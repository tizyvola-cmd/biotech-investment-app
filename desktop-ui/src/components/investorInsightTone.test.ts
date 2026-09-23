import { describe, expect, it } from "vitest";
import { resolveInvestorInsightPolarity } from "./investorInsightTone";

const LGND_CLEAN =
  "Product path: FDA DPV reports no new pediatric safety concerns for Zelsuvmi "
  + "(berdazimer) and plans continued routine pharmacovigilance — this package does "
  + "not add a new safety restriction based on the review text. This appears to be a "
  + "first PAC presentation for the product's pediatric postmarketing review. "
  + "Company / stock (LGND): for Ligand Pharmaceuticals Incorporated, a clean "
  + "postmarketing pediatric review is usually near-term noise to mildly constructive "
  + "on franchise/safety overhang — not a trading signal unless the committee raises "
  + "unexpected questions beyond the written package.";

describe("resolveInvestorInsightPolarity", () => {
  it("does not paint clean DPV / mildly constructive insight red (mixed tone)", () => {
    expect(resolveInvestorInsightPolarity(LGND_CLEAN, "mixed")).toBe("positive");
  });

  it("stays constructive without tone override", () => {
    expect(resolveInvestorInsightPolarity(LGND_CLEAN, null)).toBe("positive");
  });

  it("paints death-coded FAERS packages red", () => {
    expect(
      resolveInvestorInsightPolarity(
        "Product path: FAERS includes 60 reports with the outcome of death. "
          + "Company / stock: bearish on the franchise.",
        "negative",
      ),
    ).toBe("negative");
  });
});
