/**
 * Unified Prediction + Recalibration display grid — same calendar knots and
 * precision in Charts tab, SuperNova overlay, and sparklines.
 * Does not alter backend predictions: sheet Simulation is authoritative when
 * snapshot JSON drifts.
 */
import {
  overlaySheetPredOnPoints,
  simulationRowPredAtOffset,
} from "../data/simulationCharts";
import type { ChartPoint } from "../types";
import {
  ASSESSMENT_CHART_OFFSETS,
  calendarOffsetsForValueCount,
  POST_CD_CHART_OFFSETS,
  STANDARD_CAL_OFFSETS,
} from "./chartNodes";
import { interpolateAtOffset, completionDateToNowOffset } from "./chartNowOffset";
import { resolveRecalibratedChartPoints } from "./predictionCurveDailyRecalib";
import { extractPredGridPoints } from "./precatCurve";
import { supernovaOffsetLabel } from "./sdsHistoryCurve";

/** Calendar knots shared with Simulation Pred columns and SuperNova chart. */
export const PREDICTION_CALENDAR_OFFSETS = STANDARD_CAL_OFFSETS;

/** Extra knots before T−60 when today is still far from CD (watch / monitor zone). */
export function extendedPreCdOffsets(nowOffset: number | null | undefined): number[] {
  if (nowOffset == null || !Number.isFinite(nowOffset) || nowOffset >= -60) return [];
  const extras = [nowOffset];
  if (nowOffset <= -75) extras.push(-75);
  if (nowOffset <= -90) extras.push(-90);
  if (nowOffset <= -105) extras.push(-105);
  if (nowOffset <= -120) extras.push(-120);
  return [...new Set(extras.filter((o) => o < -60))].sort((a, b) => a - b);
}

/** Assessment grid + pre-T−60 extension when «oggi» is before the T−60 anchor. */
export function assessmentChartOffsetsForNow(
  nowOffset: number | null | undefined,
): readonly number[] {
  const merged = new Set<number>([...ASSESSMENT_CHART_OFFSETS, ...extendedPreCdOffsets(nowOffset)]);
  return [...merged].sort((a, b) => a - b);
}

/** Recalib path + foglio Simulation Pred — riempie T−60/T−30 quando lo snapshot parte da T−10. */
function buildUnifiedPredSeries(
  chartPoints: ChartPoint[],
  simRow: Record<string, unknown> | null,
): { offset: number; y: number }[] {
  const byOff = new Map<number, number>();

  const recalib = resolveDisplayRecalibPoints(chartPoints, simRow);
  for (const p of recalib) {
    const y = bestPredPct(p);
    if (y != null) byOff.set(p.offset, roundPredPct(y));
  }

  if (simRow) {
    for (const off of PREDICTION_CALENDAR_OFFSETS) {
      if (byOff.has(off)) continue;
      const sheet = simulationRowPredAtOffset(simRow, off);
      if (sheet != null) byOff.set(off, roundPredPct(sheet));
    }
    for (const g of extractPredGridPoints(simRow)) {
      if (byOff.has(g.d)) continue;
      byOff.set(g.d, roundPredPct(g.pct));
    }
  }

  return [...byOff.entries()]
    .sort(([a], [b]) => a - b)
    .map(([offset, y]) => ({ offset, y }));
}

/** Display precision: 0.01 pp — relevant for small pre-CD moves. */
export function roundPredPct(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Math.round(Number(value) * 100) / 100;
}

/** Raw snapshot vs sheet drift above this → treat JSON node as stale (pp). */
export const SNAPSHOT_SHEET_STALE_PP = 0.01;

