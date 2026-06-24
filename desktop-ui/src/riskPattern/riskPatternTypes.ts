/**
 * Risk Pattern types — Step 2 of Capital & Diversification.
 *
 * Two-stage proposed/approved + rolling temporal holdout.
 *
 * Concepts:
 *  - A `PatternCondition` is one logical predicate on an entry-time feature
 *    (e.g. SDS bucket = "SDS <40 (Low)" OR P(plan) at entry < 35%).
 *  - A `RiskPattern` is an AND combination of conditions — a single, readable
 *    logical rule. We deliberately avoid 0-100 composite scores (RA Score
 *    lesson: opacity hides redundancy).
 *  - A pattern lives in three states: `proposed` (in the queue), `approved`
 *    (currently active), `rejected` / `superseded` (historical).
 *  - In-sample stats are computed on the trades used to build the pattern.
 *    Out-of-sample stats are computed on trades closed AFTER the pattern was
 *    approved (rolling holdout — never use a trade for both training and
 *    validation in the same evaluation step).
 *
 * Anti-overfit guards:
 *  - Min n threshold to ever generate a proposal (see PatternProposalConfig).
 *  - Min precision margin (in percentage points) to propose a replacement.
 *  - Bayesian shrinkage on the underlying univariate screening (Phase A).
 *  - "no enough data" labelled explicitly when n < threshold.
 *  - patternFlaggedButTaken tracking: if user overrode the filter and took the
 *    trade anyway, the outcome counts against the pattern's effective precision.
 */
import type {
  CalibrationDimension,
  ConfidenceLevel,
} from "../calibration/calibrationTypes";

// ── Conditions and Patterns ───────────────────────────────────────────────

/** Which dimension a condition is built on. Reuses Calibration dimensions
 *  plus extra entry-state dimensions we screen in Phase A but don't calibrate
 *  weights on.
 *
 *  Each value MUST be a pure "state at entry" feature — never post-entry
 *  observation. Post-entry features introduce temporal data leakage (see
 *  brief Part B, "feature derivate" section).
 *
 *  Currently supported sources:
 *    - sdsBucket          → featureSnapshotStore.sds (frozen)
 *    - clinicalPhase      → featureSnapshotStore.clinicalPhase (frozen)
 *    - clinicalIndication → featureSnapshotStore.clinicalIndication (frozen)
 *    - pplanBucket        → SimOutcomeRow.entry_affidabilita_pct (immutable)
 *    - daysToCdBucket     → SimOutcomeRow.days_to_cd at entry (immutable)
 *    - precdSlopeSign     → SimOutcomeRow.entry_slope_20d sign (immutable)
 */
export type RiskFeatureDimension =
  | CalibrationDimension // sdsBucket | clinicalPhase | clinicalIndication | pplanBucket
  | "daysToCdBucket"
  | "precdSlopeSign";

/** Operator for a condition. With bucketed features the only meaningful
 *  operator is "equals one of the listed buckets" (set membership). */
export type ConditionOperator = "in";

/** A single predicate. The condition fires when the row's bucketed value is
 *  contained in `values`. Multiple values inside one condition behave like an
 *  OR (e.g. ["Phase 1", "Preclinical"]). */
export type PatternCondition = {
  dimension: RiskFeatureDimension;
  operator: ConditionOperator;
  values: string[];
  /** Optional human label (UI). */
  label?: string;
};

/** A risk pattern is an AND of conditions. Empty conditions => empty pattern
 *  (matches nothing — a safe default). */
export type RiskPattern = {
  id: string;
  /** Created at — ISO string. */
  createdAt: string;
  /** Active/approved-at — ISO. Only present once approved. */
  approvedAt?: string;
  /** Conditions joined with AND. */
  conditions: PatternCondition[];
  /** Free-form name set at approval time (defaults to a generated description). */
  name: string;
  /** In-sample stats at the moment of approval (frozen snapshot — never updated). */
  inSampleStats: PatternStats;
};

/** Per-pattern statistics (precision / recall / lift / F-beta). */
export type PatternStats = {
  /** Sample size used to compute the stats. */
  n: number;
  /** Wins / losses inside the bucket where the pattern fires. */
  firedN: number;
  firedLosses: number;
  /** Wins / losses outside the bucket where the pattern fires. */
  notFiredN: number;
  notFiredLosses: number;
  /** P(loss | pattern fires) — positive predictive value for loss. */
  precision: number;
  /** P(pattern fires | loss) — fraction of losses we'd flag. */
  recall: number;
  /** F-beta with beta=0.5 (favours precision). */
  fBeta: number;
  /** Loss rate when pattern fires divided by base loss rate. */
  lift: number;
  /** Base loss rate on the same sample. */
  baseLossRate: number;
  /** Confidence enum from Calibration types. */
  confidence: ConfidenceLevel;
  /** ISO timestamp marking the latest trade included in this stat. */
  computedAt: string;
};

