import { describe, expect, it } from "vitest";
import {
  buildHomePortfolioPnlHistorySeries,
  buildHomeTickerEquityCurve,
  compressHomeSeriesByDay,
  cumulativeClosedPnlAt,
  filterHomeSeriesByRange,
  homePnlHistoryCutoffIso,
  listHomeInvestedTickers,
  summarizeHomePortfolioPnlCurve,
  toHomePortfolioBreakevenPlot,
  alignInvestSimHistoryToSessionAxis,
  withLiveHomePortfolioHistoryTip,
} from "./homePortfolioPnlHistory";
import { nySessionCloseIso } from "./marketSession";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import type { SheetTable } from "../types";

describe("cumulativeClosedPnlAt", () => {
  it("sums only sells completed by the cutoff", () => {
    const inputs: InvestSimInputs = {
      "AAA|2026-01-01": {
        buyPrice: 1,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-10T12:00:00.000Z",
        closedPnlEur: 100,
      },
      "BBB|2026-02-01": {
        buyPrice: 1,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-15T12:00:00.000Z",
        closedPnlEur: -40,
      },
    };
    expect(cumulativeClosedPnlAt(inputs, Date.parse("2026-07-10T23:59:59.000Z"))).toBe(100);
    expect(cumulativeClosedPnlAt(inputs, Date.parse("2026-07-15T23:59:59.000Z"))).toBe(60);
  });
});

describe("withLiveHomePortfolioHistoryTip", () => {
  const key = "VIR|2026-08-01";
  const inputs: InvestSimInputs = {
    [key]: { buyPrice: 10, capital: 5000, investedAt: "2026-07-01T10:00:00.000Z" },
  };
  const simTable = {
    name: "Simulation",
    columns: ["Ticker", "Completion Date", "Prezzo Acquisto ($)", "Capitale Investito ($)", "Prezzo Corrente ($)"],
    rows: [
      {
        Ticker: "VIR",
        "Completion Date": "2026-08-01",
        "Prezzo Acquisto ($)": 10,
        "Capitale Investito ($)": 5000,
        "Prezzo Corrente ($)": 11,
      },
    ],
  } as unknown as SheetTable;

  it("appends a live tip when last history day is older than today", () => {
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-07-21T16:00:00.000Z",
        capital: 5000,
        value: 5200,
        pnl: 200,
        pnlPct: 4,
        byTicker: { [key]: { value: 5200, pnl: 200, pnlPct: 4 } },
      },
    ];
    // Thursday NY — trading day, tip uses wall clock.
    const now = new Date("2026-07-23T14:00:00.000Z");
    const out = withLiveHomePortfolioHistoryTip(history, inputs, simTable, now);
    expect(out).toHaveLength(2);
    expect(out[0]!.ts).toBe("2026-07-21T16:00:00.000Z");
    expect(out[1]!.ts).toBe(now.toISOString());
    expect(out[1]!.pnl).toBe(500); // 5500 − 5000
    expect(out[1]!.byTicker?.[key]?.pnl).toBe(500);
  });

  it("replaces same-day last snapshot with live marks", () => {
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-07-23T10:00:00.000Z",
        capital: 5000,
        value: 5100,
        pnl: 100,
        pnlPct: 2,
        byTicker: { [key]: { value: 5100, pnl: 100, pnlPct: 2 } },
      },
    ];
    const now = new Date("2026-07-23T16:00:00.000Z");
    const out = withLiveHomePortfolioHistoryTip(history, inputs, simTable, now);
    expect(out).toHaveLength(1);
    expect(out[0]!.ts).toBe(now.toISOString());
    expect(out[0]!.pnl).toBe(500);
  });

  it("Sunday tip stamps last Friday close — not a phantom weekend session", () => {
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-08-07T20:00:00.000Z",
        capital: 5000,
        value: 5100,
        pnl: 100,
        pnlPct: 2,
        byTicker: { [key]: { value: 5100, pnl: 100, pnlPct: 2 } },
      },
    ];
    const sun = new Date("2026-08-09T09:56:30.000Z");
    const out = withLiveHomePortfolioHistoryTip(history, inputs, simTable, sun);
    expect(out).toHaveLength(1);
    expect(out[0]!.ts).toBe(nySessionCloseIso("2026-08-07"));
    expect(out[0]!.pnl).toBe(500);
  });

  it("alignInvestSimHistoryToSessionAxis coalesces Sat/Sun wall stamps onto Friday", () => {
    const aligned = alignInvestSimHistoryToSessionAxis([
      {
        ts: "2026-08-08T06:49:19.024Z", // Sat
        capital: 100,
        value: 100,
        pnl: 0,
        pnlPct: 0,
      },
      {
        ts: "2026-08-09T09:56:30.076Z", // Sun
        capital: 21606,
        value: 22610,
        pnl: 1004,
        pnlPct: 4.6,
      },
    ]);
    expect(aligned).toHaveLength(1);
    expect(aligned[0]!.ts).toBe(nySessionCloseIso("2026-08-07"));
    expect(aligned[0]!.pnl).toBe(1004);
  });
});

