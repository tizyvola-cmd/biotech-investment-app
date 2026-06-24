import { describe, expect, it } from "vitest";
import {
  buildCombinedIntrinsicDecision,
  buildIntrinsicRecommendationSummary,
  precisionPctFromDecision,
} from "./intrinsicRecommendationEfficiency";

describe("intrinsicRecommendationEfficiency", () => {
  it("combines monitor and closed replay precision", () => {
    const summary = buildIntrinsicRecommendationSummary({
      monitorRows: [
        {
          key: "a|cd",
          ticker: "A",
          suggestedAction: "buy",
          inPaperPortfolio: false,
          hasPosition: false,
          probPct: 70,
          planReturnPct: 5,
          pnlPct24h: 2,
        },
      ],
      closedRows: [],
      simRowByKey: new Map(),
      lang: "en",
    });
    expect(summary.monitor.scoredCount).toBe(1);
    expect(summary.combinedPrecisionPct).toBe(100);
    expect(summary.combinedAllActions.n).toBe(1);
    expect(summary.combinedDirectionalPct).toBe(100);
  });

  it("pools BUY/SELL across monitor and closed replay for combined decision", () => {
    const combined = buildCombinedIntrinsicDecision(
      {
        decision: {
          buy: { labelKey: "buy", valuePct: 100, maePct: null, n: 10, good: 10, bad: 0, confidence: "high" },
          sell: { labelKey: "sell", valuePct: 80, maePct: null, n: 5, good: 4, bad: 1, confidence: "medium" },
          unverifiedSellEvitaCount: 0,
        },
        numerical: null,
        scoredCount: 15,
        allActions: { labelKey: "advice", valuePct: 93, maePct: null, n: 15, good: 14, bad: 1, confidence: "high" },
        pendingCount: 0,
      },
      {
        decision: {
          buy: { labelKey: "buy", valuePct: 50, maePct: null, n: 2, good: 1, bad: 1, confidence: "low" },
          sell: { labelKey: "sell", valuePct: 60, maePct: null, n: 10, good: 6, bad: 4, confidence: "high" },
          unverifiedSellEvitaCount: 0,
        },
        numerical: null,
        scoredCount: 12,
        allActions: { labelKey: "advice", valuePct: 58, maePct: null, n: 12, good: 7, bad: 5, confidence: "high" },
        pendingCount: 0,
      },
    );
    expect(combined.buy.n).toBe(12);
    expect(combined.buy.valuePct).toBeCloseTo(91.7, 1);
    expect(combined.sell.n).toBe(15);
    expect(combined.sell.valuePct).toBeCloseTo(66.7, 1);
    expect(precisionPctFromDecision(combined)).toBeCloseTo(77.8, 1);
  });

  it("header all-actions matches monitor+replay pool; directional matches BUY/SELL", () => {
    const monitor = {
      decision: {
        buy: { labelKey: "buy" as const, valuePct: null, maePct: null, n: 0, good: 0, bad: 0, confidence: "low" as const },
        sell: { labelKey: "sell" as const, valuePct: 100, maePct: null, n: 1, good: 1, bad: 0, confidence: "low" as const },
        unverifiedSellEvitaCount: 0,
      },
      numerical: null,
      scoredCount: 17,
      allActions: {
        labelKey: "advice" as const,
        valuePct: 82.4,
        maePct: null,
        n: 17,
        good: 14,
        bad: 3,
        confidence: "medium" as const,
      },
      pendingCount: 1,
    };
    const closed = {
      decision: {
        buy: { labelKey: "buy" as const, valuePct: 50, maePct: null, n: 2, good: 1, bad: 1, confidence: "low" as const },
        sell: { labelKey: "sell" as const, valuePct: 63.6, maePct: null, n: 22, good: 14, bad: 8, confidence: "high" as const },
        unverifiedSellEvitaCount: 0,
      },
      numerical: null,
      scoredCount: 24,
      allActions: {
        labelKey: "advice" as const,
        valuePct: 62.5,
        maePct: null,
        n: 24,
        good: 15,
        bad: 9,
        confidence: "high" as const,
      },
      pendingCount: 0,
    };
    const combined = buildCombinedIntrinsicDecision(monitor, closed);
    const allGood = 14 + 15;
    const allBad = 3 + 9;
    const allPct = Math.round((allGood / (allGood + allBad)) * 1000) / 10;
    expect(allPct).toBeCloseTo(70.7, 1);
    expect(precisionPctFromDecision(combined)).toBeCloseTo(64, 0);
    expect(combined.sell.n).toBe(23);
  });
});
