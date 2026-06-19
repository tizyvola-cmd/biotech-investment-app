import { describe, expect, it } from "vitest";
import { portfolioExitRecoveryGuardsActive } from "./portfolioDeclineSell";

describe("portfolioExitRecoveryGuardsActive", () => {
  it("holds on 24h rally at or above momentum threshold", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        investVerdict: "yes",
        recoveryProbabilityPct: 20,
        pnlPct24h: 0.6,
      }),
    ).toBe(true);
  });

  it("holds when forward model peak is still positive", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        investVerdict: "yes",
        recoveryProbabilityPct: 20,
        planReturnPct: 5,
        curvePeakReturnPct: 2,
        pnlPct24h: -0.2,
      }),
    ).toBe(true);
  });

  it("does not hold without recovery, momentum, or forward peak", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        investVerdict: "yes",
        recoveryProbabilityPct: 30,
        recoveryCoversLoss: false,
        planReturnPct: -2,
        curvePeakReturnPct: null,
        pnlPct24h: -1.5,
      }),
    ).toBe(false);
  });

  it("holds when 24h is flat-ish on positive plan (premature exit band)", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        recoveryProbabilityPct: 30,
        planReturnPct: 6,
        pnlPct24h: -0.2,
        stabilityVerdict: "hold",
      }),
    ).toBe(true);
  });

  it("still exits on strong stability exit even with flat 24h", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        recoveryProbabilityPct: 30,
        planReturnPct: 6,
        pnlPct24h: -0.2,
        stabilityVerdict: "exit",
      }),
    ).toBe(false);
  });
});
