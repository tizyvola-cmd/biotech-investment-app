import {
  fetchMobileDashboardSnapshot,
  fetchSdsByTicker,
  fetchSdsRowByTicker,
  fetchSimHistory,
  fetchSimulationChartsBundle,
  type SdsCohortRow,
} from "./api";
import { estimateMigForRow } from "./mobileMiiEstimate";
import type { MobileCurveChartsPayload } from "./dashboardTypes";
import {
  enrichPolygonFromContext,
  inferSlopesFromPredGrid,
  mergePolygonWithSnapshot,
  polygonQualityScore,
} from "./mobilePolygonUtils";
import {
  extractRecalibCurvePoints,
  resolveTodayOffset,
} from "./mobileRecalibCurve";
import {
  buildSimRowByKeyMap,
  computeSimulationPosition,
  holdingDayFractionFromInvestedAt,
  normalizedRowKey,
  parseNum,
  parseRaScoreFromRow,
  resolveInvestedAt,
} from "./simLogic";
import type { InvestSimHistoryPoint } from "./types";
import {
  buildMobileGainPlanSeries,
  gainPlanSeriesQuality,
} from "./mobileGainPlanSeries";
import { buildMobileSlopeTrajectory } from "./mobileSlopeTrajectory";
import {
  buildMobilePredBlend,
  predBlendQuality,
  refCurvesFromChartBundle,
} from "./mobilePredBlendSeries";
import type { ChartBundle, ChartPoint, InvestSimInputs, SheetTable } from "./types";

const DEFAULT_CAPITAL_EUR = 5000;

const CD_WINDOWS = [
  { id: "w1", start: -60, end: -30, label: "T−60 → T−30", arc: "Watch · preparazione", raMin: 40, sdsMin: 45, miiMin: 0, calibMin: 40, slopeMin: 0 },
  { id: "w2", start: -30, end: -10, label: "T−30 → T−10", arc: "Watch · ingresso", raMin: 50, sdsMin: 50, miiMin: 0.5, calibMin: 45, slopeMin: 0 },
  { id: "w3", start: -10, end: -3, label: "T−10 → T−3", arc: "Hot · pre-CD", raMin: 55, sdsMin: 55, miiMin: 1, calibMin: 50, slopeMin: 0.05 },
  { id: "w4", start: -3, end: 0, label: "T−3 → T0", arc: "Hot · CD imminente", raMin: 60, sdsMin: 60, miiMin: 1.5, calibMin: 55, slopeMin: 0.1 },
  { id: "w5", start: 0, end: 4, label: "T0 → T+4", arc: "Post-CD", raMin: 65, sdsMin: 65, miiMin: 2, calibMin: 60, slopeMin: 0.15 },
] as const;

function seriesKey(row: Record<string, unknown>): string | null {
  const tk = String(row.Ticker ?? "").trim().toUpperCase();
  const cd = String(row["Completion Date"] ?? "").trim();
  if (!tk || !cd || cd === "—") return null;
  const key = normalizedRowKey(tk, cd);
  const [, iso] = key.split("|");
  return iso && iso !== "—" ? `co:${tk}|${iso}` : null;
}

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

function chartPointsForRow(bundle: ChartBundle | null, row: Record<string, unknown>): ChartPoint[] | null {
  const sk = seriesKey(row);
  if (!sk || !bundle?.series?.[sk]?.points?.length) return null;
  return bundle.series[sk].points ?? null;
}

function resolveWindow(nowOff: number | null, daysToCd: number | null) {
  let off = nowOff;
  if (off == null && daysToCd != null && daysToCd > 0) off = -daysToCd;
  if (off == null) return CD_WINDOWS[0];
  for (const w of CD_WINDOWS) {
    if (w.id === "w5") {
      if (off >= w.start && off <= w.end) return w;
      continue;
    }
    if (off >= w.start && off < w.end) return w;
  }
  if (off < CD_WINDOWS[0].start) return CD_WINDOWS[0];
  return CD_WINDOWS[CD_WINDOWS.length - 1];
}

function axisPct(value: number | null, min: number): number {
  if (value == null || !Number.isFinite(value)) return 0;
  if (min <= 0) return value >= 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.round((value / min) * 100)));
}

