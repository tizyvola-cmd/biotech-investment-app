/**
 * Portfolio Sizing Widget — pure logic.
 *
 * Powers the interactive widget inside Step 3 (Capital & Diversification)
 * that lets the user modulate per-opportunity sizes and see the breakeven
 * EV bar update in real time.
 *
 * Three corrections vs the early prototype:
 *   1. EV uses REAL win rates + payoffs (Calibration Center + Step 1
 *      sdsGainBreakdown), never a synthetic constant payoff.
 *   2. Confidence applies visual friction (soft caps at 30% / 70% / 100%
 *      of the per-position absolute cap) — not a hard lock.
 *   3. Diversification caps from sizingRules (phase / indication) are
 *      enforced in real time during the drag, not just at release.
 *
 * Pure, side-effect-free, testable without UI.
 *
 * READ-ONLY: no portfolio writes ever. This is a what-if explorer.
 */
import type {
  CalibrationDimension,
  CalibrationSnapshot,
  CellEstimate,
  ConfidenceLevel,
  FrozenWeights,
} from "../calibration/calibrationTypes";
import type { SdsGainBreakdown, SdsGainRow } from "./sdsGainBreakdown";
import type { SizingRulesConfig } from "../calibration/sizingRules";
import { DEFAULT_SIZING_RULES_CONFIG } from "../calibration/sizingRules";
import type {
  PhaseAResult,
  RiskFeatureDimension,
  RiskPattern,
} from "../riskPattern/riskPatternTypes";
import { matchPattern } from "../riskPattern/lossRiskPattern";

// ── Friction config ───────────────────────────────────────────────────────

/**
 * Soft thresholds for confidence-based friction.
 * Each value is a fraction in [0, 1] of the per-position absolute cap.
 * Below this value: no friction. Above: visible friction (UI cue + log event).
 * Always SOFT — the user can drag past, but the choice becomes visible.
 *
 * Configurable in one place; tunable after first real usage.
 */
export type FrictionThresholds = {
  low: number;
  medium: number;
  high: number;
};

export const DEFAULT_FRICTION_THRESHOLDS: FrictionThresholds = {
  low: 0.30,
  medium: 0.70,
  high: 1.0,
};

// ── Deal model ────────────────────────────────────────────────────────────

/**
 * Per-opportunity input. The widget aggregates these into category groups for
 * cap enforcement. UI is responsible for building this list — the logic
 * module receives it ready.
 */
export type WidgetDeal = {
  ticker: string;
  /** Display label for the row in UI (e.g. "TICK · Phase 2 · Oncology"). */
  displayLabel: string;
  /** Cell labels used to look up calibration estimates. Use empty strings if
   *  the deal lacks the dimension. */
  cells: Record<CalibrationDimension, string>;
  /** Sim loop "promised" return for that opportunity (planReturnPct). Used
   *  ONLY when sdsGainBreakdown payoff is unavailable AND fallback is active. */
  promisedReturnPct?: number | null;
};

/**
 * Information per deal that we surface to the UI for explanation.
 * Carries the source of every number (no naked values).
 */
export type DealMetrics = {
  ticker: string;
  /** Win rate used (shrunk, in [0,1]). */
  winRate: number;
  /** Confidence of the win-rate source. */
  confidence: ConfidenceLevel;
  /** Which dimension provided the win rate (and the cell label). */
  winRateSource: { dimension: CalibrationDimension; cell: string; n: number };
  /** Average WIN gain % (positive number). */
  payoffWinPct: number;
  /** Average LOSS pct (negative number). */
  payoffLossPct: number;
  /** Where the payoff came from — "step1" (sdsGainBreakdown) or "fallback" (no Step 1 data yet). */
  payoffSource: "step1" | "fallback";
  /** SDS bucket the deal falls into (used for payoff lookup + UI). */
  sdsBucket: string;
  /** Phase A + Phase B loss-risk profile for this deal. Null when no risk data
   *  is available (e.g. screening hasn't been run). */
  lossRisk: DealLossRisk | null;
  /** Multiplier in [0.3, 1.5] derived from lossRisk that scales the suggested
   *  baseline size. 1.0 = neutral; <1 = risky / smaller suggested cap; >1 = safer. */
  lossRiskSizeMultiplier: number;
};

// ── Loss-risk integration (Phase A + Phase B) ─────────────────────────────

/**
 * Per-deal entry-state risk score derived from Phase A univariate screening
 * (`lossRiskScreening.runUnivariateScreening`) plus an optional match against
 * the currently approved Phase B pattern.
 *
 * Each contributing bucket exposes its `lift` (shrunk loss rate / base rate):
 *   - lift > 1.0 → bucket is riskier than the overall base loss rate
 *   - lift < 1.0 → bucket is safer than the overall base loss rate
 *
 * `aggregateLift` is the geometric mean of contributing bucket lifts, weighted
 * by confidence (HIGH ×1.0, MEDIUM ×0.5, LOW ×0.25). It is clamped to
 * [0.3, 3.0] before being used as a size multiplier so a single noisy bucket
 * can't dominate the suggested cap.
 *
 * `matchedApprovedPattern` is `true` only when an approved Phase B pattern
 * exists AND all its conditions fire on this deal's bucket cells. We never
 * fire on rows with missing feature values.
 */
