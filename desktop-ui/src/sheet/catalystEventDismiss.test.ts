import { afterEach, describe, expect, it } from "vitest";
import {
  catalystEventStableId,
  cdIsoEventId,
  dismissCatalystEvent,
  loadDismissedCatalystIds,
  resetCatalystEventDismissForTests,
  undismissCatalystEventsForTicker,
} from "./catalystEventDismiss";

describe("catalystEventDismiss", () => {
  afterEach(() => {
    resetCatalystEventDismissForTests();
  });

  it("builds a stable id for CD rows matching the table", () => {
    expect(cdIsoEventId("ptgx", "2026-01-01")).toBe("PTGX|cd|2026-01-01|2026-01-01|PTGX");
    expect(
      catalystEventStableId({
        ticker: "PTGX",
        event_type: "initiation",
        window_start: "2025-07-01",
        window_end: "2026-03-31",
        asset_name: "PN-881",
      }),
    ).toBe("PTGX|initiation|2025-07-01|2026-03-31|PN-881");
  });

  it("persists dismiss and restores per ticker", () => {
    dismissCatalystEvent(cdIsoEventId("PTGX", "2018-03-26"));
    dismissCatalystEvent(
      catalystEventStableId({
        ticker: "LCTX",
        event_type: "cd",
        window_start: "2026-01-01",
        window_end: "2026-01-01",
        asset_name: "LCTX",
      }),
    );
    expect(loadDismissedCatalystIds().size).toBe(2);
    undismissCatalystEventsForTicker("PTGX");
    const left = loadDismissedCatalystIds();
    expect(left.has(cdIsoEventId("PTGX", "2018-03-26"))).toBe(false);
    expect(left.size).toBe(1);
  });
});
