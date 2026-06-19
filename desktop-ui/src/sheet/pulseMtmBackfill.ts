import { looksLikeOpenMtmCatchUpCliff } from "./decisionSimPnlResolve";
import type { PortfolioGainChartRow } from "../components/PortfolioGainPlanChart";
import type { ChartPoint } from "../types";
import { interpolateAtOffset } from "./chartNowOffset";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import { holdingDayFractionFromInvestedAt } from "./investSimStorage";
import { tickerDailyCloseSeries } from "./simulationPosition";

function roundDayKey(d: number): number {
  return Math.round(d * 1000) / 1000;
}

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseCompletionDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!s || s === "—") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Chart offset (days from CD) at a hold-day after entry. */
export function chartNowOffsetAtHoldDay(
  completionDate: unknown,
  investedAtIso: string,
  holdDay: number,
): number | null {
  const cd = parseCompletionDate(completionDate);
  if (!cd) return null;
  const startMs = Date.parse(investedAtIso);
  if (!Number.isFinite(startMs)) return null;
  const probe = new Date(startMs + holdDay * 86_400_000);
  probe.setHours(0, 0, 0, 0);
  cd.setHours(0, 0, 0, 0);
  return Math.round((probe.getTime() - cd.getTime()) / 86_400_000);
}

export function chartPriceAtHoldDay(
  chartPoints: ChartPoint[] | null | undefined,
  completionDate: unknown,
  investedAtIso: string,
  holdDay: number,
): number | null {
  if (!chartPoints?.length) return null;
  const off = chartNowOffsetAtHoldDay(completionDate, investedAtIso, holdDay);
  if (off == null) return null;
  const series = chartPoints
    .map((p) => ({
      offset: p.offset,
      y: (p.price_storico_usd ?? p.price_usd) as number | null | undefined,
    }))
    .filter((p) => p.y != null && Number.isFinite(p.y)) as { offset: number; y: number }[];
  if (!series.length) return null;
  return interpolateAtOffset(series, off);
}

function resolveEntryBuyUsd(row: PortfolioGainChartRow): number | null {
  if (row.buyPriceUsd != null && row.buyPriceUsd > 0) return row.buyPriceUsd;
  if (!row.investedAt?.trim() || !row.simRow) return null;
  const px = chartPriceAtHoldDay(
    row.chartPoints,
    row.simRow["Completion Date"],
    row.investedAt,
    0,
  );
  return px != null && px > 0 ? px : null;
}

function pnlFromMarkToMarket(capital: number, buyUsd: number, priceUsd: number): number {
  if (capital <= 0 || buyUsd <= 0 || priceUsd <= 0) return 0;
  return roundEur((capital / buyUsd) * priceUsd - capital);
}

/** Merge chart-derived cumulative P&L anchors at integer hold days. */
export function backfillActualAnchorsFromChart(
  row: PortfolioGainChartRow,
  todayDay: number,
  out: Map<number, number>,
): void {
  const investedAtIso = row.investedAt?.trim();
  const capital = row.capital;
  if (!investedAtIso || capital <= 0 || !row.simRow || !row.chartPoints?.length) return;

  const buy = resolveEntryBuyUsd(row);
  if (buy == null) return;

  const maxInt = Math.max(0, Math.min(Math.ceil(todayDay), Math.floor(todayDay) + 1));
  for (let d = 0; d <= maxInt; d += 1) {
    if (d > todayDay + 0.001) break;
    const price = chartPriceAtHoldDay(
      row.chartPoints,
      row.simRow["Completion Date"],
      investedAtIso,
      d,
    );
    if (price == null) continue;
    out.set(roundDayKey(d), pnlFromMarkToMarket(capital, buy, price));
  }
}

/** Daily closes from portfolio history — prefer value − capital over stale snap.pnl. */
export function backfillActualAnchorsFromDailyCloses(
  row: PortfolioGainChartRow,
  history: InvestSimHistoryPoint[],
  todayDay: number,
  out: Map<number, number>,
): void {
  const investedAtIso = row.investedAt?.trim();
  const capital = row.capital;
  if (!investedAtIso || capital <= 0) return;

  for (const pt of tickerDailyCloseSeries(history, row.key, investedAtIso)) {
    const d = holdingDayFractionFromInvestedAt(investedAtIso, pt.ts);
    if (d == null || d < 0 || d > todayDay + 0.001) continue;
    out.set(roundDayKey(d), roundEur(pt.value - capital));
  }
}

