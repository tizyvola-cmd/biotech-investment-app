import { describe, expect, it } from "vitest";
import { buildSimLoopEqualSynthReconcile } from "./simLoopPulseView";
import type { DecisionSimState, DecisionSimTick, PaperPosition } from "./investDecisionSimLoop";
import type { SheetTable } from "../types";

function paperPos(key: string, ticker: string, capital = 5000): PaperPosition {
  return {
    key,
    ticker,
    capital,
    entryAt: "2026-06-01T10:00:00.000Z",
    entryProbPct: 60,
    entryPlanReturnPct: 10,
    lastMarkPct: 10,
  };
}

function tick(at: string, positions: PaperPosition[], markPct = 10): DecisionSimTick {
  return {
    id: `tick_${at}`,
    at,
    portfolioAfter: positions,
    evaluations: positions.map((p) => ({
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
      pnlPct: markPct,
      precatVerdictAgree: true,
      exitReason: null,
      compositeScore: null,
      scoringZone: null,
      scoreBreakdown: null,
      compositeDampened: false,
    })),
    trades: [],
    summary: { buySignals: 0, sellSignals: 0, holdSignals: 0, reviewSignals: 0, tradesExecuted: 0 },
  };
}

const simTable: SheetTable = {
  columns: ["Ticker", "Completion Date"],
  rows: [
    { Ticker: "WIN", "Completion Date": "2026-09-01" },
    { Ticker: "LOSE", "Completion Date": "2026-09-01" },
  ],
};

describe("buildSimLoopEqualSynthReconcile", () => {
  it("breaks down open and closed P&L per ticker", () => {
    const winnerKey = "WIN|2026-09-01";
    const loserKey = "LOSE|2026-09-01";
    const positions = [paperPos(winnerKey, "WIN")];
    const state: DecisionSimState = {
      ticks: [
        {
          ...tick("2026-06-17T10:00:00.000Z", positions),
          portfolioBefore: [paperPos(loserKey, "LOSE"), ...positions],
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
        },
        tick("2026-06-18T12:00:00.000Z", positions, 10),
      ],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: -500,
      closedTradeCount: 1,
    };

    const sizing = {
      shareByRowKey: { [loserKey]: 0.02, [winnerKey]: 0.25 },
      totalCapitalEur: 10_000,
      capitalPerTrade: 5000,
      sizingMode: "causal_rebalance" as const,
    };

    const report = buildSimLoopEqualSynthReconcile({ state, simTable, sizing });
    const loser = report.rows.find((r) => r.ticker === "LOSE");
    const winner = report.rows.find((r) => r.ticker === "WIN");

    expect(loser?.status).toBe("closed");
    expect(loser?.equalPnlClosedEur).toBeCloseTo(-500, 0);
    expect(winner?.status).toBe("open");
    expect(winner?.equalPnlOpenEur).toBeCloseTo(500, 0);
    // Causal rebalance after marks — not hindsight global 25% on winner.
    expect(winner?.synthPnlOpenEur).toBeGreaterThan(500);
    expect(loser?.synthPnlClosedEur).toBeGreaterThan(-500);
    expect(report.totals.equalTotalPnlEur).toBeCloseTo(0, 0);
    expect(report.totals.synthTotalPnlEur).toBeGreaterThan(0);
  });

  it("flags sign mismatch when synth flips vs equal", () => {
    const winnerKey = "WIN|2026-09-01";
    const loserKey = "LOSE|2026-09-01";
    const positions = [paperPos(winnerKey, "WIN")];
    const state: DecisionSimState = {
      ticks: [
        {
          ...tick("2026-06-17T10:00:00.000Z", positions),
          portfolioBefore: [paperPos(loserKey, "LOSE"), ...positions],
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
              pnlPct: -20,
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
              pnlPct: 5,
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
              pnlPctSimulated: -20,
              pnlEurSimulated: -1000,
            },
          ],
        },
        tick("2026-06-18T12:00:00.000Z", positions, 5),
      ],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: -1000,
      closedTradeCount: 1,
    };

    const report = buildSimLoopEqualSynthReconcile({
      state,
      simTable,
      sizing: {
        shareByRowKey: { [loserKey]: 0.02, [winnerKey]: 0.35 },
        totalCapitalEur: 10_000,
        capitalPerTrade: 5000,
        sizingMode: "causal_rebalance",
      },
    });

    expect(report.totals.equalTotalPnlEur).toBeCloseTo(-750, 0);
    expect(report.totals.synthTotalPnlEur).toBeGreaterThan(report.totals.equalTotalPnlEur);
    expect(report.signMismatch).toBe(true);
  });
});
