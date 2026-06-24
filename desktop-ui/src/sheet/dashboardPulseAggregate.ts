import {
  buildGainPlanSeries,
  type GainPlanPoint,
  type PortfolioGainChartRow,
} from "../components/PortfolioGainPlanChart";
import {
  holdingDayFractionFromInvestedAt,
  type InvestSimHistoryPoint,
} from "./investSimStorage";
import { tickPulseSeriesLooksLikeCatchUpSpike } from "./pulseMtmBackfill";

export type AggregateGainPlanPoint = {
  ts: string;
  label: string;
  planned: number | null;
  actual: number | null;
};

export type PlanGapSummary = {
  plannedNowEur: number | null;
  actualNowEur: number | null;
  gapEur: number | null;
  gapPct: number | null;
};

function fmtShortDateTime(iso: string, lang: "it" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "it" ? "it-IT" : "en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actualFromHistoryPoint(
  h: InvestSimHistoryPoint,
  rows: PortfolioGainChartRow[],
): { actual: number | null; hasActual: boolean } {
  let fromTickers = 0;
  let hasFromTickers = false;
  for (const row of rows) {
    const snap = h.byTicker[row.key];
    if (snap && Number.isFinite(snap.pnl)) {
      fromTickers += snap.pnl;
      hasFromTickers = true;
    }
  }
  if (hasFromTickers) {
    fromTickers = Math.round(fromTickers * 100) / 100;
    if (Number.isFinite(h.pnl)) {
      const drift = Math.abs(h.pnl - fromTickers);
      const tol = Math.max(500, Math.abs(fromTickers) * 0.5 + 250);
      if (drift > tol || Math.abs(h.pnl) > 500_000) {
        return { actual: fromTickers, hasActual: true };
      }
    }
    return { actual: fromTickers, hasActual: true };
  }
  if (Number.isFinite(h.pnl) && Math.abs(h.pnl) <= 500_000) {
    return { actual: h.pnl, hasActual: true };
  }
  return { actual: null, hasActual: false };
}

function strictSeriesValueAtDay(
  series: GainPlanPoint[],
  day: number,
  field: "planned" | "actual",
): number | null {
  if (day < -0.001 || !series.length) return null;
  let value: number | null = null;
  let lastDefinedDay = -Infinity;
  for (const p of series) {
    if (p.day > day + 0.001) break;
    const v = field === "planned" ? p.planned : p.actual;
    if (v != null && Number.isFinite(v)) {
      value = v;
      lastDefinedDay = p.day;
    }
  }
  if (value == null || day > lastDefinedDay + 0.001) return null;
  return value;
}

/** Latest hold-day across open rows — the aggregate chart ends here (no future). */
function resolvePortfolioAsOfDay(rows: PortfolioGainChartRow[]): number {
  let maxDay = 0.01;
  for (const row of rows) {
    const investedAt = row.investedAt?.trim();
    const day =
      (investedAt ? holdingDayFractionFromInvestedAt(investedAt) : null) ??
      row.holdDaysElapsed ??
      0;
    if (day != null && Number.isFinite(day) && day > maxDay) maxDay = day;
  }
  return maxDay;
}

function aggregateAtDay(
  rows: PortfolioGainChartRow[],
  seriesByKey: Map<string, GainPlanPoint[]>,
  day: number,
  asOfDay: number,
): { planned: number | null; actual: number | null } {
  if (day > asOfDay + 0.001) return { planned: null, actual: null };
  let planned = 0;
  let actual = 0;
  let hasPlanned = false;
  let hasActual = false;
  for (const row of rows) {
    const series = seriesByKey.get(row.key) ?? [];
    const ptPlanned = strictSeriesValueAtDay(series, day, "planned");
    const ptActual = strictSeriesValueAtDay(series, day, "actual");
    if (ptPlanned != null) {
      planned += ptPlanned;
      hasPlanned = true;
    }
    if (ptActual != null) {
      actual += ptActual;
      hasActual = true;
    }
  }
  return {
    planned: hasPlanned ? Math.round(planned * 100) / 100 : null,
    actual: hasActual ? Math.round(actual * 100) / 100 : null,
  };
}

