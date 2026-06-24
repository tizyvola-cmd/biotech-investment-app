import { describe, expect, it } from "vitest";
import type { SimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";
import {
  SYNTH_BRIDGE_GAP_TRIM_MIN,
  SYNTH_BRIDGE_MIN_CAPITAL_EUR,
  applySynthExposureBridge,
  evaluateSynthExposureVerdict,
  portfolioRecoveryGuardsActive,
} from "./synthExposureBridge";

function alloc(
  shareByKey: Record<string, number>,
  totalCapitalEur = 60_000,
): SimLoopSynthAllocation {
  return {
    shareByRowKey: shareByKey,
    simLoopApprovedShareByRowKey: {},
    portfolioShareByRowKey: shareByKey,
    portfolioDisplayShareByRowKey: shareByKey,
    simLoopDisplayShareByRowKey: {},
    totalCapitalEur,
    targetGainEur: 1200,
  };
}

function lossItem(
  overrides: Partial<PortfolioLossAnalysisItem> = {},
): PortfolioLossAnalysisItem {
  return {
    key: "AAA|2026-09-28",
    ticker: "AAA",
    hasPosition: true,
    exitDecision: "hold",
    investVerdict: "wait",
    recoveryProbabilityPct: 62,
    recoveryCoversLoss: true,
    curveRisingHold: false,
    pnlPct: -8,
    ...overrides,
  } as PortfolioLossAnalysisItem;
}

describe("synthExposureBridge", () => {
  it("detects large gap when synth near zero on meaningful capital", () => {
    const verdict = evaluateSynthExposureVerdict({
      rowKey: "AAA|2026-09-28",
      hasPosition: true,
      inPaperPortfolio: false,
      actualCapitalEur: 5000,
      totalPnlPct: -12,
      baseSuggestedAction: "hold",
      item: lossItem(),
      synthAlloc: alloc({ "AAA|2026-09-28": 0.001 }),
    });
    expect(verdict.kind).toBe("trim_review");
    expect(verdict.exposureGapRatio).not.toBeNull();
    expect(verdict.exposureGapRatio!).toBeGreaterThanOrEqual(SYNTH_BRIDGE_GAP_TRIM_MIN);
    expect(verdict.synthTargetEur).toBeLessThanOrEqual(80);
  });

  it("blocks bridge action when recovery guards active", () => {
    const bridged = applySynthExposureBridge("hold", {
      rowKey: "AAA|2026-09-28",
      hasPosition: true,
      inPaperPortfolio: false,
      actualCapitalEur: 5000,
      totalPnlPct: -12,
      baseSuggestedAction: "hold",
      item: lossItem({ recoveryProbabilityPct: 60, recoveryCoversLoss: true }),
      synthAlloc: alloc({ "AAA|2026-09-28": 0.001 }),
    });
    expect(portfolioRecoveryGuardsActive(lossItem({ recoveryProbabilityPct: 60 }))).toBe(true);
    expect(bridged.suggestedAction).toBe("hold");
    expect(bridged.verdict.kind).toBe("none");
  });

  it("promotes hold to review with synth trim label when guards fail", () => {
    const bridged = applySynthExposureBridge("hold", {
      rowKey: "AAA|2026-09-28",
      hasPosition: true,
      inPaperPortfolio: false,
      actualCapitalEur: 5000,
      totalPnlPct: -12,
      baseSuggestedAction: "hold",
      item: lossItem({
        investVerdict: "yes",
        recoveryProbabilityPct: 48,
        recoveryCoversLoss: false,
        exitDecision: "review",
      }),
      synthAlloc: alloc({ "AAA|2026-09-28": 0.001 }),
    });
    expect(bridged.suggestedAction).toBe("review");
    expect(bridged.verdict.kind).toBe("trim_review");
    expect(bridged.rationaleIt).toMatch(/Synth: riduci esposizione verso/i);
  });

  it("ignores small capital below min threshold", () => {
    const verdict = evaluateSynthExposureVerdict({
      rowKey: "AAA|2026-09-28",
      hasPosition: true,
      inPaperPortfolio: false,
      actualCapitalEur: SYNTH_BRIDGE_MIN_CAPITAL_EUR - 1,
      totalPnlPct: -5,
      baseSuggestedAction: "hold",
      item: lossItem(),
      synthAlloc: alloc({ "AAA|2026-09-28": 0.001 }),
    });
    expect(verdict.kind).toBe("none");
  });
});
