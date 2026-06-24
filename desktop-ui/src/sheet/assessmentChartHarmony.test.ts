import { describe, expect, it } from "vitest";
import {
  auditAssessmentChartHarmony,
  curveValuesVsToday,
} from "./assessmentChartHarmony";
import { calendarOffsetsForValueCount } from "./chartNodes";
import { predPctVsTodayByOffset } from "./precatCurve";
import { SUPERNova_OFFSETS } from "./sdsHistoryCurve";

describe("assessmentChartHarmony", () => {
  it("rebase overlay to 0% at today offset (interpolated)", () => {
    const vsM60 = [0, -8, 2, 4, 5, 6, 10, 12];
    const now = -20;
    const rebased = curveValuesVsToday(vsM60, now);
    const audit = auditAssessmentChartHarmony({
      overlayVsToday: {
        ticker: "T",
        color: "#6366f1",
        values: rebased,
        peakRoi: 0,
        peakOffset: now,
        peakKind: "anchor",
      },
      slopePoints: [
        {
          offset: now,
          label: "T0",
          pred: 0,
          actual: 0,
          gap: null,
          isToday: true,
        },
      ],
      todayOffset: now,
    });
    expect(audit.checks.find((c) => c.offset === now)?.overlayPct).toBeCloseTo(0, 1);
  });

  it("predPctVsToday matches rebased overlay at standard knots", () => {
    const pts = [
      { d: -60, pct: 0 },
      { d: -30, pct: -8 },
      { d: -10, pct: 2 },
      { d: -7, pct: 4 },
      { d: -5, pct: 5 },
      { d: -3, pct: 6 },
      { d: 0, pct: 4 },
      { d: 4, pct: 10 },
      { d: 7, pct: 12 },
    ];
    const todayOffset = -20;
    const predMap = predPctVsTodayByOffset(pts, todayOffset);
    const vsM60 = SUPERNova_OFFSETS.map((off) => pts.find((p) => p.d === off)?.pct ?? 0);
    const rebased = curveValuesVsToday(vsM60, todayOffset);

    for (let i = 0; i < SUPERNova_OFFSETS.length; i++) {
      const off = SUPERNova_OFFSETS[i]!;
      const fromMap = predMap.get(off);
      if (fromMap == null) continue;
      expect(rebased[i]).toBeCloseTo(fromMap, 2);
    }
  });

  it("aligned when slope pred matches overlay at shared calendar knots", () => {
    const now = -20;
    const vsM60 = [0, -8, 2, 4, 5, 6, 10, 12];
    const offsets = calendarOffsetsForValueCount(vsM60.length);
    const rebased = curveValuesVsToday(vsM60, now, offsets);
    const slopePoints = offsets.map((offset, i) => ({
      offset,
      label: offset === now ? "T0" : `T${offset}`,
      pred: offset === now ? 0 : (rebased[i] ?? null),
      actual: null,
      gap: null,
      isToday: offset === now,
    }));
    const audit = auditAssessmentChartHarmony({
      overlayVsToday: {
        ticker: "T",
        color: "#6366f1",
        values: rebased,
        peakRoi: 0,
        peakOffset: now,
        peakKind: "anchor",
      },
      slopePoints,
      todayOffset: now,
    });
    expect(audit.aligned).toBe(true);
    expect(audit.maxPredGapPp).toBe(0);
  });
});