/** Hold-day "as of now" for one open row — same axis as gain vs plan charts. */
function resolveRowAsOfDay(row: PortfolioGainChartRow): number {
  const investedAt = row.investedAt?.trim();
  const day =
    (investedAt ? holdingDayFractionFromInvestedAt(investedAt) : null) ??
    row.holdDaysElapsed ??
    0;
  return day != null && Number.isFinite(day) ? day : 0;
}

export function summarizePlanGap(rows: PortfolioGainChartRow[], history: InvestSimHistoryPoint[]): PlanGapSummary {
  let plannedNowEur = 0;
  let actualNowEur = 0;
  let capital = 0;
  let hasPlanned = false;
  let hasActual = false;

  for (const row of rows) {
    if (row.capital <= 0 || row.pnlUnavailable) continue;
    capital += row.capital;
    const series = buildGainPlanSeries(row, history);
    const asOfDay = resolveRowAsOfDay(row);
    const planned = strictSeriesValueAtDay(series, asOfDay, "planned");
    const actual =
      row.pnlEur != null && Number.isFinite(row.pnlEur) && !row.pnlUnavailable
        ? row.pnlEur
        : strictSeriesValueAtDay(series, asOfDay, "actual");
    if (planned != null && Number.isFinite(planned)) {
      plannedNowEur += planned;
      hasPlanned = true;
    }
    if (actual != null && Number.isFinite(actual)) {
      actualNowEur += actual;
      hasActual = true;
    }
  }

  if (!hasPlanned && !hasActual) {
    return { plannedNowEur: null, actualNowEur: null, gapEur: null, gapPct: null };
  }

  const gapEur =
    hasPlanned && hasActual
      ? Math.round((actualNowEur - plannedNowEur) * 100) / 100
      : null;
  const gapPct =
    gapEur != null && capital > 0 ? Math.round((gapEur / capital) * 10000) / 100 : null;

  return {
    plannedNowEur: hasPlanned ? Math.round(plannedNowEur * 100) / 100 : null,
    actualNowEur: hasActual ? Math.round(actualNowEur * 100) / 100 : null,
    gapEur,
    gapPct,
  };
}

function buildHoldDayAggregateSeries(
  rows: PortfolioGainChartRow[],
  seriesByKey: Map<string, GainPlanPoint[]>,
  lang: "it" | "en",
): AggregateGainPlanPoint[] {
  const asOfDay = resolvePortfolioAsOfDay(rows);
  const daySet = new Set<number>();
  for (const series of seriesByKey.values()) {
    for (const p of series) {
      if (p.day <= asOfDay + 0.001) daySet.add(p.day);
    }
  }
  daySet.add(Math.round(asOfDay * 10) / 10);
  const days = [...daySet]
    .filter((d) => d <= asOfDay + 0.001)
    .sort((a, b) => a - b);

  return days.map((day) => {
    const pt = aggregateAtDay(rows, seriesByKey, day, asOfDay);
    return {
      ts: `hold-${day}`,
      label: lang === "it" ? `g${Math.round(day)}` : `d${Math.round(day)}`,
      planned: pt.planned,
      actual: pt.actual,
    };
  });
}

/** Tick-based pulse charts with identical P&L at every snapshot draw a flat line.
 *  Fall back to hold-day aggregation so planned ramps and actual interpolates. */
function isDegeneratePulseAggregateSeries(points: AggregateGainPlanPoint[]): boolean {
  if (points.length < 2) return true;
  const actualVals = new Set<number>();
  const plannedVals = new Set<number>();
  const labels = new Set<string>();
  for (const p of points) {
    labels.add(p.label);
    if (p.actual != null && Number.isFinite(p.actual)) {
      actualVals.add(Math.round(p.actual * 100));
    }
    if (p.planned != null && Number.isFinite(p.planned)) {
      plannedVals.add(Math.round(p.planned * 100));
    }
  }
  if (actualVals.size <= 1 && plannedVals.size <= 1) return true;
  if (points.length <= 3 && actualVals.size <= 1) return true;
  if (points.length <= 2 && labels.size <= 1) return true;
  return false;
}

/** Tick snapshots with wild actual spikes vs live MTM — null out before charting. */
function sanitizeCorruptPulseActuals(
  points: AggregateGainPlanPoint[],
  liveActual: number | null,
): AggregateGainPlanPoint[] {
  if (liveActual == null) return points;
  const tol = Math.max(1200, Math.abs(liveActual) * 3 + 400);
  return points.map((p) => {
    if (p.actual == null || !Number.isFinite(p.actual)) return p;
    if (Math.abs(p.actual - liveActual) > tol) {
      return { ...p, actual: null };
    }
    return p;
  });
}

