/**
 * Loss-aware synth capital — open portfolio positions in the red must not be
 * upsized because of a positive 24h bounce (Weight Sim Exp entry sizing only).
 */

/** Move % fed to Weight Sim Exp for an open portfolio row. */
export function effectiveSynthMovePct(args: {
  movePct24h: number;
  totalPnlPct: number | null | undefined;
  isOpenPortfolio?: boolean;
}): number {
  const { movePct24h, totalPnlPct, isOpenPortfolio } = args;
  if (!isOpenPortfolio) return movePct24h;
  if (totalPnlPct != null && Number.isFinite(totalPnlPct) && totalPnlPct < 0) {
    return totalPnlPct;
  }
  return movePct24h;
}

/** Capital € target after sync — never upsize an underwater position. */
export function applyLossAwareSynthCapEur(
  currentCapitalEur: number,
  synthCapEur: number,
  totalPnlPct: number | null | undefined,
): number {
  const cur = Math.round(Math.max(0, currentCapitalEur));
  const synth = Math.round(Math.max(0, synthCapEur));
  if (synth <= 0) return cur;
  if (totalPnlPct != null && Number.isFinite(totalPnlPct) && totalPnlPct < 0) {
    return Math.min(cur, synth);
  }
  return synth;
}

export function applyLossAwareSynthShare(
  rawShare: number,
  currentCapitalEur: number,
  topCapitalEur: number,
  totalPnlPct: number | null | undefined,
): number {
  if (!(topCapitalEur > 0) || !(rawShare > 0)) return 0;
  const cap = applyLossAwareSynthCapEur(
    currentCapitalEur,
    rawShare * topCapitalEur,
    totalPnlPct,
  );
  return cap / topCapitalEur;
}
