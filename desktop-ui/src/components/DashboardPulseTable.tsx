import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import type { DashboardPulseData } from "../sheet/dashboardPulseView";
import { fetchIntraday1h } from "../api/supernova";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { portfolioPnlAccentClass, portfolioPnlDirectionGlyph, portfolioPnlTabShellClass, portfolioPnlTone } from "../sheet/portfolioGainLossStyle";
import { useLang, useT } from "../shared/i18n";
import { fmtPulseEur, fmtPulsePct } from "./PortfolioGainPlanAggregateChart";
import { PortfolioAllocationPie } from "./PortfolioAllocationPie";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import type { ChartBundle, ChartPoint, SheetTable } from "../types";
import {
  buildIntradaySeriesByTicker,
  resolveLowSpotSignals,
  resolvePriceLowsUsd,
  type LowSpotSignals,
} from "../sheet/earlyPeakBuyMinTarget";
import type { IntradayPricePoint } from "../sheet/simUniverse24hWhatIf";
import type { ClinicalPreCdRecord, SdsRow } from "../api/supernova";
import { PortfolioBriefcaseMark, PortfolioTickerMark } from "./PortfolioScopeToggle";
import { WindIcon } from "./ContG10Badge";
import { hydrateUiPrefsFromDisk, loadUiPrefsLocal, saveUiPrefs } from "../sheet/uiPrefs";
import { daysFromToday } from "../sheet/simulationPlanGain";
import {
  continuationTooltipText,
  resolveContBand,
  resolveDisplayPContinuation,
  type ContBand,
} from "../sheet/continuationScore";
import {
  clinicalKpiFromSimRow,
  globalTickerEisRollup,
} from "../sheet/tickerEisSummary";
import { eisColor } from "../sheet/eventImpactScore";
import {
  pulseTickerGivebackBellFromHistory,
  type PulseGivebackBell,
} from "../sheet/pulseLossOfWinsBell";
import {
  clampGlWinAlertPct,
  glWinAlertFracFromPct,
} from "../sheet/softSignalGrades";
import {
  currentPriceFromRow,
  priceRefreshAtFromRow,
  resolveBookOpenPositionMetrics,
} from "../sheet/simulationPosition";
import {
  cycleAlertForKey,
  fetchCatalystCycleAlerts,
  normalizeCycleTickerKey,
  cycleTickersFromKey,
  peekCatalystCycleAlertsCache,
  type CatalystCycleAlertsResponse,
} from "../api/catalystPatterns";
import { CatalystCycleBadge } from "./CatalystCycleBadge";
import { resolveOperationalAlignedCyclePrimary } from "../sheet/catalystCycleState";
import { ExternalHoldingAddForm } from "./ExternalHoldingAddForm";
import type { RegisterExternalHoldingHandler } from "../hooks/useInvestSimInputs";
import { useInvestSimInputsMutable } from "../hooks/useInvestSimInputs";
import { PortfolioExitButton, type PortfolioSellHandler } from "./PortfolioExitButton";
import { notifyPortfolioSellResult } from "../sheet/portfolioSell";
import { CapitalNumberInput } from "./CapitalNumberInput";
import { bookMarkToMarket } from "../sheet/externalHolding";
import { parseInputDecimal } from "../sheet/decimalInput";

/** Last mark / sheet current price ($) — adaptive decimals like Financial sheet. */
function fmtPulsePriceUsd(n: number): string {
  const decimals = n < 1 ? 4 : n < 10 ? 3 : 2;
  return `$${n.toFixed(decimals)}`;
}

function PulseLowSpotBoltIcon({ it }: { it: boolean }) {
  const label = it ? "Nuovo minimo 7g" : "New 7d low";
  return (
    <span
      className="inline-flex items-center shrink-0 text-amber-500 dark:text-amber-400"
      title={label}
      aria-label={label}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
        <path d="M9.2 1.2 3.5 9.1h3.2l-.9 5.7 6.3-8.6H8.7l.5-5z" />
      </svg>
    </span>
  );
}

function pulsePriceCellTip(signals: LowSpotSignals, it: boolean): string {
  if (signals.day === "below" && signals.week === "below") {
    return it
      ? "Prezzo sotto min 24h e min 7g — fulmine = nuovo low settimanale"
      : "Price below 24h and 7d low — bolt = new weekly low";
  }
  if (signals.day === "below") {
    return it ? "Prezzo sotto il minimo 24h" : "Price below 24h low";
  }
  return it ? "Prezzo spot corrente" : "Current spot price";
}

/** "T−12g" / "oggi" / "T+3g" — mirror of the 24h Assessment CD chip. */
function fmtDaysToCd(cd: string | null | undefined, it: boolean): string {
  if (!cd || cd === "—") return "—";
  const d = daysFromToday(cd);
  if (d == null) return "—";
  if (d === 0) return it ? "oggi" : "today";
  if (d > 0) return `T−${d}${it ? "g" : "d"}`;
  return `T+${Math.abs(d)}${it ? "g" : "d"}`;
}

