/**
 * Empirical P(continuation) vs g10-rate percentile curves (chart geometry).
 * Backend: prediction/continuation_score.build_percentile_continuation_curve
 */

export type ContCurvePoint = {
  pct: number;
  p: number;
  n: number;
  /** Median 10d % rate in the bin (optional; placement fallback). */
  g?: number;
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseContCurve(raw: unknown): ContCurvePoint[] {
  if (!Array.isArray(raw)) return [];
  const out: ContCurvePoint[] = [];
  for (const pt of raw) {
    if (!pt || typeof pt !== "object") continue;
    const o = pt as Record<string, unknown>;
    const pct = num(o.pct);
    const p = num(o.p);
    const n = num(o.n) ?? 0;
    const g = num(o.g);
    if (pct == null || p == null) continue;
    out.push(g != null ? { pct, p, n, g } : { pct, p, n });
  }
  out.sort((a, b) => a.pct - b.pct);
  return out;
}

export function resolveContCurveOwn(
  simRow: Record<string, unknown> | null | undefined,
): ContCurvePoint[] {
  return parseContCurve(simRow?.cont_curve_own);
}

export function resolveContCurvePop(
  simRow: Record<string, unknown> | null | undefined,
): ContCurvePoint[] {
  return parseContCurve(simRow?.cont_curve_pop);
}

/**
 * Population curve from Simulation table meta or any enriched row.
 * Shared by Home dashboard + Evaluation so both charts share geometry.
 */
export function resolvePopulationCurveFromSimTable(
  simTable: {
    rows?: Array<Record<string, unknown> | unknown>;
    continuation_curves?: { population?: unknown };
  } | null | undefined,
): ContCurvePoint[] {
  if (!simTable) return [];
  const meta = simTable.continuation_curves?.population;
  const fromMeta = resolveContCurvePop(
    meta ? ({ cont_curve_pop: meta } as Record<string, unknown>) : null,
  );
  if (fromMeta.length) return fromMeta;
  for (const r of simTable.rows ?? []) {
    const c = resolveContCurvePop(r as Record<string, unknown>);
    if (c.length) return c;
  }
  return [];
}

/** Attach table-level Pop curve when the row is missing `cont_curve_pop`. */
export function withContCurvePopFallback(
  simRow: Record<string, unknown> | null | undefined,
  fallbackPop: ContCurvePoint[],
): Record<string, unknown> | null | undefined {
  if (!simRow) return simRow;
  if (resolveContCurvePop(simRow).length || !fallbackPop.length) return simRow;
  return { ...simRow, cont_curve_pop: fallbackPop };
}

export function resolveContPctOwn(
  simRow: Record<string, unknown> | null | undefined,
): number | null {
  return num(simRow?.cont_pct_own);
}

/** Rate percentile in rising pop library (chart X for Population). */
export function resolveContPctPopRate(
  simRow: Record<string, unknown> | null | undefined,
): number | null {
  return num(simRow?.cont_pct_pop);
}

/** Linear interpolate P(continuation) at a rate percentile. */
export function interpolateCurveP(
  curve: ContCurvePoint[],
  pct: number | null | undefined,
): number | null {
  if (pct == null || !Number.isFinite(pct) || !curve.length) return null;
  if (pct <= curve[0]!.pct) return curve[0]!.p;
  const last = curve[curve.length - 1]!;
  if (pct >= last.pct) return last.p;
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (pct <= b.pct) {
      const span = b.pct - a.pct;
      if (!(span > 0)) return b.p;
      const t = (pct - a.pct) / span;
      return Math.round((a.p + t * (b.p - a.p)) * 10) / 10;
    }
  }
  return last.p;
}

/**
 * Estimate rate percentile from 10d % using median `g` on curve bins.
 * Used when cont_pct_pop is missing but the Pop curve carries g anchors.
 */
export function estimatePctFromG10(
  curve: ContCurvePoint[],
  g10: number | null | undefined,
): number | null {
  if (g10 == null || !Number.isFinite(g10) || !curve.length) return null;
  const anchored = curve
    .filter((pt) => pt.g != null && Number.isFinite(pt.g))
    .slice()
    .sort((a, b) => (a.g as number) - (b.g as number));
  if (anchored.length < 2) return null;
  const first = anchored[0]!;
  const last = anchored[anchored.length - 1]!;
  if (g10 <= (first.g as number)) return first.pct;
  if (g10 >= (last.g as number)) return last.pct;
  for (let i = 1; i < anchored.length; i += 1) {
    const a = anchored[i - 1]!;
    const b = anchored[i]!;
    const ga = a.g as number;
    const gb = b.g as number;
    if (g10 <= gb) {
      const span = gb - ga;
      if (!(span > 0)) return b.pct;
      const t = (g10 - ga) / span;
      return Math.round((a.pct + t * (b.pct - a.pct)) * 10) / 10;
    }
  }
  return last.pct;
}

/** First X where Pop P(continuation) crosses at/under the coin-flip level. */
export function findCoinFlipCrossingPct(
  curve: ContCurvePoint[],
  coinFlip = 50,
): number | null {
  if (curve.length < 2) return null;
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1]!;
    const b = curve[i]!;
    if (a.p >= coinFlip && b.p <= coinFlip) {
      const span = a.p - b.p;
      if (!(span > 0)) return b.pct;
      const t = (a.p - coinFlip) / span;
      return Math.round((a.pct + t * (b.pct - a.pct)) * 10) / 10;
    }
    if (a.p <= coinFlip && b.p >= coinFlip) {
      const span = b.p - a.p;
      if (!(span > 0)) return a.pct;
      const t = (coinFlip - a.p) / span;
      return Math.round((a.pct + t * (b.pct - a.pct)) * 10) / 10;
    }
  }
  // Entire curve above coin-flip → strong-wind zone is the full span.
  if (curve.every((pt) => pt.p >= coinFlip)) {
    return curve[curve.length - 1]!.pct;
  }
  // Entire curve below → no sustained-growth zone.
  if (curve.every((pt) => pt.p < coinFlip)) return null;
  return null;
}

/**
 * Merge Own + Pop onto a shared X grid; add `popStrong` for green fill where
 * Pop P(cont) ≥ coin-flip (inserts exact crossing point when needed).
 */
export function mergeDualCurveData(
  own: ContCurvePoint[],
  pop: ContCurvePoint[],
  coinFlip = 50,
): Array<{ pct: number; ownP?: number; popP?: number; popStrong?: number }> {
  const pctSet = new Set<number>();
  for (const p of own) pctSet.add(p.pct);
  for (const p of pop) pctSet.add(p.pct);
  const cross = findCoinFlipCrossingPct(pop, coinFlip);
  if (cross != null) pctSet.add(cross);
  const pcts = [...pctSet].sort((a, b) => a - b);
  return pcts.map((pct) => {
    const row: { pct: number; ownP?: number; popP?: number; popStrong?: number } = {
      pct,
    };
    const o = interpolateCurveP(own, pct);
    const p = interpolateCurveP(pop, pct);
    if (o != null) row.ownP = o;
    if (p != null) {
      row.popP = p;
      if (p >= coinFlip) row.popStrong = p;
    }
    return row;
  });
}
