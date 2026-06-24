import { describe, expect, it } from "vitest";
import {
  buildEisSuperScoreChartRows,
  type EisSuperScoreOverview,
} from "../sheet/eisSuperScoreLearningView";

const sampleOverview: EisSuperScoreOverview = {
  correlation_timeline: [
    { window: "180d+", days_min: 181, days_max: null, days_mid: 211, n_events: 20, corr_raw_7d: 0.4, corr_super_7d: 0.45, lift_7d: 0.05 },
    { window: "0–7d", days_min: 0, days_max: 7, days_mid: 4, n_events: 10, corr_raw_7d: 0.7, corr_super_7d: 0.85, lift_7d: 0.15 },
  ],
  effectiveness: { mean_corr_raw_7d: 0.5, mean_corr_super_7d: 0.6, mean_lift_7d: 0.1 },
  learning_history: [],
};

describe("buildEisSuperScoreChartRows", () => {
  it("sorts bins by days_mid descending (far → CD)", () => {
    const rows = buildEisSuperScoreChartRows(sampleOverview);
    expect(rows.length).toBe(2);
    expect(rows[0]!.daysMid).toBeGreaterThan(rows[1]!.daysMid);
  });

  it("maps correlation fields", () => {
    const rows = buildEisSuperScoreChartRows(sampleOverview);
    const near = rows.find((r) => r.window === "0–7d");
    expect(near?.corrSuper7d).toBe(0.85);
    expect(near?.lift7d).toBe(0.15);
  });
});
