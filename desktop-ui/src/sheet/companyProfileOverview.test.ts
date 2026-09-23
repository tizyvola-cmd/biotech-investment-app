import { describe, expect, it } from "vitest";
import {
  buildCompanyProfileOverview,
  isApprovedPhase,
  simRowsForTicker,
} from "./companyProfileOverview";

describe("isApprovedPhase", () => {
  it("detects marketed / cleared products", () => {
    expect(isApprovedPhase("Approved")).toBe(true);
    expect(isApprovedPhase("510(k) cleared")).toBe(true);
    expect(isApprovedPhase("Phase 2")).toBe(false);
  });
});

describe("simRowsForTicker", () => {
  it("filters by ticker", () => {
    const rows = [
      { Ticker: "BDSX", Drug: "Nodify" },
      { Ticker: "CPIX", Drug: "Other" },
    ];
    expect(simRowsForTicker(rows, "bdsx")).toHaveLength(1);
  });
});

describe("buildCompanyProfileOverview", () => {
  it("splits pipeline vs approved and builds a mission line", () => {
    const profile = buildCompanyProfileOverview({
      ticker: "BDSX",
      company: "Biodesix, Inc.",
      simRows: [
        {
          Ticker: "BDSX",
          Drug: "Nodify CDT",
          Indication: "lung nodule",
          Phase: "Phase 2",
        },
        {
          Ticker: "BDSX",
          Drug: "Nodify XL2",
          Indication: "lung cancer diagnostic",
          Phase: "Commercial",
        },
      ],
    });
    expect(profile.approved.map((p) => p.name)).toContain("Nodify XL2");
    expect(profile.pipeline.map((p) => p.name)).toContain("Nodify CDT");
    expect(profile.mission).toMatch(/Biodesix/);
  });

  it("uses guidance FDA approved outcome", () => {
    const profile = buildCompanyProfileOverview({
      ticker: "BDSX",
      company: "Biodesix, Inc.",
      guidanceEvents: [
        {
          ticker: "BDSX",
          company: "Biodesix, Inc.",
          event_type: "approval",
          asset_name: "Nodify XL2",
          indication: "lung",
          fda_outcome: "approved",
        },
      ],
    });
    expect(profile.approved[0]?.name).toBe("Nodify XL2");
  });
});
