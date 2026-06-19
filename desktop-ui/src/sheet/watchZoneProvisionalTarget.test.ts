import { describe, expect, it } from "vitest";
import {
  computeWatchTargetConfidenceMultiplier,
  hotSegmentPeakReturnPct,
} from "./watchZoneProvisionalTarget";

describe("watchZoneProvisionalTarget", () => {
  it("confidence scales with timing predictability", () => {
    const row = { "R²": 0.75, "Affidabilità\ncalib %": 0.7 };
    const conf = computeWatchTargetConfidenceMultiplier(90, row);
    expect(conf).toBeGreaterThanOrEqual(0.45);
    expect(conf).toBeLessThanOrEqual(0.85);
  });

  it("hot segment peak from chart knots", () => {
    const row = { "Completion Date": "2026-09-01" };
    const pts = [
      { offset: -60, pct_modello: 0, pct_foglio: null, pct_curva: null },
      { offset: -30, pct_modello: 3, pct_foglio: null, pct_curva: null },
      { offset: 0, pct_modello: 8, pct_foglio: null, pct_curva: null },
    ];
    const peak = hotSegmentPeakReturnPct(row, pts);
    expect(peak).not.toBeNull();
    expect(peak!).toBeGreaterThan(0);
  });
});
