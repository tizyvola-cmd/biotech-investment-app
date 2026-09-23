import { describe, expect, it } from "vitest";
import { buildPortfolioAllocationSlices } from "./portfolioAllocationSlices";
import type { InvestSimInputs } from "./investSimStorage";
import type { SheetTable } from "../types";

describe("buildPortfolioAllocationSlices", () => {
  it("weights capital by ticker as % of open book", () => {
    const inputs: InvestSimInputs = {
      "AAA|2026-10-01": { buyPrice: 10, capital: 1000 },
      "BBB|2026-10-01": { buyPrice: 20, capital: 3000 },
    };
    const simTable: SheetTable = {
      sheet: "Simulation",
      columns: ["Ticker", "Completion Date", "Prezzo Corrente ($)"],
      rows: [
        { Ticker: "AAA", "Completion Date": "2026-10-01", "Prezzo Corrente ($)": 10 },
        { Ticker: "BBB", "Completion Date": "2026-10-01", "Prezzo Corrente ($)": 20 },
      ],
    };
    const slices = buildPortfolioAllocationSlices(simTable, inputs, null);
    expect(slices).toHaveLength(2);
    expect(slices[0]!.ticker).toBe("BBB");
    expect(slices[0]!.pct).toBe(75);
    expect(slices[1]!.ticker).toBe("AAA");
    expect(slices[1]!.pct).toBe(25);
  });
});
