import { describe, expect, it } from "vitest";
import {
  buildSimLoopHistoryFromTicks,
  buildSimLoopPulseAggregateSeries,
  buildSimLoopPulseData,
  buildSimLoopPulseHourlyHistory,
  mergeSimLoopPulseChartHistory,
  resolveSimLoopClosedPnlEur,
} from "./simLoopPulseView";
import { tickPulseSeriesLooksLikeCatchUpSpike } from "./pulseMtmBackfill";
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
    lastMarkPct: 2,
  };
}

function tick(
  at: string,
  positions: PaperPosition[],
  opts: { pnlPct24h?: number | null; markPct?: number } = {},
): DecisionSimTick {
  const markPct = opts.markPct ?? positions[0]?.lastMarkPct ?? 0;
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
      pnlPct24h: opts.pnlPct24h ?? null,
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

describe("buildSimLoopPulseData", () => {
  const simTable: SheetTable = {
    columns: ["Ticker", "Completion Date", "Var. Giorn. %", "Current Price"],
    rows: [
      {
        Ticker: "AAA",
        "Completion Date": "2026-09-01",
        "Var. Giorn. %": 1.2,
        "Current Price": 10,
      },
    ],
  };

  it("falls back to Var. Giorn. % when evaluation pnlPct24h is null", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const state: DecisionSimState = {
      ticks: [tick("2026-06-18T12:00:00.000Z", positions, { pnlPct24h: null })],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 100,
      closedTradeCount: 0,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
    });

    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]?.pnlPct24h).toBe(1.2);
    expect(data.rows[0]?.pnlEur24h).not.toBeNull();
    expect(data.rows[0]?.direction).toBe("up");
  });

  it("trend follows Δ visit (flat) when P&L unchanged since visit despite positive 24h", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const state: DecisionSimState = {
      ticks: [tick("2026-06-18T12:00:00.000Z", positions, { pnlPct24h: 1.2, markPct: 2 })],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 100,
      closedTradeCount: 0,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
      priorSnapshot: {
        savedAt: "2026-06-18T10:00:00.000Z",
        totalPnlEur: 100,
        tickers: { "AAA|2026-09-01": { pnlEur: 100 } },
      },
    });

    expect(data.rows[0]?.deltaPnlEurSinceVisit).toBe(0);
    expect(data.rows[0]?.pnlPct24h).toBe(1.2);
    expect(data.rows[0]?.direction).toBe("flat");
  });

  it("uses tick history for Δ visit when ticker missing from snapshot", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const state: DecisionSimState = {
      ticks: [
        tick("2026-06-17T12:00:00.000Z", positions, { markPct: 0 }),
        tick("2026-06-18T12:00:00.000Z", positions, { pnlPct24h: 1.2, markPct: 2 }),
      ],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 200,
      closedTradeCount: 0,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
      priorSnapshot: {
        savedAt: "2026-06-17T18:00:00.000Z",
        totalPnlEur: 100,
        tickers: {},
      },
    });

    expect(data.rows[0]?.deltaPnlEurSinceVisit).toBe(100);
  });

  it("ignores stale visit snapshot inflated before history merge", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const state: DecisionSimState = {
      ticks: [tick("2026-06-18T12:00:00.000Z", positions, { pnlPct24h: 1.2, markPct: 2 })],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 100,
      closedTradeCount: 0,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
      priorSnapshot: {
        savedAt: "2026-06-18T10:00:00.000Z",
        totalPnlEur: 1480,
        tickers: { "AAA|2026-09-01": { pnlEur: 1480 } },
      },
    });

    expect(data.hasPriorVisit).toBe(false);
    expect(data.deltaPnlSinceVisit).toBeNull();
  });

  it("uses entry Weight Sim Exp for open MTM, not live share after reweight", () => {
    const store = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
    const prevWindow = (globalThis as { window?: { localStorage: typeof localStorage } }).window;
    (globalThis as { window?: { localStorage: typeof localStorage } }).window = { localStorage };

    try {
      const positions = [paperPos("AAA|2026-09-01", "AAA")];
      const state: DecisionSimState = {
        ticks: [tick("2026-06-18T12:00:00.000Z", positions, { markPct: -5 })],
        paperPortfolio: positions,
        config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
        cumulativePaperPnlEur: 0,
        closedTradeCount: 0,
      };

      const synthEntry = buildSimLoopPulseData({
        state,
        simTable,
        chartPointsByKey: new Map(),
        sizing: {
          shareByRowKey: { "AAA|2026-09-01": 0.2 },
          totalCapitalEur: 10_000,
          capitalPerTrade: 5000,
        },
      });

      const synthLiveHeavy = buildSimLoopPulseData({
        state,
        simTable,
        chartPointsByKey: new Map(),
        sizing: {
          shareByRowKey: { "AAA|2026-09-01": 0.5 },
          totalCapitalEur: 10_000,
          capitalPerTrade: 5000,
        },
      });

      expect(synthEntry.totals.pnlEur).toBeCloseTo(-100, 0);
      expect(synthLiveHeavy.totals.pnlEur).toBeCloseTo(-100, 0);
    } finally {
      (globalThis as { window?: { localStorage: typeof localStorage } }).window = prevWindow;
    }
  });

  it("scales P&L with Weight Sim Exp sizing on sim loop book", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const state: DecisionSimState = {
      ticks: [tick("2026-06-18T12:00:00.000Z", positions, { markPct: 10 })],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 0,
      closedTradeCount: 0,
    };

    const equal = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
    });
    const synth = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
      sizing: {
        shareByRowKey: { "AAA|2026-09-01": 0.2 },
        totalCapitalEur: 10_000,
        capitalPerTrade: 5000,
      },
    });

    expect(equal.totals.pnlEur).toBeCloseTo(500, 0);
    expect(synth.totals.pnlEur).toBeCloseTo(200, 0);
    expect(synth.totals.capital).toBeCloseTo(2000, 0);
    expect(synth.planGap.actualNowEur).toBeCloseTo(200, 0);
    expect(synth.rows[0]?.gainPlanRow.capital).toBeCloseTo(2000, 0);
  });

  it("keeps aggregate chart P&L when ticks store zero piggy but sells realized P&L", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA", 5000)];
    const state: DecisionSimState = {
      ticks: [
        {
          ...tick("2026-06-17T10:00:00.000Z", positions, { markPct: 2 }),
          portfolioBefore: positions,
          evaluations: [],
          trades: [
            {
              at: "2026-06-17T10:00:00.000Z",
              ticker: "AAA",
              key: "AAA|2026-09-01",
              side: "sell",
              reason: "exit",
              capital: 5000,
              pnlPctSimulated: 4,
              pnlEurSimulated: 200,
            },
          ],
        },
        tick("2026-06-18T12:00:00.000Z", positions, { markPct: 2 }),
      ],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 200,
      closedTradeCount: 1,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
    });

    expect(data.history.some((h) => (h.pnl ?? 0) >= 200)).toBe(true);
    expect(data.totals.pnlEur).toBeGreaterThanOrEqual(200);
    const last = data.aggregateGainPlanSeries[data.aggregateGainPlanSeries.length - 1];
    expect(last?.actual).toBeCloseTo(data.totals.pnlEur, 0);
  });

  it("keeps row P&L € and % on the same sign (capital return)", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA", 5000)];
    const state: DecisionSimState = {
      ticks: [tick("2026-06-18T12:00:00.000Z", positions, { markPct: -1.9 })],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 0,
      closedTradeCount: 0,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
      sizing: {
        shareByRowKey: { "AAA|2026-09-01": 0.2 },
        totalCapitalEur: 50_000,
        capitalPerTrade: 5000,
      },
    });

    const row = data.rows[0];
    expect(row?.pnlEur).toBeLessThan(0);
    expect(row?.pnlPct).toBeLessThan(0);
    if (row?.planGap.gapEur != null && row.planGap.gapPct != null) {
      expect(Math.sign(row.planGap.gapEur)).toBe(Math.sign(row.planGap.gapPct));
    }
  });

  it("keeps total P&L finite when a mark pct is NaN", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const state: DecisionSimState = {
      ticks: [
        tick("2026-06-18T12:00:00.000Z", positions, {
          markPct: Number.NaN,
        }),
      ],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 0,
      closedTradeCount: 0,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
      sizing: {
        shareByRowKey: { "AAA|2026-09-01": 0.2 },
        totalCapitalEur: 10_000,
        capitalPerTrade: 5000,
      },
    });

    expect(Number.isFinite(data.totals.pnlEur)).toBe(true);
    expect(data.totals.pnlEur).toBe(0);
  });

  it("aligns sim loop pulse chart terminal to live total when early ticks store corrupt negative pnl", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const state: DecisionSimState = {
      ticks: [
        tick("2026-06-17T10:00:00.000Z", positions, { markPct: -47 }),
        tick("2026-06-18T12:00:00.000Z", positions, { markPct: 5.54 }),
      ],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 0,
      closedTradeCount: 0,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
    });

    const actuals = data.aggregateGainPlanSeries
      .map((p) => p.actual)
      .filter((v): v is number => v != null && Number.isFinite(v));
    expect(data.totals.pnlEur).toBeCloseTo(277, 0);
    expect(actuals.length).toBeGreaterThanOrEqual(2);
    expect(actuals[actuals.length - 1]).toBeCloseTo(data.totals.pnlEur, 0);
    expect(actuals.some((v) => v <= -2000)).toBe(false);
  });

  it("removes stale high tick that draws a fake crash when live total is lower", () => {
    const now = Date.now();
    const row = {
      key: "NRIX|2026-09-01",
      name: "NRIX",
      ticker: "NRIX",
      pnlEur: 93,
      pnlUnavailable: false,
      investedAt: "2026-06-01T10:00:00.000Z",
      expectedHoldDays: 30,
      daysToTarget: null,
      expectedGainEur: 100,
      expectedGainPct: 2,
      targetGainPct: 10,
      holdDaysElapsed: 5,
      capital: 5000,
      currentPriceUsd: 10,
      buyPriceUsd: null,
      simRow: {},
      chartPoints: null,
    };
    const history = [
      {
        ts: new Date(now - 5 * 3600000).toISOString(),
        capital: 45_000,
        value: 45_250,
        pnl: 250,
        pnlPct: 0.55,
        byTicker: { "NRIX|2026-09-01": { value: 5093, pnl: 93, pnlPct: 1.9 } },
      },
      {
        ts: new Date(now - 2 * 3600000).toISOString(),
        capital: 45_000,
        value: 45_277,
        pnl: 277,
        pnlPct: 0.6,
        byTicker: { "NRIX|2026-09-01": { value: 5093, pnl: 93, pnlPct: 1.9 } },
      },
    ];
    const series = buildSimLoopPulseAggregateSeries(
      [row],
      history,
      277,
      { plannedNowEur: 153, actualNowEur: 277, gapEur: 124, gapPct: 0.3 },
      new Date(now - 1 * 3600000).toISOString(),
      "en",
    );
    const actuals = series
      .map((p) => p.actual)
      .filter((v): v is number => v != null && Number.isFinite(v));
    expect(actuals.length).toBeGreaterThanOrEqual(2);
    expect(actuals.every((v) => v <= 350)).toBe(true);
    expect(actuals[actuals.length - 1]).toBeCloseTo(277, 0);
  });

  it("uses synth-scaled open MTM in tick history (not equal-weight piggy)", () => {
    const positions = [
      {
        ...paperPos("AAA|2026-09-01", "AAA", 5000),
        lastMarkPct: 10,
      },
    ];
    const ticks: DecisionSimTick[] = [
      {
        ...tick("2026-06-12T10:00:00.000Z", positions, { markPct: 10 }),
        evaluations: [],
      },
    ];

    const sizing = {
      shareByRowKey: { "AAA|2026-09-01": 0.2 },
      totalCapitalEur: 10_000,
      capitalPerTrade: 5000,
    };

    const history = buildSimLoopHistoryFromTicks(ticks, sizing, {
      "AAA|2026-09-01": 0.2,
    });
    expect(history).toHaveLength(1);
    // synth cap 2000 × 10% = 200 (equal-weight would be 5000 × 10% = 500)
    expect(history[0]?.pnl).toBe(200);
  });

  it("detects closed-only tick climb as catch-up spike for pulse fallback", () => {
    const points = [
      { ts: "2026-06-12", label: "Jun 12", planned: 100, actual: 800 },
      { ts: "2026-06-16", label: "Jun 16", planned: 150, actual: 1800 },
      { ts: "2026-06-18", label: "Jun 18", planned: 179, actual: 2500 },
    ];
    expect(tickPulseSeriesLooksLikeCatchUpSpike(points, -2271)).toBe(true);
  });

  it("keeps plan dashed line aligned with KPI plannedNowEur (flat reference)", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const state: DecisionSimState = {
      ticks: [
        tick("2026-06-17T10:00:00.000Z", positions, { markPct: 2 }),
        tick("2026-06-18T12:00:00.000Z", positions, { markPct: 5.54 }),
      ],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 0,
      closedTradeCount: 0,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
    });

    const plannedKpi = data.planGap.plannedNowEur;
    expect(plannedKpi).not.toBeNull();
    for (const pt of data.aggregateGainPlanSeries) {
      if (pt.planned != null) {
        expect(pt.planned).toBeCloseTo(plannedKpi!, 0);
      }
    }
  });

  it("plots tick history even when Δ visit total is near zero (no flat chart shortcut)", () => {
    const now = Date.now();
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const state: DecisionSimState = {
      ticks: [
        tick(new Date(now - 20 * 3600000).toISOString(), positions, { markPct: -2 }),
        tick(new Date(now - 8 * 3600000).toISOString(), positions, { markPct: 2 }),
      ],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 100,
      closedTradeCount: 0,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
      priorSnapshot: {
        savedAt: new Date(now - 6 * 3600000).toISOString(),
        totalPnlEur: 100,
        tickers: { "AAA|2026-09-01": { pnlEur: 100 } },
      },
    });

    expect(data.deltaPnlSinceVisit).toBe(0);
    const actuals = data.aggregateGainPlanSeries
      .map((p) => p.actual)
      .filter((v): v is number => v != null && Number.isFinite(v));
    expect(actuals.length).toBeGreaterThanOrEqual(2);
    expect(new Set(actuals).size).toBeGreaterThan(1);
  });

  it("aggregate chart uses hold-day axis aligned with portfolio pulse", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const state: DecisionSimState = {
      ticks: [tick("2026-06-18T12:00:00.000Z", positions, { markPct: 5.54 })],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 0,
      closedTradeCount: 0,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
    });

    expect(data.aggregateGainPlanSeries.length).toBeGreaterThanOrEqual(2);
    const labels = data.aggregateGainPlanSeries.map((p) => p.label);
    expect(labels.some((l) => /^[dg]\d+/.test(l) || l === "now" || l === "ora")).toBe(true);
  });

  it("scales closed P&L with entry share, not current winner-heavy share", () => {
    const loserKey = "LOSER|2026-09-01";
    const winnerKey = "WIN|2026-09-01";
    const positions = [paperPos(winnerKey, "WIN", 5000)];
    const state: DecisionSimState = {
      ticks: [
        {
          ...tick("2026-06-17T10:00:00.000Z", positions, { markPct: 10 }),
          portfolioBefore: [paperPos(loserKey, "LOSER", 5000), ...positions],
          evaluations: [],
          trades: [
            {
              at: "2026-06-17T10:00:00.000Z",
              ticker: "LOSER",
              key: loserKey,
              side: "sell",
              reason: "exit",
              capital: 5000,
              pnlPctSimulated: -10,
              pnlEurSimulated: -500,
            },
          ],
        },
        tick("2026-06-18T12:00:00.000Z", positions, { markPct: 10 }),
      ],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 0,
      closedTradeCount: 1,
    };

    const entryShares = { [loserKey]: 0.1, [winnerKey]: 0.1 };
    const sizing = {
      shareByRowKey: { [loserKey]: 0.02, [winnerKey]: 0.25 },
      totalCapitalEur: 10_000,
      capitalPerTrade: 5000,
    };

    const withCurrentShareOnly = resolveSimLoopClosedPnlEur(state.ticks, sizing, {});
    const withEntryShare = resolveSimLoopClosedPnlEur(state.ticks, sizing, entryShares);

    // equal loss -500 → entry 10% of 10k = 1k cap → -100; current 2% share would be -20
    expect(withEntryShare).toBeCloseTo(-100, 0);
    expect(withCurrentShareOnly).toBeCloseTo(-20, 0);
    expect(withEntryShare).not.toBeCloseTo(withCurrentShareOnly, 0);
  });

  it("exposes equal-weight reference totals on synth pulse data", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const state: DecisionSimState = {
      ticks: [tick("2026-06-18T12:00:00.000Z", positions, { markPct: 10 })],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 0,
      closedTradeCount: 0,
    };

    const synth = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
      sizing: {
        shareByRowKey: { "AAA|2026-09-01": 0.2 },
        totalCapitalEur: 10_000,
        capitalPerTrade: 5000,
      },
    });

    expect(synth.equalReferenceTotals?.pnlEur).toBeCloseTo(500, 0);
    expect(synth.totals.pnlEur).toBeCloseTo(200, 0);
  });

  it("uses piggy open MTM on compact ticks when evaluations were stripped", () => {
    const positions = [
      {
        ...paperPos("AAA|2026-09-01", "AAA", 5000),
        lastMarkPct: 0,
      },
    ];
    const ticks: DecisionSimTick[] = [
      {
        ...tick("2026-06-18T12:00:00.000Z", positions, { markPct: 0 }),
        evaluations: [],
        summary: {
          buySignals: 0,
          sellSignals: 0,
          holdSignals: 0,
          reviewSignals: 0,
          tradesExecuted: 0,
          piggyBank: {
            openCapitalEur: 5000,
            openMtmPnlEur: -500,
            closedPnlEur: 200,
            totalPnlEur: -300,
            openPositionCount: 1,
            closedTradeCount: 1,
          },
        },
      },
    ];

    const history = buildSimLoopHistoryFromTicks(ticks);
    expect(history).toHaveLength(1);
    expect(history[0]?.closedPnlEur).toBeCloseTo(200, 0);
    expect(history[0]?.pnl).toBeCloseTo(-300, 0);
  });

  it("ramps pulse chart when tick history is closed-only but live includes open MTM", () => {
    const positions = [paperPos("AAA|2026-09-01", "AAA")];
    const histTick = (
      at: string,
      closedPnlEur: number,
      openMtmPnlEur: number,
    ): DecisionSimTick => ({
      ...tick(at, positions, { markPct: 0 }),
      evaluations: [],
      trades: [],
      summary: {
        buySignals: 0,
        sellSignals: 0,
        holdSignals: 0,
        reviewSignals: 0,
        tradesExecuted: 0,
        piggyBank: {
          openCapitalEur: 5000,
          openMtmPnlEur: 0,
          closedPnlEur,
          totalPnlEur: 0,
          openPositionCount: 1,
          closedTradeCount: 1,
        },
      },
    });

    const state: DecisionSimState = {
      ticks: [
        histTick("2026-06-12T10:00:00.000Z", 400, 0),
        histTick("2026-06-16T10:00:00.000Z", 1200, 0),
        histTick("2026-06-18T10:00:00.000Z", 1246, 0),
        tick("2026-06-18T12:00:00.000Z", positions, { markPct: -70 }),
      ],
      paperPortfolio: positions,
      config: { capitalPerTrade: 5000, maxOpenPositions: 12 },
      cumulativePaperPnlEur: 1246,
      closedTradeCount: 1,
    };

    const data = buildSimLoopPulseData({
      state,
      simTable,
      chartPointsByKey: new Map(),
    });

    expect(data.totals.pnlEur).toBeLessThan(0);
    const actuals = data.aggregateGainPlanSeries
      .map((p) => p.actual)
      .filter((v): v is number => v != null && Number.isFinite(v));
    expect(actuals.length).toBeGreaterThanOrEqual(2);
    expect(actuals[actuals.length - 1]).toBeCloseTo(data.totals.pnlEur, 0);
    const maxStep = actuals
      .slice(1)
      .reduce((m, v, i) => Math.max(m, Math.abs(v - (actuals[i] ?? v))), 0);
    expect(maxStep).toBeLessThan(2500);
  });
});

