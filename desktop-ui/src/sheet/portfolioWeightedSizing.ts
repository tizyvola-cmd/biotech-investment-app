/**
 * Risk-aware portfolio sizing — pure module.
 *
 * Given a list of `ComparisonDeal` objects (built upstream from the shared
 * `threePortfolioCompare` pipeline so every probability of success, SDS
 * expected gain and pattern-match decision in the system comes from the SAME
 * source), this module produces:
 *
 *   1. A per-deal capital share proportional to the deal's probability of
 *      success × expected gain at the SDS target — damped by confidence and
 *      penalised when the deal matches the approved Phase B risk pattern.
 *   2. The portfolio-level weighted EV per € invested (probability-weighted
 *      expected return at SDS target), ready to feed the "cumulative expected
 *      gain vs capital invested" chart.
 *   3. A `perDealBreakdown` array carrying every intermediate factor so the
 *      UI can render an inspectable table (no opaque combined score).
 *
 * Formula (matches the user-facing brief for Step 3):
 *
 *     evPerEur(d)         = winRate(d) × payoffWinPct(d) / 100
 *                           ⤷ probability-weighted expected gain at the SDS
 *                             target.  `winRate` is the deal's calibrated
 *                             P(positive close), `payoffWinPct` is the SDS-
 *                             curve-derived expected gain when the deal
 *                             reaches its target.  No downside subtraction —
 *                             failure risk enters through the patternFactor
 *                             multiplier below, NOT by inverting the EV sign.
 *     rawScore(d)         = max(0, evPerEur(d))
 *     confMul(d)          = confidenceMultipliers[d.confidence]
 *     patternFactor(d)    = matchesStep2Pattern(d) ? patternPenalty : 1
 *     adjustedScore(d)    = rawScore(d) × confMul(d) × patternFactor(d)
 *                           ⤷ "allocation budget per company is proportional
 *                              to both failure risk and potential return", per
 *                              the brief.
 *     sizeShare(d)        = adjustedScore(d) / Σ adjustedScore(j)
 *
 * Because `winRate ≥ 0` and `payoffWinPct` is typically ≥ 0 (it's the SDS-
 * curve expected gain at target), `evPerEur` is non-negative for every deal
 * with a valid SDS bucket — and so are the curves on the chart.  The slope is
 * a positive number that grows with capital invested, reaching the user's
 * spend target at the breakeven capital.
 *
 * Both the real-portfolio and the sim-loop curves call this module with the
 * same logic — each scenario contributes its OWN winRate and payoffWinPct,
 * so the chart reacts in real time as calibration / SDS / pattern data change.
 *
 * Confidence multipliers default to the same values used by the interactive
 * "frizione su LOW confidence" slider widget (`portfolioSizingWidget`'s
 * `DEFAULT_FRICTION_THRESHOLDS`) — single source of truth, so the two
 * surfaces cannot drift apart in the future.
 *
 * When all deals get a zero `adjustedScore` (e.g. every deal hits the pattern
 * with patternPenalty = 0, or every payoffWinPct is missing), we fall back to
 * uniform sizing so the curve is still well-defined and the UI flags the
 * fallback.
 *
 * No React, no localStorage, no I/O — testable in isolation.
 */
import type { ComparisonDeal } from "./threePortfolioCompare";
import type { ConfidenceLevel } from "../calibration/calibrationTypes";
import { DEFAULT_FRICTION_THRESHOLDS } from "./portfolioSizingWidget";

/** Per-confidence damping multiplier in [0, 1]. */
export type ConfidenceMultiplierMap = Record<ConfidenceLevel, number>;

export type WeightedSizingConfig = {
  /** Damping factor applied to `rawScore`. Defaults to the same numbers as the
   *  interactive sizing widget's `DEFAULT_FRICTION_THRESHOLDS` so the two
   *  surfaces stay aligned. */
  confidenceMultipliers: ConfidenceMultiplierMap;
  /** Multiplier in (0, 1] applied to deals that match the approved Phase B
   *  pattern. Defaults to 0.5 (halves the deal's weight). */
  patternPenalty: number;
};

