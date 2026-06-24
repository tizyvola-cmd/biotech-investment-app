/**
 * Market vs model slope trajectory — aligned with desktop buildSlopeTrajectory:
 * extends actual path to T−120 via price_storico_usd (incl. K-8 knots).
 */
import type { RecalibCurvePoint } from "./mobileRecalibCurve";
import {
  assessmentChartOffsetsForNow,
  extendedPreCdOffsets,
  interpolateSeriesAtOffset,
  supernovaOffsetLabel,
} from "./mobileChartCalendar";
import { currentPriceFromRow } from "./simLogic";
import type { ChartPoint } from "./types";
import type { MobileCurveChartsPayload } from "./dashboardTypes";

type TrajectoryPoint = NonNullable<MobileCurveChartsPayload["slopeTrajectory"]>[number];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function bestPredPct(p: ChartPoint): number | null {
  if (typeof p.pct_foglio === "number" && Number.isFinite(p.pct_foglio)) return p.pct_foglio;
  if (typeof p.pct_curva === "number" && Number.isFinite(p.pct_curva)) return p.pct_curva;
  if (typeof p.pct_modello === "number" && Number.isFinite(p.pct_modello)) return p.pct_modello;
  return null;
}

function isRecalibExtraNode(p: ChartPoint): boolean {
  const n = (p.nodo ?? "standard").trim();
  return n === "K-8" || n === "8-K" || n === "AI feed";
}

function includeChartNode(p: ChartPoint): boolean {
  const n = p.nodo ?? "standard";
  return n === "standard" || isRecalibExtraNode(p);
}

function isRealizedCalendarOffset(offset: number, todayOffset: number): boolean {
  return offset <= todayOffset + 0.01;
}

function pctVsTodayByOffset(
  pts: { d: number; pct: number }[],
  todayOffset: number,
  extraOffsets: number[] = [],
): Map<number, number> {
  if (!pts.length) return new Map();
  const series = pts.map((p) => ({ offset: p.d, y: p.pct }));
  const base = interpolateSeriesAtOffset(series, todayOffset, { extrapolate: true });
  if (base == null || !Number.isFinite(base)) return new Map();

  const offsets = new Set<number>(extraOffsets);
  for (const p of pts) {
    if (isRealizedCalendarOffset(p.d, todayOffset)) offsets.add(p.d);
  }
  for (const d of [-120, -105, -90, -75, -60, -45, -30, -20, -15, -10, -7, -5, -3, 0, 4, 7]) {
    if (isRealizedCalendarOffset(d, todayOffset)) offsets.add(d);
  }
  offsets.add(todayOffset);

  const out = new Map<number, number>();
  for (const d of [...offsets].sort((a, b) => a - b)) {
    const at = interpolateSeriesAtOffset(series, d, { extrapolate: true });
    if (at == null || !Number.isFinite(at)) continue;
    out.set(d, round2(at - base));
  }
  out.set(todayOffset, 0);
  return out;
}

function actualPctVsTodayFromHistoricPrices(
  chartPoints: ChartPoint[] | null | undefined,
  simRow: Record<string, unknown> | null,
  todayOffset: number,
): Map<number, number> {
  if (!chartPoints?.length || !simRow) return new Map();
  const nowPrice = currentPriceFromRow(simRow);
  if (nowPrice == null || nowPrice <= 0) return new Map();

  const pricePts = chartPoints
    .filter((p) => includeChartNode(p))
    .filter((p) => p.price_storico_usd != null && Number.isFinite(p.price_storico_usd))
    .map((p) => ({ d: p.offset, pct: p.price_storico_usd as number }));
  if (pricePts.length < 2) return new Map();

  const offsets = new Set<number>();
  for (const p of pricePts) {
    if (isRealizedCalendarOffset(p.d, todayOffset)) offsets.add(p.d);
  }
  for (const d of extendedPreCdOffsets(todayOffset)) {
    if (isRealizedCalendarOffset(d, todayOffset)) offsets.add(d);
  }
  for (const d of [-120, -105, -90, -75, -60, -45, -30, -20, -15, -10, -7, -5, -3, 0]) {
    if (isRealizedCalendarOffset(d, todayOffset)) offsets.add(d);
  }
  offsets.add(todayOffset);

  const out = new Map<number, number>();
  for (const d of [...offsets].sort((a, b) => a - b)) {
    const px = interpolateSeriesAtOffset(
      pricePts.map((p) => ({ offset: p.d, y: p.pct })),
      d,
      { extrapolate: true },
    );
    if (px == null || !Number.isFinite(px)) continue;
    out.set(d, round2(((px - nowPrice) / nowPrice) * 100));
  }
  return out;
}

