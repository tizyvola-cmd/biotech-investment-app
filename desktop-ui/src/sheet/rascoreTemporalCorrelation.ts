/**
 * Pearson ρ(RA metric, Δ% price) at each CD anchor — full RA + all 8 component indices.
 */
import { simulationRowSeriesKey, chartPointsMapFromBundle } from "../data/simulationCharts";
import type { ChartBundle, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { buildMigSolidityByKey } from "./entrySolidityMig";
import {
  SOLIDITY_COMPONENT_MAX,
  type SolidityCompositeComponentId,
} from "./entrySolidityComposite";
import { normalizedRowKey, reconcileInvestSimInputs } from "./investSimKeys";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { buildSdsByTicker } from "./sdsTopOppGate";
import { isSimRowCalibrationEligible } from "./top2FromSimulation";
import { computeRaCompositeAsOfAnchor } from "./rascoreAnchorSolidity";
import type { RaCalibrationSignal } from "./rascoreCalibrationCompute";
import { RA_CALIB_MIN_SAMPLE_N } from "./rascoreCalibrationCompute";
import {
  RA_CALIB_CD_OFFSETS,
  buildCdHorizonPriceChanges,
  buildPriceLongFromObservation,
  raCalibOffsetLabel,
  snapToRaCalibOffset,
} from "./rascoreCdHorizons";
import { completionDateToNowOffset } from "./chartNowOffset";
import {
  RA_INVERSE_COMPONENT_IDS,
  RA_INVERSE_SNAPSHOT_COMPONENT_IDS,
  raInverseComponentIdsForMode,
  type RaInverseScoreMode,
} from "./rascoreInversePattern";
import { correlationSignificance, pearsonR } from "./statSignificance";
import {
  appendNormalizedRaPairs,
  computeComponentPolarities,
  poolComponentPricePairs,
  type RaComponentObservation,
  type RaComponentPolarity,
} from "./rascoreComponentPolarity";

export type RaTemporalMetricId = "full_ra" | "normalized_ra" | SolidityCompositeComponentId;

/** Minimum cross-sectional n at a CD knot before ρ is plotted (may widen to adjacent knots). */
export const RA_TIMELINE_MIN_N = 3;

export type RaTemporalCorrelationAnchor = {
  offset: number;
  offsetLabel: string;
  isPreCd: boolean;
  rho: number | null;
  /** Raw tickers at this knot (before neighbor pooling). */
  n: number;
  /** Pairs used for ρ (may include adjacent knots when n was too small). */
  nUsed: number;
  pValue: number | null;
  reliable: boolean;
  /** True when ρ used pairs from neighboring CD knots to reach min n. */
  windowPooled: boolean;
};

export type RaTemporalCorrelationSeries = {
  metricId: RaTemporalMetricId;
  /** Snapshot-only indices (SDS/MII/calib) — temporally mixed at historical anchors. */
  isSnapshot: boolean;
  anchors: RaTemporalCorrelationAnchor[];
};

export type RaTemporalCorrelationPeak = {
  offset: number;
  offsetLabel: string;
  rho: number;
  n: number;
  metricId: RaTemporalMetricId;
  pValue: number | null;
};

export type RaPooledMetricRho = {
  metricId: RaTemporalMetricId;
  rho: number | null;
  n: number;
  pValue: number | null;
};

export type RaTemporalCorrelationResult = {
  scoreMode: RaInverseScoreMode;
  series: RaTemporalCorrelationSeries[];
  fullRaSeries: RaTemporalCorrelationSeries | null;
  normalizedFullRaSeries: RaTemporalCorrelationSeries | null;
  componentPolarities: RaComponentPolarity[];
  /** Pooled ρ across all CD buckets (always used when per-knot n is too small). */
  pooledRho: RaPooledMetricRho[];
  totalObservations: number;
  timelineAnchorRhoCount: number;
  peakPreCd: RaTemporalCorrelationPeak | null;
  peakPreCdNormalized: RaTemporalCorrelationPeak | null;
  chartRows: Array<Record<string, number | string | null>>;
  /** Per-anchor sample counts (cross-sectional + retrospective). */
  bucketCounts: Partial<Record<number, number>>;
  cohortStats: RaTemporalCohortStats;
};

export type RaTemporalCohortStats = {
  simRows: number;
  eligibleTickers: number;
  withChartSeries: number;
  tickersWithPairs: number;
  pairCount: number;
};

export type RaTemporalCorrelationBuildArgs = {
  simTable: SheetTable | null | undefined;
  chartBundle: ChartBundle | null | undefined;
  sdsRows: SdsRow[] | null | undefined;
  inputs: InvestSimInputs;
  history?: InvestSimHistoryPoint[] | null;
  lang?: "it" | "en";
};

function componentFillPct(points: number, maxPoints: number): number {
  if (maxPoints <= 0) return 0;
  return Math.round(Math.min(100, Math.max(0, (points / maxPoints) * 100)) * 10) / 10;
}

function fullRaFromComponents(
  componentPoints: Record<SolidityCompositeComponentId, number>,
  mode: RaInverseScoreMode,
): number {
  const ids = raInverseComponentIdsForMode(mode);
  return Math.round(ids.reduce((s, id) => s + (componentPoints[id] ?? 0), 0) * 10) / 10;
}

function collectMetricPairs(args: {
  buildArgs: RaTemporalCorrelationBuildArgs;
  scoreMode: RaInverseScoreMode;
}): {
  pairs: Map<number, Map<RaTemporalMetricId, { x: number; y: number }[]>>;
  bucketCounts: Map<number, number>;
  observations: RaComponentObservation[];
  cohortStats: RaTemporalCohortStats;
} {
  const {
    simTable,
    chartBundle,
    sdsRows,
    inputs,
    history = null,
    lang = "it",
  } = args.buildArgs;
  const { scoreMode } = args;

  const rows = simTable?.rows ?? [];
  const merged = reconcileInvestSimInputs(inputs, rows);
  const pointsByKey = chartPointsMapFromBundle(chartBundle);
  const sdsByTicker = buildSdsByTicker(sdsRows);
  const migByKey = buildMigSolidityByKey(simTable ?? null, chartBundle, sdsRows);
  const strictOpts = { sdsByTicker, migByKey };

  const pairs = new Map<number, Map<RaTemporalMetricId, { x: number; y: number }[]>>();
  const ensure = (offset: number, metric: RaTemporalMetricId) => {
    if (!pairs.has(offset)) pairs.set(offset, new Map());
    const m = pairs.get(offset)!;
    if (!m.has(metric)) m.set(metric, []);
    return m.get(metric)!;
  };

  const seenKeys = new Set<string>();
  const bucketCounts = new Map<number, number>();
  const observations: RaComponentObservation[] = [];
  let simRows = 0;
  let eligibleTickers = 0;
  let withChartSeries = 0;

  for (const simRow of rows) {
    const ticker = String(simRow.Ticker ?? "").trim().toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;
    simRows += 1;

    const cd = simRow["Completion Date"];
    const key = normalizedRowKey(ticker, cd);
    if (seenKeys.has(key)) continue;

    if (!isSimRowCalibrationEligible(simRow)) continue;
    eligibleTickers += 1;

    const seriesKey = simulationRowSeriesKey(simRow);
    const chartPts = seriesKey ? pointsByKey.get(seriesKey) ?? null : null;
    if (chartPts?.some((p) => p.price_storico_usd != null && Number.isFinite(p.price_storico_usd))) {
      withChartSeries += 1;
    }

    const nowOff = completionDateToNowOffset(cd);
    const { long: calendarLong } = buildCdHorizonPriceChanges(simRow, chartPts);
    const longKeys = Object.keys(calendarLong).length;
    let any = false;

    const pushPair = (
      bucket: number,
      y: number,
      composite: NonNullable<ReturnType<typeof computeRaCompositeAsOfAnchor>>,
    ) => {
      bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
      const compPts: Record<SolidityCompositeComponentId, number> = {} as Record<
        SolidityCompositeComponentId,
        number
      >;
      for (const id of RA_INVERSE_COMPONENT_IDS) {
        const hit = composite.components.find((c) => c.id === id);
        const points = hit?.points ?? 0;
        const maxPoints = hit?.maxPoints ?? SOLIDITY_COMPONENT_MAX[id];
        compPts[id] = componentFillPct(points, maxPoints);
        ensure(bucket, id).push({ x: compPts[id]!, y });
      }
      const pointById = Object.fromEntries(
        RA_INVERSE_COMPONENT_IDS.map((id) => {
          const hit = composite.components.find((c) => c.id === id);
          return [id, hit?.points ?? 0] as const;
        }),
      ) as Record<SolidityCompositeComponentId, number>;
      const fullScore = fullRaFromComponents(pointById, scoreMode);
      ensure(bucket, "full_ra").push({ x: fullScore, y });
      observations.push({ bucket, y, fills: compPts, points: pointById });
    };

    if (longKeys > 0 && nowOff != null) {
      for (const offset of RA_CALIB_CD_OFFSETS) {
        const y = calendarLong[offset];
        if (y == null || !Number.isFinite(y)) continue;

        const composite = computeRaCompositeAsOfAnchor({
          simRow,
          mergedInputs: merged,
          chartPts,
          history,
          anchor: offset,
          opts: strictOpts,
          lang,
          calibrationRelaxed: true,
        });
        if (!composite) continue;

        any = true;
        pushPair(offset, y, composite);
      }
    } else if (nowOff != null) {
      const bucket = snapToRaCalibOffset(nowOff);
      const y = buildPriceLongFromObservation(simRow, chartPts, nowOff);
      if (y == null || !Number.isFinite(y)) continue;

      let composite = computeRaCompositeAsOfAnchor({
        simRow,
        mergedInputs: merged,
        chartPts,
        history,
        anchor: nowOff,
        opts: strictOpts,
        lang,
        calibrationRelaxed: true,
      });
      if (!composite) {
        composite = computeRaCompositeAsOfAnchor({
          simRow,
          mergedInputs: merged,
          chartPts,
          history,
          anchor: bucket,
          opts: strictOpts,
          lang,
          calibrationRelaxed: true,
        });
      }
      if (!composite) continue;

      any = true;
      pushPair(bucket, y, composite);
    }

    if (any) seenKeys.add(key);
  }

  const pairCount = totalObservationCount(pairs);
  const cohortStats: RaTemporalCohortStats = {
    simRows,
    eligibleTickers,
    withChartSeries,
    tickersWithPairs: seenKeys.size,
    pairCount,
  };

  return { pairs, bucketCounts, observations, cohortStats };
}

function pairsFromSignalsOnly(
  signals: RaCalibrationSignal[],
): Map<number, Map<RaTemporalMetricId, { x: number; y: number }[]>> {
  const pairs = new Map<number, Map<RaTemporalMetricId, { x: number; y: number }[]>>();
  const ensure = (offset: number) => {
    if (!pairs.has(offset)) pairs.set(offset, new Map());
    const m = pairs.get(offset)!;
    if (!m.has("full_ra")) m.set("full_ra", []);
    return m.get("full_ra")!;
  };

  for (const sig of signals) {
    for (const offset of RA_CALIB_CD_OFFSETS) {
      const y = sig.priceChgLongByOffset[offset];
      if (y == null || !Number.isFinite(y)) continue;
      const x = sig.raScoreByOffset?.[offset] ?? sig.raScore;
      if (!Number.isFinite(x)) continue;
      ensure(offset).push({ x, y });
    }
  }
  return pairs;
}

function knotPairsAtOffset(
  pairs: Map<number, Map<RaTemporalMetricId, { x: number; y: number }[]>>,
  metricId: RaTemporalMetricId,
  offset: number,
): { x: number; y: number }[] {
  return [...(pairs.get(offset)?.get(metricId) ?? [])];
}

/** Widen to neighboring CD knots when a knot has too few cross-sectional pairs. */
function poolKnotPairsForTimeline(
  pairs: Map<number, Map<RaTemporalMetricId, { x: number; y: number }[]>>,
  metricId: RaTemporalMetricId,
  offset: number,
): { pts: { x: number; y: number }[]; windowPooled: boolean } {
  const raw = knotPairsAtOffset(pairs, metricId, offset);
  if (raw.length >= RA_TIMELINE_MIN_N) {
    return { pts: raw, windowPooled: false };
  }

  const idx = (RA_CALIB_CD_OFFSETS as readonly number[]).indexOf(offset);
  if (idx < 0) return { pts: raw, windowPooled: false };

  const pooled = [...raw];
  for (let d = 1; d < RA_CALIB_CD_OFFSETS.length && pooled.length < RA_TIMELINE_MIN_N; d += 1) {
    if (idx - d >= 0) {
      pooled.push(...knotPairsAtOffset(pairs, metricId, RA_CALIB_CD_OFFSETS[idx - d]!));
    }
    if (pooled.length >= RA_TIMELINE_MIN_N) break;
    if (idx + d < RA_CALIB_CD_OFFSETS.length) {
      pooled.push(...knotPairsAtOffset(pairs, metricId, RA_CALIB_CD_OFFSETS[idx + d]!));
    }
  }

  return {
    pts: pooled,
    windowPooled: pooled.length > raw.length && pooled.length >= RA_TIMELINE_MIN_N,
  };
}

function anchorRho(
  rawPts: { x: number; y: number }[],
  offset: number,
  pooledPts: { x: number; y: number }[],
  windowPooled: boolean,
): RaTemporalCorrelationAnchor {
  const n = rawPts.length;
  const nUsed = pooledPts.length;
  const rho = nUsed >= RA_TIMELINE_MIN_N
    ? pearsonR(pooledPts.map((p) => p.x), pooledPts.map((p) => p.y))
    : null;
  const { p: pValue } = correlationSignificance(rho, nUsed);
  return {
    offset,
    offsetLabel: raCalibOffsetLabel(offset),
    isPreCd: offset < 0,
    rho,
    n,
    nUsed,
    pValue,
    reliable: nUsed >= RA_CALIB_MIN_SAMPLE_N && !windowPooled,
    windowPooled,
  };
}

function buildSeriesForMetric(
  metricId: RaTemporalMetricId,
  pairs: Map<number, Map<RaTemporalMetricId, { x: number; y: number }[]>>,
): RaTemporalCorrelationSeries {
  const anchors = RA_CALIB_CD_OFFSETS.map((offset) => {
    const rawPts = knotPairsAtOffset(pairs, metricId, offset);
    const { pts, windowPooled } = poolKnotPairsForTimeline(pairs, metricId, offset);
    return anchorRho(rawPts, offset, pts, windowPooled);
  });
  return {
    metricId,
    isSnapshot: (RA_INVERSE_SNAPSHOT_COMPONENT_IDS as readonly string[]).includes(metricId),
    anchors,
  };
}

function poolMetricRho(
  pairs: Map<number, Map<RaTemporalMetricId, { x: number; y: number }[]>>,
  metricId: RaTemporalMetricId,
): RaPooledMetricRho {
  const pooled =
    metricId === "full_ra" || metricId === "normalized_ra"
      ? (() => {
          const out: { x: number; y: number }[] = [];
          for (const bucketMap of pairs.values()) {
            out.push(...(bucketMap.get(metricId) ?? []));
          }
          return out;
        })()
      : poolComponentPricePairs(pairs, metricId);
  const n = pooled.length;
  const rho = n >= 3 ? pearsonR(pooled.map((p) => p.x), pooled.map((p) => p.y)) : null;
  const { p: pValue } = correlationSignificance(rho, n);
  return { metricId, rho, n, pValue };
}

function countTimelineAnchorRhos(series: RaTemporalCorrelationSeries[]): number {
  let n = 0;
  for (const s of series) {
    for (const a of s.anchors) {
      if (a.rho != null) n += 1;
    }
  }
  return n;
}

function totalObservationCount(
  pairs: Map<number, Map<RaTemporalMetricId, { x: number; y: number }[]>>,
): number {
  let n = 0;
  for (const bucketMap of pairs.values()) {
    n += (bucketMap.get("full_ra") ?? []).length;
  }
  return n;
}

export function pickPeakPreCdCorrelation(
  series: RaTemporalCorrelationSeries[],
  metricId: RaTemporalMetricId = "full_ra",
): RaTemporalCorrelationPeak | null {
  const hit = series.find((s) => s.metricId === metricId);
  if (!hit) return null;

  let best: RaTemporalCorrelationPeak | null = null;
  for (const a of hit.anchors) {
    if (!a.isPreCd || a.rho == null || a.nUsed < RA_CALIB_MIN_SAMPLE_N) continue;
    const absR = Math.abs(a.rho);
    if (!best || absR > Math.abs(best.rho)) {
      best = {
        offset: a.offset,
        offsetLabel: a.offsetLabel,
        rho: a.rho,
        n: a.n,
        metricId,
        pValue: a.pValue,
      };
    }
  }
  return best;
}

export function buildRaTemporalCorrelation(args: {
  signals: RaCalibrationSignal[];
  buildArgs?: RaTemporalCorrelationBuildArgs | null;
  scoreMode?: RaInverseScoreMode;
}): RaTemporalCorrelationResult {
  const scoreMode = args.scoreMode ?? "full";
  let pairs: Map<number, Map<RaTemporalMetricId, { x: number; y: number }[]>>;
  let bucketCounts: Partial<Record<number, number>> = {};
  let componentPolarities: RaComponentPolarity[] = [];
  let cohortStats: RaTemporalCohortStats = {
    simRows: 0,
    eligibleTickers: 0,
    withChartSeries: 0,
    tickersWithPairs: 0,
    pairCount: 0,
  };

  if (args.buildArgs) {
    const collected = collectMetricPairs({ buildArgs: args.buildArgs, scoreMode });
    pairs = collected.pairs;
    bucketCounts = Object.fromEntries(collected.bucketCounts);
    componentPolarities = computeComponentPolarities(pairs);
    appendNormalizedRaPairs(pairs, collected.observations, componentPolarities, scoreMode);
    cohortStats = collected.cohortStats;
  } else {
    pairs = pairsFromSignalsOnly(args.signals);
    cohortStats = {
      simRows: args.signals.length,
      eligibleTickers: args.signals.length,
      withChartSeries: args.signals.length,
      tickersWithPairs: args.signals.length,
      pairCount: totalObservationCount(pairs),
    };
  }

  const metricIds: RaTemporalMetricId[] = [
    "full_ra",
    "normalized_ra",
    ...RA_INVERSE_COMPONENT_IDS,
  ];
  const series = metricIds.map((id) => buildSeriesForMetric(id, pairs));
  const fullRaSeries = series.find((s) => s.metricId === "full_ra") ?? null;
  const normalizedFullRaSeries = series.find((s) => s.metricId === "normalized_ra") ?? null;
  const peakPreCd = pickPeakPreCdCorrelation(series, "full_ra");
  const peakPreCdNormalized = pickPeakPreCdCorrelation(series, "normalized_ra");

  const chartRows = RA_CALIB_CD_OFFSETS.map((offset) => {
    const row: Record<string, number | string | null> = {
      offset,
      offsetLabel: raCalibOffsetLabel(offset),
    };
    for (const s of series) {
      const a = s.anchors.find((x) => x.offset === offset);
      row[s.metricId] = a?.rho ?? null;
      row[`${s.metricId}_n`] = a?.n ?? 0;
      row[`${s.metricId}_nUsed`] = a?.nUsed ?? 0;
      row[`${s.metricId}_windowPooled`] = a?.windowPooled ? 1 : 0;
    }
    return row;
  });

  return {
    scoreMode,
    series,
    fullRaSeries,
    normalizedFullRaSeries,
    componentPolarities,
    pooledRho: metricIds.map((id) => poolMetricRho(pairs, id)),
    totalObservations: totalObservationCount(pairs),
    timelineAnchorRhoCount: countTimelineAnchorRhos(series),
    peakPreCd,
    peakPreCdNormalized,
    chartRows,
    bucketCounts,
    cohortStats,
  };
}
