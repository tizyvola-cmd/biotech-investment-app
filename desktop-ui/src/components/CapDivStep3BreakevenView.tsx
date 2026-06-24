import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { CapitalNumberInput } from "./CapitalNumberInput";
import { extractTradeStatsFromClosedOutcomes } from "../sheet/portfolioDiversificationLab";
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import { loadFrozenWeights } from "../calibration/proposalStore";
import { evaluateWeightedSizingGate } from "../calibration/weightedSizingGate";
import { computeSdsGainBreakdown } from "../sheet/sdsGainBreakdown";
import {
  computeApprovedWeightShares,
} from "../sheet/approvedWeightPortfolioShares";
import { buildThreePortfolioComparison, type ComparisonDeal } from "../sheet/threePortfolioCompare";
import {
  runManualAllocationSynthesizerBundle,
  type ManualAllocationSynthesizerBundle,
} from "../sheet/manualAllocationPatternSynthesizer";
import { WeightSimExpPanel } from "./WeightSimExpPanel";
import {
  optimizeWeightSimExp,
  type WeightSimExpResult,
} from "../sheet/weightSimExpOptimizer";
import {
  DEFAULT_CONFIDENCE_MULTIPLIERS,
  DEFAULT_WEIGHTED_SIZING_CONFIG,
  computeWeightedPortfolioStats,
  type DealSizingBreakdown,
} from "../sheet/portfolioWeightedSizing";
import { loadApprovedPattern } from "../riskPattern/patternProposalStore";
import {
  extractAllRowFeatures,
  runUnivariateScreening,
} from "../riskPattern/lossRiskScreening";
import { matchPattern } from "../riskPattern/lossRiskPattern";
import { useLang, useT } from "../shared/i18n";
import { WeightedSizingGateBanner } from "./WeightedSizingGateBanner";

