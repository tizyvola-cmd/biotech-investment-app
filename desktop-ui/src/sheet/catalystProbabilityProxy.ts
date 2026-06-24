/**
 * Catalyst Probability Proxy — pure functions only, no side effects, no network.
 *
 * Takes analyst consensus/price-target data as input and produces a structured
 * proxy output. Deliberately does NOT produce a single probability percentage —
 * see the principle-of-use note below.
 *
 * PRINCIPLE OF USE (non-negotiable):
 *   Analyst consensus and price-target dispersion are MARKET SENTIMENT proxies.
 *   They are epistemically different from the shrunk win-rate frequencies used
 *   by the Calibration Center and PCSE. They must NEVER be displayed at the
 *   same level of confidence as calibrated probabilities (e.g. P(plan) 63%).
 *   Output is always a qualitative tier + visible source + visible asOf date.
 *   If in the future a numeric value is desired, it must be labelled explicitly
 *   as "proxy indicativo da dispersione analisti, non probabilità calibrata".
 */

// ── Input types ────────────────────────────────────────────────────────────

export type AnalystRating = "buy" | "outperform" | "hold" | "underperform" | "sell";

export type AnalystTarget = {
  /** Analyst firm or source label. */
  firm: string;
  rating: AnalystRating | null;
  /** Price target in currency units (same as current price). */
  pricetarget: number | null;
  /** ISO date of the rating/target. */
  asOf: string;
};

export type ConsensusInput = {
  ticker: string;
  /** Current market price in the same currency as price targets. */
  currentPrice: number | null;
  analysts: AnalystTarget[];
  /** ISO date when this consensus snapshot was fetched. */
  snapshotAt: string;
  /** Free-form source label (e.g. "Yahoo Finance", "Bloomberg", "manual"). */
  source: string;
};

// ── Output types ───────────────────────────────────────────────────────────

/**
 * Qualitative uncertainty tier derived from consensus + dispersion.
 * Never a probability percentage — see module docstring.
 *
 * - "high_binary":   High dispersion (spread > 50% of mean target) AND
 *                    a binary catalyst event is likely pending. Uncertainty
 *                    is structural, not resolvable by more analysis.
 * - "moderate":      Moderate dispersion; mixed ratings; consensus unclear.
 * - "broad_consensus": Low dispersion (spread < 20% of mean target) AND
 *                    majority buy/outperform ratings.
 * - "insufficient":  Fewer than MIN_ANALYSTS_FOR_TIER analysts with targets.
 */
export type UncertaintyTier =
  | "high_binary"
  | "moderate"
  | "broad_consensus"
  | "insufficient";

export type ConsensusLabel = "Strong Buy" | "Buy" | "Mixed" | "Hold" | "Sell" | "Insufficient";

export type ProxyResult = {
  ticker: string;
  /** Consensus label — majority-vote of ratings. */
  consensusLabel: ConsensusLabel;
  /** Count of each rating type among analysts. */
  ratingCounts: Record<AnalystRating, number>;
  /** Number of analysts with a price target. */
  analystCount: number;
  /** Mean price target. null if no targets available. */
  meanTarget: number | null;
  /** Min price target. null if < 2 targets. */
  minTarget: number | null;
  /** Max price target. null if < 2 targets. */
  maxTarget: number | null;
  /**
   * Spread = (max - min). Shown explicitly as DISAGREEMENT, not averaged away.
   * null if < 2 targets.
   */
  spread: number | null;
  /**
   * Spread as % of mean target — normalized disagreement measure.
   * null if mean = 0 or < 2 targets.
   */
  spreadPct: number | null;
  /** Upside % from current price to mean target. null if currentPrice = null. */
  upsidePct: number | null;
  /** Downside % from current price to min target. null if currentPrice = null. */
  downsideToMinPct: number | null;
  /** Upside % from current price to max target. null if currentPrice = null. */
  upsideToMaxPct: number | null;
  /**
   * Qualitative uncertainty tier. NEVER present this as equivalent to a
   * calibrated probability — always show the tier label + source + asOf.
   */
  uncertaintyTier: UncertaintyTier;
  /** Human-readable explanation of the tier assignment. */
  tierRationale: string;
  /** ISO date of the underlying consensus snapshot. */
  asOf: string;
  /** Source label (e.g. "Yahoo Finance", "manual entry"). */
  source: string;
};

// ── Constants ──────────────────────────────────────────────────────────────

const MIN_ANALYSTS_FOR_TIER = 2;
/** Spread > this fraction of mean target → elevated dispersion. */
const HIGH_DISPERSION_THRESHOLD = 0.50;
/** Spread < this fraction of mean target → low dispersion. */
const LOW_DISPERSION_THRESHOLD = 0.20;
/** Fraction of buy+outperform ratings to qualify for broad_consensus. */
const BROAD_CONSENSUS_BUY_FRACTION = 0.60;

// ── Helpers ────────────────────────────────────────────────────────────────

function computeConsensusLabel(
  counts: Record<AnalystRating, number>,
  total: number,
): ConsensusLabel {
  if (total === 0) return "Insufficient";
  const bullish = counts.buy + counts.outperform;
  const bearish = counts.sell + counts.underperform;
  const bullFrac = bullish / total;
  const bearFrac = bearish / total;
  if (bullFrac >= 0.70) return "Strong Buy";
  if (bullFrac >= 0.50) return "Buy";
  if (bearFrac >= 0.50) return "Sell";
  if (counts.hold / total >= 0.50) return "Hold";
  return "Mixed";
}

