import { describe, expect, it } from "vitest";
import {
  buildEndOfDayMapsFromTicks,
  looksLikeOpenMtmCatchUpCliff,
  reconcileEndOfDayTotalsToLive,
  resolveTickEndTotalPnlEur,
  roundSimPnlEur,
  sanitizeDecisionSimTimeSeries,
  sanitizeLiveExperimentPiggy,
} from "./decisionSimPnlResolve";
import { buildDecisionSimPnlDailySeries } from "./decisionSimPnlDaily";
import { buildDecisionSimCumulativeSeries } from "./investDecisionSimCharts";
import type { DecisionSimTick } from "./investDecisionSimLoop";

describe("resolveTickEndTotalPnlEur", () => {
  it("uses piggy open+closed parts when evaluations were stripped", () => {
    const total = resolveTickEndTotalPnlEur(
      1246,
      [
        {
          key: "AAA|cd",
          ticker: "AAA",
          capital: 5000,
          entryAt: "2026-06-01T10:00:00.000Z",
          entryProbPct: 60,
          entryPlanReturnPct: 10,
        },
      ],
      [],
      {
        openCapitalEur: 45000,
        openMtmPnlEur: -8538,
        closedPnlEur: 1246,
        totalPnlEur: 0,
        openPositionCount: 9,
        closedTradeCount: 30,
      },
    );
    expect(total).toBe(-7292);
  });
});

describe("buildDecisionSimPnlDailySeries catch-up", () => {
  it("spreads live open-MTM catch-up instead of one-day cliff", () => {
    const positions = [
      {
        key: "AAA|cd",
        ticker: "AAA",
        capital: 5000,
        entryAt: "2026-06-11T10:00:00.000Z",
        entryProbPct: 60,
        entryPlanReturnPct: 10,
      },
    ];
    const tick = (at: string, totalPnlEur: number, closedPnlEur: number): DecisionSimTick => ({
      id: `t-${at}`,
      at,
      evaluations: [],
      portfolioBefore: [],
      portfolioAfter: positions,
      trades: [],
      summary: {
        evaluatedTickers: 1,
        misalignedTickers: 0,
        harmonyAlignedPct: 100,
        precatVerdictAgree: 1,
        buySignals: 0,
        sellSignals: 0,
        holdSignals: 0,
        reviewSignals: 0,
        tradesExecuted: 0,
        misalignmentByType: {},
        piggyBank: {
          openCapitalEur: 5000,
          openMtmPnlEur: totalPnlEur - closedPnlEur,
          closedPnlEur,
          totalPnlEur: 0,
          openPositionCount: 1,
          closedTradeCount: 0,
        },
      },
    });

    const ticks: DecisionSimTick[] = [
      tick("2026-06-12T16:00:00.000Z", 200, 200),
      tick("2026-06-13T16:00:00.000Z", 400, 400),
      tick("2026-06-14T16:00:00.000Z", 600, 600),
      tick("2026-06-15T16:00:00.000Z", 800, 800),
      tick("2026-06-16T16:00:00.000Z", 1000, 1000),
      tick("2026-06-17T16:00:00.000Z", 1200, 1200),
      tick("2026-06-18T16:00:00.000Z", 1523, 1246),
    ];

    const series = buildDecisionSimPnlDailySeries(ticks, -7292);
    expect(series[series.length - 1]?.cumSimLoop).toBe(-7292);
    const lastDay = series[series.length - 1]?.daySimLoop ?? 0;
    expect(Math.abs(lastDay)).toBeLessThan(3500);
    expect(series.some((p) => p.daySimLoop < -500)).toBe(true);
  });
});

describe("reconcileEndOfDayTotalsToLive", () => {
  it("ramps end totals when last-day delta is implausible", () => {
    const end = new Map([
      ["2026-06-15", 600],
      ["2026-06-16", 800],
      ["2026-06-17", 1200],
      ["2026-06-18", 1523],
    ]);
    const cumR = new Map([
      ["2026-06-15", 600],
      ["2026-06-16", 800],
      ["2026-06-17", 1200],
      ["2026-06-18", 1246],
    ]);
    const out = reconcileEndOfDayTotalsToLive(end, cumR, -7292);
    expect(out.get("2026-06-18")).toBe(-7292);
    const lastDelta = (out.get("2026-06-18") ?? 0) - (out.get("2026-06-17") ?? 0);
    expect(Math.abs(lastDelta)).toBeLessThan(3500);
  });
});

