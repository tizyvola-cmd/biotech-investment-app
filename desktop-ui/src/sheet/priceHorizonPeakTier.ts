import type { DailyCloseBar } from "./priceVariationSeries";

/** ~1w / 1m / 3m / 6m trading-day lookbacks for multi-horizon peak Buy tier. */
export const PRICE_PEAK_HORIZONS = [
  { id: "1w" as const, tradingDays: 5 },
  { id: "1m" as const, tradingDays: 21 },
  { id: "3m" as const, tradingDays: 63 },
  { id: "6m" as const, tradingDays: 126 },
];

export type PricePeakHorizonId = (typeof PRICE_PEAK_HORIZONS)[number]["id"];

export type PricePeakTierResult = {
  /** 0 = none; 1–4 = count of horizons at/near high. */
  tier: number;
  matched: PricePeakHorizonId[];
};

const NEAR_MAX_EPS = 0.002;

/**
 * Live price at or above each horizon's max close → tier 1–4 (greener = more horizons).
 */
export function computePricePeakTier(opts: {
  dailyBars: DailyCloseBar[];
  livePrice: number | null;
  asOfDate?: string | null;
}): PricePeakTierResult {
  const { dailyBars, livePrice, asOfDate } = opts;
  if (livePrice == null || !Number.isFinite(livePrice) || livePrice <= 0) {
    return { tier: 0, matched: [] };
  }

  const sorted = [...dailyBars]
    .filter((b) => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 3) return { tier: 0, matched: [] };

  const sessionDate = asOfDate?.slice(0, 10) ?? sorted[sorted.length - 1]!.date;
  const prior = sorted.filter((b) => b.date <= sessionDate);
  if (prior.length < 3) return { tier: 0, matched: [] };

  const matched: PricePeakHorizonId[] = [];
  for (const h of PRICE_PEAK_HORIZONS) {
    const window = prior.slice(-h.tradingDays);
    if (window.length < 2) continue;
    const maxClose = Math.max(...window.map((b) => b.close));
    if (!Number.isFinite(maxClose) || maxClose <= 0) continue;
    if (livePrice >= maxClose * (1 - NEAR_MAX_EPS)) matched.push(h.id);
  }

  return { tier: matched.length, matched };
}

/** Green fill/stroke pairs — tier 1 lightest → tier 4 deepest. */
export const BUY_PEAK_TIER_STYLE: Record<number, { fill: string; stroke: string }> = {
  1: { fill: "#bbf7d0", stroke: "#4ade80" },
  2: { fill: "#86efac", stroke: "#22c55e" },
  3: { fill: "#4ade80", stroke: "#16a34a" },
  4: { fill: "#22c55e", stroke: "#15803d" },
};

export function buyPeakTierStyle(tier: number): { fill: string; stroke: string } {
  return BUY_PEAK_TIER_STYLE[Math.max(1, Math.min(4, tier))] ?? BUY_PEAK_TIER_STYLE[1]!;
}