function buildPolygon(
  row: Record<string, unknown>,
  nowOff: number | null,
  daysToCd: number | null,
  sdsScore?: number | null,
  mig?: ReturnType<typeof estimateMigForRow>,
): MobileCurveChartsPayload["polygon"] {
  const w = resolveWindow(nowOff, daysToCd);
  const inferred = inferSlopesFromPredGrid(row);
  const ra = parseRaScoreFromRow(row);
  const sds = sdsScore ?? parseNum(findCol(row, "sds score", "sds tot", "supernova distance", "distance score")) ?? parseNum(findCol(row, "sds"));
  const mii =
    mig?.miiDeg ??
    parseNum(findCol(row, "mii angle", "angolo mii", "market interest", "mii")) ??
    parseNum(findCol(row, "slope angle", "inclinometro"));
  const calib =
    mig?.calibPreScore ??
    parseNum(findCol(row, "calib pre", "calibrazione pre", "solidità calib")) ??
    parseNum(findCol(row, "calibrazione", "calib"));
  const slope20 =
    parseNum(findCol(row, "slope≈20", "slope_20", "slope20", "pendenza 20")) ?? inferred.slope20d;

  const labels = ["RA score", "SDS", "MII °", "Calib pre", "Slope 20g"];
  const rawVals = [ra, sds, mii, calib, slope20];
  const mins = [w.raMin, w.sdsMin, w.miiMin, w.calibMin, w.slopeMin];
  const units = ["/100", "/100", "°", "/100", " pp/g"];
  const radarCurrent = rawVals.map((v, i) => axisPct(v, mins[i]));
  const radarTarget = [100, 100, 100, 100, 100];
  const filledPcts = radarCurrent.filter((_, i) => rawVals[i] != null);
  const matchPct = filledPcts.length
    ? Math.round(filledPcts.reduce((s, v) => s + v, 0) / filledPcts.length)
    : 0;
  const verdict =
    matchPct >= 85 ? "Strong" : matchPct >= 65 ? "Watch" : matchPct >= 45 ? "Weak" : "Blocked";

  return {
    matchPct,
    verdictLabel: verdict,
    arcPositionLabel: `${w.label} · ${w.arc}`,
    segmentLabel: w.label,
    labels,
    radarCurrent,
    radarTarget,
    axes: labels.map((label, i) => ({
      label,
      currentText:
        rawVals[i] != null
          ? `${rawVals[i]!.toFixed(i === 2 || i === 4 ? 2 : 0)}${units[i].replace(" pp/g", "")}`
          : "—",
      targetText: `${mins[i]}${units[i].replace("/100", "/100")}`,
    })),
  };
}

function sdsForTicker(row: Record<string, unknown>, sdsMap: Map<string, number>): number | null {
  const tk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
  if (!tk) return null;
  return sdsMap.get(tk) ?? null;
}

function sdsRowForTicker(
  row: Record<string, unknown>,
  sdsRows: Map<string, SdsCohortRow>,
): SdsCohortRow | null {
  const tk = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
  if (!tk) return null;
  return sdsRows.get(tk) ?? null;
}

function buildMarketModelFromRow(
  row: Record<string, unknown>,
  sdsRow: SdsCohortRow | null,
  chartPts: ChartPoint[],
): MobileCurveChartsPayload["marketModel"] {
  const mig = estimateMigForRow(row, sdsRow, chartPts);
  if (mig) {
    const gapPct =
      mig.modelDeg != null
        ? Math.round(
            (Math.abs(mig.miiDeg - mig.modelDeg) /
              Math.max(Math.abs(mig.miiDeg), Math.abs(mig.modelDeg), 3)) *
              10000,
          ) / 100
        : null;
    return {
      miiDeg: mig.miiDeg,
      modelDeg: mig.modelDeg ?? 0,
      preModelDeg: mig.modelDeg,
      gapPct,
    };
  }
  return buildMarketModel(row);
}

function finalizePolygon(
  polygon: MobileCurveChartsPayload["polygon"],
  ctx: {
    row?: Record<string, unknown> | null;
    marketModel?: MobileCurveChartsPayload["marketModel"] | null;
    slope20d?: number | null;
    sdsScore?: number | null;
    mig?: ReturnType<typeof estimateMigForRow>;
  },
): MobileCurveChartsPayload["polygon"] {
  if (!polygon) return null;
  return enrichPolygonFromContext(polygon, ctx);
}

