import { describe, expect, it } from "vitest";
import {
  detectCurveMisalignments,
  deriveSuggestedAction,
  evaluateSimBuyGate,
  explainBuyReason,
  explainBuyWarning,
  explainHoldThesis,
  classifyBuyReasonKind,
  criticalMisalignmentSummaryFromEvaluations,
  misalignmentSummaryFromEvaluations,
  overlayPaperMarksOnLossItem,
  resolvePaperPositionMarks,
  backfillPaperEntryBuyPrices,
  simulatePaperTrades,
  sortLossItemsByActionSolidity,
  sortLossItemsByDisplayedRec,
  precatVerdictAgrees,
  softBuyDayNotRed,
  type PaperPosition,
  type SuggestedActionEnhanceCtx,
  type TickerSimEvaluation,
} from "./investDecisionSimLoop";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";
import { emptyAdviceFeedback, type AdviceFeedback } from "./adviceFeedback";
import { completionDateToNowOffset } from "./chartNowOffset";
import type { ChartPoint } from "../types";

const SOFT_BUY_CD = "2026-08-01";

/** Enhance ctx with today green + yesterday green (Soft BUY rising ≥2d). */
function risingTwoDayEnhance(
  overrides: Partial<NonNullable<SuggestedActionEnhanceCtx["simRow"]>> = {},
): SuggestedActionEnhanceCtx {
  const nowOff = completionDateToNowOffset(SOFT_BUY_CD)!;
  const chartPts: ChartPoint[] = [
    { offset: nowOff - 2, price_storico_usd: 100 },
    { offset: nowOff - 1, price_storico_usd: 103 },
    { offset: nowOff, price_storico_usd: 104 },
  ];
  return {
    simRow: {
      Ticker: "OK",
      "Completion Date": SOFT_BUY_CD,
      "Var. Giorn. %": 1.2,
      "Var. 7d %": 2,
      "Var. 3M %": 5,
      "Var. 6M %": 8,
      beta: 1.0,
      liquidity_score: 0.8,
      ...overrides,
    },
    chartPts,
  };
}

function baseItem(
  overrides: Partial<PortfolioLossAnalysisItem> = {},
): PortfolioLossAnalysisItem {
  return {
    key: "k1",
    ticker: "ABC",
    capital: 5000,
    pnlEur: 0,
    pnlPct: 0,
    completionDate: "2026-08-01",
    seriesKey: "abc",
    hasPosition: false,
    company: "ABC Inc",
    daysToCd: 30,
    planReturnPct: 8,
    planCdReturnPct: 5,
    curveGapPct: 0,
    curveGapUsd: null,
    slope5d: 0.1,
    slope20d: 0.05,
    slope45d: null,
    pred5Pp: 0.4,
    stabilityVerdict: "watch",
    precatKind: "enter",
    precatLabel: "Enter",
    investVerdict: "yes",
    exitDecision: "hold",
    exitReason: "hold",
    daysToCurvePeak: 10,
    curvePeakReturnPct: 8,
    chartPointsLoaded: true,
    modelGapLossEur: null,
    curveGapLossEur: null,
    priceGapUsd: null,
    pnlEur24h: null,
    pnlPct24h: null,
    inLoss: false,
    curveRisingHold: true,
    recoveryProbabilityPct: 62,
    recoveryCoversLoss: null,
    recoveryExpectedValuePct: null,
    recoverySummary: null,
    matchPct: 65,
    sdsScore: 55,
    sdsVeto: false,
    eisSuperScore: 50,
    ...overrides,
  } as PortfolioLossAnalysisItem;
}

describe("detectCurveMisalignments", () => {
  it("flags harmony gap when overlay and slope diverge", () => {
    const { ids } = detectCurveMisalignments(
      baseItem(),
      { todayOffset: -30, maxPredGapPp: 0.15, aligned: false, checks: [] },
      "en",
    );
    expect(ids).toContain("harmony_pred_slope");
  });

  it("flags target vs supernova when gap exceeds threshold (harmonized peak)", () => {
    const { ids } = detectCurveMisalignments(
      baseItem({ planReturnPct: 2, curvePeakReturnPct: 9 }),
      null,
      "en",
      { supernovaPeakPct: 9 },
    );
    expect(ids).toContain("target_vs_supernova");
  });

  it("does not flag target vs curve when target is provisional", () => {
    const { ids } = detectCurveMisalignments(
      baseItem({
        planReturnPct: 7.7,
        curvePeakReturnPct: 17,
        planTargetProvisional: true,
        daysToCurvePeak: 200,
        daysToCd: 110,
      }),
      null,
      "en",
      { supernovaPeakPct: 1.27 },
    );
    expect(ids).not.toContain("target_vs_supernova");
  });

  it("does not flag target vs curve when plan capped to forward peak", () => {
    const { ids } = detectCurveMisalignments(
      baseItem({
        planReturnPct: 3,
        curvePeakReturnPct: 3.04,
        daysToCurvePeak: 8,
        daysToCd: 18,
      }),
      null,
      "en",
      { supernovaPeakPct: 3.04 },
    );
    expect(ids).not.toContain("target_vs_supernova");
  });

  it("does not flag target vs curve when curve peak matches plan", () => {
    const { ids } = detectCurveMisalignments(
      baseItem({ planReturnPct: 8, curvePeakReturnPct: 8, daysToCurvePeak: 10, daysToCd: 30 }),
      null,
      "en",
      { supernovaPeakPct: 8 },
    );
    expect(ids).not.toContain("target_vs_supernova");
  });

  it("flags precat vs verdict mismatch", () => {
    const { ids } = detectCurveMisalignments(
      baseItem({ precatKind: "enter", investVerdict: "no" }),
      null,
      "en",
    );
    expect(ids).toContain("precat_vs_verdict");
  });
});

