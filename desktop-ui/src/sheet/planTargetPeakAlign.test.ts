import { describe, expect, it } from "vitest";
import {
  capPlanReturnToForwardPeak,
  forwardPeakForMisalignmentCompare,
  preCdCurvePeakForCompare,
} from "./planTargetPeakAlign";

describe("planTargetPeakAlign", () => {
  it("caps plan when forward peak is lower (CRDF-like)", () => {
    expect(
      capPlanReturnToForwardPeak(7.9, { forwardPeakPct: 3.04, targetHighPct: -0.5 }),
    ).toBe(3);
  });

  it("caps plan when targetHigh is below plan", () => {
    expect(capPlanReturnToForwardPeak(8, { forwardPeakPct: 10, targetHighPct: 5.5 })).toBe(5.5);
  });

  it("preCdCurvePeakForCompare excludes post-CD extended peak (CCCC-like)", () => {
    expect(
      preCdCurvePeakForCompare({
        curvePeakReturnPct: 17.04,
        daysToCurvePeak: 200,
        daysToCd: 110,
      }),
    ).toBeNull();
  });

  it("forwardPeakForMisalignmentCompare prefers harmonized pre-CD peak", () => {
    expect(
      forwardPeakForMisalignmentCompare(1.27, {
        curvePeakReturnPct: 17.04,
        daysToCurvePeak: 200,
        daysToCd: 110,
      }),
    ).toBe(1.27);
  });
});
