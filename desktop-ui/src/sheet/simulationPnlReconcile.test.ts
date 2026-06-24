import { describe, expect, it } from "vitest";
import {
  aggregateOpenPortfolioPnl,
  assessHistoryContamination,
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
    expect(chips[0].pnlEur).toBeCloseTo(breakdown.totalEur, 0);
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

  it("ignores stale Excel P&L when user buy is set — dashboard matches history leg total", () => {
    const key = "NRIX|2026-08-15";
    const row = {
      Ticker: "NRIX",
      "Completion Date": "15/08/2026",
      "Prezzo Corrente ($)": 28.5,
      "Var. Giorn. %": 0.42,
      "Valore Attuale ($)": 20_663,
      "P&L (%)": 65.3,
      "Capitale Investito ($)": 12_500,
    };
    const inputs = {
      [key]: {
        buyPrice: 27.5,
        capital: 12_500,
        ignoreSheet: false,
        investedAt: "2026-05-20T10:00:00.000Z",
      },
    };
    const history = [
      {
        ts: "2026-06-18T16:00:00.000Z",
        capital: 12_500,
        value: 12_951,
        pnl: 451,
        pnlPct: 3.61,
        byTicker: { [key]: { value: 12_951, pnl: 451, pnlPct: 3.61 } },
      },
    ];
    const simTable = { sheet: "Simulation", rows: [row], columns: [] };
    const pos = computeSimulationPosition(row, inputs, { history })!;
    expect(pos.pnlEur).toBeLessThan(1_500);
    expect(pos.pnlEur).not.toBeCloseTo(8_163, 0);

    const chips = buildDashboardPortfolioChips(simTable, inputs, history);
    const totals = aggregateOpenPortfolioPnl(simTable, inputs, history);
    expect(chips[0].pnlEur).toBeLessThan(1_500);
    expect(totals.pnlEur).toBeLessThan(1_500);
    expect(totals.pnlEur).toBeCloseTo(totals.priorLegEur + totals.pnlEurToday, 2);
  });

  it("ignores stale Excel P&L when buy is spot backfill — infers entry from history", () => {
    const key = "NRIX|2026-08-15";
    const row = {
      Ticker: "NRIX",
      "Completion Date": "15/08/2026",
      "Prezzo Corrente ($)": 28.5,
      "Var. Giorn. %": 0.42,
      "Valore Attuale ($)": 20_663,
      "P&L (%)": 65.3,
      "Capitale Investito ($)": 12_500,
    };
    const inputs = {
      [key]: {
        buyPrice: 28.5,
        capital: 12_500,
        ignoreSheet: false,
        investedAt: "2026-05-20T10:00:00.000Z",
      },
    };
    const history = [
      {
        ts: "2026-06-18T16:00:00.000Z",
        capital: 12_500,
        value: 12_951,
        pnl: 451,
        pnlPct: 3.61,
        byTicker: { [key]: { value: 12_951, pnl: 451, pnlPct: 3.61 } },
      },
    ];
    const simTable = { sheet: "Simulation", rows: [row], columns: [] };
    const totals = aggregateOpenPortfolioPnl(simTable, inputs, history);
    expect(totals.pnlEur).toBeLessThan(1_500);
    expect(totals.pnlEur).not.toBeCloseTo(8_163, 0);
  });

  it("ignores contaminated leg chain when clean snapshot preceded bad save", () => {
    const key = "RYTM|2026-09-15";
    const row = {
      Ticker: "RYTM",
      "Completion Date": "15/09/2026",
      "Prezzo Corrente ($)": 94.5,
      "Prezzo Acquisto ($)": 90,
      "Var. Giorn. %": 0.42,
      "Valore Attuale ($)": 34_750,
      "P&L (%)": 178,
      "Capitale Investito ($)": 12_500,
    };
    const inputs = {
      [key]: {
        buyPrice: 90,
        capital: 12_500,
        ignoreSheet: false,
        investedAt: "2026-06-12T07:11:18.665Z",
      },
    };
    const history = [
      {
        ts: "2026-06-15T16:00:00.000Z",
        capital: 12_500,
        value: 13_169,
        pnl: 669,
        pnlPct: 5.35,
        byTicker: { [key]: { value: 13_169, pnl: 669, pnlPct: 5.35 } },
      },
      {
        ts: "2026-06-17T16:00:00.000Z",
        capital: 12_500,
        value: 34_750,
        pnl: 22_250,
        pnlPct: 178,
        byTicker: { [key]: { value: 34_750, pnl: 22_250, pnlPct: 178 } },
      },
    ];
    const simTable = { sheet: "Simulation", rows: [row], columns: [] };
    const chips = buildDashboardPortfolioChips(simTable, inputs, history);
    const totals = aggregateOpenPortfolioPnl(simTable, inputs, history);

    expect(chips[0]?.pnlEur).toBeLessThan(800);
    expect(chips[0]?.pnlPct).toBeLessThan(8);
    expect(totals.pnlEur).toBeLessThan(800);
    expect(totals.pnlEur).toBeCloseTo(totals.priorLegEur + totals.pnlEurToday, 2);
  });

  it("ignores contaminated history snapshots when entry buy is known", () => {
    const key = "RYTM|2026-09-15";
    const row = {
      Ticker: "RYTM",
      "Completion Date": "15/09/2026",
      "Prezzo Corrente ($)": 94.5,
      "Prezzo Acquisto ($)": 90,
      "Var. Giorn. %": 0.42,
      "Valore Attuale ($)": 34_750,
      "P&L (%)": 178,
      "Capitale Investito ($)": 12_500,
    };
    const inputs = {
      [key]: {
        buyPrice: 90,
        capital: 12_500,
        ignoreSheet: false,
        investedAt: "2026-06-12T07:11:18.665Z",
      },
    };
    const history = [
      {
        ts: "2026-06-17T16:00:00.000Z",
        capital: 12_500,
        value: 34_750,
        pnl: 22_250,
        pnlPct: 178,
        byTicker: { [key]: { value: 34_750, pnl: 22_250, pnlPct: 178 } },
      },
    ];
    const simTable = { sheet: "Simulation", rows: [row], columns: [] };
    const chips = buildDashboardPortfolioChips(simTable, inputs, history);
    expect(chips[0].pnlEur).toBeLessThan(800);
    expect(chips[0].pnlPct).toBeLessThan(8);
  });

  it("forces MTM on moderate history contamination (+18% hist vs +5% MTM)", () => {
    const key = "MOD|2026-09-15";
    const capital = 10_000;
    const buy = 100;
    const curr = 105; // +5% MTM
    const row = {
      Ticker: "MOD",
      "Completion Date": "15/09/2026",
      "Prezzo Corrente ($)": curr,
      "Prezzo Acquisto ($)": buy,
      "Var. Giorn. %": 0.5,
      "Capitale Investito ($)": capital,
    };
    const inputs = {
      [key]: {
        buyPrice: buy,
        capital,
        ignoreSheet: false,
        investedAt: "2026-06-01T10:00:00.000Z",
      },
    };
    const history = [
      {
        ts: "2026-06-16T16:00:00.000Z",
        capital,
        value: capital * 1.18,
        pnl: capital * 0.18,
        pnlPct: 18,
        byTicker: {
          [key]: {
            value: capital * 1.18,
            pnl: capital * 0.18,
            pnlPct: 18,
          },
        },
      },
    ];
    const pos = computeSimulationPosition(row, inputs, { history })!;
    const breakdown = resolvePositionPnlBreakdown(
      pos,
      row,
      inputs[key].investedAt,
      history,
      inputs,
    );
    const assessment = assessHistoryContamination(
      capital,
      [{ dayKey: "2026-06-16", value: capital * 1.18, ts: history[0].ts }],
      buy,
      curr,
    );

    expect(assessment.contaminated).toBe(true);
    expect(assessment.driftPp).toBeGreaterThan(12);
    expect(breakdown.historyContaminated).toBe(true);
    expect(breakdown.totalSource).toBe("price_mtm_contaminated_history");
    expect(breakdown.totalEur).toBeCloseTo(500, 0);
    expect(breakdown.priorLegIsImplicitEstimate).toBe(true);
    expect(breakdown.priorLegEur! + (breakdown.pnlEurToday ?? 0)).toBeCloseTo(
      breakdown.totalEur,
      1,
    );
  });

  it("flags uncertain contamination in gray zone and forces MTM", () => {
    const capital = 10_000;
    const buy = 100;
    const curr = 106; // +6% MTM
    const assessment = assessHistoryContamination(
      capital,
      [{ dayKey: "2026-06-16", value: capital * 1.145, ts: "2026-06-16T16:00:00.000Z" }],
      buy,
      curr,
    );
    expect(assessment.contaminated).toBe(false);
    expect(assessment.uncertainContamination).toBe(true);
    expect(assessment.driftPp).toBeGreaterThan(8);
    expect(assessment.driftPp).toBeLessThanOrEqual(12);
  });
});

