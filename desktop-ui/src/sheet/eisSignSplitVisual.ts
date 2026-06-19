function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** EIS+ avg minus EIS− avg — positive means sign aligns with price direction. */
export function eisSignSplitLift(
  posAvg: number | null | undefined,
  negAvg: number | null | undefined,
): number | null {
  if (
    posAvg == null ||
    negAvg == null ||
    !Number.isFinite(posAvg) ||
    !Number.isFinite(negAvg)
  ) {
    return null;
  }
  return round2(posAvg - negAvg);
}

const LIFT_EPS_PP = 0.05;

export function eisSignSplitWorks(
  posAvg: number | null | undefined,
  negAvg: number | null | undefined,
): boolean | null {
  const lift = eisSignSplitLift(posAvg, negAvg);
  if (lift == null) return null;
  return lift > LIFT_EPS_PP;
}

export function fmtSignSplitLift(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} pp`;
}
