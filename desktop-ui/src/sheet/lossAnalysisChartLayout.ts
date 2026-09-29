/** Shared Recharts layout for Loss Analysis 2×2 tiles (pred / gain / slope). */

import { interpolateAtOffset } from "./chartNowOffset";
import {
  LOSS_ANALYSIS_X_AXIS_MAX,
  LOSS_ANALYSIS_X_AXIS_MIN,
} from "./assessmentChartHarmony";

/** Deep chart row in dense cards — slightly taller than legacy 112px for legible MII + X labels. */
export const LOSS_ANALYSIS_DEEP_DENSE_CHART_H = 132;

/** Identical plot gutters so CD=0 and Today line up across tiles in the same column/row. */
export const LOSS_ANALYSIS_ALIGNED_CHART_MARGIN = {
  top: 12,
  right: 4,
  left: 0,
  bottom: 18,
} as const;

export const LOSS_ANALYSIS_ALIGNED_Y_AXIS_WIDTH = 52;
export const LOSS_ANALYSIS_ALIGNED_X_AXIS_HEIGHT = 36;

/** Fixed header block (title + 1-line caption) so chart baselines align in each row. */
export const LOSS_ANALYSIS_TILE_HEADER_MIN_H = 36;

export const LOSS_ANALYSIS_CHART_SYNC_ID = "loss-analysis-cal-x";

/** Dense calendar knots for smooth lines (every 5d across the shared window). */
export function lossAnalysisChartOffsetGrid(): number[] {
  const out: number[] = [];
  for (let d = LOSS_ANALYSIS_X_AXIS_MIN; d <= LOSS_ANALYSIS_X_AXIS_MAX; d += 5) {
    out.push(d);
  }
  return out;
}

/** Sparse X labels — avoids overlap while keeping CD=0 and Today visible. */
export function lossAnalysisAxisTicks(
  domain: [number, number],
  todayOffset: number,
): number[] {
  const anchors = [LOSS_ANALYSIS_X_AXIS_MIN, -60, -30, 0, 30, 60, LOSS_ANALYSIS_X_AXIS_MAX];
  const ticks = new Set<number>([0, todayOffset]);
  for (const d of anchors) {
    if (d >= domain[0] && d <= domain[1]) ticks.add(d);
  }
  return [...ticks].sort((a, b) => a - b);
}

export function isLossAnalysisAlignedTile(opts: {
  alignedXDomain?: [number, number] | null;
  calendarMode?: boolean;
  calendarAxisLabels?: boolean;
  chartOnly?: boolean;
  xDomainOverride?: [number, number] | null;
}): boolean {
  if (opts.alignedXDomain) return true;
  if (opts.calendarMode) return true;
  if (opts.calendarAxisLabels) return true;
  return Boolean(opts.chartOnly && opts.xDomainOverride);
}

/** Interpolate a numeric field across the shared 5-day calendar grid. */
export function interpolateFieldOnOffsetGrid(
  points: { offset: number; y: number | null | undefined }[],
  domain: [number, number],
  extrapolate = false,
): { offset: number; y: number | null }[] {
  const series = points
    .filter((p) => p.y != null && Number.isFinite(p.y))
    .map((p) => ({ offset: p.offset, y: p.y as number }))
    .sort((a, b) => a.offset - b.offset);
  const out: { offset: number; y: number | null }[] = [];
  for (const off of lossAnalysisChartOffsetGrid()) {
    if (off < domain[0] || off > domain[1]) continue;
    if (series.length < 2) {
      const exact = series.find((p) => p.offset === off);
      out.push({ offset: off, y: exact?.y ?? null });
      continue;
    }
    const y = interpolateAtOffset(series, off, { extrapolate });
    out.push({ offset: off, y: y != null && Number.isFinite(y) ? y : null });
  }
  return out;
}
