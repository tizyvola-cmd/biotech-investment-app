import { describe, expect, it } from "vitest";
import type { ClinicalPreCdRecord, GuidanceCalendarEvent } from "../api/supernova";
import {
  assignLaneLevelsByPx,
  buildClinicalDevelopmentLane,
  buildCompanyCatalystHorizon,
  classifyDevPathStage,
  CLINICAL_LANE_PRICE_RANGE,
  companyHorizonAxis,
  forwardHorizonAxis,
  layoutClinicalDevelopmentLaneChart,
  listTopClinicalPrograms,
  defaultClinicalProgramId,
  priceAlignedLaneAxis,
  programIdentityColor,
  resolveLanePlotWidth,
  studyFrameAxis,
} from "./clinicalDevelopmentLane";

const NOW = new Date("2026-09-04T12:00:00").getTime();

function rec(partial: Partial<ClinicalPreCdRecord> = {}): ClinicalPreCdRecord {
  return {
    ticker: "ZNTL",
    company: "Zentalis",
    nct_id: "NCT05128825",
    cd_date: "2026-12-01",
    sponsor_match: "exact",
    meta: {
      brief_title: "DENALI azenosertib PROC",
      phase: "PHASE 2",
      overall_status: "RECRUITING",
      conditions: "ovarian cancer",
      interventions: "azenosertib",
      enrollment: 310,
      lead_sponsor: "Zentalis Pharmaceuticals",
    },
    clinical_events: [
      {
        event_date: "2026-04-09",
        event_title: "Dose 400mg QD 5:2",
        source_type: "press_release",
        confirmation_status: "confirmed",
        summary: "Dose selected",
      },
      {
        event_date: "2027-06-01",
        event_title: "ASPENOVA readout",
        source_type: "congress",
        confirmation_status: "anticipated",
      },
    ],
    ...partial,
  };
}