describe("sortLossItemsByActionSolidity", () => {
  it("orders buy tier before sell tier", () => {
    const buy = baseItem({
      ticker: "BUY",
      investVerdict: "yes",
      exitDecision: "hold",
      recoveryProbabilityPct: 70,
      precatKind: "enter",
    });
    const sell = baseItem({
      ticker: "SEL",
      hasPosition: true,
      exitDecision: "exit",
      investVerdict: "no",
      recoveryProbabilityPct: 30,
    });
    const sorted = sortLossItemsByActionSolidity([sell, buy], false);
    expect(sorted.map((i) => i.ticker)).toEqual(["BUY", "SEL"]);
  });

  it("ranks higher P(plan) buys first within buy tier", () => {
    const weak = baseItem({
      ticker: "W",
      investVerdict: "wait",
      exitDecision: "review",
      recoveryProbabilityPct: 46,
      precatKind: "enter",
    });
    const strong = baseItem({
      ticker: "S",
      investVerdict: "yes",
      exitDecision: "hold",
      recoveryProbabilityPct: 80,
      precatKind: "enter",
      planReturnPct: 8,
    });
    const sorted = sortLossItemsByActionSolidity([weak, strong], false);
    expect(sorted[0]?.ticker).toBe("S");
  });
});

describe("sortLossItemsByDisplayedRec", () => {
  it("puts every displayed BUY ahead of hold/uncertain, even if solidity would bury it", () => {
    const solidBuy = baseItem({
      key: "bbnx",
      ticker: "BBNX",
      investVerdict: "yes",
      recoveryProbabilityPct: 70,
    });
    const softBuy = baseItem({
      key: "inbx",
      ticker: "INBX",
      investVerdict: "wait",
      exitDecision: "review",
      recoveryProbabilityPct: 48,
      precatKind: "watch",
    });
    const hold = baseItem({
      key: "cccc",
      ticker: "CCCC",
      investVerdict: "wait",
      exitDecision: "hold",
      recoveryProbabilityPct: 55,
    });
    const recByTicker: Record<string, "buy" | "hold" | "review"> = {
      BBNX: "buy",
      INBX: "buy",
      CCCC: "hold",
    };
    const sorted = sortLossItemsByDisplayedRec(
      [hold, softBuy, solidBuy],
      (item) => recByTicker[item.ticker],
    );
    expect(sorted.map((i) => i.ticker)).toEqual(["BBNX", "INBX", "CCCC"]);
  });
});

describe("criticalMisalignmentSummaryFromEvaluations", () => {
  it("ignores minor flags for KPI count", () => {
    const summary = criticalMisalignmentSummaryFromEvaluations([
      {
        ...({} as import("./investDecisionSimLoop").TickerSimEvaluation),
        misalignments: ["harmony_pred_slope", "target_vs_supernova"],
        readings: {
          harmonyMaxGapPp: 0.8,
          planTargetPct: 10,
          supernovaPeakPct: 12,
        } as import("./investDecisionSimLoop").CurveReadings,
      },
      {
        ...({} as import("./investDecisionSimLoop").TickerSimEvaluation),
        misalignments: ["spot_vs_model"],
        readings: { curveGapPct: 9 } as import("./investDecisionSimLoop").CurveReadings,
      },
      {
        ...({} as import("./investDecisionSimLoop").TickerSimEvaluation),
        misalignments: ["precat_vs_verdict", "spot_vs_model"],
        readings: { curveGapPct: 15 } as import("./investDecisionSimLoop").CurveReadings,
      },
    ] as import("./investDecisionSimLoop").TickerSimEvaluation[]);
    expect(summary.evaluatedTickers).toBe(3);
    expect(summary.misalignedTickers).toBe(1);
    expect(summary.misalignmentByType.precat_vs_verdict).toBe(1);
    expect(summary.misalignmentByType.spot_vs_model).toBe(1);
    expect(summary.misalignmentByType.harmony_pred_slope).toBeUndefined();
  });
});

describe("misalignmentSummaryFromEvaluations", () => {
  it("counts flags by type across evaluations", () => {
    const summary = misalignmentSummaryFromEvaluations([
      {
        ...({} as import("./investDecisionSimLoop").TickerSimEvaluation),
        misalignments: ["harmony_pred_slope", "target_vs_supernova"],
        readings: { harmonyAligned: false } as import("./investDecisionSimLoop").CurveReadings,
        precatVerdictAgree: true,
      },
      {
        ...({} as import("./investDecisionSimLoop").TickerSimEvaluation),
        misalignments: ["spot_vs_model"],
        readings: { harmonyAligned: true } as import("./investDecisionSimLoop").CurveReadings,
        precatVerdictAgree: false,
      },
    ] as import("./investDecisionSimLoop").TickerSimEvaluation[]);
    expect(summary.evaluatedTickers).toBe(2);
    expect(summary.misalignedTickers).toBe(2);
    expect(summary.misalignmentByType.harmony_pred_slope).toBe(1);
    expect(summary.misalignmentByType.target_vs_supernova).toBe(1);
    expect(summary.misalignmentByType.spot_vs_model).toBe(1);
  });
});

