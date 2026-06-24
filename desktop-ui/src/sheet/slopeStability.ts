/**
 * slopeStability.ts — TypeScript mirror of prediction/curve_forecast.py
 * ("Slope stability" section). Driver for entry/exit recommendations
 * in the Decision Lab.
 *
 * Thresholds and windows calibrated on 5,330 historical pre-CD trajectories:
 *   - median monotonic trend window ≈ 8d with consistency ≥ 0.65
 *   - ≈ 14d when slope_45d is also sign-aligned
 *   - below the noise floor (|slope| < 0.10 pp/d) the slope is "flat"
 */

export const SLOPE_FLAT_THRESHOLD_PP_PER_DAY = 0.10;
export const SLOPE_CONSISTENCY_LOW  = 0.4;
export const SLOPE_CONSISTENCY_HIGH = 0.6;

export type SlopeStabilityClass =
  | "rotation"
  | "flat"
  | "low_consistency"
  | "med_consistency"
  | "high_consistency_20d"
  | "high_consistency_45d";

export const PERSISTENCE_WINDOW_DAYS: Record<SlopeStabilityClass, number> = {
  rotation:               0,
  flat:                   0,
  low_consistency:        3,
  med_consistency:        7,
  high_consistency_20d:  10,
  high_consistency_45d:  15,
};

export type SlopeStabilityMetrics = {
  consistency: number | null;
  rotationFlag: 0 | 1;
  stabilityClass: SlopeStabilityClass;
  persistenceWindowDays: number;
};

function isFlat(s: number | null | undefined): boolean {
  if (s == null || !Number.isFinite(s)) return true;
  return Math.abs(s) < SLOPE_FLAT_THRESHOLD_PP_PER_DAY;
}

function signsAligned(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (Math.abs(a) < SLOPE_FLAT_THRESHOLD_PP_PER_DAY) return false;
  if (Math.abs(b) < SLOPE_FLAT_THRESHOLD_PP_PER_DAY) return false;
  return (a > 0) === (b > 0);
}

export function computeSlopeConsistency(
  slope5d: number | null,
  slope20d: number | null,
  slope45d: number | null = null,
): number | null {
  if (isFlat(slope5d) && isFlat(slope20d)) return null;
  if (slope5d == null || slope20d == null) return null;
  if (!signsAligned(slope5d, slope20d)) return 0;

  const a5  = Math.abs(slope5d);
  const a20 = Math.abs(slope20d);
  if (a5 === 0 || a20 === 0) return 0;
  let cons = Math.min(a5, a20) / Math.max(a5, a20);

  if (slope45d != null && signsAligned(slope45d, slope20d)) {
    const a45 = Math.abs(slope45d);
    if (a45 > 0) {
      const ratio45 = Math.min(a20, a45) / Math.max(a20, a45);
      cons = Math.min(1, cons * (1 + 0.15 * ratio45));
    }
  }
  return Math.round(cons * 1000) / 1000;
}

export function computeSlopeRotationFlag(
  slope5d: number | null,
  slope20d: number | null,
): 0 | 1 {
  if (isFlat(slope5d) || isFlat(slope20d)) return 0;
  if (slope5d == null || slope20d == null) return 0;
  return (slope5d > 0) !== (slope20d > 0) ? 1 : 0;
}

export function computeSlopeStabilityClass(
  slope5d: number | null,
  slope20d: number | null,
  slope45d: number | null = null,
): SlopeStabilityClass {
  if (computeSlopeRotationFlag(slope5d, slope20d) === 1) return "rotation";
  if (isFlat(slope5d) && isFlat(slope20d)) return "flat";

  const cons = computeSlopeConsistency(slope5d, slope20d, slope45d);
  if (cons == null) return "flat";
  if (cons < SLOPE_CONSISTENCY_LOW)  return "low_consistency";
  if (cons < SLOPE_CONSISTENCY_HIGH) return "med_consistency";
  if (slope45d != null && signsAligned(slope45d, slope20d)) return "high_consistency_45d";
  return "high_consistency_20d";
}

export function computePersistenceWindowDays(
  slope5d: number | null,
  slope20d: number | null,
  slope45d: number | null = null,
): number {
  const cls = computeSlopeStabilityClass(slope5d, slope20d, slope45d);
  return PERSISTENCE_WINDOW_DAYS[cls] ?? 0;
}

