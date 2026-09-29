import { describe, expect, it } from "vitest";
import { FeedGapContextProvider } from "./gapInvestigationProvider";
import type { ClinicalPreCdRecord } from "../api/supernova";
import type { ManualFeedEventDraft } from "./manualFeedEvents";

describe("FeedGapContextProvider", () => {
  it("returns manual research when present in window", async () => {
    const manual: ManualFeedEventDraft[] = [
      {
        id: "manual_test",
        createdAt: "2026-07-09T10:00:00.000Z",
        ticker: "ABC",
        eventDate: "2026-07-09",
        source: "manual",
        title: "FDA complete response letter",
        body: "CRL received for phase 3 filing",
        investigationOutcome: "negative_catalyst",
      },
    ];
    const provider = new FeedGapContextProvider(() => [], () => manual);
    const finding = await provider.investigate({
      ticker: "ABC",
      tickTimestamp: "2026-07-10T12:00:00.000Z",
      previousMarkPct: 0,
      currentMarkPct: -8,
      gapPct: -8,
      positionCapitalEur: 5000,
      daysSinceCD: 30,
    });
    expect(finding.hasSpecificNews).toBe(true);
    expect(finding.newsType).toBe("regulatory_8k");
    expect(finding.confidence).toBe("high");
  });

  it("falls back to automated feed events", async () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "XYZ",
        nct_id: "NCT123",
        clinical_events: [
          {
            event_date: "2026-07-08",
            event_title: "Phase 2 topline met primary endpoint",
            source_type: "press_release",
            summary: "ORR 45% vs expected",
          },
        ],
      } as ClinicalPreCdRecord,
    ];
    const provider = new FeedGapContextProvider(() => records, () => []);
    const finding = await provider.investigate({
      ticker: "XYZ",
      tickTimestamp: "2026-07-10T12:00:00.000Z",
      previousMarkPct: 2,
      currentMarkPct: 12,
      gapPct: 10,
      positionCapitalEur: 5000,
      daysSinceCD: 60,
    });
    expect(finding.hasSpecificNews).toBe(true);
    expect(finding.newsType).toBe("clinical_data");
  });
});
