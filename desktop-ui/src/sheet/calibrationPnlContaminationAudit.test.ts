import { describe, expect, it } from "vitest";
import { auditCalibrationOutcomesForEngineB } from "./calibrationPnlContaminationAudit";

describe("calibrationPnlContaminationAudit — Engine B vs Calibration Center", () => {
  it("verifies shrinkage path does not consume Engine B leg-sum", () => {
    const report = auditCalibrationOutcomesForEngineB([
      {
        ticker: "RYTM",
        completion_date: "15/09/2026",
        row_key: "RYTM|2026-09-15",
        buy_price_usd: 90,
        capital_eur: 12_500,
        pnl_pct: 5,
        outcome: "open",
      },
      {
        ticker: "NRIX",
        completion_date: "31/08/2026",
        row_key: "NRIX|2026-08-31",
        buy_price_usd: 17.73,
        capital_eur: 12_500,
        exit_pnl_pct_at_event: 3.6,
        pnl_pct: 3.6,
        outcome: "success",
      },
    ]);

    expect(report.engineBFeedsCalibrationCenter).toBe(false);
    expect(report.rows.every((r) => !r.engineBPathPossible)).toBe(true);
    expect(report.verdict).toContain("VERIFIED");
    expect(report.approvedProposalIdsNeedingReview).toEqual([]);
  });

  it("flags sheet-fallback rows separately from Engine B", () => {
    const report = auditCalibrationOutcomesForEngineB([
      {
        ticker: "OLD",
        completion_date: "01/01/2026",
        buy_price_usd: 0,
        capital_eur: 5000,
        pnl_pct: 12,
        outcome: "success",
      },
    ]);

    expect(report.sheetFallbackRowKeys).toEqual(["OLD|01/01/2026"]);
    expect(report.rows[0]?.engineBPathPossible).toBe(false);
    expect(report.verdict).toContain("Engine B leg-sum did NOT feed");
  });
});
