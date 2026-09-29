import { describe, expect, it } from "vitest";
import {
  blobMentionsProduct,
  clinicalRecordMatchesProduct,
  collectTickerPipelineProducts,
  findGuidanceEventForCd,
  productLinkTokensFromRecord,
} from "./studyProductLink";
import type { ClinicalPreCdRecord } from "../api/supernova";

const natalizumabCd: ClinicalPreCdRecord = {
  ticker: "BIIB",
  nct_id: "NCT09999999",
  meta: {
    brief_title: "Natalizumab for relapsing MS",
    interventions: "Natalizumab | Placebo",
  },
  ai: { study_clinical_profile: { product_name: "Natalizumab" } },
};

describe("productLinkTokensFromRecord", () => {
  it("keeps the lead drug and drops placebo", () => {
    const toks = productLinkTokensFromRecord(natalizumabCd);
    expect(toks.some((t) => t.includes("natalizumab"))).toBe(true);
    expect(toks.some((t) => t === "placebo")).toBe(false);
  });
});

describe("clinicalRecordMatchesProduct", () => {
  it("does not keep the completing NCT when it does not mention the drug", () => {
    const other: ClinicalPreCdRecord = {
      ticker: "BIIB",
      nct_id: "NCT09999999",
      meta: { brief_title: "Unrelated title", interventions: "Placebo" },
    };
    expect(
      clinicalRecordMatchesProduct(other, ["natalizumab"], "NCT09999999"),
    ).toBe(false);
  });

  it("keeps prior natalizumab studies and drops other company products", () => {
    const prior: ClinicalPreCdRecord = {
      ticker: "BIIB",
      nct_id: "NCT000097760",
      meta: {
        brief_title:
          "Natalizumab in Combination With Glatiramer Acetate (GA) in Patients With Relapsing-Remitting Multiple Sclerosis",
        interventions: "Natalizumab | Glatiramer Acetate",
      },
    };
    const otherAsset: ClinicalPreCdRecord = {
      ticker: "BIIB",
      nct_id: "NCT01234567",
      meta: {
        brief_title: "Dimethyl Fumarate (Tecfidera) in relapsing MS",
        interventions: "Dimethyl Fumarate | Placebo",
      },
    };
    const tokens = productLinkTokensFromRecord(natalizumabCd, ["Tysabri", "Natalizumab"]);
    expect(clinicalRecordMatchesProduct(prior, tokens, "NCT09999999")).toBe(true);
    expect(clinicalRecordMatchesProduct(otherAsset, tokens, "NCT09999999")).toBe(
      false,
    );
  });

  it("does not mix natalizumab studies into a litifilimab CD", () => {
    const natalizumabPrior: ClinicalPreCdRecord = {
      ticker: "BIIB",
      nct_id: "NCT00097760",
      meta: {
        brief_title:
          "Natalizumab in Combination With Glatiramer Acetate (GA) in Patients With Relapsing-Remitting Multiple Sclerosis",
        interventions: "Natalizumab | Glatiramer Acetate",
      },
    };
    const litifilimab: ClinicalPreCdRecord = {
      ticker: "BIIB",
      nct_id: "NCT05531565",
      meta: {
        brief_title: "Litifilimab (BIIB059) in cutaneous lupus erythematosus",
        interventions: "Litifilimab | Placebo",
      },
      ai: { study_clinical_profile: { product_name: "Litifilimab" } },
    };
    // Oldest ticker row is natalizumab — must not leak into litifilimab tokens.
    const tokens = productLinkTokensFromRecord(natalizumabPrior, [
      "Litifilimab",
      "BIIB059",
    ]);
    expect(tokens.some((t) => t.includes("natalizumab"))).toBe(false);
    expect(clinicalRecordMatchesProduct(natalizumabPrior, tokens, "NCT05531565")).toBe(
      false,
    );
    expect(clinicalRecordMatchesProduct(litifilimab, tokens, "NCT05531565")).toBe(
      true,
    );
  });
});

