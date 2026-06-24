import { describe, expect, it } from "vitest";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import { auditSimulationBuyPrice } from "./simulationBuyPriceAudit";
import { computeSimulationPosition } from "./simulationPosition";

describe("simulation buy price", () => {
  it("keeps local buy when entry price equals spot (stale sheet P&L must not inflate buy)", () => {
    const row = {
      Ticker: "BCAB",
      "Completion Date": "2026-06-30",
      "Prezzo Corrente ($)": 3.69,
      "P&L (%)": -95,
      "Capitale Investito ($)": 5000,
    };
    const inputs = {
      "BCAB|2026-06-30": {
        buyPrice: 3.69,
        capital: 5000,
        ignoreSheet: false,
        investedAt: new Date().toISOString(),
      },
    };
    const pos = computeSimulationPosition(row, inputs)!;
    expect(pos.buyPrice).toBeCloseTo(3.69, 2);
    expect(pos.pnlPct).toBeCloseTo(0, 1);

    const audit = auditSimulationBuyPrice(
      row,
      inputs["BCAB|2026-06-30"],
      pos,
    );
    expect(audit.driftFromLocal).toBe(false);
    expect(audit.inconsistentWithSpot).toBe(false);
  });

  it("does not set the same sqrt(capital) buy on every ticker from history", () => {
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-06-03T18:00:00.000Z",
        capital: 35000,
        value: 17000,
        pnl: -18000,
        pnlPct: -50,
        byTicker: {
          "OLMA|2026-06-30": { value: 967, pnl: -4033, pnlPct: -80.65 },
          "TELA|2026-06-30": { value: 63, pnl: -4937, pnlPct: -98.74 },
          "TLX|2026-06-30": { value: 670, pnl: -4330, pnlPct: -86.61 },
        },
      },
    ];
    const rows = [
      {
        Ticker: "OLMA",
        "Completion Date": "30/06/2026",
        "Prezzo Corrente ($)": 13.68,
        "Var. Giorn. %": -2,
        "Capitale Investito ($)": 5000,
      },
      {
        Ticker: "TELA",
        "Completion Date": "30/06/2026",
        "Prezzo Corrente ($)": 0.89,
        "Var. Giorn. %": -3.5,
        "Capitale Investito ($)": 5000,
      },
      {
        Ticker: "TLX",
        "Completion Date": "30/06/2026",
        "Prezzo Corrente ($)": 9.47,
        "Var. Giorn. %": -7.8,
        "Capitale Investito ($)": 5000,
      },
    ];
    const inputs = {
      "OLMA|2026-06-30": {
        buyPrice: 13.68,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-05-29T10:00:00.000Z",
      },
      "TELA|2026-06-30": {
        buyPrice: 0.97,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-06-03T10:00:00.000Z",
      },
      "TLX|2026-06-30": {
        buyPrice: 10.7,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-06-03T10:00:00.000Z",
      },
    };
    const buys = rows.map((r) => computeSimulationPosition(r, inputs, { history })!.buyPrice);
    expect(buys[0]).not.toBeCloseTo(Math.sqrt(5000), 0);
    expect(new Set(buys).size).toBe(3);
    for (const b of buys) {
      expect(Math.abs(b - Math.sqrt(5000))).toBeGreaterThan(1);
    }
  });

  it("aligns buy, shares, value and total when spot backfill is older than today", () => {
    const row = {
      Ticker: "OLMA",
      "Completion Date": "30/06/2026",
      "Prezzo Corrente ($)": 13.68,
      "Var. Giorn. %": -2.7,
      "Valore Attuale ($)": 3773.22,
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
    const pos = computeSimulationPosition(row, inputs)!;
    expect(pos.buyPrice).not.toBeCloseTo(13.68, 1);
    expect(Math.abs(pos.shares * 13.68 - pos.valueNow)).toBeLessThan(2);
    expect(Math.abs(pos.capital / pos.buyPrice - pos.shares)).toBeLessThan(0.02);
    expect(pos.pnlEur).toBeCloseTo(pos.valueNow - pos.capital, 0);
    expect(pos.pnlPct).toBeCloseTo(((13.68 - pos.buyPrice) / pos.buyPrice) * 100, 1);
  });

  it("audit flags inferred buy when display diverges from local", () => {
    const row = {
      Ticker: "BCAB",
      "Completion Date": "2026-06-30",
      "Prezzo Corrente ($)": 3.69,
      "P&L (%)": -95,
    };
    const audit = auditSimulationBuyPrice(
      row,
      { buyPrice: 3.69, capital: 5000 },
      {
        key: "BCAB|2026-06-30",
        ticker: "BCAB",
        buyPrice: 73.8,
        capital: 5000,
        currPrice: 3.69,
        pnlPct: -95,
      },
    );
    expect(audit.driftFromLocal).toBe(true);
    expect(audit.inconsistentWithSpot).toBe(true);
  });
});
