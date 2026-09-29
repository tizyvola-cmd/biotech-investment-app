import { describe, expect, it } from "vitest";
import {
  HIGH_IMPACT_EIS_ABS,
  collectHighImpactEisAlerts,
  highImpactEisAlertId,
  highImpactEisDayKey,
} from "./highImpactEisAlerts";
import type { ClinicalPreCdRecord } from "../api/supernova";

describe("highImpactEisAlerts", () => {
  const now = new Date("2026-08-09T15:00:00.000Z"); // NY afternoon Aug 9
  const today = highImpactEisDayKey(now);

  it("only collects today's |EIS| > 5 events (skips historical + acked)", () => {
    const records = [
      {
        ticker: "AAA",
        company: "Aaa Bio",
        sponsor_match: "Exact",
        clinical_indicators: [],
        clinical_events: [
          {
            event_date: today,
            event_title: "Big positive readout",
            summary: "Full story text here with trial success details.",
            link: "https://example.com/news",
            source_type: "sec_8k",
            reference_verified: true,
            reference_match: "sec_8k",
            sentiment: 1.5,
            price: { delta_p_1d: 18, delta_p_3d: 22, vol_ratio: 3 },
          },
          {
            event_date: "2026-04-13",
            event_title: "Old SKYLINE data",
            summary: "Should not toast",
            link: "https://example.com/old",
            source_type: "sec_8k",
            reference_verified: true,
            reference_match: "sec_8k",
            sentiment: 1.5,
            price: { delta_p_1d: 40, delta_p_3d: 50, vol_ratio: 4 },
          },
          {
            event_date: today,
            event_title: "Minor note",
            source_type: "sec_8k",
            reference_verified: true,
            reference_match: "sec_8k",
            sentiment: 0,
            price: { delta_p_1d: 0.5, delta_p_3d: 0.2, vol_ratio: 1 },
          },
        ],
      },
    ] as unknown as ClinicalPreCdRecord[];

    const all = collectHighImpactEisAlerts(
      ["AAA"],
      records,
      "en",
      new Set(),
      now,
    );
    expect(HIGH_IMPACT_EIS_ABS).toBe(5);
    expect(all.length).toBe(1);
    expect(all[0]!.event.eventDate?.slice(0, 10)).toBe(today);
    expect(Math.abs(all[0]!.event.breakdown.score)).toBeGreaterThan(5);
    expect(all[0]!.event.link).toContain("example.com/news");

    const id = highImpactEisAlertId(all[0]!.ticker, all[0]!.event);
    const filtered = collectHighImpactEisAlerts(
      ["AAA"],
      records,
      "en",
      new Set([id]),
      now,
    );
    expect(filtered).toHaveLength(0);
  });

  it("does not alert on high |EIS| from prior days", () => {
    const records = [
      {
        ticker: "SYRE",
        company: "Syre",
        sponsor_match: "Exact",
        clinical_indicators: [],
        clinical_events: [
          {
            event_date: "2026-04-13",
            event_title: "SPY001 Phase 2",
            summary: "Old readout",
            link: "https://example.com/syre",
            source_type: "sec_8k",
            reference_verified: true,
            reference_match: "sec_8k",
            sentiment: 1.5,
            price: { delta_p_1d: 40, delta_p_3d: 55, vol_ratio: 5 },
          },
        ],
      },
    ] as unknown as ClinicalPreCdRecord[];

    const all = collectHighImpactEisAlerts(
      ["SYRE"],
      records,
      "en",
      new Set(),
      now,
    );
    expect(all).toHaveLength(0);
  });
});