function polygonQuality(p: MobileCurveChartsPayload["polygon"], source: "snapshot" | "local" = "local"): number {
  return polygonQualityScore(p, source);
}

async function resolvePolygonForRow(opts: {
  key: string;
  row: Record<string, unknown>;
  nowOff: number | null;
  daysToCd: number | null;
  snapshotCharts?: MobileCurveChartsPayload | null;
  marketModel?: MobileCurveChartsPayload["marketModel"] | null;
  slope20d?: number | null;
  sdsMap?: Map<string, number>;
  sdsRows?: Map<string, SdsCohortRow>;
  chartPts?: ChartPoint[];
}): Promise<MobileCurveChartsPayload["polygon"]> {
  type Tagged = { poly: NonNullable<MobileCurveChartsPayload["polygon"]>; source: "snapshot" | "local" };
  const candidates: Tagged[] = [];
  const sdsMap = opts.sdsMap ?? (await fetchSdsByTicker());
  const sdsRows = opts.sdsRows ?? (await fetchSdsRowByTicker());
  const chartPts = opts.chartPts ?? [];
  const sdsRow = sdsRowForTicker(opts.row, sdsRows);
  const mig = estimateMigForRow(opts.row, sdsRow, chartPts);
  const marketModel =
    opts.marketModel ?? buildMarketModelFromRow(opts.row, sdsRow, chartPts);
  const ctx = {
    row: opts.row,
    marketModel,
    slope20d: opts.slope20d,
    sdsScore: sdsForTicker(opts.row, sdsMap),
    mig,
  };
  const fromProp = opts.snapshotCharts?.polygon;
  if (fromProp?.radarCurrent?.length) candidates.push({ poly: fromProp, source: "snapshot" });

  try {
    const snap = await fetchMobileDashboardSnapshot();
    const fromSnap = snap.recommendations?.find((r) => r.key === opts.key)?.curveCharts?.polygon;
    if (fromSnap?.radarCurrent?.length) candidates.push({ poly: fromSnap, source: "snapshot" });
  } catch {
    /* snapshot best-effort */
  }

  const local = buildPolygon(opts.row, opts.nowOff, opts.daysToCd, ctx.sdsScore ?? undefined, mig);
  if (local?.radarCurrent?.length) candidates.push({ poly: local, source: "local" });

  if (!candidates.length) {
    return finalizePolygon(local, ctx);
  }
  const snapshotCandidates = candidates.filter((c) => c.source === "snapshot");
  const bestSnapshot = snapshotCandidates.length
    ? snapshotCandidates.reduce((a, b) =>
        polygonQuality(b.poly, b.source) > polygonQuality(a.poly, a.source) ? b : a,
      ).poly
    : null;

  const best = candidates.reduce((a, b) =>
    polygonQuality(b.poly, b.source) > polygonQuality(a.poly, a.source) ? b : a,
  );
  const merged = bestSnapshot ? mergePolygonWithSnapshot(best.poly, bestSnapshot) : best.poly;
  return finalizePolygon(merged, ctx);
}

function buildSlopeFromChart(
  chartPts: ChartPoint[],
  nowOff: number | null,
  fallbackSheet: Array<{ offset: number; val: number }>,
  simRow: Record<string, unknown> | null = null,
): MobileCurveChartsPayload["slopeTrajectory"] {
  return buildMobileSlopeTrajectory({
    chartPts,
    simRow,
    nowOff,
    fallbackSheet,
  });
}

/** Dedicated market-vs-slope trajectory (green MII path vs dashed model). */
export function marketSlopeChartVisible(
  slopeTrajectory: MobileCurveChartsPayload["slopeTrajectory"],
  marketModel: MobileCurveChartsPayload["marketModel"],
): boolean {
  if (!slopeTrajectory || slopeTrajectory.length < 2) return false;
  if (slopeTrajectory.some((p) => p.actual != null && Number.isFinite(p.actual))) return true;
  if (marketModel?.miiDeg != null) return true;
  return slopeTrajectory.some((p) => p.pred != null && Number.isFinite(p.pred));
}

