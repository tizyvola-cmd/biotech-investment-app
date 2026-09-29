import { describe, expect, it } from "vitest";
import { RECOMMENDATION_SIGNAL_CONFIG } from "./recommendationSignalConfig";
import {
  applyDirectionalSignalDemotion,
  buildRecommendationSignalBreakdown,
  buildRecommendationSignalCtx,
  computeWeightedMomentumScore,
  type RecommendationSignalCtx,
} from "./recommendationSignalGates";

function ctx(overrides: Partial<RecommendationSignalCtx> = {}): RecommendationSignalCtx {
  return {
    beta: 1.0,
    liquidityFy: 0.8,
    d1: 0,
    d7: 0,
    m3: 0,
    m6: 0,
    momentumScore: 0,
    ...overrides,
  };
}

describe("computeWeightedMomentumScore", () => {
  it("uses all four horizons with configured weights", () => {
    // (35*(-3.9)+30*(-2)+20*(-25)+15*(0.7)) / 100 = -6.86
    const score = computeWeightedMomentumScore({
      d1: -3.9,
      d7: -2,
      m3: -25,
      m6: 0.7,
    });
    expect(score).toBeCloseTo(-6.86, 2);
  });

  it("renormalizes when some horizons are missing", () => {
    // only 24h 35 + 3M 20 → weights 35/55 and 20/55
    const score = computeWeightedMomentumScore({
      d1: -10,
      d7: null,
      m3: 0,
      m6: null,
    });
    expect(score).toBeCloseTo((-10 * 35 + 0 * 20) / 55, 2);
  });

  it("returns null when no horizons present", () => {
    expect(
      computeWeightedMomentumScore({ d1: null, d7: null, m3: null, m6: null }),
    ).toBeNull();
  });
});

describe("applyDirectionalSignalDemotion", () => {
  it("demotes BUY when beta is extreme", () => {
    const r = applyDirectionalSignalDemotion("buy", ctx({ beta: 3.5 }));
    expect(r.action).toBe("review");
    expect(r.demoted).toBe(true);
  });

  it("demotes BUY when liquidity FY is very low", () => {
    const r = applyDirectionalSignalDemotion("buy", ctx({ liquidityFy: 0.1 }));
    expect(r.action).toBe("review");
  });

  it("demotes BUY when weighted momentum is below threshold (CRDL-like)", () => {
    const score = computeWeightedMomentumScore({
      d1: -3.91,
      d7: -4,
      m3: -25.19,
      m6: 0.67,
    });
    expect(score).not.toBeNull();
    expect(score!).toBeLessThan(RECOMMENDATION_SIGNAL_CONFIG.momentumBuyMinScore);
    const r = applyDirectionalSignalDemotion(
      "buy",
      ctx({ momentumScore: score, beta: 0.51, liquidityFy: 1.0 }),
    );
    expect(r.action).toBe("review");
    expect(r.reasons.some((x) => x.startsWith("momentum<"))).toBe(true);
  });

  it("keeps BUY when momentum is above threshold and beta/liq ok", () => {
    const r = applyDirectionalSignalDemotion(
      "buy",
      ctx({ momentumScore: -1.5, beta: 1.0, liquidityFy: 0.8 }),
    );
    expect(r.action).toBe("buy");
    expect(r.demoted).toBe(false);
  });

  it("never changes SELL or HOLD via demotion", () => {
    expect(applyDirectionalSignalDemotion("sell", ctx({ beta: 3 })).action).toBe("sell");
    expect(applyDirectionalSignalDemotion("hold", ctx({ beta: 3 })).action).toBe("hold");
  });

  it("leaves BUY unchanged when gates disabled", () => {
    const cfg = { ...RECOMMENDATION_SIGNAL_CONFIG, enableDirectionalGates: false };
    expect(applyDirectionalSignalDemotion("buy", ctx({ beta: 3 }), cfg).action).toBe("buy");
  });

  it("does not demote on momentum when score is null (missing horizons)", () => {
    const r = applyDirectionalSignalDemotion(
      "buy",
      ctx({ momentumScore: null, beta: 1, liquidityFy: 0.8 }),
    );
    expect(r.action).toBe("buy");
  });
});

describe("buildRecommendationSignalCtx", () => {
  it("reads sheet variation columns and beta/liq", () => {
    const c = buildRecommendationSignalCtx({
      Ticker: "CRDL",
      "Var. Giorn. %": -3.91,
      "Var. 7d %": -4,
      "Var. 3M %": -25.19,
      "Var. 6M %": 0.67,
      beta: 0.51,
      liquidity_score: 1,
    });
    expect(c.d1).toBeCloseTo(-3.91, 2);
    expect(c.m3).toBeCloseTo(-25.19, 2);
    expect(c.momentumScore).not.toBeNull();
    expect(c.momentumScore!).toBeLessThan(-4);
    expect(c.beta).toBeCloseTo(0.51, 2);
    expect(c.liquidityFy).toBeCloseTo(1, 2);
  });
});

describe("buildRecommendationSignalBreakdown", () => {
  it("exposes demotion parts", () => {
    const br = buildRecommendationSignalBreakdown("buy", ctx({ beta: 3.4 }));
    expect(br.actionBefore).toBe("buy");
    expect(br.actionAfter).toBe("review");
    expect(br.demoted).toBe(true);
    expect(br.beta).toBe(3.4);
  });
});
