/**
 * Allinea target operativo (gain plan) al picco forward pre-CD sulla curva recalibrata.
 */

const MIN_PEAK_PP = 0.05;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export type CapPlanReturnOptions = {
  forwardPeakPct?: number | null;
  targetHighPct?: number | null;
};

/**
 * Riduce planReturnPct quando supera il picco forward o targetHigh positivo.
 * (CRDF: plan 7.9% vs picco 3.0% → cap a 3.0%.)
 */
export function capPlanReturnToForwardPeak(
  planReturnPct: number,
  opts: CapPlanReturnOptions,
): number {
  if (!Number.isFinite(planReturnPct)) return planReturnPct;
  let v = planReturnPct;
  const peak = opts.forwardPeakPct;
  if (peak != null && Number.isFinite(peak) && peak > MIN_PEAK_PP && v > peak + 0.01) {
    v = peak;
  }
  const hi = opts.targetHighPct;
  if (hi != null && Number.isFinite(hi) && hi > MIN_PEAK_PP && v > hi + 0.01) {
    v = hi;
  }
  return round1(v);
}

/** Picco curva pre-CD entro l'orizzonte CD — evita picchi post-CD extended nel confronto. */
export function preCdCurvePeakForCompare(item: {
  curvePeakReturnPct: number | null;
  daysToCurvePeak: number | null;
  daysToCd: number | null;
}): number | null {
  if (item.curvePeakReturnPct == null || !Number.isFinite(item.curvePeakReturnPct)) {
    return null;
  }
  if (item.daysToCurvePeak == null || item.daysToCd == null) {
    return item.curvePeakReturnPct;
  }
  if (item.daysToCurvePeak > item.daysToCd + 1) return null;
  return item.curvePeakReturnPct;
}

export function forwardPeakForMisalignmentCompare(
  harmonizedPreCdPeak: number | null | undefined,
  item: {
    curvePeakReturnPct: number | null;
    daysToCurvePeak: number | null;
    daysToCd: number | null;
  },
): number | null {
  if (harmonizedPreCdPeak != null && Number.isFinite(harmonizedPreCdPeak)) {
    return harmonizedPreCdPeak;
  }
  return preCdCurvePeakForCompare(item);
}
