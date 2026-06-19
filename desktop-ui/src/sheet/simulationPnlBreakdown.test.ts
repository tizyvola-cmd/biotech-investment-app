import { describe, expect, it } from "vitest";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import {
  resolvePositionPnlBreakdown,
  sumPnlFromDailyCloseSeries,
  tickerDailyCloseSeries,
} from "./simulationPosition";

describe("P&L tab breakdown", () => {
  it("without prior closes: total equals today from sheet Var%", () => {
    const pos = {
      key: "BNTX|2026-07-13",
      valueNow: 5066.53,
      pnlEur: 66.53,
      pnlPct: 1.33,
      pnlUnavailable: false,
      buyPrice: 90.93,
      capital: 5000,
    };
    const row = {
      Ticker: "BNTX",
      "Completion Date": "13/07/2026",
      "Prezzo Corrente ($)": 92.14,
      "Var. Giorn. %": 4.24,
    };
    const b = resolvePositionPnlBreakdown(
      pos,
      row,
      "2026-05-27T10:00:00.000Z",
      [],
    );
    expect(b.totalSource).toBe("daily_close_sum");
    expect(b.priorLegEur).toBe(0);
    expect(b.pnlEurToday).toBeCloseTo(206.2, 0);
    expect(b.totalEur).toBeCloseTo(b.pnlEurToday ?? 0, 0);
  });

  it("with prior close: total = prior legs + today (no fictitious entry lump)", () => {
    const key = "BNTX|2026-07-13";
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-06-03T16:00:00.000Z",
        capital: 35000,
        value: 34000,
        pnl: -1000,
        pnlPct: -2.86,
        byTicker: { [key]: { value: 4860.33, pnl: -139.67, pnlPct: -2.79 } },
      },
    ];
    const pos = {
      key,
      valueNow: 5066.53,
      pnlEur: 66.53,
      pnlPct: 1.33,
      pnlUnavailable: false,
      buyPrice: 90.93,
      capital: 5000,
    };
    const b = resolvePositionPnlBreakdown(
      pos,
      { "Var. Giorn. %": 4.24 },
      "2026-05-27T10:00:00.000Z",
      history,
    );
    expect(b.priorLegEur).toBe(0);
    expect(b.pnlEurToday).toBeCloseTo(206.2, 0);
    expect(b.totalEur).toBeCloseTo(206.2, 0);
  });

  it("sums consecutive prior closes before today", () => {
    const key = "BNTX|2026-07-13";
    const series = tickerDailyCloseSeries(
      [
        {
          ts: "2026-05-27T16:00:00.000Z",
          capital: 5000,
          value: 5000,
          pnl: 0,
          pnlPct: 0,
          byTicker: { [key]: { value: 5000, pnl: 0, pnlPct: 0 } },
        },
        {
          ts: "2026-05-28T16:00:00.000Z",
          capital: 5000,
          value: 4860,
          pnl: -140,
          pnlPct: -2.8,
          byTicker: { [key]: { value: 4860, pnl: -140, pnlPct: -2.8 } },
        },
        {
          ts: "2026-06-03T16:00:00.000Z",
          capital: 5000,
          value: 4900,
          pnl: -100,
          pnlPct: -2,
          byTicker: { [key]: { value: 4900, pnl: -100, pnlPct: -2 } },
        },
      ],
      key,
      "2026-05-27T10:00:00.000Z",
    );
    const summed = sumPnlFromDailyCloseSeries(5000, 5066.53, series, {
      investDayKey: "2026-05-27",
    });
    expect(summed.priorLegEur).toBeCloseTo(-100, 0);
    expect(summed.pnlEurToday).toBeCloseTo(166.53, 0);
    expect(summed.totalEur).toBeCloseTo(66.53, 0);
  });

  it("today uses Var% when history close matches valueNow (stale mark)", () => {
    const key = "BCAB|2026-06-30";
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-06-04T16:00:00.000Z",
        capital: 5000,
        value: 5419.83,
        pnl: 419.83,
        pnlPct: 8.4,
        byTicker: { [key]: { value: 5419.83, pnl: 419.83, pnlPct: 8.4 } },
      },
    ];
    const summed = sumPnlFromDailyCloseSeries(5000, 5419.83, tickerDailyCloseSeries(
      history,
      key,
      "2026-05-28T10:00:00.000Z",
    ), {
      investDayKey: "2026-05-28",
      dailyPct: 2.07,
    });
    expect(summed.pnlEurToday).toBeCloseTo(110.1, 0);
    expect(summed.todayFromSheet).toBe(true);
  });

  it("today equals total on entry day", () => {
    const pos = {
      key: "CCCC|2026-09-30",
      valueNow: 5056.36,
      pnlEur: 56.36,
      pnlPct: 1.14,
      pnlUnavailable: false,
      buyPrice: 3.52,
      capital: 5000,
    };
    const b = resolvePositionPnlBreakdown(pos, {}, new Date().toISOString(), []);
    expect(b.todaySource).toBe("entry_today");
    expect(b.pnlEurToday).toBeCloseTo(b.totalEur, 0);
    expect(b.dailyLegCount).toBe(1);
  });
});

