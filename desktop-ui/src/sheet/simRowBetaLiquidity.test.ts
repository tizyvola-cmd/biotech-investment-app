import { describe, expect, it } from "vitest";
import {
  betaBucketLabel,
  betaDisplay,
  betaMarketVariancePct,
  computeLiquidityScore,
  parseLiquidityRatiosFromDisplay,
  resolveSimRowBeta,
  resolveSimRowLiquidityScore,
} from "./simRowBetaLiquidity";

describe("simRowBetaLiquidity", () => {
  it("reads beta from Simulation column header", () => {
    const row = { "Beta (5Y vs mercato)": 1.52, Ticker: "CMPS" };
    expect(resolveSimRowBeta(row)).toBeCloseTo(1.52, 2);
  });

  it("computes liquidity score from Liquidità (FY) display text", () => {
    const row = {
      "Liquidità (FY)": "CR 2.00 | QR 1.50 | Cash 0.60M",
    };
    const score = resolveSimRowLiquidityScore(row);
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(0.55);
  });

  it("reads unaccented Liquidita (FY) and spaced Liquidity Score", () => {
    expect(
      resolveSimRowLiquidityScore({ "Liquidita (FY)": "CR 2.00 | QR 1.50 | Cash 0.60M" }),
    ).toBeGreaterThan(0.55);
    expect(resolveSimRowLiquidityScore({ "Liquidity Score": 0.72 })).toBeCloseTo(0.72, 2);
  });

  it("parses CR/QR/Cash ratios from FY string", () => {
    const parsed = parseLiquidityRatiosFromDisplay("CR 1.20 | QR 0.90 | Cash 0.35");
    expect(parsed.currentRatio).toBeCloseTo(1.2, 2);
    expect(parsed.quickRatio).toBeCloseTo(0.9, 2);
    expect(parsed.cashRatio).toBeCloseTo(0.35, 2);
  });

  it("matches backend liquidity_score weights", () => {
    expect(computeLiquidityScore(2, 1.5, 0.5)).toBeCloseTo(1, 2);
    expect(computeLiquidityScore(null, null, null)).toBeNull();
  });

  it("classifies beta buckets for tooltips", () => {
    expect(betaDisplay(1).bucket).toBe("market");
    expect(betaDisplay(1.5).bucket).toBe("elevated");
    expect(betaDisplay(2.1).bucket).toBe("high");
    expect(betaDisplay(0.36).bucket).toBe("idiosyncratic");
    expect(betaDisplay(0.7).bucket).toBe("idiosyncratic");
    expect(betaDisplay(-0.3).bucket).toBe("inverse");
    expect(betaBucketLabel("idiosyncratic", false)).toContain("company-specific");
    expect(betaBucketLabel("elevated", false)).toContain("market-driven");
  });

  it("colors low beta green and elevated beta amber", () => {
    expect(betaDisplay(0.36).style.color).toContain("--positive");
    expect(betaDisplay(1.5).style.color).toContain("--warn");
    expect(betaDisplay(1).style.color).toContain("--ink");
  });

  it("approximates market variance share as beta squared", () => {
    expect(betaMarketVariancePct(0.36)).toBe(13);
    expect(betaMarketVariancePct(1)).toBe(100);
  });
});
