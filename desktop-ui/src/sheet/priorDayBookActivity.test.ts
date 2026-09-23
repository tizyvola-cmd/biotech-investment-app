import { describe, expect, it } from "vitest";
import {
  buildPriorDayBookActivity,
  priorCalendarDayKey,
} from "./priorDayBookActivity";
import type { InvestSimHistoryPoint } from "./investSimStorage";

describe("buildPriorDayBookActivity", () => {
  it("collects buys and sells for the target day", () => {
    const day = "2026-07-27";
    const act = buildPriorDayBookActivity(
      {
        "AAA|2026-08-01": {
          buyPrice: 10,
          capital: 5000,
          investedAt: "2026-07-27T15:00:00.000Z",
        },
        "BBB|2026-09-01": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          soldAt: "2026-07-27T18:00:00.000Z",
          closedCapital: 4000,
          closedPnlEur: -120,
        },
        "CCC|2026-10-01": {
          buyPrice: 5,
          capital: 3000,
          investedAt: "2026-07-26T12:00:00.000Z",
        },
      },
      day,
    );
    expect(act.buys.map((b) => b.ticker)).toEqual(["AAA"]);
    expect(act.sells.map((s) => s.ticker)).toEqual(["BBB"]);
    expect(act.sells[0]?.pnlEur).toBe(-120);
  });

  it("includes buys first seen in history that day even if investedAt is wrong", () => {
    const day = "2026-07-27";
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-07-27T16:00:00.000Z",
        byTicker: {
          "DDD|2026-11-01": { value: 2500, pnl: 0 },
        },
      },
      {
        ts: "2026-07-28T08:00:00.000Z",
        byTicker: {
          "DDD|2026-11-01": { value: 2680, pnl: 180 },
        },
      },
    ];
    const act = buildPriorDayBookActivity(
      {
        "DDD|2026-11-01": {
          buyPrice: 8,
          capital: 2500,
          // Wrong stamp (today) — history first-seen should still count as buy yesterday.
          investedAt: "2026-07-28T08:00:00.000Z",
        },
      },
      day,
      history,
    );
    expect(act.buys.map((b) => b.ticker)).toEqual(["DDD"]);
    expect(act.buys[0]?.capitalEur).toBe(2500);
    expect(act.buys[0]?.pnlEur).toBe(180);
  });


  it("lists a closed name only under Sold, even if it was bought yesterday", () => {
    const day = "2026-07-27";
    const now = new Date("2026-07-28T10:00:00");
    const act = buildPriorDayBookActivity(
      {
        "SKYE|2026-11-01": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          investedAt: "2026-07-27T14:00:00.000Z",
          soldAt: "2026-07-28T09:00:00.000Z",
          closedCapital: 4773,
          closedPnlEur: -153,
        },
        "MSLE|2026-10-01": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          investedAt: "2026-07-20T12:00:00.000Z",
          soldAt: "2026-07-27T16:00:00.000Z",
          closedCapital: 5000,
          closedPnlEur: -400,
        },
      },
      day,
      null,
      null,
      now,
    );
    expect(act.buys.map((b) => b.ticker)).toEqual([]);
    expect(act.sells.map((s) => s.ticker)).toEqual(["MSLE", "SKYE"]);
    expect(act.sells.find((s) => s.ticker === "MSLE")?.pnlEur).toBe(-400);
    expect(act.sells.find((s) => s.ticker === "SKYE")?.pnlEur).toBe(-153);
  });

  it("priorCalendarDayKey is yesterday", () => {
    const now = new Date("2026-07-28T10:00:00");
    expect(priorCalendarDayKey(now)).toBe("2026-07-27");
  });

  it("collapses JSPR + JSPRW sells into one Jasper line (prefer real PnL)", () => {
    const day = "2026-08-05";
    const now = new Date("2026-08-06T08:00:00");
    const act = buildPriorDayBookActivity(
      {
        "JSPR|2026-12-01": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          // Alias ghost: stamped as opened yesterday when common key was created.
          investedAt: "2026-08-05T12:00:00.000Z",
          soldAt: "2026-08-05T16:00:00.000Z",
          closedCapital: 2000,
          closedPnlEur: 0,
        },
        "JSPRW|2026-12-01": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          // Real warrant book — opened earlier, sold yesterday with +€120.
          investedAt: "2026-07-20T12:00:00.000Z",
          soldAt: "2026-08-05T16:05:00.000Z",
          closedCapital: 2000,
          closedPnlEur: 120,
        },
      },
      day,
      null,
      null,
      now,
    );
    expect(act.sells.map((s) => s.ticker)).toEqual(["JSPR"]);
    expect(act.sells).toHaveLength(1);
    expect(act.sells[0]?.pnlEur).toBe(120);
    expect(act.sells[0]?.capitalEur).toBe(2000);
    // Earliest open among siblings is July 20 → not a prior-day buy.
    expect(act.buys).toHaveLength(0);
  });

  it("shows one buy as JSPR when only the warrant was opened yesterday", () => {
    const day = "2026-08-05";
    const act = buildPriorDayBookActivity(
      {
        "JSPRW|2026-12-01": {
          buyPrice: 1.2,
          capital: 2000,
          investedAt: "2026-08-05T14:00:00.000Z",
        },
      },
      day,
    );
    expect(act.buys.map((b) => b.ticker)).toEqual(["JSPR"]);
    expect(act.buys[0]?.capitalEur).toBe(2000);
  });

  it("does not list a company as bought if it was also sold in the window", () => {
    const day = "2026-09-04";
    const act = buildPriorDayBookActivity(
      {
        "ZNTL|2099-06-01": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          investedAt: "2026-09-04T10:00:00.000Z",
          soldAt: "2026-09-04T16:00:00.000Z",
          closedCapital: 5000,
          closedPnlEur: -121,
        },
      },
      day,
      null,
      null,
      new Date("2026-09-05T11:00:00.000Z"),
    );
    expect(act.buys.map((b) => b.ticker)).toEqual([]);
    expect(act.sells.map((s) => s.ticker)).toEqual(["ZNTL"]);
    expect(act.sells[0]?.pnlEur).toBe(-121);
  });
});
