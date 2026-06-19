import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPatternFromConditions,
  buildPatternFromTopBuckets,
  defaultEmpiricalPatternScore,
  evaluatePatternStats,
  matchPattern,
  searchBestPatternEmpirical,
  splitInVsOutOfSample,
} from "./lossRiskPattern";
import { extractAllRowFeatures, runUnivariateScreening } from "./lossRiskScreening";
import { __resetSnapshotStoreForTests } from "../calibration/featureSnapshotStore";
import { __resetPatternStoreForTests } from "./patternProposalStore";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { RiskPattern } from "./riskPatternTypes";

function row(args: {
  ticker: string;
  pnlPct: number | null;
  pplanPct?: number | null;
  daysToCd?: number;
  entrySlope20d?: number | null;
  exitTs?: string | null;
}): SimOutcomeRow {
  return {
    row_key: `${args.ticker}|cd`,
    ticker: args.ticker,
    completion_date: "2026-06-01",
    days_to_cd: args.daysToCd ?? 30,
    cd_passed: false,
    timing_bucket: "pre_cd",
    timing_label: "Pre-CD",
    capital_eur: 1000,
    pnl_eur: args.pnlPct == null ? null : ((args.pnlPct ?? 0) / 100) * 1000,
    pnl_pct: args.pnlPct,
    outcome: args.pnlPct == null ? "open" : args.pnlPct > 0 ? "win" : "loss",
    outcome_label: args.pnlPct == null ? "Open" : args.pnlPct > 0 ? "Win" : "Loss",
    is_win: args.pnlPct != null && args.pnlPct > 0,
    affidabilita_pct: args.pplanPct ?? 60,
    entry_affidabilita_pct: args.pplanPct ?? 60,
    entry_slope_20d: args.entrySlope20d ?? null,
    exit_ts: args.exitTs ?? null,
  } as SimOutcomeRow;
}

beforeEach(() => {
  __resetSnapshotStoreForTests();
  __resetPatternStoreForTests();
});

describe("matchPattern", () => {
  it("does NOT fire on empty conditions", () => {
    const pattern: RiskPattern = {
      id: "p1",
      createdAt: "2026-01-01T00:00:00.000Z",
      conditions: [],
      name: "empty",
      inSampleStats: {} as RiskPattern["inSampleStats"],
    };
    const features = {
      rowKey: "X",
      sdsBucket: "SDS 40-55 (Mid)",
      clinicalPhase: null,
      clinicalIndication: null,
      pplanBucket: "P(plan) 50-70%",
      daysToCdBucket: null,
      precdSlopeSign: null,
    };
    expect(matchPattern(pattern, features)).toBe(false);
  });

  it("fires when all conditions match (AND semantics)", () => {
    const pattern: RiskPattern = {
      id: "p1",
      createdAt: "2026-01-01T00:00:00.000Z",
      conditions: [
        { dimension: "pplanBucket", operator: "in", values: ["P(plan) <30%"] },
        { dimension: "sdsBucket", operator: "in", values: ["SDS <40 (Low)"] },
      ],
      name: "test",
      inSampleStats: {} as RiskPattern["inSampleStats"],
    };
    const matching = {
      rowKey: "X",
      sdsBucket: "SDS <40 (Low)",
      clinicalPhase: null,
      clinicalIndication: null,
      pplanBucket: "P(plan) <30%",
      daysToCdBucket: null,
      precdSlopeSign: null,
    };
    expect(matchPattern(pattern, matching)).toBe(true);

    const notMatching = { ...matching, sdsBucket: "SDS 40-55 (Mid)" };
    expect(matchPattern(pattern, notMatching)).toBe(false);
  });

  it("does NOT fire when a conditioned feature is missing", () => {
    const pattern: RiskPattern = {
      id: "p1",
      createdAt: "2026-01-01T00:00:00.000Z",
      conditions: [
        { dimension: "precdSlopeSign", operator: "in", values: ["Slope down"] },
      ],
      name: "slope",
      inSampleStats: {} as RiskPattern["inSampleStats"],
    };
    const features = {
      rowKey: "X",
      sdsBucket: null,
      clinicalPhase: null,
      clinicalIndication: null,
      pplanBucket: null,
      daysToCdBucket: null,
      precdSlopeSign: null, // missing
    };
    expect(matchPattern(pattern, features)).toBe(false);
  });
});

