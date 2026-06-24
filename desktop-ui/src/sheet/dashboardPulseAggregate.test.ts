import { describe, expect, it } from "vitest";
import {
  alignAggregateGainPlanSeriesToLiveGap,
  buildPortfolioGainPlanAggregateSeries,
  reconcileAggregateActualTrack,
  summarizePlanGap,
} from "./dashboardPulseAggregate";
import { buildGainPlanSeries } from "../components/PortfolioGainPlanChart";
import type { PortfolioGainChartRow } from "../components/PortfolioGainPlanChart";
import type { InvestSimHistoryPoint } from "./investSimStorage";

function row(key: string, capital: number, investedAt: string): PortfolioGainChartRow {
  return {
    key,
    name: key,
    ticker: key.split("|")[0] ?? key,
    pnlEur: 100,
    pnlUnavailable: false,
    investedAt,
    expectedHoldDays: 30,
    daysToTarget: 30,
    expectedGainEur: 200,
    expectedGainPct: 20,
    targetGainPct: 25,
    holdDaysElapsed: 10,
    capital,
    currentPriceUsd: 10,
    buyPriceUsd: 8,
    simRow: { "Completion Date": "2026-07-01" },
    chartPoints: null,
  };
}

describe("buildPortfolioGainPlanAggregateSeries", () => {
  it("falls back to hold-day series when tick snapshots are flat", () => {
    const rows = [row("AAA|cd", 1000, "2026-06-01T10:00:00.000Z")];
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-06-18T08:00:00.000Z",
        capital: 1000,
        value: 1100,
        pnl: 100,
        pnlPct: 10,
        byTicker: { "AAA|cd": { value: 1100, pnl: 100, pnlPct: 10 } },
      },
      {
        ts: "2026-06-18T09:00:00.000Z",
        capital: 1000,
        value: 1100,
        pnl: 100,
        pnlPct: 10,
        byTicker: { "AAA|cd": { value: 1100, pnl: 100, pnlPct: 10 } },
      },
    ];

    const series = buildPortfolioGainPlanAggregateSeries(
      rows,
      history,
      "2026-06-18T07:00:00.000Z",
      "en",
    );

    expect(series.length).toBeGreaterThan(2);
    const plannedVals = series.map((p) => p.planned).filter((v) => v != null);
    expect(new Set(plannedVals.map((v) => Math.round(v!))).size).toBeGreaterThan(1);
    expect(series[0]?.label).toMatch(/^d\d+/);
  });

  it("falls back to hold-day series when tick actual spikes vs live MTM", () => {
    const rows = [
      {
        ...row("AAA|cd", 5000, "2026-06-01T10:00:00.000Z"),
        pnlEur: 206,
      },
    ];
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-06-18T08:00:00.000Z",
        capital: 5000,
        value: 8300,
        pnl: 3300,
        pnlPct: 66,
        byTicker: { "AAA|cd": { value: 8300, pnl: 3300, pnlPct: 66 } },
      },
      {
        ts: "2026-06-18T09:00:00.000Z",
        capital: 5000,
        value: 5206,
        pnl: 206,
        pnlPct: 4.1,
        byTicker: { "AAA|cd": { value: 5206, pnl: 206, pnlPct: 4.1 } },
      },
    ];

    const series = buildPortfolioGainPlanAggregateSeries(
      rows,
      history,
      "2026-06-18T07:00:00.000Z",
      "en",
    );

    expect(series.some((p) => p.actual === 3300)).toBe(false);
    expect(series[series.length - 1]?.actual).toBe(206);
  });
});

describe("summarizePlanGap", () => {
  it("uses planned value at hold-day today, not the last future horizon point", () => {
    const rows: PortfolioGainChartRow[] = [
      {
        key: "BDSX|cd",
        name: "BDSX",
        ticker: "BDSX",
        pnlEur: 314,
        pnlUnavailable: false,
        investedAt: "2026-06-01T10:00:00.000Z",
        expectedHoldDays: 133,
        daysToTarget: 133,
        expectedGainEur: 3000,
        expectedGainPct: 60,
        targetGainPct: 62.7,
        holdDaysElapsed: 17,
        capital: 5000,
        currentPriceUsd: 12,
        buyPriceUsd: 10,
        simRow: undefined,
        chartPoints: null,
      },
    ];
    const history: InvestSimHistoryPoint[] = [];

    const series = buildGainPlanSeries(rows[0]!, history);
    const last = series[series.length - 1]!;
    expect(last.day).toBeGreaterThan(30);
    expect(last.planned).not.toBeNull();
    expect(Math.abs((last.planned ?? 0) - 314)).toBeGreaterThan(500);

    const gap = summarizePlanGap(rows, history);
    expect(gap.actualNowEur).toBe(314);
    expect(gap.plannedNowEur).not.toBeNull();
    expect(Math.abs((gap.plannedNowEur ?? 0) - (last.planned ?? 0))).toBeGreaterThan(500);
    expect(gap.gapEur).not.toBeNull();
    expect(Math.abs(gap.gapEur!)).toBeLessThan(200);
  });

  it("uses live row MTM for actualNowEur instead of stale series interpolation", () => {
    const rows: PortfolioGainChartRow[] = [
      {
        key: "PTCT|cd",
        name: "PTCT",
        ticker: "PTCT",
        pnlEur: 706,
        pnlUnavailable: false,
        investedAt: "2026-06-01T10:00:00.000Z",
        expectedHoldDays: 30,
        daysToTarget: 30,
        expectedGainEur: 2000,
        expectedGainPct: 40,
        targetGainPct: 40,
        holdDaysElapsed: 17,
        capital: 5000,
        currentPriceUsd: 78,
        buyPriceUsd: 70,
        simRow: undefined,
        chartPoints: null,
      },
    ];
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-06-17T08:00:00.000Z",
        capital: 5000,
        value: 5300,
        pnl: 300,
        pnlPct: 6,
        byTicker: { "PTCT|cd": { value: 5300, pnl: 300, pnlPct: 6 } },
      },
    ];
    const gap = summarizePlanGap(rows, history);
    expect(gap.actualNowEur).toBe(706);
  });
});

describe("alignAggregateGainPlanSeriesToLiveGap", () => {
  it("snaps stale history terminal to live actual/planned KPI values", () => {
    const series = [
      { ts: "1", label: "Jun 17", planned: -200, actual: 120 },
      { ts: "2", label: "Jun 18", planned: -591, actual: 140 },
    ];
    const aligned = alignAggregateGainPlanSeriesToLiveGap(
      series,
      {
        plannedNowEur: -591,
        actualNowEur: 682,
        gapEur: 1273,
        gapPct: 3.9,
      },
      "en",
    );
    expect(aligned[aligned.length - 1]?.actual).toBe(682);
    expect(aligned[aligned.length - 1]?.label).toBe("now");
  });
});

describe("reconcileAggregateActualTrack", () => {
  it("ramps corrupt negative mid-series to live MTM positive", () => {
    const series = [
      { ts: "0", label: "d0", planned: -50, actual: 0 },
      { ts: "3", label: "d3", planned: -200, actual: -6993 },
      { ts: "7", label: "d7", planned: -393, actual: -4093 },
      { ts: "n", label: "d10", planned: -393, actual: -9393 },
    ];
    const out = reconcileAggregateActualTrack(series, 49346);
    expect(out[0]?.actual).toBe(0);
    expect(out[out.length - 1]?.actual).toBe(49346);
    expect(out[1]?.actual).toBeGreaterThan(0);
    expect(out[2]?.actual).toBeGreaterThan(out[1]?.actual ?? 0);
  });
});
