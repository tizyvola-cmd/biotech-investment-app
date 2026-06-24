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
  simulatePaperTrades,
  sortLossItemsByActionSolidity,
  precatVerdictAgrees,
  type PaperPosition,
  type TickerSimEvaluation,
} from "./investDecisionSimLoop";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";
import { emptyAdviceFeedback, type AdviceFeedback } from "./adviceFeedback";

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
    recoveryProbabilityPct: 55,
    recoveryCoversLoss: null,
    recoveryExpectedValuePct: null,
    recoverySummary: null,
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
  it("suggests buy for off-portfolio enter hold", () => {
    expect(
      deriveSuggestedAction(
        baseItem({ hasPosition: false, exitDecision: "hold", investVerdict: "yes" }),
        false,
      ),
    ).toBe("buy");
  });

  it("suggests buy for Top2 yes + review exit", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "yes",
          precatKind: "enter",
          recoveryProbabilityPct: 51,
        }),
        false,
      ),
    ).toBe("buy");
  });

  it("suggests buy for Top2 yes + softened exit when precat enter and P(plan) ok", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "exit",
          investVerdict: "yes",
          precatKind: "enter",
          recoveryProbabilityPct: 46,
        }),
        false,
      ),
    ).toBe("buy");
  });

  it("suggests watchlist buy for Top2 wait + precat enter + P(plan) ≥ 45% + exit review", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "wait",
          precatKind: "enter",
          recoveryProbabilityPct: 46,
        }),
        false,
      ),
    ).toBe("buy");
  });

  it("suggests watchlist buy for Top2 wait + precat enter + P(plan) ≥ 45% even with exit exit", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "exit",
          investVerdict: "wait",
          precatKind: "enter",
          recoveryProbabilityPct: 45,
        }),
        false,
      ),
    ).toBe("buy");
  });

  it("does not watchlist buy when P(plan) below 45%", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "wait",
          precatKind: "enter",
          recoveryProbabilityPct: 44,
        }),
        false,
      ),
    ).toBe("review");
  });

  it("does not watchlist buy when Top2 wait + exit exit with P below watch threshold", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "exit",
          investVerdict: "wait",
          precatKind: "enter",
          recoveryProbabilityPct: 38,
        }),
        false,
      ),
    ).toBe("review");
  });

  it("momentum override buys on 24h gainer with strong P despite Top2 no", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "exit",
          investVerdict: "no",
          precatKind: "avoid",
          recoveryProbabilityPct: 46,
          pnlPct24h: 1.4,
        }),
        false,
      ),
    ).toBe("buy");
  });

  it("watch zone accumulate with P(plan) ≥ 40% recommends buy", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: false,
          exitDecision: "review",
          investVerdict: "wait",
          precatKind: "accumulate",
          recoveryProbabilityPct: 42,
          daysToCd: 90,
        }),
        false,
      ),
    ).toBe("buy");
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

  it("paper sim holds on positive 24h momentum despite exit signal", () => {
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
        }),
        true,
      ),
    ).toBe("hold");
  });

  it("paper sim holds when model forward peak remains positive", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "yes",
          curveRisingHold: false,
          recoveryProbabilityPct: 30,
          recoveryCoversLoss: false,
          planReturnPct: 6,
          curvePeakReturnPct: 4.5,
          pnlPct24h: -0.3,
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

  it("paper sim holds on flat 24h with positive plan (ambiguous exit band)", () => {
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
          stabilityVerdict: "hold",
        }),
        true,
      ),
    ).toBe("hold");
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
    ).toBe("review");
  });

  it("suggests buy for real-portfolio hold when not yet in paper", () => {
    expect(
      deriveSuggestedAction(
        baseItem({ hasPosition: true, exitDecision: "hold", investVerdict: "yes" }),
        false,
      ),
    ).toBe("buy");
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
          pnlPct24h: -0.8,
        }),
        false,
      ),
    ).toBe("sell");
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

  it("holds portfolio watch-zone accumulate with Top2 wait", () => {
    expect(
      deriveSuggestedAction(
        baseItem({
          hasPosition: true,
          exitDecision: "exit",
          investVerdict: "wait",
          precatKind: "accumulate",
          daysToCd: 107,
          recoveryProbabilityPct: 53,
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
  it("explains momentum override with 24h and P(plan)", () => {
    const item = baseItem({
      hasPosition: false,
      exitDecision: "exit",
      investVerdict: "no",
      precatKind: "avoid",
      recoveryProbabilityPct: 84,
      pnlPct24h: 1.2,
    });
    expect(classifyBuyReasonKind(item, false)).toBe("momentum_override");
    expect(explainBuyReason(item, false, "it")).toBe(
      "Override momentum 24h +1.2% + P(plan) 84%",
    );
    expect(explainBuyReason(item, false, "en")).toMatch(/24h momentum override \+1\.2% \+ P\(plan\) 84%/);
  });

  it("warns on momentum override with Top2 no", () => {
    const item = baseItem({
      investVerdict: "no",
      precatKind: "avoid",
      pnlPct24h: 1.2,
      recoveryProbabilityPct: 84,
    });
    expect(explainBuyWarning(item, false, "it")).toContain("Top2 e precat negativi");
  });

  it("explains Top2 yes + hold", () => {
    const item = baseItem({
      hasPosition: false,
      exitDecision: "hold",
      investVerdict: "yes",
    });
    expect(explainBuyReason(item, false, "it")).toBe("Top2 sì + exit hold");
  });

  it("explains Top2 wait + precat enter + P(plan)", () => {
    const item = baseItem({
      hasPosition: false,
      exitDecision: "review",
      investVerdict: "wait",
      precatKind: "enter",
      recoveryProbabilityPct: 46,
    });
    expect(classifyBuyReasonKind(item, false)).toBe("top2_wait_precat");
    expect(explainBuyReason(item, false, "it")).toBe("Top2 wait + precat enter + P(plan) 46%");
  });

  it("returns null when action is not buy", () => {
    const item = baseItem({
      hasPosition: false,
      exitDecision: "exit",
      investVerdict: "wait",
      precatKind: "enter",
      recoveryProbabilityPct: 38,
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
});
