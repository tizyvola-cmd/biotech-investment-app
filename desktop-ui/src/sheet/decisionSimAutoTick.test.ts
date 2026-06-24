import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { tryRunDecisionSimAutoTick } from "./decisionSimAutoTick";
import { DECISION_SIM_TICK_FAILED_EVENT } from "./investDecisionSimStorage";
import { defaultDecisionSimState } from "./investDecisionSimStorage";
import * as loop from "./investDecisionSimLoop";
import * as storage from "./investDecisionSimStorage";

function installBrowserShim(): { restore: () => void; events: Array<{ type: string; detail: unknown }> } {
  const store = new Map<string, string>();
  const events: Array<{ type: string; detail: unknown }> = [];
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  const w = {
    localStorage,
    dispatchEvent: (e: { type: string; detail?: unknown }) => {
      events.push({ type: e.type, detail: e.detail });
      return true;
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousCustomEvent = (globalThis as { CustomEvent?: unknown }).CustomEvent;
  (globalThis as { window?: unknown }).window = w;
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class {
    type: string;
    detail?: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  return {
    events,
    restore: () => {
      (globalThis as { window?: unknown }).window = previousWindow;
      (globalThis as { CustomEvent?: unknown }).CustomEvent = previousCustomEvent;
    },
  };
}

describe("tryRunDecisionSimAutoTick", () => {
  let shim: ReturnType<typeof installBrowserShim>;

  beforeEach(() => {
    shim = installBrowserShim();
    vi.spyOn(storage, "shouldRunDecisionSimTick").mockReturnValue(true);
    vi.spyOn(loop, "runDecisionSimMarkTick").mockImplementation(() => {
      throw new Error("sim mark boom");
    });
  });

  afterEach(() => {
    shim.restore();
    vi.restoreAllMocks();
  });

  it("catches tick errors and dispatches failure event instead of throwing", async () => {
    const enabled = {
      ...defaultDecisionSimState(),
      config: {
        ...defaultDecisionSimState().config,
        enabled: true,
        experimentMode: true,
      },
      lastTickAt: null,
    };
    vi.spyOn(storage, "loadDecisionSimState").mockReturnValue(enabled);
    vi.spyOn(storage, "isDecisionSimRunExpired").mockReturnValue(false);

    const ok = await tryRunDecisionSimAutoTick({
      simTable: { columns: ["Ticker"], rows: [{ Ticker: "AAA" }] },
      inputs: { rows: {} },
      pointsBySeriesKey: new Map(),
      lang: "en",
      probOptions: null,
    });

    expect(ok).toBe(false);
    expect(shim.events.some((e) => e.type === DECISION_SIM_TICK_FAILED_EVENT)).toBe(true);
  });
});
