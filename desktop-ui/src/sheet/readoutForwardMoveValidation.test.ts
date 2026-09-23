import { describe, expect, it } from "vitest";
import {
  buildEisFeedEventPoints,
  buildWeeklyEisCorrelationTrend,
  eventForward3dPct,
} from "./readoutForwardMoveValidation";
import type { ClinicalPreCdRecord } from "../api/supernova";

describe("readoutForwardMoveValidation", () => {
  it("buildEisFeedEventPoints collects auto and manual events with delta_p_3d", () => {
    const records: ClinicalPreCdRecord[] = [
      {
        ticker: "VIR",
        clinical_events: [
          {
            event_date: "2026-03-01",
            source_type: "press_release",
            eis: { score: 18.5 },
            price: { delta_p_3d: 4.2 },
          },
          {
            event_date: "2026-03-05",
            source_type: "manual",
            event_type: "manual",
            eis: { score: -12 },
            price: { delta_p_1d: -2.1, delta_p_3d: -5.5 },
          },
          {
            event_date: "2026-03-10",
            source_type: "press_release",
            eis: { score: 5 },
            price: { delta_p_1d: 1 },
          },
        ],
      },
      {
        ticker: "BNTX",
        clinical_events: [
          {
            event_date: "2026-02-20",
            eis: { score: 22, delta_p_3d: 8.1 },
          },
        ],
      },
    ];
    const pts = buildEisFeedEventPoints(records);
    expect(pts).toHaveLength(3);
    expect(pts.find((p) => p.ticker === "VIR" && p.source === "feed_auto")?.y).toBe(4.2);
    expect(pts.find((p) => p.source === "feed_manual")?.y).toBe(-5.5);
    expect(pts.find((p) => p.ticker === "BNTX")?.y).toBe(8.1);
  });

  it("eventForward3dPct prefers price.delta_p_3d", () => {
    expect(
      eventForward3dPct({
        price: { delta_p_3d: 3.3 },
        eis: { delta_p_3d: 1.1, score: 5 },
      }),
    ).toBe(3.3);
  });

  it("buildWeeklyEisCorrelationTrend buckets by ISO week", () => {
    const pts = buildEisFeedEventPoints([
      {
        ticker: "A",
        clinical_events: [
          { event_date: "2026-03-03", eis: { score: 10 }, price: { delta_p_3d: 2 } },
          { event_date: "2026-03-04", eis: { score: 20 }, price: { delta_p_3d: 4 } },
          { event_date: "2026-03-05", eis: { score: 30 }, price: { delta_p_3d: 6 } },
          { event_date: "2026-03-10", eis: { score: -5 }, price: { delta_p_3d: -1 } },
          { event_date: "2026-03-11", eis: { score: -10 }, price: { delta_p_3d: -2 } },
          { event_date: "2026-03-12", eis: { score: -15 }, price: { delta_p_3d: -3 } },
        ],
      },
    ]);
    const weekly = buildWeeklyEisCorrelationTrend(pts);
    expect(weekly.length).toBeGreaterThanOrEqual(2);
    expect(weekly.every((w) => w.n >= 1)).toBe(true);
  });
});
