import { describe, expect, it } from "vitest";
import {
  buildExperimentPiggyBank,
  computeOpenMtmPnl,
  evaluateExperimentTick,
  mergeScorecardDelta,
  defaultExperimentScorecard,
} from "./investDecisionSimExperiment";
import type { PaperPosition, PaperTradeEvent, TickerSimEvaluation } from "./investDecisionSimLoop";

function evalRow(
  overrides: Partial<TickerSimEvaluation> & { key: string; ticker: string },
): TickerSimEvaluation {
  return {
    hasPosition: false,
    inPaperPortfolio: false,
    daysToCd: 30,
    readings: {
      supernovaPeakPct: 8,
      planTargetPct: 8,
      planCdPct: 5,
      precatKind: "enter",
      slope5d: 0.1,
      slope20d: 0.05,
      pred5Pp: 0.4,
      curveGapPct: 0,
      harmonyMaxGapPp: 0,
      harmonyAligned: true,
      stabilityVerdict: "watch",
    },
    misalignments: [],
    misalignmentLabels: [],
    exitDecision: "hold",
    investVerdict: "yes",
    entryVerdict: "yes",
    exitVerdict: null,
    probPct: 55,
    suggestedAction: "buy",
    planReturnPct: 8,
    pnlPct24h: 1,
    pnlPct: 2,
    precatVerdictAgree: true,
    exitReason: "hold",
    compositeScore: 62,
    scoringZone: "hot",
    scoreBreakdown: {
      pplan: 20,
      top2: 18,
      precat: 12,
      slope: 8,
      timing: 4,
      conf: 3,
      sds: 1,
      eis: 1,
    },
    compositeDampened: false,
    ...overrides,
  };
}

describe("investDecisionSimExperiment", () => {
  it("computes open MTM from evaluations", () => {
    const portfolio: PaperPosition[] = [
      { key: "a", ticker: "ABC", entryAt: "2026-01-01", capital: 5000, entryReason: "x", entryPlanReturnPct: 8 },
    ];
    const evaluations = [evalRow({ key: "a", ticker: "ABC", pnlPct: 4 })];
    const { openMtmPnlEur } = computeOpenMtmPnl(portfolio, evaluations);
    expect(openMtmPnlEur).toBe(200);
  });

  it("flags missed buy when max positions reached", () => {
    const portfolio: PaperPosition[] = [
      { key: "p1", ticker: "A", entryAt: "t", capital: 5000, entryReason: "", entryPlanReturnPct: 5 },
    ];
    const evaluations = [
      evalRow({ key: "p1", ticker: "A", suggestedAction: "hold", inPaperPortfolio: true }),
      evalRow({ key: "p2", ticker: "B", suggestedAction: "buy" }),
    ];
    const result = evaluateExperimentTick({
      tickId: "t1",
      at: "2026-06-12T10:00:00Z",
      evaluations,
      trades: [],
      portfolioBefore: portfolio,
      portfolioAfter: portfolio,
      maxOpenPositions: 1,
      capitalPerTrade: 5000,
      closedPnlBeforeEur: 0,
      closedTradeCountBefore: 0,
      badBuyScoredKeys: new Set(),
    });
    expect(result.scorecardDelta.missedBuyCount).toBe(1);
    expect(result.adviceEvents[0]?.kind).toBe("missed_buy");
  });

  it("scores bad sell on losing exit", () => {
    const portfolio: PaperPosition[] = [
      { key: "x", ticker: "XYZ", entryAt: "t", capital: 5000, entryReason: "", entryPlanReturnPct: 5 },
    ];
    const trades: PaperTradeEvent[] = [
      {
        at: "t",
        ticker: "XYZ",
        key: "x",
        side: "sell",
        reason: "exit",
        capital: 5000,
        pnlPctSimulated: -5,
        pnlEurSimulated: -250,
      },
    ];
    const evaluations = [
      evalRow({ key: "x", ticker: "XYZ", suggestedAction: "sell", pnlPct: -5, inPaperPortfolio: true }),
    ];
    const result = evaluateExperimentTick({
      tickId: "t1",
      at: "2026-06-12T10:00:00Z",
      evaluations,
      trades,
      portfolioBefore: portfolio,
      portfolioAfter: [],
      maxOpenPositions: 8,
      capitalPerTrade: 5000,
      closedPnlBeforeEur: 0,
      closedTradeCountBefore: 0,
      badBuyScoredKeys: new Set(),
    });
    expect(result.scorecardDelta.badBuyCount).toBe(1);
    expect(result.scorecardDelta.badSellCount).toBe(1);
    expect(result.piggyBank.closedPnlEur).toBe(-250);
  });

  it("builds piggy bank total = open + closed", () => {
    const portfolio: PaperPosition[] = [
      { key: "a", ticker: "A", entryAt: "t", capital: 5000, entryReason: "", entryPlanReturnPct: 10 },
    ];
    const evaluations = [evalRow({ key: "a", ticker: "A", pnlPct: 10, inPaperPortfolio: true })];
    const piggy = buildExperimentPiggyBank(portfolio, evaluations, 100, 2);
    expect(piggy.openMtmPnlEur).toBe(500);
    expect(piggy.totalPnlEur).toBe(600);
  });

  it("ignores corrupted pnlPct when computing open MTM", () => {
    const portfolio: PaperPosition[] = [
      {
        key: "a",
        ticker: "A",
        entryAt: "t",
        capital: 5000,
        entryReason: "",
        entryPlanReturnPct: 10,
        lastMarkPct: 5,
      },
    ];
    const evaluations = [
      evalRow({ key: "a", ticker: "A", pnlPct: 7381, inPaperPortfolio: true }),
    ];
    const { openMtmPnlEur } = computeOpenMtmPnl(portfolio, evaluations);
    expect(openMtmPnlEur).toBe(250);
  });

  it("mergeScorecardDelta recomputes precision", () => {
    const merged = mergeScorecardDelta(defaultExperimentScorecard(), {
      goodBuyCount: 2,
      badBuyCount: 1,
    });
    expect(merged.advicePrecisionPct).toBeCloseTo(66.7, 0);
  });
});
