/** Calendar knots aligned with desktop Simulation / SuperNova charts. */
export const STANDARD_CAL_OFFSETS = [-60, -30, -10, -7, -5, -3, 4, 7] as const;
export const POST_CD_CHART_OFFSETS = [30, 60, 90] as const;
export const ASSESSMENT_CHART_OFFSETS = [
  ...STANDARD_CAL_OFFSETS,
  ...POST_CD_CHART_OFFSETS,
] as const;

export const SUPERNova_OFFSETS = STANDARD_CAL_OFFSETS;

const _MEAN = [0.0, 38.99, 256.19, 318.23, 386.94, 377.94, 377.74, 390.5];

export const SUPERNova_HISTORY_MEAN = _MEAN;

export function calendarOffsetsForValueCount(n: number): readonly number[] {
  if (n === ASSESSMENT_CHART_OFFSETS.length) return ASSESSMENT_CHART_OFFSETS;
  if (n === STANDARD_CAL_OFFSETS.length) return STANDARD_CAL_OFFSETS;
  if (n <= STANDARD_CAL_OFFSETS.length) return STANDARD_CAL_OFFSETS.slice(0, n);
  return ASSESSMENT_CHART_OFFSETS.slice(0, n);
}

export function extendedPreCdOffsets(nowOffset: number | null | undefined): number[] {
  if (nowOffset == null || !Number.isFinite(nowOffset) || nowOffset >= -60) return [];
  const extras = [nowOffset];
  if (nowOffset <= -75) extras.push(-75);
  if (nowOffset <= -90) extras.push(-90);
  if (nowOffset <= -105) extras.push(-105);
  if (nowOffset <= -120) extras.push(-120);
  return [...new Set(extras.filter((o) => o < -60))].sort((a, b) => a - b);
}

export function assessmentChartOffsetsForNow(
  nowOffset: number | null | undefined,
): readonly number[] {
  const merged = new Set<number>([...ASSESSMENT_CHART_OFFSETS, ...extendedPreCdOffsets(nowOffset)]);
  return [...merged].sort((a, b) => a - b);
}

export function roundPredPct(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(Number(value) * 100) / 100;
}

export function supernovaOffsetLabel(off: number): string {
  if (off === 0) return "CD";
  return off > 0 ? `T+${off}` : `T${off}`;
}

export function interpolateSeriesAtOffset(
  points: { offset: number; y: number }[],
  targetOffset: number,
  options?: { extrapolate?: boolean },
): number | null {
  const sorted = points
    .filter((p) => Number.isFinite(p.offset) && Number.isFinite(p.y))
    .sort((a, b) => a.offset - b.offset);
  if (!sorted.length) return null;

  const extrapolate = options?.extrapolate === true;
  if (!extrapolate) {
    if (targetOffset <= sorted[0].offset) return sorted[0].y;
    if (targetOffset >= sorted[sorted.length - 1].offset) return sorted[sorted.length - 1].y;
  } else if (sorted.length >= 2) {
    if (targetOffset <= sorted[0].offset) {
      const a = sorted[0];
      const b = sorted[1];
      const t = (targetOffset - a.offset) / (b.offset - a.offset);
      return a.y + t * (b.y - a.y);
    }
    if (targetOffset >= sorted[sorted.length - 1].offset) {
      const a = sorted[sorted.length - 2];
      const b = sorted[sorted.length - 1];
      const t = (targetOffset - a.offset) / (b.offset - a.offset);
      return a.y + t * (b.y - a.y);
    }
  } else {
    return sorted[0].y;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (targetOffset >= a.offset && targetOffset <= b.offset) {
      const t = (targetOffset - a.offset) / (b.offset - a.offset);
      return a.y + t * (b.y - a.y);
    }
  }
  return null;
}

/** Rebase % vs T−60 knots → % vs today (0 at nowOffset). */
export function curveValuesVsToday(
  values: (number | null)[],
  nowOffset: number,
  offsets: readonly number[] = calendarOffsetsForValueCount(values.length),
): number[] {
  const series = offsets.map((offset, i) => ({ offset, y: values[i] ?? 0 }));
  const atNow = interpolateSeriesAtOffset(series, nowOffset);
  if (atNow == null || !Number.isFinite(atNow)) {
    return values.map((v) => (v != null && Number.isFinite(v) ? v : 0));
  }
  return values.map((v) => roundPredPct((v ?? 0) - atNow));
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