/** Reuse the exact same numbers as the widget's friction thresholds — that
 *  way we have a single source of truth across both surfaces. If the friction
 *  scheme is ever re-tuned, the chart and the slider stay in lockstep. */
export const DEFAULT_CONFIDENCE_MULTIPLIERS: ConfidenceMultiplierMap = {
  low: DEFAULT_FRICTION_THRESHOLDS.low,
  medium: DEFAULT_FRICTION_THRESHOLDS.medium,
  high: DEFAULT_FRICTION_THRESHOLDS.high,
};

export const DEFAULT_WEIGHTED_SIZING_CONFIG: WeightedSizingConfig = {
  confidenceMultipliers: DEFAULT_CONFIDENCE_MULTIPLIERS,
  patternPenalty: 0.5,
};

export type DealSizingBreakdown = {
  ticker: string;
  rowKey: string;
  label: string;
  /** Probability of success for this deal (calibrated P(positive close),
   *  shrunk). Surfaced so the UI can show the input alongside the resulting
   *  share — the chart reacts in real time as this value updates. */
  pSuccess: number;
  /** SDS-curve expected gain at target, in % per €. */
  sdsExpectedGainPct: number;
  /** Probability-weighted expected return per € invested in fractional units
   *  (e.g. 0.024 = +2.4 % per € invested at SDS target).
   *  evPerEur = pSuccess × sdsExpectedGainPct / 100. */
  evPerEur: number;
  /** `max(0, evPerEur)` — zero for deals with missing payoff data. */
  rawScore: number;
  confidence: ConfidenceLevel;
  confidenceMultiplier: number;
  matchesStep2Pattern: boolean;
  patternPenaltyFactor: number;
  adjustedScore: number;
  /** Capital share in [0, 1]; sums to 1 across all deals (or 0 if every deal
   *  has zero adjustedScore — in that fallback case the chart treats the
   *  portfolio as uniform). */
  sizeShare: number;
};

export type WeightedPortfolioStats = {
  /** Capital-weighted win rate in [0, 1]. */
  weightedWinRate: number;
  /** Capital-weighted EV per € invested (fractional, e.g. 0.024 = +2.4 %). */
  weightedEvPerEur: number;
  /** EV per € invested under uniform (equal-split) sizing. Exposed so the UI
   *  can show the same comparison without recomputing locally. */
  uniformEvPerEur: number;
  /** Number of deals with a positive `adjustedScore` (i.e. that actually
   *  receive any capital in weighted mode). Equal to `perDealBreakdown.length`
   *  when uniform fallback kicks in. */
  positionsCount: number;
  /** True when every deal had zero adjustedScore and we fell back to uniform. */
  uniformFallbackActive: boolean;
  perDealBreakdown: DealSizingBreakdown[];
};

/**
 * Probability-weighted expected return per € invested at the SDS target for a
 * single deal:
 *
 *     evPerEur = winRate × payoffWinPct / 100
 *
 * `winRate` is the deal's calibrated P(positive close) (shrunk via the
 * Bayesian engine), `payoffWinPct` is the SDS-curve expected gain at target
 * (in %).  We deliberately do NOT subtract `(1 - winRate) × payoffLossPct`
 * here — this function answers the question "expected gain at target, weighted
 * by the probability of getting there".  The downside enters allocation only
 * via the Step-2 pattern penalty (`patternFactor`), keeping the chart in
 * positive territory whenever there is any positive expected return at the
 * SDS target.
 *
 * Returns 0 (not negative) when payoffWinPct is non-positive or missing, so
 * the caller can treat the value as a non-negative "score per €".
 */
