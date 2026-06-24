/**
 * Cohort mean ± SD of |prediction − realized ROI| at calendar timepoints.
 * Three methods: SDS, Pred+Recal, Pred+Recal+Blend vs historical actual (CD+14d when available).
 */
import type { SdsRow } from "../api/supernova";
import {
  chartPointsMapFromBundle,
  simulationRowPredAtOffset,
  simulationRowSeriesKey,
} from "../data/simulationCharts";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import type { SdsRoiBlendEvalClientCtx } from "./sdsRoiBlendEval";
import type { ChartPoint } from "../types";
import type {
  SdsRoiBacktestScoresDoc,
  SdsRoiForecastEvent,
  SdsRoiForecastLogDoc,
  SdsRoiHorizonKey,
  SdsSnapshotDoc,
} from "./sdsRoiForecast";
import {
  buildSimulationEventKeys,
  resolveSdsRowCompletionDate,
  type SimulationSheetSnapshotDoc,
} from "./sdsRoiSimConvergence";
import {
  blendCurveFromSimChart,
  curveRoiFromSimChart,
  type SdsCurveRoiBlend,
  type SdsRoiClusterContext,
} from "./sdsRoiBlend";
import { recalibCurveVsM60 } from "./sdsCompareOverlay";
import { SUPERNova_OFFSETS, supernovaOffsetLabel } from "./sdsHistoryCurve";
import { normalizeCompletionDateForKey } from "./investSimKeys";

/** Calendar knots for temporal convergence (days vs CD). */
export const ROI_CONVERGENCE_OFFSETS = [-60, -30, -10, -7, -3, 4, 10] as const;

const HORIZON_OFFSET: Record<SdsRoiHorizonKey, number> = {
  pre_10: -10,
  pre_5: -5,
  post_4: 4,
};

const REFERENCE_HORIZON: SdsRoiHorizonKey = "pre_5";

export type RoiConvergenceMethodStats = {
  meanAbsErrPp: number | null;
  sdAbsErrPp: number | null;
  n: number;
};

export type RoiTemporalConvergencePoint = {
  offset: number;
  label: string;
  sds: RoiConvergenceMethodStats;
  pred: RoiConvergenceMethodStats;
  blend: RoiConvergenceMethodStats;
  nActual: number;
};

export type RoiTemporalConvergenceView = {
  points: RoiTemporalConvergencePoint[];
  nSimCohort: number;
  nWithActual: number;
  hasCurve: boolean;
};

