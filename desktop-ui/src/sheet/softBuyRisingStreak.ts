/**
 * Soft BUY / growth cutoff: require consecutive green session days.
 * Today = sheet Var. Giorn. %; prior days prefer Yahoo intraday 1h session
 * returns, then chart price_storico (fail closed when stale/flat interpolate).
 */
import type { ChartPoint } from "../types";
import type { Intraday1hPayload, Intraday1hSessionBlock } from "../api/supernova";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import { dailyChangePctFromRow } from "./simulationPosition";

/** Buy only names green for at least this many consecutive sessions (today included). */
export const SOFT_BUY_RISING_DAYS_MIN = 2;

/** Treat identical interpolated prices as "no real session move" (stale chart). */
const STALE_FLAT_EPS = 1e-9;

function pctFromPrices(now: number, then: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(then) || then <= 0) return null;
  return Math.round(((now - then) / then) * 10000) / 100;
}

function pricePtsFromChart(
  points: ChartPoint[] | null | undefined,
): Array<{ offset: number; y: number }> {
  if (!points?.length) return [];
  return points
    .filter((p) => p.price_storico_usd != null && Number.isFinite(p.price_storico_usd))
    .map((p) => ({ offset: p.offset, y: p.price_storico_usd as number }));
}

/**
 * Full-session return % for an intraday 1h block:
 * last print of that session vs `prev_close` (prior regular close).
 */
export function sessionReturnPctFromIntradayBlock(
  block: Intraday1hSessionBlock | null | undefined,
  ticker: string,
): number | null {
  const tk = ticker.trim().toUpperCase();
  if (!block || !tk) return null;
  const pts = block.series?.[tk];
  const prev = block.prev_close?.[tk];
  if (!pts?.length || prev == null || !Number.isFinite(prev) || prev <= 0) return null;
  const last = pts[pts.length - 1]?.price;
  if (last == null || !Number.isFinite(last)) return null;
  return pctFromPrices(last, prev);
}

/** Yesterday (session before live) return % by ticker from `/api/market/intraday-1h`. */
export function buildPriorSessionPctByTicker(
  payload: Intraday1hPayload | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  const block = payload?.prior;
  if (!block?.series) return out;
  // Pre-fix API: when Yahoo had no calendar-today bars, `prior` was the same
  // settled day as sheet Var. Giorn. — using it as "yesterday" kills Soft BUY.
  // Prefer chart fallback until the backend exposes settled live + true prior.
  const liveDate = payload?.live?.session_date ?? null;
  const priorDate = block.session_date ?? null;
  if (!liveDate && priorDate) return out;
  if (liveDate && priorDate && liveDate === priorDate) return out;
  for (const tk of Object.keys(block.series)) {
    const pct = sessionReturnPctFromIntradayBlock(block, tk);
    if (pct != null) out.set(tk.trim().toUpperCase(), pct);
  }
  return out;
}

/**
 * Session return for the completed day ending `daysAgo` sessions before today
 * (1 = yesterday). Uses chart historical prices at nowOff−daysAgo vs nowOff−daysAgo−1.
 * Returns null when prices are missing or the chart is a stale flat plateau
 * (same interpolated price on consecutive calendar offsets).
 */
export function priorSessionReturnPct(
  row: Record<string, unknown> | null | undefined,
  chartPoints: ChartPoint[] | null | undefined,
  daysAgo: number,
): number | null {
  if (!row || daysAgo < 1) return null;
  const pricePts = pricePtsFromChart(chartPoints);
  if (pricePts.length < 2) return null;
  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff)) return null;
  const end = interpolateAtOffset(pricePts, nowOff - daysAgo);
  const start = interpolateAtOffset(pricePts, nowOff - daysAgo - 1);
  if (end == null || start == null) return null;
  // Sparse CD charts often hold the last knot across many calendar days → 0%.
  // That is not a real flat session; treat as unknown so Soft BUY can use Yahoo.
  if (Math.abs(end - start) <= STALE_FLAT_EPS) return null;
  return pctFromPrices(end, start);
}

/**
 * Count consecutive rising sessions ending today.
 * Today uses `todayPct` (sheet 24h) when provided; prior days prefer
 * `priorSessionPcts` (Yahoo), then chart prices. Unknown prior day stops the streak.
 */
export function countConsecutiveRisingSessionDays(opts: {
  row?: Record<string, unknown> | null;
  chartPoints?: ChartPoint[] | null;
  /** Last trading day % (Var. Giorn.). */
  todayPct?: number | null;
  /** Minimum % to count as “up” (default > 0). */
  minUpPct?: number;
  /** How far back to scan (default 8). */
  maxLookback?: number;
  /**
   * Optional prior-session returns, newest-first (index 0 = yesterday).
   * Prefer this over chart interpolation (Yahoo intraday 1h).
   */
  priorSessionPcts?: Array<number | null | undefined>;
}): number {
  const minUp = opts.minUpPct ?? 0;
  const today =
    opts.todayPct != null && Number.isFinite(opts.todayPct)
      ? opts.todayPct
      : opts.row
        ? dailyChangePctFromRow(opts.row)
        : null;
  if (today == null || !Number.isFinite(today) || today <= minUp) return 0;

  let streak = 1;
  const maxLook = opts.maxLookback ?? 8;
  for (let daysAgo = 1; daysAgo < maxLook; daysAgo++) {
    const override = opts.priorSessionPcts?.[daysAgo - 1];
    const ret =
      override != null && Number.isFinite(override)
        ? override
        : priorSessionReturnPct(opts.row ?? null, opts.chartPoints, daysAgo);
    if (ret == null || !Number.isFinite(ret) || ret <= minUp) break;
    streak += 1;
  }
  return streak;
}

/** Soft BUY gate: rising ≥ {@link SOFT_BUY_RISING_DAYS_MIN} sessions. */
export function softBuyRisingStreakOk(opts: {
  row?: Record<string, unknown> | null;
  chartPoints?: ChartPoint[] | null;
  todayPct?: number | null;
  minDays?: number;
  priorSessionPcts?: Array<number | null | undefined>;
}): boolean {
  const need = opts.minDays ?? SOFT_BUY_RISING_DAYS_MIN;
  return (
    countConsecutiveRisingSessionDays({
      row: opts.row,
      chartPoints: opts.chartPoints,
      todayPct: opts.todayPct,
      priorSessionPcts: opts.priorSessionPcts,
    }) >= need
  );
}
