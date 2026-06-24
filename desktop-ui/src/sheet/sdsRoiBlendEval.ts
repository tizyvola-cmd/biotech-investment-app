import type { SdsRow } from "../api/supernova";
import {
  chartPointsMapFromBundle,
  simulationRowPredAtOffset,
  simulationRowSeriesKey,
} from "../data/simulationCharts";
import { normalizeCompletionDateForKey } from "./investSimKeys";
import type { ChartBundle, ChartPoint } from "../types";
import type { SdsRoiForecastEvent, SdsRoiForecastLogDoc, SdsRoiHorizonKey, SdsSnapshotDoc } from "./sdsRoiForecast";
import {
  buildSimulationEventKeys,
  buildSimulationTickerSet,
  resolveSdsRowCompletionDate,
  type SimulationSheetSnapshotDoc,
} from "./sdsRoiSimConvergence";
import {
  curveRoiFromSimChart,
  type SdsCurveRoiBlend,
  type SdsRoiClusterContext,
  type SdsRoiProfileId,
} from "./sdsRoiBlend";

export type SdsRoiBlendEvalClientCtx = {
  chartBundle: ChartBundle | null;
  refCurves: Partial<Record<SdsRoiProfileId, (number | null)[]>>;
  sdsRows?: SdsRow[] | null;
};

export type BlendVsPredHorizonSummary = {
  n?: number;
  nComparable?: number;
  maePredPp?: number | null;
  maeBlendPp?: number | null;
  blendBetterN?: number;
  blendBetterPct?: number | null;
  hitRatePred?: number | null;
  hitRateBlend?: number | null;
  hitNPred?: number;
  hitNBlend?: number;
};

export type BlendVsPredEventRow = {
  key: string;
  ticker: string;
  completionDate: string;
  horizon: SdsRoiHorizonKey;
  predictedPred: number | null;
  predictedBlend: number | null;
  actual: number | null;
  errorPredPp: number | null;
  errorBlendPp: number | null;
  blendBetter: boolean | null;
  hitPred: boolean | null;
  hitBlend: boolean | null;
  status: "scored" | "pending";
  scoredAt: string | null;
  sortTs: number;
  chartLabel: string;
};

export type BlendTimelinePoint = {
  key: string;
  ticker: string;
  completionDate: string;
  predictedPred: number | null;
  predictedBlend: number | null;
  actual: number | null;
  errorPredPp: number | null;
  errorBlendPp: number | null;
  status: "scored" | "pending";
  sortTs: number;
  chartLabel: string;
};

export type BlendMaeTrendPoint = {
  chartLabel: string;
  sortTs: number;
  maePredPp: number | null;
  maeBlendPp: number | null;
  nPred: number;
  nBlend: number;
  ticker: string;
};

export type BlendHorizonCurvePoint = {
  knot: SdsRoiHorizonKey;
  label: string;
  offset: number;
  predAvg: number | null;
  blendAvg: number | null;
  nPred: number;
  nBlend: number;
};

export type SdsRoiBlendEvalView = {
  horizon: SdsRoiHorizonKey;
  summary: BlendVsPredHorizonSummary;
  scoredRows: BlendVsPredEventRow[];
  pendingRows: BlendVsPredEventRow[];
  timeline: BlendTimelinePoint[];
  maeTrend: BlendMaeTrendPoint[];
  horizonCurve: BlendHorizonCurvePoint[];
  hasData: boolean;
  hasTimeline: boolean;
  hasMaeTrend: boolean;
  hasHorizonCurve: boolean;
};

function parseNum(v: unknown): number | null {
  if (v == null || typeof v === "boolean") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dayTs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(t) ? 0 : t;
}

