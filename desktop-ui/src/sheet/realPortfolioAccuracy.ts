/**

 * Accuratezza retrospettiva sul portfolio Simulation reale

 * (investment_sim_outcomes.json — round-trip chiusi + segnali BUY/SELL valutati dal backend).

 *

 * Non sono previsioni di accuracy: confronto consiglio vs esito già realizzato.

 */

import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";

import type { ChartPoint } from "../types";

import { confidenceFromN } from "../calibration/calibrationTypes";

import { directionHit } from "./accuracyMetrics";

import type {

  DecisionPrecisionSummary,

  NumericalForecastSummary,

  OperativeSellCoverageBreakdown,

} from "./accuracySummary";

import { buildClosedSuccessMetrics, type ClosedSuccessMetrics } from "./portfolioSuccessBridge";

import { realizedPnlPctFromOutcome } from "./outcomePnlDisplay";

import {

  classifyAdviceOutcome,

} from "./investDecisionSimAdviceCalibration";

import { completionDateToNowOffset } from "./chartNowOffset";



const NUMERICAL_FLAT_BAND_PP = 0.5;



type SignalResult = "success" | "failure" | "flat" | "pending" | "not_applicable";



export type PortfolioSellEnrichContext = {

  simRowByKey: Map<string, Record<string, unknown>>;

  pointsBySeriesKey: Map<string, ChartPoint[]>;

  seriesKeyForSimRow?: (simRow: Record<string, unknown>) => string | null;

};



type OutcomeRowExt = SimOutcomeRow & {

  exit_current_price_usd?: number | null;

  exit_pnl_pct_at_event?: number | null;

  sell_signal_after_move_pct?: number | null;

  entry_affidabilita_pct?: number | null;

};



function baseRowKey(rowKey: string): string {

  return rowKey.split("#cycle")[0] ?? rowKey;

}



function spotUsdFromSimRow(row: Record<string, unknown> | null | undefined): number | null {

  if (!row) return null;

  for (const col of ["Prezzo Corrente ($)", "Current Price ($)", "Prezzo"]) {

    const raw = row[col];

    if (raw == null || raw === "") continue;

    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));

    if (Number.isFinite(n) && n > 0) return n;

  }

  return null;

}



function findSimRowForOutcome(

  row: SimOutcomeRow,

  ctx: PortfolioSellEnrichContext,

): Record<string, unknown> | null {

  const base = baseRowKey(row.row_key);

  const direct = ctx.simRowByKey.get(base) ?? ctx.simRowByKey.get(row.row_key);

  if (direct) return direct;

  const ticker = row.ticker?.trim().toUpperCase();

  if (!ticker) return null;

  for (const [key, simRow] of ctx.simRowByKey) {

    if (baseRowKey(key).startsWith(`${ticker}|`)) return simRow;

    const tk = String(simRow.Ticker ?? "").trim().toUpperCase();

    if (tk === ticker) return simRow;

  }

  return null;

}



function chartPointsForOutcome(

  row: SimOutcomeRow,

  ctx: PortfolioSellEnrichContext,

): ChartPoint[] | null {

  const simRow = findSimRowForOutcome(row, ctx);

  if (!simRow || !ctx.seriesKeyForSimRow) return null;

  const sk = ctx.seriesKeyForSimRow(simRow);

  if (!sk) return null;

  return ctx.pointsBySeriesKey.get(sk) ?? null;

}



function readExitPriceUsd(row: SimOutcomeRow): number | null {

  const ext = row as OutcomeRowExt;

  const direct = ext.exit_current_price_usd;

  if (direct != null && Number.isFinite(direct) && direct > 0) return direct;



  const buy = row.buy_price_usd;

  const pnl =

    ext.exit_pnl_pct_at_event ?? row.pnl_pct ?? null;

  if (buy != null && buy > 0 && pnl != null && Number.isFinite(pnl)) {

    return buy * (1 + pnl / 100);

  }

  return null;

}



function priceAtChartOffset(points: ChartPoint[], targetOffset: number): number | null {

  let best: ChartPoint | null = null;

  let bestDist = Infinity;

  for (const p of points) {

    const px = p.price_storico_usd ?? p.price_usd ?? p.price_model_usd;

    if (px == null || !Number.isFinite(px) || px <= 0) continue;

    const dist = Math.abs(p.offset - targetOffset);

    if (dist < bestDist) {

      bestDist = dist;

      best = p;

    }

  }

  if (!best || bestDist > 2.5) return null;

  const px = best.price_storico_usd ?? best.price_usd ?? best.price_model_usd;

  return px != null && px > 0 ? px : null;

}



function calendarDaysBetween(later: Date, earlier: Date): number {

  const a = new Date(later);

  const b = new Date(earlier);

  a.setHours(0, 0, 0, 0);

  b.setHours(0, 0, 0, 0);

  return Math.round((a.getTime() - b.getTime()) / 86400000);

}



