import { describe, expect, it } from "vitest";
import {
  formatProductPhaseStudyLine,
  pickLatestCompletedAndOngoing,
} from "./productStudyPhases";
import type { StudyOutcomeBriefing } from "./studyOutcomeBriefing";

function briefing(partial: Partial<StudyOutcomeBriefing>): StudyOutcomeBriefing {
  return {
    studyTitle: null,
    nctId: null,
    studyUrl: null,
    phase: null,
    status: null,
    endedDate: null,
    endedKind: "none",
    design: null,
    enrollment: null,
    patientsTarget: null,
    nTreatment: null,
    nControl: null,
    inclusionCriteria: null,
    efficacyPrimary: null,
    efficacySecondary: null,
    efficacyProse: null,
    safetySummary: null,
    aeLines: [],
    sourceLinks: [],
    efficacyLines: [],
    safetyLines: [],
    eisScore: null,
    eisKpiScore: null,
    eisEventTitle: null,
    eisEventDate: null,
    efficacyIndicators: [],
    safetyIndicators: [],
    ...partial,
  };
}

describe("pickLatestCompletedAndOngoing", () => {
  it("picks latest completed and recruiting ongoing with Phase", () => {
    const { completed, ongoing } = pickLatestCompletedAndOngoing({
      ctgov: [
        {
          nct_id: "NCT00000001",
          title: "Old completed CHS-114",
          phase: "PHASE1",
          status: "COMPLETED",
          completion_date: "2022-01-01",
        },
        {
          nct_id: "NCT00000002",
          title: "Newer completed CHS-114",
          phase: "Phase 2",
          status: "COMPLETED",
          completion_date: "2024-06-15",
        },
        {
          nct_id: "NCT05635643",
          title: "CHS-114 + toripalimab",
          phase: "PHASE1",
          status: "RECRUITING",
        },
      ],
    });
    expect(completed?.nctId).toBe("NCT00000002");
    expect(formatProductPhaseStudyLine(completed!)).toContain("Phase 2");
    expect(ongoing?.nctId).toBe("NCT05635643");
    expect(formatProductPhaseStudyLine(ongoing!)).toBe(
      "Phase 1 · NCT05635643 · Recruiting",
    );
  });

  it("prefers the completing-CD NCT when it is still ongoing", () => {
    const { ongoing } = pickLatestCompletedAndOngoing({
      primaryNctId: "NCT01111111",
      ctgov: [
        {
          nct_id: "NCT09999999",
          phase: "PHASE2",
          status: "RECRUITING",
        },
        {
          nct_id: "NCT01111111",
          phase: "PHASE1",
          status: "ACTIVE_NOT_RECRUITING",
        },
      ],
    });
    expect(ongoing?.nctId).toBe("NCT01111111");
    expect(formatProductPhaseStudyLine(ongoing!)).toContain("Phase 1");
  });

  it("falls back to feed briefings when CT.gov is empty", () => {
    const { completed, ongoing } = pickLatestCompletedAndOngoing({
      briefings: [
        briefing({
          nctId: "NCT1",
          studyTitle: "Done",
          phase: "PHASE 3",
          status: "Completed",
          endedDate: "2023-04-01",
        }),
        briefing({
          nctId: "NCT2",
          studyTitle: "Live",
          phase: "PHASE 2",
          status: "Active, not recruiting",
        }),
      ],
    });
    expect(completed?.nctId).toBe("NCT1");
    expect(formatProductPhaseStudyLine(completed!)).toContain("Phase 3");
    expect(ongoing?.nctId).toBe("NCT2");
  });
});
