import { portfolioPnlAccentClass } from "./portfolioGainLossStyle";

/** Below this capital, % on Δ plan / benefit heart are too noisy to rank. */
export const PULSE_MICRO_CAPITAL_EUR = 500;

/** Position deeply underwater — beating a depressed plan is not “high ROI”. */
export const PULSE_DEEP_LOSS_PNL_PCT = -20;

export function planGapPctForDisplay(
  gapPct: number | null | undefined,
  capitalEur: number,
): number | null {
  if (gapPct == null || !Number.isFinite(gapPct)) return null;
  if (capitalEur < PULSE_MICRO_CAPITAL_EUR) return null;
  return gapPct;
}

/** True when green Δ plan masks a large MTM loss (e.g. MLTX −89% but +€1 vs plan). */
export function planGapMisleadingBeat(
  pnlPct: number | null | undefined,
  gapEur: number | null | undefined,
): boolean {
  return (
    pnlPct != null &&
    Number.isFinite(pnlPct) &&
    pnlPct < PULSE_DEEP_LOSS_PNL_PCT &&
    gapEur != null &&
    Number.isFinite(gapEur) &&
    gapEur > 0
  );
}

export function planGapAccentClass(
  pnlPct: number | null | undefined,
  gapEur: number | null | undefined,
): string {
  if (planGapMisleadingBeat(pnlPct, gapEur)) {
    return " text-amber-700 dark:text-amber-400";
  }
  return portfolioPnlAccentClass(gapEur ?? 0);
}

export function shouldUseDailyBenefitFallback(args: {
  capitalEur?: number | null;
  pnlPct?: number | null;
}): boolean {
  const cap = args.capitalEur ?? 0;
  if (cap > 0 && cap < PULSE_MICRO_CAPITAL_EUR) return false;
  const pnl = args.pnlPct;
  if (pnl != null && Number.isFinite(pnl) && pnl < PULSE_DEEP_LOSS_PNL_PCT) return false;
  return true;
}