export function computeSlopeStability(
  slope5d: number | null,
  slope20d: number | null,
  slope45d: number | null = null,
): SlopeStabilityMetrics {
  return {
    consistency:            computeSlopeConsistency(slope5d, slope20d, slope45d),
    rotationFlag:           computeSlopeRotationFlag(slope5d, slope20d),
    stabilityClass:         computeSlopeStabilityClass(slope5d, slope20d, slope45d),
    persistenceWindowDays:  computePersistenceWindowDays(slope5d, slope20d, slope45d),
  };
}

/** Readable label for the stability class. */
export function slopeStabilityLabel(cls: SlopeStabilityClass): string {
  switch (cls) {
    case "rotation":              return "Slope rotation";
    case "flat":                  return "Flat slope";
    case "low_consistency":       return "Low consistency";
    case "med_consistency":       return "Medium consistency";
    case "high_consistency_20d":  return "Stable trend (20d)";
    case "high_consistency_45d":  return "Stable trend (45d)";
  }
}

/** Color tone associated with the class (for UI badges). */
export function slopeStabilityTone(cls: SlopeStabilityClass): "positive" | "neutral" | "warn" | "negative" {
  switch (cls) {
    case "rotation":              return "negative";
    case "flat":                  return "neutral";
    case "low_consistency":       return "warn";
    case "med_consistency":       return "neutral";
    case "high_consistency_20d":  return "positive";
    case "high_consistency_45d":  return "positive";
  }
}

/**
 * Actionable investment verdict, given the effective slope (in pp/d)
 * and stability metrics. Entry/exit driver of the Decision Lab.
 */
export type StabilityVerdict = "entry" | "persistent" | "watch" | "exit" | "avoid" | "none";

export function stabilityVerdict(
  metrics: SlopeStabilityMetrics,
  effSlope: number | null,
): StabilityVerdict {
  if (metrics.rotationFlag === 1) return "exit";
  if (metrics.stabilityClass === "flat") return "none";
  if (metrics.stabilityClass === "low_consistency") return "watch";
  if (effSlope == null) return "none";
  if (effSlope < 0) {
    // Stable NEGATIVE trend → avoid/short signal, not an entry
    return metrics.persistenceWindowDays >= 7 ? "avoid" : "watch";
  }
  // effSlope > 0
  if (metrics.persistenceWindowDays >= 10) return "persistent";
  if (metrics.persistenceWindowDays >= 7)  return "entry";
  return "watch";
}

export function verdictLabel(v: StabilityVerdict): string {
  switch (v) {
    case "entry":      return "Recommended entry — stable and rising trend";
    case "persistent": return "Persistent — hold / accumulate on dips";
    case "watch":      return "Watch — unclear slope, wait for confirmation";
    case "exit":       return "Exit — recent slope has reversed";
    case "avoid":      return "Avoid — stably negative trend";
    case "none":       return "—";
  }
}

/** Messaggio quando |slope| < soglia rumore — verdetto formale = none ma va mostrato in UI. */
export function flatSlopeVerdictSummary(lang: "it" | "en"): string {
  return lang === "it"
    ? `Pendenza piatta — |slope| < ${SLOPE_FLAT_THRESHOLD_PP_PER_DAY.toFixed(2)} pp/g (sotto soglia rumore)`
    : `Flat slope — |slope| < ${SLOPE_FLAT_THRESHOLD_PP_PER_DAY.toFixed(2)} pp/d (below noise floor)`;
}

/** Pendenza sotto soglia rumore ma curva modello in salita verso target — pill RISE verde. */
export function risingFlatSlopeVerdictSummary(lang: "it" | "en"): string {
  return lang === "it"
    ? `In salita — |slope| < ${SLOPE_FLAT_THRESHOLD_PP_PER_DAY.toFixed(2)} pp/g ma curva ↑ verso target`
    : `Rising — |slope| < ${SLOPE_FLAT_THRESHOLD_PP_PER_DAY.toFixed(2)} pp/d but curve ↑ toward target`;
}

export function verdictTone(v: StabilityVerdict): "positive" | "neutral" | "warn" | "negative" {
  switch (v) {
    case "entry":      return "positive";
    case "persistent": return "positive";
    case "watch":      return "warn";
    case "exit":       return "negative";
    case "avoid":      return "negative";
    case "none":       return "neutral";
  }
}
