import { describe, expect, it } from "vitest";
import {
  buildRecommendationEngineOverview,
  detectPplanBucketAnomaly,
} from "./recommendationEngineOverview";
import {
  aggregateAdviceCalibrationBuckets,
  summarizeAdvicePrecisionByAction,
  type AdviceCalibrationPoint,
} from "./investDecisionSimAdviceCalibration";

function point(
  overrides: Partial<AdviceCalibrationPoint> & Pick<AdviceCalibrationPoint, "suggestedAction">,
): AdviceCalibrationPoint {
  return {
    id: "x",
    ticker: "TST",
    probPct: 55,
    bucketId: "50-59",
    bucketLabel: "50–59%",
    outcome: "good",
    pnlPct: null,
    priceChangePct: 2,
    expectedReturnPct: 1,
    forecastErrorPct: 1,
    suggestedAction: "buy",
    source: "live",
    kind: "buy_rec",
    at: "2026-05-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("recommendationEngineOverview", () => {
  it("splits sim vs portfolio scored deals", () => {
    const pts = [
      point({ id: "a", source: "experiment", ticker: "AAA" }),
      point({ id: "b", source: "live", ticker: "BBB", suggestedAction: "sell", outcome: "bad" }),
    ];
    const overview = buildRecommendationEngineOverview(
      pts,
      summarizeAdvicePrecisionByAction(pts),
      aggregateAdviceCalibrationBuckets(pts, "en"),
    );
    expect(overview.totalDeals).toBe(2);
    expect(overview.totalPending).toBe(0);
    expect(overview.simDeals).toBe(1);
    expect(overview.portfolioDeals).toBe(1);
  });

  it("distribution scored counts sum to totalDeals", () => {
    const pts = [
      point({ id: "a", suggestedAction: "buy", outcome: "good" }),
      point({ id: "b", suggestedAction: "sell", outcome: "bad" }),
      point({ id: "c", suggestedAction: "sell", outcome: "pending" }),
      point({ id: "d", suggestedAction: "hold", outcome: "good" }),
    ];
    const overview = buildRecommendationEngineOverview(
      pts,
      summarizeAdvicePrecisionByAction(pts),
      aggregateAdviceCalibrationBuckets(pts, "en"),
    );
    expect(overview.totalDeals).toBe(3);
    expect(overview.totalPending).toBe(1);
    const scoredBarTotal = overview.distribution.reduce((s, d) => s + d.count, 0);
    expect(scoredBarTotal).toBe(overview.totalDeals);
    const sellSeg = overview.distribution.find((d) => d.action === "sell");
    expect(sellSeg?.count).toBe(1);
    expect(sellSeg?.pending).toBe(1);
  });

  it("detects descending P(plan) bucket accuracy", () => {
    const buckets = aggregateAdviceCalibrationBuckets(
      [
        point({ bucketId: "50-59", probPct: 55, outcome: "good" }),
        point({ bucketId: "50-59", probPct: 52, outcome: "good", id: "b" }),
        point({ bucketId: "60-69", probPct: 65, outcome: "bad", id: "c" }),
        point({ bucketId: "60-69", probPct: 62, outcome: "bad", id: "d" }),
      ],
      "en",
    );
    const anomaly = detectPplanBucketAnomaly(buckets);
    expect(anomaly?.bucketId).toBe("60-69");
    expect(anomaly?.prevBucketLabel).toBe("50–59%");
  });
});
