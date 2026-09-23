import { describe, expect, it } from "vitest";

import {

  collectDiseaseSocFromRecords,

  diseaseSocFromProfile,

  indicationsCompatible,

  parseSocFlag,

  resolveEfficacySocCompare,

  resolveEfficacySocCompareWithDisease,

} from "./clinicalSocCompare";



describe("parseSocFlag", () => {

  it("maps better / similar / worse", () => {

    expect(parseSocFlag("better")).toBe("beat");

    expect(parseSocFlag("migliore")).toBe("beat");

    expect(parseSocFlag("similar")).toBe("match");

    expect(parseSocFlag("non-inferior")).toBe("match");

    expect(parseSocFlag("worse")).toBe("miss");

    expect(parseSocFlag("N/D")).toBe("unknown");

    expect(parseSocFlag("")).toBe("unknown");

  });

});



describe("resolveEfficacySocCompare", () => {

  it("flags beat from vs_soc on efficacy", () => {

    const cmp = resolveEfficacySocCompare({

      label: "ORR",

      value: "42%",

      kpi_type: "efficacy",

      vs_soc: "better",

    });

    expect(cmp?.flag).toBe("beat");

    expect(cmp?.basis).toBe("vs_soc");

  });



  it("uses same-trial comparator when vs_soc is empty", () => {

    const cmp = resolveEfficacySocCompare({

      label: "ORR",

      value: "42%",

      kpi_type: "efficacy",

      numeric_value: 42,

      comparator_value_numeric: 15,

    });

    expect(cmp?.flag).toBe("beat");

    expect(cmp?.basis).toBe("comparator");

  });



  it("treats HR as lower-better", () => {

    const cmp = resolveEfficacySocCompare({

      label: "OS HR",

      value: "0.72",

      kpi_type: "efficacy",

      numeric_value: 0.72,

      comparator_value_numeric: 1,

    });

    expect(cmp?.flag).toBe("beat");

  });



  it("names no-treatment SoC", () => {

    const cmp = resolveEfficacySocCompare({

      label: "ORR",

      value: "28%",

      kpi_type: "efficacy",

      soc_name: "no approved treatment",

      soc_is_none: true,

      soc_flag: "beat",

    });

    expect(cmp?.socIsNone).toBe(true);

    expect(cmp?.flag).toBe("beat");

  });



  it("skips safety rows", () => {

    expect(

      resolveEfficacySocCompare({

        label: "SAE rate",

        value: "12%",

        kpi_type: "safety",

        vs_soc: "better",

      }),

    ).toBeNull();

  });

});



describe("resolveEfficacySocCompareWithDisease", () => {

  it("infers beat from disease benchmark when KPI lacks vs_soc", () => {

    const cmp = resolveEfficacySocCompareWithDisease(

      {

        label: "ORR",

        value: "42%",

        kpi_type: "efficacy",

        numeric_value: 42,

      },

      {

        disease: "2L NSCLC",

        soc_name: "docetaxel",

        soc_efficacy_benchmark: "ORR ~15%",

      },

    );

    expect(cmp?.flag).toBe("beat");

    expect(cmp?.basis).toBe("benchmark");

  });

});



describe("indicationsCompatible", () => {

  it("accepts overlapping disease and conditions", () => {

    expect(

      indicationsCompatible("Duchenne Muscular Dystrophy", "Muscular Dystrophy, Duchenne"),

    ).toBe(true);

  });



  it("rejects unrelated disease blocks", () => {

    expect(

      indicationsCompatible(

        "Hidradenitis Suppurativa (HS)",

        "Muscular Dystrophy, Duchenne",

      ),

    ).toBe(false);

  });

});



describe("diseaseSocFromProfile", () => {

  it("keeps extracted disease SoC and falls back to conditions", () => {

    const ctx = diseaseSocFromProfile(

      {

        disease_soc: {

          disease: "2L NSCLC",

          usa_prevalence: "~230k prevalent US",

          soc_name: "docetaxel",

          soc_efficacy_benchmark: "ORR ~15%",

          life_expectancy: "median OS ~10 mo",

          symptoms: "dyspnea, cough",

        },

      },

      "Lung cancer",

    );

    expect(ctx.soc_name).toBe("docetaxel");

    expect(ctx.usa_prevalence).toContain("230k");

    expect(ctx.soc_efficacy_benchmark).toBe("ORR ~15%");

    expect(ctx.life_expectancy).toContain("10");

  });



  it("parses vs_standard_of_care note as benchmark", () => {

    const ctx = diseaseSocFromProfile({

      vs_standard_of_care: "ORR 42% vs SOC ~15% in 2L NSCLC",

    });

    expect(ctx.soc_efficacy_benchmark).toMatch(/SOC ~15%/i);

  });

  it("backfills soc_name from vs_standard_of_care when disease_soc.soc_name is empty", () => {
    const ctx = diseaseSocFromProfile({
      vs_standard_of_care: "ORR 42% vs SOC: docetaxel ~15%",
      disease_soc: { disease: "2L NSCLC", soc_name: null },
    });
    expect(ctx.soc_name).toMatch(/docetaxel/i);
  });

  it("promotes SoC name + ORR from platinum-resistant source_note prose", () => {
    const note =
      "Standard treatments for platinum-resistant ovarian cancer typically include PLD (pegylated liposomal doxorubicin), topotecan, or weekly paclitaxel ± bevacizumab; ORR roughly 20–30% depending on regimen and prior lines. No single global SoC; NCCN lists several options.";
    const ctx = diseaseSocFromProfile({
      disease_soc: {
        disease: "High-Grade Serous Ovarian Cancer",
        source_note: note,
      },
    });
    expect(ctx.soc_name).toMatch(/PLD|topotecan|paclitaxel/i);
    expect(ctx.soc_efficacy_benchmark).toMatch(/ORR/i);
    expect(ctx.soc_efficacy_benchmark).toMatch(/20/);
    expect(ctx.source_note).toContain("platinum-resistant");
  });

});



describe("collectDiseaseSocFromRecords", () => {

  it("uses conditions when profile is empty", () => {

    const ctx = collectDiseaseSocFromRecords(

      [{ ticker: "BDSX", meta: { conditions: "Lung cancer" } }],

      null,

      { ticker: "BDSX" },

    );

    expect(ctx?.disease).toBe("Lung cancer");

    expect(ctx?.soc_name).toBeNull();

  });



  it("filters by ticker and rejects mismatched disease_soc", () => {

    const ctx = collectDiseaseSocFromRecords(

      [

        {

          ticker: "SRPT",

          meta: { conditions: "Muscular Dystrophy, Duchenne" },

          ai: {

            study_clinical_profile: {

              disease_soc: {

                disease: "Hidradenitis Suppurativa (HS)",

                soc_name: "adalimumab",

                soc_efficacy_benchmark: "HiSCR50 ~60%",

                life_expectancy: "normal",

                symptoms: "abscesses",

              },

            },

          },

        },

        {

          ticker: "COCP",

          meta: { conditions: "Norovirus" },

          ai: {

            study_clinical_profile: {

              disease_soc: {

                disease: "Norovirus gastroenteritis",

                usa_prevalence: "~20M cases/yr US",

                soc_name: "supportive care",

                soc_efficacy_benchmark: "no antiviral SoC",

                symptoms: "vomiting, diarrhea",

              },

            },

          },

        },

      ],

      "Norovirus",

      { ticker: "COCP" },

    );

    expect(ctx?.disease).toMatch(/Norovirus/i);

    expect(ctx?.usa_prevalence).toMatch(/20M/i);

    expect(ctx?.soc_name).toBe("supportive care");

  });

});

