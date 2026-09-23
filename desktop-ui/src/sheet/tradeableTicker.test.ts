import { describe, expect, it } from "vitest";
import {
  commonTickersOnSheet,
  isRedundantWarrantOpportunityRow,
  isStalePhantomOpportunityRow,
  isValidMarketTicker,
  sanitizeIntradayTickers,
  shouldHideRedundantWarrantRow,
  filterOutRedundantWarrantRows,
  isWarrantTicker,
  tradeableTickerFromRow,
  warrantCommonTicker,
} from "./simulationPosition";

describe("warrant → tradeable common", () => {
  it("strips trailing W", () => {
    expect(warrantCommonTicker("JSPRW")).toBe("JSPR");
    expect(warrantCommonTicker("JSPR")).toBeNull();
    expect(isWarrantTicker("JSPRW")).toBe(true);
    expect(isWarrantTicker("JSPR")).toBe(false);
  });

  it("prefers live_quote_ticker then common strip", () => {
    expect(
      tradeableTickerFromRow({
        Ticker: "JSPRW",
        live_quote_ticker: "JSPR",
      }),
    ).toBe("JSPR");
    expect(tradeableTickerFromRow({ Ticker: "JSPRW" })).toBe("JSPR");
    expect(tradeableTickerFromRow({ Ticker: "VIR" })).toBe("VIR");
  });

  it("marks warrant as redundant when common is on the sheet", () => {
    const rows = [
      { Ticker: "JSPR", "Completion Date": "2026-08-01" },
      { Ticker: "JSPRW", "Completion Date": "2026-08-01" },
    ];
    const commons = commonTickersOnSheet(rows);
    expect(commons.has("JSPR")).toBe(true);
    expect(isRedundantWarrantOpportunityRow(rows[1]!, commons)).toBe(true);
    expect(isRedundantWarrantOpportunityRow(rows[0]!, commons)).toBe(false);
    expect(shouldHideRedundantWarrantRow(rows[1]!, commons, {})).toBe(true);
    expect(filterOutRedundantWarrantRows(rows, {}).map((r) => r.Ticker)).toEqual([
      "JSPR",
    ]);
  });

  it("keeps warrant row when it still has open sim capital", () => {
    const rows = [
      { Ticker: "JSPR", "Completion Date": "2026-08-01" },
      {
        Ticker: "JSPRW",
        "Completion Date": "2026-08-01",
        "Capitale Investito ($)": 1000,
      },
    ];
    const commons = commonTickersOnSheet(rows);
    const inputs = {
      "JSPRW|2026-08-01": { buyPrice: 0.01, capital: 1000 },
    };
    expect(shouldHideRedundantWarrantRow(rows[1]!, commons, inputs)).toBe(false);
  });

  it("hides only stale warrants from opportunities, not liquid commons", () => {
    expect(
      isStalePhantomOpportunityRow({ Ticker: "NRXPW", direction_live: "stale" }),
    ).toBe(true);
    expect(
      isStalePhantomOpportunityRow({ Ticker: "VRTX", direction_live: "stale" }),
    ).toBe(false);
    expect(
      isStalePhantomOpportunityRow({ Ticker: "MLTX", direction_live: "neutral" }),
    ).toBe(false);
  });

  it("rejects prose summary rows from intraday ticker lists", () => {
    expect(isValidMarketTicker("GILD")).toBe(true);
    expect(isValidMarketTicker("JSPRW")).toBe(true);
    expect(
      isValidMarketTicker("METRICHE **POOL M2** (VALORI IDENTICI SU OGNI RIGA"),
    ).toBe(false);
    expect(sanitizeIntradayTickers(["GILD", "METRICHE FOO", "NRIX"]).sort()).toEqual([
      "GILD",
      "NRIX",
    ]);
  });
});
