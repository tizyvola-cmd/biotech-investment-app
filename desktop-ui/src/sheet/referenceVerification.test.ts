import { describe, expect, it } from "vitest";
import {
  isClinicalPreCdRecordTrusted,
  resolveRecordSponsorMatch,
} from "./referenceVerification";
import type { ClinicalPreCdRecord } from "../api/supernova";

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
});