function isSimulationEvent(
  ev: SdsRoiForecastEvent,
  simKeys: Set<string>,
  simTickers: Set<string>,
): boolean {
  const key = ev.key ?? "";
  if (key && simKeys.has(key)) return true;
  const tk = String(ev.ticker ?? "").trim().toUpperCase();
  const cdRaw = ev.completion_date;
  const cd = normalizeCompletionDateForKey(cdRaw);
  if (tk && cd && cd !== "—" && simKeys.has(`${tk}|${cd}`)) return true;
  return tk.length > 0 && simTickers.has(tk);
}

function latestSnap(ev: SdsRoiForecastEvent) {
  const snaps = ev.snapshots ?? [];
  return snaps.length ? snaps[snaps.length - 1] : undefined;
}

function summaryFromForecast(
  forecast: SdsRoiForecastLogDoc | null | undefined,
  horizon: SdsRoiHorizonKey,
): BlendVsPredHorizonSummary {
  const raw = forecast?.forward_summary?.blend_vs_pred?.by_horizon?.[horizon];
  if (!raw) return {};
  return {
    n: raw.n,
    nComparable: raw.n_comparable,
    maePredPp: raw.mae_pred_pp ?? null,
    maeBlendPp: raw.mae_blend_pp ?? null,
    blendBetterN: raw.blend_better_n,
    blendBetterPct: raw.blend_better_pct ?? null,
    hitRatePred: raw.hit_rate_pred ?? null,
    hitRateBlend: raw.hit_rate_blend ?? null,
    hitNPred: raw.hit_n_pred,
    hitNBlend: raw.hit_n_blend,
  };
}

function rowFromForecastEvent(
  ev: SdsRoiForecastEvent,
  horizon: SdsRoiHorizonKey,
): BlendVsPredEventRow | null {
  const ticker = String(ev.ticker ?? "").trim().toUpperCase();
  const completionDate = String(ev.completion_date ?? "").trim().slice(0, 10);
  if (!ticker || !completionDate) return null;

  const snap = latestSnap(ev);
  const predictedBlend = parseNum(snap?.predicted_blend?.[horizon] ?? snap?.predicted?.[horizon]);
  const predictedPred = parseNum(snap?.predicted_pred?.[horizon]);
  const actual = parseNum(ev.actual?.[horizon]);
  const errorBlendPp = parseNum(ev.error_pp_blend?.[horizon] ?? ev.error_pp?.[horizon]);
  const errorPredPp = parseNum(ev.error_pp_pred?.[horizon]);
  const scored = Boolean(ev.scored_at) && actual != null;
  const scoredAt = ev.scored_at ?? null;

  if (predictedBlend == null && predictedPred == null) return null;

  let blendBetter: boolean | null = null;
  if (errorPredPp != null && errorBlendPp != null) {
    blendBetter = Math.abs(errorBlendPp) < Math.abs(errorPredPp) - 0.01;
  }

  const sortTs = scored ? dayTs(scoredAt ?? completionDate) : dayTs(completionDate);

  return {
    key: ev.key ?? `${ticker}|${completionDate}`,
    ticker,
    completionDate,
    horizon,
    predictedPred,
    predictedBlend,
    actual: scored ? actual : null,
    errorPredPp: scored ? errorPredPp : null,
    errorBlendPp: scored ? errorBlendPp : null,
    blendBetter,
    hitPred: ev.hit_pred?.[horizon] ?? null,
    hitBlend: ev.hit_blend?.[horizon] ?? null,
    status: scored ? "scored" : "pending",
    scoredAt,
    sortTs,
    chartLabel: ticker,
  };
}

