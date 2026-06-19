import { describe, expect, it } from "vitest";
import {
  computeSizingDecision,
  DEFAULT_SIZING_RULES_CONFIG,
  type SizingInput,
} from "./sizingRules";
import type { FrozenWeights } from "./calibrationTypes";

const emptyFrozen: FrozenWeights = {
  updatedAt: new Date().toISOString(),
  lastProposalId: null,
  weights: {
    clinicalPhase: {},
    clinicalIndication: {},
    sdsBucket: {},
    pplanBucket: {},
  },
};

const baseInput: SizingInput = {
  ticker: "ABC",
  cells: {
    clinicalPhase: "Phase 3",
    clinicalIndication: "Oncology",
    sdsBucket: "SDS 40-55 (Mid)",
    pplanBucket: "P(plan) 50-70%",
  },
  totalCapitalEur: 10000,
  targetPositions: 5,
};

describe("sizingRules", () => {
  it("returns neutral 1.0× when no approved weight exists for any cell", () => {
    const dec = computeSizingDecision(baseInput, emptyFrozen);
    // 10000 / 5 = 2000 baseline; no contribution → 2000 (modulo cap/floor)
    expect(dec.baselineEur).toBe(2000);
    // No caps triggered (deployed = 0 → headroom = full)
    expect(dec.capsTriggered.every((c) => !c.triggered)).toBe(true);
    expect(dec.sizeEur).toBe(2000);
    for (const c of dec.contributions) {
      expect(c.appliedMultiplier).toBe(1.0);
      expect(c.weight).toBe(DEFAULT_SIZING_RULES_CONFIG.neutralWeight);
    }
  });

  it("LOW confidence attenuates the multiplier strongly", () => {
    const frozen: FrozenWeights = {
      ...emptyFrozen,
      weights: {
        ...emptyFrozen.weights,
        pplanBucket: {
          "P(plan) 50-70%": { weight: 0.8, n: 3, confidence: "low" },
        },
      },
    };
    const dec = computeSizingDecision(baseInput, frozen);
    const pplanContrib = dec.contributions.find(
      (c) => c.dimension === "pplanBucket",
    )!;
    expect(pplanContrib.confidence).toBe("low");
    // Ideal multiplier ≈ 1 + (0.8-0.5)*2 = 1.6; attenuated by 0.25 → 1 + 0.6*0.25 = 1.15
    expect(pplanContrib.appliedMultiplier).toBeCloseTo(1.15, 2);
  });

  it("HIGH confidence applies full multiplier", () => {
    const frozen: FrozenWeights = {
      ...emptyFrozen,
      weights: {
        ...emptyFrozen.weights,
        pplanBucket: {
          "P(plan) 50-70%": { weight: 0.8, n: 30, confidence: "high" },
        },
      },
    };
    const dec = computeSizingDecision(baseInput, frozen);
    const pplanContrib = dec.contributions.find(
      (c) => c.dimension === "pplanBucket",
    )!;
    expect(pplanContrib.confidence).toBe("high");
    // Full ideal multiplier 1.6
    expect(pplanContrib.appliedMultiplier).toBeCloseTo(1.6, 2);
  });

  it("indication cap blocks oversized concentration", () => {
    const frozen: FrozenWeights = {
      ...emptyFrozen,
      weights: {
        ...emptyFrozen.weights,
        pplanBucket: {
          "P(plan) 50-70%": { weight: 0.95, n: 30, confidence: "high" },
        },
        sdsBucket: {
          "SDS 40-55 (Mid)": { weight: 0.9, n: 30, confidence: "high" },
        },
      },
    };
    const input: SizingInput = {
      ...baseInput,
      // 4000€ already deployed in Oncology — cap=40% of 10000=4000 → headroom 0
      deployedByIndicationEur: { Oncology: 4000 },
    };
    const dec = computeSizingDecision(input, frozen);
    const indCap = dec.capsTriggered.find((c) =>
      c.capName.includes("indicazione"),
    )!;
    expect(indCap.triggered).toBe(true);
    // Hard cap at floor since headroom = 0 → clamped to floor
    expect(dec.clamps.clampedToFloor).toBe(true);
  });

  it("absolute floor and cap are respected", () => {
    const frozen: FrozenWeights = {
      ...emptyFrozen,
      weights: {
        ...emptyFrozen.weights,
        pplanBucket: {
          "P(plan) 50-70%": { weight: 0.99, n: 100, confidence: "high" },
        },
        sdsBucket: {
          "SDS 40-55 (Mid)": { weight: 0.99, n: 100, confidence: "high" },
        },
        clinicalPhase: {
          "Phase 3": { weight: 0.99, n: 100, confidence: "high" },
        },
        clinicalIndication: {
          Oncology: { weight: 0.99, n: 100, confidence: "high" },
        },
      },
    };
    const dec = computeSizingDecision(baseInput, frozen);
    // All dimensions push high → without cap would be way above capPctSingle (25%)
    // sizeEur should clamp to 0.25 * 10000 = 2500
    expect(dec.clamps.clampedToCap).toBe(true);
    expect(dec.sizeEur).toBe(2500);
  });

  it("returns full decomposition (no opaque number)", () => {
    const dec = computeSizingDecision(baseInput, emptyFrozen);
    expect(dec.contributions.length).toBe(4); // all 4 dimensions
    expect(dec.capsTriggered.length).toBeGreaterThan(0);
    expect(dec.clamps).toBeDefined();
    expect(dec.baselineEur).toBeDefined();
  });
});