function mergePctMaps(primary: Map<number, number>, fallback: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>(fallback);
  for (const [k, v] of primary) {
    if (v != null && Number.isFinite(v)) out.set(k, v);
  }
  return out;
}

function seriesFromChartPoints(chartPts: ChartPoint[]): Array<{
  offset: number;
  pred: number | null;
  actual: number | null;
}> {
  const byOff = new Map<number, { pred: number | null; actual: number | null }>();
  for (const p of chartPts.filter(includeChartNode)) {
    if (!Number.isFinite(p.offset)) continue;
    const prev = byOff.get(p.offset) ?? { pred: null, actual: null };
    const pred = bestPredPct(p) ?? prev.pred;
    const actual =
      typeof p.pct_reale === "number" && Number.isFinite(p.pct_reale) ? p.pct_reale : prev.actual;
    byOff.set(p.offset, { pred, actual });
  }
  return [...byOff.entries()]
    .sort(([a], [b]) => a - b)
    .map(([offset, v]) => ({ offset, ...v }));
}

/** Watch-zone market slope: full pre-CD arc shown on mobile MII chart. */
export const MARKET_SLOPE_WATCH_MIN = -120;
export const MARKET_SLOPE_WATCH_MAX = -7;

export const MARKET_SLOPE_WATCH_TICKS = [-120, -105, -90, -75, -60, -45, -30, -15, -7] as const;

function fallbackPredFromSheet(sheet: RecalibCurvePoint[]): Array<{ d: number; pct: number }> {
  return sheet
    .filter((p) => Number.isFinite(p.offset) && Number.isFinite(p.val))
    .map((p) => ({ d: p.offset, pct: p.val }));
}

export function isMarketSlopeWatchView(todayOffset: number | null | undefined): boolean {
  return (
    todayOffset != null &&
    Number.isFinite(todayOffset) &&
    todayOffset <= MARKET_SLOPE_WATCH_MAX &&
    todayOffset >= MARKET_SLOPE_WATCH_MIN - 15
  );
}

export function marketSlopeWatchDomain(
  todayOffset: number | null,
  zoom: number,
): [number, number] {
  const z = Math.min(4, Math.max(1, zoom));
  const fullMin = MARKET_SLOPE_WATCH_MIN;
  const fullMax = MARKET_SLOPE_WATCH_MAX;
  const fullSpan = fullMax - fullMin;
  if (z <= 1.01) return [fullMin, fullMax];

  const span = fullSpan / z;
  const center =
    todayOffset != null && todayOffset >= fullMin && todayOffset <= fullMax
      ? todayOffset
      : (fullMin + fullMax) / 2;
  let xMin = center - span / 2;
  let xMax = center + span / 2;
  if (xMin < fullMin) {
    xMax += fullMin - xMin;
    xMin = fullMin;
  }
  if (xMax > fullMax) {
    xMin -= xMax - fullMax;
    xMax = fullMax;
  }
  return [Math.max(fullMin, xMin), Math.min(fullMax, xMax)];
}