function LossOfWinsBell({
  giveback,
  it,
  alertPct,
}: {
  giveback: PulseGivebackBell;
  it: boolean;
  /** Same Alert % G/L as Trades column −{pct}% G/L. */
  alertPct: number;
}) {
  const pct = giveback.givebackPctOfPeak ?? 0;
  const peak = giveback.peakEff ?? 0;
  const lost = giveback.givebackEur ?? 0;
  const base = giveback.purchasedPlusGainsEur ?? peak;
  const title = it
    ? `Stessa campanella della colonna −${alertPct}% G/L in Trades: giveback ${fmtPulseEur(lost)} (${pct.toFixed(0)}%) del picco ${fmtPulseEur(base)}`
    : `Same bell as Trades −${alertPct}% G/L column: giveback ${fmtPulseEur(lost)} (${pct.toFixed(0)}%) of peak ${fmtPulseEur(base)}`;
  return (
    <span
      className="inline-flex shrink-0 text-[12px] leading-none"
      title={title}
      aria-label={title}
      role="img"
    >
      🔔
    </span>
  );
}

type RecAction = "buy" | "sell" | "hold" | "review" | "none";

/** Colour + label — mirrors decisionChartLogic tone tokens without importing. */
function recBadgeToneClass(rec: RecAction): string {
  switch (rec) {
    case "buy":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 border border-emerald-300/60";
    case "sell":
      return "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 border border-rose-300/60";
    case "hold":
      return "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200 border border-sky-300/60";
    case "review":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 border border-amber-300/60";
    default:
      return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800/40 dark:text-neutral-300 border border-neutral-300/60";
  }
}

function recLabel(rec: RecAction, it: boolean): string {
  if (rec === "none") return "—";
  if (it) {
    if (rec === "buy") return "COMPRA";
    if (rec === "sell") return "VENDI";
    if (rec === "hold") return "TIENI";
    if (rec === "review") return "INCERTO";
    return "—";
  }
  if (rec === "review") return "UNCERTAIN";
  return rec.toUpperCase();
}

/** Strong-wind threshold — same coin-flip as P(continuation) chart. */
const STRONG_WIND_PCONT = 50;

/** Band is exhaustion-vs-base; UI shows P(continuation) — invert colors. */
function contScoreStyle(band: ContBand): { color: string; background: string } {
  if (band === "high") return { color: "#9f1239", background: "rgba(159,18,57,0.12)" };
  if (band === "low") return { color: "#166534", background: "rgba(22,101,52,0.12)" };
  if (band === "mid") return { color: "#92400e", background: "rgba(146,64,14,0.12)" };
  if (band === "declining") return { color: "#9f1239", background: "rgba(159,18,57,0.12)" };
  if (band === "not_run") return { color: "#64748b", background: "rgba(100,116,139,0.12)" };
  return { color: "#64748b", background: "transparent" };
}

/** Compact band chip for the Pulse table (full text stays in the tooltip). */
function contBandShort(band: ContBand, it: boolean): string {
  if (band === "high") return it ? "esaurim." : "exhaust.";
  if (band === "low") return it ? "forte" : "strong";
  if (band === "mid") return "~base";
  if (band === "declining") return it ? "calo" : "decl.";
  if (band === "not_run") return it ? "nascente" : "early";
  return "—";
}

