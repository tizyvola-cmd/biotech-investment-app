import { describe, expect, it } from "vitest";
import {
  ADVICE_TIMELINE_MIN_BUY_FOR_TREND,
  ADVICE_TIMELINE_MIN_SELL_FOR_TREND,
  assessAdviceTimelineQuality,
} from "./adviceLearningTimelineQuality";
import type { AdviceLearningSnapshot } from "./adviceLearningHistory";

function snap(partial: Partial<AdviceLearningSnapshot>): AdviceLearningSnapshot {
  return {
    ts: "2026-08-28T12:00:00.000Z",
    day: "2026-08-28",
    manual: false,
    scoredPoints: 8,
    overallSuccessRatePct: 62.5,
    lowProbSuccessRatePct: 50,
    lowProbScored: 4,
    highProbSuccessRatePct: 25,
    highProbScored: 4,
    midProbSuccessRatePct: 100,
    midProbScored: 3,
    portfolioSuccessRatePct: 70,
    portfolioScored: 5,
    simLoopSuccessRatePct: 40,
    simLoopScored: 6,
    bucketCorrectionsActive: 0,
    actionDemotionsActive: 0,
    unifiedAdviceSuccessPct: null,
    capturePct: null,
    paperBookReturnPct: null,
    closedPnlWinRatePct: null,
    buySuccessRatePct: 45,
    buyScored: 2,
    sellSuccessRatePct: 60,
    sellScored: 3,
    ...partial,
  };
}

describe("assessAdviceTimelineQuality", () => {
  it("flags low BUY/SELL sample and hides both trends", () => {
    const q = assessAdviceTimelineQuality([snap({})], Date.parse("2026-08-28T20:00:00.000Z"));
    expect(q.buyLowSample).toBe(true);
    expect(q.sellLowSample).toBe(true);
    expect(q.showBuyTrend).toBe(false);
    expect(q.showSellTrend).toBe(false);
    expect(q.showLowSampleBanner).toBe(true);
  });

  it("enables BUY and SELL trends when n meets thresholds", () => {
    const q = assessAdviceTimelineQuality(
      [
        snap({
          buyScored: ADVICE_TIMELINE_MIN_BUY_FOR_TREND,
          sellScored: ADVICE_TIMELINE_MIN_SELL_FOR_TREND,
        }),
      ],
      Date.parse("2026-08-28T20:00:00.000Z"),
    );
    expect(q.showBuyTrend).toBe(true);
    expect(q.showSellTrend).toBe(true);
    expect(q.showLowSampleBanner).toBe(false);
  });

  it("marks stale when latest checkpoint is older than 7 days", () => {
    const q = assessAdviceTimelineQuality(
      [snap({ ts: "2026-08-10T12:00:00.000Z", day: "2026-08-10" })],
      Date.parse("2026-08-28T12:00:00.000Z"),
    );
    expect(q.staleCheckpoint).toBe(true);
    expect(q.daysSinceLatest).toBe(18);
    expect(q.showLowSampleBanner).toBe(true);
  });
});