/** Slope tab duplicates Model when there is no actual path and pred === model at shared offsets. */
export function slopeChartIsRedundant(
  predBlend: MobileCurveChartsPayload["predBlend"],
  slopeTrajectory: MobileCurveChartsPayload["slopeTrajectory"],
): boolean {
  if (!predBlend?.length || !slopeTrajectory?.length) return false;
  if (slopeTrajectory.some((p) => p.actual != null && Number.isFinite(p.actual))) return false;

  const modelByOff = new Map(predBlend.map((p) => [p.offset, p.model]));
  let compared = 0;
  let matched = 0;
  for (const sp of slopeTrajectory) {
    if (sp.pred == null || !Number.isFinite(sp.pred)) continue;
    const model = modelByOff.get(sp.offset);
    if (model == null || !Number.isFinite(model)) continue;
    compared++;
    if (Math.abs(sp.pred - model) < 0.05) matched++;
  }
  return compared >= 2 && matched === compared;
}

function buildGainPlan(
  row: Record<string, unknown>,
  chartPts: ChartPoint[],
  inputs: InvestSimInputs,
  planReturnPct: number | null,
  daysToCd: number | null,
  hasPosition: boolean,
  history: InvestSimHistoryPoint[],
): MobileCurveChartsPayload["gainPlan"] {
  const ticker = String(row.Ticker ?? "").trim().toUpperCase();
  const cd = String(row["Completion Date"] ?? "—");
  const key = normalizedRowKey(ticker, cd);
  const pos = hasPosition ? computeSimulationPosition(row, inputs) : null;
  const capital = pos?.capital && pos.capital > 0 ? pos.capital : DEFAULT_CAPITAL_EUR;
  const daysToTarget =
    parseNum(findCol(row, "days to target", "giorni target")) ?? daysToCd;
  const investedAt = hasPosition ? resolveInvestedAt(key, inputs[key], history) : null;
  const holdDaysElapsed =
    hasPosition && investedAt
      ? holdingDayFractionFromInvestedAt(investedAt) ?? 0
      : 0;
  const series = buildMobileGainPlanSeries({
    row,
    chartPoints: chartPts,
    capital,
    hasPosition,
    planReturnPct,
    daysToCd,
    daysToTarget,
    livePnlEur: pos && !pos.pnlUnavailable ? pos.pnlEur : null,
    holdDaysElapsed,
    investedAt,
    rowKey: key,
    history: hasPosition ? history : [],
  });
  return series.length >= 2 ? series : null;
}

function miiModelGapPctLocal(miiAngleDeg: number, modelAngleDeg: number | null | undefined): number | null {
  if (modelAngleDeg == null || !Number.isFinite(modelAngleDeg)) return null;
  const gap = Math.abs(miiAngleDeg - modelAngleDeg);
  const den = Math.max(Math.abs(miiAngleDeg), Math.abs(modelAngleDeg), 3);
  return Math.round((gap / den) * 10000) / 100;
}

function buildMarketModel(row: Record<string, unknown>): MobileCurveChartsPayload["marketModel"] {
  const mii =
    parseNum(findCol(row, "mii", "angolo mii", "market interest", "mii angle")) ??
    parseNum(findCol(row, "slope angle", "inclinometro"));
  const preModel =
    parseNum(findCol(row, "model pre", "modello pre", "pre calib", "calib pre")) ??
    parseNum(findCol(row, "pendenza modello pre"));
  const postModel =
    parseNum(findCol(row, "model post", "modello post", "post calib", "calib post")) ??
    parseNum(findCol(row, "pendenza modello post"));
  const model =
    postModel ??
    preModel ??
    parseNum(findCol(row, "model slope", "pendenza modello", "modello pendenza", "slope model")) ??
    parseNum(findCol(row, "model angle"));
  if (mii == null && model == null && preModel == null && postModel == null) return null;
  const miiVal = mii ?? 0;
  const gapPct =
    mii != null
      ? miiModelGapPctLocal(miiVal, preModel) ??
        miiModelGapPctLocal(miiVal, postModel) ??
        miiModelGapPctLocal(miiVal, model)
      : null;
  return {
    miiDeg: mii,
    modelDeg: model ?? preModel ?? postModel ?? 0,
    preModelDeg: preModel,
    postModelDeg: postModel,
    gapPct,
  };
}

