/**
 * Slope model vs actual using the full recalibrated prediction path
 * (standard nodes + K-8 + AI feed knots from simulation_charts_snapshot).
 */
import type { ChartPoint } from "../types";
import { interpolateAtOffset } from "./chartNowOffset";
import { includeChartNode, isRecalibExtraNode } from "./chartNodes";
import { resolveDisplayRecalibPoints } from "./predictionCurveGrid";
import {
  calibratePredSlopePpD,
  extractPredGridPoints,
  inferPredSlopesByWindows,
  predPctVsTodayByOffset,
  readModelEmpDeltaPp,
} from "./precatCurve";
import { currentPriceFromRow } from "./simulationPosition";
import { canonicalTodayOffset, curveValuesVsToday } from "./assessmentChartHarmony";
import { POST_CD_CHART_OFFSETS } from "./chartNodes";
import {
  recalibPredValuesAtCalendarOffsets,
  samplePredAtCalendarOffsets,
  assessmentChartOffsetsForNow,
  extendedPreCdOffsets,
} from "./predictionCurveGrid";

export type SlopeChartWindowPoint = {
  d: number;
  label: string;
  pred: number | null;
  predRaw: number | null;
  actual: number | null;
  /** True when this point is an explicit recalibration knot (K-8 / AI feed). */
  isRecalibKnot?: boolean;
};

/** % vs today along the calendar axis — shows model/recalib vs real shape (not pp/d windows). */
export type SlopeTrajectoryPoint = {
  offset: number;
  label: string;
  pred: number | null;
  actual: number | null;
  /** actual − model (% vs today); positive = real above model. */
  gap: number | null;
  isRecalibKnot?: boolean;
  /** Anchor «oggi» sul calendario CD (0% = prezzo attuale). */
  isToday?: boolean;
};

export type BuildSlopeTrajectoryResult = {
  points: SlopeTrajectoryPoint[];
  usedRecalibPath: boolean;
  knotCount: number;
  todayOffset: number;
};

type SeriesPoint = {
  offset: number;
  pred: number | null;
  actual: number | null;
  isRecalibKnot: boolean;
};

const DISPLAY_WINDOWS: { d: number; start: number; end: number; label: string }[] = [
  { d: -5, start: -10, end: -3, label: "5d" },
  { d: -20, start: -30, end: -10, label: "20d" },
  { d: -45, start: -60, end: -20, label: "45d" },
];

const LOCAL_KNOT_WINDOW_D = 5;

function bestPredPct(p: ChartPoint): number | null {
  if (typeof p.pct_foglio === "number" && Number.isFinite(p.pct_foglio)) {
    return p.pct_foglio;
  }
  if (typeof p.pct_curva === "number" && Number.isFinite(p.pct_curva)) {
    return p.pct_curva;
  }
  return null;
}

/** Sheet-synced + daily recalib path — same source as Pred overlay / gain plan. */
export function recalibSeriesFromDisplayPath(
  chartPoints: ChartPoint[] | null | undefined,
  simRow: Record<string, unknown> | null | undefined,
): SeriesPoint[] {
  if (!chartPoints?.length) return [];
  const points = simRow ? resolveDisplayRecalibPoints(chartPoints, simRow) : chartPoints;
  return recalibSeriesFromChartPoints(points);
}

/** All chart nodes used for recalibrated path (incl. K-8 / AI feed). */
export function recalibSeriesFromChartPoints(points: ChartPoint[] | null | undefined): SeriesPoint[] {
  if (!points?.length) return [];
  return points
    .filter((p) => includeChartNode(p, { includeRecalibExtras: true }))
    .filter((p) => Number.isFinite(p.offset))
    .map((p) => ({
      offset: p.offset,
      pred: bestPredPct(p),
      actual:
        typeof p.pct_reale === "number" && Number.isFinite(p.pct_reale) ? p.pct_reale : null,
      isRecalibKnot: isRecalibExtraNode(p),
    }))
    .sort((a, b) => a.offset - b.offset);
}

/** OLS slope % vs calendar offset → pp/d (offset is already in days). */
export function olsSlopePpD(
  pts: { offset: number; pct: number }[],
): number | null {
  if (pts.length < 2) return null;
  const n = pts.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of pts) {
    sumX += p.offset;
    sumY += p.pct;
    sumXY += p.offset * p.pct;
    sumXX += p.offset * p.offset;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-9) return null;
  return Math.round(((n * sumXY - sumX * sumY) / denom) * 100) / 100;
}

