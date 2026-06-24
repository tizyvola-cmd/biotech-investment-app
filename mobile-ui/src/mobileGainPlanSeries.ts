import { completionDateToNowOffset } from "./mobileRecalibCurve";
import {
  holdingDayFractionFromInvestedAt,
  holdingDaysFromInvestedAt,
  parseNum,
} from "./simLogic";
import type { InvestSimHistoryPoint } from "./types";
import type { ChartPoint } from "./types";

export type MobileGainPlanPoint = {
  day: number;
  planned: number | null;
  actual: number | null;
  historical: number | null;
};

const DEFAULT_CAPITAL_EUR = 5000;
const POST_CD_GAIN_EXTENSION_DAYS = 90;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundDayKey(d: number): number {
  return Math.round(d * 1000) / 1000;
}

function bestModelPct(p: ChartPoint): number | null {
  if (typeof p.pct_foglio === "number" && Number.isFinite(p.pct_foglio)) return p.pct_foglio;
  if (typeof p.pct_curva === "number" && Number.isFinite(p.pct_curva)) return p.pct_curva;
  return null;
}

function interpolateSeries(
  series: Array<{ offset: number; y: number }>,
  target: number,
): number | null {
  if (!series.length) return null;
  const sorted = [...series].sort((a, b) => a.offset - b.offset);
  if (target <= sorted[0].offset) return sorted[0].y;
  if (target >= sorted[sorted.length - 1].offset) return sorted[sorted.length - 1].y;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (target >= a.offset && target <= b.offset) {
      const t = (target - a.offset) / (b.offset - a.offset || 1);
      return a.y + t * (b.y - a.y);
    }
  }
  return null;
}

function modelSeries(chartPoints: ChartPoint[]): Array<{ offset: number; y: number }> {
  return chartPoints
    .map((p) => {
      const y = bestModelPct(p);
      return y != null ? { offset: p.offset, y } : null;
    })
    .filter((x): x is { offset: number; y: number } => x != null);
}

function plannedGainEurFromRecalibCurve(
  row: Record<string, unknown>,
  chartPoints: ChartPoint[],
  capital: number,
  holdDaysElapsed: number,
  day: number,
): number | null {
  if (!chartPoints.length || capital <= 0) return null;
  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) return null;
  const elapsed = holdDaysElapsed >= 0 ? holdDaysElapsed : 0;
  const entryOff = nowOff - elapsed;
  const series = modelSeries(chartPoints);
  const atEntry = interpolateSeries(series, entryOff);
  const atDay = interpolateSeries(series, entryOff + day);
  if (atEntry == null || atDay == null) return null;
  return round2((capital * (atDay - atEntry)) / 100);
}

function buildActualAnchors(
  key: string,
  investedAt: string | null,
  history: InvestSimHistoryPoint[],
  todayDay: number,
  livePnl: number | null,
): Map<number, number> {
  const anchors = new Map<number, number>();
  anchors.set(0, 0);

  if (investedAt) {
    for (const h of history) {
      const snap = h.byTicker[key];
      if (!snap) continue;
      const d = holdingDayFractionFromInvestedAt(investedAt, h.ts);
      if (d == null || d < 0) continue;
      anchors.set(roundDayKey(d), round2(snap.pnl));
    }
  }

  if (livePnl != null && Number.isFinite(livePnl)) {
    const dayKey = roundDayKey(Math.max(todayDay, 0.01));
    anchors.set(dayKey, round2(livePnl));
  }

  return anchors;
}

function interpolateAnchors(day: number, anchors: Map<number, number>): number | null {
  if (!anchors.size) return null;
  const keys = [...anchors.keys()].sort((a, b) => a - b);
  if (day <= keys[0]) return anchors.get(keys[0]) ?? null;
  if (day >= keys[keys.length - 1]) return anchors.get(keys[keys.length - 1]) ?? null;
  for (let i = 0; i < keys.length - 1; i++) {
    const d0 = keys[i];
    const d1 = keys[i + 1];
    if (day >= d0 && day <= d1) {
      const v0 = anchors.get(d0)!;
      const v1 = anchors.get(d1)!;
      const t = d1 === d0 ? 0 : (day - d0) / (d1 - d0);
      return round2(v0 + t * (v1 - v0));
    }
  }
  return null;
}

