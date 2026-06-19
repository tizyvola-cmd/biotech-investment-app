/**
 * 24h assessment — all model-curve tiles share the same calendar anchor (today vs CD)
 * and the same reconciled recalib path. Pred overlay is rebased to % vs today so Y aligns
 * with the slope trajectory chart.
 */
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import { calendarOffsetsForValueCount, ASSESSMENT_CHART_OFFSETS, POST_CD_CHART_OFFSETS } from "./chartNodes";
import { roundPredPct } from "./predictionCurveGrid";
import {
  peakRoiWithOffset,
  type SdsOverlayCurve,
} from "./sdsCompareOverlay";
import type { SlopeTrajectoryPoint } from "./slopeRecalibCurve";

/** Max |Δ| pp overlay vs slope before flagging misalignment (median live gap ~1.7 pp). */
export const ALIGN_TOL_PP = 0.5;

/** Calendar offset «oggi» — prefer Completion Date on the sim row. */
export function canonicalTodayOffset(
  simRow: Record<string, unknown> | null | undefined,
  fallbackDaysToCd?: number | null,
): number {
  const fromCd = completionDateToNowOffset(simRow?.["Completion Date"]);
  if (fromCd != null && Number.isFinite(fromCd) && fromCd <= 0) return fromCd;
  if (fallbackDaysToCd != null && Number.isFinite(fallbackDaysToCd) && fallbackDaysToCd > 0) {
    return -Math.round(fallbackDaysToCd);
  }
  return -30;
}

/** Rebase % vs T−60 knots → % vs today (0 at nowOffset). */
export function curveValuesVsToday(
  values: (number | null)[],
  nowOffset: number,
  offsets: readonly number[] = calendarOffsetsForValueCount(values.length),
): number[] {
  const series = offsets.map((offset, i) => ({ offset, y: values[i] ?? 0 }));
  const atNow = interpolateAtOffset(series, nowOffset, { extrapolate: true });
  if (atNow == null || !Number.isFinite(atNow)) {
    return values.map((v) => (v != null && Number.isFinite(v) ? v : 0));
  }
  return values.map((v) => roundPredPct((v ?? 0) - atNow));
}

export function transformOverlayVsToday(
  overlay: SdsOverlayCurve,
  nowOffset: number,
): SdsOverlayCurve {
  const offsets = overlay.offsets ?? calendarOffsetsForValueCount(overlay.values.length);
  const values = curveValuesVsToday(overlay.values, nowOffset, offsets);
  const { peakRoi, peakOffset, kind } = peakRoiWithOffset(values, offsets, nowOffset);
  return { ...overlay, values, peakRoi, peakOffset, peakKind: kind };
}

export function transformBlendVsToday(
  values: (number | null)[],
  nowOffset: number,
): (number | null)[] {
  if (!values.length) return values;
  const offsets = calendarOffsetsForValueCount(values.length);
  const rebased = curveValuesVsToday(
    values.map((v) => (v != null && Number.isFinite(v) ? v : 0)),
    nowOffset,
    offsets,
  );
  return values.map((v, i) => (v == null ? null : rebased[i] ?? null));
}

export type AssessmentHarmonyAudit = {
  todayOffset: number;
  /** Max |Δ| pp between overlay (vs today) and slope model at shared offsets. */
  maxPredGapPp: number;
  aligned: boolean;
  checks: { offset: number; overlayPct: number | null; slopePredPct: number | null; gapPp: number | null }[];
};

function slopePredAt(points: SlopeTrajectoryPoint[], offset: number): number | null {
  const exact = points.find((p) => p.offset === offset);
  if (exact?.pred != null && Number.isFinite(exact.pred)) return exact.pred;
  const series = points
    .filter((p) => p.pred != null && Number.isFinite(p.pred))
    .map((p) => ({ offset: p.offset, y: p.pred as number }));
  if (series.length < 2) return null;
  return interpolateAtOffset(series, offset, { extrapolate: true });
}

/** Shared calendar knots only — avoids false gaps from off-grid interpolation. */
function harmonyProbeOffsets(todayOffset: number): number[] {
  const postCdMax = Math.max(...POST_CD_CHART_OFFSETS);
  const out = new Set<number>([todayOffset, 0]);
  for (const off of ASSESSMENT_CHART_OFFSETS) {
    if (off >= todayOffset - 0.01 && off <= postCdMax + 0.01) out.add(off);
  }
  return [...out].sort((a, b) => a - b);
}

/** Cross-check pred overlay vs slope trajectory on the same rebased curve. */
export function auditAssessmentChartHarmony(opts: {
  overlayVsToday: SdsOverlayCurve | null;
  slopePoints: SlopeTrajectoryPoint[];
  todayOffset: number;
}): AssessmentHarmonyAudit {
  const { overlayVsToday, slopePoints, todayOffset } = opts;
  const checks: AssessmentHarmonyAudit["checks"] = [];
  let maxPredGapPp = 0;

  if (!overlayVsToday?.values.length) {
    return { todayOffset, maxPredGapPp: 0, aligned: true, checks };
  }

  const overlayOffsets = calendarOffsetsForValueCount(overlayVsToday.values.length);
  const overlaySeries = overlayOffsets.map((offset, i) => ({
    offset,
    y: overlayVsToday.values[i] ?? 0,
  }));

  for (const off of harmonyProbeOffsets(todayOffset)) {
    const overlayPct = interpolateAtOffset(overlaySeries, off, { extrapolate: true });
    const slopePredPct = slopePredAt(slopePoints, off);
    if (overlayPct == null || slopePredPct == null) continue;
    const gapPp = roundPredPct(Math.abs(overlayPct - slopePredPct));
    if (gapPp != null) maxPredGapPp = Math.max(maxPredGapPp, gapPp);
    checks.push({ offset: off, overlayPct, slopePredPct, gapPp });
  }

  return {
    todayOffset,
    maxPredGapPp,
    aligned: maxPredGapPp <= ALIGN_TOL_PP,
    checks,
  };
}
