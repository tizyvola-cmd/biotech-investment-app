import { describe, expect, it, beforeEach, vi } from "vitest";
import { normalizedRowKey } from "./investSimKeys";
import {
  appendHistoryPoint,
  getInvestSimInputsSnapshot,
  loadInvestSimInputs,
  persistInvestSimHistoryNow,
  resetInvestSimInputsSnapshotCache,
  type InvestSimHistoryPoint,
  type InvestSimInputs,
} from "./investSimStorage";
import { applyPortfolioSellPatch, executePortfolioSell, executePortfolioSellAsync } from "./portfolioSell";
import { buildPortfolioDailyPnlLedger, isRowMarkedSold, rowHasActivePortfolio } from "./simulationPosition";
import { summarizeClosedPiggyBankFromLedger } from "./closedPiggyBank";

const TLX_ROW = {
  Ticker: "TLX",
  "Completion Date": "2026-08-15",
  "Prezzo Acquisto ($)": 10,
  "Capitale Investito ($)": 5000,
  "Prezzo Corrente ($)": 8.5,
};

const KEY = normalizedRowKey("TLX", TLX_ROW["Completion Date"]);

function activeInputs(): InvestSimInputs {
  return {
    [KEY]: {
      buyPrice: 10,
      capital: 5000,
      investedAt: "2026-06-01T10:00:00.000Z",
    },
  };
}