function slopeInWindow(
  series: SeriesPoint[],
  start: number,
  end: number,
  field: "pred" | "actual",
): number | null {
  const pts = series
    .filter((p) => p.offset >= start && p.offset <= end)
    .map((p) => ({
      offset: p.offset,
      pct: field === "pred" ? p.pred : p.actual,
    }))
    .filter((p): p is { offset: number; pct: number } => p.pct != null && Number.isFinite(p.pct));
  return olsSlopePpD(pts);
}

/** OLS pp/d on overlay-aligned pred samples (% vs T−60). */
function slopeInWindowFromPredSeries(
  series: { offset: number; pct: number }[],
  start: number,
  end: number,
): number | null {
  const pts = series.filter((p) => p.offset >= start && p.offset <= end);
  return olsSlopePpD(pts);
}

/** Canonical pred curve samples — same path as Supernova overlay / gain plan grid. */
export function overlayPredCalendarSeries(
  chartPoints: ChartPoint[],
  simRow: Record<string, unknown>,
  extraOffsets: readonly number[] = [-45, -20, -15],
): { offset: number; pct: number }[] {
  return samplePredAtCalendarOffsets(chartPoints, simRow, extraOffsets).map((s) => ({
    offset: s.offset,
    pct: s.pct,
  }));
}

function windowPoint(
  win: (typeof DISPLAY_WINDOWS)[number],
  predRaw: number | null,
  predCal: number | null,
  actual: number | null,
): SlopeChartWindowPoint {
  return {
    d: win.d,
    label: win.label,
    pred: predCal,
    predRaw,
    actual,
  };
}

export type BuildSlopeCurveResult = {
  points: SlopeChartWindowPoint[];
  usedRecalibPath: boolean;
  knotCount: number;
  modelDeltaPp: number | null;
};

/**
 * Build chart points: model pp/d from overlay calendar grid; actual from recalib display path.
 * Fallback to Pred grid + single-point Δ mod−emp calibration when chart data is sparse.
 */
export function buildSlopeCurveWithRecalib(opts: {
  chartPoints?: ChartPoint[] | null;
  simRow: Record<string, unknown> | null;
  actual5: number | null;
  actual20: number | null;
  actual45: number | null;
}): BuildSlopeCurveResult {
  const modelDeltaPp = opts.simRow ? readModelEmpDeltaPp(opts.simRow) : null;
  const displaySeries =
    opts.simRow && opts.chartPoints?.length
      ? recalibSeriesFromDisplayPath(opts.chartPoints, opts.simRow)
      : recalibSeriesFromChartPoints(opts.chartPoints);
  const knotCount = displaySeries.filter((p) => p.isRecalibKnot).length;

  const overlayPredPts =
    opts.simRow && opts.chartPoints?.length
      ? overlayPredCalendarSeries(opts.chartPoints, opts.simRow)
      : [];

  const knotPredFallback = displaySeries
    .filter((p) => p.pred != null)
    .map((p) => ({ offset: p.offset, pct: p.pred as number }));

  const predSeries = overlayPredPts.length >= 2 ? overlayPredPts : knotPredFallback;
  const usedOverlayPred = overlayPredPts.length >= 2;

  const predInWindow = (start: number, end: number) =>
    slopeInWindowFromPredSeries(predSeries, start, end);
  const actualInWindow = (start: number, end: number) =>
    slopeInWindow(displaySeries, start, end, "actual");

  const hasRecalibPred =
    predSeries.length >= 2 &&
    (usedOverlayPred ||
      knotCount > 0 ||
      (displaySeries.filter((p) => p.pred != null).length >= 3 &&
        displaySeries.some((p) => p.pred != null && p.offset <= -10) &&
        displaySeries.some((p) => p.pred != null && p.offset >= -5)));

  if (hasRecalibPred && displaySeries.length >= 2) {
    const out: SlopeChartWindowPoint[] = [];

    for (const win of DISPLAY_WINDOWS) {
      const pred = predInWindow(win.start, win.end);
      const actualFromCurve = actualInWindow(win.start, win.end);
      const actual =
        actualFromCurve ??
        (win.d === -5 ? opts.actual5 : win.d === -20 ? opts.actual20 : opts.actual45);
      if (pred != null || actual != null) {
        out.push(windowPoint(win, pred, pred, actual));
      }
    }

    for (const knot of displaySeries.filter((p) => p.isRecalibKnot && p.offset >= -45 && p.offset <= -3)) {
      const localStart = knot.offset - LOCAL_KNOT_WINDOW_D;
      const pred = predInWindow(localStart, knot.offset);
      const actualFromCurve = actualInWindow(localStart, knot.offset);
      if (pred == null && actualFromCurve == null) continue;
      if (out.some((p) => p.d === knot.offset)) continue;
      out.push({
        d: knot.offset,
        label: `${knot.offset}d`,
        pred,
        predRaw: pred,
        actual: actualFromCurve,
        isRecalibKnot: true,
      });
    }

    out.sort((a, b) => a.d - b.d);
    return { points: out, usedRecalibPath: usedOverlayPred || knotCount > 0, knotCount, modelDeltaPp };
  }

  const raw = opts.simRow
    ? inferPredSlopesByWindows(opts.simRow)
    : { slope5d: null, slope20d: null, slope45d: null };
  const pred5 = calibratePredSlopePpD(raw.slope5d, modelDeltaPp, 5);
  const pred20 = calibratePredSlopePpD(raw.slope20d ?? raw.slope5d, modelDeltaPp, 20);
  const pred45 = calibratePredSlopePpD(
    raw.slope45d ?? raw.slope20d ?? raw.slope5d,
    modelDeltaPp,
    45,
  );

  const fallback: SlopeChartWindowPoint[] = [
    {
      d: -5,
      label: "5d",
      pred: pred5,
      predRaw: raw.slope5d,
      actual: opts.actual5,
    },
    {
      d: -20,
      label: "20d",
      pred: pred20,
      predRaw: raw.slope20d ?? raw.slope5d,
      actual: opts.actual20,
    },
  ];
  if (opts.actual45 != null && Number.isFinite(opts.actual45)) {
    fallback.push({
      d: -45,
      label: "45d",
      pred: pred45,
      predRaw: raw.slope45d ?? raw.slope20d ?? raw.slope5d,
      actual: opts.actual45,
    });
  }

  return {
    points: fallback.filter((p) => p.pred != null || p.actual != null).sort((a, b) => a.d - b.d),
    usedRecalibPath: false,
    knotCount: 0,
    modelDeltaPp,
  };
}

