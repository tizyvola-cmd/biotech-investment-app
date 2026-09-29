import { describe, expect, it } from "vitest";
import {
  buildEisSuperScoreChartRows,
  EIS_SUPER_MIN_N,
  fisherPearsonCi,
  isLikelyMonotoneCalibrationByLift,
  isMonotoneCalibrationBlend,
  type EisSuperScoreOverview,
} from "../sheet/eisSuperScoreLearningView";

const sampleOverview: EisSuperScoreOverview = {
  correlation_timeline: [
    {
      window: "180d+",
      days_min: 181,
      days_max: null,
      days_mid: 211,
      n_events: 20,
      n_price_7d: 18,
      corr_raw_7d: 0.4,
      corr_super_7d: 0.45,
      lift_7d: 0.05,
      mono_spearman_raw_super_7d: 0.999,
    },
    {
      window: "0–7d",
      days_min: 0,
      days_max: 7,
      days_mid: 4,
      n_events: 10,
      n_price_7d: 3,
      corr_raw_7d: 0.7,
      corr_super_7d: 0.85,
      lift_7d: 0.15,
    },
  ],
  effectiveness: {
    mean_corr_raw_7d: 0.5,
    mean_corr_super_7d: 0.6,
    mean_lift_7d: 0.1,
    mean_mono_spearman_raw_super_7d: 0.998,
  },
  learning_history: [],
};

describe("buildEisSuperScoreChartRows", () => {
  it("sorts bins by days_mid descending (far → CD)", () => {
    const rows = buildEisSuperScoreChartRows(sampleOverview);
    expect(rows.length).toBe(2);
    expect(rows[0]!.daysMid).toBeGreaterThan(rows[1]!.daysMid);
  });

  it("maps correlation fields", () => {
    const rows = buildEisSuperScoreChartRows(sampleOverview);
    const near = rows.find((r) => r.window === "0–7d");
    expect(near?.corrSuper7d).toBe(0.85);
    expect(near?.lift7d).toBe(0.15);
  });

  it("gates low-n buckets", () => {
    const rows = buildEisSuperScoreChartRows(sampleOverview);
    const near = rows.find((r) => r.window === "0–7d");
    expect(near?.nGated).toBe(true);
    expect(near?.corrSuper7dGated).toBeNull();
    const far = rows.find((r) => r.window === "180d+");
    expect(far?.nGated).toBe(false);
    expect(far?.corrSuper7dGated).toBe(0.45);
  });

  it("detects monotone calibration", () => {
    expect(isMonotoneCalibrationBlend(sampleOverview)).toBe(true);
    expect(EIS_SUPER_MIN_N).toBeGreaterThanOrEqual(10);
  });

  describe("isLikelyMonotoneCalibrationByLift", () => {
    const baseFallback: EisSuperScoreOverview = {
      effectiveness: {
        mean_corr_raw_7d: 0.656,
        mean_corr_super_7d: 0.656,
        mean_lift_7d: 0.0,
        mean_mae_lift_7d: 0.33,
        mean_mono_spearman_raw_super_7d: null,
      },
    };

    it("fires when Δρ≈0 and Δ MAE > 0 and mono is missing", () => {
      expect(isLikelyMonotoneCalibrationByLift(baseFallback)).toBe(true);
    });

    it("stays silent once mono-Spearman is available", () => {
      expect(
        isLikelyMonotoneCalibrationByLift({
          effectiveness: {
            ...baseFallback.effectiveness!,
            mean_mono_spearman_raw_super_7d: 0.6,
          },
        }),
      ).toBe(false);
    });

    it("stays silent if Δρ is meaningfully non-zero", () => {
      expect(
        isLikelyMonotoneCalibrationByLift({
          effectiveness: { ...baseFallback.effectiveness!, mean_lift_7d: 0.05 },
        }),
      ).toBe(false);
    });

    it("stays silent if MAE lift is too small or negative", () => {
      expect(
        isLikelyMonotoneCalibrationByLift({
          effectiveness: { ...baseFallback.effectiveness!, mean_mae_lift_7d: 0.05 },
        }),
      ).toBe(false);
      expect(
        isLikelyMonotoneCalibrationByLift({
          effectiveness: { ...baseFallback.effectiveness!, mean_mae_lift_7d: -0.5 },
        }),
      ).toBe(false);
    });

    it("stays silent when required fields are missing", () => {
      expect(isLikelyMonotoneCalibrationByLift(null)).toBe(false);
      expect(isLikelyMonotoneCalibrationByLift({})).toBe(false);
      expect(
        isLikelyMonotoneCalibrationByLift({
          effectiveness: { mean_lift_7d: 0.0 },
        }),
      ).toBe(false);
    });
  });

  it("computes Fisher CI for super T+1", () => {
    const ci = fisherPearsonCi(0.65, 20);
    expect(ci.lo).not.toBeNull();
    expect(ci.hi).not.toBeNull();
    expect(ci.lo!).toBeLessThan(0.65);
    expect(ci.hi!).toBeGreaterThan(0.65);
    expect(fisherPearsonCi(0.5, 3).lo).toBeNull();
  });
});