describe("buildClinicalDevelopmentLane", () => {
  it("keeps dose-select / readout and fills the development-path template", () => {
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      completionDate: "2026-12-01",
      records: [rec()],
      lang: "en",
      nowMs: NOW,
    });
    expect(model).not.toBeNull();
    expect(model!.header.ticker).toBe("ZNTL");
    expect(model!.header.nctId).toBe("NCT05128825");
    expect(model!.header.phase).toBe("Phase 2");
    expect(model!.header.status).toBe("Recruiting");

    const titles = model!.markers.filter((m) => m.kind === "clinical").map((m) => m.title);
    expect(titles.some((t) => t.includes("Dose 400mg"))).toBe(true);
    expect(titles.some((t) => /ASPENOVA/i.test(t))).toBe(true);

    const past = model!.markers.find((m) => m.title.includes("Dose 400mg"));
    expect(past?.certainty).toBe("occurred");
    expect(past?.stageId).toBe("phase2");
    const inferred = model!.markers.find((m) => /ASPENOVA/i.test(m.title));
    expect(inferred?.certainty).toBe("inferred");
    expect(inferred?.stageId).toBe("congress");
    expect(model!.timingProximityDays).not.toBeNull();
    expect(model!.timingProximityDays!).toBeGreaterThan(0);

    const current = model!.pathStages.find((s) => s.status === "current");
    expect(current?.id).toBe("phase2");
    expect(model!.pathNote).toMatch(/upstream of submission/i);
  });

  it("fills header from a registry record with no feed events", () => {
    const model = buildClinicalDevelopmentLane({
      ticker: "BBNX",
      completionDate: "2026-09-30",
      records: [
        rec({
          ticker: "BBNX",
          company: "Beta Bionics, Inc.",
          nct_id: "NCT05409131",
          cd_date: "2026-09-30",
          meta: {
            brief_title: "Insulin-Only Bionic Pancreas Pivotal Trial",
            phase: "PHASE 3",
            overall_status: "ACTIVE_NOT_RECRUITING",
            conditions: "Type 1 Diabetes",
            interventions: "iLet",
            enrollment: 320,
            lead_sponsor: "Beta Bionics, Inc.",
          },
          clinical_events: [],
        }),
      ],
      lang: "en",
      nowMs: NOW,
    });
    expect(model!.header.nctId).toBe("NCT05409131");
    expect(model!.header.drug).toBe("iLet");
    expect(model!.header.studyShort).toMatch(/Bionic Pancreas/i);
    expect(model!.header.phase).toBe("Phase 3");
  });

  it("fills NCT / phase / indication from the Simulation row when the feed has no study", () => {
    const model = buildClinicalDevelopmentLane({
      ticker: "BBNX",
      completionDate: "2026-09-30",
      records: [],
      simRow: {
        Ticker: "BBNX",
        NCT: "NCT05409131",
        Phase: "Pivotal",
        Indication: "Type 1 Diabetes",
      },
      lang: "en",
      nowMs: NOW,
    });
    expect(model!.header.nctId).toBe("NCT05409131");
    expect(model!.header.phase).toMatch(/Pivotal/i);
    expect(model!.header.condition).toMatch(/Diabetes/i);
  });

  it("plots FDA AdCom votes on the drug-development lane", () => {
    const ev: GuidanceCalendarEvent = {
      ticker: "GRAL",
      company: "GRAIL, Inc.",
      event_type: "fda_vote",
      asset_name: "Galleri",
      window_start: "2026-09-23",
      window_end: "2026-09-23",
      source_type: "fda_adcom",
      timing_quote: "ODAC vote on Galleri",
    };
    expect(classifyDevPathStage("fda_vote Galleri", "fda_vote")).toBe("adcom");
    const model = buildClinicalDevelopmentLane({
      ticker: "GRAL",
      records: [rec({ ticker: "GRAL", company: "GRAIL, Inc.", clinical_events: [] })],
      guidanceEvents: [ev],
      lang: "en",
      nowMs: NOW,
    });
    const adcom = model!.markers.find((m) => m.stageId === "adcom");
    expect(adcom?.title).toMatch(/AdCom|Galleri/i);
  });

  it("maps guidance windows to expected markers with uncertainty span", () => {
    const ev: GuidanceCalendarEvent = {
      ticker: "ZNTL",
      company: "Zentalis",
      event_type: "readout",
      asset_name: "DENALI Part 2",
      window_start: "2026-11-15",
      window_end: "2026-12-31",
      estimation_method: "llm_extract",
      timing_quote: "late 2026 guidance",
    };
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      records: [rec({ clinical_events: [] })],
      guidanceEvents: [ev],
      lang: "en",
      nowMs: NOW,
    });
    const g = model!.markers.find((m) => m.title.includes("DENALI"));
    expect(g?.certainty).toBe("expected");
    expect(g?.windowEndMs).not.toBeNull();
  });

  it("drops earnings / 8-K noise and does not plot cash runway", () => {
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      records: [
        rec({
          clinical_events: [
            {
              event_date: "2026-08-05",
              event_title: "Results of operations (earnings)",
              source_type: "sec_8k",
              confirmation_status: "confirmed",
            },
            {
              event_date: "2026-07-27",
              event_title: "Officer/director departure or appointment",
              source_type: "press_release",
              confirmation_status: "confirmed",
            },
            {
              event_date: "2026-04-09",
              event_title: "Dose 400mg QD 5:2",
              source_type: "press_release",
              confirmation_status: "confirmed",
              summary: "Dose selected",
            },
          ],
        }),
      ],
      sdsRow: {
        ticker: "ZNTL",
        sds: 40,
        zone_label: "",
        zone_color: "",
        zone_action: "",
        cluster_d: { cash_runway: { runway_months: 16, total_cash_mm: 245.9 } },
      },
      lang: "en",
      nowMs: NOW,
    });
    const titles = model!.markers.filter((m) => m.kind === "clinical").map((m) => m.title);
    expect(titles.some((t) => /earnings|officer|director/i.test(t))).toBe(false);
    expect(model!.markers.some((m) => m.id.startsWith("cash-"))).toBe(false);
    expect(titles.some((t) => t.includes("Dose 400mg"))).toBe(true);
    expect(model!.pathStages.find((s) => s.status === "current")?.id).toBe("phase2");
  });

  it("returns null without ticker events", () => {
    expect(
      buildClinicalDevelopmentLane({
        ticker: "XXXX",
        records: [],
        lang: "en",
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("classifies development stages and rejects news noise", () => {
    expect(classifyDevPathStage("Dose 400mg QD 5:2 Dose selected", "press_release")).toBe("phase2");
    expect(classifyDevPathStage("ASPENOVA readout", "congress")).toBe("congress");
    expect(classifyDevPathStage("NDA submitted to the FDA", "press_release")).toBe("submission");
    expect(classifyDevPathStage("Officer/director departure", "press_release")).toBeNull();
    expect(classifyDevPathStage("Q2 2026 earnings: pipeline", "sec_8k")).toBeNull();
    expect(classifyDevPathStage("FDA Fast Track designation for PROC", "approval")).toBe(
      "designation",
    );
    expect(classifyDevPathStage("Anticipated — ESMO 2026 azenosertib", "readout")).toBe("congress");
    expect(classifyDevPathStage("accelerated approval pathway, no NDA filed", "approval")).toBeNull();
  });

  it("infers filing +60d from a dated submission and PDUFA from review estimate", () => {
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      records: [
        rec({
          cd_date: null,
          clinical_events: [
            {
              event_date: "2026-01-15",
              event_title: "NDA submitted to the FDA",
              source_type: "press_release",
              confirmation_status: "confirmed",
            },
          ],
        }),
      ],
      guidanceEvents: [
        {
          ticker: "ZNTL",
          company: "Zentalis",
          event_type: "submission",
          asset_name: "azenosertib",
          window_start: "2026-01-15",
          estimation_method: "priority_review_estimate",
        },
      ],
      lang: "en",
      nowMs: NOW,
    });
    const filing = model!.markers.find((m) => m.stageId === "filing");
    expect(filing?.certainty).toBe("inferred");
    const pdufa = model!.markers.find((m) => m.stageId === "pdufa");
    expect(pdufa?.certainty).toBe("inferred");
    expect(pdufa?.title).toMatch(/priority/i);
  });

  it("treats 1 Dec as DENALI Phase 2 CD, not approval, and does not light Approval from a designation", () => {
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      completionDate: "2026-12-01",
      records: [
        rec({
          clinical_events: [
            {
              event_date: "2026-09-01",
              event_title: "Anticipated — FDA Designation Fast Track",
              source_type: "press_release",
              event_type: "approval",
              confirmation_status: "anticipated",
            },
            {
              event_date: "2026-09-01",
              event_title: "Anticipated — ESMO 2026 azenosertib update",
              source_type: "congress",
              event_type: "readout",
              confirmation_status: "anticipated",
            },
          ],
        }),
      ],
      guidanceEvents: [
        {
          ticker: "ZNTL",
          company: "Zentalis",
          event_type: "other",
          asset_name: "azenosertib",
          timing_quote: "topline designed to support an accelerated approval pathway",
          window_start: "2026-12-01",
        },
      ],
      lang: "en",
      nowMs: NOW,
    });
    expect(model).not.toBeNull();
    expect(model!.pathStages.some((s) => s.id === "approval" && s.dateMs != null)).toBe(false);
    expect(model!.markers.some((m) => m.stageId === "approval")).toBe(false);
    expect(model!.markers.some((m) => m.stageId === "designation")).toBe(false);

    const esmo = model!.markers.find((m) => /ESMO/i.test(m.title));
    expect(esmo?.stageId).toBe("congress");
    expect(new Date(esmo!.plotMs).getMonth()).toBe(9);
    expect(new Date(esmo!.plotMs).getDate()).toBe(23);
    expect(esmo?.certainty).toBe("expected");

    const studyCd = model!.markers.find((m) => m.dateClass === "study_cd");
    expect(studyCd).toBeTruthy();
    expect(studyCd!.monthImputed).toBe(true);
    expect(studyCd!.certainty).toBe("inferred");
    expect(new Date(studyCd!.plotMs).getMonth()).toBe(11);

    const readoutChip = model!.pathStages.find((s) => s.id === "readout");
    expect(readoutChip?.dateMs).toBe(studyCd!.plotMs);
    expect(readoutChip?.dateImprecise).toBe(true);

    expect(model!.pathTopology).toBe("accelerated");
    expect(model!.pathStages.some((s) => s.id === "phase3")).toBe(false);
    expect(model!.confirmatoryPhase3?.id).toBe("phase3");
    expect(model!.pathNote).toMatch(/upstream of submission/i);
    expect(model!.pathNote).toMatch(/confirmatory in parallel/i);
    expect(model!.timingProximityUncertain).toBe(true);
    expect(model!.timingProximityDays).toBe(88);
  });
});

