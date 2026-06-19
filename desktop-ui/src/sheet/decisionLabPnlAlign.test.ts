import { describe, expect, it } from "vitest";
import { positionPnlForOpenRow } from "./simulationPosition";
import { sheetPnlPct } from "./simulationPosition";

describe("Decision Lab ↔ P&L alignment", () => {
  it("keeps saved buy and uses Valore Attuale instead of stale P&L % inference", () => {
    const row = {
      Ticker: "OLMA",
      "Completion Date": "30/06/2026",
      "Prezzo Corrente ($)": 13.68,
      "Var. Giorn. %": 28.93,
      "P&L (%)": -21.2,
      "Valore Attuale ($)": 3940,
      "Capitale Investito ($)": 5000,
    };
    const inputs = {
      "OLMA|2026-06-30": {
        buyPrice: 13.68,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-05-29T10:00:00.000Z",
      },
    };
    const m = positionPnlForOpenRow(row, inputs, []);
    expect(sheetPnlPct(row)).toBeCloseTo(-21.2, 1);
    expect(m.pos?.buyPrice).toBeCloseTo((5000 * 13.68) / 3940, 1);
    expect(m.pnlPct).toBeLessThan(-10);
    expect(Math.abs(m.pos!.buyPrice - Math.sqrt(5000))).toBeGreaterThan(1);
  });

  it("matches mark-to-market when buy differs from spot", () => {
    const row = {
      Ticker: "OLMA",
      "Completion Date": "30/06/2026",
      "Prezzo Corrente ($)": 10.78,
      "Var. Giorn. %": 2,
      "Capitale Investito ($)": 5000,
    };
    const inputs = {
      "OLMA|2026-06-30": {
        buyPrice: 13.68,
        capital: 5000,
        ignoreSheet: false,
      },
    };
    const m = positionPnlForOpenRow(row, inputs, []);
    expect(m.pnlPct).toBeLessThan(-15);
  });
});
