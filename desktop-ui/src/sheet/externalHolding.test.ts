import { describe, expect, it } from "vitest";
import { bookMarkToMarket, pickCanonicalSimRowForTicker, prepareExternalHolding } from "./externalHolding";
import { bookMarkToMarket as bookMtmShared } from "./bookMarkToMarket";

function row(ticker: string, cd: string, price = 10): Record<string, unknown> {
  return { Ticker: ticker, "Completion Date": cd, "Prezzo Corrente ($)": price };
}

describe("pickCanonicalSimRowForTicker", () => {
  it("picks the soonest future CD", () => {
    const picked = pickCanonicalSimRowForTicker(
      [row("CPIX", "2099-12-01"), row("CPIX", "2099-06-01"), row("VRTX", "2099-01-01")],
      "cpix",
    );
    expect(picked?.["Completion Date"]).toBe("2099-06-01");
  });

  it("returns null when the ticker is not in the universe", () => {
    expect(pickCanonicalSimRowForTicker([row("CPIX", "2099-06-01")], "ZZZZ")).toBeNull();
  });
});

describe("prepareExternalHolding", () => {
  const rows = [row("CPIX", "2099-06-01", 6.99)];

  it("prepares a real-book entry without Soft BUY gates", () => {
    const ready = prepareExternalHolding(rows, {}, { ticker: "cpix", capitalEur: 6000 });
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.key).toBe("CPIX|2099-06-01");
    expect(ready.buyPrice).toBe(6.99);
    expect(ready.capitalEur).toBe(6000);
  });

  it("uses the typed fill price when provided", () => {
    const ready = prepareExternalHolding(rows, {}, {
      ticker: "CPIX",
      capitalEur: 1000,
      buyPriceUsd: 5.5,
    });
    expect(ready.ok).toBe(true);
    if (!ready.ok) return;
    expect(ready.buyPrice).toBe(5.5);
  });

  it("allows a re-add when Pulse hid a leftover ghost after sell", () => {
    const zntlRows = [row("ZNTL", "2099-06-01", 3.98)];
    const check = prepareExternalHolding(
      zntlRows,
      {
        "ZNTL|2026-01-01": {
          buyPrice: 4,
          capital: 5000,
          ignoreSheet: false,
          investedAt: "2026-08-01T10:00:00.000Z",
        },
        "ZNTL|2099-06-01": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          soldAt: "2026-09-04T16:00:00.000Z",
          closedPnlEur: -120,
        },
      },
      { ticker: "ZNTL", capitalEur: 5000, buyPriceUsd: 3.98 },
    );
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.key).toBe("ZNTL|2099-06-01");
    expect(check.capitalEur).toBe(5000);
  });

  it("allows a re-add after the same ticker was sold", () => {
    const check = prepareExternalHolding(
      rows,
      {
        "CPIX|2099-06-01": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          soldAt: "2026-09-04T16:00:00.000Z",
          closedPnlEur: -80,
        },
      },
      { ticker: "CPIX", capitalEur: 6000 },
    );
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.capitalEur).toBe(6000);
  });

  it("rejects a ticker already open", () => {
    const check = prepareExternalHolding(
      rows,
      { "CPIX|2099-06-01": { buyPrice: 6, capital: 1000, ignoreSheet: false } },
      { ticker: "CPIX", capitalEur: 1000 },
    );
    expect(check).toEqual({ ok: false, reason: "already_open" });
  });

  it("marks P&L from typed capital and buy vs live price", () => {
    const mtm = bookMarkToMarket({ capital: 6000, buyPrice: 6 }, 6.6);
    expect(mtm).toEqual({
      shares: 1000,
      valueNow: 6600,
      pnlEur: 600,
      pnlPct: 10,
    });
    expect(bookMtmShared({ capital: 6000, buyPrice: 6 }, 6.6)).toEqual(mtm);
  });

  it("rejects names missing from Simulation", () => {
    expect(prepareExternalHolding(rows, {}, { ticker: "NOPE", capitalEur: 1000 })).toEqual({
      ok: false,
      reason: "not_in_universe",
    });
  });
});
