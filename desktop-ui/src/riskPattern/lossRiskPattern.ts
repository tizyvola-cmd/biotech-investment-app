/**
 * Phase B — Risk Pattern matching and stats.
 *
 * A `RiskPattern` is an AND of conditions on entry-state buckets. Given a set
 * of closed outcomes, we compute:
 *   - precision = P(loss | pattern fires) — positive predictive value for LOSS
 *   - recall    = P(pattern fires | loss) — fraction of losses we'd flag
 *   - lift      = loss_rate_when_fired / base_loss_rate
 *   - F-beta    = with β=F_BETA_FOR_PATTERN (default 0.5, favouring precision)
 *
 * In-sample vs out-of-sample is the caller's responsibility — this module is
 * pure. Pass the appropriate subset of outcomes for each evaluation.
 *
 * Pattern construction helpers also live here:
 *   - buildPatternFromTopBuckets: convenience builder that picks the most
 *     "loss-leaning" bucket of each of the top-K features (Phase A output).
 *   - matchPattern: returns true iff every condition's bucket value matches
 *     for the given row features.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import {
  confidenceFromN,
  DEFAULT_SHRINKAGE_CONFIG,
  type ShrinkageConfig,
} from "../calibration/calibrationTypes";
import { normalizedRowKey } from "../sheet/investSimKeys";
import { LOSS_THRESHOLD_PCT } from "../sheet/lossAuditAnalysis";
import {
  type RowFeatures,
  dimensionLabel,
} from "./lossRiskScreening";
import {
  F_BETA_FOR_PATTERN,
  type PatternCondition,
  type PatternStats,
  type PhaseAResult,
  type RiskFeatureDimension,
  type RiskPattern,
} from "./riskPatternTypes";

// ── Helpers ───────────────────────────────────────────────────────────────

function isResolved(r: SimOutcomeRow): boolean {
  return r.pnl_pct != null && Number.isFinite(r.pnl_pct);
}

function isLoss(r: SimOutcomeRow): boolean {
  return (r.pnl_pct ?? 0) < LOSS_THRESHOLD_PCT;
}

function pickBucket(
  features: RowFeatures,
  dim: RiskFeatureDimension,
): string | null {
  switch (dim) {
    case "sdsBucket":
      return features.sdsBucket;
    case "clinicalPhase":
      return features.clinicalPhase;
    case "clinicalIndication":
      return features.clinicalIndication;
    case "pplanBucket":
      return features.pplanBucket;
    case "daysToCdBucket":
      return features.daysToCdBucket;
    case "precdSlopeSign":
      return features.precdSlopeSign;
    default:
      return null;
  }
}

// ── Pattern matching ──────────────────────────────────────────────────────

/** A pattern fires when every condition is satisfied AND the row has a value
 *  for every conditioned dimension. Missing values short-circuit to NOT fire
 *  (we never flag a position on unknown features). */
export function matchPattern(
  pattern: RiskPattern,
  features: RowFeatures,
): boolean {
  if (!pattern.conditions || pattern.conditions.length === 0) return false;
  for (const cond of pattern.conditions) {
    const value = pickBucket(features, cond.dimension);
    if (value == null) return false; // can't evaluate → don't flag
    if (cond.operator === "in") {
      if (!cond.values.includes(value)) return false;
    } else {
      return false;
    }
  }
  return true;
}

// ── Stats computation ─────────────────────────────────────────────────────

function fBeta(precision: number, recall: number, beta: number): number {
  if (!Number.isFinite(precision) || !Number.isFinite(recall)) return 0;
  const b2 = beta * beta;
  const denom = b2 * precision + recall;
  if (denom <= 0) return 0;
  return ((1 + b2) * precision * recall) / denom;
}

/** Compute PatternStats for a given subset of outcomes. */
export function evaluatePatternStats(
  pattern: RiskPattern,
  outcomes: SimOutcomeRow[],
  featuresByRowKey: Map<string, RowFeatures>,
  config: ShrinkageConfig = DEFAULT_SHRINKAGE_CONFIG,
): PatternStats {
  let firedN = 0;
  let firedLosses = 0;
  let notFiredN = 0;
  let notFiredLosses = 0;

  for (const r of outcomes) {
    if (!isResolved(r)) continue;
    const features = featuresByRowKey.get(
      normalizedRowKey(r.ticker, r.completion_date),
    );
    if (!features) continue;
    const fires = matchPattern(pattern, features);
    const lost = isLoss(r);
    if (fires) {
      firedN += 1;
      if (lost) firedLosses += 1;
    } else {
      notFiredN += 1;
      if (lost) notFiredLosses += 1;
    }
  }

  const n = firedN + notFiredN;
  const totalLosses = firedLosses + notFiredLosses;
  const baseLossRate = n > 0 ? totalLosses / n : 0;
  const precision = firedN > 0 ? firedLosses / firedN : 0;
  const recall = totalLosses > 0 ? firedLosses / totalLosses : 0;
  const fb = fBeta(precision, recall, F_BETA_FOR_PATTERN);
  const lift =
    baseLossRate > 0 ? precision / baseLossRate : firedN > 0 ? Infinity : 0;
  const safeLift = Number.isFinite(lift) ? lift : 0;
  const confidence = confidenceFromN(firedN, config.confidence);

  return {
    n,
    firedN,
    firedLosses,
    notFiredN,
    notFiredLosses,
    precision,
    recall,
    fBeta: fb,
    lift: safeLift,
    baseLossRate,
    confidence,
    computedAt: new Date().toISOString(),
  };
}

