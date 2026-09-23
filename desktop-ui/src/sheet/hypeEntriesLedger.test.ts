import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetHypeEntriesLedger,
  dismissHypeEntriesPanel,
  hypeEntriesDismissSignature,
  isHypeEntriesPanelDismissed,
  listWeeklyNewHypeEntries,
  recordCurrentHypeTickers,
} from "./hypeEntriesLedger";

describe("hypeEntriesLedger", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
      dispatchEvent: vi.fn(),
    });
    _resetHypeEntriesLedger();
  });

  it("backdates bootstrap tickers so they don't flood 'this week'", () => {
    const weekly = recordCurrentHypeTickers(["CANF", "TCRX", "BIAF", "BJDX", "BTAI"]);
    // All bootstrapped 8 days ago → none should be in the 7-day window.
    expect(weekly).toEqual([]);
    expect(
      listWeeklyNewHypeEntries(["CANF", "TCRX", "BIAF", "BJDX", "BTAI"]),
    ).toEqual([]);
  });

  it("flags genuinely new hype tickers on subsequent snapshots", () => {
    recordCurrentHypeTickers(["CANF", "TCRX"]);
    const weekly = recordCurrentHypeTickers(["CANF", "TCRX", "BIAF"]);
    // BIAF was NOT in the bootstrap set → arrives now → new this week.
    expect(weekly.map((r) => r.ticker)).toContain("BIAF");
    expect(weekly.map((r) => r.ticker)).not.toContain("CANF");
    expect(weekly.map((r) => r.ticker)).not.toContain("TCRX");
  });

  it("does not report tickers dropped from the current hype set", () => {
    recordCurrentHypeTickers(["CANF", "TCRX"]);
    recordCurrentHypeTickers(["CANF", "TCRX", "BIAF"]);
    // BIAF is genuinely new (from the previous test's shape) — verify then drop it.
    expect(listWeeklyNewHypeEntries(["CANF", "TCRX", "BIAF"]).map((r) => r.ticker)).toContain(
      "BIAF",
    );
    // If BIAF disappears from the current hype set, it must not surface.
    expect(listWeeklyNewHypeEntries(["CANF", "TCRX"]).map((r) => r.ticker)).not.toContain(
      "BIAF",
    );
  });

  it("stays dismissed when a ticker leaves; reopens only for a new ticker", () => {
    expect(hypeEntriesDismissSignature(["TCRX", "CANF", "BIAF"])).toBe("BIAF|CANF|TCRX");
    expect(isHypeEntriesPanelDismissed(["CANF", "TCRX", "BIAF"])).toBe(false);
    dismissHypeEntriesPanel(["CANF", "TCRX", "BIAF"]);
    expect(isHypeEntriesPanelDismissed(["CANF", "TCRX", "BIAF"])).toBe(true);
    // Hold expired / drop-out must not reopen.
    expect(isHypeEntriesPanelDismissed(["CANF", "TCRX"])).toBe(true);
    // A genuinely new name reopens.
    expect(isHypeEntriesPanelDismissed(["CANF", "TCRX", "BIAF", "BJDX"])).toBe(false);
    dismissHypeEntriesPanel(["CANF", "TCRX", "BIAF", "BJDX"]);
    expect(isHypeEntriesPanelDismissed(["CANF", "TCRX", "BIAF", "BJDX"])).toBe(true);
  });

  it("migrates the v1 exact signature into a dismissed ticker set", () => {
    window.localStorage.setItem("supernova.hypeEntriesWeek.dismissedSig.v1", "BIAF|CANF|TCRX");
    expect(isHypeEntriesPanelDismissed(["CANF", "TCRX"])).toBe(true);
    expect(isHypeEntriesPanelDismissed(["CANF", "TCRX", "BJDX"])).toBe(false);
  });

  it("uppercases and trims tickers", () => {
    const weekly = recordCurrentHypeTickers([" canf ", "tcrx"]);
    expect(weekly).toEqual([]);
    // Bootstrap set — nothing weekly. Check the second call surfaces a new one.
    const next = recordCurrentHypeTickers([" canf ", "tcrx", "biaf"]);
    expect(next.map((r) => r.ticker)).toContain("BIAF");
  });
});