export type DealLossRiskContribution = {
  dimension: RiskFeatureDimension;
  bucket: string;
  /** Phase A shrunk lift (1.0 = neutral). */
  lift: number;
  /** Phase A shrunk loss rate (0..1). */
  shrunkLossRate: number;
  /** N of the bucket in Phase A. */
  n: number;
  /** Confidence of the bucket (HIGH / MED / LOW). */
  confidence: ConfidenceLevel;
};

export type DealLossRisk = {
  /** Geometric mean of contributing bucket lifts, confidence-weighted. 1.0 = neutral. */
  aggregateLift: number;
  /** Bucket-level lifts that fed the aggregate (eligible-only). */
  contributions: DealLossRiskContribution[];
  /** True if an approved Phase B pattern is configured AND fires on this deal. */
  matchedApprovedPattern: boolean;
  /** Whether Phase A produced any usable signal for this deal. */
  hasSignal: boolean;
};

const RISK_CONFIDENCE_WEIGHT: Record<ConfidenceLevel, number> = {
  high: 1.0,
  medium: 0.5,
  low: 0.25,
};

/** Read the deal's bucket label for a given Phase A risk feature dimension.
 *  Returns null if the deal does not carry that feature. */
function dealBucketForDim(
  deal: WidgetDeal,
  dim: RiskFeatureDimension,
): string | null {
  switch (dim) {
    case "sdsBucket":
      return deal.cells.sdsBucket ?? null;
    case "clinicalPhase":
      return deal.cells.clinicalPhase ?? null;
    case "clinicalIndication":
      return deal.cells.clinicalIndication ?? null;
    case "pplanBucket":
      return deal.cells.pplanBucket ?? null;
    // The widget deal currently doesn't carry daysToCdBucket / precdSlopeSign
    // because those aren't part of the calibration cell schema. Skipped.
    case "daysToCdBucket":
    case "precdSlopeSign":
      return null;
    default:
      return null;
  }
}

/**
 * Compute a per-deal loss-risk profile from Phase A screening + optional
 * approved Phase B pattern. Pure function — testable without UI.
 */
export function computeDealLossRisk(
  deal: WidgetDeal,
  phaseA: PhaseAResult | null,
  approvedPattern: RiskPattern | null,
): DealLossRisk {
  const contributions: DealLossRiskContribution[] = [];
  if (phaseA) {
    for (const feature of phaseA.features) {
      if (!feature.hasVariance) continue;
      const cellName = dealBucketForDim(deal, feature.dimension);
      if (!cellName) continue;
      const found = feature.buckets.find((b) => b.bucket === cellName);
      if (!found) continue;
      if (!found.eligibleForPattern) continue;
      contributions.push({
        dimension: feature.dimension,
        bucket: found.bucket,
        lift: found.lift,
        shrunkLossRate: found.shrunkLossRate,
        n: found.n,
        confidence: found.confidence,
      });
    }
  }

  // Geometric mean of lifts, weighted by confidence.
  let logSum = 0;
  let weightSum = 0;
  for (const c of contributions) {
    const w = RISK_CONFIDENCE_WEIGHT[c.confidence];
    if (w <= 0) continue;
    // Clamp lift to a sane range BEFORE log to avoid extreme inputs (Inf/0).
    const safeLift = Math.max(0.05, Math.min(20, c.lift));
    logSum += Math.log(safeLift) * w;
    weightSum += w;
  }
  const rawAggregate = weightSum > 0 ? Math.exp(logSum / weightSum) : 1.0;
  // Clamp the aggregate to [0.3, 3.0] so it can't double the cap (lift<0.3) or
  // zero it out (lift>3) — preserving floor and ceiling sanity.
  const aggregateLift = Math.max(0.3, Math.min(3.0, rawAggregate));

  // Approved Phase B pattern match — only when the deal carries values for
  // every dimension the pattern conditions on AND the pattern itself meets
  // minimum quality thresholds (lift >= 1.3, precision >= 0.50).
  // A pattern that matches 80%+ of all deals is too broad to be a meaningful
  // risk flag — we suppress the badge rather than cry wolf on every position.
  let matched = false;
  if (approvedPattern && approvedPattern.conditions.length > 0) {
    const stats = approvedPattern.inSampleStats;
    const patternLift = stats?.lift ?? 0;
    const patternPrecision = stats?.precision ?? 0;
    const qualityOk = patternLift >= 1.3 && patternPrecision >= 0.50;
    if (qualityOk) {
      const features = {
        rowKey: deal.ticker,
        sdsBucket: deal.cells.sdsBucket || null,
        clinicalPhase: deal.cells.clinicalPhase || null,
        clinicalIndication: deal.cells.clinicalIndication || null,
        pplanBucket: deal.cells.pplanBucket || null,
        daysToCdBucket: null,
        precdSlopeSign: null,
      };
      matched = matchPattern(approvedPattern, features);
    }
  }

  return {
    aggregateLift,
    contributions,
    matchedApprovedPattern: matched,
    hasSignal: contributions.length > 0 || matched,
  };
}