describe("deriveSuggestedAction", () => {
  it("suggests buy for off-portfolio enter hold with study evidence", () => {
    expect(
      deriveSuggestedAction(
        baseItem({ hasPosition: false, exitDecision: "hold", investVerdict: "yes" }),
        false,
      ),
    ).toBe("buy");
  });

  it("soft BUY G1 promotes when SDS≥25 · P(plan)≥55 even without Top2 ENTER alignment", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "yes",
          precatKind: "enter",
          recoveryProbabilityPct: 62,
          pnlPct24h: 1.2,
          sdsScore: 30,
          eisSuperScore: 20,
        }),
        false,
        null,
        null,
        risingTwoDayEnhance(),
      ),
    ).toBe("buy");
  });

  it("Gen 4 Soft BUY volume promotes with Top2 NO when rising ≥2d", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "no",
          precatKind: "enter",
          recoveryProbabilityPct: 55,
          pnlPct24h: 1.2,
          sdsScore: 22,
          eisSuperScore: 20,
        }),
        false,
        null,
        null,
        risingTwoDayEnhance(),
      ),
    ).toBe("buy");
  });

  it("never Soft Soft SELL while open MTM is still green (giveback ignored)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "hold",
          investVerdict: "wait",
          pnlPct: 6,
          pnlEur: 300,
          pnlPct24h: -2,
          recoveryProbabilityPct: 70,
          recoveryCoversLoss: true,
          curveRisingHold: true,
        }),
        false,
        null,
        null,
        { peakPnlEur: 400 },
      ),
    ).not.toBe("sell");
  });

  it("Gen 4 giveback Soft SELL after peak giveback once open MTM is underwater", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "hold",
          investVerdict: "wait",
          pnlPct: -0.5,
          pnlEur: -20,
          pnlPct24h: -2,
          recoveryProbabilityPct: 70,
          recoveryCoversLoss: true,
          curveRisingHold: false,
          capital: 1000,
          investedAt: "2026-08-11T15:00:00.000Z",
        }),
        false,
        null,
        null,
        { peakPnlEur: 400 },
      ),
    ).toBe("sell");
  });

  it("Gen 4 giveback does not Soft-SELL a fresh Soft BUY at flat €0 MTM", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "hold",
          investVerdict: "wait",
          pnlPct: 0,
          pnlEur: 0,
          pnlPct24h: 0,
          recoveryProbabilityPct: 70,
          recoveryCoversLoss: true,
          curveRisingHold: false,
        }),
        false,
        null,
        null,
        { peakPnlEur: 800 },
      ),
    ).not.toBe("sell");
  });

  it("soft BUY G1 does not override Top2 WAIT (even in SDS/P band)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "wait",
          precatKind: "enter",
          recoveryProbabilityPct: 62,
          planReturnPct: 8,
        }),
        false,
      ),
    ).not.toBe("buy");
  });

  it("off-book without Soft BUY but P≥50 → hold (not blanket Uncertain)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "wait",
          precatKind: "neutral",
          recoveryProbabilityPct: 64,
          sdsScore: 22,
          pnlPct24h: -1.4,
        }),
        false,
      ),
    ).toBe("hold");
  });

  it("soft BUY G1 promotes when P(plan) is 55–59 (below hard 60)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "hold",
          investVerdict: "yes",
          precatKind: "enter",
          recoveryProbabilityPct: 59,
          pnlPct24h: 1.2,
          sdsScore: 30,
          eisSuperScore: 20,
        }),
        false,
        null,
        null,
        risingTwoDayEnhance(),
      ),
    ).toBe("buy");
  });

  it("does not soft-buy when P(plan) below Soft BUY min — Hold if P≥50", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "hold",
          investVerdict: "yes",
          precatKind: "enter",
          recoveryProbabilityPct: 54,
          sdsScore: 55,
        }),
        false,
      ),
    ).toBe("hold");
  });

  it("strict Top2 BUY still requires EIS when soft band misses (low SDS) — Hold if P≥50", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "hold",
          investVerdict: "yes",
          precatKind: "enter",
          recoveryProbabilityPct: 62,
          sdsScore: 20,
          eisSuperScore: null,
        }),
        false,
      ),
    ).toBe("hold");
  });

  it("blocks soft BUY when precat avoid — Hold if P≥50 (not Uncertain)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "exit",
          investVerdict: "no",
          precatKind: "avoid",
          recoveryProbabilityPct: 62,
          pnlPct24h: 1.4,
        }),
        false,
      ),
    ).toBe("hold");
  });

  it("demotes Soft BUY to REVIEW when multi-horizon momentum is weak (CRDL-like)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "hold",
          investVerdict: "wait",
          precatKind: "enter",
          recoveryProbabilityPct: 59,
          sdsScore: 30,
          pnlPct24h: 1.2,
        }),
        false,
        null,
        null,
        {
          simRow: {
            Ticker: "CRDL",
            "Completion Date": SOFT_BUY_CD,
            "Var. Giorn. %": 1.2,
            "Var. 7d %": -4,
            "Var. 3M %": -25.19,
            "Var. 6M %": 0.67,
            beta: 0.51,
            liquidity_score: 1,
          },
          chartPts: risingTwoDayEnhance().chartPts,
          priorSessionPcts: [1.5],
        },
      ),
    ).toBe("review");
  });

  it("keeps Soft BUY when Top2 allows and momentum/beta/liq pass", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "hold",
          investVerdict: "yes",
          precatKind: "watch",
          recoveryProbabilityPct: 59,
          sdsScore: 30,
          planReturnPct: 5,
          pnlPct24h: 1.2,
          // Strict path needs ENTER + EIS; Soft path can still BUY on SDS/P.
          eisSuperScore: 20,
        }),
        false,
        null,
        null,
        risingTwoDayEnhance(),
      ),
    ).toBe("buy");
  });

  it("never Soft-BUY warrant tickers — use common (JSPR not JSPRW)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          ticker: "JSPRW",
          hasPosition: false,
          exitDecision: "hold",
          investVerdict: "yes",
          precatKind: "watch",
          recoveryProbabilityPct: 62,
          sdsScore: 40,
          planReturnPct: 8,
          pnlPct24h: 2,
          eisSuperScore: 20,
        }),
        false,
        null,
        null,
        risingTwoDayEnhance({ Ticker: "JSPRW" }),
      ),
    ).not.toBe("buy");
  });

  it("does not Soft BUY when only today is green (need ≥2 rising sessions)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "hold",
          investVerdict: "yes",
          precatKind: "watch",
          recoveryProbabilityPct: 59,
          sdsScore: 30,
          planReturnPct: 5,
          pnlPct24h: 1.2,
          eisSuperScore: 20,
        }),
        false,
        null,
        null,
        {
          simRow: {
            Ticker: "OK",
            "Completion Date": SOFT_BUY_CD,
            "Var. Giorn. %": 1.2,
            "Var. 7d %": 2,
            "Var. 3M %": 5,
            "Var. 6M %": 8,
            beta: 1.0,
            liquidity_score: 0.8,
          },
          chartPts: null,
        },
      ),
    ).not.toBe("buy");
  });

  it("Soft BUY G1w wind-run promotes despite Top2 NO / missing rising streak", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "hold",
          investVerdict: "no",
          precatKind: "watch",
          recoveryProbabilityPct: 59,
          sdsScore: 30,
          planReturnPct: 5,
          pnlPct24h: 1.2,
          eisSuperScore: 20,
        }),
        false,
        null,
        null,
        {
          simRow: {
            Ticker: "CRDL",
            "Completion Date": SOFT_BUY_CD,
            "Var. Giorn. %": 1.2,
            "Var. 7d %": -4,
            "Var. 3M %": -25,
            "Var. 6M %": 0.5,
            beta: 0.5,
            liquidity_score: 1,
            cont_g10: 15.3,
            cont_sell_edge: -1.1,
            p_continuation: 44, // display P(cont)=56
          },
          chartPts: null,
          recentlySoldBlocked: true,
        },
      ),
    ).toBe("buy");
  });

  it("Soft BUY G1w does not BUY on a red day (KZIA −7.85%)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "hold",
          investVerdict: "no",
          precatKind: "watch",
          recoveryProbabilityPct: 59,
          sdsScore: 30,
          planReturnPct: 5,
          pnlPct24h: -7.85,
          eisSuperScore: 20,
        }),
        false,
        null,
        null,
        {
          simRow: {
            Ticker: "KZIA",
            "Completion Date": SOFT_BUY_CD,
            "Var. Giorn. %": -7.85,
            "Var. 7d %": 2,
            "Var. 3M %": -10,
            "Var. 6M %": 12,
            beta: 0.5,
            liquidity_score: 1,
            cont_g10: 15.3,
            cont_sell_edge: -1.1,
            p_continuation: 44, // display P(cont)=56
          },
          chartPts: null,
          recentlySoldBlocked: false,
        },
      ),
    ).not.toBe("buy");
  });

  it("Soft BUY High Vol promotes off-book without SDS/P when accel is flagged", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "wait",
          precatKind: "enter",
          recoveryProbabilityPct: 40,
          sdsScore: 10,
          pnlPct24h: 2.1,
        }),
        false,
        null,
        null,
        {
          simRow: { Ticker: "CRDL", "Var. Giorn. %": 2.1, beta: 1, liquidity_score: 0.8 },
          volumeAccel: { flagged: true, doublingMinutes: 18, score: 0.04, rvol: 3.2 },
        },
      ),
    ).toBe("buy");
  });

  it("Soft BUY High Vol does not BUY on a red day", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "wait",
          recoveryProbabilityPct: 40,
          sdsScore: 10,
          pnlPct24h: -3,
        }),
        false,
        null,
        null,
        {
          simRow: { Ticker: "CRDL", "Var. Giorn. %": -3 },
          volumeAccel: { flagged: true, doublingMinutes: 12, score: 0.1, rvol: 4 },
        },
      ),
    ).not.toBe("buy");
  });

  it("Soft BUY day-1 catalyst buys without ↑2d when Vol surge + news Σ>0", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "wait",
          precatKind: "enter",
          recoveryProbabilityPct: 55,
          sdsScore: 25,
          pnlPct24h: 4.2,
        }),
        false,
        null,
        null,
        {
          simRow: { Ticker: "ACME", "Var. Giorn. %": 4.2, beta: 1.1, liquidity_score: 0.6 },
          volSurgePct: 210,
          newsScores: {
            clinical: 8,
            financial: null,
            corporate: null,
            marketAccess: null,
            eis: null,
            n: 1,
          },
        },
      ),
    ).toBe("buy");
  });

  it("Soft BUY day-1 does not fire without news bullish", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "wait",
          recoveryProbabilityPct: 55,
          sdsScore: 25,
          pnlPct24h: 4.2,
        }),
        false,
        null,
        null,
        {
          simRow: { Ticker: "ACME", "Var. Giorn. %": 4.2, beta: 1.1, liquidity_score: 0.6 },
          volSurgePct: 210,
          newsScores: {
            clinical: -3,
            financial: null,
            corporate: null,
            marketAccess: null,
            eis: null,
            n: 1,
          },
        },
      ),
    ).not.toBe("buy");
  });

  it("Soft SELL mild path boosts on bearish catalyst news Σ", () => {
    // investedAt far enough for ≥3 NYSE sessions; P weak so recovery HOLD does not block.
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "hold",
          investVerdict: "wait",
          recoveryProbabilityPct: 40,
          pnlPct: -4.5,
          pnlEur: -90,
          investedAt: "2026-01-02T15:00:00.000Z",
          pnlPct24h: -1.2,
        }),
        false,
        null,
        null,
        {
          simRow: { Ticker: "LOSS", "Var. Giorn. %": -1.2, "10d %": 2 },
          riskV2: 20,
          regRisk: 20,
          newsScores: {
            clinical: -6,
            financial: -2,
            corporate: null,
            marketAccess: null,
            eis: null,
            n: 2,
          },
        },
      ),
    ).toBe("sell");
  });

  it("does not Soft-BUY HAE-like WAIT on a red day (even with tiny plan)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "wait",
          precatKind: "enter",
          recoveryProbabilityPct: 61,
          sdsScore: 40,
          planReturnPct: 1.3,
          daysToCurvePeak: -90,
          curvePeakReturnPct: 11.6,
          pnlPct24h: -0.81,
        }),
        false,
        null,
        null,
        {
          simRow: {
            Ticker: "HAE",
            "Var. Giorn. %": -0.81,
            "Var. 3M %": 30.41,
            "Var. 6M %": -8.5,
            beta: 0.52,
            liquidity_score: 1,
          },
        },
      ),
    ).not.toBe("buy");
  });

  it("Soft BUY WAIT + low forward when rising ≥2d (BBNX-like — aligns Home/Evaluation)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          ticker: "BBNX",
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "wait",
          precatKind: "enter",
          recoveryProbabilityPct: 61,
          sdsScore: 25,
          planReturnPct: 0.8,
          pnlPct24h: 0.59,
          eisSuperScore: 20,
        }),
        false,
        null,
        null,
        risingTwoDayEnhance({ Ticker: "BBNX", "Var. Giorn. %": 0.59 }),
      ),
    ).toBe("buy");
  });

  it("soft SELL G1 promotes open-book loss with weak P(plan)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          key: "loser",
          hasPosition: true,
          exitDecision: "hold",
          investVerdict: "wait",
          pnlPct: -5,
          pnlPct24h: -1.2,
          recoveryProbabilityPct: 42,
          curveRisingHold: false,
        }),
        false,
        null,
        null,
        { riskV2: 45, regRisk: 30 },
      ),
    ).toBe("sell");
  });

  it("soft SELL G1 does not fire on a 2-session hold (SKYE-like noise)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          key: "SKYE|cd",
          ticker: "SKYE",
          hasPosition: true,
          exitDecision: "hold",
          investVerdict: "wait",
          pnlPct: -3,
          pnlPct24h: -1.6,
          recoveryProbabilityPct: 42,
          curveRisingHold: false,
          investedAt: new Date().toISOString(),
        }),
        false,
        null,
        null,
        { riskV2: 50, regRisk: 50 },
      ),
    ).toBe("hold");
  });

  it("paper Soft SELL uses same risk enhance as portfolio (not blind without catalog)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          key: "CHRS|…",
          ticker: "CHRS",
          hasPosition: false, // paper overlay keeps opportunity hasPosition=false
          exitDecision: "hold",
          investVerdict: "wait",
          pnlPct: -3.5,
          pnlPct24h: -0.7,
          recoveryProbabilityPct: 40,
          recoveryCoversLoss: false,
          curveRisingHold: false,
        }),
        true,
        null,
        null,
        { riskV2: 50, regRisk: 20 },
      ),
    ).toBe("sell");
  });

  it("never SELL when session day is green even if total MTM is mildly red (CERS-like)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          ticker: "CERS",
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          pnlPct: -2.8,
          pnlPct24h: 13.4,
          recoveryProbabilityPct: 55,
          curveRisingHold: false,
        }),
        false,
      ),
    ).toBe("hold");
  });

  it("deep Soft SELL (−12%) beats green-day HOLD (CERS −27% / +1.7% day)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          ticker: "CERS",
          hasPosition: true,
          exitDecision: "hold",
          investVerdict: "wait",
          pnlPct: -26.5,
          pnlPct24h: 1.7,
          recoveryProbabilityPct: 55,
          recoveryCoversLoss: true,
          curveRisingHold: false,
        }),
        false,
      ),
    ).toBe("sell");
  });

  it("urgent SELL G2 promotes when key is in book budget set", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          key: "urg1",
          hasPosition: true,
          exitDecision: "hold",
          investVerdict: "wait",
          pnlPct: -4,
          recoveryProbabilityPct: 40,
          recoveryCoversLoss: false,
          curveRisingHold: false,
        }),
        false,
        null,
        null,
        { urgentSellG2Keys: new Set(["urg1"]) },
      ),
    ).toBe("sell");
  });

  it("urgent SELL G2 is not blocked by recovery thesis (JSPR day wipeout)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          key: "JSPR|…",
          ticker: "JSPR",
          hasPosition: true,
          exitDecision: "hold",
          investVerdict: "wait",
          pnlPct: -2.3,
          pnlPct24h: -47.1,
          recoveryProbabilityPct: 70,
          recoveryCoversLoss: true,
          curveRisingHold: true,
          planReturnPct: 20,
          curvePeakReturnPct: 15,
        }),
        false,
        null,
        null,
        { urgentSellG2Keys: new Set(["JSPR|…"]) },
      ),
    ).toBe("sell");
  });

  it("suggests sell for exit decision in paper portfolio when recovery weak", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          curveRisingHold: false,
          recoveryProbabilityPct: 28,
          recoveryCoversLoss: false,
          planReturnPct: -2,
          curvePeakReturnPct: null,
          pnlPct24h: -0.8,
        }),
        true,
      ),
    ).toBe("sell");
  });

  it("paper sim holds when recovery guards pass on exit", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          recoveryProbabilityPct: 70,
          recoveryCoversLoss: true,
          curveRisingHold: false,
        }),
        true,
      ),
    ).toBe("hold");
  });

  it("paper sim holds on green session day even if recovery thesis is dead", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          curveRisingHold: false,
          recoveryProbabilityPct: 28,
          recoveryCoversLoss: false,
          pnlPct24h: 1.2,
          pnlPct: -3,
        }),
        true,
      ),
    ).toBe("hold");
  });

  it("paper sim sells on red day when recovery thesis is dead", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          curveRisingHold: false,
          recoveryProbabilityPct: 28,
          recoveryCoversLoss: false,
          pnlPct24h: -1.2,
          pnlPct: -3,
        }),
        true,
      ),
    ).toBe("sell");
  });

  it("paper sim holds when forward peak covers loss explicitly", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          curveRisingHold: false,
          recoveryProbabilityPct: 30,
          recoveryCoversLoss: true,
          planReturnPct: 6,
          curvePeakReturnPct: 4.5,
          pnlPct24h: -0.3,
          pnlPct: -2,
        }),
        true,
      ),
    ).toBe("hold");
  });

  it("still sells when exit signal and all recovery guards fail", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          curveRisingHold: false,
          recoveryProbabilityPct: 28,
          recoveryCoversLoss: false,
          pnlPct24h: -1.2,
          planReturnPct: -2,
          curvePeakReturnPct: null,
        }),
        true,
      ),
    ).toBe("sell");
  });

  it("paper sim sells on flat 24h + positive plan when thesis is dead", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          curveRisingHold: false,
          recoveryProbabilityPct: 28,
          recoveryCoversLoss: false,
          pnlPct24h: -0.3,
          planReturnPct: 8,
          stabilityVerdict: "watch",
          pnlPct: -3,
        }),
        true,
      ),
    ).toBe("sell");
  });

  it("paper sim holds when learning loop demotes SELL for this P(plan) bucket", () => {
    const feedback: AdviceFeedback = {
      ...emptyAdviceFeedback(),
      actionDemotions: new Map([
        [
          "50-59|sell",
          {
            bucketId: "50-59",
            bucketLabel: "50–59%",
            from: "sell",
            to: "review",
            samples: 10,
            badCount: 7,
            badRate: 0.7,
            dominantRootCause: "direction_wrong",
          },
        ],
      ]),
    };
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          curveRisingHold: false,
          recoveryProbabilityPct: 55,
          recoveryCoversLoss: false,
          pnlPct24h: -1.5,
          planReturnPct: -2,
        }),
        true,
        null,
        feedback,
      ),
    ).toBe("hold");
  });

  it("does not momentum-buy when expected forward gain is negative", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "exit",
          investVerdict: "no",
          precatKind: "avoid",
          recoveryProbabilityPct: 48,
          pnlPct24h: 1.4,
          planReturnPct: -3,
          curvePeakReturnPct: -2,
          pred5Pp: -0.2,
          curveRisingHold: false,
        }),
        false,
      ),
    ).toBe("review");
  });

  it("does not momentum-buy when precat avoid and forward model declining", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "exit",
          investVerdict: "no",
          precatKind: "avoid",
          recoveryProbabilityPct: 50,
          pnlPct24h: 1.4,
          slope5d: -0.2,
          pred5Pp: -0.3,
          curveRisingHold: false,
        }),
        false,
      ),
    ).toBe("hold");
  });

  it("holds real-portfolio line when already invested (no off-portfolio buy)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({ hasPosition: true, exitDecision: "hold", investVerdict: "yes" }),
        false,
      ),
    ).toBe("hold");
  });

  it("suggests sell for real-portfolio exit when not in paper", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          curveRisingHold: false,
          recoveryProbabilityPct: 28,
          recoveryCoversLoss: false,
          planReturnPct: -2,
          curvePeakReturnPct: null,
          pnlPct: -1.2,
          pnlPct24h: -0.8,
        }),
        false,
      ),
    ).toBe("sell");
  });

  it("holds real-portfolio exit when MTM is still positive (BIIB-like)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          curveRisingHold: false,
          recoveryProbabilityPct: 28,
          recoveryCoversLoss: false,
          planReturnPct: -2,
          curvePeakReturnPct: null,
          pnlPct: 2.7,
          pnlPct24h: -1.4,
        }),
        false,
      ),
    ).toBe("hold");
  });

  it("holds portfolio line when exitDecision exit but P(recovery) strong", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          precatKind: "avoid",
          recoveryProbabilityPct: 70,
          recoveryCoversLoss: true,
          planReturnPct: 11.5,
        }),
        false,
      ),
    ).toBe("hold");
  });

  it("sells when exit fires and recovery thesis is dead (Top2 wait alone insufficient)", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "wait",
          precatKind: "accumulate",
          daysToCd: 107,
          recoveryProbabilityPct: 40,
          recoveryCoversLoss: false,
          curveRisingHold: false,
          pnlPct: -4,
          planReturnPct: -1,
        }),
        false,
      ),
    ).toBe("sell");
  });

  it("holds watch-zone line when P(recovery) thesis is still alive", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "wait",
          precatKind: "accumulate",
          daysToCd: 107,
          recoveryProbabilityPct: 58,
          recoveryCoversLoss: true,
          curveRisingHold: false,
          pnlPct: -3,
        }),
        false,
      ),
    ).toBe("hold");
  });
});

