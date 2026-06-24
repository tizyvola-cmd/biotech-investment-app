import { beforeEach, describe, expect, it } from "vitest";
import {
  generateProposalFromOutcomes,
  approveProposal,
  rejectProposal,
  diffSnapshotVsFrozen,
  DEFAULT_DELTA_EPSILON,
} from "./proposalEngine";
import {
  __resetCalibrationStoreForTests,
  listProposals,
  loadFrozenWeights,
} from "./proposalStore";
import { __resetSnapshotStoreForTests } from "./featureSnapshotStore";
import { computeCalibrationSnapshot } from "./shrinkageEngine";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";

function row(args: {
  ticker: string;
  pnlPct: number | null;
  pplanPct?: number | null;
}): SimOutcomeRow {
  return {
    row_key: `${args.ticker}|cd`,
    ticker: args.ticker,
    completion_date: "2026-06-01",
    days_to_cd: 30,
    cd_passed: false,
    timing_bucket: "pre_cd",
    timing_label: "Pre-CD",
    capital_eur: 1000,
    pnl_eur:
      args.pnlPct == null ? null : ((args.pnlPct ?? 0) / 100) * 1000,
    pnl_pct: args.pnlPct,
    outcome:
      args.pnlPct == null ? "open" : args.pnlPct > 0 ? "win" : "loss",
    outcome_label:
      args.pnlPct == null ? "Open" : args.pnlPct > 0 ? "Win" : "Loss",
    is_win: args.pnlPct != null && args.pnlPct > 0,
    affidabilita_pct: args.pplanPct ?? 60,
  } as SimOutcomeRow;
}

beforeEach(() => {
  __resetCalibrationStoreForTests();
  __resetSnapshotStoreForTests();
});

