import { describe, expect, it } from "vitest";
import { buildUnifiedAdviceSuccess } from "./unifiedAdviceSuccess";
import type { AdviceCalibrationSummary } from "./investDecisionSimAdviceCalibration";

function emptyLive(): AdviceCalibrationSummary {
  return {
    lowProb: { count: 0, good: 0, bad: 0, successRatePct: null },
    highProb: { count: 0, good: 0, bad: 0, successRatePct: null },
    scoredCount: 0,
    pendingCount: 0,
    goodCount: 0,
    badCount: 0,
    overallSuccessRatePct: null,
  };
}

describe("buildUnifiedAdviceSuccess", () => {
  it("prefers live reliability over paper and closed sim", () => {
    const u = buildUnifiedAdviceSuccess({
      live: {
        ...emptyLive(),
        scoredCount: 12,
        goodCount: 10,
        badCount: 2,
        overallSuccessRatePct: 83.3,
      },
      paperPrecisionPct: 93.1,
      paperGood: 27,
      paperBad: 2,
      closed: {
        winRatePct: 20,
        winCount: 1,
        lossCount: 4,
        sampleSize: 5,
        expectancyEurPerTrade: 6,
        realizedDailyPnlEur: null,
        lowSample: true,
      },
    });
    expect(u.headlinePct).toBe(83.3);
    expect(u.primarySource).toBe("live_reliability");
    expect(u.closed.countsTowardHeadline).toBe(false);
  });

  it("falls back to paper when live sample too small", () => {
    const u = buildUnifiedAdviceSuccess({
      live: { ...emptyLive(), scoredCount: 2, goodCount: 2, badCount: 0 },
      paperPrecisionPct: 93,
      paperGood: 14,
      paperBad: 1,
    });
    expect(u.primarySource).toBe("paper_precision");
    expect(u.headlinePct).toBe(93);
  });

  it("uses closed sim only with enough round-trips and no live/paper", () => {
    const u = buildUnifiedAdviceSuccess({
      live: emptyLive(),
      closed: {
        winRatePct: 62.5,
        winCount: 5,
        lossCount: 3,
        sampleSize: 8,
        expectancyEurPerTrade: 12,
        realizedDailyPnlEur: null,
        lowSample: false,
      },
    });
    expect(u.primarySource).toBe("closed_sim");
    expect(u.headlinePct).toBe(62.5);
  });
});