describe("evaluateSimBuyGate", () => {
  it("allows buy when deriveSuggestedAction is buy", () => {
    const item = baseItem({
      hasPosition: false,
      exitDecision: "hold",
      investVerdict: "yes",
    });
    expect(evaluateSimBuyGate(item, false, "it")).toEqual({ allowed: true, reason: null });
  });

  it("blocks buy with Top2 wait when watchlist gate not met", () => {
    const item = baseItem({
      hasPosition: false,
      exitDecision: "exit",
      investVerdict: "wait",
      precatKind: "enter",
      recoveryProbabilityPct: 38,
    });
    const gate = evaluateSimBuyGate(item, false, "it");
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/wait/i);
  });
});

describe("explainBuyReason", () => {
  it("returns null for momentum-only profile (no longer buy)", () => {
    const item = baseItem({
      hasPosition: false,
      exitDecision: "exit",
      investVerdict: "no",
      precatKind: "avoid",
      recoveryProbabilityPct: 84,
      pnlPct24h: 1.2,
    });
    expect(classifyBuyReasonKind(item, false)).toBeNull();
    expect(explainBuyReason(item, false, "it")).toBeNull();
    expect(explainBuyWarning(item, false, "it")).toBeNull();
  });

  it("explains aligned Top2 yes + ENTER + evidence", () => {
    const item = baseItem({
      hasPosition: false,
      exitDecision: "hold",
      investVerdict: "yes",
    });
    expect(explainBuyReason(item, false, "it")).toBe(
      "Top2 sì + ENTER + P(plan) 62% + match/SDS/EIS ok",
    );
  });

  it("explains soft BUY G1 when Top2 allows and plan is adequate", () => {
    const item = baseItem({
      hasPosition: false,
      exitDecision: "hold",
      investVerdict: "yes",
      precatKind: "watch",
      recoveryProbabilityPct: 62,
      sdsScore: 30,
      planReturnPct: 5,
      pnlPct24h: 1.2,
      eisSuperScore: 20,
    });
    const enhance = risingTwoDayEnhance();
    expect(classifyBuyReasonKind(item, false, enhance)).toBe("soft_buy_g1");
    expect(explainBuyReason(item, false, "it", enhance)).toContain("Soft BUY G1");
  });

  it("does not classify Soft BUY when Top2 is WAIT", () => {
    const item = baseItem({
      hasPosition: false,
      exitDecision: "review",
      investVerdict: "wait",
      precatKind: "enter",
      recoveryProbabilityPct: 62,
      planReturnPct: 5,
    });
    expect(classifyBuyReasonKind(item, false)).toBeNull();
  });

  it("returns null when action is not buy", () => {
    const item = baseItem({
      hasPosition: false,
      exitDecision: "exit",
      investVerdict: "wait",
      precatKind: "enter",
      recoveryProbabilityPct: 38,
      sdsScore: 20,
    });
    expect(explainBuyReason(item, false, "it")).toBeNull();
  });
});