describe("evaluatePatternStats", () => {
  it("computes precision/recall correctly on a clean separation", () => {
    // 5 losses all with P(plan) <30%, 5 wins all with P(plan) 50-70%
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 5; i++) trades.push(row({ ticker: `L${i}`, pnlPct: -10, pplanPct: 20 }));
    for (let i = 0; i < 5; i++) trades.push(row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 60 }));

    const features = extractAllRowFeatures(trades);
    const pattern = buildPatternFromConditions(
      [{ dimension: "pplanBucket", operator: "in", values: ["P(plan) <30%"] }],
      trades,
      features,
    );

    const stats = evaluatePatternStats(pattern, trades, features);
    expect(stats.n).toBe(10);
    expect(stats.firedN).toBe(5);
    expect(stats.firedLosses).toBe(5);
    expect(stats.precision).toBe(1.0); // P(loss|fires) = 5/5
    expect(stats.recall).toBe(1.0); // P(fires|loss) = 5/5
    expect(stats.baseLossRate).toBe(0.5);
    expect(stats.lift).toBe(2.0); // precision / baseLossRate
    expect(stats.fBeta).toBeGreaterThan(0.9);
  });

  it("counts firedLosses=0 when pattern is protective (no losses match)", () => {
    // 10 wins in P(plan) 50-70%, 2 losses in P(plan) <30%
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 10; i++) trades.push(row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 60 }));
    for (let i = 0; i < 2; i++) trades.push(row({ ticker: `L${i}`, pnlPct: -10, pplanPct: 20 }));

    const features = extractAllRowFeatures(trades);
    // Pattern that flags 50-70% — protective bucket → should have low precision
    const pattern = buildPatternFromConditions(
      [{ dimension: "pplanBucket", operator: "in", values: ["P(plan) 50-70%"] }],
      trades,
      features,
    );

    const stats = evaluatePatternStats(pattern, trades, features);
    expect(stats.firedN).toBe(10);
    expect(stats.firedLosses).toBe(0);
    expect(stats.precision).toBe(0);
    expect(stats.lift).toBe(0);
  });
});

describe("buildPatternFromTopBuckets", () => {
  it("returns null when no eligible feature has a loss-leaning bucket", () => {
    // All wins, prior is 0 — every bucket has loss rate 0 = base rate → skipped
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 10; i++) trades.push(row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 60 }));
    const phaseA = runUnivariateScreening(trades);
    const features = extractAllRowFeatures(trades);
    const pattern = buildPatternFromTopBuckets(phaseA, 3, trades, features);
    expect(pattern).toBeNull();
  });

  it("builds a pattern from the most loss-leaning bucket of top-K features", () => {
    // Build a cohort where P(plan) <30% and clinical Phase Preclinical are
    // both heavily loss-associated.
    const trades: SimOutcomeRow[] = [];
    // 8 trades P(plan) <30%, 6 of which lose
    for (let i = 0; i < 6; i++) trades.push(row({ ticker: `LO${i}`, pnlPct: -8, pplanPct: 20 }));
    for (let i = 0; i < 2; i++) trades.push(row({ ticker: `LOW${i}`, pnlPct: 8, pplanPct: 20 }));
    // 9 trades P(plan) 50-70%, 8 win
    for (let i = 0; i < 8; i++) trades.push(row({ ticker: `MID${i}`, pnlPct: 10, pplanPct: 60 }));
    trades.push(row({ ticker: "MIDL", pnlPct: -5, pplanPct: 60 }));

    const phaseA = runUnivariateScreening(trades);
    const features = extractAllRowFeatures(trades);
    const pattern = buildPatternFromTopBuckets(phaseA, 1, trades, features);
    expect(pattern).not.toBeNull();
    expect(pattern!.conditions.length).toBe(1);
    expect(pattern!.conditions[0].dimension).toBe("pplanBucket");
    expect(pattern!.conditions[0].values).toContain("P(plan) <30%");
    // In-sample stats should be populated
    expect(pattern!.inSampleStats.firedN).toBe(8);
    expect(pattern!.inSampleStats.firedLosses).toBe(6);
  });
});

