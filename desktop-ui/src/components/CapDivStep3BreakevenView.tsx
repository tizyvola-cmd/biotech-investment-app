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
import { ManualAllocationSynthesizerPanel } from "./ManualAllocationSynthesizerPanel";
import { WeightSimExpPanel } from "./WeightSimExpPanel";
import {
  optimizeWeightSimExp,
  optimizedSharesToRawWeights,
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
  onManualAllocationChange,
  onPatternChanged,
  frozenWeightsTick = 0,
}: {
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  /** Live portfolio inputs (capital/buyPrice) — needed by suggestion monitor
   * to compute BUY/HOLD eligibility and per-row probPct. Wired so this chart
   * can use the SAME calibrated win rates as the slider widget above. */
  investInputs?: InvestSimInputs;
  /** Chart points per series key — required by buildSuggestionMonitorRows. */
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
  /** Capital pot from the top-of-page widget — used as the default target
   * spending the user is trying to cover, and to scale the chart X axis. */
  topCapital: number;
  /** Bumped by parent when the approved pattern changes — forces memo refresh. */
  patternStoreVersion: number;
  /** Feeds Step 2 synthesizer with open-position manual sizing intent. */
  onManualAllocationChange?: (bundle: ManualAllocationSynthesizerBundle) => void;
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
   *  X-axis range, manual sliders' € display) recomputes against it — so the
   *  user can play "what if I had X € instead?" without touching the global
   *  capital that the rest of the app uses. */
  const [capitalOverride, setCapitalOverride] = useState<number | null>(null);

  /** Effective capital pot used everywhere in this component. */
  const effectiveCapital =
    capitalOverride != null && capitalOverride > 0 ? capitalOverride : topCapital;

  /** Spending the user wants to cover ("la spesa") within the 24h horizon.
   *  Auto-default = effective capital × 0.5 % (a small daily target so the
   *  breakeven reference line lands inside the chart range — over the
   *  catalyst horizon a similar 2 % target was used; on 24h √-time scaling
   *  shrinks the natural daily move accordingly). User can override via
   *  the on-chart input; `null` means "use the auto-default". */
  const [targetEurOverride, setTargetEurOverride] = useState<number | null>(null);
  const targetEur =
    targetEurOverride != null && targetEurOverride > 0
      ? targetEurOverride
      : Math.max(50, Math.round(effectiveCapital * 0.005));

  /** Step 2 approved risk pattern — feeds the pattern matcher used by the
   *  weighted-sizing module below. `null` when no pattern has been approved
   *  yet, in which case `patternPenalty` stays at 1.0 for every deal. */
  const approvedPattern = useMemo(() => {
    return loadApprovedPattern().current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternStoreVersion]);

  // ── New "Expected cumulative gain vs capital invested" chart inputs ──
  // The chart compares the user's REAL portfolio (open positions) against the
  // SIM LOOP BUY universe, both built from the same `buildThreePortfolioComparison`
  // pipeline that powers every other risk-aware surface in the app. This
  // guarantees that every win rate / payoff / pattern-match decision shown on
  // the chart is the same number the rest of the system sees — no local
  // recomputation.
  /** Inspectable per-deal table starts collapsed; expand to audit weighting. */
  const [showSizingBreakdown, setShowSizingBreakdown] = useState(false);

  // ── Manual per-company sizing override ──
  // The user can flip into "manual mode" and dial in their own per-deal
  // weights via sliders. We store the raw weights (0..200) per rowKey so the
  // user can leave a row untouched (it keeps the Step 2 / weighted default
  // implicitly via `effectiveManualWeights` below). The normalised shares
  // sum to ≈1 and drive a 5th probability curve on the chart so the manual
  // mix can be compared head-to-head with the weighted / uniform variants.
  const [manualSizingEnabled, setManualSizingEnabled] = useState(false);
  const [manualWeightsByRowKey, setManualWeightsByRowKey] = useState<
    Record<string, number>
  >({});

  // Same state, but for the SIM LOOP universe. Independent toggle + weights
  // map so the user can dial portfolio and sim loop manual mixes separately
  // and compare both 5th & 6th curves side-by-side on the chart.
  const [simLoopManualSizingEnabled, setSimLoopManualSizingEnabled] = useState(false);
  const [simLoopManualWeightsByRowKey, setSimLoopManualWeightsByRowKey] = useState<
    Record<string, number>
  >({});

  // ── Curve visibility filter ──
  // Lets the user pick what is rendered on the breakeven chart: each curve
  // can be toggled individually (per-company-mix granularity) and three
  // quick-action buttons act as group filters ("Only portfolio" / "Only
  // sim loop" / "All"). The two manual curves (5th & 6th) only show up in
  // the toolbar when their respective manual panel is enabled.
  const [visibleCurves, setVisibleCurves] = useState<
    Record<
      "portfolioUniform"
      | "portfolioWeighted"
      | "portfolioManual"
      | "portfolioWeightSimExp"
      | "simLoopUniform"
      | "simLoopWeighted"
      | "simLoopManual"
      | "simLoopWeightSimExp",
      boolean
    >
  >({
    portfolioUniform: true,
    portfolioWeighted: true,
    portfolioManual: true,
    portfolioWeightSimExp: true,
    simLoopUniform: true,
    simLoopWeighted: true,
    simLoopManual: true,
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
   * Local aliases for the two universes — kept under their original
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
  // callback. When no pattern is approved, the matcher always returns false —
  // patternPenalty stays neutral (1.0) and the curve reduces to a pure
  // EV × confidence weighting. (Brief: "Se il pattern di Step 2 non è ancora
  // implementato […], patternPenalty può restare fisso a 1.0".)
  const patternMatchByRowKey = useMemo(() => {
    const map = new Map<string, boolean>();
    if (!approvedPattern || !comparison) return map;
    try {
      const features = extractAllRowFeatures(closedRows, { simTable, sdsRows });
      for (const d of comparison.allDeals) {
        // Same lookup heuristic used by the legacy pattern filter above:
        // features keys start with `${TICKER}|…`.
        const fk = Array.from(features.keys()).find((k) =>
          k.startsWith(`${d.ticker.toUpperCase()}|`),
        );
        if (!fk) continue;
        const fc = features.get(fk);
        if (!fc) continue;
        map.set(d.rowKey, matchPattern(approvedPattern, fc));
      }
    } catch {
      /* swallow — empty map keeps every deal at patternPenalty=1.0 */
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

  /** Live EV×confidence breakdown — diagnostic table only; curves use approved weights. */
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
   *  The pattern matcher is the same as the portfolio side — Step 2 risk
   *  pattern penalises every deal that matches, regardless of where it sits.
   *  Same 24h-scaled deals used by every other curve below — keeps the
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

  /** Per-universe size shares (length === deal count, sum ≈ 1). Approved weights
   *  are the production baseline for weighted + synthesizer curves. */
  const portfolioWeightedShares = portfolioApprovedShares;
  const simLoopWeightedShares = simLoopApprovedShares;

  /** Raw per-deal weights backing the manual mode. For each portfolio deal
   *  we read the explicit slider value if the user set one, otherwise we
   *  fall back to the Step-2 weighted share (× 100, expressed as a raw
   *  weight). This keeps the "Manual" curve coincident with the weighted
   *  curve until the user starts dragging sliders. */
  const manualRawWeights = useMemo<number[]>(() => {
    return mineDeals24h.map((d, i) => {
      const explicit = manualWeightsByRowKey[d.rowKey];
      if (typeof explicit === "number" && Number.isFinite(explicit)) {
        return Math.max(0, explicit);
      }
      const share = portfolioWeightedShares[i] ?? 0;
      return Math.max(0, share * 100);
    });
  }, [mineDeals24h, manualWeightsByRowKey, portfolioWeightedShares]);

  /** Normalised manual shares (Σ ≈ 1). When every weight is zero we return
   *  zeros — the cumulative gain curve then stays at €0 everywhere, which
   *  is the truthful answer ("no capital deployed, no realised gain"). */
  const manualShares = useMemo<number[]>(() => {
    const sum = manualRawWeights.reduce((s, v) => s + v, 0);
    if (sum <= 0) return manualRawWeights.map(() => 0);
    return manualRawWeights.map((v) => v / sum);
  }, [manualRawWeights]);

  // ── Sim loop manual mode — mirrors the portfolio block above ──
  /** Raw per-deal manual weights for the sim loop universe. Defaults to the
   *  weighted Step-2 shares (× 100) when the user has not dragged a slider
   *  yet, so the manual curve sits on top of the weighted curve until the
   *  user starts customising. */
  const simLoopManualRawWeights = useMemo<number[]>(() => {
    return simLoopDeals24h.map((d, i) => {
      const explicit = simLoopManualWeightsByRowKey[d.rowKey];
      if (typeof explicit === "number" && Number.isFinite(explicit)) {
        return Math.max(0, explicit);
      }
      const share = simLoopWeightedShares[i] ?? 0;
      return Math.max(0, share * 100);
    });
  }, [simLoopDeals24h, simLoopManualWeightsByRowKey, simLoopWeightedShares]);

  /** Normalised sim loop manual shares (Σ ≈ 1). */
  const simLoopManualShares = useMemo<number[]>(() => {
    const sum = simLoopManualRawWeights.reduce((s, val) => s + val, 0);
    if (sum <= 0) return simLoopManualRawWeights.map(() => 0);
    return simLoopManualRawWeights.map((val) => val / sum);
  }, [simLoopManualRawWeights]);

  /** Open-position manual intent — drives Step 3 synthesizer + Step 2 preview. */
  const manualAllocationBundle = useMemo<ManualAllocationSynthesizerBundle>(() => {
    const toDealRows = (
      deals: ComparisonDeal[],
      baseline: number[],
      manual: number[],
      weightsMap: Record<string, number>,
    ) =>
      deals.map((d, i) => ({
        rowKey: d.rowKey,
        ticker: d.ticker,
        baselineShare: baseline[i] ?? 0,
        manualShare: manual[i] ?? 0,
        userAdjusted: typeof weightsMap[d.rowKey] === "number",
        cells: d.cells as Record<string, string>,
      }));

    return {
      portfolio: manualSizingEnabled
        ? {
            universe: "portfolio" as const,
            enabled: true,
            deals: toDealRows(
              mineDeals24h,
              portfolioWeightedShares,
              manualShares,
              manualWeightsByRowKey,
            ),
          }
        : null,
      simLoop: simLoopManualSizingEnabled
        ? {
            universe: "simLoop" as const,
            enabled: true,
            deals: toDealRows(
              simLoopDeals24h,
              simLoopWeightedShares,
              simLoopManualShares,
              simLoopManualWeightsByRowKey,
            ),
          }
        : null,
    };
  }, [
    manualSizingEnabled,
    simLoopManualSizingEnabled,
    mineDeals24h,
    simLoopDeals24h,
    portfolioWeightedShares,
    simLoopWeightedShares,
    manualShares,
    simLoopManualShares,
    manualWeightsByRowKey,
    simLoopManualWeightsByRowKey,
  ]);

  const manualSynthOutcomes = useMemo(
    () =>
      runManualAllocationSynthesizerBundle(manualAllocationBundle, {
        simTable,
        sdsRows,
        closedRows,
        phaseA,
      }),
    [manualAllocationBundle, simTable, sdsRows, closedRows, phaseA],
  );

  /** Lift bundle to parent so Step 2 can preview the same state. */
  useEffect(() => {
    onManualAllocationChange?.(manualAllocationBundle);
  }, [onManualAllocationChange, manualAllocationBundle]);

  // ───────────────────────── Time-series cumulative gain ─────────────────────
  /**
   * Chronological cumulative-gain model (replaces the previous capital-vs-
   * probability curves at the user's request).
   *
   * For each scenario (Portfolio × {uniform, weighted, manual} and Sim loop ×
   * the same), we walk the union of all deal entry events in chronological
   * order and accumulate per-deal realised 24h gain expressed in €:
   *
   *   gainContribution = share_scenario(deal) × effectiveCapital ×
   *                       realizedReturnPct24h(deal) / 100
   *
   * `share_scenario(deal)` reads the weight that the scenario assigns to
   * that deal once the FULL universe is funded — same numbers feeding the
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
        if (cd && cd !== "—") return cd;
        return "9999-12-31";
      },
    [investInputs],
  );

  /**
   * Single chronologically-sorted list of unique deal events drawn from the
   * union of the two universes — every entry is one (date, ticker, rowKey)
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

  /** Weight Sim Exp — mix that maximises cumulative 24h gain vs chart target. */
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
    const manual = new Map<string, number>();
    const weightSimExp = new Map<string, number>();
    const n = mineDeals24h.length;
    const uniformShare = n > 0 ? 1 / n : 0;
    mineDeals24h.forEach((d, i) => {
      uniform.set(d.rowKey, uniformShare);
      weighted.set(d.rowKey, portfolioWeightedShares[i] ?? 0);
      manual.set(d.rowKey, manualShares[i] ?? 0);
      weightSimExp.set(d.rowKey, portfolioWeightSimExp?.shares[i] ?? 0);
    });
    return { uniform, weighted, manual, weightSimExp };
  }, [mineDeals24h, portfolioWeightedShares, manualShares, portfolioWeightSimExp]);

  const simLoopSharesByRowKey = useMemo(() => {
    const uniform = new Map<string, number>();
    const weighted = new Map<string, number>();
    const manual = new Map<string, number>();
    const weightSimExp = new Map<string, number>();
    const n = simLoopDeals24h.length;
    const uniformShare = n > 0 ? 1 / n : 0;
    simLoopDeals24h.forEach((d, i) => {
      uniform.set(d.rowKey, uniformShare);
      weighted.set(d.rowKey, simLoopWeightedShares[i] ?? 0);
      manual.set(d.rowKey, simLoopManualShares[i] ?? 0);
      weightSimExp.set(d.rowKey, simLoopWeightSimExp?.shares[i] ?? 0);
    });
    return { uniform, weighted, manual, weightSimExp };
  }, [simLoopDeals24h, simLoopWeightedShares, simLoopManualShares, simLoopWeightSimExp]);

  /**
   * One row per chronological X step. Each row carries the running
   * cumulative gain € for all six scenarios. `idx = 0` is the "Start"
   * sentinel point at €0 — the curves grow from there as deals enter the
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
    let pManualCum = 0;
    let pWeightSimExpCum = 0;
    let sUniformCum = 0;
    let sWeightedCum = 0;
    let sManualCum = 0;
    let sWeightSimExpCum = 0;
    const rows: Array<{
      idx: number;
      date: string;
      label: string;
      portfolioUniformEur: number;
      portfolioWeightedEur: number;
      portfolioManualEur: number;
      portfolioWeightSimExpEur: number;
      simLoopUniformEur: number;
      simLoopWeightedEur: number;
      simLoopManualEur: number;
      simLoopWeightSimExpEur: number;
    }> = [
      {
        idx: 0,
        date: "",
        label: it ? "Start" : "Start",
        portfolioUniformEur: 0,
        portfolioWeightedEur: 0,
        portfolioManualEur: 0,
        portfolioWeightSimExpEur: 0,
        simLoopUniformEur: 0,
        simLoopWeightedEur: 0,
        simLoopManualEur: 0,
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
        pManualCum +=
          (portfolioSharesByRowKey.manual.get(event.rowKey) ?? 0) *
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
        sManualCum +=
          (simLoopSharesByRowKey.manual.get(event.rowKey) ?? 0) *
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
        portfolioManualEur: pManualCum,
        portfolioWeightSimExpEur: pWeightSimExpCum,
        simLoopUniformEur: sUniformCum,
        simLoopWeightedEur: sWeightedCum,
        simLoopManualEur: sManualCum,
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
   * X index of "today" — first event whose entry date is on or after the
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
   *  per scenario — drives the KPI cards below without re-walking the
   *  series in each cell. */
  const finalGains = useMemo(() => {
    const last = cumulativeGainSeries[cumulativeGainSeries.length - 1];
    return {
      portfolioUniform: last?.portfolioUniformEur ?? 0,
      portfolioWeighted: last?.portfolioWeightedEur ?? 0,
      portfolioManual: last?.portfolioManualEur ?? 0,
      portfolioWeightSimExp: last?.portfolioWeightSimExpEur ?? 0,
      simLoopUniform: last?.simLoopUniformEur ?? 0,
      simLoopWeighted: last?.simLoopWeightedEur ?? 0,
      simLoopManual: last?.simLoopManualEur ?? 0,
      simLoopWeightSimExp: last?.simLoopWeightSimExpEur ?? 0,
    };
  }, [cumulativeGainSeries]);

  /** Y-axis padded domain so the breakeven line at €0 and the target line
   *  at +targetEur are both always visible, even when every scenario is
   *  deep in profit / loss. */
  const gainYDomain = useMemo<[number, number]>(() => {
    const candidates: number[] = [0, targetEur];
    cumulativeGainSeries.forEach((r) => {
      candidates.push(
        r.portfolioUniformEur,
        r.portfolioWeightedEur,
        r.portfolioManualEur,
        r.portfolioWeightSimExpEur,
        r.simLoopUniformEur,
        r.simLoopWeightedEur,
        r.simLoopManualEur,
        r.simLoopWeightSimExpEur,
      );
    });
    const min = Math.min(...candidates);
    const max = Math.max(...candidates);
    const pad = Math.max(50, (max - min) * 0.08);
    return [Math.floor((min - pad) / 50) * 50, Math.ceil((max + pad) / 50) * 50];
  }, [cumulativeGainSeries, targetEur]);

  /** Use the weighted breakdown as the primary inspection target — uniform
   *  is trivial (all sizes equal). When the weighted sizing falls back to
   *  uniform (no positive-EV deals), the two breakdowns coincide. */
  const portfolioStatsForBreakdown = portfolioStatsWeighted;

  /** Mean calibrated P(win) per open-book universe — NOT realized closed success.
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
              ? "Step 3 — Gain cumulato vs tempo (breakeven a €0)"
              : "Step 3 — Cumulative gain vs time (breakeven at €0)"}
          </h2>
          <p className="text-[11px] leading-relaxed text-teal-800/75 dark:text-teal-200/75 max-w-3xl">
            {it
              ? "Dato il gain medio (Step 1) e il pattern di rischio (Step 2), come si accumula il P&L 24h del portafoglio man mano che i deal entrano nel book? Il grafico confronta quattro allocazioni — Portfolio reale e Sim loop, ognuna in versione pesata (P(successo) × payoff, smorzato per confidence e pattern) e uniforme — sullo stesso pot di capitale, mostrando il gain cumulato in € contro il tempo. La linea verde tratteggiata a €0 è il breakeven: sopra = scenario in profitto, sotto = in perdita."
              : "Given the average gain (Step 1) and the risk pattern (Step 2), how does the portfolio's 24h P&L accumulate as deals enter the book? The chart compares four allocations — Real portfolio and Sim loop, each in weighted (P(success) × payoff, damped by confidence and pattern) and uniform variants — on the same capital pot, plotting cumulative gain in € against time. The green dashed line at €0 is the breakeven: above = scenario in profit, below = in loss."}
          </p>
        </div>
      </header>

      <WeightedSizingGateBanner gate={weightedGate} lang={lang} />

      {/* Risk-aware sizing chart — single-axis comparison between the user's
          real portfolio (open positions, weighted on toggle) and the sim-loop
          BUY universe (always uniform). Both lines pass through the origin
          and grow linearly in capital; the dashed reference line is the
          spending target, so each curve crosses it at its own breakeven. */}
      <div className="rounded-xl border border-teal-200/40 dark:border-teal-800/30 bg-white/70 dark:bg-surface/70 p-3 space-y-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-ink">
            {it
              ? "Sizing pesato sul portfolio — gain cumulato 24h"
              : "Risk-weighted portfolio sizing — cumulative 24h gain"}
          </p>
          <p className="text-[10px] text-ink-muted leading-snug max-w-3xl">
            {it
              ? "Per ogni deal: ritorno atteso = P(successo) × payoff. La quota di budget per ciascuna company è proporzionale a questo ritorno atteso, smorzata da confidence e ridotta se il deal matcha il pattern di rischio di Step 2. Sul grafico vedi sempre entrambe le varianti del portafoglio reale (uniforme e pesata) e il sim loop — così confronti a colpo d'occhio il vantaggio del weighting sul gain cumulato in €."
              : "Per deal: expected return = P(success) × payoff. The capital share per company is proportional to this expected return, damped by confidence and reduced if the deal matches the Step 2 risk pattern. The chart always shows both real-portfolio variants (uniform and weighted) plus sim loop — so you can read the weighting advantage on the cumulative € gain at a glance."}
          </p>
        </div>

        {/* Prominent controls row — capital pot + 24h target € + reachable
            P(target). Always-visible cells so the user can immediately steer
            the chart without scrolling for the input. */}
        <div className="rounded-md border border-teal-200/60 dark:border-teal-800/40 bg-teal-50/40 dark:bg-teal-950/15 px-3 py-2 grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">
              {it ? "Capitale totale investito (€)" : "Total invested capital (€)"}
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
                      ? `Ripristina il capitale dal widget in alto (${Math.round(topCapital).toLocaleString("it-IT")} €).`
                      : `Reset to the capital pot from the top widget (€${Math.round(topCapital).toLocaleString("it-IT")}).`
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
              {it ? "Target P&L 24h (€)" : "24h P&L target (€)"}
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
              <p className="text-sm tabular-nums font-semibold text-ink-muted">—</p>
            ) : (
              <p
                className={`text-sm tabular-nums font-semibold ${
                  finalGains.portfolioWeighted >= 0
                    ? "text-emerald-800 dark:text-emerald-200"
                    : "text-rose-700 dark:text-rose-300"
                }`}
              >
                {finalGains.portfolioWeighted >= 0 ? "+" : ""}
                {Math.round(finalGains.portfolioWeighted).toLocaleString("it-IT")} €
                <span className="text-[9px] text-ink-muted font-normal ml-1">
                  {it ? "P&L 24h cumulato" : "cumulative 24h P&L"}
                </span>
              </p>
            )}
            <span className="text-[9px] text-ink-muted leading-snug">
              {it
                ? "Somma dei P&L 24h realizzati su ogni deal pesato del tuo portafoglio reale, fino al deal più recente entrato in book. Sopra €0 = in profitto, sotto = in perdita."
                : "Sum of the realised 24h P&L on every weighted deal in your real portfolio, up to the most recent deal entered into the book. Above €0 = in profit, below = in loss."}
            </span>
            </div>
            </div>

        {/* Calibrated P(win) compare strip — predicted from Calibration Center,
            applied to the OPEN book. Not the same as Dashboard "Closed P&L
            success" (realized wins on closed round-trips). */}
        {(portfolioMeanWinRate != null || simLoopMeanWinRate != null) ? (
          <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span
              className="text-ink-muted"
              title={
                it
                  ? "Media della P(successo) calibrata (Calibration Center) sui deal aperti nel book — NON il % di chiusure in profitto. I trade chiusi servono solo a calibrare il modello per bucket SDS/fase/P(plan)."
                  : "Average calibrated P(success) from the Calibration Center on open-book deals — NOT the % of profitable closes. Closed trades only calibrate the bucket model."
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
                    ? "Differenza Portfolio − Sim loop sulla P(successo) calibrata media (deal aperti)."
                    : "Portfolio − Sim loop spread on mean calibrated P(win) (open deals)."
                }
              >
                Δ{" "}
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
                  ? "Stesso numero della KPI «Closed P&L success» nel Tester Monitor / Decision Lab: % di round-trip chiusi con P&L > 0."
                  : "Same metric as the Tester Monitor «Closed P&L success» KPI: % of closed round-trips with P&L > 0."
              }
            >
              {it ? "Chiusi sim — successo realizzato" : "Closed sim — realized success"}:{" "}
              <span className="font-semibold tabular-nums text-ink">
                {(stats.winRate * 100).toFixed(1)}%
              </span>
              <span className="tabular-nums">
                {" "}
                ({stats.winCount}✓ / {stats.lossCount}✗ · n={stats.sampleSize})
              </span>
              <span className="opacity-70">
                {it ? " · ≠ P(successo) calibrato sopra" : " · ≠ calibrated P(win) above"}
              </span>
            </p>
          ) : null}
          </div>
        ) : null}

        {/* Curve visibility filter — toggle each curve individually or via
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
              key: "simLoopManual",
              group: "simLoop",
              available: simLoopManualSizingEnabled,
              name: it ? "Sim loop (manuale)" : "Sim loop (manual)",
              color: "#7c3aed",
              dashed: true,
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
              key: "portfolioManual",
              group: "portfolio",
              available: manualSizingEnabled,
              name: it ? "Portfolio reale (manuale)" : "Real portfolio (manual)",
              color: "#6366f1",
              dashed: true,
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
              portfolioManual: group === "portfolio" && manualSizingEnabled,
              portfolioWeightSimExp: group === "portfolio",
              simLoopUniform: group === "simLoop",
              simLoopWeighted: group === "simLoop" && weightedGate.ok,
              simLoopManual: group === "simLoop" && simLoopManualSizingEnabled,
              simLoopWeightSimExp: group === "simLoop",
            }))
          }
          onShowAll={() =>
            setVisibleCurves({
              portfolioUniform: true,
              portfolioWeighted: weightedGate.ok,
              portfolioManual: true,
              portfolioWeightSimExp: true,
              simLoopUniform: true,
              simLoopWeighted: weightedGate.ok,
              simLoopManual: true,
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
                  `${Math.round(Number(v)) === 0 ? 0 : Number(v).toLocaleString("it-IT")} €`
                }
                width={64}
                label={{
                  value: it ? "Gain cumulato (€)" : "Cumulative gain (€)",
                  angle: -90,
                  position: "insideLeft",
                  offset: 12,
                  style: { fontSize: 10, fill: "rgb(100 116 139)" },
                }}
            />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
                formatter={(value, name) => [
                  `${Number(value) >= 0 ? "+" : ""}${Math.round(Number(value)).toLocaleString("it-IT")} €`,
                  name as string,
                ]}
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as
                    | { idx: number; date: string; label: string }
                    | undefined;
                  if (!row || row.idx === 0)
                    return it ? "Punto di partenza (nessun deal)" : "Starting point (no deals)";
                  const date = row.date ? ` · ${row.date}` : "";
                  return `${it ? "Deal" : "Deal"} #${row.idx} — ${row.label}${date}`;
                }}
              />
              {/* Legend lives in CurveVisibilityToolbar above — no Recharts Legend here
                  (it overlapped the X-axis caption). */}

              {/* HORIZONTAL BREAKEVEN — €0. The chart's defining reference:
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
                  value: it ? "Breakeven (€0)" : "Breakeven (€0)",
                  position: "insideRight",
                fontSize: 9,
                  fontWeight: 600,
                  fill: "#15803d",
                }}
              />

              {/* Optional horizontal TARGET line — what the user wants to
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
                      ? `Target: +${Math.round(targetEur).toLocaleString("it-IT")} €`
                      : `Target: +€${Math.round(targetEur).toLocaleString("it-IT")}`,
                  position: "insideTopRight",
                  fontSize: 9,
                    fill: "#b45309",
                }}
              />
            ) : null}

              {/* Vertical OGGI line — splits past entries (left) from
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
              {manualSizingEnabled && visibleCurves.portfolioManual ? (
                <Line
                  type="monotone"
                  dataKey="portfolioManualEur"
                  name={
                    it ? "Portfolio reale (manuale)" : "Real portfolio (manual)"
                  }
                  stroke="#6366f1"
                  strokeWidth={2.6}
                  strokeDasharray="2 4"
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
              {simLoopManualSizingEnabled && visibleCurves.simLoopManual ? (
                <Line
                  type="monotone"
                  dataKey="simLoopManualEur"
                  name={it ? "Sim loop (manuale)" : "Sim loop (manual)"}
                  stroke="#7c3aed"
                  strokeWidth={2.6}
                  strokeDasharray="2 4"
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
            ? `Asse X: i deal entrano nel book in ordine cronologico (data acquisto per il portafoglio reale, data catalyst per il sim loop). Asse Y: gain cumulato in € realizzato da ogni scenario, calcolato come Σ (quota_deal × capitale_totale × ritorno_24h_deal). Linea verde tratteggiata a €0 = breakeven (sopra = profitto netto, sotto = perdita). Quattro curve in matrice 2×2 — verde = Portfolio reale, arancio = Sim loop; pieno = pesato, tratteggiato = uniforme. La linea rossa "OGGI" separa i deal già realizzati da quelli ancora futuri (catalyst date > oggi). Formula del weighting (per le curve piene): quota(deal) ∝ P(successo) × payoff, smorzato da confidence (LOW ×${DEFAULT_CONFIDENCE_MULTIPLIERS.low.toFixed(1)}, MED ×${DEFAULT_CONFIDENCE_MULTIPLIERS.medium.toFixed(1)}, HIGH ×${DEFAULT_CONFIDENCE_MULTIPLIERS.high.toFixed(1)}) e ridotto ×${DEFAULT_WEIGHTED_SIZING_CONFIG.patternPenalty.toFixed(1)} se matcha il pattern di Step 2. Più la curva piena sta sopra la tratteggiata dello stesso colore, più valore aggiunge il weighting; più alta è la coppia verde rispetto all'arancio, più il portfolio reale batte il sim loop.`
            : `X axis: deals enter the book in chronological order (purchase date for the real portfolio, catalyst date for the sim loop). Y axis: cumulative gain in € realised by each scenario, computed as Σ (deal_share × total_capital × deal_24h_return). Green dashed line at €0 = breakeven (above = net profit, below = net loss). Four curves in a 2×2 matrix — green = Real portfolio, orange = Sim loop; solid = weighted, dashed = uniform. The red "TODAY" line separates already-realised deals from future ones (catalyst date > today). Weighting formula (for solid curves): share(deal) ∝ P(success) × payoff, damped by confidence (LOW ×${DEFAULT_CONFIDENCE_MULTIPLIERS.low.toFixed(1)}, MED ×${DEFAULT_CONFIDENCE_MULTIPLIERS.medium.toFixed(1)}, HIGH ×${DEFAULT_CONFIDENCE_MULTIPLIERS.high.toFixed(1)}) and cut ×${DEFAULT_WEIGHTED_SIZING_CONFIG.patternPenalty.toFixed(1)} when the deal matches the Step 2 risk pattern. The further the solid line sits above the dashed one of the same colour, the more value the weighting is adding; the higher the green pair sits over the orange pair, the better the real portfolio beats the sim loop.`}
          {portfolioStatsWeighted.uniformFallbackActive ||
          simLoopStatsWeighted.uniformFallbackActive ? (
            <span className="block mt-0.5 text-amber-800 dark:text-amber-200 font-semibold">
              {it
                ? `⚠ ${
                    portfolioStatsWeighted.uniformFallbackActive && simLoopStatsWeighted.uniformFallbackActive
                      ? "Né portfolio né sim loop hanno deal con gain SDS positivo"
                      : portfolioStatsWeighted.uniformFallbackActive
                        ? "Nessun deal del portfolio con gain SDS positivo"
                        : "Nessun deal del sim loop con gain SDS positivo"
                  }: il sizing pesato è caduto sull'uniforme su quel set (curva piena e tratteggiata sovrapposte).`
                : `⚠ ${
                    portfolioStatsWeighted.uniformFallbackActive && simLoopStatsWeighted.uniformFallbackActive
                      ? "Neither portfolio nor sim loop have any deal with positive SDS gain"
                      : portfolioStatsWeighted.uniformFallbackActive
                        ? "No portfolio deal has positive SDS gain"
                        : "No sim-loop deal has positive SDS gain"
                  }: weighted sizing fell back to uniform on that set (solid and dashed curves overlap).`}
            </span>
          ) : null}
        </p>

        {/* KPI cards: symmetric 2×2 matrix — rows = Portfolio / Sim loop,
            columns = weighted / uniform. Each card shows the FINAL
            cumulative € gain that scenario reaches once every deal in
            its universe is funded (= the rightmost point of the matching
            line on the chart above). Extra cards appear when either
            manual sizing mode is enabled. */}
        <div
          className={`grid gap-2 ${
            manualSizingEnabled && simLoopManualSizingEnabled
              ? "grid-cols-2 lg:grid-cols-8"
              : manualSizingEnabled || simLoopManualSizingEnabled
                ? "grid-cols-2 lg:grid-cols-7"
                : "grid-cols-2 lg:grid-cols-6"
          }`}
        >
          <CumulativeGainKpiCard
            label={it ? "Gain portfolio (pesato)" : "Gain — real portfolio (weighted)"}
            sub={it ? "verde pieno" : "solid green"}
            valueEur={finalGains.portfolioWeighted}
            tone="emerald"
            it={it}
            disabled={!weightedGate.ok}
          />
          <CumulativeGainKpiCard
            label={it ? "Gain portfolio (uniforme)" : "Gain — real portfolio (uniform)"}
            sub={it ? "verde tratteggiato" : "dashed green"}
            valueEur={finalGains.portfolioUniform}
            tone="emeraldSoft"
            it={it}
          />
          <CumulativeGainKpiCard
            label={it ? "Gain sim loop (pesato)" : "Gain — sim loop (weighted)"}
            sub={it ? "arancio pieno" : "solid orange"}
            valueEur={finalGains.simLoopWeighted}
            tone="amber"
            it={it}
            disabled={!weightedGate.ok}
          />
          <CumulativeGainKpiCard
            label={it ? "Gain sim loop (uniforme)" : "Gain — sim loop (uniform)"}
            sub={it ? "arancio tratteggiato" : "dashed orange"}
            valueEur={finalGains.simLoopUniform}
            tone="amberSoft"
            it={it}
          />
          {manualSizingEnabled ? (
            <CumulativeGainKpiCard
              label={it ? "Gain portfolio (manuale)" : "Gain — portfolio (manual)"}
              sub={it ? "indaco tratteggiato" : "dashed indigo"}
              valueEur={finalGains.portfolioManual}
              tone="indigo"
              it={it}
            />
          ) : null}
          {simLoopManualSizingEnabled ? (
            <CumulativeGainKpiCard
              label={it ? "Gain sim loop (manuale)" : "Gain — sim loop (manual)"}
              sub={it ? "viola tratteggiato" : "dashed violet"}
              valueEur={finalGains.simLoopManual}
              tone="violet"
              it={it}
            />
          ) : null}
          {portfolioWeightSimExp ? (
            <CumulativeGainKpiCard
              label={it ? "Gain portfolio (Weight Sim Exp)" : "Gain — portfolio (Weight Sim Exp)"}
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
              label={it ? "Gain sim loop (Weight Sim Exp)" : "Gain — sim loop (Weight Sim Exp)"}
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
            onApplyPortfolio={
              portfolioWeightSimExp
                ? () => {
                    setManualSizingEnabled(true);
                    const raw = optimizedSharesToRawWeights(portfolioWeightSimExp.shares);
                    const next: Record<string, number> = {};
                    mineDeals24h.forEach((d, i) => {
                      next[d.rowKey] = raw[i] ?? 0;
                    });
                    setManualWeightsByRowKey(next);
                  }
                : undefined
            }
            onApplySimLoop={
              simLoopWeightSimExp
                ? () => {
                    setSimLoopManualSizingEnabled(true);
                    const raw = optimizedSharesToRawWeights(simLoopWeightSimExp.shares);
                    const next: Record<string, number> = {};
                    simLoopDeals24h.forEach((d, i) => {
                      next[d.rowKey] = raw[i] ?? 0;
                    });
                    setSimLoopManualWeightsByRowKey(next);
                  }
                : undefined
            }
            onPatternApproved={onPatternChanged}
          />
        ) : null}

        {/* Manual allocation switch + sliders — one panel per universe.
            Both are off by default to keep the surface compact for users
            who just want to read the Step 2 recommendation. When ON, an
            additional dashed curve appears on the chart and the slider
            table lets the user dial the weight of every company in that
            universe independently.

            Layout: render the two panels in a grid so the sim-loop one
            (violet) is always discoverable next to the portfolio one
            (indigo) — previously the sim-loop panel ended up below the
            portfolio panel and was missed by users who only looked at the
            first one. */}
        {(comparison?.mineDeals.length || comparison?.simLoopDeals.length) ? (
          <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {comparison?.mineDeals.length ? (
              <ManualSizingPanel
                enabled={manualSizingEnabled}
                onToggle={() => setManualSizingEnabled((v) => !v)}
                deals={comparison.mineDeals}
                rawWeights={manualRawWeights}
                shares={manualShares}
                onSetWeight={(rowKey, w) =>
                  setManualWeightsByRowKey((prev) => ({ ...prev, [rowKey]: w }))
                }
                onResetToWeighted={() => setManualWeightsByRowKey({})}
                onResetToUniform={() => {
                  const next: Record<string, number> = {};
                  for (const d of comparison.mineDeals) {
                    next[d.rowKey] = 100;
                  }
                  setManualWeightsByRowKey(next);
                }}
                weightedGateOk={weightedGate.ok}
                topCapital={effectiveCapital}
                it={it}
                variant="portfolio"
                title={
                  it
                    ? "Allocazione manuale — portfolio reale"
                    : "Manual allocation — real portfolio"
                }
                description={
                  it
                    ? "Alternativa al pattern di Step 2 sul portafoglio reale: trascina le barre per decidere quanto capitale destinare a ciascuna società aperta. La 5ª curva indaco sul grafico aggiorna il breakeven 24h in tempo reale."
                    : "Alternative to the Step 2 pattern on the real portfolio: drag the bars to decide how much capital each open position gets. The 5th indigo curve on the chart updates the 24h breakeven live."
                }
              />
            ) : null}

            {comparison?.simLoopDeals.length ? (
              <ManualSizingPanel
                enabled={simLoopManualSizingEnabled}
                onToggle={() => setSimLoopManualSizingEnabled((v) => !v)}
                deals={comparison.simLoopDeals}
                rawWeights={simLoopManualRawWeights}
                shares={simLoopManualShares}
                onSetWeight={(rowKey, w) =>
                  setSimLoopManualWeightsByRowKey((prev) => ({ ...prev, [rowKey]: w }))
                }
                onResetToWeighted={() => setSimLoopManualWeightsByRowKey({})}
                onResetToUniform={() => {
                  const next: Record<string, number> = {};
                  for (const d of comparison.simLoopDeals) {
                    next[d.rowKey] = 100;
                  }
                  setSimLoopManualWeightsByRowKey(next);
                }}
                weightedGateOk={weightedGate.ok}
                topCapital={effectiveCapital}
                it={it}
                variant="simLoop"
                title={
                  it
                    ? "Allocazione manuale — sim loop"
                    : "Manual allocation — sim loop"
                }
                description={
                  it
                    ? "Stesso meccanismo sull'universo BUY del sim loop: scegli quanto capitale dare a ciascun deal. La 6ª curva viola sul grafico mostra il breakeven 24h della tua mix manuale del sim loop."
                    : "Same mechanism on the sim loop BUY universe: dial how much capital each deal receives. The 6th violet curve on the chart shows the 24h breakeven of your manual sim-loop mix."
                }
              />
            ) : null}
          </div>

          <div className="mt-3">
            <ManualAllocationSynthesizerPanel
              bundle={manualAllocationBundle}
              outcomes={manualSynthOutcomes}
              it={it}
              onPatternApproved={onPatternChanged}
            />
          </div>
          </>
        ) : null}

        {/* Advantage caption — small line under the KPI matrix so the
            cards stay focused on the final gain; the weighting "value-add"
            (€ delta between weighted and uniform on the real portfolio)
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

        {/* Inspectable per-deal breakdown — collapsed by default. Every row
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
                ? `Scomposizione per deal — sizing pesato (${portfolioStatsForBreakdown.perDealBreakdown.length} posizioni)`
                : `Per-deal breakdown — weighted sizing (${portfolioStatsForBreakdown.perDealBreakdown.length} positions)`}
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
                    <th className="font-medium px-1.5 py-1 text-right">EV/€</th>
                    <th className="font-medium px-1.5 py-1 text-right">{it ? "Conf." : "Conf."}</th>
                    <th className="font-medium px-1.5 py-1 text-right">×conf.</th>
                    <th className="font-medium px-1.5 py-1 text-right">Pat.</th>
                    <th className="font-medium px-1.5 py-1 text-right">×pat.</th>
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
                ? "EV/€ = P(successo) × Gain SDS / 100 (ritorno atteso al target, pesato sulla probabilità). Adjusted = EV/€ × conf.multiplier × pattern factor. Quota = Adjusted / Σ Adjusted. Quando P(successo), SDS o pattern cambiano, la quota si aggiorna live."
                : "EV/€ = P(success) × SDS gain / 100 (probability-weighted expected return at target). Adjusted = EV/€ × conf.multiplier × pattern factor. Share = Adjusted / Σ Adjusted. As P(success), SDS or pattern data change, the share updates live."}
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
 *
 * Companies inside each universe are NOT controlled here — that's the role
 * of the per-company sliders in `ManualSizingPanel` (set a slider to 0 to
 * defund a single company within the manual curve of that universe).
 */
function CurveVisibilityToolbar<
  K extends
    | "portfolioUniform"
    | "portfolioWeighted"
    | "portfolioManual"
    | "portfolioWeightSimExp"
    | "simLoopUniform"
    | "simLoopWeighted"
    | "simLoopManual"
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
    /** Hide the chip entirely when the matching curve cannot exist yet
     *  (e.g. a manual curve while its panel is disabled). */
    available: boolean;
    /** Shown but not clickable — weighted gate not satisfied. */
    disabled?: boolean;
    name: string;
    color: string;
    /** Dashed swatch hint — matches the dashed pattern on the chart. */
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
                  ? "Sizing pesato disabilitato — dati insufficienti"
                  : "Weighted sizing disabled — insufficient calibration data"
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
  /** Final cumulative gain (€) reached by the scenario after every deal
   *  in its universe has been funded — i.e. the rightmost point of the
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
        <p className="text-lg font-bold tabular-nums mt-0.5 text-ink-muted">—</p>
      ) : (
        <p
          className={`text-lg font-bold tabular-nums mt-0.5 ${
            positive
              ? "text-emerald-700 dark:text-emerald-300"
              : "text-rose-700 dark:text-rose-300"
          }`}
        >
          {positive ? "+" : ""}
          {Math.round(valueEur).toLocaleString("it-IT")} €
        </p>
      )}
      <p className="text-[9px] opacity-65 leading-snug mt-0.5">
        {disabled
          ? it
            ? "Disabilitato — calibrazione insufficiente"
            : "Disabled — insufficient calibration"
          : targetEur != null && targetReached != null ? (
            targetReached
              ? it
                ? `target +${Math.round(targetEur).toLocaleString("it-IT")} € raggiungibile`
                : `target +€${Math.round(targetEur).toLocaleString("it-IT")} reachable`
              : it
                ? `sotto target +${Math.round(targetEur).toLocaleString("it-IT")} € (max possibile)`
                : `below target +€${Math.round(targetEur).toLocaleString("it-IT")} (best possible)`
          ) : it
            ? positive
              ? "in profitto rispetto al breakeven (€0)"
              : "in perdita rispetto al breakeven (€0)"
            : positive
              ? "in profit vs breakeven (€0)"
              : "in loss vs breakeven (€0)"}
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
  /** € delta between the weighted-portfolio and uniform-portfolio final
   *  cumulative gain. Positive = the risk weighting added value vs the
   *  naive uniform mix on the real portfolio. */
  weightingAdvantageEur: number;
  /** € delta between the weighted-portfolio and weighted-sim-loop final
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
          ? "Vantaggio del weighting non calcolato finché il sizing pesato resta disabilitato."
          : "Weighting advantage is not shown while weighted sizing remains disabled."}
      </p>
    );
  }
  const positiveW = weightingAdvantageEur >= 0;
  const positiveS = simLoopAdvantageEur >= 0;
  const fmt = (v: number) =>
    `${v >= 0 ? "+" : ""}${Math.round(v).toLocaleString("it-IT")} €`;
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
          {it ? " (pesato − uniforme)." : " (weighted − uniform)."}
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
            ? " (portfolio pesato − sim loop pesato)."
            : " (weighted portfolio − weighted sim loop)."}
      </span>
      </span>
    </div>
  );
}

/**
 * Manual per-company allocation panel.
 *
 * Renders a toggle chip + (when enabled) a list of sliders, one per portfolio
 * deal, that let the user dial the relative weight of each company. The raw
 * weights are passed in as a flat array (aligned with `deals`), and the
 * panel reports back through `onSetWeight`. Normalisation to shares is the
 * parent's responsibility — the panel just shows whatever shares it receives.
 *
 * UX notes:
 *  - Sliders are scaled 0..200 (vs the implicit 100-baseline) so the user
 *    can both halve and roughly double a single position without ever
 *    needing to retune the others. Normalisation makes raw values
 *    self-rescaling.
 *  - "Reset → Step 2 (pesato)" wipes every explicit override so the manual
 *    curve falls back onto the weighted curve. "Reset → uniforme" forces
 *    every weight to the same baseline so the manual curve overlays the
 *    uniform line. Both are reachable in one click — useful for A/B-ing.
 */
/**
 * Tailwind / hex constants per visual variant — keeps the indigo (portfolio)
 * and violet (sim loop) palettes encapsulated so the only thing the call site
 * picks is `variant`.
 */
const MANUAL_PANEL_VARIANTS = {
  portfolio: {
    accentHex: "#6366f1",
    containerCls:
      "rounded-md border border-indigo-200/60 dark:border-indigo-800/40 bg-indigo-50/30 dark:bg-indigo-950/15 px-3 py-2 space-y-2",
    chipOnCls: "border-indigo-500 bg-indigo-600 text-white",
    chipOffCls:
      "border-indigo-300/60 dark:border-indigo-700/60 bg-white/70 dark:bg-surface/70 text-indigo-900 dark:text-indigo-100 hover:bg-indigo-50 dark:hover:bg-indigo-950/30",
    linkCls: "text-indigo-700 dark:text-indigo-300",
    rowHoverCls: "hover:bg-indigo-100/40 dark:hover:bg-indigo-900/20",
    accentCls: "accent-indigo-500",
  },
  simLoop: {
    accentHex: "#7c3aed",
    containerCls:
      "rounded-md border border-violet-200/60 dark:border-violet-800/40 bg-violet-50/30 dark:bg-violet-950/15 px-3 py-2 space-y-2",
    chipOnCls: "border-violet-500 bg-violet-600 text-white",
    chipOffCls:
      "border-violet-300/60 dark:border-violet-700/60 bg-white/70 dark:bg-surface/70 text-violet-900 dark:text-violet-100 hover:bg-violet-50 dark:hover:bg-violet-950/30",
    linkCls: "text-violet-700 dark:text-violet-300",
    rowHoverCls: "hover:bg-violet-100/40 dark:hover:bg-violet-900/20",
    accentCls: "accent-violet-500",
  },
} as const;

function ManualSizingPanel({
  enabled,
  onToggle,
  deals,
  rawWeights,
  shares,
  onSetWeight,
  onResetToWeighted,
  onResetToUniform,
  weightedGateOk = true,
  topCapital,
  it,
  variant,
  title,
  description,
}: {
  enabled: boolean;
  onToggle: () => void;
  deals: ComparisonDeal[];
  /** Raw 0..200 slider weights per deal (length === deals.length). */
  rawWeights: number[];
  /** Normalised shares per deal (Σ ≈ 1). */
  shares: number[];
  onSetWeight: (rowKey: string, weight: number) => void;
  onResetToWeighted: () => void;
  onResetToUniform: () => void;
  weightedGateOk?: boolean;
  topCapital: number;
  it: boolean;
  /** Colour palette + chart-curve hint shown to the user. `portfolio` =
   *  indigo (matches the 5th line on the chart); `simLoop` = violet (matches
   *  the 6th line). */
  variant: "portfolio" | "simLoop";
  title: string;
  description: string;
}) {
  const v = MANUAL_PANEL_VARIANTS[variant];
  const totalRaw = rawWeights.reduce((s, v) => s + v, 0);
  const fmtEurNoSign = (val: number): string =>
    `${Math.round(val).toLocaleString("it-IT")} €`;

  return (
    <div className={v.containerCls}>
      <header className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={enabled}
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold border transition ${
            enabled ? v.chipOnCls : v.chipOffCls
          }`}
          title={
            it
              ? "Attiva l'allocazione manuale per società: una barra per ciascuna posizione di questo universo."
              : "Enable manual per-company allocation: one slider per position in this universe."
          }
        >
          <span
            className="inline-block w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: enabled ? "#fff" : v.accentHex }}
            aria-hidden
          />
          {title}
        </button>
        <p className="text-[10px] text-ink-muted leading-snug max-w-md">
          {description}
        </p>
        {enabled ? (
          <>
            <span className="grow" />
            <button
              type="button"
              onClick={onResetToWeighted}
              disabled={!weightedGateOk}
              className={`text-[10px] font-medium ${v.linkCls} ${
                weightedGateOk ? "hover:underline" : "opacity-40 cursor-not-allowed"
              }`}
              title={
                weightedGateOk
                  ? it
                    ? "Riporta tutte le barre al valore del sizing pesato (Step 2)."
                    : "Reset every slider to the weighted Step 2 sizing."
                  : it
                    ? "Sizing pesato disabilitato — dati insufficienti."
                    : "Weighted sizing disabled — insufficient calibration data."
              }
            >
              {it ? "Reset → pesato" : "Reset → weighted"}
            </button>
            <button
              type="button"
              onClick={onResetToUniform}
              className={`text-[10px] font-medium ${v.linkCls} hover:underline`}
              title={
                it
                  ? "Imposta tutte le barre allo stesso peso: ogni società prende la stessa quota."
                  : "Set every slider to the same weight: every company gets the same share."
              }
            >
              {it ? "Reset → uniforme" : "Reset → uniform"}
            </button>
          </>
        ) : null}
      </header>

      {enabled ? (
        <div className="space-y-1">
          <div className="grid grid-cols-[minmax(96px,1fr)_minmax(140px,2fr)_64px_88px] gap-2 text-[9px] uppercase tracking-wider text-ink-muted font-semibold px-1">
            <span>{it ? "Società" : "Company"}</span>
            <span>{it ? "Peso" : "Weight"}</span>
            <span className="text-right">{it ? "Quota" : "Share"}</span>
            <span
              className="text-right"
              title={
                it
                  ? `Capitale destinato a questa società quando il pot totale è ${fmtEurNoSign(topCapital)}.`
                  : `Capital allocated to this company when the total pot is ${fmtEurNoSign(topCapital)}.`
              }
            >
              {it ? "€ @ pot" : "€ @ pot"}
            </span>
          </div>
          {deals.map((d, i) => {
            const weight = rawWeights[i] ?? 0;
            const share = shares[i] ?? 0;
            const eurAtPot = share * topCapital;
            return (
              <div
                key={d.rowKey}
                className={`grid grid-cols-[minmax(96px,1fr)_minmax(140px,2fr)_64px_88px] gap-2 items-center px-1 py-0.5 rounded ${v.rowHoverCls}`}
              >
                <span
                  className="text-[11px] font-semibold text-ink truncate"
                  title={d.label}
                >
                  {d.ticker}
                </span>
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={1}
                  value={weight}
                  onChange={(e) =>
                    onSetWeight(d.rowKey, Number(e.target.value))
                  }
                  aria-label={`${d.ticker} weight`}
                  className={`w-full ${v.accentCls}`}
                />
                <span className="text-right text-[10px] tabular-nums text-ink">
                  {(share * 100).toFixed(1)}%
                </span>
                <span className="text-right text-[10px] tabular-nums text-ink-muted">
                  {fmtEurNoSign(eurAtPot)}
                </span>
              </div>
            );
          })}
          <p className="text-[9px] text-ink-muted leading-snug mt-1 px-1">
            {it
              ? `I pesi grezzi (0–200) vengono normalizzati a 100 % per ottenere le quote. Σ pesi correnti = ${totalRaw.toFixed(0)} → ogni quota = peso / Σ. Sposta una barra a 0 per disinvestire una società; spostala a 200 per raddoppiare la sua esposizione relativa al resto dell'universo.`
              : `Raw weights (0–200) are normalised to 100 % to produce the shares. Σ weights = ${totalRaw.toFixed(0)} → each share = weight / Σ. Drag a bar to 0 to defund a company; drag it to 200 to double its exposure relative to the rest of the universe.`}
          </p>
        </div>
      ) : null}
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
      <td className="px-1.5 py-1 text-right">{`${row.sdsExpectedGainPct.toFixed(1)}%`}</td>
      <td className="px-1.5 py-1 text-right">{`${(row.evPerEur * 100).toFixed(2)}%`}</td>
      <td className="px-1.5 py-1 text-right">{confLabel}</td>
      <td className="px-1.5 py-1 text-right">{row.confidenceMultiplier.toFixed(2)}</td>
      <td className="px-1.5 py-1 text-right">{row.matchesStep2Pattern ? "✓" : "—"}</td>
      <td className="px-1.5 py-1 text-right">{row.patternPenaltyFactor.toFixed(2)}</td>
      <td className="px-1.5 py-1 text-right">{`${(row.adjustedScore * 100).toFixed(3)}%`}</td>
      <td className="px-1.5 py-1 text-right font-semibold text-ink">
        {`${(row.sizeShare * 100).toFixed(1)}%`}
      </td>
    </tr>
  );
}

