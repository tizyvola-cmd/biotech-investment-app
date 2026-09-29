import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetNewEntriesLedger,
  dismissNewEntriesPanel,
  isNewEntriesPanelDismissed,
  listWeeklyNewEntries,
  newEntriesDismissSignature,
  normalizeNewEntryTicker,
  recordCurrentTickers,
} from "./newEntriesLedger";

describe("newEntriesLedger warrant/common unify", () => {
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
    _resetNewEntriesLedger();
  });

  it("normalizes JSPRW → JSPR", () => {
    expect(normalizeNewEntryTicker("JSPRW")).toBe("JSPR");
    expect(normalizeNewEntryTicker("jspr")).toBe("JSPR");
  });

  it("does not treat JSPR as new when JSPRW was already known", () => {
    // Bootstrap with warrant in cohort.
    recordCurrentTickers(["JSPRW", "VIR"]);
    // Later the common appears — must inherit warrant firstSeen (backdated).
    const weekly = recordCurrentTickers(["JSPR", "VIR"]);
    expect(weekly.map((r) => r.ticker)).not.toContain("JSPR");
    expect(listWeeklyNewEntries(["JSPR", "VIR"]).map((r) => r.ticker)).not.toContain(
      "JSPR",
    );
  });

  it("still flags a genuinely new common after bootstrap", () => {
    recordCurrentTickers(["VIR"]);
    const weekly = recordCurrentTickers(["VIR", "SKYE"]);
    expect(weekly.map((r) => r.ticker)).toContain("SKYE");
  });

  it("stays dismissed when a ticker leaves; reopens only for a new ticker", () => {
    expect(newEntriesDismissSignature(["ZNTL", "BIOA"])).toBe("BIOA|ZNTL");
    expect(isNewEntriesPanelDismissed(["BIOA", "ZNTL"])).toBe(false);
    dismissNewEntriesPanel(["BIOA", "ZNTL"]);
    expect(isNewEntriesPanelDismissed(["BIOA", "ZNTL"])).toBe(true);
    // Drop-out must not reopen.
    expect(isNewEntriesPanelDismissed(["BIOA"])).toBe(true);
    // A genuinely new name reopens.
    expect(isNewEntriesPanelDismissed(["BIOA", "ZNTL", "KZIA"])).toBe(false);
    dismissNewEntriesPanel(["BIOA", "ZNTL", "KZIA"]);
    expect(isNewEntriesPanelDismissed(["BIOA", "ZNTL", "KZIA"])).toBe(true);
  });

  it("migrates the v1 exact signature into a dismissed ticker set", () => {
    window.localStorage.setItem("supernova.newEntriesWeek.dismissedSig.v1", "BIOA|ZNTL");
    expect(isNewEntriesPanelDismissed(["BIOA"])).toBe(true);
    expect(isNewEntriesPanelDismissed(["BIOA", "ZNTL", "KZIA"])).toBe(false);
  });
});
