import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDashboardScrollDebug } from "../debug/dashboardScrollDebug";
import type { AppScreen, ChartBundle, ChartPoint, SheetTable } from "../types";
import { loadSimulationChartsBundle } from "../data/simulationCharts";
import { useInvestSimInputs, useRegisterExternalHolding } from "../hooks/useInvestSimInputs";
import {
  aggregateOpenPortfolioPnl,
  buildDashboardPortfolioChips,
  buildPortfolioDailyPnlLedger,
  isValidMarketTicker,
  rowHasActivePortfolio,
} from "../sheet/simulationPosition";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import { useDashboardPortfolioMetricsReady } from "../hooks/useDashboardPortfolioMetricsReady";
import {
  readLocalSdsSnapshot,
  fetchRegulatoryRiskSnapshot,
  fetchIntraday1h,
  fetchVolumeAcceleration,
  fetchVolumeVsPrevSession,
  type RegulatoryRiskSnapshot,
  type SdsRow,
} from "../api/supernova";
import { useClinicalPreCdRecords } from "../hooks/useClinicalPreCdRecords";
import { buildPriorSessionPctByTicker } from "../sheet/softBuyRisingStreak";
import { buildSdsByTicker, setCachedSdsForTopOpps } from "../sheet/sdsTopOppGate";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import { daysToCdFromSimRow } from "../sheet/sdsCohortScope";
import { RefreshControls } from "./RefreshControls";
import { useLang, useT } from "../shared/i18n";
import type { DashboardAiFeedTickerMeta } from "./DashboardAiFeedCard";
import {
  countRecentPastEvents,
  flattenAiFeed,
  rankAndSliceFeed,
} from "../sheet/dashboardAiFeedBuild";
import {
  buildMobileDashboardSnapshot,
  scheduleMobileDashboardSnapshotPublish,
} from "../api/mobileDashboardSnapshot";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { buildWhatIfCrownReadoutContext } from "../sheet/whatIfCrownReadout";
import {
  hydrateWhatIfReadoutDailySnapshot,
  maybeSnapshotUniverseReadouts,
} from "../sheet/whatIfReadoutDailySnapshot";
import { PortfolioPnlSummaryBlock } from "./PortfolioPnlSummaryBlock";
import { loadSdsReferenceCurves, type SdsRoiProfileId } from "../sheet/sdsRoiBlend";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import {
  getCachedMarketContextSnapshot,
  loadMarketContextSnapshot,
  type MarketContextSnapshotDoc,
} from "../sheet/marketContextScore";
import { GAIN_STAR_LEDGER_CHANGED_EVENT } from "../sheet/gainStarLedger";
import {
  syncEarlyPeakMinTargets,
} from "../sheet/earlyPeakMinPriceAlerts";
import type { EarlyPeakBuyMinTarget } from "../sheet/earlyPeakBuyMinTarget";
import { EarlyPeakMinPriceAlertModal } from "./EarlyPeakMinPriceAlertModal";
import { HighImpactEisToast } from "./HighImpactEisToast";
import { VolumeSpikeToast } from "./VolumeSpikeToast";
import { publishDashboardRecommendationsFromSimulation } from "../sheet/topOppsFromSimulation";
import { subscribeTopOpps } from "../sheet/topOppsStore";
import {
  filterOffPortfolioHotZoneSimRows,
} from "../sheet/simCdHorizonScope";
import { DashboardPulseTable } from "./DashboardPulseTable";
import { NewEntriesThisWeekTable } from "./NewEntriesThisWeekTable";
import { HypeDetectedThisWeekTable } from "./HypeDetectedThisWeekTable";
import { DashboardRecommendationsModal } from "./DashboardRecommendationsModal";
import { MarketContextWidget } from "./MarketContextWidget";
import { runWhatIfLiveSignalsForPanel } from "../sheet/whatIfPanelRefresh";
import { invalidateProjectJsonCache } from "../data/projectData";
import {
  buildOperationalRecResult,
  type OperationalRecResult,
} from "../sheet/operationalRecommendation";
import { isVolumeSurge } from "../sheet/volumeVsPrevSession";
import { maybeTriggerEisForHighVol } from "../sheet/volumeAccelEisTrigger";
import { maybeRunHypeVolumeFunnelScan } from "../sheet/hypeVolumeFunnelTrigger";
import { subscribeTop2BuySell } from "../sheet/top2BuySellStore";
import {
  buildDashboardPulseData,
  buildDashboardVisitSnapshotFromState,
  buildSyntheticDayVisitBaseline,
  captureDashboardVisitBaseline,
} from "../sheet/dashboardPulseView";
import {
  saveDashboardVisitSnapshot,
  clearDashboardVisitSnapshot,
  loadDashboardVisitSnapshot,
  loadSessionVisitBaseline,
  saveSessionVisitBaseline,
  visitSnapshotLooksLikeSameSessionPoison,
  type DashboardVisitSnapshot,
} from "../sheet/dashboardVisitSnapshot";
import { useRefreshStatus } from "../shared/refreshStatusStore";
import { buildPnlRankIndexMap, piggyBankChipRankVisual } from "../sheet/dealRankIcon";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import {
  resolvePortfolioPositionActionForRow,
} from "../sheet/portfolioPositionAction";
import {
  PORTFOLIO_CHIP_CLS,
  portfolioPiggyBankChipDisplay,
  piggyChipToneFrom24h,
  piggyBankNeedsDayVsTotalNote,
  piggyBankPriorLegFromEntry,
} from "../sheet/portfolioGainLossStyle";
import { piggyTrendLooksLikeDataCorrection } from "../sheet/piggyBankTrend";
import { PortfolioHeroRankIcon, RankAnimalIcon } from "./DealRankBadge";
import { ClosedPiggyBankCompact } from "./ClosedPiggyBankBeerGlass";
import { useClosedPiggyBank } from "../hooks/useClosedPiggyBank";
import { ManualEisGainStarOnly } from "./ManualEisConfirmedCell";
import type { ClosedPiggyBankDisplay } from "../sheet/closedPiggyBank";
import {
  resolvePiggyChipMoveBadge,
  xbiDayReturnPctFromSnapshot,
} from "../sheet/piggyIdiosyncraticBadge";
import {
  softBuyGatePiggyTintClass,
  type SoftBuyGateStrength,
} from "../sheet/softBuyGateStrength";
import { SoftBuyGateStrengthMarks } from "./SoftBuyGateStrengthMarks";
import { buildSuggestionMonitorRows } from "../sheet/suggestionMonitor";
import {
  DECISION_SIM_CHANGED_EVENT,
  loadDecisionSimState,
} from "../sheet/investDecisionSimStorage";
import {
  ADVICE_FEEDBACK_CHANGED_EVENT,
  loadAdviceFeedback,
} from "../sheet/adviceFeedback";
import {
  type LossRiskCatalog,
} from "../hooks/useLossRiskCatalog";
import type { LossRiskEntry } from "./LossRiskPoopCell";

