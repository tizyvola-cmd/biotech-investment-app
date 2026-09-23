import { describe, expect, it } from "vitest";
import { scoreRecTradingOutcome, buildRecommendationStretchView } from "./recommendationStretchView";
import type { AdviceCalibrationPoint } from "./investDecisionSimAdviceCalibration";

function pt(
  partial: Partial<AdviceCalibrationPoint> &
    Pick<AdviceCalibrationPoint, "id" | "suggestedAction" | "priceChangePct">,
): AdviceCalibrationPoint {
  return {
    ticker: "X",
    probPct: 60,
    bucketId: "60-69",
    bucketLabel: "60–69",
    outcome: "pending",
    pnlPct: null,
    expectedReturnPct: null,
    forecastErrorPct: null,
    source: "live",
    kind: "test",
    at: "2026-07-18T12:00:00Z",
    ...partial,
  };
}

describe("recommendationStretchView", () => {
  it("scores BUY/SELL/HOLD vs price move", () => {
    expect(scoreRecTradingOutcome("buy", 1.2)).toBe("good");
    expect(scoreRecTradingOutcome("buy", -1)).toBe("bad");
    expect(scoreRecTradingOutcome("sell", -1)).toBe("good");
    expect(scoreRecTradingOutcome("sell", 1)).toBe("bad");
    expect(scoreRecTradingOutcome("hold", -1.2)).toBe("bad");
    expect(scoreRecTradingOutcome("hold", 0.2)).toBe("good");
    expect(scoreRecTradingOutcome("hold", 2)).toBe("good");
    expect(scoreRecTradingOutcome("review", -0.8)).toBe("bad");
  });

  it("builds per-action stats", () => {
    const points = [
      pt({ id: "1", suggestedAction: "buy", priceChangePct: 2, outcome: "good" }),
      pt({ id: "2", suggestedAction: "buy", priceChangePct: -1, outcome: "bad" }),
      pt({ id: "3", suggestedAction: "sell", priceChangePct: -2, outcome: "good" }),
      pt({ id: "4", suggestedAction: "hold", priceChangePct: -1.5, outcome: "bad" }),
      pt({ id: "5", suggestedAction: "hold", priceChangePct: 0.1, outcome: "good" }),
    ];
    const view = buildRecommendationStretchView({ points });
    expect(view.buy.scored).toBe(2);
    expect(view.buy.successRatePct).toBe(50);
    expect(view.sell.successRatePct).toBe(100);
    expect(view.hold.scored).toBe(2);
    expect(view.hold.good).toBe(1);
    expect(view.hold.bad).toBe(1);
  });
});
