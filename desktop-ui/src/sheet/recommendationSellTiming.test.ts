import { describe, expect, it } from "vitest";
import { analyzeSellTiming } from "./recommendationSellTiming";
import type { InvestSimHistoryPoint, InvestSimInputEntry } from "./investSimStorage";

function isoDay(i: number): string {
  const d = new Date(Date.UTC(2025, 0, 1));
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString();
}

/** Build a history where each key follows its own pnlPct series (day-by-day). */
function historyFromSeries(seriesByKey: Record<string, number[]>): InvestSimHistoryPoint[] {
  const len = Math.max(...Object.values(seriesByKey).map((s) => s.length));
  const points: InvestSimHistoryPoint[] = [];
  for (let i = 0; i < len; i += 1) {
    const byTicker: InvestSimHistoryPoint["byTicker"] = {};
    for (const [key, series] of Object.entries(seriesByKey)) {
      if (i < series.length) {
        byTicker[key] = { value: 0, pnl: 0, pnlPct: series[i]! };
      }
    }
    points.push({ ts: isoDay(i), capital: 0, value: 0, pnl: 0, pnlPct: 0, byTicker });
  }
  return points;
}

const input = (entryProbPct: number | null): InvestSimInputEntry =>
  ({ buyPrice: 1, capital: 100, entryProbPct }) as InvestSimInputEntry;

describe("analyzeSellTiming", () => {
  it("flags a falling position before the drop and grades it 'down'", () => {
    const history = historyFromSeries({ "FALL|x": [0, -2, -5, -9, -13, -17, -20] });
    const res = analyzeSellTiming({
      history,
      inputs: { "FALL|x": input(30) },
      eisScoreForKey: () => -20,
    });
    expect(res.signalN).toBe(1);
    const sig = res.signals[0]!;
    expect(sig.result).toBe("down");
    // fired early, with a positive lead vs the end of the path
    expect(sig.leadDays).toBeGreaterThan(0);
    expect(res.pDownPct).toBe(100);
  });

  it("grades a premature sell (price rebounds) as 'up'", () => {
    const history = historyFromSeries({ "REB|x": [0, -2, -5, -3, 1, 4, 6] });
    const res = analyzeSellTiming({
      history,
      inputs: { "REB|x": input(30) },
      eisScoreForKey: () => -20,
    });
    expect(res.signalN).toBe(1);
    expect(res.signals[0]!.result).toBe("up");
    expect(res.pDownPct).toBe(0);
  });

  it("computes P(down) across a down + an up signal", () => {
    const history = historyFromSeries({
      "FALL|x": [0, -2, -5, -9, -13, -17, -20],
      "REB|x": [0, -2, -5, -3, 1, 4, 6],
    });
    const res = analyzeSellTiming({
      history,
      inputs: { "FALL|x": input(30), "REB|x": input(30) },
      eisScoreForKey: () => -20,
    });
    expect(res.gradedN).toBe(2);
    expect(res.pDownPct).toBe(50);
  });

  it("does not fire for a strong, flat position (no weakness signals)", () => {
    const history = historyFromSeries({ "STRONG|x": [0, 0, 0, 0, 0, 0, 0] });
    const res = analyzeSellTiming({
      history,
      inputs: { "STRONG|x": input(95) },
      eisScoreForKey: () => null, // no negative EIS
    });
    expect(res.signalN).toBe(0);
    expect(res.available).toBe(false);
  });

  it("respects custom weights/threshold (a higher threshold suppresses weak signals)", () => {
    const history = historyFromSeries({ "MILD|x": [0, -1, -1, -1, -1, -1, -2] });
    const inputs = { "MILD|x": input(60) };
    const loose = analyzeSellTiming({ history, inputs, eisScoreForKey: () => -5, params: { threshold: 0.2 } });
    const strict = analyzeSellTiming({ history, inputs, eisScoreForKey: () => -5, params: { threshold: 0.95 } });
    expect(loose.signalN).toBeGreaterThanOrEqual(strict.signalN);
    expect(strict.signalN).toBe(0);
  });
});