describe("buildHomePortfolioPnlHistorySeries", () => {
  it("builds day series with open + closed lifetime P&L", () => {
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-07-10T16:00:00.000Z",
        capital: 5000,
        value: 5200,
        pnl: 200,
        pnlPct: 4,
        byTicker: {},
      },
      {
        ts: "2026-07-15T16:00:00.000Z",
        capital: 3000,
        value: 2950,
        pnl: -50,
        pnlPct: -1.67,
        byTicker: {},
      },
    ];
    const inputs: InvestSimInputs = {
      "AAA|2026-01-01": {
        buyPrice: 1,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-12T10:00:00.000Z",
        closedPnlEur: 150,
      },
    };
    const rows = buildHomePortfolioPnlHistorySeries(history, inputs, "en");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.pnlClosed).toBe(0);
    expect(rows[0]!.pnlTotal).toBe(200);
    expect(rows[1]!.pnlClosed).toBe(150);
    expect(rows[1]!.pnlTotal).toBe(100);
    expect(rows[1]!.capital).toBe(3000);
  });
});

describe("summarizeHomePortfolioPnlCurve", () => {
  it("reports peak, drawdown, breakeven day, and left-on-table", () => {
    const stats = summarizeHomePortfolioPnlCurve([
      { day: "1 May", pnlTotal: 0 },
      { day: "10 May", pnlTotal: -200 },
      { day: "20 May", pnlTotal: 50 },
      { day: "1 Jun", pnlTotal: 400 },
      { day: "10 Jun", pnlTotal: 300 },
    ]);
    expect(stats).toEqual({
      peakPnl: 400,
      troughPnl: -200,
      maxDrawdown: -200,
      breakevenDay: "20 May",
      leftOnTable: 100,
    });
  });
});

describe("toHomePortfolioBreakevenPlot", () => {
  it("seeds at −invested capital then tracks open P&L (gain on capital)", () => {
    const rows = [
      {
        day: "1 Jun",
        ts: "2026-06-01T16:00:00.000Z",
        capital: 46807,
        pnlOpen: 0,
        pnlClosed: 0,
        pnlTotal: 0,
      },
      {
        day: "23 Jun",
        ts: "2026-06-23T16:00:00.000Z",
        capital: 46807,
        pnlOpen: 4219,
        pnlClosed: 0,
        pnlTotal: 4219,
      },
    ];
    const plot = toHomePortfolioBreakevenPlot(rows, "open", "en");
    expect(plot[0]!.day).toBe("Entry");
    expect(plot[0]!.pnlPlot).toBe(-46807);
    expect(plot[0]!.ts).not.toBe(rows[0]!.ts);
    expect(plot[1]!.pnlPlot).toBe(0);
    expect(plot[2]!.pnlPlot).toBe(4219);
    expect(plot[2]!.capital).toBe(46807);
  });
});