function parseNum(v: unknown): number | null {
  if (v == null || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function meanSdAbs(vals: number[]): RoiConvergenceMethodStats {
  if (!vals.length) return { meanAbsErrPp: null, sdAbsErrPp: null, n: 0 };
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  if (vals.length === 1) {
    return { meanAbsErrPp: round1(mean), sdAbsErrPp: 0, n: 1 };
  }
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1);
  return { meanAbsErrPp: round1(mean), sdAbsErrPp: round1(Math.sqrt(variance)), n: vals.length };
}

function predFromHorizonMap(
  map: Partial<Record<SdsRoiHorizonKey, number | null>> | undefined,
  offset: number,
): number | null {
  if (!map) return null;
  const pts = (Object.keys(HORIZON_OFFSET) as SdsRoiHorizonKey[]).map((k) => ({
    offset: HORIZON_OFFSET[k],
    y: parseNum(map[k]),
  }));
  return interpolateAtOffset(pts, offset, { extrapolate: true });
}

function predFromCalendarGrid(values: (number | null)[] | null | undefined, offset: number): number | null {
  if (!values?.length) return null;
  const pts = SUPERNova_OFFSETS.map((off, i) => ({ offset: off, y: values[i] ?? null }));
  return interpolateAtOffset(pts, offset, { extrapolate: true });
}

function sdsClusterCtx(sdsRow: SdsRow | undefined, simRow: Record<string, unknown>): SdsRoiClusterContext {
  return {
    sds: sdsRow?.sds ?? parseNum(simRow.SDS ?? simRow.sds),
    days_to_cd: sdsRow?.days_to_cd ?? parseNum(simRow["Days to CD"] ?? simRow.days_to_cd),
    cluster_scores: sdsRow?.cluster_scores,
    cluster_a: sdsRow?.cluster_a,
    cluster_b: sdsRow?.cluster_b,
    cluster_c: sdsRow?.cluster_c,
    cluster_d: sdsRow?.cluster_d,
  };
}

function sdsPredAtOffset(
  roi: SdsCurveRoiBlend | null | undefined,
  backtestPred: Partial<Record<SdsRoiHorizonKey, number | null>> | undefined,
  forecastPred: Partial<Record<SdsRoiHorizonKey, number | null>> | undefined,
  offset: number,
): number | null {
  const corr = roi?.sds_correlation_estimate?.horizons;
  if (corr) {
    const fromCorr = predFromHorizonMap(
      Object.fromEntries(
        (Object.keys(HORIZON_OFFSET) as SdsRoiHorizonKey[]).map((k) => [
          k,
          parseNum(corr[k]?.pct_vs_m60),
        ]),
      ) as Partial<Record<SdsRoiHorizonKey, number | null>>,
      offset,
    );
    if (fromCorr != null) return fromCorr;
  }

  const fromBacktest = predFromHorizonMap(backtestPred, offset);
  if (fromBacktest != null) return fromBacktest;

  const fromForecast = predFromHorizonMap(forecastPred, offset);
  if (fromForecast != null) return fromForecast;

  const fromRoi = predFromHorizonMap(
    Object.fromEntries(
      (Object.keys(HORIZON_OFFSET) as SdsRoiHorizonKey[]).map((k) => [
        k,
        parseNum(roi?.horizons?.[k]?.pct_vs_m60),
      ]),
    ) as Partial<Record<SdsRoiHorizonKey, number | null>>,
    offset,
  );
  return fromRoi;
}

function simRowTicker(row: Record<string, unknown>): string {
  return String(row.Ticker ?? row.ticker ?? "")
    .trim()
    .toUpperCase();
}

function simRowCompletionDate(row: Record<string, unknown>): string | null {
  const cd = normalizeCompletionDateForKey(row["Completion Date"] ?? row.CD ?? row.completion_date);
  return cd && cd !== "—" && /^\d{4}-\d{2}-\d{2}$/.test(cd) ? cd : null;
}

function resolveActualRoi(
  key: string,
  ticker: string,
  completionDate: string,
  backtest: SdsRoiBacktestScoresDoc | null | undefined,
  forecast: SdsRoiForecastLogDoc | null | undefined,
): number | null {
  const bt = backtest?.sample_rows?.find(
    (r) =>
      (r.key ?? `${String(r.ticker ?? "").trim().toUpperCase()}|${r.completion_date}`) === key ||
      (String(r.ticker ?? "").trim().toUpperCase() === ticker &&
        String(r.completion_date ?? "").slice(0, 10) === completionDate),
  );
  const actBt = parseNum(bt?.actual?.[REFERENCE_HORIZON] ?? bt?.actual?.post_4);
  if (actBt != null) return actBt;

  const ev = forecast?.events?.[key] ?? Object.values(forecast?.events ?? {}).find(
    (e) =>
      String(e.ticker ?? "").trim().toUpperCase() === ticker &&
      String(e.completion_date ?? "").slice(0, 10) === completionDate,
  );
  if (!ev?.scored_at) return null;
  return parseNum(ev.actual?.[REFERENCE_HORIZON] ?? ev.actual?.post_4);
}

function latestForecastSnap(ev: SdsRoiForecastEvent | undefined) {
  const snaps = ev?.snapshots ?? [];
  return snaps.length ? snaps[snaps.length - 1] : undefined;
}

export function buildRoiTemporalConvergenceView(
  forecast: SdsRoiForecastLogDoc | null | undefined,
  sdsSnap: SdsSnapshotDoc | null | undefined,
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
  backtest: SdsRoiBacktestScoresDoc | null | undefined,
  clientCtx?: SdsRoiBlendEvalClientCtx | null,
): RoiTemporalConvergenceView {
  const simKeys = buildSimulationEventKeys(simSnap);
  const nSimCohort = simKeys.size;

  const sdsByTicker = new Map<string, SdsRow>();
  for (const row of clientCtx?.sdsRows ?? []) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    if (tk) sdsByTicker.set(tk, row);
  }
  for (const row of sdsSnap?.rows ?? []) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    if (tk && !sdsByTicker.has(tk)) sdsByTicker.set(tk, row as unknown as SdsRow);
  }

  const snapRowByKey = new Map<string, NonNullable<SdsSnapshotDoc["rows"]>[number]>();
  for (const row of sdsSnap?.rows ?? []) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    const cd = resolveSdsRowCompletionDate(row, simSnap);
    if (tk && cd && simKeys.has(`${tk}|${cd}`)) snapRowByKey.set(`${tk}|${cd}`, row);
  }

  const backtestByKey = new Map<string, NonNullable<SdsRoiBacktestScoresDoc["sample_rows"]>[number]>();
  for (const row of backtest?.sample_rows ?? []) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    const cd = String(row.completion_date ?? "").slice(0, 10);
    if (tk && cd) backtestByKey.set(row.key ?? `${tk}|${cd}`, row);
  }

  const forecastByKey = new Map<string, SdsRoiForecastEvent>();
  for (const [k, ev] of Object.entries(forecast?.events ?? {})) {
    forecastByKey.set(k, ev);
    const tk = String(ev.ticker ?? "").trim().toUpperCase();
    const cd = String(ev.completion_date ?? "").slice(0, 10);
    if (tk && cd) forecastByKey.set(`${tk}|${cd}`, ev);
  }

  const pointsBySeries = clientCtx?.chartBundle
    ? chartPointsMapFromBundle(clientCtx.chartBundle)
    : new Map<string, ChartPoint[]>();

  const errsByOffset = new Map<
    number,
    { sds: number[]; pred: number[]; blend: number[]; actualKeys: Set<string> }
  >();
  for (const off of ROI_CONVERGENCE_OFFSETS) {
    errsByOffset.set(off, { sds: [], pred: [], blend: [], actualKeys: new Set() });
  }

  let nWithActual = 0;

  for (const key of simKeys) {
    const [ticker, completionDate] = key.split("|");
    if (!ticker || !completionDate) continue;

    const actual = resolveActualRoi(key, ticker, completionDate, backtest, forecast);
    if (actual == null) continue;
    nWithActual += 1;

    const simRow =
      simSnap?.rows?.find(
        (r) => simRowTicker(r) === ticker && simRowCompletionDate(r) === completionDate,
      ) ?? null;

    const snapRow = snapRowByKey.get(key);
    const btRow = backtestByKey.get(key);
    const fcEv = forecastByKey.get(key);
    const fcSnap = latestForecastSnap(fcEv);
    const roi = (snapRow?.curve_roi ?? null) as SdsCurveRoiBlend | null;

    const sk = simRow ? simulationRowSeriesKey(simRow) : null;
    const chartPts = sk ? pointsBySeries.get(sk) ?? null : null;
    const sdsRow = sdsByTicker.get(ticker);
    const ctx = sdsRow && simRow ? sdsClusterCtx(sdsRow, simRow) : undefined;

    let recalibGrid: (number | null)[] | null = null;
    let blendGrid: (number | null)[] | null = null;
    if (chartPts?.length && simRow && clientCtx?.refCurves && Object.keys(clientCtx.refCurves).length) {
      recalibGrid = recalibCurveVsM60(chartPts, simRow);
      blendGrid = blendCurveFromSimChart(chartPts, simRow, clientCtx.refCurves, ctx ?? {});
    }

    for (const off of ROI_CONVERGENCE_OFFSETS) {
      const bucket = errsByOffset.get(off)!;

      const sdsPred = sdsPredAtOffset(roi, btRow?.predicted, fcSnap?.predicted, off);
      if (sdsPred != null) bucket.sds.push(Math.abs(sdsPred - actual));

      let predVal = predFromCalendarGrid(recalibGrid, off);
      if (predVal == null && simRow) predVal = simulationRowPredAtOffset(simRow, off);
      if (predVal != null) bucket.pred.push(Math.abs(predVal - actual));

      let blendVal = predFromCalendarGrid(blendGrid, off);
      if (blendVal == null && roi) {
        blendVal = predFromHorizonMap(
          Object.fromEntries(
            (Object.keys(HORIZON_OFFSET) as SdsRoiHorizonKey[]).map((k) => [
              k,
              parseNum(
                roi.horizons_curve?.[k]?.pct_vs_m60 ?? roi.horizons?.[k]?.pct_vs_m60,
              ),
            ]),
          ) as Partial<Record<SdsRoiHorizonKey, number | null>>,
          off,
        );
      }
      if (blendVal == null && chartPts?.length && simRow && clientCtx?.refCurves) {
        const blend = curveRoiFromSimChart(simRow, chartPts, clientCtx.refCurves, ctx ?? {});
        blendVal = predFromHorizonMap(
          Object.fromEntries(
            (Object.keys(HORIZON_OFFSET) as SdsRoiHorizonKey[]).map((k) => [
              k,
              parseNum(
                blend?.horizons_curve?.[k]?.pct_vs_m60 ?? blend?.horizons?.[k]?.pct_vs_m60,
              ),
            ]),
          ) as Partial<Record<SdsRoiHorizonKey, number | null>>,
          off,
        );
      }
      if (blendVal != null) bucket.blend.push(Math.abs(blendVal - actual));

      bucket.actualKeys.add(key);
    }
  }

  const points: RoiTemporalConvergencePoint[] = ROI_CONVERGENCE_OFFSETS.map((offset) => {
    const bucket = errsByOffset.get(offset)!;
    return {
      offset,
      label: supernovaOffsetLabel(offset),
      sds: meanSdAbs(bucket.sds),
      pred: meanSdAbs(bucket.pred),
      blend: meanSdAbs(bucket.blend),
      nActual: bucket.actualKeys.size,
    };
  });

  const hasCurve = points.some(
    (p) => p.sds.n > 0 || p.pred.n > 0 || p.blend.n > 0,
  );

  return { points, nSimCohort, nWithActual, hasCurve };
}

