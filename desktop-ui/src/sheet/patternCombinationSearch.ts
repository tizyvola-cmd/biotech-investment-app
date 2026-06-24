/**
 * Pattern Combination Search Engine (PCSE) — Phase 1a.
 *
 * Brute-force enumeration of AND-combinations across entry-state feature
 * dimensions, scored for stability on both historical closed trades and
 * live open positions (portfolio + sim-loop).
 *
 * Design decisions (fixed — not configurable at runtime):
 *  - Only AND operator in v1.
 *  - Max 3 dimensions per combination.
 *  - Dimensions and bucket labels are IDENTICAL to those used by Phase A
 *    screening (lossRiskScreening.ts) — no new buckets introduced here.
 *  - stabilityScore is an explicit weighted formula, not a statistical test.
 *  - Pure function — no side effects, no storage. Callers handle persistence.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { RiskFeatureDimension } from "../riskPattern/riskPatternTypes";
import {
  extractAllRowFeatures,
  extractFeaturesForOpenDeals,
} from "../riskPattern/lossRiskScreening";
import { LOSS_THRESHOLD_PCT } from "./lossAuditAnalysis";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";

/** Custom event dispatched on window when the PCSE scheduler triggers a new run.
 *  UI components (e.g. CapDivStep2RiskView) listen for this to re-read history. */
export const PCSE_SEARCH_REQUESTED_EVENT = "supernova:pcse-search-requested";

// ── Calibration constants (tune after seeing real results) ─────────────────

/** Points lost per percentage-point of liftDelta (historical vs live). */
export const K_DELTA = 8;

/** Live matches needed before max confidence penalty drops to 0. */
export const MIN_LIVE_MATCHES_FOR_FULL_CONFIDENCE = 5;

/** Historical n needed before max historical penalty drops to 0. */
export const MIN_HISTORICAL_N_FOR_FULL_CONFIDENCE = 8;

/** Minimum historical n for a combination to be included in output at all. */
export const MIN_HISTORICAL_N_FILTER = 3;

/** Minimum live matches for a combination to appear in the "validated" tier. */
export const MIN_LIVE_MATCHES_FILTER = 1;

/** Lift threshold below which a combination is not considered meaningful. */
export const MIN_LIFT_TO_INCLUDE = 1.05;

/** Promote to patternProposalStore when all three hold. */
export const PROMOTION_MIN_LIFT = 1.3;
export const PROMOTION_MAX_LIFT_DELTA_PP = 3;
export const PROMOTION_MIN_LIVE_MATCHES = 3;

// ── Feature dimension registry ─────────────────────────────────────────────

/**
 * Subset of RiskFeatureDimension that PCSE actually enumerates.
 * clinicalIndication excluded: too many unique values → combinatorial explosion.
 */
export type PcseFeatureDimension = Extract<
  RiskFeatureDimension,
  "sdsBucket" | "clinicalPhase" | "pplanBucket" | "daysToCdBucket" | "precdSlopeSign"
>;

export const PCSE_DIMENSIONS: PcseFeatureDimension[] = [
  "clinicalPhase",
  "sdsBucket",
  "pplanBucket",
  "daysToCdBucket",
  "precdSlopeSign",
];

// ── Core types ─────────────────────────────────────────────────────────────

export type CombinationCandidate = {
  /** Ordered list of dimensions included in this combination (AND). */
  dimensions: PcseFeatureDimension[];
  /** Bucket value for each dimension, same order. */
  cells: string[];
  /** Always "AND" in v1. Field kept for future extensibility. */
  operator: "AND";
};

export type CombinationResult = {
  candidate: CombinationCandidate;
  /** Human-readable label: "clinicalPhase=Phase 1 AND sdsBucket=SDS <40 (Low)". */
  label: string;
  /** Historical closed trades (ground truth). */
  historicalN: number;
  historicalLossCount: number;
  historicalLossPct: number;
  /** Lift vs global base loss rate. > 1 = riskier than average. */
  historicalLift: number;
  /** Open positions (portfolio + sim loop) matching this combination. */
  liveMatchCount: number;
  /**
   * Loss rate on live matches that have since resolved (closed after the
   * PCSE snapshot was taken). null if no resolved live cases yet.
   */
  liveLossPct: number | null;
  /**
   * Expected lift degradation: historicalLift - (liveLossPct / baseLossRate).
   * Positive = pattern is weaker on new data. null if liveLossPct is null.
   */
  liftDelta: number | null;
  /** 0–100 stability score (formula in computeStabilityScore). */
  stabilityScore: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** True when all promotion thresholds are met. */
  promotionReady: boolean;
};

