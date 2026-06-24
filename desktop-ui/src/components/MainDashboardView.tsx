import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppScreen, ChartBundle, ChartPoint, SheetTable } from "../types";
import { loadSimulationChartsBundle } from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import {
  aggregateOpenPortfolioPnl,
  buildDashboardPortfolioChips,
  buildPortfolioDailyPnlLedger,
  rowHasActivePortfolio,
} from "../sheet/simulationPosition";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import { useDashboardPortfolioMetricsReady } from "../hooks/useDashboardPortfolioMetricsReady";
import { readLocalSdsSnapshot, type SdsRow } from "../api/supernova";
import { buildSdsByTicker, setCachedSdsForTopOpps } from "../sheet/sdsTopOppGate";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import { RefreshControls } from "./RefreshControls";
import { useLang, useT } from "../shared/i18n";
import { useDashboardAiFeed } from "./DashboardAiFeedCard";
import {
  buildMobileDashboardSnapshot,
  scheduleMobileDashboardSnapshotPublish,
} from "../api/mobileDashboardSnapshot";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { loadSdsReferenceCurves, type SdsRoiProfileId } from "../sheet/sdsRoiBlend";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import { publishDashboardRecommendationsFromSimulation } from "../sheet/topOppsFromSimulation";
import { subscribeTopOpps } from "../sheet/topOppsStore";
import {
  filterOffPortfolioHotZoneSimRows,
  SIM_HOT_ZONE_DAYS,
} from "../sheet/simCdHorizonScope";
import { DashboardPulseTable } from "./DashboardPulseTable";
import { SimLoopPulseView } from "./SimLoopPulseView";
import { ViewErrorBoundary } from "./ViewErrorBoundary";
import { DashboardRecommendationsModal } from "./DashboardRecommendationsModal";
import { DashboardChartsRow } from "./DashboardChartsRow";
import { subscribeTop2BuySell } from "../sheet/top2BuySellStore";
import {
  buildDashboardPulseData,
  buildDashboardVisitSnapshotFromState,
} from "../sheet/dashboardPulseView";
import { saveDashboardVisitSnapshot, clearDashboardVisitSnapshot, loadDashboardVisitSnapshot } from "../sheet/dashboardVisitSnapshot";
import { useRefreshStatus } from "../shared/refreshStatusStore";
import { buildPnlRankIndexMap, piggyBankChipRankVisual } from "../sheet/dealRankIcon";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import {
  portfolioChipToneFromAction,
  resolvePortfolioPositionActionForRow,
} from "../sheet/portfolioPositionAction";
import {
  PORTFOLIO_CHIP_CLS,
  portfolioPiggyBankChipDisplay,
  piggyBankNeedsDayVsTotalNote,
  piggyBankPriorLegFromEntry,
} from "../sheet/portfolioGainLossStyle";
import { piggyTrendLooksLikeDataCorrection } from "../sheet/piggyBankTrend";
import { PortfolioHeroRankIcon, RankAnimalIcon } from "./DealRankBadge";
import { ClosedPiggyBankCompact } from "./ClosedPiggyBankBeerGlass";
import { useClosedPiggyBank } from "../hooks/useClosedPiggyBank";
import { DashboardPanelUpdatedLabel } from "./DashboardPanelUpdatedLabel";
import { latestDashboardPanelIso } from "../sheet/dashboardPanelDailyRefresh";

// ── Utility ──────────────────────────────────────────────────

