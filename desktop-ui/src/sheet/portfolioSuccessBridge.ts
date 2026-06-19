import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import {
  extractTradeStatsFromClosedOutcomes,
  type TradeOutcomeStats,
} from "./portfolioDiversificationLab";
import type { MissedOppImprovementSummary } from "./missedOpportunityAudit";
import type { ComparisonDeal } from "./threePortfolioCompare";

/** Esiti round-trip chiusi (investment_sim_outcomes.json). */
export type ClosedSuccessMetrics = {
  winRatePct: number | null;
  winCount: number;
  lossCount: number;
  sampleSize: number;
  expectancyEurPerTrade: number | null;
  realizedDailyPnlEur: number | null;
  lowSample: boolean;
};

/** Performance giornaliera vs raccomandazioni (Missed opportunity / Performance tab). */
export type TodaySuccessMetrics = {
  pnlActualEur: number | null;
  capturePct: number | null;
  capturePctFair: number | null;
  gapVsRecEur: number | null;
  gapVsFairRecEur: number | null;
  pnlRecommendationsEur: number | null;
  pnlFairRecommendationsEur: number | null;
  daysTracked: number;
};

export type PortfolioSuccessBridge = {
  closed: ClosedSuccessMetrics | null;
  today: TodaySuccessMetrics | null;
};

const LOW_SAMPLE_N = 8;

export function buildClosedSuccessMetrics(
  closedRows: SimOutcomeRow[],
): ClosedSuccessMetrics | null {
  const stats: TradeOutcomeStats | null = extractTradeStatsFromClosedOutcomes(closedRows);
  if (!stats) return null;
  return {
    winRatePct: Math.round(stats.winRate * 1000) / 10,
    winCount: stats.winCount,
    lossCount: stats.lossCount,
    sampleSize: stats.sampleSize,
    expectancyEurPerTrade: stats.expectancyEurPerTrade,
    realizedDailyPnlEur: stats.realizedDailyPnlEur,
    lowSample: stats.sampleSize < LOW_SAMPLE_N,
  };
}

export function buildTodaySuccessMetrics(
  improvement: MissedOppImprovementSummary,
  pnlActualEur: number | null,
  pnlRecommendationsEur: number | null,
  pnlFairRecommendationsEur: number | null,
): TodaySuccessMetrics {
  return {
    pnlActualEur,
    capturePct: improvement.capturePctToday,
    capturePctFair: improvement.capturePctFairToday,
    gapVsRecEur: improvement.gapVsRecToday,
    gapVsFairRecEur: improvement.gapVsFairRecToday,
    pnlRecommendationsEur,
    pnlFairRecommendationsEur,
    daysTracked: improvement.daysTracked,
  };
}

export function mergePortfolioSuccessBridge(
  closed: ClosedSuccessMetrics | null,
  today: TodaySuccessMetrics | null,
): PortfolioSuccessBridge {
  return { closed, today };
}

/** Realized win rate on closed round-trips whose ticker/rowKey is in the deal universe. */
export type DealUniverseRealizedSuccess = {
  winRatePct: number | null;
  sampleSize: number;
  winCount: number;
  lossCount: number;
};

export function computeRealizedSuccessForDeals(
  closedRows: SimOutcomeRow[],
  deals: ComparisonDeal[],
): DealUniverseRealizedSuccess {
  if (deals.length === 0 || closedRows.length === 0) {
    return { winRatePct: null, sampleSize: 0, winCount: 0, lossCount: 0 };
  }
  const rowKeys = new Set(deals.map((d) => d.rowKey));
  const tickers = new Set(deals.map((d) => d.ticker.toUpperCase()));
  const filtered = closedRows.filter((r) => {
    const rk = String(r.row_key ?? "").trim();
    const tk = String(r.ticker ?? "")
      .trim()
      .toUpperCase();
    if (rk && rowKeys.has(rk)) return true;
    return Boolean(tk && tickers.has(tk));
  });
  const stats: TradeOutcomeStats | null = extractTradeStatsFromClosedOutcomes(filtered);
  if (!stats) {
    return { winRatePct: null, sampleSize: 0, winCount: 0, lossCount: 0 };
  }
  return {
    winRatePct: Math.round(stats.winRate * 1000) / 10,
    sampleSize: stats.sampleSize,
    winCount: stats.winCount,
    lossCount: stats.lossCount,
  };
}
