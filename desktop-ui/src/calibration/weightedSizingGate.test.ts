import { describe, expect, it } from "vitest";
import type { CalibrationSnapshot } from "./calibrationTypes";
import {
  WEIGHTED_SIZING_MIN_TRADES,
  evaluateWeightedSizingGate,
  weightedSizingGateMessage,
} from "./weightedSizingGate";

function snap(totalTrades: number, highCells: number): CalibrationSnapshot {
  const cells = Array.from({ length: highCells }, (_, i) => ({
    dimension: "clinicalPhase" as const,
    cell: `Phase ${i}`,
    n: 20,
    wins: 10,
    rawObserved: 0.5,
    shrinkageApplied: 0.5,
    prior: 0.5,
    k: 8,
    confidence: "high" as const,
    inactive: null,
    avgPnlPct: 1,
    capitalDeployedEur: 1000,
  }));
  return {
    computedAt: "2026-01-01T00:00:00Z",
    globalPrior: 0.5,
    totalTrades,
    dimensions: {
      clinicalPhase: {
        dimension: "clinicalPhase",
        prior: 0.5,
        hasVariance: true,
        cells,
        totalN: totalTrades,
      },
      clinicalIndication: {
        dimension: "clinicalIndication",
        prior: 0.5,
        hasVariance: false,
        cells: [],
        totalN: 0,
      },
      sdsBucket: {
        dimension: "sdsBucket",
        prior: 0.5,
        hasVariance: false,
        cells: [],
        totalN: 0,
      },
      pplanBucket: {
        dimension: "pplanBucket",
        prior: 0.5,
        hasVariance: false,
        cells: [],
        totalN: 0,
      },
    },
  };
}

describe("evaluateWeightedSizingGate", () => {
  it("blocks when trades below threshold", () => {
    const g = evaluateWeightedSizingGate(snap(5, 1));
    expect(g.ok).toBe(false);
    expect(g.reasons).toContain("insufficient_trades");
  });

  it("blocks when no HIGH bucket", () => {
    const g = evaluateWeightedSizingGate(snap(WEIGHTED_SIZING_MIN_TRADES, 0));
    expect(g.ok).toBe(false);
    expect(g.reasons).toContain("no_high_confidence_bucket");
  });

  it("passes when both conditions met", () => {
    const g = evaluateWeightedSizingGate(snap(WEIGHTED_SIZING_MIN_TRADES, 2));
    expect(g.ok).toBe(true);
    expect(g.reasons).toHaveLength(0);
  });

  it("message mentions missing requirements", () => {
    const g = evaluateWeightedSizingGate(snap(5, 0));
    const msg = weightedSizingGateMessage(g, "en");
    expect(msg).toContain(String(WEIGHTED_SIZING_MIN_TRADES));
    expect(msg.toLowerCase()).toContain("high");
  });
});
