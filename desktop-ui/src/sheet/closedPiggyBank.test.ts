import { describe, expect, it } from "vitest";
import {
  closedPiggyBankFillPct,
  closedPiggyResetConfirmVars,
  computeClosedPiggyBankDisplay,
  summarizeClosedPiggyBankFromLedger,
} from "./closedPiggyBank";
import type { PortfolioDailyPnlLedger } from "./simulationPosition";

describe("closedPiggyBank", () => {
  const ledger: PortfolioDailyPnlLedger = {
    dayKeys: ["2026-06-01", "2026-06-02"],
    rows: [
      {
        key: "OLMA|2026-06-30",
        ticker: "OLMA",
        completionDate: "30/06/2026",
        capital: 5000,
        legs: [],
        totalEur: -274,
        pnlByDay: { "2026-06-01": -100, "2026-06-02": -174 },
        archived: true,
      },
      {
        key: "BCAB|2026-06-30",
        ticker: "BCAB",
        completionDate: "30/06/2026",
        capital: 5000,
        legs: [],
        totalEur: 523,
        pnlByDay: { "2026-06-01": 200, "2026-06-02": 323 },
        archived: true,
      },
      {
        key: "BNTX|2026-06-30",
        ticker: "BNTX",
        completionDate: "30/06/2026",
        capital: 5000,
        legs: [],
        totalEur: 67,
        pnlByDay: { "2026-06-02": 67 },
      },
    ],
    dayTotals: {},
    grandTotal: 316,
    openDayTotals: {},
    openGrandTotal: 67,
    incompleteDailyHistory: false,
    legTotalDiffersFromMtm: false,
    openRowCount: 1,
    archivedRowCount: 2,
  };

  it("sums archived rows only", () => {
    const s = summarizeClosedPiggyBankFromLedger(ledger);
    expect(s.rawPnlEur).toBe(249);
    expect(s.capitalEur).toBe(10000);
    expect(s.positionCount).toBe(2);
    expect(s.tickers).toEqual(["OLMA", "BCAB"]);
  });

  it("reset baseline offsets display", () => {
    const summary = summarizeClosedPiggyBankFromLedger(ledger);
    const display = computeClosedPiggyBankDisplay(summary, {
      baselineEur: 249,
      resetAt: "2026-06-10T00:00:00.000Z",
    });
    expect(display.pnlEur).toBe(0);
    expect(display.fillPct).toBe(0);
  });

  it("reset confirm uses display vs raw when baseline exists", () => {
    const summary = { rawPnlEur: -1107.06, capitalEur: 65000, positionCount: 13, tickers: [] };
    const display = computeClosedPiggyBankDisplay(summary, {
      baselineEur: -365.79,
      resetAt: "2026-06-01T00:00:00.000Z",
    });
    expect(display.pnlEur).toBe(-741.27);
    const vars = closedPiggyResetConfirmVars(display);
    expect(vars.hasBaseline).toBe(true);
    expect(vars.display).toBe("-741.27");
    expect(vars.raw).toBe("-1107.06");
  });

  it("fill pct is zero on loss, positive on gain", () => {
    expect(closedPiggyBankFillPct(-100, 5000)).toBe(0);
    expect(closedPiggyBankFillPct(500, 5000)).toBeGreaterThan(0);
    expect(closedPiggyBankFillPct(500, 5000)).toBeLessThanOrEqual(100);
  });
});
