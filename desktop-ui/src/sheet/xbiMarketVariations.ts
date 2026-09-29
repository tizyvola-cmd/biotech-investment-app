/**
 * XBI benchmark % changes for price-variation vs market chart.
 * Uses daily closes from market_context_snapshot.json (same source as MCS).
 */
import type { MarketContextSnapshotDoc } from "./marketContextScore";

export type PriceVarWindow = "1D" | "7D" | "1M" | "3M" | "6M" | "1Y";

/** Trading-day lookback per window — aligned with MCS / Yahoo-style horizons. */
export const MARKET_VAR_TRADING_DAYS: Record<PriceVarWindow, number> = {
  "1D": 1,
  "7D": 7,
  "1M": 21,
  "3M": 63,
  "6M": 126,
  "1Y": 252,
};

export const PRICE_VAR_WINDOW_ORDER: PriceVarWindow[] = ["1D", "7D", "1M", "3M", "6M", "1Y"];

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

export type XbiBar = { date: string; close: number };

/** Sorted daily XBI bars from MCS snapshot. */
export function xbiBarsFromSnapshot(
  doc: MarketContextSnapshotDoc | null | undefined,
): XbiBar[] {
  const raw = doc?.series?.XBI ?? doc?.series?.["^XBI"] ?? [];
  return raw
    .filter((b) => b.date && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * % return over N trading days: (close_today − close_N_ago) / close_N_ago × 100.
 * Uses the last bar as "today" and walks back N prior bars (not calendar days).
 */
export function pctReturnTradingDaysAgo(
  bars: XbiBar[],
  tradingDaysBack: number,
): number | null {
  if (bars.length < tradingDaysBack + 1 || tradingDaysBack < 1) return null;
  const today = bars[bars.length - 1]!.close;
  const past = bars[bars.length - 1 - tradingDaysBack]!.close;
  if (!Number.isFinite(today) || !Number.isFinite(past) || past <= 0) return null;
  return roundPct(((today - past) / past) * 100);
}

export type XbiHorizonVariations = Record<PriceVarWindow, number | null>;

/** All six XBI horizon % changes — null when snapshot lacks enough history. */
export function resolveXbiHorizonVariations(
  doc: MarketContextSnapshotDoc | null | undefined,
): XbiHorizonVariations {
  const bars = xbiBarsFromSnapshot(doc);
  const out = {} as XbiHorizonVariations;
  for (const w of PRICE_VAR_WINDOW_ORDER) {
    out[w] = pctReturnTradingDaysAgo(bars, MARKET_VAR_TRADING_DAYS[w]);
  }
  return out;
}

/** Convenience when only close[] is available (e.g. tests). */
export function resolveXbiHorizonVariationsFromCloses(closes: number[]): XbiHorizonVariations {
  const bars = closes.map((close, i) => ({
    date: `2020-01-${String(i + 1).padStart(2, "0")}`,
    close,
  }));
  return resolveXbiHorizonVariations({ series: { XBI: bars } });
}

export function xbiSnapshotAvailable(doc: MarketContextSnapshotDoc | null | undefined): boolean {
  return xbiBarsFromSnapshot(doc).length >= 2;
}
