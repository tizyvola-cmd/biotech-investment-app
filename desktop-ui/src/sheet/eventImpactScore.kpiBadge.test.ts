import { describe, expect, it } from "vitest";
import type { ClinicalStudyIndicator } from "../api/supernova";
import {
  computeEis,
  eisColor,
  eisIntrinsicFromKpi,
  formatKpiUnitScoreBadge,
  formatEisIntrinsicShort,
  K_INTRINSIC,
  kpiIndicatorUnitScore,
} from "./eventImpactScore";

describe("kpiIndicatorUnitScore", () => {
  it("scores endpoint-met EFF with significant p highly positive", () => {
    const ind: ClinicalStudyIndicator = {
      label: "Event-free survival at 36 months (CPS ≥10)",
      value: "59.8%",
      numeric_value: 59.8,
      kpi_type: "efficacy",
      endpoint_met: true,
      direction: "up",
      p_value: "0.004",
      confidence_interval: "95% CI: 49-88%",
      vs_soc: "better",
    };
    const s = kpiIndicatorUnitScore(ind);
    expect(s).toBeGreaterThan(1.2);
    expect(formatKpiUnitScoreBadge(s)).toMatch(/^KPI \+/);
  });

  it("scores endpoint missed as negative", () => {
    const ind: ClinicalStudyIndicator = {
      label: "Primary endpoint ORR",
      value: "12%",
      numeric_value: 12,
      kpi_type: "efficacy",
      endpoint_met: false,
      direction: "down",
      p_value: "0.42",
    };
    expect(kpiIndicatorUnitScore(ind)).toBeLessThan(0);
  });
});

describe("eis_intrinsic", () => {
  it("is clamp(kpi)×K_INTRINSIC and is not added into market score", () => {
    const marketOnly = computeEis(5, 5, 1, 0);
    expect(marketOnly.eis_intrinsic).toBeNull();
    const withKpi = computeEis(5, 5, 1, 0, undefined, 0.5);
    expect(withKpi.kpi_score).toBe(0.5);
    expect(withKpi.eis_intrinsic).toBe(0.5 * K_INTRINSIC);
    expect(withKpi.score).toBeCloseTo(marketOnly.score + 0.15 * (0.5 * 10), 5);
    expect(eisIntrinsicFromKpi(3)).toBe(2 * K_INTRINSIC);
    expect(eisIntrinsicFromKpi(-3)).toBe(-2 * K_INTRINSIC);
    expect(eisIntrinsicFromKpi(null)).toBeNull();
  });

  it("formatEisIntrinsicShort hides missing and ~0", () => {
    expect(formatEisIntrinsicShort(null)).toBeNull();
    expect(formatEisIntrinsicShort(0)).toBeNull();
    expect(formatEisIntrinsicShort(6.75)).toBe("int +6.8");
    expect(formatEisIntrinsicShort(-7.2)).toBe("int -7.2");
  });
});

describe("eisColor", () => {
  it("marks any negative score red (incl. mild −1.0)", () => {
    expect(eisColor(-1)).toMatch(/^#(F87185|ea580c|dc2626)$/i);
    expect(eisColor(-0.5)).toMatch(/^#(F87185|ea580c|dc2626)$/i);
    expect(eisColor(-8)).toBe("#dc2626");
  });

  it("marks any positive score green", () => {
    expect(eisColor(1)).toMatch(/^#(34D399|65a30d|16a34a)$/i);
    expect(eisColor(0)).toBe("#64748b");
  });
});
