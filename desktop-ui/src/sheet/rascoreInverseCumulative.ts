import type { SolidityCompositeComponentId } from "./entrySolidityComposite";
import {
  polarizedComponentPoints,
  type RaComponentPolarity,
} from "./rascoreComponentPolarity";
import {
  RA_INVERSE_COMPONENT_IDS,
  type RaInverseComponentCompare,
  type RaInversePatternResult,
} from "./rascoreInversePattern";

export function roundRaScore2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatRaScore2(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return roundRaScore2(n).toFixed(2);
}

export function formatRaDelta2(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const r = roundRaScore2(n);
  return `${r >= 0 ? "+" : ""}${r.toFixed(2)}`;
}

export type RaInverseCumulativeRow = {
  stepKey: "start" | SolidityCompositeComponentId;
  stepIndex: number;
  upTotal: number;
  downTotal: number;
} & Record<`up_${SolidityCompositeComponentId}`, number> &
  Record<`down_${SolidityCompositeComponentId}`, number>;

function emptyStacks(): Pick<
  RaInverseCumulativeRow,
  `up_${SolidityCompositeComponentId}` | `down_${SolidityCompositeComponentId}`
> {
  const out = {} as Pick<
    RaInverseCumulativeRow,
    `up_${SolidityCompositeComponentId}` | `down_${SolidityCompositeComponentId}`
  >;
  for (const id of RA_INVERSE_COMPONENT_IDS) {
    out[`up_${id}`] = 0;
    out[`down_${id}`] = 0;
  }
  return out;
}

function sumPts(
  components: RaInverseComponentCompare[],
  side: "up" | "down",
  polarities?: RaComponentPolarity[],
): number {
  if (!polarities?.length) {
    const key = side === "up" ? "upMeanPts" : "downMeanPts";
    return roundRaScore2(components.reduce((s, c) => s + (c[key] ?? 0), 0));
  }
  return roundRaScore2(components.reduce((s, c) => s + sidePts(c, side, polarities), 0));
}

function sidePts(
  comp: RaInverseComponentCompare,
  side: "up" | "down",
  polarities: RaComponentPolarity[],
): number {
  const raw = side === "up" ? comp.upMeanPts ?? 0 : comp.downMeanPts ?? 0;
  const pol = polarities.find((p) => p.id === comp.id);
  const invert = Boolean(pol?.reliable && pol.invertForPrice);
  return polarizedComponentPoints(raw, invert);
}

function rowFromIncluded(
  stepKey: RaInverseCumulativeRow["stepKey"],
  stepIndex: number,
  included: RaInverseComponentCompare[],
  polarities?: RaComponentPolarity[],
): RaInverseCumulativeRow {
  const stacks = emptyStacks();
  for (const comp of included) {
    if (polarities?.length) {
      stacks[`up_${comp.id}`] = sidePts(comp, "up", polarities);
      stacks[`down_${comp.id}`] = sidePts(comp, "down", polarities);
    } else {
      stacks[`up_${comp.id}`] = comp.upMeanPts ?? 0;
      stacks[`down_${comp.id}`] = comp.downMeanPts ?? 0;
    }
  }
  return {
    stepKey,
    stepIndex,
    upTotal: sumPts(included, "up", polarities),
    downTotal: sumPts(included, "down", polarities),
    ...stacks,
  };
}

/** One row per cumulative step: each component band stacks to the running RA mean. */
export function buildRaInverseCumulativeRows(
  pattern: RaInversePatternResult,
  polarities?: RaComponentPolarity[],
): RaInverseCumulativeRow[] {
  const rows: RaInverseCumulativeRow[] = [rowFromIncluded("start", 0, [], polarities)];
  const included: RaInverseComponentCompare[] = [];
  for (const comp of pattern.components) {
    included.push(comp);
    rows.push(rowFromIncluded(comp.id, included.length, [...included], polarities));
  }
  return rows;
}

export type RaInverseCumulativeCurveRow = RaInverseCumulativeRow & {
  /** Continuous x for smooth curve (0 = start … n = full composite). */
  stepPosition: number;
};

function smoothstep(u: number): number {
  const t = Math.max(0, Math.min(1, u));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function interpolateRow(
  a: RaInverseCumulativeRow,
  b: RaInverseCumulativeRow,
  u: number,
  stepPosition: number,
): RaInverseCumulativeCurveRow {
  const eased = smoothstep(u);
  const stacks = emptyStacks();
  for (const id of RA_INVERSE_COMPONENT_IDS) {
    stacks[`up_${id}`] = round1(lerp(a[`up_${id}`], b[`up_${id}`], eased));
    stacks[`down_${id}`] = round1(lerp(a[`down_${id}`], b[`down_${id}`], eased));
  }
  const stepKey =
    eased >= 0.98
      ? b.stepKey
      : eased <= 0.02
        ? a.stepKey
        : b.stepKey === "start"
          ? a.stepKey
          : b.stepKey;
  return {
    stepKey,
    stepIndex: b.stepIndex,
    stepPosition,
    upTotal: roundRaScore2(
      RA_INVERSE_COMPONENT_IDS.reduce((s, id) => s + stacks[`up_${id}`], 0),
    ),
    downTotal: roundRaScore2(
      RA_INVERSE_COMPONENT_IDS.reduce((s, id) => s + stacks[`down_${id}`], 0),
    ),
    ...stacks,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Densify knot rows into a smooth cumulative curve (stacked band areas preserved). */
export function densifyRaInverseCumulativeRows(
  rows: RaInverseCumulativeRow[],
  samplesPerSegment = 12,
): RaInverseCumulativeCurveRow[] {
  if (rows.length <= 1) {
    return rows.map((r) => ({ ...r, stepPosition: r.stepIndex }));
  }
  const out: RaInverseCumulativeCurveRow[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    const span = b.stepIndex - a.stepIndex || 1;
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      out.push(interpolateRow(a, b, t, a.stepIndex + span * t));
    }
  }
  const last = rows[rows.length - 1]!;
  out.push({ ...last, stepPosition: last.stepIndex });
  return out;
}

export function raInverseCumulativeYMax(rows: RaInverseCumulativeRow[]): number {
  let max = 0;
  for (const row of rows) {
    max = Math.max(max, row.upTotal, row.downTotal);
  }
  return Math.min(100, Math.ceil((max + 4) / 5) * 5);
}

export function raInverseCumulativeYMin(rows: RaInverseCumulativeRow[]): number {
  let min = 0;
  for (const row of rows) {
    min = Math.min(min, row.upTotal, row.downTotal);
    for (const id of RA_INVERSE_COMPONENT_IDS) {
      min = Math.min(min, row[`up_${id}`], row[`down_${id}`]);
    }
  }
  return Math.floor((min - 4) / 5) * 5;
}
