import type { ChartPoint } from "./types";
import { extractRecalibCurvePoints } from "./mobileRecalibCurve";
import {
  POST_CD_CHART_OFFSETS,
  assessmentChartOffsetsForNow,
  extendedPreCdOffsets,
  interpolateSeriesAtOffset,
  roundPredPct,
  STANDARD_CAL_OFFSETS,
} from "./mobileChartCalendar";

export function bestPredPct(p: ChartPoint): number | null {
  const v = p.pct_foglio ?? p.pct_curva ?? p.pct_modello;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function buildUnifiedPredSeries(
  chartPoints: ChartPoint[],
  simRow: Record<string, unknown> | null,
): { offset: number; y: number }[] {
  const byOff = new Map<number, number>();

  const standardFirst = [...chartPoints].sort((a, b) => {
    const ta = (a.nodo ?? "standard") === "standard" ? 0 : 1;
    const tb = (b.nodo ?? "standard") === "standard" ? 0 : 1;
    return ta - tb || a.offset - b.offset;
  });
  for (const p of standardFirst) {
    const y = bestPredPct(p);
    if (y != null) byOff.set(p.offset, roundPredPct(y));
  }

  if (simRow) {
    for (const pt of extractRecalibCurvePoints(simRow)) {
      if (!byOff.has(pt.offset)) byOff.set(pt.offset, roundPredPct(pt.val));
    }
  }

  return [...byOff.entries()]
    .sort(([a], [b]) => a - b)
    .map(([offset, y]) => ({ offset, y }));
}

export type RecalibPredValuesOptions = {
  extendedPostCd?: boolean;
  offsets?: readonly number[];
  nowOffset?: number | null;
};

export function recalibPredValuesAtCalendarOffsets(
  chartPoints: ChartPoint[],
  simRow: Record<string, unknown>,
  options?: RecalibPredValuesOptions,
): (number | null)[] | null {
  const nowOff = options?.nowOffset ?? null;
  const targetOffsets =
    options?.offsets ??
    (options?.extendedPostCd ? assessmentChartOffsetsForNow(nowOff) : STANDARD_CAL_OFFSETS);
  const extra =
    options?.offsets != null
      ? options.offsets.filter((o) => !STANDARD_CAL_OFFSETS.includes(o as (typeof STANDARD_CAL_OFFSETS)[number]))
      : options?.extendedPostCd
        ? POST_CD_CHART_OFFSETS
        : extendedPreCdOffsets(nowOff);

  const series = buildUnifiedPredSeries(chartPoints, simRow);
  if (series.length < 2) return null;

  const offsetSet = new Set<number>([
    ...STANDARD_CAL_OFFSETS,
    ...extra,
    ...targetOffsets,
  ]);
  const byOff = new Map<number, number>();
  for (const off of offsetSet) {
    const v = interpolateSeriesAtOffset(series, off);
    if (v != null && Number.isFinite(v)) byOff.set(off, roundPredPct(v));
  }

  const values: (number | null)[] = [];
  for (const off of targetOffsets) {
    values.push(byOff.get(off) ?? null);
  }
  if (values.filter((v) => v != null && Number.isFinite(v)).length < 2) return null;
  return values;
}
