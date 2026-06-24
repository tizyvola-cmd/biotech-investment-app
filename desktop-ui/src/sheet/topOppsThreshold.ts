/** Soglia upside Top Opps — condivisa tra Decision Lab e Dashboard. */

export const UPSIDE_THRESHOLD_KEY = "supernova_top_upside_threshold_pct_v1";
export const UPSIDE_THRESHOLD_DEFAULT_PCT = 1.5;
export const UPSIDE_THRESHOLD_MIN_PCT = 0.5;
export const UPSIDE_THRESHOLD_MAX_PCT = 5.0;

export function clampUpsideThresholdPct(v: number): number {
  if (!Number.isFinite(v)) return UPSIDE_THRESHOLD_DEFAULT_PCT;
  return Math.min(UPSIDE_THRESHOLD_MAX_PCT, Math.max(UPSIDE_THRESHOLD_MIN_PCT, v));
}

export function loadUpsideThresholdPct(): number {
  if (typeof window === "undefined") return UPSIDE_THRESHOLD_DEFAULT_PCT;
  try {
    const raw = localStorage.getItem(UPSIDE_THRESHOLD_KEY);
    if (raw == null) return UPSIDE_THRESHOLD_DEFAULT_PCT;
    return clampUpsideThresholdPct(Number(raw));
  } catch {
    return UPSIDE_THRESHOLD_DEFAULT_PCT;
  }
}

export function saveUpsideThresholdPct(v: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(UPSIDE_THRESHOLD_KEY, String(clampUpsideThresholdPct(v)));
  } catch {
    /* quota */
  }
}
