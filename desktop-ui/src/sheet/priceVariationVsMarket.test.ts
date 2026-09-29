import { describe, expect, it } from "vitest";
import {
  pctReturnTradingDaysAgo,
  resolveXbiHorizonVariationsFromCloses,
} from "./xbiMarketVariations";
import {
  buildPriceVariationWindows,
  getDeltaLabel,
  pctToDollarDelta,
  windowDelta,
} from "./priceVariationVsMarket";

describe("xbiMarketVariations", () => {
  it("computes 1D return from consecutive closes", () => {
    const pct = pctReturnTradingDaysAgo(
      [
        { date: "2026-01-01", close: 100 },
        { date: "2026-01-02", close: 105 },
      ],
      1,
    );
    expect(pct).toBe(5);
  });

  it("returns null when insufficient bars", () => {
    expect(pctReturnTradingDaysAgo([{ date: "2026-01-01", close: 100 }], 7)).toBeNull();
  });

  it("resolves all horizons from close series", () => {
    const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.5);
    const vars = resolveXbiHorizonVariationsFromCloses(closes);
    expect(vars["1D"]).not.toBeNull();
    expect(vars["6M"]).not.toBeNull();
    expect(vars["1Y"]).not.toBeNull();
  });
});

describe("priceVariationVsMarket", () => {
  it("getDeltaLabel classifies outperform / underperform / inline", () => {
    expect(getDeltaLabel(2).style).toBe("out");
    expect(getDeltaLabel(-2).style).toBe("under");
    expect(getDeltaLabel(0.2).style).toBe("inline");
  });

  it("buildPriceVariationWindows merges ticker sheet + XBI snapshot", () => {
    const closes = Array.from({ length: 260 }, (_, i) => 200 - i * 0.1);
    const windows = buildPriceVariationWindows({
      simRow: {
        "Var. Giorn. %": 1.5,
        "Var. 7d %": -2,
        "Var. 1M %": 5,
        "Var. 3M %": -14.5,
        "Var. 6M %": 8,
      },
      marketDoc: {
        series: {
          XBI: closes.map((close, i) => ({
            date: `2025-06-${String((i % 28) + 1).padStart(2, "0")}`,
            close,
          })),
        },
      },
    });
    expect(windows).toHaveLength(6);
    expect(windows[0]?.tickerChange).toBe(1.5);
    expect(windows[3]?.tickerChange).toBe(-14.5);
    expect(windows[3]?.marketChange).not.toBeNull();
    const delta = windowDelta(windows[3]!.tickerChange, windows[3]!.marketChange);
    expect(delta).not.toBeNull();
    if (delta != null) expect(getDeltaLabel(delta).style).toBe("under");
  });

  it("uses null for missing ticker horizons", () => {
    const windows = buildPriceVariationWindows({ simRow: {} });
    expect(windows.every((w) => w.tickerChange == null)).toBe(true);
    expect(windows.every((w) => w.tickerDeltaUsd == null)).toBe(true);
  });

  describe("pctToDollarDelta", () => {
    it("computes Δ$ from current price and % change", () => {
      // P_now = 11.5, pct = -4.26 → past ≈ 12.01 → Δ$ ≈ -0.51
      expect(pctToDollarDelta(11.5, -4.26)).toBeCloseTo(-0.51, 2);
    });

    it("returns positive Δ$ for a gain", () => {
      // P_now = 10, pct = +25 → past = 8 → Δ$ = +2
      expect(pctToDollarDelta(10, 25)).toBeCloseTo(2, 2);
    });

    it("returns 0 when pct is 0", () => {
      expect(pctToDollarDelta(15, 0)).toBe(0);
    });

    it("returns null on invalid inputs", () => {
      expect(pctToDollarDelta(null, 5)).toBeNull();
      expect(pctToDollarDelta(10, null)).toBeNull();
      expect(pctToDollarDelta(0, 5)).toBeNull();
      // Divergent denominator (pct = -100 ⇒ past price was 0 ⇒ undefined).
      expect(pctToDollarDelta(10, -100)).toBeNull();
    });
  });

  it("buildPriceVariationWindows populates tickerDeltaUsd from current price", () => {
    const windows = buildPriceVariationWindows({
      simRow: {
        "Prezzo Corrente ($)": 12,
        "Var. Giorn. %": 5,
        "Var. 7d %": -10,
      },
    });
    const d1 = windows.find((w) => w.window === "1D");
    const d7 = windows.find((w) => w.window === "7D");
    expect(d1?.tickerDeltaUsd).toBeCloseTo(0.57, 2); // 12 × 5 / 105
    expect(d7?.tickerDeltaUsd).toBeCloseTo(-1.33, 2); // 12 × -10 / 90
  });

  it("buildPriceVariationWindows leaves tickerDeltaUsd null when price is missing", () => {
    const windows = buildPriceVariationWindows({
      simRow: { "Var. Giorn. %": 5 },
    });
    expect(windows.every((w) => w.tickerDeltaUsd == null)).toBe(true);
  });
});
