import type { SignalLiveRow } from "../data/signalCalibrationData";

/** Finestra analisi segnali pre-CD. */
export type PreCdSignalsScope = "preCdRunup" | "nearCd";

/** Due mesi prima del CD (esclusa la finestra ±7 attorno al CD). */
export const PRE_CD_RUNUP_MIN_DAYS = 8;
export const PRE_CD_RUNUP_MAX_DAYS = 60;

/** Finestra attorno al Completion Date. */
export const NEAR_CD_WINDOW_DAYS = 7;

export function daysInPreCdScope(
  days: number | null | undefined,
  scope: PreCdSignalsScope,
): boolean {
  if (days == null || !Number.isFinite(days)) return false;
  if (scope === "nearCd") {
    return days >= -NEAR_CD_WINDOW_DAYS && days <= NEAR_CD_WINDOW_DAYS;
  }
  return days >= PRE_CD_RUNUP_MIN_DAYS && days <= PRE_CD_RUNUP_MAX_DAYS;
}

export function filterLiveRowsByScope(
  rows: SignalLiveRow[],
  scope: PreCdSignalsScope,
): SignalLiveRow[] {
  return rows.filter((r) => daysInPreCdScope(r.days_to_cd, scope));
}

export function preCdScopeWindowLabel(scope: PreCdSignalsScope, lang: "it" | "en"): string {
  if (scope === "nearCd") {
    return lang === "it"
      ? `CD ±${NEAR_CD_WINDOW_DAYS} giorni`
      : `CD ±${NEAR_CD_WINDOW_DAYS} days`;
  }
  return lang === "it"
    ? `${PRE_CD_RUNUP_MIN_DAYS}–${PRE_CD_RUNUP_MAX_DAYS} gg prima del CD`
    : `${PRE_CD_RUNUP_MIN_DAYS}–${PRE_CD_RUNUP_MAX_DAYS}d before CD`;
}