/** Six-ticker portfolio cross-check (manual audit Excel set). */
const PORTFOLIO_SIX_TICKERS = [
  { ticker: "GPCR", cd: "26/08/2026", buy: 45.73, capital: 3499, curr: 48.0 },
  { ticker: "NRIX", cd: "31/08/2026", buy: 17.73, capital: 12_500, curr: 18.37 },
  { ticker: "MLTX", cd: "28/09/2026", buy: 18.51, capital: 5, curr: 19.0 },
  { ticker: "RYTM", cd: "15/09/2026", buy: 90, capital: 12_500, curr: 94.5 },
  { ticker: "PTCT", cd: "30/09/2026", buy: 78.42, capital: 7697, curr: 80.0 },
  { ticker: "KURA", cd: "30/09/2026", buy: 9.8, capital: 10_606, curr: 10.2 },
] as const;

function portfolioRowKey(ticker: string, cd: string): string {
  const parts = cd.split("/");
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return `${ticker}|${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return `${ticker}|${cd}`;
}

describe("P&L six-ticker portfolio — moderate contamination guard", () => {
  for (const spec of PORTFOLIO_SIX_TICKERS) {
    it(`${spec.ticker}: moderate contaminated history forces MTM not leg-sum`, () => {
      const rowKey = portfolioRowKey(spec.ticker, spec.cd);
      const mtmPct = ((spec.curr - spec.buy) / spec.buy) * 100;
      const histPct = mtmPct + 13; // drift > 12pp
      const histValue = spec.capital * (1 + histPct / 100);
      const row = {
        Ticker: spec.ticker,
        "Completion Date": spec.cd,
        "Prezzo Corrente ($)": spec.curr,
        "Prezzo Acquisto ($)": spec.buy,
        "Var. Giorn. %": 0.4,
        "Capitale Investito ($)": spec.capital,
      };
      const inputs = {
        [rowKey]: {
          buyPrice: spec.buy,
          capital: spec.capital,
          ignoreSheet: false,
          investedAt: "2026-06-01T10:00:00.000Z",
        },
      };
      const history = [
        {
          ts: "2026-06-16T16:00:00.000Z",
          capital: spec.capital,
          value: histValue,
          pnl: histValue - spec.capital,
          pnlPct: histPct,
          byTicker: {
            [rowKey]: {
              value: histValue,
              pnl: histValue - spec.capital,
              pnlPct: histPct,
            },
          },
        },
      ];
      const pos = computeSimulationPosition(row, inputs, { history })!;
      const expectedMtm = (spec.capital / spec.buy) * spec.curr - spec.capital;
      const breakdown = resolvePositionPnlBreakdown(
        pos,
        row,
        inputs[rowKey].investedAt,
        history,
        inputs,
      );

      expect(breakdown.historyContaminated || breakdown.historyUncertainContamination).toBe(
        true,
      );
      expect(breakdown.totalEur).toBeCloseTo(expectedMtm, 0);
      expect(Math.abs(breakdown.totalPct - mtmPct)).toBeLessThan(1.5);
    });
  }

  it("aggregate six tickers stays in MTM band under moderate contamination", () => {
    const rows: Record<string, unknown>[] = [];
    const inputs: Record<string, { buyPrice: number; capital: number; ignoreSheet: boolean; investedAt: string }> = {};
    const history: Parameters<typeof aggregateOpenPortfolioPnl>[2] = [];
    let expectedMtmSum = 0;

    for (const spec of PORTFOLIO_SIX_TICKERS) {
      const rowKey = portfolioRowKey(spec.ticker, spec.cd);
      const mtmPct = ((spec.curr - spec.buy) / spec.buy) * 100;
      const histPct = mtmPct + 13;
      const histValue = spec.capital * (1 + histPct / 100);
      expectedMtmSum += (spec.capital / spec.buy) * spec.curr - spec.capital;
      rows.push({
        Ticker: spec.ticker,
        "Completion Date": spec.cd,
        "Prezzo Corrente ($)": spec.curr,
        "Prezzo Acquisto ($)": spec.buy,
        "Var. Giorn. %": 0.4,
        "Capitale Investito ($)": spec.capital,
      });
      inputs[rowKey] = {
        buyPrice: spec.buy,
        capital: spec.capital,
        ignoreSheet: false,
        investedAt: "2026-06-01T10:00:00.000Z",
      };
      history.push({
        ts: `2026-06-16T16:00:00.000Z`,
        capital: spec.capital,
        value: histValue,
        pnl: histValue - spec.capital,
        pnlPct: histPct,
        byTicker: {
          [rowKey]: {
            value: histValue,
            pnl: histValue - spec.capital,
            pnlPct: histPct,
          },
        },
      });
    }

    const totals = aggregateOpenPortfolioPnl(
      { sheet: "Simulation", rows, columns: [] },
      inputs,
      history,
    );

    expect(totals.anyHistoryContaminated || totals.anyHistoryUncertainContamination).toBe(
      true,
    );
    expect(totals.priorLegIsImplicitEstimate).toBe(true);
    expect(totals.pnlEur).toBeCloseTo(expectedMtmSum, 0);
    expect(totals.pnlEur).toBeLessThan(5000);
  });
});
