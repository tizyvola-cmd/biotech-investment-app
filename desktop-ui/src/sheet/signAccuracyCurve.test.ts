import { describe, expect, it } from "vitest";
import {
  buildModelIntrinsicForecastSummary,
  formatModelIntrinsicRangeLabel,
  type SignAccuracyCurveView,
} from "./signAccuracyCurve";

function viewWithSimBins(): SignAccuracyCurveView {
  return {
    points: [
      {
        offset: -60,
        label: "T-60",
        retroSignPct: 50,
        simSignPct: 48,
        retroPricePct: 80,
        simPricePct: 82,
        retroN: 10,
        simN: 5,
        zone: "pre_cd",
      },
      {
        offset: -3,
        label: "T-3",
        retroSignPct: 70,
        simSignPct: 85,
        retroPricePct: 90,
        simPricePct: 96,
        retroN: 10,
        simN: 8,
        zone: "pre_cd",
      },
      {
        offset: 7,
        label: "T+7",
        retroSignPct: 55,
        simSignPct: 60,
        retroPricePct: 88,
        simPricePct: 94,
        retroN: 10,
        simN: 6,
        zone: "post_cd",
      },
    ],
    xOffsets: [-60, -3, 7],
    retro: null,
    simulation: {
      labelIt: "Simulation",
      labelEn: "Simulation",
      nEvents: 19,
      nSessions: 19,
      overallSignPct: 65,
      overallSignPreCdPct: 66,
      overallPricePct: 91,
    },
    runIso: null,
    preCdHitPct: 66,
    metric: "daily_dod",
  };
}

describe("buildModelIntrinsicForecastSummary", () => {
  it("prefers simulation cohort and reports weighted overall with min/max bins", () => {
    const summary = buildModelIntrinsicForecastSummary(viewWithSimBins());
    expect(summary?.sign.cohort).toBe("simulation");
    expect(summary?.sign.overallPct).toBeCloseTo(67.4, 1);
    expect(summary?.sign.minPct).toBe(48);
    expect(summary?.sign.minOffset).toBe(-60);
    expect(summary?.sign.maxPct).toBe(85);
    expect(summary?.sign.maxOffset).toBe(-3);
    expect(summary?.priceAccuracy.maxPct).toBe(96);
  });

  it("formats min/max range label for dashboard", () => {
    const summary = buildModelIntrinsicForecastSummary(viewWithSimBins());
    expect(summary).not.toBeNull();
    const label = formatModelIntrinsicRangeLabel(summary!.sign, "it");
    expect(label).toBe("min 48.0% T-60 · max 85.0% T-3");
  });
});
