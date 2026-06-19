import { beforeEach, describe, expect, it } from "vitest";
import {
  approvePatternProposal,
  generatePatternProposalFromOutcomes,
  rejectPatternProposal,
} from "./patternProposalEngine";
import {
  __resetPatternStoreForTests,
  listProposals,
  loadApprovedPattern,
} from "./patternProposalStore";
import { __resetSnapshotStoreForTests } from "../calibration/featureSnapshotStore";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";

function row(args: {
  ticker: string;
  pnlPct: number | null;
  pplanPct?: number | null;
  daysToCd?: number;
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
    exit_ts: args.exitTs ?? "2026-06-15T12:00:00.000Z",
  } as SimOutcomeRow;
}

beforeEach(() => {
  __resetPatternStoreForTests();
  __resetSnapshotStoreForTests();
});

describe("patternProposalEngine — first pattern", () => {
  it("returns no proposal when there is no current pattern AND no eligible candidate", () => {
    // Too few trades: candidate would have firedN < 8
    const outcomes = [
      row({ ticker: "L1", pnlPct: -5, pplanPct: 20 }),
      row({ ticker: "L2", pnlPct: -5, pplanPct: 20 }),
      row({ ticker: "W1", pnlPct: 8, pplanPct: 60 }),
    ];
    const { proposal } = generatePatternProposalFromOutcomes(outcomes);
    expect(proposal).toBeNull();
  });

  it("creates a 'firstPattern' proposal when no approved pattern exists and there's enough data", () => {
    // 9 loss trades all P(plan) <30%, 9 win trades P(plan) 50-70% — clean signal
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 9; i++) outcomes.push(row({ ticker: `L${i}`, pnlPct: -10, pplanPct: 20 }));
    for (let i = 0; i < 9; i++) outcomes.push(row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 60 }));
    const { proposal } = generatePatternProposalFromOutcomes(outcomes);
    expect(proposal).not.toBeNull();
    expect(proposal!.reason).toBe("firstPattern");
    expect(proposal!.currentPattern).toBeNull();
    expect(proposal!.proposedPattern).not.toBeNull();
    expect(proposal!.proposedPattern!.inSampleStats.firedN).toBeGreaterThanOrEqual(8);
    expect(proposal!.status).toBe("pending");
    expect(proposal!.rationale.length).toBeGreaterThan(20);
  });

  it("approval promotes the candidate to the active pattern", () => {
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 9; i++) outcomes.push(row({ ticker: `L${i}`, pnlPct: -10, pplanPct: 20 }));
    for (let i = 0; i < 9; i++) outcomes.push(row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 60 }));
    const { proposal } = generatePatternProposalFromOutcomes(outcomes);
    const result = approvePatternProposal(proposal!.id, "looks reasonable");
    expect(result).not.toBeNull();
    expect(result!.approvedPattern).not.toBeNull();
    const stored = loadApprovedPattern();
    expect(stored.current).not.toBeNull();
    expect(stored.current!.approvedAt).toBeDefined();
  });
});

describe("patternProposalEngine — better pattern found", () => {
  it("does NOT re-propose the same pattern that is already approved", () => {
    // Build & approve a pattern
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 9; i++) outcomes.push(row({ ticker: `L${i}`, pnlPct: -10, pplanPct: 20 }));
    for (let i = 0; i < 9; i++) outcomes.push(row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 60 }));
    const { proposal } = generatePatternProposalFromOutcomes(outcomes);
    approvePatternProposal(proposal!.id);

    // Re-run the engine immediately — candidate is identical to approved pattern.
    // Expectation: no proposal generated.
    const second = generatePatternProposalFromOutcomes(outcomes);
    expect(second.proposal).toBeNull();
  });
});

describe("patternProposalEngine — currentPatternDegraded alarm", () => {
  it("emits a 'currentPatternDegraded' proposal when OOS precision drops materially", () => {
    // Train: 9 losses in P(plan) <30% + 9 wins in P(plan) 50-70%
    // Pattern: P(plan)<30% → fires on losses.
    // Then approve the pattern. Then add 6 NEW trades after approval where the
    // pattern still fires (P(plan) <30%) but they all WIN → OOS precision = 0.
    const trainingTrades: SimOutcomeRow[] = [];
    for (let i = 0; i < 9; i++) {
      trainingTrades.push(
        row({ ticker: `L${i}`, pnlPct: -10, pplanPct: 20, exitTs: "2026-06-10T12:00:00.000Z" }),
      );
    }
    for (let i = 0; i < 9; i++) {
      trainingTrades.push(
        row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 60, exitTs: "2026-06-10T12:00:00.000Z" }),
      );
    }
    const first = generatePatternProposalFromOutcomes(trainingTrades);
    expect(first.proposal).not.toBeNull();
    approvePatternProposal(first.proposal!.id);

    // Now feed: training + 6 new trades AFTER approval, all P(plan)<30% but
    // they all WIN unexpectedly. The pattern still fires but is wrong → OOS
    // precision falls to ~0.
    const augmented: SimOutcomeRow[] = [...trainingTrades];
    for (let i = 0; i < 6; i++) {
      augmented.push(
        row({
          ticker: `OOSWIN${i}`,
          pnlPct: 12,
          pplanPct: 20,
          exitTs: "2026-07-15T12:00:00.000Z",
        }),
      );
    }
    const second = generatePatternProposalFromOutcomes(augmented);
    expect(second.proposal).not.toBeNull();
    expect(second.proposal!.reason).toBe("currentPatternDegraded");
    expect(second.currentOosStats).not.toBeNull();
    expect(second.currentOosStats!.firedN).toBeGreaterThanOrEqual(5);
    expect(second.currentOosStats!.precision).toBeLessThan(0.5);
  });
});

describe("patternProposalEngine — reject keeps audit trail", () => {
  it("rejected proposals are preserved in history", () => {
    const outcomes: SimOutcomeRow[] = [];
    for (let i = 0; i < 9; i++) outcomes.push(row({ ticker: `L${i}`, pnlPct: -10, pplanPct: 20 }));
    for (let i = 0; i < 9; i++) outcomes.push(row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 60 }));
    const { proposal } = generatePatternProposalFromOutcomes(outcomes);
    expect(proposal).not.toBeNull();
    const rejected = rejectPatternProposal(proposal!.id, "not convinced");
    expect(rejected).not.toBeNull();
    expect(rejected!.status).toBe("rejected");
    expect(rejected!.reviewNote).toBe("not convinced");
    // History still has the proposal
    const all = listProposals();
    expect(all.length).toBe(1);
    expect(all[0].status).toBe("rejected");
    // No approved pattern was activated
    expect(loadApprovedPattern().current).toBeNull();
  });
});