export function evPerEurForDeal(deal: ComparisonDeal): number {
  if (!Number.isFinite(deal.winRate) || !Number.isFinite(deal.payoffWinPct)) {
    return 0;
  }
  if (deal.payoffWinPct <= 0) return 0;
  const wr = Math.max(0, Math.min(1, deal.winRate));
  return (wr * deal.payoffWinPct) / 100;
}

function uniformAverageEvPerEur(deals: ComparisonDeal[]): number {
  if (deals.length === 0) return 0;
  let sum = 0;
  for (const d of deals) sum += evPerEurForDeal(d);
  return sum / deals.length;
}

function uniformAverageWinRate(deals: ComparisonDeal[]): number {
  if (deals.length === 0) return 0;
  let sum = 0;
  for (const d of deals) sum += d.winRate;
  return sum / deals.length;
}

export function computeWeightedPortfolioStats(
  deals: ComparisonDeal[],
  config: WeightedSizingConfig = DEFAULT_WEIGHTED_SIZING_CONFIG,
  matchesStep2Pattern: (deal: ComparisonDeal) => boolean = () => false,
): WeightedPortfolioStats {
  const uniformEvPerEur = uniformAverageEvPerEur(deals);

  if (deals.length === 0) {
    return {
      weightedWinRate: 0,
      weightedEvPerEur: 0,
      uniformEvPerEur: 0,
      positionsCount: 0,
      uniformFallbackActive: false,
      perDealBreakdown: [],
    };
  }

  const intermediate: Omit<DealSizingBreakdown, "sizeShare">[] = deals.map((d) => {
    const evPerEur = evPerEurForDeal(d);
    const rawScore = Math.max(0, evPerEur);
    const confidenceMultiplier =
      config.confidenceMultipliers[d.confidence] ??
      DEFAULT_CONFIDENCE_MULTIPLIERS[d.confidence] ??
      1;
    const matches = matchesStep2Pattern(d);
    const patternPenaltyFactor = matches ? config.patternPenalty : 1;
    const adjustedScore = rawScore * confidenceMultiplier * patternPenaltyFactor;
    return {
      ticker: d.ticker,
      rowKey: d.rowKey,
      label: d.label,
      pSuccess: d.winRate,
      sdsExpectedGainPct: d.payoffWinPct,
      evPerEur,
      rawScore,
      confidence: d.confidence,
      confidenceMultiplier,
      matchesStep2Pattern: matches,
      patternPenaltyFactor,
      adjustedScore,
    };
  });

  const sumScore = intermediate.reduce((s, x) => s + x.adjustedScore, 0);

  // Fallback: when every deal has zero adjustedScore (e.g. all-negative EV or
  // all matched the risk pattern with patternPenalty = 0), we can't form a
  // meaningful proportional split. Fall back to uniform sizing so the chart
  // still has something to draw — and flag it so the UI can warn the user.
  if (sumScore <= 0) {
    const share = 1 / intermediate.length;
    const perDealBreakdown: DealSizingBreakdown[] = intermediate.map((row) => ({
      ...row,
      sizeShare: share,
    }));
    return {
      weightedWinRate: uniformAverageWinRate(deals),
      weightedEvPerEur: uniformEvPerEur,
      uniformEvPerEur,
      positionsCount: intermediate.length,
      uniformFallbackActive: true,
      perDealBreakdown,
    };
  }

  let weightedWr = 0;
  let weightedEv = 0;
  let positionsCount = 0;
  const perDealBreakdown: DealSizingBreakdown[] = intermediate.map((row, i) => {
    const sizeShare = row.adjustedScore / sumScore;
    if (sizeShare > 0) positionsCount += 1;
    weightedWr += sizeShare * deals[i].winRate;
    weightedEv += sizeShare * row.evPerEur;
    return { ...row, sizeShare };
  });

  return {
    weightedWinRate: weightedWr,
    weightedEvPerEur: weightedEv,
    uniformEvPerEur,
    positionsCount,
    uniformFallbackActive: false,
    perDealBreakdown,
  };
}

