/**
 * Early-peak Soft BUY — weekly minimum price as entry target.
 * Min = lowest `price_storico_usd` over the last 7 calendar days (vs CD).
 */
import type { ChartPoint } from "../types";
import type { IntradayPricePoint } from "./simUniverse24hWhatIf";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import { softBuyEarlyPeakHit } from "./continuationScore";
import {
  currentPriceFromRow,
  dailyChangePctFromRow,
  nasdaqOpenFromRow,
} from "./simulationPosition";

/** Calendar days back from CD "now" for the weekly low window. */
export const WEEK_MIN_LOOKBACK_DAYS = 7;

/** Live price within this band of target counts as "at minimum". */
export const EARLY_PEAK_MIN_HIT_TOLERANCE_PCT = 0.35;

/** Spot within this % above a low → show $ (near entry). */
export const LOW_NEAR_SPOT_MAX_PREMIUM_PCT = 2;

export type EarlyPeakBuyMinTarget = {
  key: string;
  ticker: string;
  /** Lowest USD print in the 7d window when the signal was recorded. */
  weekMinPriceUsd: number;
  /** Frozen buy-at target (same as week min at signal time). */
  buyAtMinTargetUsd: number;
  /** Var. Giorn. % when the target was set. */
  signalDayPct: number | null;
  /** ISO timestamp when target was first stored. */
  setAtIso: string;
};

export function formatBuyMinPriceUsd(price: number | null | undefined): string | null {
  if (price == null || !Number.isFinite(price) || !(price > 0)) return null;
  if (price >= 100) return `$${price.toFixed(2)}`;
  if (price >= 10) return `$${price.toFixed(2)}`;
  return `$${price.toFixed(3)}`;
}

/**
 * Min `price_storico_usd` between offsets [now−7d, now] on the CD chart.
 */
