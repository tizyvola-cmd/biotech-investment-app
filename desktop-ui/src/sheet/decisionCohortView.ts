import type { DecisionCohortDoc } from "../data/investmentDecisionData";
import type { CohortHistoryDoc } from "../data/modelLearningsData";

export type DecisionCohortHistoryPoint = {
  label: string;
  hitPct: number | null;
  ts: string | null;
  nEvents: number | null;
};

export type DecisionCohortView = {
  currentHitPct: number | null;
  previousHitPct: number | null;
  hitDeltaPp: number | null;
  updatedAt: string | null;
  nEvents: number | null;
  historyPoints: DecisionCohortHistoryPoint[];
  hasChart: boolean;
};

function dayLabel(iso: string | undefined | null): string {
  if (!iso) return "—";
  return String(iso).slice(0, 10);
}

function parseHit(v: unknown): number | null {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(v);
}

function pointFromSnapshot(
  generatedAt: string | undefined,
  summary: { hit_rate_pct?: number | null; n_events?: number | null } | undefined,
): DecisionCohortHistoryPoint | null {
  const hitPct = parseHit(summary?.hit_rate_pct);
  if (hitPct == null) return null;
  const ts = generatedAt ?? null;
  return {
    label: dayLabel(ts ?? undefined),
    hitPct,
    ts,
    nEvents: summary?.n_events ?? null,
  };
}

export function buildDecisionCohortView(
  cohort: DecisionCohortDoc | null | undefined,
  cohortHistory: CohortHistoryDoc | null | undefined,
): DecisionCohortView {
  const comparison = cohort?.comparison;
  const currentHitPct =
    parseHit(comparison?.summary_after?.hit_rate_pct) ??
    parseHit(cohort?.summary?.hit_rate_pct);
  const previousHitPct = parseHit(comparison?.summary_before?.hit_rate_pct);
  const hitDeltaPp =
    comparison?.summary_delta?.hit_rate_pct ??
    (currentHitPct != null && previousHitPct != null
      ? Math.round((currentHitPct - previousHitPct) * 10) / 10
      : null);
  const updatedAt =
    comparison?.current_at ?? cohort?.generated_at ?? null;
  const nEvents =
    comparison?.summary_after?.n_events ?? cohort?.summary?.n_events ?? null;

  const byTs = new Map<string, DecisionCohortHistoryPoint>();

  for (const snap of cohortHistory?.snapshots ?? []) {
    const pt = pointFromSnapshot(snap.generated_at, snap.summary);
    if (pt?.ts) byTs.set(pt.ts, pt);
  }

  for (const snap of cohort?.history_tail ?? []) {
    const pt = pointFromSnapshot(snap.generated_at, snap.summary);
    if (pt?.ts) byTs.set(pt.ts, pt);
  }

  if (currentHitPct != null && updatedAt) {
    byTs.set(updatedAt, {
      label: dayLabel(updatedAt),
      hitPct: currentHitPct,
      ts: updatedAt,
      nEvents,
    });
  }

  const historyPoints = [...byTs.values()].sort((a, b) =>
    String(a.ts ?? "").localeCompare(String(b.ts ?? "")),
  );

  return {
    currentHitPct,
    previousHitPct,
    hitDeltaPp,
    updatedAt,
    nEvents,
    historyPoints,
    hasChart: historyPoints.length >= 2,
  };
}

export function decisionHitTone(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "text-ink";
  if (pct >= 58) return "text-positive";
  if (pct >= 52) return "text-warn";
  return "text-negative";
}
