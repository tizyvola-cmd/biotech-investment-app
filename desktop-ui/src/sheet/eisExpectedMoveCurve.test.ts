import { describe, expect, it } from "vitest";
import { buildEisExpectedMoveCurveView, expectedMovePpAtEis } from "./eisExpectedMoveCurve";
import type { EisMagnitudeAnalysisDoc } from "../data/signalCalibrationData";

describe("buildEisExpectedMoveCurveView", () => {
  it("builds calibration from regression when persisted payload missing", () => {
    const analysis: EisMagnitudeAnalysisDoc = {
      n_events_scored: 10,
      n_with_price_1d: 10,
      correlation: {
        n_1d: 10,
        regression_1d: { n: 10, slope: 2, intercept: -1, r: 0.8, line: [] },
      },
      scatter: {
        delta_p_1d: {
          points: [
            { x: -5, y: -11, ticker: "A" },
            { x: 0, y: -1, ticker: "B" },
            { x: 5, y: 9, ticker: "C" },
          ],
          regression: { n: 3, slope: 2, intercept: -1, r: 1, line: [] },
        },
      },
    };
    const view = buildEisExpectedMoveCurveView(analysis);
    expect(view.t1?.slope_pp_per_eis).toBe(2);
    expect(view.t1?.formula).toContain("× EIS");
    expect(view.anchorRows.some((r) => r.eis === 5 && r.expectedPpT1 === 9)).toBe(true);
    expect(view.observedT1).toHaveLength(3);
    expect(view.observedT1[2]?.deltaPp).toBe(9);
    expect(expectedMovePpAtEis(view.t1, 5)).toBe(9);
  });
});
