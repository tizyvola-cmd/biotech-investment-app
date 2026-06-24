import { describe, expect, it } from "vitest";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import {
  buildRealPortfolioAccuracySummary,
  resolvePortfolioPostExitMovePct,
  resolvePortfolioSellSignalResult,
  summarizeRealPortfolioSignalAccuracy,
  type PortfolioSellEnrichContext,
} from "./realPortfolioAccuracy";

function row(partial: Partial<SimOutcomeRow>): SimOutcomeRow {
  return {
    row_key: "X|cd",
    ticker: "X",
    completion_date: "01/01/2026",
    days_to_cd: 30,
    cd_passed: false,
    timing_bucket: "pre",
    timing_label: "pre",
    capital_eur: 5000,
    buy_price_usd: 10,
    pnl_eur: 100,
    pnl_pct: 2,
    outcome: "win",
    outcome_label: "Win",
    is_win: true,
    affidabilita_pct: 65,
    pred7_pp: 5,
    pred_direction_hit: true,
    exit_ts: "2026-06-10T12:00:00.000Z",
    entry_ts: "2026-06-09T12:00:00.000Z",
    ...partial,
  };
}

describe("realPortfolioAccuracy", () => {
  it("computes buy/sell signal precision from backend results", () => {
    const summary = summarizeRealPortfolioSignalAccuracy([
      row({ buy_signal_result: "success", exit_ts: undefined, cd_passed: false }),
      row({ row_key: "Y|cd", buy_signal_result: "failure", exit_ts: undefined, cd_passed: false }),
      row({ row_key: "Z|cd", buy_signal_result: "flat", exit_ts: undefined, cd_passed: false }),
      row({ sell_signal_result: "success" }),
    ]);
    expect(summary.buy.n).toBe(2);
    expect(summary.buy.valuePct).toBe(50);
    expect(summary.sell.n).toBe(1);
    expect(summary.sell.valuePct).toBe(100);
    expect(summary.unverifiedSellEvitaCount).toBe(0);
  });

  it("builds closed win rate from realized P&L", () => {
    const closed = [
      row({ pnl_eur: 100, is_win: true }),
      row({ row_key: "L|cd", pnl_eur: -50, is_win: false, pnl_pct: -1 }),
    ];
    const full = buildRealPortfolioAccuracySummary(
      [...closed, row({ row_key: "O|cd", decision_current_open: true })],
      closed,
    );
    expect(full.closed?.winRatePct).toBe(50);
    expect(full.closedRowCount).toBe(2);
  });

  it("reports sell coverage for exited positions", () => {
    const full = buildRealPortfolioAccuracySummary(
      [
        row({ sell_signal_result: "success", exit_ts: "2026-06-10T12:00:00.000Z", cd_passed: true }),
        row({
          row_key: "Y|cd",
          sell_signal_result: "pending",
          exit_ts: "2026-06-11T12:00:00.000Z",
          cd_passed: true,
        }),
        row({
          row_key: "Z|cd",
          sell_signal_result: "not_applicable",
          exit_ts: undefined,
          cd_passed: false,
        }),
      ],
      [],
    );
    expect(full.sellCoverage).toEqual({
      executedCount: 2,
      scoredCount: 1,
      missingPplanCount: 0,
      missingPostMoveCount: 1,
      pendingFlatCount: 0,
    });
  });

  it("enriches pending portfolio SELL from sim spot vs derived exit price", () => {
    const pendingRow = row({
      row_key: "ABC|cd",
      ticker: "ABC",
      sell_signal_result: "pending",
      exit_ts: "2026-06-10T12:00:00.000Z",
      cd_passed: true,
      buy_price_usd: 10,
      pnl_pct: 0,
    });
    const sellCtx: PortfolioSellEnrichContext = {
      simRowByKey: new Map([
        [
          "ABC|cd",
          {
            Ticker: "ABC",
            "Prezzo Corrente ($)": 9,
          },
        ],
      ]),
      pointsBySeriesKey: new Map(),
    };
    const move = resolvePortfolioPostExitMovePct(pendingRow, sellCtx);
    expect(move).toBe(-10);
    expect(resolvePortfolioSellSignalResult(pendingRow, sellCtx)).toBe("success");

    const summary = summarizeRealPortfolioSignalAccuracy([pendingRow], sellCtx);
    expect(summary.sell.n).toBe(1);
    expect(summary.sell.valuePct).toBe(100);
    expect(summary.sell.good).toBe(1);
  });

  it("uses backend sell_signal_after_move_pct when present", () => {
    const r = row({
      sell_signal_result: "pending",
      exit_ts: "2026-06-10T12:00:00.000Z",
      cd_passed: true,
      sell_signal_after_move_pct: 3,
    } as Partial<SimOutcomeRow>);
    expect(resolvePortfolioPostExitMovePct(r, null)).toBe(3);
    expect(resolvePortfolioSellSignalResult(r, null)).toBe("failure");
  });
});
