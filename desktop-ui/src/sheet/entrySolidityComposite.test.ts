import { describe, expect, it } from "vitest";
import { computeEntrySolidityComposite, SOLIDITY_COMPONENT_MAX } from "./entrySolidityComposite";
import type { Top2PickSignal } from "./top2PortfolioPick";

function pick(over: Partial<Top2PickSignal> = {}): Top2PickSignal {
  return {
    ticker: "TLX",
    cd: "01/06/2026",
    hasPosition: false,
    days: 8,
    pred5: 2,
    planReturnPct: 4,
    precatExpectedReturn: 2,
    upsideScore: 0,
    precatKind: "enter",
    precatOriginalKind: "enter",
    stabilityVerdict: "persistent",
    affid: 0.75,
    r2: 0.85,
    ...over,
  };
}

describe("entrySolidityComposite", () => {
  it("sums eight components to total 0–100", () => {
    const c = computeEntrySolidityComposite(pick(), [], undefined, "it");
    expect(c.components).toHaveLength(8);
    const sum = c.components.reduce((a, x) => a + x.points, 0);
    expect(c.total).toBeGreaterThanOrEqual(0);
    expect(c.total).toBeLessThanOrEqual(100);
    expect(Object.values(SOLIDITY_COMPONENT_MAX).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Math.abs(c.total - Math.round(sum)) <= 1 || c.total <= 55).toBe(true);
  });

  it("high-quality pick trends toward strong tier", () => {
    const c = computeEntrySolidityComposite(pick(), [], undefined, "it");
    expect(c.total).toBeGreaterThanOrEqual(55);
    expect(["top", "strong", "watch"]).toContain(c.tier);
  });

  it("caps total when hard block failures present", () => {
    const c = computeEntrySolidityComposite(
      pick(),
      [{ code: "timing_binary" }],
      undefined,
      "it",
    );
    expect(c.total).toBeLessThanOrEqual(55);
  });
});
