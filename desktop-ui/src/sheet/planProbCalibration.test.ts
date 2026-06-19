import { describe, expect, it } from "vitest";
import {
  applyPlanProbIsotonicShrink,
  applyPlanProbPostCalibration,
  detectPlanProbMisalignments,
  misalignmentDampFactor,
} from "./planProbCalibration";

describe("planProbCalibration", () => {
  it("detects spot vs model when gap exceeds threshold", () => {
    const ids = detectPlanProbMisalignments({ curveGapPct: 9.2 });
    expect(ids).toContain("spot_vs_model");
  });

  it("detects precat vs verdict conflict", () => {
    const ids = detectPlanProbMisalignments({
      precatKind: "avoid",
      investVerdict: "yes",
    });
    expect(ids).toContain("precat_vs_verdict");
  });

  it("misalignment dampener stacks with floor", () => {
    const damp = misalignmentDampFactor(["spot_vs_model", "precat_vs_verdict", "harmony_pred_slope"]);
    expect(damp).toBeGreaterThanOrEqual(0.72);
    expect(damp).toBeLessThan(1);
  });

  it("isotonic shrink moderates 70–79 band without crushing 80+", () => {
    expect(applyPlanProbIsotonicShrink(65)).toBe(65);
    expect(applyPlanProbIsotonicShrink(74)).toBeLessThan(74);
    expect(applyPlanProbIsotonicShrink(74)).toBeGreaterThan(58);
    expect(applyPlanProbIsotonicShrink(77)).toBeLessThan(applyPlanProbIsotonicShrink(85));
    expect(applyPlanProbIsotonicShrink(85)).toBeGreaterThan(68);
  });

  it("post-calibration applies dampener then isotonic shrink", () => {
    const out = applyPlanProbPostCalibration(76, {
      curveGapPct: 10,
      precatKind: "enter",
      investVerdict: "no",
    });
    expect(out.probabilityPct).toBeLessThan(76);
    expect(out.misalignmentIds).toContain("spot_vs_model");
    expect(out.misalignmentIds).toContain("precat_vs_verdict");
    expect(out.dampFactor).toBeLessThan(1);
  });
});
