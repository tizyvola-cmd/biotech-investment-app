/**
 * Calibration & Sizing Engine — shared types.
 *
 * The engine works on *dimensions* (e.g. clinicalPhase, sdsBucket, pplanBucket,
 * indication) and *cells* inside each dimension (e.g. "Phase 3", "SDS Mid").
 *
 * Every output value MUST carry n + confidence + raw_observed + shrinkage_applied
 * so that no downstream consumer can accidentally use the bare frequency.
 */

/** Dimension we calibrate over. */
export type CalibrationDimension =
  | "clinicalPhase"
  | "clinicalIndication"
  | "sdsBucket"
  | "pplanBucket";

/** Confidence enum derived from sample size n. */
export type ConfidenceLevel = "low" | "medium" | "high";

/** Why a cell might be excluded from sizing. */
export type CellInactiveReason =
  /** Cell has no observations at all — proposal engine MUST skip it. */
  | "no_data"
  /** Cell has data but n is below the floor needed to influence sizing. */
  | "n_below_floor"
  /** The whole dimension is structurally missing (e.g. indication=Unknown 19/19) */
  | "dimension_no_variance"
  /** Manually disabled via proposal review. */
  | "manual_disabled";

/**
 * Shrinkage result for a single cell.
 * Carries enough metadata for the UI to refuse to render a number "naked".
 */
export type CellEstimate = {
  dimension: CalibrationDimension;
  cell: string;
  /** Sample size for this cell. */
  n: number;
  /** Number of wins observed in this cell. */
  wins: number;
  /** Raw observed win rate — NEVER use this directly in sizing. */
  rawObserved: number;
  /** Bayesian-shrunk win rate — use this for sizing. */
  shrinkageApplied: number;
  /** The hierarchical prior used (e.g. dimension-level aggregate or global). */
  prior: number;
  /** Pseudo-count k used in the shrinkage formula. */
  k: number;
  /** Confidence enum derived from n. */
  confidence: ConfidenceLevel;
  /** True when the cell should be treated as "no data" (n==0). */
  inactive: CellInactiveReason | null;
  /** Aggregate PnL stats (informational, NOT shrunk). */
  avgPnlPct: number | null;
  /** Sum of capital deployed across observed trades in this cell. */
  capitalDeployedEur: number;
};

/**
 * Estimates for an entire dimension.
 */
export type DimensionEstimate = {
  dimension: CalibrationDimension;
  /** Pooled prior used for cells in this dimension. */
  prior: number;
  /** True if the dimension has effectively no variance (single bucket only). */
  hasVariance: boolean;
  cells: CellEstimate[];
  /** Aggregate sample size across all cells in this dimension. */
  totalN: number;
};

/**
 * Snapshot of the full calibration state at a moment in time.
 * Used both as input to the proposal engine and as audit payload.
 */
export type CalibrationSnapshot = {
  /** ISO timestamp when this snapshot was computed. */
  computedAt: string;
  /** Global win rate (used as fallback prior). */
  globalPrior: number;
  /** Total resolved trades that fed the snapshot. */
  totalTrades: number;
  /** Per-dimension shrinkage results. */
  dimensions: Record<CalibrationDimension, DimensionEstimate>;
};

/**
 * One change inside a CalibrationProposal.
 * Each change is reviewable independently — but for a single proposal we
 * batch all the changes triggered by a single closed trade.
 */
export type ProposalChange = {
  dimension: CalibrationDimension;
  cell: string;
  oldWeight: number;
  newWeight: number;
  delta: number;
  oldN: number;
  newN: number;
  oldConfidence: ConfidenceLevel;
  newConfidence: ConfidenceLevel;
  /** True if confidence level changed — flagged in UI as "attention". */
  confidenceChanged: boolean;
  /** Natural-language explanation generated for human review. */
  rationale: string;
};

export type ProposalStatus = "pending" | "approved" | "rejected";

export type CalibrationProposal = {
  id: string;
  createdAt: string;
  /** row_key of the closed trade that triggered this proposal (null = manual recompute). */
  triggeredByTradeId: string | null;
  changes: ProposalChange[];
  status: ProposalStatus;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNote?: string;
};

/**
 * Frozen weights — the "approved" view of calibrated win rates.
 * sizingRules.ts reads ONLY this, never the live shrinkage engine output.
 */
export type FrozenWeights = {
  /** ISO timestamp when this set of weights was last updated by an approval. */
  updatedAt: string;
  /** id of the proposal that produced this set, or null for initial state. */
  lastProposalId: string | null;
  /** dimension → cell → {weight, n, confidence} */
  weights: Record<
    CalibrationDimension,
    Record<
      string,
      {
        weight: number;
        n: number;
        confidence: ConfidenceLevel;
      }
    >
  >;
};

/**
 * Sizing output — what sizingRules.ts returns for one opportunity.
 *
 * Comes WITH the decomposition (which dimension contributed how much) — so
 * the UI can show "Phase 3 pushed −12%, SDS Mid pushed +5%" instead of an
 * opaque number.
 */
export type SizingDecision = {
  ticker: string;
  /** Suggested size in EUR. */
  sizeEur: number;
  /** Size as fraction of total capital (0-1). */
  sizeFraction: number;
  /** What baseline we started from (equal-weight default). */
  baselineEur: number;
  /** Per-dimension multiplier applied to baseline. */
  contributions: Array<{
    dimension: CalibrationDimension;
    cell: string;
    /** Weight from frozen weights table. */
    weight: number;
    n: number;
    confidence: ConfidenceLevel;
    /** Multiplier actually applied after confidence attenuation. */
    appliedMultiplier: number;
    /** Δ in EUR vs baseline produced by this dimension. */
    deltaEur: number;
    note: string;
  }>;
  /** Diversification caps actually triggered. */
  capsTriggered: Array<{
    capName: string;
    triggered: boolean;
    note: string;
  }>;
  /** Absolute floor/cap clamps applied. */
  clamps: {
    floorEur: number;
    capEur: number;
    clampedToFloor: boolean;
    clampedToCap: boolean;
  };
};

/** Confidence threshold defaults — exposed so they can be tuned externally. */
export type ConfidenceThresholds = {
  /** n < this → low. */
  lowMax: number;
  /** n < this → medium. */
  mediumMax: number;
};

/** Shrinkage configuration — exposed so prior strength k can be tuned. */
export type ShrinkageConfig = {
  /** Pseudo-count for the prior. Start at 8-10 with current low volume. */
  k: number;
  /** Floor for cells to even be considered for sizing (below = ignored). */
  minNForSizing: number;
  /** When dimension has fewer than this many cells with data, treat as no variance. */
  minCellsForVariance: number;
  confidence: ConfidenceThresholds;
};

export const DEFAULT_SHRINKAGE_CONFIG: ShrinkageConfig = {
  k: 8,
  minNForSizing: 3,
  minCellsForVariance: 2,
  confidence: {
    lowMax: 5,
    mediumMax: 15,
  },
};

export function confidenceFromN(
  n: number,
  thr: ConfidenceThresholds = DEFAULT_SHRINKAGE_CONFIG.confidence,
): ConfidenceLevel {
  if (n < thr.lowMax) return "low";
  if (n < thr.mediumMax) return "medium";
  return "high";
}