export function computeWeekMinPriceUsd(
  simRow: Record<string, unknown> | null | undefined,
  chartPts: ChartPoint[] | null | undefined,
  lookbackDays: number = WEEK_MIN_LOOKBACK_DAYS,
): number | null {
  if (!simRow || !chartPts?.length || lookbackDays <= 0) return null;
  const nowOff = completionDateToNowOffset(simRow["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff)) return null;

  const pricePts = chartPts
    .filter((p) => p.price_storico_usd != null && Number.isFinite(p.price_storico_usd))
    .map((p) => ({ offset: p.offset, y: p.price_storico_usd as number }));
  if (pricePts.length < 2) return null;

  const startOff = nowOff - lookbackDays;
  let min: number | null = null;

  // Scan actual chart prints in the window.
  for (const pt of pricePts) {
    if (pt.offset < startOff - 0.01 || pt.offset > nowOff + 0.01) continue;
    min = min == null ? pt.y : Math.min(min, pt.y);
  }

  // Fill gaps via daily interpolation (handles sparse charts).
  for (let d = 0; d <= lookbackDays; d += 1) {
    const off = startOff + d;
    const p = interpolateAtOffset(pricePts, off);
    if (p == null || !Number.isFinite(p) || !(p > 0)) continue;
    min = min == null ? p : Math.min(min, p);
  }
  if (min == null) return null;
  return Math.round(min * 10000) / 10000;
}

/**
 * Min from actual chart knots in [now−lookback, now] — no interpolation
 * (avoids flat/sparse curves making 7g === 24h).
 */
export function minPriceFromChartKnotsOnly(
  simRow: Record<string, unknown> | null | undefined,
  chartPts: ChartPoint[] | null | undefined,
  lookbackDays: number = WEEK_MIN_LOOKBACK_DAYS,
): number | null {
  if (!simRow || !chartPts?.length || lookbackDays <= 0) return null;
  const nowOff = completionDateToNowOffset(simRow["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff)) return null;
  const startOff = nowOff - lookbackDays;
  let min: number | null = null;
  for (const p of chartPts) {
    const price = p.price_storico_usd;
    if (price == null || !Number.isFinite(price) || !(price > 0)) continue;
    if (p.offset < startOff - 0.01 || p.offset > nowOff + 0.01) continue;
    min = min == null ? price : Math.min(min, price);
  }
  if (min == null) return null;
  return Math.round(min * 10000) / 10000;
}

/** Session low from sheet: min(open, inferred prev close, current). */
export function inferSessionLowFromSimRow(
  simRow: Record<string, unknown> | null | undefined,
): number | null {
  if (!simRow) return null;
  const curr = currentPriceFromRow(simRow);
  const open = nasdaqOpenFromRow(simRow);
  const dayPct = dailyChangePctFromRow(simRow);
  let prevClose: number | null = null;
  if (curr != null && dayPct != null && Number.isFinite(dayPct) && dayPct > -99.9) {
    prevClose = curr / (1 + dayPct / 100);
  }
  let min: number | null = null;
  for (const p of [open, prevClose, curr]) {
    if (p == null || !Number.isFinite(p) || !(p > 0)) continue;
    min = min == null ? p : Math.min(min, p);
  }
  if (min == null) return null;
  return Math.round(min * 10000) / 10000;
}

/** Min hourly print in the live session only (today's low). */
export function minPriceFromLiveSessionOnly(
  live: IntradayPricePoint[] | null | undefined,
): number | null {
  return minPriceFromIntradaySeries(null, live);
}

/** Rolling ~2 sessions — fallback when live alone is sparse. */
export function minPriceFromRollingSessions(
  prior: IntradayPricePoint[] | null | undefined,
  live: IntradayPricePoint[] | null | undefined,
): number | null {
  return minPriceFromIntradaySeries(prior, live);
}

/** Fallback: min print in intraday prior + live series (≤2 sessions). */
export function minPriceFromIntradaySeries(
  prior: IntradayPricePoint[] | null | undefined,
  live: IntradayPricePoint[] | null | undefined,
): number | null {
  let min: number | null = null;
  for (const pt of [...(prior ?? []), ...(live ?? [])]) {
    if (!(pt.price > 0)) continue;
    min = min == null ? pt.price : Math.min(min, pt.price);
  }
  if (min == null) return null;
  return Math.round(min * 10000) / 10000;
}

export function resolveWeekMinPriceUsd(opts: {
  simRow: Record<string, unknown> | null | undefined;
  chartPts?: ChartPoint[] | null;
  intradayPrior?: IntradayPricePoint[] | null;
  intradayLive?: IntradayPricePoint[] | null;
}): number | null {
  const fromKnots = minPriceFromChartKnotsOnly(
    opts.simRow,
    opts.chartPts ?? null,
    WEEK_MIN_LOOKBACK_DAYS,
  );
  if (fromKnots != null) return fromKnots;
  const fromChart = computeWeekMinPriceUsd(opts.simRow, opts.chartPts ?? null);
  if (fromChart != null) return fromChart;
  return minPriceFromRollingSessions(opts.intradayPrior, opts.intradayLive);
}

export function resolvePriceLowsUsd(opts: {
  simRow: Record<string, unknown> | null | undefined;
  chartPts?: ChartPoint[] | null;
  intradayPrior?: IntradayPricePoint[] | null;
  intradayLive?: IntradayPricePoint[] | null;
}): { weekMinUsd: number | null; dayMinUsd: number | null } {
  const weekMinUsd = resolveWeekMinPriceUsd(opts);

  // 24h = today's session low (Yahoo hourly live), not 1 CD calendar day.
  const liveMin = minPriceFromLiveSessionOnly(opts.intradayLive);
  const rollingMin = minPriceFromRollingSessions(opts.intradayPrior, opts.intradayLive);
  const sessionMin = inferSessionLowFromSimRow(opts.simRow);
  const dayMinUsd = liveMin ?? rollingMin ?? sessionMin;

  return { weekMinUsd, dayMinUsd };
}

export function buildIntradaySeriesByTicker(
  payload: {
    prior?: { series?: Record<string, IntradayPricePoint[] | undefined> };
    live?: { series?: Record<string, IntradayPricePoint[] | undefined> };
    series?: Record<string, IntradayPricePoint[] | undefined>;
  } | null | undefined,
): Map<string, { prior?: IntradayPricePoint[]; live?: IntradayPricePoint[] }> {
  const map = new Map<string, { prior?: IntradayPricePoint[]; live?: IntradayPricePoint[] }>();
  if (!payload) return map;
  const keys = new Set<string>([
    ...Object.keys(payload.prior?.series ?? {}),
    ...Object.keys(payload.live?.series ?? {}),
    ...Object.keys(payload.series ?? {}),
  ]);
  for (const tk of keys) {
    const upper = tk.trim().toUpperCase();
    if (!upper) continue;
    map.set(upper, {
      prior: payload.prior?.series?.[tk] ?? payload.prior?.series?.[upper],
      live:
        payload.live?.series?.[tk] ??
        payload.live?.series?.[upper] ??
        payload.series?.[tk] ??
        payload.series?.[upper],
    });
  }
  return map;
}

export function isEarlyPeakBuySignal(
  simRow: Record<string, unknown> | null | undefined,
  dayPct?: number | null,
): boolean {
  const day = dayPct ?? (simRow ? dailyChangePctFromRow(simRow) : null);
  return softBuyEarlyPeakHit(simRow, day);
}

/** True when spot is at or below the stored weekly-min buy target. */
export function priceAtOrBelowBuyMinTarget(
  currentUsd: number | null | undefined,
  targetUsd: number | null | undefined,
  tolerancePct: number = EARLY_PEAK_MIN_HIT_TOLERANCE_PCT,
): boolean {
  if (
    currentUsd == null ||
    targetUsd == null ||
    !Number.isFinite(currentUsd) ||
    !Number.isFinite(targetUsd) ||
    !(targetUsd > 0)
  ) {
    return false;
  }
  const ceiling = targetUsd * (1 + tolerancePct / 100);
  return currentUsd <= ceiling;
}

export type LowSpotSignal = "below" | "near" | "above" | null;

function validLowPair(
  currentUsd: number | null | undefined,
  lowUsd: number | null | undefined,
): currentUsd is number {
  return (
    currentUsd != null &&
    lowUsd != null &&
    Number.isFinite(currentUsd) &&
    Number.isFinite(lowUsd) &&
    lowUsd > 0 &&
    currentUsd > 0
  );
}

/**
 * Green $ — spot **below** the recorded low.
 * Yellow $ — spot within {@link LOW_NEAR_SPOT_MAX_PREMIUM_PCT}% above the low (not below).
 * Low column red — spot well above the low (bounced).
 */
export function resolveLowSpotSignal(
  currentUsd: number | null | undefined,
  lowUsd: number | null | undefined,
  maxPremiumPct: number = LOW_NEAR_SPOT_MAX_PREMIUM_PCT,
): LowSpotSignal {
  if (!validLowPair(currentUsd, lowUsd)) return null;
  if (currentUsd < lowUsd! - 1e-9) return "below";
  const ceiling = lowUsd! * (1 + maxPremiumPct / 100);
  if (currentUsd <= ceiling) return "near";
  return "above";
}

export type LowSpotSignals = {
  week: LowSpotSignal;
  day: LowSpotSignal;
};

export function resolveLowSpotSignals(
  currentUsd: number | null | undefined,
  weekMinUsd: number | null | undefined,
  dayMinUsd: number | null | undefined,
): LowSpotSignals {
  return {
    week: resolveLowSpotSignal(currentUsd, weekMinUsd),
    day: resolveLowSpotSignal(currentUsd, dayMinUsd),
  };
}

/** Aggregate $ for the price column: green beats yellow. */
export function resolvePriceDollarSignal(
  signals: LowSpotSignals,
): Extract<LowSpotSignal, "below" | "near"> | null {
  if (signals.week === "below" || signals.day === "below") return "below";
  if (signals.week === "near" || signals.day === "near") return "near";
  return null;
}

/** @deprecated use resolveLowSpotSignal — kept for early-peak popup (at/below target). */
export function isLowNearSpotPrice(
  currentUsd: number | null | undefined,
  lowUsd: number | null | undefined,
  maxPremiumPct: number = LOW_NEAR_SPOT_MAX_PREMIUM_PCT,
): boolean {
  return resolveLowSpotSignal(currentUsd, lowUsd, maxPremiumPct) != null;
}

/** @deprecated use resolveLowSpotSignals */
export function resolveLowNearSpotFlags(
  currentUsd: number | null | undefined,
  weekMinUsd: number | null | undefined,
  dayMinUsd: number | null | undefined,
): { weekNear: boolean; dayNear: boolean; anyNear: boolean } {
  const s = resolveLowSpotSignals(currentUsd, weekMinUsd, dayMinUsd);
  return {
    weekNear: s.week != null,
    dayNear: s.day != null,
    anyNear: s.week != null || s.day != null,
  };
}

export function currentPriceUsdFromSimRow(
  simRow: Record<string, unknown> | null | undefined,
): number | null {
  return simRow ? currentPriceFromRow(simRow) : null;
}

export function earlyPeakMinAlertId(key: string, targetUsd: number): string {
  return `${key}|${targetUsd.toFixed(4)}`;
}
