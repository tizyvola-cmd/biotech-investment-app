import type { SolidityCompositeComponentId } from "./entrySolidityComposite";
import { RA_CALIB_MIN_SAMPLE_N } from "./rascoreCalibrationCompute";
import {
  RA_INVERSE_COMPONENT_IDS,
  raInverseComponentIdsForMode,
  type RaInverseScoreMode,
} from "./rascoreInversePattern";
import { correlationSignificance, pearsonR } from "./statSignificance";

export type RaComponentPriceDirection = "positive" | "negative" | "neutral" | "unknown";

export type RaComponentPolarity = {
  id: SolidityCompositeComponentId;
  /** Pooled ρ(fill%, Δ% price) across all CD buckets. */
  rho: number | null;
  /**
   * ρ after mirroring fill% (100−fill) when raw ρ is negative — strength aligned to price-up.
   * Intuitively like putting − before raw ρ when inverted; here recomputed on mirrored data.
   */
  rhoPriceAligned: number | null;
  n: number;
  pValue: number | null;
  /** Significance on {@link rhoPriceAligned}. */
  pValueAligned: number | null;
  direction: RaComponentPriceDirection;
  /** When true, component points are subtracted in polarized RA (Σρ+ − Σρ−). */
  invertForPrice: boolean;
  reliable: boolean;
};

export type RaComponentObservation = {
  bucket: number;
  y: number;
  fills: Record<SolidityCompositeComponentId, number>;
  points: Record<SolidityCompositeComponentId, number>;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function directionFromRho(rho: number | null, n: number): RaComponentPriceDirection {
  if (rho == null || n < 3) return "unknown";
  if (rho < -0.05) return "negative";
  if (rho > 0.05) return "positive";
  return "neutral";
}

/** Pool (fill%, price outcome) for one component across all calibration buckets. */
export function poolComponentPricePairs(
  pairs: Map<number, Map<string, { x: number; y: number }[]>>,
  componentId: SolidityCompositeComponentId,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const bucketMap of pairs.values()) {
    out.push(...(bucketMap.get(componentId) ?? []));
  }
  return out;
}

/** ρ on mirrored fill% — correct alignment vs simple −ρ on raw Pearson. */
export function computeAlignedPooledRho(
  pooled: { x: number; y: number }[],
  invert: boolean,
): number | null {
  const n = pooled.length;
  if (n < 3) return null;
  const xs = invert
    ? pooled.map((p) => alignComponentFillPct(p.x, true))
    : pooled.map((p) => p.x);
  return pearsonR(xs, pooled.map((p) => p.y));
}

/** Display shortcut: −ρ when index historically moves opposite to price. */
export function signFlipRhoForDisplay(rho: number | null, invert: boolean): number | null {
  if (rho == null || !Number.isFinite(rho)) return null;
  return invert ? -rho : rho;
}

export function computeComponentPolarities(
  pairs: Map<number, Map<string, { x: number; y: number }[]>>,
): RaComponentPolarity[] {
  return RA_INVERSE_COMPONENT_IDS.map((id) => {
    const pooled = poolComponentPricePairs(pairs, id);
    const n = pooled.length;
    const rho = n >= 3 ? pearsonR(pooled.map((p) => p.x), pooled.map((p) => p.y)) : null;
    const { p: pValue } = correlationSignificance(rho, n);
    const direction = directionFromRho(rho, n);
    const reliable = n >= RA_CALIB_MIN_SAMPLE_N;
    const invertForPrice = reliable && rho != null && rho < 0;
    const rhoPriceAligned = computeAlignedPooledRho(pooled, invertForPrice);
    const { p: pValueAligned } = correlationSignificance(rhoPriceAligned, n);
    return {
      id,
      rho,
      rhoPriceAligned,
      n,
      pValue,
      pValueAligned,
      direction,
      invertForPrice,
      reliable,
    };
  });
}

