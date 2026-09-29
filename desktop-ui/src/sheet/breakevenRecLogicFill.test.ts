import { describe, expect, it } from "vitest";
import {
  blendPositionsLogicColor,
  clearanceAboveGate,
  clearanceSellPnl,
} from "./breakevenRecLogicFill";

describe("breakevenRecLogicFill", () => {
  it("fades below min gate and strengthens above", () => {
    expect(clearanceAboveGate(10, 20)).toBeLessThan(0.25);
    expect(clearanceAboveGate(20, 20)).toBeGreaterThan(0.3);
    expect(clearanceAboveGate(50, 20)).toBeGreaterThan(clearanceAboveGate(25, 20));
  });

  it("sells intensify with deeper MTM loss", () => {
    expect(clearanceSellPnl(-1)).toBeLessThan(clearanceSellPnl(-3));
    expect(clearanceSellPnl(-12)).toBeGreaterThan(clearanceSellPnl(-3));
    expect(clearanceSellPnl(2)).toBe(0);
  });

  it("buy blend leans emerald when P(plan) dominates", () => {
    const { css } = blendPositionsLogicColor(
      [
        {
          key: "A|cd",
          ticker: "AAA",
          capital: 1000,
          pplan: 80,
          sds: 22,
          pcont: 52,
          pnlPct: 1,
          riskV2: null,
          regRisk: null,
        },
      ],
      "buy",
    );
    expect(css.startsWith("rgba(")).toBe(true);
  });
});