function rowFromSdsSnap(
  row: NonNullable<SdsSnapshotDoc["rows"]>[number],
  horizon: SdsRoiHorizonKey,
  simKeys: Set<string>,
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
): BlendVsPredEventRow | null {
  const ticker = String(row.ticker ?? "").trim().toUpperCase();
  const completionDate = resolveSdsRowCompletionDate(row, simSnap) ?? "";
  if (!ticker || !completionDate) return null;
  const key = `${ticker}|${completionDate}`;
  if (!simKeys.has(key)) return null;

  const roi = row.curve_roi;
  const predictedBlend = parseNum(roi?.horizons_curve?.[horizon]?.pct_vs_m60 ?? roi?.horizons?.[horizon]?.pct_vs_m60);
  const predictedPred = parseNum(roi?.horizons_pred?.[horizon]?.pct_vs_m60);
  if (predictedBlend == null && predictedPred == null) return null;

  return {
    key,
    ticker,
    completionDate,
    horizon,
    predictedPred,
    predictedBlend,
    actual: null,
    errorPredPp: null,
    errorBlendPp: null,
    blendBetter: null,
    hitPred: null,
    hitBlend: null,
    status: "pending",
    scoredAt: null,
    sortTs: dayTs(completionDate),
    chartLabel: ticker,
  };
}

const HORIZON_KNOTS: { key: SdsRoiHorizonKey; label: string; offset: number }[] = [
  { key: "pre_10", label: "T−10", offset: -10 },
  { key: "pre_5", label: "T−5", offset: -5 },
  { key: "post_4", label: "T+4", offset: 4 },
];

function simRowTicker(row: Record<string, unknown>): string {
  return String(row.Ticker ?? row.ticker ?? "")
    .trim()
    .toUpperCase();
}

function simRowCompletionDate(row: Record<string, unknown>): string | null {
  const cd = normalizeCompletionDateForKey(
    row["Completion Date"] ?? row.CD ?? row.completion_date,
  );
  return cd && cd !== "—" && /^\d{4}-\d{2}-\d{2}$/.test(cd) ? cd : null;
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

function clientBlendFromSimRow(
  simRow: Record<string, unknown>,
  chartPts: ChartPoint[] | null | undefined,
  refCurves: Partial<Record<SdsRoiProfileId, (number | null)[]>>,
  sdsRow: SdsRow | undefined,
): SdsCurveRoiBlend | null {
  if (!chartPts?.length) return null;
  return curveRoiFromSimChart(simRow, chartPts, refCurves, sdsClusterCtx(sdsRow, simRow));
}

function buildClientCohortHorizonCurve(
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
  simKeys: Set<string>,
  clientCtx: SdsRoiBlendEvalClientCtx | null | undefined,
): BlendHorizonCurvePoint[] {
  if (!clientCtx?.chartBundle || !Object.keys(clientCtx.refCurves).length) {
    return HORIZON_KNOTS.map(({ key, label, offset }) => ({
      knot: key,
      label,
      offset,
      predAvg: null,
      blendAvg: null,
      nPred: 0,
      nBlend: 0,
    }));
  }

  const sdsByTicker = new Map<string, SdsRow>();
  for (const row of clientCtx.sdsRows ?? []) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    if (tk) sdsByTicker.set(tk, row);
  }

  const pointsByKey = chartPointsMapFromBundle(clientCtx.chartBundle);
  const predByKnot = new Map<SdsRoiHorizonKey, number[]>();
  const blendByKnot = new Map<SdsRoiHorizonKey, number[]>();

  for (const simRow of simSnap?.rows ?? []) {
    const tk = simRowTicker(simRow);
    const cd = simRowCompletionDate(simRow);
    if (!tk || !cd || !simKeys.has(`${tk}|${cd}`)) continue;

    const sk = simulationRowSeriesKey(simRow);
    const pts = sk ? pointsByKey.get(sk) ?? null : null;
    const blend = clientBlendFromSimRow(simRow, pts, clientCtx.refCurves, sdsByTicker.get(tk));
    if (!blend) continue;

    for (const { key } of HORIZON_KNOTS) {
      const pred = parseNum(blend.horizons_pred?.[key]?.pct_vs_m60);
      const bl = parseNum(
        blend.horizons_curve?.[key]?.pct_vs_m60 ?? blend.horizons?.[key]?.pct_vs_m60,
      );
      if (pred != null) {
        const arr = predByKnot.get(key) ?? [];
        arr.push(pred);
        predByKnot.set(key, arr);
      }
      if (bl != null) {
        const arr = blendByKnot.get(key) ?? [];
        arr.push(bl);
        blendByKnot.set(key, arr);
      }
    }
  }

  const avg = (vals: number[]) =>
    vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : null;

  return HORIZON_KNOTS.map(({ key, label, offset }) => ({
    knot: key,
    label,
    offset,
    predAvg: avg(predByKnot.get(key) ?? []),
    blendAvg: avg(blendByKnot.get(key) ?? []),
    nPred: predByKnot.get(key)?.length ?? 0,
    nBlend: blendByKnot.get(key)?.length ?? 0,
  }));
}

