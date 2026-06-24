import { describe, expect, it } from "vitest";
import {
  buildClosedSuccessMetrics,
  buildTodaySuccessMetrics,
  computeRealizedSuccessForDeals,
  mergePortfolioSuccessBridge,
} from "./portfolioSuccessBridge";
import type { ComparisonDeal } from "./threePortfolioCompare";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";

function closedRow(pnlEur: number, key: string): SimOutcomeRow {
  return {
    row_key: key,
    ticker: key.split("|")[0] ?? "X",
    completion_date: "01/01/2026",
    days_to_cd: 30,
    cd_passed: false,
    timing_bucket: "pre",
    timing_label: "pre",
    capital_eur: 5000,
    buy_price_usd: 10,
    pnl_eur: pnlEur,
    pnl_pct: (pnlEur / 5000) * 100,
    outcome: pnlEur > 0 ? "win" : "loss",
    outcome_label: pnlEur > 0 ? "Win" : "Loss",
    is_win: pnlEur > 0,
    affidabilita_pct: 60,
    pred7_pp: 1,
    pred_direction_hit: true,
    exit_ts: "2026-06-10T12:00:00.000Z",
    entry_ts: "2026-06-09T12:00:00.000Z",
  };
}

describe("portfolioSuccessBridge", () => {
  it("computes 20% win rate on 1 win 4 losses", () => {
    const rows = [
      closedRow(33, "A|cd"),
      closedRow(-1, "B|cd"),
      closedRow(-1, "C|cd"),
      closedRow(-1, "D|cd"),
      closedRow(-1, "E|cd"),
    ];
    const closed = buildClosedSuccessMetrics(rows);
    expect(closed?.winRatePct).toBe(20);
    expect(closed?.winCount).toBe(1);
    expect(closed?.lossCount).toBe(4);
    expect(closed?.expectancyEurPerTrade).toBeGreaterThan(0);
  });

  it("merges today capture independently of closed win rate", () => {
    const today = buildTodaySuccessMetrics(
      {
        deltaActual: 535,
        capturePctToday: 88,
        capturePctFairToday: 101,
        gapVsRecToday: 73,
        gapVsFairRecToday: -5,
        gapVsAllGainersToday: 600,
        daysTracked: 2,
      },
      535,
      608,
      534,
    );
    const bridge = mergePortfolioSuccessBridge(
      buildClosedSuccessMetrics([closedRow(-1, "L|cd")]),
      today,
    );
    expect(bridge.closed?.winRatePct).toBe(0);
    expect(bridge.today?.capturePct).toBe(88);
    expect(bridge.today?.capturePctFair).toBe(101);
    expect(bridge.today?.pnlActualEur).toBe(535);
  });

  it("computeRealizedSuccessForDeals filters by universe tickers", () => {
    const rows = [
      closedRow(100, "A|cd"),
      closedRow(-50, "B|cd"),
      closedRow(80, "C|cd"),
    ];
    const deals: ComparisonDeal[] = [
      {
        ticker: "A",
        rowKey: "A|cd",
        label: "A",
        cells: {
          clinicalPhase: "Phase 2",
          clinicalIndication: "Unknown",
          sdsBucket: "No SDS",
          pplanBucket: "P(plan) n/a",
        },
        sdsValue: null,
        winRate: 0.5,
        rawWinRate: 0.5,
        confidence: "medium",
        winRateDimension: "clinicalPhase",
        winRateN: 5,
        payoffWinPct: 10,
        payoffLossPct: -8,
        payoffSource: "step1",
        lossRisk: null,
        riskScore: null,
        realizedReturnPct: null,
        realizedReturnPct24h: null,
      },
      {
        ticker: "B",
        rowKey: "B|cd",
        label: "B",
        cells: {
          clinicalPhase: "Phase 2",
          clinicalIndication: "Unknown",
          sdsBucket: "No SDS",
          pplanBucket: "P(plan) n/a",
        },
        sdsValue: null,
        winRate: 0.5,
        rawWinRate: 0.5,
        confidence: "medium",
        winRateDimension: "clinicalPhase",
        winRateN: 5,
        payoffWinPct: 10,
        payoffLossPct: -8,
        payoffSource: "step1",
        lossRisk: null,
        riskScore: null,
        realizedReturnPct: null,
        realizedReturnPct24h: null,
      },
    ];
    const r = computeRealizedSuccessForDeals(rows, deals);
    expect(r.sampleSize).toBe(2);
    expect(r.winCount).toBe(1);
    expect(r.lossCount).toBe(1);
    expect(r.winRatePct).toBe(50);
  });
});