describe("clinical lane label packing", () => {
  const MS_DAY = 86_400_000;
  const start = Date.parse("2026-01-01T12:00:00");
  const end = Date.parse("2027-07-01T12:00:00");

  it("puts overlapping labels on distinct vertical levels", () => {
    const packed = assignLaneLevelsByPx(
      [
        { id: "a", x: 0, widthPx: 100 },
        { id: "b", x: 18, widthPx: 100 },
        { id: "c", x: 36, widthPx: 100 },
      ],
      6,
    );
    expect(packed.overflow).toBe(false);
    expect(new Set(packed.levels.values()).size).toBe(3);
  });

  it("widens the plot when many markers cluster on the same week", () => {
    const sparse = resolveLanePlotWidth(
      start,
      end,
      [
        { id: "a", plotMs: start + 40 * MS_DAY, widthPx: 90 },
        { id: "b", plotMs: end - 40 * MS_DAY, widthPx: 90 },
      ],
      [],
    );
    const clustered = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      plotMs: Date.parse("2026-06-04T12:00:00") + i * MS_DAY,
      widthPx: 130,
    }));
    const dense = resolveLanePlotWidth(start, end, clustered, []);
    expect(dense).toBeGreaterThan(sparse);
  });

  it("lays out a built model wider than a single viewport when events bunch", () => {
    const events = Array.from({ length: 8 }, (_, i) => ({
      event_date: `2026-10-${String(2 + i).padStart(2, "0")}`,
      event_title: `Cluster event ${i} AACR ASCO readout`,
      source_type: "press_release",
      confirmation_status: "confirmed",
    }));
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      records: [rec({ clinical_events: events })],
      lang: "en",
      nowMs: NOW,
      axisOverride: forwardHorizonAxis(NOW, 12),
    });
    expect(model).not.toBeNull();
    const layout = layoutClinicalDevelopmentLaneChart(model!);
    expect(layout.svgW).toBeGreaterThan(920);
    const clinLevels = [...layout.clinicalLevels.values()];
    expect(new Set(clinLevels).size).toBeGreaterThan(1);
  });

  it("does not overwrite ESMO and December CD on a wide fitted viewport", () => {
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      completionDate: "2026-12-01",
      records: [
        rec({
          clinical_events: [
            {
              event_date: "2026-09-01",
              event_title: "Anticipated — ESMO 2026 azenosertib update",
              source_type: "congress",
              event_type: "readout",
              confirmation_status: "anticipated",
            },
          ],
        }),
      ],
      lang: "en",
      nowMs: NOW,
      axisOverride: priceAlignedLaneAxis("cat6M", NOW),
    });
    const esmo = model!.markers.find((m) => /ESMO/i.test(m.title));
    const studyCd = model!.markers.find((m) => m.dateClass === "study_cd");
    expect(esmo && studyCd).toBeTruthy();
    const layout = layoutClinicalDevelopmentLaneChart(model!, { fitViewportPx: 1920 });
    expect(layout.clinicalLevels.get(esmo!.id)).not.toBe(layout.clinicalLevels.get(studyCd!.id));
  });

  it("hides overflow instead of painting two labels on the same lane", () => {
    const packed = assignLaneLevelsByPx(
      Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, x: 0, widthPx: 120 })),
      3,
    );
    expect(packed.overflow).toBe(true);
    expect(packed.levels.size).toBe(3);
    expect(packed.hidden.size).toBe(7);
    expect(new Set(packed.levels.values()).size).toBe(3);
  });

  it("collapses duplicate study-CD readouts in the same window", () => {
    const model = buildClinicalDevelopmentLane({
      ticker: "TELA",
      completionDate: "2026-06-30",
      records: [
        rec({
          ticker: "TELA",
          nct_id: "NCT123",
          cd_date: "2026-06-30",
          clinical_events: [
            {
              event_date: "2026-06-30",
              event_title: "CD window closes — NCT123",
              source_type: "cd_milestone",
              event_type: "cd_milestone",
              confirmation_status: "anticipated",
            },
            {
              event_date: "2026-06-30",
              event_title: "Expected CD — A Retrospective Study of OviTex",
              source_type: "cd_milestone",
              event_type: "cd_milestone",
              confirmation_status: "anticipated",
            },
          ],
        }),
      ],
      lang: "en",
      nowMs: NOW,
    });
    const cdLike = model!.markers.filter(
      (m) => m.dateClass === "study_cd" || /readout study|cd window|expected cd/i.test(m.title),
    );
    expect(cdLike.length).toBe(1);
  });
});

