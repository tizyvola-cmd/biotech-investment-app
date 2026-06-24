import { describe, expect, it } from "vitest";
import {
  correlationTwoTailedPValue,
  criticalAbsCorrelation,
  formatCorrelationWithStars,
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
});
