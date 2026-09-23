import { describe, expect, it } from "vitest";
import {
  calendarEventsToCatalystSimEntries,
  unionCatalystSimEntries,
} from "./calendarCatalystSimEntries";
import { fdaAdcomToGuidanceEvent } from "./calendarCatalystEvents";

describe("calendarEventsToCatalystSimEntries", () => {
  it("adds AMGN from an FDA PAC event even when Guidance is empty", () => {
    const entries = calendarEventsToCatalystSimEntries(
      [
        fdaAdcomToGuidanceEvent({
          date: "2026-09-16",
          ticker: "AMGN",
          company: "Amgen Inc.",
          product: "Aranesp (darbepoetin alfa)",
          eventEn: "PAC pediatric post-marketing safety review (Aranesp)",
          kind: "safety_review",
        }),
      ],
      new Date("2026-09-06T12:00:00Z"),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      Ticker: "AMGN",
      Società: "Amgen Inc.",
      "Completion Date": "16/09/2026",
      Drug: "Aranesp (darbepoetin alfa)",
      guidance_calendar_catalyst: true,
      guidance_event_type: "fda_safety",
    });
  });
});

describe("unionCatalystSimEntries", () => {
  it("fills AMGN from the live calendar when the sidecar file is stale", () => {
    const out = unionCatalystSimEntries(
      [
        {
          Ticker: "AMGN",
          "Completion Date": "16/09/2026",
          guidance_calendar_catalyst: true,
        },
      ],
      [{ Ticker: "GRAL", "Completion Date": "23/09/2026" }],
    );
    const tickers = out.map((r) => r.Ticker);
    expect(tickers).toContain("AMGN");
    expect(tickers).toContain("GRAL");
  });
});
