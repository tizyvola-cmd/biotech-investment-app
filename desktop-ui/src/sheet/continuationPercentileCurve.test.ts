import { describe, expect, it } from "vitest";
import {
  estimatePctFromG10,
  findCoinFlipCrossingPct,
  interpolateCurveP,
  mergeDualCurveData,
  parseContCurve,
} from "./continuationPercentileCurve";

describe("continuationPercentileCurve", () => {
  it("parses curve points", () => {
    const pts = parseContCurve([
      { pct: 75, p: 40, n: 50, g: 18 },
      { pct: 25, p: 55, n: 80, g: 6 },
    ]);
    expect(pts.map((p) => p.pct)).toEqual([25, 75]);
    expect(pts[0]?.g).toBe(6);
  });

  it("interpolates between bins", () => {
    const curve = [
      { pct: 25, p: 60, n: 40 },
      { pct: 75, p: 40, n: 40 },
    ];
    expect(interpolateCurveP(curve, 25)).toBe(60);
    expect(interpolateCurveP(curve, 75)).toBe(40);
    expect(interpolateCurveP(curve, 50)).toBe(50);
  });

  it("estimates pct from g10 via bin medians", () => {
    const curve = [
      { pct: 10, p: 65, n: 40, g: 2 },
      { pct: 50, p: 55, n: 40, g: 8 },
      { pct: 90, p: 40, n: 40, g: 20 },
    ];
    expect(estimatePctFromG10(curve, 2)).toBe(10);
    expect(estimatePctFromG10(curve, 8)).toBe(50);
    expect(estimatePctFromG10(curve, 5)).toBe(30);
  });

  it("finds coin-flip crossing on declining half-bell", () => {
    const curve = [
      { pct: 10, p: 64, n: 40 },
      { pct: 40, p: 55, n: 40 },
      { pct: 70, p: 45, n: 40 },
      { pct: 90, p: 40, n: 40 },
    ];
    const x = findCoinFlipCrossingPct(curve, 50);
    expect(x).not.toBeNull();
    expect(x!).toBeGreaterThan(40);
    expect(x!).toBeLessThan(70);
  });

  it("merges Own/Pop and marks strong-wind fill", () => {
    const merged = mergeDualCurveData(
      [{ pct: 30, p: 55, n: 20 }],
      [
        { pct: 25, p: 60, n: 40 },
        { pct: 75, p: 35, n: 40 },
      ],
      50,
    );
    expect(merged.length).toBeGreaterThanOrEqual(2);
    expect(merged.some((r) => r.popStrong != null)).toBe(true);
    expect(merged.some((r) => r.popP != null && r.popP < 50 && r.popStrong == null)).toBe(
      true,
    );
  });
});