export type SdsPredictionNode = {
  label: string;
  offset: number;
  predicted: number | null;
  actual: number | null;
};

export type SdsPredictionSignal = {
  id: string;
  ticker: string;
  sdsScore: number;
  cdDate: string;
  nodes: SdsPredictionNode[];
};

export const SDS_PREDICTION_OFFSETS = ROI_CONVERGENCE_OFFSETS;

function actualRoiAtOffset(chartPts: ChartPoint[], offset: number): number | null {
  const pts = chartPts.map((p) => ({ offset: p.offset, y: p.pct_reale }));
  return interpolateAtOffset(pts, offset, { extrapolate: false });
}

/** Per-signal SDS predicted vs actual ROI at calendar T-nodes (reuses cohort SDS paths). */
export function buildSdsPredictionSignals(
  forecast: SdsRoiForecastLogDoc | null | undefined,
  sdsSnap: SdsSnapshotDoc | null | undefined,
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
  backtest: SdsRoiBacktestScoresDoc | null | undefined,
  clientCtx?: SdsRoiBlendEvalClientCtx | null,
): SdsPredictionSignal[] {
  const simKeys = buildSimulationEventKeys(simSnap);
  const sdsByTicker = new Map<string, SdsRow>();
  for (const row of clientCtx?.sdsRows ?? []) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    if (tk) sdsByTicker.set(tk, row);
  }
  for (const row of sdsSnap?.rows ?? []) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    if (tk && !sdsByTicker.has(tk)) sdsByTicker.set(tk, row as unknown as SdsRow);
  }

  const snapRowByKey = new Map<string, NonNullable<SdsSnapshotDoc["rows"]>[number]>();
  for (const row of sdsSnap?.rows ?? []) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    const cd = resolveSdsRowCompletionDate(row, simSnap);
    if (tk && cd && simKeys.has(`${tk}|${cd}`)) snapRowByKey.set(`${tk}|${cd}`, row);
  }

  const backtestByKey = new Map<string, NonNullable<SdsRoiBacktestScoresDoc["sample_rows"]>[number]>();
  for (const row of backtest?.sample_rows ?? []) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    const cd = String(row.completion_date ?? "").slice(0, 10);
    if (tk && cd) backtestByKey.set(row.key ?? `${tk}|${cd}`, row);
  }

  const forecastByKey = new Map<string, SdsRoiForecastEvent>();
  for (const [k, ev] of Object.entries(forecast?.events ?? {})) {
    forecastByKey.set(k, ev);
    const tk = String(ev.ticker ?? "").trim().toUpperCase();
    const cd = String(ev.completion_date ?? "").slice(0, 10);
    if (tk && cd) forecastByKey.set(`${tk}|${cd}`, ev);
  }

  const pointsBySeries = clientCtx?.chartBundle
    ? chartPointsMapFromBundle(clientCtx.chartBundle)
    : new Map<string, ChartPoint[]>();

  const out: SdsPredictionSignal[] = [];

  for (const key of simKeys) {
    const [ticker, completionDate] = key.split("|");
    if (!ticker || !completionDate) continue;

    const simRow =
      simSnap?.rows?.find(
        (r) => simRowTicker(r) === ticker && simRowCompletionDate(r) === completionDate,
      ) ?? null;

    const snapRow = snapRowByKey.get(key);
    const btRow = backtestByKey.get(key);
    const fcEv = forecastByKey.get(key);
    const fcSnap = latestForecastSnap(fcEv);
    const roi = (snapRow?.curve_roi ?? null) as SdsCurveRoiBlend | null;
    const sk = simRow ? simulationRowSeriesKey(simRow) : null;
    const chartPts = sk ? pointsBySeries.get(sk) ?? null : null;
    const sdsRow = sdsByTicker.get(ticker);
    const sdsScore = parseNum(sdsRow?.sds ?? simRow?.SDS ?? simRow?.sds) ?? 0;
    const nowOff = completionDateToNowOffset(completionDate);

    const nodes: SdsPredictionNode[] = SDS_PREDICTION_OFFSETS.map((offset) => {
      const predicted = sdsPredAtOffset(roi, btRow?.predicted, fcSnap?.predicted, offset);
      const actual =
        nowOff != null && nowOff >= offset && chartPts?.length
          ? actualRoiAtOffset(chartPts, offset)
          : null;
      return {
        label: supernovaOffsetLabel(offset),
        offset,
        predicted: predicted != null ? round1(predicted) : null,
        actual: actual != null ? round1(actual) : null,
      };
    });

    if (!nodes.some((n) => n.predicted != null)) continue;

    out.push({
      id: key,
      ticker,
      sdsScore,
      cdDate: completionDate,
      nodes,
    });
  }

  return out.sort((a, b) => a.cdDate.localeCompare(b.cdDate) || a.ticker.localeCompare(b.ticker));
}
