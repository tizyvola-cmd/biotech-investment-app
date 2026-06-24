import { describe, expect, it } from "vitest";
import {
  buildRaInverseCumulativeRows,
  densifyRaInverseCumulativeRows,
  raInverseCumulativeYMax,
} from "./rascoreInverseCumulative";
import type { RaInversePatternResult } from "./rascoreInversePattern";
import {
  RA_INVERSE_COMPONENT_IDS,
  raInverseComponentIdsForMode,
} from "./rascoreInversePattern";
import { SOLIDITY_COMPONENT_MAX } from "./entrySolidityComposite";

function mockPattern(
  upPts: number[],
  downPts: number[],
): RaInversePatternResult {
  return {
    offset: -60,
    offsetLabel: "T-60",
    horizon: "long",
    scoreMode: "full",
    activeComponentIds: raInverseComponentIdsForMode("full"),
    upN: 6,
    downN: 13,
    flatN: 0,
    upMeanRa: upPts.reduce((a, b) => a + b, 0),
    downMeanRa: downPts.reduce((a, b) => a + b, 0),
    raDelta: null,
    raPValue: null,
    raStars: "ns",
    topDiscriminators: [],
    members: [],
    components: RA_INVERSE_COMPONENT_IDS.map((id, i) => ({
      id,
      upMeanPct: null,
      downMeanPct: null,
      deltaPct: null,
      upMeanPts: upPts[i] ?? 0,
      downMeanPts: downPts[i] ?? 0,
      maxPoints: SOLIDITY_COMPONENT_MAX[id],
      pValue: null,
      stars: "ns" as const,
    })),
  };
}

describe("buildRaInverseCumulativeRows", () => {
  it("starts at zero and stacks component means cumulatively", () => {
    const up = [10, 5, 3, 0, 8, 2, 1, 4];
    const down = [8, 6, 2, 4, 5, 3, 0, 2];
    const rows = buildRaInverseCumulativeRows(mockPattern(up, down));

    expect(rows).toHaveLength(RA_INVERSE_COMPONENT_IDS.length + 1);
    expect(rows[0]!.upTotal).toBe(0);
    expect(rows[0]!.downTotal).toBe(0);

    const last = rows[rows.length - 1]!;
    expect(last.upTotal).toBe(up.reduce((a, b) => a + b, 0));
    expect(last.downTotal).toBe(down.reduce((a, b) => a + b, 0));
    expect(last.up_reliability).toBe(10);
    expect(last.up_timing).toBe(5);
    expect(last.down_align).toBe(2);
  });

  it("computes y max with headroom capped at 100", () => {
    const rows = buildRaInverseCumulativeRows(mockPattern([20, 20, 20, 0, 0, 0, 0, 0], [10, 10, 10, 0, 0, 0, 0, 0]));
    expect(raInverseCumulativeYMax(rows)).toBe(65);
  });

  it("subtracts negatively correlated component points when polarities supplied", () => {
    const up = [10, 5, 3, 0, 8, 2, 1, 4];
    const down = [8, 6, 2, 4, 5, 3, 0, 2];
    const polarities = RA_INVERSE_COMPONENT_IDS.map((id) => ({
      id,
      rho: id === "timing" ? -0.66 : 0.5,
      rhoPriceAligned: id === "timing" ? 0.66 : 0.5,
      n: 5,
      pValue: 0.1,
      pValueAligned: 0.1,
      direction: id === "timing" ? ("negative" as const) : ("positive" as const),
      invertForPrice: id === "timing",
      reliable: true,
    }));
    const raw = buildRaInverseCumulativeRows(mockPattern(up, down));
    const aligned = buildRaInverseCumulativeRows(mockPattern(up, down), polarities);
    const rawLast = raw[raw.length - 1]!;
    const alignedLast = aligned[aligned.length - 1]!;
    expect(rawLast.up_timing).toBe(5);
    expect(alignedLast.up_timing).toBe(-5);
    expect(alignedLast.upTotal).toBe(rawLast.upTotal - 10);
  });

  it("densifies rows for smooth curves while preserving knot totals", () => {
    const knots = buildRaInverseCumulativeRows(mockPattern([10, 5, 3, 0, 8, 2, 1, 4], [8, 6, 2, 4, 5, 3, 0, 2]));
    const curve = densifyRaInverseCumulativeRows(knots, 8);
    expect(curve.length).toBeGreaterThan(knots.length);
    const last = curve[curve.length - 1]!;
    expect(last.upTotal).toBe(knots[knots.length - 1]!.upTotal);
    expect(last.downTotal).toBe(knots[knots.length - 1]!.downTotal);
  });
});
