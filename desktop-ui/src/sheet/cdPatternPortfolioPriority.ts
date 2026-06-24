import type { CdPatternTickerRecommendation } from "./cdPatternRecommendation";
import type { CdPatternWindowId } from "./cdPatternHorizons";

/** Arc urgency — later windows weigh more (closer to readout). */
const WINDOW_URGENCY: Record<CdPatternWindowId, number> = {
  w1: 35,
  w2: 55,
  w3: 72,
  w4: 88,
  w5: 100,
};

const VERDICT_SCORE: Record<CdPatternTickerRecommendation["verdict"], number> = {
  strong: 100,
  watch: 72,
  weak: 45,
  blocked: 15,
};

function clamp0_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Days-to-CD compression: hot zone (≤7d) = 100, fades toward 60d. */
export function cdProximityUrgency(daysToCd: number | null): number {
  if (daysToCd == null || !Number.isFinite(daysToCd)) return 40;
  if (daysToCd <= 0) return 100;
  if (daysToCd <= 7) return 100;
  if (daysToCd <= 14) return 88;
  if (daysToCd <= 30) return 70;
  if (daysToCd <= 60) return 50;
  return 25;
}

function segmentMomentum(segmentRoiPct: number | null): number {
  if (segmentRoiPct == null || !Number.isFinite(segmentRoiPct)) return 50;
  return clamp0_100(50 + segmentRoiPct * 2.5);
}

export type CdPatternPriorityInput = {
  rec: CdPatternTickerRecommendation;
  inPortfolio: boolean;
};

/**
 * Portfolio Pattern Index (PPI) 0–100 — higher = review first.
 * Blends polygon match, arc/window urgency, CD proximity, verdict and segment momentum.
 */
export function computeCdPatternPriorityIndex({ rec, inPortfolio }: CdPatternPriorityInput): number {
  const match = rec.matchPct;
  const arc = WINDOW_URGENCY[rec.window.id] ?? 50;
  const cdUrg = cdProximityUrgency(rec.daysToCd);
  const verdict = VERDICT_SCORE[rec.verdict];
  const momentum = segmentMomentum(rec.segmentRoiPct);

  let score =
    match * 0.38 +
    arc * 0.27 +
    cdUrg * 0.2 +
    verdict * 0.1 +
    momentum * 0.05;

  if (inPortfolio) {
    // Low match near readout → sell/review attention boost.
    if (match < 50 && cdUrg >= 88) score += 12;
    else if (match >= 65 && cdUrg >= 70) score += 6;
    score += 4;
  }

  return clamp0_100(score);
}

export function sortCdPatternByPortfolioPriority(
  rows: CdPatternTickerRecommendation[],
  portfolioByKey: Map<string, boolean>,
): CdPatternTickerRecommendation[] {
  return [...rows].sort((a, b) => {
    const aPf = portfolioByKey.get(a.key) ?? false;
    const bPf = portfolioByKey.get(b.key) ?? false;
    if (aPf !== bPf) return aPf ? -1 : 1;
    const aIdx = computeCdPatternPriorityIndex({ rec: a, inPortfolio: aPf });
    const bIdx = computeCdPatternPriorityIndex({ rec: b, inPortfolio: bPf });
    if (bIdx !== aIdx) return bIdx - aIdx;
    const da = a.daysToCd ?? 999;
    const db = b.daysToCd ?? 999;
    if (da !== db) return da - db;
    return b.matchPct - a.matchPct;
  });
}

/** Polygon match % descending — higher fit first. */
export function sortCdPatternByMatchScore(
  rows: CdPatternTickerRecommendation[],
): CdPatternTickerRecommendation[] {
  return [...rows].sort((a, b) => {
    if (b.matchPct !== a.matchPct) return b.matchPct - a.matchPct;
    const da = a.daysToCd ?? 999;
    const db = b.daysToCd ?? 999;
    if (da !== db) return da - db;
    return a.ticker.localeCompare(b.ticker);
  });
}

export function portfolioPriorityRank(
  rec: CdPatternTickerRecommendation,
  sortedPortfolio: CdPatternTickerRecommendation[],
): number | null {
  const i = sortedPortfolio.findIndex((r) => r.key === rec.key);
  return i >= 0 ? i + 1 : null;
}