/** Var. ~24h post-uscita da curva storica (offset CD) o spot Simulation. */

export function resolvePortfolioPostExitMovePct(

  row: SimOutcomeRow,

  ctx?: PortfolioSellEnrichContext | null,

): number | null {

  const ext = row as OutcomeRowExt;

  if (

    ext.sell_signal_after_move_pct != null &&

    Number.isFinite(ext.sell_signal_after_move_pct)

  ) {

    return ext.sell_signal_after_move_pct;

  }



  const exitPx = readExitPriceUsd(row);

  if (exitPx == null || exitPx <= 0) return null;



  if (ctx) {

    const chartPts = chartPointsForOutcome(row, ctx);

    const completionDate =

      row.completion_date ||

      findSimRowForOutcome(row, ctx)?.["Completion Date"] ||

      null;

    const exitTs = row.exit_ts;

    if (chartPts?.length && completionDate && exitTs) {

      const nowOff = completionDateToNowOffset(completionDate);

      const exitAt = new Date(exitTs);

      if (nowOff != null && Number.isFinite(exitAt.getTime())) {

        const today = new Date();

        today.setHours(0, 0, 0, 0);

        const daysSinceExit = calendarDaysBetween(today, exitAt);

        const offsetAtExit = nowOff + daysSinceExit;

        const pxExit = priceAtChartOffset(chartPts, offsetAtExit);

        const pxAfter = priceAtChartOffset(chartPts, offsetAtExit + 1);

        if (pxExit != null && pxAfter != null && pxExit > 0) {

          return Math.round(((pxAfter - pxExit) / pxExit) * 1000) / 10;

        }

      }

    }



    const simRow = findSimRowForOutcome(row, ctx);

    const spot = spotUsdFromSimRow(simRow);

    if (spot != null && spot > 0) {

      return Math.round(((spot - exitPx) / exitPx) * 1000) / 10;

    }

  }



  return null;

}



function adviceOutcomeToSignal(outcome: ReturnType<typeof classifyAdviceOutcome>): SignalResult {

  if (outcome === "good") return "success";

  if (outcome === "bad") return "failure";

  if (outcome === "pending") return "flat";

  return "pending";

}



export function resolvePortfolioSellSignalResult(

  row: SimOutcomeRow,

  ctx?: PortfolioSellEnrichContext | null,

): SignalResult {

  const hasExit = Boolean(row.exit_ts || row.cd_passed);

  if (!hasExit) return "not_applicable";



  const backend = row.sell_signal_result;

  if (backend === "success" || backend === "failure" || backend === "flat") {

    return backend;

  }



  const movePct = resolvePortfolioPostExitMovePct(row, ctx);

  if (movePct == null) return "pending";

  return adviceOutcomeToSignal(classifyAdviceOutcome("sell", movePct));

}



function isEvaluableSignal(v: unknown): v is "success" | "failure" | "flat" {

  return v === "success" || v === "failure" || v === "flat";

}



function signalToGoodBad(result: "success" | "failure" | "flat"): "good" | "bad" | null {

  if (result === "success") return "good";

  if (result === "failure") return "bad";

  return null;

}



function precisionFromSignals(

  rows: SimOutcomeRow[],

  field: "buy_signal_result" | "sell_signal_result",

  sellCtx?: PortfolioSellEnrichContext | null,

): { good: number; bad: number; pending: number } {

  let good = 0;

  let bad = 0;

  let pending = 0;

  for (const r of rows) {

    if (field === "sell_signal_result") {

      const resolved = resolvePortfolioSellSignalResult(r, sellCtx);

      if (resolved === "not_applicable" || resolved === "pending") {

        if (resolved === "pending") pending += 1;

        continue;

      }

      if (!isEvaluableSignal(resolved)) continue;

      const scored = signalToGoodBad(resolved);

      if (scored === "good") good += 1;

      else if (scored === "bad") bad += 1;

      else pending += 1;

      continue;

    }



    const raw = r[field];

    if (!isEvaluableSignal(raw)) continue;

    const scored = signalToGoodBad(raw);

    if (scored === "good") good += 1;

    else if (scored === "bad") bad += 1;

    else pending += 1;

  }

  return { good, bad, pending };

}



function precisionCardFromCounts(

  good: number,

  bad: number,

  labelKey: "buy" | "sell",

): DecisionPrecisionSummary["buy"] {

  const n = good + bad;

  return {

    labelKey,

    valuePct: n > 0 ? Math.round((good / n) * 1000) / 10 : null,

    maePct: null,

    n,

    good,

    bad,

    confidence: confidenceFromN(n),

  };

}



/** (i) BUY/SELL — segnali valutati post-hoc su posizioni Simulation reali. */