/**
 * When all pre-today anchors sit near €0 but live MTM is large, spread the
 * open-MTM catch-up across hold days instead of a vertical cliff at `now`.
 */
export function rampStaleFlatAnchorsToLive(
  anchors: Map<number, number>,
  todayDay: number,
  livePnl: number | null,
): void {
  if (livePnl == null || !Number.isFinite(livePnl) || todayDay <= 0.05) return;

  if (!anchors.has(0)) {
    anchors.set(0, 0);
  }

  const priorKeys = [...anchors.keys()]
    .filter((d) => d < todayDay - 0.02)
    .sort((a, b) => a - b);
  const maxPriorAbs = priorKeys.reduce(
    (m, k) => Math.max(m, Math.abs(anchors.get(k) ?? 0)),
    0,
  );
  const nearZeroTol = Math.max(50, Math.abs(livePnl) * 0.08);
  const jumpTol = Math.max(120, Math.abs(livePnl) * 0.12);
  if (maxPriorAbs > nearZeroTol || Math.abs(livePnl) < jumpTol) return;

  // Drop fractional hold-day keys from stale zero history — otherwise they
  // survive the integer ramp grid and keep mid-chart flat at €0.
  for (const k of [...anchors.keys()]) {
    if (k <= todayDay + 0.001) anchors.delete(k);
  }

  const steps = Math.max(2, Math.ceil(todayDay));
  for (let i = 0; i <= steps; i += 1) {
    const d = roundDayKey((i / steps) * todayDay);
    if (d > todayDay + 0.001) break;
    anchors.set(d, roundEur((i / steps) * livePnl));
  }
}

/** Full anchor map for one row — history closes, chart path, live terminal. */
export function buildMtmBackfillActualAnchors(
  row: PortfolioGainChartRow,
  history: InvestSimHistoryPoint[],
  todayDay: number,
  livePnl: number | null,
): Map<number, number> {
  const anchors = new Map<number, number>();
  const investedAtIso = row.investedAt?.trim() || null;

  if (investedAtIso && !anchors.has(0)) {
    anchors.set(0, 0);
  }
  if (row.buyPriceUsd != null && row.buyPriceUsd > 0) {
    anchors.set(0, 0);
  }

  backfillActualAnchorsFromDailyCloses(row, history, todayDay, anchors);

  if (investedAtIso) {
    for (const h of history) {
      const snap = h.byTicker[row.key];
      if (!snap) continue;
      const d = holdingDayFractionFromInvestedAt(investedAtIso, h.ts);
      if (d == null || d < 0 || d > todayDay + 0.001) continue;
      const fromValue =
        snap.value > 0 && row.capital > 0
          ? roundEur(snap.value - row.capital)
          : roundEur(snap.pnl);
      const key = roundDayKey(d);
      const prev = anchors.get(key);
      if (prev != null && Math.abs(prev) > Math.abs(fromValue) + 0.5) continue;
      anchors.set(key, fromValue);
    }
  }

  backfillActualAnchorsFromChart(row, todayDay, anchors);

  rampStaleFlatAnchorsToLive(anchors, todayDay, livePnl);

  if (livePnl != null) {
    anchors.set(roundDayKey(todayDay), livePnl);
  }

  return anchors;
}

export type AggregateGainPlanPoint = {
  ts: string;
  label: string;
  planned: number | null;
  actual: number | null;
};

/** Tick-based pulse series missing open MTM until the live terminal point. */
export function tickPulseSeriesLooksLikeCatchUpSpike(
  points: AggregateGainPlanPoint[],
  liveActual: number | null,
): boolean {
  if (liveActual == null || !Number.isFinite(liveActual) || points.length < 2) {
    return false;
  }

  const actuals = points
    .map((p) => p.actual)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (actuals.length < 2) return false;

  const last = actuals[actuals.length - 1]!;
  const prior = actuals.slice(0, -1);
  const lastPrior = prior[prior.length - 1] ?? last;

  if (looksLikeOpenMtmCatchUpCliff(last, liveActual, last)) {
    return true;
  }

  if (Math.abs(last - liveActual) > 40) return false;

  const nearZeroTol = Math.max(80, Math.abs(liveActual) * 0.12);
  const priorNearZero = prior.every((v) => Math.abs(v) <= nearZeroTol);
  const jumpTol = Math.max(350, Math.abs(liveActual) * 0.2);
  const jump = Math.abs(liveActual - lastPrior) >= jumpTol;

  return priorNearZero && jump;
}
