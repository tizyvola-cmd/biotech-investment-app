/**
 * Ranking unificato errori pendenza: tipo (inversione > contrarian > decelerazione)
 * poi magnitudine |Δ| / impatto. Usato da tab Slope errors e banner Decision Lab.
 */

import type { UnifiedSlopeFeedRow } from "./slopeEventsFeed";
import { slopesFromFeedRow } from "./slopeEventSummary";

/** Priorità tipo errore (maggiore = più grave). */
export const SLOPE_TYPE_PRIORITY: Record<string, number> = {
  slope_rev: 4,
  contrarian: 3,
  slope_dec: 2,
  slope_acc: 1,
};

export function slopeTypePriority(kind: string): number {
  return SLOPE_TYPE_PRIORITY[kind] ?? 0;
}

/** Magnitudine comparabile entro lo stesso tipo. */
export function eventImpactAbs(row: UnifiedSlopeFeedRow): number {
  const { slope5d, slope20d, delta } = slopesFromFeedRow(row);
  if (row.source === "contrarian") {
    const pred = row.contrarianEvent.pred5;
    return (
      Math.abs(slope5d ?? 0) +
      (pred != null && Number.isFinite(pred) ? Math.abs(pred) * 0.12 : 0)
    );
  }
  if (row.kind === "slope_rev") {
    return Math.max(Math.abs(slope5d ?? 0), Math.abs(slope20d ?? 0));
  }
  if (delta != null && Number.isFinite(delta)) return Math.abs(delta);
  return Math.max(Math.abs(slope5d ?? 0), Math.abs(slope20d ?? 0));
}

/** >0 se `a` è peggiore di `b` (rank più alto). */
export function compareSlopeFeedRows(
  a: UnifiedSlopeFeedRow,
  b: UnifiedSlopeFeedRow,
): number {
  const ta = slopeTypePriority(a.kind);
  const tb = slopeTypePriority(b.kind);
  if (ta !== tb) return ta - tb;
  const ia = eventImpactAbs(a);
  const ib = eventImpactAbs(b);
  if (ia !== ib) return ia - ib;
  const ca = a.hasActiveChart ? 1 : 0;
  const cb = b.hasActiveChart ? 1 : 0;
  if (ca !== cb) return ca - cb;
  return a.detected_at - b.detected_at;
}

export type SlopeAlertKind = "reversal" | "contrarian" | "deceleration" | "acceleration";

export const ALERT_KIND_PRIORITY: Record<SlopeAlertKind, number> = {
  reversal: SLOPE_TYPE_PRIORITY.slope_rev,
  contrarian: SLOPE_TYPE_PRIORITY.contrarian,
  deceleration: SLOPE_TYPE_PRIORITY.slope_dec,
  acceleration: SLOPE_TYPE_PRIORITY.slope_acc,
};

export function feedKindToAlertKind(
  kind: UnifiedSlopeFeedRow["kind"],
): SlopeAlertKind | null {
  if (kind === "slope_rev") return "reversal";
  if (kind === "contrarian") return "contrarian";
  if (kind === "slope_dec") return "deceleration";
  if (kind === "slope_acc") return "acceleration";
  return null;
}

/** >0 se `a` è peggiore di `b`. */
export function compareSlopeAlertKind(
  kindA: SlopeAlertKind,
  kindB: SlopeAlertKind,
  impactA: number,
  impactB: number,
): number {
  const pa = ALERT_KIND_PRIORITY[kindA];
  const pb = ALERT_KIND_PRIORITY[kindB];
  if (pa !== pb) return pa - pb;
  return impactA - impactB;
}
