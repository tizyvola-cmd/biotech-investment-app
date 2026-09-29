import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAdviceSuccessFreezeKey,
  resolveAdviceSuccessKpiDisplay,
  loadAdviceSuccessCloseSnapshot,
} from "./adviceSuccessCloseSnapshot";

describe("buildAdviceSuccessFreezeKey", () => {
  it("uses last NYSE close session, not live prices", () => {
    const sun = new Date("2026-07-05T16:00:00Z");
    expect(buildAdviceSuccessFreezeKey("en", sun)).toBe("en|2026-07-02");
    const tueBeforeClose = new Date("2026-07-07T18:00:00Z");
    expect(buildAdviceSuccessFreezeKey("it", tueBeforeClose)).toBe("it|2026-07-06");
  });

  it("advances after regular NYSE close on a trading day", () => {
    const tueAfterClose = new Date("2026-07-07T22:00:00Z");
    expect(buildAdviceSuccessFreezeKey("en", tueAfterClose)).toBe("en|2026-07-07");
  });
});

describe("resolveAdviceSuccessKpiDisplay", () => {
  beforeEach(() => {
    vi.stubGlobal("window", globalThis);
  });

  it("returns cached display when close session key matches", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    });

    const key = "en|2026-07-02";
    resolveAdviceSuccessKpiDisplay(key, () => ({
      value: "75%",
      sub: "advice 75%",
    }));
    const second = resolveAdviceSuccessKpiDisplay(key, () => ({
      value: "66.7%",
      sub: "advice 66.7%",
    }));
    expect(second.value).toBe("75%");
    expect(second.frozen).toBe(true);
    expect(second.closeSessionKey).toBe("2026-07-02");
    expect(loadAdviceSuccessCloseSnapshot()?.value).toBe("75%");

    vi.unstubAllGlobals();
  });

  it("does not cache or reuse dash placeholders", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    });

    const key = "it|2026-07-03";
    resolveAdviceSuccessKpiDisplay(key, () => ({
      value: "—",
      sub: "sim 95.9%",
    }));
    expect(loadAdviceSuccessCloseSnapshot()).toBeNull();

    resolveAdviceSuccessKpiDisplay(key, () => ({
      value: "95.9%",
      sub: "sim 95.9%",
    }));
    expect(loadAdviceSuccessCloseSnapshot()?.value).toBe("95.9%");

    const second = resolveAdviceSuccessKpiDisplay(key, () => ({
      value: "—",
      sub: "sim 50%",
    }));
    expect(second.value).toBe("95.9%");
    expect(second.frozen).toBe(true);

    vi.unstubAllGlobals();
  });
});
