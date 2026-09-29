import { describe, expect, it } from "vitest";
import {
  closedDealLossBinary,
  computeRiskScoreV2,
  dtcToRiskScore,
  riskLiquidityComponent,
  riskPlanComponent,
  riskPlanDeltaFromPplanCorrection,
  riskTimingComponent,
  slopeToRiskScore,
} from "./riskScoreV2";

describe("riskPlanComponent", () => {
  it("returns null when P(plan) missing", () => {
    expect(riskPlanComponent(null)).toBeNull();
    expect(riskPlanComponent(undefined)).toBeNull();
  });
  it("inverts P(plan)", () => {
    expect(riskPlanComponent(80)).toBe(20);
    expect(riskPlanComponent(40)).toBe(60);
  });
});

describe("riskTimingComponent", () => {
  it("returns null timing when DTC missing", () => {
    const r = riskTimingComponent({ daysToCd: null, slope5d: 0.2 });
    expect(r.timing).toBeNull();
    expect(r.slope).toBe(0);
  });
  it("weights DTC and slope", () => {
    const r = riskTimingComponent({ daysToCd: 10, slope5d: -0.1 });
    expect(r.dtc).toBe(100);
    expect(r.slope).toBe(100);
    expect(r.timing).toBe(100);
  });
});

describe("dtcToRiskScore", () => {
  it("maps endpoints", () => {
    expect(dtcToRiskScore(5)).toBe(100);
    expect(dtcToRiskScore(60)).toBe(0);
  });
});

describe("slopeToRiskScore", () => {
  it("uses 50 when missing", () => {
    expect(slopeToRiskScore(null)).toBe(50);
  });
});

describe("riskLiquidityComponent", () => {
  it("redistributes when illiquidity missing", () => {
    const r = riskLiquidityComponent({
      externalAlignmentScore: 80,
      volumeAnomalyScore: 40,
    });
    expect(r.illiquid).toBeNull();
    expect(r.liquidity).toBeCloseTo(0.57 * 20 + 0.43 * 40, 1);
  });
});

describe("computeRiskScoreV2", () => {
  it("reweights when timing is null", () => {
    const r = computeRiskScoreV2({
      entryPplanPct: 70,
      externalAlignmentScore: 60,
      volumeAnomalyScore: 30,
      marketCapUsd: 80_000_000,
    });
    expect(r.componentsUsed).not.toContain("timing");
    expect(r.score).not.toBeNull();
    expect(r.plan).toBe(30);
  });

  it("includes all four components when populated", () => {
    const r = computeRiskScoreV2({
      entryPplanPct: 55,
      daysToCd: 20,
      slope5d: -0.05,
      externalAlignmentScore: 70,
      volumeAnomalyScore: 25,
      marketCapUsd: 200_000_000,
      regulatoryImminenceScore: 45,
    });
    expect(r.componentsUsed).toEqual(
      expect.arrayContaining(["plan", "timing", "liquidity", "regulatory"]),
    );
    expect(r.score).toBeGreaterThan(0);
    expect(r.regulatorySource).toBe("imminence");
  });
});

describe("closedDealLossBinary", () => {
  it("matches LOSS_THRESHOLD", () => {
    expect(closedDealLossBinary(-2.5)).toBe(true);
    expect(closedDealLossBinary(-1)).toBe(false);
  });
});

describe("riskPlanDeltaFromPplanCorrection", () => {
  it("drops risk when P(plan) corrected upward in 50-70 band", () => {
    const delta = riskPlanDeltaFromPplanCorrection(55, 62);
    expect(delta).toBeLessThan(0);
  });
});
