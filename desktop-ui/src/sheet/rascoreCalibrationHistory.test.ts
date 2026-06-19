import { describe, expect, it } from "vitest";
import {
  buildRascoreEvolutionSummary,
  type RascoreWeeklySnapshot,
} from "./rascoreCalibrationHistory";

function week(
  key: string,
  rho: number | null,
  ts: number,
): RascoreWeeklySnapshot {
  return {
    weekKey: key,
    weekLabel: key,
    weekTs: ts,
    savedAt: new Date(ts).toISOString(),
    spearmanGrow7d: rho,
    tier: rho != null && rho >= 0.45 ? "strong" : "weak",
    nBinsUsed: 3,
    nSignals: 10,
    nWith7d: 8,
    investMinScore: null,
    peakGrow7dPct: 60,
    deltaRho: null,
  };
}

describe("buildRascoreEvolutionSummary", () => {
  it("detects improving rho trend over 4 weeks", () => {
    const summary = buildRascoreEvolutionSummary([
      week("2026-W01", 0.1, 1),
      week("2026-W02", 0.25, 2),
      week("2026-W03", 0.4, 3),
      week("2026-W04", 0.55, 4),
    ]);
    expect(summary.trend.label).toBe("improving");
    expect(summary.trend.rhoSlope).toBeGreaterThan(0.04);
    expect(summary.totalWeeks).toBe(4);
  });

  it("returns unknown with fewer than 3 rho weeks", () => {
    const summary = buildRascoreEvolutionSummary([
      week("2026-W01", 0.2, 1),
      week("2026-W02", null, 2),
    ]);
    expect(summary.trend.label).toBe("unknown");
  });
});