// ── Pattern builders ──────────────────────────────────────────────────────

let patternIdSeq = 0;
function nextPatternId(): string {
  patternIdSeq += 1;
  return `pat-${Date.now().toString(36)}-${patternIdSeq.toString(36)}`;
}

/**
 * Convenience: given a PhaseAResult, build a RiskPattern that ANDs the most
 * loss-leaning bucket of each of the top-K features that pass the eligibility
 * floor.
 *
 * "Most loss-leaning" = the bucket inside the feature with the largest
 * shrunkLossRate (NOT the largest |lift-1| — we want PRESENCE of loss, not
 * absence). Buckets with eligibleForPattern=false are skipped; if no eligible
 * bucket exists in a feature, the feature is skipped entirely.
 */
export function buildPatternFromTopBuckets(
  phaseA: PhaseAResult,
  k: number = 3,
  outcomes: SimOutcomeRow[] = [],
  featuresByRowKey: Map<string, RowFeatures> = new Map(),
): RiskPattern | null {
  const conditions: PatternCondition[] = [];
  // The phaseA.features are already ranked by maxAbsLift desc.
  for (const f of phaseA.features) {
    if (conditions.length >= k) break;
    if (!f.hasVariance) continue;
    // Pick the bucket with the highest shrunkLossRate that is eligible
    const eligible = f.buckets.filter((b) => b.eligibleForPattern);
    if (eligible.length === 0) continue;
    eligible.sort((a, b) => b.shrunkLossRate - a.shrunkLossRate);
    const top = eligible[0];
    // Skip buckets whose loss rate is below the base rate (they are protective,
    // not risky — flagging them as a "risk" pattern would be wrong).
    if (top.shrunkLossRate <= f.baseLossRate) continue;
    conditions.push({
      dimension: f.dimension,
      operator: "in",
      values: [top.bucket],
      label: `${dimensionLabel(f.dimension)} = ${top.bucket}`,
    });
  }

  if (conditions.length === 0) return null;

  // Pre-compute in-sample stats if outcomes were provided
  const pattern: RiskPattern = {
    id: nextPatternId(),
    createdAt: new Date().toISOString(),
    conditions,
    name: describePattern({ id: "", createdAt: "", conditions, name: "", inSampleStats: PLACEHOLDER_STATS }),
    inSampleStats: PLACEHOLDER_STATS,
  };

  if (outcomes.length > 0 && featuresByRowKey.size > 0) {
    pattern.inSampleStats = evaluatePatternStats(
      pattern,
      outcomes,
      featuresByRowKey,
    );
  }

  return pattern;
}

const PLACEHOLDER_STATS: PatternStats = {
  n: 0,
  firedN: 0,
  firedLosses: 0,
  notFiredN: 0,
  notFiredLosses: 0,
  precision: 0,
  recall: 0,
  fBeta: 0,
  lift: 0,
  baseLossRate: 0,
  confidence: "low",
  computedAt: new Date(0).toISOString(),
};

// ── Empirical pattern search ──────────────────────────────────────────────

/** Default scoring function for the empirical pattern search.
 *
 * Combines three signals into a single scalar that rewards patterns which are
 *   (a) accurate on the trades they flag (precision),
 *   (b) statistically supported by enough fired trades (n via log),
 *   (c) concentrated noticeably above the base loss rate (lift, capped).
 *
 * The log on n dampens the runaway reward of including more trades just for
 * the sake of it, and the cap on lift avoids tiny eligible buckets winning
 * just because shrunkLossRate spiked. A bucket that fires on, say, 6 trades
 * with 5 losses (precision ≈83%, lift ≈3) at a 30% base rate scores higher
 * than one that fires on 20 trades with 11 losses (precision 55%, lift ≈1.8).
 */
export function defaultEmpiricalPatternScore(s: PatternStats): number {
  if (s.firedN <= 0) return 0;
  const liftCapped = Math.min(s.lift, 3);
  return s.precision * Math.log10(s.firedN + 1) * liftCapped;
}