describe("collectTickerPipelineProducts", () => {
  it("emits one card per product and puts the completing CD first", () => {
    const records: ClinicalPreCdRecord[] = [
      natalizumabCd,
      {
        ticker: "BIIB",
        nct_id: "NCT00097760",
        meta: {
          brief_title: "Natalizumab + GA",
          interventions: "Natalizumab | Glatiramer Acetate",
        },
        ai: { study_clinical_profile: { product_name: "Natalizumab" } },
      },
      {
        ticker: "BIIB",
        nct_id: "NCT05531565",
        meta: {
          brief_title: "Litifilimab in CLE",
          interventions: "Litifilimab | Placebo",
        },
        ai: { study_clinical_profile: { product_name: "Litifilimab" } },
      },
      {
        ticker: "BIIB",
        nct_id: "NCT01234567",
        meta: {
          brief_title: "Aducanumab in Alzheimer's",
          interventions: "Aducanumab | Placebo",
        },
        ai: { study_clinical_profile: { product_name: "Aducanumab" } },
      },
    ];
    const out = collectTickerPipelineProducts(records, {
      ticker: "BIIB",
      primaryNctId: "NCT05531565",
      completingProduct: "Litifilimab",
    });
    expect(out[0]?.name).toMatch(/litifilimab/i);
    expect(out[0]?.isCompletingCd).toBe(true);
    const names = out.map((p) => p.name.toLowerCase());
    expect(names.some((n) => n.includes("natalizumab"))).toBe(true);
    expect(names.some((n) => n.includes("aducanumab"))).toBe(true);
    expect(out.filter((p) => /litifilimab/i.test(p.name))).toHaveLength(1);
  });

  it("seeds a product card from guidance when clinical feed is empty", () => {
    const out = collectTickerPipelineProducts([], {
      ticker: "REGN",
      cdIso: "2027-01-30",
      guidanceEvents: [
        {
          ticker: "REGN",
          company: "Regeneron",
          event_type: "cd",
          asset_name: "Fianlimab",
          trial_phase: "Phase 3",
          window_start: "2027-01-30",
          window_end: "2027-01-30",
          timing_quote: "Primary completion NCT09999999",
        },
      ],
    });
    expect(out[0]?.name).toMatch(/fianlimab/i);
    expect(out[0]?.isCompletingCd).toBe(true);
    expect(out[0]?.nctId).toBe("NCT09999999");
  });

  it("uses completingProduct from Catalyst/sim — never Study NCT as product name", () => {
    const out = collectTickerPipelineProducts([], {
      ticker: "CRVO",
      primaryNctId: "NCT06987643",
      completingProduct: "neflamapimod",
      cdIso: "2026-09-30",
      guidanceEvents: [
        {
          ticker: "CRVO",
          company: "CervoMed Inc.",
          event_type: "cd",
          asset_name: "",
          trial_phase: "Phase 2",
          window_start: "2026-09-30",
          window_end: "2026-09-30",
          timing_quote: "Primary completion 2026-09-30 (NCT06987643)",
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.isCompletingCd).toBe(true);
    expect(out[0]?.nctId).toBe("NCT06987643");
    expect(out[0]?.name).toMatch(/neflamapimod/i);
  });

  it("mounts an NCT-keyed completing card when asset_name is missing", () => {
    const out = collectTickerPipelineProducts([], {
      ticker: "CRVO",
      primaryNctId: "NCT06987643",
      cdIso: "2026-09-30",
      guidanceEvents: [
        {
          ticker: "CRVO",
          company: "CervoMed Inc.",
          event_type: "cd",
          asset_name: "",
          trial_phase: "Phase 2",
          window_start: "2026-09-30",
          window_end: "2026-09-30",
          timing_quote: "Primary completion 2026-09-30 (NCT06987643)",
        },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.isCompletingCd).toBe(true);
    expect(out[0]?.nctId).toBe("NCT06987643");
    expect(out[0]?.name).toBe("CD study");
    expect(out[0]?.name).not.toMatch(/^NCT\d/i);
  });

  it("rejects SHAREHOLDER noise and still keeps the NCT completing card", () => {
    const out = collectTickerPipelineProducts(
      [
        {
          ticker: "BBNX",
          company: "Beta Bionics",
          nct_id: null,
          meta: { brief_title: "BBNX — Daily News EIS" },
          clinical_events: [
            {
              drug: "SHAREHOLDER",
              event_title: "BBNX SHAREHOLDER ALERT: Bronstein",
              event_type: "press_release",
            },
          ],
        } as never,
      ],
      {
        ticker: "BBNX",
        primaryNctId: "NCT06449677",
        completingProduct: "SHAREHOLDER",
        cdIso: "2026-09-30",
        guidanceEvents: [
          {
            ticker: "BBNX",
            company: "Beta Bionics",
            event_type: "cd",
            asset_name: "",
            window_start: "2026-09-30",
            window_end: "2026-09-30",
            timing_quote: "Primary completion 2026-09-30 (NCT06449677)",
            nct_id: "NCT06449677",
          } as never,
        ],
      },
    );
    expect(out.every((p) => !/shareholder/i.test(p.name))).toBe(true);
    expect(out.every((p) => !/^NCT\d{8}$/i.test(p.name))).toBe(true);
    expect(out.some((p) => p.nctId === "NCT06449677" && p.isCompletingCd)).toBe(true);
  });
});

describe("findGuidanceEventForCd", () => {
  it("finds the calendar CD on that day", () => {
    const hit = findGuidanceEventForCd("REGN", "2027-01-30", [
      {
        ticker: "REGN",
        company: "Regeneron",
        event_type: "cd",
        asset_name: "Fianlimab",
        window_start: "2027-01-30",
      },
    ]);
    expect(hit?.asset_name).toMatch(/fianlimab/i);
  });
});

describe("blobMentionsProduct", () => {
  it("does not treat natalizumab titles as litifilimab", () => {
    expect(
      blobMentionsProduct(
        "Natalizumab in Combination With Glatiramer Acetate",
        "Litifilimab",
        ["BIIB059"],
      ),
    ).toBe(false);
    expect(
      blobMentionsProduct("Litifilimab (BIIB059) in CLE", "Litifilimab", ["BIIB059"]),
    ).toBe(true);
  });
});
