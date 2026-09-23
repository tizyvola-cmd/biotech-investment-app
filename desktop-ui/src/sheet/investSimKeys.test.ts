import { describe, expect, it } from "vitest";
import {
  collapseGhostOpensAfterCompanySell,
  mergeClosedBooksFromCandidates,
  mergeInvestSimInputs,
  preserveRecentManualOpens,
  purgeSoldAliasesForOpenTickers,
  reassertOpenBookFromDisk,
  reconcileInvestSimInputs,
  restoreOpenCapitalFromDisk,
  sumClosedPnlEur,
  sumOpenCapital,
} from "./investSimKeys";
import type { InvestSimInputEntry } from "./investSimStorage";

describe("mergeInvestSimInputs sold position", () => {
  it("does not reopen a row closed with soldAt when merging stale disk capital", () => {
    const sold: InvestSimInputEntry = {
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      soldAt: "2026-05-29T10:00:00.000Z",
      investedAt: "2026-05-01T10:00:00.000Z",
    };
    const diskOpen: InvestSimInputEntry = {
      buyPrice: 12.5,
      capital: 5000,
      ignoreSheet: false,
    };
    const merged = mergeInvestSimInputs(
      { "TLX|2026-06-30": diskOpen },
      { "TLX|2026-06-30": sold },
    );
    const row = merged["TLX|2026-06-30"];
    expect(row?.capital).toBe(0);
    expect(row?.ignoreSheet).toBe(true);
    expect(row?.soldAt).toBeTruthy();
  });

  it("collapses a ghost open whose investedAt is before a sell on another CD", () => {
    const localOpen: InvestSimInputEntry = {
      buyPrice: 3.1,
      capital: 4062,
      ignoreSheet: false,
      investedAt: "2026-07-01T10:00:00.000Z",
    };
    const apiSold: InvestSimInputEntry = {
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      soldAt: "2026-08-13T17:53:23.805Z",
      investedAt: "2026-07-20T10:00:00.000Z",
      closedCapital: 4062,
    };
    const merged = mergeInvestSimInputs(
      { "CMPX|2026-10-01": localOpen },
      { "CMPX|2026-07-20": apiSold },
    );
    expect(merged["CMPX|2026-10-01"]?.capital).toBe(0);
    expect(merged["CMPX|2026-10-01"]?.ignoreSheet).toBe(true);
    expect(merged["CMPX|2026-07-20"]?.closedCapital).toBe(4062);
  });

  it("does not close a real rebuy invested after the company sell", () => {
    const rebuy: InvestSimInputEntry = {
      buyPrice: 50,
      capital: 5000,
      ignoreSheet: false,
      investedAt: "2026-08-20T10:00:00.000Z",
    };
    const sold: InvestSimInputEntry = {
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      soldAt: "2026-08-13T17:53:23.805Z",
      closedCapital: 5000,
    };
    const merged = mergeInvestSimInputs(
      { "GPCR|2026-10-01": rebuy },
      { "GPCR|2026-07-15": sold },
    );
    expect(merged["GPCR|2026-10-01"]?.capital).toBe(5000);
    expect(merged["GPCR|2026-10-01"]?.ignoreSheet).toBe(false);
  });
});