function mergeHorizonCurvePoints(
  snapCurve: BlendHorizonCurvePoint[],
  clientCurve: BlendHorizonCurvePoint[],
): BlendHorizonCurvePoint[] {
  return HORIZON_KNOTS.map(({ key, label, offset }) => {
    const snap = snapCurve.find((p) => p.knot === key);
    const client = clientCurve.find((p) => p.knot === key);
    const predAvg =
      (snap?.nPred ?? 0) > 0 ? snap!.predAvg : client?.predAvg ?? snap?.predAvg ?? null;
    const blendAvg =
      (snap?.nBlend ?? 0) > 0 ? snap!.blendAvg : client?.blendAvg ?? snap?.blendAvg ?? null;
    return {
      knot: key,
      label,
      offset,
      predAvg,
      blendAvg,
      nPred: Math.max(snap?.nPred ?? 0, client?.nPred ?? 0),
      nBlend: Math.max(snap?.nBlend ?? 0, client?.nBlend ?? 0),
    };
  });
}

function enrichRowsFromClient(
  rows: Map<string, BlendVsPredEventRow>,
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
  simKeys: Set<string>,
  horizon: SdsRoiHorizonKey,
  clientCtx: SdsRoiBlendEvalClientCtx | null | undefined,
): void {
  if (!clientCtx?.chartBundle || !Object.keys(clientCtx.refCurves).length) return;

  const sdsByTicker = new Map<string, SdsRow>();
  for (const row of clientCtx.sdsRows ?? []) {
    const tk = String(row.ticker ?? "").trim().toUpperCase();
    if (tk) sdsByTicker.set(tk, row);
  }
  const pointsByKey = chartPointsMapFromBundle(clientCtx.chartBundle);

  for (const simRow of simSnap?.rows ?? []) {
    const tk = simRowTicker(simRow);
    const cd = simRowCompletionDate(simRow);
    if (!tk || !cd || !simKeys.has(`${tk}|${cd}`)) continue;
    const key = `${tk}|${cd}`;
    const existing = rows.get(key);
    if (existing?.status === "scored") continue;
    if (existing?.predictedPred != null && existing?.predictedBlend != null) continue;

    const sk = simulationRowSeriesKey(simRow);
    const pts = sk ? pointsByKey.get(sk) ?? null : null;
    const blend = clientBlendFromSimRow(simRow, pts, clientCtx.refCurves, sdsByTicker.get(tk));
    if (!blend) continue;

    const predictedPred = parseNum(blend.horizons_pred?.[horizon]?.pct_vs_m60);
    const predictedBlend = parseNum(
      blend.horizons_curve?.[horizon]?.pct_vs_m60 ?? blend.horizons?.[horizon]?.pct_vs_m60,
    );
    if (predictedPred == null && predictedBlend == null) continue;

    rows.set(key, {
      key,
      ticker: tk,
      completionDate: cd,
      horizon,
      predictedPred: existing?.predictedPred ?? predictedPred,
      predictedBlend: existing?.predictedBlend ?? predictedBlend,
      actual: existing?.actual ?? null,
      errorPredPp: existing?.errorPredPp ?? null,
      errorBlendPp: existing?.errorBlendPp ?? null,
      blendBetter: existing?.blendBetter ?? null,
      hitPred: existing?.hitPred ?? null,
      hitBlend: existing?.hitBlend ?? null,
      status: existing?.status ?? "pending",
      scoredAt: existing?.scoredAt ?? null,
      sortTs: existing?.sortTs ?? dayTs(cd),
      chartLabel: existing?.chartLabel ?? tk,
    });
  }
}

