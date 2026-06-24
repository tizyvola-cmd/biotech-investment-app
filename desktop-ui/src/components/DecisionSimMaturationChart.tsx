import { useMemo, useState, useEffect } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ExperimentPiggyBank } from "../sheet/investDecisionSimExperiment";
import type { DecisionSimTick, PaperPosition, TickerSimEvaluation } from "../sheet/investDecisionSimLoop";
import {
  buildPaperMaturationSeries,
  maturationChartTickIndices,
  preparePaperMaturationChartData,
  type PaperMaturationChartPoint,
} from "../sheet/paperSimMaturation";
import type { SimLoopSynthMaturationPoint } from "../sheet/simLoopSynthMaturation";
import type { SimLoopSizingVariant } from "../sheet/simLoopSizingVariant";
import { SimLoopSizingVariantToggle } from "./SimLoopSizingVariantToggle";
import {
  clampMaturationChartValue,
  computeMaturationChartYDomain,
  buildMaturationOverview,
  maturationOverviewLabel,
  type MaturationOverviewGroup,
} from "../sheet/maturationOverview";
import type { PortfolioDailyPnlLedger } from "../sheet/simulationPosition";
import type { SheetTable } from "../types";
import { useLang, useT } from "../shared/i18n";
import { DECISION_SIM_PAIR_CHART_HEIGHT } from "./decisionSimChartLayout";

function fmtEur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtAxisEur(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const sign = n >= 0 ? "+" : "−";
    return `${sign}€${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 10_000) {
    const sign = n >= 0 ? "+" : "−";
    return `${sign}€${Math.round(abs / 1000)}k`;
  }
  return fmtEur(n);
}

function fmtSignedEur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${fmtEur(n)}`;
}

type MaturationChartPoint = PaperMaturationChartPoint & {
  baselineTotalPnlEur?: number | null;
  actualPortfolioClosedPnlEur?: number | null;
  actualPortfolioOpenPnlEur?: number | null;
  simLoopSynthClosedPnlEur?: number | null;
  simLoopSynthOpenMtmEur?: number | null;
  simLoopWeightClosedPnlEur?: number | null;
  simLoopWeightOpenMtmEur?: number | null;
};

type MaturationCurveKey =
  | "portfolioClosed"
  | "portfolioOpen"
  | "simClosed"
  | "simOpen"
  | "synthClosed"
  | "synthOpen"
  | "weightClosed"
  | "weightOpen"
  | "baseline";

type MaturationCurveDef = {
  key: MaturationCurveKey;
  group: "portfolio" | "sim" | "synth" | "weight" | "baseline";
  color: string;
  dashed: boolean;
  labelIt: string;
  labelEn: string;
  dataKey: keyof MaturationChartPoint;
  yValue: (p: MaturationChartPoint) => number | null | undefined;
};

const MATURATION_CURVE_DEFS: MaturationCurveDef[] = [
  {
    key: "portfolioClosed",
    group: "portfolio",
    color: "#d97706",
    dashed: false,
    labelIt: "Portfolio · chiusi",
    labelEn: "Portfolio · closed",
    dataKey: "actualPortfolioClosedPnlEur",
    yValue: (p) => p.actualPortfolioClosedPnlEur,
  },
  {
    key: "portfolioOpen",
    group: "portfolio",
    color: "#dc2626",
    dashed: true,
    labelIt: "Portfolio · aperti",
    labelEn: "Portfolio · open",
    dataKey: "actualPortfolioOpenPnlEur",
    yValue: (p) => p.actualPortfolioOpenPnlEur,
  },
  {
    key: "simClosed",
    group: "sim",
    color: "#059669",
    dashed: false,
    labelIt: "Sim loop · chiusi",
    labelEn: "Sim loop · closed",
    dataKey: "closedPnlEur",
    yValue: (p) => p.closedPnlEur,
  },
  {
    key: "simOpen",
    group: "sim",
    color: "#0ea5e9",
    dashed: true,
    labelIt: "Sim loop · aperti",
    labelEn: "Sim loop · open",
    dataKey: "openMtmEur",
    yValue: (p) => p.openMtmEur,
  },
  {
    key: "synthClosed",
    group: "synth",
    color: "#db2777",
    dashed: false,
    labelIt: "Sim synth · chiusi",
    labelEn: "Sim synth · closed",
    dataKey: "simLoopSynthClosedPnlEur",
    yValue: (p) => p.simLoopSynthClosedPnlEur,
  },
  {
    key: "synthOpen",
    group: "synth",
    color: "#c026d3",
    dashed: true,
    labelIt: "Sim synth · aperti",
    labelEn: "Sim synth · open",
    dataKey: "simLoopSynthOpenMtmEur",
    yValue: (p) => p.simLoopSynthOpenMtmEur,
  },
  {
    key: "weightClosed",
    group: "weight",
    color: "#d97706",
    dashed: false,
    labelIt: "Sim weight · chiusi",
    labelEn: "Sim weight · closed",
    dataKey: "simLoopWeightClosedPnlEur",
    yValue: (p) => p.simLoopWeightClosedPnlEur,
  },
  {
    key: "weightOpen",
    group: "weight",
    color: "#f59e0b",
    dashed: true,
    labelIt: "Sim weight · aperti",
    labelEn: "Sim weight · open",
    dataKey: "simLoopWeightOpenMtmEur",
    yValue: (p) => p.simLoopWeightOpenMtmEur,
  },
  {
    key: "baseline",
    group: "baseline",
    color: "#7c3aed",
    dashed: true,
    labelIt: "Baseline",
    labelEn: "Baseline",
    dataKey: "baselineTotalPnlEur",
    yValue: (p) => p.baselineTotalPnlEur,
  },
];

