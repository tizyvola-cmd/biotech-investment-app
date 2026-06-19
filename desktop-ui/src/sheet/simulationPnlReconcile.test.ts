import { describe, expect, it } from "vitest";
import {
  aggregateOpenPortfolioPnl,
  buildDashboardPortfolioChips,
  computeSimulationPosition,
  positionCapitalPnlPct,
  positionDailyPnlForPnlTab,
  resolvePositionPnlBreakdown,
} from "./simulationPosition";

describe("P&L total vs trading day", () => {
  it("infers buy from Valore Attuale when spot backfill is older than today", () => {
    const row = {
      Ticker: "OLMA",
      "Completion Date": "30/06/2026",
      "Prezzo Corrente ($)": 13.68,
      "Var. Giorn. %": 28.93,
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
    expect(pos.buyPrice).toBeCloseTo(10.61, 1);
    expect(Math.abs(pos.capital / pos.buyPrice - pos.shares)).toBeLessThan(0.02);

    const daily = positionDailyPnlForPnlTab(pos, row, inputs["OLMA|2026-06-30"].investedAt, null);
    expect(daily.hasToday).toBe(true);
    if (daily.pnlEurToday != null) {
      expect(Math.abs(daily.pnlEurToday)).toBeGreaterThan(50);
    }
  });

  it("uses Valore Attuale coherently when spot backfill is stale", () => {
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
    const pos = computeSimulationPosition(row, inputs)!;
    const impliedBuy = (5000 * 13.68) / 3940;
    expect(pos.buyPrice).toBeCloseTo(impliedBuy, 1);
    expect(pos.valueNow).toBeCloseTo((5000 / impliedBuy) * 13.68, 0);
    expect(pos.pnlEur).toBeCloseTo(pos.valueNow - 5000, 0);
  });

  it("still ignores stale sheet P&L when local buy equals spot", () => {
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
        investedAt: "2026-05-28T12:00:00.000Z",
      },
    };
    const pos = computeSimulationPosition(row, inputs)!;
    expect(pos.pnlPct).toBeCloseTo(0, 1);
    expect(pos.pnlEur).toBeCloseTo(0, 0);
  });

  it("Piggy Bank chips use MTM total aligned with aggregateOpenPortfolioPnl", () => {
    const row = {
      Ticker: "BNTX",
      "Completion Date": "30/06/2026",
      "Prezzo Corrente ($)": 110,
      "Var. Giorn. %": -1.2,
      "Valore Attuale ($)": 5067,
      "Capitale Investito ($)": 5000,
    };
    const inputs = {
      "BNTX|2026-06-30": {
        buyPrice: 100,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-05-20T10:00:00.000Z",
      },
    };
    const simTable = { sheet: "Simulation", rows: [row], columns: [] };
    const pos = computeSimulationPosition(row, inputs)!;
    const breakdown = resolvePositionPnlBreakdown(
      pos,
      row,
      inputs["BNTX|2026-06-30"].investedAt,
      null,
    );
    const chips = buildDashboardPortfolioChips(simTable, inputs, []);
    const totals = aggregateOpenPortfolioPnl(simTable, inputs, []);
    expect(chips).toHaveLength(1);
    expect(chips[0].pnlEur).toBeCloseTo(pos.pnlEur, 2);
    expect(chips[0].pnlEur).not.toBeCloseTo(breakdown.totalEur, 0);
    expect(chips[0].pnlEur24h).toBeCloseTo(breakdown.pnlEurToday ?? 0, 2);
    expect(totals.pnlEur).toBeCloseTo(pos.pnlEur, 2);
    expect(totals.pnlEurToday).toBeCloseTo(breakdown.pnlEurToday ?? 0, 2);
    expect(totals.priorLegEur + totals.pnlEurToday).toBeCloseTo(totals.pnlEur, 2);
  });

  it("prefers history + Var% over stale Valore Attuale when prior closes exist", () => {
    const key = "BNTX|2026-06-30";
    const row = {
      Ticker: "BNTX",
      "Completion Date": "30/06/2026",
      "Prezzo Corrente ($)": 110,
      "Var. Giorn. %": -1.2,
      "Valore Attuale ($)": 4200,
      "Capitale Investito ($)": 5000,
    };
    const inputs = {
      [key]: {
        buyPrice: 100,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-05-20T10:00:00.000Z",
      },
    };
    const history = [
      {
        ts: "2026-06-09T16:00:00.000Z",
        capital: 5000,
        value: 5067,
        pnl: 67,
        pnlPct: 1.34,
        byTicker: { [key]: { value: 5067, pnl: 67, pnlPct: 1.34 } },
      },
    ];
    const pos = computeSimulationPosition(row, inputs, { history })!;
    const breakdown = resolvePositionPnlBreakdown(
      pos,
      row,
      inputs[key].investedAt,
      history,
    );
    const totals = aggregateOpenPortfolioPnl({ sheet: "Simulation", rows: [row], columns: [] }, inputs, history);
    expect(breakdown.priorCloseCount).toBeGreaterThan(0);
    expect(pos.pnlEur).not.toBeCloseTo(4200 - 5000, 0);
    expect(totals.pnlEur).toBeCloseTo(totals.priorLegEur + totals.pnlEurToday, 2);
  });

  it("aggregate uses leg total when prior closes exist", () => {
    const key = "BNTX|2026-07-13";
    const history = [
      {
        ts: "2026-06-03T16:00:00.000Z",
        capital: 5000,
        value: 4860,
        pnl: -140,
        pnlPct: -2.8,
        byTicker: { [key]: { value: 4860, pnl: -140, pnlPct: -2.8 } },
      },
    ];
    const row = {
      Ticker: "BNTX",
      "Completion Date": "13/07/2026",
      "Prezzo Corrente ($)": 92.14,
      "Var. Giorn. %": 4.24,
    };
    const inputs = {
      [key]: {
        buyPrice: 90.93,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-05-27T10:00:00.000Z",
      },
    };
    const totals = aggregateOpenPortfolioPnl({ sheet: "Simulation", rows: [row], columns: [] }, inputs, history);
    expect(totals.pnlEurToday).toBeCloseTo(206.2, 0);
    expect(totals.priorLegEur + totals.pnlEurToday).toBeCloseTo(totals.pnlEur, 0);
  });

  it("rescales history closes when Capital € was raised (synth sync)", () => {
    const key = "RYTM|2026-09-01";
    const history = [
      {
        ts: "2026-06-03T16:00:00.000Z",
        capital: 5000,
        value: 4860,
        pnl: -140,
        pnlPct: -2.8,
        byTicker: { [key]: { value: 4860, pnl: -140, pnlPct: -2.8 } },
      },
    ];
    const row = {
      Ticker: "RYTM",
      "Completion Date": "01/09/2026",
      "Prezzo Corrente ($)": 92.14,
      "Var. Giorn. %": 4.24,
      "Capitale Investito ($)": 12_500,
    };
    const inputs = {
      [key]: {
        buyPrice: 90.93,
        capital: 12_500,
        ignoreSheet: false,
        investedAt: "2026-05-27T10:00:00.000Z",
      },
    };
    const pos = computeSimulationPosition(row, inputs)!;
    const mtm = pos.pnlEur;
    const totals = aggregateOpenPortfolioPnl(
      { sheet: "Simulation", rows: [row], columns: [] },
      inputs,
      history,
    );
    expect(totals.pnlEur).toBeGreaterThan(mtm - 500);
    expect(totals.pnlEur).toBeLessThan(mtm + 500);
    expect(totals.pnlEur).toBeGreaterThan(-4000);
  });

  it("bar chart total % matches capital-weighted sum (not price/daily %)", () => {
    const pos = {
      key: "OLMA|2026-06-30",
      valueNow: 5003.54,
      pnlEur: 3.54,
      pnlPct: 4.24,
      pnlUnavailable: false,
      buyPrice: 13.68,
      capital: 5000,
    };
    const fromCapital = positionCapitalPnlPct(pos.pnlEur, pos.capital);
    expect(fromCapital).toBeCloseTo(0.07, 2);
    expect(fromCapital).not.toBeCloseTo(pos.pnlPct, 1);
    const weighted =
      (pos.pnlEur / pos.capital) * 100;
    expect(fromCapital).toBeCloseTo(weighted, 2);
  });
});
