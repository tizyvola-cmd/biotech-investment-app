import { describe, expect, it } from "vitest";
import { mergePortfolioAndSimLoopClosedDeals } from "./closedDealsUnion";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";

function simRow(partial: Partial<SimOutcomeRow> & { row_key: string; ticker: string }): SimOutcomeRow {
  return {
    completion_date: "2026-01-15",
    days_to_cd: 30,
    cd_passed: false,
    timing_bucket: "",
    timing_label: "",
    capital_eur: 500,
    buy_price_usd: 10,
    pnl_eur: 50,
    pnl_pct: 10,
    outcome: "win",
    outcome_label: "",
    is_win: true,
    affidabilita_pct: 60,
    pred7_pp: null,
    pred_direction_hit: null,
    decision_current_open: false,
    universe: "simloop",
    ...partial,
  };
}

describe("mergePortfolioAndSimLoopClosedDeals", () => {
  it("adds portfolio sells missing from outcomes", () => {
    const merged = mergePortfolioAndSimLoopClosedDeals({
      simOutcomeRows: [
        simRow({ row_key: "AAA|2026-01-15", ticker: "AAA", pnl_pct: 5 }),
      ],
      investInputs: {
        "BBB|2026-02-01": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          soldAt: "2026-03-01T12:00:00.000Z",
          closedCapital: 1000,
          closedValue: 1100,
          closedPnlEur: 100,
          entryProbPct: 55,
        },
      },
      investHistory: [],
    });
    expect(merged).toHaveLength(2);
    const port = merged.find((r) => r.ticker === "BBB");
    expect(port?.correlationSource).toBe("portfolio");
    expect(port?.pnl_pct).toBeCloseTo(10, 5);
  });

  it("does not duplicate simloop keys already in outcomes", () => {
    const merged = mergePortfolioAndSimLoopClosedDeals({
      simOutcomeRows: [simRow({ row_key: "AAA|2026-01-15", ticker: "AAA" })],
      investInputs: {
        "AAA|2026-01-15": {
          buyPrice: 0,
          capital: 0,
          ignoreSheet: true,
          soldAt: "2026-02-01T00:00:00.000Z",
          closedCapital: 500,
          closedValue: 400,
        },
      },
      investHistory: [],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]!.ticker).toBe("AAA");
  });
});
