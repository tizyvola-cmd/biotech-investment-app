import { describe, expect, it } from "vitest";
import {
  alignOpenBookToDesktopPulse,
  openBookCapital,
  preferLocalBookIfFresher,
  resolveMobileTradeTarget,
  unionOpenBooks,
} from "./mobileTradeBook";
import { resolveInputsFromDesktopSnapshot } from "./hooks/useRefresh";
import type { InvestSimInputs, SheetTable } from "./types";
import type { MobileDashboardSnapshot } from "./dashboardTypes";

describe("unionOpenBooks", () => {
  it("keeps a mobile-only open when desktop snapshot omits it", () => {
    const desktop: InvestSimInputs = {
      "AAA|2026-01-01": { buyPrice: 10, capital: 5000, ignoreSheet: false },
    };
    const mobile: InvestSimInputs = {
      "KZIA|2026-12-01": {
        buyPrice: 8.5,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-08-10T18:00:00.000Z",
      },
    };
    const out = unionOpenBooks(desktop, mobile);
    expect(out["KZIA|2026-12-01"]?.capital).toBe(5000);
    expect(out["AAA|2026-01-01"]?.capital).toBe(5000);
  });

  it("does not resurrect a desktop sell over a stale mobile open", () => {
    const desktopSold: InvestSimInputs = {
      "SRPT|2026-10-31": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-08-13T07:00:00.000Z",
        investedAt: "2026-08-12T10:00:00.000Z",
      },
    };
    const staleMobileOpen: InvestSimInputs = {
      "SRPT|2026-10-31": {
        buyPrice: 18.38,
        capital: 2500,
        ignoreSheet: false,
        investedAt: "2026-08-12T10:00:00.000Z",
      },
    };
    const out = unionOpenBooks(desktopSold, staleMobileOpen);
    expect(out["SRPT|2026-10-31"]?.ignoreSheet).toBe(true);
    expect(out["SRPT|2026-10-31"]?.capital ?? 0).toBe(0);
  });
});

describe("preferLocalBookIfFresher", () => {
  it("keeps a just-saved buy over an older thinner remote book", () => {
    const local: InvestSimInputs = {
      "KZIA|2026-12-01": { buyPrice: 8, capital: 5000, ignoreSheet: false },
      "AAA|2026-01-01": { buyPrice: 10, capital: 5000, ignoreSheet: false },
    };
    const remote: InvestSimInputs = {
      "AAA|2026-01-01": { buyPrice: 10, capital: 5000, ignoreSheet: false },
    };
    const out = preferLocalBookIfFresher(
      local,
      "2026-08-10T20:00:00.000Z",
      remote,
      "2026-08-10T19:00:00.000Z",
    );
    expect(openBookCapital(out)).toBe(10_000);
    expect(out["KZIA|2026-12-01"]?.capital).toBe(5000);
  });

  it("prefers fresher remote stamp (no longer overrides by fatter local capital alone)", () => {
    const local: InvestSimInputs = {
      "GHOST|2026-01-01": { buyPrice: 5, capital: 5000, ignoreSheet: false },
      "AAA|2026-01-01": { buyPrice: 10, capital: 5000, ignoreSheet: false },
    };
    const remote: InvestSimInputs = {
      "AAA|2026-01-01": { buyPrice: 10, capital: 5000, ignoreSheet: false },
    };
    // Older code kept local whenever localCap > remoteCap; now remote stamp wins
    // the primary merge (ghosts are closed by alignOpenBookToDesktopPulse).
    const out = preferLocalBookIfFresher(
      local,
      "2026-08-10T18:00:00.000Z",
      remote,
      "2026-08-10T20:00:00.000Z",
    );
    expect(out["AAA|2026-01-01"]?.capital).toBe(5000);
  });
});

describe("alignOpenBookToDesktopPulse", () => {
  it("closes stale ghosts not in Pulse openPositions", () => {
    const book: InvestSimInputs = {
      "AAA|2026-01-01": {
        buyPrice: 10,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-07-01T00:00:00.000Z",
      },
      "GHOST|2026-01-01": {
        buyPrice: 5,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-07-01T00:00:00.000Z",
      },
    };
    const out = alignOpenBookToDesktopPulse(book, ["AAA|2026-01-01"], {
      nowMs: Date.parse("2026-08-10T20:00:00.000Z"),
    });
    expect(out["AAA|2026-01-01"]?.capital).toBe(5000);
    expect(out["GHOST|2026-01-01"]?.ignoreSheet).toBe(true);
    expect(out["GHOST|2026-01-01"]?.capital).toBe(0);
  });

  it("keeps a just-saved mobile buy missing from Pulse", () => {
    const now = Date.parse("2026-08-10T20:00:00.000Z");
    const book: InvestSimInputs = {
      "AAA|2026-01-01": {
        buyPrice: 10,
        capital: 5000,
        ignoreSheet: false,
        investedAt: "2026-07-01T00:00:00.000Z",
      },
      "KZIA|2026-12-01": {
        buyPrice: 8,
        capital: 5000,
        ignoreSheet: false,
        investedAt: new Date(now - 60_000).toISOString(),
      },
    };
    const out = alignOpenBookToDesktopPulse(book, ["AAA|2026-01-01"], {
      nowMs: now,
    });
    expect(out["KZIA|2026-12-01"]?.capital).toBe(5000);
  });
});

describe("resolveMobileTradeTarget", () => {
  it("maps Soft chip key to canonical sheet key when CD formatting differs", () => {
    const sheet: SheetTable = {
      sheet: "Simulation",
      columns: ["Ticker", "Completion Date", "Prezzo Corrente ($)"],
      rows: [
        {
          Ticker: "KZIA",
          "Completion Date": "01/12/2026",
          "Prezzo Corrente ($)": 8.25,
        },
      ],
    };
    const target = resolveMobileTradeTarget("KZIA|2026-12-01", sheet, {});
    expect(target.canonKey).toBe("KZIA|2026-12-01");
    expect(target.priceUsd).toBe(8.25);
    expect(target.row).not.toBeNull();
  });
});