function enrichRowsFromSheetPred(
  rows: Map<string, BlendVsPredEventRow>,
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
  simKeys: Set<string>,
  horizon: SdsRoiHorizonKey,
): void {
  const offsetByHorizon: Record<SdsRoiHorizonKey, number> = {
    pre_10: -10,
    pre_5: -5,
    post_4: 4,
  };

  for (const simRow of simSnap?.rows ?? []) {
    const tk = simRowTicker(simRow);
    const cd = simRowCompletionDate(simRow);
    if (!tk || !cd || !simKeys.has(`${tk}|${cd}`)) continue;
    const key = `${tk}|${cd}`;
    const existing = rows.get(key);
    if (existing?.status === "scored") continue;
    if (existing?.predictedPred != null && existing?.predictedBlend != null) continue;

    const predictedPred = simulationRowPredAtOffset(simRow, offsetByHorizon[horizon]);
    if (predictedPred == null && existing?.predictedPred == null && existing?.predictedBlend == null) {
      continue;
    }

    rows.set(key, {
      key,
      ticker: tk,
      completionDate: cd,
      horizon,
      predictedPred: existing?.predictedPred ?? predictedPred,
      predictedBlend: existing?.predictedBlend ?? null,
      actual: existing?.actual ?? null,
      errorPredPp: existing?.errorPredPp ?? null,
      errorBlendPp: existing?.errorBlendPp ?? null,
      blendBetter: existing?.blendBetter ?? null,
      hitPred: existing?.hitPred ?? null,
      hitBlend: existing?.hitBlend ?? null,
      status: existing?.status ?? "pending",
      scoredAt: existing?.scoredAt ?? null,
      sortTs: existing?.sortTs ?? dayTs(cd),
      chartLabel: existing?.chartLabel ?? tk,
    });
  }
}

function buildSheetPredHorizonCurve(
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
  simKeys: Set<string>,
): BlendHorizonCurvePoint[] {
  const offsetByKnot: Record<SdsRoiHorizonKey, number> = {
    pre_10: -10,
    pre_5: -5,
    post_4: 4,
  };
  const predByKnot = new Map<SdsRoiHorizonKey, number[]>();

  for (const simRow of simSnap?.rows ?? []) {
    const tk = simRowTicker(simRow);
    const cd = simRowCompletionDate(simRow);
    if (!tk || !cd || !simKeys.has(`${tk}|${cd}`)) continue;
    for (const { key } of HORIZON_KNOTS) {
      const pred = simulationRowPredAtOffset(simRow, offsetByKnot[key]);
      if (pred != null) {
        const arr = predByKnot.get(key) ?? [];
        arr.push(pred);
        predByKnot.set(key, arr);
      }
    }
  }

  const avg = (vals: number[]) =>
    vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : null;

  return HORIZON_KNOTS.map(({ key, label, offset }) => ({
    knot: key,
    label,
    offset,
    predAvg: avg(predByKnot.get(key) ?? []),
    blendAvg: null,
    nPred: predByKnot.get(key)?.length ?? 0,
    nBlend: 0,
  }));
}