describe("portfolioSell", () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    const ls = {
      store,
      getItem(k: string) {
        return store[k] ?? null;
      },
      setItem(k: string, v: string) {
        store[k] = v;
      },
      removeItem(k: string) {
        delete store[k];
      },
    };
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", {
      confirm: vi.fn(() => true),
      localStorage: ls,
      dispatchEvent: vi.fn(),
    });
    resetInvestSimInputsSnapshotCache();
    ls.setItem("supernova_invest_sim_inputs", JSON.stringify(activeInputs()));
    persistInvestSimHistoryNow([]);
  });

  it("applyPortfolioSellPatch stores closed exit snapshot on sold row", () => {
    const next = applyPortfolioSellPatch(activeInputs(), KEY, [TLX_ROW], {
      closedCapital: 5000,
      closedValue: 4200,
      closedPnlEur: -800,
    });
    expect(next[KEY]?.ignoreSheet).toBe(true);
    expect(next[KEY]?.capital).toBe(0);
    expect(next[KEY]?.closedCapital).toBe(5000);
    expect(next[KEY]?.closedPnlEur).toBe(-800);
    expect(next[KEY]?.soldAt).toBeTruthy();
  });

  it("executePortfolioSell closes legacy alias keys for the same row", () => {
    const cpixRow = {
      Ticker: "CPIX",
      "Completion Date": "2026-08-26",
      "Prezzo Corrente ($)": 6.22,
    };
    const canon = normalizedRowKey("CPIX", cpixRow["Completion Date"]);
    const alias = "CPIX|26/08/2026";
    const inputs: InvestSimInputs = {
      [alias]: {
        buyPrice: 7.06,
        capital: 6000,
        investedAt: "2026-07-03T10:31:38.373Z",
      },
    };
    const table = { sheet: "simulation", columns: [], rows: [cpixRow], row_count: 1 };
    expect(rowHasActivePortfolio(cpixRow, inputs)).toBe(true);
    const result = executePortfolioSell({
      key: canon,
      simRow: cpixRow,
      simTable: table,
      inputs,
      confirm: false,
      recordHistory: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(rowHasActivePortfolio(cpixRow, result.inputs)).toBe(false);
    expect(isRowMarkedSold(cpixRow, result.inputs)).toBe(true);
    expect(result.inputs[canon]?.ignoreSheet).toBe(true);
    expect(result.inputs[canon]?.soldAt).toBeTruthy();
  });

  it("executePortfolioSell removes active portfolio and records closed P&L", () => {
    const result = executePortfolioSell({
      key: KEY,
      simRow: TLX_ROW,
      simTable: { sheet: "simulation", columns: [], rows: [TLX_ROW], row_count: 1 },
      inputs: activeInputs(),
      confirm: false,
      recordHistory: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diskPersisted).toBe(false);
    expect(rowHasActivePortfolio(TLX_ROW, result.inputs)).toBe(false);
    expect(result.inputs[KEY]?.closedPnlEur).toBe(-750);
    expect(result.inputs[KEY]?.closedCapital).toBe(5000);
    const cached = getInvestSimInputsSnapshot();
    expect(rowHasActivePortfolio(TLX_ROW, cached)).toBe(false);
    expect(loadInvestSimInputs()[KEY]?.ignoreSheet).toBe(true);
  });

  it("isRowMarkedSold matches sold entry under legacy alias key", () => {
    const aliasKey = "TLX|2026-08-15";
    const sold: InvestSimInputs = {
      [aliasKey]: {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-01T12:00:00.000Z",
        closedCapital: 5000,
        closedPnlEur: -400,
      },
    };
    expect(isRowMarkedSold(TLX_ROW, sold)).toBe(true);
    expect(rowHasActivePortfolio(TLX_ROW, sold)).toBe(false);
  });

  it("CD rename after sell: sheet capital / ghost open does not stay in portfolio", () => {
    const septRow = {
      Ticker: "VRTX",
      "Completion Date": "2026-09-17",
      "Prezzo Corrente ($)": 400,
      "Capitale Investito ($)": 8000,
      "Prezzo Acquisto ($)": 350,
    };
    const soldOldCd: InvestSimInputs = {
      "VRTX|2026-05-31": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-05-29T17:41:46.291Z",
        closedCapital: 8000,
      },
    };
    expect(isRowMarkedSold(septRow, soldOldCd)).toBe(true);
    expect(rowHasActivePortfolio(septRow, soldOldCd)).toBe(false);

    const ghostOpen: InvestSimInputs = {
      ...soldOldCd,
      "VRTX|2026-09-17": {
        buyPrice: 350,
        capital: 8000,
        investedAt: "2026-05-01T10:00:00.000Z",
      },
    };
    expect(isRowMarkedSold(septRow, ghostOpen)).toBe(true);
    expect(rowHasActivePortfolio(septRow, ghostOpen)).toBe(false);
  });

  it("rebuy after company sell stays in portfolio", () => {
    const row = {
      Ticker: "GPCR",
      "Completion Date": "2026-07-15",
      "Prezzo Corrente ($)": 60,
    };
    const inputs: InvestSimInputs = {
      "GPCR|2026-08-26": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-06-25T13:44:11.135Z",
        closedPnlEur: 153.79,
      },
      "GPCR|2026-07-15": {
        buyPrice: 54.75,
        capital: 5000,
        investedAt: "2026-07-07T09:37:09.994Z",
      },
    };
    expect(isRowMarkedSold(row, inputs)).toBe(false);
    expect(rowHasActivePortfolio(row, inputs)).toBe(true);
  });

  it("rebuy after sell uses fresh investedAt and is active in portfolio", () => {
    const row = {
      Ticker: "TLX",
      "Completion Date": "2026-08-15",
      "Prezzo Corrente ($)": 9,
    };
    const sold = applyPortfolioSellPatch(activeInputs(), KEY, [row], {
      closedCapital: 5000,
      closedValue: 4500,
      closedPnlEur: -500,
    });
    expect(rowHasActivePortfolio(row, sold)).toBe(false);
    const boughtAt = "2026-08-06T18:00:00.000Z";
    const rebuy: InvestSimInputs = {
      ...sold,
      [KEY]: {
        buyPrice: 9,
        capital: 5000,
        ignoreSheet: false,
        investedAt: boughtAt,
        universe: "simloop",
      },
    };
    expect(isRowMarkedSold(row, rebuy)).toBe(false);
    expect(rowHasActivePortfolio(row, rebuy)).toBe(true);
  });

  it("sell closes open capital on every CD for the company", () => {
    const septRow = {
      Ticker: "VRTX",
      "Completion Date": "2026-09-17",
      "Prezzo Corrente ($)": 400,
    };
    const mayKey = "VRTX|2026-05-31";
    const septKey = normalizedRowKey("VRTX", septRow["Completion Date"]);
    const inputs: InvestSimInputs = {
      [mayKey]: {
        buyPrice: 300,
        capital: 5000,
        investedAt: "2026-05-01T10:00:00.000Z",
      },
      [septKey]: {
        buyPrice: 350,
        capital: 8000,
        investedAt: "2026-05-15T10:00:00.000Z",
      },
    };
    const next = applyPortfolioSellPatch(inputs, septKey, [septRow], {
      closedCapital: 8000,
      closedValue: 8200,
      closedPnlEur: 200,
    });
    expect(next[septKey]?.ignoreSheet).toBe(true);
    expect(next[septKey]?.capital).toBe(0);
    expect(next[septKey]?.closedPnlEur).toBe(200);
    expect(next[mayKey]?.ignoreSheet).toBe(true);
    expect(next[mayKey]?.capital).toBe(0);
    expect(rowHasActivePortfolio(septRow, next)).toBe(false);
  });

  it("executePortfolioSellAsync reports diskPersisted when API save succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const result = await executePortfolioSellAsync({
      key: KEY,
      simRow: TLX_ROW,
      simTable: { sheet: "simulation", columns: [], rows: [TLX_ROW], row_count: 1 },
      inputs: activeInputs(),
      confirm: false,
      recordHistory: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diskPersisted).toBe(true);
  });

  it("closed piggy bank includes sold TLX even without history snapshots", () => {
    const sold = applyPortfolioSellPatch(activeInputs(), KEY, [TLX_ROW], {
      closedCapital: 5000,
      closedValue: 4600,
      closedPnlEur: -400,
    });
    const ledger = buildPortfolioDailyPnlLedger(
      { sheet: "simulation", columns: [], rows: [TLX_ROW], row_count: 1 },
      sold,
      [],
    );
    const summary = summarizeClosedPiggyBankFromLedger(ledger);
    expect(summary.positionCount).toBe(1);
    expect(summary.rawPnlEur).toBe(-400);
    expect(summary.tickers).toEqual(["TLX"]);
  });
});

describe("appendHistoryPoint same-day merge", () => {
  it("preserves sold ticker in byTicker when later snapshot omits it", () => {
    const day = "2026-06-11T12:00:00.000Z";
    const preSell: InvestSimHistoryPoint = {
      ts: day,
      capital: 5000,
      value: 4600,
      pnl: -400,
      pnlPct: -8,
      byTicker: {
        [KEY]: { value: 4600, pnl: -400, pnlPct: -8 },
      },
    };
    const postRefresh: Omit<InvestSimHistoryPoint, "ts"> = {
      capital: 10000,
      value: 9500,
      pnl: -500,
      pnlPct: -5,
      byTicker: {
        OTHER: { value: 9500, pnl: -500, pnlPct: -5 },
      },
    };
    const merged = appendHistoryPoint([preSell], postRefresh, { force: true });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.byTicker[KEY]?.pnl).toBe(-400);
    expect(merged[0]?.byTicker.OTHER?.pnl).toBe(-500);
  });
});
