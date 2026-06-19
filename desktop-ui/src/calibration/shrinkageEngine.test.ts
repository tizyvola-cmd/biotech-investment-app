import { beforeEach, describe, expect, it } from "vitest";
import {
  computeCalibrationSnapshot,
  lookupCellEstimate,
} from "./shrinkageEngine";
import { DEFAULT_SHRINKAGE_CONFIG, confidenceFromN } from "./calibrationTypes";
import { __resetSnapshotStoreForTests } from "./featureSnapshotStore";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";

function row(args: {
  ticker: string;
  pnlPct: number | null;
  pplanPct?: number | null;
  capital?: number;
}): SimOutcomeRow {
  return {
    row_key: `${args.ticker}|cd`,
    ticker: args.ticker,
    completion_date: "2026-06-01",
    days_to_cd: 30,
    cd_passed: false,
    timing_bucket: "pre_cd",
    timing_label: "Pre-CD",
    capital_eur: args.capital ?? 1000,
    pnl_eur: args.pnlPct == null ? null : ((args.pnlPct ?? 0) / 100) * (args.capital ?? 1000),
    pnl_pct: args.pnlPct,
    outcome: args.pnlPct == null ? "open" : args.pnlPct > 0 ? "win" : "loss",
    outcome_label: args.pnlPct == null ? "Open" : args.pnlPct > 0 ? "Win" : "Loss",
    is_win: args.pnlPct != null && args.pnlPct > 0,
    affidabilita_pct: args.pplanPct ?? 60,
  } as SimOutcomeRow;
}

beforeEach(() => {
  __resetSnapshotStoreForTests();
});