const DEFAULT_VISIBLE_CURVES: Record<MaturationCurveKey, boolean> = {
  portfolioClosed: true,
  portfolioOpen: true,
  simClosed: true,
  simOpen: true,
  synthClosed: false,
  synthOpen: false,
  weightClosed: false,
  weightOpen: false,
  baseline: true,
};

function MaturationCurveSwatch({ color, dashed, dimmed }: { color: string; dashed: boolean; dimmed?: boolean }) {
  if (dashed) {
    return (
      <span
        className="inline-block w-3.5 h-0 border-t-2 border-dashed"
        style={{ borderColor: color, opacity: dimmed ? 0.35 : 1 }}
        aria-hidden
      />
    );
  }
  return (
    <span
      className="inline-block w-3.5 h-0.5 rounded"
      style={{ backgroundColor: color, opacity: dimmed ? 0.35 : 1 }}
      aria-hidden
    />
  );
}

function MaturationCurveToolbar({
  curves,
  visible,
  onToggleCurve,
  onToggleGroup,
  onShowAll,
  it,
}: {
  curves: MaturationCurveDef[];
  visible: Record<MaturationCurveKey, boolean>;
  onToggleCurve: (key: MaturationCurveKey) => void;
  onToggleGroup: (group: "portfolio" | "sim" | "synth" | "weight") => void;
  onShowAll: () => void;
  it: boolean;
}) {
  const groupDefs = [
    { id: "portfolio" as const, labelIt: "Portfolio", labelEn: "Portfolio" },
    { id: "sim" as const, labelIt: "Sim equal", labelEn: "Sim equal" },
    { id: "weight" as const, labelIt: "Sim weight", labelEn: "Sim weight" },
    { id: "synth" as const, labelIt: "Sim synth", labelEn: "Sim synth" },
  ].filter((g) => curves.some((c) => c.group === g.id));

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 shrink-0">
      <span className="text-[9px] uppercase tracking-wider text-ink-muted font-semibold">
        {it ? "Mostra" : "Show"}
      </span>
      {groupDefs.map((g) => {
        const keys = curves.filter((c) => c.group === g.id).map((c) => c.key);
        const allOn = keys.every((k) => visible[k]);
        const anyOn = keys.some((k) => visible[k]);
        return (
          <button
            key={g.id}
            type="button"
            aria-pressed={anyOn}
            onClick={() => onToggleGroup(g.id)}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold border transition ${
              anyOn
                ? allOn
                  ? "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-ink"
                  : "border-indigo-300 dark:border-indigo-700 bg-indigo-50/80 dark:bg-indigo-950/30 text-indigo-900 dark:text-indigo-100"
                : "border-slate-200/60 dark:border-slate-700/60 bg-slate-50/70 dark:bg-slate-900/50 text-ink-muted/70 line-through"
            }`}
            title={
              it
                ? allOn
                  ? `Nascondi tutto ${g.labelIt}`
                  : `Mostra tutto ${g.labelIt}`
                : allOn
                  ? `Hide all ${g.labelEn}`
                  : `Show all ${g.labelEn}`
            }
          >
            {it ? g.labelIt : g.labelEn}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onShowAll}
        className="rounded-full px-2 py-0.5 text-[9px] font-medium border border-slate-200/70 dark:border-slate-700/60 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-800/60 transition"
      >
        {it ? "Tutte" : "All"}
      </button>
      <span className="hidden sm:inline text-ink-muted/40">|</span>
      {curves.map((c) => {
        const on = visible[c.key];
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggleCurve(c.key)}
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-medium border transition ${
              on
                ? "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-ink"
                : "border-slate-200/60 dark:border-slate-700/60 bg-slate-50/70 dark:bg-slate-900/50 text-ink-muted/70 line-through"
            }`}
            title={on ? (it ? `Nascondi ${c.labelIt}` : `Hide ${c.labelEn}`) : it ? `Mostra ${c.labelIt}` : `Show ${c.labelEn}`}
          >
            <MaturationCurveSwatch color={c.color} dashed={c.dashed} dimmed={!on} />
            <span className="max-w-[7rem] truncate">{it ? c.labelIt : c.labelEn}</span>
          </button>
        );
      })}
      <span className="inline-flex items-center gap-1 text-[8px] text-ink-muted/80 px-1">
        <span className="inline-block w-2 h-2 rounded-full bg-rose-500" aria-hidden />
        SELL
      </span>
    </div>
  );
}