describe("mergeEntryForSave rebuy", () => {
  it("assigns fresh investedAt after a Soft SELL so Pulse does not orphan-close", async () => {
    const { mergeEntryForSave } = await import("./mobileTradeBook");
    const soldAt = "2026-08-10T18:00:00.000Z";
    const next = mergeEntryForSave(
      {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        investedAt: "2026-07-01T12:00:00.000Z",
        soldAt,
        closedCapital: 2000,
        closedPnlEur: -15,
      },
      4.2,
      2500,
      false,
    );
    expect(next.ignoreSheet).toBe(false);
    expect(next.capital).toBe(2500);
    expect(next.investedAt).toBeTruthy();
    expect(Date.parse(next.investedAt!) > Date.parse(soldAt)).toBe(true);
    expect(next.soldAt).toBeUndefined();
  });
});

describe("resolveInputsFromDesktopSnapshot", () => {
  it("does not let a fresh Soft-list publish stamp wipe a newer sim-inputs file", () => {
    const persisted = {
      updated_at: "2026-08-10T20:10:00.000Z",
      source: "shared" as const,
      inputs: {
        "KZIA|2026-12-01": {
          buyPrice: 8,
          capital: 5000,
          ignoreSheet: false,
          investedAt: "2026-08-10T20:10:00.000Z",
        },
      } satisfies InvestSimInputs,
    };
    const snap = {
      version: 1,
      updated_at: "2026-08-10T20:15:00.000Z",
      // Book stamp older than file — Soft lists republished later.
      investSimInputsUpdatedAt: "2026-08-10T19:00:00.000Z",
      investSimInputs: {
        "AAA|2026-01-01": { buyPrice: 10, capital: 5000, ignoreSheet: false },
      },
      openPositions: [],
    } as unknown as MobileDashboardSnapshot;

    const out = resolveInputsFromDesktopSnapshot(snap, persisted);
    expect(out.inputs["KZIA|2026-12-01"]?.capital).toBe(5000);
    expect(out.inputs["AAA|2026-01-01"]?.capital).toBe(5000);
  });

  it("aligns fat VPS file to Pulse openPositions (drops ghosts)", () => {
    const persisted = {
      updated_at: "2026-08-10T20:10:00.000Z",
      source: "shared" as const,
      inputs: {
        "INBX|2026-01-01": {
          buyPrice: 10,
          capital: 3000,
          ignoreSheet: false,
          investedAt: "2026-07-01T00:00:00.000Z",
        },
        "ETON|2026-01-01": {
          buyPrice: 5,
          capital: 5000,
          ignoreSheet: false,
          investedAt: "2026-07-01T00:00:00.000Z",
        },
      } satisfies InvestSimInputs,
    };
    const snap = {
      version: 1,
      updated_at: "2026-08-10T20:15:00.000Z",
      investSimInputsUpdatedAt: "2026-08-10T19:00:00.000Z",
      investSimInputs: {
        "INBX|2026-01-01": {
          buyPrice: 10,
          capital: 3000,
          ignoreSheet: false,
          investedAt: "2026-07-01T00:00:00.000Z",
        },
      },
      openPositions: [
        {
          key: "INBX|2026-01-01",
          ticker: "INBX",
          capitalEur: 3000,
          pnlEur: 100,
          pnlPct: 3,
        },
      ],
    } as unknown as MobileDashboardSnapshot;

    const out = resolveInputsFromDesktopSnapshot(snap, persisted);
    expect(out.inputs["INBX|2026-01-01"]?.capital).toBe(3000);
    expect(out.inputs["ETON|2026-01-01"]?.ignoreSheet).toBe(true);
    expect(out.alignedToPulse).toBe(true);
  });

  it("restores Pulse opens wiped by a newer empty VPS sim-inputs file", () => {
    const persisted = {
      updated_at: "2026-08-12T09:01:00.000Z",
      source: "shared" as const,
      inputs: {
        "MSLE|2026-08-30": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          investedAt: "2026-07-09T11:20:44.422Z",
          soldAt: "2026-08-12T09:01:00.000Z",
        },
      } satisfies InvestSimInputs,
    };
    const snap = {
      version: 1,
      updated_at: "2026-08-12T08:58:00.000Z",
      investSimInputsUpdatedAt: "2026-08-12T08:58:00.000Z",
      investSimInputs: {
        "MSLE|2026-08-30": {
          buyPrice: 8.98,
          capital: 5000,
          ignoreSheet: false,
          investedAt: "2026-07-09T11:20:44.422Z",
        },
      },
      openPositions: [
        {
          key: "MSLE|2026-08-30",
          ticker: "MSLE",
          capitalEur: 5000,
          pnlEur: 100,
          pnlPct: 2,
        },
      ],
    } as unknown as MobileDashboardSnapshot;

    const out = resolveInputsFromDesktopSnapshot(snap, persisted);
    expect(out.inputs["MSLE|2026-08-30"]?.capital).toBe(5000);
    expect(out.inputs["MSLE|2026-08-30"]?.ignoreSheet).toBe(false);
    expect(out.inputs["MSLE|2026-08-30"]?.soldAt).toBeUndefined();
    // Stale VPS soldAt (>15m) must not wipe Pulse open; keep/reopen authority book.
    expect(out.inputs["MSLE|2026-08-30"]?.buyPrice).toBe(8.98);
    expect(openBookCapital(out.inputs)).toBe(5000);
  });
});
