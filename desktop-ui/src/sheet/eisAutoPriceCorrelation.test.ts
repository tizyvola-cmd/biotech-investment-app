import { describe, expect, it } from "vitest";
import type { ClinicalPreCdRecord } from "../api/supernova";
import {
  computeEisAutoPriceCorrelation,
  EIS_AUTO_LOOKBACK_DAYS,
} from "./eisAutoPriceCorrelation";

const NOW = Date.parse("2026-07-04T12:00:00");

function rec(ticker: string, events: ClinicalPreCdRecord["clinical_events"]): ClinicalPreCdRecord {
  return { ticker, clinical_events: events };
}

describe("computeEisAutoPriceCorrelation", () => {
  it("returns zero bars when no auto events", () => {
    const c = computeEisAutoPriceCorrelation("VIR", [], 2.1, { nowMs: NOW });
    expect(c.bars).toBe(0);
    expect(c.nEvents).toBe(0);
  });

  it("scores strong positive correlation", () => {
    const records = [
      rec("BNTX", [
        { event_date: "2026-07-01", source_type: "press_release", eis: { score: 8 }, price: { delta_p_1d: 3 } },
        { event_date: "2026-07-02", source_type: "press_release", eis: { score: 5 }, price: { delta_p_1d: 2 } },
        { event_date: "2026-07-03", source_type: "sec_8k", eis: { score: 10 }, price: { delta_p_1d: 4 } },
      ]),
    ];
    const c = computeEisAutoPriceCorrelation("BNTX", records, 2.5, { nowMs: NOW });
    expect(c.nEvents).toBe(3);
    expect(c.pearsonR).not.toBeNull();
    expect((c.pearsonR ?? 0) > 0.9).toBe(true);
    expect(c.bars).toBeGreaterThanOrEqual(4);
  });

  it("scores negative correlation (EIS vs price move opposite signs)", () => {
    const records = [
      rec("MLTX", [
        { event_date: "2026-07-01", source_type: "press_release", eis: { score: 8 }, price: { delta_p_1d: -3 } },
        { event_date: "2026-07-02", source_type: "press_release", eis: { score: 6 }, price: { delta_p_1d: -2 } },
        { event_date: "2026-07-03", source_type: "press_release", eis: { score: 4 }, price: { delta_p_1d: -1.5 } },
      ]),
    ];
    const c = computeEisAutoPriceCorrelation("MLTX", records, -1.2, { nowMs: NOW });
    expect(c.pearsonR).not.toBeNull();
    expect((c.pearsonR ?? 0) < -0.9).toBe(true);
    expect(c.bars).toBeGreaterThanOrEqual(4);
  });

  it("ignores manual events and events older than lookback", () => {
    const records = [
      rec("X", [
        { event_date: "2026-06-20", source_type: "press_release", eis: { score: 9 }, price: { delta_p_1d: 5 } },
        { event_date: "2026-07-03", source_type: "manual", eis: { score: 9 }, price: { delta_p_1d: 5 } },
      ]),
    ];
    const c = computeEisAutoPriceCorrelation("X", records, 1, {
      nowMs: NOW,
      lookbackDays: EIS_AUTO_LOOKBACK_DAYS,
    });
    expect(c.nEvents).toBe(0);
  });
});
