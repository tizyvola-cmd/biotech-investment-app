/**
 * Deep audit for sim loop + synth loop health — run from tests or DevTools console.
 */
import type { DecisionSimState, DecisionSimTick } from "./investDecisionSimLoop";
import { sanitizeLiveExperimentPiggy } from "./decisionSimPnlResolve";
import { sanitizePaperMovePct } from "./investDecisionSimExperiment";
import { DECISION_SIM_MAX_TICKS } from "./investDecisionSimStorage";

export type SimLoopDiagnosticSeverity = "info" | "warn" | "critical";

export type SimLoopDiagnosticFinding = {
  id: string;
  severity: SimLoopDiagnosticSeverity;
  message: string;
  detail?: string;
};

export type SimLoopDiagnosticStats = {
  paperPositions: number;
  ticks: number;
  closedTrades: number;
  cumulativeClosedPnlEur: number;
  piggyTotalPnlEur: number | null;
  piggyClosedPnlEur: number | null;
  piggyOpenMtmPnlEur: number | null;
  enabled: boolean;
  experimentMode: boolean;
  lastTickAt: string | null;
  estimatedStorageBytes: number | null;
  compactTicksWithoutPiggy: number;
  invalidMarks: number;
};

export type SimLoopDiagnosticReport = {
  at: string;
  findings: SimLoopDiagnosticFinding[];
  stats: SimLoopDiagnosticStats;
  /** No warn/critical findings. */
  healthy: boolean;
};

function sumSellPnlFromTicks(ticks: DecisionSimTick[]): number {
  let sum = 0;
  for (const tick of ticks) {
    for (const tr of tick.trades) {
      if (tr.side === "sell" && tr.pnlEurSimulated != null && Number.isFinite(tr.pnlEurSimulated)) {
        sum += tr.pnlEurSimulated;
      }
    }
  }
  return Math.round(sum * 100) / 100;
}

function countCompactTicksMissingPiggy(ticks: DecisionSimTick[]): number {
  let n = 0;
  for (const tick of ticks) {
    const compact = (tick.evaluations?.length ?? 0) === 0;
    const hasPiggy = tick.summary?.piggyBank != null;
    const hasPortfolio = (tick.portfolioAfter?.length ?? 0) > 0;
    if (compact && hasPortfolio && !hasPiggy) n += 1;
  }
  return n;
}

function countInvalidMarks(state: DecisionSimState): number {
  let n = 0;
  for (const pos of state.paperPortfolio) {
    if (sanitizePaperMovePct(pos.lastMarkPct) == null && pos.lastMarkPct != null) n += 1;
  }
  return n;
}

function lastTickPortfolioMismatch(state: DecisionSimState): boolean {
  const last = state.ticks[state.ticks.length - 1];
  if (!last) return false;
  const afterKeys = new Set((last.portfolioAfter ?? []).map((p) => p.key));
  const liveKeys = new Set(state.paperPortfolio.map((p) => p.key));
  if (afterKeys.size !== liveKeys.size) return true;
  for (const k of afterKeys) {
    if (!liveKeys.has(k)) return true;
  }
  return false;
}

/** Repair piggy / obvious inconsistencies after load (non-destructive). */
export function repairDecisionSimState(state: DecisionSimState): DecisionSimState {
  const { piggy } = sanitizeLiveExperimentPiggy(state.piggyBank, state.cumulativePaperPnlEur);
  const sellSum = sumSellPnlFromTicks(state.ticks);
  const closedTol = Math.max(50, Math.abs(sellSum) * 0.05 + 25);
  const closedTradeCount = state.ticks.reduce(
    (n, t) => n + t.trades.filter((tr) => tr.side === "sell").length,
    0,
  );

  let cumulativePaperPnlEur = state.cumulativePaperPnlEur;
  if (Math.abs(cumulativePaperPnlEur - sellSum) > closedTol && state.ticks.length > 0) {
    cumulativePaperPnlEur = sellSum;
  }

  return {
    ...state,
    piggyBank: piggy,
    cumulativePaperPnlEur,
    closedTradeCount: Math.max(state.closedTradeCount, closedTradeCount),
  };
}

