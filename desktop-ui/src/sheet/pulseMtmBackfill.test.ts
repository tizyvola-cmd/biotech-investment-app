import { describe, expect, it } from "vitest";
import type { PortfolioGainChartRow } from "../components/PortfolioGainPlanChart";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import {
  buildMtmBackfillActualAnchors,
  rampStaleFlatAnchorsToLive,
  tickPulseSeriesLooksLikeCatchUpSpike,
} from "./pulseMtmBackfill";
import { buildPortfolioGainPlanAggregateSeries } from "./dashboardPulseAggregate";

function chartRow(args: Partial<PortfolioGainChartRow> & { key: string; capital: number; investedAt: string }): PortfolioGainChartRow {
  return {
    name: args.key,
    ticker: args.key.split("|")[0] ?? args.key,
    pnlEur: args.pnlEur ?? 500,
    pnlUnavailable: false,
    expectedHoldDays: 30,
    daysToTarget: 30,
    expectedGainEur: 200,
    expectedGainPct: 20,
    targetGainPct: 25,
    holdDaysElapsed: 6,
    buyPriceUsd: args.buyPriceUsd ?? 10,
    currentPriceUsd: 11,
    simRow: args.simRow ?? { "Completion Date": "2026-09-28" },
    chartPoints: args.chartPoints ?? null,
    ...args,
  };
}

describe("pulseMtmBackfill", () => {
  it("ramps stale flat anchors toward live instead of cliff at today only", () => {
    const anchors = new Map<number, number>([[3, 0]]);
    rampStaleFlatAnchorsToLive(anchors, 6, 1500);
    expect(anchors.get(0)).toBe(0);
    expect(anchors.get(3)).toBeGreaterThan(400);
    expect(anchors.get(3)).toBeLessThan(1100);
    expect(anchors.get(6)).toBeCloseTo(1500, 0);
  });

  it("detects tick series catch-up spike pattern", () => {
    expect(
      tickPulseSeriesLooksLikeCatchUpSpike(
        [
          { ts: "a", label: "d0", planned: 100, actual: 0 },
          { ts: "b", label: "d6", planned: 100, actual: 0 },
          { ts: "c", label: "now", planned: 100, actual: 1523 },
        ],
        1523,
      ),
    ).toBe(true);
  });

  it("builds gradual anchors when history stored zero open MTM", () => {
    const row = chartRow({
      key: "AAA|2026-09-28",
      capital: 5000,
      investedAt: "2026-06-12T10:00:00.000Z",
      pnlEur: 277,
      chartPoints: null,
    });
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-06-15T12:00:00.000Z",
        capital: 5000,
        value: 5000,
        pnl: 0,
        pnlPct: 0,
        byTicker: { "AAA|2026-09-28": { value: 5000, pnl: 0, pnlPct: 0 } },
      },
    ];

    const anchors = buildMtmBackfillActualAnchors(row, history, 6, 277);
    const midKey = [...anchors.keys()].find((k) => k > 0.5 && k < 5.5);
    expect(midKey).toBeDefined();
    expect(anchors.get(midKey!)).toBeGreaterThan(40);
    expect(anchors.get(6)).toBeCloseTo(277, 0);
  });

  it("aggregate chart uses hold-day backfill when tick history catch-up spikes", () => {
    const investedAt = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const midTs = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const lastTs = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const rows = [
      chartRow({
        key: "AAA|2026-09-28",
        capital: 5000,
        investedAt,
        pnlEur: 1523,
      }),
    ];
    const history: InvestSimHistoryPoint[] = [
      {
        ts: midTs,
        capital: 5000,
        value: 5000,
        pnl: 0,
        pnlPct: 0,
        byTicker: { "AAA|2026-09-28": { value: 5000, pnl: 0, pnlPct: 0 } },
      },
      {
        ts: lastTs,
        capital: 5000,
        value: 5000,
        pnl: 0,
        pnlPct: 0,
        byTicker: { "AAA|2026-09-28": { value: 5000, pnl: 0, pnlPct: 0 } },
      },
      {
        ts: new Date().toISOString(),
        capital: 5000,
        value: 6523,
        pnl: 1523,
        pnlPct: 30,
        byTicker: { "AAA|2026-09-28": { value: 6523, pnl: 1523, pnlPct: 30 } },
      },
    ];

    const series = buildPortfolioGainPlanAggregateSeries(rows, history, null, "en");
    expect(
      tickPulseSeriesLooksLikeCatchUpSpike(
        history.map((h, i) => ({
          ts: h.ts,
          label: `t${i}`,
          planned: 100,
          actual: h.pnl,
        })),
        1523,
      ),
    ).toBe(true);
    const actuals = series
      .map((p) => p.actual)
      .filter((v): v is number => v != null && Number.isFinite(v));
    expect(actuals.length).toBeGreaterThan(2);
    expect(actuals[actuals.length - 1]).toBeCloseTo(1523, 0);
    if (actuals.length >= 3) {
      const mid = actuals[Math.floor(actuals.length / 2)]!;
      expect(mid).toBeGreaterThan(50);
      expect(mid).toBeLessThan(1450);
    }
  });
});
