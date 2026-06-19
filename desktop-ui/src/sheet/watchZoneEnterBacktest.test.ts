import { describe, expect, it } from "vitest";
import {
  buildWatchEnterBacktest,
  evaluateWatchBacktestPoint,
  type PastCatalystCloseRecord,
} from "./watchZoneEnterBacktest";

const sampleRec: PastCatalystCloseRecord = {
  ticker: "TEST",
  completion_date: "2024-06-15",
  close_m60: 10,
  close_m30: 12.2,
  close_m10: 12,
  close_m7: 12.5,
  model_dm60_pct: 4,
  model_dm30_pct: 6,
  score_v4: 78,
  affidabilita: 72,
  slope_20d: 0.08,
  slope_5d: 0.1,
  d5_pct: 8,
};

describe("watchZoneEnterBacktest", () => {
  it("detects gainer drift on watch anchor", () => {
    const pt = evaluateWatchBacktestPoint(sampleRec, {
      id: "T-90",
      daysToCd: 90,
      entryKey: "close_m60",
      nextKey: "close_m30",
      cdKey: "close_m7",
    });
    expect(pt).not.toBeNull();
    expect(pt!.zone).toBe("watch");
    expect(pt!.isGainer).toBe(true);
    expect(pt!.roiToCdPct).toBeGreaterThan(0);
  });

  it("builds summary from synthetic cohort", () => {
    const summary = buildWatchEnterBacktest(
      { "TEST|2024-06-15": sampleRec },
      { today: new Date("2025-01-01") },
    );
    expect(summary.cohortN).toBe(1);
    expect(summary.watch.gainersN).toBeGreaterThan(0);
    expect(summary.evalPointsN).toBeGreaterThan(0);
  });
});
