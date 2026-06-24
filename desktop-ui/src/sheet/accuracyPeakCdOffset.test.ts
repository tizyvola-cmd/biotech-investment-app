import { describe, expect, it } from "vitest";
import type { AdviceCalibrationPoint } from "./investDecisionSimAdviceCalibration";
import {
  binCalOffsetFromDaysToCd,
  calOffsetFromDaysToCd,
  formatPeakCdAnnotation,
  formatPeakCdLabel,
  buildAdviceOutcomeBinnedSummary,
  expectedAdviceOutcomeAtDaysToCd,
  formatAdviceOutcomeRangeLabel,
  peakCdFromAdvicePoints,
  peakCdFromSimOutcomeSign,
} from "./accuracyPeakCdOffset";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";

function calPoint(
  partial: Partial<AdviceCalibrationPoint> & Pick<AdviceCalibrationPoint, "id">,
): AdviceCalibrationPoint {
  return {
    ticker: "X",
    probPct: 70,
    bucketId: "70-79",
    bucketLabel: "70–79%",
    outcome: "good",
    pnlPct: 2,
    priceChangePct: 2,
    expectedReturnPct: 3,
    forecastErrorPct: -1,
    suggestedAction: "buy",
    source: "live",
    kind: "buy_rec",
    at: "",
    ...partial,
  };
}

describe("accuracyPeakCdOffset", () => {
  it("maps days to CD into sign-curve bins", () => {
    expect(calOffsetFromDaysToCd(45)).toBe(-45);
    expect(binCalOffsetFromDaysToCd(45)).toBe(-40);
    expect(binCalOffsetFromDaysToCd(5)).toBe(-5);
    expect(binCalOffsetFromDaysToCd(7)).toBe(-7);
  });

  it("finds peak outcome bin from advice points", () => {
    const points = [
      calPoint({ id: "live|A|buy", daysToCdAtAdvice: 5, outcome: "good" }),
      calPoint({ id: "live|B|buy", daysToCdAtAdvice: 6, outcome: "good" }),
      calPoint({ id: "live|C|buy", daysToCdAtAdvice: 30, outcome: "bad" }),
      calPoint({ id: "live|D|buy", daysToCdAtAdvice: 32, outcome: "bad" }),
    ];
    const peak = peakCdFromAdvicePoints(points, { mode: "outcome", action: "buy" });
    expect(peak?.offset).toBe(-5);
    expect(peak?.pct).toBe(100);
  });

  it("formats advice outcome range label", () => {
    const summary = buildAdviceOutcomeBinnedSummary([
      { daysToCd: 45, correct: true },
      { daysToCd: 46, correct: false },
      { daysToCd: 5, correct: true },
      { daysToCd: 6, correct: true },
      { daysToCd: 7, correct: true },
    ]);
    expect(formatAdviceOutcomeRangeLabel(summary, "it")).toBe(
      "spread bin T-CD: min 50.0% T-50 · max 100.0% T-5",
    );
    const expected = expectedAdviceOutcomeAtDaysToCd(6, summary);
    expect(expected?.offset).toBe(-5);
    expect(expected?.pct).toBe(100);
  });

  it("ignores sparse bins (n<2) for min/max range", () => {
    const summary = buildAdviceOutcomeBinnedSummary([
      { daysToCd: 45, correct: false },
      { daysToCd: 5, correct: true },
      { daysToCd: 6, correct: true },
    ]);
    expect(formatAdviceOutcomeRangeLabel(summary, "en")).toBe(
      "T-CD bin spread: min 100.0% T-5 · max 100.0% T-5",
    );
  });

  it("formats peak annotation with bin rate for dashboard", () => {
    expect(formatPeakCdAnnotation({ offset: -5, pct: 88.9 }, "it")).toBe(
      "88.9% max a T-5 dal CD",
    );
    expect(formatPeakCdAnnotation({ offset: -5, pct: 88.9 }, "en")).toBe(
      "88.9% max at T-5 from CD",
    );
    expect(formatPeakCdLabel(-5, "it")).toBe("max a T-5 dal CD");
  });

  it("finds peak sign bin on closed outcomes", () => {
    const row = (days: number, hit: boolean): SimOutcomeRow =>
      ({
        row_key: `X${days}|cd`,
        ticker: "X",
        days_to_cd: days,
        capital_eur: 5000,
        entry_pred7_pp: 5,
        pnl_pct: hit ? 4 : -4,
        outcome: hit ? "win" : "loss",
      }) as SimOutcomeRow;

    const peak = peakCdFromSimOutcomeSign([
      row(5, true),
      row(6, true),
      row(30, false),
      row(32, false),
    ]);
    expect(peak?.offset).toBe(-5);
    expect(peak?.pct).toBe(100);
  });
});
