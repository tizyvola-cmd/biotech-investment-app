import { describe, expect, it } from "vitest";
import type { ConfidenceLevel } from "../calibration/calibrationTypes";
import type { ComparisonDeal } from "./threePortfolioCompare";
import {
  DEFAULT_CONFIDENCE_MULTIPLIERS,
  DEFAULT_WEIGHTED_SIZING_CONFIG,
  breakevenCapitalForSlope,
  computeProfitProbabilityCurve,
  computePortfolioSizingSuccessComparison,
  computePortfolioSuccessEstimate,
  computeUniformPortfolioStats,
  computeWeightedPortfolioStats,
  evPerEurForDeal,
  findBreakevenCapitalFromCurve,
} from "./portfolioWeightedSizing";

function makeDeal(
  ticker: string,
  winRate: number,
  payoffWinPct = 10,
  payoffLossPct = -8,
  confidence: ConfidenceLevel = "medium",
): ComparisonDeal {
  return {
    ticker,
    rowKey: `${ticker}|2030-01-01`,
    label: `${ticker} · Phase 2`,
    cells: {
      clinicalPhase: "Phase 2",
      clinicalIndication: "Unknown",
      sdsBucket: "SDS 40-55 (Mid)",
      pplanBucket: "P(plan) 30-50%",
    },
    sdsValue: null,
    winRate,
    rawWinRate: winRate,
    confidence,
    winRateDimension: "clinicalPhase",
    winRateN: 10,
    payoffWinPct,
    payoffLossPct,
    payoffSource: "step1",
    lossRisk: null,
    riskScore: null,
    realizedReturnPct: null,
    realizedReturnPct24h: null,
  };
}

describe("evPerEurForDeal", () => {
  it("returns probability-weighted SDS expected gain at target", () => {
    const d = makeDeal("ABC", 0.6, 10, -10);
    // evPerEur = 0.6 * 10 / 100 = 0.06
    expect(evPerEurForDeal(d)).toBeCloseTo(0.06, 6);
  });

  it("scales linearly with the SDS expected gain", () => {
    expect(evPerEurForDeal(makeDeal("A", 0.5, 8, -10))).toBeCloseTo(0.04, 6);
    expect(evPerEurForDeal(makeDeal("B", 0.5, 12, -10))).toBeCloseTo(0.06, 6);
  });

  it("scales linearly with the win rate", () => {
    expect(evPerEurForDeal(makeDeal("A", 0.4, 10, -10))).toBeCloseTo(0.04, 6);
    expect(evPerEurForDeal(makeDeal("B", 0.8, 10, -10))).toBeCloseTo(0.08, 6);
  });

  it("never goes below zero (downside enters via the pattern factor, not EV)", () => {
    expect(evPerEurForDeal(makeDeal("A", 0.2, 10, -10))).toBeGreaterThanOrEqual(0);
    expect(evPerEurForDeal(makeDeal("B", 0.99, 10, -10))).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 when payoffWinPct is missing or non-positive", () => {
    expect(evPerEurForDeal(makeDeal("A", 0.6, 0, -10))).toBe(0);
    expect(evPerEurForDeal(makeDeal("B", 0.6, -5, -10))).toBe(0);
  });
});

describe("computeUniformPortfolioStats", () => {
  it("returns zeros for an empty portfolio", () => {
    const stats = computeUniformPortfolioStats([]);
    expect(stats.weightedWinRate).toBe(0);
    expect(stats.weightedEvPerEur).toBe(0);
    expect(stats.perDealBreakdown).toEqual([]);
  });

  it("gives every deal an equal sizeShare and matches the arithmetic mean of EV", () => {
    const deals = [
      makeDeal("AAA", 0.7, 10, -10),
      makeDeal("BBB", 0.3, 10, -10),
    ];
    const stats = computeUniformPortfolioStats(deals);
    expect(stats.perDealBreakdown).toHaveLength(2);
    for (const row of stats.perDealBreakdown) {
      expect(row.sizeShare).toBeCloseTo(0.5, 6);
    }
    // Mean EV (new formula) = (0.07 + 0.03) / 2 = 0.05
    expect(stats.weightedEvPerEur).toBeCloseTo(0.05, 6);
    expect(stats.uniformEvPerEur).toBeCloseTo(0.05, 6);
    expect(stats.weightedWinRate).toBeCloseTo(0.5, 6);
  });
});

