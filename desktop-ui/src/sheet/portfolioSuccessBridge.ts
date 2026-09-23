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

/** Per-ticker breakdown used by the weighted realized-success card. */
export type TickerRealizedBreakdown = {
  ticker: string;
  /** Capital allocated to this ticker in the current portfolio (€). */
  capitalEur: number;
  /** Capital share of the total portfolio (0–100). */
  capitalSharePct: number;
  /** Historical win rate for this ticker across ALL closed rows (0–100). */
  historicalWinRatePct: number | null;
  /** Number of closed round-trips for this ticker in history. */
  historicalN: number;
};

/** Realized win rate on closed round-trips whose ticker/rowKey is in the deal universe. */
export type DealUniverseRealizedSuccess = {
  winRatePct: number | null;
  sampleSize: number;
  winCount: number;
  lossCount: number;
  /** Capital-weighted realized win rate — weights each ticker by its allocation. */
  weightedWinRatePct: number | null;
  /** Delta pp between weighted and equal win rate. */
  weightingImpactPp: number | null;
  /** Per-ticker detail for the weighted calculation. */
  tickerBreakdown: TickerRealizedBreakdown[];
};

/** Closed outcomes whose row_key or ticker belongs to the deal universe. */
export function closedRowsInDealUniverse(
  closedRows: SimOutcomeRow[],
  deals: ComparisonDeal[],
): SimOutcomeRow[] {
  if (deals.length === 0) return [];
  const keys = new Set(deals.map((d) => d.rowKey));
  const tickers = new Set(deals.map((d) => d.ticker.toUpperCase()));
  return closedRows.filter((r) => {
    const rk =
      r.row_key ?? `${String(r.ticker ?? "").trim()}|${r.completion_date ?? ""}`;
    if (keys.has(rk)) return true;
    const tk = String(r.ticker ?? "").trim().toUpperCase();
    return tk.length > 0 && tickers.has(tk);
  });
}

export function computeRealizedSuccessForDeals(
  closedRows: SimOutcomeRow[],
  deals: ComparisonDeal[],
  /** Optional capital per ticker — from scenario.capByTicker. */
  capByTicker?: Record<string, number> | Map<string, number>,
): DealUniverseRealizedSuccess {
  const empty: DealUniverseRealizedSuccess = {
    winRatePct: null,
    sampleSize: 0,
    winCount: 0,
    lossCount: 0,
    weightedWinRatePct: null,
    weightingImpactPp: null,
    tickerBreakdown: [],
  };
  if (closedRows.length === 0) return empty;

  const universeRows =
    deals.length > 0 ? closedRowsInDealUniverse(closedRows, deals) : closedRows;

  const allStats: TradeOutcomeStats | null =
    extractTradeStatsFromClosedOutcomes(universeRows);
  if (!allStats) return empty;

  const equalWinRatePct = Math.round(allStats.winRate * 1000) / 10;

  if (deals.length === 0) {
    return {
      winRatePct: equalWinRatePct,
      sampleSize: allStats.sampleSize,
      winCount: allStats.winCount,
      lossCount: allStats.lossCount,
      weightedWinRatePct: null,
      weightingImpactPp: null,
      tickerBreakdown: [],
    };
  }

  const capEntries: [string, number][] =
    capByTicker instanceof Map
      ? [...capByTicker.entries()]
      : Object.entries(capByTicker ?? {});
  const totalCap = capEntries.reduce((s, [, v]) => s + v, 0);

  // Per-ticker historical win rate from universe-filtered closes.
  const winsByTicker = new Map<string, { wins: number; total: number }>();
  for (const r of universeRows) {
    const tk = String(r.ticker ?? "").trim().toUpperCase();
    if (!tk) continue;
    const isWin = r.pnl_eur != null && r.pnl_eur > 0;
    const existing = winsByTicker.get(tk) ?? { wins: 0, total: 0 };
    winsByTicker.set(tk, {
      wins: existing.wins + (isWin ? 1 : 0),
      total: existing.total + 1,
    });
  }

  let weightedWinRatePct: number | null = null;
  if (totalCap > 0) {
    let weightedSum = 0;
    let weightSum = 0;
    for (const [tk, cap] of capEntries) {
      if (cap <= 0) continue;
      const tkUp = tk.toUpperCase();
      const hist = winsByTicker.get(tkUp);
      if (!hist || hist.total === 0) continue;
      const tickerWinRate = hist.wins / hist.total;
      weightedSum += tickerWinRate * cap;
      weightSum += cap;
    }
    if (weightSum > 0) {
      weightedWinRatePct = Math.round((weightedSum / weightSum) * 1000) / 10;
    }
  }

  const weightingImpactPp =
    weightedWinRatePct != null ? Math.round((weightedWinRatePct - equalWinRatePct) * 10) / 10 : null;

  // Build per-ticker breakdown sorted by capital descending
  const tickerBreakdown: TickerRealizedBreakdown[] = [];
  for (const [tk, cap] of capEntries) {
    if (cap <= 0) continue;
    const tkUp = tk.toUpperCase();
    const hist = winsByTicker.get(tkUp);
    tickerBreakdown.push({
      ticker: tkUp,
      capitalEur: Math.round(cap),
      capitalSharePct: totalCap > 0 ? Math.round((cap / totalCap) * 1000) / 10 : 0,
      historicalWinRatePct: hist && hist.total > 0 ? Math.round((hist.wins / hist.total) * 1000) / 10 : null,
      historicalN: hist?.total ?? 0,
    });
  }
  tickerBreakdown.sort((a, b) => b.capitalEur - a.capitalEur);

  return {
    winRatePct: equalWinRatePct,
    sampleSize: allStats.sampleSize,
    winCount: allStats.winCount,
    lossCount: allStats.lossCount,
    weightedWinRatePct,
    weightingImpactPp,
    tickerBreakdown,
  };
}
