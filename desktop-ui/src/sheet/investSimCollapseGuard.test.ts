import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  forceRestoreOpenBookFromServer,
  loadInvestSimInputs,
  persistInvestSimInputs,
  saveInvestSimInputs,
  type InvestSimInputs,
} from "./investSimStorage";
import { sumOpenCapital } from "./investSimKeys";

const store = new Map<string, string>();

function installLocalStorage() {
  const ls = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
  vi.stubGlobal("localStorage", ls);
  vi.stubGlobal("window", {
    localStorage: ls,
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

describe("open-book collapse guard", () => {
  beforeEach(() => {
    store.clear();
    installLocalStorage();
  });
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refuses to overwrite a full open book with a collapsed one lacking sells", () => {
    const full: InvestSimInputs = {
      "BNTX|2026-07-31": { buyPrice: 90, capital: 4063, ignoreSheet: false },
      "CERS|2026-07-30": { buyPrice: 3, capital: 2279, ignoreSheet: false },
      "BIIB|2026-09-27": { buyPrice: 200, capital: 4062, ignoreSheet: false },
      "VIR|2026-09-25": { buyPrice: 10, capital: 4062, ignoreSheet: false },
      "CHRS|2026-09-30": { buyPrice: 1.4, capital: 13, ignoreSheet: false },
    };
    saveInvestSimInputs(full, { allowBogusCollapse: true });
    expect(sumOpenCapital(loadInvestSimInputs())).toBeGreaterThan(14_000);

    const collapsed: InvestSimInputs = {
      "BIIB|2026-09-27": { buyPrice: 200, capital: 4062, ignoreSheet: false },
      "VIR|2026-09-25": { buyPrice: 10, capital: 4062, ignoreSheet: false },
      "CHRS|2026-09-30": { buyPrice: 1.4, capital: 13, ignoreSheet: false },
      "BNTX|2026-07-31": { buyPrice: 0, capital: 0, ignoreSheet: false },
      "CERS|2026-07-30": { buyPrice: 0, capital: 0, ignoreSheet: false },
    };
    persistInvestSimInputs(collapsed);
    expect(sumOpenCapital(loadInvestSimInputs())).toBeGreaterThan(14_000);
  });

  it("allows a real Sell that marks soldAt", () => {
    const full: InvestSimInputs = {
      "BNTX|2026-07-31": { buyPrice: 90, capital: 4063, ignoreSheet: false },
      "BIIB|2026-09-27": { buyPrice: 200, capital: 4062, ignoreSheet: false },
      "VIR|2026-09-25": { buyPrice: 10, capital: 4062, ignoreSheet: false },
      "MSLE|2026-08-30": { buyPrice: 9, capital: 5000, ignoreSheet: false },
    };
    saveInvestSimInputs(full, { allowBogusCollapse: true });
    const afterSell: InvestSimInputs = {
      ...full,
      "BNTX|2026-07-31": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-22T10:00:00.000Z",
        closedCapital: 4063,
        closedPnlEur: 100,
      },
      "MSLE|2026-08-30": {
        buyPrice: 0,
        capital: 0,
        ignoreSheet: true,
        soldAt: "2026-07-22T10:01:00.000Z",
        closedCapital: 5000,
        closedPnlEur: -50,
      },
    };
    persistInvestSimInputs(afterSell);
    const loaded = loadInvestSimInputs();
    expect(loaded["BNTX|2026-07-31"]?.ignoreSheet).toBe(true);
    expect(sumOpenCapital(loaded)).toBe(8124);
  });
});

describe("forceRestoreOpenBookFromServer", () => {
  beforeEach(() => {
    store.clear();
    installLocalStorage();
  });
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reopens vanished names from the richest API book", async () => {
    const collapsed: InvestSimInputs = {
      "BIIB|2026-09-27": { buyPrice: 200, capital: 4062, ignoreSheet: false },
      "VIR|2026-09-25": { buyPrice: 10, capital: 4062, ignoreSheet: false },
      "CHRS|2026-09-30": { buyPrice: 1.4, capital: 13, ignoreSheet: false },
    };
    saveInvestSimInputs(collapsed, { allowBogusCollapse: true });

    const rich = {
      version: 1,
      updated_at: "2026-07-22T08:00:00.000Z",
      inputs: {
        ...collapsed,
        "BNTX|2026-07-31": { buyPrice: 90, capital: 4063, ignoreSheet: false },
        "CERS|2026-07-30": { buyPrice: 3, capital: 2279, ignoreSheet: false },
        "SYRE|2026-08-19": { buyPrice: 100, capital: 1690, ignoreSheet: false },
        "MSLE|2026-08-30": { buyPrice: 9, capital: 5000, ignoreSheet: false },
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/investment/sim-inputs") && !url.includes("PUT")) {
          return new Response(JSON.stringify(rich), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    vi.spyOn(await import("../data/projectData"), "fetchProjectJson").mockResolvedValue({
      data: null,
      error: null,
    } as never);
    vi.spyOn(await import("../api/investSim"), "saveInvestSimInputsPersisted").mockResolvedValue();

    const result = await forceRestoreOpenBookFromServer();
    expect(result.ok).toBe(true);
    expect(result.restoredKeys).toEqual(
      expect.arrayContaining(["BNTX|2026-07-31", "CERS|2026-07-30", "SYRE|2026-08-19"]),
    );
    expect(sumOpenCapital(loadInvestSimInputs())).toBeGreaterThan(20_000);
  });
});