describe("buildEndOfDayMapsFromTicks", () => {
  it("reads decomposed piggy on compact ticks", () => {
    const { endOfDayTotal } = buildEndOfDayMapsFromTicks([
      {
        id: "t1",
        at: "2026-06-18T16:00:00.000Z",
        evaluations: [],
        portfolioBefore: [],
        portfolioAfter: [],
        trades: [],
        summary: {
          evaluatedTickers: 0,
          misalignedTickers: 0,
          harmonyAlignedPct: null,
          precatVerdictAgree: 0,
          buySignals: 0,
          sellSignals: 0,
          holdSignals: 0,
          reviewSignals: 0,
          tradesExecuted: 0,
          misalignmentByType: {},
          piggyBank: {
            openCapitalEur: 45000,
            openMtmPnlEur: -2000,
            closedPnlEur: 1246,
            totalPnlEur: 0,
            openPositionCount: 9,
            closedTradeCount: 30,
          },
        },
      },
    ]);
    expect(endOfDayTotal.get("2026-06-18")).toBe(-754);
  });
});

describe("sanitizeLiveExperimentPiggy", () => {
  it("recomputes total from closed + open when stored total is stale", () => {
    const result = sanitizeLiveExperimentPiggy(
      {
        openCapitalEur: 45000,
        openMtmPnlEur: -8538,
        closedPnlEur: 1246,
        totalPnlEur: 1523,
        openPositionCount: 9,
        closedTradeCount: 30,
      },
      1246,
    );
    expect(result.adjusted).toBe(true);
    expect(result.piggy.totalPnlEur).toBe(-7292);
  });
});

