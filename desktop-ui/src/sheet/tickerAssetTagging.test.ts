import { describe, expect, it, beforeEach } from "vitest";
import type { ClinicalPreCdRecord } from "../api/supernova";
import { buildTickerEisDetail } from "./tickerEisSummary";
import {
  computeClassificationCoverage,
  resolveAssetId,
  resolveAssetRole,
  resolveEventNctId,
  resolveTickerPipeline,
  resetTickerPipelineMapCache,
  tagEventAssetRole,
  type TickerPipeline,
} from "./tickerAssetTagging";
import type { EisBreakdown } from "./eventImpactScore";
import type { TickerEisEventDetail } from "./tickerEisSummary";

function bd(score = 1): EisBreakdown {
  return {
    score,
    delta_p_1d: 1,
    delta_p_3d: 2,
    vol_ratio: 1,
    vol_term: 0,
    sentiment: 0,
    kpi_score: null,
    sent_term: 0,
    weights: { w1: 0.35, w2: 0.35, w3: 0.15, w4: 0.15 },
  };
}

function ev(
  partial: Partial<TickerEisEventDetail> & Pick<TickerEisEventDetail, "title">,
): TickerEisEventDetail {
  return {
    eventDate: "2026-08-01",
    sourceType: "press_release",
    sourceLabel: "Press",
    nctId: null,
    studyTitle: "",
    studyUrl: null,
    indicators: [],
    impactNote: null,
    link: null,
    summary: null,
    breakdown: bd(),
    ...partial,
  };
}

const pipeline: TickerPipeline = {
  ticker: "KZIA",
  cdAssetId: "paxalisib",
  programs: [
    {
      assetId: "paxalisib",
      name: "paxalisib",
      isCdAsset: true,
      nctId: "NCT03914742",
    },
    {
      assetId: "evt801",
      name: "EVT801",
      isCdAsset: false,
      nctId: "NCT02903771",
    },
  ],
};

describe("resolveEventNctId", () => {
  it("uses event nct_id field first", () => {
    expect(
      resolveEventNctId({ nct_id: "NCT03914742", event_title: "x" }, "NCT00000000"),
    ).toBe("NCT03914742");
  });

  it("extracts NCT from title without inheriting parent record", () => {
    expect(
      resolveEventNctId(
        { event_title: "Data from NCT02903771 presented" },
        "NCT03914742",
      ),
    ).toBe("NCT02903771");
  });

  it("does not inherit parent NCT for press/manual", () => {
    expect(
      resolveEventNctId(
        { event_title: "Company announces financing", source_type: "press_release" },
        "NCT03914742",
      ),
    ).toBeNull();
  });

  it("inherits parent NCT only for CT.gov synthetic source", () => {
    expect(
      resolveEventNctId(
        { event_title: "CT.gov registry update", source_type: "ctgov" },
        "NCT05128825",
      ),
    ).toBe("NCT05128825");
  });
});

describe("asset tagging roles", () => {
  it("tags cd_study by NCT match", () => {
    const tagged = tagEventAssetRole(
      ev({ title: "paxalisib update", nctId: "NCT03914742", asset: "paxalisib" }),
      pipeline,
    );
    expect(tagged.assetId).toBe("paxalisib");
    expect(tagged.assetRole).toBe("cd_study");
  });

  it("tags other_pipeline by drug keyword", () => {
    const tagged = tagEventAssetRole(
      ev({ title: "EVT801 Clinical Data at congress", asset: "EVT801" }),
      pipeline,
    );
    expect(tagged.assetId).toBe("evt801");
    expect(tagged.assetRole).toBe("other_pipeline");
  });

  it("tags corporate when asset is Corporate and no program id", () => {
    const tagged = tagEventAssetRole(
      ev({
        title: "Q2 financial results",
        sourceType: "sec_8k",
        itemsRaw: "2.02",
        asset: "Corporate",
      }),
      pipeline,
    );
    expect(tagged.assetId).toBeNull();
    expect(tagged.assetRole).toBe("corporate");
  });

  it("never defaults ambiguous lead program to cd_study", () => {
    const role = resolveAssetRole(null, pipeline, {
      title: "Update on our lead program",
      summary: "",
      sourceType: "sec_8k",
      asset: null,
    });
    expect(role).toBe("unclassified");
  });

  it("does not assign cd_study by temporal proximity alone", () => {
    const id = resolveAssetId(
      ev({ title: "Unrelated analyst note", nctId: null, asset: null }),
      pipeline,
    );
    expect(id).toBeNull();
    expect(
      resolveAssetRole(id, pipeline, {
        title: "Unrelated analyst note",
        summary: "",
        sourceType: "press_release",
        asset: null,
      }),
    ).toBe("unclassified");
  });
});

