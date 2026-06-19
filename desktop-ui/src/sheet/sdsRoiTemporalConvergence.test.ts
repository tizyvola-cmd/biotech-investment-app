import { describe, expect, it } from "vitest";
import {
  ROI_CONVERGENCE_OFFSETS,
  buildRoiTemporalConvergenceView,
} from "./sdsRoiTemporalConvergence";

const simSnap = {
  rows: [
    {
      Ticker: "CLRB",
      "Completion Date": "15/01/2025",
      "Δ% vs Pred−60\nPred\n−10": 2,
      "Δ% vs Pred−60\nPred\n−5": 3,
      "Δ% vs Pred−60\nPred\n+4": 4,
    },
    {
      Ticker: "LTRN",
      "Completion Date": "20/02/2025",
      "Δ% vs Pred−60\nPred\n−10": 1,
      "Δ% vs Pred−60\nPred\n−5": 2,
      "Δ% vs Pred−60\nPred\n+4": 3,
    },
  ],
};

const backtest = {
  sample_rows: [
    {
      key: "CLRB|2025-01-15",
      ticker: "CLRB",
      completion_date: "2025-01-15",
      predicted: { pre_10: 2.5, pre_5: 3.5, post_4: 4.5 },
      actual: { pre_5: 3.0 },
      error_pp: { pre_5: 0.5 },
    },
    {
      key: "LTRN|2025-02-20",
      ticker: "LTRN",
      completion_date: "2025-02-20",
      predicted: { pre_10: 1.5, pre_5: 2.5, post_4: 3.5 },
      actual: { pre_5: 2.0 },
      error_pp: { pre_5: 0.5 },
    },
  ],
};

describe("buildRoiTemporalConvergenceView", () => {
  it("uses all reference calendar offsets", () => {
    expect(ROI_CONVERGENCE_OFFSETS).toEqual([-60, -30, -10, -7, -3, 4, 10]);
  });

  it("builds mean MAE curves when backtest actuals exist", () => {
    const view = buildRoiTemporalConvergenceView(null, null, simSnap, backtest, null);
    expect(view.nSimCohort).toBe(2);
    expect(view.nWithActual).toBe(2);
    expect(view.hasCurve).toBe(true);
    expect(view.points).toHaveLength(ROI_CONVERGENCE_OFFSETS.length);

    const t10 = view.points.find((p) => p.offset === -10);
    expect(t10?.sds.n).toBe(2);
    expect(t10?.sds.meanAbsErrPp).not.toBeNull();
    expect(t10?.pred.n).toBe(2);
  });

  it("returns empty curve without scored actuals", () => {
    const view = buildRoiTemporalConvergenceView(null, null, simSnap, null, null);
    expect(view.nWithActual).toBe(0);
    expect(view.hasCurve).toBe(false);
  });
});
