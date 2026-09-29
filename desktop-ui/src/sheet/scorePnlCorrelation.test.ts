import { describe, expect, it } from "vitest";
import { excludePplanPlaceholders, scoreTertileSpread } from "./scorePnlCorrelation";
import { fisherZ95Ci, formatFisherCi } from "./statSignificance";

describe("scorePnlCorrelation", () => {
  it("excludePplanPlaceholders removes default X=50 rows", () => {
    const rows = [
      { pnl: 10, pplanIsDefault: false },
      { pnl: -5, pplanIsDefault: true },
      { pnl: 3 },
    ];
    expect(excludePplanPlaceholders(rows)).toHaveLength(2);
  });

  it("scoreTertileSpread returns high-low mean spread", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      pnl: i < 3 ? -10 : i < 6 ? 0 : 10,
      score: i,
    }));
    const spread = scoreTertileSpread(rows, (r) => r.score);
    expect(spread).not.toBeNull();
    expect(spread!.spreadHighLow).toBe(20);
  });
});

describe("fisherZ95Ci", () => {
  it("matches reference CI for r=0.43 n=26", () => {
    const ci = fisherZ95Ci(0.43, 26);
    expect(ci).not.toBeNull();
    expect(ci!.lo).toBeGreaterThan(0.04);
    expect(ci!.lo).toBeLessThan(0.08);
    expect(ci!.hi).toBeGreaterThan(0.65);
    expect(ci!.hi).toBeLessThan(0.75);
    expect(formatFisherCi(ci)).toMatch(/\[\+/);
  });
});
