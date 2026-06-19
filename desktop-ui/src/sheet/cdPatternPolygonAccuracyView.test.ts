import { describe, expect, it } from "vitest";
import {
  buildCdPatternPolygonChartRows,
  buildCdPatternPolygonLearningTrend,
  parseCdPatternPolygonOverview,
  resolveCdPatternWindowCorr,
} from "./cdPatternPolygonAccuracyView";

const SAMPLE_OVERVIEW = {
  correlation_timeline: [
    { window: "T−60→T−30", window_id: "w1", days_min: 30, days_max: 60, days_mid: 45, n_samples: 10, corr_match_stock: 0.15 },
    { window: "T−30→T−10", window_id: "w2", days_min: 10, days_max: 29, days_mid: 20, n_samples: 8, corr_match_stock: 0.28 },
    { window: "T−10→T−7", window_id: "w3", days_min: 7, days_max: 9, days_mid: 8, n_samples: 5, corr_match_stock: 0.41 },
    { window: "T−7→T−3", window_id: "w4", days_min: 3, days_max: 6, days_mid: 5, n_samples: 4, corr_match_stock: 0.42 },
    { window: "T−3→T+4", window_id: "w5", days_min: 0, days_max: 3, days_mid: 2, n_samples: 2, corr_match_stock: 0.55 },
  ],
};

describe("cdPatternPolygonAccuracyView", () => {
  it("builds chart rows sorted by days before CD", () => {
    const overview = parseCdPatternPolygonOverview({
      correlation_timeline: [
        { window: "T−7→T−3", days_min: 3, days_max: 6, days_mid: 5, n_samples: 4, corr_match_stock: 0.42 },
        { window: "T−60→T−30", days_min: 30, days_max: 60, days_mid: 45, n_samples: 10, corr_match_stock: 0.15 },
      ],
    });
    const rows = buildCdPatternPolygonChartRows(overview);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.daysMid).toBeGreaterThan(rows[1]!.daysMid);
    expect(rows[0]!.corr).toBe(0.15);
  });

  it("resolves windowCorr by window_id or daysToCd", () => {
    const overview = parseCdPatternPolygonOverview(SAMPLE_OVERVIEW);
    expect(resolveCdPatternWindowCorr(overview, { windowId: "w3" })).toBe(0.41);
    expect(resolveCdPatternWindowCorr(overview, { daysToCd: 20 })).toBe(0.28);
    expect(resolveCdPatternWindowCorr(overview, { daysToCd: 5 })).toBe(0.42);
    expect(resolveCdPatternWindowCorr(overview, { windowId: "w5" })).toBeNull();
    expect(resolveCdPatternWindowCorr(null, { daysToCd: 20 })).toBeNull();
  });

  it("builds learning trend from weekly history", () => {
    const overview = parseCdPatternPolygonOverview({
      learning_history: [
        { week: "2026-05-01", mean_corr_match_stock: 0.22, n_samples: 40, n_events: 8 },
        { week: "2026-06-01", mean_corr_match_stock: 0.31, n_samples: 55, n_events: 10 },
      ],
    });
    const trend = buildCdPatternPolygonLearningTrend(overview);
    expect(trend).toHaveLength(2);
    expect(trend[1]!.meanCorr).toBe(0.31);
  });
});
