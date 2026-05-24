/**
 * Colori celle tabelle Model Lab (MAE ↓ verde, Hit ↑ verde — stile testo Simulation).
 */
import type { CSSProperties } from "react";
import type { CellStyle } from "./variationColors";
import { TABLE_COLORS_ENABLED } from "./tableColorsEnabled";
import type { TemporalModelRow } from "./accuracyMetrics";
import { ACCURACY_OFFSETS } from "./accuracyMetrics";
import type { ModelAgg } from "./accuracyMetrics";

const POS = "rgb(var(--positive))";
const NEG = "rgb(var(--negative))";
const MUTED = "rgb(var(--ink-muted))";
const WARN = "rgb(var(--warn))";

export type MetricColumnRanges = {
  maeByOffset: Map<number, { min: number; max: number }>;
  hitByOffset: Map<number, { min: number; max: number }>;
  maeGlobal: { min: number; max: number } | null;
  hitGlobal: { min: number; max: number } | null;
};

function rangeOf(values: number[]): { min: number; max: number } | null {
  if (!values.length) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

function mergeRange(
  map: Map<number, { min: number; max: number }>,
  offset: number,
  value: number
) {
  const cur = map.get(offset);
  if (!cur) {
    map.set(offset, { min: value, max: value });
    return;
  }
  map.set(offset, { min: Math.min(cur.min, value), max: Math.max(cur.max, value) });
}

/** Min/max per colonna sul set di righe visibili (colori relativi). */
export function buildTemporalMetricRanges(rows: TemporalModelRow[]): MetricColumnRanges {
  const maeByOffset = new Map<number, { min: number; max: number }>();
  const hitByOffset = new Map<number, { min: number; max: number }>();
  const maeGlobals: number[] = [];
  const hitGlobals: number[] = [];

  for (const r of rows) {
    if (r.maeGlobal != null && Number.isFinite(r.maeGlobal)) maeGlobals.push(r.maeGlobal);
    if (r.hitGlobal != null && Number.isFinite(r.hitGlobal)) hitGlobals.push(r.hitGlobal);
    for (const h of r.horizons) {
      if (h.mae != null && Number.isFinite(h.mae)) mergeRange(maeByOffset, h.offset, h.mae);
      if (h.hitPct != null && Number.isFinite(h.hitPct)) mergeRange(hitByOffset, h.offset, h.hitPct);
    }
  }

  return {
    maeByOffset,
    hitByOffset,
    maeGlobal: rangeOf(maeGlobals),
    hitGlobal: rangeOf(hitGlobals),
  };
}

function normLowBetter(value: number, min: number, max: number): number {
  if (max <= min) return 0.5;
  return (value - min) / (max - min);
}

function normHighBetter(value: number, min: number, max: number): number {
  return 1 - normLowBetter(value, min, max);
}

function styleFromScore(score: number, boldThreshold = 0.85): CellStyle {
  if (score >= 0.72) return { color: POS, fontWeight: score >= boldThreshold ? "700" : "600" };
  if (score <= 0.28) return { color: NEG, fontWeight: score <= 0.12 ? "700" : "400" };
  if (score >= 0.45 && score <= 0.55) return { color: MUTED };
  return { color: WARN };
}

/** MAE: più basso = meglio (verde). */
export function maeCellStyle(
  value: number | null | undefined,
  range: { min: number; max: number } | null | undefined
): CellStyle | undefined {
  if (!TABLE_COLORS_ENABLED || value == null || !Number.isFinite(value)) return undefined;
  if (!range) {
    if (value <= 2) return { color: POS, fontWeight: "600" };
    if (value >= 10) return { color: NEG, fontWeight: "700" };
    return { color: MUTED };
  }
  const score = normHighBetter(value, range.min, range.max);
  return styleFromScore(score);
}

/** Hit % / Acc %: più alto = meglio (verde). */
export function hitCellStyle(
  value: number | null | undefined,
  range: { min: number; max: number } | null | undefined
): CellStyle | undefined {
  if (!TABLE_COLORS_ENABLED || value == null || !Number.isFinite(value)) return undefined;
  if (!range) {
    if (value >= 75) return { color: POS, fontWeight: "600" };
    if (value < 55) return { color: NEG };
    return { color: MUTED };
  }
  const score = normHighBetter(value, range.min, range.max);
  return styleFromScore(score);
}

/** Bias / gap firmati: vicino a 0 neutro, positivo/negativo colorati. */
export function signedPpCellStyle(value: number | null | undefined, maxAbs = 5): CellStyle | undefined {
  if (!TABLE_COLORS_ENABLED || value == null || !Number.isFinite(value)) return undefined;
  if (Math.abs(value) < 0.05) return { color: MUTED };
  const bold = Math.abs(value) >= maxAbs * 0.4;
  if (value > 0) return { color: POS, fontWeight: bold ? "700" : "400" };
  return { color: NEG, fontWeight: bold ? "700" : "400" };
}

export function cellStyleToCss(style: CellStyle | undefined): CSSProperties | undefined {
  if (!style) return undefined;
  return style as CSSProperties;
}

export function buildModelAggRanges(aggs: ModelAgg[]): MetricColumnRanges {
  const rows: TemporalModelRow[] = aggs.map((m) => ({
    runIso: "",
    model: m.model,
    nRows: m.global.n,
    horizons: m.horizons,
    maeGlobal: m.global.mae,
    hitGlobal: m.global.hitPct,
  }));
  return buildTemporalMetricRanges(rows);
}

export function emptyTemporalRanges(): MetricColumnRanges {
  return {
    maeByOffset: new Map(),
    hitByOffset: new Map(),
    maeGlobal: null,
    hitGlobal: null,
  };
}

export { ACCURACY_OFFSETS };
