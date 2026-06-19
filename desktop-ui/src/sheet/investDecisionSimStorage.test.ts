import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  DECISION_SIM_STORAGE_KEY,
  defaultDecisionSimState,
  ensureTickPiggyOpenMtmForStorage,
  loadDecisionSimState,
  saveDecisionSimState,
  shouldRunDecisionSimTick,
} from "./investDecisionSimStorage";
import type { DecisionSimTick } from "./investDecisionSimLoop";

// Minimal browser shim — the vitest config uses the "node" env, but the storage
// helpers gate on `typeof window === "undefined"` and call window.localStorage.
function installBrowserShim(): { restore: () => void } {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  const w = {
    localStorage,
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousCustomEvent = (globalThis as { CustomEvent?: unknown }).CustomEvent;
  const previousLocalStorage = (globalThis as { localStorage?: typeof localStorage }).localStorage;
  (globalThis as { window?: unknown }).window = w;
  (globalThis as { localStorage?: typeof localStorage }).localStorage = localStorage;
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class {
    constructor(
      public type: string,
      public init?: unknown,
    ) {}
  };
  return {
    restore: () => {
      (globalThis as { window?: unknown }).window = previousWindow;
      (globalThis as { localStorage?: typeof localStorage }).localStorage = previousLocalStorage;
      (globalThis as { CustomEvent?: unknown }).CustomEvent = previousCustomEvent;
    },
  };
}

function romeWallToUtc(ymd: string, hour: number): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  for (let utcH = 0; utcH < 24; utcH += 1) {
    const candidate = new Date(Date.UTC(y, m - 1, d, utcH, 0));
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Rome",
      hour: "2-digit",
      hour12: false,
    });
    const h = Number(fmt.format(candidate));
    if (h === hour) return candidate;
  }
  throw new Error("no map");
}

describe("shouldRunDecisionSimTick market window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("blocks ticks outside Mon–Fri 15–22 Rome", () => {
    const state = {
      ...defaultDecisionSimState(),
      config: {
        ...defaultDecisionSimState().config,
        enabled: true,
        experimentMode: true,
        intervalHours: 1,
      },
      lastTickAt: null,
    };
    const saturday = romeWallToUtc("2026-06-13", 16);
    expect(shouldRunDecisionSimTick(state, saturday)).toBe(false);
  });

  it("allows first tick inside window", () => {
    const state = {
      ...defaultDecisionSimState(),
      config: {
        ...defaultDecisionSimState().config,
        enabled: true,
        experimentMode: true,
        intervalHours: 1,
      },
      lastTickAt: null,
    };
    const wed = romeWallToUtc("2026-06-10", 16);
    expect(shouldRunDecisionSimTick(state, wed)).toBe(true);
  });
});

describe("loadDecisionSimState — maxOpenPositions migration", () => {
  let shim: ReturnType<typeof installBrowserShim>;
  beforeEach(() => {
    shim = installBrowserShim();
  });

  afterEach(() => {
    shim.restore();
  });

  it("force-uncaps legacy finite maxOpenPositions values on load", () => {
    // Legacy state with explicit cap=8 — represents users who carried over
    // an old default. The current sim policy is "no cap": invest in every BUY.
    (globalThis as { window: { localStorage: Storage } }).window.localStorage.setItem(
      DECISION_SIM_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        config: {
          enabled: true,
          intervalHours: 1,
          startedAt: null,
          endsAt: null,
          capitalPerTrade: 5000,
          maxOpenPositions: 8,
          experimentMode: false,
        },
        paperPortfolio: [],
        ticks: [],
        lastTickAt: null,
        cumulativePaperPnlEur: 0,
        closedTradeCount: 0,
      }),
    );
    const loaded = loadDecisionSimState();
    expect(loaded.config.maxOpenPositions).toBe(Number.POSITIVE_INFINITY);
  });

  it("also uncaps when the stored value is null (JSON-serialized Infinity)", () => {
    (globalThis as { window: { localStorage: Storage } }).window.localStorage.setItem(
      DECISION_SIM_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        config: {
          ...defaultDecisionSimState().config,
          maxOpenPositions: null,
        },
      }),
    );
    const loaded = loadDecisionSimState();
    expect(loaded.config.maxOpenPositions).toBe(Number.POSITIVE_INFINITY);
  });

  it("returns default state when no value is persisted", () => {
    const loaded = loadDecisionSimState();
    expect(loaded.config.maxOpenPositions).toBe(Number.POSITIVE_INFINITY);
    expect(loaded.paperPortfolio).toEqual([]);
  });
});