function sanitizePulseHistory(
  rows: PortfolioGainChartRow[],
  history: InvestSimHistoryPoint[],
): InvestSimHistoryPoint[] {
  const liveByKey = new Map<string, number>();
  for (const row of rows) {
    if (row.pnlEur != null && Number.isFinite(row.pnlEur) && !row.pnlUnavailable) {
      liveByKey.set(row.key, row.pnlEur);
    }
  }
  if (liveByKey.size === 0) return history;

  return history.map((h) => {
    let dirty = false;
    const byTicker = { ...h.byTicker };
    for (const [key, live] of liveByKey) {
      const snap = byTicker[key];
      if (!snap || !Number.isFinite(snap.pnl)) continue;
      const tol = Math.max(1200, Math.abs(live) * 3 + 400);
      if (Math.abs(snap.pnl - live) > tol) {
        delete byTicker[key];
        dirty = true;
      }
    }
    if (!dirty) return h;
    const { actual, hasActual } = actualFromHistoryPoint({ ...h, byTicker }, rows);
    return {
      ...h,
      byTicker,
      pnl: hasActual && actual != null ? actual : h.pnl,
    };
  });
}

/** ~8 hold-days — matches the d0–d7 pulse chart window on the dashboard. */
export const PULSE_GAIN_CHART_HOLD_DAYS = 8;

export type BuildPortfolioGainPlanAggregateOpts = {
  /** Force hold-day axis (d0…dN, now) — keeps Portfolio · Sim loop · Synth aligned. */
  preferHoldDayAxis?: boolean;
  /** Authoritative live terminal — KPI Gain open (MTM) overrides row-sum drift. */
  liveGap?: PlanGapSummary;
};

export function buildPortfolioGainPlanAggregateSeries(
  rows: PortfolioGainChartRow[],
  history: InvestSimHistoryPoint[],
  priorVisitAt: string | null,
  lang: "it" | "en" = "it",
  opts?: BuildPortfolioGainPlanAggregateOpts,
): AggregateGainPlanPoint[] {
  if (!rows.length) return [];

  const cleanHistory = sanitizePulseHistory(rows, history);
  const seriesByKey = new Map<string, GainPlanPoint[]>();
  for (const row of rows) {
    seriesByKey.set(row.key, buildGainPlanSeries(row, cleanHistory));
  }

  const asOfDay = resolvePortfolioAsOfDay(rows);
  const nowMs = Date.now();
  const liveGap = opts?.liveGap ?? summarizePlanGap(rows, cleanHistory);

  if (opts?.preferHoldDayAxis) {
    return alignAggregateGainPlanSeriesToLiveGap(
      buildHoldDayAggregateSeries(rows, seriesByKey, lang),
      liveGap,
      lang,
    );
  }

  const visitMs = priorVisitAt ? Date.parse(priorVisitAt) : NaN;
  const histFiltered = cleanHistory.filter((h) => {
    const ts = Date.parse(h.ts);
    if (!Number.isFinite(ts) || ts > nowMs) return false;
    if (!Number.isFinite(visitMs)) return true;
    return ts >= visitMs - 12 * 3600000;
  });

  if (histFiltered.length >= 2) {
    const tickSeriesRaw = histFiltered.map((h) => {
      let planned = 0;
      let hasPlanned = false;
      const { actual, hasActual } = actualFromHistoryPoint(h, rows);

      for (const row of rows) {
        const investedAt = row.investedAt?.trim();
        const series = seriesByKey.get(row.key) ?? [];
        if (investedAt) {
          const day = holdingDayFractionFromInvestedAt(investedAt, h.ts);
          if (day != null && day >= 0 && day <= asOfDay + 0.001) {
            const ptPlanned = strictSeriesValueAtDay(series, day, "planned");
            if (ptPlanned != null) {
              planned += ptPlanned;
              hasPlanned = true;
            }
          }
        }
      }

      return {
        ts: h.ts,
        label: fmtShortDateTime(h.ts, lang),
        planned: hasPlanned ? Math.round(planned * 100) / 100 : null,
        actual: hasActual ? Math.round(actual! * 100) / 100 : null,
      };
    });
    const tickSeries = sanitizeCorruptPulseActuals(tickSeriesRaw, liveGap.actualNowEur);
    if (
      !isDegeneratePulseAggregateSeries(tickSeries) &&
      !tickPulseSeriesLooksLikeCatchUpSpike(tickSeries, liveGap.actualNowEur)
    ) {
      return alignAggregateGainPlanSeriesToLiveGap(tickSeries, liveGap, lang);
    }
  }

  return alignAggregateGainPlanSeriesToLiveGap(
    buildHoldDayAggregateSeries(rows, seriesByKey, lang),
    liveGap,
    lang,
  );
}

