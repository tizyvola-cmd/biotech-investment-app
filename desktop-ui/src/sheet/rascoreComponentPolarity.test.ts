import { describe, expect, it } from "vitest";
import {
  alignComponentPoints,
  computeComponentPolarities,
  computePolarizedRaTotal,
  computePriceAlignedRaScore,
  polarizedComponentPoints,
} from "./rascoreComponentPolarity";
import { SOLIDITY_COMPONENT_MAX, type SolidityCompositeComponentId } from "./entrySolidityComposite";

describe("rascoreComponentPolarity", () => {
  it("detects negative component correlation and inverts for price-aligned RA", () => {
    const pairs = new Map<number, Map<string, { x: number; y: number }[]>>([
      [
        -30,
        new Map([
          [
            "timing",
            [
              { x: 90, y: 10 },
              { x: 70, y: 30 },
              { x: 50, y: 50 },
              { x: 30, y: 70 },
            ],
          ],
          [
            "reliability",
            [
              { x: 30, y: 10 },
              { x: 50, y: 30 },
              { x: 70, y: 50 },
              { x: 90, y: 70 },
            ],
          ],
        ]),
      ],
    ]);

    const polarities = computeComponentPolarities(pairs);
    const timing = polarities.find((p) => p.id === "timing");
    const reliability = polarities.find((p) => p.id === "reliability");

    expect(timing?.direction).toBe("negative");
    expect(timing?.invertForPrice).toBe(true);
    expect(timing?.rho).toBeLessThan(0);
    expect(timing?.rhoPriceAligned).not.toBeNull();
    expect(timing!.rhoPriceAligned!).toBeGreaterThan(0.9);
    expect(reliability?.direction).toBe("positive");
    expect(reliability?.invertForPrice).toBe(false);
    expect(reliability?.rhoPriceAligned).toBe(reliability?.rho);

    const maxTiming = SOLIDITY_COMPONENT_MAX.timing;
    expect(alignComponentPoints(10, maxTiming, true)).toBe(maxTiming - 10);
    expect(polarizedComponentPoints(10, true)).toBe(-10);

    const pts = { timing: 10, reliability: 80 } as Record<SolidityCompositeComponentId, number>;
    const polaritiesReliable = polarities.map((p) => ({ ...p, reliable: true }));
    const breakdown = computePolarizedRaTotal(pts, polaritiesReliable, "curve_only");
    expect(breakdown.positiveSum).toBe(80);
    expect(breakdown.negativeSum).toBe(10);
    expect(breakdown.total).toBe(70);
    expect(computePriceAlignedRaScore(pts, polaritiesReliable, "curve_only", { clamp0To100: false })).toBe(70);
  });
});