describe("explainHoldThesis", () => {
  it("describes recovery horizon when P(recovery) high", () => {
    const item = baseItem({
      hasPosition: true,
      exitDecision: "hold",
      investVerdict: "wait",
      recoveryProbabilityPct: 70,
      recoveryCoversLoss: true,
      planReturnPct: 11.5,
      daysToCurvePeak: 45,
    });
    const thesis = explainHoldThesis(item, "it");
    expect(thesis).toMatch(/Attendi recupero/);
    expect(thesis).toMatch(/70%/);
    expect(thesis).toMatch(/11\.5%/);
    expect(thesis).toMatch(/45g/);
  });
});

describe("precatVerdictAgrees", () => {
  it("agrees when enter and yes", () => {
    expect(precatVerdictAgrees(baseItem({ precatKind: "enter", investVerdict: "yes" }))).toBe(
      true,
    );
  });

  it("disagrees when enter and no", () => {
    expect(precatVerdictAgrees(baseItem({ precatKind: "enter", investVerdict: "no" }))).toBe(
      false,
    );
  });
});

// ── simulatePaperTrades ───────────────────────────────────────────────────

function buildEval(overrides: Partial<TickerSimEvaluation> = {}): TickerSimEvaluation {
  return {
    key: "k1",
    ticker: "T1",
    hasPosition: false,
    inPaperPortfolio: false,
    daysToCd: 30,
    readings: { todayOffset: 0, maxPredGapPp: 0, aligned: false, checks: [] } as TickerSimEvaluation["readings"],
    misalignments: [],
    misalignmentLabels: [],
    exitDecision: "hold",
    investVerdict: "wait",
    entryVerdict: "wait",
    exitVerdict: null,
    probPct: 60,
    suggestedAction: "buy",
    planReturnPct: 8,
    pnlPct24h: 0,
    pnlPct: 0,
    precatVerdictAgree: true,
    exitReason: "",
    compositeScore: 60,
    scoringZone: "watch" as TickerSimEvaluation["scoringZone"],
    scoreBreakdown: {} as TickerSimEvaluation["scoreBreakdown"],
    compositeDampened: false,
    ...overrides,
  };
}

