import { describe, expect, it } from "vitest";
import {
  attachEisScoresToStudyBriefings,
  collectStudyOutcomeBriefings,
  preserveStudyOutcomeCtgovFills,
  type StudyOutcomeBriefing,
} from "./studyOutcomeBriefing";
import type { ClinicalPreCdRecord } from "../api/supernova";

function sparseBrief(over: Partial<StudyOutcomeBriefing> = {}): StudyOutcomeBriefing {
  return {
    nctId: "NCT03809624",
    studyTitle: "INBRX-105",
    studyUrl: null,
    phase: "PHASE 1",
    status: "Terminated",
    design: null,
    inclusionCriteria: null,
    enrollment: 160,
    patientsTarget: null,
    nTreatment: null,
    nControl: null,
    endedDate: "2024-10-03",
    endedKind: "completion",
    efficacyPrimary: null,
    efficacySecondary: null,
    efficacyProse: null,
    efficacyLines: [],
    safetySummary: null,
    safetyLines: [],
    aeLines: [],
    sourceLinks: [],
    eisScore: null,
    eisKpiScore: null,
    eisEventTitle: null,
    eisEventDate: null,
    efficacyIndicators: [],
    safetyIndicators: [],
    ...over,
  };
}

describe("preserveStudyOutcomeCtgovFills", () => {
  it("keeps inclusion/design across a sparse base rebuild (no flicker)", () => {
    const filled = sparseBrief({
      design: "Open-label · Non-randomized",
      inclusionCriteria: "Adults with solid tumors; ECOG 0–1.",
    });
    const rebuilt = sparseBrief({
      eisScore: 4.2,
      design: null,
      inclusionCriteria: null,
    });
    const out = preserveStudyOutcomeCtgovFills([rebuilt], [filled]);
    expect(out[0]!.inclusionCriteria).toBe("Adults with solid tumors; ECOG 0–1.");
    expect(out[0]!.design).toBe("Open-label · Non-randomized");
    expect(out[0]!.eisScore).toBe(4.2);
  });
});

describe("collectStudyOutcomeBriefings", () => {
  it("returns EN descriptions, marks missed endpoints, attaches EIS", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "CRDL",
        nct_id: "NCT05180240",
        sponsor_match: "Exact",
        cd_date: "2024-11-14",
        meta: {
          brief_title: "ARCHER Phase 2 — recurrent pericarditis",
          phase: "PHASE2",
          overall_status: "COMPLETED",
          enrollment: 61,
          study_design: "Double-blind · Placebo-controlled · Randomized",
          inclusion_criteria: "Adults with recurrent pericarditis; ≥2 prior episodes.",
          primary_completion_date: "2024-11-14",
          interventions: "CardiolRx | Placebo",
        },
        ae_summary: ["Cardiac failure: 1/45, 0/44"],
        ai: {
          study_clinical_profile: {
            primary_endpoint_label: "Time to recurrence",
            primary_endpoint_value: "statistically significant reduction",
            safety_summary: "Generally well tolerated",
            patients_enrolled: 61,
          },
        },
        clinical_indicators: [
          {
            label: "ECV",
            value: "-3.7 ml",
            kpi_type: "efficacy",
            endpoint_met: false,
            trend_note: "Mancata significatività statistica per il marker primario ECV.",
            source: "publication",
          },
          {
            label: "LV mass",
            value: "-9.2 g",
            kpi_type: "efficacy",
            endpoint_met: true,
            trend_note: "Significant LV mass reduction.",
            source: "publication",
          },
          {
            label: "Adverse events",
            value: "Tachycardia: 0/45, 1/44",
            kpi_type: "safety",
            source: "ctgov",
          },
        ],
        outcome_measures: [
          {
            type: "PRIMARY",
            title: "ECV",
            description: "Extracellular volume change from baseline.",
            time_frame: "12 weeks",
            values: ["-3.7 ml"],
          },
        ],
        ai_ok: true,
        clinical_events: [
          {
            event_date: "2024-11-14",
            event_title: "ARCHER readout",
            link: "https://ir.example.com/archer",
            confirmation_status: "confirmed",
            reference_verified: true,
          },
        ],
      },
    ];

    const out = collectStudyOutcomeBriefings(records, {
      ticker: "CRDL",
      primaryNctId: "NCT05180240",
      it: false,
    });

    expect(out.length).toBe(1);
    const ecv = out[0]!.efficacyLines.find((l) => /ECV/i.test(l.label));
    expect(ecv?.endpointMet).toBe(false);
    expect(ecv?.description ?? "").not.toMatch(/Mancata significatività/i);
    expect(ecv?.description ?? "").toMatch(/extracellular|endpoint|result|volume/i);

    const withEis = attachEisScoresToStudyBriefings(out, [
      {
        nctId: "NCT05180240",
        title: "ARCHER Phase 2 primary",
        eventDate: "2024-11-14",
        breakdown: { score: 12.4, kpi_score: 0.9 },
      },
    ]);
    expect(withEis[0]!.eisScore).toBe(12.4);
    expect(withEis[0]!.eisKpiScore).toBe(0.9);
  });

  it("keeps only studies linked to the completing product", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "BIIB",
        nct_id: "NCT09999999",
        sponsor_match: "Exact",
        meta: {
          brief_title: "Natalizumab extension",
          interventions: "Natalizumab | Placebo",
        },
        ai: { study_clinical_profile: { product_name: "Natalizumab" } },
      },
      {
        ticker: "BIIB",
        nct_id: "NCT000097760",
        sponsor_match: "Exact",
        meta: {
          brief_title: "Natalizumab in Combination With Glatiramer Acetate",
          interventions: "Natalizumab | Glatiramer Acetate",
        },
      },
      {
        ticker: "BIIB",
        nct_id: "NCT05555555",
        sponsor_match: "Exact",
        meta: {
          brief_title: "Aducanumab in early Alzheimer's disease",
          interventions: "Aducanumab | Placebo",
        },
      },
    ];
    const out = collectStudyOutcomeBriefings(records, {
      ticker: "BIIB",
      primaryNctId: "NCT09999999",
      productName: "Natalizumab",
      it: false,
    });
    const ncts = out.map((b) => b.nctId);
    expect(ncts).toContain("NCT09999999");
    expect(ncts).toContain("NCT000097760");
    expect(ncts).not.toContain("NCT05555555");
  });

  it("does not list natalizumab studies under a litifilimab product filter", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "BIIB",
        nct_id: "NCT00097760",
        sponsor_match: "Exact",
        meta: {
          brief_title: "Natalizumab in Combination With Glatiramer Acetate",
          interventions: "Natalizumab | Glatiramer Acetate",
        },
        ai: { study_clinical_profile: { product_name: "Natalizumab" } },
      },
      {
        ticker: "BIIB",
        nct_id: "NCT05531565",
        sponsor_match: "Exact",
        meta: {
          brief_title: "Litifilimab (BIIB059) in CLE",
          interventions: "Litifilimab | Placebo",
        },
        ai: { study_clinical_profile: { product_name: "Litifilimab" } },
      },
    ];
    const out = collectStudyOutcomeBriefings(records, {
      ticker: "BIIB",
      primaryNctId: "NCT05531565",
      productName: "Litifilimab",
      productAliases: ["BIIB059"],
      it: false,
    });
    const ncts = out.map((b) => b.nctId);
    expect(ncts).toContain("NCT05531565");
    expect(ncts).not.toContain("NCT00097760");
  });
});
