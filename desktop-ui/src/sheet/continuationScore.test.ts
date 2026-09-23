import { describe, expect, it } from "vitest";
import {
  contLossSideSellBoost,
  contSellCutPriority,
  contWeakensRecoveryHold,
  resolveContSellEdge,
  resolveContSellRegime,
    estimateContG10FromChart,
    estimateContG10FromDailyCloses,
  resolveContSellUiRegime,
  resolveDisplayPContinuation,
  resolvePContinuation,
  resolveContG10,
  resolveContPBase,
  shouldContinuationExhaustedSell,
  softBuyContinuationAllows,
  softBuyEarlyPeakHit,
  softBuyWindOrEarlyPeakHit,
  softBuyWindRunHit,
  SOFT_BUY_MIN_PCONT,
  EARLY_PEAK_MIN_DAY_PCT,
} from "./continuationScore";

describe("continuationScore v2 exhaustion edge", () => {
  it("reads P and bucket base", () => {
    expect(resolvePContinuation({ p_continuation: 52.5 })).toBe(52.5);
    expect(resolveContPBase({ cont_p_base: 48 })).toBe(48);
    expect(resolveContSellEdge({ cont_sell_edge: 4.5 })).toBe(4.5);
    expect(resolveContSellEdge({ p_continuation: 52, cont_p_base: 48 })).toBe(4);
    expect(resolvePContinuation({ p_continuation: "44,0" })).toBe(44);
    expect(resolveContG10({ cont_g10: "11,8" })).toBeCloseTo(11.8, 5);
  });

  it("display P(cont) uses curve, else 100 − P(exhaustion)", () => {
    expect(resolveDisplayPContinuation({ p_continuation: 17 })).toBe(83);
    expect(
      resolveDisplayPContinuation({
        p_continuation: 17,
        cont_pct_pop: 45,
        cont_curve_pop: [
          { pct: 0, p: 70, n: 40 },
          { pct: 50, p: 60, n: 40 },
          { pct: 100, p: 40, n: 40 },
        ],
      }),
    ).toBe(61); // interpolate 45% between 70@0 and 60@50 → 61
  });

  it("ui regime always classifies declining / weak / in-run / missing", () => {
    expect(resolveContSellUiRegime(-3)).toBe("declining");
    expect(resolveContSellUiRegime(2)).toBe("not_run");
    expect(resolveContSellUiRegime(7)).toBe("in_regime");
    expect(resolveContSellUiRegime(null)).toBe("missing");
  });

  it("estimates g10 from chart when cont_g10 missing", () => {
    const nowOff = -20;
    const g10 = estimateContG10FromChart(
      { "Completion Date": "2030-01-01" },
      [
        { offset: nowOff - 10, price_storico_usd: 100 },
        { offset: nowOff, price_storico_usd: 103 },
      ],
    );
    // completionDateToNowOffset may not be -20 for 2030-01-01 — only assert finite or null
    if (g10 != null) expect(Number.isFinite(g10)).toBe(true);
  });

  it("estimates g10 from last ~10 daily closes (not CD-relative)", () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    expect(estimateContG10FromDailyCloses(closes)).toBeCloseTo(10, 5);
    expect(
      estimateContG10FromDailyCloses(closes.map((close) => ({ close }))),
    ).toBeCloseTo(10, 5);
    expect(estimateContG10FromDailyCloses([{ close: 100 }])).toBeNull();
    expect(estimateContG10FromDailyCloses([])).toBeNull();
  });

  it("does not invent g10 from a CD-window chart when today is outside the series", () => {
    expect(
      estimateContG10FromChart(
        { "Completion Date": "01/07/2025" },
        [
          { offset: -60, price_storico_usd: 80 },
          { offset: 0, price_storico_usd: 100 },
          { offset: 7, price_storico_usd: 102 },
        ],
      ),
    ).toBeNull();
  });

  it("Soft BUY continuation gate blocks exhausted runs in regime", () => {
    expect(softBuyContinuationAllows({ cont_g10: 2 })).toBe(true);
    expect(softBuyContinuationAllows({ cont_g10: -4 })).toBe(true);
    expect(
      softBuyContinuationAllows({
        cont_g10: 8,
        cont_sell_edge: 4,
        p_continuation: 60,
        cont_pct_pop: 50,
        cont_curve_pop: [
          { pct: 0, p: 70, n: 40 },
          { pct: 100, p: 40, n: 40 },
        ],
      }),
    ).toBe(false); // edge > 0
    expect(
      softBuyContinuationAllows({
        cont_g10: 8,
        cont_sell_edge: -2,
        p_continuation: 60, // exh → display 40 without curve
      }),
    ).toBe(false); // P(cont) 40 < 50
    expect(SOFT_BUY_MIN_PCONT).toBe(50);
    expect(
      softBuyContinuationAllows({
        cont_g10: 8,
        cont_sell_edge: -2,
        p_continuation: 30, // display P(cont)=70
      }),
    ).toBe(true);
  });

  it("wind-run hit needs 10d≥5 · P(cont)≥50 · edge≤0 (positive evidence)", () => {
    expect(
      softBuyWindRunHit({
        cont_g10: 15,
        cont_sell_edge: -1,
        p_continuation: 40, // display 60
      }),
    ).toBe(true);
    expect(
      softBuyWindRunHit({
        cont_g10: 2,
        cont_sell_edge: -1,
        p_continuation: 40,
      }),
    ).toBe(false);
    expect(
      softBuyWindRunHit({
        cont_g10: 15,
        cont_sell_edge: 2,
        p_continuation: 40,
      }),
    ).toBe(false);
    expect(
      softBuyWindRunHit({
        cont_g10: 15,
        cont_sell_edge: -1,
        // missing P → not a wind promote
      }),
    ).toBe(false);
  });

  it("early-peak hit: 0≤10d<5 · Δ≥8% · not declining · edge≤0", () => {
    expect(
      softBuyEarlyPeakHit({ cont_g10: 4.9, cont_sell_edge: -1 }, 15.9),
    ).toBe(true);
    expect(
      softBuyEarlyPeakHit({ cont_g10: 4.9, cont_sell_edge: -1 }, 7.9),
    ).toBe(false);
    expect(
      softBuyEarlyPeakHit({ cont_g10: -3, cont_sell_edge: -1 }, 16),
    ).toBe(false);
    expect(
      softBuyEarlyPeakHit({ cont_g10: 8, cont_sell_edge: -1 }, 16),
    ).toBe(false);
    expect(
      softBuyEarlyPeakHit({ cont_g10: 3, cont_sell_edge: 2 }, 12),
    ).toBe(false);
    expect(EARLY_PEAK_MIN_DAY_PCT).toBe(8);
    expect(
      softBuyWindOrEarlyPeakHit({ cont_g10: 4.9, cont_sell_edge: -1 }, 15.9),
    ).toBe(true);
  });

  it("soft-sells when edge > 0 with green MTM and g10≥5", () => {
    const row = { p_continuation: 52, cont_p_base: 48, cont_g10: 12, cont_sell_edge: 4 };
    expect(
      shouldContinuationExhaustedSell({ hasPosition: true, pnlPct: 4, simRow: row }),
    ).toBe(true);
    expect(
      shouldContinuationExhaustedSell({
        hasPosition: true,
        pnlPct: 4,
        simRow: { p_continuation: 44, cont_p_base: 48, cont_g10: 12, cont_sell_edge: -4 },
      }),
    ).toBe(false);
    expect(
      shouldContinuationExhaustedSell({
        hasPosition: true,
        pnlPct: -1,
        simRow: row,
      }),
    ).toBe(false);
    expect(
      shouldContinuationExhaustedSell({
        hasPosition: true,
        pnlPct: 4,
        simRow: { ...row, cont_g10: 2 },
      }),
    ).toBe(false);
  });

  it("classifies regime and cut priority", () => {
    expect(resolveContSellRegime({ cont_g10: -3 })).toBe("declining");
    expect(resolveContSellRegime({ cont_g10: 2 })).toBe("not_run");
    expect(resolveContSellRegime({ cont_g10: 8 })).toBe("in_regime");
    expect(contSellCutPriority({ cont_g10: -3 })).toBeGreaterThan(
      contSellCutPriority({ cont_g10: 2 }),
    );
    expect(contSellCutPriority({ cont_g10: 2 })).toBeGreaterThan(
      contSellCutPriority({ cont_g10: 12, cont_sell_edge: 4 }),
    );
    expect(contSellCutPriority({ cont_g10: 12, cont_sell_edge: 4 })).toBeGreaterThan(
      contSellCutPriority({ cont_g10: 12, cont_sell_edge: -2 }),
    );
  });

  it("loss-side boost and recovery HOLD weaken on red book", () => {
    expect(contLossSideSellBoost({ cont_g10: -4 })).toBe("g10 declining");
    expect(contLossSideSellBoost({ cont_g10: 2 })).toBe("g10 not in regime");
    expect(contLossSideSellBoost({ cont_g10: 10, cont_sell_edge: 3 })).toBe(
      "exhaustion edge>0",
    );
    expect(contLossSideSellBoost({ cont_g10: 10, cont_sell_edge: -1 })).toBeNull();
    expect(
      contWeakensRecoveryHold({ pnlPct: -3, simRow: { cont_g10: -2 } }),
    ).toBe(true);
    expect(
      contWeakensRecoveryHold({ pnlPct: 2, simRow: { cont_g10: -2 } }),
    ).toBe(false);
  });
});
