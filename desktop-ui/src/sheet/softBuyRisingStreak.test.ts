import { describe, expect, it } from "vitest";
import { completionDateToNowOffset } from "./chartNowOffset";
import {
  buildPriorSessionPctByTicker,
  countConsecutiveRisingSessionDays,
  softBuyRisingStreakOk,
} from "./softBuyRisingStreak";
import type { ChartPoint } from "../types";
import type { Intraday1hPayload } from "../api/supernova";

const CD = "2026-08-01";

function risingChart(yesterdayUp = true): ChartPoint[] {
  const nowOff = completionDateToNowOffset(CD);
  expect(nowOff).not.toBeNull();
  const o = nowOff!;
  return [
    { offset: o - 2, price_storico_usd: 100 },
    { offset: o - 1, price_storico_usd: yesterdayUp ? 103 : 97 },
    { offset: o, price_storico_usd: 104 },
  ];
}

describe("softBuyRisingStreak", () => {
  it("counts today + yesterday when both green", () => {
    const streak = countConsecutiveRisingSessionDays({
      row: { "Completion Date": CD, "Var. Giorn. %": 1.5 },
      chartPoints: risingChart(true),
      todayPct: 1.5,
    });
    expect(streak).toBeGreaterThanOrEqual(2);
    expect(
      softBuyRisingStreakOk({
        row: { "Completion Date": CD },
        chartPoints: risingChart(true),
        todayPct: 1.5,
      }),
    ).toBe(true);
  });

  it("stops at 1 when yesterday is red", () => {
    const streak = countConsecutiveRisingSessionDays({
      row: { "Completion Date": CD },
      chartPoints: risingChart(false),
      todayPct: 1.5,
    });
    expect(streak).toBe(1);
    expect(
      softBuyRisingStreakOk({
        row: { "Completion Date": CD },
        chartPoints: risingChart(false),
        todayPct: 1.5,
      }),
    ).toBe(false);
  });

  it("returns 0 when today is red", () => {
    expect(
      countConsecutiveRisingSessionDays({
        row: { "Completion Date": CD },
        chartPoints: risingChart(true),
        todayPct: -0.5,
      }),
    ).toBe(0);
  });

  it("does not invent a 2-day streak without prior chart prices", () => {
    expect(
      softBuyRisingStreakOk({
        row: { "Completion Date": CD, "Var. Giorn. %": 2 },
        chartPoints: null,
        todayPct: 2,
      }),
    ).toBe(false);
  });

  it("accepts Yahoo priorSessionPcts when charts are stale/flat", () => {
    const nowOff = completionDateToNowOffset(CD)!;
    const staleFlat: ChartPoint[] = [
      { offset: nowOff - 20, price_storico_usd: 100 },
      { offset: nowOff - 10, price_storico_usd: 100 },
    ];
    expect(
      softBuyRisingStreakOk({
        row: { "Completion Date": CD },
        chartPoints: staleFlat,
        todayPct: 2,
      }),
    ).toBe(false);
    expect(
      softBuyRisingStreakOk({
        row: { "Completion Date": CD },
        chartPoints: staleFlat,
        todayPct: 2,
        priorSessionPcts: [1.2],
      }),
    ).toBe(true);
  });

  it("ignores Yahoo prior when live session is missing (same-day poison)", () => {
    const poisoned: Intraday1hPayload = {
      updated_at: null,
      series: {},
      prior: {
        session_date: "2026-08-12",
        series: { BBNX: [{ t: "x", price: 17.33 }] },
        prev_close: { BBNX: 17.62 },
      },
      live: { session_date: null, series: {}, prev_close: {} },
    };
    expect(buildPriorSessionPctByTicker(poisoned).size).toBe(0);
  });

  it("keeps Yahoo prior when live is settled and prior is the day before", () => {
    const ok: Intraday1hPayload = {
      updated_at: null,
      series: {},
      prior: {
        session_date: "2026-08-11",
        series: { BBNX: [{ t: "x", price: 18.93 }] },
        prev_close: { BBNX: 17.62 },
      },
      live: {
        session_date: "2026-08-12",
        series: { BBNX: [{ t: "y", price: 17.33 }] },
        prev_close: { BBNX: 18.93 },
      },
    };
    expect(buildPriorSessionPctByTicker(ok).get("BBNX")).toBeCloseTo(7.44, 1);
  });
});