export function summarizeRealPortfolioSignalAccuracy(

  rows: SimOutcomeRow[],

  sellCtx?: PortfolioSellEnrichContext | null,

): DecisionPrecisionSummary {

  const buy = precisionFromSignals(rows, "buy_signal_result");

  const sell = precisionFromSignals(rows, "sell_signal_result", sellCtx);

  return {

    buy: precisionCardFromCounts(buy.good, buy.bad, "buy"),

    sell: precisionCardFromCounts(sell.good, sell.bad, "sell"),

    unverifiedSellEvitaCount: sell.pending,

  };

}



/** (ii) Segno previsto vs P&L realizzato su round-trip chiusi. */

export function summarizeRealPortfolioNumericalAccuracy(

  closedRows: SimOutcomeRow[],

): NumericalForecastSummary | null {

  let signHits = 0;

  let signN = 0;

  const absErrors: number[] = [];



  for (const r of closedRows) {

    const actual = realizedPnlPctFromOutcome(r);

    const expected = r.entry_pred7_pp ?? r.pred7_pp ?? null;

    if (actual == null || !Number.isFinite(actual)) continue;



    if (expected != null && Number.isFinite(expected)) {

      if (

        directionHit(expected, actual, NUMERICAL_FLAT_BAND_PP) ||

        (Math.abs(expected) < NUMERICAL_FLAT_BAND_PP &&

          Math.abs(actual) < NUMERICAL_FLAT_BAND_PP)

      ) {

        signHits += 1;

      }

      signN += 1;

      absErrors.push(Math.abs(actual - expected));

    } else if (typeof r.pred_direction_hit === "boolean") {

      if (r.pred_direction_hit) signHits += 1;

      signN += 1;

    }

  }



  if (signN === 0 && absErrors.length === 0) return null;



  const maeN = absErrors.length;

  const maePct =

    maeN > 0

      ? Math.round((absErrors.reduce((a, b) => a + b, 0) / maeN) * 10) / 10

      : null;



  return {

    signHit: {

      labelKey: "signHit",

      valuePct: signN > 0 ? Math.round((signHits / signN) * 1000) / 10 : null,

      maePct: null,

      n: signN,

      confidence: confidenceFromN(signN),

    },

    mae: {

      labelKey: "mae",

      valuePct: null,

      maePct,

      n: maeN,

      confidence: confidenceFromN(maeN),

    },

  };

}



export type RealPortfolioAccuracySummary = {

  decision: DecisionPrecisionSummary;

  numerical: NumericalForecastSummary | null;

  closed: ClosedSuccessMetrics | null;

  /** Righe totali nel ledger outcomes (aperte + chiuse). */

  outcomeRowCount: number;

  closedRowCount: number;

  /** Post-exit move coverage for operative SELL column. */

  sellCoverage: OperativeSellCoverageBreakdown;

};



function readOutcomePplanPct(row: SimOutcomeRow): number | null {

  const ext = row as OutcomeRowExt;

  const raw = ext.entry_affidabilita_pct ?? row.affidabilita_pct ?? null;

  if (raw == null || !Number.isFinite(Number(raw))) return null;

  return Number(raw);

}



export function summarizeRealPortfolioSellCoverage(

  rows: SimOutcomeRow[],

  sellCtx?: PortfolioSellEnrichContext | null,

): OperativeSellCoverageBreakdown {

  let executedCount = 0;

  let scoredCount = 0;

  let missingPplanCount = 0;

  let missingPostMoveCount = 0;

  let pendingFlatCount = 0;



  for (const r of rows) {

    const hasExit = Boolean(r.exit_ts || r.cd_passed);

    if (!hasExit) continue;

    executedCount += 1;



    if (readOutcomePplanPct(r) == null) missingPplanCount += 1;



    const resolved = resolvePortfolioSellSignalResult(r, sellCtx);

    if (resolved === "success" || resolved === "failure") {

      scoredCount += 1;

      continue;

    }

    if (resolved === "pending") {

      if (resolvePortfolioPostExitMovePct(r, sellCtx) == null) {

        missingPostMoveCount += 1;

      } else {

        pendingFlatCount += 1;

      }

      continue;

    }

    if (resolved === "flat") pendingFlatCount += 1;

  }



  return {

    executedCount,

    scoredCount,

    missingPplanCount,

    missingPostMoveCount,

    pendingFlatCount,

  };

}



export function buildRealPortfolioAccuracySummary(

  allRows: SimOutcomeRow[],

  closedRows: SimOutcomeRow[],

  sellCtx?: PortfolioSellEnrichContext | null,

): RealPortfolioAccuracySummary {

  return {

    decision: summarizeRealPortfolioSignalAccuracy(allRows, sellCtx),

    numerical: summarizeRealPortfolioNumericalAccuracy(closedRows),

    closed: buildClosedSuccessMetrics(closedRows),

    outcomeRowCount: allRows.length,

    closedRowCount: closedRows.length,

    sellCoverage: summarizeRealPortfolioSellCoverage(allRows, sellCtx),

  };

}


