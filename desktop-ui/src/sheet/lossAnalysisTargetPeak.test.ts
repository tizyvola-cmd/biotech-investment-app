import { describe, expect, it } from "vitest";
import {
  resolvePeakDaysGapReason,
  resolveTargetRoiGapReason,
} from "./lossAnalysisTargetPeak";

describe("lossAnalysisTargetPeak", () => {
  it("marks target available when planReturnPct is positive", () => {
    expect(
      resolveTargetRoiGapReason({
        daysToCd: 30,
        planReturnPct: 12,
        chartPointsLoaded: true,
      }),
    ).toBe("available");
  });

  it("explains watch zone beyond hot horizon", () => {
    expect(
      resolveTargetRoiGapReason({
        daysToCd: 75,
        planReturnPct: null,
        chartPointsLoaded: true,
      }),
    ).toBe("beyond_hot");
  });

  it("marks provisional watch target when positive", () => {
    expect(
      resolveTargetRoiGapReason({
        daysToCd: 85,
        planReturnPct: 4.2,
        chartPointsLoaded: true,
        targetProvisional: true,
      }),
    ).toBe("watch_provisional");
  });

  it("explains missing chart in hot zone", () => {
    expect(
      resolvePeakDaysGapReason({
        daysToCd: 20,
        daysToCurvePeak: null,
        chartPointsLoaded: false,
      }),
    ).toBe("no_chart");
  });

  it("explains flat curve in hot zone", () => {
    expect(
      resolvePeakDaysGapReason({
        daysToCd: 20,
        daysToCurvePeak: null,
        chartPointsLoaded: true,
      }),
    ).toBe("no_rise");
  });
});