/** Convenience: equivalent of `computeWeightedPortfolioStats` but for the
 *  uniform-sizing scenario (no toggle). Returns the same shape so the UI can
 *  treat both modes interchangeably. */
export function computeUniformPortfolioStats(
  deals: ComparisonDeal[],
): WeightedPortfolioStats {
  if (deals.length === 0) {
    return {
      weightedWinRate: 0,
      weightedEvPerEur: 0,
      uniformEvPerEur: 0,
      positionsCount: 0,
      uniformFallbackActive: false,
      perDealBreakdown: [],
    };
  }
  const evPerEur = uniformAverageEvPerEur(deals);
  const share = 1 / deals.length;
  const perDealBreakdown: DealSizingBreakdown[] = deals.map((d) => {
    const ev = evPerEurForDeal(d);
    return {
      ticker: d.ticker,
      rowKey: d.rowKey,
      label: d.label,
      pSuccess: d.winRate,
      sdsExpectedGainPct: d.payoffWinPct,
      evPerEur: ev,
      rawScore: Math.max(0, ev),
      confidence: d.confidence,
      confidenceMultiplier: 1,
      matchesStep2Pattern: false,
      patternPenaltyFactor: 1,
      adjustedScore: 1,
      sizeShare: share,
    };
  });
  return {
    weightedWinRate: uniformAverageWinRate(deals),
    weightedEvPerEur: evPerEur,
    uniformEvPerEur: evPerEur,
    positionsCount: deals.length,
    uniformFallbackActive: false,
    perDealBreakdown,
  };
}

/** Capital € at which `capital × evPerEur` first reaches `targetEur`.
 *  Returns `null` when the slope is non-positive (target unreachable). */
export function breakevenCapitalForSlope(
  evPerEur: number,
  targetEur: number,
): number | null {
  if (!Number.isFinite(evPerEur) || evPerEur <= 0) return null;
  if (!Number.isFinite(targetEur) || targetEur <= 0) return 0;
  return targetEur / evPerEur;
}

// ── Probability of positive close ────────────────────────────────────────
//
// The old "Expected returns vs capital invested" chart plotted P(net P&L ≥
// spending) as a sigmoidal function of total capital invested, using the
// binomial distribution over the closed-trade pool. We restore that
// curvilinear shape here but generalise it to a *list of independent deals*
// (each with its own win rate and payoff), so we can plot one curve per
// universe-sizing combination (Portfolio uniform/weighted, Sim loop
// uniform/weighted).

export type ProbabilityCurvePoint = {
  capitalEur: number;
  /** P(net portfolio P&L ≥ spendingTargetEur) × 100 — i.e. percentage, 0..100. */
  probPct: number;
};

/**
 * Probability that the realised net P&L of the *given* deal list, sized by
 * `sizeShares`, lands at or above `spendingTargetEur` — as a function of
 * the total capital invested.
 *
 * Mathematical model:
 *   - Each deal is an independent Bernoulli trial with success probability
 *     `deal.winRate`. On a win the deal returns `size × payoffWinPct/100`;
 *     on a loss it returns `size × payoffLossPct/100` (payoffLossPct is
 *     negative). The portfolio net is the sum.
 *   - We compute P(net ≥ spendingTargetEur) by enumerating all 2^N joint
 *     outcomes when N ≤ `monteCarloThreshold` (default 16, ≤ 65 k states),
 *     otherwise we fall back to Monte Carlo (`monteCarloIterations`).
 *   - The curve is evaluated at every capital point in `capitalRange`; for
 *     each point sizes_i = sizeShares_i × totalCap, with sum(sizeShares) ≈ 1.
 *
 * Edge cases:
 *   - `deals` empty or shares-length mismatched → returns all-zero curve.
 *   - `sizeShares` may sum to slightly less than 1 when some deals have
 *     `evPerEur = 0` and the weighted module zeros their share; in that
 *     case the remaining capital is simply *not invested* (modelled as no
 *     extra Bernoulli trial), which is the correct interpretation.
 */