describe("proposalEngine", () => {
  it("returns null proposal when nothing changed (idempotent run on empty)", () => {
    const result = generateProposalFromOutcomes([]);
    expect(result.proposal).toBeNull();
    expect(listProposals()).toHaveLength(0);
  });

  it("first run with data creates a proposal with status=pending", () => {
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 13; i++) {
      outcomes.push(row({ ticker: `MID${i}`, pnlPct: 8, pplanPct: 60 }));
    }
    outcomes.push(row({ ticker: "LO1", pnlPct: -5, pplanPct: 20 }));
    outcomes.push(row({ ticker: "LO2", pnlPct: -3, pplanPct: 20 }));

    const { proposal } = generateProposalFromOutcomes(outcomes, {}, {
      triggeredByTradeId: "MID12|cd",
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.status).toBe("pending");
    expect(proposal!.changes.length).toBeGreaterThan(0);
    expect(proposal!.triggeredByTradeId).toBe("MID12|cd");
  });

  it("does NOT auto-apply: frozen weights remain empty until approval", () => {
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 13; i++) {
      outcomes.push(row({ ticker: `MID${i}`, pnlPct: 8, pplanPct: 60 }));
    }
    outcomes.push(row({ ticker: "LO1", pnlPct: -5, pplanPct: 20 }));
    outcomes.push(row({ ticker: "LO2", pnlPct: -3, pplanPct: 20 }));

    generateProposalFromOutcomes(outcomes);
    const frozen = loadFrozenWeights();
    expect(Object.keys(frozen.weights.pplanBucket).length).toBe(0);
  });

  it("approving a proposal atomically applies its changes to frozen weights", () => {
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 13; i++) {
      outcomes.push(row({ ticker: `MID${i}`, pnlPct: 8, pplanPct: 60 }));
    }
    outcomes.push(row({ ticker: "LO1", pnlPct: -5, pplanPct: 20 }));
    outcomes.push(row({ ticker: "LO2", pnlPct: -3, pplanPct: 20 }));

    const { proposal } = generateProposalFromOutcomes(outcomes);
    expect(proposal).not.toBeNull();
    const result = approveProposal(proposal!.id, "looks good");
    expect(result).not.toBeNull();
    expect(result!.proposal.status).toBe("approved");
    expect(result!.proposal.reviewNote).toBe("looks good");
    // Now frozen weights contain the cells from the proposal
    const fw = loadFrozenWeights();
    const mid = fw.weights.pplanBucket["P(plan) 50-70%"];
    expect(mid).toBeDefined();
    expect(mid.n).toBe(13);
    expect(mid.confidence).toBe("medium");
  });

  it("rejected proposal does NOT modify frozen weights but persists in history", () => {
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 5; i++) {
      outcomes.push(row({ ticker: `T${i}`, pnlPct: 8 }));
    }
    outcomes.push(row({ ticker: "L1", pnlPct: -5, pplanPct: 20 }));
    const { proposal } = generateProposalFromOutcomes(outcomes);
    expect(proposal).not.toBeNull();
    rejectProposal(proposal!.id, "n too low");
    const fw = loadFrozenWeights();
    expect(Object.keys(fw.weights.pplanBucket).length).toBe(0);
    // History preserved
    const all = listProposals();
    expect(all.find((p) => p.id === proposal!.id)?.status).toBe("rejected");
    expect(all.find((p) => p.id === proposal!.id)?.reviewNote).toBe(
      "n too low",
    );
  });

  it("second approval on the same proposal is a no-op (audit trail preserved)", () => {
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 5; i++) outcomes.push(row({ ticker: `T${i}`, pnlPct: 8 }));
    outcomes.push(row({ ticker: "L1", pnlPct: -5, pplanPct: 20 }));
    const { proposal } = generateProposalFromOutcomes(outcomes);
    approveProposal(proposal!.id);
    // Second approval attempt
    const second = approveProposal(proposal!.id);
    expect(second).toBeNull(); // refused — already reviewed
  });

  it("diff skips cells with no_data and skips small numeric changes below epsilon", () => {
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 13; i++) {
      outcomes.push(row({ ticker: `MID${i}`, pnlPct: 8, pplanPct: 60 }));
    }
    outcomes.push(row({ ticker: "LO1", pnlPct: -5, pplanPct: 20 }));
    outcomes.push(row({ ticker: "LO2", pnlPct: -3, pplanPct: 20 }));

    const snap = computeCalibrationSnapshot(outcomes);
    // First diff vs empty frozen: many changes expected
    const empty = loadFrozenWeights();
    const changes = diffSnapshotVsFrozen(snap, empty, DEFAULT_DELTA_EPSILON);
    expect(changes.length).toBeGreaterThan(0);
    // No change for a cell with n=0
    for (const c of changes) {
      expect(c.newN).toBeGreaterThan(0);
    }
  });

  it("flags confidence-level change even when weight delta is tiny", () => {
    // Build a frozen state where pplan 50-70% is at LOW (n=4)
    // and a fresh snapshot pushing it to MEDIUM (n=5) with nearly same weight.
    // We need >=2 buckets with data so the dim has variance and produces proposals.
    const old: SimOutcomeRow[] = [];
    for (let i = 0; i < 3; i++) old.push(row({ ticker: `O${i}`, pnlPct: 6, pplanPct: 60 }));
    old.push(row({ ticker: "OL", pnlPct: -5, pplanPct: 60 }));
    // Add some trades in a second bucket so pplanBucket.hasVariance = true
    for (let i = 0; i < 3; i++)
      old.push(row({ ticker: `LO${i}`, pnlPct: -4, pplanPct: 20 }));
    const r1 = generateProposalFromOutcomes(old);
    expect(r1.proposal).not.toBeNull();
    approveProposal(r1.proposal!.id);

    // Add one more in 50-70% — pushes n from 4 to 5 (LOW → MEDIUM)
    const next = [
      ...old,
      row({ ticker: "NEW", pnlPct: 6, pplanPct: 60 }),
    ];
    const r2 = generateProposalFromOutcomes(next);
    expect(r2.proposal).not.toBeNull();
    const flagged = r2.proposal!.changes.find(
      (c) =>
        c.dimension === "pplanBucket" &&
        c.cell === "P(plan) 50-70%" &&
        c.confidenceChanged,
    );
    expect(flagged).toBeDefined();
    expect(flagged!.oldConfidence).toBe("low");
    expect(flagged!.newConfidence).toBe("medium");
  });
});
