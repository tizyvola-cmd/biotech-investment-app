/**
 * Finestre temporali pre-CD: monitoraggio (4 mesi) vs zona hot (2 mesi).
 * Allineare con ``SIM_SHEET_DISPLAY_HORIZON_CAL_DAYS`` in data_orchestrator.py.
 *
 * Post-CD: vedi ``cdLifecycle.ts`` (watch 7 gg → past_catalyst).
 */

/** Società monitorate in Simulation / Clinical (≈4 mesi). */
export const SIM_MONITOR_HORIZON_DAYS = 120;

/** Zona hot: timing operativo e Top Opportunità primarie (≈2 mesi). */
export const SIM_HOT_ZONE_DAYS = 60;

/** R² minimo per candidati watch (curva ancora leggibile lontano dal CD). */
export const WATCH_ZONE_MIN_R2 = 0.2;

export type CdZone = "hot" | "watch" | "past" | "beyond" | "unknown";

export function resolveCdZone(days: number | null | undefined): CdZone {
  if (days == null || !Number.isFinite(days)) return "unknown";
  if (days < 0) return "past";
  if (days <= SIM_HOT_ZONE_DAYS) return "hot";
  if (days <= SIM_MONITOR_HORIZON_DAYS) return "watch";
  return "beyond";
}

export function isHotZone(days: number | null | undefined): boolean {
  return resolveCdZone(days) === "hot";
}

export function isWatchZone(days: number | null | undefined): boolean {
  return resolveCdZone(days) === "watch";
}

/**
 * Peso 0–100 sulla predictibilità operativa della curva in funzione del
 * tempo al CD e della qualità del fit (R², conf., coerenza pendenza).
 */
export function computeTimingPredictabilityPct(
  days: number | null | undefined,
  r2: number | null | undefined,
  affid: number | null | undefined,
  slopeConsistency: number | null | undefined,
): number {
  if (days == null || !Number.isFinite(days) || days < 0) return 0;

  let timingWeight: number;
  if (days <= 14) {
    timingWeight = 1;
  } else if (days <= SIM_HOT_ZONE_DAYS) {
    timingWeight = 0.85 + (0.15 * (SIM_HOT_ZONE_DAYS - days)) / (SIM_HOT_ZONE_DAYS - 14);
  } else if (days <= SIM_MONITOR_HORIZON_DAYS) {
    const span = SIM_MONITOR_HORIZON_DAYS - SIM_HOT_ZONE_DAYS;
    timingWeight = 0.35 + (0.45 * (SIM_MONITOR_HORIZON_DAYS - days)) / span;
  } else {
    timingWeight = 0.2;
  }

  const r2Part = Math.min(1, Math.max(0, r2 ?? 0.15));
  const affPart = Math.min(1, Math.max(0, affid ?? 0.35));
  const slopePart = Math.min(1, Math.max(0, slopeConsistency ?? 0.45));
  const curveQuality = r2Part * 0.45 + affPart * 0.35 + slopePart * 0.2;

  return Math.round(Math.min(100, Math.max(0, timingWeight * curveQuality * 100)));
}

/** Hit% cohort scalato per distanza al CD (accuracy operativa attesa). */
export function effectiveTimingHitPct(
  expectedHitPct: number | null | undefined,
  timingPredictabilityPct: number,
): number | null {
  if (expectedHitPct == null || !Number.isFinite(expectedHitPct)) return null;
  return Math.round(expectedHitPct * (timingPredictabilityPct / 100));
}
