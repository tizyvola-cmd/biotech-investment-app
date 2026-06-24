import { describe, expect, it } from "vitest";
import { buildSimLoopTradeAlertsFromTick } from "./simLoopTradeAlerts";
import type { DecisionSimTick } from "./investDecisionSimLoop";

describe("buildSimLoopTradeAlertsFromTick", () => {
  it("builds alerts for buy and sell trades", () => {
    const tick: DecisionSimTick = {
      id: "tick_1",
      at: "2026-06-18T12:00:00.000Z",
      portfolioBefore: [],
      portfolioAfter: [],
      evaluations: [
        {
          key: "AAA|2026-09-01",
          ticker: "AAA",
          hasPosition: false,
          inPaperPortfolio: false,
          daysToCd: 30,
          readings: {} as never,
          misalignments: [],
          misalignmentLabels: [],
          exitDecision: "hold",
          investVerdict: "yes",
          entryVerdict: "yes",
          exitVerdict: null,
          probPct: 72,
          suggestedAction: "buy",
          planReturnPct: 12,
          pnlPct24h: 1.1,
          pnlPct: null,
          precatVerdictAgree: true,
          exitReason: "",
          compositeScore: 70,
          scoringZone: "mid",
          scoreBreakdown: {} as never,
          compositeDampened: false,
        },
      ],
      trades: [
        {
          at: "2026-06-18T12:00:00.000Z",
          ticker: "AAA",
          key: "AAA|2026-09-01",
          side: "buy",
          reason: "Top2 yes · hold",
          capital: 5000,
          pnlPctSimulated: null,
          pnlEurSimulated: null,
        },
      ],
      summary: {
        evaluatedTickers: 1,
        misalignedTickers: 0,
        harmonyAlignedPct: null,
        precatVerdictAgree: 1,
        buySignals: 1,
        sellSignals: 0,
        holdSignals: 0,
        reviewSignals: 0,
        tradesExecuted: 1,
        misalignmentByType: {},
      },
    };

    const alerts = buildSimLoopTradeAlertsFromTick(tick, "it");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.side).toBe("buy");
    expect(alerts[0]?.ticker).toBe("AAA");
    expect(alerts[0]?.completionDate).toBe("2026-09-01");
    expect(alerts[0]?.recommendation).toContain("BUY");
    expect(alerts[0]?.inRealPortfolio).toBe(false);
  });

  it("marks alerts for tickers in the real Simulation portfolio", () => {
    const tick: DecisionSimTick = {
      id: "tick_2",
      at: "2026-06-18T12:00:00.000Z",
      portfolioBefore: [],
      portfolioAfter: [],
      evaluations: [
        {
          key: "CRDL|2026-09-21",
          ticker: "CRDL",
          hasPosition: true,
          inPaperPortfolio: true,
          daysToCd: 90,
          readings: {} as never,
          misalignments: [],
          misalignmentLabels: [],
          exitDecision: "exit",
          investVerdict: "no",
          entryVerdict: "no",
          exitVerdict: "exit",
          probPct: 48,
          suggestedAction: "sell",
          planReturnPct: 1.7,
          pnlPct24h: 0,
          pnlPct: 0,
          precatVerdictAgree: true,
          exitReason: "Don't add",
          compositeScore: 40,
          scoringZone: "low",
          scoreBreakdown: {} as never,
          compositeDampened: false,
        },
      ],
      trades: [
        {
          at: "2026-06-18T12:00:00.000Z",
          ticker: "CRDL",
          key: "CRDL|2026-09-21",
          side: "sell",
          reason: "Don't add",
          capital: null,
          pnlPctSimulated: 0,
          pnlEurSimulated: 0,
        },
      ],
      summary: {
        evaluatedTickers: 1,
        misalignedTickers: 0,
        harmonyAlignedPct: null,
        precatVerdictAgree: 1,
        buySignals: 0,
        sellSignals: 1,
        holdSignals: 0,
        reviewSignals: 0,
        tradesExecuted: 1,
        misalignmentByType: {},
      },
    };

    const alerts = buildSimLoopTradeAlertsFromTick(tick, "en");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.inRealPortfolio).toBe(true);
  });

  it("marks alerts when Simulation inputs show deployed capital", () => {
    const tick: DecisionSimTick = {
      id: "tick_3",
      at: "2026-06-18T12:00:00.000Z",
      portfolioBefore: [],
      portfolioAfter: [],
      evaluations: [],
      trades: [
        {
          at: "2026-06-18T12:00:00.000Z",
          ticker: "LCTX",
          key: "LCTX|2026-08-31",
          side: "sell",
          reason: "Don't add",
          capital: null,
          pnlPctSimulated: 0,
          pnlEurSimulated: 0,
        },
      ],
      summary: {
        evaluatedTickers: 0,
        misalignedTickers: 0,
        harmonyAlignedPct: null,
        precatVerdictAgree: 0,
        buySignals: 0,
        sellSignals: 1,
        holdSignals: 0,
        reviewSignals: 0,
        tradesExecuted: 1,
        misalignmentByType: {},
      },
    };

    const alerts = buildSimLoopTradeAlertsFromTick(tick, "en", undefined, {
      "LCTX|2026-08-31": { capital: 5000, buyPrice: 10, investedAt: "2026-06-01T10:00:00.000Z" },
    });
    expect(alerts[0]?.inRealPortfolio).toBe(true);
  });
});
