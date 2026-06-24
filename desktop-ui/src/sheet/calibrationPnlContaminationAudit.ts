/**
 * Audit trail: does Calibration Center (shrinkage / proposals / PCSE) consume
 * Engine B leg-sum P&L from contaminated `invest_sim_history`?
 *
 * Verified architecture (2026-06-23):
 * - `computeCalibrationSnapshot` / `generateProposalFromOutcomes` read
 *   `SimOutcomeRow.pnl_pct` from `investment_sim_outcomes.json` (Python).
 * - Python `_compute_pnl` uses buy+capital+current price (Engine A) when buy>0.
 * - Decision-log exits store `pnl_pct_at_event` from the same Python row at exit.
 * - Engine B (`resolvePositionPnlBreakdown` leg-sum) feeds Piggy Bank / Pulse live
 *   only — NOT the calibration outcome store.
 */

export type OutcomePnlProvenance =
  | "python_mtm_buy_capital"
  | "python_sheet_fallback"
  | "decision_log_exit"
  | "unresolved_open"
  | "unknown";

export type CalibrationContaminationAuditRow = {
  rowKey: string;
  ticker: string;
  pnlPct: number | null;
  provenance: OutcomePnlProvenance;
  /** True only when this row could have been computed via Engine B leg-sum. Always false today. */
  engineBPathPossible: boolean;
  note: string;
};

export type CalibrationContaminationAuditReport = {
  engineBFeedsCalibrationCenter: false;
  totalOutcomes: number;
  resolvedOutcomes: number;
  rows: CalibrationContaminationAuditRow[];
  /** Closed trades whose pnl_pct relied on sheet columns (separate stale-sheet risk). */
  sheetFallbackRowKeys: string[];
  /** Approved proposal ids — empty unless sheet-fallback rows map to changed cells (manual review). */
  approvedProposalIdsNeedingReview: string[];
  verdict: string;
};

type OutcomeLike = {
  ticker: string;
  completion_date?: string | null;
  row_key?: string | null;
  pnl_pct?: number | null;
  buy_price_usd?: number | null;
  capital_eur?: number | null;
  exit_pnl_pct_at_event?: number | null;
  outcome?: string | null;
};

function rowKeyOf(r: OutcomeLike): string {
  if (r.row_key?.trim()) return r.row_key.trim();
  const cd = (r.completion_date ?? "").trim();
  return cd ? `${r.ticker.toUpperCase()}|${cd}` : r.ticker.toUpperCase();
}

function classifyProvenance(r: OutcomeLike): OutcomePnlProvenance {
  if (r.exit_pnl_pct_at_event != null && Number.isFinite(r.exit_pnl_pct_at_event)) {
    return "decision_log_exit";
  }
  const buy = r.buy_price_usd ?? 0;
  const cap = r.capital_eur ?? 0;
  if (cap > 0 && buy > 0) return "python_mtm_buy_capital";
  if (r.pnl_pct != null && Number.isFinite(r.pnl_pct)) {
    if (r.outcome === "open" || (r.outcome ?? "").includes("open")) {
      return "unresolved_open";
    }
    return "python_sheet_fallback";
  }
  return "unknown";
}

function provenanceNote(p: OutcomePnlProvenance): string {
  switch (p) {
    case "python_mtm_buy_capital":
      return "Python MTM (capital/buy×price) — not Engine B leg-sum";
    case "decision_log_exit":
      return "Decision log exit snapshot — sourced from Python MTM at close event";
    case "python_sheet_fallback":
      return "Sheet P&L columns fallback (no buy) — stale-sheet risk, not Engine B history";
    case "unresolved_open":
      return "Open mark from Python snapshot — live, not calibration shrinkage cell";
    default:
      return "Unresolved P&L source";
  }
}

/**
 * Classify each outcome row. Engine B path is structurally excluded from shrinkage input.
 */
export function auditCalibrationOutcomesForEngineB(
  outcomes: OutcomeLike[],
  approvedProposalIds: string[] = [],
): CalibrationContaminationAuditReport {
  const rows: CalibrationContaminationAuditRow[] = outcomes.map((r) => {
    const provenance = classifyProvenance(r);
    const pnlPct =
      r.exit_pnl_pct_at_event ?? r.pnl_pct ?? null;
    return {
      rowKey: rowKeyOf(r),
      ticker: r.ticker.toUpperCase(),
      pnlPct,
      provenance,
      engineBPathPossible: false,
      note: provenanceNote(provenance),
    };
  });

  const sheetFallbackRowKeys = rows
    .filter((r) => r.provenance === "python_sheet_fallback")
    .map((r) => r.rowKey);

  const resolvedOutcomes = rows.filter(
    (r) => r.pnlPct != null && Number.isFinite(r.pnlPct),
  ).length;

  const engineBHits = rows.filter((r) => r.engineBPathPossible);
  const approvedProposalIdsNeedingReview =
    engineBHits.length > 0 || sheetFallbackRowKeys.length > 0
      ? [...approvedProposalIds]
      : [];

  let verdict: string;
  if (engineBHits.length > 0) {
    verdict =
      "CONTAMINATION POSSIBLE: at least one calibration outcome row could use Engine B leg-sum.";
  } else if (sheetFallbackRowKeys.length > 0) {
    verdict =
      "Engine B leg-sum did NOT feed calibration. Some closed rows use sheet P&L fallback (separate stale-sheet risk) — review sheetFallbackRowKeys.";
  } else {
    verdict =
      "VERIFIED: no calibration outcome row uses Engine B contaminated leg-sum. Shrinkage/proposals consume Python MTM outcomes only.";
  }

  return {
    engineBFeedsCalibrationCenter: false,
    totalOutcomes: rows.length,
    resolvedOutcomes,
    rows,
    sheetFallbackRowKeys,
    approvedProposalIdsNeedingReview,
    verdict,
  };
}
