import { describe, expect, it } from "vitest";
import { buildApprovedWeightsCapitalRows } from "./approvedWeightsCapitalKpi";
import type { ComparisonDeal } from "./threePortfolioCompare";

function stubDeal(rowKey: string, ticker: string): ComparisonDeal {
  return {
    ticker,
    rowKey,
    label: ticker,
    cells: {
      clinicalPhase: "Phase 2",
      clinicalIndication: "Unknown",
      sdsBucket: "40-60",
      pplanBucket: "50-70",
    },
    sdsValue: 50,
    winRate: 0.55,
    rawWinRate: 0.55,
    confidence: "medium",
    winRateDimension: "pplanBucket",
    winRateN: 10,
    payoffWinPct: 20,
    payoffLossPct: -15,
    payoffSource: "fallback",
    lossRisk: null,
    riskScore: null,
    realizedReturnPct: null,
    realizedReturnPct24h: null,
  };
}

describe("buildApprovedWeightsCapitalRows", () => {
  it("flags buy-new for non-invested BUY recommendations", () => {
    const deal = stubDeal("LTRN|2026-01-01", "LTRN");
    const rows = buildApprovedWeightsCapitalRows({
      deals: [deal],
      weightedShares: [0.1],
      totalCapitalEur: 5000,
      simTable: {
        columns: ["Ticker", "Completion Date"],
        rows: [{ Ticker: "LTRN", "Completion Date": "2026-01-01" }],
      },
      inputs: {},
      monitorByKey: new Map([
        [
          deal.rowKey,
          {
            key: deal.rowKey,
            ticker: "LTRN",
            suggestedAction: "buy",
            inLoss: false,
            pnlPct: null,
            probPct: 62,
          } as never,
        ],
      ]),
    });
    expect(rows[0]?.investedUsd).toBe(0);
    expect(rows[0]?.recommendedUsd).toBe(500);
    expect(rows[0]?.action).toMatchObject({ side: "buy", usd: 500, reason: "buy_new" });
  });

  it("suggests partial sell when over-allocated with low rescue score", () => {
    const deal = stubDeal("BBNX|2026-01-01", "BBNX");
    const rows = buildApprovedWeightsCapitalRows({
      deals: [deal],
      weightedShares: [0.08],
      totalCapitalEur: 5000,
      simTable: {
        columns: ["Ticker", "Completion Date", "Capitale Investito ($)"],
        rows: [
          {
            Ticker: "BBNX",
            "Completion Date": "2026-01-01",
            "Capitale Investito ($)": 800,
          },
        ],
      },
      inputs: {
        [deal.rowKey]: { buyPrice: 10, capital: 800 },
      },
      monitorByKey: new Map([
        [
          deal.rowKey,
          {
            key: deal.rowKey,
            ticker: "BBNX",
            suggestedAction: "review",
            inLoss: true,
            pnlPct: -8,
            probPct: 40,
          } as never,
        ],
      ]),
    });
    expect(rows[0]?.recommendedUsd).toBe(400);
    expect(rows[0]?.investedUsd).toBe(800);
    expect(rows[0]?.action?.side).toBe("sell");
    expect(rows[0]?.action!.usd).toBeGreaterThan(0);
  });
});
