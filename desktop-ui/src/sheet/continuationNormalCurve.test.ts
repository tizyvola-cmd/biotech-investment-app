import { describe, expect, it } from "vitest";
import {
  approxNormalPercentile,
  buildNormalCurvePoints,
  normalPdf,
} from "./continuationNormalCurve";

describe("continuationNormalCurve", () => {
  it("peaks at mu", () => {
    const peak = normalPdf(50, 50, 10);
    const side = normalPdf(40, 50, 10);
    expect(peak).toBeGreaterThan(side);
  });

  it("builds 0..100 curve", () => {
    const pts = buildNormalCurvePoints({ mu: 45, sigma: 12, n: 100 }, 40);
    expect(pts[0]?.x).toBe(0);
    expect(pts[pts.length - 1]?.x).toBe(100);
    expect(pts.every((p) => p.density >= 0)).toBe(true);
  });

  it("percentile near mu is ~50", () => {
    const pct = approxNormalPercentile(50, { mu: 50, sigma: 10, n: 1 });
    expect(pct).not.toBeNull();
    expect(pct!).toBeGreaterThan(45);
    expect(pct!).toBeLessThan(55);
  });
});
