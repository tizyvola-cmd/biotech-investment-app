import { describe, expect, it } from "vitest";
import {
  cumulativeGainFromShares,
  gainContributionEur,
  blendAndCapSharesForDisplay,
  optimizeSharesMaxGain,
  optimizeWeightSimExp,
} from "./weightSimExpOptimizer";

describe("weightSimExpOptimizer", () => {
  it("allocates proportionally to positive movers", () => {
    const contributions = [100, 300, 0];
    const shares = optimizeSharesMaxGain(contributions);
    expect(shares[0]).toBeCloseTo(0.25, 5);
    expect(shares[1]).toBeCloseTo(0.75, 5);
    expect(shares[2]).toBeCloseTo(0, 5);
    expect(shares.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5);
  });

  it("concentrates on least-bad deal when all moves negative", () => {
    const contributions = [-200, -50, -120];
    const shares = optimizeSharesMaxGain(contributions);
    expect(shares[1]).toBe(1);
    expect(cumulativeGainFromShares(shares, contributions)).toBe(-50);
  });

  it("marks target reached when max gain exceeds target", () => {
    const result = optimizeWeightSimExp(
      [
        { rowKey: "A|1", ticker: "AAA", movePct24h: 10, baselineShare: 0.5 },
        { rowKey: "B|2", ticker: "BBB", movePct24h: 2, baselineShare: 0.5 },
      ],
      10_000,
      500,
    );
    expect(result).not.toBeNull();
    expect(result!.targetReached).toBe(true);
    expect(result!.finalGainEur).toBeGreaterThan(500);
    expect(result!.shares[0]).toBeGreaterThan(result!.shares[1] ?? 0);
  });

  it("flags unreachable target", () => {
    const result = optimizeWeightSimExp(
      [
        { rowKey: "A|1", ticker: "AAA", movePct24h: 1, baselineShare: 0.5 },
        { rowKey: "B|2", ticker: "BBB", movePct24h: 0.5, baselineShare: 0.5 },
      ],
      10_000,
      5000,
    );
    expect(result!.targetReached).toBe(false);
    expect(result!.unreachableReason).toContain("Max");
  });

  it("caps concentrated max-gain mix for display", () => {
    const shares = blendAndCapSharesForDisplay([0.64, 0, 0, 0, 0, 0, 0], 0.25);
    expect(Math.max(...shares)).toBeLessThanOrEqual(0.25 + 1e-6);
  });

  it("caps screenshot-like Weight Sim Exp mix (no single name above 25%)", () => {
    const raw = [0.6385, 0.1744, 0.0554, 0.079, 0.0527];
    const capped = blendAndCapSharesForDisplay(raw, 0.25);
    for (const s of capped) {
      expect(s).toBeLessThanOrEqual(0.25 + 1e-6);
    }
    expect(capped[0]).toBeCloseTo(0.25, 5);
    const total = capped.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(1);
  });

  it("two-deal concentration never exceeds cap after clamp", () => {
    const capped = blendAndCapSharesForDisplay([0.9, 0.1], 0.25);
    expect(capped[0]).toBeLessThanOrEqual(0.25);
    expect(capped[1]).toBeLessThanOrEqual(0.25);
  });
});