function buildPos(overrides: Partial<PaperPosition> = {}): PaperPosition {
  return {
    key: "k1",
    ticker: "T1",
    entryAt: "2026-06-01T10:00:00.000Z",
    capital: 5000,
    entryReason: "test",
    entryPlanReturnPct: 8,
    entryProbPct: 60,
    lastMarkPct: null,
    ...overrides,
  };
}

describe("simulatePaperTrades — orphan eviction", () => {
  it("closes positions whose evaluation has disappeared at last known mark", () => {
    const portfolio = [
      buildPos({ key: "ORPH1", ticker: "ORPH1", lastMarkPct: -3.5 }),
      buildPos({ key: "ORPH2", ticker: "ORPH2", lastMarkPct: 2 }),
    ];
    // Only ORPH2 has a live eval — ORPH1 is orphaned.
    const evaluations = [
      buildEval({ key: "ORPH2", ticker: "ORPH2", suggestedAction: "hold" }),
    ];
    const { trades, portfolioAfter } = simulatePaperTrades(
      evaluations,
      portfolio,
      "2026-06-17T10:00:00.000Z",
      5000,
      Number.POSITIVE_INFINITY,
    );
    const sells = trades.filter((t) => t.side === "sell");
    expect(sells.length).toBe(1);
    expect(sells[0].key).toBe("ORPH1");
    expect(sells[0].pnlPctSimulated).toBeCloseTo(-3.5, 3);
    expect(sells[0].pnlEurSimulated).toBeCloseTo(-175, 1); // 5000 * -3.5%
    expect(sells[0].reason).toMatch(/orphan/i);
    expect(portfolioAfter.map((p) => p.key)).toEqual(["ORPH2"]);
  });

  it("treats missing lastMarkPct on an orphan as 0% P&L (no synthetic loss)", () => {
    const portfolio = [buildPos({ key: "Z", ticker: "Z", lastMarkPct: null })];
    const { trades, portfolioAfter } = simulatePaperTrades(
      [],
      portfolio,
      "2026-06-17T10:00:00.000Z",
      5000,
      Number.POSITIVE_INFINITY,
    );
    expect(portfolioAfter).toEqual([]);
    expect(trades).toHaveLength(1);
    expect(trades[0].pnlPctSimulated).toBe(0);
    expect(trades[0].pnlEurSimulated).toBe(0);
  });

  it("does not over-evict: a position present in the eval list is kept", () => {
    const portfolio = [buildPos({ key: "KEEP", ticker: "KEEP" })];
    const evaluations = [
      buildEval({ key: "KEEP", ticker: "KEEP", suggestedAction: "hold" }),
    ];
    const { trades, portfolioAfter } = simulatePaperTrades(
      evaluations,
      portfolio,
      "2026-06-17T10:00:00.000Z",
      5000,
      Number.POSITIVE_INFINITY,
    );
    expect(portfolioAfter).toEqual(portfolio);
    expect(trades.filter((t) => t.side === "sell")).toHaveLength(0);
  });
});

