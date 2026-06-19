import { describe, expect, it } from "vitest";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SdsRow } from "../api/supernova";
import { runContinuousLossRegression } from "./continuousFeatureRegression";

function row(args: {
  ticker: string;
  pnlPct: number;
  pplanPct?: number | null;
  daysToCd?: number;
  entrySlope20d?: number | null;
}): SimOutcomeRow {
  return {
    row_key: `${args.ticker}|cd`,
    ticker: args.ticker,
    completion_date: "2026-06-01",
    days_to_cd: args.daysToCd ?? 30,
    cd_passed: false,
    timing_bucket: "pre_cd",
    timing_label: "Pre-CD",
    capital_eur: 1000,
    pnl_eur: (args.pnlPct / 100) * 1000,
    pnl_pct: args.pnlPct,
    outcome: args.pnlPct > 0 ? "win" : "loss",
    outcome_label: args.pnlPct > 0 ? "Win" : "Loss",
    is_win: args.pnlPct > 0,
    affidabilita_pct: args.pplanPct ?? 60,
    entry_affidabilita_pct: args.pplanPct ?? 60,
    entry_slope_20d: args.entrySlope20d ?? null,
    exit_ts: null,
  } as SimOutcomeRow;
}

describe("runContinuousLossRegression", () => {
  it("flags features that are systematically LOWER in losses (positive lossIndicator)", () => {
    // Losses always have low P(plan); wins always have high P(plan).
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 8; i += 1) trades.push(row({ ticker: `L${i}`, pnlPct: -10, pplanPct: 25 }));
    for (let i = 0; i < 8; i += 1) trades.push(row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 75 }));

    const r = runContinuousLossRegression(trades);
    const pplan = r.features.find((f) => f.key === "pplanPct")!;
    // meanLoss ~25, meanWin ~75, sd ~25 → lossIndicator ~ (75-25)/25 = 2
    expect(pplan.meanLoss).toBeCloseTo(25, 0);
    expect(pplan.meanWin).toBeCloseTo(75, 0);
    expect(pplan.lossIndicator).toBeGreaterThan(1);
    // Strong positive Pearson(pplan, pnl)
    expect(pplan.corrWithPnl).toBeGreaterThan(0.9);
    // Slope on standardised feature should be strongly positive
    expect(pplan.regressionSlopeStdized).toBeGreaterThan(0);
  });

  it("flags features that are systematically HIGHER in losses (negative lossIndicator)", () => {
    // Losses always have lots of days to CD; wins are short.
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 8; i += 1)
      trades.push(row({ ticker: `L${i}`, pnlPct: -10, daysToCd: 120 }));
    for (let i = 0; i < 8; i += 1)
      trades.push(row({ ticker: `W${i}`, pnlPct: 10, daysToCd: 15 }));

    const r = runContinuousLossRegression(trades);
    const dtc = r.features.find((f) => f.key === "daysToCd")!;
    expect(dtc.meanLoss).toBeGreaterThan(dtc.meanWin);
    // lossIndicator is (win - loss)/sd, so it's NEGATIVE when loss > win
    expect(dtc.lossIndicator).toBeLessThan(-1);
    expect(dtc.corrWithPnl).toBeLessThan(-0.9);
  });

  it("returns ~0 indicators when the feature is non-discriminating", () => {
    // Random-looking slope, balanced losses/wins
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 8; i += 1)
      trades.push(row({ ticker: `L${i}`, pnlPct: -10, entrySlope20d: 0.4 }));
    for (let i = 0; i < 8; i += 1)
      trades.push(row({ ticker: `W${i}`, pnlPct: 10, entrySlope20d: 0.4 }));
    const r = runContinuousLossRegression(trades);
    const slope = r.features.find((f) => f.key === "slope20d")!;
    // No variance in slope → stdDev=0 → lossIndicator=0
    expect(slope.lossIndicator).toBe(0);
    expect(slope.corrWithPnl).toBe(0);
  });

  it("ranks features by |lossIndicator| desc", () => {
    // pplan separates strongly; slope barely
    const trades: SimOutcomeRow[] = [];
    for (let i = 0; i < 10; i += 1)
      trades.push(
        row({ ticker: `L${i}`, pnlPct: -10, pplanPct: 25, entrySlope20d: 0.1 }),
      );
    for (let i = 0; i < 10; i += 1)
      trades.push(
        row({ ticker: `W${i}`, pnlPct: 10, pplanPct: 75, entrySlope20d: 0.2 }),
      );
    const r = runContinuousLossRegression(trades);
    expect(r.features[0].key).toBe("pplanPct");
  });

  it("respects buyRecOnly filter (entry_affidabilita_pct >= minBuyRecPct)", () => {
    const trades: SimOutcomeRow[] = [
      row({ ticker: "A", pnlPct: -10, pplanPct: 20 }), // excluded (below 50%)
      row({ ticker: "B", pnlPct: -10, pplanPct: 55 }), // included
      row({ ticker: "C", pnlPct: 10, pplanPct: 80 }), // included
      row({ ticker: "D", pnlPct: 10, pplanPct: 30 }), // excluded
    ];
    const r = runContinuousLossRegression(trades, {}, { buyRecOnly: true });
    expect(r.totalTrades).toBe(2);
    expect(r.filter).toBe("buyRecOnly");
  });

  it("joins SDS scores from sdsRows by ticker (uppercase)", () => {
    const trades: SimOutcomeRow[] = [
      row({ ticker: "aaa", pnlPct: -10 }),
      row({ ticker: "bbb", pnlPct: 10 }),
    ];
    const sdsRows: SdsRow[] = [
      { ticker: "AAA", sds: 20 } as SdsRow,
      { ticker: "BBB", sds: 80 } as SdsRow,
    ];
    const r = runContinuousLossRegression(trades, { sdsRows });
    const sds = r.features.find((f) => f.key === "sdsScore")!;
    expect(sds.n).toBe(2);
    expect(sds.meanLoss).toBe(20);
    expect(sds.meanWin).toBe(80);
  });
});
