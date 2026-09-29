import { describe, expect, it } from "vitest";
import {
  resolveEventEis,
  resolvePrimaryEisScore,
  type EisBreakdown,
} from "./eventImpactScore";

function bd(partial: Partial<EisBreakdown>): EisBreakdown {
  return {
    score: 0,
    delta_p_1d: null,
    delta_p_3d: null,
    vol_ratio: 1,
    vol_term: 0,
    sentiment: 0,
    sent_term: 0,
    weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
    ...partial,
  };
}

describe("resolvePrimaryEisScore", () => {
  it("uses market score when |score| >= 0.5", () => {
    expect(resolvePrimaryEisScore(bd({ score: -2.1, eis_intrinsic: -5.5 }))).toBe(-2.1);
    expect(resolvePrimaryEisScore(bd({ score: 1.2, eis_intrinsic: -5.5 }))).toBe(1.2);
  });

  it("falls back to intrinsic when market is flat (CANF-style dilutive manual)", () => {
    expect(resolvePrimaryEisScore(bd({ score: 0, eis_intrinsic: -5.5 }))).toBe(-5.5);
    expect(resolvePrimaryEisScore(bd({ score: 0.2, eis_intrinsic: -5.5 }))).toBe(-5.5);
  });

  it("keeps market zero when intrinsic missing", () => {
    expect(resolvePrimaryEisScore(bd({ score: 0, eis_intrinsic: null }))).toBe(0);
  });
});

describe("resolveEventEis stored Daily News score", () => {
  it("keeps taxonomy EIS when ΔP legs are empty", () => {
    const resolved = resolveEventEis(
      {
        eis: { score: -3.4, sentiment: -0.8 },
        sentiment: -0.8,
        source_type: "press_release",
      },
      [],
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.score).toBe(-3.4);
    expect(resolvePrimaryEisScore(resolved!)).toBe(-3.4);
  });
});
