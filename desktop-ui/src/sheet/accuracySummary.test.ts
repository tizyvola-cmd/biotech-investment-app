import { describe, expect, it } from "vitest";
import type { AdviceCalibrationPoint } from "./investDecisionSimAdviceCalibration";
import {
  computeNumericalForecastAccuracy,
  filterPaperExecutedCalibrationPoints,
  formatOperativeSellBreakdownLabel,
  summarizeDecisionPrecision,
  summarizeWeightedGrowthFromImpact,
} from "./accuracySummary";
import { computeSynthGainImpact } from "./threePortfolioCompare";

function point(
  partial: Partial<AdviceCalibrationPoint> & Pick<AdviceCalibrationPoint, "suggestedAction" | "outcome">,
): AdviceCalibrationPoint {
  return {
    id: "t",
    ticker: "X",
    probPct: 70,
    bucketId: "70-79",
    bucketLabel: "70–79%",
    pnlPct: null,
    priceChangePct: 2,
    expectedReturnPct: 5,
    forecastErrorPct: -3,
    source: "live",
    kind: "live",
    at: "2026-01-01",
    ...partial,
  };
}

describe("summarizeDecisionPrecision", () => {
  it("computes buy and sell precision separately", () => {
    const summary = summarizeDecisionPrecision([
      point({ suggestedAction: "buy", outcome: "good" }),
      point({ suggestedAction: "buy", outcome: "bad" }),
      point({ suggestedAction: "sell", outcome: "good", priceChangePct: -1 }),
      point({ suggestedAction: "sell", outcome: "pending", priceChangePct: 0.1 }),
    ]);
    expect(summary.buy.n).toBe(2);
    expect(summary.buy.valuePct).toBe(50);
    expect(summary.sell.n).toBe(1);
    expect(summary.sell.valuePct).toBe(100);
    expect(summary.unverifiedSellEvitaCount).toBe(1);
  });
});

describe("computeNumericalForecastAccuracy", () => {
  it("returns sign hit rate and MAE in pp", () => {
    const summary = computeNumericalForecastAccuracy([
      point({
        suggestedAction: "buy",
        outcome: "good",
        expectedReturnPct: 5,
        priceChangePct: 4,
        forecastErrorPct: -1,
      }),
      point({
        suggestedAction: "sell",
        outcome: "good",
        expectedReturnPct: -3,
        priceChangePct: -2,
        forecastErrorPct: 1,
      }),
    ]);
    expect(summary.signHit.n).toBe(2);
    expect(summary.signHit.valuePct).toBe(100);
    expect(summary.mae.maePct).toBe(1);
  });

  it("excludes HOLD/REVIEW — no resolved directional forecast yet", () => {
    const summary = computeNumericalForecastAccuracy([
      point({
        suggestedAction: "hold",
        outcome: "bad",
        expectedReturnPct: 0,
        priceChangePct: 8,
        forecastErrorPct: 8,
      }),
      point({
        suggestedAction: "buy",
        outcome: "good",
        expectedReturnPct: 5,
        priceChangePct: 6,
        forecastErrorPct: 1,
      }),
    ]);
    expect(summary.signHit.n).toBe(1);
    expect(summary.signHit.valuePct).toBe(100);
    expect(summary.mae.n).toBe(1);
  });
});

describe("filterPaperExecutedCalibrationPoints", () => {
  it("drops live snapshot rows", () => {
    const filtered = filterPaperExecutedCalibrationPoints([
      point({ suggestedAction: "buy", outcome: "good", source: "live", kind: "buy_rec" }),
      point({ suggestedAction: "buy", outcome: "bad", source: "experiment", kind: "good_buy" }),
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.source).toBe("experiment");
  });
});

describe("summarizeWeightedGrowthFromImpact", () => {
  it("shows multiplier below 1 honestly", () => {
    const impact = computeSynthGainImpact(1000, 50_000, 800, 50_000);
    const summary = summarizeWeightedGrowthFromImpact(impact, "simLoop", 5);
    expect(summary.multiplier).toBe(0.8);
    expect(summary.dealSampleN).toBe(5);
  });
});

describe("formatOperativeSellBreakdownLabel", () => {
  it("formats scored vs executed with exclusion reasons", () => {
    expect(
      formatOperativeSellBreakdownLabel(
        {
          executedCount: 38,
          scoredCount: 0,
          missingPplanCount: 30,
          missingPostMoveCount: 8,
          pendingFlatCount: 0,
        },
        true,
        "simLoop",
      ),
    ).toBe("0/38 valutati · 30 senza P(plan) · 8 senza Var. post-vendita");
  });
});
