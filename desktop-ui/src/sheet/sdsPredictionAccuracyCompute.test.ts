import { describe, expect, it } from "vitest";
import {
  computeMinimalSignificantSdsScore,
  computeSdsScoreBandStats,
  computeSdsSignalImpactInsights,
  computeNodeAccuracySummary,
  computeSdsAccuracyKpis,
  SDS_GROW_SIGNIFICANT_MIN_PCT,
} from "./sdsPredictionAccuracyCompute";
import type { SdsPredictionSignal } from "./sdsRoiTemporalConvergence";

function signal(
  score: number,
  offset: number,
  actual: number | null,
): SdsPredictionSignal {
  return {
    id: `TK|2026-06-01|${score}`,
    ticker: "TK",
    sdsScore: score,
    cdDate: "2026-06-01",
    nodes: [
      { label: "T-7", offset, predicted: 10, actual },
      { label: "T-30", offset: -30, predicted: 5, actual: null },
    ],
  };
}

describe("computeMinimalSignificantSdsScore", () => {
  it("returns lowest band min when grow threshold met", () => {
    const stats = [
      { label: "0–25", min: 0, max: 25, n: 3, growActualPct: 33, meanActualPp: 1 },
      { label: "25–50", min: 25, max: 50, n: 4, growActualPct: 60, meanActualPp: 3 },
      { label: "50–75", min: 50, max: 75, n: 5, growActualPct: 80, meanActualPp: 8 },
    ];
    const out = computeMinimalSignificantSdsScore(stats, SDS_GROW_SIGNIFICANT_MIN_PCT, 2);
    expect(out.score).toBe(25);
    expect(out.bandLabel).toBe("25–50");
  });
});

describe("computeSdsScoreBandStats", () => {
  it("groups actual ROI by SDS band at offset", () => {
    const signals = [
      signal(20, -7, 2),
      signal(30, -7, -1),
      signal(55, -7, 5),
      signal(80, -7, 8),
    ];
    const stats = computeSdsScoreBandStats(signals, -7);
    const mid = stats.find((s) => s.label === "25–50");
    expect(mid?.n).toBe(1);
    expect(mid?.growActualPct).toBe(0);
  });
});

describe("computeSdsSignalImpactInsights", () => {
  it("exposes confidence and best window from signals", () => {
    const signals = [
      signal(60, -7, 4),
      signal(70, -7, 6),
      signal(80, -7, 3),
      signal(55, -7, 2),
    ];
    const summary = computeNodeAccuracySummary(signals);
    const kpis = computeSdsAccuracyKpis(signals, []);
    const insights = computeSdsSignalImpactInsights(signals, summary, [], kpis);
    expect(insights.bestWindow?.label).toBe("T-7");
    expect(insights.confidencePct).toBeGreaterThanOrEqual(0);
    expect(insights.confidencePct).toBeLessThanOrEqual(100);
  });
});