export type PcseRunResult = {
  computedAt: string;
  totalHistoricalN: number;
  globalLossRate: number;
  results: CombinationResult[];
};

// ── Combination enumeration ────────────────────────────────────────────────

function combinationsOf<T>(arr: T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (arr.length < size) return [];
  const [first, ...rest] = arr;
  const withFirst = combinationsOf(rest, size - 1).map((c) => [first!, ...c]);
  const withoutFirst = combinationsOf(rest, size);
  return [...withFirst, ...withoutFirst];
}

function cartesianProduct(arrays: string[][]): string[][] {
  return arrays.reduce<string[][]>(
    (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
    [[]],
  );
}

/**
 * Enumerate all AND-combinations of 1, 2, or 3 dimensions.
 * Each dimension contributes exactly one bucket value per combination.
 * Total combinations with all 5 dims at realistic bucket counts is well
 * below 1000 — safe for synchronous in-browser computation.
 */
export function enumerateCombinations(
  featureMap: Map<string, Map<PcseFeatureDimension, string>>,
  maxDimensions: 1 | 2 | 3 = 3,
): CombinationCandidate[] {
  // Collect observed bucket values per dimension from actual data
  // (avoids enumerating phantom buckets that never appear in the dataset).
  const observedBuckets = new Map<PcseFeatureDimension, Set<string>>();
  for (const dimValues of featureMap.values()) {
    for (const [dim, val] of dimValues) {
      if (!observedBuckets.has(dim)) observedBuckets.set(dim, new Set());
      observedBuckets.get(dim)!.add(val);
    }
  }

  const activeDims = PCSE_DIMENSIONS.filter((d) => (observedBuckets.get(d)?.size ?? 0) > 0);
  const candidates: CombinationCandidate[] = [];

  for (let size = 1; size <= maxDimensions; size++) {
    for (const dimCombo of combinationsOf(activeDims, size)) {
      const bucketSets = dimCombo.map((d) => [...(observedBuckets.get(d) ?? [])]);
      for (const cellCombo of cartesianProduct(bucketSets)) {
        candidates.push({
          dimensions: dimCombo,
          cells: cellCombo,
          operator: "AND",
        });
      }
    }
  }
  return candidates;
}

// ── Feature map builders ───────────────────────────────────────────────────

/**
 * Flatten RowFeatures map to Map<rowKey, Map<PcseFeatureDimension, string>>.
 * Only includes rows where all dimensions in a given combination have values.
 */
function buildFlatFeatureMap(
  rowFeatures: ReturnType<typeof extractAllRowFeatures>,
): Map<string, Map<PcseFeatureDimension, string>> {
  const out = new Map<string, Map<PcseFeatureDimension, string>>();
  for (const [key, feats] of rowFeatures) {
    const row = new Map<PcseFeatureDimension, string>();
    if (feats.sdsBucket) row.set("sdsBucket", feats.sdsBucket);
    if (feats.clinicalPhase) row.set("clinicalPhase", feats.clinicalPhase);
    if (feats.pplanBucket) row.set("pplanBucket", feats.pplanBucket);
    if (feats.daysToCdBucket) row.set("daysToCdBucket", feats.daysToCdBucket);
    if (feats.precdSlopeSign) row.set("precdSlopeSign", feats.precdSlopeSign);
    if (row.size > 0) out.set(key, row);
  }
  return out;
}

// ── Row matching ───────────────────────────────────────────────────────────

function rowMatchesCandidate(
  rowDims: Map<PcseFeatureDimension, string>,
  candidate: CombinationCandidate,
): boolean {
  for (let i = 0; i < candidate.dimensions.length; i++) {
    const dim = candidate.dimensions[i]!;
    const expected = candidate.cells[i]!;
    if (rowDims.get(dim) !== expected) return false;
  }
  return true;
}

// ── Stability score ────────────────────────────────────────────────────────

function computeStabilityScore(
  liftDelta: number | null,
  liveMatchCount: number,
  historicalN: number,
): number {
  let score = 100;

  if (liftDelta != null) {
    score -= Math.abs(liftDelta) * K_DELTA;
  } else {
    // No live data yet — apply a fixed uncertainty penalty
    score -= 20;
  }

  const livePenalty =
    liveMatchCount < MIN_LIVE_MATCHES_FOR_FULL_CONFIDENCE
      ? (MIN_LIVE_MATCHES_FOR_FULL_CONFIDENCE - liveMatchCount) * 4
      : 0;
  score -= livePenalty;

  const histPenalty =
    historicalN < MIN_HISTORICAL_N_FOR_FULL_CONFIDENCE
      ? (MIN_HISTORICAL_N_FOR_FULL_CONFIDENCE - historicalN) * 2
      : 0;
  score -= histPenalty;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function computeConfidence(
  stabilityScore: number,
  liveMatchCount: number,
  historicalN: number,
): "HIGH" | "MEDIUM" | "LOW" {
  if (stabilityScore >= 75 && liveMatchCount >= MIN_LIVE_MATCHES_FOR_FULL_CONFIDENCE && historicalN >= MIN_HISTORICAL_N_FOR_FULL_CONFIDENCE) {
    return "HIGH";
  }
  if (stabilityScore >= 50 && liveMatchCount >= 2) return "MEDIUM";
  return "LOW";
}

function candidateLabel(c: CombinationCandidate): string {
  return c.dimensions.map((d, i) => `${d}=${c.cells[i]}`).join(" AND ");
}

// ── Main run function ──────────────────────────────────────────────────────

export type PcseInput = {
  /** Ground-truth closed trades. */
  closedRows: SimOutcomeRow[];
  /**
   * Open deals for live matching (portfolio + sim-loop).
   * Shape mirrors what extractFeaturesForOpenDeals expects.
   */
  openDeals: Array<{ rowKey: string; ticker: string; cells: Record<string, string> }>;
  /**
   * Closed trades that were previously "open" at the last snapshot — used to
   * compute liveLossPct on formerly-open matches that have now resolved.
   * Pass [] on first run.
   */
  resolvedLiveRows: SimOutcomeRow[];
  /** Row keys that were matched as "live" in the previous snapshot. */
  previousLiveMatchKeys: string[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  maxDimensions?: 1 | 2 | 3;
};

/**
 * Run the full PCSE enumeration.
 *
 * Pure function — no side effects. Returns a `PcseRunResult` that the
 * caller must persist via `patternSearchHistory.ts`.
 */
export function runPatternCombinationSearch(input: PcseInput): PcseRunResult {
  const ctx = { simTable: input.simTable, sdsRows: input.sdsRows };

  // Extract features for historical closed rows
  const historicalFeatureMap = extractAllRowFeatures(input.closedRows, ctx);
  const historicalFlat = buildFlatFeatureMap(historicalFeatureMap);

  // Extract features for open deals
  const liveFeatureMapRaw = extractFeaturesForOpenDeals(input.openDeals, ctx);
  const liveFlat = buildFlatFeatureMap(
    new Map(
      [...liveFeatureMapRaw].map(([k, v]) => [
        k,
        {
          rowKey: k,
          sdsBucket: v.sdsBucket,
          clinicalPhase: v.clinicalPhase,
          clinicalIndication: v.clinicalIndication,
          pplanBucket: v.pplanBucket,
          daysToCdBucket: v.daysToCdBucket,
          precdSlopeSign: v.precdSlopeSign,
        },
      ]),
    ),
  );

  // Extract features for resolved-live rows (formerly open, now closed)
  const resolvedFeatureMap = extractAllRowFeatures(input.resolvedLiveRows, ctx);
  const resolvedFlat = buildFlatFeatureMap(resolvedFeatureMap);
  const previousLiveSet = new Set(input.previousLiveMatchKeys);

  // Global stats on historical data
  const resolvedHistorical = input.closedRows.filter(
    (r) => r.pnl_pct != null && Number.isFinite(r.pnl_pct),
  );
  const totalHistoricalN = resolvedHistorical.length;
  const globalLosses = resolvedHistorical.filter((r) => (r.pnl_pct ?? 0) < LOSS_THRESHOLD_PCT).length;
  const globalLossRate = totalHistoricalN > 0 ? globalLosses / totalHistoricalN : 0;

  if (totalHistoricalN === 0) {
    return {
      computedAt: new Date().toISOString(),
      totalHistoricalN: 0,
      globalLossRate: 0,
      results: [],
    };
  }

  // Build a loss lookup for historical rows by rowKey
  const historicalLossByKey = new Map<string, boolean>();
  for (const r of resolvedHistorical) {
    const key = `${r.ticker}|${r.completion_date}`;
    historicalLossByKey.set(key, (r.pnl_pct ?? 0) < LOSS_THRESHOLD_PCT);
  }

  // Enumerate candidates from observed feature space
  const allFlat = new Map([...historicalFlat, ...liveFlat]);
  const candidates = enumerateCombinations(allFlat, input.maxDimensions ?? 3);

  const results: CombinationResult[] = [];

  for (const candidate of candidates) {
    // ── Historical scoring ────────────────────────────────────────────────
    let histN = 0;
    let histLoss = 0;
    for (const [key, rowDims] of historicalFlat) {
      if (!rowMatchesCandidate(rowDims, candidate)) continue;
      histN++;
      if (historicalLossByKey.get(key)) histLoss++;
    }

    if (histN < MIN_HISTORICAL_N_FILTER) continue;

    const histLossPct = histN > 0 ? (histLoss / histN) * 100 : 0;
    const historicalLift = globalLossRate > 0 ? histLossPct / 100 / globalLossRate : 1;

    if (historicalLift < MIN_LIFT_TO_INCLUDE) continue;

    // ── Live matching ─────────────────────────────────────────────────────
    let liveMatchCount = 0;
    for (const rowDims of liveFlat.values()) {
      if (rowMatchesCandidate(rowDims, candidate)) liveMatchCount++;
    }

    // ── Resolved-live scoring ─────────────────────────────────────────────
    // Among previously-live matched rows that have now closed, compute loss rate
    let resolvedLiveN = 0;
    let resolvedLiveLoss = 0;
    for (const [key, rowDims] of resolvedFlat) {
      if (!previousLiveSet.has(key)) continue;
      if (!rowMatchesCandidate(rowDims, candidate)) continue;
      resolvedLiveN++;
      const row = input.resolvedLiveRows.find(
        (r) => `${r.ticker}|${r.completion_date}` === key,
      );
      if (row && (row.pnl_pct ?? 0) < LOSS_THRESHOLD_PCT) resolvedLiveLoss++;
    }

    const liveLossPct =
      resolvedLiveN > 0 ? (resolvedLiveLoss / resolvedLiveN) * 100 : null;

    const liftDelta =
      liveLossPct != null && globalLossRate > 0
        ? historicalLift - liveLossPct / 100 / globalLossRate
        : null;

    const stabilityScore = computeStabilityScore(liftDelta, liveMatchCount, histN);
    const confidence = computeConfidence(stabilityScore, liveMatchCount, histN);

    const promotionReady =
      historicalLift >= PROMOTION_MIN_LIFT &&
      liveMatchCount >= PROMOTION_MIN_LIVE_MATCHES &&
      confidence === "HIGH" &&
      (liftDelta == null || Math.abs(liftDelta) <= PROMOTION_MAX_LIFT_DELTA_PP);

    results.push({
      candidate,
      label: candidateLabel(candidate),
      historicalN: histN,
      historicalLossCount: histLoss,
      historicalLossPct: Math.round(histLossPct * 10) / 10,
      historicalLift: Math.round(historicalLift * 100) / 100,
      liveMatchCount,
      liveLossPct: liveLossPct != null ? Math.round(liveLossPct * 10) / 10 : null,
      liftDelta: liftDelta != null ? Math.round(liftDelta * 100) / 100 : null,
      stabilityScore,
      confidence,
      promotionReady,
    });
  }

  // Sort by stabilityScore desc, then historicalLift desc
  results.sort((a, b) =>
    b.stabilityScore !== a.stabilityScore
      ? b.stabilityScore - a.stabilityScore
      : b.historicalLift - a.historicalLift,
  );

  return {
    computedAt: new Date().toISOString(),
    totalHistoricalN,
    globalLossRate: Math.round(globalLossRate * 1000) / 10,
    results,
  };
}

// ── Promotion helper ───────────────────────────────────────────────────────

/**
 * Filter results eligible for promotion to patternProposalStore.
 * Phase 1e will map these to PatternProposal format.
 */
export function filterPromotionCandidates(run: PcseRunResult): CombinationResult[] {
  return run.results.filter((r) => r.promotionReady);
}
