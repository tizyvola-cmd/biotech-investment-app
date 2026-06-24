import { describe, expect, it } from "vitest";
import { buildModelQualityWeeklyTrends } from "./modelQualityWeeklyTrends";

describe("modelQualityWeeklyTrends", () => {
  it("builds acc and MAE weekly trends from monitor entries", () => {
    const trends = buildModelQualityWeeklyTrends({
      entries: [
        {
          run_iso: "2026-06-02T10:00:00.000Z",
          acc_v4_pct: 58,
          delta_pp_vs_prev: null,
          m2_mae_7_pp: 11,
          n_evaluable_ok_v4: 100,
        },
        {
          run_iso: "2026-06-09T10:00:00.000Z",
          acc_v4_pct: 60,
          delta_pp_vs_prev: 2,
          m2_mae_7_pp: 10,
          n_evaluable_ok_v4: 105,
        },
      ],
    });
    expect(trends).not.toBeNull();
    expect(trends!.accV4Pct).toBe(60);
    expect(trends!.deltaPpLastMonitor).toBe(2);
    expect(trends!.modelSizeError.currentMaePp).toBe(10);
  });
});
