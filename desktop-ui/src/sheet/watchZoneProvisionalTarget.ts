/**
 * Target forward provvisorio in watch zone (T−61…T−120): run-up verso hot zone
 * + segmento hot sulla curva bundle, scontato per predictability.
 */
import type { ChartPoint } from "../types";
import { interpolateAtOffset } from "./chartNowOffset";
import {
  computeTimingPredictabilityPct,
  isWatchZone,
  SIM_HOT_ZONE_DAYS,
} from "./cdHorizons";
import { extractCurveInputs } from "./precatCurve";
import { resolveDisplayRecalibPoints } from "./predictionCurveGrid";
import {
  forwardRiseSegmentPeak,
} from "./simulationSparkline";

export const WATCH_RUNUP_SLOPE_DISCOUNT = 0.75;
export const WATCH_HOT_SEGMENT_DISCOUNT = 0.65;
export const WATCH_CONFIDENCE_FLOOR = 0.45;
export const WATCH_MOMENTUM_MATCH_MIN = 65;
export const WATCH_MOMENTUM_DAILY_MIN = 1.2;

export type WatchProvisionalTargetSource =
  | "watch_curve_extrap"
  | "watch_slope_runup"
  | "watch_slope_momentum";

export type WatchProvisionalTarget = {
  targetReturnPct: number;
  daysToTarget: number;
  confidencePct: number;
  source: WatchProvisionalTargetSource;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function parseR2(row: Record<string, unknown>): number | null {
  for (const k of Object.keys(row)) {
    if (k.startsWith("R²") || k.startsWith("R2")) {
      const v = row[k];
      const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

function parseAffidPct(row: Record<string, unknown>): number | null {
  for (const k of Object.keys(row)) {
    if (!k.includes("Affidabilit")) continue;
    const v = row[k];
    let n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
    if (!Number.isFinite(n)) continue;
    if (n > 1 && n <= 100) return n;
    if (n <= 1) return n * 100;
    return n;
  }
  return null;
}

export function computeWatchTargetConfidenceMultiplier(
  daysToCd: number,
  row: Record<string, unknown>,
): number {
  const r2 = parseR2(row);
  const affidPct = parseAffidPct(row);
  const timingPred = computeTimingPredictabilityPct(
    daysToCd,
    r2,
    affidPct != null ? affidPct / 100 : null,
    null,
  );
  return Math.min(0.85, Math.max(WATCH_CONFIDENCE_FLOOR, timingPred / 100));
}

/** Peak % sul segmento T−60 → CD sulla curva bundle. */
export function hotSegmentPeakReturnPct(
  row: Record<string, unknown>,
  chartPoints: ChartPoint[] | null | undefined,
): number | null {
  if (!chartPoints?.length) return null;
  const overlaid = resolveDisplayRecalibPoints(chartPoints, row);
  const sorted = [...overlaid]
    .filter((p) => Number.isFinite(p.offset))
    .sort((a, b) => a.offset - b.offset);
  if (sorted.length < 2) return null;

  const bestPts = sorted
    .map((p) => {
      const y =
        typeof p.pct_foglio === "number"
          ? p.pct_foglio
          : typeof p.pct_curva === "number"
            ? p.pct_curva
            : typeof p.pct_modello === "number"
              ? p.pct_modello
              : null;
      return y != null ? { offset: p.offset, y } : null;
    })
    .filter((p): p is { offset: number; y: number } => p != null);

  if (bestPts.length < 2) return null;
  const hotOff = -SIM_HOT_ZONE_DAYS;
  const atHot = interpolateAtOffset(bestPts, hotOff, { extrapolate: true });
  if (atHot == null) return null;

  let peakY = atHot;
  for (const p of bestPts) {
    if (p.offset > hotOff && p.offset <= 0 && p.y > peakY) peakY = p.y;
  }
  const delta = peakY - atHot;
  if (!Number.isFinite(delta) || delta <= 0.05) return null;
  return round1(delta);
}

export function resolveWatchProvisionalTarget(
  row: Record<string, unknown>,
  chartPoints: ChartPoint[] | null | undefined,
  daysToCd: number | null,
  opts?: {
    dailyPct24h?: number | null;
    matchPct?: number | null;
    flatThrPpPerDay?: number;
  },
): WatchProvisionalTarget | null {
  if (daysToCd == null || !isWatchZone(daysToCd)) return null;

  const flatThr = opts?.flatThrPpPerDay ?? 0.05;
  const confidence = computeWatchTargetConfidenceMultiplier(daysToCd, row);
  const confidencePct = Math.round(confidence * 100);

  const peak = forwardRiseSegmentPeak(row, chartPoints, flatThr);
  if (peak && peak.returnPct > 0.05) {
    const targetReturnPct = round1(peak.returnPct * confidence);
    if (targetReturnPct > 0) {
      return {
        targetReturnPct,
        daysToTarget: peak.days,
        confidencePct,
        source: "watch_curve_extrap",
      };
    }
  }

  const { slope5d, slope20d } = extractCurveInputs(row);
  const effSlope =
    slope20d != null && Number.isFinite(slope20d)
      ? slope20d
      : slope5d != null && Number.isFinite(slope5d)
        ? slope5d
        : null;

  const daysToHot = daysToCd - SIM_HOT_ZONE_DAYS;
  let runUpPct = 0;
  if (effSlope != null && effSlope > flatThr && daysToHot > 0) {
    runUpPct = round1(effSlope * daysToHot * WATCH_RUNUP_SLOPE_DISCOUNT);
  }

  const hotSeg = hotSegmentPeakReturnPct(row, chartPoints) ?? 0;
  let rawTarget = round1(runUpPct + hotSeg * WATCH_HOT_SEGMENT_DISCOUNT);

  const daily = opts?.dailyPct24h;
  const match = opts?.matchPct;
  let source: WatchProvisionalTargetSource = "watch_slope_runup";
  if (
    daily != null &&
    daily >= WATCH_MOMENTUM_DAILY_MIN &&
    match != null &&
    match >= WATCH_MOMENTUM_MATCH_MIN
  ) {
    rawTarget = Math.max(rawTarget, round1(daily * 1.5 + 2));
    source = "watch_slope_momentum";
  }

  if (rawTarget <= 0.05) {
    if (daily != null && daily >= WATCH_MOMENTUM_DAILY_MIN) {
      rawTarget = round1(Math.max(rawTarget, daily * 1.2 + 1.5));
      source = "watch_slope_momentum";
    }
  }

  if (rawTarget <= 0.05) return null;

  const targetReturnPct = round1(rawTarget * confidence);
  if (targetReturnPct <= 0) return null;

  const daysToTarget = Math.max(
    14,
    Math.min(daysToCd - 14, Math.round(daysToHot + (hotSeg > 0 ? 25 : 14))),
  );

  return {
    targetReturnPct,
    daysToTarget,
    confidencePct,
    source,
  };
}
