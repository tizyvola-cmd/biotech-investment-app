/**
 * Weight Sim Exp — find portfolio shares that maximise cumulative 24h gain
 * (or best approach a chart target) using realised move % per deal.
 *
 * Pure module — no React. Used by Step 3 breakeven chart + synthesizer.
 */

export type WeightSimExpDealInput = {
  rowKey: string;
  ticker: string;
  /** Realised 24h move in % (fallback MTM when 24h missing). */
  movePct24h: number;
  /** Baseline share (e.g. weighted sizing) in [0, 1]. */
  baselineShare: number;
};

export type WeightSimExpResult = {
  shares: number[];
  /** € gain at full book: Σ share_i × capital × move_i / 100 */
  finalGainEur: number;
  /** User target from chart (may be null when only maximising). */
  targetGainEur: number;
  targetReached: boolean;
  /** Max achievable gain on this universe (same formula, optimal shares). */
  maxGainEur: number;
  unreachableReason: string | null;
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

/** Per-deal € contribution when 100 % of capital is allocated to that deal. */
export function gainContributionEur(movePct24h: number, capitalEur: number): number {
  if (!Number.isFinite(movePct24h) || !Number.isFinite(capitalEur) || capitalEur <= 0) {
    return 0;
  }
  return (capitalEur * movePct24h) / 100;
}

/** Dot product: portfolio gain from share vector. */
export function cumulativeGainFromShares(
  shares: number[],
  contributionsEur: number[],
): number {
  let sum = 0;
  for (let i = 0; i < shares.length; i += 1) {
    sum += (shares[i] ?? 0) * (contributionsEur[i] ?? 0);
  }
  return sum;
}

/**
 * Maximise Σ s_i c_i on the simplex (Σ s_i = 1, s_i ≥ 0).
 * Weights positive contributors proportionally; if all ≤ 0, concentrate on
 * the least-negative mover (minimise loss).
 */
export function optimizeSharesMaxGain(contributionsEur: number[]): number[] {
  const n = contributionsEur.length;
  if (n === 0) return [];

  const positive = contributionsEur.map((c) => (c > 0 ? c : 0));
  const posSum = positive.reduce((s, v) => s + v, 0);
  if (posSum > 0) {
    return positive.map((c) => c / posSum);
  }

  let bestIdx = 0;
  let best = contributionsEur[0] ?? -Infinity;
  for (let i = 1; i < n; i += 1) {
    const c = contributionsEur[i] ?? -Infinity;
    if (c > best) {
      best = c;
      bestIdx = i;
    }
  }
  return contributionsEur.map((_, i) => (i === bestIdx ? 1 : 0));
}

/** Clamp each share to maxShare — no renormalize (sum may be < 1; each deal obeys cap). */
export function clampSharesForDisplay(
  shares: number[],
  maxShare = 0.25,
): number[] {
  return shares.map((v) => {
    const raw = Number.isFinite(v) && v > 0 ? v : 0;
    return Math.min(maxShare, raw);
  });
}

/**
 * @deprecated Prefer clampSharesForDisplay for UI hints. Kept for iterative redistribution tests.
 */
export function capAndRenormalizeShares(
  shares: number[],
  maxShare = 0.25,
): number[] {
  const n = shares.length;
  if (n === 0) return [];
  const equal = 1 / n;
  let s = shares.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const sum = s.reduce((a, b) => a + b, 0);
  if (sum <= 0) return shares.map(() => equal);
  s = s.map((v) => v / sum);

  for (let iter = 0; iter < 64; iter++) {
    let excess = 0;
    let anyOver = false;
    const capped = s.map((v) => {
      if (v > maxShare + 1e-12) {
        anyOver = true;
        excess += v - maxShare;
        return maxShare;
      }
      return v;
    });
    if (!anyOver) return clampSharesForDisplay(capped, maxShare);
    const belowIdx = capped
      .map((v, i) => (v < maxShare - 1e-12 ? i : -1))
      .filter((i) => i >= 0);
    if (belowIdx.length === 0) return clampSharesForDisplay(capped, maxShare);
    const add = excess / belowIdx.length;
    s = capped.map((v, i) =>
      belowIdx.includes(i) ? Math.min(maxShare, v + add) : v,
    );
  }
  return clampSharesForDisplay(s, maxShare);
}

/** Blend max-gain mix with equal weight, then enforce per-deal cap (no sum-to-100% force). */
export function blendAndCapSharesForDisplay(
  shares: number[],
  maxShare = 0.25,
  expWeight = 0.35,
): number[] {
  const n = shares.length;
  if (n === 0) return [];
  const equal = 1 / n;
  const blended = shares.map((v) => {
    const raw = Number.isFinite(v) && v > 0 ? v : 0;
    return expWeight * raw + (1 - expWeight) * equal;
  });
  const sum = blended.reduce((a, b) => a + b, 0);
  const normalized = sum > 0 ? blended.map((v) => v / sum) : blended.map(() => equal);
  return clampSharesForDisplay(normalized, maxShare);
}

/**
 * Reach at least `targetGainEur` when feasible; otherwise return the max-gain mix.
 * When multiple mixes reach the target, we still use the max-gain allocation
 * (same as unconstrained optimum when max ≥ target).
 */
export function optimizeWeightSimExp(
  deals: WeightSimExpDealInput[],
  capitalEur: number,
  targetGainEur: number,
): WeightSimExpResult | null {
  if (deals.length === 0 || capitalEur <= 0) return null;

  const contributions = deals.map((d) => gainContributionEur(d.movePct24h, capitalEur));
  const shares = optimizeSharesMaxGain(contributions);
  const maxGainEur = cumulativeGainFromShares(shares, contributions);
  const target = Math.max(0, targetGainEur);
  const targetReached = maxGainEur >= target - 1e-6;

  let unreachableReason: string | null = null;
  if (!targetReached && target > 0) {
    unreachableReason = `Max ${Math.round(maxGainEur)} € < target ${Math.round(target)} €`;
  }

  return {
    shares,
    finalGainEur: maxGainEur,
    targetGainEur: target,
    targetReached,
    maxGainEur,
    unreachableReason,
  };
}

/** Raw slider weights (0..200 scale) from optimised shares. */
export function optimizedSharesToRawWeights(shares: number[]): number[] {
  return shares.map((s) => Math.round(clamp01(s) * 100));
}
