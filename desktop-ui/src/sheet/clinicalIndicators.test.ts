import { describe, expect, it } from "vitest";
import {
  dedupeClinicalIndicators,
  localizeClinicalIndicatorLabel,
  localizeClinicalIndicatorValue,
  localizeClinicalKpiType,
  localizeStudyPhase,
  localizeStudyStatus,
  normalizeIndicatorDate,
  stampIndicatorDate,
  describeClinicalIndicator,
  expandClinicalAcronymsInLabel,
  indicatorsForStudyDisplay,
  indicatorsForFeedEvent,
  isGenericClinicalEndpointLabel,
  markClinicalIndicatorsShown,
  resolveClinicalIndicatorHref,
  studyIndicatorsForFeedHeader,
  summarizeClinicalEfficacySafety,
} from "./clinicalIndicators";

describe("resolveClinicalIndicatorHref", () => {
  it("uses http(s) link when present", () => {
    expect(
      resolveClinicalIndicatorHref({
        link: "https://ir.example.com/press/archer",
        source: "press_release",
      }),
    ).toBe("https://ir.example.com/press/archer");
  });

  it("maps PMID and DOI", () => {
    expect(resolveClinicalIndicatorHref({ link: "PMID 12345678" })).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/12345678/",
    );
    expect(resolveClinicalIndicatorHref({ link: "10.1000/xyz.1" })).toBe(
      "https://doi.org/10.1000/xyz.1",
    );
  });

  it("falls back to CT.gov for ctgov source + NCT", () => {
    expect(
      resolveClinicalIndicatorHref(
        { source: "ctgov", label: "Adverse events" },
        { nctId: "NCT05180240" },
      ),
    ).toBe("https://clinicaltrials.gov/study/NCT05180240");
  });
});

describe("normalizeIndicatorDate", () => {
  it("accepts ISO dates", () => {
    expect(normalizeIndicatorDate("2026-04-15")).toBe("2026-04-15");
    expect(normalizeIndicatorDate("2026-04-15T12:00:00Z")).toBe("2026-04-15");
  });

  it("rejects NA placeholders", () => {
    expect(normalizeIndicatorDate("2025-NA-NA")).toBeNull();
    expect(normalizeIndicatorDate("2026-XX-01")).toBeNull();
  });

  it("parses DMY", () => {
    expect(normalizeIndicatorDate("15/04/2026")).toBe("2026-04-15");
  });
});

describe("stampIndicatorDate", () => {
  it("keeps valid own date", () => {
    const stamped = stampIndicatorDate(
      { label: "ORR", value: "76%", indicator_date: "2026-04-15" },
      "2026-01-01",
    );
    expect(stamped.indicator_date).toBe("2026-04-15");
  });

  it("falls back to event date and clears garbage", () => {
    const stamped = stampIndicatorDate(
      { label: "ORR", value: "76%", indicator_date: "2025-NA-NA" },
      "2026-04-15",
    );
    expect(stamped.indicator_date).toBe("2026-04-15");
  });
});