describe("sim loop pulse 24h hourly history", () => {
  const pos = paperPos("AAA|2026-09-01", "AAA");

  it("builds hourly points from portfolio snapshots for paper keys", () => {
    const now = Date.now();
    const portfolioHistory = [0, 6, 12, 18].map((hAgo) => {
      const ts = new Date(now - hAgo * 3600000).toISOString();
      const pct = 2 + hAgo * 0.5;
      return {
        ts,
        capital: 5000,
        value: 5000 + (5000 * pct) / 100,
        pnl: (5000 * pct) / 100,
        pnlPct: pct,
        byTicker: {
          "AAA|2026-09-01": {
            value: 5000 + (5000 * pct) / 100,
            pnl: (5000 * pct) / 100,
            pnlPct: pct,
          },
        },
      };
    });

    const hourly = buildSimLoopPulseHourlyHistory(portfolioHistory, [], [pos]);
    expect(hourly.length).toBe(4);
    expect(hourly[3]!.pnl).toBeLessThan(hourly[0]!.pnl ?? 0);
  });

  it("prefers hourly over sparse ticks for pulse chart", () => {
    const now = Date.now();
    const portfolioHistory = Array.from({ length: 8 }, (_, i) => {
      const ts = new Date(now - (7 - i) * 3 * 3600000).toISOString();
      const pct = i;
      return {
        ts,
        capital: 5000,
        value: 5000 + 50 * i,
        pnl: 50 * i,
        pnlPct: pct,
        byTicker: {
          "AAA|2026-09-01": { value: 5000 + 50 * i, pnl: 50 * i, pnlPct: pct },
        },
      };
    });
    const tickHistory = buildSimLoopHistoryFromTicks([
      tick(new Date(now - 20 * 3600000).toISOString(), [pos]),
      tick(new Date(now - 1 * 3600000).toISOString(), [pos], { markPct: 7 }),
    ]);
    const merged = mergeSimLoopPulseChartHistory(tickHistory, buildSimLoopPulseHourlyHistory(portfolioHistory, [], [pos]));
    expect(merged.length).toBeGreaterThanOrEqual(6);
  });
});
