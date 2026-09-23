import { describe, expect, it } from "vitest";
import { findClinicalPreCdRecord } from "./eisPolyAdjust";
import type { ClinicalPreCdRecord } from "../api/supernova";

describe("findClinicalPreCdRecord", () => {
  const natalizumab: ClinicalPreCdRecord = {
    ticker: "BIIB",
    nct_id: "NCT00097760",
    cd_date: "2004-03-01",
    meta: { brief_title: "Natalizumab + GA" },
  };
  const litifilimab: ClinicalPreCdRecord = {
    ticker: "BIIB",
    nct_id: "NCT05531565",
    cd_date: "2026-09-16",
    meta: { brief_title: "Litifilimab in CLE" },
  };

  it("does not fall back to an older pipeline study when the CD date has no match", () => {
    expect(
      findClinicalPreCdRecord("BIIB", "2026-09-16", [natalizumab]),
    ).toBeNull();
  });

  it("returns the record whose CD date matches", () => {
    const hit = findClinicalPreCdRecord("BIIB", "2026-09-16", [
      natalizumab,
      litifilimab,
    ]);
    expect(hit?.nct_id).toBe("NCT05531565");
  });
});