/** Which per-deal win rate feeds joint portfolio P(+). */
export type PortfolioSuccessWinRateMode = "calibrated" | "raw";

function winRateForPortfolioSuccess(
  deal: ComparisonDeal,
  mode: PortfolioSuccessWinRateMode,
): number {
  const v = mode === "raw" ? (deal.rawWinRate ?? deal.winRate) : deal.winRate;
  return Math.max(0, Math.min(1, v));
}

export function computeProfitProbabilityCurve(
  deals: ComparisonDeal[],
  capitalRange: number[],
  sizeShares: number[],
  spendingTargetEur = 0,
  monteCarloThreshold = 16,
  monteCarloIterations = 2000,
  winRateMode: PortfolioSuccessWinRateMode = "raw",
): ProbabilityCurvePoint[] {
  const n = deals.length;
  if (n === 0 || sizeShares.length !== n) {
    return capitalRange.map((capitalEur) => ({ capitalEur, probPct: 0 }));
  }

  // Pre-compute per-deal constants to avoid repeated field access inside the
  // hot loop (this matters for the 2^N enumeration path).
  const winProbs = deals.map((d) => winRateForPortfolioSuccess(d, winRateMode));
  const lossProbs = winProbs.map((p) => 1 - p);
  const payoffWinFracs = deals.map((d) => d.payoffWinPct / 100);
  const payoffLossFracs = deals.map((d) => d.payoffLossPct / 100);

  const out: ProbabilityCurvePoint[] = [];

  for (const totalCap of capitalRange) {
    const sizes = sizeShares.map((s) => s * totalCap);
    let prob = 0;

    if (n <= monteCarloThreshold) {
      const states = 1 << n;
      let acc = 0;
      for (let bits = 0; bits < states; bits++) {
        let p = 1;
        let net = 0;
        for (let i = 0; i < n; i++) {
          const win = (bits >> i) & 1;
          if (win === 1) {
            p *= winProbs[i];
            net += sizes[i] * payoffWinFracs[i];
          } else {
            p *= lossProbs[i];
            net += sizes[i] * payoffLossFracs[i];
          }
          if (p === 0) break; // zero-probability branch — skip net accumulation
        }
        if (p > 0 && net >= spendingTargetEur) acc += p;
      }
      prob = acc;
    } else {
      let hits = 0;
      for (let it = 0; it < monteCarloIterations; it++) {
        let net = 0;
        for (let i = 0; i < n; i++) {
          const win = Math.random() < winProbs[i];
          net += sizes[i] * (win ? payoffWinFracs[i] : payoffLossFracs[i]);
        }
        if (net >= spendingTargetEur) hits++;
      }
      prob = hits / monteCarloIterations;
    }

    out.push({
      capitalEur: totalCap,
      probPct: Math.min(100, Math.max(0, prob * 100)),
    });
  }

  return out;
}

/** Capital-weighted avg P(positive close) + joint P(net P&L ≥ target) at full pot. */
export type PortfolioSuccessEstimate = {
  /** Share-weighted average win rate (0..1). */
  avgWinRate: number;
  /** P(portfolio net P&L ≥ spendingTargetEur) at totalCapitalEur (0..100). */
  probNetAtTargetPct: number;
};

export function sharesFromCapAllocation(
  deals: ComparisonDeal[],
  capByTicker: Record<string, number>,
  totalCapitalEur: number,
): number[] {
  if (deals.length === 0 || totalCapitalEur <= 0) {
    return deals.map(() => 0);
  }
  return deals.map((d) => {
    const cap = capByTicker[d.ticker] ?? 0;
    return cap > 0 ? cap / totalCapitalEur : 0;
  });
}

