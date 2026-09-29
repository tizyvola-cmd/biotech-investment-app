import { afterEach, describe, expect, it, vi } from "vitest";
import {
  computeRescueScoreBreakdown,
  computeRescueScoreExtendedBreakdown,
  summarizeRescueExtendedGroups,
  RESCUE_OPERATIONAL_THRESHOLD_PCT,
} from "./lossRescueEngine";
import * as resilienceData from "./resilienceScoreData";
import type { ResilienceEntryDoc } from "./resilienceScoreData";

/**
 * Post-2026-07-14 refactor: `computeRescueScoreBreakdown` no longer derives
 * the score from `entryProbPct`/`lastMarkPct`/`eisWindowScore` — those args
 * are preserved on the signature for backward-compat but ignored. The score
 * now comes from the Resilience Score snapshot (see
 * `prediction/resilience_score.py`). Field naming is preserved:
 *   probPt        = block A (historical drawdown-recovery, max 45)
 *   lossPt        = block B (asymmetric beta vs XBI,       max 30)
 *   eisPt         = block C (upside capacity,              max 25)
 */

function fakeEntry(score: number, blockA: number, blockB: number, blockC: number): ResilienceEntryDoc {
  return {
    ticker: "TEST",
    as_of: "2026-07-14",
    resilience_score: score,
    max_score: 100,
    status: "ok",
    components: {
      historical_recovery: { score: blockA, max: 45, status: "ok" },
      asymmetric_beta: { score: blockB, max: 30, status: "ok" },
      upside_capacity: { score: blockC, max: 25, status: "ok" },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("computeRescueScoreBreakdown (resilience-backed)", () => {
  it("returns unmeasured breakdown when ticker not in snapshot", () => {
    vi.spyOn(resilienceData, "lookupResilienceForTicker").mockReturnValue(null);
    const bd = computeRescueScoreBreakdown({
      ticker: "NOPE",
      entryProbPct: 70,
      lastMarkPct: -10,
      eisWindowScore: 8,
    });
    expect(bd.status).toBe("unmeasured");
    expect(bd.rescoreScore).toBe(0);
    expect(bd.probPt).toBe(0);
    expect(bd.lossPt).toBe(0);
    expect(bd.eisPt).toBe(0);
  });

  it("maps snapshot components onto legacy field names", () => {
    vi.spyOn(resilienceData, "lookupResilienceForTicker").mockReturnValue(
      fakeEntry(72, 30, 25, 17),
    );
    const bd = computeRescueScoreBreakdown({
      ticker: "VIR",
      entryProbPct: 40,
      lastMarkPct: -8,
      eisWindowScore: 0,
    });
    expect(bd.status).toBe("ok");
    expect(bd.rescoreScore).toBe(72);
    // probPt = block A (historical recovery)
    expect(bd.probPt).toBe(30);
    // lossPt = block B (asymmetric beta)
    expect(bd.lossPt).toBe(25);
    // eisPt = block C (upside capacity)
    expect(bd.eisPt).toBe(17);
    // legacy penalty/bonus fields are always 0 post-refactor
    expect(bd.volPenalty).toBe(0);
    expect(bd.extBonus).toBe(0);
    expect(bd.cashPenalty).toBe(0);
  });

  it("ignores entryProbPct / lastMarkPct — score depends only on snapshot", () => {
    vi.spyOn(resilienceData, "lookupResilienceForTicker").mockReturnValue(
      fakeEntry(55, 22, 18, 15),
    );
    const bdWinner = computeRescueScoreBreakdown({
      ticker: "VIR",
      entryProbPct: 90,
      lastMarkPct: 30,
      eisWindowScore: 20,
    });
    const bdLoser = computeRescueScoreBreakdown({
      ticker: "VIR",
      entryProbPct: 20,
      lastMarkPct: -40,
      eisWindowScore: -20,
    });
    expect(bdWinner.rescoreScore).toBe(bdLoser.rescoreScore);
    expect(bdWinner.rescoreScore).toBe(55);
  });

  it("extended breakdown returns the same payload as the operational one", () => {
    vi.spyOn(resilienceData, "lookupResilienceForTicker").mockReturnValue(
      fakeEntry(42, 20, 12, 10),
    );
    const op = computeRescueScoreBreakdown({ ticker: "PFE", lastMarkPct: -5 });
    const ext = computeRescueScoreExtendedBreakdown({ ticker: "PFE", lastMarkPct: 5 });
    expect(op).toEqual(ext);
  });

  it("returns unmeasured when ticker argument is omitted", () => {
    const bd = computeRescueScoreBreakdown({ entryProbPct: 50, lastMarkPct: -10, eisWindowScore: 5 });
    expect(bd.status).toBe("unmeasured");
    expect(bd.rescoreScore).toBe(0);
  });
});

describe("summarizeRescueExtendedGroups", () => {
  it("splits by operational threshold", () => {
    const stats = summarizeRescueExtendedGroups(
      [
        { pnlPct: -5, rescueExtended: 30 },
        { pnlPct: -3, rescueExtended: 25 },
        { pnlPct: 0, rescueExtended: 45 },
        { pnlPct: 10, rescueExtended: 50 },
      ],
      RESCUE_OPERATIONAL_THRESHOLD_PCT,
    );
    expect(stats.groupA.count).toBe(2);
    expect(stats.groupB.count).toBe(2);
    expect(stats.groupB.mean).toBeGreaterThan(stats.groupA.mean);
  });
});