describe("buildHomeTickerEquityCurve", () => {
  it("starts at −capital then climbs with daily P&L past breakeven", () => {
    const key = "VIR|2026-08-01";
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-07-01T16:00:00.000Z",
        capital: 5000,
        value: 5000,
        pnl: 0,
        pnlPct: 0,
        byTicker: { [key]: { value: 5000, pnl: 0, pnlPct: 0 } },
      },
      {
        ts: "2026-07-05T16:00:00.000Z",
        capital: 5000,
        value: 4800,
        pnl: -200,
        pnlPct: -4,
        byTicker: { [key]: { value: 4800, pnl: -200, pnlPct: -4 } },
      },
      {
        ts: "2026-07-10T16:00:00.000Z",
        capital: 5000,
        value: 5600,
        pnl: 600,
        pnlPct: 12,
        byTicker: { [key]: { value: 5600, pnl: 600, pnlPct: 12 } },
      },
    ];
    const inputs: InvestSimInputs = {
      [key]: {
        buyPrice: 10,
        capital: 5000,
        investedAt: "2026-07-01T10:00:00.000Z",
      },
    };
    const rows = buildHomeTickerEquityCurve(history, inputs, key, "en");
    expect(rows[0]!.day).toBe("Entry");
    expect(rows[0]!.equity).toBe(-5000);
    expect(rows.some((r) => r.equity === -200)).toBe(true);
    expect(rows[rows.length - 1]!.equity).toBe(600);
  });
});

describe("listHomeInvestedTickers", () => {
  it("lists open and closed positions", () => {
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-07-10T16:00:00.000Z",
        capital: 5000,
        value: 5100,
        pnl: 100,
        pnlPct: 2,
        byTicker: {
          "OPEN|2026-08-01": { value: 5100, pnl: 100, pnlPct: 2 },
        },
      },
    ];
    const inputs: InvestSimInputs = {
      "OPEN|2026-08-01": { buyPrice: 1, capital: 5000 },
      "GONE|2026-07-01": {
        buyPrice: 1,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-05T12:00:00.000Z",
        closedCapital: 2000,
        closedPnlEur: 150,
      },
    };
    const list = listHomeInvestedTickers(history, inputs, {
      liveOpenKeys: ["OPEN|2026-08-01"],
    });
    expect(list.map((t) => t.ticker)).toEqual(["OPEN", "GONE"]);
    expect(list[0]!.status).toBe("open");
    expect(list[1]!.status).toBe("closed");
  });

  it("marks stale capital (not on live sheet) as closed — GPCR/CPIX ghost case", () => {
    const history: InvestSimHistoryPoint[] = [];
    const inputs: InvestSimInputs = {
      "BIIB|2026-08-01": { buyPrice: 200, capital: 4000 },
      "GPCR|2026-09-01": { buyPrice: 10, capital: 2000 }, // leftover capital, not live
      "CPIX|2026-07-01": {
        buyPrice: 1,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-01T12:00:00.000Z",
        closedPnlEur: -473,
        closedCapital: 3000,
      },
    };
    const list = listHomeInvestedTickers(history, inputs, {
      liveOpenKeys: ["BIIB|2026-08-01"],
    });
    expect(list.find((t) => t.ticker === "BIIB")?.status).toBe("open");
    expect(list.find((t) => t.ticker === "GPCR")?.status).toBe("closed");
    expect(list.find((t) => t.ticker === "CPIX")?.status).toBe("closed");
  });
});

