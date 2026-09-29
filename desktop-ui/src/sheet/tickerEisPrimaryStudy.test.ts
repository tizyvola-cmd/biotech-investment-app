import { describe, expect, it } from "vitest";
import type { ClinicalPreCdRecord } from "../api/supernova";
import type { EisBreakdown } from "./eventImpactScore";
import {
  assessCatalystFit,
  buildTickerEisDetail,
  pickPrimaryStudyContextEvent,
  type TickerEisEventDetail,
} from "./tickerEisSummary";

function bd(partial: Partial<EisBreakdown> & Pick<EisBreakdown, "score">): EisBreakdown {
  return {
    delta_p_1d: 0,
    delta_p_3d: 0,
    vol_ratio: 1,
    vol_term: 0,
    sentiment: 0,
    kpi_score: null,
    sent_term: 0,
    weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
    ...partial,
  };
}

function ev(
  partial: Partial<TickerEisEventDetail> & Pick<TickerEisEventDetail, "breakdown" | "title">,
): TickerEisEventDetail {
  return {
    eventDate: "2026-08-01",
    sourceType: "clinical",
    sourceLabel: "Clinical",
    nctId: "NCT00000001",
    studyTitle: "Study",
    studyUrl: null,
    indicators: [],
    impactNote: null,
    link: null,
    summary: null,
    ...partial,
  };
}

describe("pickPrimaryStudyContextEvent", () => {
  it("prefers the highest |EIS| trial over a newer low-impact symposium (KZIA)", () => {
    const ovarian = ev({
      eventDate: "2026-08-31",
      title: "EVT801 ovarian symposium",
      nctId: "NCT02903771",
      studyTitle: "Phase I Study of EVT801 in Ovarian Neoplasm",
      studyConditions: "Ovarian Neoplasm",
      asset: "EVT801",
      breakdown: bd({ score: 0.4, kpi_score: -0.2, delta_p_1d: 1 }),
    });
    const paxalisib = ev({
      eventDate: "2026-08-28",
      title: "Phase 1b paxalisib TNBC 100% clinical benefit rate",
      sourceType: "manual",
      nctId: "NCT03914742",
      studyTitle: "Paxalisib in Triple-Negative Breast Cancer",
      studyConditions: "Triple Negative Breast Cancer",
      studyPhase: "Phase 1b",
      asset: "paxalisib",
      breakdown: bd({ score: 8.2, kpi_score: 1.2, delta_p_1d: 28 }),
    });
    const primary = pickPrimaryStudyContextEvent([ovarian, paxalisib]);
    expect(primary?.nctId).toBe("NCT03914742");
    expect(primary?.asset).toBe("paxalisib");
  });

  it("does not let an earnings 8-K steal the study card from a clinical event", () => {
    const quell = ev({
      eventDate: "2026-08-05",
      title: "BioAge Labs first patient dosed in QUELL-CV Phase 2",
      sourceType: "press_release",
      nctId: "NCT07656421",
      breakdown: bd({ score: 0.8, kpi_score: 0.1, delta_p_1d: 2 }),
    });
    const earnings = ev({
      eventDate: "2026-07-31",
      title: "BioAge Labs Reports Second Quarter 2026 Financial Results",
      sourceType: "sec_8k",
      itemsRaw: "2.02",
      nctId: "NCT07656421",
      breakdown: bd({ score: -14, kpi_score: 0.1, delta_p_1d: -55 }),
    });
    const primary = pickPrimaryStudyContextEvent([quell, earnings]);
    expect(primary?.title).toMatch(/QUELL-CV/);
  });
});

describe("assessCatalystFit", () => {
  it("flags a crash inherited by earnings with no matching own-ticker trial (BIOA)", () => {
    const quell = ev({
      eventDate: "2026-08-05",
      title: "BioAge Labs first patient dosed in QUELL-CV Phase 2",
      sourceType: "press_release",
      breakdown: bd({ score: 0.8, kpi_score: 0.1, delta_p_1d: 2 }),
    });
    const earnings = ev({
      eventDate: "2026-07-31",
      title: "BioAge Labs Reports Second Quarter 2026 Financial Results",
      sourceType: "sec_8k",
      itemsRaw: "2.02",
      breakdown: bd({ score: -14, kpi_score: 0.1, delta_p_1d: -55 }),
    });
    expect(assessCatalystFit([quell, earnings], quell)).toBe("unexplained_readthrough");
  });

  it("is aligned when the high-|EIS| trial news matches the spike (KZIA)", () => {
    const paxalisib = ev({
      eventDate: "2026-08-28",
      title: "Phase 1b paxalisib TNBC readout",
      sourceType: "manual",
      breakdown: bd({ score: 8.2, kpi_score: 1.2, delta_p_1d: 28 }),
    });
    const ovarian = ev({
      eventDate: "2026-08-31",
      title: "EVT801 ovarian symposium",
      breakdown: bd({ score: 0.4, kpi_score: -0.2, delta_p_1d: 1 }),
    });
    expect(assessCatalystFit([ovarian, paxalisib], paxalisib)).toBe("aligned");
  });
});

