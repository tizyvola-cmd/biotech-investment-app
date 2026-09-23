import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManualFeedEventDraft } from "./manualFeedEvents";
import {
  lastManualFeedEventDate,
  manualEisMarkDisplayDayKey,
  shouldShowManualEisUpdatedMark,
} from "./manualEisMarkVisibility";
import { lastUsEquityTradingDayKey } from "./marketSession";

const manualStore: ManualFeedEventDraft[] = [];

vi.mock("./manualFeedEvents", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./manualFeedEvents")>();
  return {
    ...orig,
    loadManualFeedEvents: () => manualStore,
  };
});

describe("manualEisMarkVisibility", () => {
  beforeEach(() => {
    manualStore.length = 0;
  });

  it("maps Saturday to last Friday for display day", () => {
    const sat = new Date("2026-06-13T15:00:00Z");
    expect(manualEisMarkDisplayDayKey(sat)).toBe("2026-06-12");
  });

  it("shows mark on weekend when EIS saved last trading day", () => {
    manualStore.push({
      id: "1",
      createdAt: "2026-06-12",
      ticker: "BNTX",
      eventDate: "2026-06-12",
      source: "Manual",
      title: "News",
      body: "Topline met primary endpoint with statistical significance.",
      investigationContext: "gain",
      priceDropPct: 2,
    });
    const sat = new Date("2026-06-13T15:00:00Z");
    expect(shouldShowManualEisUpdatedMark("BNTX", sat)).toBe(true);
  });

  it("hides mark on Monday after Friday-only save", () => {
    manualStore.push({
      id: "1",
      createdAt: "2026-06-12",
      ticker: "BNTX",
      eventDate: "2026-06-12",
      source: "Manual",
      title: "News",
      body: "Topline met primary endpoint with statistical significance.",
      investigationContext: "gain",
      priceDropPct: 2,
    });
    const mon = new Date("2026-06-15T14:00:00Z");
    expect(manualEisMarkDisplayDayKey(mon)).toBe("2026-06-15");
    expect(shouldShowManualEisUpdatedMark("BNTX", mon)).toBe(false);
  });

  it("shows on NYSE holiday when saved previous session", () => {
    manualStore.push({
      id: "1",
      createdAt: "2026-07-02",
      ticker: "X",
      eventDate: "2026-07-02",
      source: "Manual",
      title: "News",
      body: "Topline met primary endpoint with statistical significance.",
      priceDropPct: -1,
      investigationContext: "loss",
    });
    const holiday = new Date("2026-07-03T16:00:00Z");
    expect(lastUsEquityTradingDayKey(holiday)).toBe("2026-07-02");
    expect(shouldShowManualEisUpdatedMark("X", holiday)).toBe(true);
  });

  it("lastManualFeedEventDate picks latest event date", () => {
    manualStore.push({
      id: "a",
      createdAt: "",
      ticker: "Y",
      eventDate: "2026-06-10",
      source: "Manual",
      title: "a",
      body: "Topline met primary endpoint.",
    });
    manualStore.push({
      id: "b",
      createdAt: "",
      ticker: "Y",
      eventDate: "2026-06-12",
      source: "Manual",
      title: "b",
      body: "Topline met primary endpoint.",
    });
    expect(lastManualFeedEventDate("Y")).toBe("2026-06-12");
  });
});
