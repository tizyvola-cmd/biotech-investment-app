import { describe, expect, it } from "vitest";
import {
  binomialPmf,
  buildProfitProbabilityCurve,
  expectedDailyPnlForPositions,
  extractTradeStatsFromClosedOutcomes,
  minPositionsForConfidence,
  minWinsForPositivePortfolio,
  probPortfolioPositive,
} from "./portfolioDiversificationLab";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";

const closed = (pnlEur: number, capital = 5000): SimOutcomeRow =>
  ({
    row_key: `k-${pnlEur}`,
    ticker: "TST",
    completion_date: "2026-12-01",
    capital_eur: capital,
    pnl_eur: pnlEur,
    pnl_pct: (pnlEur / capital) * 100,
    is_win: pnlEur > 0,
    outcome: pnlEur > 0 ? "win" : "loss",
    outcome_label: pnlEur > 0 ? "Win" : "Loss",
    cd_passed: false,
    timing_bucket: "pre_cd",
    timing_label: "Pre-CD",
    days_to_cd: 30,
  }) as SimOutcomeRow;

describe("portfolioDiversificationLab", () => {
  it("extracts win rate and average win/loss from closed rows", () => {
    const stats = extractTradeStatsFromClosedOutcomes([
      closed(500),
      closed(300),
      closed(-200),
      closed(-150),
    ]);
    expect(stats).not.toBeNull();
    expect(stats!.winCount).toBe(2);
    expect(stats!.lossCount).toBe(2);
    expect(stats!.winRate).toBe(0.5);
    expect(stats!.avgWinEur).toBe(400);
    expect(stats!.avgLossEur).toBe(175);
  });

  it("computes min wins for positive portfolio", () => {
    expect(minWinsForPositivePortfolio(8, 400, 175)).toBe(3);
  });

  it("binomial pmf sums to ~1", () => {
    let sum = 0;
    for (let k = 0; k <= 10; k++) sum += binomialPmf(10, k, 0.6);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("more positions raise confidence when edge is positive", () => {
    const stats = extractTradeStatsFromClosedOutcomes([
      closed(500),
      closed(400),
      closed(350),
      closed(-200),
      closed(-180),
      closed(-150),
    ])!;
    const p1 = probPortfolioPositive(1, stats.winRate, stats.avgWinEur, stats.avgLossEur, 5000);
    const p20 = probPortfolioPositive(20, stats.winRate, stats.avgWinEur, stats.avgLossEur, 5000);
    expect(p20).toBeGreaterThan(p1);
    const curve = buildProfitProbabilityCurve(stats, { maxPositions: 12 });
    expect(curve[0].n).toBe(1);
    expect(curve[curve.length - 1].probPositivePct).toBeGreaterThanOrEqual(curve[0].probPositivePct);
  });

  it("finds min positions for 90% confidence", () => {
    const stats = extractTradeStatsFromClosedOutcomes([
      closed(600),
      closed(550),
      closed(500),
      closed(-200),
      closed(-180),
      closed(-160),
      closed(-140),
    ])!;
    const n90 = minPositionsForConfidence(stats, 90);
    expect(n90).not.toBeNull();
    expect(n90!).toBeGreaterThanOrEqual(2);
  });

  it("estimates expected daily from hold days", () => {
    const rows = [
      {
        ...closed(600),
        holding_days: 10,
        entry_ts: "2026-06-01T12:00:00.000Z",
        exit_ts: "2026-06-11T12:00:00.000Z",
      },
      {
        ...closed(-200),
        holding_days: 20,
        entry_ts: "2026-06-02T12:00:00.000Z",
        exit_ts: "2026-06-22T12:00:00.000Z",
      },
    ];
    const stats = extractTradeStatsFromClosedOutcomes(rows)!;
    expect(stats.avgHoldDays).toBe(15);
    const daily = expectedDailyPnlForPositions(11, stats, 2500);
    expect(daily).not.toBeNull();
    expect(daily!).toBeGreaterThan(0);
  });
});