describe("price-aligned clinical lane axis", () => {
  it("matches the Cal 6M price-chart window (~6 months back + 6 months forward)", () => {
    expect(CLINICAL_LANE_PRICE_RANGE).toBe("cat6M");
    const axis = priceAlignedLaneAxis("cat6M", NOW);
    const spanDays = (axis.endMs - axis.startMs) / 86_400_000;
    expect(spanDays).toBeGreaterThan(300);
    expect(spanDays).toBeLessThan(420);
    expect(axis.endMs).toBeGreaterThan(NOW + 150 * 86_400_000);
    expect(axis.startMs).toBeLessThan(NOW - 150 * 86_400_000);
  });

  it("matches the 6M price-chart window (lookback + short future pad)", () => {
    const axis = priceAlignedLaneAxis("6M", NOW);
    expect(axis.endMs - axis.startMs).toBeGreaterThan(150 * 86_400_000);
    expect(axis.endMs - axis.startMs).toBeLessThan(220 * 86_400_000);
    expect(axis.endMs).toBeGreaterThan(NOW);
    expect(axis.startMs).toBeLessThan(NOW);
  });

  it("narrows the model axis when override is set", () => {
    const axis = priceAlignedLaneAxis("1M", NOW);
    const full = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      records: [rec()],
      lang: "en",
      nowMs: NOW,
    });
    const aligned = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      records: [rec()],
      lang: "en",
      nowMs: NOW,
      axisOverride: axis,
    });
    expect(full!.axisEndMs - full!.axisStartMs).toBeGreaterThan(
      aligned!.axisEndMs - aligned!.axisStartMs,
    );
    expect(aligned!.axisStartMs).toBe(axis.startMs);
    expect(aligned!.axisEndMs).toBe(axis.endMs);
  });

  it("fits synced layout to the viewport instead of expanding for density", () => {
    const axis = priceAlignedLaneAxis("6M", NOW);
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      records: [rec()],
      lang: "en",
      nowMs: NOW,
      axisOverride: axis,
    });
    const layout = layoutClinicalDevelopmentLaneChart(model!, { fitViewportPx: 800 });
    expect(layout.svgW).toBeLessThanOrEqual(840);
    expect(layout.svgW).toBeGreaterThan(500);
  });

  it("clamps a huge fitted viewport so the SVG cannot grow without bound", () => {
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      records: [rec()],
      lang: "en",
      nowMs: NOW,
    });
    const layout = layoutClinicalDevelopmentLaneChart(model!, { fitViewportPx: 80_000 });
    expect(layout.svgW).toBeLessThanOrEqual(2200);
    expect(layout.svgH).toBeLessThanOrEqual(640);
  });

  it("lists the 3 most advanced programs and scopes the lane to one drug", () => {
    const records = [
      rec({
        ticker: "INBX",
        nct_id: "NCT04198766",
        cd_date: "2026-10-30",
        meta: {
          brief_title: "INBRX-106 OX40",
          phase: "PHASE 2",
          overall_status: "RECRUITING",
          conditions: "Solid Tumor",
          interventions: "INBRX-106",
          enrollment: 340,
        },
        clinical_events: [
          {
            event_date: "2026-07-15",
            event_title: "Phase 1 dose escalation complete",
            source_type: "press_release",
            confirmation_status: "confirmed",
            summary: "Phase 1 completed for INBRX-106",
          },
        ],
      }),
      rec({
        ticker: "INBX",
        nct_id: "NCT03736823",
        cd_date: "2027-01-01",
        meta: {
          brief_title: "INBRX-109 chondrosarcoma",
          phase: "PHASE 2",
          overall_status: "RECRUITING",
          conditions: "Chondrosarcoma",
          interventions: "INBRX-109",
          enrollment: 200,
        },
        clinical_events: [
          {
            event_date: "2026-08-01",
            event_title: "INBRX-109 interim",
            source_type: "press_release",
            confirmation_status: "confirmed",
            summary: "Interim for INBRX-109",
          },
        ],
      }),
      rec({
        ticker: "INBX",
        nct_id: "NCT03834710",
        cd_date: "2028-06-01",
        meta: {
          brief_title: "INBRX-105 PD-L1",
          phase: "PHASE 1",
          overall_status: "RECRUITING",
          conditions: "Solid Tumor",
          interventions: "INBRX-105",
          enrollment: 80,
        },
        clinical_events: [],
      }),
      rec({
        ticker: "INBX",
        nct_id: "NCT99999999",
        meta: {
          brief_title: "Early discovery",
          phase: "EARLY PHASE 1",
          interventions: "INBRX-099",
          enrollment: 10,
        },
        clinical_events: [],
      }),
    ];
    const programs = listTopClinicalPrograms({
      ticker: "INBX",
      records,
      completionDate: "2026-10-30",
      limit: 3,
    });
    expect(programs).toHaveLength(3);
    expect(programs.map((p) => p.drug)).toEqual(
      expect.arrayContaining(["INBRX-106", "INBRX-109", "INBRX-105"]),
    );
    expect(programs.some((p) => p.drug === "INBRX-099")).toBe(false);

    const focused = programs.find((p) => p.drug === "INBRX-106")!;
    const model = buildClinicalDevelopmentLane({
      ticker: "INBX",
      completionDate: "2026-10-30",
      records,
      guidanceEvents: [
        {
          ticker: "INBX",
          event_type: "pdufa",
          asset_name: "INBRX-109",
          window_start: "2027-04-14",
          timing_quote: "PDUFA for 109",
        },
        {
          ticker: "INBX",
          event_type: "readout",
          asset_name: "INBRX-106",
          window_start: "2026-10-10",
          timing_quote: "Readout 106",
        },
      ],
      lang: "en",
      nowMs: NOW,
      programId: focused.id,
    });
    expect(model!.header.drug).toBe("INBRX-106");
    const titles = model!.markers.map((m) => m.title).join(" | ");
    expect(titles).toMatch(/106|OX40|Phase 1|Readout/i);
    expect(titles).not.toMatch(/INBRX-109|PDUFA for 109/i);
  });

  it("frames the Gantt on the NCT (start → completion) and plots CT.gov study milestones", () => {
    const records = [
      rec({
        ticker: "CRDL",
        company: "Cardiol Therapeutics",
        nct_id: "NCT04615649",
        cd_date: "2026-09-23",
        meta: {
          brief_title: "Cannabidiol in Patients With COVID-19",
          phase: "PHASE2 / PHASE3",
          overall_status: "TERMINATED",
          conditions: "COVID-19",
          interventions: "Cannabidiol",
          enrollment: 80,
          study_design: "Randomized · double-blind · placebo",
          start_date: "2020-11-15",
          primary_completion_date: "2021-06-30",
          completion_date: "2021-08-12",
        },
        clinical_events: [],
      }),
    ];
    const draft = buildClinicalDevelopmentLane({
      ticker: "CRDL",
      completionDate: "2026-09-23",
      records,
      lang: "en",
      nowMs: NOW,
      axisOverride: { startMs: Date.parse("2020-01-01T12:00:00"), endMs: Date.parse("2022-01-01T12:00:00") },
    });
    const studyAxis = studyFrameAxis(records[0], draft?.markers ?? [], NOW);
    const model = buildClinicalDevelopmentLane({
      ticker: "CRDL",
      completionDate: "2026-09-23",
      records,
      lang: "en",
      nowMs: NOW,
      axisOverride: { startMs: studyAxis.start, endMs: studyAxis.end },
    });
    expect(model).not.toBeNull();
    const titles = model!.markers.filter((m) => m.kind === "clinical").map((m) => m.title);
    expect(titles.some((t) => /study start/i.test(t))).toBe(true);
    expect(titles.some((t) => /primary completion/i.test(t))).toBe(true);
    expect(titles.some((t) => /terminated|study completion/i.test(t))).toBe(true);
    expect(titles.some((t) => /readout study/i.test(t))).toBe(false);
    expect(model!.header.phase).toMatch(/Phase 2/i);
    expect(model!.header.status).toMatch(/Terminated/i);
    expect(model!.studyFrameNote).toMatch(/final milestone/i);
    const start = Date.parse("2020-11-01T12:00:00");
    const end = Date.parse("2021-09-30T12:00:00");
    expect(model!.axisStartMs).toBeGreaterThanOrEqual(start - 40 * 86_400_000);
    expect(model!.axisEndMs).toBeLessThan(end + 80 * 86_400_000);
    expect(model!.axisEndMs).toBeLessThan(NOW - 1000 * 86_400_000);
  });

  it("defaults product Gantt to a 12-month forward axis", () => {
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      records: [rec()],
      lang: "en",
      nowMs: NOW,
    });
    const fwd = forwardHorizonAxis(NOW, 12);
    expect(model!.axisStartMs).toBe(fwd.startMs);
    expect(model!.axisEndMs).toBe(fwd.endMs);
  });

  it("keeps a path-strip readout date on the Gantt even when it sits before the default lookback", () => {
    const pastCd = "2026-07-27";
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      completionDate: pastCd,
      records: [
        rec({
          cd_date: pastCd,
          meta: {
            brief_title: "DENALI azenosertib PROC",
            phase: "PHASE3",
            overall_status: "ACTIVE_NOT_RECRUITING",
            primary_completion_date: pastCd,
            completion_date: pastCd,
          },
        }),
      ],
      lang: "en",
      nowMs: NOW,
      axisOverride: forwardHorizonAxis(NOW, 12),
    });
    expect(model).not.toBeNull();
    const readoutChip = model!.pathStages.find((s) => s.id === "readout");
    expect(readoutChip?.dateMs).toBeTruthy();
    expect(model!.axisStartMs).toBeLessThanOrEqual(readoutChip!.dateMs!);
    const layout = layoutClinicalDevelopmentLaneChart(model!);
    const onChart = model!.markers.filter((m) => layout.visibleMarkerIds.has(m.id));
    expect(
      onChart.some(
        (m) =>
          m.stageId === "readout" ||
          m.dateClass === "study_cd" ||
          /readout/i.test(m.title),
      ),
    ).toBe(true);
  });

  it("builds a 30-day company horizon colored by program stage", () => {
    const horizon = buildCompanyCatalystHorizon({
      ticker: "AXSM",
      records: [
        rec({
          ticker: "AXSM",
          nct_id: "NCT1",
          meta: {
            brief_title: "AXS-05 MDD",
            phase: "PHASE 3",
            interventions: "AXS-05",
            conditions: "MDD",
            overall_status: "RECRUITING",
          },
          clinical_events: [
            {
              event_date: "2026-09-20",
              event_title: "AXS-05 Phase 3 readout",
              source_type: "press_release",
              event_type: "readout",
              confirmation_status: "anticipated",
            },
          ],
        }),
        rec({
          ticker: "AXSM",
          nct_id: "NCT2",
          meta: {
            brief_title: "Solriamfetol narcolepsy",
            phase: "PHASE 4",
            interventions: "Solriamfetol",
            conditions: "narcolepsy",
            overall_status: "RECRUITING",
          },
          clinical_events: [
            {
              event_date: "2026-10-01",
              event_title: "Solriamfetol Phase 4 readout",
              source_type: "press_release",
              event_type: "readout",
              confirmation_status: "anticipated",
            },
          ],
        }),
      ],
      guidanceEvents: [
        {
          ticker: "AXSM",
          asset_name: "Solriamfetol",
          event_type: "readout",
          trial_phase: "Phase 4",
          window_start: "2026-10-01",
          window_end: "2026-10-01",
        } as GuidanceCalendarEvent,
      ],
      lang: "en",
      nowMs: NOW,
    });
    expect(horizon).not.toBeNull();
    const axis = companyHorizonAxis(NOW, 30);
    expect(horizon!.horizonDays).toBe(30);
    expect(horizon!.axisEndMs).toBe(axis.endMs);
    expect(horizon!.items.length).toBeGreaterThan(0);
    expect(horizon!.items.every((i) => i.plotMs <= axis.endMs)).toBe(true);
    expect(new Set(horizon!.items.map((i) => i.color)).size).toBeGreaterThanOrEqual(1);
  });

  it("expands company horizon to 365 days when next 30 days are empty", () => {
    const horizon = buildCompanyCatalystHorizon({
      ticker: "REGN",
      records: [
        rec({
          ticker: "REGN",
          nct_id: "NCT06868815",
          meta: {
            brief_title: "REGN Phase 2",
            phase: "PHASE2",
            interventions: "REGN-X",
            conditions: "indication",
            overall_status: "RECRUITING",
            primary_completion_date: "2027-03-15",
          },
          clinical_events: [
            {
              event_date: "2027-03-15",
              event_title: "REGN-X Phase 2 readout",
              source_type: "press_release",
              event_type: "readout",
              confirmation_status: "anticipated",
            },
          ],
        }),
      ],
      guidanceEvents: [
        {
          ticker: "REGN",
          asset_name: "REGN-X",
          event_type: "readout",
          trial_phase: "Phase 2",
          window_start: "2027-03-15",
          window_end: "2027-03-15",
        } as GuidanceCalendarEvent,
      ],
      lang: "en",
      nowMs: NOW,
    });
    expect(horizon).not.toBeNull();
    expect(horizon!.horizonDays).toBe(365);
    expect(horizon!.items.length).toBeGreaterThan(0);
    expect(horizon!.items.every((i) => i.plotMs <= horizon!.axisEndMs)).toBe(true);
    const forced30 = buildCompanyCatalystHorizon({
      ticker: "REGN",
      records: horizon!.programs.length
        ? [
            rec({
              ticker: "REGN",
              nct_id: "NCT06868815",
              meta: {
                brief_title: "REGN Phase 2",
                phase: "PHASE2",
                interventions: "REGN-X",
                overall_status: "RECRUITING",
                primary_completion_date: "2027-03-15",
              },
              clinical_events: [
                {
                  event_date: "2027-03-15",
                  event_title: "REGN-X Phase 2 readout",
                  source_type: "press_release",
                  event_type: "readout",
                  confirmation_status: "anticipated",
                },
              ],
            }),
          ]
        : [],
      lang: "en",
      nowMs: NOW,
      horizonDays: 30,
    });
    expect(forced30!.horizonDays).toBe(30);
    expect(forced30!.items.length).toBe(0);
  });

  it("does not paint the ticker Simulation CD on a different product", () => {
    const records = [
      rec({
        ticker: "CRDL",
        nct_id: "NCT06708299",
        cd_date: "2026-09-23",
        meta: {
          brief_title: "MAvERIC-3",
          phase: "PHASE 3",
          overall_status: "RECRUITING",
          interventions: "CardiolRx",
          enrollment: 200,
          primary_completion_date: "2026-09-23",
        },
        clinical_events: [],
      }),
      rec({
        ticker: "CRDL",
        nct_id: "NCT04615649",
        cd_date: "2026-09-23",
        meta: {
          brief_title: "COVID cannabidiol",
          phase: "PHASE2 / PHASE3",
          overall_status: "TERMINATED",
          interventions: "Cannabidiol",
          enrollment: 80,
          start_date: "2020-11-15",
          completion_date: "2021-08-12",
        },
        clinical_events: [],
      }),
    ];
    const programs = listTopClinicalPrograms({ ticker: "CRDL", records, completionDate: "2026-09-23" });
    expect(programs[0]?.drug).toBe("CardiolRx");
    expect(programs.map((p) => p.drug)).toContain("Cannabidiol");
    const cbd = programs.find((p) => p.drug === "Cannabidiol")!;
    const model = buildClinicalDevelopmentLane({
      ticker: "CRDL",
      completionDate: "2026-09-23",
      records,
      lang: "en",
      nowMs: NOW,
      programId: cbd.id,
    });
    const titles = model!.markers.map((m) => m.title).join(" | ");
    expect(titles).not.toMatch(/Readout Study/i);
    expect(model!.header.nctId).toBe("NCT04615649");
  });

  it("seeds a Deep Dive program from sim NCT + CD when no drug name exists", () => {
    const programs = listTopClinicalPrograms({
      ticker: "BBNX",
      completionDate: "2026-09-30",
      simRow: {
        NCT: "NCT08449617",
        "Clinical Study": "Daily News US",
        study_phase: "PHASE 3",
      },
    });
    expect(programs.length).toBeGreaterThan(0);
    expect(programs[0]?.nctId).toBe("NCT08449617");
    expect(defaultClinicalProgramId(programs, "2026-09-30")).toBe(programs[0].id);

    const model = buildClinicalDevelopmentLane({
      ticker: "BBNX",
      completionDate: "2026-09-30",
      simRow: {
        NCT: "NCT08449617",
        "Clinical Study": "Daily News US",
        study_phase: "PHASE 3",
      },
      lang: "en",
      nowMs: NOW,
      programId: programs[0].id,
      axisOverride: forwardHorizonAxis(NOW, 12),
    });
    expect(model).toBeTruthy();
    expect(model!.header.nctId).toBe("NCT08449617");
    expect(model!.pathStages.length).toBeGreaterThan(0);
    const layout = layoutClinicalDevelopmentLaneChart(model!);
    expect(layout.svgH).toBeGreaterThan(80);
  });

  it("header switches NCT/drug when selecting another product (no primary sticky)", () => {
    const records = [
      rec({
        ticker: "BIIB",
        nct_id: "NCT00097760",
        cd_date: "2004-03-01",
        company: "Biogen",
        meta: {
          brief_title: "Natalizumab in Combination With Glatiramer",
          phase: "PHASE2",
          overall_status: "COMPLETED",
          interventions: "Natalizumab",
          conditions: "Multiple Sclerosis",
          enrollment: 110,
          start_date: "2002-01-01",
          completion_date: "2004-03-01",
        },
        clinical_events: [],
      }),
      rec({
        ticker: "BIIB",
        nct_id: "NCT05373992",
        cd_date: "2026-06-15",
        company: "Biogen",
        meta: {
          brief_title: "Litifilimab in Cutaneous Lupus",
          phase: "PHASE3",
          overall_status: "RECRUITING",
          interventions: "Litifilimab",
          conditions: "Cutaneous Lupus Erythematosus",
          enrollment: 450,
          start_date: "2022-05-01",
          primary_completion_date: "2026-06-15",
          completion_date: "2026-12-01",
        },
        clinical_events: [],
      }),
    ];
    const programs = listTopClinicalPrograms({
      ticker: "BIIB",
      records,
      completionDate: "2004-03-01",
      limit: 20,
    });
    const natalizumab = programs.find((p) => /natalizumab/i.test(p.drug))!;
    const litifilimab = programs.find((p) => /litifilimab/i.test(p.drug))!;
    expect(natalizumab).toBeTruthy();
    expect(litifilimab).toBeTruthy();

    const primaryLane = buildClinicalDevelopmentLane({
      ticker: "BIIB",
      completionDate: "2004-03-01",
      records,
      lang: "en",
      nowMs: NOW,
      programId: natalizumab.id,
    });
    expect(primaryLane!.header.drug).toMatch(/Natalizumab/i);
    expect(primaryLane!.header.nctId).toBe("NCT00097760");

    const otherLane = buildClinicalDevelopmentLane({
      ticker: "BIIB",
      completionDate: "2004-03-01",
      records,
      lang: "en",
      nowMs: NOW,
      programId: litifilimab.id,
    });
    expect(otherLane!.header.drug).toMatch(/Litifilimab/i);
    expect(otherLane!.header.nctId).toBe("NCT05373992");
    expect(otherLane!.header.studyShort).toMatch(/Litifilimab/i);
    expect(otherLane!.header.enrollment).toBe(450);
  });

  it("each product chip gets its own guidance markers (no company-wide Gantt bleed)", () => {
    const records = [
      rec({
        ticker: "GILD",
        nct_id: "NCT10000001",
        meta: {
          brief_title: "Remdesivir COVID",
          phase: "PHASE3",
          interventions: "Remdesivir",
          conditions: "COVID-19",
          enrollment: 1000,
          overall_status: "COMPLETED",
          start_date: "2020-01-01",
          completion_date: "2021-06-01",
        },
        clinical_events: [],
      }),
      rec({
        ticker: "GILD",
        nct_id: "NCT10000002",
        meta: {
          brief_title: "Idelalisib CLL",
          phase: "PHASE3",
          interventions: "Idelalisib",
          conditions: "CLL",
          enrollment: 400,
          overall_status: "COMPLETED",
          start_date: "2012-01-01",
          completion_date: "2015-06-01",
        },
        clinical_events: [],
      }),
    ];
    const guidance = [
      {
        ticker: "GILD",
        company: "Gilead",
        event_type: "pdufa",
        asset_name: "Veklury",
        trial_phase: "APPROVED",
        window_start: "2026-12-23",
        timing_quote: "PDUFA Veklury",
        source_type: "catalyst_calendar",
      },
      {
        ticker: "GILD",
        company: "Gilead",
        event_type: "adcom",
        asset_name: "Idelalisib",
        trial_phase: "PHASE3",
        window_start: "2026-09-16",
        timing_quote: "AdCom Idelalisib",
        source_type: "catalyst_calendar",
      },
      {
        ticker: "GILD",
        company: "Gilead",
        event_type: "cd",
        asset_name: "Obeldesivir",
        trial_phase: "PHASE2",
        window_start: "2027-03-01",
        timing_quote: "Obeldesivir readout",
        source_type: "catalyst_calendar",
      },
    ];
    const programs = listTopClinicalPrograms({
      ticker: "GILD",
      records,
      guidanceEvents: guidance,
      limit: 20,
    });
    const veklury = programs.find((p) => /veklury|remdesivir/i.test(p.drug))!;
    const idelalisib = programs.find((p) => /idelalisib/i.test(p.drug))!;
    const obeldesivir = programs.find((p) => /obeldesivir/i.test(p.drug))!;
    expect(veklury).toBeTruthy();
    expect(idelalisib).toBeTruthy();
    expect(obeldesivir).toBeTruthy();

    const nowMs = Date.parse("2026-09-16T12:00:00Z");
    const axis = { startMs: nowMs, endMs: nowMs + 370 * 86_400_000 };
    const vLane = buildClinicalDevelopmentLane({
      ticker: "GILD",
      records,
      guidanceEvents: guidance,
      lang: "en",
      nowMs,
      programId: veklury.id,
      axisOverride: axis,
    })!;
    const iLane = buildClinicalDevelopmentLane({
      ticker: "GILD",
      records,
      guidanceEvents: guidance,
      lang: "en",
      nowMs,
      programId: idelalisib.id,
      axisOverride: axis,
    })!;
    const oLane = buildClinicalDevelopmentLane({
      ticker: "GILD",
      records,
      guidanceEvents: guidance,
      lang: "en",
      nowMs,
      programId: obeldesivir.id,
      axisOverride: axis,
    })!;

    const vTitles = vLane.markers.map((m) => m.title).join(" | ");
    const iTitles = iLane.markers.map((m) => m.title).join(" | ");
    const oTitles = oLane.markers.map((m) => m.title).join(" | ");
    expect(vTitles).toMatch(/Veklury|PDUFA/i);
    expect(vTitles).not.toMatch(/Idelalisib|Obeldesivir/i);
    expect(iTitles).toMatch(/Idelalisib|AdCom/i);
    expect(iTitles).not.toMatch(/Veklury|Obeldesivir/i);
    expect(oTitles).toMatch(/Obeldesivir/i);
    expect(oTitles).not.toMatch(/Veklury|Idelalisib/i);
    expect(vLane.pathNote ?? "").not.toMatch(/Idelalisib|Obeldesivir/i);
    expect(iLane.pathNote ?? "").not.toMatch(/Veklury|Obeldesivir/i);
  });

  it("plots catalyst-calendar primary completion on the study lane", () => {
    expect(classifyDevPathStage("primary completion NCT1", "trial_primary_completion")).toBe(
      "readout",
    );
    const model = buildClinicalDevelopmentLane({
      ticker: "ZNTL",
      records: [rec()],
      guidanceEvents: [
        {
          ticker: "ZNTL",
          company: "Zentalis",
          event_type: "cd",
          asset_name: "azenosertib",
          trial_phase: "PHASE 2",
          window_start: "2026-11-15",
          timing_quote: "Primary completion NCT05128825",
          source_type: "catalyst_calendar",
        },
      ],
      lang: "en",
      nowMs: NOW,
    });
    const hit = model!.markers.find((m) => /Primary completion NCT05128825/i.test(m.detail));
    expect(hit?.stageId).toBe("readout");
  });

  it("pins a distinct Development Path per NCT (no product guidance bleed)", () => {
    const records = [
      rec({
        ticker: "FRPT",
        company: "Fractyl",
        nct_id: "NCT99900001",
        cd_date: "2026-10-01",
        meta: {
          brief_title: "Revita pivotal Phase 2",
          phase: "PHASE2",
          overall_status: "ACTIVE_NOT_RECRUITING",
          conditions: "Type 2 Diabetes",
          interventions: "Revita DMR",
          enrollment: 300,
          start_date: "2023-01-01",
          completion_date: "2026-10-01",
        },
        clinical_events: [
          {
            event_date: "2024-09-15",
            event_title: "Phase 2 start",
            event_type: "trial_start",
            confirmation_status: "confirmed",
          },
        ],
      }),
    ];
    const programs = listTopClinicalPrograms({
      ticker: "FRPT",
      records,
      guidanceEvents: [
        {
          ticker: "FRPT",
          company: "Fractyl",
          event_type: "readout",
          asset_name: "Revita DMR",
          trial_phase: "PHASE2",
          window_start: "2026-10-01",
          timing_quote: "Revita DMR pivotal readout",
        },
      ],
      completionDate: "2026-10-01",
      limit: 5,
    });
    const programId = programs[0]?.id;
    expect(programId).toBeTruthy();

    const registry = buildClinicalDevelopmentLane({
      ticker: "FRPT",
      completionDate: "2028-07-01",
      records,
      guidanceEvents: [
        {
          ticker: "FRPT",
          company: "Fractyl",
          event_type: "readout",
          asset_name: "Revita DMR",
          trial_phase: "PHASE2",
          window_start: "2026-10-01",
          timing_quote: "Revita DMR pivotal readout",
        },
      ],
      lang: "en",
      nowMs: NOW,
      programId,
      nctId: "NCT06256497",
      phaseOverride: null,
    });
    expect(registry).not.toBeNull();
    expect(registry!.header.nctId).toBe("NCT06256497");
    // Observational registry: no Phase 2 inheritance from the product chip.
    expect(registry!.header.phase).toBeNull();
    const registryReadout = registry!.pathStages.find((s) => s.id === "readout");
    expect(registryReadout?.dateMs).toBe(Date.parse("2028-07-01T12:00:00"));
    const phase2 = registry!.pathStages.find((s) => s.id === "phase2");
    expect(phase2?.dateMs).toBeNull();

    const crossover = buildClinicalDevelopmentLane({
      ticker: "FRPT",
      completionDate: "2027-03-01",
      records,
      guidanceEvents: [
        {
          ticker: "FRPT",
          company: "Fractyl",
          event_type: "readout",
          asset_name: "Revita DMR",
          trial_phase: "PHASE2",
          window_start: "2026-10-01",
          timing_quote: "Revita DMR pivotal readout",
        },
      ],
      lang: "en",
      nowMs: NOW,
      programId,
      nctId: "NCT06092476",
      phaseOverride: "PHASE1",
    });
    expect(crossover).not.toBeNull();
    expect(crossover!.header.nctId).toBe("NCT06092476");
    expect(crossover!.header.phase).toMatch(/phase\s*1/i);
    const crossoverReadout = crossover!.pathStages.find((s) => s.id === "readout");
    expect(crossoverReadout?.dateMs).toBe(Date.parse("2027-03-01T12:00:00"));
    expect(crossoverReadout?.dateMs).not.toBe(registryReadout?.dateMs);
  });
});

describe("programIdentityColor", () => {
  it("keeps the same swatch for the same product id", () => {
    const a = programIdentityColor("CRDL|rivenpraz");
    const b = programIdentityColor("CRDL|rivenpraz");
    const c = programIdentityColor("ZNTL|denali-part-2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
