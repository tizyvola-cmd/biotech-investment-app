import { describe, expect, it } from "vitest";
import type { ChartPoint } from "../types";
import {
  displayPredChartPoints,
  PREDICTION_CALENDAR_OFFSETS,
  reconcileChartPointsWithSheet,
  roundPredPct,
  samplePredAtCalendarOffsets,
  snapshotSheetDrift,
  assessmentChartOffsetsForNow,
} from "./predictionCurveGrid";
import { recalibCurveVsM60 } from "./sdsCompareOverlay";

const ROW: Record<string, unknown> = {
  Ticker: "LTRN",
  "Completion Date": "2026-07-27",
  "Δ% vs Pred−60\nPred\n−60": -0.0251,
  "Δ% vs Pred−60\nPred\n−30": -0.018,
  "Δ% vs Pred−60\nPred\n−10": -0.017,
  "Δ% vs Pred−60\nPred\n−7": -0.016,
  "Δ% vs Pred−60\nPred\n−5": -0.016,
  "Δ% vs Pred−60\nPred\n−3": -0.016,
  "Δ% vs Pred−60\nPred\n+4": -0.015,
  "Δ% vs Pred−60\nPred\n+7": -0.016,
};

const STALE_SNAPSHOT: ChartPoint[] = [
  { offset: -60, nodo: "standard", pct_foglio: 0.23 },
  { offset: -40, nodo: "standard", pct_foglio: -1.2 },
  { offset: -20, nodo: "standard", pct_foglio: -0.8 },
  { offset: 7, nodo: "standard", pct_foglio: -0.5 },
];

describe("predictionCurveGrid", () => {
  it("roundPredPct keeps 0.01 pp precision", () => {
    expect(roundPredPct(-2.514)).toBe(-2.51);
    expect(roundPredPct(0.076)).toBe(0.08);
  });

  it("detects stale snapshot vs sheet", () => {
    const drift = snapshotSheetDrift(STALE_SNAPSHOT, ROW);
    expect(drift.compared).toBe(PREDICTION_CALENDAR_OFFSETS.length);
    expect(drift.staleNodes).toBeGreaterThan(0);
  });

  it("reconcile replaces stale standard nodes with sheet Pred", () => {
    const synced = reconcileChartPointsWithSheet(STALE_SNAPSHOT, ROW);
    const at60 = synced.find((p) => p.offset === -60);
    expect(at60?.pct_foglio).toBe(-2.51);
  });

  it("display grid uses standard calendar offsets only", () => {
    const pts = displayPredChartPoints(STALE_SNAPSHOT, ROW);
    expect(pts.map((p) => p.offset)).toEqual([...PREDICTION_CALENDAR_OFFSETS]);
  });

  it("Charts and SuperNova sample identical values at standard knots", () => {
    const grid = samplePredAtCalendarOffsets(STALE_SNAPSHOT, ROW);
    const sds = recalibCurveVsM60(STALE_SNAPSHOT, ROW);
    expect(sds).not.toBeNull();
    const byOff = new Map(grid.map((g) => [g.offset, g.pct]));
    for (let i = 0; i < PREDICTION_CALENDAR_OFFSETS.length; i++) {
      const off = PREDICTION_CALENDAR_OFFSETS[i]!;
      expect(byOff.get(off)).toBe(sds![i]);
    }
  });

  it("fills T−60/T−30 from sheet when snapshot only has nodes from T−10", () => {
    const sparse: ChartPoint[] = [
      { offset: -10, nodo: "standard", pct_foglio: -1.7 },
      { offset: -7, nodo: "standard", pct_foglio: -1.6 },
      { offset: -5, nodo: "standard", pct_foglio: -1.6 },
      { offset: -3, nodo: "standard", pct_foglio: -1.6 },
      { offset: 4, nodo: "standard", pct_foglio: -1.5 },
      { offset: 7, nodo: "standard", pct_foglio: -1.6 },
    ];
    const grid = samplePredAtCalendarOffsets(sparse, ROW);
    const byOff = new Map(grid.map((g) => [g.offset, g.pct]));
    expect(byOff.get(-60)).toBe(-2.51);
    expect(byOff.get(-30)).toBe(-1.8);
    expect(byOff.get(-10)).toBe(-1.7);
  });

  it("extends grid before T−60 when today is far from CD", () => {
    const farRow = { ...ROW, "Completion Date": "2026-09-15" };
    const nowOff = -97;
    const offsets = assessmentChartOffsetsForNow(nowOff);
    expect(offsets.some((o) => o < -60)).toBe(true);
    expect(offsets).toContain(-60);
    const grid = samplePredAtCalendarOffsets(STALE_SNAPSHOT, farRow);
    expect(grid.some((g) => g.offset < -60)).toBe(true);
  });
});