function pct(a: number, b: number): number {
  return Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Derive a structured proxy from analyst consensus data.
 *
 * Pure function — deterministic, no side effects, fully testable in isolation.
 * Call this whenever a new ConsensusInput is saved and store the ProxyResult
 * alongside the raw input.
 */
export function deriveProxyFromConsensus(input: ConsensusInput): ProxyResult {
  const { ticker, analysts, currentPrice, snapshotAt, source } = input;

  const counts: Record<AnalystRating, number> = {
    buy: 0,
    outperform: 0,
    hold: 0,
    underperform: 0,
    sell: 0,
  };
  for (const a of analysts) {
    if (a.rating) counts[a.rating]++;
  }
  const totalRatings = analysts.filter((a) => a.rating).length;
  const consensusLabel = computeConsensusLabel(counts, totalRatings);

  const targets = analysts
    .map((a) => a.pricetarget)
    .filter((t): t is number => t != null && Number.isFinite(t) && t > 0);

  const analystCount = targets.length;
  const meanTarget =
    analystCount > 0
      ? Math.round((targets.reduce((s, t) => s + t, 0) / analystCount) * 100) / 100
      : null;
  const minTarget = analystCount >= 2 ? Math.min(...targets) : null;
  const maxTarget = analystCount >= 2 ? Math.max(...targets) : null;
  const spread = minTarget != null && maxTarget != null ? maxTarget - minTarget : null;
  const spreadPct =
    spread != null && meanTarget != null && meanTarget > 0
      ? Math.round((spread / meanTarget) * 1000) / 10
      : null;

  const upsidePct =
    meanTarget != null && currentPrice != null && currentPrice > 0
      ? pct(meanTarget, currentPrice)
      : null;
  const downsideToMinPct =
    minTarget != null && currentPrice != null && currentPrice > 0
      ? pct(minTarget, currentPrice)
      : null;
  const upsideToMaxPct =
    maxTarget != null && currentPrice != null && currentPrice > 0
      ? pct(maxTarget, currentPrice)
      : null;

  // ── Tier assignment ──────────────────────────────────────────────────────
  let uncertaintyTier: UncertaintyTier;
  let tierRationale: string;

  if (analystCount < MIN_ANALYSTS_FOR_TIER) {
    uncertaintyTier = "insufficient";
    tierRationale = `Only ${analystCount} analyst target(s) available — minimum ${MIN_ANALYSTS_FOR_TIER} needed for tier classification.`;
  } else if (spreadPct != null && spreadPct > HIGH_DISPERSION_THRESHOLD * 100) {
    uncertaintyTier = "high_binary";
    tierRationale = `High analyst disagreement: price target spread is ${spreadPct.toFixed(0)}% of the mean target (threshold: ${HIGH_DISPERSION_THRESHOLD * 100}%). Structural uncertainty — not resolvable by more analysis of the same data.`;
  } else if (
    spreadPct != null &&
    spreadPct < LOW_DISPERSION_THRESHOLD * 100 &&
    totalRatings > 0 &&
    (counts.buy + counts.outperform) / totalRatings >= BROAD_CONSENSUS_BUY_FRACTION
  ) {
    uncertaintyTier = "broad_consensus";
    tierRationale = `Low spread (${spreadPct?.toFixed(0) ?? "—"}% of mean) and ${Math.round(((counts.buy + counts.outperform) / totalRatings) * 100)}% bullish ratings — relatively aligned analyst view.`;
  } else {
    uncertaintyTier = "moderate";
    tierRationale = `Mixed signals: spread ${spreadPct?.toFixed(0) ?? "—"}% of mean target, ratings split across categories.`;
  }

  return {
    ticker,
    consensusLabel,
    ratingCounts: counts,
    analystCount,
    meanTarget,
    minTarget,
    maxTarget,
    spread: spread != null ? Math.round(spread * 100) / 100 : null,
    spreadPct,
    upsidePct,
    downsideToMinPct,
    upsideToMaxPct,
    uncertaintyTier,
    tierRationale,
    asOf: snapshotAt,
    source,
  };
}

// ── Tier display helpers ───────────────────────────────────────────────────

export function tierLabel(tier: UncertaintyTier, lang: "it" | "en"): string {
  if (lang === "it") {
    switch (tier) {
      case "high_binary": return "Alta incertezza binaria";
      case "moderate": return "Incertezza moderata";
      case "broad_consensus": return "Consenso ampio";
      case "insufficient": return "Dati insufficienti";
    }
  }
  switch (tier) {
    case "high_binary": return "High binary uncertainty";
    case "moderate": return "Moderate uncertainty";
    case "broad_consensus": return "Broad consensus";
    case "insufficient": return "Insufficient data";
  }
}

export function tierColorClass(tier: UncertaintyTier): string {
  switch (tier) {
    case "high_binary": return "text-rose-700 dark:text-rose-300 bg-rose-100/60 dark:bg-rose-900/30";
    case "moderate": return "text-amber-700 dark:text-amber-300 bg-amber-100/60 dark:bg-amber-900/30";
    case "broad_consensus": return "text-emerald-700 dark:text-emerald-300 bg-emerald-100/60 dark:bg-emerald-900/30";
    case "insufficient": return "text-slate-500 dark:text-slate-400 bg-slate-100/60 dark:bg-slate-800/30";
  }
}
