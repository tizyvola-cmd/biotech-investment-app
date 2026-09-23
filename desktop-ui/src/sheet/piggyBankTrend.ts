/**
 * Detect P&L deltas that come from stale baselines or mid-load data corrections —
 * not from real portfolio moves (especially vs 24h P&L).
 */
export function portfolioPnlDeltaLooksLikeStaleBaseline(
  prevPnlEur: number,
  totalPnlEur: number,
  pnl24hEur: number,
  todayCovered: number,
): boolean {
  const delta = totalPnlEur - prevPnlEur;
  if (delta === 0) return false;
  // A swing this large between visits is never a real market move — it signals a contaminated
  // baseline snapshot (e.g. saved while history bug inflated P&L). Catches even when
  // todayCovered=0 (market data not yet loaded, which would otherwise bypass all checks below).
  if (Math.abs(delta) > 10_000) return true;
  if (todayCovered <= 0) return false;
  if (Math.abs(delta) > Math.abs(pnl24hEur) + 200) return true;
  // Snapshot saved before history merge (MTM inflation vs leg-sum total).
  if (
    prevPnlEur > totalPnlEur + 250 &&
    Math.abs(delta) > 400 &&
    Math.abs(delta) > Math.abs(pnl24hEur) * 0.55
  ) {
    return true;
  }
  return false;
}

/** @deprecated use portfolioPnlDeltaLooksLikeStaleBaseline */
export const piggyTrendLooksLikeDataCorrection = portfolioPnlDeltaLooksLikeStaleBaseline;
