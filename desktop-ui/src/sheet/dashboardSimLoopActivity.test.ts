import { describe, expect, it } from "vitest";
import type { DecisionSimState } from "./investDecisionSimLoop";
import { defaultDecisionSimState } from "./investDecisionSimStorage";
import {
  buildSimLoopActivityMetrics,
  countSimLoopTradeMovements,
  formatSimLoopActivityFragment,
} from "./dashboardSimLoopActivity";

function baseState(overrides: Partial<DecisionSimState> = {}): DecisionSimState {
  return { ...defaultDecisionSimState(), ...overrides };
}

describe("dashboardSimLoopActivity", () => {
  it("counts trade movements across ticks", () => {
    const state = baseState({
      ticks: [
        { at: "2026-06-10T15:00:00Z", trades: [{ key: "a", action: "BUY" }] },
        {
          at: "2026-06-10T16:00:00Z",
          trades: [
            { key: "b", action: "BUY" },
            { key: "a", action: "SELL" },
          ],
        },
      ],
    });
    expect(countSimLoopTradeMovements(state)).toBe(3);
  });

  it("builds activity metrics with error rate from scorecard", () => {
    const state = baseState({
      ticks: [{ at: "2026-06-10T15:00:00Z", trades: [] }],
      scorecard: {
        ...defaultDecisionSimState().scorecard,
        goodBuyCount: 20,
        goodSellCount: 8,
        badBuyCount: 7,
        badSellCount: 3,
        missedBuyCount: 4,
      },
    });
    const activity = buildSimLoopActivityMetrics(state);
    expect(activity.tickCount).toBe(1);
    expect(activity.movementCount).toBe(0);
    expect(activity.scoredCount).toBe(38);
    expect(activity.badCount).toBe(10);
    expect(activity.errorRatePct).toBeCloseTo(26.3, 1);
  });

  it("formats tick · mov · err fragment", () => {
    const activity = buildSimLoopActivityMetrics(
      baseState({
        ticks: Array.from({ length: 245 }, (_, i) => ({
          at: `2026-06-10T${String(15 + (i % 8)).padStart(2, "0")}:00:00Z`,
          trades: i < 38 ? [{ key: `k${i}`, action: "BUY" as const }] : [],
        })),
        scorecard: {
          ...defaultDecisionSimState().scorecard,
          goodBuyCount: 20,
          goodSellCount: 6,
          badBuyCount: 8,
          badSellCount: 4,
        },
      }),
    );
    expect(formatSimLoopActivityFragment(activity, "en")).toBe("245 ticks · 38 moves · 12 err (31.6%)");
    expect(formatSimLoopActivityFragment(activity, "it")).toBe("245 tick · 38 mov · 12 err (31.6%)");
  });

  it("returns null fragment when no activity", () => {
    const activity = buildSimLoopActivityMetrics(baseState());
    expect(formatSimLoopActivityFragment(activity, "en")).toBeNull();
  });
});
