import { describe, expect, it } from "vitest";
import { collectTicker8kFilings } from "./ticker8kFilings";
import { isClinicalNewsEvent } from "./tickerImpactEvents";
import type { ClinicalPreCdRecord } from "../api/supernova";
import type { TickerEisEventDetail } from "./tickerEisSummary";

function ev(over: Partial<TickerEisEventDetail> = {}): TickerEisEventDetail {
  return {
    eventDate: "2026-09-01",
    title: "Trial readout",
    sourceType: "press_release",
    sourceLabel: "Press",
    breakdown: {
      score: 2,
      delta_p_1d: 1,
      delta_p_3d: 1,
      vol_ratio: 1,
      vol_term: 0,
      sentiment: 0,
      sent_term: 0,
      weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
    },
    indicators: [],
    impactNote: null,
    link: null,
    summary: "Primary endpoint met.",
    nctId: null,
    studyTitle: "",
    studyUrl: null,
    ...over,
  };
}

describe("isClinicalNewsEvent", () => {
  it("keeps press / trial news and drops 8-K filings", () => {
    expect(isClinicalNewsEvent(ev())).toBe(true);
    expect(
      isClinicalNewsEvent(
        ev({ sourceType: "sec_8k", title: "Results of Operations and Financial Condition" }),
      ),
    ).toBe(false);
  });
});

describe("collectTicker8kFilings", () => {
  it("returns only 8-K rows with financial score", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "CRDL",
        nct_id: "NCT1",
        clinical_events: [
          {
            event_date: "2026-09-10",
            event_title: "8-K Item 2.02 earnings",
            summary: "Q2 cash and runway update.",
            source_type: "sec_8k",
            items_raw: "2.02",
            financial_score: 1.2,
            link: "https://www.sec.gov/Archives/example.htm",
            confirmation_status: "confirmed",
            reference_verified: true,
          },
          {
            event_date: "2026-09-11",
            event_title: "ARCHER Phase 3 enrollment",
            summary: "Last patient in.",
            source_type: "press_release",
            clinical_score: 0.8,
            confirmation_status: "confirmed",
            reference_verified: true,
          },
        ],
      },
    ];
    const out = collectTicker8kFilings(records, "CRDL");
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toMatch(/8-K/i);
    expect(out[0]!.financialScore).toBe(1.2);
    expect(out[0]!.summary).toMatch(/cash/i);
  });
});