function formatVisitAgo(iso: string | null, lang: "it" | "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffH = Math.round((Date.now() - d.getTime()) / 3600000);
  if (diffH < 1) return lang === "it" ? "<1h fa" : "<1h ago";
  if (diffH < 48) return lang === "it" ? `${diffH}h fa` : `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return lang === "it" ? `${diffD}g fa` : `${diffD}d ago`;
}

function PulseBuyPriceInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (n: number) => boolean | void;
}) {
  const [draft, setDraft] = useState(value > 0 ? String(value) : "");
  useEffect(() => {
    setDraft(value > 0 ? String(value) : "");
  }, [value]);
  return (
    <input
      className="input w-[4.2rem] py-0 px-1 text-[9px] tabular-nums text-center"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        const n = parseInputDecimal(draft);
        if (!(n > 0)) {
          setDraft(value > 0 ? String(value) : "");
          return;
        }
        onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function PulseRemoveButton({
  ticker,
  simKey,
  simRow,
  onSell,
}: {
  ticker: string;
  simKey: string;
  simRow?: Record<string, unknown> | null;
  onSell: PortfolioSellHandler;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[rgb(var(--border))]/55 bg-white text-ink-muted text-[12px] font-semibold leading-none hover:border-[rgb(var(--signal-down))]/50 hover:bg-[rgb(var(--signal-down))]/10 hover:text-[rgb(var(--signal-down))] disabled:opacity-50"
      title={t("dashboard.pulse.removeTip", { ticker })}
      aria-label={t("dashboard.pulse.removeTip", { ticker })}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!window.confirm(t("dashboard.pulse.removeConfirm", { ticker }))) return;
        setBusy(true);
        void Promise.resolve(onSell(simKey, simRow ?? null, { confirm: false }))
          .then((result) => {
            notifyPortfolioSellResult(result, t);
          })
          .finally(() => {
            setBusy(false);
          });
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      ×
    </button>
  );
}

export type PulsePortfolioRecAction = "buy" | "sell" | "hold" | "review" | "none";

export function DashboardPulseTable({
  data,
  history,
  simTable,
  inputs,
  sdsRows,
  chartBundle,
  reloadToken,
  onOpenSimulationRow,
  onOpen24hAssessment,
  onAddExternalHolding,
  onSell,
  onOpenSupernovaTab: _onOpenSupernovaTab,
  priceAgeNote,
  recommendationByKey,
  clinicalPreCdRecords,
}: {
  data: DashboardPulseData;
  history: InvestSimHistoryPoint[];
  /** Live sim sheet — allocation pie + legacy API compat. */
  simTable: SheetTable | null;
  /** Sim inputs — open-book capital for allocation pie. */
  inputs: InvestSimInputs;
  sdsRows: SdsRow[] | null | undefined;
  chartBundle: ChartBundle | null;
  /** Bumps invalidate the loss-risk catalog after a refresh. */
  reloadToken?: number;
  onOpenSimulationRow?: (focus: { ticker: string; cd?: string }) => void;
  /** Simulation tab — 24h assessment, scrolled to the company row. */
  onOpen24hAssessment?: (focus: {
    ticker: string;
    cd?: string;
    rowKey?: string;
    openDeepDive?: boolean;
  }) => void;
  onAddExternalHolding?: RegisterExternalHoldingHandler;
  onSell?: PortfolioSellHandler;
  onOpenSupernovaTab?: (ticker: string) => void;
  /** Price-age note from livePositionSnapshot — shown in the subtitle when prices are stale. */
  priceAgeNote?: string | null;
  /** Suggested action per position key — feeds the Rec column (col 2). */
  recommendationByKey?: Map<string, PulsePortfolioRecAction>;
  /** Clinical pre-CD feed — powers Global EIS rollup from collected events. */
  clinicalPreCdRecords?: ClinicalPreCdRecord[] | null;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";
  const { patchInputs } = useInvestSimInputsMutable(simTable);
  const openCap = data.portfolioTotals.capital ?? data.portfolioTotals.capitalInOpenEur ?? 0;

  /** Same denominator / ticker aggregation as the Home allocation pie slices. */
  const openBookCapital =
    openCap > 0
      ? openCap
      : data.portfolioRows.reduce((s, r) => s + (r.gainPlanRow.capital || 0), 0);
  const capitalByTicker = new Map<string, number>();
  for (const r of data.portfolioRows) {
    const tk = r.ticker.trim().toUpperCase();
    if (!tk) continue;
    capitalByTicker.set(tk, (capitalByTicker.get(tk) ?? 0) + (r.gainPlanRow.capital || 0));
  }
  // `sdsRows` kept for API compatibility (loss-risk columns removed).
  void sdsRows;

  const chartPointsByKey = useMemo(() => {
    const m = new Map<string, ChartPoint[]>();
    if (!chartBundle) return m;
    for (const [key, series] of Object.entries(chartBundle.series)) {
      if (series.points?.length) m.set(key, series.points);
    }
    return m;
  }, [chartBundle]);

  const [intradayByTicker, setIntradayByTicker] = useState<
    Map<string, { prior?: IntradayPricePoint[]; live?: IntradayPricePoint[] }>
  >(() => new Map());

  useEffect(() => {
    const tickers = [
      ...new Set(
        data.portfolioRows.map((r) => r.ticker.trim().toUpperCase()).filter(Boolean),
      ),
    ];
    if (!tickers.length) {
      setIntradayByTicker(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchIntraday1h(tickers);
        if (cancelled) return;
        setIntradayByTicker(buildIntradaySeriesByTicker(payload));
      } catch {
        if (!cancelled) setIntradayByTicker(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data.portfolioRows, reloadToken]);

  const portfolioTickersKey = useMemo(
    () =>
      normalizeCycleTickerKey(
        data.portfolioRows.map((r) => r.ticker),
      ),
    [data.portfolioRows],
  );

  const [cycleAlerts, setCycleAlerts] = useState<CatalystCycleAlertsResponse | null>(null);
  const [cycleAlertsLoading, setCycleAlertsLoading] = useState(false);
  const cycleFetchGenRef = useRef(0);

  useEffect(() => {
    if (!portfolioTickersKey) {
      setCycleAlerts(null);
      setCycleAlertsLoading(false);
      return;
    }
    const tickers = cycleTickersFromKey(portfolioTickersKey);
    const gen = ++cycleFetchGenRef.current;
    const cached = peekCatalystCycleAlertsCache(tickers);
    if (cached) {
      setCycleAlerts(cached);
      setCycleAlertsLoading(false);
    } else {
      setCycleAlertsLoading(true);
    }
    void (async () => {
      try {
        const resp = await fetchCatalystCycleAlerts(tickers);
        if (cycleFetchGenRef.current !== gen) return;
        setCycleAlerts(resp);
      } catch {
        if (cycleFetchGenRef.current !== gen) return;
        setCycleAlerts({ updated_at: null, cohort_summary: null, alerts: {} });
      } finally {
        if (cycleFetchGenRef.current === gen) setCycleAlertsLoading(false);
      }
    })();
  }, [reloadToken, portfolioTickersKey]);

  const [positionsOpen, setPositionsOpen] = useState(() => {
    const v = loadUiPrefsLocal().pulsePositionsOpen;
    // Two-window hero already has the compact movement log — keep the wide
    // sheet collapsed unless the user opened it.
    return v == null ? false : Boolean(v);
  });
  /** Same knob as Trades “Alert % G/L” / column −% G/L. */
  const [glWinAlertPct, setGlWinAlertPct] = useState(() =>
    clampGlWinAlertPct(loadUiPrefsLocal().glWinAlertPct),
  );
  const glWinAlertFrac = glWinAlertFracFromPct(glWinAlertPct);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const disk = await hydrateUiPrefsFromDisk();
      if (cancelled || !disk) return;
      if (typeof disk.pulsePositionsOpen === "boolean") {
        setPositionsOpen(disk.pulsePositionsOpen);
      }
      if (disk.glWinAlertPct != null) {
        setGlWinAlertPct(clampGlWinAlertPct(disk.glWinAlertPct));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const syncPct = () =>
      setGlWinAlertPct(clampGlWinAlertPct(loadUiPrefsLocal().glWinAlertPct));
    window.addEventListener("storage", syncPct);
    window.addEventListener("supernova-ui-prefs-changed", syncPct);
    const id = window.setInterval(syncPct, 2_000);
    return () => {
      window.removeEventListener("storage", syncPct);
      window.removeEventListener("supernova-ui-prefs-changed", syncPct);
      window.clearInterval(id);
    };
  }, []);

  const onPositionsToggle = useCallback((e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const next = (e.currentTarget as HTMLDetailsElement).open;
    setPositionsOpen(next);
    saveUiPrefs({ pulsePositionsOpen: next });
  }, []);

  const openPortfolioRow = useCallback(
    (row: { ticker: string; completionDate?: string; key?: string }) => {
      const focus = {
        ticker: row.ticker,
        cd: row.completionDate,
        rowKey: row.key,
        openDeepDive: true,
      };
      if (onOpen24hAssessment) {
        onOpen24hAssessment(focus);
      } else {
        onOpenSimulationRow?.(focus);
      }
    },
    [onOpen24hAssessment, onOpenSimulationRow],
  );

  const ptfTone = portfolioPnlTone(data.portfolioTotals.pnlEur, data.portfolioTotals.pnlPct);
  const shellCls = portfolioPnlTabShellClass(data.winRate.winPct);

  return (
    <section
      className={`dashboard-pulse-table shrink-0 rounded-2xl border border-[rgb(var(--panel-feed-border))]/55 overflow-x-hidden shadow-[0_2px_16px_rgb(99_102_241_/_0.08)] ${shellCls}`}
    >
      <div className="dashboard-pulse-head flex flex-col gap-2 px-4 py-3 border-b border-[rgb(var(--panel-lab-border))]/45 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-semibold text-ink inline-flex items-center gap-1.5">
              <PortfolioBriefcaseMark
                title={t("sim.lossAnalysis.summaryTable.portfolioMark")}
                className="text-xs"
              />
              {t("dashboard.pulse.title")}
            </h2>
            <p className="ui-subtitle-clamp mt-1">
              {data.hasPriorVisit
                ? t("dashboard.pulse.sinceVisit", {
                    when: formatVisitAgo(data.priorVisitAt, lang),
                  })
                : t("dashboard.pulse.firstVisit")}
              {priceAgeNote ? (
                <span className="ml-1 text-amber-600 dark:text-amber-400 font-medium">
                  · {priceAgeNote}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {data.winRate.decisive > 0 ? (
              <span
                className={`text-xs font-semibold tabular-nums px-2 py-1 rounded-full border border-[rgb(var(--panel-feed-border))]/45 bg-white/80 ${
                  data.winRate.winPct != null && data.winRate.winPct >= 50
                    ? "text-[rgb(var(--signal-up))]"
                    : "text-[rgb(var(--signal-down))]"
                }`}
              >
                {it
                  ? `${data.winRate.gainCount}↑ · ${data.winRate.lossCount}↓`
                  : `${data.winRate.gainCount} up · ${data.winRate.lossCount} down`}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="dashboard-pulse-hero p-3">
        <div className="rounded-xl border border-[rgb(var(--panel-feed-border))]/45 bg-white/90 overflow-hidden grid grid-cols-2 divide-x divide-[rgb(var(--panel-feed-border))]/35">
          <div className="min-w-0 p-3">
            {onAddExternalHolding ? (
              <ExternalHoldingAddForm onAdd={onAddExternalHolding} embedded />
            ) : (
              <p className="text-xs text-ink-muted">
                {it ? "Aggiunta holding non disponibile." : "Add holding is unavailable."}
              </p>
            )}
          </div>
          <div className="min-w-0 p-3">
            <PortfolioAllocationPie
              simTable={simTable}
              inputs={inputs}
              history={history}
              dense
              embedded
            />
          </div>
        </div>
      </div>

      {data.portfolioRows.length === 0 ? (
        <p className="text-xs text-ink-muted text-center py-6 px-4">{t("dashboard.pulse.noPortfolio")}</p>
      ) : (
        <>
          <details
            open={positionsOpen}
            onToggle={onPositionsToggle}
            className="border-t border-[rgb(var(--panel-feed-border))]/35 shrink-0"
          >
            <summary className="cursor-pointer select-none list-none px-4 py-2 bg-[rgb(var(--panel-feed-header-bg))]/50 hover:bg-[rgb(var(--panel-feed-row-hover))]/35 transition-colors [&::-webkit-details-marker]:hidden">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--panel-feed-accent-strong))]">
                {t("dashboard.pulse.positionsSummary", { n: data.portfolioRows.length })}
              </span>
              <span className="ml-2 text-[11px] text-ink-muted font-normal normal-case tracking-normal">
                {positionsOpen ? (it ? "nascondi" : "hide") : it ? "mostra" : "show"}
              </span>
            </summary>
            <div className="min-w-0 overflow-x-auto overflow-y-hidden">
            <table className={`${SHEET_GRID_TABLE_CLASS} text-xs border-collapse w-full table-fixed`}>
              <SheetGridColgroup columnCount={onSell ? 12 : 11} />
              <thead>
                <tr className="bg-[rgb(var(--panel-feed-header-bg))]/80 text-[11px] uppercase tracking-wide text-ink-muted font-semibold">
                  <th className={gridTh("left", "py-2 font-semibold")}>{t("dashboard.pulse.colTicker")}</th>
                  <th
                    className={gridTh("center", "py-2 font-semibold w-[4.5rem]")}
                    title={t("dashboard.pulse.colCycleTip")}
                  >
                    {t("dashboard.pulse.colCycle")}
                  </th>
                  <th
                    className={gridTh("center", "py-2 font-semibold")}
                    title={t("dashboard.pulse.colPriceTip")}
                  >
                    {t("dashboard.pulse.colPrice")}
                  </th>
                  <th
                    className={gridTh("center", "py-2 font-semibold")}
                    title={it ? "Raccomandazione motore sim (Compra/Tieni/Vendi/Valuta)" : "Sim engine recommendation (Buy/Hold/Sell/Review)"}
                  >
                    {it ? "Racc." : "Rec."}
                  </th>
                  <th
                    className={gridTh("center", "py-2 font-semibold")}
                    title={it ? "Giorni al Completion Date (T−giorni oggi; T+giorni se passato)" : "Days to Completion Date (T−days today; T+days if past)"}
                  >
                    T−CD
                  </th>
                  <th className={gridTh("center", "py-2 font-semibold")} title={t("dashboard.pulse.colPcontWindTip")}>
                    {t("dashboard.pulse.colPcontWind")}
                  </th>
                  <th
                    className={gridTh("center", "py-2 font-semibold")}
                    title={t("dashboard.pulse.colDeltaTip")}
                  >
                    {t("dashboard.pulse.colDelta")}
                  </th>
                  <th
                    className={gridTh("center", "py-2 font-semibold")}
                    title={t("dashboard.pulse.colGlobalEisTip")}
                  >
                    {t("dashboard.pulse.colGlobalEis")}
                  </th>
                  <th
                    className={gridTh("center", "py-2 font-semibold")}
                    title={t("dashboard.pulse.col24hTip")}
                  >
                    24h
                  </th>
                  <th
                    className={gridTh("center", "py-2 font-semibold")}
                    title={t("dashboard.pulse.colInvestedTip")}
                  >
                    {t("dashboard.pulse.colInvested")}
                  </th>
                  <th
                    className={gridTh("center", "py-2 font-semibold")}
                    title={t("dashboard.pulse.colPnlTip")}
                  >
                    {t("dashboard.pulse.colPnl")}
                  </th>
                  {onSell ? (
                    <th
                      className={gridTh("center", "py-2 font-semibold w-[5.5rem]")}
                      title={t("dashboard.pulse.colCloseTip")}
                    >
                      {t("dashboard.pulse.colClose")}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  return data.portfolioRows.map((row) => {
                  const bookEntry = inputs[row.key];
                  const livePx =
                    row.gainPlanRow.currentPriceUsd ??
                    (row.gainPlanRow.simRow
                      ? currentPriceFromRow(row.gainPlanRow.simRow as Record<string, unknown>)
                      : null);
                  const bookMtm = bookMarkToMarket(bookEntry, livePx);
                  const bookMetrics = row.gainPlanRow.simRow
                    ? resolveBookOpenPositionMetrics(
                        row.gainPlanRow.simRow as Record<string, unknown>,
                        inputs,
                        livePx,
                        row.gainPlanRow.investedAt ?? null,
                      )
                    : null;
                  const displayPnlEur = bookMetrics?.pnlEur ?? bookMtm?.pnlEur ?? row.pnlEur;
                  const displayPnlPct = bookMetrics?.pnlPct ?? bookMtm?.pnlPct ?? row.pnlPct;
                  const displayPnlEur24h = bookMetrics?.pnlEur24h ?? row.pnlEur24h;
                  const displayPnlPct24h = bookMetrics?.pnlPct24h ?? row.pnlPct24h;
                  const givebackCapital =
                    bookMetrics != null && bookMetrics.capital > 0
                      ? bookMetrics.capital
                      : row.gainPlanRow.capital > 0
                        ? row.gainPlanRow.capital
                        : null;
                  const givebackBell = pulseTickerGivebackBellFromHistory(
                    row.key,
                    displayPnlEur,
                    history,
                    row.gainPlanRow.investedAt ?? null,
                    glWinAlertFrac,
                    givebackCapital,
                  );
                  const cycleAlert = cycleAlertForKey(
                    cycleAlerts?.alerts,
                    row.key,
                    row.ticker,
                  );
                  return (
                  <tr
                    key={row.key}
                    className="border-t border-[rgb(var(--panel-feed-border))]/25 hover:bg-[rgb(var(--panel-feed-row-hover))]/45 cursor-pointer bg-white/70"
                    onClick={() => openPortfolioRow(row)}
                  >
                    <td className={`${gridTd("left")} whitespace-nowrap`}>
                      <div className="flex flex-col leading-tight">
                        <span className="inline-flex items-center gap-1 min-w-0">
                          <PortfolioTickerMark
                            ticker={row.ticker}
                            inPortfolio
                            pnlPct={displayPnlPct}
                            pnlEur={displayPnlEur}
                            simRow={row.gainPlanRow.simRow as Record<string, unknown> | undefined}
                            className="text-xs"
                            portfolioMarkTitle={t("sim.lossAnalysis.summaryTable.portfolioMark")}
                          />
                          {givebackBell.hit ? (
                            <LossOfWinsBell
                              giveback={givebackBell}
                              it={it}
                              alertPct={clampGlWinAlertPct(glWinAlertPct)}
                            />
                          ) : null}
                        </span>
                        {row.gainPlanRow.investedAt ? (
                          <span
                            className="text-[9px] text-ink-muted/85 tabular-nums"
                            title={
                              it
                                ? `Investito il ${new Date(row.gainPlanRow.investedAt).toLocaleString("it-IT")}`
                                : `Invested ${new Date(row.gainPlanRow.investedAt).toLocaleString("en-US")}`
                            }
                          >
                            {it ? "dal " : "since "}
                            {new Date(row.gainPlanRow.investedAt).toLocaleDateString(
                              it ? "it-IT" : "en-US",
                              { day: "2-digit", month: "short", year: "2-digit" },
                            )}
                            {row.gainPlanRow.holdDaysElapsed != null
                              ? ` · ${row.gainPlanRow.holdDaysElapsed}d`
                              : ""}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className={`${gridTd("center")} py-1 whitespace-nowrap`}>
                      {(() => {
                        if (cycleAlertsLoading && !cycleAlerts) {
                          return (
                            <span
                              className="text-ink-muted/60 text-[10px] tabular-nums"
                              title={t("dashboard.pulse.colCycleTip")}
                            >
                              …
                            </span>
                          );
                        }
                        const cyclePrimary = resolveOperationalAlignedCyclePrimary(cycleAlert, {
                          operationalRec: recommendationByKey?.get(row.key) ?? "hold",
                          hasPosition: true,
                        });
                        return cyclePrimary ? (
                          <CatalystCycleBadge
                            primary={cyclePrimary}
                            matches={cycleAlert?.matches}
                            compact
                          />
                        ) : (
                          <span
                            className="text-ink-muted/70 text-[10px] tabular-nums"
                            title={t("dashboard.pulse.colCycleTip")}
                          >
                            {t("common.na")}
                          </span>
                        );
                      })()}
                    </td>
                    {(() => {
                      const simRow = row.gainPlanRow.simRow as Record<string, unknown> | undefined;
                      const px = simRow ? currentPriceFromRow(simRow) : null;
                      const refreshed = simRow ? priceRefreshAtFromRow(simRow) : null;
                      const sk = simRow ? simulationRowSeriesKey(simRow) : null;
                      const chartPts = sk ? chartPointsByKey.get(sk) ?? null : null;
                      const intra = intradayByTicker.get(row.ticker.trim().toUpperCase());
                      const priceLows = resolvePriceLowsUsd({
                        simRow,
                        chartPts,
                        intradayPrior: intra?.prior,
                        intradayLive: intra?.live,
                      });
                      const lowSpot = resolveLowSpotSignals(
                        px,
                        priceLows.weekMinUsd,
                        priceLows.dayMinUsd,
                      );
                      const lowSpotTip = pulsePriceCellTip(lowSpot, it);
                      const tip =
                        px != null
                          ? refreshed
                            ? it
                              ? `${lowSpotTip} · aggiornato ${new Date(refreshed).toLocaleString("it-IT")}`
                              : `${lowSpotTip} · updated ${new Date(refreshed).toLocaleString("en-US")}`
                            : lowSpot.day === "below"
                              ? lowSpotTip
                              : t("dashboard.pulse.colPriceTip")
                          : it
                            ? "Prezzo corrente non disponibile sul foglio"
                            : "Current price not available on the sheet";
                      const priceTone =
                        px != null && lowSpot.day === "below"
                          ? "font-bold text-emerald-700 dark:text-emerald-300"
                          : "font-semibold text-ink";
                      return (
                        <td
                          className={`${gridTd("center")} tabular-nums whitespace-nowrap text-[11px] ${priceTone}`}
                          title={tip}
                        >
                          {px != null ? (
                            <div className="inline-flex flex-col items-center gap-0 leading-none">
                              {lowSpot.day === "below" && lowSpot.week === "below" ? (
                                <PulseLowSpotBoltIcon it={it} />
                              ) : null}
                              <span>{fmtPulsePriceUsd(px)}</span>
                              {bookEntry && !bookEntry.ignoreSheet ? (
                                <span
                                  className="mt-0.5 inline-flex items-center gap-0.5 text-[9px] font-normal text-ink-muted"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {t("dashboard.pulse.buyBasis")}
                                  <PulseBuyPriceInput
                                    value={bookEntry.buyPrice ?? 0}
                                    onCommit={(n) => {
                                      patchInputs((prev) => {
                                        const cur = prev[row.key];
                                        if (!cur || cur.ignoreSheet) return prev;
                                        return { ...prev, [row.key]: { ...cur, buyPrice: n } };
                                      });
                                    }}
                                  />
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })()}
                    {(() => {
                      const rec = (recommendationByKey?.get(row.key) ?? "none") as RecAction;
                      return (
                        <td className={`${gridTd("center")} py-1`}>
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide ${recBadgeToneClass(rec)}`}
                            title={
                              rec === "none"
                                ? (it ? "Raccomandazione non disponibile" : "Recommendation not available")
                                : (it ? `Motore sim: ${recLabel(rec, true)}` : `Sim engine: ${recLabel(rec, false)}`)
                            }
                          >
                            {recLabel(rec, it)}
                          </span>
                        </td>
                      );
                    })()}
                    {(() => {
                      const d = daysFromToday(row.completionDate);
                      const isPast = d != null && d < 0;
                      const isSoon = d != null && d >= 0 && d <= 7;
                      const tone = isPast
                        ? "text-ink-muted/70"
                        : isSoon
                        ? "text-amber-600 dark:text-amber-400 font-semibold"
                        : "text-ink";
                      return (
                        <td
                          className={`${gridTd("center")} tabular-nums whitespace-nowrap text-[11px] ${tone}`}
                          title={row.completionDate && row.completionDate !== "—" ? row.completionDate : undefined}
                        >
                          {fmtDaysToCd(row.completionDate, it)}
                        </td>
                      );
                    })()}
                    {(() => {
                      const simRow = row.gainPlanRow.simRow as Record<string, unknown> | undefined;
                      const pCont = resolveDisplayPContinuation(simRow);
                      const contBand = resolveContBand(simRow);
                      const tip = continuationTooltipText(simRow, it);
                      if (pCont == null) {
                        return (
                          <td className={`${gridTd("center")} py-1 text-ink-muted/50 font-bold`} title={tip}>
                            —
                          </td>
                        );
                      }
                      return (
                        <td className={`${gridTd("center")} py-1`} title={tip}>
                          <span
                            className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[11px] font-bold tabular-nums leading-none"
                            style={contScoreStyle(contBand)}
                          >
                            {pCont >= STRONG_WIND_PCONT ? (
                              <WindIcon className="w-3 h-3 shrink-0 text-sky-600" />
                            ) : null}
                            {Math.round(pCont)}%
                          </span>
                          <span className="block text-[8px] text-ink-muted/75 leading-tight mt-0.5">
                            {contBandShort(contBand, it)}
                          </span>
                        </td>
                      );
                    })()}
                    <td
                      className={`${gridTd("center")} tabular-nums whitespace-nowrap${portfolioPnlAccentClass(row.deltaPnlEurSinceVisit ?? 0)}`}
                      title={
                        row.deltaPnlEurSinceVisit != null
                          ? t("dashboard.pulse.colDeltaTip")
                          : undefined
                      }
                    >
                      {row.deltaPnlEurSinceVisit != null ? (
                        <>
                          <span className="mr-0.5 opacity-80" aria-hidden>
                            {row.deltaPnlEurSinceVisit > 0.5
                              ? "↑"
                              : row.deltaPnlEurSinceVisit < -0.5
                                ? "↓"
                                : "→"}
                          </span>
                          {fmtPulseEur(row.deltaPnlEurSinceVisit)}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    {(() => {
                      const simRow = row.gainPlanRow.simRow as
                        | Record<string, unknown>
                        | undefined;
                      const sheetKpi = clinicalKpiFromSimRow(simRow ?? null);
                      const rollup = globalTickerEisRollup(
                        row.ticker,
                        lang,
                        sheetKpi,
                        clinicalPreCdRecords ?? undefined,
                      );
                      if (rollup.total == null) {
                        return (
                          <td
                            className={`${gridTd("center")} py-1 text-ink-muted/50 text-[11px]`}
                            title={
                              it
                                ? "Nessun evento EIS nel feed clinico e nessun Clinical KPI sul foglio — aggiornamento giornaliero del feed."
                                : "No EIS events in clinical feed and no sheet Clinical KPI — clinical feed refreshes daily."
                            }
                          >
                            —
                          </td>
                        );
                      }
                      const color = eisColor(rollup.total);
                      const tip =
                        rollup.eventCount > 0
                          ? t("dashboard.pulse.colGlobalEisTip")
                          : it
                            ? "Fallback Clinical KPI (foglio Simulation) — nessun evento feed per questo ticker."
                            : "Sheet Clinical KPI fallback — no feed events for this ticker.";
                      return (
                        <td className={`${gridTd("center")} py-1`} title={tip}>
                          <p
                            className="font-bold tabular-nums text-[11px] leading-none"
                            style={{ color }}
                          >
                            Σ {rollup.total >= 0 ? "+" : ""}
                            {rollup.total.toFixed(1)}
                          </p>
                          {(rollup.posSum > 0 || rollup.negAbsSum > 0) &&
                          rollup.eventCount > 0 ? (
                            <p className="text-[8px] tabular-nums text-ink-muted/80 leading-tight mt-0.5 whitespace-nowrap">
                              <span className="text-emerald-700">+{rollup.posSum.toFixed(1)}</span>
                              <span className="text-ink-muted/50"> / </span>
                              <span className="text-rose-700">−{rollup.negAbsSum.toFixed(1)}</span>
                            </p>
                          ) : rollup.eventCount === 0 ? (
                            <p className="text-[8px] text-ink-muted/70 leading-tight mt-0.5">
                              KPI
                            </p>
                          ) : null}
                        </td>
                      );
                    })()}
                    <td
                      className={`${gridTd("center")} tabular-nums whitespace-nowrap${portfolioPnlAccentClass(displayPnlEur24h ?? 0)}`}
                      title={t("dashboard.pulse.col24hTip")}
                    >
                      {displayPnlEur24h != null ? (
                        <>
                          {fmtPulseEur(displayPnlEur24h)}
                          {displayPnlPct24h != null ? (
                            <span className="text-[11px] font-normal opacity-80 ml-0.5">
                              {fmtPulsePct(displayPnlPct24h)}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td
                      className={`${gridTd("center")} tabular-nums whitespace-nowrap text-ink`}
                      title={t("dashboard.pulse.investedEditTip")}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex flex-col items-center gap-0.5">
                        <CapitalNumberInput
                          value={bookEntry?.capital ?? row.gainPlanRow.capital ?? 0}
                          onCommit={(n) => {
                            if (!(n > 0) || !bookEntry || bookEntry.ignoreSheet) return false;
                            patchInputs((prev) => {
                              const cur = prev[row.key];
                              if (!cur || cur.ignoreSheet) return prev;
                              return { ...prev, [row.key]: { ...cur, capital: n } };
                            });
                          }}
                          className="input w-[5.5rem] py-0.5 text-[11px] tabular-nums text-center"
                        />
                        {(() => {
                          const tk = row.ticker.trim().toUpperCase();
                          const tickerCap = capitalByTicker.get(tk) ?? 0;
                          const weightPct =
                            openBookCapital > 0 && tickerCap > 0
                              ? Math.round((tickerCap / openBookCapital) * 1000) / 10
                              : null;
                          return weightPct != null ? (
                            <span className="text-[10px] font-normal text-ink-muted">
                              {weightPct.toFixed(1)}%
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </td>
                    <td
                      className={`${gridTd("center")} tabular-nums whitespace-nowrap font-semibold${portfolioPnlAccentClass(displayPnlEur, displayPnlPct)}`}
                      title={t("dashboard.pulse.colPnlTip")}
                    >
                      <span className="mr-0.5 opacity-80" aria-hidden>
                        {portfolioPnlDirectionGlyph(displayPnlEur, displayPnlPct)}
                      </span>
                      {fmtPulseEur(displayPnlEur)}
                      <span className="text-[11px] font-normal opacity-80 ml-0.5">
                        {fmtPulsePct(displayPnlPct)}
                      </span>
                    </td>
                    {onSell ? (
                      <td
                        className={`${gridTd("center")} whitespace-nowrap`}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center justify-center gap-1">
                          <PulseRemoveButton
                            ticker={row.ticker}
                            simKey={row.key}
                            simRow={row.gainPlanRow.simRow ?? null}
                            onSell={onSell}
                          />
                          <PortfolioExitButton
                            simKey={row.key}
                            simRow={row.gainPlanRow.simRow ?? null}
                            onSell={onSell}
                            compact
                          />
                        </div>
                      </td>
                    ) : null}
                    {/* Δ PLAN / GAIN VS PLAN / Risk & Benefit / Reg. / Rescue
                        removed from the Open Positions table on user request.
                        The same signals remain available in the 24h Assessment
                        tab (per-ticker cards + Top KPI table). */}
                  </tr>
                  );
                  });
                })()}
              </tbody>
            </table>
            </div>
          </details>
        </>
      )}

      {/* Risk & Benefit, Regulatory and Rescue score detail modals were
          removed alongside their trigger columns. The same detail
          breakdowns remain reachable from the 24h Assessment tab. */}

      {/* MII Opportunities table removed — Soft BUY/SELL live in the unified
          Recommendations desk (HomeSignalsDesk) below Pulse. */}

      <p className="px-4 pb-3 pt-1 text-[11px] text-ink-muted/75 leading-snug border-t border-[rgb(var(--panel-feed-border))]/25 bg-[rgb(var(--panel-feed-header-bg))]/45">
        {t("dashboard.pulse.footnote")}
        {ptfTone === "gain" ? ` · ${t("dashboard.pulse.inGain")}` : ptfTone === "loss" ? ` · ${t("dashboard.pulse.inLoss")}` : ""}
      </p>
    </section>
  );
}
