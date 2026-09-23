import { describe, expect, it } from "vitest";
import {
  isClinicalPreCdRecordTrusted,
  isFeedEventTrusted,
  resolveRecordSponsorMatch,
} from "./referenceVerification";
import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "../api/supernova";

function rec(partial: Partial<ClinicalPreCdRecord>): ClinicalPreCdRecord {
  return {
    ticker: "PLSE",
    company: "Pulse Biosciences, Inc.",
    nct_id: "NCT06696170",
    cd_date: "2026-06-25",
    sponsor_match: "",
    meta: { lead_sponsor: "Pulse Biosciences, Inc.", brief_title: "CellFX PFA" },
    ...partial,
  } as ClinicalPreCdRecord;
}

describe("referenceVerification sponsor gate", () => {
  it("trusts Exact sponsor from meta lead_sponsor", () => {
    const r = rec({ sponsor_match: "" });
    expect(resolveRecordSponsorMatch(r)).toBe("exact");
    expect(isClinicalPreCdRecordTrusted(r)).toBe(true);
  });

  it("blocks Pfizer study on PLSE ticker", () => {
    const r = rec({
      nct_id: "NCT04607837",
      meta: {
        lead_sponsor: "Pfizer",
        brief_title: "Etrasimod Versus Placebo",
      },
    });
    expect(isClinicalPreCdRecordTrusted(r)).toBe(false);
  });

  it("blocks Partial-only generic Biosciences match (PLSE vs UCB)", () => {
    const r = rec({
      nct_id: "NCT02408549",
      sponsor_match: "Partial",
      meta: {
        lead_sponsor: "UCB BIOSCIENCES, Inc.",
        brief_title: "Lacosamide",
      },
    });
    expect(isClinicalPreCdRecordTrusted(r)).toBe(false);
  });

  it("blocks empty sponsor with no lead_sponsor", () => {
    const r = rec({ meta: {} });
    expect(isClinicalPreCdRecordTrusted(r)).toBe(false);
  });

  it("blocks stale Exact when lead sponsor is a different pharma (ETON≠PMV)", () => {
    const r = rec({
      ticker: "ETON",
      company: "Eton Pharmaceuticals, Inc.",
      nct_id: "NCT04585750",
      sponsor_match: "Exact",
      meta: {
        lead_sponsor: "PMV Pharmaceuticals, Inc",
        brief_title: "PYNNACLE",
      },
    });
    expect(resolveRecordSponsorMatch(r)).toBe("no match");
    expect(isClinicalPreCdRecordTrusted(r)).toBe(false);
  });
});

describe("isFeedEventTrusted daily news", () => {
  it("keeps Daily News migrate events even when the study sponsor is untrusted", () => {
    const r = rec({
      sponsor_match: "no match",
      meta: { lead_sponsor: "Unrelated Pharma", brief_title: "Other" },
    });
    const ev: ClinicalPublicationEvent = {
      event_date: "2026-09-15",
      event_title: "Vertex completes Crinetics acquisition",
      source_type: "press_release",
      reference_verified: true,
      reference_match: "daily_news",
      link_label: "Daily News",
      eis: { score: 4.2, sentiment: 0.5 },
    };
    (ev as { _from_daily_news?: boolean })._from_daily_news = true;
    expect(isFeedEventTrusted(ev, r)).toBe(true);
  });
});
