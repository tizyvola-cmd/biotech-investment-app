import { describe, expect, it } from "vitest";
import {
  buildPortfolioVsSimLoopInsight,
  summarizePortfolioVsSimLoop,
} from "./portfolioVsSimLoopAnalysis";
import { defaultExperimentScorecard } from "./investDecisionSimExperiment";

describe("portfolioVsSimLoopAnalysis", () => {
  it("computes cumulative delta actual minus sim loop", () => {
    const summary = summarizePortfolioVsSimLoop(2500, 500, [
      {
        date: "06-15",
        dayAllGainers: 0,
        dayRecommendations: 0,
        dayFairRecommendations: 0,
        dayActual: 2500,
        deltaActual: 9,
        capturePct: null,
        gapVsRecEur: 0,
        daySimLoop: 2,
        cumSimLoop: 500,
      },
    ]);
    expect(summary.deltaEur).toBe(2000);
    expect(summary.deltaDailyEur).toBe(7);
  });

  it("includes RA-not-driver and ahead factors when portfolio leads", () => {
    const insight = buildPortfolioVsSimLoopInsight({
      pnlActualEur: 2500,
      simLoopTotalEur: 500,
      dailyWithSim: [],
      scorecard: { ...defaultExperimentScorecard(), badBuyCount: 2, advicePrecisionPct: 40 },
      paperPortfolio: [
        {
          ticker: "AAA",
          key: "a",
          capital: 5000,
          entryAt: "2026-06-15",
          entryReason: "test",
          entryPlanReturnPct: 5,
        },
      ],
      portfolioTickers: ["BBB"],
      gapVsFairRecToday: -35,
    });
    expect(insight.factors.some((f) => f.id === "ra_not_driver")).toBe(true);
    expect(insight.factors.some((f) => f.id === "ahead")).toBe(true);
    expect(insight.factors.some((f) => f.id === "sim_bad_buys")).toBe(true);
    expect(insight.factors.some((f) => f.id === "executable_aligned")).toBe(true);
    expect(insight.overlapCount).toBe(0);
  });
});