export function bestPredPct(p: ChartPoint): number | null {
  const v = p.pct_foglio ?? p.pct_curva ?? p.pct_modello;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type SnapshotSheetDrift = {
  compared: number;
  staleNodes: number;
  maxDriftPp: number;
};

/** Drift between chart JSON and Simulation sheet before reconcile. */
export function snapshotSheetDrift(
  points: ChartPoint[],
  row: Record<string, unknown> | null,
  staleThresholdPp = SNAPSHOT_SHEET_STALE_PP,
): SnapshotSheetDrift {
  if (!row || !points.length) return { compared: 0, staleNodes: 0, maxDriftPp: 0 };
  let compared = 0;
  let staleNodes = 0;
  let maxDriftPp = 0;
  for (const off of PREDICTION_CALENDAR_OFFSETS) {
    const sheetPred = simulationRowPredAtOffset(row, off);
    if (sheetPred == null) continue;
    const snap = points.find(
      (p) => p.offset === off && (p.nodo ?? "standard") === "standard",
    );
    const snapPred = snap ? bestPredPct(snap) : null;
    compared += 1;
    if (snapPred == null) {
      staleNodes += 1;
      continue;
    }
    const drift = Math.abs(roundPredPct(snapPred) - roundPredPct(sheetPred));
    maxDriftPp = Math.max(maxDriftPp, drift);
    if (drift > staleThresholdPp) staleNodes += 1;
  }
  return { compared, staleNodes, maxDriftPp };
}

/**
 * Prefer Simulation sheet Pred at standard nodes when snapshot JSON is stale.
 * K-8 / AI feed knots are preserved from the reconciled overlay path.
 */
export function reconcileChartPointsWithSheet(
  points: ChartPoint[],
  row: Record<string, unknown> | null,
  staleThresholdPp = SNAPSHOT_SHEET_STALE_PP,
): ChartPoint[] {
  if (!row || !points.length) return points;

  const overlaid = overlaySheetPredOnPoints(points, row);
  const byOffset = new Map<number, ChartPoint>();
  for (const p of overlaid) {
    if ((p.nodo ?? "standard") === "standard") byOffset.set(p.offset, p);
  }

  for (const off of PREDICTION_CALENDAR_OFFSETS) {
    const sheetPred = simulationRowPredAtOffset(row, off);
    if (sheetPred == null) continue;
    const rounded = roundPredPct(sheetPred);
    const existing = byOffset.get(off);
    const chartPred = existing ? bestPredPct(existing) : null;
    const stale =
      chartPred == null ||
      Math.abs(roundPredPct(chartPred) - rounded) > staleThresholdPp;
    if (stale) {
      byOffset.set(off, {
        ...(existing ?? { offset: off, nodo: "standard" }),
        offset: off,
        nodo: "standard",
        pct_foglio: rounded,
      });
    }
  }

  const extras = overlaid.filter((p) => (p.nodo ?? "standard") !== "standard");
  return [...byOffset.values(), ...extras].sort((a, b) => a.offset - b.offset);
}

/** Sheet-synced path + daily open recalibration — canonical display series. */
export function resolveDisplayRecalibPoints(
  points: ChartPoint[] | null | undefined,
  row: Record<string, unknown> | null | undefined,
): ChartPoint[] {
  if (!points?.length) return [];
  const synced = reconcileChartPointsWithSheet(points, row ?? null);
  return resolveRecalibratedChartPoints(synced, row ?? null);
}

export type PredCalendarSample = { offset: number; pct: number; label: string };

/** Sample % vs T−60 on the unified calendar grid (linear interp on full recalib path). */
export function samplePredAtCalendarOffsets(
  chartPoints: ChartPoint[],
  simRow: Record<string, unknown> | null,
  extraOffsets: readonly number[] = [],
): PredCalendarSample[] {
  const series = buildUnifiedPredSeries(chartPoints, simRow);
  if (series.length < 2) return [];

  const nowOff = simRow ? completionDateToNowOffset(simRow["Completion Date"]) : null;
  const offsetSet = new Set<number>([
    ...PREDICTION_CALENDAR_OFFSETS,
    ...extraOffsets,
    ...extendedPreCdOffsets(nowOff),
  ]);

  const out: PredCalendarSample[] = [];
  for (const off of [...offsetSet].sort((a, b) => a - b)) {
    const v = interpolateAtOffset(series, off, { extrapolate: true });
    if (v == null) continue;
    out.push({
      offset: off,
      pct: roundPredPct(v),
      label: supernovaOffsetLabel(off),
    });
  }
  return out;
}

/** Standard-grid ChartPoint[] for % line charts (Prediction + Recalibration only). */
export function displayPredChartPoints(
  chartPoints: ChartPoint[],
  simRow: Record<string, unknown> | null,
  extraOffsets: readonly number[] = [],
): ChartPoint[] {
  return samplePredAtCalendarOffsets(chartPoints, simRow, extraOffsets).map(({ offset, pct }) => ({
    offset,
    nodo: "standard",
    pct_foglio: pct,
  }));
}

export type RecalibPredValuesOptions = {
  /** Include +30/+60/+90 post-CD extrapolation knots (assessment charts). */
  extendedPostCd?: boolean;
  /** Override target offset grid (default: standard or assessment). */
  offsets?: readonly number[];
  /** «Oggi» vs CD — estende la griglia oltre T−60 quando oggi è più lontano. */
  nowOffset?: number | null;
};

/** Values aligned with SuperNova overlay (`recalibCurveVsM60`). */
export function recalibPredValuesAtCalendarOffsets(
  chartPoints: ChartPoint[],
  simRow: Record<string, unknown>,
  options?: RecalibPredValuesOptions,
): (number | null)[] | null {
  const nowOff =
    options?.nowOffset ??
    completionDateToNowOffset(simRow["Completion Date"]);
  const targetOffsets =
    options?.offsets ??
    (options?.extendedPostCd
      ? assessmentChartOffsetsForNow(nowOff)
      : PREDICTION_CALENDAR_OFFSETS);
  const extra =
    options?.offsets != null
      ? options.offsets.filter(
          (o) => !PREDICTION_CALENDAR_OFFSETS.includes(o as (typeof PREDICTION_CALENDAR_OFFSETS)[number]),
        )
      : options?.extendedPostCd
        ? POST_CD_CHART_OFFSETS
        : [];
  const samples = samplePredAtCalendarOffsets(chartPoints, simRow, extra);
  if (samples.length < 2) return null;
  const byOff = new Map(samples.map((s) => [s.offset, s.pct]));
  const values: (number | null)[] = [];
  for (const off of targetOffsets) {
    values.push(byOff.get(off) ?? null);
  }
  if (values.filter((v) => v != null && Number.isFinite(v)).length < 2) return null;
  return values;
}

export { calendarOffsetsForValueCount, ASSESSMENT_CHART_OFFSETS };