describe("searchBestPatternEmpirical", () => {
  it("returns null when no eligible risky bucket exists", () => {
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 10; i++) trades.push(row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 60 }));
    const phaseA = runUnivariateScreening(trades);
    const features = extractAllRowFeatures(trades);
    const result = searchBestPatternEmpirical(phaseA, trades, features, { minFiredN: 3 });
    expect(result).toBeNull();
  });

  it("picks the AND-combination that empirically best predicts loss", () => {
    // Cohort: a clean separation lives in the AND of
    //   (P(plan) <30%) AND (Slope down).
    // Univariate, P(plan) <30% alone has 6 losses out of 10 (60%, lift~1.5),
    // and Slope down alone has 6 losses out of 10 (60%, lift~1.5). Their
    // AND has 5 losses out of 5 (100%) — that's what an empirical search
    // should find, NOT the trivial AND-of-each-feature-worst-bucket.
    const trades: SimOutcomeRow[] = [];
    // Group A: P(plan) <30% AND Slope down → 5 trades, all losses
    for (let i = 0; i < 5; i++) {
      trades.push(row({ ticker: `A${i}`, pnlPct: -10, pplanPct: 20, entrySlope20d: -0.6 }));
    }
    // Group B: P(plan) <30% AND Slope up → 5 trades, only 1 loss
    for (let i = 0; i < 4; i++) {
      trades.push(row({ ticker: `B${i}`, pnlPct: 10, pplanPct: 20, entrySlope20d: 0.6 }));
    }
    trades.push(row({ ticker: "B5", pnlPct: -8, pplanPct: 20, entrySlope20d: 0.6 }));
    // Group C: P(plan) 50-70% AND Slope down → 5 trades, only 1 loss
    for (let i = 0; i < 4; i++) {
      trades.push(row({ ticker: `C${i}`, pnlPct: 10, pplanPct: 60, entrySlope20d: -0.6 }));
    }
    trades.push(row({ ticker: "C5", pnlPct: -8, pplanPct: 60, entrySlope20d: -0.6 }));
    // Group D: P(plan) 50-70% AND Slope up → 5 trades, 0 losses
    for (let i = 0; i < 5; i++) {
      trades.push(row({ ticker: `D${i}`, pnlPct: 10, pplanPct: 60, entrySlope20d: 0.6 }));
    }

    const phaseA = runUnivariateScreening(trades);
    const features = extractAllRowFeatures(trades);
    const result = searchBestPatternEmpirical(phaseA, trades, features, {
      maxConditions: 3,
      minFiredN: 5,
      minLift: 1.0,
    });
    expect(result).not.toBeNull();
    const dims = result!.pattern.conditions.map((c) => c.dimension).sort();
    expect(dims).toEqual(["pplanBucket", "precdSlopeSign"]);
    // The chosen buckets should be the risky pair
    const pplan = result!.pattern.conditions.find((c) => c.dimension === "pplanBucket")!;
    const slope = result!.pattern.conditions.find((c) => c.dimension === "precdSlopeSign")!;
    expect(pplan.values).toContain("P(plan) <30%");
    expect(slope.values).toContain("Slope down");
    // The winning stats: 5/5 losses fired, precision 1.0
    expect(result!.stats.firedN).toBe(5);
    expect(result!.stats.firedLosses).toBe(5);
    expect(result!.stats.precision).toBe(1.0);
    // And it should beat the 1-condition options
    const oneCondPplan = buildPatternFromConditions(
      [{ dimension: "pplanBucket", operator: "in", values: ["P(plan) <30%"] }],
      trades,
      features,
    );
    expect(result!.stats.precision).toBeGreaterThan(oneCondPplan.inSampleStats.precision);
  });

  it("falls back to the best single-condition pattern when 2D doesn't help", () => {
    // Only P(plan) <30% drives loss; slope and SDS are noise.
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 7; i++) {
      trades.push(row({ ticker: `L${i}`, pnlPct: -10, pplanPct: 20 }));
    }
    for (let i = 0; i < 10; i++) {
      trades.push(row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 60 }));
    }

    const phaseA = runUnivariateScreening(trades);
    const features = extractAllRowFeatures(trades);
    const result = searchBestPatternEmpirical(phaseA, trades, features, {
      maxConditions: 3,
      minFiredN: 5,
      minLift: 1.0,
    });
    expect(result).not.toBeNull();
    expect(result!.pattern.conditions.length).toBe(1);
    expect(result!.pattern.conditions[0].dimension).toBe("pplanBucket");
    expect(result!.stats.precision).toBe(1.0);
  });

  it("respects the minFiredN floor (anti-overfit)", () => {
    // A tiny 2-trade bucket with 100% loss should NOT be picked over a
    // larger, slightly less precise one.
    const trades: SimOutcomeRow[] = [];
    // 2 losses in a tiny tail bucket
    for (let i = 0; i < 2; i++) {
      trades.push(row({ ticker: `T${i}`, pnlPct: -15, pplanPct: 20, entrySlope20d: -0.6 }));
    }
    // 6 trades, 4 losses in the bigger P(plan) <30% pool
    for (let i = 0; i < 4; i++) {
      trades.push(row({ ticker: `BL${i}`, pnlPct: -10, pplanPct: 20, entrySlope20d: 0.6 }));
    }
    for (let i = 0; i < 2; i++) {
      trades.push(row({ ticker: `BW${i}`, pnlPct: 10, pplanPct: 20, entrySlope20d: 0.6 }));
    }
    // 8 wins elsewhere
    for (let i = 0; i < 8; i++) {
      trades.push(row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 60 }));
    }
    const phaseA = runUnivariateScreening(trades);
    const features = extractAllRowFeatures(trades);
    const result = searchBestPatternEmpirical(phaseA, trades, features, {
      maxConditions: 2,
      minFiredN: 5, // 2-trade combo must be excluded
      minLift: 1.0,
    });
    expect(result).not.toBeNull();
    expect(result!.stats.firedN).toBeGreaterThanOrEqual(5);
  });
});

