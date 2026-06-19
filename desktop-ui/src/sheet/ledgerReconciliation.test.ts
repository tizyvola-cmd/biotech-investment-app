import { describe, expect, it } from "vitest";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import { normalizedRowKey } from "./investSimKeys";
import {
  buildPortfolioDailyPnlLedger,
  sumLedgerRowDailyLegs,
  sumLedgerRowsForDayKeys,
} from "./simulationPosition";

describe("Daily P&L ledger reconciliation", () => {
  it("row TOTAL equals sum of all daily legs", () => {
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
      {
        ts: "2026-06-11T16:00:00.000Z",
        capital: 5000,
        value: 4550.91,
        pnl: -449.09,
        pnlPct: -8.98,
        byTicker: { [key]: { value: 4550.91, pnl: -449.09, pnlPct: -8.98 } },
      },
    ];
    const ledger = buildPortfolioDailyPnlLedger(
      { sheet: "simulation", columns: [], rows: [row], row_count: 1 },
      {
        [key]: {
          buyPrice: 2.5,
          capital: 5000,
          investedAt: "2026-06-08T10:00:00.000Z",
        },
      },
      history,
    );
    const openRows = ledger.rows.filter((r) => !r.archived);
    expect(openRows).toHaveLength(1);
    const r = openRows[0]!;
    expect(r.totalEur).toBeCloseTo(sumLedgerRowDailyLegs(r), 2);
    expect(ledger.openGrandTotal).toBeCloseTo(r.totalEur, 2);
  });

  it("window subtotal sums only visible day keys", () => {
    const rows = [
      {
        key: "A",
        ticker: "A",
        completionDate: "—",
        capital: 5000,
        legs: [],
        totalEur: 150,
        pnlByDay: {
          "2026-06-08": 10,
          "2026-06-09": 20,
          "2026-06-10": 30,
          "2026-06-11": 40,
          "2026-06-12": 50,
        },
      },
    ];
    const window = ["2026-06-10", "2026-06-11", "2026-06-12"];
    expect(sumLedgerRowsForDayKeys(rows, window)).toBe(120);
    expect(rows[0]!.totalEur).toBe(150);
  });

  it("flags Var% today when leg total differs from MTM", () => {
    const row = {
      Ticker: "BCAB",
      "Completion Date": "30/06/2026",
      "Prezzo Acquisto ($)": 10,
      "Capitale Investito ($)": 5000,
      "Prezzo Corrente ($)": 10.84,
      "Var. Giorn. %": 2.07,
    };
    const key = normalizedRowKey("BCAB", row["Completion Date"]);
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-06-04T16:00:00.000Z",
        capital: 5000,
        value: 5419.83,
        pnl: 419.83,
        pnlPct: 8.4,
        byTicker: { [key]: { value: 5419.83, pnl: 419.83, pnlPct: 8.4 } },
      },
    ];
    const ledger = buildPortfolioDailyPnlLedger(
      { sheet: "simulation", columns: [], rows: [row], row_count: 1 },
      {
        [key]: {
          buyPrice: 10,
          capital: 5000,
          investedAt: "2026-05-28T10:00:00.000Z",
        },
      },
      history,
    );
    expect(ledger.legTotalDiffersFromMtm).toBe(true);
    expect(ledger.rows[0]?.mtmTotalEur).toBeDefined();
    expect(ledger.rows[0]?.totalEur).not.toBeCloseTo(ledger.rows[0]?.mtmTotalEur ?? 0, 0);
  });
});
