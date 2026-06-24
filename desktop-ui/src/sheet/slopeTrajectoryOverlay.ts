import type { SlopeTrajectoryPoint } from "./slopeRecalibCurve";

/** Finestre calendario allineate a DISPLAY_WINDOWS in slopeRecalibCurve. */
export const SLOPE_WINDOW_20D = { start: -30, end: -10 } as const;
export const SLOPE_WINDOW_5D = { start: -10, end: -3 } as const;

export type TrajectorySegmentOverlay = {
  startOffset: number;
  endOffset: number;
  yStart: number;
  yEnd: number;
  label: string;
};

export type TrajectoryWindowSlice = {
  label: string;
  field: "actual" | "pred";
  points: SlopeTrajectoryPoint[];
};

export function trajectorySegmentField(points: SlopeTrajectoryPoint[]): "actual" | "pred" {
  const actualCount = points.filter(
    (p) => !p.isToday && p.actual != null && Number.isFinite(p.actual),
  ).length;
  return actualCount >= 2 ? "actual" : "pred";
}

export function interpTrajectoryField(
  points: SlopeTrajectoryPoint[],
  offset: number,
  field: "actual" | "pred",
): number | null {
  const exact = points.find((p) => p.offset === offset);
  if (exact?.[field] != null && Number.isFinite(exact[field])) return exact[field];

  const valid = points
    .filter((p) => p[field] != null && Number.isFinite(p[field] as number))
    .sort((a, b) => a.offset - b.offset);
  if (valid.length < 2) return valid[0]?.[field] ?? null;

  if (offset <= valid[0].offset) return valid[0][field] as number;
  if (offset >= valid[valid.length - 1].offset) {
    return valid[valid.length - 1][field] as number;
  }

  for (let i = 0; i < valid.length - 1; i++) {
    const a = valid[i];
    const b = valid[i + 1];
    if (offset >= a.offset && offset <= b.offset) {
      const va = a[field] as number;
      const vb = b[field] as number;
      const t = (offset - a.offset) / (b.offset - a.offset);
      return Math.round((va + t * (vb - va)) * 100) / 100;
    }
  }
  return null;
}

/** Punti lungo la curva visibile (pred o actual) dentro una finestra — per Line colorate. */
export function buildWindowPointSlice(
  points: SlopeTrajectoryPoint[],
  field: "actual" | "pred",
  win: { start: number; end: number },
): SlopeTrajectoryPoint[] {
  const yStart = interpTrajectoryField(points, win.start, field);
  const yEnd = interpTrajectoryField(points, win.end, field);
  if (yStart == null || yEnd == null) return [];

  const slice: SlopeTrajectoryPoint[] = [];
  const push = (offset: number, value: number) => {
    slice.push({
      offset,
      label: "",
      pred: field === "pred" ? value : null,
      actual: field === "actual" ? value : null,
      gap: null,
      isRecalibKnot: false,
      isToday: false,
    });
  };

  if (!points.some((p) => p.offset === win.start && !p.isToday)) {
    push(win.start, yStart);
  }
  for (const p of points) {
    if (p.isToday || p.offset < win.start || p.offset > win.end) continue;
    const v = p[field];
    if (v == null || !Number.isFinite(v)) continue;
    slice.push({
      ...p,
      pred: field === "pred" ? v : p.pred,
      actual: field === "actual" ? v : p.actual,
    });
  }
  if (!slice.some((p) => p.offset === win.end)) {
    push(win.end, yEnd);
  }

  return slice.sort((a, b) => a.offset - b.offset);
}

export function buildTrajectoryWindowSlices(
  points: SlopeTrajectoryPoint[],
  lang: "it" | "en",
  field?: "actual" | "pred",
): TrajectoryWindowSlice[] {
  const it = lang === "it";
  const resolved = field ?? trajectorySegmentField(points);
  const slices: TrajectoryWindowSlice[] = [
    {
      label: it ? "20g" : "20d",
      field: resolved,
      points: buildWindowPointSlice(points, resolved, SLOPE_WINDOW_20D),
    },
    {
      label: it ? "5g" : "5d",
      field: resolved,
      points: buildWindowPointSlice(points, resolved, SLOPE_WINDOW_5D),
    },
  ];
  return slices.filter((s) => s.points.length >= 2);
}

export function buildActualWindowSegments(
  points: SlopeTrajectoryPoint[],
  lang: "it" | "en",
  field?: "actual" | "pred",
): TrajectorySegmentOverlay[] {
  const resolved = field ?? trajectorySegmentField(points);
  const it = lang === "it";
  const seg20 = segmentForWindow(points, SLOPE_WINDOW_20D, it ? "20g" : "20d", resolved);
  const seg5 = segmentForWindow(points, SLOPE_WINDOW_5D, it ? "5g" : "5d", resolved);
  return [seg20, seg5].filter((s): s is TrajectorySegmentOverlay => s != null);
}

function segmentForWindow(
  points: SlopeTrajectoryPoint[],
  win: { start: number; end: number },
  label: string,
  field: "actual" | "pred",
): TrajectorySegmentOverlay | null {
  const yStart = interpTrajectoryField(points, win.start, field);
  const yEnd = interpTrajectoryField(points, win.end, field);
  if (yStart == null || yEnd == null) return null;
  return {
    startOffset: win.start,
    endOffset: win.end,
    yStart,
    yEnd,
    label,
  };
}

export type ExpectedPreErrorPoint = {
  offset: number;
  expected: number;
};

/**
 * Traiettoria attesa prima dell'errore slope: proiezione della pendenza 20g
 * dal confine −10g (inizio finestra 5g) verso oggi e CD.
 */
export function buildExpectedPreErrorTrajectory(
  points: SlopeTrajectoryPoint[],
  todayOffset: number,
  slope20d: number | null,
  field: "actual" | "pred" = "pred",
): ExpectedPreErrorPoint[] {
  if (slope20d == null || !Number.isFinite(slope20d)) return [];
  const pivot = SLOPE_WINDOW_5D.start;
  const yPivot = interpTrajectoryField(points, pivot, field);
  if (yPivot == null) return [];

  const offsets = new Set<number>([pivot, todayOffset, 0]);
  for (const p of points) {
    if (p.offset >= todayOffset && p.offset <= 0) offsets.add(p.offset);
  }

  return [...offsets]
    .sort((a, b) => a - b)
    .map((offset) => ({
      offset,
      expected: Math.round((yPivot + slope20d * (offset - pivot)) * 100) / 100,
    }))
    .filter((p) => Number.isFinite(p.expected));
}
