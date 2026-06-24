import { describe, expect, it } from "vitest";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { RowFeatures } from "./lossRiskScreening";
import type { RiskPattern } from "./riskPatternTypes";
import {
  buildClosedValidationPoints,
  summarizeClosedValidation,
  validationPointJitter,
} from "./patternValidationChartData";

const pattern: RiskPattern = {
  id: "test",
  createdAt: "",
  name: "SDS mid",
  conditions: [{ dimension: "sdsBucket", operator: "in", values: ["SDS 40-55 (Mid)"] }],
  inSampleStats: {} as RiskPattern["inSampleStats"],
};

function row(
  ticker: string,
  pnl: number,
  sds: string,
): { r: SimOutcomeRow; f: RowFeatures } {
  const key = `${ticker}|cd1`;
  return {
    r: {
      ticker,
      completion_date: "cd1",
      pnl_pct: pnl,
      capital_eur: 1000,
      is_win: pnl > -2,
    } as SimOutcomeRow,
    f: {
      rowKey: key,
      sdsBucket: sds,
      clinicalPhase: "Phase 2",
      clinicalIndication: "Oncology",
      pplanBucket: "P(plan) 30-50%",
      daysToCdBucket: "DTC 14-30d",
      precdSlopeSign: "Slope flat",
    },
  };
}

describe("patternValidationChartData", () => {
  it("builds closed validation points with match flags", () => {
    const a = row("AAA", -8, "SDS 40-55 (Mid)");
    const b = row("BBB", 5, "SDS ≥70 (Premium)");
    const features = new Map([
      [`AAA|cd1`, a.f],
      [`BBB|cd1`, b.f],
    ]);
    const points = buildClosedValidationPoints(pattern, [a.r, b.r], features);
    expect(points).toHaveLength(2);
    expect(points.find((p) => p.ticker === "AAA")?.matchPattern).toBe(true);
    expect(points.find((p) => p.ticker === "BBB")?.matchPattern).toBe(false);
  });

  it("summarizes precision and recall", () => {
    const rows = [
      row("L1", -10, "SDS 40-55 (Mid)"),
      row("L2", -6, "SDS 40-55 (Mid)"),
      row("W1", 8, "SDS 40-55 (Mid)"),
      row("W2", 4, "SDS ≥70 (Premium)"),
    ];
    const features = new Map(rows.map(({ r, f }) => [`${r.ticker}|cd1`, f]));
    const points = buildClosedValidationPoints(
      pattern,
      rows.map((x) => x.r),
      features,
    );
    const summary = summarizeClosedValidation(points, 3);
    expect(summary.matchedN).toBe(3);
    expect(summary.matchedLossN).toBe(2);
    expect(summary.precision).toBeCloseTo(2 / 3);
    expect(summary.recall).toBeCloseTo(1);
  });

  it("jitter is stable for the same seed", () => {
    expect(validationPointJitter("AAA|cd1")).toBe(validationPointJitter("AAA|cd1"));
  });
});