/**
 * Empirical search for the AND-combination of (dimension, bucket) conditions
 * on closed outcomes that best predicts LOSS.
 *
 * Algorithm:
 *  1. Collect every Phase-A bucket that is eligibleForPattern AND has a
 *     shrunkLossRate above its feature's base rate (protective buckets are
 *     skipped — they don't belong in a loss-risk pattern).
 *  2. Enumerate all subsets of distinct dimensions of size 1..maxConditions,
 *     and for each subset take the cartesian product of buckets across the
 *     chosen dimensions. Each combination defines a candidate AND pattern.
 *  3. For every candidate, recompute precision/recall/lift/firedN on the same
 *     outcomes (this is the "simulation" — every candidate gets evaluated on
 *     real closed trades, not on a heuristic).
 *  4. Filter out candidates below the minFiredN, minLift, minPrecision floors.
 *  5. Return the candidate with the highest score (default
 *     defaultEmpiricalPatternScore), plus its full PatternStats and (for
 *     diagnostics) the top-N runners-up.
 *
 * The dimension count is small (6) and per-dimension buckets are small (3–5),
 * so the worst-case search space is ≲700 combinations at maxConditions=3 —
 * easily evaluable in tens of milliseconds even on a few hundred trades.
 */
export function searchBestPatternEmpirical(
  phaseA: PhaseAResult,
  outcomes: SimOutcomeRow[],
  featuresByRowKey: Map<string, RowFeatures>,
  opts: {
    /** Max AND-conditions to combine. Default 3. */
    maxConditions?: number;
    /** Minimum firedN on the candidate (anti-overfit). Default 5. */
    minFiredN?: number;
    /** Minimum lift over base rate. Default 1.0 (no protective patterns). */
    minLift?: number;
    /** Minimum in-sample precision. Default 0 (no floor). */
    minPrecision?: number;
    /** Custom score function. Default `defaultEmpiricalPatternScore`. */
    score?: (s: PatternStats) => number;
    /** How many runners-up to return for diagnostics. Default 4. */
    topAlternatives?: number;
  } = {},
): {
  pattern: RiskPattern;
  stats: PatternStats;
  alternatives: Array<{ pattern: RiskPattern; stats: PatternStats; score: number }>;
  /** Total candidates enumerated (useful for sanity checks in tests). */
  candidatesEvaluated: number;
} | null {
  const maxConditions = Math.max(1, opts.maxConditions ?? 3);
  const minFiredN = Math.max(1, opts.minFiredN ?? 5);
  const minLift = opts.minLift ?? 1.0;
  const minPrecision = opts.minPrecision ?? 0;
  const scoreFn = opts.score ?? defaultEmpiricalPatternScore;
  const keepAlternatives = Math.max(0, opts.topAlternatives ?? 4);

  // 1. Collect risky buckets, grouped by dimension
  type BucketRef = { dim: RiskFeatureDimension; bucket: string };
  const byDim = new Map<RiskFeatureDimension, BucketRef[]>();
  for (const f of phaseA.features) {
    if (!f.hasVariance) continue;
    for (const b of f.buckets) {
      if (!b.eligibleForPattern) continue;
      if (b.shrunkLossRate <= f.baseLossRate) continue;
      const ref: BucketRef = { dim: f.dimension, bucket: b.bucket };
      const arr = byDim.get(f.dimension) ?? [];
      arr.push(ref);
      byDim.set(f.dimension, arr);
    }
  }
  if (byDim.size === 0) return null;
  const dims = Array.from(byDim.keys());

  // 2-4. Enumerate and evaluate
  const scored: Array<{ pattern: RiskPattern; stats: PatternStats; score: number }> = [];
  let candidatesEvaluated = 0;

  const evaluateCombo = (
    chosenDims: RiskFeatureDimension[],
    chosenBuckets: string[],
  ): void => {
    const conditions: PatternCondition[] = chosenDims.map((d, i) => ({
      dimension: d,
      operator: "in",
      values: [chosenBuckets[i]],
      label: `${dimensionLabel(d)} = ${chosenBuckets[i]}`,
    }));
    const provisional: RiskPattern = {
      id: `cand-${candidatesEvaluated}`,
      createdAt: new Date(0).toISOString(),
      conditions,
      name: "",
      inSampleStats: PLACEHOLDER_STATS,
    };
    const stats = evaluatePatternStats(provisional, outcomes, featuresByRowKey);
    candidatesEvaluated += 1;
    if (
      stats.firedN < minFiredN ||
      stats.lift < minLift ||
      stats.precision < minPrecision
    ) {
      return;
    }
    const sc = scoreFn(stats);
    scored.push({
      pattern: { ...provisional, inSampleStats: stats },
      stats,
      score: sc,
    });
  };

  const enumerateBuckets = (chosenDims: RiskFeatureDimension[]): void => {
    const choices = chosenDims.map((d) => byDim.get(d) ?? []);
    if (choices.some((c) => c.length === 0)) return;
    const indices = new Array<number>(chosenDims.length).fill(0);
    while (true) {
      const buckets = indices.map((idx, i) => choices[i][idx].bucket);
      evaluateCombo(chosenDims, buckets);
      let k = indices.length - 1;
      while (k >= 0) {
        indices[k] += 1;
        if (indices[k] < choices[k].length) break;
        indices[k] = 0;
        k -= 1;
      }
      if (k < 0) break;
    }
  };

  const enumerateDimSubsets = (
    start: number,
    current: RiskFeatureDimension[],
  ): void => {
    if (current.length > 0) enumerateBuckets(current);
    if (current.length >= maxConditions) return;
    for (let i = start; i < dims.length; i += 1) {
      current.push(dims[i]);
      enumerateDimSubsets(i + 1, current);
      current.pop();
    }
  };

  enumerateDimSubsets(0, []);

  if (scored.length === 0) return null;

  // 5. Pick winner + runners-up
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];
  const finalPattern: RiskPattern = {
    ...winner.pattern,
    id: nextPatternId(),
    createdAt: new Date().toISOString(),
    name: describePattern(winner.pattern),
  };

  return {
    pattern: finalPattern,
    stats: winner.stats,
    alternatives: scored.slice(1, 1 + keepAlternatives),
    candidatesEvaluated,
  };
}