function MaturationTooltip({
  active,
  payload,
  it,
}: {
  active?: boolean;
  payload?: { payload: MaturationChartPoint }[];
  it: boolean;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  const group = (
    title: string,
    closed: number | null | undefined,
    open: number | null | undefined,
    closedClass: string,
    openClass: string,
  ) => {
    if (closed == null && open == null) return null;
    return (
      <div className="border-t border-slate-100 pt-1 mt-1 first:border-0 first:pt-0 first:mt-0">
        <p className="font-semibold text-ink">{title}</p>
        <p className={closedClass}>
          {it ? "Chiusi" : "Closed"}: {fmtSignedEur(closed ?? 0)}
        </p>
        <p className={openClass}>
          {it ? "Aperti (MTM)" : "Open (MTM)"}: {fmtSignedEur(open ?? 0)}
        </p>
      </div>
    );
  };

  return (
    <div className="rounded-md border bg-white px-2.5 py-2 text-[10px] shadow-md space-y-0.5 max-w-[240px]">
      <p className="font-semibold">{d.atLabel}</p>
      {group(
        it ? "Portfolio reale" : "Actual portfolio",
        d.actualPortfolioClosedPnlEur,
        d.actualPortfolioOpenPnlEur,
        "text-amber-800",
        "text-red-700",
      )}
      {group(
        it ? "Sim loop" : "Sim loop",
        d.closedPnlEur,
        d.openMtmEur,
        "text-emerald-700",
        "text-sky-700",
      )}
      {group(
        it ? "Sim loop · synth" : "Sim loop · synth",
        d.simLoopSynthClosedPnlEur,
        d.simLoopSynthOpenMtmEur,
        "text-pink-700",
        "text-fuchsia-600",
      )}
      {d.sellTicker ? (
        <p className={d.sellPnlEur != null && d.sellPnlEur >= 0 ? "text-emerald-600" : "text-rose-600"}>
          SELL {d.sellTicker}: {fmtSignedEur(d.sellPnlEur)}
        </p>
      ) : null}
    </div>
  );
}

function MaturationGroupSummary({
  group,
  it,
}: {
  group: MaturationOverviewGroup;
  it: boolean;
}) {
  const label = maturationOverviewLabel(group.id, it);
  const accent =
    group.id === "actual"
      ? { closed: "text-amber-800", open: "text-red-700", total: "text-amber-900" }
      : group.id === "simSynth"
        ? { closed: "text-pink-700", open: "text-fuchsia-600", total: "text-pink-800" }
        : { closed: "text-emerald-700", open: "text-sky-700", total: "text-emerald-800" };

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface))]/70 px-2.5 py-2 min-w-0">
      <p className="text-[10px] font-semibold text-ink truncate">{label}</p>
      <p className="text-[9px] text-ink-muted mt-0.5 tabular-nums">
        {it ? "Deal" : "Deals"}:{" "}
        <span className="font-medium text-ink">
          {group.openDeals} {it ? "aperti" : "open"}
        </span>
        {" · "}
        <span className="font-medium text-ink">
          {group.closedDeals} {it ? "chiusi" : "closed"}
        </span>
      </p>
      <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 text-[9px] tabular-nums">
        <div>
          <p className="text-ink-muted/90 uppercase tracking-wide text-[8px]">
            {it ? "Chiusi" : "Closed"}
          </p>
          <p className={`font-semibold ${accent.closed}`}>{fmtSignedEur(group.closedPnlEur)}</p>
        </div>
        <div>
          <p className="text-ink-muted/90 uppercase tracking-wide text-[8px]">
            {it ? "Aperti MTM" : "Open MTM"}
          </p>
          <p className={`font-semibold ${accent.open}`}>{fmtSignedEur(group.openMtmEur)}</p>
        </div>
        <div>
          <p className="text-ink-muted/90 uppercase tracking-wide text-[8px]">
            {it ? "Totale" : "Total"}
          </p>
          <p className={`font-bold ${accent.total}`}>{fmtSignedEur(group.totalPnlEur)}</p>
        </div>
        <div>
          <p className="text-ink-muted/90 uppercase tracking-wide text-[8px]">24h</p>
          <p
            className={`font-semibold ${
              group.pnl24hEur == null
                ? "text-ink-muted"
                : group.pnl24hEur >= 0
                  ? "text-[rgb(var(--signal-up))]"
                  : "text-[rgb(var(--signal-down))]"
            }`}
          >
            {group.pnl24hEur != null ? fmtSignedEur(group.pnl24hEur) : "—"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function DecisionSimMaturationChart({
  ticks,
  livePiggy,
  liveEvaluations,
  paperPortfolio,
  compact = false,
  className,
  compareTicks,
  compareLivePiggy,
  comparePaperPortfolio,
  raWhatIfActive = false,
  actualPortfolioSeries,
  simLoopSynthSeries,
  simLoopWeightedSeries,
  portfolioLedger = null,
  simTable = null,
  synthSizing = null,
  sizingVariant = "equal",
  onSizingVariantChange,
}: {
  ticks: DecisionSimTick[];
  livePiggy: ExperimentPiggyBank;
  liveEvaluations: TickerSimEvaluation[];
  paperPortfolio: PaperPosition[];
  compact?: boolean;
  className?: string;
  compareTicks?: DecisionSimTick[];
  compareLivePiggy?: ExperimentPiggyBank;
  comparePaperPortfolio?: PaperPosition[];
  raWhatIfActive?: boolean;
  /** Actual portfolio P&L series (from Simulation sheet) for comparison */
  actualPortfolioSeries?: {
    closed: Array<{ at: string; totalPnlEur: number }>;
    open: Array<{ at: string; totalPnlEur: number }>;
  };
  /** Sim loop counterfactual with Weight Sim Exp (synth) sizing — one point per tick `at`. */
  simLoopSynthSeries?: SimLoopSynthMaturationPoint[];
  /** Sim loop with Learning Lab / Step 2 approved weights. */
  simLoopWeightedSeries?: SimLoopSynthMaturationPoint[];
  portfolioLedger?: PortfolioDailyPnlLedger | null;
  simTable?: SheetTable | null;
  synthSizing?: {
    shareByRowKey: Record<string, number>;
    totalCapitalEur: number;
  } | null;
  sizingVariant?: SimLoopSizingVariant;
  onSizingVariantChange?: (v: SimLoopSizingVariant) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const chartHeight = compact ? Math.max(DECISION_SIM_PAIR_CHART_HEIGHT, 180) : 220;

  const series = useMemo(
    () =>
      buildPaperMaturationSeries(ticks, {
        piggyBank: livePiggy,
        evaluations: liveEvaluations,
        paperPortfolio,
      }),
    [ticks, livePiggy, liveEvaluations, paperPortfolio],
  );

  const compareSeries = useMemo(() => {
    if (!raWhatIfActive || !compareTicks?.length) return null;
    return buildPaperMaturationSeries(compareTicks, {
      piggyBank: compareLivePiggy ?? livePiggy,
      evaluations: liveEvaluations,
      paperPortfolio: comparePaperPortfolio ?? [],
    });
  }, [
    raWhatIfActive,
    compareTicks,
    compareLivePiggy,
    livePiggy,
    liveEvaluations,
    comparePaperPortfolio,
  ]);

  const simLoopSynthLookup = useMemo(() => {
    if (!simLoopSynthSeries?.length) return null;
    const sorted = [...simLoopSynthSeries].sort((a, b) => a.at.localeCompare(b.at));
    return (at: string, isLive?: boolean) => {
      if (isLive) {
        const last = sorted[sorted.length - 1];
        return last
          ? {
              closed: last.simLoopSynthClosedPnlEur,
              open: last.simLoopSynthOpenMtmEur,
            }
          : null;
      }
      let last: SimLoopSynthMaturationPoint | null = null;
      for (const pt of sorted) {
        if (pt.at > at) break;
        last = pt;
      }
      return last
        ? {
            closed: last.simLoopSynthClosedPnlEur,
            open: last.simLoopSynthOpenMtmEur,
          }
        : null;
    };
  }, [simLoopSynthSeries]);

  const simLoopWeightLookup = useMemo(() => {
    if (!simLoopWeightedSeries?.length) return null;
    const sorted = [...simLoopWeightedSeries].sort((a, b) => a.at.localeCompare(b.at));
    return (at: string, isLive?: boolean) => {
      if (isLive) {
        const last = sorted[sorted.length - 1];
        return last
          ? {
              closed: last.simLoopSynthClosedPnlEur,
              open: last.simLoopSynthOpenMtmEur,
            }
          : null;
      }
      let last: SimLoopSynthMaturationPoint | null = null;
      for (const pt of sorted) {
        if (pt.at > at) break;
        last = pt;
      }
      return last
        ? {
            closed: last.simLoopSynthClosedPnlEur,
            open: last.simLoopSynthOpenMtmEur,
          }
        : null;
    };
  }, [simLoopWeightedSeries]);

  const chartData = useMemo((): MaturationChartPoint[] => {
    const baselineByAt = new Map(
      (compareSeries ?? []).map((p) => [p.at, p.totalPnlEur]),
    );
    const toDayKey = (iso: string) => iso.slice(0, 10);

    const actualClosedSorted = [
      ...(actualPortfolioSeries?.closed ?? []),
    ].sort((a, b) => a.at.localeCompare(b.at));
    const actualOpenSorted = [
      ...(actualPortfolioSeries?.open ?? []),
    ].sort((a, b) => a.at.localeCompare(b.at));

    /**
     * Forward-fill an actual-portfolio series onto the sim-tick day axis.
     * For each tick day we use the last actual-portfolio value strictly
     * ≤ the tick day so that the actual curve doesn't disappear on days
     * the ledger didn't record (e.g. weekends).
     */
    const getActualValue = (
      sorted: Array<{ at: string; totalPnlEur: number }>,
      dayKey: string,
    ): number | null => {
      if (!sorted.length) return null;
      let lastValue: number | null = null;
      for (const entry of sorted) {
        if (entry.at <= dayKey) {
          lastValue = entry.totalPnlEur;
        } else {
          break;
        }
      }
      return lastValue;
    };

    return preparePaperMaturationChartData(series).map((p) => {
      const dayKey = toDayKey(p.at);
      const synth = simLoopSynthLookup?.(p.at, p.isLive);
      const weight = simLoopWeightLookup?.(p.at, p.isLive);
      return {
        ...p,
        closedPnlEur: clampMaturationChartValue(p.closedPnlEur) ?? p.closedPnlEur,
        openMtmEur: clampMaturationChartValue(p.openMtmEur) ?? p.openMtmEur,
        baselineTotalPnlEur: clampMaturationChartValue(baselineByAt.get(p.at) ?? null),
        actualPortfolioClosedPnlEur: clampMaturationChartValue(
          getActualValue(actualClosedSorted, dayKey),
        ),
        actualPortfolioOpenPnlEur: clampMaturationChartValue(
          getActualValue(actualOpenSorted, dayKey),
        ),
        simLoopSynthClosedPnlEur: clampMaturationChartValue(synth?.closed ?? null),
        simLoopSynthOpenMtmEur: clampMaturationChartValue(synth?.open ?? null),
        simLoopWeightClosedPnlEur: clampMaturationChartValue(weight?.closed ?? null),
        simLoopWeightOpenMtmEur: clampMaturationChartValue(weight?.open ?? null),
      };
    });
  }, [series, compareSeries, actualPortfolioSeries, simLoopSynthLookup, simLoopWeightLookup]);

  const overview = useMemo(
    () =>
      buildMaturationOverview({
        ledger: portfolioLedger,
        simTable,
        livePiggy,
        paperPortfolio,
        liveEvaluations,
        ticks,
        synthLatest:
          simLoopSynthSeries?.length && simLoopSynthSeries.length > 0
            ? {
                closedPnlEur:
                  simLoopSynthSeries[simLoopSynthSeries.length - 1]!.simLoopSynthClosedPnlEur,
                openMtmEur:
                  simLoopSynthSeries[simLoopSynthSeries.length - 1]!.simLoopSynthOpenMtmEur,
              }
            : null,
        synthSizing,
      }),
    [
      portfolioLedger,
      simTable,
      livePiggy,
      paperPortfolio,
      liveEvaluations,
      ticks,
      simLoopSynthSeries,
      synthSizing,
    ],
  );

  const hasPortfolio = overview.some((g) => g.id === "actual");
  const hasSynth = overview.some((g) => g.id === "simSynth");
  const hasWeight = Boolean(simLoopWeightedSeries?.length);

  const activeCurves = useMemo(() => {
    return MATURATION_CURVE_DEFS.filter((c) => {
      if (c.group === "portfolio") return hasPortfolio;
      if (c.group === "synth") return hasSynth;
      if (c.group === "weight") return hasWeight;
      if (c.group === "baseline") return raWhatIfActive;
      return true;
    });
  }, [hasPortfolio, hasSynth, hasWeight, raWhatIfActive]);

  const [visibleCurves, setVisibleCurves] = useState(DEFAULT_VISIBLE_CURVES);

  const exclusiveSizingMode = onSizingVariantChange != null;

  useEffect(() => {
    if (exclusiveSizingMode) {
      setVisibleCurves((prev) => ({
        ...prev,
        simClosed: sizingVariant === "equal",
        simOpen: sizingVariant === "equal",
        weightClosed: sizingVariant === "weight" && hasWeight,
        weightOpen: sizingVariant === "weight" && hasWeight,
        synthClosed: sizingVariant === "synth" && hasSynth,
        synthOpen: sizingVariant === "synth" && hasSynth,
      }));
      return;
    }
    // Dashboard / multi-curve: equal + synth together (subtitle promises both).
    setVisibleCurves((prev) => ({
      ...prev,
      simClosed: true,
      simOpen: true,
      synthClosed: hasSynth,
      synthOpen: hasSynth,
      weightClosed: false,
      weightOpen: false,
    }));
  }, [sizingVariant, exclusiveSizingMode, hasSynth, hasWeight]);

  const toggleCurve = (key: MaturationCurveKey) => {
    setVisibleCurves((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleGroup = (group: "portfolio" | "sim" | "synth" | "weight") => {
    const keys = activeCurves.filter((c) => c.group === group).map((c) => c.key);
    if (keys.length === 0) return;
    setVisibleCurves((prev) => {
      const allOn = keys.every((k) => prev[k]);
      const next = { ...prev };
      for (const k of keys) next[k] = !allOn;
      return next;
    });
  };

  const showAllCurves = () => {
    setVisibleCurves((prev) => {
      const next = { ...prev };
      for (const c of activeCurves) next[c.key] = true;
      return next;
    });
  };

  const yDomain = useMemo(
    () =>
      computeMaturationChartYDomain(
        chartData.flatMap((p) =>
          activeCurves
            .filter((c) => visibleCurves[c.key])
            .map((c) => c.yValue(p)),
        ),
      ),
    [chartData, activeCurves, visibleCurves],
  );

  const xTickIndices = useMemo(() => maturationChartTickIndices(chartData.length), [chartData.length]);

  const sellMarkers = useMemo(
    () => chartData.filter((p) => p.sellTicker != null && p.sellPnlEur != null),
    [chartData],
  );

  if (chartData.length < 1) {
    return (
      <div
        className={`tester-monitor-panel rounded-xl flex items-center justify-center ${compact ? "p-2 min-h-[120px]" : "p-3 min-h-[160px]"} ${className ?? ""}`}
      >
        <p className="tester-monitor-muted text-[10px] text-center leading-relaxed px-2">
          {t("testerMonitor.decisionSim.chart.maturationEmpty")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`tester-monitor-panel rounded-xl flex flex-col min-w-0 ${compact ? "p-2 space-y-1" : "p-3 space-y-1.5"} ${className ?? ""}`}
    >
      <div className="shrink-0 min-w-0 flex flex-wrap items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <p className={`tester-monitor-text font-semibold truncate ${compact ? "text-[10px]" : "text-[11px]"}`}>
            {raWhatIfActive
              ? t("testerMonitor.decisionSim.chart.maturationTitleRa")
              : t("testerMonitor.decisionSim.chart.maturationTitle")}
          </p>
          {!compact ? (
            <p className="tester-monitor-muted text-[10px] mt-0.5 leading-snug">
              {t("testerMonitor.decisionSim.chart.maturationSub")}
            </p>
          ) : null}
        </div>
        {onSizingVariantChange ? (
          <SimLoopSizingVariantToggle
            value={sizingVariant}
            onChange={onSizingVariantChange}
            compact
          />
        ) : null}
      </div>

      <MaturationCurveToolbar
        curves={activeCurves}
        visible={visibleCurves}
        onToggleCurve={toggleCurve}
        onToggleGroup={toggleGroup}
        onShowAll={showAllCurves}
        it={it}
      />

      {/* Chart wrapper: ALWAYS pinned to an explicit pixel height so Recharts'
          ResponsiveContainer has a finite vertical extent to draw against.
          We previously relied on `flex-1 + h-full` to inherit the parent
          height, but inside containers that don't propagate an explicit
          height down the flex chain (e.g. the dashboard's ChartCard whose
          grandparent isn't a flex column) that resolved to 0px and only
          the title + legend remained visible. The inline `height` plus
          matching `minHeight` makes the rendering deterministic in every
          host layout. */}
      <div
        className="w-full min-w-0"
        style={{ height: chartHeight, minHeight: chartHeight }}
      >
        <ResponsiveContainer width="100%" height={chartHeight}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="xIdx"
              type="number"
              domain={[0, Math.max(0, chartData.length - 1)]}
              ticks={xTickIndices}
              tick={{ fontSize: 8 }}
              tickFormatter={(idx) => chartData[Number(idx)]?.xShort ?? ""}
              tickLine={false}
              axisLine={false}
              height={18}
              padding={{ left: 8, right: 8 }}
            />
            <YAxis
              tick={{ fontSize: 8 }}
              tickFormatter={(v) => fmtAxisEur(v)}
              width={48}
              tickLine={false}
              axisLine={false}
              domain={yDomain}
            />
            <Tooltip content={<MaturationTooltip it={it} />} />
            {activeCurves.map((c) => {
              if (!visibleCurves[c.key]) return null;
              return (
                <Line
                  key={c.key}
                  type={c.group === "synth" || c.group === "baseline" ? "monotone" : "linear"}
                  dataKey={c.dataKey}
                  stroke={c.color}
                  strokeWidth={c.dashed ? 1.5 : 2}
                  strokeDasharray={c.dashed ? (c.key === "baseline" ? "5 4" : c.group === "portfolio" ? "6 3" : c.group === "synth" ? "3 2" : "4 3") : undefined}
                  dot={false}
                  connectNulls
                  name={it ? c.labelIt : c.labelEn}
                />
              );
            })}
            {visibleCurves.simClosed
              ? sellMarkers.map((p) => (
                  <ReferenceDot
                    key={`${p.at}-${p.sellTicker}`}
                    x={p.xIdx}
                    y={p.closedPnlEur}
                    r={4}
                    fill={p.sellPnlEur != null && p.sellPnlEur >= 0 ? "#22c55e" : "#ef4444"}
                    stroke="#fff"
                    strokeWidth={1}
                  />
                ))
              : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {overview.length > 0 ? (
        <div
          className={`grid gap-1.5 shrink-0 ${
            overview.length >= 3
              ? "grid-cols-1 sm:grid-cols-3"
              : overview.length === 2
                ? "grid-cols-1 sm:grid-cols-2"
                : "grid-cols-1"
          }`}
        >
          {overview.map((group) => (
            <MaturationGroupSummary key={group.id} group={group} it={it} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
