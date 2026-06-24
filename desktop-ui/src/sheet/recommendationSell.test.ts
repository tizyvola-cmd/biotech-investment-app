import { describe, expect, it } from "vitest";
import type { InvestSimHistoryPoint, InvestSimInputEntry } from "./investSimStorage";
import { analyzeSellDirectional } from "./recommendationSell";

function pt(ts: string, byTicker: Record<string, number>): InvestSimHistoryPoint {
  const by: InvestSimHistoryPoint["byTicker"] = {};
  for (const [k, pnlPct] of Object.entries(byTicker)) {
    by[k] = { value: 1000 * (1 + pnlPct / 100), pnl: 1000 * (pnlPct / 100), pnlPct };
  }
  return { ts, capital: 1000, value: 1000, pnl: 0, pnlPct: 0, byTicker: by };
}

function entry(): InvestSimInputEntry {
  return { buyPrice: 10, capital: 1000, entryProbPct: null } as InvestSimInputEntry;
}

describe("analyzeSellDirectional", () => {
  it("is unavailable when no position hits the stop-loss", () => {
    const key = "AAA|2026-06-01";
    const history = [pt("2026-01-01", { [key]: -5 }), pt("2026-01-10", { [key]: -12 })];
    const res = analyzeSellDirectional({ history, inputs: { [key]: entry() } });
    expect(res.available).toBe(false);
    expect(res.n).toBe(0);
    expect(res.note).toBeTruthy();
  });

  it("counts a stop-loss as a correct sell when the price keeps dropping", () => {
    const key = "BBB|2026-06-01";
    const history = [
      pt("2026-01-01", { [key]: -5 }),
      pt("2026-01-10", { [key]: -16 }), // stop fires (<= -15)
      pt("2026-01-20", { [key]: -25 }), // dropped further -> sell was right
    ];
    const res = analyzeSellDirectional({ history, inputs: { [key]: entry() } });
    expect(res.available).toBe(true);
    expect(res.n).toBe(1);
    expect(res.episodes[0]!.droppedFurther).toBe(true);
    expect(res.downHitPct).toBe(100);
  });

  it("counts a stop-loss as a premature sell when the price recovers", () => {
    const key = "CCC|2026-06-01";
    const history = [
      pt("2026-01-01", { [key]: -16 }), // stop fires
      pt("2026-01-20", { [key]: -8 }), // recovered, never went lower -> sell premature
    ];
    const res = analyzeSellDirectional({ history, inputs: { [key]: entry() } });
    expect(res.episodes[0]!.droppedFurther).toBe(false);
    expect(res.downHitPct).toBe(0);
  });

  it("marks a stop at the last mark as pending (not gradable yet)", () => {
    const key = "DDD|2026-06-01";
    const history = [pt("2026-01-01", { [key]: -5 }), pt("2026-01-10", { [key]: -18 })];
    const res = analyzeSellDirectional({ history, inputs: { [key]: entry() } });
    expect(res.available).toBe(false);
    expect(res.pendingN).toBe(1);
    expect(res.n).toBe(0);
  });

  it("aggregates P(down) across multiple stop-loss episodes", () => {
    const inputs: Record<string, InvestSimInputEntry> = {};
    const history: InvestSimHistoryPoint[] = [];
    // 3 correct (drop further) + 1 premature (recovers) -> 75%
    for (let i = 0; i < 3; i += 1) {
      const k = `DOWN${i}|2026-06-01`;
      inputs[k] = entry();
      history.push(pt("2026-01-01", { [k]: -16 }), pt("2026-01-20", { [k]: -30 }));
    }
    const up = "UP0|2026-06-01";
    inputs[up] = entry();
    history.push(pt("2026-01-01", { [up]: -16 }), pt("2026-01-20", { [up]: -2 }));

    const res = analyzeSellDirectional({ history, inputs });
    expect(res.n).toBe(4);
    expect(res.downHitPct).toBe(75);
  });
});
