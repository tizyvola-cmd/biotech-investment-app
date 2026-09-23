import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GAIN_STAR_COLORS,
  GAIN_STAR_COLOR_COUNT,
  GAIN_STAR_LEDGER_STORAGE_KEY,
  gainStarColorForIndex,
  gainStarStillAnchored,
  getTickerGainStars,
  isNewMaterialPriceMove,
  loadGainStarLedger,
  manualEventQualifiesForGainStarDay,
  refreshGainStarLedger,
} from "./gainStarLedger";
import type { ManualFeedEventDraft } from "./manualFeedEvents";

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

function manual24hDraft(
  ticker: string,
  eventDate: string,
  priceDropPct: number,
  context: "loss" | "gain" = "gain",
  body = "Topline met primary endpoint with statistical significance.",
): ManualFeedEventDraft {
  return {
    id: `${ticker}-${eventDate}`,
    createdAt: eventDate,
    ticker,
    eventDate,
    source: "Manual",
    title: `${ticker} Phase 3 met primary endpoint — FDA path accelerated`,
    body,
    priceDropPct,
    investigationContext: context,
  };
}

describe("gainStarLedger", () => {
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

  it("shows anchored star until a new material price move", () => {
    manualStore.push(manual24hDraft("BNTX", "2026-07-01", 2.5));
    refreshGainStarLedger();
    expect(getTickerGainStars("BNTX", 2.5)).toHaveLength(1);
    expect(getTickerGainStars("BNTX", 2.3)).toHaveLength(1);
    expect(getTickerGainStars("BNTX", -2.0)).toHaveLength(0);
  });

  it("carries star through weekend when move unchanged", () => {
    manualStore.push(manual24hDraft("BNTX", "2026-06-12", 2.5));
    refreshGainStarLedger();
    expect(getTickerGainStars("BNTX", 2.5)).toHaveLength(1);
    expect(getTickerGainStars("BNTX", 2.4)).toHaveLength(1);
  });

  it("keeps star on Monday when move still matches anchor", () => {
    manualStore.push(manual24hDraft("BNTX", "2026-06-12", 2.5));
    refreshGainStarLedger();
    expect(getTickerGainStars("BNTX", 2.5)).toHaveLength(1);
  });

  it("rotates color on a new qualifying save day", () => {
    manualStore.push(manual24hDraft("BNTX", "2026-07-01", 2.5));
    refreshGainStarLedger();
    manualStore.push(manual24hDraft("BNTX", "2026-07-02", 1.8));
    refreshGainStarLedger();

    expect(getTickerGainStars("BNTX", 1.8)[0]!.color).toBe(gainStarColorForIndex(1));
    expect(getTickerGainStars("BNTX", 1.8)[0]!.color).not.toBe(gainStarColorForIndex(0));
  });

  it("wraps palette after five qualifying days", () => {
    const tradingDays = [
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-15",
    ];
    for (let i = 0; i < tradingDays.length; i++) {
      manualStore.push(manual24hDraft("LTRN", tradingDays[i]!, 2 + i * 0.1));
    }
    refreshGainStarLedger();
    const stars = getTickerGainStars("LTRN", 2.5);
    expect(stars).toHaveLength(1);
    expect(stars[0]!.colorIndex).toBe(5 % GAIN_STAR_COLOR_COUNT);
    expect(stars[0]!.color).toBe(GAIN_STAR_COLORS[0]);
  });

  it("ignores Feed-tab events without 24h context", () => {
    manualStore.push({
      id: "feed-1",
      createdAt: "2026-07-04",
      ticker: "MRNA",
      eventDate: "2026-07-04",
      source: "Manual",
      title: "MRNA Phase 3 met primary endpoint",
      body: "Topline met primary endpoint with statistical significance.",
    });
    refreshGainStarLedger();
    expect(getTickerGainStars("MRNA", 2)).toHaveLength(0);
  });

  it("does not show star for negative catalyst loss EIS", () => {
    manualStore.push({
      id: "loss-1",
      createdAt: "2026-07-04",
      ticker: "VIR",
      eventDate: "2026-07-04",
      source: "Manual",
      title: "VIR trial missed primary endpoint — FDA path delayed",
      body: "Topline missed primary endpoint; complete response letter expected.",
      priceDropPct: -4.2,
      investigationContext: "loss",
    });
    refreshGainStarLedger();
    expect(getTickerGainStars("VIR", -4.2)).toHaveLength(0);
    expect(loadGainStarLedger().VIR ?? []).toHaveLength(0);
  });

  it("keeps one ledger entry per ticker per day", () => {
    manualStore.push(manual24hDraft("BNTX", "2026-07-03", 3));
    refreshGainStarLedger();
    refreshGainStarLedger();
    expect(loadGainStarLedger().BNTX).toHaveLength(1);
    expect(getTickerGainStars("BNTX", 3)).toHaveLength(1);
  });

  it("manualEventQualifiesForGainStarDay requires 24h context and gain move", () => {
    const flat = manual24hDraft("X", "2026-07-01", 0.2);
    expect(manualEventQualifiesForGainStarDay(flat)).toBe(false);
    const up = manual24hDraft("X", "2026-07-01", 2);
    expect(manualEventQualifiesForGainStarDay(up)).toBe(true);
  });

  it("qualifies CPIX-like M&A manual EIS when +% move is cited in prose", () => {
    manualStore.push({
      id: "cpix-1",
      createdAt: "2026-07-05",
      ticker: "CPIX",
      eventDate: "2026-07-05",
      source: "Manual",
      title: "CPIX — Confirmed Cause: Closing of the Sale to Apotex for $100M",
      body: "Shareholder approval June 25. Closing July 1. +8.95% price move aligns with this sequence.",
    });
    refreshGainStarLedger();
    expect(loadGainStarLedger().CPIX?.[0]?.date).toBe("2026-07-02");
    const stars = getTickerGainStars("CPIX", 8.95);
    expect(stars).toHaveLength(1);
    expect(stars[0]!.context).toBe("gain");
    expect(stars[0]!.eisScore).toBeGreaterThan(0);
  });

  it("persists ledger in localStorage", () => {
    manualStore.push(manual24hDraft("BIIB", "2026-07-06", 1.5));
    refreshGainStarLedger();
    const raw = localStorage.getItem(GAIN_STAR_LEDGER_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(loadGainStarLedger().BIIB).toHaveLength(1);
  });

  it("isNewMaterialPriceMove detects sign flip and magnitude change", () => {
    expect(isNewMaterialPriceMove(8.9, 8.5)).toBe(false);
    expect(isNewMaterialPriceMove(8.9, 4.5)).toBe(true);
    expect(isNewMaterialPriceMove(8.9, 1.0)).toBe(true);
    expect(isNewMaterialPriceMove(8.9, -2.0)).toBe(true);
    expect(gainStarStillAnchored({ date: "x", source: "manual", eisScore: 7, colorIndex: 0, context: "gain", anchorMovePct: 8.9 }, 8.7)).toBe(true);
    expect(gainStarStillAnchored({ date: "x", source: "manual", eisScore: 7, colorIndex: 0, context: "gain", anchorMovePct: 8.9 }, -1.2)).toBe(false);
  });
});
