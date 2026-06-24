import { describe, expect, it } from "vitest";
import type { DecisionSimTick } from "./investDecisionSimLoop";
import {
  alignSimLoopCurveToPortfolioDates,
  alignSimLoopPnlToPortfolioDates,
  buildSimLoopSynthMaturationSeries,
} from "./simLoopSynthMaturation";

function makeTick(
  at: string,
  overrides: Partial<DecisionSimTick> = {},
): DecisionSimTick {
  return {
    at,
    evaluations: [],
    trades: [],
    portfolioBefore: [],
    portfolioAfter: [],
    summary: { misalignments: { evaluatedTickers: 0, misalignedTickers: 0, misalignedPct: 0 } },
    ...overrides,
  };
}

describe("buildSimLoopSynthMaturationSeries", () => {
  it("scales closed sell P&L by synth/equal cap ratio", () => {
    const ticks = [
      makeTick("2026-06-12T10:00:00Z", {
        portfolioBefore: [
          { key: "AAA|cd", ticker: "AAA", entryAt: "2026-06-10", capital: 5000, entryProbPct: 60 },
        ],
        portfolioAfter: [],
        trades: [
          {
            at: "2026-06-12T10:00:00Z",
            key: "AAA|cd",
            ticker: "AAA",
            side: "sell",
            capital: 5000,
            pnlEurSimulated: 500,
            pnlPctSimulated: 10,
          },
        ],
      }),
    ];
    const series = buildSimLoopSynthMaturationSeries(ticks, {
      shareByRowKey: { "AAA|cd": 0.2 },
      totalCapitalEur: 10_000,
      capitalPerTrade: 5000,
      sizingMode: "static_approved",
    });
    expect(series).toHaveLength(1);
    // synth cap 2000 vs equal 5000 → P&L 500 * 0.4 = 200
    expect(series[0]!.simLoopSynthClosedPnlEur).toBe(200);
    expect(series[0]!.simLoopSynthOpenMtmEur).toBe(0);
    expect(series[0]!.simLoopSynthTotalPnlEur).toBe(200);
  });

  it("includes open MTM with synth caps", () => {
    const ticks = [
      makeTick("2026-06-13T10:00:00Z", {
        portfolioAfter: [
          { key: "BBB|cd", ticker: "BBB", entryAt: "2026-06-12", capital: 5000, entryProbPct: 55 },
        ],
        evaluations: [
          {
            key: "BBB|cd",
            ticker: "BBB",
            hasPosition: true,
            inPaperPortfolio: true,
            daysToCd: 10,
            readings: {} as never,
            misalignments: [],
            misalignmentLabels: [],
            exitDecision: "hold",
            investVerdict: "enter",
            entryVerdict: null,
            exitVerdict: null,
            probPct: 50,
            suggestedAction: "hold",
            planReturnPct: 20,
            pnlPct24h: null,
            pnlPct: 10,
            precatVerdictAgree: true,
            exitReason: "",
            compositeScore: 50,
            scoringZone: "mid",
            scoreBreakdown: {} as never,
            compositeDampened: false,
          },
        ],
      }),
    ];
    const series = buildSimLoopSynthMaturationSeries(ticks, {
      shareByRowKey: { "BBB|cd": 0.5 },
      totalCapitalEur: 10_000,
      capitalPerTrade: 5000,
      sizingMode: "static_approved",
    });
    // synth cap 5000, 10% → 500
    expect(series[0]!.simLoopSynthClosedPnlEur).toBe(0);
    expect(series[0]!.simLoopSynthOpenMtmEur).toBe(500);
    expect(series[0]!.simLoopSynthTotalPnlEur).toBe(500);
  });

  it("uses lastMarkPct for open MTM when evaluations were stripped from storage", () => {
    const ticks = [
      makeTick("2026-06-12T10:00:00Z", {
        portfolioAfter: [
          {
            key: "BBB|cd",
            ticker: "BBB",
            entryAt: "2026-06-11",
            capital: 5000,
            entryProbPct: 55,
            lastMarkPct: 10,
          },
        ],
        evaluations: [],
      }),
    ];
    const series = buildSimLoopSynthMaturationSeries(ticks, {
      shareByRowKey: { "BBB|cd": 0.5 },
      totalCapitalEur: 10_000,
      capitalPerTrade: 5000,
      sizingMode: "static_approved",
    });
    // synth cap 5000 * 10% = 500
    expect(series[0]!.simLoopSynthOpenMtmEur).toBe(500);
    expect(series[0]!.simLoopSynthTotalPnlEur).toBe(500);
  });

  it("aligns maturation to portfolio curve dates including live tail", () => {
    const maturation = [
      {
        at: "2026-06-12T10:00:00Z",
        simLoopSynthClosedPnlEur: 100,
        simLoopSynthOpenMtmEur: 0,
        simLoopSynthTotalPnlEur: 100,
      },
      {
        at: "2026-06-16T19:35:00Z",
        simLoopSynthClosedPnlEur: 100,
        simLoopSynthOpenMtmEur: 400,
        simLoopSynthTotalPnlEur: 500,
      },
    ];
    const portfolioCurve = [
      { date: "06-12 10:00", value: 51_000, totalPnlEur: 1000 },
      { date: "06-16 19:35", value: 54_000, totalPnlEur: 4000 },
      { date: "· now", value: 55_000, totalPnlEur: 5000 },
    ];
    const aligned = alignSimLoopCurveToPortfolioDates(maturation, portfolioCurve, 50_000);
    expect(aligned).toHaveLength(3);
    expect(aligned[0]!.value).toBe(50_100);
    expect(aligned[1]!.value).toBe(50_500);
    expect(aligned[2]!.value).toBe(50_500);
  });

  it("aligns synth P&L only (no book offset) to portfolio dates", () => {
    const maturation = [
      {
        at: "2026-06-12T10:00:00Z",
        simLoopSynthClosedPnlEur: 100,
        simLoopSynthOpenMtmEur: 0,
        simLoopSynthTotalPnlEur: 100,
      },
      {
        at: "2026-06-16T19:35:00Z",
        simLoopSynthClosedPnlEur: 100,
        simLoopSynthOpenMtmEur: 400,
        simLoopSynthTotalPnlEur: 500,
      },
    ];
    const portfolioCurve = [
      { date: "06-12 10:00", value: 100, totalPnlEur: 100 },
      { date: "06-16 19:35", value: 400, totalPnlEur: 400 },
      { date: "· now", value: 500, totalPnlEur: 500 },
    ];
    const aligned = alignSimLoopPnlToPortfolioDates(maturation, portfolioCurve);
    expect(aligned.map((p) => p.value)).toEqual([100, 500, 500]);
  });

  it("spreads synth open-MTM catch-up across history instead of a cliff at live", () => {
    const positions = [
      {
        key: "BBB|cd",
        ticker: "BBB",
        entryAt: "2026-06-11",
        capital: 5000,
        entryProbPct: 55,
        lastMarkPct: -70,
      },
    ];
    const histTick = (at: string, closed: number): DecisionSimTick =>
      makeTick(at, {
        portfolioAfter: positions,
        evaluations: [],
        summary: {
          misalignments: { evaluatedTickers: 0, misalignedTickers: 0, misalignedPct: 0 },
          piggyBank: {
            openCapitalEur: 5000,
            openMtmPnlEur: 0,
            closedPnlEur: closed,
            totalPnlEur: 0,
            openPositionCount: 1,
            closedTradeCount: 1,
          },
        },
      });

    const series = buildSimLoopSynthMaturationSeries(
      [
        histTick("2026-06-12T10:00:00Z", 400),
        histTick("2026-06-16T10:00:00Z", 1200),
        histTick("2026-06-18T10:00:00Z", 1246),
      ],
      {
        shareByRowKey: { "BBB|cd": 0.5 },
        totalCapitalEur: 10_000,
        capitalPerTrade: 5000,
        sizingMode: "static_approved",
        live: {
          paperPortfolio: positions,
          evaluations: [],
          piggyBank: {
            openCapitalEur: 5000,
            openMtmPnlEur: -3500,
            closedPnlEur: 1246,
            totalPnlEur: -2254,
            openPositionCount: 1,
            closedTradeCount: 1,
          },
        },
      },
    );

    const totals = series.map((p) => p.simLoopSynthTotalPnlEur);
    expect(totals[totals.length - 1]).toBeLessThan(0);
    const maxStep = totals
      .slice(1)
      .reduce((m, v, i) => Math.max(m, Math.abs(v - (totals[i] ?? v))), 0);
    expect(maxStep).toBeLessThan(2500);
  });
});
