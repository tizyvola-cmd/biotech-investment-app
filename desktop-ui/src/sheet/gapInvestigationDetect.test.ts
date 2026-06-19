import { describe, expect, it } from "vitest";
import { detectGapEvents } from "./gapInvestigationDetect";
import { GAP_INVESTIGATION_THRESHOLD_PCT } from "./gapInvestigationTypes";
import type { PaperPosition, TickerSimEvaluation } from "./investDecisionSimLoop";

function pos(key: string, ticker: string, lastMarkPct: number | null, capital = 5000): PaperPosition {
  return {
    key,
    ticker,
    capital,
    entryAt: "2026-06-01T10:00:00.000Z",
    entryReason: "test",
    entryPlanReturnPct: null,
    lastMarkPct,
  };
}

describe("detectGapEvents", () => {
  it("triggers when |gap| exceeds threshold", () => {
    const before = [pos("A|2026-07-01", "AAA", 2)];
    const after = [pos("A|2026-07-01", "AAA", 2 - GAP_INVESTIGATION_THRESHOLD_PCT - 1)];
    const events = detectGapEvents(before, after, "2026-06-19T12:00:00.000Z");
    expect(events).toHaveLength(1);
    expect(events[0]!.gapPct).toBeLessThan(-GAP_INVESTIGATION_THRESHOLD_PCT);
    expect(events[0]!.rowKey).toBe("A|2026-07-01");
  });

  it("triggers on large positive gap", () => {
    const before = [pos("B|2026-08-01", "BBB", 0)];
    const after = [pos("B|2026-08-01", "BBB", GAP_INVESTIGATION_THRESHOLD_PCT + 2)];
    const events = detectGapEvents(before, after, "2026-06-19T12:00:00.000Z");
    expect(events).toHaveLength(1);
    expect(events[0]!.gapPct).toBeGreaterThan(GAP_INVESTIGATION_THRESHOLD_PCT);
  });

  it("skips when gap is at or below threshold", () => {
    const before = [pos("C|2026-09-01", "CCC", 1)];
    const after = [pos("C|2026-09-01", "CCC", 1 + GAP_INVESTIGATION_THRESHOLD_PCT)];
    expect(detectGapEvents(before, after, "2026-06-19T12:00:00.000Z")).toHaveLength(0);
  });

  it("skips new positions without previous mark", () => {
    const before: PaperPosition[] = [];
    const after = [pos("D|2026-10-01", "DDD", -8)];
    expect(detectGapEvents(before, after, "2026-06-19T12:00:00.000Z")).toHaveLength(0);
  });

  it("skips when previous mark is null", () => {
    const before = [pos("E|2026-11-01", "EEE", null)];
    const after = [pos("E|2026-11-01", "EEE", -10)];
    expect(detectGapEvents(before, after, "2026-06-19T12:00:00.000Z")).toHaveLength(0);
  });

  it("maps daysToCd from evaluations", () => {
    const before = [pos("F|2026-12-01", "FFF", 0)];
    const after = [pos("F|2026-12-01", "FFF", -12)];
    const evals: TickerSimEvaluation[] = [
      {
        key: "F|2026-12-01",
        ticker: "FFF",
        hasPosition: true,
        daysToCd: 42,
      } as TickerSimEvaluation,
    ];
    const events = detectGapEvents(before, after, "2026-06-19T12:00:00.000Z", evals);
    expect(events[0]?.daysSinceCD).toBe(42);
  });
});
