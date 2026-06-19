import { describe, expect, it } from "vitest";
import {
  deriveRaEntryInvestVerdict,
  type RaCalibrationThresholds,
} from "./raEntryInvestVerdict";

const th: RaCalibrationThresholds = {
  investMinScore: 50,
  divestBelowScore: 35,
  tier: "strong",
  source: "default",
  snapshotWeek: null,
};

describe("deriveRaEntryInvestVerdict", () => {
  it("maps opportunity rows to buy/hold/avoid from thresholds", () => {
    expect(
      deriveRaEntryInvestVerdict({ entryRa: 55, hasPosition: false, thresholds: th }).verdict,
    ).toBe("buy");
    expect(
      deriveRaEntryInvestVerdict({ entryRa: 42, hasPosition: false, thresholds: th }).verdict,
    ).toBe("hold");
    expect(
      deriveRaEntryInvestVerdict({ entryRa: 30, hasPosition: false, thresholds: th }).verdict,
    ).toBe("avoid");
  });

  it("maps portfolio rows to reduce when RA is low", () => {
    expect(
      deriveRaEntryInvestVerdict({ entryRa: 32, hasPosition: true, thresholds: th }).verdict,
    ).toBe("reduce");
    expect(
      deriveRaEntryInvestVerdict({ entryRa: 60, hasPosition: true, thresholds: th }).verdict,
    ).toBe("hold");
  });

  it("downgrades buy to hold when calibration tier is inverted", () => {
    const res = deriveRaEntryInvestVerdict({
      entryRa: 62,
      hasPosition: false,
      thresholds: { ...th, tier: "inverted", source: "snapshot", snapshotWeek: "2026-W24" },
    });
    expect(res.verdict).toBe("hold");
    expect(res.downgraded).toBe(true);
  });

  it("keeps buy on default thresholds even when tier is insufficient", () => {
    const res = deriveRaEntryInvestVerdict({
      entryRa: 62,
      hasPosition: false,
      thresholds: { ...th, tier: "insufficient", source: "default", snapshotWeek: null },
    });
    expect(res.verdict).toBe("buy");
    expect(res.downgraded).toBe(false);
  });
});