describe("defaultEmpiricalPatternScore", () => {
  it("scales with precision, fires count and lift", () => {
    const s = (precision: number, firedN: number, lift: number) =>
      defaultEmpiricalPatternScore({
        n: 100,
        firedN,
        firedLosses: Math.round(firedN * precision),
        notFiredN: 100 - firedN,
        notFiredLosses: 0,
        precision,
        recall: 0,
        fBeta: 0,
        lift,
        baseLossRate: 0.3,
        confidence: "medium",
        computedAt: new Date(0).toISOString(),
      });
    // Higher precision wins at equal n and lift
    expect(s(0.9, 10, 2)).toBeGreaterThan(s(0.6, 10, 2));
    // More fires win at equal precision and lift (log dampens)
    expect(s(0.8, 20, 2)).toBeGreaterThan(s(0.8, 10, 2));
    // Lift cap kicks in past 3
    expect(s(0.8, 10, 3)).toBeCloseTo(s(0.8, 10, 10));
    // Zero fires → zero score
    expect(s(0.8, 0, 2)).toBe(0);
  });
});

describe("splitInVsOutOfSample", () => {
  it("returns all as in-sample when approvedAt is missing", () => {
    const trades = [row({ ticker: "T1", pnlPct: 5, exitTs: "2026-06-15T12:00:00.000Z" })];
    const { inSample, outOfSample } = splitInVsOutOfSample(trades, undefined);
    expect(inSample.length).toBe(1);
    expect(outOfSample.length).toBe(0);
  });

  it("splits by exit_ts vs approvedAt cutoff", () => {
    const trades = [
      row({ ticker: "T1", pnlPct: 5, exitTs: "2026-06-10T12:00:00.000Z" }), // before
      row({ ticker: "T2", pnlPct: 5, exitTs: "2026-06-15T12:00:00.000Z" }), // after
      row({ ticker: "T3", pnlPct: 5, exitTs: null }), // unknown → in-sample
    ];
    const { inSample, outOfSample } = splitInVsOutOfSample(
      trades,
      "2026-06-12T00:00:00.000Z",
    );
    expect(inSample.map((r) => r.ticker)).toEqual(["T1", "T3"]);
    expect(outOfSample.map((r) => r.ticker)).toEqual(["T2"]);
  });
});
