import { describe, expect, it } from "vitest";
import {
  correlationTwoTailedPValue,
  criticalAbsCorrelation,
  formatCorrelationWithStars,
  linearRegressionOLS,
  linearRegressionTheilSen,
  mannWhitneyTwoTailedP,
  significanceStars,
} from "./statSignificance";

describe("statSignificance", () => {
  it("assigns stars by p-value thresholds", () => {
    expect(significanceStars(0.0005)).toBe("***");
    expect(significanceStars(0.005)).toBe("**");
    expect(significanceStars(0.03)).toBe("*");
    expect(significanceStars(0.2)).toBe("ns");
    expect(significanceStars(null)).toBe("ns");
  });

  it("marks moderate correlation as significant with enough n", () => {
    const p = correlationTwoTailedPValue(0.489, 22);
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(0.05);
    expect(formatCorrelationWithStars(0.489, 22)).toMatch(/\*\*|\*/);
  });

  it("marks weak correlation as ns with tiny n", () => {
    expect(formatCorrelationWithStars(0.489, 3)).toContain("ns");
  });

  it("computes critical |ρ| for n≈22 near 0.35", () => {
    const crit = criticalAbsCorrelation(22);
    expect(crit).not.toBeNull();
    expect(crit!).toBeGreaterThan(0.34);
    expect(crit!).toBeLessThan(0.40);
    expect(correlationTwoTailedPValue(crit!, 22)!).toBeLessThanOrEqual(0.05);
    expect(correlationTwoTailedPValue(crit! - 0.01, 22)!).toBeGreaterThan(0.05);
  });

  it("Mann–Whitney detects separated groups", () => {
    const p = mannWhitneyTwoTailedP([10, 12, 14, 16], [1, 2, 3, 4]);
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(0.05);
  });

  it("Mann–Whitney ns for overlapping groups", () => {
    const p = mannWhitneyTwoTailedP([5, 6, 7, 8], [5, 6, 7, 8]);
    expect(p).not.toBeNull();
    expect(p!).toBeGreaterThan(0.05);
  });

  it("linearRegressionOLS spans x domain for chart overlay", () => {
    const reg = linearRegressionOLS([0, 50, 100], [0, 5, 10], { min: 0, max: 100 });
    expect(reg).not.toBeNull();
    expect(reg!.slope).toBeCloseTo(0.1, 4);
    expect(reg!.line).toHaveLength(2);
    expect(reg!.line[0]).toEqual({ x: 0, y: 0 });
    expect(reg!.line[1]!.y).toBeCloseTo(10, 1);
  });

  it("linearRegressionTheilSen matches OLS on clean linear data", () => {
    const reg = linearRegressionTheilSen(
      [0, 25, 50, 75, 100],
      [0, 2.5, 5, 7.5, 10],
      { min: 0, max: 100 },
    );
    expect(reg).not.toBeNull();
    expect(reg!.slope).toBeCloseTo(0.1, 3);
    expect(reg!.intercept).toBeCloseTo(0, 3);
  });

  it("linearRegressionTheilSen is robust to a single outlier that OLS follows", () => {
    // Perfect line y = 0.1·x, plus one outlier at (100, -50). OLS bends;
    // Theil-Sen ignores the outlier because its slopes are minority.
    const xs = [0, 20, 40, 60, 80, 100];
    const ys = [0, 2, 4, 6, 8, -50];
    const ols = linearRegressionOLS(xs, ys);
    const robust = linearRegressionTheilSen(xs, ys);
    expect(ols).not.toBeNull();
    expect(robust).not.toBeNull();
    // OLS slope is dragged strongly negative by the outlier
    expect(ols!.slope).toBeLessThan(-0.3);
    // Theil-Sen keeps close to the true +0.1 slope
    expect(robust!.slope).toBeCloseTo(0.1, 1);
  });

  it("linearRegressionTheilSen returns null for degenerate inputs", () => {
    expect(linearRegressionTheilSen([1, 2], [1, 2])).toBeNull();
    expect(linearRegressionTheilSen([5, 5, 5], [1, 2, 3])).toBeNull();
  });
});
