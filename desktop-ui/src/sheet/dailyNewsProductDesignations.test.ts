import { describe, expect, it } from "vitest";
import {
  formatProductDesignationCell,
  newsProductDesignationByTicker,
} from "./dailyNewsProductDesignations";
import type { DailyNewsPayload } from "../api/supernova";

describe("newsProductDesignationByTicker", () => {
  it("extracts NEO100 + Orphan/Fast Track/Rare Pediatric from takeaway prose", () => {
    const payload: DailyNewsPayload = {
      highlights: [
        {
          ticker: "NTHI",
          title: "The Nose Knows: Why NeOnc’s Patent Portfolio Could Make NTHI More Than a One-Drug Biotech",
          summary:
            "NEO100 carries FDA Orphan Drug, Fast Track, and Rare Pediatric Disease designations. NEO212 completed Phase 1 dose escalation with RP2D 610 mg.",
        },
      ],
    };
    const by = newsProductDesignationByTicker(payload);
    expect(by.NTHI?.product).toMatch(/NEO100/i);
    expect(by.NTHI?.designations).toEqual(
      expect.arrayContaining(["Orphan Drug", "Fast Track", "Rare Pediatric Disease"]),
    );
  });

  it("does not treat market_access_notes taxonomy text as a designation", () => {
    const payload: DailyNewsPayload = {
      highlights: [
        {
          ticker: "CRDL",
          title: "CardiolRx update",
          summary: "Company presented at a conference.",
          market_access_notes: "No market-access event classified",
        },
      ],
    };
    const by = newsProductDesignationByTicker(payload);
    expect(by.CRDL?.designations ?? []).toEqual([]);
    expect(JSON.stringify(by.CRDL ?? {})).not.toMatch(/market.access/i);
  });

  it("still mines Orphan from market_access_notes when present as prose", () => {
    const payload: DailyNewsPayload = {
      top_news: [
        {
          ticker: "NTHI",
          title: "Press",
          summary: "Update",
          market_access_notes: "NEO100 received Orphan Drug designation from FDA.",
        },
      ],
    };
    const by = newsProductDesignationByTicker(payload);
    expect(by.NTHI?.designations).toContain("Orphan Drug");
  });

  it("merges manual analysis product + designations", () => {
    const payload: DailyNewsPayload = {
      user_analyses: [
        {
          ticker: "NTHI",
          product: "NEO212",
          detail_summary: "Candidate received Breakthrough Therapy designation.",
        },
      ],
    };
    const by = newsProductDesignationByTicker(payload);
    expect(by.NTHI?.product).toBe("NEO212");
    expect(by.NTHI?.designations).toContain("Breakthrough Therapy");
  });
});

describe("formatProductDesignationCell", () => {
  it("joins product and designations", () => {
    expect(formatProductDesignationCell("NEO100", ["Orphan Drug", "Fast Track"])).toBe(
      "NEO100 · Orphan Drug, Fast Track",
    );
  });
});
