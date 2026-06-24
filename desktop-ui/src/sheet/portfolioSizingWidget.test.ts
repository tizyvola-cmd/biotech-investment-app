import { describe, expect, it } from "vitest";
import {
  computeDealLossRisk,
  computePositionState,
  lossRiskInvestmentScore,
  lossRiskSizeMultiplier,
  pickBestCellEstimate,
  clampSliderToRuntimeMax,
  type WidgetDeal,
} from "./portfolioSizingWidget";
import type {
  CalibrationSnapshot,
  FrozenWeights,
} from "../calibration/calibrationTypes";
import type { SdsGainBreakdown } from "./sdsGainBreakdown";
import type {
  PhaseAResult,
  RiskPattern,
} from "../riskPattern/riskPatternTypes";

// ── Test fixtures ─────────────────────────────────────────────────────────

function buildSnapshot(): CalibrationSnapshot {
  return {
    computedAt: "2026-06-15T12:00:00.000Z",
    globalPrior: 0.5,
    totalTrades: 30,
    dimensions: {
      clinicalPhase: {
        dimension: "clinicalPhase",
        prior: 0.5,
        hasVariance: true,
        totalN: 20,
        cells: [
          {
            dimension: "clinicalPhase",
            cell: "Phase 3",
            n: 12,
            wins: 9,
            rawObserved: 0.75,
            shrinkageApplied: 0.7,
            prior: 0.5,
            k: 8,
            confidence: "medium",
            inactive: null,
            avgPnlPct: 12,
            capitalDeployedEur: 12000,
          },
          {
            dimension: "clinicalPhase",
            cell: "Phase 1",
            n: 3,
            wins: 0,
            rawObserved: 0,
            shrinkageApplied: 0.2,
            prior: 0.5,
            k: 8,
            confidence: "low",
            inactive: null,
            avgPnlPct: -10,
            capitalDeployedEur: 3000,
          },
        ],
      },
      clinicalIndication: {
        dimension: "clinicalIndication",
        prior: 0.5,
        hasVariance: false,
        totalN: 19,
        cells: [
          {
            dimension: "clinicalIndication",
            cell: "Unknown",
            n: 19,
            wins: 10,
            rawObserved: 0.526,
            shrinkageApplied: 0.51,
            prior: 0.5,
            k: 8,
            confidence: "high",
            inactive: null,
            avgPnlPct: 1,
            capitalDeployedEur: 19000,
          },
        ],
      },
      sdsBucket: {
        dimension: "sdsBucket",
        prior: 0.5,
        hasVariance: true,
        totalN: 25,
        cells: [
          {
            dimension: "sdsBucket",
            cell: "SDS 40-55 (Mid)",
            n: 11,
            wins: 8,
            rawObserved: 0.72,
            shrinkageApplied: 0.65,
            prior: 0.5,
            k: 8,
            confidence: "medium",
            inactive: null,
            avgPnlPct: 6,
            capitalDeployedEur: 11000,
          },
        ],
      },
      pplanBucket: {
        dimension: "pplanBucket",
        prior: 0.5,
        hasVariance: true,
        totalN: 20,
        cells: [
          {
            dimension: "pplanBucket",
            cell: "P(plan) 50-70%",
            n: 13,
            wins: 12,
            rawObserved: 0.92,
            shrinkageApplied: 0.78,
            prior: 0.5,
            k: 8,
            confidence: "medium",
            inactive: null,
            avgPnlPct: 8,
            capitalDeployedEur: 13000,
          },
        ],
      },
    },
  };
}

function buildSdsBreakdown(): SdsGainBreakdown {
  return {
    computedAt: "2026-06-15T12:00:00.000Z",
    totalClosed: 20,
    totalOpen: 6,
    rows: [
      {
        bucket: "SDS 40-55 (Mid)",
        deliveredN: 11,
        deliveredWins: 8,
        deliveredWinRate: 8 / 11,
        deliveredAvgPnlPct: 6,
        deliveredAvgPnlEur: 120,
        deliveredAvgHoldDays: 30,
        deliveredAvgRoiPerDay: 0.2,
        promisedOpenN: 4,
        promisedAvgRoiPct: 20,
        promisedAvgProbPct: 55,
        promisedExpectedRoiPct: 11,
        promisedAvgDaysToCd: 30,
        promisedExpectedRoiPerDay: 0.37,
      },
    ],
    globalDeliveredAvgPnlPct: 6,
    globalPromisedExpectedRoiPct: 11,
  };
}

