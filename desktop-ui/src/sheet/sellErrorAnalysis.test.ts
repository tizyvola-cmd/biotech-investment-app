import { describe, expect, it } from "vitest";
import { analyzeSellErrors, buildAcceptanceBreakdown } from "./sellErrorAnalysis";
import type { InvestSimHistoryPoint, InvestSimInputEntry } from "./investSimStorage";

function isoDay(i: number): string {
  const d = new Date(Date.UTC(2025, 0, 1));
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString();
}

function historyFromSeries(seriesByKey: Record<string, number[]>): InvestSimHistoryPoint[] {
  const len = Math.max(...Object.values(seriesByKey).map((s) => s.length));
  const points: InvestSimHistoryPoint[] = [];
  for (let i = 0; i < len; i += 1) {
    const byTicker: InvestSimHistoryPoint["byTicker"] = {};
    for (const [key, series] of Object.entries(seriesByKey)) {
      if (i < series.length) byTicker[key] = { value: 0, pnl: 0, pnlPct: series[i]! };
    }
    points.push({ ts: isoDay(i), capital: 0, value: 0, pnl: 0, pnlPct: 0, byTicker });
  }
  return points;
}

const input = (capital: number, entryProbPct: number | null): InvestSimInputEntry =>
  ({ buyPrice: 1, capital, entryProbPct }) as InvestSimInputEntry;

describe("analyzeSellErrors", () => {
  it("counts a missed sell (held, price fell) and its € erosion", () => {
    const history = historyFromSeries({ "FALL|x": [0, -2, -5, -9, -13, -17, -20] });
    const res = analyzeSellErrors({
      history,
      inputs: { "FALL|x": input(1000, 30) },
      eisScoreForKey: () => -20,
    });
    expect(res.missedSellCount).toBe(1);
    expect(res.prematureCount).toBe(0);
    // erosion ≈ capital × |forward move| / 100 > 0
    expect(res.missedSellErosionEur).toBeGreaterThan(0);
  });

  it("counts a premature-if-followed signal (price rebounded) as cost, not erosion", () => {
    const history = historyFromSeries({ "REB|x": [0, -2, -5, -3, 1, 4, 6] });
    const res = analyzeSellErrors({
      history,
      inputs: { "REB|x": input(1000, 30) },
      eisScoreForKey: () => -20,
    });
    expect(res.prematureCount).toBe(1);
    expect(res.missedSellCount).toBe(0);
    expect(res.prematureCostEur).toBeGreaterThan(0);
  });

  it("excludes closed positions (capital 0) from the € impact", () => {
    const history = historyFromSeries({ "FALL|x": [0, -2, -5, -9, -13, -17, -20] });
    const res = analyzeSellErrors({
      history,
      inputs: { "FALL|x": input(0, 30) },
      eisScoreForKey: () => -20,
    });
    expect(res.available).toBe(false);
    expect(res.rows).toHaveLength(0);
  });
});

describe("buildAcceptanceBreakdown", () => {
  const opts = { minPplanPct: 50, minSds: 30 };

  it("accepts a strong BUY and buckets the rejections by reason", () => {
    const res = buildAcceptanceBreakdown(
      [
        { ticker: "OK", suggestedAction: "buy", sds: 60, pplanPct: 70 },
        { ticker: "LOWP", suggestedAction: "buy", sds: 60, pplanPct: 40 },
        { ticker: "LOWSDS", suggestedAction: "buy", sds: 10, pplanPct: 70 },
        { ticker: "HOLD", suggestedAction: "hold", sds: 60, pplanPct: 70 },
        { ticker: "NOSDS", suggestedAction: "buy", sds: null, pplanPct: 70 },
      ],
      opts,
    );
    expect(res.total).toBe(5);
    expect(res.accepted).toBe(1);
    expect(res.byReason.belowPplan).toBe(1);
    expect(res.byReason.belowSds).toBe(1);
    expect(res.byReason.notBuy).toBe(1);
    expect(res.byReason.unknown).toBe(1);
    expect(res.rejected).toBe(4);
  });
});
