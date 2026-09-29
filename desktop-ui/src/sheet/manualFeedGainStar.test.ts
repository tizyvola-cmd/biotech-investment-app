import { describe, expect, it } from "vitest";
import {
  filterManualFeedEventsForAnchoredLossPanel,
  manualEventQualifiesForGainStar,
  tickerHasManualGainStar,
} from "./manualFeedGainStar";
import {
  resolveManualEventClassification,
  resolveManualEventEis,
  type ManualFeedEventDraft,
} from "./manualFeedEvents";
import {
  showManualGainNewsInvestigationLink,
  stockNeedsManualGainInvestigation,
} from "./manualFeedDropPrompt";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";

function gainItem(
  ticker: string,
  pnlPct: number | null,
  overrides: Partial<PortfolioLossAnalysisItem> = {},
): PortfolioLossAnalysisItem {
  return {
    key: ticker,
    ticker,
    company: ticker,
    hasPosition: true,
    pnlPct,
    pnlPct24h: null,
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

describe("stockNeedsManualGainInvestigation", () => {
  it("flags daily gain above threshold", () => {
    expect(stockNeedsManualGainInvestigation(gainItem("BNTX", 2.2, { pnlPct24h: 4.5 }))).toBe(true);
  });

  it("does not flag daily gain below threshold", () => {
    expect(stockNeedsManualGainInvestigation(gainItem("BNTX", 2.2, { pnlPct24h: 3.0 }))).toBe(false);
  });

  it("clears when daily flat even if MTM is up", () => {
    expect(stockNeedsManualGainInvestigation(gainItem("CPIX", 5, { pnlPct24h: 0.2 }))).toBe(false);
  });
});

describe("manualEventQualifiesForGainStar", () => {
  it("qualifies on positive catalyst with positive EIS", () => {
    const draft: ManualFeedEventDraft = {
      id: "x",
      createdAt: "",
      ticker: "BNTX",
      eventDate: "2026-07-04",
      source: "Manual",
      title: "BNTX Phase 3 met primary endpoint — FDA path accelerated",
      body: "Topline met primary endpoint with statistical significance.",
      priceDropPct: 2.5,
      investigationContext: "gain",
    };
    const { investigationOutcome } = resolveManualEventClassification(draft);
    expect(investigationOutcome).toBe("positive_catalyst");
    expect(resolveManualEventEis(draft).score).toBeGreaterThan(0);
    expect(manualEventQualifiesForGainStar(draft)).toBe(true);
  });

  it("does not qualify for market noise only", () => {
    const draft: ManualFeedEventDraft = {
      id: "x",
      createdAt: "",
      ticker: "MLTX",
      eventDate: "2026-07-04",
      source: "Manual",
      title: "Why MLTX rallied",
      body: "Sector rotation and broad market strength — no company news.",
      priceDropPct: 3,
    };
    expect(manualEventQualifiesForGainStar(draft)).toBe(false);
    expect(tickerHasManualGainStar("MLTX")).toBe(false);
  });
});

describe("showManualGainNewsInvestigationLink", () => {
  it("shows link when daily gain without saved news", () => {
    expect(showManualGainNewsInvestigationLink(gainItem("CHRS", 4, { pnlPct24h: 4.5 }))).toBe(true);
  });
});

describe("loss panel checklist anchor filter", () => {
  const anchored: ManualFeedEventDraft = {
    id: "friday-bntx",
    createdAt: "2026-07-03T16:00:00Z",
    ticker: "BNTX",
    eventDate: "2026-07-03",
    source: "Manual",
    title: "BNTX catalyst",
    body: "Positive readout.",
    priceDropPct: 2.1,
    investigationContext: "gain",
  };

  it("keeps row while Var.24h still matches Friday anchor", () => {
    expect(
      filterManualFeedEventsForAnchoredLossPanel([anchored], new Map([["BNTX", 2.3]])),
    ).toHaveLength(1);
  });

  it("drops row after a new material move on Monday", () => {
    expect(
      filterManualFeedEventsForAnchoredLossPanel([anchored], new Map([["BNTX", -2.0]])),
    ).toHaveLength(0);
  });

  it("drops all rows for a ticker when any anchored move is stale", () => {
    const thursday: ManualFeedEventDraft = {
      id: "cpix-thu",
      createdAt: "2026-07-03T12:00:00Z",
      ticker: "CPIX",
      eventDate: "2026-07-03",
      source: "Manual",
      title: "CPIX gain research",
      body: "Catalyst confirmed.",
      priceDropPct: 4.2,
      investigationContext: "gain",
    };
    const oldFeed: ManualFeedEventDraft = {
      id: "cpix-old",
      createdAt: "2024-11-06T12:00:00Z",
      ticker: "CPIX",
      eventDate: "2024-11-06",
      source: "Manual",
      title: "CPIX FDA orphan",
      body: "Historical feed note without VAR_24H.",
    };
    const moves = new Map([["CPIX", -3.3]]);
    expect(
      filterManualFeedEventsForAnchoredLossPanel([thursday, oldFeed], moves),
    ).toHaveLength(0);
  });
});