/**
 * Convert an aggregate lift into a size multiplier in [0.3, 1.5].
 *   lift = 1.0 → 1.0 (neutral)
 *   lift = 2.0 → 0.5 (halve)
 *   lift = 0.5 → ~1.4 (safer-than-average; modest boost)
 *
 * A matched approved Phase B pattern multiplies the result by `0.5` (extra
 * downward push) so the user sees a noticeably smaller suggested cap when the
 * deal is flagged by the calibrated risk profile.
 */
export function lossRiskSizeMultiplier(risk: DealLossRisk): number {
  // Bound input so 1/lift stays sane.
  const lift = Math.max(0.3, Math.min(3.0, risk.aggregateLift));
  let mult = 1 / lift;
  if (risk.matchedApprovedPattern) mult *= 0.5;
  return Math.max(0.3, Math.min(1.5, mult));
}

/**
 * Map a `DealLossRisk` to a single 0-100 "investment risk score" suitable for
 * a table column. Higher = riskier.
 *
 * Anchors (no pattern):
 *   - lift = 0.3 (very safe)  → 0
 *   - lift = 0.5              → ~19
 *   - lift = 1.0 (neutral)    → 50
 *   - lift = 1.5              → ~69
 *   - lift = 2.0              → ~82
 *   - lift = 3.0 (very risky) → 100
 *
 * Formula: `50 + 50 × log(lift) / log(3)`.
 *
 * An approved Phase B pattern match adds +20 (clamped to 100) — the pattern is
 * a calibrated red flag worth more than any single bucket's lift.
 *
 * Returns null when the deal has no Phase A signal AND no pattern match (we
 * don't want to show "50" on deals with literally no risk data — that would
 * be misleading).
 */
export function lossRiskInvestmentScore(risk: DealLossRisk | null): number | null {
  if (!risk) return null;
  if (!risk.hasSignal) return null;
  const lift = Math.max(0.3, Math.min(3.0, risk.aggregateLift));
  const base = 50 + 50 * (Math.log(lift) / Math.log(3));
  const penalty = risk.matchedApprovedPattern ? 20 : 0;
  return Math.max(0, Math.min(100, base + penalty));
}

// ── Friction events ───────────────────────────────────────────────────────

export type FrictionEventKind =
  | "phase_cap_blocked"
  | "indication_cap_blocked"
  | "low_confidence_threshold_crossed"
  | "medium_confidence_threshold_crossed"
  | "single_position_cap_blocked"
  | "indication_cap_disabled";

export type FrictionEvent = {
  kind: FrictionEventKind;
  ticker: string;
  /** ISO timestamp. */
  at: string;
  /** Human-readable message. Localised by caller. */
  message: string;
  /** Numeric payload (optional) for UI rendering. */
  payload?: { capEur?: number; cellLabel?: string; thresholdFraction?: number };
};

// ── Category usage ────────────────────────────────────────────────────────

export type CategoryUsage = {
  category: "phase" | "indication";
  label: string;
  deployedEur: number;
  capEur: number;
  /** Fraction of cap used (deployed / cap). */
  usageFraction: number;
  /** True if the cap cannot be enforced (e.g. indication has no variance). */
  disabled: boolean;
  /** Reason for disabled (used by UI). */
  disabledReason?: string;
};

// ── Computed state ────────────────────────────────────────────────────────

export type ComputedWidgetState = {
  /** Per-deal computed values (EV, multipliers, slider bounds). */
  perDeal: Array<{
    ticker: string;
    /** Slider value as provided. */
    sizeEur: number;
    /** Expected value contribution at the current size (€). */
    evEur: number;
    /** EV per € invested at the current settings (deterministic from win rate × payoff). */
    evPerEur: number;
    /** Absolute max size for this deal given caps (phase / indication / single). */
    runtimeMaxEur: number;
    /** Soft friction threshold (€) — UI changes color past this point. */
    softThresholdEur: number;
    /** Has the size pushed past the soft threshold? */
    pastSoftThreshold: boolean;
    /** Was the size capped at runtimeMaxEur in this evaluation? */
    clampedToRuntimeMax: boolean;
    metrics: DealMetrics;
  }>;
  /** Total EV across all deals (sum of evEur). */
  evTotalEur: number;
  /** Total capital currently allocated (sum of sizeEur). */
  allocatedEur: number;
  /** Category usage cards (phase + indication groups). */
  capByCategory: CategoryUsage[];
  /** Friction events produced during this compute pass. */
  frictionEvents: FrictionEvent[];
  /** Whether the EV total meets/exceeds the target breakeven. */
  evMeetsTarget: boolean;
  /** Progress (evTotalEur / breakevenTargetEur), clamped to [0, ∞). */
  evProgress: number;
};

