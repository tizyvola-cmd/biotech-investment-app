import { describe, expect, it } from "vitest";
import { portfolioPnlDeltaLooksLikeStaleBaseline } from "./piggyBankTrend";

describe("portfolioPnlDeltaLooksLikeStaleBaseline", () => {
  it("flags stale baseline drop far beyond today's 24h move", () => {
    expect(portfolioPnlDeltaLooksLikeStaleBaseline(1400, 706, 397, 6)).toBe(true);
    expect(portfolioPnlDeltaLooksLikeStaleBaseline(1473, 706, 397, 6)).toBe(true);
  });

  it("allows normal refresh delta aligned with 24h", () => {
    expect(portfolioPnlDeltaLooksLikeStaleBaseline(650, 706, 397, 6)).toBe(false);
    expect(portfolioPnlDeltaLooksLikeStaleBaseline(706, 750, 44, 6)).toBe(false);
  });

  it("flags inflated MTM snapshot when 24h alone cannot explain the drop", () => {
    expect(portfolioPnlDeltaLooksLikeStaleBaseline(1473, 706, 984, 6)).toBe(true);
  });

  it("allows real single-day loss when 24h confirms it", () => {
    expect(portfolioPnlDeltaLooksLikeStaleBaseline(1000, 620, -350, 6)).toBe(false);
  });

  it("flags large contaminated baseline even when todayCovered=0 (market data not yet loaded)", () => {
    // Snapshot saved during P&L history bug (~+33k), live now ~+1.5k → delta=-31.5k
    // todayCovered=0 previously bypassed ALL checks — this must be caught as stale.
    expect(portfolioPnlDeltaLooksLikeStaleBaseline(33_000, 1_500, 0, 0)).toBe(true);
    expect(portfolioPnlDeltaLooksLikeStaleBaseline(33_313, 1_500, 0, 0)).toBe(true);
  });

  it("does not flag small valid delta when todayCovered=0", () => {
    // Small swing with no market data — cannot determine if stale, so allow through.
    expect(portfolioPnlDeltaLooksLikeStaleBaseline(1200, 900, 0, 0)).toBe(false);
  });
});
