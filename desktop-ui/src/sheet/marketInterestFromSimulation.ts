/**
 * Snapshot MII da foglio Simulation + cache SDS (volume ratio) + slope modello ricalibrato.
 */
import type { SheetTable, ChartBundle, ChartPoint } from "../types";
import type { SdsRow } from "../api/supernova";
import { simulationRowSeriesKey, chartPointsMapFromBundle } from "../data/simulationCharts";
import { daysFromToday, readPred5RelativePp } from "./simulationPlanGain";
import {
  forwardPred5PpAfterDailyRecalib,
  forwardPred5PpBeforeDailyRecalib,
} from "./predictionCurveDailyRecalib";
import type { MarketInterestSnapshot } from "./marketInterestGate";

function parseNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "."));
  return Number.isFinite(n) ? n : null;
}

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

function readDeltaPricePct5d(row: Record<string, unknown>): { pct: number; source: string } {
  const daily =
    parseNum(row["Var. Giorn. %"]) ??
    parseNum(row["Var. Giorn.%"]) ??
    parseNum(findCol(row, "var.", "giorn"));
  const var1m = parseNum(row["Var. 1M %"]) ?? parseNum(findCol(row, "var.", "1m"));

  if (var1m != null) {
    return { pct: round2((var1m * 5) / 22), source: "Var.1M→5d" };
  }
  if (daily != null) {
    return { pct: round2(daily * 5), source: "Var.giorn×5" };
  }

  const slope5 = parseNum(findCol(row, "slope≈5", "slope5"));
  if (slope5 != null) {
    return { pct: round2(slope5 * 5), source: "slope5d×5" };
  }

  return { pct: 0, source: "missing" };
}

function volRatioFromSdsRow(sds: SdsRow | undefined): { ratio: number; source: string } {
  const c = sds?.cluster_c;
  const vr = c?.volume_ratio;
  const fromComp =
    vr?.ratio_5d_vs_20d ??
    (vr?.avg_volume_5d != null &&
    vr?.avg_volume_20d != null &&
    vr.avg_volume_20d > 0
      ? vr.avg_volume_5d / vr.avg_volume_20d
      : null);

  if (fromComp != null && Number.isFinite(fromComp) && fromComp > 0) {
    return { ratio: round3(fromComp), source: "SDS vol ratio" };
  }

  const obv = c?.obv_accumulation?.price_slope_pct_day;
  if (obv != null && Number.isFinite(obv)) {
    return { ratio: 1, source: "SDS (no vol — neutral 1×)" };
  }

  return { ratio: 1, source: "neutral 1×" };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Pendenza modello Pred+5/5 prima e dopo ricalibrazione giornaliera open. */
export function resolveDailyRecalibModelSlopes5d(
  row: Record<string, unknown>,
  chartPoints: ChartPoint[] | null | undefined,
): {
  preDailySlope5d: number | null;
  postDailySlope5d: number | null;
  preSource: string;
  postSource: string;
} {
  if (chartPoints?.length) {
    const pre5 = forwardPred5PpBeforeDailyRecalib(row, chartPoints);
    const post5 = forwardPred5PpAfterDailyRecalib(row, chartPoints);
    return {
      preDailySlope5d: pre5 != null ? round2(pre5 / 5) : null,
      postDailySlope5d: post5 != null ? round2(post5 / 5) : null,
      preSource: pre5 != null ? "pred+5 pre-daily" : "missing",
      postSource: post5 != null ? "pred+5 post-daily" : "missing",
    };
  }

  const pred5 = readPred5RelativePp(row, undefined);
  const postFromSheet = pred5 != null ? round2(pred5 / 5) : null;
  return {
    preDailySlope5d: postFromSheet,
    postDailySlope5d: postFromSheet,
    preSource: postFromSheet != null ? "sheet pred+5" : "missing",
    postSource: postFromSheet != null ? "sheet pred+5" : "missing",
  };
}

export function buildMarketInterestSnapshotsFromSimulation(
  simTable: SheetTable | null | undefined,
  sdsByTicker?: Map<string, SdsRow>,
  opts?: {
    maxDaysToCd?: number;
    minDaysToCd?: number;
    chartsBundle?: ChartBundle | null;
    chartPointsBySeriesKey?: Map<string, ChartPoint[]>;
  },
): MarketInterestSnapshot[] {
  if (!simTable?.rows?.length) return [];

  const cols =
    simTable.columns?.length ? simTable.columns : Object.keys(simTable.rows[0] ?? {});
  const colTicker = cols.find((c) => c.toLowerCase().includes("ticker")) ?? "Ticker";
  const colCd =
    cols.find((c) => c.toLowerCase().includes("completion")) ?? "Completion Date";

  const maxDays = opts?.maxDaysToCd ?? 120;
  const minDays = opts?.minDaysToCd ?? -45;

  const pointsByKey =
    opts?.chartPointsBySeriesKey ??
    (opts?.chartsBundle ? chartPointsMapFromBundle(opts.chartsBundle) : null);

  const out: MarketInterestSnapshot[] = [];
  const seen = new Set<string>();

  for (const row of simTable.rows) {
    const ticker = String(row[colTicker] ?? "")
      .trim()
      .toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;

    const cd = String(row[colCd] ?? "").trim();
    const key = `${ticker}|${cd}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const days = cd ? daysFromToday(cd) : null;
    if (days != null && (days < minDays || days > maxDays)) continue;

    const { pct, source: deltaSource } = readDeltaPricePct5d(row);
    const sds = sdsByTicker?.get(ticker);
    const { ratio, source: volSource } = volRatioFromSdsRow(sds);

    const sk = simulationRowSeriesKey(row);
    const chartPts = sk && pointsByKey ? pointsByKey.get(sk) ?? null : null;
    const model = resolveDailyRecalibModelSlopes5d(row, chartPts);

    out.push({
      ticker,
      cd: cd || undefined,
      daysToCd: days,
      deltaPricePct: pct,
      volRatio: ratio,
      deltaSource,
      volSource,
      preDailyModelSlope5dPpPerDay: model.preDailySlope5d,
      postDailyModelSlope5dPpPerDay: model.postDailySlope5d,
    });
  }

  return out.sort((a, b) => {
    const da = a.daysToCd ?? 999;
    const db = b.daysToCd ?? 999;
    if (da !== db) return da - db;
    return a.ticker.localeCompare(b.ticker);
  });
}

export function sdsRowsToMap(rows: SdsRow[] | null | undefined): Map<string, SdsRow> {
  const m = new Map<string, SdsRow>();
  for (const r of rows ?? []) {
    const tk = String(r.ticker ?? "")
      .trim()
      .toUpperCase();
    if (tk) m.set(tk, r);
  }
  return m;
}
