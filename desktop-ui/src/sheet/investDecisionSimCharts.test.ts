import { describe, expect, it } from "vitest";
import {
  buildDecisionSimCumulativeSeries,
  buildDecisionSimTradeChartSeries,
  computeRecs24hHypotheticalPnl,
  formatDecisionSimChartTime,
  isInRecs24hUniverse,
  sumClosedPnlFromTicks,
} from "./investDecisionSimCharts";
import type { DecisionSimTick, TickerSimEvaluation } from "./investDecisionSimLoop";

const baseEval = (
  overrides: Partial<TickerSimEvaluation> & Pick<TickerSimEvaluation, "key" | "ticker">,
): TickerSimEvaluation => ({
  hasPosition: false,
  inPaperPortfolio: false,
  daysToCd: 30,
  readings: {} as TickerSimEvaluation["readings"],
  misalignments: [],
  misalignmentLabels: [],
  exitDecision: "hold",
  investVerdict: "yes",
  entryVerdict: "yes",
  exitVerdict: "wait",
  probPct: 70,
  suggestedAction: "none",
  planReturnPct: 10,
  pnlPct24h: null,
  pnlPct: null,
  precatVerdictAgree: true,
  exitReason: "",
  compositeScore: 50,
  scoringZone: "hot",
  scoreBreakdown: {
    pplan: 16,
    top2: 12,
    precat: 10,
    slope: 6,
    timing: 3,
    conf: 2,
    sds: 1,
    eis: 0,
  },
  compositeDampened: false,
  ...overrides,
});

const baseTick = (
  at: string,
  trades: DecisionSimTick["trades"],
  piggy: { totalPnlEur: number; openMtmPnlEur: number; closedPnlEur: number },
  evaluations: TickerSimEvaluation[] = [],
): DecisionSimTick => ({
  id: `t-${at}`,
  at,
  evaluations,
  portfolioBefore: [],
  portfolioAfter: [],
  trades,
  summary: {
    evaluatedTickers: 1,
    misalignedTickers: 0,
    harmonyAlignedPct: null,
    precatVerdictAgree: 1,
    buySignals: 0,
    sellSignals: 0,
    holdSignals: 0,
    reviewSignals: 0,
    tradesExecuted: trades.length,
    misalignmentByType: {},
    piggyBank: {
      openCapitalEur: 5000,
      openMtmPnlEur: piggy.openMtmPnlEur,
      closedPnlEur: piggy.closedPnlEur,
      totalPnlEur: piggy.totalPnlEur,
      openPositionCount: 1,
      closedTradeCount: 0,
    },
  },
});

describe("formatDecisionSimChartTime", () => {
  it("shows Europe/Rome wall clock, not raw UTC slice", () => {
    expect(formatDecisionSimChartTime("2026-06-19T13:01:00.000Z")).toBe("06-19 15:01");
    expect(formatDecisionSimChartTime("2026-06-19T20:00:00.000Z")).toBe("06-19 22:00");
  });

  it("handles space-separated timestamps", () => {
    expect(formatDecisionSimChartTime("2026-06-12 10:36:00.000Z")).toBe("06-12 12:36");
  });
});

describe("buildDecisionSimCumulativeSeries", () => {
  it("accumulates realized on sells and tracks MTM total per tick", () => {
    const ticks = [
      baseTick(
        "2026-06-12T08:34:00.000Z",
        [{ at: "2026-06-12T08:34:00.000Z", ticker: "AAA", key: "A", side: "buy", reason: "x", capital: 5000, pnlPctSimulated: null, pnlEurSimulated: null }],
        { totalPnlEur: -50, openMtmPnlEur: -50, closedPnlEur: 0 },
      ),
      baseTick(
        "2026-06-12T14:31:00.000Z",
        [{ at: "2026-06-12T14:31:00.000Z", ticker: "AAA", key: "A", side: "sell", reason: "x", capital: 5000, pnlPctSimulated: 2, pnlEurSimulated: 100 }],
        { totalPnlEur: 100, openMtmPnlEur: 0, closedPnlEur: 100 },
      ),
    ];
    const series = buildDecisionSimCumulativeSeries(ticks);
    expect(series).toHaveLength(2);
    expect(series[1].cumulativeRealizedEur).toBe(100);
    expect(series[1].totalPnlEur).toBe(100);
    expect(sumClosedPnlFromTicks(ticks)).toBe(100);
  });

  it("reconstructs total P&L when stored piggy total is zero but book had exposure", () => {
    const ticks: DecisionSimTick[] = [
      {
        ...baseTick(
          "2026-06-17T12:00:00.000Z",
          [
            {
              at: "2026-06-17T12:00:00.000Z",
              ticker: "AAA",
              key: "AAA|cd",
              side: "sell",
              reason: "x",
              capital: 5000,
              pnlPctSimulated: 4,
              pnlEurSimulated: 200,
            },
          ],
          { totalPnlEur: 0, openMtmPnlEur: 0, closedPnlEur: 0 },
        ),
        portfolioAfter: [
          {
            key: "BBB|cd2",
            ticker: "BBB",
            capital: 5000,
            entryAt: "2026-06-17T10:00:00.000Z",
            entryProbPct: 60,
            entryPlanReturnPct: 10,
            lastMarkPct: 2,
          },
        ],
      },
    ];
    const series = buildDecisionSimCumulativeSeries(ticks);
    expect(series[0]?.totalPnlEur).toBeCloseTo(300, 0);
  });
});

