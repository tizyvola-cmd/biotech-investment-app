import { describe, expect, it } from "vitest";
import {
  clinicalAssetProductName,
  collectEisProductBriefing,
  eisProductBriefingHasBody,
  mergeProductBriefingWithAiLookup,
  productBriefingNeedsAiEnrichment,
} from "./eisProductBriefing";
import type { ClinicalPreCdRecord } from "../api/supernova";

const REC: ClinicalPreCdRecord = {
  ticker: "ETON",
  nct_id: "NCT123",
  meta: { interventions: "ET-400, oral tablet", conditions: "CAH" },
  ai: {
    study_clinical_profile: {
      product_name: "ET-400",
      product_technology: "native cortisol replacement (oral)",
      mechanism_of_action: "Restores physiologic cortisol rhythm without glucocorticoid excess.",
      disease_soc: { disease: "CAH", soc_name: "hydrocortisone" },
    },
  },
};

describe("collectEisProductBriefing", () => {
  it("reads product / technology / MoA from study_clinical_profile", () => {
    const b = collectEisProductBriefing([REC], { ticker: "ETON", nctId: "NCT123" });
    expect(b.productName).toBe("ET-400");
    expect(b.productTechnology).toMatch(/cortisol/i);
    expect(b.mechanismOfAction).toMatch(/cortisol rhythm/i);
    expect(b.modality).toBeTruthy();
    expect(b.indication).toBe("CAH");
    expect(b.standardOfCare).toMatch(/hydrocortisone/i);
    expect(eisProductBriefingHasBody(b)).toBe(true);
  });

  it("normalizes modality and extracts therapeutic target from MoA", () => {
    const rec: ClinicalPreCdRecord = {
      ticker: "NRIX",
      ai: {
        study_clinical_profile: {
          product_name: "ziftomenib",
          product_technology: "small molecule",
          mechanism_of_action: "Selective menin-KMT2A inhibitor; impairs leukemic transcription.",
          disease_soc: { disease: "NPM1-mutant AML" },
        },
      },
    };
    const b = collectEisProductBriefing([rec], { ticker: "NRIX" });
    expect(b.modality).toMatch(/small molecule/i);
    expect(b.therapeuticTarget).toMatch(/menin/i);
  });

  it("falls back to interventions and SDS mechanism_class", () => {
    const bare: ClinicalPreCdRecord = {
      ticker: "NRIX",
      meta: { interventions: "ziftomenib" },
    };
    const b = collectEisProductBriefing([bare], {
      ticker: "NRIX",
      sdsMechanismClass: "menin-KMT2A inhibitor",
    });
    expect(b.productName).toBe("ziftomenib");
    expect(b.mechanismOfAction).toBe("menin-KMT2A inhibitor");
    expect(b.source).toBe("meta");
  });

  it("skips placebo and uses CT.gov intervention before studyDrug hint", () => {
    const bare: ClinicalPreCdRecord = {
      ticker: "CRDL",
      nct_id: "NCT999",
      meta: { interventions: "Placebo | CardiolRx" },
    };
    const b = collectEisProductBriefing([bare], {
      ticker: "CRDL",
      nctId: "NCT999",
      studyDrug: "SHOULD_NOT_WIN",
    });
    expect(b.productName).toBe("CardiolRx");
  });

  it("mergeProductBriefingWithAiLookup fills gaps from Gemini patch", () => {
    const base = collectEisProductBriefing([REC], { ticker: "ETON" });
    const sparse = {
      ...base,
      modality: null,
      mechanismOfAction: null,
      therapeuticTarget: null,
      source: "meta" as const,
    };
    expect(productBriefingNeedsAiEnrichment(sparse)).toBe(true);
    const merged = mergeProductBriefingWithAiLookup(sparse, {
      modality: "Small molecule",
      mechanism_of_action: "Cortisol replacement therapy.",
      therapeutic_target: "glucocorticoid receptor pathway",
    });
    expect(merged.modality).toMatch(/small molecule/i);
    expect(merged.mechanismOfAction).toMatch(/cortisol/i);
    expect(merged.therapeuticTarget).toMatch(/glucocorticoid/i);
    expect(merged.source).toBe("mixed");
  });

  it("rejects disease names as therapeutic_target", () => {
    const sparse = {
      productName: "FIX-GT",
      productTechnology: null,
      modality: null,
      mechanismOfAction: null,
      therapeuticTarget: null,
      interventions: null,
      indication: null,
      usaPrevalence: null,
      standardOfCare: null,
      phase3And4Products: null,
      source: "none" as const,
    };
    const merged = mergeProductBriefingWithAiLookup(sparse, {
      mechanism_of_action: "Gene therapy delivering FIX.",
      therapeutic_target: "Hemophilia B",
      indication: "Hemophilia B",
    });
    expect(merged.indication).toBe("Hemophilia B");
    expect(merged.therapeuticTarget).toBeNull();
  });

  it("mergeProductBriefingWithAiLookup fills indication / prevalence / SoC / Phase 3-4", () => {
    const base = collectEisProductBriefing([REC], { ticker: "ETON" });
    expect(productBriefingNeedsAiEnrichment(base)).toBe(true);
    const merged = mergeProductBriefingWithAiLookup(base, {
      usa_prevalence: "~20k diagnosed US",
      phase_3_and_4_products: "DrugX (Acme, Phase 3); DrugY (Beta, Phase 4)",
    });
    expect(merged.indication).toBe("CAH");
    expect(merged.usaPrevalence).toMatch(/20k/i);
    expect(merged.phase3And4Products).toMatch(/Phase 3/i);
    expect(merged.source).toBe("mixed");
  });

  it("reads clinical_events drug when interventions missing", () => {
    const bare: ClinicalPreCdRecord = {
      ticker: "ABCD",
      nct_id: "NCT111",
      clinical_events: [{ drug: "SofPulse", summary: "update" }],
    };
    expect(clinicalAssetProductName([bare], { ticker: "ABCD", nctId: "NCT111" })).toBe(
      "SofPulse",
    );
  });
});
