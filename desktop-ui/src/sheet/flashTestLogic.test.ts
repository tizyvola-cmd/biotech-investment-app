import { describe, expect, it } from "vitest";
import { deriveFlashTestAction } from "./flashTestLogic";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";

function item(
  overrides: Partial<PortfolioLossAnalysisItem> = {},
): PortfolioLossAnalysisItem {
  return {
    key: "AAA|cd",
    ticker: "AAA",
    capital: 0,
    pnlEur: 0,
    pnlPct: 0,
    completionDate: "2026-09-01",
    seriesKey: "aaa",
    hasPosition: false,
    company: "AAA",
    daysToCd: 20,
    planReturnPct: 10,
    planCdReturnPct: 8,
    curveGapPct: 0,
    curveGapUsd: null,
    slope5d: 0.1,
    slope20d: 0.05,
    slope45d: null,
    pred5Pp: 0.4,
    stabilityVerdict: "watch",
    precatKind: "enter",
    precatLabel: "Enter",
    investVerdict: "wait",
    exitDecision: "hold",
    exitReason: "",
    recoveryProbabilityPct: 55,
    recoveryCoversLoss: true,
    curveRisingHold: true,
    curvePeakReturnPct: 12,
    daysToCurvePeak: 10,
    sdsScore: 22,
    eisSuperScore: 30,
    pnlPct24h: 1.2,
    ...overrides,
  } as PortfolioLossAnalysisItem;
}

const rising = { priorSessionPcts: [1.2] as Array<number | null | undefined> };

describe("deriveFlashTestAction", () => {
  it("Gen 0 Soft BUY only via classic Top2 yes — no volume Soft BUY", () => {
    // Volume Soft path (WAIT + SDS25 + P60) must NOT buy on Gen 0.
    expect(
      deriveFlashTestAction(
        0,
        item({
          investVerdict: "wait",
          sdsScore: 30,
          recoveryProbabilityPct: 62,
          pnlPct24h: 1.5,
        }),
        rising,
      ),
    ).not.toBe("buy");
    // Classic Top2 yes + ENTER + study evidence (SDS≥50 · EIS≥45).
    expect(
      deriveFlashTestAction(
        0,
        item({
          investVerdict: "yes",
          precatKind: "enter",
          exitDecision: "hold",
          sdsScore: 55,
          recoveryProbabilityPct: 62,
          planReturnPct: 10,
          curvePeakReturnPct: 12,
          eisSuperScore: 50,
          pnlPct24h: 1.5,
        }),
        rising,
      ),
    ).toBe("buy");
  });

  it("Gen 1 Soft BUY needs SDS≥25 and Top2≠NO; Gen 2 allows SDS≥20", () => {
    const waitSds22 = item({
      investVerdict: "wait",
      sdsScore: 22,
      recoveryProbabilityPct: 55,
      pnlPct24h: 1.5,
    });
    expect(deriveFlashTestAction(1, waitSds22, rising)).not.toBe("buy");
    expect(deriveFlashTestAction(2, waitSds22, rising)).toBe("buy");

    const waitSds26 = item({
      investVerdict: "wait",
      sdsScore: 26,
      recoveryProbabilityPct: 55,
      pnlPct24h: 1.5,
    });
    expect(deriveFlashTestAction(1, waitSds26, rising)).toBe("buy");
    expect(deriveFlashTestAction(2, waitSds26, rising)).toBe("buy");
  });

  it("Gen 1–3 hard-block Top2 NO; Gen 4 allows it (Home Soft)", () => {
    const top2No = item({
      investVerdict: "no",
      sdsScore: 30,
      recoveryProbabilityPct: 55,
      pnlPct24h: 1.5,
    });
    expect(deriveFlashTestAction(1, top2No, rising)).not.toBe("buy");
    expect(deriveFlashTestAction(2, top2No, rising)).not.toBe("buy");
    expect(deriveFlashTestAction(3, top2No, rising)).not.toBe("buy");
    expect(deriveFlashTestAction(4, top2No, rising)).toBe("buy");
  });

  it("Gen 4 Soft BUY matches Home — Top2 NO + SDS/P + ↑≥2d priors", () => {
    expect(
      deriveFlashTestAction(4, item({ investVerdict: "no", sdsScore: 22 }), null),
    ).not.toBe("buy");
    expect(
      deriveFlashTestAction(
        4,
        item({ investVerdict: "no", sdsScore: 22, pnlPct24h: 1.5 }),
        { priorSessionPcts: [1.2] },
      ),
    ).toBe("buy");
  });

  it("Gen 4 does not giveback-sell while MTM is still green", () => {
    expect(
      deriveFlashTestAction(
        4,
        item({
          hasPosition: true,
          exitDecision: "hold",
          pnlPct: 6,
          pnlEur: 300,
          pnlPct24h: -1,
          recoveryProbabilityPct: 70,
        }),
        { peakPnlEur: 400 },
      ),
    ).not.toBe("sell");
  });

  it("Gen 4 giveback sells after peak giveback once MTM ≤ 0", () => {
    expect(
      deriveFlashTestAction(
        4,
        item({
          hasPosition: true,
          exitDecision: "hold",
          pnlPct: -1,
          pnlEur: -20,
          pnlPct24h: -1,
          recoveryProbabilityPct: 70,
          investedAt: "2026-08-11T15:00:00.000Z",
        }),
        { peakPnlEur: 400 },
      ),
    ).toBe("sell");
  });

  it("Gen 2 does not giveback-sell on the same peak drawdown", () => {
    expect(
      deriveFlashTestAction(
        2,
        item({
          hasPosition: true,
          exitDecision: "hold",
          pnlPct: 6,
          pnlEur: 300,
          pnlPct24h: -1,
          recoveryProbabilityPct: 70,
        }),
        { peakPnlEur: 400 },
      ),
    ).not.toBe("sell");
  });

  it("inPaper=true uses sell path even when item.hasPosition is false", () => {
    // Flash Test overlay used to leave hasPosition=false — Soft SELL never fired.
    expect(
      deriveFlashTestAction(
        4,
        item({
          hasPosition: false,
          exitDecision: "hold",
          pnlPct: -1,
          pnlEur: -20,
          pnlPct24h: -1,
          recoveryProbabilityPct: 70,
          investedAt: "2026-08-11T15:00:00.000Z",
        }),
        { peakPnlEur: 400 },
        true,
      ),
    ).toBe("sell");
    expect(
      deriveFlashTestAction(
        1,
        item({
          hasPosition: false,
          investVerdict: "wait",
          sdsScore: 30,
          recoveryProbabilityPct: 55,
          pnlPct24h: 1.5,
        }),
        rising,
        true,
      ),
    ).not.toBe("buy");
  });
});
