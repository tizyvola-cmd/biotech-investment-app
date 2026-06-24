import { describe, expect, it } from "vitest";
import { normalizedRowKey } from "./investSimKeys";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import {
  buildPortfolioGainAuditExport,
  buildPortfolioGainAuditSpreadsheetXml,
} from "./portfolioGainAuditExport";

describe("portfolioGainAuditExport", () => {
  it("exports entry row plus daily rows with cumulative P&L", () => {
    const row = {
      Ticker: "CRDF",
      "Completion Date": "30/06/2026",
      "Prezzo Acquisto ($)": 2.5,
      "Capitale Investito ($)": 5000,
      "Prezzo Corrente ($)": 2.3,
      "Var. Giorn. %": 1.08,
    };
    const key = normalizedRowKey("CRDF", row["Completion Date"]);
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-06-09T16:00:00.000Z",
        capital: 5000,
        value: 5000,
        pnl: 0,
        pnlPct: 0,
        byTicker: { [key]: { value: 5000, pnl: 0, pnlPct: 0 } },
      },
      {
        ts: "2026-06-10T16:00:00.000Z",
        capital: 5000,
        value: 4143.33,
        pnl: -856.67,
        pnlPct: -17.13,
        byTicker: { [key]: { value: 4143.33, pnl: -856.67, pnlPct: -17.13 } },
      },
    ];
    const exp = buildPortfolioGainAuditExport({
      simTable: { sheet: "simulation", columns: [], rows: [row], row_count: 1 },
      inputs: {
        [key]: {
          buyPrice: 2.5,
          capital: 5000,
          investedAt: "2026-06-08T10:00:00.000Z",
          purchaseDate: "2026-06-08",
        },
      },
      history,
      portfolioOnly: true,
    });

    expect(exp.rows.length).toBeGreaterThanOrEqual(2);
    const entry = exp.rows.find((r) => r.rowKind === "entry");
    expect(entry?.capitalEur).toBe(5000);
    expect(entry?.buyPriceUsd).toBe(2.5);
    expect(entry?.shares).toBeCloseTo(2000, 2);
    expect(entry?.cumulativePnlEur).toBe(0);

    const dayRow = exp.rows.find((r) => r.day === "2026-06-10");
    expect(dayRow?.positionValueEur).toBeCloseTo(4143.33, 2);
    expect(dayRow?.cumulativePnlEur).toBeCloseTo(-856.67, 2);
  });

  it("builds spreadsheet xml with movements sheet", () => {
    const exp = buildPortfolioGainAuditExport({
      simTable: null,
      inputs: {},
      history: [],
    });
    const xml = buildPortfolioGainAuditSpreadsheetXml(exp, "en");
    expect(xml).toContain("<Worksheet ss:Name=\"Movements\">");
    expect(xml).toContain("<Worksheet ss:Name=\"Legend\">");
  });
});
