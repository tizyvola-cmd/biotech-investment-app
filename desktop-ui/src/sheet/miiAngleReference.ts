/**
 * Riferimento soglie MII ° → Δ prezzo ~5g e volume ratio.
 * Inversa di marketInterestGate: angle = arctan(MII_raw / 15).
 */
import { DEFAULT_MIG_CONFIG, computeMiiRaw, slopeAngleFromMiiRaw } from "./marketInterestGate";

export const MII_ANGLE_REFERENCE_THRESHOLDS = [15, 20, 23, 28, 35] as const;

export type MiiAngleReferenceRow = {
  angleDeg: number;
  /** Δ prezzo % ~5g a Vol 1.0× per raggiungere ~angleDeg (senza penalità low-vol). */
  deltaAtVol1: number;
  /** Δ prezzo % ~5g a Vol 1.5×. */
  deltaAtVol15: number;
  /** Δ prezzo % ~5g a Vol 2.0×. */
  deltaAtVol2: number;
};

export function miiRawForAngle(
  angleDeg: number,
  normFactor: number = DEFAULT_MIG_CONFIG.normalizationFactor,
): number {
  return normFactor * Math.tan((angleDeg * Math.PI) / 180);
}

/** ΔP% (~5g) necessario per un angolo target a dato Vol× (MII senza penalità low-vol). */
export function deltaPctForTargetAngle(
  angleDeg: number,
  volRatio: number,
  normFactor: number = DEFAULT_MIG_CONFIG.normalizationFactor,
): number {
  const raw = miiRawForAngle(angleDeg, normFactor);
  const vr = Math.max(0, volRatio);
  const volFactor = Math.log(vr + 1) * Math.sqrt(vr);
  if (volFactor <= 1e-9) return 0;
  return Math.round((raw / volFactor) * 10) / 10;
}

export function buildMiiAngleReferenceRows(
  normFactor: number = DEFAULT_MIG_CONFIG.normalizationFactor,
): MiiAngleReferenceRow[] {
  return MII_ANGLE_REFERENCE_THRESHOLDS.map((angleDeg) => ({
    angleDeg,
    deltaAtVol1: deltaPctForTargetAngle(angleDeg, 1.0, normFactor),
    deltaAtVol15: deltaPctForTargetAngle(angleDeg, 1.5, normFactor),
    deltaAtVol2: deltaPctForTargetAngle(angleDeg, 2.0, normFactor),
  }));
}

/** Verifica coerenza formula (es. +10% @ 1.0× ≈ 23–25°). */
export function angleFromDeltaVol(
  deltaPct: number,
  volRatio: number,
  normFactor: number = DEFAULT_MIG_CONFIG.normalizationFactor,
): number {
  const { raw } = computeMiiRaw(deltaPct, volRatio);
  return slopeAngleFromMiiRaw(raw, normFactor);
}

export function fmtDeltaPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function fmtVol(v: number): string {
  return `${v.toFixed(1)}×`;
}