export function computePortfolioSuccessEstimate(
  deals: ComparisonDeal[],
  sizeShares: number[],
  totalCapitalEur: number,
  spendingTargetEur = 0,
  winRateMode: PortfolioSuccessWinRateMode = "raw",
): PortfolioSuccessEstimate {
  if (deals.length === 0 || sizeShares.length !== deals.length || totalCapitalEur <= 0) {
    return { avgWinRate: 0, probNetAtTargetPct: 0 };
  }

  let weightedWr = 0;
  let shareSum = 0;
  for (let i = 0; i < deals.length; i++) {
    const s = sizeShares[i] ?? 0;
    if (s <= 0) continue;
    weightedWr += s * winRateForPortfolioSuccess(deals[i], winRateMode);
    shareSum += s;
  }
  const avgWinRate = shareSum > 0 ? weightedWr / shareSum : 0;

  const curve = computeProfitProbabilityCurve(
    deals,
    [totalCapitalEur],
    sizeShares,
    spendingTargetEur,
    16,
    2000,
    winRateMode,
  );
  const probNetAtTargetPct = curve[0]?.probPct ?? 0;

  return { avgWinRate, probNetAtTargetPct };
}

export type PortfolioSizingSuccessComparison = {
  equal: PortfolioSuccessEstimate;
  weighted: PortfolioSuccessEstimate | null;
  synth: PortfolioSuccessEstimate;
  /** P(net ≥ targetGainEur) under synth sizing (24h Step 3 target). */
  synthAtGainTarget: PortfolioSuccessEstimate;
};

export function computePortfolioSizingSuccessComparison(args: {
  deals: ComparisonDeal[];
  totalCapitalEur: number;
  equalCapByTicker: Record<string, number>;
  weightedCapByTicker: Record<string, number> | null;
  synthCapByTicker: Record<string, number>;
  targetGainEur: number;
  winRateMode?: PortfolioSuccessWinRateMode;
}): PortfolioSizingSuccessComparison {
  const { deals, totalCapitalEur, targetGainEur } = args;
  const winRateMode = args.winRateMode ?? "raw";
  const equalShares = sharesFromCapAllocation(deals, args.equalCapByTicker, totalCapitalEur);
  const synthShares = sharesFromCapAllocation(deals, args.synthCapByTicker, totalCapitalEur);
  const weightedShares =
    args.weightedCapByTicker != null
      ? sharesFromCapAllocation(deals, args.weightedCapByTicker, totalCapitalEur)
      : null;

  return {
    equal: computePortfolioSuccessEstimate(deals, equalShares, totalCapitalEur, 0, winRateMode),
    weighted:
      weightedShares != null
        ? computePortfolioSuccessEstimate(deals, weightedShares, totalCapitalEur, 0, winRateMode)
        : null,
    synth: computePortfolioSuccessEstimate(deals, synthShares, totalCapitalEur, 0, winRateMode),
    synthAtGainTarget: computePortfolioSuccessEstimate(
      deals,
      synthShares,
      totalCapitalEur,
      targetGainEur,
      winRateMode,
    ),
  };
}

/** Smallest capital € at which the probability curve first crosses
 *  `targetProbPct` (linear-interpolated between sample points). Returns null
 *  if the curve never reaches the target inside the sampled range. */
export function findBreakevenCapitalFromCurve(
  curve: ProbabilityCurvePoint[],
  targetProbPct: number,
): number | null {
  if (curve.length === 0) return null;
  if (curve[0].probPct >= targetProbPct) return curve[0].capitalEur;
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1];
    const curr = curve[i];
    if (prev.probPct < targetProbPct && curr.probPct >= targetProbPct) {
      const span = curr.probPct - prev.probPct;
      if (span <= 0) return curr.capitalEur;
      const t = (targetProbPct - prev.probPct) / span;
      return prev.capitalEur + t * (curr.capitalEur - prev.capitalEur);
    }
  }
  return null;
}
