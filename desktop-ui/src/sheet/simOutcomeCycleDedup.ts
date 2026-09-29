/**
 * Collapse sim-loop `#cycleN` replay rows to one closed round-trip per ticker|CD.
 * Used by Model Quality validation and Bayesian calibration (not raw outcomes audit).
 */
import {
  isSimOutcomeOpen,
  type SimOutcomeRow,
  type SimOutcomesDoc,
} from "../data/investmentSimOutcomesData";

/** `TICKER|YYYY-MM-DD` — strips optional `#cycleN` suffix from row_key. */
export function simOutcomePositionBaseKey(r: SimOutcomeRow): string {
  const raw = (r.row_key ?? "").trim();
  const base = raw.split("#cycle", 1)[0]?.trim();
  if (base) return base.toUpperCase();
  const cd = (r.completion_date ?? "").slice(0, 10);
  return `${(r.ticker ?? "").trim().toUpperCase()}|${cd}`;
}

function cycleIndex(rowKey: string): number {
  const m = rowKey.match(/#cycle(\d+)/i);
  return m ? Number(m[1]) : 0;
}

function pickLaterClosedOutcome(a: SimOutcomeRow, b: SimOutcomeRow): SimOutcomeRow {
  const aTs = Date.parse(a.exit_ts ?? "");
  const bTs = Date.parse(b.exit_ts ?? "");
  if (Number.isFinite(aTs) && Number.isFinite(bTs) && aTs !== bTs) {
    return aTs > bTs ? a : b;
  }
  if (Number.isFinite(aTs) && !Number.isFinite(bTs)) return a;
  if (!Number.isFinite(aTs) && Number.isFinite(bTs)) return b;

  const ac = cycleIndex(a.row_key ?? "");
  const bc = cycleIndex(b.row_key ?? "");
  if (ac !== bc) return ac > bc ? a : b;

  return (a.pnl_pct ?? -1e9) >= (b.pnl_pct ?? -1e9) ? a : b;
}

/** One row per position key; merges `#cycle` replays on the same ticker|CD. */
export function collapseSimOutcomeCycleRows(rows: SimOutcomeRow[]): SimOutcomeRow[] {
  const byPosition = new Map<string, SimOutcomeRow[]>();
  for (const r of rows) {
    const key = simOutcomePositionBaseKey(r);
    const arr = byPosition.get(key) ?? [];
    arr.push(r);
    byPosition.set(key, arr);
  }

  const out: SimOutcomeRow[] = [];
  for (const group of byPosition.values()) {
    const withCycle = group.filter((r) => cycleIndex(r.row_key ?? "") > 0);
    const pool = withCycle.length > 0 ? withCycle : group;
    let best = pool[0]!;
    for (let i = 1; i < pool.length; i++) {
      best = pickLaterClosedOutcome(best, pool[i]!);
    }
    out.push(best);
  }
  return out;
}

/** Closed, realized-P&L rows for validation charts and shrinkage calibration. */
export function closedValidationOutcomeRowsFromDoc(
  doc: SimOutcomesDoc | null | undefined,
): SimOutcomeRow[] {
  const closed = (doc?.rows ?? []).filter(
    (r) =>
      !isSimOutcomeOpen(r) &&
      r.pnl_pct != null &&
      Number.isFinite(r.pnl_pct),
  );
  return collapseSimOutcomeCycleRows(closed);
}
