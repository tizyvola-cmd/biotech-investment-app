import { describe, expect, it } from "vitest";
import { buildDecisionSimPnlDailySeries, mergeMissedOppDailyWithSimLoop } from "./decisionSimPnlDaily";
import type { DecisionSimTick } from "./investDecisionSimLoop";

describe("decisionSimPnlDaily", () => {
  it("builds daily delta from end-of-day piggy totals", () => {
    const ticks: DecisionSimTick[] = [
      {
        id: "t1",
        at: "2026-06-12T16:00:00.000Z",
        evaluations: [],
        portfolioBefore: [],
        portfolioAfter: [],
        trades: [],
        summary: {
          evaluatedTickers: 1,
          misalignedTickers: 0,
          harmonyAlignedPct: 100,
          precatVerdictAgree: 1,
          buySignals: 0,
          sellSignals: 0,
          holdSignals: 0,
          reviewSignals: 0,
          tradesExecuted: 0,
          misalignmentByType: {},
          piggyBank: {
            openCapitalEur: 5000,
            openMtmPnlEur: 200,
            closedPnlEur: 0,
            totalPnlEur: 200,
            openPositionCount: 1,
            closedTradeCount: 0,
          },
        },
      },
      {
        id: "t2",
        at: "2026-06-13T10:00:00.000Z",
        evaluations: [],
        portfolioBefore: [],
        portfolioAfter: [],
        trades: [],
        summary: {
          evaluatedTickers: 1,
          misalignedTickers: 0,
          harmonyAlignedPct: 100,
          precatVerdictAgree: 1,
          buySignals: 0,
          sellSignals: 0,
          holdSignals: 0,
          reviewSignals: 0,
          tradesExecuted: 0,
          misalignmentByType: {},
          piggyBank: {
            openCapitalEur: 5000,
            openMtmPnlEur: 500,
            closedPnlEur: 0,
            totalPnlEur: 500,
            openPositionCount: 1,
            closedTradeCount: 0,
          },
        },
      },
    ];

    const series = buildDecisionSimPnlDailySeries(ticks);
    expect(series).toHaveLength(2);
    expect(series[0]?.daySimLoop).toBe(200);
    expect(series[1]?.daySimLoop).toBe(300);
    expect(series[1]?.cumSimLoop).toBe(500);
  });

  it("merges sim loop into missed opp daily rows by date", () => {
    const merged = mergeMissedOppDailyWithSimLoop(
      [
        {
          date: "06-13",
          dayAllGainers: 1000,
          dayRecommendations: 600,
          dayFairRecommendations: 600,
          dayActual: 620,
          deltaActual: 50,
          capturePct: 103,
          gapVsRecEur: -20,
        },
      ],
      [
        { date: "2026-06-13", daySimLoop: 450, cumSimLoop: 450 },
      ],
    );
    expect(merged[0]?.daySimLoop).toBe(450);
    expect(merged[0]?.cumSimLoop).toBe(450);
  });

  it("ignores corrupted piggy totals when building daily deltas", () => {
    const positions = [
      {
        key: "AAA|cd",
        ticker: "AAA",
        capital: 5000,
        entryAt: "2026-06-01T10:00:00.000Z",
        entryProbPct: 60,
        entryPlanReturnPct: 10,
        lastMarkPct: 2,
      },
    ];
    const ticks: DecisionSimTick[] = [
      {
        id: "t1",
        at: "2026-06-17T16:00:00.000Z",
        evaluations: [],
        portfolioBefore: [],
        portfolioAfter: positions,
        trades: [],
        summary: {
          evaluatedTickers: 1,
          misalignedTickers: 0,
          harmonyAlignedPct: 100,
          precatVerdictAgree: 1,
          buySignals: 0,
          sellSignals: 0,
          holdSignals: 0,
          reviewSignals: 0,
          tradesExecuted: 0,
          misalignmentByType: {},
          piggyBank: {
            openCapitalEur: 5000,
            openMtmPnlEur: 100,
            closedPnlEur: 0,
            totalPnlEur: 100,
            openPositionCount: 1,
            closedTradeCount: 0,
          },
        },
      },
      {
        id: "t2",
        at: "2026-06-18T16:00:00.000Z",
        evaluations: [],
        portfolioBefore: [],
        portfolioAfter: positions,
        trades: [],
        summary: {
          evaluatedTickers: 1,
          misalignedTickers: 0,
          harmonyAlignedPct: 100,
          precatVerdictAgree: 1,
          buySignals: 0,
          sellSignals: 0,
          holdSignals: 0,
          reviewSignals: 0,
          tradesExecuted: 0,
          misalignmentByType: {},
          piggyBank: {
            openCapitalEur: 5000,
            openMtmPnlEur: 5_166_000,
            closedPnlEur: 0,
            totalPnlEur: 5_166_822,
            openPositionCount: 1,
            closedTradeCount: 0,
          },
        },
      },
    ];

    const series = buildDecisionSimPnlDailySeries(ticks);
    expect(series).toHaveLength(2);
    expect(series[1]?.daySimLoop).toBe(0);
    expect(series[1]?.cumSimLoop).toBe(100);
  });
});
