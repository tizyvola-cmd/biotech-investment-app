import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIG_CONFIG,
  computeModelSlopeCalibration,
  evaluateBatch,
  evaluateMarketInterest,
  slopeAngleFromDeltaAndVol,
  slopeAngleFromMiiRaw,
} from "./marketInterestGate";

describe("marketInterestGate", () => {
  it("maps +5% @ 1.5x vol to ~20° at default config", () => {
    const r = evaluateMarketInterest(
      { ticker: "TLX", deltaPricePct: 5, volRatio: 1.5 },
      DEFAULT_MIG_CONFIG,
    );
    expect(r.slopeAngleDeg).toBeGreaterThan(15);
    expect(r.slopeAngleDeg).toBeLessThan(28);
    expect(r.verdict).toBe("PASS");
  });

  it("blocks noise-level moves", () => {
    const r = evaluateMarketInterest(
      { ticker: "X", deltaPricePct: 0.5, volRatio: 1.0 },
      DEFAULT_MIG_CONFIG,
    );
    expect(Math.abs(r.slopeAngleDeg)).toBeLessThan(12);
    expect(r.verdict).toBe("BLOCK");
  });

  it("applies low-volume penalty on price up", () => {
    const r = evaluateMarketInterest(
      { ticker: "Y", deltaPricePct: 8, volRatio: 0.5 },
      DEFAULT_MIG_CONFIG,
    );
    expect(r.lowVolumePenalty).toBe(true);
    const noPen = evaluateMarketInterest(
      { ticker: "Y", deltaPricePct: 8, volRatio: 2 },
      DEFAULT_MIG_CONFIG,
    );
    expect(noPen.slopeAngleDeg).toBeGreaterThan(r.slopeAngleDeg);
  });

  it("evaluateBatch partitions by verdict", () => {
    const batch = evaluateBatch([
      { ticker: "A", deltaPricePct: 6, volRatio: 1.6 },
      { ticker: "B", deltaPricePct: 0.2, volRatio: 1 },
    ]);
    expect(batch.all.length).toBe(2);
    expect(batch.pass.length + batch.watch.length + batch.block.length).toBe(2);
  });

  it("slope angle is bounded ~±90", () => {
    const a = slopeAngleFromMiiRaw(500, 15);
    expect(a).toBeLessThan(90);
    expect(a).toBeGreaterThan(80);
  });

  it("model calibration — aligned when market matches model slope", () => {
    const modelSlope5d = 1.2;
    const modelDelta = modelSlope5d * 5;
    const vol = 1.5;
    const marketAngle = slopeAngleFromDeltaAndVol(modelDelta, vol);
    const calib = computeModelSlopeCalibration(marketAngle, modelSlope5d, vol);
    expect(calib.modelSlopeAngleDeg).toBeCloseTo(marketAngle, 1);
    expect(calib.slopeDeltaDeg).toBe(0);
    expect(calib.calibrationScore).toBeGreaterThan(95);
    expect(calib.calibrationTier).toBe("aligned");
  });

  it("model calibration — contrarian when signs oppose", () => {
    const calib = computeModelSlopeCalibration(22, -1.5, 1.4);
    expect(calib.calibrationTier).toBe("contrarian");
    expect(calib.calibrationScore).toBeLessThan(50);
  });

  it("evaluateMarketInterest computes pre and post daily calib", () => {
    const r = evaluateMarketInterest({
      ticker: "TLX",
      deltaPricePct: 5,
      volRatio: 1.5,
      preDailyModelSlope5dPpPerDay: 0.8,
      postDailyModelSlope5dPpPerDay: 1.2,
    });
    expect(r.calibPreDaily.modelSlopeAngleDeg).not.toBeNull();
    expect(r.calibPostDaily.modelSlopeAngleDeg).not.toBeNull();
    expect(r.calibPreDaily.calibrationScore).not.toBeNull();
    expect(r.calibPostDaily.calibrationScore).not.toBeNull();
    expect(r.detail).toContain("pre");
    expect(r.detail).toContain("post");
  });
});