describe("restoreOpenCapitalFromDisk", () => {
  it("restores capital zeroed in localStorage without a Sell", () => {
    const disk: Record<string, InvestSimInputEntry> = {
      "BNTX|2026-07-31": { buyPrice: 93.8, capital: 4063, ignoreSheet: false },
      "CERS|2026-07-30": { buyPrice: 3.21, capital: 2279, ignoreSheet: false },
    };
    const local: Record<string, InvestSimInputEntry> = {
      "BNTX|2026-07-31": { buyPrice: 93.8, capital: 0, ignoreSheet: false },
      "BIIB|2026-09-27": { buyPrice: 201, capital: 4062, ignoreSheet: false },
    };
    const { inputs, restoredKeys, bookCollapsed } = restoreOpenCapitalFromDisk(local, disk);
    expect(bookCollapsed).toBe(false);
    expect(restoredKeys.sort()).toEqual(["BNTX|2026-07-31", "CERS|2026-07-30"]);
    expect(inputs["BNTX|2026-07-31"]?.capital).toBe(4063);
    expect(inputs["CERS|2026-07-30"]?.capital).toBe(2279);
    expect(inputs["BIIB|2026-09-27"]?.capital).toBe(4062);
  });

  it("does not resurrect an explicit Sell in soft mode", () => {
    const disk: Record<string, InvestSimInputEntry> = {
      "SYRE|2026-08-19": { buyPrice: 100, capital: 1690, ignoreSheet: false },
    };
    const local: Record<string, InvestSimInputEntry> = {
      "SYRE|2026-08-19": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-21T10:00:00.000Z",
      },
    };
    const { inputs, restoredKeys } = restoreOpenCapitalFromDisk(local, disk);
    expect(restoredKeys).toEqual([]);
    expect(inputs["SYRE|2026-08-19"]?.capital).toBe(0);
    expect(inputs["SYRE|2026-08-19"]?.ignoreSheet).toBe(true);
  });

  it("force book-collapse restores even after bogus local Sells", () => {
    const disk: Record<string, InvestSimInputEntry> = {
      "BNTX|2026-07-31": { buyPrice: 93.8, capital: 4063, ignoreSheet: false },
      "CERS|2026-07-30": { buyPrice: 3.21, capital: 2279, ignoreSheet: false },
      "SYRE|2026-08-19": { buyPrice: 100, capital: 1690, ignoreSheet: false },
      "MSLE|2026-08-30": { buyPrice: 9, capital: 5000, ignoreSheet: false },
      "BIIB|2026-09-27": { buyPrice: 201, capital: 4062, ignoreSheet: false },
      "VIR|2026-09-25": { buyPrice: 10, capital: 4062, ignoreSheet: false },
      "CHRS|2026-09-30": { buyPrice: 1.46, capital: 13, ignoreSheet: false },
    };
    const local: Record<string, InvestSimInputEntry> = {
      "BIIB|2026-09-27": { buyPrice: 201, capital: 4062, ignoreSheet: false },
      "VIR|2026-09-25": { buyPrice: 10, capital: 4062, ignoreSheet: false },
      "CHRS|2026-09-30": { buyPrice: 1.46, capital: 13, ignoreSheet: false },
      "BNTX|2026-07-31": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-22T06:00:00.000Z",
      },
      "CERS|2026-07-30": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-22T06:00:00.000Z",
      },
    };
    expect(sumOpenCapital(local)).toBe(8137);
    expect(sumOpenCapital(disk)).toBeGreaterThan(20_000);

    const { inputs, restoredKeys, bookCollapsed } = restoreOpenCapitalFromDisk(local, disk);
    expect(bookCollapsed).toBe(true);
    expect(restoredKeys).toEqual(
      expect.arrayContaining(["BNTX|2026-07-31", "CERS|2026-07-30", "SYRE|2026-08-19", "MSLE|2026-08-30"]),
    );
    expect(inputs["BNTX|2026-07-31"]?.capital).toBe(4063);
    expect(inputs["BNTX|2026-07-31"]?.ignoreSheet).toBe(false);
    expect(sumOpenCapital(inputs)).toBe(sumOpenCapital(disk));
  });

  it("does not restore a ghost open invested before a later company sell", () => {
    const disk: Record<string, InvestSimInputEntry> = {
      "CMPX|2026-10-01": {
        buyPrice: 3.1,
        capital: 4062,
        ignoreSheet: false,
        investedAt: "2026-07-01T10:00:00.000Z",
      },
    };
    const local: Record<string, InvestSimInputEntry> = {
      "CMPX|2026-07-20": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-08-13T17:53:23.805Z",
        closedCapital: 4062,
      },
    };
    const { inputs, restoredKeys } = restoreOpenCapitalFromDisk(local, disk);
    expect(restoredKeys).toEqual([]);
    expect(inputs["CMPX|2026-10-01"]?.capital ?? 0).toBe(0);
  });
});