describe("classificationCoverage", () => {
  it("gates Company Memory when unclassified share >= 20%", () => {
    const cov = computeClassificationCoverage([
      { chartOnly: false, assetRole: "cd_study" },
      { chartOnly: false, assetRole: "unclassified" },
      { chartOnly: false, assetRole: "unclassified" },
      { chartOnly: false, assetRole: "unclassified" },
      { chartOnly: false, assetRole: "unclassified" },
    ]);
    expect(cov.companyMemoryAllowed).toBe(false);
    expect(cov.coverage).toBeCloseTo(0.2);
  });

  it("allows Company Memory when unclassified share < 20%", () => {
    const cov = computeClassificationCoverage([
      { chartOnly: false, assetRole: "cd_study" },
      { chartOnly: false, assetRole: "other_pipeline" },
      { chartOnly: false, assetRole: "corporate" },
      { chartOnly: false, assetRole: "cd_study" },
      { chartOnly: false, assetRole: "cd_study" },
      { chartOnly: false, assetRole: "unclassified" },
    ]);
    expect(cov.unclassified / cov.scoredEvents).toBeLessThan(0.2);
    expect(cov.companyMemoryAllowed).toBe(true);
  });
});

describe("buildTickerEisDetail event NCT + tagging", () => {
  beforeEach(() => resetTickerPipelineMapCache());

  it("does not stamp sibling study NCT onto a press event without NCT", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "DEMO",
        company: "Demo Co",
        nct_id: "NCT11111111",
        sponsor_match: "Exact",
        meta: {
          brief_title: "Study A",
          interventions: "drug-a",
          lead_sponsor: "Demo Co",
        },
        clinical_events: [
          {
            event_date: "2026-08-01",
            event_title: "Financing closed",
            source_type: "sec_8k",
            asset: "Corporate",
            items_raw: "2.02",
            eis: { score: 1 },
            price: { delta_p_1d: 2 },
          },
          {
            event_date: "2026-08-02",
            event_title: "CT.gov registry update",
            source_type: "ctgov",
            nct_id: "NCT11111111",
            drug: "drug-a",
            link: "https://clinicaltrials.gov/study/NCT11111111",
            eis: { score: 0.5 },
            price: { delta_p_1d: 1 },
            reference_verified: true,
            reference_match: "ctgov",
          },
        ],
      },
    ];
    const detail = buildTickerEisDetail("DEMO", "en", null, records);
    const press = detail.events.find((e) => /Financing/i.test(e.title));
    const ctgov = detail.events.find((e) => /CT\.gov/i.test(e.title));
    expect(press).toBeTruthy();
    expect(press?.nctId).toBeNull();
    expect(ctgov?.nctId).toBe("NCT11111111");
    expect(press?.assetRole).toBe("corporate");
    expect(detail.classificationCoverage.scoredEvents).toBeGreaterThan(0);
  });

  it("KZIA config map tags paxalisib as cd_study", () => {
    const pipe = resolveTickerPipeline("KZIA");
    expect(pipe.cdAssetId).toBe("paxalisib");
    const tagged = tagEventAssetRole(
      ev({ title: "paxalisib TNBC", asset: "paxalisib", nctId: "NCT03914742" }),
      pipe,
    );
    expect(tagged.assetRole).toBe("cd_study");
  });
});
