/**
 * Build ticker vs XBI windows for PriceVariationChart.
 */
import type { ChartPoint, ChartSeries } from "../types";
import type { MarketContextSnapshotDoc } from "./marketContextScore";
import { buildLossAnalysisVarHorizons } from "./lossAnalysisVarHorizons";
import { resolvePriceVariationHorizons } from "./priceVariationHorizons";
import { currentPriceFromRow } from "./simulationPosition";
import {
  PRICE_VAR_WINDOW_ORDER,
  resolveXbiHorizonVariations,
  type PriceVarWindow,
} from "./xbiMarketVariations";

export type TimeWindowData = {
  window: PriceVarWindow;
  tickerChange: number | null;
  marketChange: number | null;
  /**
   * Ticker $ variation over the window (positive/negative). Computed from
   * the current price and the % change: Δ$ = P_now × pct / (100 + pct).
   * `null` when either the current price or the % change is unavailable.
   */
  tickerDeltaUsd: number | null;
};

export function getDeltaLabel(delta: number): {
  text: string;
  style: "out" | "under" | "inline";
} {
  if (delta > 0.5) return { text: `+${delta.toFixed(1)}% vs mkt`, style: "out" };
  if (delta < -0.5) return { text: `${delta.toFixed(1)}% vs mkt`, style: "under" };
  return { text: "~mkt", style: "inline" };
}

export function windowDelta(
  tickerChange: number | null,
  marketChange: number | null,
): number | null {
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

function horizonPct(
  horizons: { label: string; pct: number | null }[],
  label: string,
): number | null {
  const h = horizons.find((x) => x.label === label);
  return h?.pct != null && Number.isFinite(h.pct) ? h.pct : null;
}

/**
 * Convert a % change to a $ delta given the current price.
 *  past = P_now / (1 + pct/100) ⇒ Δ$ = P_now − past = P_now × pct / (100 + pct)
 * Returns null when inputs are invalid or the denominator collapses (pct ≤ -100).
 */
export function pctToDollarDelta(
  currentPriceUsd: number | null | undefined,
  pct: number | null | undefined,
): number | null {
  if (
    currentPriceUsd == null ||
    !Number.isFinite(currentPriceUsd) ||
    currentPriceUsd <= 0
  ) {
    return null;
  }
  if (pct == null || !Number.isFinite(pct)) return null;
  const denom = 100 + pct;
  if (Math.abs(denom) < 1e-6) return null;
  const delta = (currentPriceUsd * pct) / denom;
  return Math.round(delta * 100) / 100;
}

/** Combine ticker sheet/bundle horizons with XBI snapshot for all six windows. */
export function buildPriceVariationWindows(opts: {
  simRow: Record<string, unknown> | null | undefined;
  chartPts?: ChartPoint[] | null;
  seriesMeta?: Pick<ChartSeries, "var_horizons"> | null;
  marketDoc?: MarketContextSnapshotDoc | null;
}): TimeWindowData[] {
  const { simRow, chartPts, seriesMeta, marketDoc = null } = opts;
  const priceVar = resolvePriceVariationHorizons(simRow, chartPts, seriesMeta ?? null);
  const varHorizons = buildLossAnalysisVarHorizons(simRow, chartPts, seriesMeta ?? null);
  const xbi = resolveXbiHorizonVariations(marketDoc);

  const tickerByWindow: Record<PriceVarWindow, number | null> = {
    "1D": priceVar.d1,
    "7D": priceVar.d7,
    "1M": priceVar.m1 ?? horizonPct(varHorizons, "1M"),
    "3M": horizonPct(varHorizons, "3M"),
    "6M": horizonPct(varHorizons, "6M"),
    "1Y": horizonPct(varHorizons, "1Y"),
  };

  const currentPriceUsd = simRow ? currentPriceFromRow(simRow) : null;

  return PRICE_VAR_WINDOW_ORDER.map((window) => ({
    window,
    tickerChange: tickerByWindow[window],
    marketChange: xbi[window],
    tickerDeltaUsd: pctToDollarDelta(currentPriceUsd, tickerByWindow[window]),
  }));
}

/** Global max |%| across all ticker + market values (for bar normalization). */
export function maxAbsPctForWindows(windows: TimeWindowData[]): number {
  const vals: number[] = [];
  for (const w of windows) {
    if (w.tickerChange != null && Number.isFinite(w.tickerChange)) vals.push(Math.abs(w.tickerChange));
    if (w.marketChange != null && Number.isFinite(w.marketChange)) vals.push(Math.abs(w.marketChange));
  }
  return Math.max(1, ...vals, 0.5);
}