/** Full sim-loop state audit. Pass `storageJsonBytes` when checking localStorage size. */
export function auditDecisionSimState(
  state: DecisionSimState,
  opts?: { storageJsonBytes?: number | null },
): SimLoopDiagnosticReport {
  const findings: SimLoopDiagnosticFinding[] = [];
  const piggy = state.piggyBank;
  const sellSum = sumSellPnlFromTicks(state.ticks);
  const closedTol = Math.max(75, Math.abs(sellSum) * 0.06 + 50);

  if (state.config.enabled && state.config.experimentMode) {
    findings.push({
      id: "experiment_active",
      severity: "info",
      message: "Sim loop experiment mode is enabled — auto ticks run Mon–Fri 15:00–22:59 Rome.",
    });
  }

  if (state.paperPortfolio.length > 40) {
    findings.push({
      id: "large_paper_book",
      severity: "warn",
      message: `Paper portfolio has ${state.paperPortfolio.length} open positions (no cap).`,
      detail: "Each hourly tick evaluates the full Simulation sheet — large books increase CPU load and crash risk.",
    });
  }

  if (state.paperPortfolio.length > 80) {
    findings.push({
      id: "very_large_paper_book",
      severity: "critical",
      message: `Paper portfolio has ${state.paperPortfolio.length} positions — likely to freeze the tab on tick.`,
    });
  }

  if (Math.abs(state.cumulativePaperPnlEur - sellSum) > closedTol && state.ticks.length > 0) {
    findings.push({
      id: "closed_pnl_drift",
      severity: "warn",
      message: `cumulativePaperPnlEur (${state.cumulativePaperPnlEur}) ≠ sum of sell trades (${sellSum}).`,
      detail: "Can happen after silent save failure or partial tick. Run repairDecisionSimState on load.",
    });
  }

  const piggySan = sanitizeLiveExperimentPiggy(piggy, state.cumulativePaperPnlEur);
  if (piggySan.adjusted) {
    findings.push({
      id: "piggy_inconsistent",
      severity: "warn",
      message: `Piggy bank total (${piggy.totalPnlEur}) inconsistent with closed + open MTM.`,
      detail: `Reason: ${piggySan.reason ?? "unknown"}. Repaired total would be ${piggySan.piggy.totalPnlEur}.`,
    });
  }

  const compactMissing = countCompactTicksMissingPiggy(state.ticks);
  if (compactMissing > 0) {
    findings.push({
      id: "compact_ticks_no_piggy",
      severity: "warn",
      message: `${compactMissing} compact tick(s) store open positions but no piggyBank snapshot.`,
      detail: "Chart P&L may show catch-up cliffs until history is ramped (see simLoopPulseView).",
    });
  }

  const invalidMarks = countInvalidMarks(state);
  if (invalidMarks > 0) {
    findings.push({
      id: "invalid_marks",
      severity: "warn",
      message: `${invalidMarks} paper position(s) have invalid lastMarkPct (NaN or |pct|>500).`,
    });
  }

  if (lastTickPortfolioMismatch(state)) {
    findings.push({
      id: "portfolio_tick_mismatch",
      severity: "critical",
      message: "paperPortfolio keys do not match last tick portfolioAfter.",
      detail: "State may be corrupted — last tick save may have failed mid-write.",
    });
  }

  if (state.ticks.length >= DECISION_SIM_MAX_TICKS) {
    findings.push({
      id: "ticks_at_cap",
      severity: "info",
      message: `Tick history at storage cap (${DECISION_SIM_MAX_TICKS}). Oldest ticks are trimmed on save.`,
    });
  }

  const storageBytes = opts?.storageJsonBytes ?? null;
  if (storageBytes != null && storageBytes > 4_500_000) {
    findings.push({
      id: "storage_near_quota",
      severity: "critical",
      message: `Decision sim localStorage ~${(storageBytes / 1_000_000).toFixed(1)} MB — save may fail silently.`,
    });
  } else if (storageBytes != null && storageBytes > 2_000_000) {
    findings.push({
      id: "storage_large",
      severity: "warn",
      message: `Decision sim localStorage ~${(storageBytes / 1_000_000).toFixed(1)} MB.`,
    });
  }

  if (!state.config.enabled && state.ticks.length > 0 && state.lastTickAt) {
    const lastMs = Date.parse(state.lastTickAt);
    const hoursAgo = Number.isFinite(lastMs) ? (Date.now() - lastMs) / 3_600_000 : null;
    if (hoursAgo != null && hoursAgo < 24) {
      findings.push({
        id: "recently_disabled",
        severity: "info",
        message: `Sim loop disabled but last tick was ${hoursAgo.toFixed(1)}h ago.`,
        detail: "May indicate auto-stop after expiry or manual stop after an error.",
      });
    }
  }

  const healthy = !findings.some((f) => f.severity === "warn" || f.severity === "critical");

  return {
    at: new Date().toISOString(),
    findings,
    stats: {
      paperPositions: state.paperPortfolio.length,
      ticks: state.ticks.length,
      closedTrades: state.closedTradeCount,
      cumulativeClosedPnlEur: state.cumulativePaperPnlEur,
      piggyTotalPnlEur: piggy.totalPnlEur ?? null,
      piggyClosedPnlEur: piggy.closedPnlEur ?? null,
      piggyOpenMtmPnlEur: piggy.openMtmPnlEur ?? null,
      enabled: state.config.enabled,
      experimentMode: state.config.experimentMode,
      lastTickAt: state.lastTickAt,
      estimatedStorageBytes: storageBytes,
      compactTicksWithoutPiggy: compactMissing,
      invalidMarks,
    },
    healthy,
  };
}

/** Format report for console.log in DevTools. */
export function formatSimLoopDiagnosticReport(report: SimLoopDiagnosticReport): string {
  const lines = [
    `=== Sim loop diagnostic (${report.at}) ===`,
    `healthy: ${report.healthy}`,
    `positions: ${report.stats.paperPositions} | ticks: ${report.stats.ticks} | closed: ${report.stats.closedTrades}`,
    `cum closed €: ${report.stats.cumulativeClosedPnlEur} | piggy total €: ${report.stats.piggyTotalPnlEur}`,
    `enabled: ${report.stats.enabled} | experiment: ${report.stats.experimentMode} | last tick: ${report.stats.lastTickAt ?? "—"}`,
  ];
  if (report.stats.estimatedStorageBytes != null) {
    lines.push(`storage est: ${(report.stats.estimatedStorageBytes / 1024).toFixed(0)} KB`);
  }
  for (const f of report.findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.id}: ${f.message}`);
    if (f.detail) lines.push(`  → ${f.detail}`);
  }
  return lines.join("\n");
}
