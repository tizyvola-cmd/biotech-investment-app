import { describe, expect, it } from "vitest";
import {
  portfolioChipToneFromAction,
  resolvePortfolioPositionAction,
} from "./portfolioPositionAction";
import type { StabilityVerdict } from "./slopeStability";

describe("resolvePortfolioPositionAction", () => {
  it("gain when P&L positive regardless of slope", () => {
    expect(
      resolvePortfolioPositionAction({
        pnlEur: 200,
        pnlPct: 4,
        planReturnPct: -5,
        slope20d: -1,
        inPortfolio: true,
      }),
    ).toBe("gain");
  });

  it("hold when in loss but curve rising with positive target (OLMA-like)", () => {
    expect(
      resolvePortfolioPositionAction({
        pnlEur: -274,
        pnlPct: -5.5,
        planReturnPct: 8,
        slope5d: 0,
        slope20d: 0.82,
        inPortfolio: true,
      }),
    ).toBe("hold");
  });

  it("sell when in loss with sustained decline", () => {
    expect(
      resolvePortfolioPositionAction({
        pnlEur: -400,
        pnlPct: -8,
        planReturnPct: 2,
        slope5d: -0.5,
        slope20d: -0.4,
        stabilityVerdict: "exit" as StabilityVerdict,
        inPortfolio: true,
      }),
    ).toBe("sell");
  });

  it("maps hold to warn chip tone and sell to loss chip tone", () => {
    expect(portfolioChipToneFromAction("hold")).toBe("warn");
    expect(portfolioChipToneFromAction("sell")).toBe("loss");
    expect(portfolioChipToneFromAction("gain")).toBe("gain");
  });
});