describe("filterHomeSeriesByRange", () => {
  const now = new Date("2026-07-20T18:00:00.000Z");

  it("returns full series for all", () => {
    const rows = [
      { ts: "2026-07-01T12:00:00.000Z", v: 1 },
      { ts: "2026-07-20T12:00:00.000Z", v: 2 },
    ];
    expect(filterHomeSeriesByRange(rows, "all", now)).toHaveLength(2);
    expect(homePnlHistoryCutoffIso("all", now)).toBeNull();
  });

  it("keeps the last 7 days and pads toward min points", () => {
    const rows = [
      { ts: "2026-07-01T12:00:00.000Z", v: 1, day: "1 Jul" },
      { ts: "2026-07-14T12:00:00.000Z", v: 2, day: "14 Jul" },
      { ts: "2026-07-18T12:00:00.000Z", v: 3, day: "18 Jul" },
      { ts: "2026-07-20T12:00:00.000Z", v: 4, day: "20 Jul" },
    ];
    const sliced = filterHomeSeriesByRange(rows, "7d", now);
    // Cutoff ≈ 13 Jul + pad toward min 6 when earlier history exists.
    expect(sliced.map((r) => r.v)).toEqual([1, 2, 3, 4]);
  });

  it("pads sparse 24h windows with prior marks so a curve can draw", () => {
    const rows = [
      { ts: "2026-07-16T12:00:00.000Z", v: 0, day: "16 Jul" },
      { ts: "2026-07-17T12:00:00.000Z", v: 1, day: "17 Jul" },
      { ts: "2026-07-18T12:00:00.000Z", v: 2, day: "18 Jul" },
      { ts: "2026-07-19T16:00:00.000Z", v: 3, day: "19 Jul" },
      { ts: "2026-07-20T12:00:00.000Z", v: 4, day: "20 Jul" },
    ];
    const sliced = filterHomeSeriesByRange(rows, "24h", now);
    // In-window ≈ 20 Jul + anchor 19 Jul (min 2 — keep 24h tight).
    expect(sliced.map((r) => r.v)).toEqual([3, 4]);
    expect(sliced.length).toBeGreaterThanOrEqual(2);
  });

  it("omits Entry seed on short-range breakeven plots", () => {
    const rows = [
      {
        day: "20 Jul",
        ts: "2026-07-20T12:00:00.000Z",
        capital: 1000,
        pnlOpen: 50,
        pnlClosed: 0,
        pnlTotal: 50,
      },
    ];
    const plot = toHomePortfolioBreakevenPlot(rows, "open", "en", 0, {
      includeEntrySeed: false,
    });
    expect(plot).toHaveLength(1);
    expect(plot[0]!.pnlPlot).toBe(50);
  });

  it("does not use Entry seed as the 24h anchor when a real pre-window mark exists", () => {
    const rows = [
      { ts: "2026-06-01T10:00:00.000Z", v: -5000, day: "Entry" },
      { ts: "2026-07-19T16:00:00.000Z", v: 50, day: "19 Jul" },
      { ts: "2026-07-20T12:00:00.000Z", v: 108, day: "20 Jul" },
    ];
    const sliced = filterHomeSeriesByRange(rows, "24h", now);
    expect(sliced.map((r) => r.v)).toEqual([50, 108]);
  });

  it("keeps Entry as left edge when only one MTM tick is inside 24h", () => {
    const rows = [
      { ts: "2026-07-19T18:00:00.000Z", v: -2000, day: "Entry" },
      { ts: "2026-07-20T08:00:00.000Z", v: 40, day: "20 Jul" },
    ];
    const sliced = filterHomeSeriesByRange(rows, "24h", now);
    expect(sliced.map((r) => r.v)).toEqual([-2000, 40]);
  });

  it("compresses dense same-day snapshots to one mark per day", () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => ({
        ts: new Date(Date.UTC(2026, 6, 1, i % 20, 0, 0)).toISOString(),
        v: i,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        ts: new Date(Date.UTC(2026, 6, 2, i % 20, 0, 0)).toISOString(),
        v: 100 + i,
      })),
    ];
    expect(rows.length).toBe(50);
    const compressed = compressHomeSeriesByDay(rows);
    expect(compressed).toHaveLength(2);
    expect(compressed[0]!.v).toBe(19);
    expect(compressed[1]!.v).toBe(119);
  });
});

describe("buildHomeTickerEquityCurve CD remap", () => {
  it("stitches history across ticker|CD key changes (BNTX-like)", () => {
    const oldKey = "BNTX|2026-07-13";
    const newKey = "BNTX|2026-07-31";
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-07-10T16:00:00.000Z",
        capital: 4000,
        value: 3900,
        pnl: -100,
        pnlPct: -2.5,
        byTicker: { [oldKey]: { value: 3900, pnl: -100, pnlPct: -2.5 } },
      },
      {
        ts: "2026-07-15T16:00:00.000Z",
        capital: 4000,
        value: 4100,
        pnl: 100,
        pnlPct: 2.5,
        byTicker: { [newKey]: { value: 4100, pnl: 100, pnlPct: 2.5 } },
      },
    ];
    const inputs: InvestSimInputs = {
      [newKey]: {
        buyPrice: 10,
        capital: 4000,
        investedAt: "2026-07-01T10:00:00.000Z",
      },
    };
    const rows = buildHomeTickerEquityCurve(history, inputs, newKey, "en");
    expect(rows.some((r) => r.equity === -100)).toBe(true);
    expect(rows[rows.length - 1]!.equity).toBe(100);
  });
});
