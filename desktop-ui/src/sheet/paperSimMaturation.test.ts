import { describe, expect, it } from "vitest";
import type { PaperMaturationPoint } from "./paperSimMaturation";
import {
  buildPaperMaturationSeries,
  compressPaperMaturationSeries,
  maturationAxisShortLabel,
  preparePaperMaturationChartData,
  summarizePaperClosedDeals,
} from "./paperSimMaturation";
import type { DecisionSimTick } from "./investDecisionSimLoop";

describe("paperSimMaturation", () => {
  it("summarizes closed paper deals from sell trades", () => {
    const ticks: DecisionSimTick[] = [
      {
        id: "t1",
        at: "2026-06-12T10:00:00.000Z",
        evaluations: [],
        portfolioBefore: [
          {
            key: "a|cd",
            ticker: "AAA",
            entryAt: "2026-06-11T10:00:00.000Z",
            capital: 5000,
            entryReason: "buy",
            entryPlanReturnPct: 8,
            entryProbPct: 72,
          },
        ],
        portfolioAfter: [],
        trades: [
          {
            at: "2026-06-12T10:00:00.000Z",
            ticker: "AAA",
            key: "a|cd",
            side: "sell",
            reason: "exit",
            capital: 5000,
            pnlPctSimulated: 2.4,
            pnlEurSimulated: 120,
          },
        ],
        summary: {
          evaluatedTickers: 1,
          misalignedTickers: 0,
          harmonyAlignedPct: 100,
          precatVerdictAgree: 1,
          buySignals: 0,
          sellSignals: 1,
          holdSignals: 0,
          reviewSignals: 0,
          tradesExecuted: 1,
          misalignmentByType: {},
          piggyBank: {
            openCapitalEur: 0,
            openMtmPnlEur: 0,
            closedPnlEur: 120,
            totalPnlEur: 120,
            openPositionCount: 0,
            closedTradeCount: 1,
          },
        },
      },
    ];

    const summary = summarizePaperClosedDeals(ticks);
    expect(summary.dealCount).toBe(1);
    expect(summary.rawPnlEur).toBe(120);
    expect(summary.tickers).toEqual(["AAA"]);
    expect(summary.deals[0]?.holdDays).toBe(1);

    const series = buildPaperMaturationSeries(ticks);
    expect(series).toHaveLength(1);
    expect(series[0]?.closedPnlEur).toBe(120);
    expect(series[0]?.sellTicker).toBe("AAA");
  });

  it("reconstructs open MTM from lastMarkPct when stored piggy open is zero", () => {
    const ticks: DecisionSimTick[] = [
      {
        id: "t1",
        at: "2026-06-12T10:00:00.000Z",
        evaluations: [],
        portfolioBefore: [],
        portfolioAfter: [
          {
            key: "a|cd",
            ticker: "AAA",
            entryAt: "2026-06-11T10:00:00.000Z",
            capital: 5000,
            entryReason: "buy",
            entryPlanReturnPct: 8,
            entryProbPct: 72,
            lastMarkPct: 4,
          },
        ],
        trades: [],
        summary: {
          evaluatedTickers: 1,
          misalignedTickers: 0,
          harmonyAlignedPct: 100,
          precatVerdictAgree: 1,
          buySignals: 0,
          sellSignals: 0,
          holdSignals: 1,
          reviewSignals: 0,
          tradesExecuted: 0,
          misalignmentByType: {},
          piggyBank: {
            openCapitalEur: 5000,
            openMtmPnlEur: 0,
            closedPnlEur: 0,
            totalPnlEur: 0,
            openPositionCount: 1,
            closedTradeCount: 0,
          },
        },
      },
    ];

    const series = buildPaperMaturationSeries(ticks);
    expect(series[0]?.openMtmEur).toBe(200);
    expect(series[0]?.totalPnlEur).toBe(200);
  });

  it("uses sell-trade cumulative closed P&L when piggy closed is stale zero", () => {
    const ticks: DecisionSimTick[] = [
      {
        id: "t1",
        at: "2026-06-12T10:00:00.000Z",
        evaluations: [],
        portfolioBefore: [
          {
            key: "a|cd",
            ticker: "AAA",
            entryAt: "2026-06-11T10:00:00.000Z",
            capital: 5000,
            entryReason: "buy",
            entryPlanReturnPct: 8,
            entryProbPct: 72,
          },
        ],
        portfolioAfter: [],
        trades: [
          {
            at: "2026-06-12T10:00:00.000Z",
            ticker: "AAA",
            key: "a|cd",
            side: "sell",
            reason: "exit",
            capital: 5000,
            pnlPctSimulated: 2.4,
            pnlEurSimulated: 120,
          },
        ],
        summary: {
          evaluatedTickers: 1,
          misalignedTickers: 0,
          harmonyAlignedPct: 100,
          precatVerdictAgree: 1,
          buySignals: 0,
          sellSignals: 1,
          holdSignals: 0,
          reviewSignals: 0,
          tradesExecuted: 1,
          misalignmentByType: {},
          piggyBank: {
            openCapitalEur: 0,
            openMtmPnlEur: 0,
            closedPnlEur: 0,
            totalPnlEur: 0,
            openPositionCount: 0,
            closedTradeCount: 0,
          },
        },
      },
    ];

    const series = buildPaperMaturationSeries(ticks);
    expect(series[0]?.closedPnlEur).toBe(120);
  });

  it("uses stored openMtmPnlEur on compact ticks when evaluations are stripped", () => {
    const ticks: DecisionSimTick[] = [
      {
        id: "t1",
        at: "2026-06-18T16:00:00.000Z",
        evaluations: [],
        portfolioBefore: [],
        portfolioAfter: [
          {
            key: "a|cd",
            ticker: "AAA",
            entryAt: "2026-06-11T10:00:00.000Z",
            capital: 5000,
            entryReason: "buy",
            entryPlanReturnPct: 8,
            entryProbPct: 72,
          },
        ],
        trades: [],
        summary: {
          evaluatedTickers: 1,
          misalignedTickers: 0,
          harmonyAlignedPct: 100,
          precatVerdictAgree: 1,
          buySignals: 0,
          sellSignals: 0,
          holdSignals: 1,
          reviewSignals: 0,
          tradesExecuted: 0,
          misalignmentByType: {},
          piggyBank: {
            openCapitalEur: 5000,
            openMtmPnlEur: -3000,
            closedPnlEur: 1246,
            totalPnlEur: 0,
            openPositionCount: 1,
            closedTradeCount: 30,
          },
        },
      },
    ];

    const series = buildPaperMaturationSeries(ticks);
    expect(series[0]?.openMtmEur).toBe(-3000);
    expect(series[0]?.totalPnlEur).toBe(-1754);
  });

  it("compresses many same-day ticks for a short x-axis", () => {
    const points: PaperMaturationPoint[] = Array.from({ length: 20 }, (_, i) => ({
      at: `2026-06-12T${String(8 + Math.floor(i / 3)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00.000Z`,
      atLabel: `06-12 ${8 + Math.floor(i / 3)}:${String((i * 7) % 60).padStart(2, "0")}`,
      closedPnlEur: 0,
      openMtmEur: i * 10,
      totalPnlEur: i * 10,
      closedDealCount: 0,
      avgOpenPnlPct: null,
    }));
    points.push({
      at: new Date().toISOString(),
      atLabel: "· now",
      closedPnlEur: 0,
      openMtmEur: 500,
      totalPnlEur: 500,
      closedDealCount: 0,
      avgOpenPnlPct: 1.2,
      isLive: true,
    });
    const compressed = compressPaperMaturationSeries(points);
    expect(compressed.length).toBeLessThanOrEqual(14);
    expect(compressed[compressed.length - 1]?.isLive).toBe(true);
    const chart = preparePaperMaturationChartData(points);
    expect(chart.every((p) => p.xShort.length <= 6 || p.xShort === "· now")).toBe(true);
    expect(maturationAxisShortLabel({ at: "2026-06-12T10:00:00.000Z", atLabel: "06-12 10:00", isLive: false })).toBe(
      "06-12",
    );
  });
});
