import { describe, expect, it } from "vitest";
import {
  buildFairRecsSlotsFromMissedOppRows,
  computeFairRecs24hFromEvaluations,
  fairRecsPnlFromSlots,
  FAIR_RECS_MAX_POSITIONS,
} from "./missedOpportunityFairRecs";
import type { MissedOppRow } from "./missedOpportunityAudit";
import type { PaperPosition, TickerSimEvaluation } from "./investDecisionSimLoop";

function missedRow(over: Partial<MissedOppRow>): MissedOppRow {
  return {
    key: "X|cd",
    ticker: "X",
    company: null,
    completionDate: "2026-06-20",
    dailyPct24h: 2,
    daysToCd: 30,
    bucket: "detected",
    suggested: false,
    exitDecision: "hold",
    probPct: 70,
    planReturnPct: 5,
    matchPct: 80,
    segmentRoiPct: 2,
    blockers: [],
    inPortfolio: false,
    inMonitorWindow: true,
    inOperationalWindow: true,
    inWatchWindow: false,
    ...over,
  };
}

function evalRow(over: Partial<TickerSimEvaluation> & Pick<TickerSimEvaluation, "key" | "ticker">): TickerSimEvaluation {
  return {
    hasPosition: false,
    inPaperPortfolio: false,
    daysToCd: 30,
    readings: {} as TickerSimEvaluation["readings"],
    misalignments: [],
    misalignmentLabels: [],
    exitDecision: "hold",
    investVerdict: "yes",
    entryVerdict: "yes",
    exitVerdict: "wait",
    probPct: 70,
    suggestedAction: "buy",
    planReturnPct: 5,
    pnlPct24h: 2,
    pnlPct: 2,
    precatVerdictAgree: true,
    exitReason: "",
    compositeScore: 70,
    scoringZone: "hot",
    scoreBreakdown: {
      pplan: 16,
      top2: 12,
      precat: 10,
      slope: 6,
      timing: 3,
      conf: 2,
      sds: 1,
      eis: 0,
    },
    compositeDampened: false,
    ...over,
  };
}

describe("missedOpportunityFairRecs", () => {
  it("respects an explicit cap on Enter signals", () => {
    // Default cap is now unlimited; opts.maxOpenPositions overrides per-call.
    const rows = Array.from({ length: 12 }, (_, i) =>
      missedRow({
        key: `T${i}|cd`,
        ticker: `T${i}`,
        suggested: true,
        probPct: 90 - i,
        dailyPct24h: 1,
      }),
    );
    const slots = buildFairRecsSlotsFromMissedOppRows(
      rows,
      { sheet: "sim", columns: [], rows: [] },
      {},
      { maxOpenPositions: 5 },
    );
    expect(slots.length).toBe(5);
    expect(slots.every((s) => s.source === "enter")).toBe(true);
  });

  it("no longer caps Enter signals by default (unlimited)", () => {
    // With the cap removed, the baseline follows every reliable BUY signal so
    // it stays apples-to-apples with the sim loop (which is also uncapped).
    const rows = Array.from({ length: 12 }, (_, i) =>
      missedRow({
        key: `T${i}|cd`,
        ticker: `T${i}`,
        suggested: true,
        probPct: 90 - i,
        dailyPct24h: 1,
      }),
    );
    const slots = buildFairRecsSlotsFromMissedOppRows(
      rows,
      { sheet: "sim", columns: [], rows: [] },
      {},
    );
    expect(slots.length).toBe(12);
    expect(Number.isFinite(FAIR_RECS_MAX_POSITIONS)).toBe(false);
  });

  it("skips Enter on negative 24h and exit decisions", () => {
    const rows = [
      missedRow({ key: "A|cd", ticker: "A", suggested: true, dailyPct24h: -1 }),
      missedRow({ key: "B|cd", ticker: "B", suggested: true, exitDecision: "exit", dailyPct24h: 2 }),
      missedRow({ key: "C|cd", ticker: "C", suggested: true, dailyPct24h: 2, probPct: 80 }),
    ];
    const slots = buildFairRecsSlotsFromMissedOppRows(
      rows,
      { sheet: "sim", columns: [], rows: [] },
      {},
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].key).toBe("C|cd");
  });

  it("uses paper capital and ranks Enter for decision sim", () => {
    const paper: PaperPosition[] = [
      {
        key: "H|cd",
        ticker: "H",
        entryAt: "2026-06-10",
        capital: 3000,
        entryReason: "test",
        entryPlanReturnPct: 5,
        entryProbPct: 70,
      },
    ];
    const evaluations = [
      evalRow({ key: "H|cd", ticker: "H", hasPosition: false, suggestedAction: "hold", pnlPct24h: 1 }),
      evalRow({ key: "A|cd", ticker: "A", probPct: 90, pnlPct24h: 2 }),
      evalRow({ key: "B|cd", ticker: "B", probPct: 80, pnlPct24h: 2 }),
    ];
    const pnl = computeFairRecs24hFromEvaluations(evaluations, paper, { capitalPerTrade: 5000 });
    expect(pnl).toBe(30 + 100 + 100);
  });

  it("sums slot P&L with per-position capital", () => {
    const pnl = fairRecsPnlFromSlots([
      { key: "a", capitalEur: 4000, dailyPct24h: 2, source: "held" },
      { key: "b", capitalEur: 5000, dailyPct24h: 1, source: "enter" },
    ]);
    expect(pnl).toBe(80 + 50);
  });
});
