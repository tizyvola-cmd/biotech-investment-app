import { describe, expect, it } from "vitest";
import { isCtgovRegistryFeedEvent } from "./tickerEisSummary";

describe("isCtgovRegistryFeedEvent", () => {
  it("detects clinicaltrials.gov status updates", () => {
    expect(
      isCtgovRegistryFeedEvent({
        event_title:
          "ClinicalTrials.gov status update for NCT05635643 to active not recruiting",
        link: "https://clinicaltrials.gov/study/NCT05635643",
        source_type: "publication",
      }),
    ).toBe(true);
  });

  it("detects ctgov source_type", () => {
    expect(
      isCtgovRegistryFeedEvent({
        source_type: "ctgov",
        event_title: "Registry update",
      }),
    ).toBe(true);
  });

  it("does not flag real PubMed papers", () => {
    expect(
      isCtgovRegistryFeedEvent({
        source_type: "publication",
        event_title: "Phase 2 results of CHS-114 in solid tumors",
        link: "https://pubmed.ncbi.nlm.nih.gov/12345678/",
      }),
    ).toBe(false);
  });
});
