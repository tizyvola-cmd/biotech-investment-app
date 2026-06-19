/**
 * Soglie unificate per eventi pendenza (log, banner, tab Slope errors, caveat segnali).
 * P&L / Top 2 / score usano altre formule — vedi note i18n `*.slopeHarmonyNote`.
 */

import { computeSlopeRotationFlag } from "./slopeStability";

/** |slope5d − slope20d| minimo per decelerazione / accelerazione (pp/giorno). */
export const SLOPE_DELTA_ACCEL_DECEL_PP_PER_DAY = 0.8;

/** Percorso alternativo «rialzo forte» (entrambe le pendenze positive). */
export const SLOPE_STRONG_RISE_SLOPE5 = 0.35;
export const SLOPE_STRONG_RISE_SLOPE20 = 0.12;
export const SLOPE_STRONG_RISE_DELTA_MIN = 0.25;

/** Gap traiettoria 5g (actual − pred, pp) per tono colonna Modello T+5 in tab slope. */
export const SLOPE_TRAJECTORY_GAP5_PP = 0.35;

/** |Modello T+5 $ − reale $| minimo per segnalare errori/variazioni pendenza (sotto = rumore). */
export const SLOPE_MIN_PRICE_GAP_USD = 0.2;

export type SlopeEventKindClassified = "slope_rev" | "slope_dec" | "slope_acc";

export function slopeDeltaPpPerDay(slope5d: number, slope20d: number): number {
  return slope5d - slope20d;
}

/** Classifica evento pendenza (stesso criterio ovunque). */
export function classifySlopeEventKind(
  slope5d: number | null,
  slope20d: number | null,
): SlopeEventKindClassified | null {
  if (slope5d == null || slope20d == null) return null;
  if (computeSlopeRotationFlag(slope5d, slope20d) === 1) return "slope_rev";

  const delta = slopeDeltaPpPerDay(slope5d, slope20d);
  if (delta <= -SLOPE_DELTA_ACCEL_DECEL_PP_PER_DAY) return "slope_dec";
  if (delta >= SLOPE_DELTA_ACCEL_DECEL_PP_PER_DAY) return "slope_acc";

  if (
    slope5d >= SLOPE_STRONG_RISE_SLOPE5 &&
    slope20d >= SLOPE_STRONG_RISE_SLOPE20 &&
    slope5d > 0 &&
    slope20d > 0 &&
    delta >= SLOPE_STRONG_RISE_DELTA_MIN
  ) {
    return "slope_acc";
  }

  return null;
}

export function isStrongSlopeAcceleration(
  kind: SlopeEventKindClassified | string | null,
  slope5d: number | null | undefined,
  slope20d: number | null | undefined,
): boolean {
  if (kind !== "slope_acc") return false;
  if (slope5d == null || slope20d == null) return true;
  return slopeDeltaPpPerDay(slope5d, slope20d) >= SLOPE_DELTA_ACCEL_DECEL_PP_PER_DAY;
}

/** Testo soglie per UI (i18n threshold line). */
export function slopeThresholdSummary(lang: "it" | "en"): string {
  const u = lang === "it" ? "pp/g" : "pp/d";
  const d = SLOPE_DELTA_ACCEL_DECEL_PP_PER_DAY;
  const g = SLOPE_MIN_PRICE_GAP_USD;
  if (lang === "it") {
    return `Inversione: segno opposto slope5d vs slope20d (|slope| ≥ 0,10 ${u}) · accel/decel: |Δ| ≥ ${d} ${u} · ↑ forte: slope5d ≥ ${SLOPE_STRONG_RISE_SLOPE5} e slope20d ≥ ${SLOPE_STRONG_RISE_SLOPE20} · se |modello T+5 − reale| è noto, richiede ≥ $${g.toFixed(2)} · foglio Simulation`;
  }
  return `Reversal: opposite sign on slope5d vs slope20d (|slope| ≥ 0.10 ${u}) · accel/decel: |Δ| ≥ ${d} ${u} · strong ↑: slope5d ≥ ${SLOPE_STRONG_RISE_SLOPE5} & slope20d ≥ ${SLOPE_STRONG_RISE_SLOPE20} · when |model T+5 − real| is known, requires ≥ $${g.toFixed(2)} · Simulation sheet`;
}
