import { describe, expect, it } from "vitest";
import {
  fdaAdcomToGuidanceEvent,
  fdaRowsFromSnapshot,
  mergeCalendarSources,
  mergeGuidanceAndFdaEvents,
  secForwardToGuidanceEvent,
  simRowsToCdEvents,
  windowLabelToIsoRange,
} from "./calendarCatalystEvents";
import type { CatalystCalendarEntry, GuidanceCalendarEvent } from "../api/supernova";

describe("fdaAdcomToGuidanceEvent", () => {
  it("maps a vote to fda_vote with the product as asset", () => {
    const ev = fdaAdcomToGuidanceEvent({
      date: "2026-09-23",
      ticker: "gral",
      company: "GRAIL, Inc.",
      product: "Galleri",
      eventEn: "ODAC vote on Galleri",
      kind: "vote",
      href: "https://www.fda.gov/example",
    });
    expect(ev).toMatchObject({
      ticker: "GRAL",
      event_type: "fda_vote",
      asset_name: "Galleri",
      window_start: "2026-09-23",
      source_type: "fda_adcom",
    });
  });
});

describe("mergeGuidanceAndFdaEvents", () => {
  it("keeps guidance rows and appends FDA AdCom for the same ticker", () => {
    const guidance: GuidanceCalendarEvent[] = [
      {
        ticker: "GRAL",
        company: "GRAIL, Inc.",
        event_type: "readout",
        asset_name: "Galleri",
        window_start: "2026-11-01",
      },
    ];
    const merged = mergeGuidanceAndFdaEvents(guidance, [
      {
        date: "2026-09-23",
        ticker: "GRAL",
        company: "GRAIL, Inc.",
        product: "Galleri",
        eventEn: "ODAC vote",
        kind: "vote",
      },
    ]);
    expect(merged.map((e) => e.event_type)).toEqual(["fda_vote", "readout"]);
  });
});

describe("secForwardToGuidanceEvent", () => {
  it("maps exact PDUFA into guidance shape", () => {
    const row: CatalystCalendarEntry = {
      ticker: "abcd",
      event_type: "PDUFA",
      date_precision: "exact_date",
      date_value: "2026-10-15",
      confidence: "high",
      source_filing_url: "https://sec.gov/x",
      raw_snippet: "PDUFA date of October 15, 2026",
    };
    expect(secForwardToGuidanceEvent(row)).toMatchObject({
      ticker: "ABCD",
      event_type: "pdufa",
      window_start: "2026-10-15",
      source_type: "sec_forward",
      estimation_method: "sec_8k_extract",
    });
  });

  it("maps a partnership window and keeps the counterparty as asset", () => {
    const row: CatalystCalendarEntry = {
      ticker: "abcd",
      event_type: "Partnership",
      date_precision: "quarter_window",
      window_label: "Q1 2027",
      partner: "Novartis Pharma AG",
      confidence: "medium",
      source_item: "1.01",
    };
    expect(secForwardToGuidanceEvent(row)).toMatchObject({
      ticker: "ABCD",
      event_type: "partnership",
      asset_name: "Novartis Pharma AG",
      window_start: "2027-01-01",
      window_end: "2027-03-31",
    });
  });

  it("maps readout windows via label", () => {
    const row: CatalystCalendarEntry = {
      ticker: "XYZ",
      event_type: "Readout",
      date_precision: "half_year_window",
      window_label: "2H 2026",
      confidence: "medium",
    };
    expect(secForwardToGuidanceEvent(row)).toMatchObject({
      event_type: "readout",
      window_start: "2026-07-01",
      window_end: "2026-12-31",
    });
  });
});

describe("windowLabelToIsoRange", () => {
  it("parses Q4", () => {
    expect(windowLabelToIsoRange("Q4 2026")).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
  });
});

describe("mergeCalendarSources", () => {
  it("includes SEC rows in one list", () => {
    const merged = mergeCalendarSources(
      [
        {
          ticker: "AAA",
          company: "A",
          event_type: "cd",
          window_start: "2026-12-01",
        },
      ],
      [],
      [
        {
          ticker: "BBB",
          event_type: "PDUFA",
          date_precision: "exact_date",
          date_value: "2026-09-20",
          confidence: "high",
        },
      ],
    );
    expect(merged.map((e) => e.ticker)).toEqual(["BBB", "AAA"]);
    expect(merged[0]?.source_type).toBe("sec_forward");
  });

  it("drops fully past guidance and SEC rows", () => {
    const merged = mergeCalendarSources(
      [
        {
          ticker: "OLD",
          company: "Old",
          event_type: "cd",
          window_start: "2025-01-01",
          window_end: "2025-06-30",
        },
        {
          ticker: "NEW",
          company: "New",
          event_type: "cd",
          window_start: "2026-12-01",
          window_end: "2026-12-01",
        },
      ],
      [],
      [
        {
          ticker: "PAST",
          event_type: "PDUFA",
          date_precision: "exact_date",
          date_value: "2026-01-01",
          confidence: "high",
        },
      ],
    );
    expect(merged.map((e) => e.ticker)).toEqual(["NEW"]);
  });

  it("merges Simulation CT.gov CD days", () => {
    const cds = simRowsToCdEvents(
      [
        {
          Ticker: "CCCC",
          "Completion Date": "2026-09-30",
          Società: "C4",
          NCT: "NCT04756726",
        },
      ],
      new Date("2026-09-11T12:00:00Z"),
    );
    const merged = mergeCalendarSources([], [], [], false, cds);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.event_type).toBe("cd");
    expect(merged[0]?.source_type).toBe("clinicaltrials.gov");
    expect(merged[0]?.ticker).toBe("CCCC");
  });
});

describe("fdaRowsFromSnapshot", () => {
  it("keeps AMGN from the seed when the snapshot omitted it", () => {
    const rows = fdaRowsFromSnapshot(
      {
        rows: [
          {
            id: "2026-09-16-GILD",
            date: "2026-09-16",
            ticker: "GILD",
            company: "Gilead Sciences, Inc.",
            product: "Veklury; Vemlidy",
            eventEn: "PAC",
            eventIt: "PAC",
            committee: "PAC",
            kind: "safety_review",
            href: "https://www.fda.gov/example",
          },
        ],
      },
      new Date("2026-09-06T12:00:00Z"),
    );
    expect(rows.map((r) => r.ticker)).toContain("AMGN");
    expect(rows.map((r) => r.ticker)).toContain("GILD");
  });
});