function buildCohortHorizonCurve(
  sdsSnap: SdsSnapshotDoc | null | undefined,
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
  simKeys: Set<string>,
): BlendHorizonCurvePoint[] {
  const rows = (sdsSnap?.rows ?? []).filter((row) => {
    const tk = String(row.ticker ?? "")
      .trim()
      .toUpperCase();
    const cd = resolveSdsRowCompletionDate(row, simSnap);
    return tk && cd && simKeys.has(`${tk}|${cd}`);
  });

  return HORIZON_KNOTS.map(({ key, label, offset }) => {
    const predVals: number[] = [];
    const blendVals: number[] = [];
    for (const row of rows) {
      const roi = row.curve_roi;
      const pred = parseNum(roi?.horizons_pred?.[key]?.pct_vs_m60);
      const blend = parseNum(
        roi?.horizons_curve?.[key]?.pct_vs_m60 ?? roi?.horizons?.[key]?.pct_vs_m60,
      );
      if (pred != null) predVals.push(pred);
      if (blend != null) blendVals.push(blend);
    }
    const avg = (vals: number[]) =>
      vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : null;
    return {
      knot: key,
      label,
      offset,
      predAvg: avg(predVals),
      blendAvg: avg(blendVals),
      nPred: predVals.length,
      nBlend: blendVals.length,
    };
  });
}

function buildBlendTimeline(rows: BlendVsPredEventRow[]): BlendTimelinePoint[] {
  return rows
    .filter((r) => r.predictedPred != null || r.predictedBlend != null)
    .map((r) => ({
      key: r.key,
      ticker: r.ticker,
      completionDate: r.completionDate,
      predictedPred: r.predictedPred,
      predictedBlend: r.predictedBlend,
      actual: r.actual,
      errorPredPp: r.errorPredPp,
      errorBlendPp: r.errorBlendPp,
      status: r.status,
      sortTs: r.sortTs,
      chartLabel: r.chartLabel,
    }))
    .sort((a, b) => a.sortTs - b.sortTs || a.ticker.localeCompare(b.ticker));
}

function buildBlendMaeTrend(scored: BlendVsPredEventRow[]): BlendMaeTrendPoint[] {
  const ordered = [...scored]
    .filter((r) => r.errorPredPp != null || r.errorBlendPp != null)
    .sort((a, b) => a.sortTs - b.sortTs || a.ticker.localeCompare(b.ticker));

  const out: BlendMaeTrendPoint[] = [];
  const predErrs: number[] = [];
  const blendErrs: number[] = [];

  for (const ev of ordered) {
    if (ev.errorPredPp != null) predErrs.push(Math.abs(ev.errorPredPp));
    if (ev.errorBlendPp != null) blendErrs.push(Math.abs(ev.errorBlendPp));
    out.push({
      chartLabel: ev.chartLabel,
      sortTs: ev.sortTs,
      maePredPp:
        predErrs.length > 0
          ? Math.round((predErrs.reduce((s, v) => s + v, 0) / predErrs.length) * 10) / 10
          : null,
      maeBlendPp:
        blendErrs.length > 0
          ? Math.round((blendErrs.reduce((s, v) => s + v, 0) / blendErrs.length) * 10) / 10
          : null,
      nPred: predErrs.length,
      nBlend: blendErrs.length,
      ticker: ev.ticker,
    });
  }
  return out;
}

/** Client-side MAE/hit when forward_summary blend_vs_pred is not yet in the log file. */
function computeClientSummary(rows: BlendVsPredEventRow[]): BlendVsPredHorizonSummary {
  const scored = rows.filter((r) => r.status === "scored");
  const predErrs = scored.map((r) => r.errorPredPp).filter((v): v is number => v != null).map(Math.abs);
  const blendErrs = scored.map((r) => r.errorBlendPp).filter((v): v is number => v != null).map(Math.abs);
  const comparable = scored.filter((r) => r.errorPredPp != null && r.errorBlendPp != null);
  const blendWins = comparable.filter((r) => r.blendBetter).length;
  const hitPred = scored.filter((r) => r.hitPred != null);
  const hitBlend = scored.filter((r) => r.hitBlend != null);

  return {
    n: Math.max(predErrs.length, blendErrs.length),
    nComparable: comparable.length,
    maePredPp: predErrs.length ? Math.round((predErrs.reduce((a, b) => a + b, 0) / predErrs.length) * 10) / 10 : null,
    maeBlendPp: blendErrs.length ? Math.round((blendErrs.reduce((a, b) => a + b, 0) / blendErrs.length) * 10) / 10 : null,
    blendBetterN: blendWins,
    blendBetterPct: comparable.length ? Math.round((100 * blendWins) / comparable.length * 10) / 10 : null,
    hitRatePred: hitPred.length
      ? Math.round((100 * hitPred.filter((r) => r.hitPred).length) / hitPred.length * 10) / 10
      : null,
    hitRateBlend: hitBlend.length
      ? Math.round((100 * hitBlend.filter((r) => r.hitBlend).length) / hitBlend.length * 10) / 10
      : null,
    hitNPred: hitPred.length,
    hitNBlend: hitBlend.length,
  };
}