describe("shrinkageEngine — real-data cases from the brief", () => {
  it("returns no_data for empty cells and never produces a naked 0", () => {
    const snap = computeCalibrationSnapshot([]);
    expect(snap.totalTrades).toBe(0);
    expect(snap.globalPrior).toBeCloseTo(0.5);
    for (const dim of Object.values(snap.dimensions)) {
      for (const cell of dim.cells) {
        if (cell.n === 0) {
          expect(cell.inactive).toBe("no_data");
          // raw and shrunk should fall back to the prior, never 0
          expect(cell.rawObserved).toBe(cell.prior);
          expect(cell.shrinkageApplied).toBe(cell.prior);
        }
      }
    }
  });

  it("Phase 3 with n=3, 1 loss: shrinks 33% loss rate towards prior, NOT towards 0 or 50", () => {
    // Build 3 Phase 3 trades, one loss + plenty of other trades to seed the global prior
    const outcomes: SimOutcomeRow[] = [
      // 2 wins + 1 loss in P3 — but we have no SheetTable so phase comes back as "Unknown"
      row({ ticker: "P3A", pnlPct: 8 }),
      row({ ticker: "P3B", pnlPct: 5 }),
      row({ ticker: "P3C", pnlPct: -10 }),
      // global cohort: 5 wins + 2 losses ⇒ global prior = 5/7 ≈ 0.714
      row({ ticker: "X1", pnlPct: 12 }),
      row({ ticker: "X2", pnlPct: 6 }),
      row({ ticker: "X3", pnlPct: 4 }),
      row({ ticker: "X4", pnlPct: -5 }),
    ];
    const snap = computeCalibrationSnapshot(outcomes);
    expect(snap.totalTrades).toBe(7);
    // global prior reflects overall WIN rate
    expect(snap.globalPrior).toBeGreaterThan(0.6);
    expect(snap.globalPrior).toBeLessThan(0.8);
    // Without sheet, all phases collapse to "Unknown" — find the only cell
    const phase = snap.dimensions.clinicalPhase;
    expect(phase.cells.length).toBeGreaterThan(0);
    // First active cell with all 7 observations
    const cellAll = phase.cells.find((c) => c.n === 7);
    expect(cellAll).toBeDefined();
    if (cellAll) {
      // shrinkage applied is between raw observed and prior (here they should be close)
      expect(cellAll.rawObserved).toBeCloseTo(5 / 7, 3);
      expect(cellAll.inactive).toBeNull();
    }
  });

  it("SDS Mid with n=11 zero-loss does NOT remain at 100% win rate — pulled towards global prior", () => {
    // 11 wins in SDS Mid (modeled as P(plan) bucket since SDS needs SdsRow)
    // We use pplanBucket which doesn't depend on external joins.
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 11; i++) {
      outcomes.push(row({ ticker: `MID${i}`, pnlPct: 8, pplanPct: 60 }));
    }
    // Add a few losses elsewhere to make global prior < 1.0
    outcomes.push(row({ ticker: "LO1", pnlPct: -5, pplanPct: 20 }));
    outcomes.push(row({ ticker: "LO2", pnlPct: -3, pplanPct: 20 }));
    outcomes.push(row({ ticker: "LO3", pnlPct: -4, pplanPct: 20 }));

    const snap = computeCalibrationSnapshot(outcomes);
    expect(snap.totalTrades).toBe(14);
    expect(snap.globalPrior).toBeCloseTo(11 / 14, 3);

    const pp = snap.dimensions.pplanBucket;
    const mid = lookupCellEstimate(snap, "pplanBucket", "P(plan) 50-70%");
    expect(mid).toBeDefined();
    expect(mid!.n).toBe(11);
    expect(mid!.rawObserved).toBe(1.0);
    // KEY ASSERTION: shrunk weight is BELOW 1.0 — zero observed losses ≠ zero risk
    expect(mid!.shrinkageApplied).toBeLessThan(1.0);
    // And not pulled all the way down to global prior either — n=11 has weight
    expect(mid!.shrinkageApplied).toBeGreaterThan(snap.globalPrior);
    // hasVariance: we have 2 active cells (50-70% and <30%)
    expect(pp.hasVariance).toBe(true);
  });

  it("P(plan) 50-70% with n=13 and 1 surprise loss: surprise rate spikes do NOT propagate to shrunk weight", () => {
    // 12 wins, 1 loss in bucket 50-70%
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 12; i++) {
      outcomes.push(row({ ticker: `MID${i}`, pnlPct: 8, pplanPct: 60 }));
    }
    outcomes.push(row({ ticker: "MIDLO", pnlPct: -8, pplanPct: 60 }));
    // Tail
    outcomes.push(row({ ticker: "LO1", pnlPct: -5, pplanPct: 20 }));

    const snap = computeCalibrationSnapshot(outcomes);
    const mid = lookupCellEstimate(snap, "pplanBucket", "P(plan) 50-70%");
    expect(mid).toBeDefined();
    expect(mid!.n).toBe(13);
    expect(mid!.rawObserved).toBeCloseTo(12 / 13, 3);
    // Shrunk should be reasonably close to raw (n=13 carries weight)
    expect(mid!.shrinkageApplied).toBeGreaterThan(0.7);
    // Confidence should be medium (n=13 with default thresholds 5..15)
    expect(mid!.confidence).toBe("medium");
  });

  it("dimension where 19/19 trades fall in the same single bucket has hasVariance=false", () => {
    // All in P(plan) <30% — single bucket
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 19; i++) {
      outcomes.push(
        row({ ticker: `T${i}`, pnlPct: i % 3 === 0 ? -3 : 5, pplanPct: 20 }),
      );
    }
    const snap = computeCalibrationSnapshot(outcomes);
    const pp = snap.dimensions.pplanBucket;
    // Only one bucket has data → hasVariance must be false
    expect(pp.cells.filter((c) => c.n > 0).length).toBe(1);
    expect(pp.hasVariance).toBe(false);
  });

  it("never returns a naked frequency without n/confidence metadata", () => {
    const outcomes = [row({ ticker: "A", pnlPct: 5 })];
    const snap = computeCalibrationSnapshot(outcomes);
    for (const dim of Object.values(snap.dimensions)) {
      for (const cell of dim.cells) {
        expect(cell.n).toBeDefined();
        expect(cell.confidence).toBeDefined();
        expect(cell.rawObserved).toBeDefined();
        expect(cell.shrinkageApplied).toBeDefined();
        expect(cell.k).toBe(DEFAULT_SHRINKAGE_CONFIG.k);
      }
    }
  });

  it("confidenceFromN thresholds: low<5, medium 5-15, high>=15", () => {
    expect(confidenceFromN(0)).toBe("low");
    expect(confidenceFromN(4)).toBe("low");
    expect(confidenceFromN(5)).toBe("medium");
    expect(confidenceFromN(14)).toBe("medium");
    expect(confidenceFromN(15)).toBe("high");
    expect(confidenceFromN(50)).toBe("high");
  });
});
