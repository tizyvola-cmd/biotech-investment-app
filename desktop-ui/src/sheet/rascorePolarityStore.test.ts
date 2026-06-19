import { describe, expect, it } from "vitest";
import {
  SOLIDITY_COMPONENT_MAX,
  type EntrySolidityComposite,
  type SolidityCompositeComponentId,
} from "./entrySolidityComposite";
import type { RaComponentPolarity } from "./rascoreComponentPolarity";
import { applyPriceAlignedComposite } from "./rascorePolarityStore";

function mkComposite(points: Partial<Record<SolidityCompositeComponentId, number>>): EntrySolidityComposite {
  const ids = Object.keys(SOLIDITY_COMPONENT_MAX) as SolidityCompositeComponentId[];
  const components = ids.map((id) => ({
    id,
    points: points[id] ?? 0,
    maxPoints: SOLIDITY_COMPONENT_MAX[id],
    detail: id,
    tone: "neutral" as const,
  }));
  const total = components.reduce((s, c) => s + c.points, 0);
  return { total, tier: "watch", components };
}

function mkPolarity(id: SolidityCompositeComponentId, invert: boolean): RaComponentPolarity {
  return {
    id,
    rho: invert ? -0.5 : 0.5,
    rhoPriceAligned: 0.5,
    n: 5,
    pValue: 0.01,
    pValueAligned: 0.01,
    direction: invert ? "negative" : "positive",
    invertForPrice: invert,
    reliable: true,
  };
}

describe("applyPriceAlignedComposite", () => {
  it("subtracts inverted component points and recomputes polarized total", () => {
    const raw = mkComposite({ timing: 10, reliability: 20 });
    const aligned = applyPriceAlignedComposite(raw, [mkPolarity("timing", true)]);
    expect(aligned.components.find((c) => c.id === "timing")?.points).toBe(-10);
    expect(aligned.total).toBe(10);
    expect(aligned.total).not.toBe(raw.total);
  });

  it("returns same composite when no reliable inversions", () => {
    const raw = mkComposite({ timing: 10 });
    const aligned = applyPriceAlignedComposite(raw, [mkPolarity("timing", false)]);
    expect(aligned.total).toBe(raw.total);
  });
});