/** Model pp/d at 5d / 20d / 45d windows — recalib chart path when available. */
export function modelSlopesFromRecalibChart(
  chartPoints: ChartPoint[] | null | undefined,
  simRow: Record<string, unknown> | null,
): {
  slope5d: number | null;
  slope20d: number | null;
  slope45d: number | null;
  usedRecalibPath: boolean;
} {
  const built = buildSlopeCurveWithRecalib({
    chartPoints,
    simRow,
    actual5: null,
    actual20: null,
    actual45: null,
  });
  const pick = (d: number) => built.points.find((p) => p.d === d)?.pred ?? null;
  return {
    slope5d: pick(-5),
    slope20d: pick(-20),
    slope45d: pick(-45),
    usedRecalibPath: built.usedRecalibPath,
  };
}

/** Actual market data exists only at or before the «today» calendar offset. */
function isRealizedCalendarOffset(offset: number, todayOffset: number): boolean {
  return offset <= todayOffset + 0.01;
}

function clipActualMapToPast(
  map: Map<number, number>,
  todayOffset: number,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const [d, v] of map) {
    if (isRealizedCalendarOffset(d, todayOffset) && v != null && Number.isFinite(v)) {
      out.set(d, v);
    }
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Same pred % vs today as Supernova overlay (samplePredAtCalendarOffsets + rebase). */
function predMapFromOverlayPath(
  chartPoints: ChartPoint[],
  simRow: Record<string, unknown>,
  todayOffset: number,
): Map<number, number> | null {
  const raw = recalibPredValuesAtCalendarOffsets(chartPoints, simRow, {
    extendedPostCd: true,
    nowOffset: todayOffset,
    offsets: assessmentChartOffsetsForNow(todayOffset),
  });
  if (!raw) return null;
  const offsets = assessmentChartOffsetsForNow(todayOffset);
  const vsToday = curveValuesVsToday(raw, todayOffset, offsets);
  const out = new Map<number, number>();
  for (let i = 0; i < offsets.length; i++) {
    const off = offsets[i]!;
    const v = vsToday[i];
    if (v == null || !Number.isFinite(v)) continue;
    out.set(off, round2(v));
  }
  out.set(todayOffset, 0);
  return out.size >= 2 ? out : null;
}

/** % vs oggi da price_storico_usd nel bundle (quando pct_reale è assente o troppo rada). */
function actualPctVsTodayFromHistoricPrices(
  chartPoints: ChartPoint[] | null | undefined,
  simRow: Record<string, unknown> | null,
  todayOffset: number,
): Map<number, number> {
  if (!chartPoints?.length || !simRow) return new Map();
  const nowPrice = currentPriceFromRow(simRow);
  if (nowPrice == null || nowPrice <= 0) return new Map();

  const pricePts = chartPoints
    .filter((p) => p.price_storico_usd != null && Number.isFinite(p.price_storico_usd))
    .map((p) => ({ d: p.offset, pct: p.price_storico_usd as number }));
  if (pricePts.length < 2) return new Map();

  const out = new Map<number, number>();
  const offsets = new Set<number>();
  for (const p of pricePts) {
    if (isRealizedCalendarOffset(p.d, todayOffset)) offsets.add(p.d);
  }
  for (const d of [-60, -45, -30, -20, -15, -10, -7, -5, -3, 0, 4, 7]) {
    if (isRealizedCalendarOffset(d, todayOffset)) offsets.add(d);
  }
  offsets.add(todayOffset);

  for (const d of [...offsets].sort((a, b) => a - b)) {
    const px = interpolateAtOffset(
      pricePts.map((p) => ({ offset: p.d, y: p.pct })),
      d,
      { extrapolate: true },
    );
    if (px == null || !Number.isFinite(px)) continue;
    out.set(d, round2(((px - nowPrice) / nowPrice) * 100));
  }
  return out;
}

function mergeActualPctMaps(
  primary: Map<number, number>,
  fallback: Map<number, number>,
): Map<number, number> {
  const out = new Map<number, number>(fallback);
  for (const [k, v] of primary) {
    if (v != null && Number.isFinite(v)) out.set(k, v);
  }
  return out;
}

/**
 * Trajectory chart: model/recalib % vs real % on the same calendar axis (% vs today).
 * Makes deceleration and model deviation visible (not flattened by OLS pp/d windows).
 */
export function buildSlopeTrajectory(opts: {
  chartPoints?: ChartPoint[] | null;
  simRow: Record<string, unknown> | null;
  daysToCd: number;
}): BuildSlopeTrajectoryResult {
  const todayOffset = canonicalTodayOffset(opts.simRow, opts.daysToCd);
  const series = opts.simRow
    ? recalibSeriesFromDisplayPath(opts.chartPoints, opts.simRow)
    : recalibSeriesFromChartPoints(opts.chartPoints);
  const knotCount = series.filter((p) => p.isRecalibKnot).length;
  const knotOffsets = new Set(
    series.filter((p) => p.isRecalibKnot).map((p) => p.offset),
  );

  const predPts = series
    .filter((p) => p.pred != null)
    .map((p) => ({ d: p.offset, pct: p.pred as number }));
  if (predPts.length < 2 && opts.simRow) {
    for (const g of extractPredGridPoints(opts.simRow)) {
      if (!predPts.some((p) => p.d === g.d)) predPts.push(g);
    }
    predPts.sort((a, b) => a.d - b.d);
  }

  const actualPts = series
    .filter((p) => p.actual != null && isRealizedCalendarOffset(p.offset, todayOffset))
    .map((p) => ({ d: p.offset, pct: p.actual as number }));

  const overlayPred =
    opts.simRow && opts.chartPoints?.length
      ? predMapFromOverlayPath(opts.chartPoints, opts.simRow, todayOffset)
      : null;
  const predMap =
    overlayPred ??
    (() => {
      const map = predPctVsTodayByOffset(predPts, todayOffset);
      for (const off of POST_CD_CHART_OFFSETS) {
        if (off < todayOffset - 0.01) continue;
        if (map.has(off)) continue;
        const pct = interpolateAtOffset(
          predPts.map((p) => ({ offset: p.d, y: p.pct })),
          off,
          { extrapolate: true },
        );
        if (pct != null && Number.isFinite(pct)) map.set(off, round2(pct));
      }
      return map;
    })();
  const postCdMax = Math.max(...POST_CD_CHART_OFFSETS);
  const actualFromReale = predPctVsTodayByOffset(actualPts, todayOffset);
  const actualFromPrice = actualPctVsTodayFromHistoricPrices(
    opts.chartPoints,
    opts.simRow,
    todayOffset,
  );
  const actualMap = clipActualMapToPast(
    mergeActualPctMaps(actualFromReale, actualFromPrice),
    todayOffset,
  );

  const usedRecalibPath =
    knotCount > 0 ||
    (series.length >= 2 && predPts.length >= 3);

  const offsets = new Set<number>([...predMap.keys(), ...actualMap.keys()]);
  for (const d of assessmentChartOffsetsForNow(todayOffset)) {
    if (d >= todayOffset && d <= postCdMax) offsets.add(d);
  }
  for (const d of extendedPreCdOffsets(todayOffset)) {
    offsets.add(d);
  }
  offsets.add(todayOffset);

  let points: SlopeTrajectoryPoint[] = [...offsets]
    .sort((a, b) => a - b)
    .map((offset) => {
      const pred = predMap.get(offset) ?? null;
      const rawActual = actualMap.get(offset) ?? null;
      const actual = isRealizedCalendarOffset(offset, todayOffset) ? rawActual : null;
      const isToday = offset === todayOffset;
      return {
        offset,
        label: isToday ? "T0" : offset === 0 ? "CD" : `T${offset}`,
        pred: isToday ? (pred ?? 0) : pred,
        actual: isToday ? (actual ?? 0) : actual,
        gap:
          pred != null && actual != null ? round2(actual - pred) : null,
        isRecalibKnot: knotOffsets.has(offset),
        isToday,
      };
    })
    .filter((p) => p.isToday || p.pred != null || p.actual != null);

  if (!points.some((p) => p.isToday)) {
    points = [
      ...points,
      {
        offset: todayOffset,
        label: "T0",
        pred: 0,
        actual: 0,
        gap: null,
        isToday: true,
      },
    ].sort((a, b) => a.offset - b.offset);
  }

  return { points, usedRecalibPath, knotCount, todayOffset };
}

/** True when trajectory chart has enough points (snapshot and/or Pred grid on sim row). */
export function canRenderSlopeTrajectory(opts: {
  chartPoints?: ChartPoint[] | null;
  simRow: Record<string, unknown> | null;
  daysToCd: number;
}): boolean {
  return buildSlopeTrajectory(opts).points.length >= 2;
}

/** % gap (actual − model) at standard windows on the trajectory. */
export function slopeGapsFromTrajectory(points: SlopeTrajectoryPoint[]): {
  at5: number | null;
  at20: number | null;
  maxAbs: number | null;
} {
  const pick = (d: number) =>
    points.find((p) => p.offset === d) ??
    points.reduce<SlopeTrajectoryPoint | null>((best, p) => {
      if (Math.abs(p.offset - d) > 3) return best;
      if (!best || Math.abs(p.offset - d) < Math.abs(best.offset - d)) return p;
      return best;
    }, null);

  let at5: number | null = null;
  let at20: number | null = null;
  let maxAbs: number | null = null;
  for (const win of [-5, -20] as const) {
    const row = pick(win);
    if (row?.gap == null) continue;
    if (win === -5) at5 = row.gap;
    if (win === -20) at20 = row.gap;
    const abs = Math.abs(row.gap);
    if (maxAbs == null || abs > maxAbs) maxAbs = abs;
  }
  for (const p of points) {
    if (p.gap == null) continue;
    const abs = Math.abs(p.gap);
    if (maxAbs == null || abs > maxAbs) maxAbs = abs;
  }
  return { at5, at20, maxAbs };
}

/** Local pp/d slope on the trajectory between two calendar anchors (% vs today). */
export function segmentSlopePpD(
  points: SlopeTrajectoryPoint[],
  field: "pred" | "actual",
  dEnd: number,
  dStart: number,
): number | null {
  const pEnd = points.find((p) => p.offset === dEnd);
  const pStart = points.find((p) => p.offset === dStart);
  const vEnd = pEnd?.[field];
  const vStart = pStart?.[field];
  if (vEnd == null || vStart == null || dEnd === dStart) return null;
  return round2((vEnd - vStart) / (dEnd - dStart));
}

/** Gap model − actual (pp/d) at each window; uses all recalib-aware slopes when available. */
export function slopeGapsFromCurvePoints(points: SlopeChartWindowPoint[]): {
  at5: number | null;
  at20: number | null;
  maxAbs: number | null;
} {
  let at5: number | null = null;
  let at20: number | null = null;
  let maxAbs: number | null = null;
  for (const p of points) {
    if (p.pred == null || p.actual == null) continue;
    const gap = Math.round((p.actual - p.pred) * 100) / 100;
    if (p.d === -5) at5 = gap;
    if (p.d === -20) at20 = gap;
    const abs = Math.abs(gap);
    if (maxAbs == null || abs > maxAbs) maxAbs = abs;
  }
  return { at5, at20, maxAbs };
}
