import type { ChartPoint } from "../types";

/**
 * Recalibrated prediction path: ``pct_foglio`` (Simulation sheet Pred when present,
 * else ``pct_curva`` seq curve) including standard nodes, K-8 +1/+2/+3, AI feed +1/+2/+3.
 */
export const PREDICTION_CURVE_RECALIB_LABEL = "Prediction Curve + Recalibration";

export function predictionCurveRecalibLegend(ticker: string): string {
  const tk = ticker.trim();
  return tk ? `${tk} · ${PREDICTION_CURVE_RECALIB_LABEL}` : PREDICTION_CURVE_RECALIB_LABEL;
}

/** Panel title for the % chart (dashboard + Grafici). */
export function predictionCurveRecalibChartTitle(scope?: string): string {
  const base = PREDICTION_CURVE_RECALIB_LABEL;
  const s = scope?.trim();
  return s ? `${base} · ${s}` : base;
}

/** Calendar offsets aligned with ``SIMULATION_PRED_CAL_OFFSETS`` (backend). */
export const STANDARD_CAL_OFFSETS = [-60, -30, -10, -7, -5, -3, 4, 7] as const;

/** Post-CD knots for assessment charts — extrapolated from the recalib path (+1/+2/+3 mo). */
export const POST_CD_CHART_OFFSETS = [30, 60, 90] as const;

/** Standard sim grid + post-CD extension (24h assessment / loss-analysis tiles). */
export const ASSESSMENT_CHART_OFFSETS = [
  ...STANDARD_CAL_OFFSETS,
  ...POST_CD_CHART_OFFSETS,
] as const;

/** Gain-vs-plan horizon beyond CD (calendar days after catalyst). */
export const POST_CD_GAIN_EXTENSION_DAYS = 90;

/** Resolve offset grid from a sampled value array length. */
export function calendarOffsetsForValueCount(n: number): readonly number[] {
  if (n === ASSESSMENT_CHART_OFFSETS.length) return ASSESSMENT_CHART_OFFSETS;
  if (n === STANDARD_CAL_OFFSETS.length) return STANDARD_CAL_OFFSETS;
  if (n <= STANDARD_CAL_OFFSETS.length) return STANDARD_CAL_OFFSETS.slice(0, n);
  return ASSESSMENT_CHART_OFFSETS.slice(0, n);
}

export function isSecK8Node(p: ChartPoint): boolean {
  const n = (p.nodo ?? "standard").trim();
  return n === "K-8" || n === "8-K";
}

export function isAiFeedNode(p: ChartPoint): boolean {
  return (p.nodo ?? "standard") === "AI feed";
}

export function isRecalibExtraNode(p: ChartPoint): boolean {
  return isSecK8Node(p) || isAiFeedNode(p);
}

export function includeChartNode(
  p: ChartPoint,
  opts: { standardOnly?: boolean; includeRecalibExtras?: boolean },
): boolean {
  const nodo = p.nodo ?? "standard";
  if (opts.standardOnly) return nodo === "standard";
  if (!opts.includeRecalibExtras) return nodo === "standard";
  return nodo === "standard" || isRecalibExtraNode(p);
}

export function chartPointSortKey(p: ChartPoint): [number, number] {
  if (p.sort?.length === 2) return [p.sort[0], p.sort[1]];
  const tier = isSecK8Node(p) ? 1 : isAiFeedNode(p) ? 2 : 0;
  return [tier, p.offset];
}