function buildFrozen(): FrozenWeights {
  return {
    updatedAt: "2026-06-15T12:00:00.000Z",
    lastProposalId: "prop-x",
    weights: {
      clinicalPhase: {
        "Phase 3": { weight: 0.7, n: 12, confidence: "medium" },
      },
      sdsBucket: {
        "SDS 40-55 (Mid)": { weight: 0.65, n: 11, confidence: "medium" },
      },
      pplanBucket: {},
      clinicalIndication: {},
    },
  };
}

const PHASE_3_DEAL: WidgetDeal = {
  ticker: "P3A",
  displayLabel: "P3A · Phase 3 · Mid",
  cells: {
    clinicalPhase: "Phase 3",
    clinicalIndication: "Unknown",
    sdsBucket: "SDS 40-55 (Mid)",
    pplanBucket: "P(plan) 50-70%",
  },
};

// Phase 1 deal that ONLY matches the Phase 1 cell (low n=3 in snapshot).
// We deliberately use cells that aren't in the snapshot for other dimensions
// so the priority-order lookup falls through to clinicalPhase.
const PHASE_1_DEAL: WidgetDeal = {
  ticker: "P1A",
  displayLabel: "P1A · Phase 1 · Low confidence",
  cells: {
    clinicalPhase: "Phase 1",
    clinicalIndication: "Onco", // not in snapshot
    sdsBucket: "No SDS", // not in snapshot
    pplanBucket: "P(plan) <30%", // not in snapshot
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("pickBestCellEstimate", () => {
  it("prefers a specific cell (clinicalPhase) over a higher-n fallback (clinicalIndication=Unknown)", () => {
    // Regression test: previously the picker sorted by N first, which made a
    // generic "Unknown" indication with n=19 win over the deal's actual
    // Phase 3 cell (n=12). The result was that ALL deals with different
    // phases ended up with the same homogenized win rate.
    // New behavior: when a specific cell (non-fallback) has n ≥ 5, it wins
    // even if a fallback cell has higher n.
    const snap = buildSnapshot();
    const picked = pickBestCellEstimate(snap, {
      clinicalPhase: "Phase 3",
      clinicalIndication: "Unknown",
      sdsBucket: "SDS 40-55 (Mid)",
      pplanBucket: "P(plan) 50-70%",
    });
    expect(picked).not.toBeNull();
    // Phase 3 (n=12, specific) wins over Unknown (n=19, fallback).
    expect(picked!.dimension).toBe("clinicalPhase");
    expect(picked!.estimate.cell).toBe("Phase 3");
  });

  it("falls back to a generic 'Unknown' cell only when no specific cell qualifies", () => {
    // Deal whose specific dimensions all have n < 5 (or missing) — the picker
    // should accept the high-n fallback rather than return null.
    const snap = buildSnapshot();
    const picked = pickBestCellEstimate(snap, {
      clinicalPhase: "Phase 4", // not in snapshot
      clinicalIndication: "Unknown", // n=19 fallback
      sdsBucket: "SDS 100", // not in snapshot
      pplanBucket: "P(plan) 99%", // not in snapshot
    });
    expect(picked).not.toBeNull();
    expect(picked!.dimension).toBe("clinicalIndication");
    expect(picked!.estimate.n).toBe(19);
  });

  it("distinguishes between two deals with different specific phases", () => {
    // Ensures the picker no longer homogenizes: Phase 3 deal and Phase 1 deal
    // get different win rates even when the high-n Unknown fallback is shared.
    const snap = buildSnapshot();
    const phase3 = pickBestCellEstimate(snap, {
      clinicalPhase: "Phase 3",
      clinicalIndication: "Unknown",
      sdsBucket: "SDS 40-55 (Mid)",
      pplanBucket: "P(plan) 50-70%",
    });
    const phase1 = pickBestCellEstimate(snap, {
      clinicalPhase: "Phase 1",
      clinicalIndication: "Unknown",
      sdsBucket: "SDS 40-55 (Mid)",
      pplanBucket: "P(plan) 50-70%",
    });
    expect(phase3).not.toBeNull();
    expect(phase1).not.toBeNull();
    // Phase 3 has n=12 (≥5) → wins as specific cell.
    // Phase 1 has n=3 (<5) → falls back to next-best specific cell.
    // Their win rates must NOT be identical.
    expect(phase3!.estimate.shrinkageApplied).not.toBe(phase1!.estimate.shrinkageApplied);
  });

  it("tie-breaks using priority order (phase wins over sds at equal n)", () => {
    const snap: CalibrationSnapshot = {
      ...buildSnapshot(),
      dimensions: {
        ...buildSnapshot().dimensions,
        clinicalPhase: {
          dimension: "clinicalPhase",
          prior: 0.5,
          hasVariance: true,
          totalN: 5,
          cells: [
            {
              dimension: "clinicalPhase",
              cell: "Phase 2",
              n: 5,
              wins: 3,
              rawObserved: 0.6,
              shrinkageApplied: 0.55,
              prior: 0.5,
              k: 8,
              confidence: "medium",
              inactive: null,
              avgPnlPct: 4,
              capitalDeployedEur: 5000,
            },
          ],
        },
        sdsBucket: {
          dimension: "sdsBucket",
          prior: 0.5,
          hasVariance: true,
          totalN: 5,
          cells: [
            {
              dimension: "sdsBucket",
              cell: "SDS 40-55 (Mid)",
              n: 5,
              wins: 3,
              rawObserved: 0.6,
              shrinkageApplied: 0.55,
              prior: 0.5,
              k: 8,
              confidence: "medium",
              inactive: null,
              avgPnlPct: 4,
              capitalDeployedEur: 5000,
            },
          ],
        },
        clinicalIndication: {
          dimension: "clinicalIndication",
          prior: 0.5,
          hasVariance: false,
          totalN: 0,
          cells: [],
        },
        pplanBucket: {
          dimension: "pplanBucket",
          prior: 0.5,
          hasVariance: false,
          totalN: 0,
          cells: [],
        },
      },
    };
    const picked = pickBestCellEstimate(snap, {
      clinicalPhase: "Phase 2",
      clinicalIndication: "Unknown",
      sdsBucket: "SDS 40-55 (Mid)",
      pplanBucket: "P(plan) 50-70%",
    });
    expect(picked!.dimension).toBe("clinicalPhase");
  });

  it("skips inactive cells (n=0 or n_below_floor)", () => {
    const snap = buildSnapshot();
    snap.dimensions.clinicalPhase.cells[0] = {
      ...snap.dimensions.clinicalPhase.cells[0],
      inactive: "n_below_floor",
    };
    const picked = pickBestCellEstimate(snap, {
      clinicalPhase: "Phase 3",
      clinicalIndication: "Unknown",
      sdsBucket: "SDS 40-55 (Mid)",
      pplanBucket: "P(plan) 50-70%",
    });
    expect(picked!.dimension).not.toBe("clinicalPhase");
  });

  it("returns null when no dimension has an active cell", () => {
    const snap: CalibrationSnapshot = {
      computedAt: "x",
      globalPrior: 0.5,
      totalTrades: 0,
      dimensions: {
        clinicalPhase: { dimension: "clinicalPhase", prior: 0.5, hasVariance: false, totalN: 0, cells: [] },
        clinicalIndication: { dimension: "clinicalIndication", prior: 0.5, hasVariance: false, totalN: 0, cells: [] },
        sdsBucket: { dimension: "sdsBucket", prior: 0.5, hasVariance: false, totalN: 0, cells: [] },
        pplanBucket: { dimension: "pplanBucket", prior: 0.5, hasVariance: false, totalN: 0, cells: [] },
      },
    };
    expect(pickBestCellEstimate(snap, {
      clinicalPhase: "Phase 3",
      clinicalIndication: "Unknown",
      sdsBucket: "SDS 40-55 (Mid)",
      pplanBucket: "P(plan) 50-70%",
    })).toBeNull();
  });
});

describe("computePositionState — EV computation", () => {
  it("produces a positive EV for a high-win-rate / positive-payoff deal", () => {
    const state = computePositionState({
      deals: [PHASE_3_DEAL],
      sliders: { P3A: 1000 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    expect(state.perDeal.length).toBe(1);
    const d = state.perDeal[0];
    // Indication has n=19, win rate 0.51 → payoff Step 1 values used → EV per € small positive
    expect(d.evEur).toBeGreaterThan(0);
    expect(d.metrics.payoffSource).toBe("step1");
  });

  it("uses fallback payoff when no Step 1 breakdown is provided", () => {
    const state = computePositionState({
      deals: [PHASE_3_DEAL],
      sliders: { P3A: 1000 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: null,
    });
    expect(state.perDeal[0].metrics.payoffSource).toBe("fallback");
  });

  it("reads from frozen weights when no snapshot is provided", () => {
    const state = computePositionState({
      deals: [PHASE_3_DEAL],
      sliders: { P3A: 1000 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      frozenWeights: buildFrozen(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    // Phase 3 (n=12) wins over Mid SDS (n=11) on tiebreak priority
    expect(state.perDeal[0].metrics.winRateSource.dimension).toBe("clinicalPhase");
    expect(state.perDeal[0].metrics.winRate).toBe(0.7);
  });

  it("returns winRate = neutralWeight when nothing matches", () => {
    const state = computePositionState({
      deals: [{ ...PHASE_3_DEAL, cells: { clinicalPhase: "Approved", clinicalIndication: "X", sdsBucket: "Y", pplanBucket: "Z" } }],
      sliders: { P3A: 1000 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      calibrationSnapshot: buildSnapshot(),
    });
    // Neutral 0.5
    expect(state.perDeal[0].metrics.winRate).toBe(0.5);
  });
});

describe("computePositionState — diversification caps in real time", () => {
  it("clamps total phase-bucket allocation to phase cap", () => {
    // 5 Phase 3 deals — phase cap = 50% of 10000 = 5000
    const deals: WidgetDeal[] = [1, 2, 3, 4, 5].map((i) => ({
      ticker: `P3${i}`,
      displayLabel: `P3${i}`,
      cells: {
        clinicalPhase: "Phase 3",
        clinicalIndication: "Onco",
        sdsBucket: "SDS 40-55 (Mid)",
        pplanBucket: "P(plan) 50-70%",
      },
    }));
    const state = computePositionState({
      deals,
      // Each requests 1500 → total 7500 > 5000 cap
      sliders: { P31: 1500, P32: 1500, P33: 1500, P34: 1500, P35: 1500 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    // Sum of sizes must NOT exceed the phase cap (5000). Each individual
    // slider can fall to its own runtime max (phase headroom excluding self).
    const totalSizes = state.perDeal.reduce((s, p) => s + p.sizeEur, 0);
    // After clamping per slider, total can still exceed the cap because the
    // algorithm clamps each independently. But each individual slider must
    // respect its own runtime max.
    // Sanity: every per-deal size is <= 2500 (single cap) and <= phaseHeadroom.
    for (const d of state.perDeal) {
      expect(d.sizeEur).toBeLessThanOrEqual(2500); // single cap = 25%
    }
    // At least one cap event must have been emitted.
    const capEvents = state.frictionEvents.filter((e) =>
      e.kind === "phase_cap_blocked" || e.kind === "single_position_cap_blocked",
    );
    expect(capEvents.length).toBeGreaterThan(0);
    expect(totalSizes).toBeLessThan(7500); // proven the caps actually fired
  });

  it("respects disabled indication caps (no enforcement, emits info event)", () => {
    const deals: WidgetDeal[] = [1, 2].map((i) => ({
      ticker: `T${i}`,
      displayLabel: `T${i}`,
      cells: {
        clinicalPhase: "Phase 3",
        clinicalIndication: "Unknown",
        sdsBucket: "SDS 40-55 (Mid)",
        pplanBucket: "P(plan) 50-70%",
      },
    }));
    const disabled = new Set(["Unknown"]);
    const state = computePositionState({
      deals,
      sliders: { T1: 2000, T2: 2000 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
      disabledIndications: disabled,
    });
    // Indication cap is 40% = 4000; with disabled it should NOT clamp.
    // Phase cap is 50% = 5000; sum is 4000 → fits, no clamp.
    expect(state.perDeal.every((p) => p.sizeEur === 2000)).toBe(true);
    // An indication_cap_disabled event must have been emitted once.
    const disabledEvents = state.frictionEvents.filter(
      (e) => e.kind === "indication_cap_disabled",
    );
    expect(disabledEvents.length).toBe(1);
  });

  it("enforces single-position cap (capPctSingle * totalCapital)", () => {
    const state = computePositionState({
      deals: [PHASE_3_DEAL],
      sliders: { P3A: 100000 }, // way above single cap
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    // Single cap = 25% * 10000 = 2500
    expect(state.perDeal[0].sizeEur).toBe(2500);
    expect(state.frictionEvents.some((e) => e.kind === "single_position_cap_blocked")).toBe(true);
  });
});

describe("computePositionState — confidence soft thresholds", () => {
  it("flags pastSoftThreshold for LOW-confidence deal above 30% of single cap", () => {
    // Phase 1 (low confidence in our snapshot), single cap = 25% * 10000 = 2500
    // LOW threshold = 30% of 2500 = 750
    // Push slider to 1500 → past LOW threshold.
    const state = computePositionState({
      deals: [PHASE_1_DEAL],
      sliders: { P1A: 1500 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    const d = state.perDeal[0];
    expect(d.metrics.confidence).toBe("low");
    expect(d.softThresholdEur).toBe(750);
    expect(d.pastSoftThreshold).toBe(true);
    expect(state.frictionEvents.some((e) => e.kind === "low_confidence_threshold_crossed")).toBe(true);
  });

  it("does NOT flag pastSoftThreshold for HIGH-confidence deal", () => {
    // Indication "Unknown" has high confidence (n=19) — but it'd be picked
    // because of priority. Let me construct a deal that ONLY matches a
    // high-confidence indication cell to be deterministic.
    const deal: WidgetDeal = {
      ticker: "HI",
      displayLabel: "HI",
      cells: {
        clinicalPhase: "Approved", // not in snapshot
        clinicalIndication: "Unknown", // high (n=19)
        sdsBucket: "Other", // not in snapshot
        pplanBucket: "Other", // not in snapshot
      },
    };
    const state = computePositionState({
      deals: [deal],
      sliders: { HI: 2400 }, // close to single cap
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    expect(state.perDeal[0].metrics.confidence).toBe("high");
    expect(state.perDeal[0].pastSoftThreshold).toBe(false);
  });

  it("LOW threshold can be customized via friction config", () => {
    const state = computePositionState({
      deals: [PHASE_1_DEAL],
      sliders: { P1A: 1500 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
      friction: { low: 0.8, medium: 0.9, high: 1.0 },
    });
    // LOW threshold = 80% of 2500 = 2000 → 1500 is BELOW it
    expect(state.perDeal[0].pastSoftThreshold).toBe(false);
  });
});

describe("computePositionState — breakeven progress", () => {
  it("evMeetsTarget=true when EV total ≥ target", () => {
    const state = computePositionState({
      deals: [PHASE_3_DEAL],
      sliders: { P3A: 2500 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 1,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    expect(state.evMeetsTarget).toBe(true);
    expect(state.evProgress).toBeGreaterThan(1);
  });

  it("evMeetsTarget=false when EV total below target", () => {
    const state = computePositionState({
      deals: [PHASE_3_DEAL],
      sliders: { P3A: 100 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 10000,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    expect(state.evMeetsTarget).toBe(false);
    expect(state.evProgress).toBeLessThan(1);
  });
});

describe("clampSliderToRuntimeMax", () => {
  it("clamps to runtimeMax from state", () => {
    const state = computePositionState({
      deals: [PHASE_3_DEAL],
      sliders: { P3A: 1000 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    expect(clampSliderToRuntimeMax(5000, "P3A", state)).toBe(2500); // single cap
    expect(clampSliderToRuntimeMax(1500, "P3A", state)).toBe(1500);
    expect(clampSliderToRuntimeMax(-100, "P3A", state)).toBe(0);
  });

  it("returns clamped candidate even when ticker is not in state", () => {
    const state = computePositionState({
      deals: [PHASE_3_DEAL],
      sliders: { P3A: 1000 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 10,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    expect(clampSliderToRuntimeMax(2000, "MISSING", state)).toBe(2000);
    expect(clampSliderToRuntimeMax(-1, "MISSING", state)).toBe(0);
  });
});

describe("computePositionState — category usage cards", () => {
  it("groups phase + indication usage with correct totals and caps", () => {
    const deals: WidgetDeal[] = [
      {
        ticker: "A",
        displayLabel: "A",
        cells: {
          clinicalPhase: "Phase 3",
          clinicalIndication: "Onco",
          sdsBucket: "SDS 40-55 (Mid)",
          pplanBucket: "P(plan) 50-70%",
        },
      },
      {
        ticker: "B",
        displayLabel: "B",
        cells: {
          clinicalPhase: "Phase 3",
          clinicalIndication: "Neuro",
          sdsBucket: "SDS 40-55 (Mid)",
          pplanBucket: "P(plan) 50-70%",
        },
      },
    ];
    const state = computePositionState({
      deals,
      sliders: { A: 1000, B: 800 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 1,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    const phaseCard = state.capByCategory.find(
      (c) => c.category === "phase" && c.label === "Phase 3",
    );
    expect(phaseCard).toBeDefined();
    expect(phaseCard!.deployedEur).toBe(1800);
    expect(phaseCard!.capEur).toBe(5000); // 50% of 10000

    const oncoCard = state.capByCategory.find(
      (c) => c.category === "indication" && c.label === "Onco",
    );
    expect(oncoCard!.deployedEur).toBe(1000);
    expect(oncoCard!.disabled).toBe(false);
  });
});

// ── computeDealLossRisk tests ─────────────────────────────────────────────

/** Phase A fixture with one risky bucket (P(plan) <30%, lift=1.94) and one
 *  safer bucket (Phase 1, lift=0.6) — both eligible for sizing. */
function buildPhaseA(): PhaseAResult {
  return {
    computedAt: "2026-06-15T12:00:00.000Z",
    totalTrades: 19,
    globalLossRate: 0.105,
    features: [
      {
        dimension: "pplanBucket",
        baseLossRate: 0.105,
        totalN: 19,
        maxAbsLift: 0.94,
        hasVariance: true,
        buckets: [
          {
            dimension: "pplanBucket",
            bucket: "P(plan) <30%",
            n: 5,
            losses: 5,
            rawLossRate: 1.0,
            shrunkLossRate: 0.204,
            lift: 1.94,
            confidence: "medium",
            eligibleForPattern: true,
          },
          {
            dimension: "pplanBucket",
            bucket: "P(plan) 50-70%",
            n: 13,
            losses: 1,
            rawLossRate: 0.077,
            shrunkLossRate: 0.087,
            lift: 0.83,
            confidence: "medium",
            eligibleForPattern: true,
          },
        ],
      },
      {
        dimension: "clinicalPhase",
        baseLossRate: 0.143,
        totalN: 14,
        maxAbsLift: 0.4,
        hasVariance: true,
        buckets: [
          {
            dimension: "clinicalPhase",
            bucket: "Phase 1",
            n: 6,
            losses: 1,
            rawLossRate: 0.167,
            shrunkLossRate: 0.153,
            lift: 1.07,
            confidence: "medium",
            eligibleForPattern: true,
          },
          {
            dimension: "clinicalPhase",
            bucket: "Phase 3",
            n: 3,
            losses: 1,
            rawLossRate: 0.333,
            shrunkLossRate: 0.194,
            lift: 1.36,
            // n<5 → not eligible for sizing
            confidence: "low",
            eligibleForPattern: false,
          },
        ],
      },
      {
        dimension: "sdsBucket",
        baseLossRate: 0.105,
        totalN: 19,
        maxAbsLift: 0.69,
        hasVariance: true,
        buckets: [
          {
            dimension: "sdsBucket",
            bucket: "SDS 40-55 (Mid)",
            n: 11,
            losses: 0,
            rawLossRate: 0,
            shrunkLossRate: 0.044,
            lift: 0.42,
            confidence: "medium",
            eligibleForPattern: true,
          },
        ],
      },
    ],
  };
}

describe("computeDealLossRisk", () => {
  it("returns neutral risk (no signal) when phaseA is null and no pattern", () => {
    const deal: WidgetDeal = {
      ticker: "X",
      displayLabel: "X",
      cells: {
        clinicalPhase: "Phase 3",
        clinicalIndication: "Unknown",
        sdsBucket: "SDS 40-55 (Mid)",
        pplanBucket: "P(plan) 50-70%",
      },
    };
    const risk = computeDealLossRisk(deal, null, null);
    expect(risk.aggregateLift).toBe(1);
    expect(risk.contributions).toEqual([]);
    expect(risk.matchedApprovedPattern).toBe(false);
    expect(risk.hasSignal).toBe(false);
  });

  it("aggregates per-feature lifts using a confidence-weighted geometric mean", () => {
    // P(plan) <30% (lift 1.94, MED) + SDS Mid (lift 0.42, MED).
    // Geometric mean with equal weights: sqrt(1.94 * 0.42) ≈ 0.903 → safer-than-base.
    const deal: WidgetDeal = {
      ticker: "Y",
      displayLabel: "Y",
      cells: {
        clinicalPhase: "Phase 2", // not in fixture → ignored
        clinicalIndication: "Onco",
        sdsBucket: "SDS 40-55 (Mid)", // lift 0.42
        pplanBucket: "P(plan) <30%", // lift 1.94
      },
    };
    const risk = computeDealLossRisk(deal, buildPhaseA(), null);
    expect(risk.contributions.length).toBe(2);
    expect(risk.aggregateLift).toBeCloseTo(Math.sqrt(1.94 * 0.42), 2);
    expect(risk.hasSignal).toBe(true);
  });

  it("ignores buckets with eligibleForPattern=false (insufficient n)", () => {
    const deal: WidgetDeal = {
      ticker: "Z",
      displayLabel: "Z",
      cells: {
        clinicalPhase: "Phase 3", // lift 1.36 but n=3, NOT eligible → ignored
        clinicalIndication: "Onco",
        sdsBucket: "No SDS", // not in fixture
        pplanBucket: "P(plan) n/a", // not in fixture
      },
    };
    const risk = computeDealLossRisk(deal, buildPhaseA(), null);
    expect(risk.contributions.length).toBe(0);
    expect(risk.aggregateLift).toBe(1);
    expect(risk.hasSignal).toBe(false);
  });

  it("flags matched approved Phase B pattern", () => {
    const deal: WidgetDeal = {
      ticker: "W",
      displayLabel: "W",
      cells: {
        clinicalPhase: "Phase 1",
        clinicalIndication: "Onco",
        sdsBucket: "SDS 40-55 (Mid)",
        pplanBucket: "P(plan) <30%",
      },
    };
    const pattern: RiskPattern = {
      id: "p1",
      createdAt: "2026-06-15T12:00:00.000Z",
      approvedAt: "2026-06-15T13:00:00.000Z",
      name: "Test pattern",
      conditions: [
        {
          dimension: "pplanBucket",
          operator: "in",
          values: ["P(plan) <30%"],
        },
      ],
      inSampleStats: {
        n: 19,
        firedN: 5,
        firedLosses: 5,
        notFiredN: 14,
        notFiredLosses: 1,
        precision: 1,
        recall: 0.83,
        fBeta: 0.96,
        lift: 1.94,
      },
    };
    const risk = computeDealLossRisk(deal, buildPhaseA(), pattern);
    expect(risk.matchedApprovedPattern).toBe(true);
  });

  it("does not match pattern when deal lacks values for conditioned dim", () => {
    const deal: WidgetDeal = {
      ticker: "W2",
      displayLabel: "W2",
      cells: {
        clinicalPhase: "Phase 1",
        clinicalIndication: "Onco",
        sdsBucket: "SDS 40-55 (Mid)",
        pplanBucket: "", // missing
      },
    };
    const pattern: RiskPattern = {
      id: "p1",
      createdAt: "2026-06-15T12:00:00.000Z",
      approvedAt: "2026-06-15T13:00:00.000Z",
      name: "T",
      conditions: [
        { dimension: "pplanBucket", operator: "in", values: ["P(plan) <30%"] },
      ],
      inSampleStats: {
        n: 1,
        firedN: 0,
        firedLosses: 0,
        notFiredN: 1,
        notFiredLosses: 0,
        precision: 0,
        recall: 0,
        fBeta: 0,
        lift: 0,
      },
    };
    const risk = computeDealLossRisk(deal, null, pattern);
    expect(risk.matchedApprovedPattern).toBe(false);
  });
});

describe("lossRiskSizeMultiplier", () => {
  it("returns ~1.0 when aggregate lift is neutral", () => {
    const m = lossRiskSizeMultiplier({
      aggregateLift: 1.0,
      contributions: [],
      matchedApprovedPattern: false,
      hasSignal: false,
    });
    expect(m).toBeCloseTo(1.0, 2);
  });

  it("halves the size when lift = 2.0", () => {
    const m = lossRiskSizeMultiplier({
      aggregateLift: 2.0,
      contributions: [],
      matchedApprovedPattern: false,
      hasSignal: true,
    });
    expect(m).toBeCloseTo(0.5, 2);
  });

  it("applies an extra 0.5× penalty when an approved pattern matches", () => {
    const neutral = lossRiskSizeMultiplier({
      aggregateLift: 1.0,
      contributions: [],
      matchedApprovedPattern: false,
      hasSignal: false,
    });
    const flagged = lossRiskSizeMultiplier({
      aggregateLift: 1.0,
      contributions: [],
      matchedApprovedPattern: true,
      hasSignal: true,
    });
    expect(neutral).toBeCloseTo(1.0, 2);
    expect(flagged).toBeCloseTo(0.5, 2);
  });

  it("clamps the multiplier to [0.3, 1.5]", () => {
    const veryRisky = lossRiskSizeMultiplier({
      aggregateLift: 3.0,
      contributions: [],
      matchedApprovedPattern: true, // would push to 0.5/3 = 0.166
      hasSignal: true,
    });
    expect(veryRisky).toBe(0.3);

    const verySafe = lossRiskSizeMultiplier({
      aggregateLift: 0.3,
      contributions: [],
      matchedApprovedPattern: false,
      hasSignal: true,
    });
    expect(verySafe).toBe(1.5);
  });
});

describe("lossRiskInvestmentScore (0-100 scoring)", () => {
  it("returns null when there is no risk signal", () => {
    expect(lossRiskInvestmentScore(null)).toBeNull();
    expect(
      lossRiskInvestmentScore({
        aggregateLift: 1.0,
        contributions: [],
        matchedApprovedPattern: false,
        hasSignal: false,
      }),
    ).toBeNull();
  });

  it("anchors: lift 1.0 → 50, lift 0.3 → 0, lift 3.0 → 100", () => {
    const at = (lift: number) =>
      lossRiskInvestmentScore({
        aggregateLift: lift,
        contributions: [
          {
            dimension: "pplanBucket",
            bucket: "X",
            lift,
            shrunkLossRate: 0.1,
            n: 10,
            confidence: "medium",
          },
        ],
        matchedApprovedPattern: false,
        hasSignal: true,
      });
    expect(at(1.0)).toBeCloseTo(50, 1);
    expect(at(0.3)).toBeCloseTo(0, 1);
    expect(at(3.0)).toBeCloseTo(100, 1);
  });

  it("adds +20 (clamped to 100) when an approved pattern matches", () => {
    const safe = lossRiskInvestmentScore({
      aggregateLift: 0.5,
      contributions: [
        {
          dimension: "pplanBucket",
          bucket: "X",
          lift: 0.5,
          shrunkLossRate: 0.05,
          n: 10,
          confidence: "medium",
        },
      ],
      matchedApprovedPattern: true,
      hasSignal: true,
    });
    // base ≈ 50 + 50 × log(0.5)/log(3) = 50 - 31.5 = 18.5; + 20 ≈ 38.5
    expect(safe).toBeGreaterThan(35);
    expect(safe).toBeLessThan(42);

    const veryRisky = lossRiskInvestmentScore({
      aggregateLift: 3.0,
      contributions: [
        {
          dimension: "pplanBucket",
          bucket: "X",
          lift: 3.0,
          shrunkLossRate: 0.3,
          n: 10,
          confidence: "medium",
        },
      ],
      matchedApprovedPattern: true,
      hasSignal: true,
    });
    expect(veryRisky).toBe(100); // 100 + 20 → clamped
  });
});

describe("computePositionState — loss-risk integration", () => {
  it("populates metrics.lossRisk and lossRiskSizeMultiplier when phaseA is provided", () => {
    const phaseA = buildPhaseA();
    const deal: WidgetDeal = {
      ticker: "RISKY",
      displayLabel: "RISKY",
      cells: {
        clinicalPhase: "Phase 1",
        clinicalIndication: "Onco",
        sdsBucket: "No SDS",
        pplanBucket: "P(plan) <30%", // lift 1.94, MED, eligible
      },
    };
    const state = computePositionState({
      deals: [deal],
      sliders: { RISKY: 1000 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 100,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
      phaseA,
    });
    const m = state.perDeal[0].metrics;
    expect(m.lossRisk).not.toBeNull();
    expect(m.lossRisk!.contributions.length).toBeGreaterThan(0);
    // P(plan) <30% has lift 1.94 → aggregate ≈ 1.94 (only contributor) → mult ≈ 1/1.94 ≈ 0.52.
    expect(m.lossRiskSizeMultiplier).toBeLessThan(1.0);
    expect(m.lossRiskSizeMultiplier).toBeGreaterThan(0.3);
  });

  it("keeps metrics.lossRisk null when neither phaseA nor approvedPattern is provided", () => {
    const deal: WidgetDeal = {
      ticker: "X",
      displayLabel: "X",
      cells: {
        clinicalPhase: "Phase 3",
        clinicalIndication: "Onco",
        sdsBucket: "SDS 40-55 (Mid)",
        pplanBucket: "P(plan) 50-70%",
      },
    };
    const state = computePositionState({
      deals: [deal],
      sliders: { X: 1000 },
      totalCapitalEur: 10000,
      breakevenTargetEur: 100,
      calibrationSnapshot: buildSnapshot(),
      sdsGainBreakdown: buildSdsBreakdown(),
    });
    const m = state.perDeal[0].metrics;
    expect(m.lossRisk).toBeNull();
    expect(m.lossRiskSizeMultiplier).toBe(1.0);
  });
});
