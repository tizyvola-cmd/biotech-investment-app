import { describe, expect, it } from "vitest";
import type { SlopeTrajectoryPoint } from "./slopeRecalibCurve";
import {
  buildExpectedPreErrorTrajectory,
  buildTrajectoryWindowSlices,
  buildWindowPointSlice,
  SLOPE_WINDOW_20D,
  SLOPE_WINDOW_5D,
} from "./slopeTrajectoryOverlay";

function pt(offset: number, pred: number, actual?: number | null): SlopeTrajectoryPoint {
  return {
    offset,
    label: `T${offset}`,
    pred,
    actual: actual ?? null,
    gap: actual != null ? pred - actual : null,
    isRecalibKnot: false,
    isToday: offset === -21,
  };
}

describe("slopeTrajectoryOverlay", () => {
  it("builds pred window slices when actual history is missing", () => {
    const points = [
      pt(-30, -2),
      pt(-20, 1),
      pt(-10, 4),
      pt(-5, 6),
      pt(-3, 5),
      pt(-21, 0, null),
    ];
    const slices = buildTrajectoryWindowSlices(points, "en", "pred");
    expect(slices).toHaveLength(2);
    expect(slices[0]?.field).toBe("pred");
    expect(slices[0]?.points.length).toBeGreaterThanOrEqual(2);
    expect(slices[1]?.points.length).toBeGreaterThanOrEqual(2);
  });

  it("window slice follows pred curve offsets, not flat chord at bottom", () => {
    const points = [
      pt(-30, -1),
      pt(-15, 3),
      pt(-10, 5),
      pt(-7, 4),
      pt(-3, 2),
      pt(-21, 0),
    ];
    const slice20 = buildWindowPointSlice(points, "pred", SLOPE_WINDOW_20D);
    const slice5 = buildWindowPointSlice(points, "pred", SLOPE_WINDOW_5D);
    expect(slice20.some((p) => (p.pred ?? 0) > 2)).toBe(true);
    expect(slice5.some((p) => (p.pred ?? 0) > 1)).toBe(true);
    expect(slice20[0]?.offset).toBe(SLOPE_WINDOW_20D.start);
    expect(slice5[slice5.length - 1]?.offset).toBe(SLOPE_WINDOW_5D.end);
  });

  it("extrapolates 20d expected path from −10d pivot", () => {
    const points = [
      pt(-30, -1),
      pt(-15, 3),
      pt(-10, 5),
      pt(-7, 4),
      pt(-3, 2),
      pt(-21, 0),
    ];
    const expected = buildExpectedPreErrorTrajectory(points, -21, 0.72, "pred");
    expect(expected.length).toBeGreaterThanOrEqual(2);
    const atPivot = expected.find((p) => p.offset === -10);
    expect(atPivot?.expected).toBe(5);
    const atToday = expected.find((p) => p.offset === -21);
    expect(atToday?.expected).toBeCloseTo(5 + 0.72 * (-21 - -10), 1);
  });
});
