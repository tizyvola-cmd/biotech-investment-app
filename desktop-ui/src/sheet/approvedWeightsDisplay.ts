/**
 * Shared display helpers for Learning Lab approved (frozen) weights.
 */
import type {
  CalibrationDimension,
  FrozenWeights,
} from "../calibration/calibrationTypes";

export const ALLOCATION_DIMENSIONS: CalibrationDimension[] = [
  "pplanBucket",
  "sdsBucket",
  "clinicalPhase",
  "clinicalIndication",
];

export const DIM_LABEL_IT: Record<CalibrationDimension, string> = {
  clinicalPhase: "Fase clinica",
  clinicalIndication: "Indicazione",
  sdsBucket: "SDS",
  pplanBucket: "P(plan)",
};

export const DIM_LABEL_EN: Record<CalibrationDimension, string> = {
  clinicalPhase: "Clinical phase",
  clinicalIndication: "Indication",
  sdsBucket: "SDS",
  pplanBucket: "P(plan)",
};

/** Geometric mean of approved win rates across dimensions with n > 0. */
export function compositeApprovedWinRate(
  cells: Record<CalibrationDimension, string>,
  frozen: FrozenWeights,
): number | null {
  let product = 1;
  let count = 0;
  for (const dim of ALLOCATION_DIMENSIONS) {
    const entry = frozen.weights[dim]?.[cells[dim]];
    if (!entry || entry.n <= 0) continue;
    product *= entry.weight;
    count += 1;
  }
  if (count === 0) return null;
  return Math.pow(product, 1 / count);
}

/**
 * Same as compositeApprovedWinRate but allows overriding the weight for one
 * dimension (used for diagnostic "what-if" calculations only — never writes to
 * frozen weights). The override is applied only if the dimension already had
 * n > 0 (i.e., it was counted in the original composite); otherwise the
 * override is silently ignored so that the dimension count stays consistent.
 */
export function compositeApprovedWinRateWithOverride(
  cells: Record<CalibrationDimension, string>,
  frozen: FrozenWeights,
  overrides: Partial<Record<CalibrationDimension, number>>,
): number | null {
  let product = 1;
  let count = 0;
  for (const dim of ALLOCATION_DIMENSIONS) {
    const entry = frozen.weights[dim]?.[cells[dim]];
    if (!entry || entry.n <= 0) continue;
    const w = dim in overrides ? (overrides[dim] ?? entry.weight) : entry.weight;
    product *= w;
    count += 1;
  }
  if (count === 0) return null;
  return Math.pow(product, 1 / count);
}