describe("simulatePaperTrades — uncapped sim loop", () => {
  it("enters every BUY suggestion when maxOpenPositions is Infinity", () => {
    const evaluations = Array.from({ length: 15 }, (_, i) =>
      buildEval({
        key: `K${i}`,
        ticker: `T${i}`,
        suggestedAction: "buy",
      }),
    );
    const { trades, portfolioAfter } = simulatePaperTrades(
      evaluations,
      [],
      "2026-06-17T10:00:00.000Z",
      5000,
      Number.POSITIVE_INFINITY,
    );
    const buys = trades.filter((t) => t.side === "buy");
    expect(buys).toHaveLength(15);
    expect(portfolioAfter).toHaveLength(15);
  });

  it("still respects a finite cap when one is provided (tests can opt-in)", () => {
    const evaluations = Array.from({ length: 6 }, (_, i) =>
      buildEval({ key: `K${i}`, ticker: `T${i}`, suggestedAction: "buy" }),
    );
    const { portfolioAfter } = simulatePaperTrades(
      evaluations,
      [],
      "2026-06-17T10:00:00.000Z",
      5000,
      3,
    );
    expect(portfolioAfter).toHaveLength(3);
  });

  it("captures entryBuyPrice from sim row on BUY", () => {
    const evaluations = [
      buildEval({ key: "K1", ticker: "ABC", suggestedAction: "buy" }),
    ];
    const simRowByKey = new Map<string, Record<string, unknown>>([
      ["K1", { Ticker: "ABC", "Prezzo Corrente ($)": 12.5 }],
    ]);
    const { portfolioAfter } = simulatePaperTrades(
      evaluations,
      [],
      "2026-06-17T10:00:00.000Z",
      5000,
      Number.POSITIVE_INFINITY,
      { simRowByKey },
    );
    expect(portfolioAfter[0]?.entryBuyPrice).toBe(12.5);
  });
});