/** @deprecated Prefer {@link polarizedComponentPoints} for RA totals. Kept for fill-% ρ calibration. */
export function alignComponentPoints(
  points: number,
  maxPoints: number,
  invert: boolean,
): number {
  if (!invert) return points;
  return round1(Math.max(0, Math.min(maxPoints, maxPoints - points)));
}

/** Signed contribution: +pts if ρ≥0 cohort, −pts if ρ<0 (subtract negative correlators). */
export function polarizedComponentPoints(points: number, invert: boolean): number {
  const raw = round1(points);
  return invert ? -raw : raw;
}

export type PolarizedRaBreakdown = {
  total: number;
  positiveSum: number;
  negativeSum: number;
};

function reliableInvertById(
  polarities: readonly RaComponentPolarity[],
): Map<SolidityCompositeComponentId, boolean> {
  return new Map(
    polarities.filter((p) => p.reliable).map((p) => [p.id, p.invertForPrice]),
  );
}

/** RA polarizzato = Σ(indici ρ+) − Σ(indici ρ−). */
export function computePolarizedRaTotal(
  points: Record<SolidityCompositeComponentId, number>,
  polarities: readonly RaComponentPolarity[],
  mode: RaInverseScoreMode,
): PolarizedRaBreakdown {
  const invertById = reliableInvertById(polarities);
  const ids = raInverseComponentIdsForMode(mode);
  let positiveSum = 0;
  let negativeSum = 0;
  for (const id of ids) {
    const raw = points[id] ?? 0;
    if (invertById.get(id)) {
      negativeSum += raw;
    } else {
      positiveSum += raw;
    }
  }
  return {
    positiveSum: round1(positiveSum),
    negativeSum: round1(negativeSum),
    total: round1(positiveSum - negativeSum),
  };
}

export function alignComponentFillPct(fillPct: number, invert: boolean): number {
  if (!invert) return fillPct;
  return round1(Math.max(0, Math.min(100, 100 - fillPct)));
}

export function computePriceAlignedRaScore(
  points: Record<SolidityCompositeComponentId, number>,
  polarities: readonly RaComponentPolarity[],
  mode: RaInverseScoreMode,
  opts?: { clamp0To100?: boolean },
): number {
  const { total } = computePolarizedRaTotal(points, polarities, mode);
  if (opts?.clamp0To100 === false) return total;
  return round1(Math.min(100, Math.max(0, total)));
}

export function appendNormalizedRaPairs(
  pairs: Map<number, Map<string, { x: number; y: number }[]>>,
  observations: RaComponentObservation[],
  polarities: RaComponentPolarity[],
  scoreMode: RaInverseScoreMode,
): void {
  for (const obs of observations) {
    const score = computePriceAlignedRaScore(obs.points, polarities, scoreMode, {
      clamp0To100: false,
    });
    if (!pairs.has(obs.bucket)) pairs.set(obs.bucket, new Map());
    const m = pairs.get(obs.bucket)!;
    if (!m.has("normalized_ra")) m.set("normalized_ra", []);
    m.get("normalized_ra")!.push({ x: score, y: obs.y });
  }
}

export function countInvertedPolarities(polarities: RaComponentPolarity[]): number {
  return polarities.filter((p) => p.invertForPrice).length;
}

export function invertedComponentIds(
  polarities: readonly RaComponentPolarity[],
): SolidityCompositeComponentId[] {
  return polarities.filter((p) => p.invertForPrice).map((p) => p.id);
}

/** Mean price-aligned RA for one inverse-pattern group (price-up / price-down). */
export function computeAlignedMeanRaForMembers(
  members: Array<{
    group: "up" | "down";
    componentPts: Record<SolidityCompositeComponentId, number>;
  }>,
  group: "up" | "down",
  polarities: readonly RaComponentPolarity[],
  mode: RaInverseScoreMode,
): number | null {
  const scores = members
    .filter((m) => m.group === group)
    .map((m) => computePriceAlignedRaScore(m.componentPts, polarities, mode));
  if (!scores.length) return null;
  return round1(scores.reduce((s, v) => s + v, 0) / scores.length);
}