function kziaRecords(): ClinicalPreCdRecord[] {
  return [
    {
      ticker: "KZIA",
      company: "Kazia Therapeutics",
      nct_id: "NCT02903771",
      sponsor_match: "Exact",
      meta: {
        brief_title: "Phase I Study of EVT801 in Ovarian Neoplasm",
        phase: "Phase 1",
        conditions: "Ovarian Neoplasm",
        lead_sponsor: "Kazia Therapeutics",
      },
      clinical_indicators: [
        {
          label: "Endpoint p",
          value: "0",
          kpi_type: "efficacy",
          numeric_value: 0,
          direction: "down",
        },
      ],
      clinical_events: [
        {
          event_date: "2026-08-31",
          event_title: "Kazia Therapeutics Announces Presentation of EVT801 Clinical Data",
          source_type: "congress",
          asset: "EVT801",
          eis: { score: 0.4, kpi_score: -0.2 },
          price: { delta_p_1d: 1, delta_p_3d: 2 },
        },
      ],
    },
    {
      ticker: "KZIA",
      company: "Kazia Therapeutics",
      nct_id: "NCT03914742",
      sponsor_match: "Exact",
      meta: {
        brief_title: "Paxalisib in Triple-Negative Breast Cancer",
        phase: "Phase 1b",
        conditions: "Triple Negative Breast Cancer",
        lead_sponsor: "Kazia Therapeutics",
      },
      clinical_indicators: [
        {
          label: "Clinical benefit rate",
          value: "100%",
          kpi_type: "efficacy",
          numeric_value: 100,
          direction: "up",
        },
      ],
      clinical_events: [
        {
          event_date: "2026-08-28",
          event_title: "Phase 1b paxalisib TNBC 100% clinical benefit rate",
          source_type: "manual",
          asset: "paxalisib",
          eis: { score: 8.2, kpi_score: 1.2 },
          price: { delta_p_1d: 28, delta_p_3d: 30, vol_ratio: 4 },
        },
      ],
    },
  ];
}