export function countHorizonCurveKnots(curve: BlendHorizonCurvePoint[]): number {
  return curve.filter((p) => p.predAvg != null || p.blendAvg != null).length;
}

export function buildSdsRoiBlendEvalView(
  forecast: SdsRoiForecastLogDoc | null | undefined,
  sdsSnap: SdsSnapshotDoc | null | undefined,
  simSnap: SimulationSheetSnapshotDoc | null | undefined,
  horizon: SdsRoiHorizonKey = "pre_5",
  clientCtx?: SdsRoiBlendEvalClientCtx | null,
): SdsRoiBlendEvalView {
  const simKeys = buildSimulationEventKeys(simSnap);
  const simTickers = buildSimulationTickerSet(simSnap);
  const byKey = new Map<string, BlendVsPredEventRow>();

  for (const ev of Object.values(forecast?.events ?? {})) {
    if (!isSimulationEvent(ev, simKeys, simTickers)) continue;
    const row = rowFromForecastEvent(ev, horizon);
    if (row) byKey.set(row.key, row);
  }

  for (const snapRow of sdsSnap?.rows ?? []) {
    const row = rowFromSdsSnap(snapRow, horizon, simKeys, simSnap);
    if (!row) continue;
    const existing = byKey.get(row.key);
    if (!existing || existing.status === "pending") {
      byKey.set(row.key, existing?.status === "scored" ? existing : row);
    }
  }

  enrichRowsFromClient(byKey, simSnap, simKeys, horizon, clientCtx);
  enrichRowsFromSheetPred(byKey, simSnap, simKeys, horizon);

  const all = [...byKey.values()].sort(
    (a, b) => a.completionDate.localeCompare(b.completionDate) || a.ticker.localeCompare(b.ticker),
  );
  const scoredRows = all.filter((r) => r.status === "scored");
  const pendingRows = all.filter((r) => r.status === "pending");
  const timeline = buildBlendTimeline(all);
  const maeTrend = buildBlendMaeTrend(scoredRows);
  const snapHorizonCurve = buildCohortHorizonCurve(sdsSnap, simSnap, simKeys);
  const clientHorizonCurve = buildClientCohortHorizonCurve(simSnap, simKeys, clientCtx);
  const sheetHorizonCurve = buildSheetPredHorizonCurve(simSnap, simKeys);
  const horizonCurve = mergeHorizonCurvePoints(
    mergeHorizonCurvePoints(snapHorizonCurve, clientHorizonCurve),
    sheetHorizonCurve,
  );

  const fromLog = summaryFromForecast(forecast, horizon);
  const summary =
    fromLog.nComparable != null || fromLog.maeBlendPp != null
      ? fromLog
      : computeClientSummary(scoredRows);

  const curveKnots = countHorizonCurveKnots(horizonCurve);

  return {
    horizon,
    summary,
    scoredRows,
    pendingRows,
    timeline,
    maeTrend,
    horizonCurve,
    hasData:
      all.length > 0 ||
      curveKnots >= 2 ||
      (summary.maePredPp != null && summary.maeBlendPp != null),
    hasTimeline: timeline.length > 0,
    hasMaeTrend: maeTrend.length >= 2,
    hasHorizonCurve: curveKnots >= 2,
  };
}
