import { describe, expect, it } from "vitest";
import {
  buildLossAnalysisSummaryCapitalKpi,
  lossAnalysisCapitalDenominatorEur,
} from "./lossAnalysisSummaryCapitalKpi";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";

function stubItem(partial: Partial<PortfolioLossAnalysisItem> & Pick<PortfolioLossAnalysisItem, "key" | "ticker">): PortfolioLossAnalysisItem {
  return {
    company: null,
    completionDate: "2026-01-01",
    seriesKey: null,
    hasPosition: false,
    inLoss: false,
    capital: 0,
    pnlEur: null,
    pnlPct: null,
    pnlEur24h: null,
    pnlPct24h: null,
    pnlEurSinceReading: null,
    pnlPctSinceReading: null,
    priorReadingTs: null,
    exitDecision: "review",
    recoveryProbabilityPct: 55,
    recoverySummary: "",
    investVerdict: "wait",
    precatKind: "watch",
    planReturnPct: 12,
    curvePeakReturnPct: null,
    daysToCurvePeak: null,
    curveGapPct: null,
    modelGapLossEur: null,
    daysToCd: 30,
    stabilityVerdict: "neutral",
    curveRisingHold: false,
    holdDaysElapsed: null,
    planTargetProvisional: false,
    ...partial,
  } as PortfolioLossAnalysisItem;
}

describe("lossAnalysisSummaryCapitalKpi", () => {
  it("buy opportunity shows plan slot in rec column", () => {
    const item = stubItem({ key: "GRCE|2026-01-01", ticker: "GRCE" });
    const kpi = buildLossAnalysisSummaryCapitalKpi({
      item,
      simRow: null,
      inputs: {},
      decisionRec: "buy",
      totalDenominatorEur: 5000,
    });
    expect(kpi.investedUsd).toBe(0);
    expect(kpi.actionSide).toBe("buy");
    expect(kpi.actionUsd).toBe(5000);
  });

  it("portfolio sell uses rescue-weighted fraction", () => {
    const item = stubItem({
      key: "BBNX|2026-01-01",
      ticker: "BBNX",
      hasPosition: true,
      inLoss: true,
      capital: 8000,
      pnlPct: -10,
      recoveryProbabilityPct: 35,
    });
    const kpi = buildLossAnalysisSummaryCapitalKpi({
      item,
      simRow: { Ticker: "BBNX", "Completion Date": "2026-01-01" },
      inputs: { [item.key]: { buyPrice: 10, capital: 8000 } },
      decisionRec: "sell",
      totalDenominatorEur: 8000,
    });
    expect(kpi.investedUsd).toBe(8000);
    expect(kpi.actionSide).toBe("sell");
    expect(kpi.actionUsd).toBeGreaterThan(0);
    expect(kpi.actionUsd!).toBeLessThanOrEqual(8000);
  });

  it("denominator sums open capital and buy slots", () => {
    const items = [
      stubItem({ key: "a", ticker: "A", hasPosition: true, capital: 3000 }),
      stubItem({ key: "b", ticker: "B" }),
    ];
    const recMap = new Map([
      ["a", "hold" as const],
      ["b", "buy" as const],
    ]);
    expect(lossAnalysisCapitalDenominatorEur(items, recMap)).toBe(8000);
  });

  it("HOLD with P(plan) 63 yields a P(plan)-derived target size", () => {
    // Real case (screenshot 2026-07-16): 32 opportunities in HOLD with
    // P(plan) ~59–68% all showed "—" in Rec. size because computeActionUsd
    // has no HOLD branch. Now they should show `≈ 0.63 × 5000 = $3,150`
    // as target size (grey, muted) so the user always sees the model's
    // recommended allocation size — not just when action is required.
    const item = stubItem({ key: "ERNA|2026-08-11", ticker: "ERNA" });
    const kpi = buildLossAnalysisSummaryCapitalKpi({
      item,
      simRow: null,
      inputs: {},
      decisionRec: "hold",
      totalDenominatorEur: 5000,
      pplanPct: 63,
    });
    expect(kpi.actionUsd).toBeNull();
    expect(kpi.actionSide).toBeNull();
    expect(kpi.targetUsd).toBe(3150);
    expect(kpi.targetPct).toBeCloseTo(0.63, 2);
  });

  it("HOLD with P(plan) < 40 shows no target (already below sell threshold)", () => {
    const item = stubItem({ key: "X|2026-08-11", ticker: "X" });
    const kpi = buildLossAnalysisSummaryCapitalKpi({
      item,
      simRow: null,
      inputs: {},
      decisionRec: "hold",
      totalDenominatorEur: 5000,
      pplanPct: 35,
    });
    expect(kpi.targetUsd).toBeNull();
  });

  it("HOLD with P(plan) null shows no target (nothing to derive from)", () => {
    const item = stubItem({ key: "X|2026-08-11", ticker: "X" });
    const kpi = buildLossAnalysisSummaryCapitalKpi({
      item,
      simRow: null,
      inputs: {},
      decisionRec: "hold",
      totalDenominatorEur: 5000,
      pplanPct: null,
    });
    expect(kpi.targetUsd).toBeNull();
    expect(kpi.actionUsd).toBeNull();
  });

  it("BUY still exposes actionUsd; target is present but should not shadow the delta", () => {
    // The UI consumes actionUsd first and falls back to targetUsd only when
    // actionUsd is null — so on BUY the operational delta wins the display.
    const item = stubItem({ key: "GRCE|2026-01-01", ticker: "GRCE" });
    const kpi = buildLossAnalysisSummaryCapitalKpi({
      item,
      simRow: null,
      inputs: {},
      decisionRec: "buy",
      totalDenominatorEur: 5000,
      pplanPct: 70,
    });
    expect(kpi.actionUsd).toBe(5000);
    expect(kpi.actionSide).toBe("buy");
    expect(kpi.targetUsd).toBe(3500);
  });
});
