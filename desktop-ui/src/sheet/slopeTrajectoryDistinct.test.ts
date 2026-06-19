import { describe, expect, it } from "vitest";
import type { ChartPoint } from "../types";
import { buildSlopeTrajectory } from "./slopeRecalibCurve";
import { buildExpectedPreErrorTrajectory } from "./slopeTrajectoryOverlay";

function mkPoints(
  ticker: string,
  pctRealeByOffset: Record<number, number>,
  pctFoglioByOffset: Record<number, number>,
): ChartPoint[] {
  const offsets = [...new Set([...Object.keys(pctRealeByOffset), ...Object.keys(pctFoglioByOffset)])].map(
    Number,
  );
  return offsets.sort((a, b) => a - b).map((offset) => ({
    offset,
    nodo: "standard",
    pct_reale: pctRealeByOffset[offset] ?? null,
    pct_foglio: pctFoglioByOffset[offset] ?? null,
    pct_curva: pctFoglioByOffset[offset] ?? null,
    label: `T${offset}`,
    ticker,
  }));
}

describe("slope trajectory per-ticker distinctness", () => {
  it("VYGR-like vs PBYI-like trajectories differ (not shared template data)", () => {
    const vygrPts = mkPoints(
      "VYGR",
      { [-20]: 0, [-15]: 0, [-10]: -10, [-5]: -10, [-3]: -10, [0]: -8 },
      { [-20]: 0, [-15]: 0, [-10]: 2, [-5]: 2, [0]: 2 },
    );
    const pbyiPts = mkPoints(
      "PBYI",
      { [-24]: -0.3, [-15]: -0.3, [-10]: -3, [-5]: -3, [-3]: -3, [0]: -2 },
      { [-24]: -0.3, [-15]: 0, [-10]: 0.5, [-5]: 0.5, [0]: 0.5 },
    );

    const vygrSim = { Ticker: "VYGR", "Completion Date": "01/07/2026", "Days to CD": 20 };
    const pbyiSim = { Ticker: "PBYI", "Completion Date": "05/07/2026", "Days to CD": 24 };

    const vygr = buildSlopeTrajectory({ chartPoints: vygrPts, simRow: vygrSim, daysToCd: 20 });
    const pbyi = buildSlopeTrajectory({ chartPoints: pbyiPts, simRow: pbyiSim, daysToCd: 24 });

    const pick = (pts: typeof vygr.points, off: number, field: "pred" | "actual") =>
      pts.find((p) => p.offset === off)?.[field] ?? null;

    const vygrActualPast = vygr.points.find((p) => !p.isToday && p.actual != null);
    const pbyiActualPast = pbyi.points.find((p) => !p.isToday && p.actual != null);
    if (vygrActualPast && pbyiActualPast) {
      expect(vygrActualPast.actual).not.toBe(pbyiActualPast.actual);
    }
    expect(pick(vygr.points, -10, "pred")).not.toBe(pick(pbyi.points, -10, "pred"));

    const vygrExpected = buildExpectedPreErrorTrajectory(vygr.points, vygr.todayOffset, 0.27, "actual");
    const pbyiExpected = buildExpectedPreErrorTrajectory(pbyi.points, pbyi.todayOffset, 0.23, "actual");
    const vygrToday = vygrExpected.find((p) => p.offset === vygr.todayOffset)?.expected;
    const pbyiToday = pbyiExpected.find((p) => p.offset === pbyi.todayOffset)?.expected;
    expect(vygrToday).not.toBe(pbyiToday);
    expect(vygrToday).not.toBeNull();
    expect(pbyiToday).not.toBeNull();
  });

  it("model trajectory is smooth when today is well before T−60", () => {
    const pts = mkPoints(
      "LONG",
      { [-60]: 0, [-30]: 2, [-10]: 4, [0]: 6 },
      { [-60]: 0, [-30]: 3, [-10]: 5, [0]: 7 },
    );
    const sim = { Ticker: "LONG", "Completion Date": "28/08/2026", "Days to CD": 80 };
    const built = buildSlopeTrajectory({ chartPoints: pts, simRow: sim, daysToCd: 80 });
    const today = built.points.find((p) => p.isToday);
    expect(today?.pred).toBe(0);
    const at60 = built.points.find((p) => p.offset === -60)?.pred;
    expect(at60).not.toBeNull();
    if (at60 != null) {
      expect(Math.abs(at60)).toBeLessThan(12);
    }
  });

  it("actual curve stops at today — no post-today or post-CD future points", () => {
    const pts = mkPoints(
      "FUT",
      {
        [-30]: -2,
        [-15]: -1,
        [-10]: 0,
        0: 5,
        30: 8,
        60: 10,
        90: 12,
      },
      {
        [-60]: 0,
        [-30]: 1,
        0: 3,
        30: 6,
        60: 8,
        90: 10,
      },
    );
    const sim = {
      Ticker: "FUT",
      "Completion Date": "01/07/2026",
      "Days to CD": 18,
      "Last Price (USD)": 10,
    };
    const built = buildSlopeTrajectory({ chartPoints: pts, simRow: sim, daysToCd: 18 });
    for (const p of built.points) {
      if (p.offset > built.todayOffset + 0.01) {
        expect(p.actual).toBeNull();
      }
    }
    expect(
      built.points.some((p) => p.offset <= built.todayOffset && p.actual != null),
    ).toBe(true);
    expect(built.points.find((p) => p.offset === 30)?.pred).not.toBeNull();
  });
});
