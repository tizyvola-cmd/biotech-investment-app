import { describe, expect, it } from "vitest";
import {
  buildRascoreObservations,
  buildRascoreSignalImpactView,
  rascoreChartSlots,
  type RascoreObservation,
} from "./rascoreSignalImpactView";

function obs(score: number, d24: number | null, d7: number | null, pnl: number | null = null): RascoreObservation {
  return {
    score,
    ticker: "TK",
    rowKey: `TK|2026-06-01`,
    hasPosition: pnl != null,
    priceChg24h: d24,
    priceChg7d: d7,
    cdPriceChgLongByOffset: {},
    cdPriceChgShortByOffset: {},
    raScoreByOffset: {},
    pnlPct: pnl,
  };
}

describe("buildRascoreSignalImpactView", () => {
  it("computes grow/decline rates by RA band on 24h and 7d", () => {
    const view = buildRascoreSignalImpactView([
      obs(25, 2, 5),
      obs(28, -1, -3),
      obs(32, 1, 1),
      obs(35, 1, 2),
      obs(37, 1, 3),
      obs(39, -1, -1),
      obs(55, 1.5, 4),
      obs(58, 0.8, 6),
      obs(56, -2, 1),
    ]);

    const low = view.bins.find((b) => b.scoreMin === 20);
    const mid = view.bins.find((b) => b.scoreMin === 30);
    const high = view.bins.find((b) => b.scoreMin === 50);

    expect(low?.grow7dPct).toBe(50);
    expect(low?.decline7dPct).toBe(50);
    expect(mid?.grow7dPct).toBe(75);
    expect(high?.grow7dPct).toBe(100);
    expect(high?.decline7dPct).toBe(0);

    expect(view.thresholds.investMinScore).toBe(30);
    expect(view.thresholds.peakGrow7dPct).toBe(100);
    expect(view.calibrationQuality.spearmanGrow7d).toBe(1);
    expect(view.calibrationQuality.tier).toBe("strong");
    expect(view.cohort.missingHighRa).toBe(true);
    const slots = rascoreChartSlots(view.bins);
    expect(slots.some((s) => s.n === 0 && s.scoreMin >= 60)).toBe(true);
  });

  it("buildRascoreObservations skips rows without invest signal", () => {
    const simTable = {
      sheet: "Simulation",
      columns: ["Ticker", "Completion Date"],
      rows: [
        {
          Ticker: "PORTAFOGLIO",
          "Completion Date": "—",
        },
        {
          Ticker: "ZZZZ",
          "Completion Date": "01/01/2099",
        },
      ],
    };
    const out = buildRascoreObservations({
      simTable,
      chartBundle: null,
      sdsRows: [],
      inputs: {},
    });
    expect(out).toHaveLength(0);
  });
});
