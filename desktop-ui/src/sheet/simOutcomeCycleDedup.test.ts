import { describe, expect, it } from "vitest";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import {
  collapseSimOutcomeCycleRows,
  closedValidationOutcomeRowsFromDoc,
  simOutcomePositionBaseKey,
} from "./simOutcomeCycleDedup";

function row(partial: Partial<SimOutcomeRow> & Pick<SimOutcomeRow, "row_key" | "ticker" | "completion_date">): SimOutcomeRow {
  return {
    days_to_cd: 30,
    cd_passed: true,
    timing_bucket: "",
    timing_label: "",
    capital_eur: 5000,
    buy_price_usd: 10,
    pnl_eur: 100,
    pnl_pct: 2,
    outcome: "success",
    outcome_label: "",
    is_win: true,
    affidabilita_pct: 55,
    pred7_pp: null,
    pred_direction_hit: null,
    entry_ts: null,
    entry_affidabilita_pct: 55,
    exit_ts: null,
    exit_pnl_pct_at_event: null,
    exit_pnl_eur_at_event: null,
    decision_current_open: false,
    universe: "simloop",
    ...partial,
  };
}

describe("simOutcomeCycleDedup", () => {
  it("simOutcomePositionBaseKey strips #cycle suffix", () => {
    const r = row({
      row_key: "NRIX|2026-08-31#cycle3",
      ticker: "NRIX",
      completion_date: "2026-08-31",
    });
    expect(simOutcomePositionBaseKey(r)).toBe("NRIX|2026-08-31");
  });

  it("keeps latest exit_ts among cycle replays", () => {
    const rows = [
      row({
        row_key: "GPCR|2026-08-26#cycle1",
        ticker: "GPCR",
        completion_date: "2026-08-26",
        pnl_pct: -1.68,
        exit_ts: "2026-06-24T10:00:00.000Z",
      }),
      row({
        row_key: "GPCR|2026-08-26#cycle6",
        ticker: "GPCR",
        completion_date: "2026-08-26",
        pnl_pct: 4.4,
        exit_ts: "2026-06-25T10:00:00.000Z",
      }),
    ];
    const out = collapseSimOutcomeCycleRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0]?.row_key).toBe("GPCR|2026-08-26#cycle6");
    expect(out[0]?.pnl_pct).toBe(4.4);
  });

  it("prefers #cycle rows over bare row_key sibling", () => {
    const rows = [
      row({
        row_key: "KPTI|2026-06-30",
        ticker: "KPTI",
        completion_date: "2026-06-30",
        pnl_pct: 7.11,
        exit_ts: "",
      }),
      row({
        row_key: "KPTI|2026-06-30#cycle1",
        ticker: "KPTI",
        completion_date: "2026-06-30",
        pnl_pct: 0,
        exit_ts: "2026-06-16T10:00:00.000Z",
      }),
    ];
    const out = collapseSimOutcomeCycleRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0]?.row_key).toBe("KPTI|2026-06-30#cycle1");
    expect(out[0]?.pnl_pct).toBe(0);
  });

  it("closedValidationOutcomeRowsFromDoc skips open rows and collapses cycles", () => {
    const doc = {
      rows: [
        row({
          row_key: "AAA|2026-01-01#cycle1",
          ticker: "AAA",
          completion_date: "2026-01-01",
          pnl_pct: 1,
          exit_ts: "2026-06-01T00:00:00.000Z",
        }),
        row({
          row_key: "AAA|2026-01-01#cycle2",
          ticker: "AAA",
          completion_date: "2026-01-01",
          pnl_pct: 3,
          exit_ts: "2026-06-02T00:00:00.000Z",
        }),
        row({
          row_key: "BBB|2026-02-01",
          ticker: "BBB",
          completion_date: "2026-02-01",
          decision_current_open: true,
          pnl_pct: 5,
        }),
      ],
    };
    const out = closedValidationOutcomeRowsFromDoc(doc);
    expect(out).toHaveLength(1);
    expect(out[0]?.ticker).toBe("AAA");
    expect(out[0]?.pnl_pct).toBe(3);
  });
});
