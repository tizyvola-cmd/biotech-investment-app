import { describe, expect, it } from "vitest";
import type { PortfolioGainChartRow } from "../components/PortfolioGainPlanChart";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import {
  buildMtmBackfillActualAnchors,
  rampStaleFlatAnchorsToLive,
  tickPulseSeriesLooksLikeCatchUpSpike,
} from "./pulseMtmBackfill";
import { buildPortfolioGainPlanAggregateSeries } from "./dashboardPulseAggregate";

function chartRow(args: Partial<PortfolioGainChartRow> & { key: string; capital: number; investedAt: string }): PortfolioGainChartRow {
  return {
    name: args.key,
    ticker: args.key.split("|")[0] ?? args.key,
    pnlEur: args.pnlEur ?? 500,
    pnlUnavailable: false,
    expectedHoldDays: 30,
    daysToTarget: 30,
    expectedGainEur: 200,
    expectedGainPct: 20,
    targetGainPct: 25,
    holdDaysElapsed: 6,
    buyPriceUsd: args.buyPriceUsd ?? 10,
    currentPriceUsd: 11,
    simRow: args.simRow ?? { "Completion Date": "2026-09-28" },
    chartPoints: args.chartPoints ?? null,
    ...args,
  };
}

describe("pulseMtmBackfill", () => {
  it("ramps stale flat anchors toward live instead of cliff at today only", () => {
    const anchors = new Map<number, number>([[3, 0]]);
    rampStaleFlatAnchorsToLive(anchors, 6, 1500);
    expect(anchors.get(0)).toBe(0);
    expect(anchors.get(3)).toBeGreaterThan(400);
    expect(anchors.get(3)).toBeLessThan(1100);
    expect(anchors.get(6)).toBeCloseTo(1500, 0);
  });

  it("detects tick series catch-up spike pattern", () => {
    expect(
      tickPulseSeriesLooksLikeCatchUpSpike(
        [
          { ts: "a", label: "d0", planned: 100, actual: 0 },
          { ts: "b", label: "d6", planned: 100, actual: 0 },
          { ts: "c", label: "now", planned: 100, actual: 1523 },
        ],
        1523,
      ),
    ).toBe(true);
  });

  it("builds gradual anchors when history stored zero open MTM", () => {
    const row = chartRow({
      key: "AAA|2026-09-28",
      capital: 5000,
      investedAt: "2026-06-12T10:00:00.000Z",
      pnlEur: 277,
      chartPoints: null,
    });
    const history: InvestSimHistoryPoint[] = [
      {
        ts: "2026-06-15T12:00:00.000Z",
        capital: 5000,
        value: 5000,
        pnl: 0,
        pnlPct: 0,
        byTicker: { "AAA|2026-09-28": { value: 5000, pnl: 0, pnlPct: 0 } },
      },
    ];

    const anchors = buildMtmBackfillActualAnchors(row, history, 6, 277);
    const midKey = [...anchors.keys()].find((k) => k > 0.5 && k < 5.5);
    expect(midKey).toBeDefined();
    expect(anchors.get(midKey!)).toBeGreaterThan(40);
    expect(anchors.get(6)).toBeCloseTo(277, 0);
  });

  it("aggregate chart uses hold-day backfill when tick history catch-up spikes", () => {
    const investedAt = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const midTs = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const lastTs = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const rows = [
      chartRow({
        key: "AAA|2026-09-28",
        capital: 5000,
        investedAt,
        pnlEur: 1523,
      }),
    ];
    const history: InvestSimHistoryPoint[] = [
      {
        ts: midTs,
        capital: 5000,
        value: 5000,
        pnl: 0,
        pnlPct: 0,
        byTicker: { "AAA|2026-09-28": { value: 5000, pnl: 0, pnlPct: 0 } },
      },
      {
        ts: lastTs,
        capital: 5000,
        value: 5000,
        pnl: 0,
        pnlPct: 0,
        byTicker: { "AAA|2026-09-28": { value: 5000, pnl: 0, pnlPct: 0 } },
      },
      {
        ts: new Date().toISOString(),
        capital: 5000,
        value: 6523,
        pnl: 1523,
        pnlPct: 30,
        byTicker: { "AAA|2026-09-28": { value: 6523, pnl: 1523, pnlPct: 30 } },
      },
    ];

    const series = buildPortfolioGainPlanAggregateSeries(rows, history, null, "en");
    expect(
      tickPulseSeriesLooksLikeCatchUpSpike(
        history.map((h, i) => ({
          ts: h.ts,
          label: `t${i}`,
          planned: 100,
          actual: h.pnl,
        })),
        1523,
      ),
    ).toBe(true);
    const actuals = series
      .map((p) => p.actual)
      .filter((v): v is number => v != null && Number.isFinite(v));
    expect(actuals.length).toBeGreaterThan(2);
    expect(actuals[actuals.length - 1]).toBeCloseTo(1523, 0);
    if (actuals.length >= 3) {
      const mid = actuals[Math.floor(actuals.length / 2)]!;
      expect(mid).toBeGreaterThan(50);
      expect(mid).toBeLessThan(1450);
    }
  });

  /*
   * Regression: for a real position with historical chartPoints where the
   * interpolated day-0 price differs from the user's actual buy price
   * (typical for high-momentum biotechs — e.g. VIR up +65% in 6M), the
   * previous implementation overwrote anchor[0] with a phantom pnl derived
   * from (capital / buyUsd) * chartPriceAtDay0 − capital. On the
   * Gain-vs-Plan chart this produced a spurious multi-thousand-euro spike
   * at the entry. Anchor at hold-day 0 must always be exactly €0 for real
   * positions.
   */
  it("keeps anchor[0] = €0 even when chart entry price ≠ user's buy price", () => {
    const investedAt = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const completionDate = new Date(Date.now() + 90 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    /*
     * VIR-like scenario: user bought at $12 recently, but the ticker's
     * chartPoints series carries older historical closes with prices in
     * the $7–$8 range at the entry offset — the interpolation there is
     * legitimately far from the actual fill. Without the fix,
     * pnl[0] = (10_000 / 12) * 7 − 10_000 ≈ −€4_167 (huge phantom
     * negative). With the fix, anchor[0] = 0 as expected.
     */
    const chartPoints = [
      { offset: -100, price_storico_usd: 7, price_usd: 7 },
      { offset: -80, price_storico_usd: 8, price_usd: 8 },
      { offset: -95, price_storico_usd: 7.5, price_usd: 7.5 },
      { offset: 0, price_usd: 13 },
      { offset: 10, price_usd: 15 },
    ] as unknown as PortfolioGainChartRow["chartPoints"];

    const row = chartRow({
      key: "VIR|test",
      capital: 10_000,
      buyPriceUsd: 12,
      currentPriceUsd: 12.5,
      investedAt,
      pnlEur: 400,
      simRow: { "Completion Date": completionDate },
      chartPoints,
      holdDaysElapsed: 5,
    });

    const anchors = buildMtmBackfillActualAnchors(row, [], 5, 400);
    expect(anchors.get(0)).toBe(0);
    const positiveKeys = [...anchors.keys()].filter((k) => k > 0);
    expect(positiveKeys.length).toBeGreaterThan(0);
  });

  /*
   * Regression (CHRS scenario, Jul 2026): fixing anchor[0] alone is not
   * enough — the phantom spike migrated to anchor[1] because
   * ``backfillActualAnchorsFromChart`` uses the formula
   *   pnl[d] = (capital / userBuy) * chartPrice[d] − capital
   * If chartPrice[d] differs from userBuy (chart interpolation clamps to a
   * distant historical close, or the ticker gapped intraday), the amplified
   * ``capital / userBuy`` factor produces a several-thousand-euro artifact
   * at hold-day 1, which visually looks like a near-vertical spike at
   * x ≈ 0 in the Gain-vs-Plan chart — the user then sees the actual line
   * "start" from a phantom high and drop toward today's live P&L,
   * inconsistent with the actual price-variation panel above the chart.
   *
   * Fix: chart backfill must anchor to chartPrice[hold-day 0] (chart-
   * relative return), not to userBuy — so pnl[d] = 0 when chartPrice[d] ==
   * chartPrice[0], regardless of divergence between chart and user's fill.
   */
  it("does not produce a phantom spike at hold-day 1 when chart price near entry diverges from user buy", () => {
    const investedAt = new Date(Date.now() - 45 * 86_400_000).toISOString();
    const completionDate = new Date(Date.now() + 85 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    /*
     * CHRS-like: user fill $10 (real trade), but the chartPoints series
     * carries a large historical run-up in the -180 → -80 offset window
     * (interpolation clamps hold-day 1 back to that region because the
     * series doesn't extend all the way to the entry offset). The chart
     * price at hold-day 1 comes back as ~$10.7 — ~7 % higher than the
     * user's fill. With the old formula, pnl[1] ≈ (10 000 / 10) * 10.7 −
     * 10 000 = +€700 for a €10k position; scale to €80k capital and this
     * balloons to +€5 600 — the phantom spike in the screenshot.
     */
    const chartPoints = [
      { offset: -180, price_storico_usd: 10.7, price_usd: 10.7 },
      { offset: -170, price_storico_usd: 10.65, price_usd: 10.65 },
      { offset: -160, price_storico_usd: 10.6, price_usd: 10.6 },
      // No points between −160 and 0 — interpolation clamps hold-day 1
      // (which is around offset −129 here) to the leftmost point at $10.7.
      { offset: 0, price_usd: 9.925 },
      { offset: 30, price_usd: 10 },
    ] as unknown as PortfolioGainChartRow["chartPoints"];

    const row = chartRow({
      key: "CHRS|test",
      capital: 80_000,
      buyPriceUsd: 10,
      currentPriceUsd: 9.925,
      investedAt,
      pnlEur: -599,
      simRow: { "Completion Date": completionDate },
      chartPoints,
      holdDaysElapsed: 45,
    });

    const anchors = buildMtmBackfillActualAnchors(row, [], 45, -599);

    /*
     * anchor[0] pinned by our earlier guard.
     */
    expect(anchors.get(0)).toBe(0);

    /*
     * anchor[1] is the phantom-spike site: with the buggy formula this
     * anchor sits at roughly +€5 600 (~7 % of €80k capital), producing a
     * visual near-vertical up-spike right after entry. Once the chart
     * backfill anchors to the chart's OWN entry price (chart-relative
     * return), pnl[1] should reflect the real chart delta from hold-day 0
     * → hold-day 1, which is small (single-digit percent of capital at
     * most) and bounded well below the live P&L magnitude.
     */
    const anchor1 = anchors.get(1);
    if (anchor1 != null) {
      /*
       * Chart-relative anchor at hold-day 1 must not exceed a small
       * fraction of the position value — well under €2 000 on €80k
       * capital. Anything approaching €5 000+ is the phantom spike.
       */
      expect(Math.abs(anchor1)).toBeLessThan(2_000);
    }

    /*
     * Guard against interpolation between anchor[0]=0 and a spurious
     * anchor[1] producing large intermediate values.
     */
    for (const [key, val] of anchors) {
      if (key >= 0 && key <= 2) {
        expect(Math.abs(val)).toBeLessThan(2_000);
      }
    }
  });
});