describe("paper MTM marks", () => {
  it("resolvePaperPositionMarks uses entry vs spot and Var. Giorn.", () => {
    const pos: PaperPosition = {
      key: "K1",
      ticker: "ABC",
      entryAt: "2026-06-01T00:00:00.000Z",
      capital: 5000,
      entryReason: "test",
      entryBuyPrice: 10,
    };
    const marks = resolvePaperPositionMarks(pos, {
      "Prezzo Corrente ($)": 11,
      "Var. Giorn. %": -2.5,
    });
    expect(marks.totalPnlPct).toBe(10);
    expect(marks.dayPnlPct).toBe(-2.5);
    expect(marks.dayPnlEur).toBe(-125);
  });

  it("resolvePaperPositionMarks uses Var. Giorn. when entry still equals spot", () => {
    const pos: PaperPosition = {
      key: "K1",
      ticker: "VRTX",
      entryAt: "2026-08-10T08:00:00.000Z",
      capital: 3500,
      entryReason: "test",
      entryBuyPrice: 496.07,
      lastMarkPct: 0,
    };
    const marks = resolvePaperPositionMarks(pos, {
      "Prezzo Corrente ($)": 496.07,
      "Var. Giorn. %": 1.8,
    });
    expect(marks.totalPnlPct).toBe(1.8);
    expect(marks.dayPnlPct).toBe(1.8);
  });

  it("overlayPaperMarksOnLossItem replaces opportunity pnlPct≡0", () => {
    const item = baseItem({ pnlPct: 0, pnlEur: 0, capital: 0, inLoss: false });
    const pos: PaperPosition = {
      key: "k1",
      ticker: "ABC",
      entryAt: "2026-06-01T00:00:00.000Z",
      capital: 4000,
      entryReason: "test",
      entryBuyPrice: 20,
    };
    const over = overlayPaperMarksOnLossItem(item, pos, {
      "Prezzo Corrente ($)": 18,
      "Var. Giorn. %": -3,
    });
    expect(over.pnlPct).toBe(-10);
    expect(over.pnlEur).toBe(-400);
    expect(over.pnlPct24h).toBe(-3);
    expect(over.capital).toBe(4000);
    expect(over.inLoss).toBe(true);
  });

  it("backfillPaperEntryBuyPrices infers entry from lastMarkPct", () => {
    const portfolio: PaperPosition[] = [
      {
        key: "K1",
        ticker: "ABC",
        entryAt: "2026-06-01T00:00:00.000Z",
        capital: 5000,
        entryReason: "test",
        lastMarkPct: -20,
      },
    ];
    const map = new Map<string, Record<string, unknown>>([
      ["K1", { "Prezzo Corrente ($)": 8 }],
    ]);
    const out = backfillPaperEntryBuyPrices(portfolio, map);
    expect(out[0]?.entryBuyPrice).toBe(10);
  });
});

describe("softBuyDayNotRed session noise", () => {
  it("does not treat a tiny red print as a red day", () => {
    expect(softBuyDayNotRed({ pnlPct24h: -0.2 })).toBe(true);
    expect(softBuyDayNotRed({ pnlPct24h: 0 })).toBe(true);
    expect(softBuyDayNotRed({ pnlPct24h: -0.8 })).toBe(false);
  });
});