export function hasCurveChartContent(charts: MobileCurveChartsPayload | null | undefined): boolean {
  if (!charts) return false;
  const hasPolygon =
    Boolean(charts.polygon?.labels?.length) &&
    Boolean(charts.polygon?.radarCurrent?.length);
  return Boolean(
    hasPolygon ||
      charts.predBlend?.length ||
      charts.slopeTrajectory?.length ||
      charts.gainPlan?.length ||
      (charts.marketModel &&
        (charts.marketModel.miiDeg != null || charts.marketModel.modelDeg != null)),
  );
}

export function normalizeCurveChartsPayload(
  charts: MobileCurveChartsPayload | null | undefined,
): MobileCurveChartsPayload | null {
  if (!charts) return null;
  const polygon = charts.polygon;
  const normalizedPolygon =
    polygon && polygon.labels?.length && polygon.radarCurrent?.length
      ? {
          ...polygon,
          labels: polygon.labels ?? [],
          radarCurrent: polygon.radarCurrent ?? [],
          radarTarget: polygon.radarTarget ?? polygon.radarCurrent.map(() => 100),
          axes: polygon.axes ?? [],
        }
      : null;
  return {
    ...charts,
    polygon: normalizedPolygon,
    predBlend: charts.predBlend?.length ? charts.predBlend : null,
    slopeTrajectory: charts.slopeTrajectory?.length ? charts.slopeTrajectory : null,
    gainPlan: charts.gainPlan?.length ? charts.gainPlan : null,
    marketModel:
      charts.marketModel &&
      (charts.marketModel.miiDeg != null || charts.marketModel.modelDeg != null)
        ? charts.marketModel
        : null,
  };
}