/** Build a pattern from a user-edited list of conditions (manual UI). */
export function buildPatternFromConditions(
  conditions: PatternCondition[],
  outcomes: SimOutcomeRow[] = [],
  featuresByRowKey: Map<string, RowFeatures> = new Map(),
): RiskPattern {
  const pattern: RiskPattern = {
    id: nextPatternId(),
    createdAt: new Date().toISOString(),
    conditions,
    name: describePattern({
      id: "",
      createdAt: "",
      conditions,
      name: "",
      inSampleStats: PLACEHOLDER_STATS,
    }),
    inSampleStats: PLACEHOLDER_STATS,
  };
  if (outcomes.length > 0 && featuresByRowKey.size > 0) {
    pattern.inSampleStats = evaluatePatternStats(
      pattern,
      outcomes,
      featuresByRowKey,
    );
  }
  return pattern;
}

/** Build a human-readable, language-agnostic description of a pattern. */
export function describePattern(p: RiskPattern): string {
  if (!p.conditions || p.conditions.length === 0) return "(no conditions)";
  return p.conditions
    .map((c) => {
      const vs = c.values.length === 1 ? c.values[0] : `[${c.values.join(", ")}]`;
      return `${c.dimension} ∈ ${vs}`;
    })
    .join(" AND ");
}

/** Pretty label for a single condition (UI-friendly, optionally localised). */
export function conditionLabel(
  c: PatternCondition,
  lang: "it" | "en" = "en",
): string {
  const dim = dimensionLabel(c.dimension, lang);
  if (c.values.length === 1) return `${dim} = ${c.values[0]}`;
  return `${dim} ∈ {${c.values.join(", ")}}`;
}

// ── Holdout split helpers ─────────────────────────────────────────────────

/** Split outcomes into in-sample (closed at or before approvedAt) and
 *  out-of-sample (closed strictly after approvedAt).
 *  We use `exit_ts` when present, falling back to `entry_ts`, falling back to
 *  the position in the array (less reliable but a safe last-resort). */
export function splitInVsOutOfSample(
  outcomes: SimOutcomeRow[],
  approvedAt: string | undefined,
): { inSample: SimOutcomeRow[]; outOfSample: SimOutcomeRow[] } {
  if (!approvedAt) {
    return { inSample: outcomes, outOfSample: [] };
  }
  const cutoff = new Date(approvedAt).getTime();
  if (!Number.isFinite(cutoff)) {
    return { inSample: outcomes, outOfSample: [] };
  }
  const inSample: SimOutcomeRow[] = [];
  const outOfSample: SimOutcomeRow[] = [];
  for (const r of outcomes) {
    const exitOrEntry =
      (r as SimOutcomeRow & { exit_ts?: string | null }).exit_ts ??
      (r as SimOutcomeRow & { entry_ts?: string | null }).entry_ts ??
      null;
    if (!exitOrEntry) {
      inSample.push(r);
      continue;
    }
    const t = new Date(exitOrEntry).getTime();
    if (!Number.isFinite(t)) {
      inSample.push(r);
      continue;
    }
    if (t > cutoff) outOfSample.push(r);
    else inSample.push(r);
  }
  return { inSample, outOfSample };
}