describe("computeWeightedPortfolioStats", () => {
  it("returns an empty result for an empty portfolio", () => {
    const stats = computeWeightedPortfolioStats([]);
    expect(stats.weightedEvPerEur).toBe(0);
    expect(stats.weightedWinRate).toBe(0);
    expect(stats.perDealBreakdown).toEqual([]);
    expect(stats.uniformFallbackActive).toBe(false);
  });

  it("concentrates capital on the higher-EV deal when EVs differ", () => {
    const deals = [
      makeDeal("HIGH", 0.7, 10, -10), // EV = 0.07 (winRate × payoffWinPct / 100)
      makeDeal("LOW", 0.35, 10, -10), // EV = 0.035
    ];
    const stats = computeWeightedPortfolioStats(deals);
    const high = stats.perDealBreakdown.find((r) => r.ticker === "HIGH")!;
    const low = stats.perDealBreakdown.find((r) => r.ticker === "LOW")!;
    expect(high.sizeShare).toBeGreaterThan(low.sizeShare);
    expect(stats.weightedEvPerEur).toBeGreaterThan(low.evPerEur);
    expect(stats.weightedEvPerEur).toBeLessThan(high.evPerEur);
  });

  it("dampens LOW-confidence deals relative to HIGH-confidence ones", () => {
    const deals = [
      makeDeal("HIGHCONF", 0.6, 10, -10, "high"),
      makeDeal("LOWCONF", 0.6, 10, -10, "low"),
    ];
    const stats = computeWeightedPortfolioStats(deals);
    const hi = stats.perDealBreakdown.find((r) => r.ticker === "HIGHCONF")!;
    const lo = stats.perDealBreakdown.find((r) => r.ticker === "LOWCONF")!;
    expect(hi.confidenceMultiplier).toBe(DEFAULT_CONFIDENCE_MULTIPLIERS.high);
    expect(lo.confidenceMultiplier).toBe(DEFAULT_CONFIDENCE_MULTIPLIERS.low);
    expect(hi.sizeShare).toBeGreaterThan(lo.sizeShare);
  });

  it("halves the weight of deals that match the Step 2 pattern by default", () => {
    const deals = [
      makeDeal("CLEAN", 0.6, 10, -10),
      makeDeal("RISKY", 0.6, 10, -10),
    ];
    const matches = (d: ComparisonDeal) => d.ticker === "RISKY";
    const stats = computeWeightedPortfolioStats(deals, undefined, matches);
    const clean = stats.perDealBreakdown.find((r) => r.ticker === "CLEAN")!;
    const risky = stats.perDealBreakdown.find((r) => r.ticker === "RISKY")!;
    expect(clean.matchesStep2Pattern).toBe(false);
    expect(risky.matchesStep2Pattern).toBe(true);
    expect(risky.patternPenaltyFactor).toBe(DEFAULT_WEIGHTED_SIZING_CONFIG.patternPenalty);
    expect(clean.sizeShare).toBeGreaterThan(risky.sizeShare);
    // Halving the weight should roughly halve the size share too (both deals
    // have identical EV and confidence so the ratio must be exact).
    expect(clean.sizeShare / risky.sizeShare).toBeCloseTo(
      1 / DEFAULT_WEIGHTED_SIZING_CONFIG.patternPenalty,
      6,
    );
  });

  it("falls back to uniform when every deal has zero adjustedScore", () => {
    // With the new formula evPerEur is zero only when winRate=0 or
    // payoffWinPct ≤ 0 (no SDS payoff available).
    const deals = [
      makeDeal("NOSDS1", 0.6, 0, -10),
      makeDeal("NOSDS2", 0.5, 0, -10),
    ];
    const stats = computeWeightedPortfolioStats(deals);
    expect(stats.uniformFallbackActive).toBe(true);
    for (const row of stats.perDealBreakdown) {
      expect(row.sizeShare).toBeCloseTo(0.5, 6);
    }
  });

  it("sizeShare sums to ~1 across the portfolio", () => {
    const deals = [
      makeDeal("A", 0.65, 10, -10, "high"),
      makeDeal("B", 0.6, 10, -10, "medium"),
      makeDeal("C", 0.55, 10, -10, "low"),
    ];
    const stats = computeWeightedPortfolioStats(deals);
    const total = stats.perDealBreakdown.reduce((s, r) => s + r.sizeShare, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe("breakevenCapitalForSlope", () => {
  it("returns null when the slope is non-positive", () => {
    expect(breakevenCapitalForSlope(0, 1000)).toBeNull();
    expect(breakevenCapitalForSlope(-0.01, 1000)).toBeNull();
  });

  it("returns target/slope for positive slopes", () => {
    expect(breakevenCapitalForSlope(0.02, 1000)).toBeCloseTo(50_000, 4);
  });

  it("returns 0 when the target spending is non-positive", () => {
    expect(breakevenCapitalForSlope(0.02, 0)).toBe(0);
    expect(breakevenCapitalForSlope(0.02, -100)).toBe(0);
  });
});

describe("computeProfitProbabilityCurve", () => {
  it("returns an all-zero curve when the deal list is empty", () => {
    const curve = computeProfitProbabilityCurve(
      [],
      [1000, 2000, 3000],
      [],
      0,
    );
    expect(curve).toHaveLength(3);
    for (const p of curve) expect(p.probPct).toBe(0);
  });

  it("returns 100% at all capitals when every deal always wins", () => {
    const deals = [makeDeal("A", 1.0, 20, -10), makeDeal("B", 1.0, 30, -5)];
    const curve = computeProfitProbabilityCurve(
      deals,
      [1000, 5000],
      [0.5, 0.5],
      0,
    );
    for (const p of curve) expect(p.probPct).toBeCloseTo(100, 4);
  });

  it("returns 0% at all capitals when every deal always loses (target > 0)", () => {
    const deals = [makeDeal("A", 0, 20, -10), makeDeal("B", 0, 30, -5)];
    const curve = computeProfitProbabilityCurve(
      deals,
      [1000, 5000],
      [0.5, 0.5],
      0,
    );
    for (const p of curve) expect(p.probPct).toBeCloseTo(0, 4);
  });

  it("matches the analytic binomial probability for a single uniform deal", () => {
    // Single deal with winRate=0.6, equal-share=1.0 → P(net ≥ 0) = winRate.
    const deal = makeDeal("ONLY", 0.6, 20, -10);
    const curve = computeProfitProbabilityCurve([deal], [1000], [1.0], 0);
    expect(curve[0].probPct).toBeCloseTo(60, 4);
  });

  it("rises monotonically when expectancy is positive (diversification effect)", () => {
    // 4 i.i.d. deals, winRate 0.7, payoff +30 / -15. Expectancy positive
    // ⇒ probability of (net ≥ a small positive spending) must rise with
    // capital because the binomial concentrates around its mean.
    const deals = [
      makeDeal("A", 0.7, 30, -15),
      makeDeal("B", 0.7, 30, -15),
      makeDeal("C", 0.7, 30, -15),
      makeDeal("D", 0.7, 30, -15),
    ];
    const shares = [0.25, 0.25, 0.25, 0.25];
    const curve = computeProfitProbabilityCurve(
      deals,
      [4_000, 20_000, 50_000, 100_000],
      shares,
      1_000,
    );
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].probPct).toBeGreaterThanOrEqual(curve[i - 1].probPct - 0.01);
    }
    expect(curve[curve.length - 1].probPct).toBeGreaterThan(curve[0].probPct);
  });

  it("falls back to Monte Carlo above the threshold without crashing", () => {
    // 20 deals → 2^20 > monteCarloThreshold(16). MC should kick in.
    const deals = Array.from({ length: 20 }, (_, i) =>
      makeDeal(`T${i}`, 0.5, 15, -10),
    );
    const shares = new Array(20).fill(0.05);
    const curve = computeProfitProbabilityCurve(
      deals,
      [10_000, 50_000],
      shares,
      0,
      16,
      500,
    );
    expect(curve).toHaveLength(2);
    for (const p of curve) {
      expect(p.probPct).toBeGreaterThanOrEqual(0);
      expect(p.probPct).toBeLessThanOrEqual(100);
    }
  });
});

describe("computePortfolioSuccessEstimate", () => {
  it("computes share-weighted win rate and P(net ≥ 0) for equal sizing", () => {
    const deals = [makeDeal("A", 0.6, 10, -8), makeDeal("B", 0.4, 10, -8)];
    const est = computePortfolioSuccessEstimate(deals, [0.5, 0.5], 10_000, 0);
    expect(est.avgWinRate).toBeCloseTo(0.5, 6);
    expect(est.probNetAtTargetPct).toBeGreaterThan(0);
    expect(est.probNetAtTargetPct).toBeLessThanOrEqual(100);
  });

  it("evaluates P(net ≥ spending target) separately from P(net ≥ 0)", () => {
    const deals = [makeDeal("A", 0.7, 10, -8), makeDeal("B", 0.5, 10, -8)];
    const atZero = computePortfolioSuccessEstimate(deals, [0.5, 0.5], 50_000, 0);
    const atTarget = computePortfolioSuccessEstimate(deals, [0.5, 0.5], 50_000, 5_000);
    expect(atZero.probNetAtTargetPct).toBeGreaterThanOrEqual(atTarget.probNetAtTargetPct);
    expect(atTarget.probNetAtTargetPct).toBeLessThan(100);
  });
});

describe("computePortfolioSizingSuccessComparison", () => {
  it("returns equal, weighted and synth estimates", () => {
    const deals = [makeDeal("A", 0.55, 10, -8), makeDeal("B", 0.45, 10, -8)];
    const cmp = computePortfolioSizingSuccessComparison({
      deals,
      totalCapitalEur: 20_000,
      equalCapByTicker: { A: 10_000, B: 10_000 },
      weightedCapByTicker: { A: 12_000, B: 8_000 },
      synthCapByTicker: { A: 14_000, B: 6_000 },
      targetGainEur: 100,
    });
    expect(cmp.equal.avgWinRate).toBeCloseTo(0.5, 6);
    expect(cmp.weighted?.avgWinRate).toBeCloseTo(0.51, 6);
    expect(cmp.synth.avgWinRate).toBeCloseTo(0.52, 6);
    expect(cmp.synthAtGainTarget.probNetAtTargetPct).toBeLessThanOrEqual(
      cmp.synth.probNetAtTargetPct,
    );
  });
});

describe("findBreakevenCapitalFromCurve", () => {
  it("returns null on empty curves", () => {
    expect(findBreakevenCapitalFromCurve([], 99)).toBeNull();
  });

  it("returns null when the curve never reaches the target", () => {
    expect(
      findBreakevenCapitalFromCurve(
        [
          { capitalEur: 0, probPct: 10 },
          { capitalEur: 10_000, probPct: 50 },
          { capitalEur: 20_000, probPct: 80 },
        ],
        99,
      ),
    ).toBeNull();
  });

  it("returns the first capital sample when the curve starts above target", () => {
    expect(
      findBreakevenCapitalFromCurve(
        [
          { capitalEur: 5_000, probPct: 99.5 },
          { capitalEur: 10_000, probPct: 100 },
        ],
        99,
      ),
    ).toBe(5_000);
  });

  it("linearly interpolates between sample points", () => {
    // From 80% at €10k to 100% at €20k, the 90% point should be €15k.
    expect(
      findBreakevenCapitalFromCurve(
        [
          { capitalEur: 10_000, probPct: 80 },
          { capitalEur: 20_000, probPct: 100 },
        ],
        90,
      ),
    ).toBeCloseTo(15_000, 4);
  });
});
