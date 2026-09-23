import { describe, expect, it } from "vitest";
import {
  breakevenWinRateForPortfolio,
  closedPnlStatsForUniverse,
  expectedPnlEurAtWinRate,
  historicalClosedWinRate,
  portfolioEvAtWinRate,
} from "./threeExperimentBreakeven";
import type { ComparisonDeal, PortfolioAllocation } from "./threePortfolioCompare";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";

function deal(winPct: number, lossPct: number): ComparisonDeal {
  return {
    ticker: "TST",
    rowKey: "TST|cd",
    label: "TST",
    cells: {
      clinicalPhase: "P2",
      clinicalIndication: "Onc",
      sdsBucket: "Mid",
      pplanBucket: "50-70%",
    },
    sdsValue: 50,
    winRate: 0.6,
    rawWinRate: 0.6,
    confidence: "medium",
    winRateDimension: "clinicalPhase",
    winRateN: 10,
    payoffWinPct: winPct,
    payoffLossPct: lossPct,
    payoffSource: "fallback",
    lossRisk: null,
    riskScore: null,
    realizedReturnPct: null,
    realizedReturnPct24h: null,
  };
}

function alloc(cap: number): PortfolioAllocation {
  return {
    capByTicker: { TST: cap },
    evByTicker: {},
    realizedEurByTicker: {},
    totalCapitalEur: cap,
    totalEvEur: 0,
    totalRealizedEur: 0,
    positionsCount: 1,
    realizedPositionsCount: 0,
  };
}

describe("threeExperimentBreakeven", () => {
  it("computes expected P&L at win rate", () => {
    const d = deal(20, -10);
    expect(expectedPnlEurAtWinRate(d, 1000, 1)).toBeCloseTo(200, 0);
    expect(expectedPnlEurAtWinRate(d, 1000, 0)).toBeCloseTo(-100, 0);
  });

  it("finds breakeven win rate", () => {
    const d = deal(20, -10);
    const be = breakevenWinRateForPortfolio([d], alloc(1000));
    expect(be).not.toBeNull();
    expect(be!).toBeCloseTo(1 / 3, 2);
    expect(portfolioEvAtWinRate([d], alloc(1000), be!)).toBeGreaterThanOrEqual(-1);
  });

  it("historicalClosedWinRate uses pnl > -2% convention", () => {
    const rows = [
      { pnl_pct: 5 },
      { pnl_pct: -1 },
      { pnl_pct: -10 },
      { pnl_pct: 0 },
    ] as SimOutcomeRow[];
    const h = historicalClosedWinRate(rows);
    expect(h.n).toBe(4);
    expect(h.wins).toBe(3);
    expect(h.pct).toBe(75);
  });

  it("closedPnlStatsForUniverse sums pnl_eur and counts wins", () => {
    const deals = [deal(20, -10)];
    const rows = [
      { ticker: "TST", row_key: "TST|cd", pnl_eur: 120, pnl_pct: 8 },
      { ticker: "TST", row_key: "TST|cd", pnl_eur: -40, pnl_pct: -3 },
      { ticker: "OTH", row_key: "OTH|cd", pnl_eur: 50, pnl_pct: 5 },
    ] as SimOutcomeRow[];
    const stats = closedPnlStatsForUniverse(rows, deals);
    expect(stats.n).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.pnlEur).toBe(80);
  });
});