// ── Inputs ────────────────────────────────────────────────────────────────

export type ComputePositionStateInput = {
  /** All deals visible in the widget. */
  deals: WidgetDeal[];
  /** Current slider value per ticker in EUR. Missing tickers default to 0. */
  sliders: Record<string, number>;
  /** Total capital pot the user is sizing inside. */
  totalCapitalEur: number;
  /** Target EV the bar progresses towards (passed from Step 3 recommendation). */
  breakevenTargetEur: number;
  /** Optional snapshot to read win rates from. Required for non-fallback EV. */
  calibrationSnapshot?: CalibrationSnapshot | null;
  /** Optional approved frozen weights — used when the snapshot is missing.
   *  Has lower fidelity (no per-cell n / confidence) but works as fallback. */
  frozenWeights?: FrozenWeights | null;
  /** Optional Step 1 gain breakdown for payoffs. When missing, fallback used. */
  sdsGainBreakdown?: SdsGainBreakdown | null;
  /** Sizing rules config (defaults to DEFAULT_SIZING_RULES_CONFIG). */
  rules?: SizingRulesConfig;
  /** Friction thresholds (defaults to DEFAULT_FRICTION_THRESHOLDS). */
  friction?: FrictionThresholds;
  /** Indications that are disabled (e.g. no variance). Caps for these are skipped. */
  disabledIndications?: Set<string>;
  /** Phase A univariate screening (loss-risk per bucket). When present, the
   *  widget shows per-deal risk contributions and uses them to nudge the
   *  suggested baseline size via `lossRiskSizeMultiplier`. */
  phaseA?: PhaseAResult | null;
  /** Approved Phase B risk pattern (if any). Deals matching the pattern get
   *  flagged in the UI and receive an extra 0.5× downward multiplier on top
   *  of the Phase A aggregate lift. */
  approvedPattern?: RiskPattern | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Find the most reliable cell estimate across dimensions for a deal.
 *
 * Selection rule (documented behaviour, not heuristic):
 *   1. Iterate dimensions in priority order: clinicalPhase, sdsBucket,
 *      pplanBucket, clinicalIndication.
 *   2. For each, look up the cell estimate in `snapshot.dimensions[dim]`.
 *   3. Skip cells where `inactive != null` (n=0 or below floor).
 *   4. Pick the candidate with the highest n. Break ties using the priority
 *      order above (earlier in the list wins).
 *   5. If nothing qualifies, return null.
 *
 * Rationale: clinical phase has the most stable signal in our domain,
 * SDS bucket second, P(plan) third (high variance ad-hoc bucketing),
 * indication last (currently always 'Unknown' for us → no variance).
 */
/**
 * Returns true for "fallback" cell labels that mean "no specific value" — these
 * collapse multiple unrelated deals onto a single bucket, so we should only
 * use them when no better signal is available.
 */
function isFallbackCell(cell: string, dim: CalibrationDimension): boolean {
  if (dim === "clinicalPhase" || dim === "clinicalIndication") {
    return cell === "Unknown";
  }
  if (dim === "sdsBucket") return cell === "No SDS";
  if (dim === "pplanBucket") return cell === "P(plan) n/a";
  return false;
}

export function pickBestCellEstimate(
  snapshot: CalibrationSnapshot,
  cells: Record<CalibrationDimension, string>,
): { estimate: CellEstimate; dimension: CalibrationDimension } | null {
  const priority: CalibrationDimension[] = [
    "clinicalPhase",
    "sdsBucket",
    "pplanBucket",
    "clinicalIndication",
  ];
  // Minimum N to consider a specific (non-fallback) cell "trustworthy enough"
  // to win over a generic high-N fallback. Below this threshold we still
  // prefer the specific cell over a fallback, but it falls behind another
  // specific cell with more evidence.
  const MIN_SPECIFIC_N = 5;
  type Cand = {
    estimate: CellEstimate;
    dimension: CalibrationDimension;
    priorityIdx: number;
    isFallback: boolean;
  };
  const cands: Cand[] = [];
  priority.forEach((dim, idx) => {
    const cell = cells[dim];
    if (!cell) return;
    const dimEst = snapshot.dimensions[dim];
    if (!dimEst) return;
    const found = dimEst.cells.find((c) => c.cell === cell);
    if (!found) return;
    if (found.inactive != null) return; // n=0 or n_below_floor
    cands.push({
      estimate: found,
      dimension: dim,
      priorityIdx: idx,
      isFallback: isFallbackCell(cell, dim),
    });
  });
  if (cands.length === 0) return null;

  // Selection order:
  //  1. Non-fallback cells with N ≥ MIN_SPECIFIC_N win over EVERYTHING ELSE.
  //     Within this tier, sort by dimension priority (phase>sds>pplan>ind)
  //     then by N desc.
  //  2. Non-fallback cells with N < MIN_SPECIFIC_N next — same ordering.
  //  3. Fallback cells last — they prevent homogenizing all deals onto the
  //     same generic "Unknown"/"No SDS" cell when at least one specific
  //     signal exists.
  function rank(c: Cand): number {
    if (!c.isFallback && c.estimate.n >= MIN_SPECIFIC_N) return 0;
    if (!c.isFallback) return 1;
    return 2;
  }
  cands.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.priorityIdx !== b.priorityIdx) return a.priorityIdx - b.priorityIdx;
    return b.estimate.n - a.estimate.n;
  });
  const top = cands[0];
  return { estimate: top.estimate, dimension: top.dimension };
}