function fillForwardPredToWatchEnd(
  predMap: Map<number, number>,
  predPts: { d: number; pct: number }[],
  todayOffset: number,
): Map<number, number> {
  if (todayOffset > MARKET_SLOPE_WATCH_MAX) return predMap;
  const series = predPts.map((p) => ({ offset: p.d, y: p.pct }));
  if (series.length < 2) return predMap;

  const base = interpolateSeriesAtOffset(series, todayOffset, { extrapolate: true });
  if (base == null || !Number.isFinite(base)) return predMap;

  const out = new Map(predMap);
  out.set(todayOffset, 0);

  for (const d of MARKET_SLOPE_WATCH_TICKS) {
    if (d < MARKET_SLOPE_WATCH_MIN || d > MARKET_SLOPE_WATCH_MAX) continue;
    const at = interpolateSeriesAtOffset(series, d, { extrapolate: true });
    if (at != null && Number.isFinite(at)) out.set(d, round2(at - base));
  }

  for (let d = Math.ceil(todayOffset) + 1; d <= MARKET_SLOPE_WATCH_MAX; d++) {
    const at = interpolateSeriesAtOffset(series, d, { extrapolate: true });
    if (at != null && Number.isFinite(at)) out.set(d, round2(at - base));
  }

  return out;
}

/** Full slope trajectory (% vs today) — market path can reach T−120 when CD is distant. */
export function buildMobileSlopeTrajectory(opts: {
  chartPts: ChartPoint[];
  simRow: Record<string, unknown> | null;
  nowOff: number | null;
  fallbackSheet?: RecalibCurvePoint[];
}): MobileCurveChartsPayload["slopeTrajectory"] {
  const todayOffset = opts.nowOff;
  if (todayOffset == null || !Number.isFinite(todayOffset)) {
    return legacyBuildSlopeFromChart(opts.chartPts, null, opts.fallbackSheet ?? []);
  }

  const series = seriesFromChartPoints(opts.chartPts);
  const predPts = series
    .filter((p) => p.pred != null)
    .map((p) => ({ d: p.offset, pct: p.pred as number }));
  if (predPts.length < 2 && opts.fallbackSheet?.length) {
    for (const g of fallbackPredFromSheet(opts.fallbackSheet)) {
      if (!predPts.some((p) => p.d === g.d)) predPts.push(g);
    }
    predPts.sort((a, b) => a.d - b.d);
  }

  const actualPts = series
    .filter((p) => p.actual != null && isRealizedCalendarOffset(p.offset, todayOffset))
    .map((p) => ({ d: p.offset, pct: p.actual as number }));

  const predMapRaw = pctVsTodayByOffset(predPts, todayOffset, extendedPreCdOffsets(todayOffset));
  const predMap = fillForwardPredToWatchEnd(predMapRaw, predPts, todayOffset);
  const actualFromReale = pctVsTodayByOffset(actualPts, todayOffset, extendedPreCdOffsets(todayOffset));
  const actualFromPrice = actualPctVsTodayFromHistoricPrices(opts.chartPts, opts.simRow, todayOffset);
  const actualMap = mergePctMaps(actualFromReale, actualFromPrice);

  const offsets = new Set<number>([...predMap.keys(), ...actualMap.keys()]);
  for (const d of assessmentChartOffsetsForNow(todayOffset)) {
    if (d >= todayOffset) offsets.add(d);
  }
  for (const d of extendedPreCdOffsets(todayOffset)) {
    offsets.add(d);
  }
  if (todayOffset <= MARKET_SLOPE_WATCH_MAX) {
    for (const d of MARKET_SLOPE_WATCH_TICKS) offsets.add(d);
    for (let d = Math.ceil(todayOffset); d <= MARKET_SLOPE_WATCH_MAX; d++) offsets.add(d);
  }
  offsets.add(todayOffset);

  let points: TrajectoryPoint[] = [...offsets]
    .sort((a, b) => a - b)
    .map((offset) => {
      const pred = predMap.get(offset) ?? null;
      const rawActual = actualMap.get(offset) ?? null;
      const actual = isRealizedCalendarOffset(offset, todayOffset) ? rawActual : null;
      const isToday = offset === todayOffset;
      return {
        offset,
        label: isToday ? "Today" : supernovaOffsetLabel(offset),
        pred: isToday ? (pred ?? 0) : pred,
        actual: isToday ? (actual ?? 0) : actual,
      };
    })
    .filter((p) => p.label === "Today" || p.pred != null || p.actual != null);

  if (!points.some((p) => p.offset === todayOffset)) {
    points = [
      ...points,
      {
        offset: todayOffset,
        label: "Today",
        pred: 0,
        actual: 0,
      },
    ].sort((a, b) => a.offset - b.offset);
  }

  return points.length >= 2 ? points : legacyBuildSlopeFromChart(opts.chartPts, todayOffset, opts.fallbackSheet ?? []);
}

