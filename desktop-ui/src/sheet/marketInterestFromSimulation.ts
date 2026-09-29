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

/**
 * Returns the first row value whose key matches ANY of the keywords.
 * Kept for backward compat with legacy alt-name lookups like
 * `findCol(row, "slope≈5", "slope5")` where the caller passes variants.
 */
function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

/**
 * Returns the first row value whose key contains ALL of the keywords.
 * Use for narrow lookups like "Var. 1M" where matching "var." alone would
 * grab the wrong column (e.g. "Var. Giorn. %").
 */
function findColAll(row: Record<string, unknown>, ...keywords: string[]): unknown {
  const los = keywords.map((k) => k.toLowerCase());
  const key = Object.keys(row).find((k) => {
    const lk = k.toLowerCase();
    return los.every((kw) => lk.includes(kw));
  });
  return key ? row[key] : undefined;
}

/**
 * ΔP % on ~5-day horizon used as MII input.
 *
 * Preferred: 50/50 blend of the short-term (weekly) and multi-week
 * (monthly-scaled) signals. Rationale:
 *
 *  • Pure monthly (previous behavior) is too slow for biotech catalysts —
 *    e.g. ERNA closed +11% on a positive preclinical readout, but Var.1M
 *    was still −11% (dragged by the 4-week drawdown before the catalyst),
 *    so MII showed −28° when the market clearly turned positive.
 *
 *  • Pure weekly (5-day slope × 5) is too noisy for a multi-week thesis —
 *    e.g. MSLE +60% over 1M with RSI 75; a −2.3 slope on the 5-day
 *    ipercomprato retrace would flip MII to −38° and hide a genuine
 *    uptrend still worth watching.
 *
 * The 50/50 blend keeps ~half the memory of the monthly trend while
 * letting the weekly slope pull the signal within 5-7 trading days when a
 * regime change happens. On the current 50-ticker universe this reduces
 * mean |Δ°| vs pure-monthly from 16° (weekly) to ~8°, and drops sign
 * flips from 17 to ~7.
 *
 * Fallback chain (when a source is missing):
 *   1. slope5 + Var.1M  → blend
 *   2. Var.1M only      → monthly-scaled (legacy)
 *   3. slope5 only      → weekly-scaled
 *   4. Var. Giorn only  → daily × 5 (very noisy — kept as last resort)
 */
export function readDeltaPricePct5d(row: Record<string, unknown>): { pct: number; source: string } {
  const daily =
    parseNum(row["Var. Giorn. %"]) ??
    parseNum(row["Var. Giorn.%"]) ??
    parseNum(findColAll(row, "var.", "giorn"));
  const var1m =
    parseNum(row["Var. 1M %"]) ?? parseNum(findColAll(row, "var.", "1m"));
  const slope5 = parseNum(findCol(row, "slope≈5", "slope5"));

  const weeklyPct = slope5 != null ? slope5 * 5 : null;
  const monthlyPct = var1m != null ? (var1m * 5) / 22 : null;

  if (weeklyPct != null && monthlyPct != null) {
    return {
      pct: round2((weeklyPct + monthlyPct) / 2),
      source: "50%·slope5d + 50%·Var.1M→5d",
    };
  }
  if (monthlyPct != null) {
    return { pct: round2(monthlyPct), source: "Var.1M→5d (slope5d n/a)" };
  }
  if (weeklyPct != null) {
    return { pct: round2(weeklyPct), source: "slope5d×5 (Var.1M n/a)" };
  }
  if (daily != null) {
    return { pct: round2(daily * 5), source: "Var.giorn×5 (fallback)" };
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
