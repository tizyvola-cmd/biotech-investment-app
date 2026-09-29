import { describe, expect, it, beforeEach } from "vitest";
import {
  dismissEisNews,
  eisClinicalNewsStableId,
  eisFinancialNewsStableId,
  loadDismissedEisNewsIds,
  resetEisNewsDismissForTests,
} from "./eisNewsDismiss";

describe("eisNewsDismiss", () => {
  beforeEach(() => {
    resetEisNewsDismissForTests();
  });

  it("builds stable clinical and financial ids", () => {
    expect(
      eisClinicalNewsStableId({
        ticker: "gpcr",
        eventDate: "2024-09-08",
        title: "Structure Therapeutics Shares Slide",
        link: "https://example.com/a",
        sourceType: "press",
      }),
    ).toBe(
      "GPCR|clin|2024-09-08|press|https://example.com/a|Structure Therapeutics Shares Slide",
    );
    expect(
      eisFinancialNewsStableId({
        ticker: "BBNX",
        filingDate: "2026-09-14",
        title: "Item 8.01",
        link: "https://sec.gov/x",
        form: "8-K",
      }),
    ).toContain("BBNX|fin|2026-09-14|8-K|");
  });

  it("persists dismiss ids", () => {
    const id = eisClinicalNewsStableId({
      ticker: "GPCR",
      eventDate: "2024-09-08",
      title: "Hello",
      link: null,
      sourceType: "press",
    });
    dismissEisNews(id);
    expect(loadDismissedEisNewsIds().has(id)).toBe(true);
  });
});
