import type { PaperPosition } from "./investDecisionSimLoop";
import type {
  GapInvestigationRecord,
  GapInvestigationUserDecision,
} from "./gapInvestigationTypes";
import { GAP_INVESTIGATION_LOG_MAX } from "./gapInvestigationTypes";

export function pendingGapInvestigationRecords(
  log: GapInvestigationRecord[] | undefined | null,
): GapInvestigationRecord[] {
  if (!log?.length) return [];
  return log.filter((r) => r.status === "pending");
}

export function applyGapSizeDecisionToPortfolio(
  portfolio: PaperPosition[],
  rowKey: string,
  decision: Extract<GapInvestigationUserDecision, { kind: "reduce" } | { kind: "add" }>,
): PaperPosition[] {
  const idx = portfolio.findIndex((p) => p.key === rowKey);
  if (idx < 0) return portfolio;

  const pos = portfolio[idx]!;
  const current = pos.capital ?? 0;
  if (!(current > 0)) return portfolio;

  let nextCap = current;
  if (decision.kind === "reduce") {
    nextCap = Math.max(0, Math.round((current - decision.amountEur) * 100) / 100);
  } else {
    nextCap = Math.round((current + decision.amountEur) * 100) / 100;
  }

  if (nextCap <= 0) {
    return portfolio.filter((p) => p.key !== rowKey);
  }

  const next = [...portfolio];
  next[idx] = { ...pos, capital: nextCap };
  return next;
}

export function appendGapInvestigationRecord(
  log: GapInvestigationRecord[],
  record: GapInvestigationRecord,
): GapInvestigationRecord[] {
  return [...log, record].slice(-GAP_INVESTIGATION_LOG_MAX);
}

export function resolveGapInvestigationRecord(
  log: GapInvestigationRecord[],
  recordId: string,
  decision: GapInvestigationUserDecision,
  decidedAt: string = new Date().toISOString(),
): GapInvestigationRecord[] {
  return log.map((r) =>
    r.id === recordId
      ? {
          ...r,
          status: "decided",
          userDecision: decision,
          decidedAt,
        }
      : r,
  );
}

export function markGapInvestigationIgnored(
  log: GapInvestigationRecord[],
  recordId: string,
): GapInvestigationRecord[] {
  return resolveGapInvestigationRecord(log, recordId, { kind: "ignored" });
}
