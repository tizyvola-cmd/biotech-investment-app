import { describe, expect, it } from "vitest";
import {
  computeWeekMinPriceUsd,
  formatBuyMinPriceUsd,
  minPriceFromIntradaySeries,
  priceAtOrBelowBuyMinTarget,
  resolvePriceLowsUsd,
  resolveLowSpotSignal,
  resolveLowSpotSignals,
  resolvePriceDollarSignal,
  LOW_NEAR_SPOT_MAX_PREMIUM_PCT,
  WEEK_MIN_LOOKBACK_DAYS,
} from "./earlyPeakBuyMinTarget";
import type { ChartPoint } from "../types";

function chartAtOffsets(
  pairs: Array<[number, number]>,
): { row: Record<string, unknown>; pts: ChartPoint[] } {
  const pts: ChartPoint[] = pairs.map(([offset, price]) => ({
    offset,
    price_storico_usd: price,
  }));
  const maxOff = Math.max(...pairs.map(([o]) => o));
  // CD chosen so completionDateToNowOffset ≈ maxOff (last point = "now").
  const cd = new Date();
  cd.setDate(cd.getDate() - maxOff);
  const iso = cd.toISOString().slice(0, 10);
  return { row: { "Completion Date": iso }, pts };
}

describe("earlyPeakBuyMinTarget", () => {
  it("computes min price over 7 calendar days from chart", () => {
    const { row, pts } = chartAtOffsets([
      [-10, 12],
      [-7, 10],
      [-5, 8.5],
      [-3, 9],
      [-1, 11],
      [0, 13],
    ]);
    expect(computeWeekMinPriceUsd(row, pts)).toBe(8.5);
    expect(WEEK_MIN_LOOKBACK_DAYS).toBe(7);
  });

  it("formats USD prices for chip labels", () => {
    expect(formatBuyMinPriceUsd(4.125)).toBe("$4.125");
    expect(formatBuyMinPriceUsd(42.5)).toBe("$42.50");
  });

  it("detects live price at weekly minimum within tolerance", () => {
    expect(priceAtOrBelowBuyMinTarget(10.02, 10)).toBe(true);
    expect(priceAtOrBelowBuyMinTarget(10.5, 10)).toBe(false);
  });

  it("24h low uses session/intraday, not 1 CD calendar day", () => {
    const row = { "Completion Date": "2026-09-01", "Var. Giorn. %": 10, "Prezzo Corrente ($)": 110 };
    const pts = [{ offset: -20, price_storico_usd: 80 }, { offset: 0, price_storico_usd: 110 }];
    const lows = resolvePriceLowsUsd({
      simRow: row,
      chartPts: pts,
      intradayLive: [
        { t: "2026-01-01T15:00:00Z", price: 95 },
        { t: "2026-01-01T16:00:00Z", price: 102 },
      ],
    });
    expect(lows.weekMinUsd).toBe(80);
    expect(lows.dayMinUsd).toBe(95);
    expect(lows.dayMinUsd).not.toBe(lows.weekMinUsd);
  });

  it("flags green $ below low, yellow $ when near (not below)", () => {
    expect(LOW_NEAR_SPOT_MAX_PREMIUM_PCT).toBe(2);
    expect(resolveLowSpotSignal(1.335, 1.345)).toBe("below");
    expect(resolveLowSpotSignal(107.03, 107.03)).toBe("near");
    expect(resolveLowSpotSignal(105.64, 105.33)).toBe("near");
    expect(resolveLowSpotSignal(110, 100)).toBe("above");
    const mixed = resolveLowSpotSignals(1.09, 1.175, 1.08);
    expect(mixed.week).toBe("below");
    expect(mixed.day).toBe("near");
    expect(resolvePriceDollarSignal(mixed)).toBe("below");
    expect(resolvePriceDollarSignal(resolveLowSpotSignals(110, 100, 95))).toBe(null);
  });

  it("falls back to intraday series min", () => {
    expect(
      minPriceFromIntradaySeries(
        [{ t: "2026-01-01T15:00:00Z", price: 9.2 }],
        [{ t: "2026-01-02T15:00:00Z", price: 8.7 }],
      ),
    ).toBe(8.7);
  });
});