const LIVE_GAP_ALIGN_EPS_EUR = 25;
const LIVE_GAP_ALIGN_MAX_DRIFT_EUR = 250_000;

/** Snap the chart terminal to live MTM so KPI tiles and green line agree. */
export function alignAggregateGainPlanSeriesToLiveGap(
  series: AggregateGainPlanPoint[],
  gap: PlanGapSummary,
  lang: "it" | "en" = "it",
): AggregateGainPlanPoint[] {
  if (series.length === 0) return series;
  if (gap.actualNowEur == null && gap.plannedNowEur == null) return series;

  const reconciled = reconcileAggregateActualTrack(series, gap.actualNowEur);
  const last = reconciled[reconciled.length - 1]!;
  const actualDrift =
    gap.actualNowEur != null && last.actual != null
      ? Math.abs(gap.actualNowEur - last.actual)
      : gap.actualNowEur != null && last.actual == null
        ? LIVE_GAP_ALIGN_EPS_EUR + 1
        : 0;
  const plannedDrift =
    gap.plannedNowEur != null && last.planned != null
      ? Math.abs(gap.plannedNowEur - last.planned)
      : gap.plannedNowEur != null && last.planned == null
        ? LIVE_GAP_ALIGN_EPS_EUR + 1
        : 0;

  if (
    actualDrift > LIVE_GAP_ALIGN_MAX_DRIFT_EUR ||
    plannedDrift > LIVE_GAP_ALIGN_MAX_DRIFT_EUR
  ) {
    return reconciled;
  }

  if (actualDrift < LIVE_GAP_ALIGN_EPS_EUR && plannedDrift < LIVE_GAP_ALIGN_EPS_EUR) {
    return reconciled;
  }

  const nowLabel = lang === "it" ? "ora" : "now";
  const out = [...reconciled];
  out[out.length - 1] = {
    ...last,
    label: nowLabel,
    actual: gap.actualNowEur ?? last.actual,
    planned: gap.plannedNowEur ?? last.planned,
  };
  return out;
}

/**
 * Per-row chart backfill can yield wild mid-series actuals that disagree with
 * live MTM (+49k in KPI vs −7k on d3). Ramp to a monotone 0 → live track when
 * intermediate points sign-flip or diverge sharply from the terminal.
 */
export function reconcileAggregateActualTrack(
  series: AggregateGainPlanPoint[],
  liveActual: number | null,
): AggregateGainPlanPoint[] {
  if (liveActual == null || !Number.isFinite(liveActual) || series.length < 2) {
    return series;
  }

  const lastIdx = series.length - 1;
  const priorActuals = series
    .slice(0, -1)
    .map((p) => p.actual)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const jumpTol = Math.max(2500, Math.abs(liveActual) * 0.2);
  const needsRamp =
    priorActuals.length === 0 ||
    priorActuals.some((v) => {
      if (Math.abs(liveActual) <= jumpTol) return Math.abs(v - liveActual) > jumpTol;
      if (Math.sign(v) !== Math.sign(liveActual) && Math.abs(v) > jumpTol * 0.15) {
        return true;
      }
      return Math.abs(v - liveActual) > Math.abs(liveActual) * 0.55;
    });

  if (!needsRamp) return series;

  return series.map((p, i) => ({
    ...p,
    actual: Math.round((i / lastIdx) * liveActual * 100) / 100,
  }));
}

export function planGapForRow(
  row: PortfolioGainChartRow,
  history: InvestSimHistoryPoint[],
): PlanGapSummary {
  return summarizePlanGap([row], history);
}
