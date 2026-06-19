import { describe, expect, it } from "vitest";
import {
  buildCumulativePortfolioMaturationSeries,
  harmonizeAllocationRealized,
  scenarioGainEur,
  summarizeThreeScenarioGainTotals,
} from "./portfolioScenarioGain";
import type { ComparisonDeal, PortfolioAllocation } from "./threePortfolioCompare";

function deal(ticker: string, pct: number | null): ComparisonDeal {
  return {
    ticker,
    rowKey: `${ticker}|cd`,
    label: ticker,
    cells: {
      clinicalPhase: "P3",
      clinicalIndication: "x",
      sdsBucket: "mid",
      pplanBucket: "mid",
    },
    sdsValue: 50,
    winRate: 0.5,
    rawWinRate: 0.5,
    confidence: "medium",
    winRateDimension: null,
    winRateN: 10,
    payoffWinPct: 20,
    payoffLossPct: -10,
    payoffSource: "fallback",
    lossRisk: null,
    riskScore: null,
    realizedReturnPct: pct,
    realizedReturnPct24h: null,
  };
}

describe("portfolioScenarioGain", () => {
  it("computes gain as cap × return / 100", () => {
    expect(scenarioGainEur(10_000, 5.2)).toBe(520);
    expect(scenarioGainEur(10_000, null)).toBe(0);
  });

  it("harmonizes allocation totals from deal returns", () => {
    const deals = [deal("AAA", 10), deal("BBB", -4)];
    const alloc: PortfolioAllocation = {
      capByTicker: { AAA: 5000, BBB: 5000 },
      evByTicker: {},
      realizedEurByTicker: { AAA: 999, BBB: 0 },
      totalCapitalEur: 10_000,
      totalEvEur: 0,
      totalRealizedEur: 999,
      positionsCount: 2,
      realizedPositionsCount: 2,
    };
    const out = harmonizeAllocationRealized(alloc, deals);
    expect(out.realizedEurByTicker.AAA).toBe(500);
    expect(out.realizedEurByTicker.BBB).toBe(-200);
    expect(out.totalRealizedEur).toBe(300);
  });

  it("builds cumulative maturation from daily ledger legs", () => {
    const series = buildCumulativePortfolioMaturationSeries({
      dayKeys: ["2026-06-16", "2026-06-17", "2026-06-18"],
      dayTotals: { "2026-06-16": 100, "2026-06-17": 50, "2026-06-18": -20 },
      openDayTotals: { "2026-06-16": 100, "2026-06-17": 50, "2026-06-18": -20 },
      grandTotal: 130,
      openGrandTotal: 130,
      rows: [
        {
          key: "a|cd",
          ticker: "AAA",
          archived: false,
          pnlByDay: { "2026-06-16": 100, "2026-06-17": 50, "2026-06-18": -20 },
          totalEur: 130,
          legs: [],
        },
      ],
      incompleteDailyHistory: false,
      legTotalDiffersFromMtm: false,
      openRowCount: 1,
      archivedRowCount: 0,
    });
    expect(series.open.map((p) => p.totalPnlEur)).toEqual([100, 150, 130]);
  });

  it("closed maturation uses realized exit P&L, not Σ daily MTM legs", () => {
    const series = buildCumulativePortfolioMaturationSeries({
      dayKeys: ["2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19"],
      dayTotals: {},
      openDayTotals: {},
      grandTotal: 1124,
      openGrandTotal: 0,
      rows: [
        {
          key: "x|cd",
          ticker: "X",
          archived: true,
          capital: 5000,
          pnlByDay: {
            "2026-06-16": -2000,
            "2026-06-17": -3000,
            "2026-06-18": -2302,
          },
          totalEur: 1124,
          legs: [],
        },
      ],
      incompleteDailyHistory: false,
      legTotalDiffersFromMtm: true,
      openRowCount: 0,
      archivedRowCount: 1,
    });
    expect(series.closed.map((p) => p.totalPnlEur)).toEqual([0, 0, 1124, 1124]);
  });

  it("summarizes three scenario headline totals", () => {
    const base = (): PortfolioAllocation => ({
      capByTicker: {},
      evByTicker: {},
      realizedEurByTicker: {},
      totalCapitalEur: 50_000,
      totalEvEur: 0,
      totalRealizedEur: 250,
      positionsCount: 5,
      realizedPositionsCount: 5,
    });
    const s = summarizeThreeScenarioGainTotals({
      portfolio: base(),
      simLoopEqual: { ...base(), totalRealizedEur: 206 },
      simLoopSynth: { ...base(), totalRealizedEur: 277 },
    });
    expect(s.simLoopEqual.gainEur).toBe(206);
    expect(s.simLoopSynth.gainPct).toBeCloseTo(0.55, 2);
  });
});