describe("ensureTickPiggyOpenMtmForStorage — §1.1", () => {
  let shim: ReturnType<typeof installBrowserShim>;
  beforeEach(() => {
    shim = installBrowserShim();
  });
  afterEach(() => {
    shim.restore();
  });

  const position = {
    key: "AAA|cd",
    ticker: "AAA",
    capital: 5000,
    entryAt: "2026-06-01T10:00:00.000Z",
    entryReason: "buy",
    entryPlanReturnPct: 10,
    lastMarkPct: -10,
  };

  function tickWithPiggy(piggy: {
    openMtmPnlEur: number;
    closedPnlEur: number;
    totalPnlEur: number;
  }): DecisionSimTick {
    return {
      id: "t1",
      at: "2026-06-18T12:00:00.000Z",
      evaluations: [],
      portfolioBefore: [],
      portfolioAfter: [position],
      trades: [],
      summary: {
        evaluatedTickers: 1,
        misalignedTickers: 0,
        harmonyAlignedPct: 100,
        precatVerdictAgree: 1,
        buySignals: 0,
        sellSignals: 0,
        holdSignals: 1,
        reviewSignals: 0,
        tradesExecuted: 0,
        misalignmentByType: {},
        piggyBank: {
          openCapitalEur: 5000,
          openMtmPnlEur: piggy.openMtmPnlEur,
          closedPnlEur: piggy.closedPnlEur,
          totalPnlEur: piggy.totalPnlEur,
          openPositionCount: 1,
          closedTradeCount: 1,
        },
      },
    };
  }

  it("fills openMtmPnlEur from lastMarkPct when piggy stored zero", () => {
    const repaired = ensureTickPiggyOpenMtmForStorage(
      tickWithPiggy({ openMtmPnlEur: 0, closedPnlEur: 1246, totalPnlEur: 0 }),
    );
    expect(repaired.summary.piggyBank?.openMtmPnlEur).toBe(-500);
    expect(repaired.summary.piggyBank?.totalPnlEur).toBe(746);
  });

  it("persists repaired openMtm through saveDecisionSimState compact path", () => {
    saveDecisionSimState({
      ...defaultDecisionSimState(),
      ticks: [
        tickWithPiggy({ openMtmPnlEur: 0, closedPnlEur: 1246, totalPnlEur: 0 }),
      ],
    });
    const raw = JSON.parse(
      (globalThis as { window: { localStorage: Storage } }).window.localStorage.getItem(
        DECISION_SIM_STORAGE_KEY,
      )!,
    ) as { ticks: DecisionSimTick[] };
    expect(raw.ticks[0]?.summary.piggyBank?.openMtmPnlEur).toBe(-500);
    expect(raw.ticks[0]?.evaluations).toEqual([]);
  });

  it("leaves tick unchanged when openMtmPnlEur already populated", () => {
    const tick = tickWithPiggy({ openMtmPnlEur: -3547, closedPnlEur: 1246, totalPnlEur: -2301 });
    const repaired = ensureTickPiggyOpenMtmForStorage(tick);
    expect(repaired.summary.piggyBank?.openMtmPnlEur).toBe(-3547);
    expect(repaired.summary.piggyBank?.totalPnlEur).toBe(-2301);
  });
});
