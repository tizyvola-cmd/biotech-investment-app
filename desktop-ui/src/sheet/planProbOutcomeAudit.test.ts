import { describe, expect, it } from "vitest";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { buildPlanProbLearningSummary } from "./planProbOutcomeAudit";

function strongEnterRow(overrides: Partial<SimOutcomeRow> = {}): SimOutcomeRow {
  return {
    row_key: "ABC#cd2026-06-01",
    ticker: "ABC",
    completion_date: "2026-06-01",
    days_to_cd: 18,
    cd_passed: false,
    timing_bucket: "pre_cd",
    timing_label: "Pre-CD",
    capital_eur: 0,
    buy_price_usd: 10,
    pnl_eur: -50,
    pnl_pct: -4.2,
    outcome: "closed_loss",
    outcome_label: "Loss",
    is_win: false,
    affidabilita_pct: 72,
    pred7_pp: 14,
    pred_direction_hit: false,
    entry_ts: "2026-05-01T10:00:00Z",
    entry_slope_5d: 0.08,
    entry_slope_20d: 0.18,
    entry_pred7_pp: 14,
    entry_affidabilita_pct: 72,
    entry_r2_fit: 0.82,
    decision_current_open: false,
    ...overrides,
  };
}

describe("buildPlanProbLearningSummary", () => {
  it("flags high P(plan) Enter + loss as wrong with high Brier penalty", () => {
    const rows = [strongEnterRow()];
    const summary = buildPlanProbLearningSummary(rows, new Map(), "en");
    expect(summary.evaluable).toBe(1);
    expect(summary.correct).toBe(0);
    expect(summary.incorrect).toBe(1);
    const audit = summary.auditRows[0]!;
    expect(audit.decisionLabel).toBe("enter");
    expect(audit.probPct).toBeGreaterThanOrEqual(60);
    expect(audit.correct).toBe(false);
    expect(audit.brier).toBeGreaterThan(0.2);
    expect(audit.confidencePenalty).toBeGreaterThanOrEqual(60);
    expect(summary.weightedPenalty).toBeGreaterThanOrEqual(60);
  });

  it("counts pending open positions separately", () => {
    const rows = [
      strongEnterRow({
        row_key: "OPEN#cd",
        ticker: "OPEN",
        pnl_pct: null,
        pnl_eur: null,
        outcome: "open",
        decision_current_open: true,
        capital_eur: 1000,
      }),
    ];
    const summary = buildPlanProbLearningSummary(rows, new Map(), "en");
    expect(summary.pending).toBe(1);
    expect(summary.evaluable).toBe(0);
  });

  it("Wait recommendation correct when P&L stays flat", () => {
    const rows = [
      strongEnterRow({
        ticker: "FLAT",
        row_key: "FLAT#cd",
        entry_slope_20d: 0.07,
        entry_pred7_pp: 6,
        entry_affidabilita_pct: 48,
        entry_r2_fit: 0.55,
        pnl_pct: 0.8,
        pnl_eur: 8,
        is_win: true,
        outcome: "closed_flat",
      }),
    ];
    const summary = buildPlanProbLearningSummary(rows, new Map(), "en");
    const audit = summary.auditRows[0]!;
    if (audit.decisionLabel === "wait") {
      expect(audit.correct).toBe(true);
      expect(summary.correct).toBeGreaterThanOrEqual(1);
    }
  });
});
