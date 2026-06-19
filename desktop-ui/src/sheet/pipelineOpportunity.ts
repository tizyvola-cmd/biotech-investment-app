/**
 * Metriche pipeline unificate — ranking icone maialino, tono chip e sort
 * allineati al ROI **target** (fine tratto in salita), non al P&L realizzato.
 */
import { dealRankVisual, dealRankVisualFromGainPct, type DealRankVisual } from "./dealRankIcon";
import type { PortfolioPnlTone } from "./portfolioGainLossStyle";

const EPS_PCT = 0.05;

/** Tono da ROI target (%). */
export function pipelineToneFromReturnPct(
  pct: number | null | undefined,
): PortfolioPnlTone {
  if (pct == null || !Number.isFinite(pct)) return "flat";
  if (pct < -EPS_PCT) return "loss";
  if (pct > EPS_PCT) return "gain";
  return "flat";
}

export function pipelineStatusLabel(tone: PortfolioPnlTone, lang: "it" | "en"): string {
  if (tone === "gain") return lang === "it" ? "Target ↑" : "Target ↑";
  if (tone === "loss") return lang === "it" ? "Target ↓" : "Target ↓";
  return lang === "it" ? "Target —" : "Target —";
}

export function buildPipelineRankIndexMap<T>(
  items: T[],
  getKey: (item: T) => string,
  getReturnPct: (item: T) => number | null,
): { rankByKey: Map<string, number>; total: number } {
  const sorted = [...items].sort((a, b) => {
    const ga = getReturnPct(a);
    const gb = getReturnPct(b);
    return (gb ?? Number.NEGATIVE_INFINITY) - (ga ?? Number.NEGATIVE_INFINITY);
  });
  const rankByKey = new Map<string, number>();
  sorted.forEach((item, i) => rankByKey.set(getKey(item), i));
  return { rankByKey, total: sorted.length };
}

export function sortByPipelineReturnPct<T>(
  items: T[],
  getReturnPct: (item: T) => number | null,
): T[] {
  return [...items].sort(
    (a, b) =>
      (getReturnPct(b) ?? Number.NEGATIVE_INFINITY) -
      (getReturnPct(a) ?? Number.NEGATIVE_INFINITY),
  );
}

export function pipelineRankVisual(
  planReturnPct: number | null,
  rankIndex: number | null | undefined,
  rankTotal: number,
): DealRankVisual | null {
  if (rankIndex != null && rankTotal > 0) {
    return dealRankVisual(rankIndex, rankTotal);
  }
  const tone = pipelineToneFromReturnPct(planReturnPct);
  if (tone === "flat") return dealRankVisual(1, 4);
  if (planReturnPct != null && Number.isFinite(planReturnPct)) {
    return dealRankVisualFromGainPct(planReturnPct);
  }
  return null;
}

export function summarizePipelineTones(
  rows: ReadonlyArray<{ planReturnPct: number | null }>,
): { gain: number; loss: number; flat: number; total: number } {
  let gain = 0;
  let loss = 0;
  let flat = 0;
  for (const row of rows) {
    const tone = pipelineToneFromReturnPct(row.planReturnPct);
    if (tone === "gain") gain += 1;
    else if (tone === "loss") loss += 1;
    else flat += 1;
  }
  return { gain, loss, flat, total: rows.length };
}

/** Aggiustamento upsideScore Decision Lab quando ROI target è noto. */
export function upsideScorePipelineAdjust(
  baseScore: number,
  planReturnPct: number | null,
): number {
  if (planReturnPct == null || !Number.isFinite(planReturnPct)) return baseScore;
  if (planReturnPct <= 0) {
    return Math.min(baseScore, 12) + planReturnPct * 2.5;
  }
  return baseScore + Math.min(22, planReturnPct * 1.8);
}
