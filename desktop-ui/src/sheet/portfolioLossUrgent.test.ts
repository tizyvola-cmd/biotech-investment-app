import { describe, expect, it, beforeEach, vi } from "vitest";
import type { SheetTable } from "../types";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import {
  ackLossModalBatch,
  detectPortfolioLossAlerts,
  dismissPortfolioLossAlert,
  dismissPortfolioLossAlerts,
  isLossModalAutoShownThisSession,
  isLossModalBatchAcked,
  isPortfolioLossAlertDismissed,
  lossAlertKeySig,
  markLossModalAutoShownThisSession,
} from "./portfolioLossUrgent";
import { resolvePnlTabCardTone } from "./portfolioGainLossStyle";
import { positionPnlForOpenRow, rowHasActivePortfolio } from "./simulationPosition";

function simTable(rows: Record<string, unknown>[]): SheetTable {
  return { sheet: "Simulation", columns: Object.keys(rows[0] ?? {}), rows };
}

describe("detectPortfolioLossAlerts ↔ P&L tab", () => {
  it("uses breakdown P&L (not raw position) for loss detection", () => {
    const key = "TELA|2026-06-30";
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-05-29T16:00:00.000Z",
        capital: 5000,
        value: 5000,
        pnl: 0,
        pnlPct: 0,
        byTicker: { [key]: { value: 5000, pnl: 0, pnlPct: 0 } },
      },
      {
        ts: "2026-06-04T16:00:00.000Z",
        capital: 5000,
        value: 4818,
        pnl: -182,
        pnlPct: -3.64,
        byTicker: { [key]: { value: 4818, pnl: -182, pnlPct: -3.64 } },
      },
    ];
    const row = {
      Ticker: "TELA",
      "Completion Date": "30/06/2026",
      "Prezzo Corrente ($)": 0.89,
      "Var. Giorn. %": -3.51,
    };
    const inputs: InvestSimInputs = {
      [key]: {
        buyPrice: 0.89,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-05-29T10:00:00.000Z",
      },
    };
    const table = simTable([row]);

    const metrics = positionPnlForOpenRow(row, inputs, history);
    expect(resolvePnlTabCardTone(metrics.pnlEur, metrics.pnlPct)).toBe("loss");

    const alerts = detectPortfolioLossAlerts(table, inputs, history);
    const tela = alerts.find((a) => a.key === key);
    expect(tela?.ticker).toBe("TELA");
    expect(tela?.pnlEur).toBe(metrics.pnlEur);
    expect(tela?.pnlPct).toBe(metrics.pnlPct);
  });

  it("loss set matches P&L tab tone for every open position", () => {
    const rows = [
      {
        Ticker: "OLMA",
        "Completion Date": "30/06/2026",
        "Prezzo Corrente ($)": 13.68,
        "Var. Giorn. %": -2.7,
      },
      {
        Ticker: "TLX",
        "Completion Date": "30/06/2026",
        "Prezzo Corrente ($)": 9.47,
        "Var. Giorn. %": -7.79,
      },
    ];
    const inputs: InvestSimInputs = {
      "OLMA|2026-06-30": {
        buyPrice: 14.06,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-05-01T10:00:00.000Z",
      },
      "TLX|2026-06-30": {
        buyPrice: 10.27,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-05-01T10:00:00.000Z",
      },
    };
    const table = simTable(rows);
    const history: InvestSimHistoryPoint[] = [];

    const pnlTabLossKeys = new Set<string>();
    for (const row of rows) {
      if (!rowHasActivePortfolio(row, inputs)) continue;
      const m = positionPnlForOpenRow(row, inputs, history);
      if (resolvePnlTabCardTone(m.pnlEur, m.pnlPct) === "loss") {
        const pos = m.pos!;
        pnlTabLossKeys.add(pos.key);
      }
    }

    const alertKeys = new Set(detectPortfolioLossAlerts(table, inputs, history).map((a) => a.key));
    expect(alertKeys).toEqual(pnlTabLossKeys);
  });
});

describe("loss modal batch ack", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    });
    vi.stubGlobal("window", {});
  });

  it("acks by refresh token + key set (P&L drift does not invalidate)", () => {
    const alerts = [
      { key: "TLX|2026-06-30", ticker: "TLX", completionDate: "30/06/2026", pnlEur: -800, pnlPct: -16.18, capital: 5000, valueNow: 4182, buyPrice: 10.27, seriesKey: null },
      { key: "OLMA|2026-06-30", ticker: "OLMA", completionDate: "30/06/2026", pnlEur: -200, pnlPct: -4, capital: 5000, valueNow: 4800, buyPrice: 14, seriesKey: null },
    ];
    const keySig = lossAlertKeySig(alerts);
    const token = "1748500000000";

    expect(isLossModalBatchAcked(token, keySig)).toBe(false);
    ackLossModalBatch(token, keySig);
    expect(isLossModalBatchAcked(token, keySig)).toBe(true);
    expect(isLossModalBatchAcked("1748500000001", keySig)).toBe(false);
    expect(isLossModalBatchAcked(token, "OTHER|2026-06-30")).toBe(false);
  });

  it("session auto-shown gate blocks repeat auto popups", () => {
    expect(isLossModalAutoShownThisSession()).toBe(false);
    markLossModalAutoShownThisSession();
    expect(isLossModalAutoShownThisSession()).toBe(true);
  });
});

describe("portfolio loss dismiss persistence", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    });
    vi.stubGlobal("window", {});
  });

  it("batch dismiss keeps alerts suppressed after reload", () => {
    dismissPortfolioLossAlerts([
      { key: "AGIO|2026-06-30", pnlPct: -1.3 },
      { key: "TLX|2026-06-30", pnlPct: -4 },
    ]);
    expect(isPortfolioLossAlertDismissed("AGIO|2026-06-30", -1.3)).toBe(true);
    expect(isPortfolioLossAlertDismissed("AGIO|2026-06-30", -2.5)).toBe(true);
    expect(isPortfolioLossAlertDismissed("AGIO|2026-06-30", -3.5)).toBe(false);
    dismissPortfolioLossAlert("AGIO|2026-06-30", -3.5);
    expect(isPortfolioLossAlertDismissed("AGIO|2026-06-30", -3.5)).toBe(true);
  });
});
