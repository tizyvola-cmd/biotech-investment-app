import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualFeedEventDraft } from "./manualFeedEvents";
import { resolveManualEisConfirmedDisplay } from "./manualEisConfirmedDisplay";

const manualStore: ManualFeedEventDraft[] = [];

vi.mock("./manualFeedEvents", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./manualFeedEvents")>();
  return {
    ...orig,
    loadManualFeedEvents: () => manualStore,
  };
});

vi.mock("./manualFeedPersistence", () => ({
  scheduleManualFeedStoreDiskFlush: vi.fn(),
}));

describe("manualEisConfirmedDisplay", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    manualStore.length = 0;
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => {
        storage.set(k, v);
      },
      removeItem: (k: string) => {
        storage.delete(k);
      },
    });
    vi.stubGlobal("window", {
      localStorage,
      dispatchEvent: vi.fn(),
    });
  });

  it("returns positive gain manual EIS with star while move matches anchor", () => {
    manualStore.push({
      id: "cpix-1",
      createdAt: "2026-07-05",
      ticker: "CPIX",
      eventDate: "2026-07-05",
      source: "Manual",
      title: "CPIX — Confirmed Cause: Closing of the Sale to Apotex for $100M",
      body: "Shareholder approval June 25. Closing July 1. +8.95% price move aligns with this sequence.",
      investigationContext: "gain",
      priceDropPct: 8.95,
    });
    const d = resolveManualEisConfirmedDisplay("CPIX", 8.95);
    expect(d).not.toBeNull();
    expect(d!.score).toBeGreaterThan(0);
    expect(d!.showStar).toBe(true);
    expect(d!.polarity).toBe("positive");
  });

  it("returns negative loss manual EIS without star", () => {
    manualStore.push({
      id: "vir-1",
      createdAt: "2026-07-04",
      ticker: "VIR",
      eventDate: "2026-07-04",
      source: "Manual",
      title: "VIR trial missed primary endpoint — FDA path delayed",
      body: "Topline missed primary endpoint; complete response letter expected.",
      priceDropPct: -4.2,
      investigationContext: "loss",
    });
    const d = resolveManualEisConfirmedDisplay("VIR", -4.2);
    expect(d).not.toBeNull();
    expect(d!.score).toBeLessThan(0);
    expect(d!.showStar).toBe(false);
    expect(d!.polarity).toBe("negative");
  });

  it("returns positive feed manual EIS with star without 24h context", () => {
    manualStore.push({
      id: "bdsx-1",
      createdAt: "2026-07-05",
      ticker: "BDSX",
      eventDate: "2026-07-05",
      source: "Manual",
      title: "Biodesix pulled in roughly $17.2M in gross proceeds",
      body: "Positive catalyst for funding runway and operational stability.",
      sentiment: 1.2,
    });
    const d = resolveManualEisConfirmedDisplay("BDSX");
    expect(d).not.toBeNull();
    expect(d!.score).toBeGreaterThan(0);
    expect(d!.showStar).toBe(true);
    expect(d!.polarity).toBe("positive");
  });

  it("returns null for unconfirmed manual news", () => {
    manualStore.push({
      id: "x-1",
      createdAt: "2026-07-05",
      ticker: "X",
      eventDate: "2026-07-05",
      source: "Manual",
      title: "X — no catalyst",
      body: "Market noise only, no company-specific news found.",
      investigationContext: "loss",
    });
    expect(resolveManualEisConfirmedDisplay("X", -2)).toBeNull();
  });
});