describe("dedupeClinicalIndicators", () => {
  it("prefers the dated copy for the same label/value", () => {
    const out = dedupeClinicalIndicators([
      { label: "ORR", value: "76.1%", indicator_date: null },
      { label: "ORR", value: "76.1%", indicator_date: "2026-04-15" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.indicator_date).toBe("2026-04-15");
  });
});

describe("clinical indicator locale", () => {
  it("maps stored Italian labels to English", () => {
    expect(localizeClinicalIndicatorLabel("Esito studio", false)).toBe("Study outcome");
    expect(localizeClinicalIndicatorLabel("Endpoint secondari", false)).toBe("Secondary endpoints");
    expect(localizeClinicalIndicatorLabel("AE grado≥3", false)).toBe("Grade ≥3 AE");
    expect(localizeClinicalIndicatorLabel("Sicurezza", false)).toBe("Safety");
  });

  it("keeps Italian labels when UI is Italian", () => {
    expect(localizeClinicalIndicatorLabel("Esito studio", true)).toBe("Esito studio");
    expect(localizeClinicalIndicatorLabel("Study outcome", true)).toBe("Esito studio");
  });

  it("maps chip values both ways", () => {
    expect(localizeClinicalIndicatorValue("ongoing", false)).toBe("ongoing");
    expect(localizeClinicalIndicatorValue("ongoing", true)).toBe("in corso");
    expect(localizeClinicalIndicatorValue("better", true)).toBe("migliore");
    expect(localizeClinicalIndicatorValue("migliore", false)).toBe("better");
  });

  it("maps CT.gov status and KPI type hover", () => {
    expect(localizeStudyStatus("RECRUITING", false)).toBe("Recruiting");
    expect(localizeStudyStatus("RECRUITING", true)).toBe("in reclutamento");
    expect(localizeStudyStatus("ACTIVE_NOT_RECRUITING", true)).toBe("attivo, non in reclutamento");
    expect(localizeClinicalKpiType("efficacy", false)).toBe("Efficacy");
    expect(localizeClinicalKpiType("efficacy", true)).toBe("Efficacia");
    expect(localizeClinicalKpiType("safety", true)).toBe("Sicurezza");
    expect(localizeStudyPhase("PHASE 2", true)).toBe("Fase 2");
    expect(localizeStudyPhase("PHASE 2", false)).toBe("Phase 2");
    expect(localizeStudyPhase("PHASE2 / PHASE3", false)).toBe("Phase 2/3");
  });
});

describe("describeClinicalIndicator", () => {
  it("explains FEV1 change-from-baseline instead of leaving only the number", () => {
    const text = describeClinicalIndicator(
      {
        label: "Absolute Change From Baseline in Percent Predicted FEV1",
        value: "-0.4 ± 0.7",
        kpi_type: "efficacy",
        direction: "flat",
      },
      false,
    );
    expect(text.toLowerCase()).toMatch(/lung function|fev1/);
    expect(text.toLowerCase()).toMatch(/change|baseline|unchanged|shift/);
  });

  it("uses the study-page note instead of the generic primary-endpoint gloss", () => {
    const text = describeClinicalIndicator(
      {
        label: "Primary endpoint",
        value: "43",
        kpi_type: "efficacy",
        trend_note: "ORR 43% nel braccio sperimentale, sopra la soglia di successo.",
      },
      true,
    );
    expect(text).toContain("ORR 43%");
    expect(text.toLowerCase()).not.toMatch(/criterio di efficacia/);
  });

  it("expands ECV/GLS/LV acronyms in the label and explains the readout", () => {
    expect(expandClinicalAcronymsInLabel("Primary Endpoint: ECV (mean)", false)).toMatch(
      /ECV \(extracellular volume\)/i,
    );
    expect(expandClinicalAcronymsInLabel("GLS difference", false)).toMatch(
      /GLS \(global longitudinal strain\)/i,
    );
    expect(expandClinicalAcronymsInLabel("LV mass difference", false)).toMatch(
      /LV \(left ventricular\)/i,
    );

    const ecv = describeClinicalIndicator(
      {
        label: "Primary Endpoint: ECV (mean)",
        value: "-3.7 ml",
        kpi_type: "efficacy",
        endpoint_met: false,
        direction: "down",
        n_patients: 109,
      },
      false,
    );
    expect(ecv.toLowerCase()).toMatch(/extracellular volume/);
    expect(ecv.toLowerCase()).toMatch(/edema|fibrosis|mri|myocardium/);
    expect(ecv.toLowerCase()).toMatch(/primary endpoint/);
  });

  it("describes safety AE counts in plain language", () => {
    const text = describeClinicalIndicator(
      {
        label: "Adverse events (Cough)",
        value: "Cough: 1/46",
        kpi_type: "safety",
        n_patients: 46,
      },
      false,
    );
    expect(text.toLowerCase()).toMatch(/cough|safety|side effect/);
    expect(text).toMatch(/n=46/);
  });
});

describe("indicatorsForStudyDisplay", () => {
  it("replaces generic Primary endpoint with the CT.gov measure title and description", () => {
    const out = indicatorsForStudyDisplay(
      [
        { label: "Primary endpoint", value: "85", kpi_type: "efficacy" },
        { label: "Primary endpoint", value: "158", kpi_type: "efficacy" },
      ],
      [
        {
          type: "PRIMARY",
          title: "Percentage of Subjects Reporting Headache Pain Freedom",
          description: "Absence of headache pain. AXS-07 vs Placebo.",
          time_frame: "Hour 2 following dose administration",
          values: ["AXS-07: 85/428 (20%)"],
        },
        {
          type: "PRIMARY",
          title: "Percentage of Subjects With Absence of Most Bothersome Symptom",
          description: "Absence of most bothersome symptom, defined at the onset of migraine.",
          values: ["AXS-07: 158/428 (37%)"],
        },
      ],
      { nctId: "NCT01234567" },
    );
    expect(out.map((i) => i.label)).toEqual([
      "Percentage of Subjects Reporting Headache Pain Freedom",
      "Percentage of Subjects With Absence of Most Bothersome Symptom",
    ]);
    expect(out[0]!.trend_note).toMatch(/Absence of headache pain/i);
    expect(out[0]!.link).toBe("https://clinicaltrials.gov/study/NCT01234567");
  });

  it("drops leaked generic numbers and shows the recruiting study's planned endpoint", () => {
    const out = indicatorsForStudyDisplay(
      [
        { label: "Primary endpoint", value: "85", kpi_type: "efficacy" },
        {
          label: "Adverse events",
          value: "Abortion spontaneous: 1/441, 0/433",
          kpi_type: "safety",
        },
      ],
      [
        {
          type: "PRIMARY",
          title: "Time from randomization to relapse of depressive symptoms",
          description: "Relapse defined as MADRS total score ≥ 18.",
          time_frame: "up to 26 weeks",
        },
      ],
      { nctId: "NCT09999999" },
    );
    expect(out.some((i) => i.label === "Primary endpoint" || i.value === "85")).toBe(false);
    expect(out[0]!.label).toMatch(/relapse of depressive/i);
    expect(out[0]!.value).toMatch(/26 weeks/);
    expect(out[0]!.trend_note).toMatch(/MADRS/i);
    expect(out.some((i) => i.kpi_type === "safety")).toBe(true);
  });

  it("treats Endpoint primario as a generic label", () => {
    expect(isGenericClinicalEndpointLabel("Endpoint primario")).toBe(true);
    expect(isGenericClinicalEndpointLabel("Percentage of Subjects Reporting Headache Pain Freedom")).toBe(
      false,
    );
  });

  it("keeps only primary and secondary readouts", () => {
    const out = indicatorsForStudyDisplay(
      [],
      [
        {
          type: "PRIMARY",
          title: "CLA-IGA 0 or 1 at Week 16",
          time_frame: "Week 16",
        },
        {
          type: "SECONDARY",
          title: "CLASI-70 at Week 24",
          time_frame: "Week 24",
        },
        {
          type: "OTHER",
          title: "CLASI-70 at Week 52 among Week 16 responders",
          time_frame: "Week 52",
        },
        {
          type: "OTHER",
          title: "CLASI-70 at Week 52 among Week 24 responders",
          time_frame: "Week 52",
        },
      ],
      { nctId: "NCT01234567" },
    );
    const labels = out.map((i) => i.label);
    expect(labels).toEqual(["CLA-IGA 0 or 1 at Week 16", "CLASI-70 at Week 24"]);
  });
});

describe("summarizeClinicalEfficacySafety", () => {
  it("keeps one efficacy and one safety line, skipping NA placeholders", () => {
    const out = summarizeClinicalEfficacySafety(
      [
        {
          label: "Time (Weeks) to Decrease of BKV Plasma Viral Load by 1 Log",
          value: "19.61 ± 11.75",
          kpi_type: "efficacy",
        },
        {
          label: "Time (Weeks) to First Decrease of BKV Plasma Viral Load to LLOQ",
          value: "NA ± NA",
          kpi_type: "efficacy",
        },
        {
          label: "Adverse events",
          value: "Bone marrow failure: 0/8, 1/10",
          kpi_type: "safety",
        },
        {
          label: "SAE rate — MAU868 arm",
          value: "3/10 SAEs",
          kpi_type: "safety",
        },
      ],
      false,
    );
    expect(out.efficacy?.value).toContain("19.61");
    expect(out.efficacy?.label).toMatch(/BKV/i);
    expect(out.safety?.value).toContain("3/10");
    expect(out.safety?.label).toMatch(/SAE/i);
    expect(out.extraEfficacy).toBe(1);
    expect(out.extraSafety).toBe(1);
  });
});

describe("indicatorsForFeedEvent", () => {
  const study = [
    {
      label: "ARCHER Phase 2 — recurrence",
      value: "Statistically significant reduction",
      kpi_type: "efficacy" as const,
      indicator_date: "2024-11-14",
    },
    {
      label: "MAVERIC Phase 3 — enrollment",
      value: "Recruiting",
      kpi_type: "other" as const,
      indicator_date: "2025-09-01",
    },
  ];

  it("shows study rollup once in the header helper", () => {
    const header = studyIndicatorsForFeedHeader(study);
    expect(header.length).toBeGreaterThan(0);
    expect(header.some((i) => /ARCHER/i.test(i.label ?? ""))).toBe(true);
  });

  it("hides study-rollup copies stamped onto press rows", () => {
    const press = indicatorsForFeedEvent(
      {
        event_date: "2026-08-28",
        indicators: study,
      },
      study,
    );
    expect(press).toHaveLength(0);
  });

  it("keeps a KPI dated to the event even if it also sits on the study rollup", () => {
    const dated = indicatorsForFeedEvent(
      {
        event_date: "2024-11-14",
        indicators: [
          {
            label: "ARCHER Phase 2 — recurrence",
            value: "Statistically significant reduction",
            kpi_type: "efficacy",
            indicator_date: "2024-11-14",
          },
        ],
      },
      study,
    );
    expect(dated).toHaveLength(1);
  });

  it("skips KPIs already shown in the header when walking the feed", () => {
    const shown = new Set<string>();
    markClinicalIndicatorsShown(shown, studyIndicatorsForFeedHeader(study));
    const again = indicatorsForFeedEvent(
      {
        event_date: "2024-11-14",
        indicators: [
          {
            label: "ARCHER Phase 2 — recurrence",
            value: "Statistically significant reduction",
            kpi_type: "efficacy",
            indicator_date: "2024-11-14",
          },
        ],
      },
      study,
      { alreadyShownKeys: shown },
    );
    expect(again).toHaveLength(0);
  });

  it("keeps a novel KPI that is not on the study rollup", () => {
    const novel = indicatorsForFeedEvent(
      {
        event_date: "2026-08-27",
        indicators: [
          {
            label: "Financing update",
            value: "Raised $50M",
            kpi_type: "other",
          },
        ],
      },
      study,
    );
    expect(novel.some((i) => /Financing/i.test(i.label ?? ""))).toBe(true);
  });
});