describe("buildDecisionSimTradeChartSeries", () => {
  it("lists buys at 0 and sells with realized pnl", () => {
    const ticks = [
      baseTick(
        "2026-06-12T10:36:00.000Z",
        [{ at: "2026-06-12T10:36:00.000Z", ticker: "BBB", key: "B", side: "buy", reason: "x", capital: 5000, pnlPctSimulated: null, pnlEurSimulated: null }],
        { totalPnlEur: 0, openMtmPnlEur: 0, closedPnlEur: 0 },
      ),
      baseTick(
        "2026-06-12T15:52:00.000Z",
        [{ at: "2026-06-12T15:52:00.000Z", ticker: "BBB", key: "B", side: "sell", reason: "x", capital: 5000, pnlPctSimulated: -4, pnlEurSimulated: -200 }],
        { totalPnlEur: -200, openMtmPnlEur: 0, closedPnlEur: -200 },
      ),
    ];
    const trades = buildDecisionSimTradeChartSeries(ticks);
    expect(trades).toHaveLength(2);
    expect(trades[0].side).toBe("buy");
    expect(trades[0].pnlEur).toBe(0);
    expect(trades[0].buyMarkerY).toBe(0);
    expect(trades[0].sellBarEur).toBeNull();
    expect(trades[1].side).toBe("sell");
    expect(trades[1].pnlEur).toBe(-200);
    expect(trades[1].sellBarEur).toBe(-200);
    expect(trades[1].buyMarkerY).toBeNull();
    expect(trades[1].cumRealizedEur).toBe(-200);
  });

  it("rebuilds BUY markers from portfolio when tick trades are missing", () => {
    const trades = buildDecisionSimTradeChartSeries(
      [],
      new Map([["B", { pnlPct: -2, pnlPct24h: null }]]),
      [
        {
          key: "B",
          ticker: "BBB",
          entryAt: "2026-06-12T10:36:00.000Z",
          capital: 5000,
          entryReason: "test",
          entryPlanReturnPct: 10,
        },
      ],
    );
    expect(trades).toHaveLength(1);
    expect(trades[0].fromPortfolioFallback).toBe(true);
    expect(trades[0].buyMarkerY).toBe(0);
    expect(trades[0].openMtmEur).toBe(-100);
  });
});

describe("computeRecs24hHypotheticalPnl", () => {
  it("sums 24h move for buy signals and real portfolio only", () => {
    const evals = [
      baseEval({ key: "A", ticker: "AAA", suggestedAction: "buy", pnlPct24h: 2 }),
      baseEval({ key: "B", ticker: "BBB", hasPosition: true, pnlPct24h: -1 }),
      baseEval({ key: "C", ticker: "CCC", suggestedAction: "review", pnlPct24h: 5 }),
    ];
    expect(isInRecs24hUniverse(evals[0])).toBe(true);
    expect(isInRecs24hUniverse(evals[2])).toBe(false);
    expect(computeRecs24hHypotheticalPnl(evals)).toBe(50);
  });

  it("attaches recs24h to cumulative series from tick evaluations", () => {
    const ticks = [
      baseTick(
        "2026-06-12T10:00:00.000Z",
        [],
        { totalPnlEur: -300, openMtmPnlEur: -300, closedPnlEur: 0 },
        [baseEval({ key: "A", ticker: "AAA", suggestedAction: "buy", pnlPct24h: 4 })],
      ),
    ];
    const series = buildDecisionSimCumulativeSeries(ticks);
    expect(series[0].recs24hHypotheticalEur).toBe(200);
    expect(series[0].fairRecs24hEur).toBe(200);
    expect(series[0].cumulativeFairRecs24hEur).toBe(200);
    expect(series[0].totalPnlEur).toBe(-300);
  });

  it("accumulates fair recs across ticks for multi-day backtest line", () => {
    const evals = [baseEval({ key: "A", ticker: "AAA", suggestedAction: "buy", pnlPct24h: 2 })];
    const ticks = [
      baseTick("2026-06-11T10:00:00.000Z", [], { totalPnlEur: 0, openMtmPnlEur: 0, closedPnlEur: 0 }, evals),
      baseTick("2026-06-12T10:00:00.000Z", [], { totalPnlEur: 50, openMtmPnlEur: 50, closedPnlEur: 0 }, evals),
    ];
    const series = buildDecisionSimCumulativeSeries(ticks);
    expect(series[0].cumulativeFairRecs24hEur).toBe(100);
    expect(series[1].cumulativeFairRecs24hEur).toBe(200);
  });
});
