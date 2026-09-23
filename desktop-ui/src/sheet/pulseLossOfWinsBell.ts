/**
 * Red Pulse / Pick-stocks campanella — same rule as Trades column −% G/L:
 * giveback from peak wins ≥ user % of G/L won (uiPrefs `glWinAlertPct`, default 10).
 * Portfolio auto-sell remains Urgent G2 (20% of purchased + open gains).
 */

import {
  GL_WIN_ALERT_FRAC_DEFAULT,
  glWinAlertHit,
  peakPnlEurFromHistory,
} from "./softSignalGrades";
import type { InvestSimHistoryPoint } from "./investSimStorage";

/** Default fraction — overridden by uiPrefs `glWinAlertPct` at call sites. */
export const PULSE_LOSS_OF_WINS_BELL_FRAC = GL_WIN_ALERT_FRAC_DEFAULT;
export const PULSE_SHARE_LOSS_BELL_FRAC = GL_WIN_ALERT_FRAC_DEFAULT;
export const PULSE_GIVEBACK_BELL_MIN_PEAK_EUR = 100;

/** @deprecated book-wide sum — kept for callers/tests that still aggregate wins. */
export function sumOpenWinsEur(rows: { pnlEur: number }[]): number {
  let s = 0;
  for (const r of rows) {
    if (r.pnlEur > 0) s += r.pnlEur;
  }
  return s;
}

export type PulseGivebackBell = {
  hit: boolean;
  peakEff: number | null;
  givebackEur: number | null;
  givebackPctOfPeak: number | null;
  /** Peak / won base used for the threshold (same as Trades −% G/L). */
  purchasedPlusGainsEur?: number | null;
};

export type PulseGivebackBellOpts = {
  investedAt?: string | null;
  now?: Date;
  requireUnderwater?: boolean;
  capitalEur?: number | null;
};

/**
 * Same hit as Pick-stocks / Trades `glWinAlertHit` (no RTH gate — column parity).
 */
export function pulseTickerGivebackBell(
  pnlEur: number,
  peakPnlEur: number | null | undefined,
  frac = PULSE_LOSS_OF_WINS_BELL_FRAC,
  _minPeakEur?: number,
  _opts?: PulseGivebackBellOpts,
): PulseGivebackBell {
  if (!Number.isFinite(pnlEur) || !(frac > 0)) {
    return { hit: false, peakEff: null, givebackEur: null, givebackPctOfPeak: null };
  }
  const peakHist =
    peakPnlEur != null && Number.isFinite(peakPnlEur) && peakPnlEur > 0
      ? peakPnlEur
      : null;
  const peakEff =
    peakHist != null
      ? Math.max(peakHist, pnlEur > 0 ? pnlEur : peakHist)
      : pnlEur > 0
        ? pnlEur
        : null;
  const hit = glWinAlertHit(pnlEur, peakPnlEur, frac);
  if (!hit || peakEff == null) {
    return {
      hit: false,
      peakEff: peakEff != null ? Math.round(peakEff * 100) / 100 : null,
      givebackEur: null,
      givebackPctOfPeak: null,
      purchasedPlusGainsEur:
        peakEff != null ? Math.round(peakEff * 100) / 100 : null,
    };
  }
  const giveback = peakEff - pnlEur;
  return {
    hit: true,
    peakEff: Math.round(peakEff * 100) / 100,
    givebackEur: Math.round(giveback * 100) / 100,
    givebackPctOfPeak: Math.round((giveback / peakEff) * 1000) / 10,
    purchasedPlusGainsEur: Math.round(peakEff * 100) / 100,
  };
}

export function pulseTickerGivebackBellFromHistory(
  key: string,
  pnlEur: number,
  history: readonly InvestSimHistoryPoint[] | null | undefined,
  investedAt?: string | null,
  frac = PULSE_LOSS_OF_WINS_BELL_FRAC,
  capitalEur?: number | null,
): PulseGivebackBell {
  const peak = peakPnlEurFromHistory(history, key, investedAt);
  return pulseTickerGivebackBell(pnlEur, peak, frac, undefined, {
    investedAt,
    capitalEur,
  });
}

/**
 * @deprecated Prefer `pulseTickerGivebackBell`.
 */
export function pulseLossExceedsWinShare(
  pnlEur: number,
  totalOpenWinsEur: number,
  frac = PULSE_LOSS_OF_WINS_BELL_FRAC,
): boolean {
  if (!(totalOpenWinsEur > 0) || !(pnlEur < 0) || !(frac > 0)) return false;
  return Math.abs(pnlEur) > totalOpenWinsEur * frac;
}