describe("sanitizeDecisionSimTimeSeries", () => {
  it("ramps maturation totals instead of a live-end cliff", () => {
    const positions = [
      {
        key: "AAA|cd",
        ticker: "AAA",
        capital: 5000,
        entryAt: "2026-06-11T10:00:00.000Z",
        entryProbPct: 60,
        entryPlanReturnPct: 10,
      },
    ];
    const tick = (at: string, closed: number): DecisionSimTick => ({
      id: `t-${at}`,
      at,
      evaluations: [],
      portfolioBefore: [],
      portfolioAfter: positions,
      trades: [],
      summary: {
        evaluatedTickers: 1,
        misalignedTickers: 0,
        harmonyAlignedPct: 100,
        precatVerdictAgree: 1,
        buySignals: 0,
        sellSignals: 0,
        holdSignals: 0,
        reviewSignals: 0,
        tradesExecuted: 0,
        misalignmentByType: {},
        piggyBank: {
          openCapitalEur: 5000,
          openMtmPnlEur: 0,
          closedPnlEur: closed,
          totalPnlEur: 0,
          openPositionCount: 1,
          closedTradeCount: 0,
        },
      },
    });

    const ticks = [
      tick("2026-06-15T16:00:00.000Z", 600),
      tick("2026-06-16T16:00:00.000Z", 800),
      tick("2026-06-17T16:00:00.000Z", 1000),
      tick("2026-06-18T16:00:00.000Z", 1246),
    ];
    const series = buildDecisionSimCumulativeSeries(ticks, {
      piggyBank: {
        openCapitalEur: 45000,
        openMtmPnlEur: -8538,
        closedPnlEur: 1246,
        totalPnlEur: -7292,
        openPositionCount: 9,
        closedTradeCount: 30,
      },
      paperPortfolio: positions,
      evaluations: [],
    });
    const hist = series.filter((p) => !p.isLive);
    expect(series[series.length - 1]?.totalPnlEur).toBe(-7292);
    expect(hist.length).toBeGreaterThan(1);
    const lastHist = hist[hist.length - 1]!;
    const prevHist = hist[hist.length - 2]!;
    expect(Math.abs(lastHist.totalPnlEur - prevHist.totalPnlEur)).toBeLessThan(4000);
  });

  it("ramps when history shows closed-only climb then live includes open MTM", () => {
    const positions = [
      {
        key: "AAA|cd",
        ticker: "AAA",
        capital: 5000,
        entryAt: "2026-06-11T10:00:00.000Z",
        entryProbPct: 60,
        entryPlanReturnPct: 10,
      },
    ];
    const tick = (at: string, closed: number): DecisionSimTick => ({
      id: `t-${at}`,
      at,
      evaluations: [],
      portfolioBefore: [],
      portfolioAfter: positions,
      trades: [],
      summary: {
        evaluatedTickers: 1,
        misalignedTickers: 0,
        harmonyAlignedPct: 100,
        precatVerdictAgree: 1,
        buySignals: 0,
        sellSignals: 0,
        holdSignals: 0,
        reviewSignals: 0,
        tradesExecuted: 0,
        misalignmentByType: {},
        piggyBank: {
          openCapitalEur: 55000,
          openMtmPnlEur: 0,
          closedPnlEur: closed,
          totalPnlEur: closed,
          openPositionCount: 11,
          closedTradeCount: 31,
        },
      },
    });

    const ticks = [
      tick("2026-06-12T16:00:00.000Z", 800),
      tick("2026-06-14T16:00:00.000Z", 1500),
      tick("2026-06-18T16:00:00.000Z", 2500),
    ];
    const series = buildDecisionSimCumulativeSeries(ticks, {
      piggyBank: {
        openCapitalEur: 55000,
        openMtmPnlEur: -4771,
        closedPnlEur: 2500,
        totalPnlEur: -2271,
        openPositionCount: 11,
        closedTradeCount: 31,
      },
      paperPortfolio: positions,
      evaluations: [],
    });

    expect(series[series.length - 1]?.totalPnlEur).toBe(-2271);
    const hist = series.filter((p) => !p.isLive);
    const lastHist = hist[hist.length - 1]!;
    const prevHist = hist[hist.length - 2]!;
    expect(Math.abs(lastHist.totalPnlEur - prevHist.totalPnlEur)).toBeLessThan(2500);
    expect(lastHist.totalPnlEur).toBeLessThan(2500);
  });

  it("ramps when last tick had stale positive open MTM then live re-marked negative", () => {
    const positions = [
      {
        key: "AAA|cd",
        ticker: "AAA",
        capital: 5000,
        entryAt: "2026-06-11T10:00:00.000Z",
        entryProbPct: 60,
        entryPlanReturnPct: 10,
        lastMarkPct: 5,
      },
    ];
    const tick = (
      at: string,
      closed: number,
      openMtm: number,
    ): DecisionSimTick => ({
      id: `t-${at}`,
      at,
      evaluations: [],
      portfolioBefore: [],
      portfolioAfter: positions,
      trades: [],
      summary: {
        evaluatedTickers: 1,
        misalignedTickers: 0,
        harmonyAlignedPct: 100,
        precatVerdictAgree: 1,
        buySignals: 0,
        sellSignals: 0,
        holdSignals: 0,
        reviewSignals: 0,
        tradesExecuted: 0,
        misalignmentByType: {},
        piggyBank: {
          openCapitalEur: 60_000,
          openMtmPnlEur: openMtm,
          closedPnlEur: closed,
          totalPnlEur: roundSimPnlEur(closed + openMtm),
          openPositionCount: 12,
          closedTradeCount: 35,
        },
      },
    });

    const ticks = [
      tick("2026-06-12T08:34:00.000Z", 400, 0),
      tick("2026-06-14T12:27:00.000Z", 800, 200),
      tick("2026-06-18T20:45:00.000Z", 1246, 254),
    ];
    const series = buildDecisionSimCumulativeSeries(ticks, {
      piggyBank: {
        openCapitalEur: 60_000,
        openMtmPnlEur: -3547,
        closedPnlEur: 1246,
        totalPnlEur: -2301,
        openPositionCount: 12,
        closedTradeCount: 35,
      },
      paperPortfolio: positions,
      evaluations: [],
    });

    expect(series[series.length - 1]?.totalPnlEur).toBe(-2301);
    const hist = series.filter((p) => !p.isLive);
    const lastHist = hist[hist.length - 1]!;
    const prevHist = hist[hist.length - 2]!;
    expect(lastHist.totalPnlEur).toBeCloseTo(-2301, 0);
    expect(Math.abs(lastHist.totalPnlEur - prevHist.totalPnlEur)).toBeLessThan(4000);
    expect(Math.abs(lastHist.totalPnlEur - (-2301))).toBeLessThan(50);
  });
});

describe("looksLikeOpenMtmCatchUpCliff", () => {
  it("detects closed-only history vs negative live", () => {
    expect(looksLikeOpenMtmCatchUpCliff(2500, -2271, 2500)).toBe(true);
  });

  it("detects flat history vs deep negative live", () => {
    expect(looksLikeOpenMtmCatchUpCliff(1246, -7292, 1246)).toBe(true);
  });

  it("ignores small drift within tolerance", () => {
    expect(looksLikeOpenMtmCatchUpCliff(200, 150, 200)).toBe(false);
  });

  it("detects stale partial open MTM at last tick vs live re-mark", () => {
    expect(looksLikeOpenMtmCatchUpCliff(1500, -2301, 1246, 1246)).toBe(true);
    expect(looksLikeOpenMtmCatchUpCliff(2500, -2301, 1246, 1246)).toBe(true);
  });

  it("ignores large total gap when closed also moved (realized trades)", () => {
    expect(looksLikeOpenMtmCatchUpCliff(1500, -2301, 1246, 2100)).toBe(false);
  });
});