/**
 * Fallback win-rate lookup from frozen weights when snapshot is unavailable.
 * Returns a CellEstimate-shaped object with confidence reported from frozen.
 */
function pickBestFromFrozen(
  frozen: FrozenWeights,
  cells: Record<CalibrationDimension, string>,
): { winRate: number; confidence: ConfidenceLevel; n: number; dimension: CalibrationDimension; cell: string } | null {
  const priority: CalibrationDimension[] = [
    "clinicalPhase",
    "sdsBucket",
    "pplanBucket",
    "clinicalIndication",
  ];
  const MIN_SPECIFIC_N = 5;
  type Cand = { winRate: number; confidence: ConfidenceLevel; n: number; dimension: CalibrationDimension; cell: string; priorityIdx: number; isFallback: boolean };
  const cands: Cand[] = [];
  priority.forEach((dim, idx) => {
    const cell = cells[dim];
    if (!cell) return;
    const entry = frozen.weights[dim]?.[cell];
    if (!entry) return;
    cands.push({
      winRate: entry.weight,
      confidence: entry.confidence,
      n: entry.n,
      dimension: dim,
      cell,
      priorityIdx: idx,
      isFallback: isFallbackCell(cell, dim),
    });
  });
  if (cands.length === 0) return null;
  // Same selection order as snapshot path: specific cells first, fallback last.
  function rank(c: Cand): number {
    if (!c.isFallback && c.n >= MIN_SPECIFIC_N) return 0;
    if (!c.isFallback) return 1;
    return 2;
  }
  cands.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.priorityIdx !== b.priorityIdx) return a.priorityIdx - b.priorityIdx;
    return b.n - a.n;
  });
  const top = cands[0];
  return {
    winRate: top.winRate,
    confidence: top.confidence,
    n: top.n,
    dimension: top.dimension,
    cell: top.cell,
  };
}

/**
 * Lookup the payoff (avg win % + avg loss %) for an SDS bucket from Step 1.
 * Returns "step1" provenance when found, "fallback" when missing.
 *
 * Fallback values are deliberately conservative:
 *   - payoffWinPct = +8% (typical biotech CD win when present)
 *   - payoffLossPct = −10% (slightly worse than typical CD miss, to bias against)
 * These are picked so the user IMMEDIATELY notices when they're active (because
 * the EV math will be flat and the UI tag "stima preliminare" will be visible).
 */
const FALLBACK_PAYOFF_WIN_PCT = 8;
const FALLBACK_PAYOFF_LOSS_PCT = -10;