describe("buildTickerEisDetail HIGH-IMPACT study card", () => {
  it("KZIA: binds the card to paxalisib TNBC, not the newer EVT801 ovarian symposium", () => {
    const detail = buildTickerEisDetail("KZIA", "en", null, kziaRecords());
    expect(detail.nctId).toBe("NCT03914742");
    expect(detail.studyConditions).toMatch(/Triple Negative/i);
    expect(detail.studyPhase).toMatch(/1b/i);
    expect(detail.primaryEvent?.title).toMatch(/paxalisib/i);
    expect(detail.catalystFit).toBe("aligned");
    expect(detail.primaryStudyIndicators.some((i) => /benefit/i.test(i.label ?? ""))).toBe(true);
    expect(detail.primaryStudyIndicators.some((i) => /Endpoint p/i.test(i.label ?? ""))).toBe(false);
  });

  it("BIOA: flags read-through when the crash is earnings-dated and QUELL-CV KPIs are positive", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "BIOA",
        company: "BioAge Labs",
        nct_id: "NCT07656421",
        sponsor_match: "Exact",
        meta: {
          brief_title: "A Phase 2 Cardiovascular Outcomes Study in Obesity (QUELL-CV)",
          phase: "Phase 2",
          conditions: "Obesity, Cardiovascular",
          lead_sponsor: "BioAge Labs",
        },
        clinical_indicators: [
          {
            label: "hsCRP",
            value: "reduced",
            kpi_type: "biomarker",
            direction: "up",
          },
        ],
        clinical_events: [
          {
            event_date: "2026-08-05",
            event_title: "BioAge Labs first patient dosed in QUELL-CV Phase 2",
            source_type: "press_release",
            eis: { score: 0.8, kpi_score: 0.1 },
            price: { delta_p_1d: 2, delta_p_3d: 1 },
          },
          {
            event_date: "2026-07-31",
            event_title: "BioAge Labs Reports Second Quarter 2026 Financial Results",
            source_type: "sec_8k",
            items_raw: "2.02",
            eis: { score: -12, kpi_score: 0.1 },
            price: { delta_p_1d: -55, delta_p_3d: -58, vol_ratio: 10 },
          },
        ],
      },
    ];
    const detail = buildTickerEisDetail("BIOA", "en", null, records);
    expect(detail.catalystFit).toBe("unexplained_readthrough");
    expect(detail.studyTitle).toMatch(/QUELL-CV/i);
  });

  it("keeps anticipated / gated feed events as chart-only pallini without using them as primary", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "BDSX",
        company: "Biodesix",
        nct_id: "NCT06728319",
        sponsor_match: "Exact",
        meta: { lead_sponsor: "Biodesix, Inc.", brief_title: "Nodify Lung" },
        clinical_events: [
          {
            event_date: "2026-05-04",
            event_title: "Results of operations (earnings)",
            source_type: "sec_8k",
            eis: { score: 15.75 },
            price: { delta_p_1d: 1.71, delta_p_3d: 35.38 },
          },
          {
            event_date: "2026-03-01",
            event_title: "Potential CHEST 2026 or ATS 2026 abstract submission",
            source_type: "sec_8k",
            confirmation_status: "anticipated",
            eis_gated: "unverified_hypothesis",
          },
        ],
      },
    ];
    const detail = buildTickerEisDetail("BDSX", "en", null, records);
    const gated = detail.events.find((e) => e.chartOnly);
    expect(gated?.eventDate).toBe("2026-03-01");
    expect(detail.events.some((e) => e.eventDate === "2026-05-04" && !e.chartOnly)).toBe(true);
    expect(pickPrimaryStudyContextEvent(detail.events)?.eventDate).toBe("2026-05-04");
  });

  it("fills NCT / title / phase from a pre-CD record even with no feed events", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "BBNX",
        company: "Beta Bionics, Inc.",
        nct_id: "NCT05409131",
        cd_date: "2026-09-30",
        sponsor_match: "Exact",
        meta: {
          brief_title: "Insulin-Only Bionic Pancreas Pivotal Trial",
          phase: "Phase 3",
          conditions: "Type 1 Diabetes Mellitus",
          interventions: "iLet",
          lead_sponsor: "Beta Bionics, Inc.",
        },
        clinical_events: [],
      },
    ];
    const detail = buildTickerEisDetail("BBNX", "en", null, records, "2026-09-30");
    expect(detail.nctId).toBe("NCT05409131");
    expect(detail.studyTitle).toMatch(/Bionic Pancreas/i);
    expect(detail.studyPhase).toMatch(/3/i);
    expect(detail.studyConditions).toMatch(/Diabetes/i);
    expect(detail.studyDrug).toBe("iLet");
    expect(detail.cdDate).toBe("2026-09-30");
    expect(detail.events).toHaveLength(0);
  });

  it("still uses the ticker study record when its CD does not match Simulation", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "BBNX",
        company: "Beta Bionics, Inc.",
        nct_id: "NCT05409131",
        cd_date: "2026-10-15",
        sponsor_match: "Exact",
        meta: {
          brief_title: "Insulin-Only Bionic Pancreas Pivotal Trial",
          phase: "Phase 3",
          conditions: "Type 1 Diabetes Mellitus",
        },
        clinical_events: [],
      },
    ];
    const detail = buildTickerEisDetail("BBNX", "en", null, records, "2026-09-30");
    expect(detail.nctId).toBe("NCT05409131");
    expect(detail.studyTitle).toMatch(/Bionic Pancreas/i);
  });

  it("falls back to Simulation row NCT / phase / indication when the feed has no study", () => {
    const detail = buildTickerEisDetail("BBNX", "en", null, [], "2026-09-30", {
      Ticker: "BBNX",
      NCT: "NCT05409131",
      Phase: "Pivotal",
      Indication: "Type 1 Diabetes Mellitus",
      "Completion Date": "2026-09-30",
    });
    expect(detail.nctId).toBe("NCT05409131");
    expect(detail.studyPhase).toMatch(/Pivotal/i);
    expect(detail.studyConditions).toMatch(/Diabetes/i);
    expect(detail.cdDate).toBe("2026-09-30");
  });

  it("does not let a PDUFA 8-K replace the CD-matching trial on the approaching-CD card", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "AZN",
        company: "AstraZeneca PLC",
        nct_id: "NCT03557411",
        cd_date: "2026-08-31",
        sponsor_match: "Exact",
        meta: {
          brief_title:
            "Durvalumab After Chemoradiation in Unresectable Stage III NSCLC (PACIFIC)",
          phase: "Phase 3",
          conditions: "Non-small Cell Lung Cancer",
          interventions: "durvalumab (IMFINZI)",
          enrollment: 713,
          overall_status: "COMPLETED",
          lead_sponsor: "AstraZeneca",
        },
        outcome_measures: [{ type: "primary", title: "Progression-free survival vs placebo" }],
        clinical_events: [
          {
            event_date: "2026-08-31",
            event_title: "PDUFA date confirmed",
            source_type: "sec_8k",
            asset: "PDUFA",
            eis: { score: 9.4 },
            price: { delta_p_1d: 1.7, delta_p_3d: 2.1 },
          },
        ],
      },
    ];
    const detail = buildTickerEisDetail("AZN", "en", null, records, "2026-08-31", {
      Ticker: "AZN",
      Drug: "IMFINZI",
      Phase: "PDUFA",
      "Completion Date": "2026-08-31",
    });
    expect(detail.studyDrug).not.toMatch(/pdufa/i);
    expect(detail.studyPhase).not.toMatch(/pdufa/i);
    expect(detail.studyTitle).toMatch(/PACIFIC/i);
    expect(detail.cdCompletingStudy.nctId).toBe("NCT03557411");
    expect(detail.cdCompletingStudy.studyTitle).toMatch(/PACIFIC/i);
    expect(detail.cdCompletingStudy.studyPhase).toMatch(/3/i);
    expect(detail.cdCompletingStudy.studyConditions).toMatch(/Lung/i);
    expect(detail.cdCompletingStudy.studyDrug).toMatch(/durvalumab|IMFINZI/i);
    expect(detail.cdCompletingStudy.catalystKind).toBe("PDUFA");
    expect(detail.cdCompletingStudy.enrollment).toBe(713);
    expect(detail.cdCompletingStudy.primaryEndpoint).toMatch(/Progression-free/i);
  });

  it("still surfaces the sim-row drug when the CD is labeled PDUFA and CT.gov is empty", () => {
    const detail = buildTickerEisDetail("AZN", "en", null, [], "2026-08-31", {
      Ticker: "AZN",
      Drug: "IMFINZI",
      Phase: "PDUFA",
      Indication: "NSCLC",
      "Clinical Study": "PDUFA",
      "Completion Date": "2026-08-31",
    });
    expect(detail.cdCompletingStudy.catalystKind).toBe("PDUFA");
    expect(detail.cdCompletingStudy.studyDrug).toBe("IMFINZI");
    expect(detail.cdCompletingStudy.studyConditions).toMatch(/NSCLC/i);
    expect(detail.cdCompletingStudy.studyTitle).toBeNull();
    expect(detail.studyPhase).toBeNull();
  });

  it("fills the corresponding trial when inclusion is a guidance catalyst, not a CD", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "ENDV",
        company: "Endonovo Therapeutics, Inc.",
        nct_id: "NCT01234567",
        cd_date: "2027-03-31",
        sponsor_match: "Exact",
        meta: {
          brief_title: "SofPulse for Postoperative Pain After C-Section",
          phase: "Phase 3",
          conditions: "Postoperative Pain",
          interventions: "SofPulse",
          enrollment: 120,
          overall_status: "COMPLETED",
        },
        clinical_events: [],
      },
    ];
    const simRow = {
      Ticker: "ENDV",
      "Studio Phase": "PDUFA",
      "Completion Date": "27/08/2026",
      NCT: "",
      guidance_calendar_catalyst: true,
      guidance_event_type: "pdufa",
      guidance_asset_name: "SofPulse",
      guidance_trial_phase: "3",
      guidance_indication: "Postoperative pain",
    };
    const guidance = [
      {
        ticker: "ENDV",
        company: "Endonovo Therapeutics, Inc.",
        event_type: "pdufa" as const,
        asset_name: "SofPulse",
        trial_phase: "3",
        indication: "Postoperative pain",
        timing_quote: "PDUFA for SofPulse C-section pain study",
        window_start: "2026-08-27",
      },
    ];
    const detail = buildTickerEisDetail(
      "ENDV",
      "en",
      null,
      records,
      "2026-08-27",
      simRow,
      guidance,
    );
    expect(detail.cdCompletingStudy.catalystKind).toBe("PDUFA");
    expect(detail.cdCompletingStudy.studyDrug).toBe("SofPulse");
    expect(detail.cdCompletingStudy.nctId).toBe("NCT01234567");
    expect(detail.cdCompletingStudy.studyTitle).toMatch(/SofPulse/i);
    expect(detail.cdCompletingStudy.studyPhase).toMatch(/3/i);
    expect(detail.cdCompletingStudy.studyConditions).toMatch(/Pain/i);
  });

  it("uses guidance study fields when CT.gov has no record for a catalyst ticker", () => {
    const detail = buildTickerEisDetail(
      "ENDV",
      "en",
      null,
      [],
      "2026-08-27",
      {
        Ticker: "ENDV",
        "Studio Phase": "PDUFA",
        guidance_calendar_catalyst: true,
        guidance_event_type: "pdufa",
        guidance_asset_name: "SofPulse",
        guidance_trial_phase: "2",
        guidance_indication: "Postoperative pain",
        guidance_source_quote: "NDA accepted; PDUFA June 2026",
        "Completion Date": "27/08/2026",
      },
      [
        {
          ticker: "ENDV",
          company: "Endonovo Therapeutics",
          event_type: "pdufa" as const,
          asset_name: "SofPulse",
          trial_phase: "2",
          indication: "Postoperative pain",
          timing_quote: "NDA accepted; PDUFA June 2026",
          window_start: "2026-08-27",
        },
      ],
    );
    expect(detail.cdCompletingStudy.catalystKind).toBe("PDUFA");
    expect(detail.cdCompletingStudy.studyDrug).toBe("SofPulse");
    expect(detail.cdCompletingStudy.studyPhase).toMatch(/2/i);
    expect(detail.cdCompletingStudy.studyConditions).toMatch(/pain/i);
    expect(detail.cdCompletingStudy.timingQuote).toMatch(/NDA accepted/i);
  });

  it("names approaching-CD endpoints from that NCT's study page, not another trial's numbers", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "AXSM",
        company: "Axsome Therapeutics, Inc.",
        nct_id: "NCT03896009",
        cd_date: "2019-12-10",
        sponsor_match: "Exact",
        meta: {
          brief_title: "Maximizing Outcomes in Treating Acute Migraine",
          phase: "Phase 3",
          conditions: "Migraine",
          lead_sponsor: "Axsome Therapeutics, Inc.",
        },
        outcome_measures: [
          {
            type: "PRIMARY",
            title: "Percentage of Subjects Reporting Headache Pain Freedom",
            description: "Absence of headache pain. AXS-07 vs Placebo.",
            values: ["AXS-07: 85/428 (20%)"],
          },
        ],
        clinical_indicators: [
          { label: "Primary endpoint", value: "85", kpi_type: "efficacy" },
        ],
        clinical_events: [],
      },
      {
        ticker: "AXSM",
        company: "Axsome Therapeutics, Inc.",
        nct_id: "NCT06223880",
        cd_date: "2026-12-01",
        sponsor_match: "Exact",
        meta: {
          brief_title:
            "A Study to Evaluate the Efficacy of AXS-05 Compared to Bupropion in Preventing the Relapse of Depressive Symptoms",
          phase: "Phase 4",
          conditions: "Major Depressive Disorder",
          interventions: "AXS-05",
          enrollment: 350,
          overall_status: "Recruiting",
          lead_sponsor: "Axsome Therapeutics, Inc.",
        },
        outcome_measures: [
          {
            type: "PRIMARY",
            title: "Time from randomization to relapse of depressive symptoms",
            description: "Relapse of MADRS-defined depressive symptoms.",
            time_frame: "up to 26 weeks",
          },
        ],
        clinical_indicators: [
          { label: "Primary endpoint", value: "85", kpi_type: "efficacy" },
        ],
        clinical_events: [],
      },
    ];
    const detail = buildTickerEisDetail("AXSM", "en", null, records, "2026-12-01", {
      Ticker: "AXSM",
      Drug: "AXS-05",
      NCT: "NCT06223880",
      Phase: "Phase 4",
      "Completion Date": "2026-12-01",
    });
    expect(detail.cdCompletingStudy.nctId).toBe("NCT06223880");
    expect(detail.cdCompletingStudy.primaryEndpoint).toMatch(/relapse of depressive/i);
    expect(detail.cdStudyIndicators.some((i) => /relapse of depressive/i.test(i.label ?? ""))).toBe(
      true,
    );
    expect(detail.cdStudyIndicators.some((i) => i.value === "85")).toBe(false);
    expect(detail.cdStudyIndicators.some((i) => /Pain Freedom/i.test(i.label ?? ""))).toBe(false);
  });
});
