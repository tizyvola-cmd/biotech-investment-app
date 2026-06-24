import { describe, expect, it } from "vitest";
import type { InvestSimHistoryPoint, InvestSimInputEntry } from "./investSimStorage";
import { analyzeRescueRebound } from "./recommendationRescue";

function pt(ts: string, byTicker: Record<string, number>): InvestSimHistoryPoint {
  const by: InvestSimHistoryPoint["byTicker"] = {};
  for (const [k, pnlPct] of Object.entries(byTicker)) {
    by[k] = { value: 1000 * (1 + pnlPct / 100), pnl: 1000 * (pnlPct / 100), pnlPct };
  }
  return { ts, capital: 1000, value: 1000, pnl: 0, pnlPct: 0, byTicker: by };
}

function entry(entryProbPct: number | null): InvestSimInputEntry {
  return { buyPrice: 10, capital: 1000, entryProbPct } as InvestSimInputEntry;
}

describe("analyzeRescueRebound", () => {
  it("returns unavailable when no position fell into loss", () => {
    const history = [pt("2026-01-01", { "AAA|2026-03-01": 3 }), pt("2026-01-05", { "AAA|2026-03-01": 5 })];
    const res = analyzeRescueRebound({ history, inputs: { "AAA|2026-03-01": entry(80) } });
    expect(res.available).toBe(false);
    expect(res.n).toBe(0);
    expect(res.note).toBeTruthy();
  });

  it("detects a rebound to >=0 within the horizon and its size", () => {
    const key = "AAA|2026-06-01";
    const history = [
      pt("2026-01-01", { [key]: -1 }), // not yet in loss (> -2)
      pt("2026-01-05", { [key]: -8 }), // loss episode start (trough later)
      pt("2026-01-10", { [key]: -12 }), // trough
      pt("2026-01-20", { [key]: -3 }),
      pt("2026-01-30", { [key]: 2 }), // rebound to >= 0
      pt("2026-02-10", { [key]: 6 }), // peak
    ];
    const res = analyzeRescueRebound({ history, inputs: { [key]: entry(85) } });
    expect(res.available).toBe(true);
    expect(res.n).toBe(1);
    const ep = res.episodes[0]!;
    expect(ep.rebounded).toBe(true);
    expect(ep.daysToRebound).toBe(25); // 2026-01-05 -> 2026-01-30
    expect(ep.troughPct).toBe(-12);
    expect(ep.reboundSizePct).toBe(18); // 6 - (-12)
    expect(res.hitRatePct).toBe(100);
  });

  it("marks no rebound when PnL never returns to >=0 within the horizon", () => {
    const key = "BBB|2026-06-01";
    const history = [
      pt("2026-01-01", { [key]: -5 }),
      pt("2026-01-15", { [key]: -9 }),
      pt("2026-02-15", { [key]: -4 }),
    ];
    const res = analyzeRescueRebound({ history, inputs: { [key]: entry(40) } });
    expect(res.episodes[0]!.rebounded).toBe(false);
    expect(res.episodes[0]!.daysToRebound).toBeNull();
    expect(res.hitRatePct).toBe(0);
  });

  it("excludes points beyond the horizon from the rebound window", () => {
    const key = "CCC|2026-06-01";
    const history = [
      pt("2026-01-01", { [key]: -6 }),
      pt("2026-05-01", { [key]: 4 }), // >60d after loss -> not counted as rebound
    ];
    const res = analyzeRescueRebound({ history, inputs: { [key]: entry(50) }, horizonDays: 60 });
    expect(res.episodes[0]!.rebounded).toBe(false);
  });

  it("buckets episodes by rescue-score tier", () => {
    const inputs: Record<string, InvestSimInputEntry> = {};
    const history: InvestSimHistoryPoint[] = [];
    // high prob -> high score tier, rebounds; low prob -> low tier, no rebound
    for (let i = 0; i < 3; i += 1) {
      const k = `HI${i}|2026-06-01`;
      inputs[k] = entry(95);
      // deep loss + high prob -> rescue score >= 70 (high tier), then rebounds
      history.push(pt("2026-01-01", { [k]: -20 }), pt("2026-01-20", { [k]: 3 }));
    }
    for (let i = 0; i < 3; i += 1) {
      const k = `LO${i}|2026-06-01`;
      inputs[k] = entry(30);
      history.push(pt("2026-01-01", { [k]: -6 }), pt("2026-02-20", { [k]: -2 }));
    }
    const res = analyzeRescueRebound({ history, inputs });
    expect(res.n).toBe(6);
    const high = res.tiers.find((t) => t.tier === "high")!;
    const low = res.tiers.find((t) => t.tier === "low")!;
    expect(high.n).toBe(3);
    expect(high.hitRatePct).toBe(100);
    expect(low.n).toBe(3);
    expect(low.hitRatePct).toBe(0);
  });
});