/** How the currently active pattern was last approved. */
export type PatternApprovalSource =
  | "engine"
  | "pcse"
  | "manual"
  | "auto_apply"
  | "unknown";

// ── Phase A — Univariate screening ────────────────────────────────────────

/** One bucket of one feature, with shrunk loss rate and lift vs base rate. */
export type UnivariateBucket = {
  dimension: RiskFeatureDimension;
  bucket: string;
  /** Trades observed in this bucket. */
  n: number;
  /** Losses observed in this bucket. */
  losses: number;
  /** Raw observed loss rate (n_loss / n) — UI must mark this as "raw". */
  rawLossRate: number;
  /** Bayesian-shrunk loss rate vs base rate. UI uses this for ranking. */
  shrunkLossRate: number;
  /** Lift = shrunkLossRate / baseLossRate. >1 = riskier than average. */
  lift: number;
  /** Confidence enum. */
  confidence: ConfidenceLevel;
  /** Whether n is large enough to be used for a pattern (n >= floor). */
  eligibleForPattern: boolean;
};

/** Screening result for one feature dimension. */
export type UnivariateScreening = {
  dimension: RiskFeatureDimension;
  /** Base loss rate computed on all trades that had a value for this feature. */
  baseLossRate: number;
  /** Total resolved trades that had a value for this feature. */
  totalN: number;
  /** Buckets sorted by |lift - 1| desc (most discriminating first). */
  buckets: UnivariateBucket[];
  /** Max |lift - 1| across buckets — used to rank features overall. */
  maxAbsLift: number;
  /** Has at least minCellsForVariance buckets with data. */
  hasVariance: boolean;
};

/** Full Phase A output: features ranked by maxAbsLift desc. */
export type PhaseAResult = {
  computedAt: string;
  /** Total resolved trades that fed the screening. */
  totalTrades: number;
  /** Global loss rate (used as shrinkage prior). */
  globalLossRate: number;
  /** Per-feature screening, sorted by maxAbsLift desc. */
  features: UnivariateScreening[];
};

// ── Phase B — Pattern stats (in/out of sample) ────────────────────────────

/** A pattern with both in-sample (from build time) and out-of-sample stats. */
export type PatternEvaluation = {
  pattern: RiskPattern;
  /** Stats on the same trades used to build the pattern. */
  inSample: PatternStats;
  /** Stats on trades closed AFTER pattern.approvedAt (rolling holdout). */
  outOfSample: PatternStats | null;
  /** How many trades the pattern would have flagged but were taken anyway. */
  flaggedButTakenCount: number;
};

// ── Proposal engine ───────────────────────────────────────────────────────

export type PatternProposalReason =
  | "currentPatternDegraded"
  | "betterPatternFound"
  | "firstPattern";

export type PatternProposalStatus = "pending" | "approved" | "rejected";

export type PatternProposal = {
  id: string;
  createdAt: string;
  /** row_key of the closed trade that triggered the proposal (null = manual). */
  triggeredByTradeId: string | null;
  reason: PatternProposalReason;
  /** State of the currently approved pattern at proposal time (or null if none). */
  currentPattern: {
    pattern: RiskPattern;
    outOfSampleStats: PatternStats | null;
  } | null;
  /** The new pattern proposed. Null when reason = currentPatternDegraded and
   *  no alternative could be found (acts as an alarm). */
  proposedPattern: {
    pattern: RiskPattern;
    inSampleStats: PatternStats;
  } | null;
  /** Free-form rationale string. Includes n, confidence and the trade ids
   *  that drove the change. Localised. */
  rationale: string;
  /** Trade ids that drove this proposal (e.g. flipped current pattern's stats). */
  drivenByTradeIds: string[];
  status: PatternProposalStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
};

// ── Config ────────────────────────────────────────────────────────────────

export type PatternProposalConfig = {
  /** Minimum n on the proposed pattern's firedN to even consider proposing. */
  minFiredNForProposal: number;
  /** Minimum margin (percentage points, 0-100) on precision over the current
   *  approved pattern's out-of-sample precision to propose a replacement.
   *  Default 15. */
  minPrecisionMarginPP: number;
  /** Out-of-sample precision below (currentInSamplePrecision * this) is a
   *  "degraded" signal. Default 0.6. */
  outOfSampleDegradationRatio: number;
  /** Minimum out-of-sample n before declaring a degradation alarm. Default 5. */
  minOutOfSampleNForDegradation: number;
};

export const DEFAULT_PATTERN_PROPOSAL_CONFIG: PatternProposalConfig = {
  minFiredNForProposal: 8,
  minPrecisionMarginPP: 15,
  outOfSampleDegradationRatio: 0.6,
  minOutOfSampleNForDegradation: 5,
};

/** Beta used for F-beta. β=0.5 → weighs precision twice as much as recall.
 *  Rationale: false exclusion of a winning trade is cheaper than letting in a
 *  losing trade, but only mildly so. */
export const F_BETA_FOR_PATTERN = 0.5;
