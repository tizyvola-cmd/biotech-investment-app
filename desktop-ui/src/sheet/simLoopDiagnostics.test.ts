import { describe, expect, it } from "vitest";
import type { DecisionSimState } from "./investDecisionSimLoop";
import { defaultDecisionSimState } from "./investDecisionSimStorage";
import {
  auditDecisionSimState,
  repairDecisionSimState,
} from "./simLoopDiagnostics";

function baseState(overrides: Partial<DecisionSimState> = {}): DecisionSimState {
  return { ...defaultDecisionSimState(), ...overrides };
}

describe("auditDecisionSimState", () => {
  it("reports healthy empty state", () => {
    const report = auditDecisionSimState(baseState());
    expect(report.healthy).toBe(true);
    expect(report.findings).toHaveLength(0);
  });

  it("flags closed P&L drift", () => {
    const report = auditDecisionSimState(
      baseState({
        cumulativePaperPnlEur: 500,
        ticks: [
          {
            id: "t1",
            at: "2026-06-18T10:00:00.000Z",
            evaluations: [],
            portfolioBefore: [],
            portfolioAfter: [],
            trades: [
              {
                at: "2026-06-18T10:00:00.000Z",
                ticker: "AAA",
                key: "AAA|2026-09-01",
                side: "sell",
                reason: "exit",
                capital: 5000,
                pnlPctSimulated: 2,
                pnlEurSimulated: 100,
              },
            ],
            summary: {
              buySignals: 0,
              sellSignals: 1,
              holdSignals: 0,
              reviewSignals: 0,
              tradesExecuted: 1,
            },
          },
        ],
      }),
    );
    expect(report.findings.some((f) => f.id === "closed_pnl_drift")).toBe(true);
  });

  it("flags large paper book", () => {
    const positions = Array.from({ length: 45 }, (_, i) => ({
      key: `T${i}|2026-09-01`,
      ticker: `T${i}`,
      capital: 5000,
      entryAt: "2026-06-01T10:00:00.000Z",
      entryProbPct: 60,
      entryPlanReturnPct: 10,
      lastMarkPct: 1,
    }));
    const report = auditDecisionSimState(baseState({ paperPortfolio: positions }));
    expect(report.findings.some((f) => f.id === "large_paper_book")).toBe(true);
  });

  it("flags portfolio vs last tick mismatch as critical", () => {
    const pos = {
      key: "AAA|2026-09-01",
      ticker: "AAA",
      capital: 5000,
      entryAt: "2026-06-01T10:00:00.000Z",
      entryProbPct: 60,
      entryPlanReturnPct: 10,
      lastMarkPct: 1,
    };
    const report = auditDecisionSimState(
      baseState({
        paperPortfolio: [pos],
        ticks: [
          {
            id: "t1",
            at: "2026-06-18T10:00:00.000Z",
            evaluations: [],
            portfolioBefore: [],
            portfolioAfter: [],
            trades: [],
            summary: {
              buySignals: 0,
              sellSignals: 0,
              holdSignals: 0,
              reviewSignals: 0,
              tradesExecuted: 0,
            },
          },
        ],
      }),
    );
    expect(report.findings.some((f) => f.id === "portfolio_tick_mismatch")).toBe(true);
    expect(report.healthy).toBe(false);
  });
});

describe("repairDecisionSimState", () => {
  it("realigns cumulative closed P&L from tick sells", () => {
    const state = baseState({
      cumulativePaperPnlEur: 999,
      closedTradeCount: 0,
      ticks: [
        {
          id: "t1",
          at: "2026-06-18T10:00:00.000Z",
          evaluations: [],
          portfolioBefore: [],
          portfolioAfter: [],
          trades: [
            {
              at: "2026-06-18T10:00:00.000Z",
              ticker: "AAA",
              key: "AAA|2026-09-01",
              side: "sell",
              reason: "exit",
              capital: 5000,
              pnlPctSimulated: 4,
              pnlEurSimulated: 200,
            },
          ],
          summary: {
            buySignals: 0,
            sellSignals: 1,
            holdSignals: 0,
            reviewSignals: 0,
            tradesExecuted: 1,
          },
        },
      ],
    });
    const repaired = repairDecisionSimState(state);
    expect(repaired.cumulativePaperPnlEur).toBe(200);
    expect(repaired.closedTradeCount).toBeGreaterThanOrEqual(1);
  });
});
