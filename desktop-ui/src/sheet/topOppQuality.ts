/**
 * Soglie e metriche condivise per Top opportunità (Decision Lab + Simulation).
 */

import { tradeCalibThreshold } from "./investmentTradeCalib";
import type { SimSignalMetrics } from "./investSignalScore";

export const MIN_AFFIDABILITA_KEY = "supernova_top_min_affidabilita_v2";
export const MIN_AFFIDABILITA_DEFAULT = 50;

export function loadTopOppMinAffidPct(): number {
  if (typeof window === "undefined") return MIN_AFFIDABILITA_DEFAULT;
  try {
    const raw = localStorage.getItem(MIN_AFFIDABILITA_KEY);
    if (!raw) return MIN_AFFIDABILITA_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return MIN_AFFIDABILITA_DEFAULT;
    return n;
  } catch {
    return MIN_AFFIDABILITA_DEFAULT;
  }
}

/** ROI atteso % ÷ giorni al CD (densità rendimento). */
export function roiPerDayFromPlan(
  returnPct: number | null | undefined,
  daysToCd: number | null | undefined,
): number {
  if (returnPct == null || !Number.isFinite(returnPct) || returnPct <= 0) return 0;
  if (daysToCd == null || !Number.isFinite(daysToCd) || daysToCd <= 0) {
    return returnPct / 60;
  }
  return returnPct / daysToCd;
}

/** Score composito + Confidence minima (stesse soglie Decision Lab). */
export function passesTopOppQuality(
  metrics: SimSignalMetrics,
  planReturnPct: number | null | undefined,
  minAffidPct: number = loadTopOppMinAffidPct(),
): boolean {
  if (planReturnPct == null || !Number.isFinite(planReturnPct) || planReturnPct <= 0) {
    return false;
  }
  const scoreMin = tradeCalibThreshold("score_watch_min");
  if (metrics.score == null || metrics.score < scoreMin) return false;
  if (metrics.affidPct == null || metrics.affidPct < minAffidPct) return false;
  return true;
}
