/**
 * SDS proximity to SuperNova zone (score ≥ 75) — 5★ alert for Top KPI.
 * ★★★★★ = deal at SuperNova level; gapPp = points still needed to reach 75.
 */
import { sdsZoneId, type SdsZoneId } from "./sdsZoneColors";

/** Canonical SuperNova SDS floor — aligned with ``sdsZoneId`` / BUY_FULL band. */
export const SDS_SUPERNOVA_THRESHOLD = 75;

export type SdsSupernovaProximity = {
  score: number;
  /** 0–5; 5 means at or above SuperNova threshold. */
  stars: number;
  /** ``threshold − score``; ≤ 0 means already in SuperNova zone. */
  gapPp: number;
  isSupernova: boolean;
  zone: SdsZoneId;
};

/**
 * Map SDS → stars. Only 5★ at SuperNova (≥75); bands of 15 pp below.
 *   ≥75 → 5 · ≥60 → 4 · ≥45 → 3 · ≥30 → 2 · ≥15 → 1 · else 0
 */
export function sdsSupernovaStars(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score >= SDS_SUPERNOVA_THRESHOLD) return 5;
  if (score >= 60) return 4;
  if (score >= 45) return 3;
  if (score >= 30) return 2;
  if (score >= 15) return 1;
  return 0;
}

export function computeSdsSupernovaProximity(
  score: number | null | undefined,
): SdsSupernovaProximity | null {
  if (score == null || !Number.isFinite(score)) return null;
  const s = Number(score);
  const gapPp = Math.round((SDS_SUPERNOVA_THRESHOLD - s) * 10) / 10;
  return {
    score: s,
    stars: sdsSupernovaStars(s),
    gapPp,
    isSupernova: s >= SDS_SUPERNOVA_THRESHOLD,
    zone: sdsZoneId(s),
  };
}

export function formatSdsSupernovaGap(
  prox: SdsSupernovaProximity,
  it: boolean,
): string {
  if (prox.isSupernova) {
    return it ? "deal SuperNova" : "SuperNova deal";
  }
  const g = Math.abs(prox.gapPp);
  const gLabel = Number.isInteger(g) ? String(g) : g.toFixed(1);
  return it ? `−${gLabel} pp → SN` : `−${gLabel} pp → SN`;
}
