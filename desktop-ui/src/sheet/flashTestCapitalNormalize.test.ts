import { describe, expect, it } from "vitest";
import {
  normalizeFlashArmCapitals,
  normalizeFlashOpenCapitals,
} from "./flashTestEngine";
import { resolvePaperPositionMarks } from "./investDecisionSimLoop";
import type { PaperPosition } from "./investDecisionSimLoop";
import type { FlashTestArmState } from "./flashTestTypes";

function pos(capital: number, entryBuyPrice = 10, lastMarkPct = 5): PaperPosition {
  return {
    key: `T|2026-09-01`,
    ticker: "T",
    entryAt: "2026-08-10T10:00:00.000Z",
    capital,
    entryReason: "buy",
    entryPlanReturnPct: null,
    entryProbPct: null,
    entryBuyPrice,
    lastMarkPct,
  };
}

describe("normalizeFlashOpenCapitals", () => {
  it("rewrites legacy Gen 4 gate-sized tickets to fixed per-trade capital", () => {
    const out = normalizeFlashOpenCapitals(
      [pos(2000), pos(3500), pos(5000)],
      5000,
    );
    expect(out.map((p) => p.capital)).toEqual([5000, 5000, 5000]);
  });

  it("preserves € MTM when upsizing legacy gate-sized capital", () => {
    const simRow = new Map<string, Record<string, unknown>>([
      [
        "T|2026-09-01",
        { "Prezzo Corrente ($)": 11, "Var. Giorn. %": 0.5 },
      ],
    ]);
    const before = pos(2000, 10, 10);
    const beforeMtm = resolvePaperPositionMarks(before, simRow.get("T|2026-09-01")!);
    expect(beforeMtm.totalPnlPct).toBe(10);
    const beforeEur = Math.round(((2000 * 10) / 100) * 100) / 100;

    const [after] = normalizeFlashOpenCapitals([before], 5000, simRow);
    expect(after!.capital).toBe(5000);
    const afterMtm = resolvePaperPositionMarks(after!, simRow.get("T|2026-09-01")!);
    expect(afterMtm.totalPnlPct).toBe(4);
    expect(Math.round(((5000 * (afterMtm.totalPnlPct ?? 0)) / 100) * 100) / 100).toBe(
      beforeEur,
    );
  });

  it("is a no-op when already at target", () => {
    const input = [pos(5000)];
    expect(normalizeFlashOpenCapitals(input, 5000)).toBe(input);
  });
});

describe("normalizeFlashArmCapitals", () => {
  it("rewrites open rows and BUY ledger tickets together", () => {
    const arm: FlashTestArmState = {
      gen: 4,
      portfolio: [pos(2000)],
      trades: [
        {
          gen: 4,
          key: "T|2026-09-01",
          ticker: "T",
          side: "buy",
          at: "2026-08-10T10:00:00.000Z",
          capital: 2000,
          reason: "buy",
          pnlPctSimulated: null,
          pnlEurSimulated: null,
        },
      ],
      equity: [],
      cumulativeClosedPnlEur: 0,
      closedTradeCount: 0,
      peakPnlByKey: {},
      lastTickSignals: [],
      lastTickMissCounts: {},
    };
    const out = normalizeFlashArmCapitals(arm, 5000);
    expect(out.portfolio[0]!.capital).toBe(5000);
    expect(out.trades[0]!.capital).toBe(5000);
  });
});
