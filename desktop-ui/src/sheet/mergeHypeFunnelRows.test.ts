import { describe, expect, it } from "vitest";
import { mergeHypeFunnelRowsIntoTable } from "./mergeHypeFunnelRows";
import type { SheetTable } from "../types";

const base: SheetTable = {
  columns: ["Ticker", "Completion Date"],
  rows: [{ Ticker: "VNDA", "Completion Date": "01/12/2026" }],
};

describe("mergeHypeFunnelRowsIntoTable", () => {
  it("appends missing hype tickers and flags names already on the sheet", () => {
    const next = mergeHypeFunnelRowsIntoTable(base, [
      { Ticker: "VNDA", "Completion Date": "01/12/2026", hype_volume_funnel: true },
      { Ticker: "CANF", "Completion Date": "31/08/2027", hype_volume_funnel: true },
    ]);
    expect(next).not.toBe(base);
    expect(next?.rows.map((r) => r.Ticker)).toEqual(["VNDA", "CANF"]);
    expect(next?.rows[0]?.hype_volume_funnel).toBe(true);
    expect(next?.rows[1]?.hype_volume_funnel).toBe(true);
  });

  it("returns the same table when entries are empty", () => {
    expect(mergeHypeFunnelRowsIntoTable(base, [])).toBe(base);
  });

  it("is a no-op when the sheet row is already marked Hype", () => {
    const already: SheetTable = {
      columns: ["Ticker", "Completion Date"],
      rows: [
        { Ticker: "VNDA", "Completion Date": "01/12/2026", hype_volume_funnel: true },
      ],
    };
    expect(
      mergeHypeFunnelRowsIntoTable(already, [
        { Ticker: "VNDA", "Completion Date": "01/12/2026", hype_volume_funnel: true },
      ]),
    ).toBe(already);
  });
});
