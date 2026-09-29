/**
 * Ticker vs XBI price variation windows — mobile mirror of desktop priceVariationVsMarket.
 */
import type { MarketContextSnapshotDoc } from "./mobileMarketContext";
import { parseNum } from "./simLogic";
import type { ChartPoint } from "./types";

export type PriceVarWindow = "1D" | "7D" | "1M" | "3M" | "6M";

export type PriceWindowData = {
  window: PriceVarWindow;
  tickerChange: number | null;
  marketChange: number | null;
};

export const PRICE_VAR_WINDOW_ORDER: PriceVarWindow[] = ["1D", "7D", "1M", "3M", "6M"];

const MARKET_TRADING_DAYS: Record<PriceVarWindow, number> = {
  "1D": 1,
  "7D": 7,
  "1M": 21,
  "3M": 63,
  "6M": 126,
};

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

function numFromRow(row: Record<string, unknown>, ...keywords: string[]): number | null {
  for (const kw of keywords) {
    const v = parseNum(findCol(row, kw));
    if (v != null) {
      return Math.abs(v) <= 1.5 ? v * 100 : v;
    }
  }
  return null;
}

function var1d(row: Record<string, unknown>): number | null {
  return (
    parseNum(row["Var. Giorn. %"]) ??
    parseNum(row["Var. Giorn %"]) ??
    numFromRow(row, "var. giorn", "var giorn", "dailychange")
  );
}

function var1m(row: Record<string, unknown>): number | null {
  return parseNum(row["Var. 1M %"]) ?? numFromRow(row, "var. 1m", "var 1m");
}

function var1w(row: Record<string, unknown>): number | null {
  const run7 = parseNum(row["run_up_7d"]) ?? numFromRow(row, "run_up_7", "runup_7");
  if (run7 != null) return run7;
  const explicit =
    parseNum(row["Var. 7d %"]) ??
    parseNum(row["Var. 7D %"]) ??
    parseNum(row["Var. 7g %"]) ??
    numFromRow(row, "var. 7d", "var 7d");
  if (explicit != null) return explicit;
  const m1 = var1m(row);
  if (m1 != null) return Math.round(((m1 * 7) / 22) * 100) / 100;
  const d1 = var1d(row);
  if (d1 != null) return Math.round(d1 * 5 * 100) / 100;
  return null;
}

function var3m(row: Record<string, unknown>): number | null {
  return parseNum(row["Var. 3M %"]) ?? numFromRow(row, "var. 3m", "var 3m");
}

function var6m(row: Record<string, unknown>): number | null {
  return parseNum(row["Var. 6M %"]) ?? numFromRow(row, "var. 6m", "var 6m");
}

function xbiBars(doc: MarketContextSnapshotDoc | null | undefined): { close: number }[] {
  const raw = doc?.series?.XBI ?? doc?.series?.["^XBI"] ?? [];
  return raw
    .filter((b) => b.date && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function xbiPctReturn(bars: { close: number }[], tradingDaysBack: number): number | null {
  if (bars.length < tradingDaysBack + 1 || tradingDaysBack < 1) return null;
  const today = bars[bars.length - 1]!.close;
  const past = bars[bars.length - 1 - tradingDaysBack]!.close;
  if (!Number.isFinite(today) || !Number.isFinite(past) || past <= 0) return null;
  return Math.round(((today - past) / past) * 10000) / 100;
}

export function windowDelta(tickerChange: number | null, marketChange: number | null): number | null {
  if (
    tickerChange == null ||
    marketChange == null ||
    !Number.isFinite(tickerChange) ||
    !Number.isFinite(marketChange)
  ) {
    return null;
  }
  return Math.round((tickerChange - marketChange) * 100) / 100;
}

export function getDeltaLabel(delta: number): { text: string; style: "out" | "under" | "inline" } {
  if (delta > 0.5) return { text: `+${delta.toFixed(1)}% vs mkt`, style: "out" };
  if (delta < -0.5) return { text: `${delta.toFixed(1)}% vs mkt`, style: "under" };
  return { text: "~mkt", style: "inline" };
}

export function maxAbsPctForWindows(windows: PriceWindowData[]): number {
  const vals: number[] = [];
  for (const w of windows) {
    if (w.tickerChange != null && Number.isFinite(w.tickerChange)) vals.push(Math.abs(w.tickerChange));
    if (w.marketChange != null && Number.isFinite(w.marketChange)) vals.push(Math.abs(w.marketChange));
  }
  return Math.max(1, ...vals, 0.5);
}

export function buildMobilePriceWindows(opts: {
  simRow: Record<string, unknown>;
  marketDoc?: MarketContextSnapshotDoc | null;
  chartPts?: ChartPoint[] | null;
}): PriceWindowData[] {
  const { simRow, marketDoc = null } = opts;
  const bars = xbiBars(marketDoc);

  const tickerByWindow: Record<PriceVarWindow, number | null> = {
    "1D": var1d(simRow),
    "7D": var1w(simRow),
    "1M": var1m(simRow),
    "3M": var3m(simRow),
    "6M": var6m(simRow),
  };

  return PRICE_VAR_WINDOW_ORDER.map((window) => ({
    window,
    tickerChange: tickerByWindow[window],
    marketChange: xbiPctReturn(bars, MARKET_TRADING_DAYS[window]),
  }));
}

export function mostSignificantDeltaPreview(windows: PriceWindowData[]): string | null {
  let best: { delta: number; window: PriceVarWindow } | null = null;
  for (const w of windows) {
    const d = windowDelta(w.tickerChange, w.marketChange);
    if (d == null) continue;
    if (!best || Math.abs(d) > Math.abs(best.delta)) {
      best = { delta: d, window: w.window };
    }
  }
  if (!best) return null;
  const label = getDeltaLabel(best.delta);
  return `${label.text} (${best.window})`;
}

export function formatPriceVariationPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}