export function payoffForSdsBucket(
  bucket: string,
  breakdown: SdsGainBreakdown | null | undefined,
): { winPct: number; lossPct: number; source: "step1" | "fallback" } {
  if (!breakdown) {
    return {
      winPct: FALLBACK_PAYOFF_WIN_PCT,
      lossPct: FALLBACK_PAYOFF_LOSS_PCT,
      source: "fallback",
    };
  }
  const row: SdsGainRow | undefined = breakdown.rows.find((r) => r.bucket === bucket);
  if (!row || row.deliveredN === 0 || row.deliveredAvgPnlPct == null) {
    return {
      winPct: FALLBACK_PAYOFF_WIN_PCT,
      lossPct: FALLBACK_PAYOFF_LOSS_PCT,
      source: "fallback",
    };
  }
  // Per the brief, Step 1 should expose separate avg win % and avg loss %
  // by bucket. Currently sdsGainBreakdown only exposes the all-trade avg
  // (deliveredAvgPnlPct). We split into win/loss approximations using
  // the win rate from the same row:
  //   avgPnl ≈ winRate * winPct + (1 - winRate) * lossPct
  // We solve for winPct / lossPct given a typical asymmetry ratio (1.5×)
  // and the row's win rate. This is a tactical bridge until Step 1 surfaces
  // separate win/loss aggregations.
  const winRate = row.deliveredWinRate;
  if (winRate <= 0) {
    // No wins observed — keep loss as observed avg, win as fallback positive.
    return {
      winPct: FALLBACK_PAYOFF_WIN_PCT,
      lossPct: row.deliveredAvgPnlPct,
      source: "step1",
    };
  }
  if (winRate >= 1) {
    // All wins — keep win as observed avg, loss as fallback negative.
    return {
      winPct: row.deliveredAvgPnlPct,
      lossPct: FALLBACK_PAYOFF_LOSS_PCT,
      source: "step1",
    };
  }
  // Solve: winRate * W + (1 - winRate) * L = avg, with W >0, L <0.
  // Use the empirical asymmetry W ≈ 1.5 × |L| as a stable shrinker.
  // avg = winRate * 1.5 * |L| + (1 - winRate) * L = L * ((1 - winRate) − 1.5 * winRate)
  // Note L is negative; we solve directly:
  //
  // Bayesian shrinkage on avg toward neutral (0) when n is small, mirroring
  // the same k=8 pseudo-count used by the shrinkage engine for win rates.
  // This prevents thin-sample outlier losses from producing extreme EV.
  const PAYOFF_SHRINK_K = 8; // pseudo-count — same as shrinkage engine default
  const NEUTRAL_AVG = 0; // prior for avg P&L: assume breakeven until data says otherwise
  const shrunkAvg =
    (row.deliveredN * row.deliveredAvgPnlPct + PAYOFF_SHRINK_K * NEUTRAL_AVG) /
    (row.deliveredN + PAYOFF_SHRINK_K);
  const avg = shrunkAvg;
  // L * (1 - 2.5 * winRate) = avg → L = avg / (1 - 2.5 * winRate)
  const denom = 1 - 2.5 * winRate;
  let lossPct: number;
  let winPct: number;
  if (Math.abs(denom) < 1e-3) {
    // Pathological: fall back to symmetric split.
    lossPct = avg < 0 ? avg / Math.max(0.001, 1 - winRate) : FALLBACK_PAYOFF_LOSS_PCT;
    winPct = avg > 0 ? avg / Math.max(0.001, winRate) : FALLBACK_PAYOFF_WIN_PCT;
  } else {
    lossPct = avg / denom;
    winPct = -1.5 * lossPct;
  }
  // Sanity clamp: winPct must be > 0 and lossPct must be < 0; otherwise fallback.
  if (winPct <= 0 || lossPct >= 0 || !Number.isFinite(winPct) || !Number.isFinite(lossPct)) {
    return {
      winPct: FALLBACK_PAYOFF_WIN_PCT,
      lossPct: FALLBACK_PAYOFF_LOSS_PCT,
      source: "fallback",
    };
  }
  return { winPct, lossPct, source: "step1" };
}