function parseDMY(s: string): Date | null {
  if (!s) return null;
  const parts = s.split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts.map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysFromToday(s: string): number | null {
  const d = parseDMY(s);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function tickerFromRow(row: Record<string, unknown>): string {
  return String(row["Ticker"] ?? "")
    .trim()
    .toUpperCase();
}

// ── PiggyBankBar ─────────────────────────────────────────────────────────────
// Horizontal full-width bar — sits between hero KPIs and main content.

function PiggyBankBar({
  simTable,
  inputs,
  history,
  metricsReady,
  onNavigateToPnl,
}: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  /** False while Simulation / inputs / history are still merging — hide P&L numbers. */
  metricsReady: boolean;
  onNavigateToPnl?: () => void;
}) {
  const { lang } = useLang();
  const t = useT();

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

  const closedLedger = useMemo(
    () => buildPortfolioDailyPnlLedger(simTable, inputs, history),
    [simTable, inputs, history],
  );
  const { display: closedPiggyDisplay, reset: resetClosedPiggy } =
    useClosedPiggyBank(closedLedger);

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
          ? "Salvadanaio portfolio: P&L totale dall'ingresso, variazione 24h, barra 0–40% del target gain, chip per ticker (verde=gain, giallo=attendi, rosso=vendi)"
          : "Portfolio piggy bank: total P&L since entry, 24h move, 0–40% target gain bar, per-ticker chips (green=gain, yellow=wait, red=sell)"
      }
    >
      {/* Portfolio rank pig (same tiers as P&L: 👑🐷 → 🐔) — clic → tab P&L */}
      <div className="relative select-none shrink-0 flex items-end justify-center min-w-[3rem]">
        {onNavigateToPnl && !noData ? (
          <button
            type="button"
            onClick={onNavigateToPnl}
            className="rounded-lg hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))]/50 transition-opacity"
            title={
              lang === "it"
                ? "Apri tab P&L in Simulation"
                : "Open P&L tab in Simulation"
            }
            aria-label={
              lang === "it"
                ? "Apri tab P&L in Simulation"
                : "Open P&L tab in Simulation"
            }
          >
            <PortfolioHeroRankIcon gainPct={pnlPct} noData={noData} basePx={40} />
          </button>
        ) : (
          <PortfolioHeroRankIcon gainPct={pnlPct} noData={noData} basePx={40} />
        )}
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
        onReset={resetClosedPiggy}
        onOpenDetail={onNavigateToPnl}
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
            const chipTone = portfolioChipToneFromAction(action);
            const rankIdx = chipRank.rankByKey.get(ticker);
            const rankVisual = piggyBankChipRankVisual(
              rankIdx ?? null,
              chipRank.total,
              action,
              pp,
            );
            const todayLbl = lang === "it" ? "oggi" : "24h";
            return (
              <span
                key={ticker}
                className={`piggy-bank-chip piggy-bank-chip--${chipTone} ${PORTFOLIO_CHIP_CLS[chipTone]}`}
                title={`${ticker}: ${chip.title}`}
              >
                {rankVisual ? <RankAnimalIcon visual={rankVisual} basePx={12} /> : null}
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

function HeroKpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "up" | "down" | "warn" | "accent";
}) {
  const lineColor =
    accent === "up"
      ? "rgb(var(--signal-up))"
      : accent === "down"
        ? "rgb(var(--signal-down))"
        : accent === "warn"
          ? "rgb(var(--warn))"
          : "rgb(var(--accent))";

  const valueColor =
    accent === "up"
      ? "text-[rgb(var(--signal-up))]"
      : accent === "down"
        ? "text-[rgb(var(--signal-down))]"
        : accent === "warn"
          ? "text-[rgb(var(--warn))]"
          : "text-ink";

  return (
    <div className="flex-1 card px-4 py-3 relative overflow-hidden min-w-0">
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: lineColor }}
      />
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted/70 truncate">
        {label}
      </p>
      <p className={`text-xl font-bold tabular-nums mt-0.5 leading-tight ${valueColor}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export function MainDashboardView({
  simTable,
  simLoading,
  secK8Loading,
  onScreen,
  onOpenSecK8: _onOpenSecK8,
  onReload,
  onNavigateToSimulationPnl,
  onOpenSimulationRow,
  onOpenSimulationSheet,
  onOpen24hAssessment,
  onRegisterBuy,
  onSellPosition,
  onOpenPredictionCharts: _onOpenPredictionCharts,
  onOpenCatalystFeed: _onOpenCatalystFeed,
  onOpenClinicalFeed: _onOpenClinicalFeed,
  onOpenSupernovaTab,
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
  secK8Table: SheetTable | null;
  secK8Loading: boolean;
  onScreen: (s: AppScreen) => void;
  onOpenSecK8?: (ticker: string) => void;
  /** Full local reload of every snapshot used by the dashboard. */
  onReload?: () => void | Promise<void>;
  onNavigateToSimulationPnl?: () => void;
  onOpenSimulationRow?: (focus: { ticker: string; cd?: string }) => void;
  onOpenSimulationSheet?: (focus: {
    ticker: string;
    cd?: string;
    action?: "buy" | "sell";
  }) => void;
  onOpen24hAssessment?: (focus: { ticker: string; cd?: string }) => void;
  onRegisterBuy?: import("../hooks/useInvestSimInputs").PortfolioRegisterBuyHandler;
  onSellPosition?: import("./PortfolioExitButton").PortfolioSellHandler;
  onOpenPredictionCharts?: (focus: { seriesKey: string | null; ticker: string }) => void;
  onOpenCatalystFeed?: () => void;
  onOpenClinicalFeed?: (ticker: string) => void;
  onOpenSupernovaTab?: (ticker: string) => void;
}) {
  const simRows = simTable?.rows ?? [];

  const t = useT();
  const { lang } = useLang();
  const { dataUpdatedAt } = useRefreshStatus();
  const [dashboardReloadToken, setDashboardReloadToken] = useState(0);
  const [dashboardRefreshing, setDashboardRefreshing] = useState(false);
  // "Since your last visit" pulse view mode — toggles between the real
  // portfolio (default) and the sim loop's paper portfolio. Both views
  // occupy the same slot (screen-swap, not popup) so the user can
  // evaluate the advancement of one or the other — one at a time. The
  // toggle button lives in each view's header (top-right).
  const [pulseMode, setPulseMode] = useState<"portfolio" | "simLoop" | "simLoopSynth">(
    "portfolio",
  );
  const [recModalOpen, setRecModalOpen] = useState(false);
  const [recStats, setRecStats] = useState({ total: 0, newCount: 0, keySig: "" });
  const recModalAckSigRef = useRef("");
  const inputs = useInvestSimInputs(simTable, dashboardReloadToken);
  const { history: portfolioHistory, historyReady } = useInvestSimPortfolioHistory(
    dashboardReloadToken,
  );
  const portfolioInputsReady = useDashboardPortfolioMetricsReady(
    simTable,
    simLoading,
    dashboardReloadToken,
  );
  const portfolioMetricsReady = portfolioInputsReady && historyReady;

  const [chartBundle, setChartBundle] = useState<ChartBundle | null>(null);
  const [eisState, setEisState] = useState<Awaited<ReturnType<typeof loadEisSuperScoreState>> | null>(
    null,
  );
  const polygonOverview = useCdPatternPolygonOverview();
  const [refCurves, setRefCurves] = useState<
    Partial<Record<SdsRoiProfileId, (number | null)[]>>
  >({});
  const [sdsGateTick, setSdsGateTick] = useState(0);
  const [sdsRowsForMig, setSdsRowsForMig] = useState<SdsRow[] | null>(null);

  /** Grafici, SDS, EIS e curve di riferimento — riletti ad ogni Refresh pagina. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [chartsRes, sdsDoc, eis, curves] = await Promise.all([
        loadSimulationChartsBundle(),
        readLocalSdsSnapshot(),
        loadEisSuperScoreState(),
        loadSdsReferenceCurves(),
      ]);
      if (cancelled) return;
      setChartBundle(chartsRes.bundle);
      setCachedSdsForTopOpps(buildSdsByTicker(sdsDoc?.rows));
      setSdsRowsForMig(sdsDoc?.rows ?? null);
      setEisState(eis);
      setRefCurves(curves.refs);
      if (dashboardReloadToken > 0) setSdsGateTick((n) => n + 1);
    })();
    return () => {
      cancelled = true;
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

  const dashboardPulseData = useMemo(
    () =>
      buildDashboardPulseData({
        simTable,
        inputs,
        history: portfolioHistory,
        chartPointsByKey: top2ChartPointsByKey,
        sdsByTicker,
        migByKey: migSolidityByKey,
        lang,
      }),
    [simTable, inputs, portfolioHistory, top2ChartPointsByKey, sdsByTicker, migSolidityByKey, lang],
  );

  useEffect(() => {
    const persistVisit = () => {
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
    const onVis = () => {
      if (document.visibilityState === "hidden") persistVisit();
    };
    window.addEventListener("beforeunload", persistVisit);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", persistVisit);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [
    simTable,
    inputs,
    portfolioHistory,
    migSolidityByKey,
    portfolioMetricsReady,
    simLoading,
  ]);

  useEffect(() => {
    if (!portfolioMetricsReady || simLoading || !simTable?.rows?.length) return;
    const prior = loadDashboardVisitSnapshot();
    if (!prior) return;
    const totals = aggregateOpenPortfolioPnl(simTable, inputs, portfolioHistory);
    if (
      piggyTrendLooksLikeDataCorrection(
        prior.portfolioPnlEur,
        totals.pnlEur,
        totals.pnlEurToday,
        totals.todayCovered,
      )
    ) {
      clearDashboardVisitSnapshot();
      try {
        window.localStorage.removeItem("dashboard.piggy.lastPnlEur");
        window.localStorage.removeItem("dashboard.piggy.lastTrend");
      } catch {
        /* non-fatal */
      }
    }
  }, [simTable, inputs, portfolioHistory, portfolioMetricsReady, simLoading]);

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
    publishDashboardRecommendationsFromSimulation(simTable, inputs, top2ChartPointsByKey);
  }, [simTable, inputs, simLoading, top2ChartPointsByKey, sdsGateTick]);

  const feedScopeTickers = useMemo(() => {
    const s = new Set<string>();
    for (const r of portfolioRows) {
      const tk = tickerFromRow(r);
      if (tk && !tk.includes("TOTALE")) s.add(tk);
    }
    return s;
  }, [portfolioRows]);

  const portfolioMetrics = useMemo(() => {
    const totals = aggregateOpenPortfolioPnl(simTable, inputs, portfolioHistory);
    return { cap: totals.capital, pnl: totals.pnlEur };
  }, [simTable, inputs, portfolioHistory]);

  const totalCapital = portfolioMetrics.cap;

  const nextCdDays = useMemo(() => {
    return portfolioRows.reduce<number | null>((best, r) => {
      const days = daysFromToday(String(r["Completion Date"] ?? ""));
      if (days == null || days < 0) return best;
      return best == null || days < best ? days : best;
    }, null);
  }, [portfolioRows]);

  const {
    feed: aiFeedTop,
    recentCount: aiFeedRecentCount,
    loading: aiFeedLoading,
    loadError: aiFeedLoadError,
    updatedAt: aiFeedUpdatedAt,
    reload: reloadAiFeed,
  } = useDashboardAiFeed(feedScopeTickers);

  const chartsSectionUpdatedAt = useMemo(
    () => latestDashboardPanelIso(dataUpdatedAt, aiFeedUpdatedAt),
    [dataUpdatedAt, aiFeedUpdatedAt],
  );

  const handleDashboardRefresh = useCallback(async () => {
    setDashboardRefreshing(true);
    try {
      await Promise.all([onReload?.(), reloadAiFeed()]);
      setDashboardReloadToken((n) => n + 1);
    } finally {
      setDashboardRefreshing(false);
    }
  }, [onReload, reloadAiFeed]);

  useEffect(() => {
    if (simLoading || !simTable?.rows?.length) return;
    scheduleMobileDashboardSnapshotPublish(
      buildMobileDashboardSnapshot({
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
        lang: lang === "it" ? "it" : "en",
        refCurves,
      }),
    );
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
    lang,
    refCurves,
  ]);

  return (
    <div className="sim-harmonize flex flex-col gap-3 pr-1 w-full min-h-0">

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
        <RefreshControls
          onRefresh={handleDashboardRefresh}
          loading={dashboardRefreshing || simLoading || secK8Loading || aiFeedLoading}
          tooltip={t("refresh.page.dashboard.tooltip")}
          dataUpdatedAt={dataUpdatedAt}
          extraInfo={
            simTable
              ? `${(simTable.rows ?? []).length} Simulation rows`
              : undefined
          }
        />
      </div>

      {/* Hero KPI strip */}
      <div className="flex gap-2 shrink-0">
        <HeroKpi
          label={lang === "it" ? "Portafoglio / Opp." : "Portfolio / Opp."}
          value={`${portfolioRows.length} / ${opportunityRows.length}`}
          sub={
            lang === "it"
              ? `investiti · CD ≤${SIM_HOT_ZONE_DAYS}g fuori portafoglio`
              : `invested · off-portfolio CD ≤${SIM_HOT_ZONE_DAYS}d`
          }
        />
        <div className="flex-1 card px-4 py-3 relative overflow-hidden min-w-0">
          <div
            className="absolute top-0 left-0 right-0 h-[2px]"
            style={{ background: "rgb(var(--accent))" }}
          />
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted/70 truncate">
            {lang === "it" ? "Capitale totale" : "Total Capital"}
          </p>
          <p className="text-xl font-bold tabular-nums mt-0.5 leading-tight text-ink">
            {totalCapital > 0 ? fmtUsd(totalCapital) : "—"}
          </p>
        </div>
        <HeroKpi
          label={lang === "it" ? "Prossimo CD" : "Next Catalyst"}
          value={nextCdDays != null ? `${nextCdDays} d` : "—"}
          accent={nextCdDays != null && nextCdDays <= 3 ? "warn" : undefined}
          sub={nextCdDays != null && nextCdDays <= 7 ? "⚡ imminent" : undefined}
        />
        <HeroKpi
          label={lang === "it" ? "AI feed" : "Top AI feed"}
          value={String(aiFeedRecentCount)}
          sub="clinical pubs · 30d"
          accent="accent"
        />
      </div>

      {/* Piggy bank bar — full-width, below KPIs */}
      <PiggyBankBar
        simTable={simTable}
        inputs={inputs}
        history={portfolioHistory}
        metricsReady={portfolioMetricsReady}
        onNavigateToPnl={onNavigateToSimulationPnl}
      />

      {/* "Since your last visit" — promoted right under the Piggy Bank so
          the delta-since-last-session story is the first thing the user
          reads. Three pulse scopes (portfolio · sim loop equal · sim loop synth)
          share one slot; PulseScopeSwitcher selects which session is active. */}
      <div className="shrink-0 min-w-0">
      {pulseMode === "portfolio" ? (
        <DashboardPulseTable
          data={dashboardPulseData}
          history={portfolioHistory}
          simTable={simTable}
          sdsRows={sdsRowsForMig}
          chartBundle={chartBundle}
          reloadToken={dashboardReloadToken}
          onOpenSimulationRow={onOpenSimulationRow}
          onOpen24hAssessment={onOpen24hAssessment}
          onOpenSupernovaTab={onOpenSupernovaTab}
          pulseScope={pulseMode}
          onPulseScopeChange={setPulseMode}
        />
      ) : (
        <ViewErrorBoundary label="Sim loop pulse">
        <SimLoopPulseView
          variant={pulseMode === "simLoopSynth" ? "synth" : "equal"}
          pulseScope={pulseMode}
          onPulseScopeChange={setPulseMode}
          simTable={simTable}
          sdsRows={sdsRowsForMig}
          chartBundle={chartBundle}
          investInputs={inputs}
          reloadToken={dashboardReloadToken}
          onOpenSimulationRow={onOpenSimulationRow}
          onOpen24hAssessment={onOpen24hAssessment}
        />
        </ViewErrorBoundary>
      )}
      </div>

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
        onOpenSimulationSheet={onOpenSimulationSheet}
        onOpen24hAssessment={onOpen24hAssessment}
        onRegisterBuy={onRegisterBuy}
        onSell={onSellPosition}
        onStatsChange={setRecStats}
      />

      {/* Grafici · P(plan) + paper sim · poi 24h + AI feed */}
      <section
        className="dashboard-charts-section card dashboard-middle-panel flex flex-col gap-3 min-w-0 shrink-0"
        aria-label={lang === "it" ? "Grafici e AI feed" : "Charts and AI feed"}
      >
        <div className="shrink-0 px-4 py-3 border-b border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-elevated))]">
          <h2 className="text-base font-semibold text-ink">
            {lang === "it" ? "Grafici e AI feed" : "Charts & AI feed"}
          </h2>
          <p className="mt-1 text-[11px] text-ink-muted leading-snug">
            {lang === "it"
              ? "P(plan) e paper sim · sotto: performance 24h e feed AI"
              : "P(plan) and paper sim · below: 24h performance and AI feed"}
          </p>
          <DashboardPanelUpdatedLabel updatedAt={chartsSectionUpdatedAt} className="!text-[11px]" />
        </div>
        <div className="px-3 pb-4 min-w-0">
          <DashboardChartsRow
            simTable={simTable}
            chartBundle={chartBundle}
            sdsRows={sdsRowsForMig}
            dataUpdatedAt={dataUpdatedAt}
            onNavigate={onScreen}
            aiFeed={{
              feed: aiFeedTop,
              recentCount: aiFeedRecentCount,
              loading: aiFeedLoading,
              loadError: aiFeedLoadError,
              updatedAt: aiFeedUpdatedAt,
              scopeLabel: t("dashboard.list.portfolio"),
              onOpenFeed: () => onScreen("catalystFeed"),
            }}
          />
        </div>
      </section>
    </div>
  );
}