describe("position reading delta", () => {
  it("computes delta vs prior snapshot with different value", async () => {
    const { computePositionReadingDelta } = await import("./simulationPosition");
    const key = "CRDF|2026-06-30";
    const history = [
      {
        ts: "2026-06-10T08:00:00.000Z",
        capital: 5000,
        value: 4800,
        pnl: -200,
        pnlPct: -4,
        byTicker: { [key]: { value: 4600, pnl: -400, pnlPct: -8 } },
      },
      {
        ts: "2026-06-10T16:00:00.000Z",
        capital: 5000,
        value: 4900,
        pnl: -100,
        pnlPct: -2,
        byTicker: { [key]: { value: 4700, pnl: -300, pnlPct: -6 } },
      },
    ];
    const delta = computePositionReadingDelta(4750, history, key);
    expect(delta).not.toBeNull();
    expect(delta!.pnlEur).toBe(50);
    expect(delta!.pnlPct).toBeCloseTo(1.06, 1);
  });
});

describe("invest sim history merge", () => {
  it("merges by calendar day keeping the latest snapshot", async () => {
    const { mergeInvestSimHistoryPoints } = await import("./investSimStorage");
    const key = "BCAB|2026-06-30";
    const local = [
      {
        ts: "2026-06-03T10:00:00.000Z",
        capital: 5000,
        value: 5100,
        pnl: 100,
        pnlPct: 2,
        byTicker: { [key]: { value: 5100, pnl: 100, pnlPct: 2 } },
      },
    ];
    const disk = [
      {
        ts: "2026-06-04T16:00:00.000Z",
        capital: 5000,
        value: 5200,
        pnl: 200,
        pnlPct: 4,
        byTicker: { [key]: { value: 5200, pnl: 200, pnlPct: 4 } },
      },
      {
        ts: "2026-06-03T18:00:00.000Z",
        capital: 5000,
        value: 5050,
        pnl: 50,
        pnlPct: 1,
        byTicker: { [key]: { value: 5050, pnl: 50, pnlPct: 1 } },
      },
    ];
    const merged = mergeInvestSimHistoryPoints(local, disk);
    expect(merged).toHaveLength(2);
    expect(merged[0].value).toBe(5050);
    expect(merged[1].value).toBe(5200);
  });

  it("merges byTicker within the same calendar day", async () => {
    const { mergeInvestSimHistoryPoints } = await import("./investSimStorage");
    const aKey = "BCAB|2026-06-30";
    const bKey = "BNTX|2026-06-30";
    const morning = [
      {
        ts: "2026-06-03T10:00:00.000Z",
        capital: 5000,
        value: 5100,
        pnl: 100,
        pnlPct: 2,
        byTicker: { [aKey]: { value: 5100, pnl: 100, pnlPct: 2 } },
      },
    ];
    const evening = [
      {
        ts: "2026-06-03T18:00:00.000Z",
        capital: 10000,
        value: 10200,
        pnl: 200,
        pnlPct: 2,
        byTicker: { [bKey]: { value: 5100, pnl: 100, pnlPct: 2 } },
      },
    ];
    const merged = mergeInvestSimHistoryPoints(morning, evening);
    expect(merged).toHaveLength(1);
    expect(merged[0].byTicker[aKey]?.value).toBe(5100);
    expect(merged[0].byTicker[bKey]?.value).toBe(5100);
  });
});