describe("reconcile must not kill restored opens via sold aliases", () => {
  it("purge + reassert keeps BNTX/CERS open after bogus Sell aliases", () => {
    const disk: Record<string, InvestSimInputEntry> = {
      "BNTX|2026-07-31": { buyPrice: 93.8, capital: 4063, ignoreSheet: false },
      "CERS|2026-07-30": { buyPrice: 3.21, capital: 2279, ignoreSheet: false },
      "BIIB|2026-09-27": { buyPrice: 201, capital: 4062, ignoreSheet: false },
      "VIR|2026-09-25": { buyPrice: 10, capital: 4062, ignoreSheet: false },
      "CHRS|2026-09-30": { buyPrice: 1.46, capital: 13, ignoreSheet: false },
    };
    const local: Record<string, InvestSimInputEntry> = {
      ...disk,
      "BNTX|2026-06-01": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-22T06:00:00.000Z",
        closedCapital: 4000,
        closedPnlEur: 10,
      },
      "CERS|2026-05-01": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-22T06:00:00.000Z",
      },
    };
    const rows = [
      { Ticker: "BNTX", "Completion Date": "2026-07-31" },
      { Ticker: "CERS", "Completion Date": "2026-07-30" },
      { Ticker: "BIIB", "Completion Date": "2026-09-27" },
      { Ticker: "VIR", "Completion Date": "2026-09-25" },
      { Ticker: "CHRS", "Completion Date": "2026-09-30" },
    ];

    // Same-key bogus Sell (the failure mode that emptied Pulse to BIIB/VIR/CHRS).
    const sameKeySold: Record<string, InvestSimInputEntry> = {
      "BIIB|2026-09-27": disk["BIIB|2026-09-27"]!,
      "VIR|2026-09-25": disk["VIR|2026-09-25"]!,
      "CHRS|2026-09-30": disk["CHRS|2026-09-30"]!,
      "BNTX|2026-07-31": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-22T06:00:00.000Z",
      },
      "CERS|2026-07-30": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-22T06:00:00.000Z",
      },
    };
    const mergedSold = mergeInvestSimInputs(disk, sameKeySold);
    expect(sumOpenCapital(mergedSold)).toBe(8137);

    const fixed = reassertOpenBookFromDisk(
      purgeSoldAliasesForOpenTickers(
        reconcileInvestSimInputs(purgeSoldAliasesForOpenTickers({ ...disk, ...local }), rows),
      ),
      disk,
      rows,
    );
    expect(sumOpenCapital(fixed)).toBeGreaterThan(14_000);
    expect(fixed["BNTX|2026-07-31"]?.capital).toBe(4063);
    expect(fixed["CERS|2026-07-30"]?.capital).toBe(2279);
    expect(fixed["BNTX|2026-07-31"]?.ignoreSheet).toBe(false);
  });

  it("collapseGhostOpensAfterCompanySell closes capital invested before a later sell", () => {
    const book: Record<string, InvestSimInputEntry> = {
      "BNTX|2026-07-13": {
        buyPrice: 93.8,
        capital: 4063,
        ignoreSheet: false,
        investedAt: "2026-05-27T04:43:45.406Z",
      },
      "BNTX|2026-07-31": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-08-02T12:35:37.536Z",
        closedPnlEur: -100,
      },
    };
    const fixed = collapseGhostOpensAfterCompanySell(book);
    expect(fixed["BNTX|2026-07-13"]?.capital).toBe(0);
    expect(fixed["BNTX|2026-07-13"]?.ignoreSheet).toBe(true);
    expect(fixed["BNTX|2026-07-31"]?.closedPnlEur).toBe(-100);
  });

  it("keeps a Dashboard universe:real reopen after a prior company sell", () => {
    const book: Record<string, InvestSimInputEntry> = {
      "CPIX|2026-06-01": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-09-04T16:00:00.000Z",
        closedPnlEur: -200,
      },
      "CPIX|2099-06-01": {
        buyPrice: 6.99,
        capital: 6000,
        ignoreSheet: false,
        investedAt: "2026-09-05T09:00:00.000Z",
        universe: "real",
      },
    };
    const fixed = collapseGhostOpensAfterCompanySell(book);
    expect(fixed["CPIX|2099-06-01"]?.capital).toBe(6000);
    expect(fixed["CPIX|2099-06-01"]?.ignoreSheet).toBe(false);
    expect(fixed["CPIX|2026-06-01"]?.closedPnlEur).toBe(-200);

    const rows = [{ Ticker: "CPIX", "Completion Date": "2099-06-01" }];
    const reconciled = reconcileInvestSimInputs(book, rows);
    expect(reconciled["CPIX|2099-06-01"]?.capital).toBe(6000);
    expect(reconciled["CPIX|2099-06-01"]?.universe).toBe("real");
  });

  it("merge prefers a universe:real rebuy over a sold marker on the same key", () => {
    const sold: InvestSimInputEntry = {
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      soldAt: "2026-09-04T16:00:00.000Z",
      closedPnlEur: -80,
    };
    const rebuy: InvestSimInputEntry = {
      buyPrice: 7,
      capital: 6000,
      ignoreSheet: false,
      investedAt: "2026-09-01T12:00:00.000Z",
      universe: "real",
    };
    const merged = mergeInvestSimInputs(
      { "CPIX|2099-06-01": sold },
      { "CPIX|2099-06-01": rebuy },
    );
    expect(merged["CPIX|2099-06-01"]?.capital).toBe(6000);
    expect(merged["CPIX|2099-06-01"]?.ignoreSheet).toBe(false);
    expect(merged["CPIX|2099-06-01"]?.universe).toBe("real");
  });

  it("preserveRecentManualOpens restores a typed holding wiped by a stale hydrate", () => {
    const now = Date.parse("2026-09-05T10:00:00.000Z");
    const local: Record<string, InvestSimInputEntry> = {
      "CPIX|2099-06-01": {
        buyPrice: 6.99,
        capital: 6000,
        ignoreSheet: false,
        investedAt: "2026-09-05T09:50:00.000Z",
        universe: "real",
      },
    };
    const incoming: Record<string, InvestSimInputEntry> = {
      "CPIX|2099-06-01": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-09-04T16:00:00.000Z",
      },
    };
    const kept = preserveRecentManualOpens(incoming, local, now);
    expect(kept["CPIX|2099-06-01"]?.capital).toBe(6000);
    expect(kept["CPIX|2099-06-01"]?.universe).toBe("real");
  });

  it("reassert does not revive disk open invested before a later company sell", () => {
    const disk: Record<string, InvestSimInputEntry> = {
      "VRTX|2026-05-31": {
        buyPrice: 300,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-05-01T10:00:00.000Z",
      },
      "VRTX|2026-09-17": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-05-29T17:41:46.291Z",
      },
    };
    const rows = [{ Ticker: "VRTX", "Completion Date": "2026-09-17" }];
    const fixed = reassertOpenBookFromDisk({}, disk, rows);
    expect(fixed["VRTX|2026-09-17"]?.capital ?? 0).toBe(0);
    expect(fixed["VRTX|2026-05-31"]?.capital ?? 0).toBe(0);
  });

  it("keeps prior closed PnL on another CD when same ticker is reopened", () => {
    const book: Record<string, InvestSimInputEntry> = {
      "GPCR|2026-07-15": { buyPrice: 54, capital: 5000, ignoreSheet: false },
      "GPCR|2026-08-26": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-06-25T13:44:11.135Z",
        closedCapital: 3499,
        closedPnlEur: 153.79,
      },
    };
    const purged = purgeSoldAliasesForOpenTickers(book, {
      restoredKeys: ["GPCR|2026-07-15"],
    });
    expect(purged["GPCR|2026-07-15"]?.capital).toBe(5000);
    expect(purged["GPCR|2026-08-26"]?.closedPnlEur).toBe(153.79);
    expect(sumClosedPnlEur(purged)).toBeCloseTo(153.79);
  });

  it("merges richer closed rows from another host", () => {
    const local: Record<string, InvestSimInputEntry> = {
      "BIIB|2026-09-27": { buyPrice: 200, capital: 4062, ignoreSheet: false },
    };
    const vps: Record<string, InvestSimInputEntry> = {
      "GPCR|2026-08-26": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        closedPnlEur: 153.79,
        closedCapital: 3499,
        soldAt: "2026-06-25T13:44:11.135Z",
      },
    };
    const merged = mergeClosedBooksFromCandidates(local, vps);
    expect(merged["GPCR|2026-08-26"]?.closedPnlEur).toBe(153.79);
    expect(sumClosedPnlEur(merged)).toBeCloseTo(153.79);
  });
});
