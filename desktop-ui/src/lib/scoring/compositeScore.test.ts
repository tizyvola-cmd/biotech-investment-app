import { describe, expect, it } from "vitest";
import { computeCompositeScore, stabilityFactorFromVerdict } from "./compositeScore";
import { getScoringZone } from "./zoneWeights";

describe("getScoringZone", () => {
  it("maps CD distance and portfolio loss", () => {
    expect(getScoringZone(30, false, false)).toBe("hot");
    expect(getScoringZone(90, false, false)).toBe("watch");
    expect(getScoringZone(150, false, false)).toBe("early");
    expect(getScoringZone(30, true, true)).toBe("loss");
  });
});

describe("computeCompositeScore", () => {
  it("scores high in hot zone with strong P(plan) and Top2 yes", () => {
    const r = computeCompositeScore({
      daysToCd: 25,
      hasPosition: false,
      probPlan: 72,
      investVerdict: "yes",
      precatKind: "enter",
      stabilityVerdict: "persistent",
      signalScore: 68,
      sdsScore: 55,
      eisSuperScore: 6,
      forwardRoi: 8,
      matchPct: 75,
    });
    expect(r.zone).toBe("hot");
    expect(r.score).toBeGreaterThan(55);
    expect(r.breakdown.pplan).toBeGreaterThan(0);
  });

  it("normalizes loss zone weights when pplan/timing are zero", () => {
    const r = computeCompositeScore({
      daysToCd: 20,
      hasPosition: true,
      currentPnlPct: -8,
      probPlan: 70,
      investVerdict: "wait",
      precatKind: "accumulate",
      stabilityVerdict: "watch",
      slope20d: -0.2,
    });
    expect(r.zone).toBe("loss");
    expect(r.normalizedWeights.pplan).toBe(0);
    expect(r.normalizedWeights.slope).toBeGreaterThan(0);
  });

  it("applies dampener on weak concurrent signals", () => {
    const strong = computeCompositeScore({
      daysToCd: 40,
      hasPosition: false,
      probPlan: 65,
      investVerdict: "yes",
      precatKind: "enter",
      stabilityVerdict: "persistent",
      signalScore: 70,
      sdsScore: 60,
      matchPct: 80,
      forwardRoi: 6,
    });
    const weak = computeCompositeScore({
      ...{
        daysToCd: 40,
        hasPosition: false,
        probPlan: 65,
        investVerdict: "yes",
        precatKind: "enter",
        stabilityVerdict: "persistent",
        signalScore: 70,
      },
      sdsScore: 20,
      miiAngleDeg: -8,
      matchPct: 30,
      forwardRoi: 0.5,
      spotVsModelGapPct: 12,
    });
    expect(weak.dampened).toBe(true);
    expect(weak.score).toBeLessThan(strong.score);
  });
});

describe("stabilityFactorFromVerdict", () => {
  it("maps exit low and persistent high", () => {
    expect(stabilityFactorFromVerdict("exit")).toBe(0.18);
    expect(stabilityFactorFromVerdict("persistent")).toBe(0.88);
    expect(stabilityFactorFromVerdict("watch", true)).toBe(0.74);
  });
});
