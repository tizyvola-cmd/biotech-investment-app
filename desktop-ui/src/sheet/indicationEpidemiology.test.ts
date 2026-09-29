import { describe, expect, it } from "vitest";
import {
  buildProductIndicationRows,
  lookupIndicationEpidemiology,
  resolveIndicationEpidemiology,
} from "./indicationEpidemiology";

describe("lookupIndicationEpidemiology", () => {
  it("maps HNSCC to SEER oral cavity / pharynx ranges", () => {
    const epi = lookupIndicationEpidemiology(
      "Head and Neck Squamous Cell Carcinoma",
    );
    expect(epi.usaPrevalence).toMatch(/461k/i);
    expect(epi.fiveYearSurvival).toMatch(/70%/);
  });

  it("maps advanced / metastatic solid tumor as umbrella basket", () => {
    const a = lookupIndicationEpidemiology("Advanced Solid Tumor");
    const b = lookupIndicationEpidemiology("Metastatic Solid Tumors");
    expect(a.usaPrevalence).toMatch(/umbrella|18M/i);
    expect(b.fiveYearSurvival).toMatch(/site-specific|69%/i);
  });
});

describe("resolveIndicationEpidemiology", () => {
  it("prefers matching disease_soc prevalence / 5y survival", () => {
    const epi = resolveIndicationEpidemiology("HNSCC", {
      diseaseSocs: [
        {
          disease: "Head and neck squamous cell carcinoma",
          usa_prevalence: "~400k custom",
          five_year_survival: "~55% distant-heavy trial population",
          life_expectancy: "median OS ~18 mo",
        },
      ],
    });
    expect(epi.usaPrevalence).toMatch(/400k custom/);
    expect(epi.fiveYearSurvival).toMatch(/55%/);
    expect(epi.lifeExpectancy).toMatch(/18 mo/);
  });
});

describe("buildProductIndicationRows", () => {
  it("attaches epi to each label", () => {
    const rows = buildProductIndicationRows([
      "Advanced Solid Tumor",
      "Head and Neck Squamous Cell Carcinoma",
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].epi.usaPrevalence).toBeTruthy();
    expect(rows[1].epi.fiveYearSurvival).toMatch(/70%/);
  });
});
