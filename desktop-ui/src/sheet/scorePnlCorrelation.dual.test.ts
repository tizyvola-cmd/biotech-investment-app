import { describe, expect, it } from "vitest";
import { summarizeScoreOutcomeCorr } from "./scorePnlCorrelation";

describe("summarizeScoreOutcomeCorr", () => {
  it("computes r on P&L and can reuse rows for T+3 outcome", () => {
    const rows = [
      { pplan: 40, pnl: -5, move3d: -2 },
      { pplan: 50, pnl: 1, move3d: 0.5 },
      { pplan: 70, pnl: 8, move3d: 3 },
      { pplan: 80, pnl: 12, move3d: 4 },
      { pplan: 55, pnl: -1, move3d: -0.2 },
    ];
    const pnl = summarizeScoreOutcomeCorr(
      "pplan",
      "P(plan)",
      rows,
      (r) => r.pplan,
      (r) => r.pnl,
    );
    const t3 = summarizeScoreOutcomeCorr(
      "pplan",
      "P(plan)",
      rows,
      (r) => r.pplan,
      (r) => r.move3d,
    );
    expect(pnl.n).toBe(5);
    expect(t3.n).toBe(5);
    expect(pnl.rAll).not.toBeNull();
    expect(t3.rAll).not.toBeNull();
    expect(pnl.rAll!).toBeGreaterThan(0.5);
  });
});
