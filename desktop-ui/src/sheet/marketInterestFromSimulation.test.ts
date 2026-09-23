import { describe, expect, it } from "vitest";
import { readDeltaPricePct5d } from "./marketInterestFromSimulation";

describe("readDeltaPricePct5d — MII ΔP source (weekly + monthly blend)", () => {
  it("blends 50/50 slope5 and Var.1M when both are present", () => {
    // Real case (MSLE 2026-07-16): Var.1M=+60.14, slope5=-2.29
    //   weekly:  -2.29 × 5     = -11.47
    //   monthly: +60.14 × 5/22 = +13.67
    //   blend:   (-11.47 + 13.67) / 2 = 1.10
    // Rationale: pure monthly (+13.67) misses the ipercomprato retrace,
    // pure weekly (-11.47) throws away the whole 1M uptrend. Blend keeps
    // the trend memory but dampens it — MSLE from +43° down to ~+3.4°.
    const { pct, source } = readDeltaPricePct5d({
      "Var. 1M %": 60.14,
      "slope≈5g": -2.29,
      "Var. Giorn. %": -2.83,
    });
    expect(pct).toBeCloseTo(1.1, 1);
    expect(source).toContain("50%");
  });

  it("blends catalyst spike correctly (ERNA case)", () => {
    // ERNA 2026-07-16: Var.1M=-11.45 (pre-catalyst drawdown), slope5=+2.70
    // (fresh positive readout). Monthly alone would give -11.45×5/22=-2.60
    // → MII slightly negative. Weekly alone would give +2.70×5=+13.5 →
    // MII very positive. Blend = (13.5 - 2.6) / 2 = 5.45 → MII moderately
    // positive, which correctly reflects that a new regime just started
    // but the market hasn't fully re-priced yet.
    const { pct } = readDeltaPricePct5d({
      "Var. 1M %": -11.45,
      "slope≈5g": 2.6981,
      "Var. Giorn. %": 11.06,
    });
    expect(pct).toBeGreaterThan(0);
    expect(pct).toBeLessThan(13.5);
    expect(pct).toBeCloseTo(5.45, 1);
  });

  it("falls back to monthly-only when slope5 is missing", () => {
    const { pct, source } = readDeltaPricePct5d({ "Var. 1M %": 22 });
    expect(pct).toBeCloseTo(5.0, 1);
    expect(source).toContain("slope5d n/a");
  });

  it("falls back to weekly-only when Var.1M is missing", () => {
    const { pct, source } = readDeltaPricePct5d({ "slope≈5g": 3 });
    expect(pct).toBeCloseTo(15, 1);
    expect(source).toContain("Var.1M n/a");
  });

  it("falls back to daily×5 only when nothing else is available", () => {
    const { pct, source } = readDeltaPricePct5d({ "Var. Giorn. %": 2 });
    expect(pct).toBeCloseTo(10, 1);
    expect(source).toContain("fallback");
  });

  it("returns 0/missing when no source is available at all", () => {
    const { pct, source } = readDeltaPricePct5d({});
    expect(pct).toBe(0);
    expect(source).toBe("missing");
  });

  it("blend halves the sign flip rate when weekly and monthly disagree", () => {
    // ACRV-like case: Var.1M very positive, slope5 slightly negative.
    // Pure monthly would fire PASS on a stale uptrend; pure weekly would
    // fire BLOCK on a single bad day. Blend lands in WATCH territory,
    // which is exactly the right verdict for "uptrend cooling off".
    const { pct } = readDeltaPricePct5d({
      "Var. 1M %": 40,
      "slope≈5g": -0.4,
    });
    // weekly: -2.0, monthly: 9.09, blend: 3.55
    expect(pct).toBeCloseTo(3.55, 1);
  });
});