export async function resolveCurveChartsForRow(opts: {
  key: string;
  row: Record<string, unknown> | null;
  snapshotCharts?: MobileCurveChartsPayload | null;
  inputs: InvestSimInputs;
  daysToCd: number | null;
  planReturnPct: number | null;
  hasPosition: boolean;
  completionDate?: string | null;
}): Promise<MobileCurveChartsPayload | null> {
  const nowOff = opts.row
    ? resolveTodayOffset({
        completionDate: opts.completionDate,
        daysToCd: opts.daysToCd,
      })
    : null;

  if (opts.snapshotCharts && hasCurveChartContent(opts.snapshotCharts) && opts.row) {
    const bundle = await fetchSimulationChartsBundle();
    const chartPts = chartPointsForRow(bundle, opts.row) ?? [];
    const sdsRows = await fetchSdsRowByTicker();
    const sdsRow = sdsRowForTicker(opts.row, sdsRows);
    const history = await fetchSimHistory();
    const { refs: refCurves } = refCurvesFromChartBundle(bundle);
    const marketModel =
      opts.snapshotCharts.marketModel ?? buildMarketModelFromRow(opts.row, sdsRow, chartPts);
    const slope20d =
      opts.snapshotCharts.slope20d ??
      parseNum(findCol(opts.row, "slope≈20", "slope_20", "slope20")) ??
      inferSlopesFromPredGrid(opts.row).slope20d;
    const polygon = await resolvePolygonForRow({
      key: opts.key,
      row: opts.row,
      nowOff,
      daysToCd: opts.daysToCd,
      snapshotCharts: opts.snapshotCharts,
      marketModel,
      slope20d,
      chartPts,
      sdsRows,
    });
    const localGain = buildGainPlan(
      opts.row,
      chartPts,
      opts.inputs,
      opts.planReturnPct,
      opts.daysToCd,
      opts.hasPosition,
      history,
    );
    const snapGain = opts.snapshotCharts.gainPlan;
    const gainPlan =
      localGain && gainPlanSeriesQuality(localGain, opts.hasPosition) >
        gainPlanSeriesQuality(snapGain, opts.hasPosition)
        ? localGain
        : snapGain ?? localGain;
    const localPred = buildMobilePredBlend({
      row: opts.row,
      chartPts,
      nowOff,
      daysToCd: opts.daysToCd,
      sdsRow,
      refCurves,
    });
    const predBlend =
      predBlendQuality(localPred.predBlend) >= predBlendQuality(opts.snapshotCharts.predBlend)
        ? localPred.predBlend
        : opts.snapshotCharts.predBlend ?? localPred.predBlend;
    const predCaption =
      predBlendQuality(localPred.predBlend) >= predBlendQuality(opts.snapshotCharts.predBlend)
        ? localPred.predCaption
        : opts.snapshotCharts.predCaption ?? localPred.predCaption;
    const fallbackSheet = extractRecalibCurvePoints(opts.row);
    const localSlope = buildSlopeFromChart(chartPts, nowOff, fallbackSheet, opts.row);
    const snapSlope = opts.snapshotCharts.slopeTrajectory;
    const slopeTrajectory =
      localSlope && (localSlope.length ?? 0) >= (snapSlope?.length ?? 0) ? localSlope : snapSlope ?? localSlope;
    return {
      ...opts.snapshotCharts,
      gainPlan,
      marketModel,
      polygon,
      predBlend,
      predCaption,
      slopeTrajectory,
      todayOffset: nowOff ?? opts.snapshotCharts.todayOffset,
    };
  }
  if (opts.snapshotCharts && hasCurveChartContent(opts.snapshotCharts)) {
    return opts.snapshotCharts;
  }
  if (!opts.row) return opts.snapshotCharts ?? null;

  const bundle = await fetchSimulationChartsBundle();
  const chartPts = chartPointsForRow(bundle, opts.row) ?? [];
  const fallbackSheet = extractRecalibCurvePoints(opts.row);
  const sdsRows = await fetchSdsRowByTicker();
  const sdsRow = sdsRowForTicker(opts.row, sdsRows);
  const history = await fetchSimHistory();
  const { refs: refCurves } = refCurvesFromChartBundle(bundle);

  const slope20 =
    parseNum(findCol(opts.row, "slope≈20", "slope_20", "slope20")) ??
    inferSlopesFromPredGrid(opts.row).slope20d;
  const marketModel = buildMarketModelFromRow(opts.row, sdsRow, chartPts);
  const { predBlend, predCaption } = buildMobilePredBlend({
    row: opts.row,
    chartPts,
    nowOff,
    daysToCd: opts.daysToCd,
    sdsRow,
    refCurves,
  });

  const built: MobileCurveChartsPayload = {
    polygon: await resolvePolygonForRow({
      key: opts.key,
      row: opts.row,
      nowOff,
      daysToCd: opts.daysToCd,
      snapshotCharts: opts.snapshotCharts,
      marketModel,
      slope20d: slope20,
      chartPts,
      sdsRows,
    }),
    predBlend,
    predCaption,
    slopeTrajectory: buildSlopeFromChart(chartPts, nowOff, fallbackSheet, opts.row),
    todayOffset: nowOff,
    slope5d: parseNum(findCol(opts.row, "slope≈5", "slope_5")),
    slope20d: slope20,
    dailyMovePct: parseNum(findCol(opts.row, "var. giorn", "daily", "24h")),
    gainPlan: buildGainPlan(
      opts.row,
      chartPts,
      opts.inputs,
      opts.planReturnPct,
      opts.daysToCd,
      opts.hasPosition,
      history,
    ),
    gainPlanHypothetical: !opts.hasPosition,
    marketModel,
  };

  if (built.polygon && opts.row) {
    built.polygon = finalizePolygon(built.polygon, {
      row: opts.row,
      marketModel: built.marketModel,
      slope20d: built.slope20d,
    });
  }

  return hasCurveChartContent(built) ? built : opts.snapshotCharts ?? built;
}

export function simRowForKey(sheet: SheetTable | null, key: string): Record<string, unknown> | null {
  if (!sheet?.rows?.length) return null;
  return buildSimRowByKeyMap(sheet.rows).get(key) ?? null;
}

export function buildChartPointsByKey(
  sheet: SheetTable | null,
  bundle: ChartBundle | null,
): Map<string, ChartPoint[]> {
  const map = new Map<string, ChartPoint[]>();
  if (!sheet?.rows?.length || !bundle?.series) return map;
  for (const row of sheet.rows) {
    const tk = String(row.Ticker ?? "").trim().toUpperCase();
    const cd = String(row["Completion Date"] ?? "").trim();
    if (!tk || !cd || cd === "—") continue;
    const key = normalizedRowKey(tk, cd);
    const pts = chartPointsForRow(bundle, row);
    if (pts?.length) map.set(key, pts);
  }
  return map;
}