/** Legacy path — kept as fallback when calendar offset unknown. */
function legacyBuildSlopeFromChart(
  chartPts: ChartPoint[],
  nowOff: number | null,
  fallbackSheet: RecalibCurvePoint[],
): MobileCurveChartsPayload["slopeTrajectory"] {
  if (chartPts.length >= 2) {
    const byOff = new Map<number, { pred: number | null; actual: number | null }>();
    for (const p of chartPts.filter(includeChartNode)) {
      const prev = byOff.get(p.offset) ?? { pred: null, actual: null };
      const pred = bestPredPct(p) ?? prev.pred;
      const actual =
        typeof p.pct_reale === "number" && Number.isFinite(p.pct_reale) ? p.pct_reale : prev.actual;
      byOff.set(p.offset, { pred, actual });
    }
    const sorted = [...byOff.entries()].sort((a, b) => a[0] - b[0]);
    const predRaw = sorted
      .filter(([, v]) => v.pred != null)
      .map(([offset, v]) => ({ offset, val: v.pred as number }));
    const rebasedPred = rebaseVsTodayLegacy(predRaw, nowOff);
    const atNowVal =
      nowOff != null && rebasedPred.length
        ? (rebasedPred.find((p) => p.offset === nowOff)?.val ??
          rebasedPred.reduce((best, p) =>
            Math.abs(p.offset - nowOff) < Math.abs(best.offset - nowOff) ? p : best,
          ).val)
        : null;
    const base = atNowVal ?? 0;
    return sorted.map(([offset, v]) => ({
      offset,
      label: supernovaOffsetLabel(offset),
      pred: rebasedPred.find((p) => p.offset === offset)?.val ?? null,
      actual:
        v.actual != null && nowOff != null
          ? round2(v.actual - (predRaw.find((p) => p.offset === nowOff)?.val ?? base))
          : v.actual,
    }));
  }
  if (fallbackSheet.length >= 2) {
    const rebased = rebaseVsTodayLegacy(
      fallbackSheet.map((p) => ({ offset: p.offset, val: p.val })),
      nowOff,
    );
    return rebased.map((p) => ({
      offset: p.offset,
      label: supernovaOffsetLabel(p.offset),
      pred: p.val,
      actual: null,
    }));
  }
  return null;
}

function rebaseVsTodayLegacy(
  points: Array<{ offset: number; val: number }>,
  nowOff: number | null,
): Array<{ offset: number; val: number }> {
  if (nowOff == null || !points.length) return points;
  const sorted = [...points].sort((a, b) => a.offset - b.offset);
  const base = interpolateSeriesAtOffset(
    sorted.map((p) => ({ offset: p.offset, y: p.val })),
    nowOff,
    { extrapolate: true },
  );
  if (base == null || !Number.isFinite(base)) return points;
  return sorted.map((p) => ({
    offset: p.offset,
    val: round2(p.val - base),
  }));
}
