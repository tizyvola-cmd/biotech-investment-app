import { describe, expect, it } from "vitest";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";
import {
  listRecoveredManualNewsTickers,
  stockNeedsManualGainInvestigation,
  stockNeedsManualNewsInvestigation,
  tickerManualNewsObsolete,
} from "./manualFeedDropPrompt";

function lossItem(
  ticker: string,
  pnlPct24h: number | null,
  overrides: Partial<PortfolioLossAnalysisItem> = {},
): PortfolioLossAnalysisItem {
  return {
    key: ticker,
    ticker,
    company: ticker,
    hasPosition: true,
    pnlPct: null,
    pnlPct24h,
    inLoss: false,
    daysToCd: null,
    investedAt: null,
    holdDaysElapsed: null,
    planReturnPct: null,
    planCdReturnPct: null,
    curveGapPct: null,
    curveGapUsd: null,
    slope5d: null,
    slope20d: null,
    slope45d: null,
    pred5Pp: null,
    stabilityVerdict: "unknown",
    precatKind: "",
    precatLabel: "",
    investVerdict: "hold",
    exitDecision: "hold",
    exitReason: "",
    daysToCurvePeak: null,
    curvePeakReturnPct: null,
    chartPointsLoaded: false,
    modelGapLossEur: null,
    curveGapLossEur: null,
    ...overrides,
  } as PortfolioLossAnalysisItem;
}

describe("stockNeedsManualNewsInvestigation", () => {
  it("flags daily loss below threshold", () => {
    expect(stockNeedsManualNewsInvestigation(lossItem("VIR", -6))).toBe(true);
  });

  it("clears when 24h move is flat or positive", () => {
    expect(stockNeedsManualNewsInvestigation(lossItem("VIR", 0.5))).toBe(false);
  });

  it("clears when 24h loss is below material threshold", () => {
    expect(stockNeedsManualNewsInvestigation(lossItem("CMPX", -2.0))).toBe(false);
    expect(stockNeedsManualNewsInvestigation(lossItem("CMPX", -3.9))).toBe(false);
    expect(stockNeedsManualNewsInvestigation(lossItem("CMPX", -4.5))).toBe(true);
  });

  it("ignores MTM loss when daily close is up", () => {
    expect(
      stockNeedsManualNewsInvestigation(lossItem("VIR", 2.0, { pnlPct: -8, inLoss: true })),
    ).toBe(false);
  });
});

describe("stockNeedsManualGainInvestigation", () => {
  it("flags daily gain above threshold", () => {
    expect(stockNeedsManualGainInvestigation(lossItem("CHRS", 4.5))).toBe(true);
  });

  it("clears when 24h gain is below material threshold", () => {
    expect(stockNeedsManualGainInvestigation(lossItem("CPIX", 1.0))).toBe(false);
    expect(stockNeedsManualGainInvestigation(lossItem("CPIX", 3.9))).toBe(false);
    expect(stockNeedsManualGainInvestigation(lossItem("CPIX", 4.5))).toBe(true);
  });

  it("ignores MTM gain when daily close is down", () => {
    expect(
      stockNeedsManualGainInvestigation(lossItem("BIIB", -2.4, { pnlPct: 12 })),
    ).toBe(false);
    expect(stockNeedsManualNewsInvestigation(lossItem("BIIB", -2.4, { pnlPct: 12 }))).toBe(false);
    expect(stockNeedsManualNewsInvestigation(lossItem("BIIB", -4.5, { pnlPct: 12 }))).toBe(true);
  });
});

describe("tickerManualNewsObsolete", () => {
  it("is obsolete when ticker recovered from loss", () => {
    const items = [lossItem("VIR", 1.2)];
    expect(tickerManualNewsObsolete("VIR", items)).toBe(true);
  });

  it("stays relevant while still in loss", () => {
    const items = [lossItem("LTRN", -4.5)];
    expect(tickerManualNewsObsolete("LTRN", items)).toBe(false);
  });

  it("is obsolete when ticker left the analysis list", () => {
    expect(tickerManualNewsObsolete("VIR", [lossItem("LTRN", -2)])).toBe(true);
  });
});

describe("listRecoveredManualNewsTickers", () => {
  it("returns empty when no manual events in storage", () => {
    expect(listRecoveredManualNewsTickers([lossItem("VIR", -5)])).toEqual([]);
  });
});
