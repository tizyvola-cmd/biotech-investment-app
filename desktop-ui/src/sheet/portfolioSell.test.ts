import { describe, expect, it, beforeEach, vi } from "vitest";
import { normalizedRowKey } from "./investSimKeys";
import {
  appendHistoryPoint,
  getInvestSimInputsSnapshot,
  loadInvestSimInputs,
  persistInvestSimHistoryNow,
  type InvestSimHistoryPoint,
  type InvestSimInputs,
} from "./investSimStorage";
import { applyPortfolioSellPatch, executePortfolioSell } from "./portfolioSell";
import { buildPortfolioDailyPnlLedger, rowHasActivePortfolio } from "./simulationPosition";
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
    expect(rowHasActivePortfolio(TLX_ROW, result.inputs)).toBe(false);
    expect(result.inputs[KEY]?.closedPnlEur).toBe(-750);
    expect(result.inputs[KEY]?.closedCapital).toBe(5000);
    const cached = getInvestSimInputsSnapshot();
    expect(rowHasActivePortfolio(TLX_ROW, cached)).toBe(false);
    expect(loadInvestSimInputs()[KEY]?.ignoreSheet).toBe(true);
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
