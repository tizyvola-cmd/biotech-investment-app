import { describe, expect, it } from "vitest";
import type { DecisionSimTick, PaperPosition } from "./investDecisionSimLoop";
import {
  buildCausalSimLoopShareWalk,
  rebalanceCausalSimLoopShares,
  shareToSynthCap,
} from "./simLoopCausalSynth";

function pos(key: string, ticker: string, mark?: number): PaperPosition {
  return {
    key,
    ticker,
    capital: 5000,
    entryAt: "2026-06-01T10:00:00.000Z",
    entryProbPct: 60,
    entryPlanReturnPct: 10,
    lastMarkPct: mark ?? null,
  };
}

describe("simLoopCausalSynth", () => {
  it("rebalances toward winners after marks are observed", () => {
    const winnerKey = "WIN|2026-09-01";
    const loserKey = "LOSE|2026-09-01";
    const portfolio = [pos(loserKey, "LOSE", -10), pos(winnerKey, "WIN", 10)];
    const shares = rebalanceCausalSimLoopShares(
      portfolio,
      portfolio.map((p) => ({
        key: p.key,
        ticker: p.ticker,
        hasPosition: true,
        inPaperPortfolio: true,
        daysToCd: 30,
        readings: {},
        misalignments: [],
        misalignmentLabels: [],
        exitDecision: "hold",
        investVerdict: null,
        entryVerdict: null,
        exitVerdict: null,
        probPct: 60,
        suggestedAction: "hold",
        planReturnPct: 10,
        pnlPct24h: null,
        pnlPct: p.key === loserKey ? -10 : 10,
        precatVerdictAgree: true,
        exitReason: null,
        compositeScore: null,
        scoringZone: null,
        scoreBreakdown: null,
        compositeDampened: false,
      })),
      { totalCapitalEur: 10_000, capitalPerTrade: 5000 },
    );
    expect(shares[winnerKey]!).toBeGreaterThan(shares[loserKey]!);
  });

  it("does not apply future global weights to past sells", () => {
    const winnerKey = "WIN|2026-09-01";
    const loserKey = "LOSE|2026-09-01";
    const ticks: DecisionSimTick[] = [
      {
        id: "t1",
        at: "2026-06-17T10:00:00.000Z",
        portfolioBefore: [pos(loserKey, "LOSE", -10), pos(winnerKey, "WIN", 10)],
        portfolioAfter: [pos(winnerKey, "WIN", 10)],
        evaluations: [
          {
            key: loserKey,
            ticker: "LOSE",
            hasPosition: true,
            inPaperPortfolio: true,
            daysToCd: 30,
            readings: {},
            misalignments: [],
            misalignmentLabels: [],
            exitDecision: "sell",
            investVerdict: null,
            entryVerdict: null,
            exitVerdict: null,
            probPct: 60,
            suggestedAction: "sell",
            planReturnPct: 10,
            pnlPct24h: null,
            pnlPct: -10,
            precatVerdictAgree: true,
            exitReason: null,
            compositeScore: null,
            scoringZone: null,
            scoreBreakdown: null,
            compositeDampened: false,
          },
          {
            key: winnerKey,
            ticker: "WIN",
            hasPosition: true,
            inPaperPortfolio: true,
            daysToCd: 30,
            readings: {},
            misalignments: [],
            misalignmentLabels: [],
            exitDecision: "hold",
            investVerdict: null,
            entryVerdict: null,
            exitVerdict: null,
            probPct: 60,
            suggestedAction: "hold",
            planReturnPct: 10,
            pnlPct24h: null,
            pnlPct: 10,
            precatVerdictAgree: true,
            exitReason: null,
            compositeScore: null,
            scoringZone: null,
            scoreBreakdown: null,
            compositeDampened: false,
          },
        ],
        trades: [
          {
            at: "2026-06-17T10:00:00.000Z",
            ticker: "LOSE",
            key: loserKey,
            side: "sell",
            reason: "exit",
            capital: 5000,
            pnlPctSimulated: -10,
            pnlEurSimulated: -500,
          },
        ],
        summary: {
          evaluatedTickers: 2,
          misalignedTickers: 0,
          harmonyAlignedPct: 100,
          precatVerdictAgree: 2,
          buySignals: 0,
          sellSignals: 1,
          holdSignals: 1,
          reviewSignals: 0,
          tradesExecuted: 1,
          misalignmentByType: {},
        },
      },
    ];

    const walk = buildCausalSimLoopShareWalk(ticks, {
      totalCapitalEur: 10_000,
      capitalPerTrade: 5000,
      sizingMode: "causal_rebalance",
    });
    const sellShare = walk.sellShareByEventKey.get(`2026-06-17T10:00:00.000Z\0${loserKey}`);
    expect(sellShare).toBeDefined();
    expect(sellShare!).toBeLessThan(0.5);
    const synthCap = shareToSynthCap(sellShare, 10_000, 5000);
    const scaledLoss = Math.round(-500 * (synthCap / 5000) * 100) / 100;
    // Optimizer can zero the loser before sell — never the hindsight 2% (-20 €).
    expect(scaledLoss).not.toBeCloseTo(-20, 0);
    expect(scaledLoss).toBeGreaterThanOrEqual(-500);
  });
});