export function CapDivStep3BreakevenView({
  closedRows,
  simTable,
  sdsRows,
  investInputs,
  pointsBySeriesKey,
  topCapital,
  patternStoreVersion,
  onPatternChanged,
  frozenWeightsTick = 0,
}: {
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  /** Live portfolio inputs (capital/buyPrice) â€” needed by suggestion monitor
   * to compute BUY/HOLD eligibility and per-row probPct. Wired so this chart
   * can use the SAME calibrated win rates as the slider widget above. */
  investInputs?: InvestSimInputs;
  /** Chart points per series key â€” required by buildSuggestionMonitorRows. */
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
  /** Capital pot from the top-of-page widget â€” used as the default target
   * spending the user is trying to cover, and to scale the chart X axis. */
  topCapital: number;
  /** Bumped by parent when the approved pattern changes â€” forces memo refresh. */
  patternStoreVersion: number;
  /** Bumped when user approves a synthesized pattern from this step. */
  onPatternChanged?: () => void;
  /** Bumped when Learning Lab approves frozen weights (shared with parent). */
  frozenWeightsTick?: number;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  const stats = useMemo(
    () => extractTradeStatsFromClosedOutcomes(closedRows),
    [closedRows],
  );

  /** Local override for the total capital pot. `null` means "use the parent's
   *  `topCapital` value" (the global pot from the top-of-page widget). When
   *  the user types a number into the on-chart input we store it here and
   *  every derived computation in this view (allocations, breakeven curves,
   *  X-axis range, manual sliders' â‚¬ display) recomputes against it â€” so the
   *  user can play "what if I had X â‚¬ instead?" without touching the global
   *  capital that the rest of the app uses. */
  const [capitalOverride, setCapitalOverride] = useState<number | null>(null);

  /** Effective capital pot used everywhere in this component. */
  const effectiveCapital =
    capitalOverride != null && capitalOverride > 0 ? capitalOverride : topCapital;

  /** Spending the user wants to cover ("la spesa") within the 24h horizon.
   *  Auto-default = effective capital Ã— 0.5 % (a small daily target so the
   *  breakeven reference line lands inside the chart range â€” over the
   *  catalyst horizon a similar 2 % target was used; on 24h âˆš-time scaling
   *  shrinks the natural daily move accordingly). User can override via
   *  the on-chart input; `null` means "use the auto-default". */
  const [targetEurOverride, setTargetEurOverride] = useState<number | null>(null);
  const targetEur =
    targetEurOverride != null && targetEurOverride > 0
      ? targetEurOverride
      : Math.max(50, Math.round(effectiveCapital * 0.005));

  /** Step 2 approved risk pattern â€” feeds the pattern matcher used by the
   *  weighted-sizing module below. `null` when no pattern has been approved
   *  yet, in which case `patternPenalty` stays at 1.0 for every deal. */
  const approvedPattern = useMemo(() => {
    return loadApprovedPattern().current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternStoreVersion]);

  // â”€â”€ New "Expected cumulative gain vs capital invested" chart inputs â”€â”€
  // The chart compares the user's REAL portfolio (open positions) against the
  // SIM LOOP BUY universe, both built from the same `buildThreePortfolioComparison`
  // pipeline that powers every other risk-aware surface in the app. This
  // guarantees that every win rate / payoff / pattern-match decision shown on
  // the chart is the same number the rest of the system sees â€” no local
  // recomputation.
  /** Inspectable per-deal table starts collapsed; expand to audit weighting. */
  const [showSizingBreakdown, setShowSizingBreakdown] = useState(false);

  // â”€â”€ Curve visibility filter â”€â”€
  // Lets the user pick what is rendered on the breakeven chart: each curve
  // can be toggled individually and three quick-action buttons act as group
  // filters ("Only portfolio" / "Only sim loop" / "All").
  const [visibleCurves, setVisibleCurves] = useState<
    Record<
      | "portfolioUniform"
      | "portfolioWeighted"
      | "portfolioWeightSimExp"
      | "simLoopUniform"
      | "simLoopWeighted"
      | "simLoopWeightSimExp",
      boolean
    >
  >({
    portfolioUniform: true,
    portfolioWeighted: true,
    portfolioWeightSimExp: true,
    simLoopUniform: true,
    simLoopWeighted: true,
    simLoopWeightSimExp: true,
  });

  const calibrationSnapshot = useMemo(() => {
    try {
      return computeCalibrationSnapshot(closedRows, { simTable, sdsRows: sdsRows ?? undefined });
    } catch {
      return null;
    }
  }, [closedRows, simTable, sdsRows]);

  const weightedGate = useMemo(
    () => evaluateWeightedSizingGate(calibrationSnapshot),
    [calibrationSnapshot],
  );

  useEffect(() => {
    if (weightedGate.ok) return;
    setVisibleCurves((prev) => ({
      ...prev,
      portfolioWeighted: false,
      simLoopWeighted: false,
    }));
  }, [weightedGate.ok]);

  const sdsBreakdown = useMemo(
    () => computeSdsGainBreakdown(closedRows, { simTable, sdsRows: sdsRows ?? undefined }),
    [closedRows, simTable, sdsRows],
  );

  const phaseA = useMemo(() => {
    try {
      return runUnivariateScreening(closedRows, {
        simTable,
        sdsRows: sdsRows ?? undefined,
      });
    } catch {
      return null;
    }
  }, [closedRows, simTable, sdsRows]);

  const comparison = useMemo(() => {
    if (!simTable?.rows?.length) return null;
    try {
      return buildThreePortfolioComparison({
        closedRows,
        simTable,
        sdsRows: sdsRows ?? null,
        inputs: investInputs,
        pointsBySeriesKey,
        lang,
        calibrationSnapshot,
        sdsBreakdown,
        totalCapitalEur: effectiveCapital > 0 ? effectiveCapital : 100_000,
        phaseA,
        approvedPattern,
      });
    } catch {
      return null;
    }
  }, [
    closedRows,
    simTable,
    sdsRows,
    investInputs,
    pointsBySeriesKey,
    lang,
    calibrationSnapshot,
    sdsBreakdown,
    effectiveCapital,
    phaseA,
    approvedPattern,
  ]);

  /**
   * Local aliases for the two universes â€” kept under their original
   * `*Deals24h` names so the rest of the file is unchanged after the
   * probability-curve refactor. The cumulative-gain time-series chart below
   * uses `realizedReturnPct24h` directly (a true 24h move from the data)
   * so no winRate/payoff scaling is needed here anymore.
   */
  const mineDeals24h = useMemo<ComparisonDeal[]>(
    () => comparison?.mineDeals ?? [],
    [comparison?.mineDeals],
  );
  const simLoopDeals24h = useMemo<ComparisonDeal[]>(
    () => comparison?.simLoopDeals ?? [],
    [comparison?.simLoopDeals],
  );

  // Pre-build the matcher once so the weighted-sizing module receives a stable
  // callback. When no pattern is approved, the matcher always returns false â€”
  // patternPenalty stays neutral (1.0) and the curve reduces to a pure
  // EV Ã— confidence weighting. (Brief: "Se il pattern di Step 2 non Ã¨ ancora
  // implementato [â€¦], patternPenalty puÃ² restare fisso a 1.0".)
  const patternMatchByRowKey = useMemo(() => {
    const map = new Map<string, boolean>();
    if (!approvedPattern || !comparison) return map;
    try {
      const features = extractAllRowFeatures(closedRows, { simTable, sdsRows });
      for (const d of comparison.allDeals) {
        // Same lookup heuristic used by the legacy pattern filter above:
        // features keys start with `${TICKER}|â€¦`.
        const fk = Array.from(features.keys()).find((k) =>
          k.startsWith(`${d.ticker.toUpperCase()}|`),
        );
        if (!fk) continue;
        const fc = features.get(fk);
        if (!fc) continue;
        map.set(d.rowKey, matchPattern(approvedPattern, fc));
      }
    } catch {
      /* swallow â€” empty map keeps every deal at patternPenalty=1.0 */
    }
    return map;
  }, [approvedPattern, comparison, closedRows, simTable, sdsRows]);

  const matchesStep2Pattern = useMemo(
    () => (deal: ComparisonDeal) => patternMatchByRowKey.get(deal.rowKey) === true,
    [patternMatchByRowKey],
  );

  const frozenWeights = useMemo(
    () => loadFrozenWeights(),
    [frozenWeightsTick, patternStoreVersion],
  );

  /** Live EVÃ—confidence breakdown â€” diagnostic table only; curves use approved weights. */
  const portfolioStatsWeighted = useMemo(
    () =>
      computeWeightedPortfolioStats(
        mineDeals24h,
        DEFAULT_WEIGHTED_SIZING_CONFIG,
        matchesStep2Pattern,
      ),
    [mineDeals24h, matchesStep2Pattern],
  );

  /** Weighted version of the sim-loop universe so the chart is symmetric:
   *  uniform vs weighted for BOTH the real portfolio and the sim-loop pool.
   *  The pattern matcher is the same as the portfolio side â€” Step 2 risk
   *  pattern penalises every deal that matches, regardless of where it sits.
   *  Same 24h-scaled deals used by every other curve below â€” keeps the
   *  weighting consistent with the horizon being plotted. */
  const simLoopStatsWeighted = useMemo(
    () =>
      computeWeightedPortfolioStats(
        simLoopDeals24h,
        DEFAULT_WEIGHTED_SIZING_CONFIG,
        matchesStep2Pattern,
      ),
    [simLoopDeals24h, matchesStep2Pattern],
  );

  /** Baseline mix from Learning Lab approved weights (sizingRules multipliers). */
  const portfolioApprovedShares = useMemo(
    () => computeApprovedWeightShares(mineDeals24h, frozenWeights, matchesStep2Pattern),
    [mineDeals24h, frozenWeights, matchesStep2Pattern],
  );
  const simLoopApprovedShares = useMemo(
    () => computeApprovedWeightShares(simLoopDeals24h, frozenWeights, matchesStep2Pattern),
    [simLoopDeals24h, frozenWeights, matchesStep2Pattern],
  );

  /** Per-universe size shares (length === deal count, sum â‰ˆ 1). Approved weights
   *  are the production baseline for weighted + synthesizer curves. */
  const portfolioWeightedShares = portfolioApprovedShares;
  const simLoopWeightedShares = simLoopApprovedShares;

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Time-series cumulative gain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Chronological cumulative-gain model (replaces the previous capital-vs-
   * probability curves at the user's request).
   *
   * For each scenario (Portfolio Ã— {uniform, weighted, manual} and Sim loop Ã—
   * the same), we walk the union of all deal entry events in chronological
   * order and accumulate per-deal realised 24h gain expressed in â‚¬:
   *
   *   gainContribution = share_scenario(deal) Ã— effectiveCapital Ã—
   *                       realizedReturnPct24h(deal) / 100
   *
   * `share_scenario(deal)` reads the weight that the scenario assigns to
   * that deal once the FULL universe is funded â€” same numbers feeding the
   * KPI cards and the per-deal breakdown table below. Each scenario sums
   * only its own deals (a portfolio scenario only contributes when one of
   * the user's open positions enters the chronology; a sim loop scenario
   * only contributes for sim-loop deals), so deals shared across both
   * universes naturally land on both curves at the same X step.
   */
  const entryDateForDeal = useMemo(
    () =>
      (deal: ComparisonDeal): string => {
        const entry = investInputs?.[deal.rowKey];
        if (entry?.purchaseDate) return entry.purchaseDate;
        if (entry?.investedAt) return entry.investedAt.slice(0, 10);
        const cd = deal.rowKey.split("|")[1];
        if (cd && cd !== "â€”") return cd;
        return "9999-12-31";
      },
    [investInputs],
  );

  /**
   * Single chronologically-sorted list of unique deal events drawn from the
   * union of the two universes â€” every entry is one (date, ticker, rowKey)
   * tuple deduped across the two universes so a deal that lives in both
   * portfolio AND sim loop produces one X step (not two).
   */
  const chronologicalEvents = useMemo(() => {
    if (!comparison) return [] as Array<{ date: string; ticker: string; rowKey: string }>;
    const events: Array<{ date: string; ticker: string; rowKey: string }> = [];
    const seen = new Set<string>();
    const push = (d: ComparisonDeal) => {
      if (seen.has(d.rowKey)) return;
      seen.add(d.rowKey);
      events.push({ date: entryDateForDeal(d), ticker: d.ticker, rowKey: d.rowKey });
    };
    comparison.mineDeals.forEach(push);
    comparison.simLoopDeals.forEach(push);
    events.sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      return cmp !== 0 ? cmp : a.ticker.localeCompare(b.ticker);
    });
    return events;
  }, [comparison, entryDateForDeal]);

  /**
   * Realised 24h move per ticker, sourced from `ComparisonDeal.realizedReturnPct24h`.
   * Falls back to the slower `realizedReturnPct` (all-time MTM) when 24h is
   * not yet populated (e.g. brand-new position with no daily snapshot yet),
   * and finally to 0 % when nothing is available.
   */
  const moveByRowKey = useMemo(() => {
    const m = new Map<string, number>();
    const consider = (d: ComparisonDeal) => {
      if (m.has(d.rowKey)) return;
      const move =
        d.realizedReturnPct24h != null && Number.isFinite(d.realizedReturnPct24h)
          ? d.realizedReturnPct24h
          : d.realizedReturnPct != null && Number.isFinite(d.realizedReturnPct)
            ? d.realizedReturnPct
            : 0;
      m.set(d.rowKey, move);
    };
    (comparison?.mineDeals ?? []).forEach(consider);
    (comparison?.simLoopDeals ?? []).forEach(consider);
    return m;
  }, [comparison]);

  /** Weight Sim Exp â€” mix that maximises cumulative 24h gain vs chart target. */
  const portfolioWeightSimExp = useMemo<WeightSimExpResult | null>(() => {
    if (mineDeals24h.length === 0 || effectiveCapital <= 0) return null;
    return optimizeWeightSimExp(
      mineDeals24h.map((d, i) => ({
        rowKey: d.rowKey,
        ticker: d.ticker,
        movePct24h: moveByRowKey.get(d.rowKey) ?? 0,
        baselineShare: portfolioWeightedShares[i] ?? 0,
      })),
      effectiveCapital,
      targetEur,
    );
  }, [mineDeals24h, effectiveCapital, targetEur, moveByRowKey, portfolioWeightedShares]);

  const simLoopWeightSimExp = useMemo<WeightSimExpResult | null>(() => {
    if (simLoopDeals24h.length === 0 || effectiveCapital <= 0) return null;
    return optimizeWeightSimExp(
      simLoopDeals24h.map((d, i) => ({
        rowKey: d.rowKey,
        ticker: d.ticker,
        movePct24h: moveByRowKey.get(d.rowKey) ?? 0,
        baselineShare: simLoopWeightedShares[i] ?? 0,
      })),
      effectiveCapital,
      targetEur,
    );
  }, [simLoopDeals24h, effectiveCapital, targetEur, moveByRowKey, simLoopWeightedShares]);

  const weightSimExpSynthBundle = useMemo<ManualAllocationSynthesizerBundle>(() => {
    const toDeals = (
      deals: ComparisonDeal[],
      baseline: number[],
      exp: WeightSimExpResult | null,
    ) => {
      if (!exp || deals.length === 0) return null;
      return deals.map((d, i) => ({
        rowKey: d.rowKey,
        ticker: d.ticker,
        baselineShare: baseline[i] ?? 0,
        manualShare: exp.shares[i] ?? 0,
        userAdjusted:
          Math.abs((exp.shares[i] ?? 0) - (baseline[i] ?? 0)) > 0.005,
        cells: d.cells as Record<string, string>,
      }));
    };

    return {
      portfolio:
        portfolioWeightSimExp && mineDeals24h.length > 0
          ? {
              universe: "portfolio" as const,
              enabled: true,
              deals: toDeals(
                mineDeals24h,
                portfolioWeightedShares,
                portfolioWeightSimExp,
              )!,
            }
          : null,
      simLoop:
        simLoopWeightSimExp && simLoopDeals24h.length > 0
          ? {
              universe: "simLoop" as const,
              enabled: true,
              deals: toDeals(
                simLoopDeals24h,
                simLoopWeightedShares,
                simLoopWeightSimExp,
              )!,
            }
          : null,
    };
  }, [
    portfolioWeightSimExp,
    simLoopWeightSimExp,
    mineDeals24h,
    simLoopDeals24h,
    portfolioWeightedShares,
    simLoopWeightedShares,
  ]);

  const weightSimExpSynthOutcomes = useMemo(
    () =>
      runManualAllocationSynthesizerBundle(weightSimExpSynthBundle, {
        simTable,
        sdsRows,
        closedRows,
        phaseA,
      }),
    [weightSimExpSynthBundle, simTable, sdsRows, closedRows, phaseA],
  );

  /** When Weight Sim Exp is active, show weighted + exp curves on the chart for comparison. */
  useEffect(() => {
    if (!portfolioWeightSimExp && !simLoopWeightSimExp) return;
    setVisibleCurves((prev) => ({
      ...prev,
      portfolioWeightSimExp: true,
      simLoopWeightSimExp: true,
      ...(weightedGate.ok
        ? { portfolioWeighted: true, simLoopWeighted: true }
        : {}),
    }));
  }, [portfolioWeightSimExp, simLoopWeightSimExp, weightedGate.ok, targetEur]);

  /**
   * Per-scenario share map keyed by `rowKey`, so the chronological walker
   * below can look the share up without re-aligning indices. Uniform shares
   * are constant 1/N within the universe; weighted/manual shares are pulled
   * from the already-computed share arrays (kept aligned to `mineDeals24h`
   * / `simLoopDeals24h`).
   */
  const portfolioSharesByRowKey = useMemo(() => {
    const uniform = new Map<string, number>();
    const weighted = new Map<string, number>();
    const weightSimExp = new Map<string, number>();
    const n = mineDeals24h.length;
    const uniformShare = n > 0 ? 1 / n : 0;
    mineDeals24h.forEach((d, i) => {
      uniform.set(d.rowKey, uniformShare);
      weighted.set(d.rowKey, portfolioWeightedShares[i] ?? 0);
      weightSimExp.set(d.rowKey, portfolioWeightSimExp?.shares[i] ?? 0);
    });
    return { uniform, weighted, weightSimExp };
  }, [mineDeals24h, portfolioWeightedShares, portfolioWeightSimExp]);

  const simLoopSharesByRowKey = useMemo(() => {
    const uniform = new Map<string, number>();
    const weighted = new Map<string, number>();
    const weightSimExp = new Map<string, number>();
    const n = simLoopDeals24h.length;
    const uniformShare = n > 0 ? 1 / n : 0;
    simLoopDeals24h.forEach((d, i) => {
      uniform.set(d.rowKey, uniformShare);
      weighted.set(d.rowKey, simLoopWeightedShares[i] ?? 0);
      weightSimExp.set(d.rowKey, simLoopWeightSimExp?.shares[i] ?? 0);
    });
    return { uniform, weighted, weightSimExp };
  }, [simLoopDeals24h, simLoopWeightedShares, simLoopWeightSimExp]);

  /**
   * One row per chronological X step. Each row carries the running
   * cumulative gain â‚¬ for all six scenarios. `idx = 0` is the "Start"
   * sentinel point at â‚¬0 â€” the curves grow from there as deals enter the
   * book in time order. The chart consumes this directly via `dataKey`.
   */
  const cumulativeGainSeries = useMemo(() => {
    const portfolioRowKeys = new Set<string>(
      (comparison?.mineDeals ?? []).map((d) => d.rowKey),
    );
    const simLoopRowKeys = new Set<string>(
      (comparison?.simLoopDeals ?? []).map((d) => d.rowKey),
    );
    let pUniformCum = 0;
    let pWeightedCum = 0;
    let pWeightSimExpCum = 0;
    let sUniformCum = 0;
    let sWeightedCum = 0;
    let sWeightSimExpCum = 0;
    const rows: Array<{
      idx: number;
      date: string;
      label: string;
      portfolioUniformEur: number;
      portfolioWeightedEur: number;
      portfolioWeightSimExpEur: number;
      simLoopUniformEur: number;
      simLoopWeightedEur: number;
      simLoopWeightSimExpEur: number;
    }> = [
      {
        idx: 0,
        date: "",
        label: it ? "Start" : "Start",
        portfolioUniformEur: 0,
        portfolioWeightedEur: 0,
        portfolioWeightSimExpEur: 0,
        simLoopUniformEur: 0,
        simLoopWeightedEur: 0,
        simLoopWeightSimExpEur: 0,
      },
    ];
    chronologicalEvents.forEach((event, i) => {
      const movePct = moveByRowKey.get(event.rowKey) ?? 0;
      if (portfolioRowKeys.has(event.rowKey)) {
        pUniformCum +=
          (portfolioSharesByRowKey.uniform.get(event.rowKey) ?? 0) *
          effectiveCapital *
          (movePct / 100);
        pWeightedCum +=
          (portfolioSharesByRowKey.weighted.get(event.rowKey) ?? 0) *
          effectiveCapital *
          (movePct / 100);
        pWeightSimExpCum +=
          (portfolioSharesByRowKey.weightSimExp.get(event.rowKey) ?? 0) *
          effectiveCapital *
          (movePct / 100);
      }
      if (simLoopRowKeys.has(event.rowKey)) {
        sUniformCum +=
          (simLoopSharesByRowKey.uniform.get(event.rowKey) ?? 0) *
          effectiveCapital *
          (movePct / 100);
        sWeightedCum +=
          (simLoopSharesByRowKey.weighted.get(event.rowKey) ?? 0) *
          effectiveCapital *
          (movePct / 100);
        sWeightSimExpCum +=
          (simLoopSharesByRowKey.weightSimExp.get(event.rowKey) ?? 0) *
          effectiveCapital *
          (movePct / 100);
      }
      rows.push({
        idx: i + 1,
        date: event.date,
        label: event.ticker,
        portfolioUniformEur: pUniformCum,
        portfolioWeightedEur: pWeightedCum,
        portfolioWeightSimExpEur: pWeightSimExpCum,
        simLoopUniformEur: sUniformCum,
        simLoopWeightedEur: sWeightedCum,
        simLoopWeightSimExpEur: sWeightSimExpCum,
      });
    });
    return rows;
  }, [
    chronologicalEvents,
    comparison,
    portfolioSharesByRowKey,
    simLoopSharesByRowKey,
    moveByRowKey,
    effectiveCapital,
    it,
  ]);

  /**
   * X index of "today" â€” first event whose entry date is on or after the
   * user's current calendar day. Falls back to the last index when every
   * deal is in the past (no "future" steps to highlight). Used to draw the
   * vertical OGGI line on the chart.
   */
  const todayIdx = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 0; i < cumulativeGainSeries.length; i++) {
      const d = cumulativeGainSeries[i].date;
      if (d && d >= today) return i;
    }
    return cumulativeGainSeries.length - 1;
  }, [cumulativeGainSeries]);

  /** Convenience: last (= "final after every deal funded") cumulative gain
   *  per scenario â€” drives the KPI cards below without re-walking the
   *  series in each cell. */
  const finalGains = useMemo(() => {
    const last = cumulativeGainSeries[cumulativeGainSeries.length - 1];
    return {
      portfolioUniform: last?.portfolioUniformEur ?? 0,
      portfolioWeighted: last?.portfolioWeightedEur ?? 0,
      portfolioWeightSimExp: last?.portfolioWeightSimExpEur ?? 0,
      simLoopUniform: last?.simLoopUniformEur ?? 0,
      simLoopWeighted: last?.simLoopWeightedEur ?? 0,
      simLoopWeightSimExp: last?.simLoopWeightSimExpEur ?? 0,
    };
  }, [cumulativeGainSeries]);

  /** Y-axis padded domain so the breakeven line at â‚¬0 and the target line
   *  at +targetEur are both always visible, even when every scenario is
   *  deep in profit / loss. */
  const gainYDomain = useMemo<[number, number]>(() => {
    const candidates: number[] = [0, targetEur];
    cumulativeGainSeries.forEach((r) => {
      candidates.push(
        r.portfolioUniformEur,
        r.portfolioWeightedEur,
        r.portfolioWeightSimExpEur,
        r.simLoopUniformEur,
        r.simLoopWeightedEur,
        r.simLoopWeightSimExpEur,
      );
    });
    const min = Math.min(...candidates);
    const max = Math.max(...candidates);
    const pad = Math.max(50, (max - min) * 0.08);
    return [Math.floor((min - pad) / 50) * 50, Math.ceil((max + pad) / 50) * 50];
  }, [cumulativeGainSeries, targetEur]);

  /** Use the weighted breakdown as the primary inspection target â€” uniform
   *  is trivial (all sizes equal). When the weighted sizing falls back to
   *  uniform (no positive-EV deals), the two breakdowns coincide. */
  const portfolioStatsForBreakdown = portfolioStatsWeighted;

  /** Mean calibrated P(win) per open-book universe â€” NOT realized closed success.
   *  Each deal's winRate comes from Calibration Center shrinkage (historical
   *  closed trades by bucket). The "(N deals)" count is open positions / BUY
   *  rows, not closed round-trips. Compare with `stats` below for realized
   *  closed P&L success (same as Dashboard "Closed P&L success"). */
  const portfolioMeanWinRate = useMemo(() => {
    if (mineDeals24h.length === 0) return null;
    const sum = mineDeals24h.reduce((s, d) => s + d.winRate, 0);
    return sum / mineDeals24h.length;
  }, [mineDeals24h]);
  const simLoopMeanWinRate = useMemo(() => {
    if (simLoopDeals24h.length === 0) return null;
    const sum = simLoopDeals24h.reduce((s, d) => s + d.winRate, 0);
    return sum / simLoopDeals24h.length;
  }, [simLoopDeals24h]);

  if (!stats) {
    return (
      <section className="rounded-2xl border border-teal-200/60 dark:border-teal-800/40 bg-gradient-to-br from-teal-50/40 via-white to-emerald-50/30 px-4 py-4">
        <p className="text-sm text-ink-muted">{t("modelLab.diversify.empty")}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-teal-200/60 dark:border-teal-800/40 bg-gradient-to-br from-teal-50/40 via-white to-emerald-50/30 dark:from-teal-950/15 dark:via-surface dark:to-emerald-950/15 px-4 py-4 space-y-4">
      {/* Header */}
      <header className="flex items-start gap-3">
        <div className="shrink-0 w-9 h-9 rounded-lg bg-teal-500/15 dark:bg-teal-400/20 flex items-center justify-center text-teal-700 dark:text-teal-200 font-bold">
          3
        </div>
        <div>
          <h2 className="text-base font-semibold text-teal-900 dark:text-teal-100">
            {it
              ? "Step 3 â€” Gain cumulato vs tempo (breakeven a â‚¬0)"
              : "Step 3 â€” Cumulative gain vs time (breakeven at â‚¬0)"}
          </h2>
          <p className="text-[11px] leading-relaxed text-teal-800/75 dark:text-teal-200/75 max-w-3xl">
            {it
              ? "Dato il gain medio (Step 1) e il pattern di rischio (Step 2), come si accumula il P&L 24h del portafoglio man mano che i deal entrano nel book? Il grafico confronta quattro allocazioni â€” Portfolio reale e Sim loop, ognuna in versione pesata (P(successo) Ã— payoff, smorzato per confidence e pattern) e uniforme â€” sullo stesso pot di capitale, mostrando il gain cumulato in â‚¬ contro il tempo. La linea verde tratteggiata a â‚¬0 Ã¨ il breakeven: sopra = scenario in profitto, sotto = in perdita."
              : "Given the average gain (Step 1) and the risk pattern (Step 2), how does the portfolio's 24h P&L accumulate as deals enter the book? The chart compares four allocations â€” Real portfolio and Sim loop, each in weighted (P(success) Ã— payoff, damped by confidence and pattern) and uniform variants â€” on the same capital pot, plotting cumulative gain in â‚¬ against time. The green dashed line at â‚¬0 is the breakeven: above = scenario in profit, below = in loss."}
          </p>
        </div>
      </header>

      <WeightedSizingGateBanner gate={weightedGate} lang={lang} />

      {/* Risk-aware sizing chart â€” single-axis comparison between the user's
          real portfolio (open positions, weighted on toggle) and the sim-loop
          BUY universe (always uniform). Both lines pass through the origin
          and grow linearly in capital; the dashed reference line is the
          spending target, so each curve crosses it at its own breakeven. */}
      <div className="rounded-xl border border-teal-200/40 dark:border-teal-800/30 bg-white/70 dark:bg-surface/70 p-3 space-y-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-ink">
            {it
              ? "Sizing pesato sul portfolio â€” gain cumulato 24h"
              : "Risk-weighted portfolio sizing â€” cumulative 24h gain"}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug max-w-3xl">
            {it
              ? "Per ogni deal: ritorno atteso = P(successo) Ã— payoff. La quota di budget per ciascuna company Ã¨ proporzionale a questo ritorno atteso, smorzata da confidence e ridotta se il deal matcha il pattern di rischio di Step 2. Sul grafico vedi sempre entrambe le varianti del portafoglio reale (uniforme e pesata) e il sim loop â€” cosÃ¬ confronti a colpo d'occhio il vantaggio del weighting sul gain cumulato in â‚¬."
              : "Per deal: expected return = P(success) Ã— payoff. The capital share per company is proportional to this expected return, damped by confidence and reduced if the deal matches the Step 2 risk pattern. The chart always shows both real-portfolio variants (uniform and weighted) plus sim loop â€” so you can read the weighting advantage on the cumulative â‚¬ gain at a glance."}
          </p>
        </div>

        {/* Prominent controls row â€” capital pot + 24h target â‚¬ + reachable
            P(target). Always-visible cells so the user can immediately steer
            the chart without scrolling for the input. */}
        <div className="rounded-md border border-teal-200/60 dark:border-teal-800/40 bg-teal-50/40 dark:bg-teal-950/15 px-3 py-2 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">
              {it ? "Capitale totale investito (â‚¬)" : "Total invested capital (â‚¬)"}
          </span>
            <div className="flex items-center gap-2">
              <CapitalNumberInput
                value={effectiveCapital}
                onCommit={(n) =>
                  setCapitalOverride(n > 0 && n !== topCapital ? n : null)
                }
                step={1000}
                className="input flex-1 py-1 text-sm tabular-nums text-right font-semibold"
                placeholder={String(Math.round(topCapital))}
              />
              {capitalOverride != null ? (
                <button
                  type="button"
                  onClick={() => setCapitalOverride(null)}
                  className="text-[10px] underline text-teal-700 dark:text-teal-300 hover:text-teal-900 dark:hover:text-teal-100 shrink-0"
            title={
              it
                      ? `Ripristina il capitale dal widget in alto (${Math.round(topCapital).toLocaleString("it-IT")} â‚¬).`
                      : `Reset to the capital pot from the top widget (â‚¬${Math.round(topCapital).toLocaleString("it-IT")}).`
                  }
                >
                  {it ? "reset" : "reset"}
                </button>
              ) : (
                <span className="text-[9px] text-ink-muted shrink-0">
                  {it ? "dal widget" : "from widget"}
                </span>
              )}
            </div>
            <span className="text-[9px] text-ink-muted leading-snug">
              {it
                ? "Pot di capitale per cui valuti il breakeven 24h. La linea verticale sul grafico mostra dove ti trovi oggi."
                : "Capital pot you're evaluating the 24h breakeven for. The vertical line on the chart marks where you are today."}
            </span>
        </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">
              {it ? "Target P&L 24h (â‚¬)" : "24h P&L target (â‚¬)"}
          </span>
          <div className="flex items-center gap-2">
              <CapitalNumberInput
                value={targetEur}
                onCommit={(n) =>
                  setTargetEurOverride(
                    n > 0 && n !== Math.max(50, Math.round(effectiveCapital * 0.005))
                      ? n
                      : null,
                  )
                }
                step={50}
                className="input flex-1 py-1 text-sm tabular-nums text-right font-semibold"
                placeholder={String(Math.max(50, Math.round(effectiveCapital * 0.005)))}
              />
              {targetEurOverride != null ? (
                <button
                  type="button"
                  onClick={() => setTargetEurOverride(null)}
                  className="text-[10px] underline text-teal-700 dark:text-teal-300 hover:text-teal-900 dark:hover:text-teal-100 shrink-0"
          title={
                    it
                      ? "Ripristina il target al default (0.5 % del capitale)."
                      : "Reset target to the default (0.5 % of capital)."
                  }
                >
                  {it ? "reset" : "reset"}
                </button>
              ) : (
                <span className="text-[9px] text-ink-muted shrink-0">
                  {it ? "0.5 % cap." : "0.5 % cap."}
          </span>
              )}
      </div>
            <span className="text-[9px] text-ink-muted leading-snug">
              {it
                ? "Profitto 24h che vuoi raggiungere. La curva Weight Sim Exp calcola la mix ottimale sui ritorni reali; confronta con la linea amber sul grafico."
                : "24h profit you want to hit. The Weight Sim Exp curve computes the optimal mix on real returns; compare with the amber line on the chart."}
            </span>
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">
              {it ? "Gain corrente portfolio pesato" : "Weighted portfolio current gain"}
            </span>
            {!weightedGate.ok ? (
              <p className="text-sm tabular-nums font-semibold text-ink-muted">â€”</p>
            ) : (
              <p
                className={`text-sm tabular-nums font-semibold ${
                  finalGains.portfolioWeighted >= 0
                    ? "text-emerald-800 dark:text-emerald-200"
                    : "text-rose-700 dark:text-rose-300"
                }`}
              >
                {finalGains.portfolioWeighted >= 0 ? "+" : ""}
                {Math.round(finalGains.portfolioWeighted).toLocaleString("it-IT")} â‚¬
                <span className="text-[9px] text-ink-muted font-normal ml-1">
                  {it ? "P&L 24h cumulato" : "cumulative 24h P&L"}
                </span>
              </p>
            )}
            <span className="text-[9px] text-ink-muted leading-snug">
              {it
                ? "Somma dei P&L 24h realizzati su ogni deal pesato del tuo portafoglio reale, fino al deal piÃ¹ recente entrato in book. Sopra â‚¬0 = in profitto, sotto = in perdita."
                : "Sum of the realised 24h P&L on every weighted deal in your real portfolio, up to the most recent deal entered into the book. Above â‚¬0 = in profit, below = in loss."}
            </span>
            </div>
            </div>

        {/* Calibrated P(win) compare strip â€” predicted from Calibration Center,
            applied to the OPEN book. Not the same as Dashboard "Closed P&L
            success" (realized wins on closed round-trips). */}
        {(portfolioMeanWinRate != null || simLoopMeanWinRate != null) ? (
          <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span
              className="text-ink-muted"
              title={
                it
                  ? "Media della P(successo) calibrata (Calibration Center) sui deal aperti nel book â€” NON il % di chiusure in profitto. I trade chiusi servono solo a calibrare il modello per bucket SDS/fase/P(plan)."
                  : "Average calibrated P(success) from the Calibration Center on open-book deals â€” NOT the % of profitable closes. Closed trades only calibrate the bucket model."
              }
            >
              {it ? "P(successo) calibrato medio" : "Mean calibrated P(win)"}
            </span>
            {portfolioMeanWinRate != null ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-950/25 px-2 py-0.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: "#10b981" }}
                  aria-hidden
                />
                <span className="text-ink-muted">
                  {it ? "Portfolio" : "Portfolio"}
                </span>
                <span className="font-semibold text-emerald-800 dark:text-emerald-200 tabular-nums">
                  {(portfolioMeanWinRate * 100).toFixed(1)}%
                </span>
                <span className="text-[9px] text-ink-muted">
                  ({comparison?.mineDeals.length ?? 0} {it ? "deal" : "deals"})
                </span>
              </span>
            ) : null}
            {simLoopMeanWinRate != null ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/25 px-2 py-0.5">
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: "#f97316" }}
                  aria-hidden
                />
                <span className="text-ink-muted">Sim loop</span>
                <span className="font-semibold text-amber-800 dark:text-amber-200 tabular-nums">
                  {(simLoopMeanWinRate * 100).toFixed(1)}%
                </span>
                <span className="text-[9px] text-ink-muted">
                  ({comparison?.simLoopDeals.length ?? 0} {it ? "deal" : "deals"})
                </span>
              </span>
            ) : null}
            {portfolioMeanWinRate != null && simLoopMeanWinRate != null ? (
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold tabular-nums ${
                  portfolioMeanWinRate >= simLoopMeanWinRate
                  ? "text-emerald-700 dark:text-emerald-300"
                    : "text-amber-700 dark:text-amber-300"
                }`}
                title={
                  it
                    ? "Differenza Portfolio âˆ’ Sim loop sulla P(successo) calibrata media (deal aperti)."
                    : "Portfolio âˆ’ Sim loop spread on mean calibrated P(win) (open deals)."
                }
              >
                Î”{" "}
                {portfolioMeanWinRate >= simLoopMeanWinRate ? "+" : ""}
                {((portfolioMeanWinRate - simLoopMeanWinRate) * 100).toFixed(1)} pt
            </span>
            ) : null}
        </div>
          {stats && stats.sampleSize > 0 ? (
            <p
              className="text-[10px] text-ink-muted"
              title={
                it
                  ? "Stesso numero della KPI Â«Closed P&L successÂ» nel Tester Monitor / Decision Lab: % di round-trip chiusi con P&L > 0."
                  : "Same metric as the Tester Monitor Â«Closed P&L successÂ» KPI: % of closed round-trips with P&L > 0."
              }
            >
              {it ? "Chiusi sim â€” successo realizzato" : "Closed sim â€” realized success"}:{" "}
              <span className="font-semibold tabular-nums text-ink">
                {(stats.winRate * 100).toFixed(1)}%
              </span>
              <span className="tabular-nums">
                {" "}
                ({stats.winCount}âœ“ / {stats.lossCount}âœ— Â· n={stats.sampleSize})
              </span>
              <span className="opacity-70">
                {it ? " Â· â‰  P(successo) calibrato sopra" : " Â· â‰  calibrated P(win) above"}
              </span>
            </p>
          ) : null}
          </div>
        ) : null}

        {/* Curve visibility filter â€” toggle each curve individually or via
            the three group shortcuts (Only portfolio / Only sim loop / All).
            Together with the per-company sliders in the manual panels, this
            gives full per-company OR group control over what is shown. */}
        <CurveVisibilityToolbar
          curves={[
            {
              key: "simLoopUniform",
              group: "simLoop",
              available: true,
              name: it ? "Sim loop (uniforme)" : "Sim loop (uniform)",
              color: "#fdba74",
              dashed: true,
            },
            {
              key: "simLoopWeighted",
              group: "simLoop",
              available: true,
              disabled: !weightedGate.ok,
              name: it ? "Sim loop (pesato)" : "Sim loop (weighted)",
              color: "#f97316",
              dashed: false,
            },
            {
              key: "simLoopWeightSimExp",
              group: "simLoop",
              available: Boolean(simLoopWeightSimExp),
              name: it ? "Sim loop (Weight Sim Exp)" : "Sim loop (Weight Sim Exp)",
              color: "#db2777",
              dashed: false,
            },
            {
              key: "portfolioUniform",
              group: "portfolio",
              available: true,
              name: it ? "Portfolio reale (uniforme)" : "Real portfolio (uniform)",
              color: "#6ee7b7",
              dashed: true,
            },
            {
              key: "portfolioWeighted",
              group: "portfolio",
              available: true,
              disabled: !weightedGate.ok,
              name: it ? "Portfolio reale (pesato)" : "Real portfolio (weighted)",
              color: "#10b981",
              dashed: false,
            },
            {
              key: "portfolioWeightSimExp",
              group: "portfolio",
              available: Boolean(portfolioWeightSimExp),
              name: it ? "Portfolio reale (Weight Sim Exp)" : "Real portfolio (Weight Sim Exp)",
              color: "#ec4899",
              dashed: false,
            },
          ]}
          visible={visibleCurves}
          onToggle={(key) => {
            if (
              !weightedGate.ok &&
              (key === "portfolioWeighted" || key === "simLoopWeighted")
            ) {
              return;
            }
            setVisibleCurves((prev) => ({ ...prev, [key]: !prev[key] }));
          }}
          onShowOnlyGroup={(group) =>
            setVisibleCurves((prev) => ({
              ...prev,
              portfolioUniform: group === "portfolio",
              portfolioWeighted: group === "portfolio" && weightedGate.ok,
              portfolioWeightSimExp: group === "portfolio",
              simLoopUniform: group === "simLoop",
              simLoopWeighted: group === "simLoop" && weightedGate.ok,
              simLoopWeightSimExp: group === "simLoop",
            }))
          }
          onShowAll={() =>
            setVisibleCurves({
              portfolioUniform: true,
              portfolioWeighted: weightedGate.ok,
              portfolioWeightSimExp: true,
              simLoopUniform: true,
              simLoopWeighted: weightedGate.ok,
              simLoopWeightSimExp: true,
            })
          }
          it={it}
        />

        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={cumulativeGainSeries}
              margin={{ left: 4, right: 28, bottom: 36, top: 12 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
            <XAxis
                dataKey="idx"
              type="number"
                domain={[0, cumulativeGainSeries.length - 1]}
              tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                tickFormatter={(v) => (Number(v) === 0 ? (it ? "Start" : "Start") : `#${v}`)}
              label={{
                  value: it
                    ? "Deal aggiunti in ordine cronologico (data acquisto / catalyst)"
                    : "Deals added in chronological order (purchase / catalyst date)",
                  position: "bottom",
                  offset: 8,
                  style: { fontSize: 9, fill: "rgb(100 116 139)" },
              }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
                domain={gainYDomain}
                tickFormatter={(v) =>
                  `${Math.round(Number(v)) === 0 ? 0 : Number(v).toLocaleString("it-IT")} â‚¬`
                }
                width={64}
                label={{
                  value: it ? "Gain cumulato (â‚¬)" : "Cumulative gain (â‚¬)",
                  angle: -90,
                  position: "insideLeft",
                  offset: 12,
                  style: { fontSize: 10, fill: "rgb(100 116 139)" },
                }}
            />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
                formatter={(value, name) => [
                  `${Number(value) >= 0 ? "+" : ""}${Math.round(Number(value)).toLocaleString("it-IT")} â‚¬`,
                  name as string,
                ]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as
                    | { idx: number; date: string; label: string }
                    | undefined;
                  if (!row || row.idx === 0)
                    return it ? "Punto di partenza (nessun deal)" : "Starting point (no deals)";
                  const date = row.date ? ` Â· ${row.date}` : "";
                  return `${it ? "Deal" : "Deal"} #${row.idx} â€” ${row.label}${date}`;
                }}
              />
              {/* Legend lives in CurveVisibilityToolbar above â€” no Recharts Legend here
                  (it overlapped the X-axis caption). */}

              {/* HORIZONTAL BREAKEVEN â€” â‚¬0. The chart's defining reference:
                  every curve above this line = scenario is in net profit on
                  the realised 24h P&L; below = in net loss. Solid green
                  dashed for unmissable visibility (per user request). */}
            <ReferenceLine
                y={0}
                stroke="#16a34a"
                strokeDasharray="6 4"
                strokeWidth={1.6}
                strokeOpacity={0.9}
              ifOverflow="extendDomain"
              label={{
                  value: it ? "Breakeven (â‚¬0)" : "Breakeven (â‚¬0)",
                  position: "insideRight",
                fontSize: 9,
                  fontWeight: 600,
                  fill: "#15803d",
                }}
              />

              {/* Optional horizontal TARGET line â€” what the user wants to
                  hit in 24h. Shown only when targetEur > 0 and inside the
                  plotted Y range. Amber tint to keep it visually distinct
                  from the breakeven. */}
              {targetEur > 0 && targetEur >= gainYDomain[0] && targetEur <= gainYDomain[1] ? (
              <ReferenceLine
                  y={targetEur}
                  stroke="#f59e0b"
                  strokeDasharray="4 4"
                  strokeWidth={1.4}
                ifOverflow="extendDomain"
                label={{
                  value: it
                      ? `Target: +${Math.round(targetEur).toLocaleString("it-IT")} â‚¬`
                      : `Target: +â‚¬${Math.round(targetEur).toLocaleString("it-IT")}`,
                  position: "insideTopRight",
                  fontSize: 9,
                    fill: "#b45309",
                }}
              />
            ) : null}

              {/* Vertical OGGI line â€” splits past entries (left) from
                  upcoming catalyst-date deals (right) so the user knows
                  which side of the chart is "actually realised" vs
                  "projected from catalyst date". */}
              {todayIdx > 0 && todayIdx < cumulativeGainSeries.length ? (
            <ReferenceLine
                  x={todayIdx}
                  stroke="#dc2626"
                  strokeDasharray="4 4"
                  strokeWidth={1.4}
                  ifOverflow="extendDomain"
              label={{
                    value: it ? "OGGI" : "TODAY",
                    position: "top",
                    fill: "#dc2626",
                fontSize: 9,
                    fontWeight: 600,
              }}
            />
              ) : null}

              {visibleCurves.simLoopUniform ? (
            <Line
              type="monotone"
                  dataKey="simLoopUniformEur"
                  name={it ? "Sim loop (uniforme)" : "Sim loop (uniform)"}
                stroke="#fdba74"
                strokeWidth={1.8}
                strokeDasharray="4 4"
              dot={false}
                isAnimationActive={false}
            />
              ) : null}
              {visibleCurves.simLoopWeighted && weightedGate.ok ? (
            <Line
              type="monotone"
                  dataKey="simLoopWeightedEur"
                  name={it ? "Sim loop (pesato)" : "Sim loop (weighted)"}
                stroke="#f97316"
                strokeWidth={2.6}
              dot={false}
                isAnimationActive={false}
            />
              ) : null}
              {visibleCurves.portfolioUniform ? (
            <Line
              type="monotone"
                  dataKey="portfolioUniformEur"
                name={
                    it ? "Portfolio reale (uniforme)" : "Real portfolio (uniform)"
                }
                stroke="#6ee7b7"
                strokeWidth={1.8}
                strokeDasharray="4 4"
              dot={false}
                isAnimationActive={false}
              />
              ) : null}
              {visibleCurves.portfolioWeighted && weightedGate.ok ? (
              <Line
                type="monotone"
                  dataKey="portfolioWeightedEur"
                name={
                    it ? "Portfolio reale (pesato)" : "Real portfolio (weighted)"
                }
                stroke="#10b981"
                strokeWidth={2.6}
                dot={false}
                isAnimationActive={false}
              />
              ) : null}
              {portfolioWeightSimExp && visibleCurves.portfolioWeightSimExp ? (
                <Line
                  type="monotone"
                  dataKey="portfolioWeightSimExpEur"
                  name={
                    it
                      ? "Portfolio reale (Weight Sim Exp)"
                      : "Real portfolio (Weight Sim Exp)"
                  }
                  stroke="#ec4899"
                  strokeWidth={2.8}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : null}
              {simLoopWeightSimExp && visibleCurves.simLoopWeightSimExp ? (
                <Line
                  type="monotone"
                  dataKey="simLoopWeightSimExpEur"
                  name={
                    it ? "Sim loop (Weight Sim Exp)" : "Sim loop (Weight Sim Exp)"
                  }
                  stroke="#db2777"
                  strokeWidth={2.8}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : null}
          </ComposedChart>
        </ResponsiveContainer>
        </div>

        {/* Visible note: explain the time-series model + how to read the
            cumulative-gain curves so the user always understands what
            they're looking at. */}
        <p className="text-[10px] leading-snug rounded-md border border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/60 dark:bg-emerald-950/20 px-2.5 py-1.5 text-emerald-900 dark:text-emerald-100">
          {it
            ? `Asse X: i deal entrano nel book in ordine cronologico (data acquisto per il portafoglio reale, data catalyst per il sim loop). Asse Y: gain cumulato in â‚¬ realizzato da ogni scenario, calcolato come Î£ (quota_deal Ã— capitale_totale Ã— ritorno_24h_deal). Linea verde tratteggiata a â‚¬0 = breakeven (sopra = profitto netto, sotto = perdita). Quattro curve in matrice 2Ã—2 â€” verde = Portfolio reale, arancio = Sim loop; pieno = pesato, tratteggiato = uniforme. La linea rossa "OGGI" separa i deal giÃ  realizzati da quelli ancora futuri (catalyst date > oggi). Formula del weighting (per le curve piene): quota(deal) âˆ P(successo) Ã— payoff, smorzato da confidence (LOW Ã—${DEFAULT_CONFIDENCE_MULTIPLIERS.low.toFixed(1)}, MED Ã—${DEFAULT_CONFIDENCE_MULTIPLIERS.medium.toFixed(1)}, HIGH Ã—${DEFAULT_CONFIDENCE_MULTIPLIERS.high.toFixed(1)}) e ridotto Ã—${DEFAULT_WEIGHTED_SIZING_CONFIG.patternPenalty.toFixed(1)} se matcha il pattern di Step 2. PiÃ¹ la curva piena sta sopra la tratteggiata dello stesso colore, piÃ¹ valore aggiunge il weighting; piÃ¹ alta Ã¨ la coppia verde rispetto all'arancio, piÃ¹ il portfolio reale batte il sim loop.`
            : `X axis: deals enter the book in chronological order (purchase date for the real portfolio, catalyst date for the sim loop). Y axis: cumulative gain in â‚¬ realised by each scenario, computed as Î£ (deal_share Ã— total_capital Ã— deal_24h_return). Green dashed line at â‚¬0 = breakeven (above = net profit, below = net loss). Four curves in a 2Ã—2 matrix â€” green = Real portfolio, orange = Sim loop; solid = weighted, dashed = uniform. The red "TODAY" line separates already-realised deals from future ones (catalyst date > today). Weighting formula (for solid curves): share(deal) âˆ P(success) Ã— payoff, damped by confidence (LOW Ã—${DEFAULT_CONFIDENCE_MULTIPLIERS.low.toFixed(1)}, MED Ã—${DEFAULT_CONFIDENCE_MULTIPLIERS.medium.toFixed(1)}, HIGH Ã—${DEFAULT_CONFIDENCE_MULTIPLIERS.high.toFixed(1)}) and cut Ã—${DEFAULT_WEIGHTED_SIZING_CONFIG.patternPenalty.toFixed(1)} when the deal matches the Step 2 risk pattern. The further the solid line sits above the dashed one of the same colour, the more value the weighting is adding; the higher the green pair sits over the orange pair, the better the real portfolio beats the sim loop.`}
          {portfolioStatsWeighted.uniformFallbackActive ||
          simLoopStatsWeighted.uniformFallbackActive ? (
            <span className="block mt-0.5 text-amber-800 dark:text-amber-200 font-semibold">
              {it
                ? `âš  ${
                    portfolioStatsWeighted.uniformFallbackActive && simLoopStatsWeighted.uniformFallbackActive
                      ? "NÃ© portfolio nÃ© sim loop hanno deal con gain SDS positivo"
                      : portfolioStatsWeighted.uniformFallbackActive
                        ? "Nessun deal del portfolio con gain SDS positivo"
                        : "Nessun deal del sim loop con gain SDS positivo"
                  }: il sizing pesato Ã¨ caduto sull'uniforme su quel set (curva piena e tratteggiata sovrapposte).`
                : `âš  ${
                    portfolioStatsWeighted.uniformFallbackActive && simLoopStatsWeighted.uniformFallbackActive
                      ? "Neither portfolio nor sim loop have any deal with positive SDS gain"
                      : portfolioStatsWeighted.uniformFallbackActive
                        ? "No portfolio deal has positive SDS gain"
                        : "No sim-loop deal has positive SDS gain"
                  }: weighted sizing fell back to uniform on that set (solid and dashed curves overlap).`}
            </span>
          ) : null}
        </p>

        {/* KPI cards: symmetric 2Ã—2 matrix â€” rows = Portfolio / Sim loop,
            columns = weighted / uniform. Each card shows the FINAL
            cumulative â‚¬ gain that scenario reaches once every deal in
            its universe is funded (= the rightmost point of the matching
            line on the chart above). Extra cards appear when either
            manual sizing mode is enabled. */}
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-6">
          <CumulativeGainKpiCard
            label={it ? "Gain portfolio (pesato)" : "Gain â€” real portfolio (weighted)"}
            sub={it ? "verde pieno" : "solid green"}
            valueEur={finalGains.portfolioWeighted}
            tone="emerald"
            it={it}
            disabled={!weightedGate.ok}
          />
          <CumulativeGainKpiCard
            label={it ? "Gain portfolio (uniforme)" : "Gain â€” real portfolio (uniform)"}
            sub={it ? "verde tratteggiato" : "dashed green"}
            valueEur={finalGains.portfolioUniform}
            tone="emeraldSoft"
            it={it}
          />
          <CumulativeGainKpiCard
            label={it ? "Gain sim loop (pesato)" : "Gain â€” sim loop (weighted)"}
            sub={it ? "arancio pieno" : "solid orange"}
            valueEur={finalGains.simLoopWeighted}
            tone="amber"
            it={it}
            disabled={!weightedGate.ok}
          />
          <CumulativeGainKpiCard
            label={it ? "Gain sim loop (uniforme)" : "Gain â€” sim loop (uniform)"}
            sub={it ? "arancio tratteggiato" : "dashed orange"}
            valueEur={finalGains.simLoopUniform}
            tone="amberSoft"
            it={it}
          />
          {portfolioWeightSimExp ? (
            <CumulativeGainKpiCard
              label={it ? "Gain portfolio (Weight Sim Exp)" : "Gain â€” portfolio (Weight Sim Exp)"}
              sub={it ? "rosa pieno" : "solid rose"}
              valueEur={finalGains.portfolioWeightSimExp}
              tone="rose"
              it={it}
              targetEur={targetEur}
              targetReached={portfolioWeightSimExp.targetReached}
            />
          ) : null}
          {simLoopWeightSimExp ? (
            <CumulativeGainKpiCard
              label={it ? "Gain sim loop (Weight Sim Exp)" : "Gain â€” sim loop (Weight Sim Exp)"}
              sub={it ? "fucsia pieno" : "solid fuchsia"}
              valueEur={finalGains.simLoopWeightSimExp}
              tone="fuchsia"
              it={it}
              targetEur={targetEur}
              targetReached={simLoopWeightSimExp.targetReached}
            />
          ) : null}
        </div>

        {portfolioWeightSimExp || simLoopWeightSimExp ? (
          <WeightSimExpPanel
            it={it}
            targetEur={targetEur}
            portfolioResult={portfolioWeightSimExp}
            simLoopResult={simLoopWeightSimExp}
            portfolioDeals={mineDeals24h}
            simLoopDeals={simLoopDeals24h}
            synthBundle={weightSimExpSynthBundle}
            synthOutcomes={weightSimExpSynthOutcomes}
            weightedGateOk={weightedGate.ok}
            chartGains={{
              portfolioWeighted: finalGains.portfolioWeighted,
              portfolioUniform: finalGains.portfolioUniform,
              portfolioWeightSimExp: finalGains.portfolioWeightSimExp,
              simLoopWeighted: finalGains.simLoopWeighted,
              simLoopWeightSimExp: finalGains.simLoopWeightSimExp,
              simLoopUniform: finalGains.simLoopUniform,
            }}
            onPatternApproved={onPatternChanged}
          />
        ) : null}

        {/* Advantage caption â€” small line under the KPI matrix so the
            cards stay focused on the final gain; the weighting "value-add"
            (â‚¬ delta between weighted and uniform on the real portfolio)
            is contextual info. */}
        <AdvantageCaption
          weightingAdvantageEur={
            finalGains.portfolioWeighted - finalGains.portfolioUniform
          }
          simLoopAdvantageEur={
            finalGains.portfolioWeighted - finalGains.simLoopWeighted
          }
          weightedGateOk={weightedGate.ok}
          it={it}
        />

        {/* Inspectable per-deal breakdown â€” collapsed by default. Every row
            shows the factors that combine into sizeShare so there is no opaque
            number on the chart. Same anti-RA-Score principle as the rest of
            the system. */}
        {comparison?.mineDeals.length ? (
          <details
            className="rounded-md border border-slate-200/60 dark:border-slate-700/50 bg-slate-50/40 dark:bg-slate-900/30 px-2.5 py-2 text-[10px]"
            open={showSizingBreakdown}
            onToggle={(e) => setShowSizingBreakdown((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer font-semibold text-ink select-none">
              {it
                ? `Scomposizione per deal â€” sizing pesato (${portfolioStatsForBreakdown.perDealBreakdown.length} posizioni)`
                : `Per-deal breakdown â€” weighted sizing (${portfolioStatsForBreakdown.perDealBreakdown.length} positions)`}
            </summary>
            <div className="overflow-x-auto mt-2">
              <table className="w-full min-w-[720px] text-[10px] tabular-nums">
                <thead>
                  <tr className="text-ink-muted text-left">
                    <th className="font-medium px-1.5 py-1">{it ? "Deal" : "Deal"}</th>
                    <th className="font-medium px-1.5 py-1 text-right">
                      {it ? "P(succ)" : "P(succ)"}
                    </th>
                    <th className="font-medium px-1.5 py-1 text-right">
                      {it ? "Gain SDS" : "SDS gain"}
                    </th>
                    <th className="font-medium px-1.5 py-1 text-right">EV/â‚¬</th>
                    <th className="font-medium px-1.5 py-1 text-right">{it ? "Conf." : "Conf."}</th>
                    <th className="font-medium px-1.5 py-1 text-right">Ã—conf.</th>
                    <th className="font-medium px-1.5 py-1 text-right">Pat.</th>
                    <th className="font-medium px-1.5 py-1 text-right">Ã—pat.</th>
                    <th className="font-medium px-1.5 py-1 text-right">{it ? "Adj." : "Adj."}</th>
                    <th className="font-medium px-1.5 py-1 text-right">{it ? "Quota" : "Share"}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...portfolioStatsForBreakdown.perDealBreakdown]
                    .sort((a, b) => b.sizeShare - a.sizeShare)
                    .map((row) => (
                      <SizingBreakdownRow key={row.rowKey} row={row} />
                    ))}
                </tbody>
              </table>
            </div>
            <p className="text-[9px] text-ink-muted mt-1.5 leading-snug">
              {it
                ? "EV/â‚¬ = P(successo) Ã— Gain SDS / 100 (ritorno atteso al target, pesato sulla probabilitÃ ). Adjusted = EV/â‚¬ Ã— conf.multiplier Ã— pattern factor. Quota = Adjusted / Î£ Adjusted. Quando P(successo), SDS o pattern cambiano, la quota si aggiorna live."
                : "EV/â‚¬ = P(success) Ã— SDS gain / 100 (probability-weighted expected return at target). Adjusted = EV/â‚¬ Ã— conf.multiplier Ã— pattern factor. Share = Adjusted / Î£ Adjusted. As P(success), SDS or pattern data change, the share updates live."}
            </p>
          </details>
        ) : null}
      </div>

    </section>
  );
}

/**
 * Toolbar above the breakeven chart letting the user filter which curves
 * are drawn. Each available curve gets one toggle chip (visual swatch
 * matches the line on the chart); three quick-action buttons act as group
 * filters so the user can isolate one universe with a single click.
 */
function CurveVisibilityToolbar<
  K extends
    | "portfolioUniform"
    | "portfolioWeighted"
    | "portfolioWeightSimExp"
    | "simLoopUniform"
    | "simLoopWeighted"
    | "simLoopWeightSimExp",
>({
  curves,
  visible,
  onToggle,
  onShowOnlyGroup,
  onShowAll,
  it,
}: {
  curves: Array<{
    key: K;
    group: "portfolio" | "simLoop";
    /** Hide the chip entirely when the matching curve cannot exist yet. */
    available: boolean;
    /** Shown but not clickable â€” weighted gate not satisfied. */
    disabled?: boolean;
    name: string;
    color: string;
    /** Dashed swatch hint â€” matches the dashed pattern on the chart. */
    dashed: boolean;
  }>;
  visible: Record<K, boolean>;
  onToggle: (key: K) => void;
  onShowOnlyGroup: (group: "portfolio" | "simLoop") => void;
  onShowAll: () => void;
  it: boolean;
}) {
  const available = curves.filter((c) => c.available);
  if (available.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-0.5">
      <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold shrink-0">
        {it ? "Mostra curve" : "Show curves"}
      </span>
      {available.map((c) => {
        const on = visible[c.key];
        const locked = c.disabled === true;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              if (locked) return;
              onToggle(c.key);
            }}
            disabled={locked}
            aria-pressed={on}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
              locked
                ? "border-amber-200/80 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-950/20 text-amber-900/70 dark:text-amber-100/70 cursor-not-allowed opacity-80"
                : on
                  ? "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-ink"
                  : "border-slate-200/60 dark:border-slate-700/60 bg-slate-50/70 dark:bg-slate-900/50 text-ink-muted/70 line-through"
            }`}
            title={
              locked
                ? it
                  ? "Sizing pesato disabilitato â€” dati insufficienti"
                  : "Weighted sizing disabled â€” insufficient calibration data"
                : on
                  ? it
                    ? `Nascondi ${c.name}`
                    : `Hide ${c.name}`
                  : it
                    ? `Mostra ${c.name}`
                    : `Show ${c.name}`
            }
          >
            <span
              className="inline-block w-4 h-0"
              style={{
                borderTopWidth: 2,
                borderTopStyle: c.dashed ? "dashed" : "solid",
                borderTopColor: on ? c.color : "transparent",
              }}
              aria-hidden
            />
            {c.name}
          </button>
        );
      })}
      <span className="grow" />
      <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold shrink-0">
        {it ? "Gruppi" : "Groups"}
      </span>
      <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-600 overflow-hidden">
        <button
          type="button"
          onClick={() => onShowOnlyGroup("portfolio")}
          className="px-2 py-0.5 text-[10px] font-medium bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
          title={
            it
              ? "Mostra solo le curve del portfolio reale."
              : "Show only the real-portfolio curves."
          }
        >
          {it ? "Solo portfolio" : "Only portfolio"}
        </button>
        <button
          type="button"
          onClick={() => onShowOnlyGroup("simLoop")}
          className="px-2 py-0.5 text-[10px] font-medium border-l border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
          title={
            it
              ? "Mostra solo le curve del sim loop."
              : "Show only the sim-loop curves."
          }
        >
          {it ? "Solo sim loop" : "Only sim loop"}
        </button>
        <button
          type="button"
          onClick={onShowAll}
          className="px-2 py-0.5 text-[10px] font-medium border-l border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-ink hover:bg-slate-50 dark:hover:bg-slate-700"
          title={
            it
              ? "Mostra di nuovo tutte le curve."
              : "Show every curve again."
          }
        >
          {it ? "Tutte" : "All"}
        </button>
      </div>
    </div>
  );
}

function CumulativeGainKpiCard({
  label,
  sub,
  valueEur,
  tone,
  it,
  disabled = false,
  targetEur,
  targetReached,
}: {
  label: string;
  sub: string;
  /** Final cumulative gain (â‚¬) reached by the scenario after every deal
   *  in its universe has been funded â€” i.e. the rightmost point of the
   *  matching line on the chart above. Positive = scenario net profit,
   *  negative = net loss. */
  valueEur: number;
  tone: "emerald" | "emeraldSoft" | "amber" | "amberSoft" | "indigo" | "violet" | "rose" | "fuchsia";
  it: boolean;
  disabled?: boolean;
  targetEur?: number;
  targetReached?: boolean;
}) {
  const toneClasses =
    tone === "emerald"
      ? "border-emerald-300/60 bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-100"
      : tone === "emeraldSoft"
        ? "border-emerald-200/50 bg-emerald-50/20 dark:bg-emerald-950/10 text-emerald-800/90 dark:text-emerald-200/90"
        : tone === "amber"
          ? "border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20 text-amber-900 dark:text-amber-100"
          : tone === "amberSoft"
            ? "border-amber-200/50 bg-amber-50/20 dark:bg-amber-950/10 text-amber-800/90 dark:text-amber-200/90"
            : tone === "violet"
              ? "border-violet-300/60 bg-violet-50/40 dark:bg-violet-950/20 text-violet-900 dark:text-violet-100"
              : tone === "rose"
                ? "border-rose-300/60 bg-rose-50/40 dark:bg-rose-950/20 text-rose-900 dark:text-rose-100"
                : tone === "fuchsia"
                  ? "border-fuchsia-300/60 bg-fuchsia-50/40 dark:bg-fuchsia-950/20 text-fuchsia-900 dark:text-fuchsia-100"
                  : tone === "indigo"
                    ? "border-indigo-300/60 bg-indigo-50/40 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-100"
                    : "border-indigo-300/60 bg-indigo-50/40 dark:bg-indigo-950/20 text-indigo-900 dark:text-indigo-100";
  const positive = valueEur >= 0;
  return (
    <div
      className={`rounded-md border px-3 py-2 ${toneClasses} ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <p className="text-[9px] uppercase font-medium opacity-80">{label}</p>
      <p className="text-[9px] opacity-70 -mt-0.5">{sub}</p>
      {disabled ? (
        <p className="text-lg font-bold tabular-nums mt-0.5 text-ink-muted">â€”</p>
      ) : (
        <p
          className={`text-lg font-bold tabular-nums mt-0.5 ${
            positive
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-rose-700 dark:text-rose-300"
          }`}
        >
          {positive ? "+" : ""}
          {Math.round(valueEur).toLocaleString("it-IT")} â‚¬
        </p>
      )}
      <p className="text-[9px] opacity-65 leading-snug mt-0.5">
        {disabled
          ? it
            ? "Disabilitato â€” calibrazione insufficiente"
            : "Disabled â€” insufficient calibration"
          : targetEur != null && targetReached != null ? (
            targetReached
              ? it
                ? `target +${Math.round(targetEur).toLocaleString("it-IT")} â‚¬ raggiungibile`
                : `target +â‚¬${Math.round(targetEur).toLocaleString("it-IT")} reachable`
              : it
                ? `sotto target +${Math.round(targetEur).toLocaleString("it-IT")} â‚¬ (max possibile)`
                : `below target +â‚¬${Math.round(targetEur).toLocaleString("it-IT")} (best possible)`
          ) : it
            ? positive
              ? "in profitto rispetto al breakeven (â‚¬0)"
              : "in perdita rispetto al breakeven (â‚¬0)"
            : positive
              ? "in profit vs breakeven (â‚¬0)"
              : "in loss vs breakeven (â‚¬0)"}
      </p>
    </div>
  );
}

function AdvantageCaption({
  weightingAdvantageEur,
  simLoopAdvantageEur,
  weightedGateOk,
  it,
}: {
  /** â‚¬ delta between the weighted-portfolio and uniform-portfolio final
   *  cumulative gain. Positive = the risk weighting added value vs the
   *  naive uniform mix on the real portfolio. */
  weightingAdvantageEur: number;
  /** â‚¬ delta between the weighted-portfolio and weighted-sim-loop final
   *  cumulative gain. Positive = the real portfolio beat the sim loop
   *  reference. */
  simLoopAdvantageEur: number;
  weightedGateOk: boolean;
  it: boolean;
}) {
  if (!weightedGateOk) {
    return (
      <p className="text-[10px] text-ink-muted leading-snug">
        {it
          ? "Vantaggio del weighting non calcolato finchÃ© il sizing pesato resta disabilitato."
          : "Weighting advantage is not shown while weighted sizing remains disabled."}
      </p>
    );
  }
  const positiveW = weightingAdvantageEur >= 0;
  const positiveS = simLoopAdvantageEur >= 0;
  const fmt = (v: number) =>
    `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("it-IT")} â‚¬`;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-ink-muted leading-snug">
      <span>
        {it ? "Vantaggio del weighting (portfolio): " : "Weighting advantage (portfolio): "}
      <span
        className={`font-semibold tabular-nums ${
            positiveW
            ? "text-emerald-700 dark:text-emerald-300"
            : "text-rose-700 dark:text-rose-300"
        }`}
      >
          {fmt(weightingAdvantageEur)}
        </span>
        <span className="text-ink-muted">
          {it ? " (pesato âˆ’ uniforme)." : " (weighted âˆ’ uniform)."}
        </span>
      </span>
      <span>
        {it ? "Vantaggio vs sim loop (pesato): " : "Advantage vs sim loop (weighted): "}
        <span
          className={`font-semibold tabular-nums ${
            positiveS
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-rose-700 dark:text-rose-300"
          }`}
        >
          {fmt(simLoopAdvantageEur)}
      </span>
      <span className="text-ink-muted">
        {it
            ? " (portfolio pesato âˆ’ sim loop pesato)."
            : " (weighted portfolio âˆ’ weighted sim loop)."}
      </span>
      </span>
    </div>
  );
}
function SizingBreakdownRow({ row }: { row: DealSizingBreakdown }) {
  const confLabel =
    row.confidence === "high" ? "HIGH" : row.confidence === "medium" ? "MED" : "LOW";
  return (
    <tr className="border-t border-slate-200/40 dark:border-slate-700/40">
      <td className="px-1.5 py-1 text-ink font-semibold">{row.label}</td>
      <td className="px-1.5 py-1 text-right">{`${(row.pSuccess * 100).toFixed(0)}%`}</td>
      <td className="px-1.5 py-1 text-right">{`${(row.sdsExpectedGainPct ?? 0).toFixed(1)}%`}</td>
      <td className="px-1.5 py-1 text-right">{`${(row.evPerEur * 100).toFixed(2)}%`}</td>
      <td className="px-1.5 py-1 text-right">{confLabel}</td>
      <td className="px-1.5 py-1 text-right">{(row.confidenceMultiplier ?? 1).toFixed(2)}</td>
      <td className="px-1.5 py-1 text-right">{row.matchesStep2Pattern ? "âœ“" : "â€”"}</td>
      <td className="px-1.5 py-1 text-right">{(row.patternPenaltyFactor ?? 1).toFixed(2)}</td>
      <td className="px-1.5 py-1 text-right">{`${(row.adjustedScore * 100).toFixed(3)}%`}</td>
      <td className="px-1.5 py-1 text-right font-semibold text-ink">
        {`${(row.sizeShare * 100).toFixed(1)}%`}
      </td>
    </tr>
  );
}

