import { describe, expect, it } from "vitest";
import {
  allocationSlicesFromOpenRows,
  buildMobilePortfolioAllocation,
} from "./mobilePortfolioAllocation";
import type { InvestSimInputs, SheetTable } from "./types";

describe("mobilePortfolioAllocation", () => {
  it("pie total matches open-rows invested sum", () => {
    const openRows = [
      { key: "AAA|2026-01-01", ticker: "AAA", invested: 5000 },
      { key: "BBB|2026-06-01", ticker: "BBB", invested: 2500 },
    ];
    const slices = allocationSlicesFromOpenRows(openRows);
    const pieTotal = slices.reduce((s, x) => s + x.capitalEur, 0);
    const openTotal = openRows.reduce((s, r) => s + r.invested, 0);
    expect(pieTotal).toBe(openTotal);
    expect(slices.map((s) => s.ticker)).toEqual(["AAA", "BBB"]);
  });

  it("ignores ghost input capital when openRows are authoritative", () => {
    const sheet = {
      sheet: "Simulation",
      columns: [],
      rows: [
        {
          Ticker: "BBB",
          "Completion Date": "2026-06-01",
          "Prezzo Attuale": 12,
        },
      ],
    } as SheetTable;
    const inputs: InvestSimInputs = {
      "AAA|2026-01-01": { buyPrice: 10, capital: 5000, ignoreSheet: false },
      "BBB|2026-06-01": { buyPrice: 10, capital: 2500, ignoreSheet: false },
    };
    // Open table only shows BBB (caller already filtered); pie must follow.
    const openRows = [{ key: "BBB|2026-06-01", ticker: "BBB", invested: 2500 }];
    const slices = buildMobilePortfolioAllocation(sheet, inputs, null, openRows);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.ticker).toBe("BBB");
    expect(slices[0]?.capitalEur).toBe(2500);
  });

  it("does not prefer stale snapshot allocation over openRows", () => {
    const openRows = [{ key: "BBB|2026-06-01", ticker: "BBB", invested: 2500 }];
    const snap = {
      updatedAt: null,
      allocation: [
        { key: "AAA|x", ticker: "AAA", capitalEur: 5000, pct: 100 },
      ],
    };
    const slices = buildMobilePortfolioAllocation(null, {}, snap as never, openRows);
    expect(slices).toHaveLength(1);
    expect(slices[0]?.ticker).toBe("BBB");
  });
});