function collectSeriesDays(
  maxDay: number,
  anchors: Map<number, number>,
  minDay = 0,
): number[] {
  const set = new Set<number>();
  for (let d = minDay; d <= Math.ceil(maxDay); d++) set.add(d);
  for (const d of anchors.keys()) {
    if (d >= minDay - 0.001 && d <= maxDay + 0.001) set.add(roundDayKey(d));
  }
  return [...set].sort((a, b) => a - b);
}

function findCol(row: Record<string, unknown>, ...keywords: string[]): unknown {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const key = Object.keys(row).find((k) => k.toLowerCase().includes(lo));
    if (key) return row[key];
  }
  return undefined;
}

export function buildMobileGainPlanSeries(opts: {
  row: Record<string, unknown>;
  chartPoints: ChartPoint[];
  capital: number;
  hasPosition: boolean;
  planReturnPct: number | null;
  daysToCd: number | null;
  daysToTarget: number | null;
  livePnlEur: number | null;
  holdDaysElapsed: number;
  investedAt?: string | null;
  rowKey?: string;
  history?: InvestSimHistoryPoint[];
}): MobileGainPlanPoint[] {
  const {
    row,
    chartPoints,
    capital,
    hasPosition,
    planReturnPct,
    daysToCd,
    daysToTarget,
    livePnlEur,
    holdDaysElapsed,
    investedAt = null,
    rowKey = "",
    history = [],
  } = opts;

  const ret =
    planReturnPct ??
    parseNum(findCol(row, "plan return", "roi atteso", "target roi")) ??
    15;
  const expectedGainEur = round2((capital * ret) / 100);
  const planDays = daysToTarget ?? daysToCd ?? 60;
  const postCdHorizon = planDays + POST_CD_GAIN_EXTENSION_DAYS;
  const todayDay = holdDaysElapsed >= 0 ? holdDaysElapsed : 0;
  const maxDay = Math.max(todayDay, planDays, postCdHorizon, 1);
  const useRecalibPlan = chartPoints.length > 0;

  const actualAnchors = hasPosition
    ? buildActualAnchors(rowKey, investedAt, history, todayDay, livePnlEur)
    : new Map<number, number>();
  const actualEndDay =
    hasPosition && actualAnchors.size > 0 ? Math.max(todayDay, 0.01) : todayDay;

  const seriesDays = collectSeriesDays(maxDay, actualAnchors, 0);
  const out: MobileGainPlanPoint[] = [];

  for (const day of seriesDays) {
    let planned: number | null = null;
    if (day >= 0 && useRecalibPlan) {
      planned = plannedGainEurFromRecalibCurve(row, chartPoints, capital, holdDaysElapsed, day);
    }
    if (planned == null && day >= 0 && expectedGainEur != null) {
      const span = planDays > 0 ? planDays : maxDay;
      planned = round2((day / span) * expectedGainEur);
    }

    const actual =
      hasPosition && day >= 0 && day <= actualEndDay + 0.001 && actualAnchors.size > 0
        ? interpolateAnchors(day, actualAnchors)
        : null;

    out.push({ day, planned, actual, historical: null });
  }

  return out;
}

export function gainPlanSeriesQuality(
  points: MobileGainPlanPoint[] | null | undefined,
  hasPosition = false,
): number {
  if (!points?.length) return -1;
  const plan = points.filter((p) => p.planned != null).length;
  const actual = points.filter((p) => p.actual != null).length;
  if (hasPosition) return actual * 10 + plan + points.length;
  return plan + points.length;
}