function softThresholdFraction(c: ConfidenceLevel, fr: FrictionThresholds): number {
  if (c === "low") return fr.low;
  if (c === "medium") return fr.medium;
  return fr.high;
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Pure compute of the widget state given inputs. Calling this is cheap and
 * idempotent — the UI re-invokes on every slider change.
 *
 * Behaviour highlights:
 *   - Sliders are first clamped to runtimeMaxEur (caps + single-position cap).
 *   - When clamped to a cap, a FrictionEvent is recorded so the UI can show
 *     the explanation log under the breakeven bar.
 *   - When a slider exceeds the soft confidence threshold, a friction event
 *     is recorded. The slider is NOT moved — only marked `pastSoftThreshold`.
 *   - Caps are computed in two passes: (1) sum all current sliders by
 *     category, (2) per-deal runtime max = min(single-cap, cap_phase −
 *     (used_phase − this_size), cap_indication − (used_indication −
 *     this_size)). This makes the cap "real-time" — the slider for any single
 *     deal cannot push the category over the cap.
 *   - Disabled indications (no variance) are excluded from the cap; one
 *     `indication_cap_disabled` event is emitted to inform the UI.
 */
export function computePositionState(
  input: ComputePositionStateInput,
): ComputedWidgetState {
  const rules = input.rules ?? DEFAULT_SIZING_RULES_CONFIG;
  const friction = input.friction ?? DEFAULT_FRICTION_THRESHOLDS;
  const deals = input.deals;
  const sliders = input.sliders;
  const totalCapital = input.totalCapitalEur;
  const singleCapEur = totalCapital * rules.capPctSingle;
  const phaseCapEur = totalCapital * rules.capPctByPhase;
  const indicationCapEur = totalCapital * rules.capPctByIndication;
  const disabledIndications = input.disabledIndications ?? new Set<string>();
  const now = new Date().toISOString();

  // Pass 1 — compute per-deal metrics (win rate / confidence / payoff).
  type DealEnriched = {
    deal: WidgetDeal;
    requestedSize: number;
    metrics: DealMetrics;
    softThresholdEur: number;
  };
  const enriched: DealEnriched[] = deals.map((deal) => {
    const requestedSize = Math.max(0, sliders[deal.ticker] ?? 0);
    let winRate = rules.neutralWeight;
    let confidence: ConfidenceLevel = "low";
    let n = 0;
    let dimension: CalibrationDimension = "sdsBucket";
    let cell = deal.cells.sdsBucket;
    if (input.calibrationSnapshot) {
      const picked = pickBestCellEstimate(input.calibrationSnapshot, deal.cells);
      if (picked) {
        winRate = picked.estimate.shrinkageApplied;
        confidence = picked.estimate.confidence;
        n = picked.estimate.n;
        dimension = picked.dimension;
        cell = picked.estimate.cell;
      }
    } else if (input.frozenWeights) {
      const picked = pickBestFromFrozen(input.frozenWeights, deal.cells);
      if (picked) {
        winRate = picked.winRate;
        confidence = picked.confidence;
        n = picked.n;
        dimension = picked.dimension;
        cell = picked.cell;
      }
    }
    const sdsBucket = deal.cells.sdsBucket ?? "No SDS";
    const payoff = payoffForSdsBucket(sdsBucket, input.sdsGainBreakdown);
    // Phase A + Phase B loss-risk profile (null when no screening provided).
    const lossRisk = input.phaseA || input.approvedPattern
      ? computeDealLossRisk(deal, input.phaseA ?? null, input.approvedPattern ?? null)
      : null;
    const sizeMultiplier = lossRisk ? lossRiskSizeMultiplier(lossRisk) : 1.0;
    const metrics: DealMetrics = {
      ticker: deal.ticker,
      winRate,
      confidence,
      winRateSource: { dimension, cell, n },
      payoffWinPct: payoff.winPct,
      payoffLossPct: payoff.lossPct,
      payoffSource: payoff.source,
      sdsBucket,
      lossRisk,
      lossRiskSizeMultiplier: sizeMultiplier,
    };
    return {
      deal,
      requestedSize,
      metrics,
      softThresholdEur: singleCapEur * softThresholdFraction(confidence, friction),
    };
  });

  // Pass 2 — group totals by phase / indication using REQUESTED sizes
  // (we then enforce caps below; runtime max may end up smaller).
  const usedByPhase = new Map<string, number>();
  const usedByIndication = new Map<string, number>();
  for (const e of enriched) {
    const phase = e.deal.cells.clinicalPhase || "Unknown";
    const ind = e.deal.cells.clinicalIndication || "Unknown";
    usedByPhase.set(phase, (usedByPhase.get(phase) ?? 0) + e.requestedSize);
    usedByIndication.set(ind, (usedByIndication.get(ind) ?? 0) + e.requestedSize);
  }

  // Pass 3 — per-deal runtime cap + clamping + friction events.
  const frictionEvents: FrictionEvent[] = [];
  // Emit one disabled-cap event per disabled indication present (UI dedups).
  const disabledEmitted = new Set<string>();

  const perDeal = enriched.map((e) => {
    const phase = e.deal.cells.clinicalPhase || "Unknown";
    const ind = e.deal.cells.clinicalIndication || "Unknown";
    const requested = e.requestedSize;

    // Single-position cap
    let runtimeMax = singleCapEur;
    let blockedBy: FrictionEventKind | null = null;
    let blockedNote = "";

    // Phase cap headroom (excluding this deal so it's not double-counted)
    const phaseUsedOther = (usedByPhase.get(phase) ?? 0) - requested;
    const phaseHeadroom = Math.max(0, phaseCapEur - phaseUsedOther);
    if (phaseHeadroom < runtimeMax) {
      runtimeMax = phaseHeadroom;
    }
    // Indication cap headroom (skip if disabled)
    if (!disabledIndications.has(ind)) {
      const indUsedOther = (usedByIndication.get(ind) ?? 0) - requested;
      const indHeadroom = Math.max(0, indicationCapEur - indUsedOther);
      if (indHeadroom < runtimeMax) {
        runtimeMax = indHeadroom;
      }
    } else if (!disabledEmitted.has(ind)) {
      frictionEvents.push({
        kind: "indication_cap_disabled",
        ticker: e.deal.ticker,
        at: now,
        message: `Cap per indicazione "${ind}" non attivo: nessuna varianza nei dati.`,
        payload: { cellLabel: ind },
      });
      disabledEmitted.add(ind);
    }

    // Final size = min(requested, runtimeMax). If clamped, emit a friction event
    // attributing the binding constraint.
    let size = requested;
    if (size > runtimeMax) {
      size = runtimeMax;
      if (runtimeMax === phaseHeadroom && phaseHeadroom < singleCapEur) {
        blockedBy = "phase_cap_blocked";
        blockedNote = `Cap fase "${phase}" raggiunto: slider fermato a ${Math.round(size).toLocaleString("it-IT")} €.`;
      } else if (!disabledIndications.has(ind) && runtimeMax < singleCapEur) {
        blockedBy = "indication_cap_blocked";
        blockedNote = `Cap indicazione "${ind}" raggiunto: slider fermato a ${Math.round(size).toLocaleString("it-IT")} €.`;
      } else {
        blockedBy = "single_position_cap_blocked";
        blockedNote = `Cap singola posizione raggiunto: slider fermato a ${Math.round(size).toLocaleString("it-IT")} €.`;
      }
    }
    if (blockedBy) {
      frictionEvents.push({
        kind: blockedBy,
        ticker: e.deal.ticker,
        at: now,
        message: blockedNote,
        payload: { capEur: runtimeMax, cellLabel: blockedBy === "phase_cap_blocked" ? phase : ind },
      });
    }

    // Soft threshold friction (informational only — size NOT modified)
    const pastSoft = size > e.softThresholdEur && e.metrics.confidence !== "high";
    if (pastSoft) {
      const kind: FrictionEventKind =
        e.metrics.confidence === "low"
          ? "low_confidence_threshold_crossed"
          : "medium_confidence_threshold_crossed";
      frictionEvents.push({
        kind,
        ticker: e.deal.ticker,
        at: now,
        message:
          e.metrics.confidence === "low"
            ? `Confidence LOW: superata soglia soft a ${Math.round(e.softThresholdEur).toLocaleString("it-IT")} € — n insufficiente per questa stima.`
            : `Confidence MEDIUM: superata soglia soft a ${Math.round(e.softThresholdEur).toLocaleString("it-IT")} €.`,
        payload: { thresholdFraction: softThresholdFraction(e.metrics.confidence, friction) },
      });
    }

    // EV math (per-position):
    //   EV(€) = size × (winRate × payoffWinPct/100 + (1 − winRate) × payoffLossPct/100)
    const evPerEur =
      e.metrics.winRate * (e.metrics.payoffWinPct / 100) +
      (1 - e.metrics.winRate) * (e.metrics.payoffLossPct / 100);
    const evEur = size * evPerEur;

    return {
      ticker: e.deal.ticker,
      sizeEur: size,
      evEur,
      evPerEur,
      runtimeMaxEur: runtimeMax,
      softThresholdEur: e.softThresholdEur,
      pastSoftThreshold: pastSoft,
      clampedToRuntimeMax: blockedBy != null,
      metrics: e.metrics,
    };
  });

  // ── Category usage cards ────────────────────────────────────────────────
  // Recompute totals after clamping (use the actual size values, not requested).
  const finalByPhase = new Map<string, number>();
  const finalByIndication = new Map<string, number>();
  for (let i = 0; i < perDeal.length; i++) {
    const phase = enriched[i].deal.cells.clinicalPhase || "Unknown";
    const ind = enriched[i].deal.cells.clinicalIndication || "Unknown";
    finalByPhase.set(phase, (finalByPhase.get(phase) ?? 0) + perDeal[i].sizeEur);
    finalByIndication.set(ind, (finalByIndication.get(ind) ?? 0) + perDeal[i].sizeEur);
  }

  const capByCategory: CategoryUsage[] = [];
  for (const [phase, deployed] of finalByPhase) {
    capByCategory.push({
      category: "phase",
      label: phase,
      deployedEur: deployed,
      capEur: phaseCapEur,
      usageFraction: phaseCapEur > 0 ? deployed / phaseCapEur : 0,
      disabled: false,
    });
  }
  for (const [ind, deployed] of finalByIndication) {
    const disabled = disabledIndications.has(ind);
    capByCategory.push({
      category: "indication",
      label: ind,
      deployedEur: deployed,
      capEur: indicationCapEur,
      usageFraction: indicationCapEur > 0 && !disabled ? deployed / indicationCapEur : 0,
      disabled,
      disabledReason: disabled ? "no variance" : undefined,
    });
  }
  // Stable sort for UI: phase first (by label), then indication
  capByCategory.sort((a, b) => {
    if (a.category !== b.category) return a.category === "phase" ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  const evTotal = perDeal.reduce((s, d) => s + d.evEur, 0);
  const allocated = perDeal.reduce((s, d) => s + d.sizeEur, 0);
  const evMeetsTarget = evTotal >= input.breakevenTargetEur;
  const evProgress =
    input.breakevenTargetEur > 0
      ? Math.max(0, evTotal / input.breakevenTargetEur)
      : evTotal > 0
        ? 1
        : 0;

  return {
    perDeal,
    evTotalEur: evTotal,
    allocatedEur: allocated,
    capByCategory,
    frictionEvents,
    evMeetsTarget,
    evProgress,
  };
}

// ── Slider clamp helper (called by UI on drag) ────────────────────────────

/**
 * Given a candidate size for a single deal, clamp it to the runtime max so
 * the slider physically cannot push the category over the cap.
 *
 * This is a convenience helper for the UI; the same logic is enforced inside
 * `computePositionState` to keep the cap invariant tight.
 */
export function clampSliderToRuntimeMax(
  candidateEur: number,
  ticker: string,
  state: ComputedWidgetState,
): number {
  const d = state.perDeal.find((p) => p.ticker === ticker);
  if (!d) return Math.max(0, candidateEur);
  return Math.max(0, Math.min(candidateEur, d.runtimeMaxEur));
}
