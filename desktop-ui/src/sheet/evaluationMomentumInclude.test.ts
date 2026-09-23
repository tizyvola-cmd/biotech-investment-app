import { describe, expect, it } from "vitest";
import type { ChartPoint, SheetTable } from "../types";
import {
  collectPastCdOffBookTickers,
  detectHighVolOffBookRescueAlerts,
  detectMomentumOpportunityAlerts,
  detectOffBookUpcomingCdAlerts,
  hasEvaluationMomentumInclude,
  isHighVolOffBookRescue,
  isOffBookUpcomingCd,
  mergeOpportunityAlertsByKey,
  resolveEvaluationWeekPct,
  tickerHasHighVol,
} from "./evaluationMomentumInclude";
import type { PortfolioLossAlert } from "./portfolioLossUrgent";

describe("evaluationMomentumInclude", () => {
  it("requires strictly positive 24h and 7d", () => {
    expect(
      hasEvaluationMomentumInclude({
        "Var. Giorn. %": 6,
        "Var. 7d %": 5.8,
      }),
    ).toBe(true);
    expect(
      hasEvaluationMomentumInclude({
        "Var. Giorn. %": 6,
        "Var. 7d %": 0,
      }),
    ).toBe(false);
    expect(
      hasEvaluationMomentumInclude({
        "Var. Giorn. %": -1,
        "Var. 7d %": 5,
      }),
    ).toBe(false);
  });

  it("accepts cont_g10 when Var. 7d % is missing (scan table parity)", () => {
    expect(
      hasEvaluationMomentumInclude({
        "Var. Giorn. %": 6,
        cont_g10: 5.8,
      }),
    ).toBe(true);
  });

  it("prefers cont_g10 over the chart 7d clamp on a past Completion Date", () => {
    // PMVP: CD already past, so the historical series ends before "now" and both
    // interpolation points clamp to the last node → chart 7d = exactly 0.
    const row = {
      Ticker: "PMVP",
      "Completion Date": "15/08/2026",
      "Var. Giorn. %": 1.56,
      cont_g10: 11.82,
    };
    const chartPts: ChartPoint[] = [
      { offset: -30, price_storico_usd: 1.3 },
      { offset: -10, price_storico_usd: 1.17 },
      { offset: -3, price_storico_usd: 1.23 },
    ];
    expect(resolveEvaluationWeekPct(row, chartPts)).toBeCloseTo(11.82);
    expect(hasEvaluationMomentumInclude(row, chartPts)).toBe(true);
  });

  it("still drops a 24h gainer whose 10-day run is negative", () => {
    expect(
      hasEvaluationMomentumInclude({
        Ticker: "ZNTL",
        "Var. Giorn. %": 1.45,
        cont_g10: -10.2,
      }),
    ).toBe(false);
  });

  it("includes off-book MSLE-like row beyond CD horizon", () => {
    const simTable: SheetTable = {
      columns: ["Ticker", "Completion Date", "Var. Giorn. %", "Var. 7d %"],
      rows: [
        {
          Ticker: "MSLE",
          "Completion Date": "15/03/2027",
          "Var. Giorn. %": 6,
          "Var. 7d %": 5.8,
        },
      ],
    };
    const alerts = detectMomentumOpportunityAlerts(simTable, {}, new Map());
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.ticker).toBe("MSLE");
  });

  it("skips in-portfolio rows", () => {
    const key = "MSLE|15/03/2027";
    const simTable: SheetTable = {
      columns: ["Ticker", "Completion Date", "Var. Giorn. %", "Var. 7d %"],
      rows: [
        {
          Ticker: "MSLE",
          "Completion Date": "15/03/2027",
          "Var. Giorn. %": 6,
          "Var. 7d %": 5.8,
        },
      ],
    };
    const alerts = detectMomentumOpportunityAlerts(
      simTable,
      { [key]: { buyPrice: 10, capital: 5000, ignoreSheet: false } },
      new Map(),
    );
    expect(alerts).toHaveLength(0);
  });

  it("mergeOpportunityAlertsByKey dedupes by key", () => {
    const a: PortfolioLossAlert = {
      key: "A|cd",
      ticker: "A",
      completionDate: "cd",
      pnlEur: 0,
      pnlPct: 0,
      capital: 5000,
      valueNow: 0,
      buyPrice: 0,
      seriesKey: null,
    };
    const b: PortfolioLossAlert = { ...a, ticker: "B" };
    const merged = mergeOpportunityAlertsByKey([a], [b]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.ticker).toBe("A");
  });
});

describe("Off Book CD + High Vol rescue", () => {
  function fmtOffset(offsetDays: number): string {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  }

  it("upcoming CD is off-book only after the 2-month hot window", () => {
    expect(isOffBookUpcomingCd(61)).toBe(true);
    expect(isOffBookUpcomingCd(90)).toBe(true);
    expect(isOffBookUpcomingCd(60)).toBe(false);
    expect(isOffBookUpcomingCd(23)).toBe(false);
    expect(isOffBookUpcomingCd(-18)).toBe(false);
  });

  it("rescues past CD only with High Vol", () => {
    expect(isHighVolOffBookRescue(-18, true)).toBe(true);
    expect(isHighVolOffBookRescue(-18, false)).toBe(false);
    expect(isHighVolOffBookRescue(23, true)).toBe(false);
    expect(isHighVolOffBookRescue(90, true)).toBe(false);
  });

  it("tickerHasHighVol follows VOL vs prev ≥ 150%", () => {
    expect(
      tickerHasHighVol("PMVP", { PMVP: { date: "d", volume: 1, prev_date: "p", prev_volume: 1, pct_of_prev: 610 } }),
    ).toBe(true);
    expect(
      tickerHasHighVol("NRIX", { NRIX: { date: "d", volume: 1, prev_date: "p", prev_volume: 1, pct_of_prev: 91 } }),
    ).toBe(false);
  });

  it("lists far CD names and High Vol past-CD rescue, not hot-zone movers", () => {
    const simTable: SheetTable = {
      columns: ["Ticker", "Completion Date"],
      rows: [
        { Ticker: "VIR", "Completion Date": fmtOffset(23) },
        { Ticker: "BIOA", "Completion Date": fmtOffset(89) },
        { Ticker: "PMVP", "Completion Date": fmtOffset(-18) },
        { Ticker: "NRIX", "Completion Date": fmtOffset(-2) },
      ],
    };
    const upcoming = detectOffBookUpcomingCdAlerts(simTable, {});
    expect(upcoming.map((a) => a.ticker).sort()).toEqual(["BIOA"]);

    const rescued = detectHighVolOffBookRescueAlerts(simTable, {}, ["PMVP"]);
    expect(rescued.map((a) => a.ticker)).toEqual(["PMVP"]);

    expect(collectPastCdOffBookTickers(simTable, {}).sort()).toEqual(["NRIX", "PMVP"]);
  });

  it("keeps Hype sidecars in Off Book even after CD (pipeline hold)", () => {
    const simTable: SheetTable = {
      columns: ["Ticker", "Completion Date"],
      rows: [
        { Ticker: "VIR", "Completion Date": fmtOffset(23) },
        {
          Ticker: "CANF",
          "Completion Date": fmtOffset(360),
          hype_volume_funnel: true,
        },
        {
          Ticker: "OLDH",
          "Completion Date": fmtOffset(-12),
          hype_volume_funnel: true,
        },
      ],
    };
    const upcoming = detectOffBookUpcomingCdAlerts(simTable, {});
    expect(upcoming.map((a) => a.ticker).sort()).toEqual(["CANF", "OLDH"]);
  });
});
