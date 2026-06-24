/**
 * Single authoritative source for live position P&L + price-age data.
 *
 * All components that display P&L totals or 24h gains should derive their
 * data from `buildLivePositionSnapshot` (called once per simTable update)
 * rather than running their own parallel pipelines.
 *
 * Priority chain for pnlPct24h (highest first):
 *   1. ev.pnlPct24h  — from TickerSimEvaluation (loop tick, most recent)
 *   2. dailyChangePctFromRow — Var. Giorn. % from the Simulation sheet (Yahoo)
 *   3. null
 *
 * Priority chain for pnlPct total:
 *   1. paper.lastMarkPct (paper sim book)
 *   2. ev.pnlPct (evaluation tick mark)
 *   3. null
 */

import type { SheetTable } from "../types";
import type { PaperPosition, TickerSimEvaluation } from "./investDecisionSimLoop";
import {
  dailyChangePctFromRow,
  pnlEurFromDailyPct,
  priceRefreshAtFromRow,
} from "./simulationPosition";
import { sanitizePaperMovePct } from "./investDecisionSimExperiment";
import { buildSimRowByKeyMap } from "./investSimKeys";

export type LivePositionEntry = {
  key: string;
  ticker: string;
  /** Actual deployed capital (paper = pos.capital, real = from inputs). */
  capital: number;
  /** Total MTM P&L in €. */
  pnlEur: number;
  /** Total MTM P&L %. */
  pnlPct: number | null;
  /** 24h P&L in € (null when no price data available). */
  pnlEur24h: number | null;
  /** 24h P&L % (null when no price data available). */
  pnlPct24h: number | null;
  /** ISO timestamp of the most recent price refresh for this row. */
  priceRefreshAt: string | null;
};

export type LivePositionSnapshot = {
  entries: LivePositionEntry[];
  /** ISO of the most recent priceRefreshAt across all entries. */
  latestPriceRefreshAt: string | null;
  /** Age in hours of the most recent price data. null when unknown. */
  priceAgeHours: number | null;
  /** Aggregate totals */
  totalPnlEur: number;
  totalPnlEur24h: number | null;
  totalCapital: number;
  /** How many positions contributed a non-null 24h figure. */
  covered24h: number;
  /** ISO of when this snapshot was computed. */
  computedAt: string;
};

function pnlEurFromPct(capital: number, pct: number | null): number {
  if (capital <= 0 || pct == null || !Number.isFinite(pct)) return 0;
  return Math.round(((capital * pct) / 100) * 100) / 100;
}

/**
 * Build a unified snapshot from the paper sim book + latest evaluation tick.
 *
 * @param simTable   Raw Simulation sheet (for Var. Giorn. % and priceRefreshAt)
 * @param paperPortfolio  Open paper positions
 * @param latestEvaluations  Evaluations from the latest DecisionSim tick
 */
export function buildLivePositionSnapshot(
  simTable: SheetTable | null | undefined,
  paperPortfolio: PaperPosition[],
  latestEvaluations: TickerSimEvaluation[],
): LivePositionSnapshot {
  const computedAt = new Date().toISOString();
  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const evalByKey = new Map(latestEvaluations.map((e) => [e.key, e]));

  const entries: LivePositionEntry[] = [];
  let totalPnlEur = 0;
  let totalPnlEur24hAcc = 0;
  let totalCapital = 0;
  let covered24h = 0;
  let latestPriceMs = 0;

  for (const pos of paperPortfolio) {
    const simRow = rowByKey.get(pos.key);
    const ev = evalByKey.get(pos.key);
    const capital = pos.capital;

    // --- Total P&L ---
    const markPct =
      sanitizePaperMovePct(ev?.pnlPct) ??
      sanitizePaperMovePct(pos.lastMarkPct) ??
      null;
    const pnlEur = pnlEurFromPct(capital, markPct);
    const pnlPct = markPct;

    // --- 24h P&L ---
    let pnlPct24h: number | null = null;
    let pnlEur24h: number | null = null;

    const evalDaily = ev?.pnlPct24h;
    if (evalDaily != null && Number.isFinite(evalDaily)) {
      pnlPct24h = evalDaily;
      pnlEur24h = pnlEurFromPct(capital, pnlPct24h);
    } else if (simRow) {
      const dailyPct = dailyChangePctFromRow(simRow);
      if (dailyPct != null && Number.isFinite(dailyPct)) {
        pnlPct24h = Math.round(dailyPct * 100) / 100;
        const valueNow = capital + pnlEur;
        pnlEur24h =
          valueNow > 0
            ? pnlEurFromDailyPct(valueNow, dailyPct)
            : pnlEurFromPct(capital, pnlPct24h);
      }
    }

    // --- Price timestamp ---
    const priceRefreshAt = simRow ? priceRefreshAtFromRow(simRow) : null;
    if (priceRefreshAt) {
      const ms = Date.parse(priceRefreshAt);
      if (Number.isFinite(ms) && ms > latestPriceMs) latestPriceMs = ms;
    }

    entries.push({
      key: pos.key,
      ticker: pos.ticker,
      capital,
      pnlEur,
      pnlPct,
      pnlEur24h,
      pnlPct24h,
      priceRefreshAt,
    });

    totalCapital += capital;
    totalPnlEur += pnlEur;
    if (pnlEur24h != null) {
      totalPnlEur24hAcc += pnlEur24h;
      covered24h++;
    }
  }

  totalPnlEur = Math.round(totalPnlEur * 100) / 100;
  totalPnlEur24hAcc = Math.round(totalPnlEur24hAcc * 100) / 100;

  const latestPriceRefreshAt = latestPriceMs > 0 ? new Date(latestPriceMs).toISOString() : null;
  const priceAgeHours =
    latestPriceMs > 0
      ? Math.round(((Date.now() - latestPriceMs) / 3_600_000) * 10) / 10
      : null;

  return {
    entries,
    latestPriceRefreshAt,
    priceAgeHours,
    totalPnlEur,
    totalPnlEur24h: covered24h > 0 ? totalPnlEur24hAcc : null,
    totalCapital,
    covered24h,
    computedAt,
  };
}

/**
 * Format a price-age note for chart subtitles.
 * Returns null when age < 1h (fresh enough, no warning needed).
 */
export function priceAgeLabel(
  priceAgeHours: number | null,
  lang: "it" | "en",
): string | null {
  if (priceAgeHours == null || priceAgeHours < 1) return null;
  const label =
    priceAgeHours < 24
      ? `${Math.round(priceAgeHours)}h`
      : `${Math.round(priceAgeHours / 24)}d`;
  return lang === "it"
    ? `prezzi aggiornati ${label} fa`
    : `prices ${label} old`;
}
