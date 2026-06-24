import { describe, expect, it } from "vitest";
import type { ChartPoint } from "../types";
import {
  buildSlopeCurveWithRecalib,
  buildSlopeTrajectory,
  modelSlopesFromRecalibChart,
  segmentSlopePpD,
} from "./slopeRecalibCurve";

function mkPoints(
  ticker: string,
  foglioByOffset: Record<number, number>,
): ChartPoint[] {
  return Object.entries(foglioByOffset)
    .map(([k, pct]) => ({
      offset: Number(k),
      nodo: "standard" as const,
      pct_foglio: pct,
      pct_curva: pct,
      label: `T${k}`,
      ticker,
    }))
    .sort((a, b) => a.offset - b.offset);
}

describe("overlay-aligned pp/d slopes", () => {
  it("modelSlopesFromRecalibChart uses overlay calendar grid (usedRecalibPath)", () => {
    const pts = mkPoints("T", {
      [-60]: 0,
      [-30]: -4,
      [-10]: 2,
      [-7]: 4,
      [-5]: 5,
      [-3]: 6,
      [0]: 8,
      [4]: 10,
      [7]: 12,
    });
    const sim = { Ticker: "T", "Completion Date": "01/07/2026", "Days to CD": 20 };
    const slopes = modelSlopesFromRecalibChart(pts, sim);
    expect(slopes.usedRecalibPath).toBe(true);
    expect(slopes.slope5d).not.toBeNull();
    expect(slopes.slope20d).not.toBeNull();
  });

  it("pp/d model slopes match trajectory segment slopes on the same overlay path", () => {
    const pts = mkPoints("T", {
      [-60]: 0,
      [-30]: -6,
      [-10]: 1,
      [-7]: 3,
      [-5]: 4,
      [-3]: 5,
      [0]: 7,
      [4]: 9,
      [7]: 11,
    });
    const sim = { Ticker: "T", "Completion Date": "01/07/2026", "Days to CD": 20 };
    const traj = buildSlopeTrajectory({ chartPoints: pts, simRow: sim, daysToCd: 20 });
    const curve = buildSlopeCurveWithRecalib({
      chartPoints: pts,
      simRow: sim,
      actual5: null,
      actual20: null,
      actual45: null,
    });
    const model5 = curve.points.find((p) => p.d === -5)?.pred;
    const seg5 = segmentSlopePpD(traj.points, "pred", -5, -10);
    if (model5 != null && seg5 != null) {
      expect(model5).toBeCloseTo(seg5, 1);
    }
  });
});
