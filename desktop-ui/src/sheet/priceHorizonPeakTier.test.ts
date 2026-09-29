import { describe, expect, it } from "vitest";
import { computePricePeakTier } from "./priceHorizonPeakTier";

function bars(closes: number[], start = "2026-01-02"): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = [];
  let d = new Date(`${start}T12:00:00Z`);
  for (const close of closes) {
    out.push({ date: d.toISOString().slice(0, 10), close });
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

describe("computePricePeakTier", () => {
  it("tier 4 when live price equals highs on all horizons", () => {
    const daily = bars(Array.from({ length: 130 }, (_, i) => 10 + i * 0.05));
    const r = computePricePeakTier({
      dailyBars: daily,
      livePrice: daily[daily.length - 1]!.close,
      asOfDate: daily[daily.length - 1]!.date,
    });
    expect(r.tier).toBe(4);
    expect(r.matched).toEqual(["1w", "1m", "3m", "6m"]);
  });

  it("tier 0 when live price below recent range", () => {
    const daily = bars([12, 11, 10, 9, 8, 7, 6, 5]);
    const r = computePricePeakTier({
      dailyBars: daily,
      livePrice: 4,
      asOfDate: daily[daily.length - 1]!.date,
    });
    expect(r.tier).toBe(0);
  });
});
