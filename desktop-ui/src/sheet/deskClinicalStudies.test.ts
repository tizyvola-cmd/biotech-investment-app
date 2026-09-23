import { describe, expect, it } from "vitest";
import type { ClinicalPreCdRecord } from "../api/supernova";
import {
  deskRowStudyPhaseLabel,
  listDeskClinicalStudiesForTicker,
  resolveDeskRowClinicalStudies,
} from "./deskClinicalStudies";

const REC_A: ClinicalPreCdRecord = {
  ticker: "VCEL",
  nct_id: "NCT111",
  cd_date: "2026-04-01",
  meta: { brief_title: "Epicel study A", phase: "PHASE3" },
};

const REC_B: ClinicalPreCdRecord = {
  ticker: "VCEL",
  nct_id: "NCT222",
  cd_date: "2024-01-01",
  meta: { brief_title: "Older trial", phase: "PHASE2" },
};

describe("deskClinicalStudies", () => {
  it("lists deduped studies per ticker", () => {
    const list = listDeskClinicalStudiesForTicker("VCEL", [REC_A, REC_B]);
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.nctId).sort()).toEqual(["NCT111", "NCT222"]);
  });

  it("picks catalyst NCT from sim row and separates others", () => {
    const { primary, others } = resolveDeskRowClinicalStudies("VCEL", [REC_A, REC_B], {
      simRow: { NCT: "NCT111" },
      completionDate: "2026-04-01",
    });
    expect(primary?.nctId).toBe("NCT111");
    expect(others).toHaveLength(1);
    expect(others[0]?.nctId).toBe("NCT222");
  });

  it("phase label uses primary study not semicolon dump", () => {
    const { primary } = resolveDeskRowClinicalStudies("VCEL", [REC_A, REC_B], {
      simRow: { NCT: "NCT111" },
    });
    const label = deskRowStudyPhaseLabel(null, primary, false);
    expect(label).toMatch(/Phase 3/i);
    expect(label).not.toContain(";");
  });
});
