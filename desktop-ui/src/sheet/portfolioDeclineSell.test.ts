import { describe, expect, it } from "vitest";
import {
  portfolioExitRecoveryGuardsActive,
  recoveryThesisAlive,
} from "./portfolioDeclineSell";

describe("portfolioExitRecoveryGuardsActive", () => {
  it("holds when recovery thesis is alive (P≥55% + covers)", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        investVerdict: "yes",
        recoveryProbabilityPct: 61,
        recoveryCoversLoss: true,
        pnlPct24h: -1.5,
        pnlPct: -3,
      }),
    ).toBe(true);
  });

  it("does not hold on deep open loss even if recovery thesis looks alive", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: true,
        investVerdict: "wait",
        recoveryProbabilityPct: 70,
        recoveryCoversLoss: true,
        pnlPct24h: -2.3,
        pnlPct: -47.1,
      }),
    ).toBe(false);
  });

  it("does not hold on red book when g10 is declining", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: true,
        investVerdict: "wait",
        recoveryProbabilityPct: 70,
        recoveryCoversLoss: true,
        pnlPct24h: -1,
        pnlPct: -4,
        simRow: { cont_g10: -5 },
      }),
    ).toBe(false);
  });

  it("does not hold on 24h rally alone when thesis is dead", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        investVerdict: "yes",
        recoveryProbabilityPct: 20,
        recoveryCoversLoss: false,
        pnlPct24h: 0.6,
        pnlPct: -4,
      }),
    ).toBe(false);
  });

  it("does not hold on micro forward peak without cover", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        investVerdict: "yes",
        recoveryProbabilityPct: 20,
        recoveryCoversLoss: false,
        planReturnPct: 5,
        curvePeakReturnPct: 0.5,
        pnlPct24h: -0.2,
        pnlPct: -3,
      }),
    ).toBe(false);
  });

  it("holds on meaningful peak that explicitly covers the loss", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        investVerdict: "yes",
        recoveryProbabilityPct: 40,
        recoveryCoversLoss: true,
        planReturnPct: 8,
        curvePeakReturnPct: 5,
        pnlPct24h: -0.2,
        pnlPct: -3,
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
        pnlPct: -5,
      }),
    ).toBe(false);
  });

  it("does not hold on flat 24h + positive plan when thesis is dead", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        recoveryProbabilityPct: 30,
        recoveryCoversLoss: false,
        planReturnPct: 6,
        pnlPct24h: -0.2,
        stabilityVerdict: "watch",
        pnlPct: -4,
      }),
    ).toBe(false);
  });

  it("does not freeze Sell on curveRisingHold alone", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: true,
        investVerdict: "wait",
        recoveryProbabilityPct: 35,
        recoveryCoversLoss: false,
        planReturnPct: 4,
        curvePeakReturnPct: 1,
        pnlPct: -3,
      }),
    ).toBe(false);
  });

  it("does not freeze Sell on Top2 wait alone", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        investVerdict: "wait",
        recoveryProbabilityPct: 40,
        recoveryCoversLoss: false,
        pnlPct: -2,
      }),
    ).toBe(false);
  });

  it("still exits on strong stability pressure when thesis is dead", () => {
    expect(
      portfolioExitRecoveryGuardsActive({
        curveRisingHold: false,
        recoveryProbabilityPct: 30,
        recoveryCoversLoss: false,
        planReturnPct: 6,
        pnlPct24h: -0.2,
        stabilityVerdict: "exit",
        pnlPct: -4,
      }),
    ).toBe(false);
  });
});

describe("recoveryThesisAlive", () => {
  it("requires P≥55% and cover", () => {
    expect(
      recoveryThesisAlive({ recoveryProbabilityPct: 61, recoveryCoversLoss: true }),
    ).toBe(true);
    expect(
      recoveryThesisAlive({ recoveryProbabilityPct: 50, recoveryCoversLoss: true }),
    ).toBe(false);
    expect(
      recoveryThesisAlive({ recoveryProbabilityPct: 70, recoveryCoversLoss: false }),
    ).toBe(false);
  });
});
