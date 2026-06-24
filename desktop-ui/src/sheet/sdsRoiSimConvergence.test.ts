import { describe, expect, it } from "vitest";
import {
  buildSdsRoiSimConvergenceView,
  buildSimulationEventKeys,
  buildSimulationTickerSet,
} from "./sdsRoiSimConvergence";
import { buildSdsRoiBlendEvalView, countHorizonCurveKnots } from "./sdsRoiBlendEval";

const simSnap = {
  rows: [
    {
      Ticker: "CLRB",
      "Completion Date": "30/06/2026",
      "Δ% vs Pred−60\nPred\n−10": -0.0612,
      "Δ% vs Pred−60\nPred\n−5": -0.05,
      "Δ% vs Pred−60\nPred\n+4": 0.02,
    },
    {
      Ticker: "LTRN",
      "Completion Date": "09/06/2026",
      "Δ% vs Pred−60\nPred\n−10": 0.08,
      "Δ% vs Pred−60\nPred\n−5": 0.06,
      "Δ% vs Pred−60\nPred\n+4": 0.04,
    },
    { Ticker: "PORTAFOGLIO", "Completion Date": "01/01/2026" },
  ],
};

describe("sdsRoiSimConvergence date keys", () => {
  it("buildSimulationEventKeys accepts DD/MM/YYYY completion dates", () => {
    const keys = buildSimulationEventKeys(simSnap);
    expect(keys.has("CLRB|2026-06-30")).toBe(true);
    expect(keys.has("LTRN|2026-06-09")).toBe(true);
    expect(keys.has("PORTAFOGLIO|2026-01-01")).toBe(false);
    expect(buildSimulationTickerSet(simSnap).has("CLRB")).toBe(true);
  });

  it("builds pending convergence events from Simulation Pred columns", () => {
    const view = buildSdsRoiSimConvergenceView(null, null, simSnap, null, "pre_5");
    expect(view.summary.nSimTracked).toBe(2);
    expect(view.summary.nPending).toBe(2);
    expect(view.hasTimeline).toBe(true);
  });
});

describe("sdsRoiBlendEval sheet pred fallback", () => {
  it("builds horizon curve from Simulation Pred columns without SDS snapshot", () => {
    const view = buildSdsRoiBlendEvalView(null, null, simSnap, "pre_5", null);
    expect(countHorizonCurveKnots(view.horizonCurve)).toBeGreaterThanOrEqual(2);
    expect(view.hasHorizonCurve).toBe(true);
    expect(view.hasData).toBe(true);
    expect(view.pendingRows.length).toBe(2);
    expect(view.hasTimeline).toBe(true);
  });
});