/** Stable empties — never allocate per render (breaks operationalRec / monitor memos). */
const EMPTY_LOSS_RISK_CATALOG: LossRiskCatalog = new Map();
const EMPTY_LOSS_RISK_BY_ROW: Map<string, LossRiskEntry> = new Map();
import { useSimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";
import { loadUiPrefsLocal } from "../sheet/uiPrefs";

// ── Utility ──────────────────────────────────────────────────

function fmtSignedUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : v > 0 ? "+" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtUsd(v: number): string {
  return fmtSignedUsd(v).replace(/^\+/, "");
}

function tickerFromRow(row: Record<string, unknown>): string {
  return String(row["Ticker"] ?? "")
    .trim()
    .toUpperCase();
}

// ── PiggyBankBar ─────────────────────────────────────────────────────────────
// Horizontal full-width bar — sits between P&L summary and Pulse.

function PiggyBankBar({
  simTable,
  inputs,
  history,
  metricsReady,
  closedPiggyDisplay,
  onResetClosedPiggy,
  reinvestedEur,
  openFromBudgetEur,
  gainsCashEur,
  gateStrengthByKey,
}: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  /** False while Simulation / inputs / history are still merging — hide P&L numbers. */
  metricsReady: boolean;
  closedPiggyDisplay: ClosedPiggyBankDisplay;
  onResetClosedPiggy: () => void;
  /** Open-book amount from gains beyond budget (budget-first). */
  reinvestedEur?: number;
  /** Open-book amount still covered by the investment budget. */
  openFromBudgetEur?: number;
  /** Closed gains sitting in piggy cash (not drawn for open book). */
  gainsCashEur?: number;
  /** Soft BUY gate ticks — same engine as Suggested BUY chips. */
  gateStrengthByKey?: Map<string, SoftBuyGateStrength>;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";

  const rowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable?.rows],
  );

  const chips = useMemo(
    () => buildDashboardPortfolioChips(simTable, inputs, history),
    [simTable, inputs, history],
  );

  const portfolioTotals = useMemo(
    () => aggregateOpenPortfolioPnl(simTable, inputs, history),
    [simTable, inputs, history],
  );

  /** XBI last-session % — idio badge when market flat and ticker Var.24h moves. */
  const xbiDayPct = useMemo(
    () => xbiDayReturnPctFromSnapshot(getCachedMarketContextSnapshot()),
    // Snapshot is cached by App boot; refresh when open P&L updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metricsReady, portfolioTotals.pnlEur],
  );

  const totalCapital = portfolioTotals.capital;
  const totalPnl = portfolioTotals.pnlEur;
  const isPos = totalPnl > 0;
  const isNeg = totalPnl < 0;
  const noData = totalCapital === 0 || !metricsReady;
  const positionsReady = metricsReady && totalCapital > 0;
  const pnlPct = portfolioTotals.pnlPct;
  const fillPct = Math.min(100, Math.max(0, (pnlPct / 40) * 100));

  // Track piggy delta since the previous data refresh, so we can flag with
  // an up/down arrow whether the portfolio moved up or down from the last
  // observed value. Both the baseline AND the last detected trend are
  // persisted to localStorage so the arrow survives page reloads / tab
  // remounts — i.e. it always reflects "since the last time this tab was
  // updated" rather than only "since this React mount". Without persisting
  // the trend itself, the arrow vanished every time the page reloaded with
  // an unchanged value (very common: you reopen the dashboard, totalPnl
  // matches the saved baseline, no delta is recomputed → no arrow).
  const PIGGY_BASELINE_KEY = "dashboard.piggy.lastPnlEur";
  const PIGGY_TREND_KEY = "dashboard.piggy.lastTrend";
  // Stale trends past this age are ignored on hydration (default 48h) so a
  // very old arrow can't keep pointing forever after a long idle period.
  const PIGGY_TREND_MAX_AGE_MS = 48 * 60 * 60 * 1000;
  const prevPnlRef = useRef<number | null>(null);
  const [pnlTrend, setPnlTrend] = useState<{ delta: number; ts: number } | null>(null);
  // Hydrate baseline + last trend once on mount — synchronously, so the
  // FIRST totalPnl effect run can already compare against a real previous
  // value, and so the user immediately sees the last-known arrow direction
  // even when nothing has changed since the previous visit.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PIGGY_BASELINE_KEY);
      if (raw != null) {
        const n = Number(raw);
        if (Number.isFinite(n)) prevPnlRef.current = n;
      }
    } catch {
      /* localStorage unavailable — non-fatal */
    }
    try {
      const raw = window.localStorage.getItem(PIGGY_TREND_KEY);
      if (raw != null) {
        const parsed = JSON.parse(raw) as { delta?: unknown; ts?: unknown };
        const d = typeof parsed?.delta === "number" ? parsed.delta : NaN;
        const ts = typeof parsed?.ts === "number" ? parsed.ts : NaN;
        if (
          Number.isFinite(d) &&
          d !== 0 &&
          Number.isFinite(ts) &&
          Date.now() - ts < PIGGY_TREND_MAX_AGE_MS
        ) {
          setPnlTrend({ delta: d, ts });
        }
      }
    } catch {
      /* localStorage unavailable / corrupted JSON — non-fatal */
    }
  }, []);
  useEffect(() => {
    if (noData || !metricsReady) {
      // Don't wipe the persisted baseline OR the persisted trend here: if
      // data is temporarily unavailable (e.g. mid-refresh, simTable empty
      // for an instant), we still want the next successful load to be able
      // to compare against the last known value AND to keep showing the
      // most recent arrow direction in the meantime.
      return;
    }
    const prev = prevPnlRef.current;
    const looksLikeCorrection =
      prev != null &&
      prev !== totalPnl &&
      piggyTrendLooksLikeDataCorrection(
        prev,
        totalPnl,
        portfolioTotals.pnlEurToday,
        portfolioTotals.todayCovered,
      );

    if (looksLikeCorrection) {
      setPnlTrend(null);
      try {
        window.localStorage.removeItem(PIGGY_TREND_KEY);
      } catch {
        /* localStorage unavailable — non-fatal */
      }
    } else if (prev != null && prev !== totalPnl) {
      const next = { delta: totalPnl - prev, ts: Date.now() };
      setPnlTrend(next);
      try {
        window.localStorage.setItem(PIGGY_TREND_KEY, JSON.stringify(next));
      } catch {
        /* localStorage unavailable — non-fatal */
      }
    }
    prevPnlRef.current = totalPnl;
    try {
      window.localStorage.setItem(PIGGY_BASELINE_KEY, String(totalPnl));
    } catch {
      /* localStorage unavailable — non-fatal */
    }
  }, [totalPnl, noData, metricsReady, portfolioTotals.pnlEurToday, portfolioTotals.todayCovered]);

  const positions = chips;

  const chipRank = useMemo(() => {
    const rows = positions.map((p) => ({
      ticker: p.ticker,
      pnlPct: p.pnlPct,
      pnlEur: p.pnlEur,
      pnlUnavailable: false,
    }));
    return buildPnlRankIndexMap(rows, "total", (r) => r.ticker);
  }, [positions]);

  /** Miglior → peggiore P&L totale (👑 … 🐔). */
  const positionsForChips = useMemo(() => {
    return [...positions]
      .sort((a, b) => {
        const ra = chipRank.rankByKey.get(a.ticker) ?? 999;
        const rb = chipRank.rankByKey.get(b.ticker) ?? 999;
        return ra - rb;
      })
      .slice(0, 6);
  }, [positions, chipRank]);

  const pnl24h = useMemo(
    () => ({
      eur: portfolioTotals.pnlEurToday,
      pct: portfolioTotals.pnlPctToday,
      covered: portfolioTotals.todayCovered,
      total: portfolioTotals.todayTotal,
    }),
    [portfolioTotals],
  );

  const pnlColor = noData
    ? "text-ink-muted"
    : isPos
      ? "text-[rgb(var(--signal-up))]"
      : isNeg
        ? "text-[rgb(var(--signal-down))]"
        : "text-ink";

  const has24h = pnl24h.covered > 0 && pnl24h.pct != null;
  const is24hPos = pnl24h.eur > 0;
  const is24hNeg = pnl24h.eur < 0;
  const priorLegEur = has24h ? piggyBankPriorLegFromEntry(totalPnl, pnl24h.eur) : null;
  const showDayVsTotalNote =
    has24h && piggyBankNeedsDayVsTotalNote(totalPnl, pnl24h.eur);
  const piggyTotalTitle = useMemo(() => {
    if (!metricsReady) {
      return lang === "it"
        ? "Caricamento prezzi e storico P&L…"
        : "Loading prices and P&L history…";
    }
    if (has24h && priorLegEur != null) {
      const todayStr = fmtUsd(pnl24h.eur);
      const priorStr = fmtUsd(priorLegEur);
      if (portfolioTotals.anyHistoryUncertainContamination) {
        return t("dashboard.piggy.priorLegUncertain", { today: todayStr, prior: priorStr });
      }
      if (portfolioTotals.priorLegIsImplicitEstimate) {
        return t("dashboard.piggy.priorLegImplicit", { today: todayStr, prior: priorStr });
      }
      if (showDayVsTotalNote) {
        return t("dashboard.piggy.priorLegVerified", { today: todayStr, prior: priorStr });
      }
    }
    return lang === "it"
      ? "Somma (valore attuale − capitale) su posizioni aperte"
      : "Sum of (current value − capital) on open positions";
  }, [
    metricsReady,
    lang,
    t,
    has24h,
    priorLegEur,
    pnl24h.eur,
    portfolioTotals.anyHistoryUncertainContamination,
    portfolioTotals.priorLegIsImplicitEstimate,
    showDayVsTotalNote,
  ]);
  const pnl24hColor = !has24h
    ? "text-ink-muted"
    : is24hPos
      ? "text-[rgb(var(--signal-up))]"
      : is24hNeg
        ? "text-[rgb(var(--signal-down))]"
        : "text-ink";

  return (
    <div
      className="piggy-bank-bar piggy-bank-bar--compact shrink-0 flex items-center gap-2 px-3 py-1.5 overflow-hidden relative rounded-xl border"
      title={
        lang === "it"
          ? "Salvadanaio portfolio: P&L totale dall'ingresso, variazione 24h, barra 0–40% del target gain, chip per ticker (verde=24h positiva, rosso=24h negativa)"
          : "Portfolio piggy bank: total P&L since entry, 24h move, 0–40% target gain bar, per-ticker chips (green=24h up, red=24h down)"
      }
    >
      {/* Portfolio rank pig (same tiers as P&L: 👑🐷 → 🐔) */}
      <div className="relative select-none shrink-0 flex items-end justify-center min-w-[3rem]">
        <PortfolioHeroRankIcon gainPct={pnlPct} noData={noData} basePx={40} />
        {isPos && !noData && (
          <span
            className="absolute -top-1 -right-1 text-sm leading-none"
            style={{ animation: "bounce 2s ease-in-out infinite" }}
          >
            🪙
          </span>
        )}
        {isNeg && !noData && (
          <span className="absolute -top-1 -right-1 text-xs leading-none">💸</span>
        )}
        {has24h && is24hNeg && isPos && !noData && (
          <span
            className="absolute -bottom-0.5 -right-1 text-[10px] leading-none"
            title={lang === "it" ? "Oggi in perdita" : "Down today"}
          >
            📉
          </span>
        )}
      </div>

      {/* P&L totale + 24h — blocco compatto */}
      <div className="shrink-0 min-w-[7.25rem] space-y-0.5">
        <p className="piggy-bank-bar-label text-[7px] uppercase tracking-widest font-semibold leading-none">
          Piggy Bank
        </p>
        <p
          className={`text-base font-bold tabular-nums leading-none ${pnlColor}`}
          title={piggyTotalTitle}
        >
          {noData ? (metricsReady ? "—" : "…") : `${totalPnl >= 0 ? "+" : ""}${fmtUsd(totalPnl)}`}
          {!noData && (
            <span className="text-[10px] font-semibold opacity-90">
              {" "}
              ({totalPnl >= 0 ? "+" : ""}
              {pnlPct.toFixed(1)}%)
            </span>
          )}
          {!noData && pnlTrend && pnlTrend.delta !== 0 ? (
            <span
              key={pnlTrend.ts}
              className={`piggy-refresh-trend inline-block ml-1 text-[11px] font-bold leading-none align-middle ${
                pnlTrend.delta > 0
                  ? "text-[rgb(var(--signal-up))]"
                  : "text-[rgb(var(--signal-down))]"
              }`}
              title={
                lang === "it"
                  ? `${pnlTrend.delta > 0 ? "+" : ""}${fmtUsd(pnlTrend.delta)} dall'ultimo refresh`
                  : `${pnlTrend.delta > 0 ? "+" : ""}${fmtUsd(pnlTrend.delta)} since last refresh`
              }
              aria-label={
                pnlTrend.delta > 0
                  ? lang === "it"
                    ? "Piggy bank in aumento dall'ultimo refresh"
                    : "Piggy bank up since last refresh"
                  : lang === "it"
                    ? "Piggy bank in calo dall'ultimo refresh"
                    : "Piggy bank down since last refresh"
              }
            >
              {pnlTrend.delta > 0 ? "▲" : "▼"}
            </span>
          ) : null}
        </p>
        <p
          className="text-[9px] tabular-nums leading-snug font-medium"
          title={
            pnl24h.covered > 0
              ? lang === "it"
                ? `Var. 24h · ${pnl24h.covered}/${pnl24h.total} ticker`
                : `24h move · ${pnl24h.covered}/${pnl24h.total} tickers`
              : undefined
          }
        >
          <span className="text-ink-muted/80 uppercase text-[7px] tracking-wide">
            {lang === "it" ? "24h " : "24h "}
          </span>
          {has24h ? (
            <span className={pnl24hColor}>
              {pnl24h.eur >= 0 ? "+" : ""}
              {fmtUsd(pnl24h.eur)} ({pnl24h.pct! >= 0 ? "+" : ""}
              {pnl24h.pct!.toFixed(2)}%)
            </span>
          ) : (
            <span className="text-ink-muted">—</span>
          )}
        </p>
      </div>

      {/* Fill bar — stretches to fill the middle */}
      <div className="flex-1 min-w-0 px-2">
        {!metricsReady ? (
          <p className="piggy-bank-bar-meta text-xs text-ink-muted">
            {lang === "it" ? "Caricamento P&L portfolio…" : "Loading portfolio P&L…"}
          </p>
        ) : totalCapital <= 0 ? (
          <p className="piggy-bank-bar-meta text-xs">
            {lang === "it"
              ? "Inserisci capitale in Simulation per riempire il salvadanaio"
              : "Enter capital in Simulation to start filling the piggy bank"}
          </p>
        ) : (
          <>
            <div className="piggy-bank-bar-scale flex justify-between text-[7px] mb-0.5 leading-none">
              <span>0%</span>
              <span className="font-medium">
                {isPos ? "🪙" : isNeg ? "📉" : "●"} {Math.abs(pnlPct).toFixed(1)}% / 40%
              </span>
              <span>+40%</span>
            </div>
            <div className="piggy-bank-bar-track h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-1000 ease-out ${
                  isPos
                    ? "bg-gradient-to-r from-pink-300/80 via-emerald-400/80 to-[rgb(var(--signal-up))]"
                    : "bg-[rgb(var(--signal-down))]/70"
                }`}
                style={{ width: `${fillPct}%` }}
              />
            </div>
          </>
        )}
      </div>

      {/* Salvadanaio opportunità chiuse — bicchiere birra */}
      <ClosedPiggyBankCompact
        display={closedPiggyDisplay}
        onReset={onResetClosedPiggy}
        onOpenDetail={undefined}
        reinvestedEur={reinvestedEur}
        openFromBudgetEur={openFromBudgetEur}
        gainsCashEur={gainsCashEur}
      />

      {/* Per-ticker chips — same engine as Pulse (resolvePositionPnlBreakdown) */}
      {positionsReady && positions.length > 0 && (
        <div className="shrink-0 flex items-center gap-1 flex-wrap max-w-[280px]">
          {positionsForChips.map(({ ticker, key, pnlEur, pnlPct: pp, pnlEur24h, pnlPct24h }) => {
            const chip = portfolioPiggyBankChipDisplay(
              pnlEur,
              pp,
              pnlEur24h,
              pnlPct24h,
              lang,
            );
            const action = resolvePortfolioPositionActionForRow(rowByKey.get(key) ?? null, {
              pnlEur,
              pnlPct: pp,
            });
            const chipTone = piggyChipToneFrom24h(pnlEur24h, pnlPct24h);
            const rankIdx = chipRank.rankByKey.get(ticker);
            const rankVisual = piggyBankChipRankVisual(
              rankIdx ?? null,
              chipRank.total,
              action,
              pp,
            );
            const todayLbl = lang === "it" ? "oggi" : "24h";
            const idioBadge = resolvePiggyChipMoveBadge(pnlPct24h, xbiDayPct);
            const gate = gateStrengthByKey?.get(key) ?? null;
            const gateTint = gate
              ? softBuyGatePiggyTintClass(gate.tier, gate.ticks)
              : "";
            const chipTitle = [
              `${ticker}: ${chip.title}`,
              idioBadge ? (it ? idioBadge.titleIt : idioBadge.titleEn) : null,
              gate ? (it ? gate.summaryIt : gate.summaryEn) : null,
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <span
                key={ticker}
                className={`piggy-bank-chip piggy-bank-chip--${chipTone} ${PORTFOLIO_CHIP_CLS[chipTone]}${gateTint ? ` ${gateTint}` : ""}`}
                title={chipTitle}
              >
                {rankVisual ? <RankAnimalIcon visual={rankVisual} basePx={12} /> : null}
                {gate && gate.ticks > 0 ? (
                  <SoftBuyGateStrengthMarks strength={gate} dense />
                ) : null}
                <ManualEisGainStarOnly ticker={ticker} pnlPct24h={pnlPct24h} />
                {idioBadge ? (
                  <span
                    className="rounded px-0.5 text-[8px] font-bold uppercase tracking-wide bg-amber-500/20 text-amber-900 dark:text-amber-100 border border-amber-500/35"
                    title={it ? idioBadge.titleIt : idioBadge.titleEn}
                  >
                    {it ? idioBadge.labelIt : idioBadge.labelEn}
                  </span>
                ) : null}
                <span className="text-[10px] leading-snug">
                  <span className="font-bold">{ticker}</span>{" "}
                  <span>{chip.mainUsd}</span>
                  {chip.dailySuffixUsd ? (
                    <span className="opacity-75 font-normal text-[9px]">
                      {" "}
                      · {todayLbl} {chip.dailySuffixUsd}
                    </span>
                  ) : null}
                </span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

// ── Main component ────────────────────────────────────────────

export function MainDashboardView({
  simTable,
  simLoading,
  secK8Loading: _secK8Loading,
  onScreen: _onScreen,
  onOpenSecK8: _onOpenSecK8,
  onReload,
  onReloadSimulation,
  onOpen24hAssessment,
  onRegisterBuy,
  onSellPosition,
  onOpenPredictionCharts: _onOpenPredictionCharts,
  onOpenCatalystFeed: _onOpenCatalystFeed,
  onOpenClinicalFeed: _onOpenClinicalFeed,
  onOpenSupernovaTab,
  sharedChartBundle = null,
  sharedLossRiskCatalog = null,
  sharedLossRiskByRowKey = null,
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
  secK8Table: SheetTable | null;
  secK8Loading: boolean;
  onScreen: (s: AppScreen) => void;
  onOpenSecK8?: (ticker: string) => void;
  /** Full local reload of every snapshot used by the dashboard. */
  onReload?: () => void | Promise<void>;
  /** Reload Simulation snapshot only (what-if panel after live signals). */
  onReloadSimulation?: () => void | Promise<SheetTable | null | undefined>;
  onOpen24hAssessment?: (focus: {
    ticker: string;
    cd?: string;
    rowKey?: string;
    openDeepDive?: boolean;
  }) => void;
  onRegisterBuy?: import("../hooks/useInvestSimInputs").PortfolioRegisterBuyHandler;
  onSellPosition?: import("./PortfolioExitButton").PortfolioSellHandler;
  onOpenPredictionCharts?: (focus: { seriesKey: string | null; ticker: string }) => void;
  onOpenCatalystFeed?: () => void;
  onOpenClinicalFeed?: (ticker: string) => void;
  onOpenSupernovaTab?: (ticker: string) => void;
  /** Chart bundle from App — avoids duplicate loadSimulationChartsBundle on dashboard. */
  sharedChartBundle?: ChartBundle | null;
  /** Shared Risk v2 catalog from App (single build for Home + sim-loop Soft SELL). */
  sharedLossRiskCatalog?: LossRiskCatalog | null;
  sharedLossRiskByRowKey?: Map<string, LossRiskEntry> | null;
}) {
  useDashboardScrollDebug("MainDashboardView", "post-fix-v2");
  const simRows = simTable?.rows ?? [];

  const t = useT();
  const { lang } = useLang();
  const { dataUpdatedAt } = useRefreshStatus();
  const [dashboardReloadToken, setDashboardReloadToken] = useState(0);
  /** Yahoo prior-session % — Soft BUY / Cutoff growth streak (↑≥2d). */
  const [priorSessionPctByTicker, setPriorSessionPctByTicker] = useState<
    Map<string, number>
  >(() => new Map());
  const [volumeAccelByTicker, setVolumeAccelByTicker] = useState<
    Map<string, { flagged: boolean; score: number | null; doublingMinutes: number | null; rvol: number | null }>
  >(() => new Map());
  /** Daily VOL vs prev ≥150% — Off Book High Vol rescue into Suggested BUY. */
  const [volumeSurgeTickers, setVolumeSurgeTickers] = useState<string[]>([]);
  const [cdHorizonPublishRev, setCdHorizonPublishRev] = useState(0);
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false);
  const [refreshPhaseLabel, setRefreshPhaseLabel] = useState<string | null>(null);
  const [livePricesBackground, setLivePricesBackground] = useState(false);
  const [mobilePublishContext, setMobilePublishContext] = useState<{
    autoRegSnap: RegulatoryRiskSnapshot | null;
    mcsDoc: MarketContextSnapshotDoc | null;
  }>({ autoRegSnap: null, mcsDoc: null });
  const [gainStarLedgerVersion, setGainStarLedgerVersion] = useState(0);
  const { records: clinicalPreCdRecordsMerged } = useClinicalPreCdRecords();
  const [recModalOpen, setRecModalOpen] = useState(false);
  const [recStats, setRecStats] = useState({ total: 0, newCount: 0, keySig: "" });
  const recModalAckSigRef = useRef("");
  const inputs = useInvestSimInputs(simTable, dashboardReloadToken);
  const registerExternalHolding = useRegisterExternalHolding(simTable);
  const { history: portfolioHistory, historyReady } = useInvestSimPortfolioHistory(
    dashboardReloadToken,
  );
  const portfolioInputsReady = useDashboardPortfolioMetricsReady(
    simTable,
    simLoading,
    dashboardReloadToken,
  );
  const portfolioMetricsReady = portfolioInputsReady && historyReady;

  const [decisionSimState, setDecisionSimState] = useState(() => loadDecisionSimState());
  const [adviceFeedback, setAdviceFeedback] = useState(() =>
    typeof window !== "undefined" ? loadAdviceFeedback() : null,
  );
  useEffect(() => {
    const onSimChange = () => setDecisionSimState(loadDecisionSimState());
    window.addEventListener(DECISION_SIM_CHANGED_EVENT, onSimChange);
    return () => window.removeEventListener(DECISION_SIM_CHANGED_EVENT, onSimChange);
  }, []);

  useEffect(() => {
    const onFeedbackChange = () => setAdviceFeedback(loadAdviceFeedback());
    window.addEventListener(ADVICE_FEEDBACK_CHANGED_EVENT, onFeedbackChange);
    return () => window.removeEventListener(ADVICE_FEEDBACK_CHANGED_EVENT, onFeedbackChange);
  }, []);

  const [chartBundle, setChartBundle] = useState<ChartBundle | null>(sharedChartBundle);
  const [eisState, setEisState] = useState<Awaited<ReturnType<typeof loadEisSuperScoreState>> | null>(
    null,
  );
  const polygonOverview = useCdPatternPolygonOverview();
  const [refCurves, setRefCurves] = useState<
    Partial<Record<SdsRoiProfileId, (number | null)[]>>
  >({});
  const [sdsGateTick, setSdsGateTick] = useState(0);
  const [sdsRowsForMig, setSdsRowsForMig] = useState<SdsRow[] | null>(null);

  useEffect(() => {
    if (sharedChartBundle) setChartBundle(sharedChartBundle);
  }, [sharedChartBundle]);

  /** SDS + charts first (Pulse). EIS / ref curves after idle. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const needCharts = !sharedChartBundle || dashboardReloadToken > 0;
      const [chartsRes, sdsDoc] = await Promise.all([
        needCharts ? loadSimulationChartsBundle() : Promise.resolve({ bundle: sharedChartBundle! }),
        readLocalSdsSnapshot(),
      ]);
      if (cancelled) return;
      setChartBundle(chartsRes.bundle);
      setCachedSdsForTopOpps(buildSdsByTicker(sdsDoc?.rows));
      setSdsRowsForMig(sdsDoc?.rows ?? null);
      if (dashboardReloadToken > 0) setSdsGateTick((n) => n + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [dashboardReloadToken, sharedChartBundle]);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      void Promise.all([loadEisSuperScoreState(), loadSdsReferenceCurves()]).then(
        ([eis, curves]) => {
          if (cancelled) return;
          setEisState(eis);
          setRefCurves(curves.refs);
        },
      );
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleHandle: number | null = null;
    const timeoutHandle = window.setTimeout(() => {
      if (typeof w.requestIdleCallback === "function") {
        idleHandle = w.requestIdleCallback(run, { timeout: 2_500 });
      } else {
        run();
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutHandle);
      if (idleHandle != null) w.cancelIdleCallback?.(idleHandle);
    };
  }, [dashboardReloadToken]);

  const portfolioRows = useMemo(
    () => simRows.filter((r) => rowHasActivePortfolio(r, inputs)),
    [simRows, inputs],
  );

  useEffect(() => {
    const unsubTopOpps = subscribeTopOpps(() => {});
    const unsubTop2 = subscribeTop2BuySell(() => {});
    return () => {
      unsubTopOpps();
      unsubTop2();
    };
  }, []);

  const sdsByTicker = useMemo(() => buildSdsByTicker(sdsRowsForMig), [sdsRowsForMig]);
  const migSolidityByKey = useMemo(
    () => buildMigSolidityByKey(simTable, chartBundle, sdsRowsForMig),
    [simTable, chartBundle, sdsRowsForMig],
  );

  const readoutSnapshotCtx = useMemo(
    () =>
      buildWhatIfCrownReadoutContext({
        sdsRows: sdsRowsForMig,
        eisSuperScoreState: eisState,
        simTable,
        chartBundle,
        inputs,
      }),
    [sdsRowsForMig, eisState, simTable, chartBundle, inputs],
  );

  useEffect(() => {
    void hydrateWhatIfReadoutDailySnapshot();
  }, []);

  useEffect(() => {
    if (!simTable?.rows?.length || !sdsRowsForMig?.length) return;
    maybeSnapshotUniverseReadouts({
      simTable,
      inputs,
      ctx: readoutSnapshotCtx,
    });
  }, [simTable, sdsRowsForMig, readoutSnapshotCtx, inputs]);

  const probOptionsForPublish = useMemo((): LossAnalysisProbOptions | null => {
    if (!simTable?.rows?.length) return null;
    return {
      sdsRows: sdsRowsForMig,
      migSolidityByKey,
      eisSuperScoreState: eisState,
      polygonOverview,
      lightweightPolygon: true,
      mergedInputs: inputs,
    };
  }, [simTable, sdsRowsForMig, migSolidityByKey, eisState, polygonOverview, inputs]);

  const lossRiskCatalog = sharedLossRiskCatalog ?? EMPTY_LOSS_RISK_CATALOG;
  const catalogByRowKey = sharedLossRiskByRowKey ?? EMPTY_LOSS_RISK_BY_ROW;

  const langCode = lang === "it" ? "it" : "en";

  const opportunityRows = useMemo(
    () => filterOffPortfolioHotZoneSimRows(simRows, inputs),
    [simRows, inputs],
  );

  const top2ChartPointsByKey = useMemo(() => {
    const m = new Map<string, ChartPoint[]>();
    if (!chartBundle) return m;
    for (const [key, series] of Object.entries(chartBundle.series)) {
      if (series.points?.length) m.set(key, series.points);
    }
    return m;
  }, [chartBundle]);

  const dashboardTopCapital = useMemo(() => {
    const pref = loadUiPrefsLocal().topCapital;
    if (pref != null && Number.isFinite(pref) && pref > 0) return pref;
    let sum = 0;
    for (const v of Object.values(inputs)) {
      if (v.capital > 0) sum += v.capital;
    }
    return sum > 0 ? sum : 5000;
  }, [inputs]);

  /** Portfolio investment budget (casella Portfolio) — budget-first open attribution. */
  const portfolioBudgetEur = useMemo(() => {
    const pref = loadUiPrefsLocal();
    const v = pref.topCapitalPortfolio ?? pref.topCapital;
    return v != null && Number.isFinite(v) && v > 0 ? v : 50_000;
  }, [inputs, dashboardReloadToken]);

  const sharedSynthAlloc = useSimLoopSynthAllocation({
    simTable,
    sdsRows: sdsRowsForMig,
    investInputs: inputs,
    pointsBySeriesKey: top2ChartPointsByKey,
    totalCapitalEur: dashboardTopCapital,
    enabled: Boolean(simTable?.rows?.length) && dashboardTopCapital > 0,
  });

  const sharedMonitorRows = useMemo(() => {
    if (!simTable?.rows?.length) return [];
    return buildSuggestionMonitorRows({
      simTable,
      inputs,
      pointsBySeriesKey: top2ChartPointsByKey,
      lang: langCode,
      probOptions: probOptionsForPublish,
      paperPortfolio: decisionSimState.paperPortfolio,
      adviceFeedback,
      synthAlloc: sharedSynthAlloc,
      history: portfolioHistory,
      lossRiskCatalog,
      catalogByRowKey,
      autoRegSnap: mobilePublishContext.autoRegSnap,
    });
  }, [
    simTable,
    inputs,
    top2ChartPointsByKey,
    langCode,
    probOptionsForPublish,
    decisionSimState.paperPortfolio,
    adviceFeedback,
    sharedSynthAlloc,
    portfolioHistory,
    lossRiskCatalog,
    catalogByRowKey,
    mobilePublishContext.autoRegSnap,
  ]);

  const closedLedger = useMemo(
    () => buildPortfolioDailyPnlLedger(simTable, inputs, portfolioHistory),
    [simTable, inputs, portfolioHistory],
  );
  const { display: closedPiggyDisplay, reset: resetClosedPiggy } =
    useClosedPiggyBank(closedLedger, inputs);

  /**
   * Visit baseline frozen at dashboard enter. Re-reading localStorage on each
   * price tick zeroes Δ visit after alt-tab (visibility save overwrites storage).
   * `undefined` = not captured yet; `null` = first visit / discarded stale.
   */
  const [visitBaseline, setVisitBaseline] = useState<
    DashboardVisitSnapshot | null | undefined
  >(undefined);
  const visitBaselineCapturedRef = useRef(false);

  useEffect(() => {
    if (!portfolioMetricsReady || simLoading || !simTable?.rows?.length) return;
    if (visitBaselineCapturedRef.current) return;
    const totals = aggregateOpenPortfolioPnl(simTable, inputs, portfolioHistory);
    // Prefer tab session freeze — Strict Mode remount used to re-read a leave
    // snapshot just written with live MTM and zero Δ visit for the whole visit.
    const sessionFrozen = loadSessionVisitBaseline();
    let baseline: DashboardVisitSnapshot | null = sessionFrozen;
    if (!baseline) {
      const prior = loadDashboardVisitSnapshot();
      const usablePrior =
        prior &&
        !visitSnapshotLooksLikeSameSessionPoison(prior, totals.pnlEur)
          ? prior
          : null;
      baseline = captureDashboardVisitBaseline(usablePrior, totals);
      if (prior && !usablePrior) {
        // Poisoned same-session leave — drop it so next real leave can rewrite.
        clearDashboardVisitSnapshot();
      } else if (prior && !baseline) {
        clearDashboardVisitSnapshot();
        try {
          window.localStorage.removeItem("dashboard.piggy.lastPnlEur");
          window.localStorage.removeItem("dashboard.piggy.lastTrend");
        } catch {
          /* non-fatal */
        }
      }
      if (!baseline) {
        // No usable leave snapshot — implied prior close (live − 24h) so Δ visit
        // shows up/down for the session instead of locking +€0 after first paint.
        baseline = buildSyntheticDayVisitBaseline({
          simTable,
          inputs,
          history: portfolioHistory,
          migByKey: migSolidityByKey,
        });
      }
      saveSessionVisitBaseline(baseline);
    }
    visitBaselineCapturedRef.current = true;
    setVisitBaseline(baseline);
  }, [
    portfolioMetricsReady,
    simLoading,
    simTable,
    inputs,
    portfolioHistory,
    migSolidityByKey,
  ]);

  const dashboardPulseData = useMemo(
    () =>
      buildDashboardPulseData({
        simTable,
        inputs,
        history: portfolioHistory,
        chartPointsByKey: top2ChartPointsByKey,
        sdsByTicker,
        migByKey: migSolidityByKey,
        /** Hold null until freeze — never live-reload storage mid-visit. */
        priorSnapshot: visitBaseline === undefined ? null : visitBaseline,
        lang,
        closedPiggyDisplay,
        startingCapitalEur: portfolioBudgetEur,
      }),
    [
      simTable,
      inputs,
      portfolioHistory,
      top2ChartPointsByKey,
      sdsByTicker,
      migSolidityByKey,
      visitBaseline,
      lang,
      closedPiggyDisplay,
      portfolioBudgetEur,
    ],
  );

  // Prior Nasdaq session returns (Yahoo 1h) — only open-book + near-CD tickers.
  // Full-universe fetch (80 names, up to 90s) was freezing Soft BUY + snapshot publish.
  useEffect(() => {
    if (!simTable?.rows?.length) {
      setPriorSessionPctByTicker(new Map());
      return;
    }
    const openTickers = new Set(
      portfolioRows
        .map((r) => String(r.Ticker ?? "").trim().toUpperCase())
        .filter((tk) => isValidMarketTicker(tk)),
    );
    const nearCd: string[] = [];
    for (const r of simTable.rows) {
      const tk = String(r.Ticker ?? "").trim().toUpperCase();
      if (!isValidMarketTicker(tk) || openTickers.has(tk)) continue;
      const d = daysToCdFromSimRow(r);
      if (d != null && d >= 0 && d <= 90) nearCd.push(tk);
    }
    const tickers = [
      ...new Set([...openTickers, ...volumeSurgeTickers, ...nearCd]),
    ].slice(0, 50);
    let cancelled = false;
    const run = () => {
      void (async () => {
        try {
          const payload = await fetchIntraday1h(tickers);
          if (cancelled) return;
          const next = buildPriorSessionPctByTicker(payload);
          startTransition(() => {
            if (!cancelled) setPriorSessionPctByTicker(next);
          });
        } catch {
          if (!cancelled) {
            startTransition(() => setPriorSessionPctByTicker(new Map()));
          }
        }
      })();
    };
    // Defer past first paint / Pulse layout.
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      idleHandle = w.requestIdleCallback(run, { timeout: 4_000 });
    } else {
      timeoutHandle = window.setTimeout(run, 1_500);
    }
    return () => {
      cancelled = true;
      if (idleHandle != null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [simTable, portfolioRows, dashboardReloadToken, volumeSurgeTickers]);

  // VOL vs prev (cheap) → EIS search on daily/live surge; 5m T_double → Soft BUY High Vol.
  useEffect(() => {
    if (!simTable?.rows?.length) {
      setVolumeSurgeTickers([]);
      setVolumeAccelByTicker(new Map());
      return;
    }
    const tickers: string[] = [];
    const seen = new Set<string>();
    for (const r of simTable.rows) {
      const tk = String(r.Ticker ?? "").trim().toUpperCase();
      if (!isValidMarketTicker(tk) || seen.has(tk)) continue;
      seen.add(tk);
      tickers.push(tk);
      if (tickers.length >= 80) break;
    }
    let cancelled = false;
    const run = () => {
      void (async () => {
        try {
          const vsPrev = await fetchVolumeVsPrevSession(tickers);
          if (cancelled) return;
          const surge = Object.entries(vsPrev.rows ?? {})
            .filter(([, row]) => isVolumeSurge(row.pct_of_prev))
            .map(([tk]) => tk.trim().toUpperCase())
            .filter(Boolean);
          if (!cancelled) {
            startTransition(() => setVolumeSurgeTickers(surge));
          }
          maybeTriggerEisForHighVol(surge);
          if (!surge.length) {
            startTransition(() => setVolumeAccelByTicker(new Map()));
            return;
          }
          const accel = await fetchVolumeAcceleration(surge);
          if (cancelled) return;
          const map = new Map<
            string,
            {
              flagged: boolean;
              score: number | null;
              doublingMinutes: number | null;
              rvol: number | null;
            }
          >();
          for (const [tk, row] of Object.entries(accel.rows ?? {})) {
            map.set(tk, {
              flagged: Boolean(row.flagged),
              score: row.score ?? null,
              doublingMinutes: row.doubling_time_minutes ?? null,
              rvol: row.rvol ?? null,
            });
          }
          startTransition(() => {
            if (!cancelled) setVolumeAccelByTicker(map);
          });
        } catch {
          if (!cancelled) {
            startTransition(() => {
              setVolumeSurgeTickers([]);
              setVolumeAccelByTicker(new Map());
            });
          }
        }
      })();
    };
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      idleHandle = w.requestIdleCallback(run, { timeout: 6_000 });
    } else {
      timeoutHandle = window.setTimeout(run, 2_500);
    }
    return () => {
      cancelled = true;
      if (idleHandle != null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [simTable, dashboardReloadToken]);

  useEffect(() => {
    if (!simTable?.rows?.length) return;
    maybeRunHypeVolumeFunnelScan(() => {
      void onReloadSimulation?.();
    });
  }, [simTable, dashboardReloadToken, onReloadSimulation]);

  /**
   * Single operative arbiter (Soft/Urgent enhance + history) — shared by
   * Pulse OPEN POSITIONS Rec and Home Cutoff BUY/SELL boxes.
   *
   * Must not run during render: buildLossAnalysisItems on the full sheet
   * blocks the JS thread, so sidebar clicks and Home scroll freeze until it
   * finishes. Yield first; publish the result as a transition.
   */
  const [operationalRec, setOperationalRec] = useState<OperationalRecResult | null>(null);
  useEffect(() => {
    if (!simTable?.rows?.length) {
      setOperationalRec(null);
      return;
    }
    let cancelled = false;
    let idleHandle: number | null = null;
    const run = () => {
      if (cancelled) return;
      const next = buildOperationalRecResult({
        simTable,
        inputs,
        pointsBySeriesKey: top2ChartPointsByKey,
        chartBundle,
        history: portfolioHistory,
        lang: langCode,
        sdsRows: sdsRowsForMig,
        probOptions: probOptionsForPublish,
        lossRiskCatalog,
        catalogByRowKey,
        autoRegSnap: mobilePublishContext.autoRegSnap,
        priorSessionPctByTicker,
        volumeAccelByTicker,
        highVolTickers: volumeSurgeTickers,
      });
      if (cancelled) return;
      startTransition(() => {
        if (!cancelled) setOperationalRec(next);
      });
    };
    const timeoutHandle = window.setTimeout(() => {
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      };
      if (typeof w.requestIdleCallback === "function") {
        idleHandle = w.requestIdleCallback(run, { timeout: 600 });
      } else {
        run();
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutHandle);
      const w = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (idleHandle != null) w.cancelIdleCallback?.(idleHandle);
    };
  }, [
    simTable,
    inputs,
    top2ChartPointsByKey,
    chartBundle,
    portfolioHistory,
    langCode,
    sdsRowsForMig,
    probOptionsForPublish,
    lossRiskCatalog,
    catalogByRowKey,
    mobilePublishContext.autoRegSnap,
    priorSessionPctByTicker,
    volumeAccelByTicker,
    volumeSurgeTickers,
  ]);

  const simRowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable?.rows],
  );

  const [earlyPeakMinTargets, setEarlyPeakMinTargets] = useState<
    Map<string, EarlyPeakBuyMinTarget>
  >(() => new Map());

  useEffect(() => {
    if (!operationalRec) return;
    const active: EarlyPeakBuyMinTarget[] = [];
    for (const b of operationalRec.buys) {
      if (
        !b.isEarlyPeak ||
        b.buyAtMinTargetUsd == null ||
        !(b.buyAtMinTargetUsd > 0)
      ) {
        continue;
      }
      const simRow = simRowByKey.get(b.key) ?? null;
      const dayRaw = simRow ? simRow["Var. Giorn. %"] : null;
      const dayPct =
        typeof dayRaw === "number" && Number.isFinite(dayRaw)
          ? dayRaw
          : typeof dayRaw === "string"
            ? Number(String(dayRaw).replace(/,/g, ".").replace(/%/g, ""))
            : null;
      active.push({
        key: b.key,
        ticker: b.ticker,
        weekMinPriceUsd: b.weekMinPriceUsd ?? b.buyAtMinTargetUsd,
        buyAtMinTargetUsd: b.buyAtMinTargetUsd,
        signalDayPct: Number.isFinite(dayPct!) ? dayPct : null,
        setAtIso: new Date().toISOString(),
      });
    }
    setEarlyPeakMinTargets(syncEarlyPeakMinTargets(active));
  }, [operationalRec, simRowByKey]);

  // Suggested action per key — Pulse Rec column (= Cutoff operative lists).
  const pulseRecommendationByKey = useMemo(() => {
    const map = new Map<string, "buy" | "sell" | "hold" | "review" | "none">();
    const byTicker = new Map<string, "buy" | "sell" | "hold" | "review" | "none">();

    // Prefer full operational enhance (history + risk/reg + G2 prior session).
    // Open-book BUY → HOLD chip (same as Decision Chart / Actions).
    if (operationalRec) {
      const openKeys = new Set(dashboardPulseData.portfolioRows.map((pr) => pr.key));
      for (const [key, action] of operationalRec.byKey) {
        const display =
          action === "buy" && openKeys.has(key) ? ("hold" as const) : action;
        map.set(key, display);
        const itemTicker = key.split("|")[0]?.trim().toUpperCase();
        if (itemTicker) byTicker.set(itemTicker, display);
      }
    }

    // Fallback: suggestion-monitor rows (synth bridge) only when op map misses.
    for (const row of sharedMonitorRows) {
      if (!row.key || !row.suggestedAction) continue;
      if (!map.has(row.key)) map.set(row.key, row.suggestedAction);
      const tk = String(row.ticker ?? "")
        .trim()
        .toUpperCase();
      if (tk && !byTicker.has(tk)) byTicker.set(tk, row.suggestedAction);
    }

    for (const pr of dashboardPulseData.portfolioRows) {
      const existing = map.get(pr.key);
      if (existing && existing !== "none") continue;
      const viaTicker = byTicker.get(pr.ticker.trim().toUpperCase());
      if (viaTicker && viaTicker !== "none") {
        map.set(pr.key, viaTicker);
      } else if (pr.gainPlanRow.capital > 0 && (!existing || existing === "none")) {
        map.set(pr.key, "hold");
      }
    }
    return map;
  }, [operationalRec, sharedMonitorRows, dashboardPulseData.portfolioRows]);

  const persistVisitRef = useRef(() => {});
  persistVisitRef.current = () => {
    if (!portfolioMetricsReady || simLoading || !simTable?.rows?.length) return;
    saveDashboardVisitSnapshot(
      buildDashboardVisitSnapshotFromState({
        simTable,
        inputs,
        history: portfolioHistory,
        migByKey: migSolidityByKey,
      }),
    );
  };

  useEffect(() => {
    const persistVisit = () => persistVisitRef.current();
    /**
     * Do NOT persist on visibilitychange (alt-tab). That used to overwrite the
     * previous-visit leave snapshot with live MTM mid-session, so the next
     * enter saw prior ≈ live → Δ visit all "—" / €0.
     * Real leave: tab close / pagehide / navigate away from Home.
     */
    /** Skip Strict Mode's synthetic unmount so we don't wipe the enter baseline. */
    let persistOnUnmount = false;
    const arm = requestAnimationFrame(() => {
      persistOnUnmount = true;
    });
    window.addEventListener("beforeunload", persistVisit);
    // Electron / PWA often skip beforeunload — pagehide is the reliable leave hook.
    window.addEventListener("pagehide", persistVisit);
    return () => {
      cancelAnimationFrame(arm);
      window.removeEventListener("beforeunload", persistVisit);
      window.removeEventListener("pagehide", persistVisit);
      // Leaving Dashboard (navigate away) — next enter compares against this.
      if (persistOnUnmount) persistVisit();
    };
  }, []);

  useEffect(() => {
    if (recStats.newCount <= 0) return;
    if (recStats.keySig === recModalAckSigRef.current) return;
    setRecModalOpen(true);
  }, [recStats.newCount, recStats.keySig]);

  const handleRecModalClose = useCallback(() => {
    recModalAckSigRef.current = recStats.keySig;
    setRecModalOpen(false);
  }, [recStats.keySig]);

  useEffect(() => {
    if (simLoading || !simTable?.rows?.length) return;
    // Opening/refreshing the Dashboard is the recompute action the staleness
    // alert points users to — force the store timestamp so the age resets even
    // when the recomputed picks are identical to the stored ones.
    publishDashboardRecommendationsFromSimulation(simTable, inputs, top2ChartPointsByKey, {
      forceTimestamp: true,
    });
  }, [simTable, inputs, simLoading, top2ChartPointsByKey, sdsGateTick]);

  const feedScopeTickers = useMemo(() => {
    const s = new Set<string>();
    for (const r of portfolioRows) {
      const tk = tickerFromRow(r);
      if (tk && !tk.includes("TOTALE")) s.add(tk);
    }
    return s;
  }, [portfolioRows]);

  const feedTickerMeta = useMemo(() => {
    const map = new Map<string, DashboardAiFeedTickerMeta>();
    for (const r of portfolioRows) {
      const tk = tickerFromRow(r).trim().toUpperCase();
      if (!tk || tk.includes("TOTALE")) continue;
      map.set(tk, {
        inPortfolio: true,
        daysToCd: daysToCdFromSimRow(r),
      });
    }
    return map;
  }, [portfolioRows]);

  const portfolioMetrics = useMemo(() => {
    const totals = aggregateOpenPortfolioPnl(simTable, inputs, portfolioHistory);
    return { cap: totals.capital, pnl: totals.pnlEur };
  }, [simTable, inputs, portfolioHistory]);

  const totalCapital = portfolioMetrics.cap;

  const allFeedItems = useMemo(
    () => flattenAiFeed(clinicalPreCdRecordsMerged, feedScopeTickers, feedTickerMeta),
    [clinicalPreCdRecordsMerged, feedScopeTickers, feedTickerMeta],
  );
  const aiFeedTop = useMemo(() => rankAndSliceFeed(allFeedItems, 10), [allFeedItems]);
  const aiFeedRecentCount = useMemo(() => countRecentPastEvents(allFeedItems), [allFeedItems]);

  const handleDashboardRefresh = useCallback(async () => {
    setDashboardRefreshing(true);
    setRefreshPhaseLabel(lang === "it" ? "Foglio…" : "Sheet…");
    invalidateProjectJsonCache("simulation_sheet_snapshot.json");
    const reloadSim = async (): Promise<SheetTable | null> => {
      if (onReloadSimulation) {
        const table = await onReloadSimulation();
        return table ?? null;
      }
      await onReload?.();
      return null;
    };
    try {
      // Fast path: re-read Simulation so the button unlocks quickly.
      // Previously we awaited Yahoo live-signals (up to 90s) THEN reloaded every
      // sheet (clinical/SEC/accuracy) — Refresh felt stuck and janked the page.
      const freshTable = await reloadSim();
      const tableForPublish = freshTable ?? simTable;
      if (tableForPublish?.rows?.length) {
        publishDashboardRecommendationsFromSimulation(
          tableForPublish,
          inputs,
          top2ChartPointsByKey,
          { forceTimestamp: true },
        );
      }
      setDashboardReloadToken((n) => n + 1);
      setSdsGateTick((n) => n + 1);
    } finally {
      setDashboardRefreshing(false);
      setRefreshPhaseLabel(null);
    }

    // Background: force Yahoo prices, then pull Simulation again (same-day MTM).
    setLivePricesBackground(true);
    void (async () => {
      try {
        const live = await runWhatIfLiveSignalsForPanel({
          cdHorizon: 90,
          timeoutMs: 60_000,
        });
        if (!live.ok) {
          if (live.message) {
            console.warn("[dashboard refresh] live signals:", live.message);
          }
          return;
        }
        invalidateProjectJsonCache("simulation_sheet_snapshot.json");
        await reloadSim();
        try {
          const { hydrateInvestSimHistory } = await import("../sheet/investSimStorage");
          await hydrateInvestSimHistory();
        } catch {
          /* optional */
        }
        setDashboardReloadToken((n) => n + 1);
        setSdsGateTick((n) => n + 1);
      } finally {
        setLivePricesBackground(false);
      }
    })();
  }, [
    onReload,
    onReloadSimulation,
    simTable,
    inputs,
    top2ChartPointsByKey,
    lang,
  ]);

  useEffect(() => {
    const onHorizon = () => setCdHorizonPublishRev((n) => n + 1);
    window.addEventListener("supernova-cd-horizon-changed", onHorizon);
    return () => window.removeEventListener("supernova-cd-horizon-changed", onHorizon);
  }, []);

  // Volatile visit Δ — read at publish time; don't re-queue on every MTM tick.
  const visitBaselinePublishRef = useRef(visitBaseline);
  visitBaselinePublishRef.current = visitBaseline;

  useEffect(() => {
    if (simLoading || !simTable?.rows?.length) return;
    const idleHandleRef = { current: null as number | null };
    const timer = window.setTimeout(() => {
      const publish = () => {
        const vb = visitBaselinePublishRef.current;
        const snap = buildMobileDashboardSnapshot({
          simTable,
          inputs,
          history: portfolioHistory,
          chartBundle,
          probOptions: probOptionsForPublish,
          simTableVersion: null,
          portfolioRows,
          opportunityRows,
          totalCapital,
          aiFeed: aiFeedTop,
          aiFeedRecentCount,
          lang: langCode,
          refCurves,
          autoRegSnap: mobilePublishContext.autoRegSnap,
          mcsDoc: mobilePublishContext.mcsDoc,
          clinicalPreCdRecords: clinicalPreCdRecordsMerged,
          lossRiskCatalog,
          catalogByRowKey,
          paperPortfolio: decisionSimState.paperPortfolio,
          adviceFeedback,
          priorSessionPctByTicker,
          operationalRec,
          priorVisitSnapshot: vb === undefined ? null : vb,
        });
        scheduleMobileDashboardSnapshotPublish(snap);
      };
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      };
      if (typeof w.requestIdleCallback === "function") {
        idleHandleRef.current = w.requestIdleCallback(publish, { timeout: 2_500 });
      } else {
        publish();
      }
    }, 1_200);
    return () => {
      window.clearTimeout(timer);
      const w = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (idleHandleRef.current != null) w.cancelIdleCallback?.(idleHandleRef.current);
    };
  }, [
    simLoading,
    simTable,
    inputs,
    portfolioHistory,
    chartBundle,
    probOptionsForPublish,
    portfolioRows,
    opportunityRows,
    totalCapital,
    aiFeedTop,
    aiFeedRecentCount,
    langCode,
    refCurves,
    mobilePublishContext,
    clinicalPreCdRecordsMerged,
    gainStarLedgerVersion,
    lossRiskCatalog,
    catalogByRowKey,
    cdHorizonPublishRev,
    decisionSimState.paperPortfolio,
    adviceFeedback,
    priorSessionPctByTicker,
    operationalRec,
  ]);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      void Promise.all([
        fetchRegulatoryRiskSnapshot().catch(() => null),
        loadMarketContextSnapshot().catch(() => null),
      ]).then(([autoRegSnap, mcsDoc]) => {
        if (!cancelled) {
          setMobilePublishContext({
            autoRegSnap,
            mcsDoc,
          });
        }
      });
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    if (typeof w.requestIdleCallback === "function") {
      idleHandle = w.requestIdleCallback(run, { timeout: 4_000 });
    } else {
      timeoutHandle = window.setTimeout(run, 1_500);
    }
    return () => {
      cancelled = true;
      if (idleHandle != null) w.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [dashboardReloadToken]);

  useEffect(() => {
    const onGainStarsChanged = () => setGainStarLedgerVersion((v) => v + 1);
    window.addEventListener(GAIN_STAR_LEDGER_CHANGED_EVENT, onGainStarsChanged);
    return () => window.removeEventListener(GAIN_STAR_LEDGER_CHANGED_EVENT, onGainStarsChanged);
  }, []);

  return (
    <>
    <div className="sim-harmonize dashboard-home-page flex flex-col gap-2 w-full min-w-0 shrink-0 pb-2">

      {/* Refresh toolbar */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div>
            <h2 className="text-base font-semibold">Dashboard</h2>
            <p className="text-[11px] text-ink-muted">
              Pulse · Piggy Bank · Portfolio · catalyst timeline
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <RefreshControls
            onRefresh={handleDashboardRefresh}
            loading={dashboardRefreshing}
            loadingLabel={refreshPhaseLabel ?? (lang === "it" ? "Aggiorno…" : "Updating…")}
            tooltip={t("refresh.page.dashboard.tooltip")}
            dataUpdatedAt={dataUpdatedAt}
            extraInfo={
              simTable
                ? `${(simTable.rows ?? []).length} Simulation rows`
                : undefined
            }
          />
          {livePricesBackground ? (
            <span className="text-[10px] text-ink-muted/80 tabular-nums">
              {lang === "it" ? "Prezzi Yahoo in corso…" : "Yahoo prices running…"}
            </span>
          ) : null}
        </div>
      </div>

      {/* Market context — first panel of the tab (never deferred). */}
      <div className="shrink-0 min-w-0">
        <MarketContextWidget lang={lang} />
      </div>

      <PortfolioPnlSummaryBlock data={dashboardPulseData} />

      {/* Piggy bank bar — full-width, below KPIs */}
      <PiggyBankBar
        simTable={simTable}
        inputs={inputs}
        history={portfolioHistory}
        metricsReady={portfolioMetricsReady}
        closedPiggyDisplay={closedPiggyDisplay}
        onResetClosedPiggy={resetClosedPiggy}
        reinvestedEur={dashboardPulseData.portfolioTotals.gainsRecycledInOpenEur}
        openFromBudgetEur={dashboardPulseData.portfolioTotals.capitalNotFromGainsEur}
        gainsCashEur={
          (dashboardPulseData.portfolioTotals.gainsRecycledInOpenEur ?? 0) <= 0.5
            ? Math.max(0, closedPiggyDisplay.pnlEur)
            : Math.max(
                0,
                closedPiggyDisplay.pnlEur -
                  (dashboardPulseData.portfolioTotals.gainsRecycledInOpenEur ?? 0),
              )
        }
        gateStrengthByKey={operationalRec?.gateStrengthByKey}
      />

      {/* Real portfolio pulse — always painted (no content-visibility defer). */}
      <div className="shrink-0 min-w-0">
        <DashboardPulseTable
          data={dashboardPulseData}
          history={portfolioHistory}
          simTable={simTable}
          inputs={inputs}
          sdsRows={sdsRowsForMig}
          chartBundle={chartBundle}
          reloadToken={dashboardReloadToken}
          clinicalPreCdRecords={clinicalPreCdRecordsMerged}
          onOpen24hAssessment={onOpen24hAssessment}
          onAddExternalHolding={registerExternalHolding}
          onSell={onSellPosition}
          onOpenSupernovaTab={onOpenSupernovaTab}
          recommendationByKey={pulseRecommendationByKey}
        />
      </div>

      <HighImpactEisToast
        tickers={dashboardPulseData.portfolioRows.map((r) => r.ticker.trim().toUpperCase())}
        records={clinicalPreCdRecordsMerged}
        lang={lang === "it" ? "it" : "en"}
      />

      <VolumeSpikeToast
        tickers={dashboardPulseData.portfolioRows.map((r) => r.ticker.trim().toUpperCase())}
        lang={lang === "it" ? "it" : "en"}
      />

      <EarlyPeakMinPriceAlertModal
        targets={earlyPeakMinTargets}
        rowByKey={simRowByKey}
        lang={lang === "it" ? "it" : "en"}
        onOpenEvaluation={
          onOpen24hAssessment
            ? (focus) =>
                onOpen24hAssessment({
                  ticker: focus.ticker,
                  rowKey: focus.rowKey,
                  cd: focus.rowKey?.includes("|")
                    ? focus.rowKey.split("|").slice(1).join("|")
                    : undefined,
                })
            : undefined
        }
      />

      <div className="shrink-0 min-w-0">
        <NewEntriesThisWeekTable
          simTable={simTable}
          onOpen24hAssessment={onOpen24hAssessment}
        />
      </div>

      <div className="shrink-0 min-w-0">
        <HypeDetectedThisWeekTable
          simTable={simTable}
          onOpen24hAssessment={onOpen24hAssessment}
        />
      </div>

      {/* Evaluation Lab → Top KPI (Decision Chart removed). */}

      {!recModalOpen && recStats.total > 0 ? (
        <div className="shrink-0 min-w-0 px-1">
          <button
            type="button"
            className="w-full rounded-lg border border-[rgb(var(--accent))]/35 bg-[rgb(var(--accent))]/8 px-3 py-2 text-left text-[11px] font-medium text-ink hover:bg-[rgb(var(--accent))]/12 transition"
            onClick={() => setRecModalOpen(true)}
          >
            {t("dashboard.rec.reviewOpen", {
              n: String(recStats.total),
              new: String(recStats.newCount),
            })}
          </button>
        </div>
      ) : null}

      <DashboardRecommendationsModal
        open={recModalOpen}
        onClose={handleRecModalClose}
        simTable={simTable}
        simLoading={simLoading}
        chartBundle={chartBundle}
        sdsRows={sdsRowsForMig}
        onOpen24hAssessment={onOpen24hAssessment}
        onRegisterBuy={onRegisterBuy}
        onSell={onSellPosition}
        onStatsChange={setRecStats}
        adviceFeedback={adviceFeedback}
        paperPortfolio={decisionSimState.paperPortfolio}
        synthAlloc={sharedSynthAlloc}
      />

      {/* "Charts & AI feed" section removed on user request. The Top AI feed
          is still reachable from the sidebar (Catalyst Feed tab). */}
    </div>

    </>
  );
}
