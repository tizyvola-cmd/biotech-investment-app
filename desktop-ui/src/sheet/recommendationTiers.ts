/**
 * Gerarchia raccomandazioni condivisa tra tab (Decision Lab → Dashboard → Simulation).
 *
 * | Tier        | Origine              | Criteri (Decision Lab)                    | UI |
 * |-------------|----------------------|-------------------------------------------|-----|
 * | top2_buy    | pickTop2BuyCandidates| Hot Top, fuori portafoglio, ROI/giorno top2| Top2BuySellPanel |
 * | hot_top     | upsideClassification | CD ≤60d, pred/aff/quality/pre-CD enter    | Decision Lab hot cards |
 * | watch_top   | watchClassification  | CD 61–120d, R²/timing, pre-CD ok          | Decision Lab watch cards |
 *
 * Pubblicato da InvestmentSignalsPanel via topOppsStore dopo cohortLoaded.
 */

import type { TopOppsSnapshot } from "./topOppsStore";

export type RecommendationTier = "top2_buy" | "hot_top" | "watch_top" | "none";

/** Chiavi serie da lista segnali (simRow → co:TICKER|YYYY-MM-DD). */
export function seriesKeysFromSimRows(
  rows: Array<{ simRow?: Record<string, unknown> | null }>,
  keyFn: (row: Record<string, unknown>) => string | null,
): string[] {
  const keys: string[] = [];
  for (const item of rows) {
    const row = item.simRow;
    if (!row) continue;
    const k = keyFn(row);
    if (k) keys.push(k);
  }
  return keys;
}

export function recommendationTierForKey(
  seriesKey: string | null | undefined,
  inPortfolio: boolean,
  snap: TopOppsSnapshot,
): RecommendationTier {
  if (!seriesKey) return "none";
  if (!inPortfolio && snap.top2BuyKeySet.has(seriesKey)) return "top2_buy";
  if (snap.hotKeySet.has(seriesKey)) return "hot_top";
  if (snap.watchKeySet.has(seriesKey)) return "watch_top";
  return "none";
}

export function isPublishedHotTop(
  seriesKey: string | null | undefined,
  snap: TopOppsSnapshot,
): boolean {
  return seriesKey != null && snap.hotKeySet.has(seriesKey);
}

export function isPublishedWatchTop(
  seriesKey: string | null | undefined,
  snap: TopOppsSnapshot,
): boolean {
  return seriesKey != null && snap.watchKeySet.has(seriesKey);
}

export function isTop2BuyKey(
  seriesKey: string | null | undefined,
  snap: TopOppsSnapshot,
): boolean {
  return seriesKey != null && snap.top2BuyKeySet.has(seriesKey);
}

/** Store pubblicato e non vuoto (Decision Lab ha calcolato almeno una hot Top). */
export function hasPublishedRecommendations(snap: TopOppsSnapshot): boolean {
  return snap.hotKeys.length > 0 || snap.watchKeys.length > 0;
}
