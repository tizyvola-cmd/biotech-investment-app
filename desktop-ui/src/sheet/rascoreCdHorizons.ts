import type { ChartPoint } from "../types";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import { supernovaOffsetLabel } from "./sdsHistoryCurve";

/** Pre/post-CD calendar anchors for RA window calibration (days vs Completion Date). */
/** T−120 ≈ 4 months pre-CD through T+7 post-CD. */
export const RA_CALIB_CD_OFFSETS = [
  -120, -90, -60, -45, -30, -14, -10, -7, -3, 4, 7,
] as const;

/** Long-horizon target: forward return from each anchor to T+7. */
export const RA_CALIB_LONG_TARGET_OFFSET = 7;

const PRICE_MOVE_EPS_PP = 0.05;

export type RaCdHorizonChanges = {
  long: Partial<Record<number, number>>;
  short: Partial<Record<number, number>>;
};

export function nextRaCalibCdOffset(offset: number): number | null {
  const idx = (RA_CALIB_CD_OFFSETS as readonly number[]).indexOf(offset);
  if (idx < 0 || idx >= RA_CALIB_CD_OFFSETS.length - 1) return null;
  return RA_CALIB_CD_OFFSETS[idx + 1]!;
}

export function raCalibOffsetLabel(offset: number): string {
  return supernovaOffsetLabel(offset);
}

/** Nearest calibration knot to a ticker’s current CD offset (cross-sectional bucketing). */
export function snapToRaCalibOffset(nowOff: number): number {
  let best: number = RA_CALIB_CD_OFFSETS[0]!;
  let bestDist = Math.abs(nowOff - best);
  for (const off of RA_CALIB_CD_OFFSETS) {
    const d = Math.abs(nowOff - off);
    if (d < bestDist || (d === bestDist && off > best)) {
      bestDist = d;
      best = off;
    }
  }
  return best;
}

function maxPriceChartOffset(pricePts: { offset: number }[]): number | null {
  if (!pricePts.length) return null;
  return Math.max(...pricePts.map((p) => p.offset));
}

/**
 * Forward % from the ticker’s observation point (usually today’s CD offset) → T+7 when the
 * simulation chart covers it, else partial to the last chart knot.
 */
export function buildPriceLongFromObservation(
  row: Record<string, unknown>,
  chartPoints: ChartPoint[] | null | undefined,
  observationOffset: number,
): number | null {
  const pricePts = priceSeriesFromChart(chartPoints);
  if (pricePts.length < 2) return null;

  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  if (nowOff != null && nowOff < observationOffset) return null;

  const priceAtObs = interpolateAtOffset(pricePts, observationOffset);
  if (priceAtObs == null) return null;

  const chartMax = maxPriceChartOffset(pricePts);
  let targetOff: number | null = null;
  if (chartMax != null && chartMax >= RA_CALIB_LONG_TARGET_OFFSET) {
    targetOff = RA_CALIB_LONG_TARGET_OFFSET;
  } else if (chartMax != null && chartMax > observationOffset) {
    targetOff = chartMax;
  } else if (nowOff != null && nowOff > observationOffset) {
    targetOff = nowOff;
  }
  if (targetOff == null || targetOff <= observationOffset) return null;

  const priceAtTarget = interpolateAtOffset(pricePts, targetOff);
  return pctBetweenPrices(priceAtObs, priceAtTarget ?? NaN);
}

function pctBetweenPrices(from: number, to: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null;
  return Math.round(((to - from) / from) * 10000) / 100;
}

function priceSeriesFromChart(chartPoints: ChartPoint[] | null | undefined) {
  return (chartPoints ?? [])
    .filter((p) => p.price_storico_usd != null && Number.isFinite(p.price_storico_usd))
    .map((p) => ({ offset: p.offset, y: p.price_storico_usd as number }));
}

/**
 * Forward % moves from each CD anchor using historical price_storico_usd.
 * Long = anchor → T+7; short = anchor → next anchor in RA_CALIB_CD_OFFSETS.
 */
export function buildCdHorizonPriceChanges(
  row: Record<string, unknown>,
  chartPoints: ChartPoint[] | null | undefined,
): RaCdHorizonChanges {
  const pricePts = priceSeriesFromChart(chartPoints);
  if (pricePts.length < 2) return { long: {}, short: {} };

  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  const long: Partial<Record<number, number>> = {};
  const short: Partial<Record<number, number>> = {};

  for (const anchor of RA_CALIB_CD_OFFSETS) {
    if (nowOff != null && nowOff < anchor) continue;

    const priceAtAnchor = interpolateAtOffset(pricePts, anchor);
    if (priceAtAnchor == null) continue;

    const longTargetOff =
      nowOff != null && nowOff < RA_CALIB_LONG_TARGET_OFFSET && nowOff > anchor
        ? nowOff
        : nowOff == null || nowOff >= RA_CALIB_LONG_TARGET_OFFSET
          ? RA_CALIB_LONG_TARGET_OFFSET
          : null;

    if (longTargetOff != null) {
      const priceAtTarget = interpolateAtOffset(pricePts, longTargetOff);
      const pctLong = pctBetweenPrices(priceAtAnchor, priceAtTarget ?? NaN);
      if (pctLong != null) long[anchor] = pctLong;
    }

    const next = nextRaCalibCdOffset(anchor);
    if (next != null && (nowOff == null || nowOff >= next)) {
      const priceAtNext = interpolateAtOffset(pricePts, next);
      const pctShort = pctBetweenPrices(priceAtAnchor, priceAtNext ?? NaN);
      if (pctShort != null) short[anchor] = pctShort;
    }
  }

  return { long, short };
}

export function priceUpFromChgPct(pct: number | null | undefined): boolean | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  return pct > PRICE_MOVE_EPS_PP;
}
