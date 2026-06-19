/** Giorni da CD (T0): negativo = prima del catalyst, positivo = dopo. */

export type NowOffsetMarker = {
  offset: number;
  label: string;
};

/**
 * Subset of calendar offsets for the X axis — keeps anchor knots and «today» pins,
 * drops labels closer than `minGap` days (e.g. T−10 / T−7 / T−5 / T−3 collapse to T−10).
 */
export function pickSparseCalTickOffsets(
  gridOffsets: readonly number[],
  extraOffsets: number[] = [],
  minGap = 9,
): number[] {
  const anchors = new Set([-60, -30, 4, 7]);
  const nowSet = new Set(extraOffsets);
  const sorted = [...new Set([...gridOffsets, ...extraOffsets])].sort((a, b) => a - b);

  const picked: number[] = [];
  for (const off of sorted) {
    const force = anchors.has(off) || nowSet.has(off);
    if (picked.length === 0) {
      picked.push(off);
      continue;
    }
    const prev = picked[picked.length - 1]!;
    if (force) {
      if (Math.abs(off - prev) < minGap && !anchors.has(prev) && !nowSet.has(prev)) {
        picked.pop();
      }
      picked.push(off);
      continue;
    }
    if (Math.abs(off - prev) >= minGap) {
      picked.push(off);
    }
  }
  return picked;
}

function parseCompletionDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!s || s === "—") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const parts = s.replace(/\./g, "/").split("/");
  if (parts.length === 3 && parts[2].length === 4) {
    const d = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) return new Date(ms);
  return null;
}

/** Offset calendario «oggi» rispetto alla Completion Date (0 = giorno CD). */
export function completionDateToNowOffset(completionDate: unknown): number | null {
  const cd = parseCompletionDate(completionDate);
  if (!cd) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  cd.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - cd.getTime()) / 86400000);
}

export function buildNowMarkersFromSimulationRows(
  rows: Record<string, unknown>[]
): NowOffsetMarker[] {
  const byOff = new Map<number, string>();
  const tickersAtOff = new Map<number, Set<string>>();

  for (const r of rows) {
    const off = completionDateToNowOffset(r["Completion Date"]);
    if (off == null || !Number.isFinite(off)) continue;
    const tk = String(r["Ticker"] ?? "")
      .trim()
      .toUpperCase();
    if (!tickersAtOff.has(off)) tickersAtOff.set(off, new Set());
    if (tk) tickersAtOff.get(off)!.add(tk);
    if (!byOff.has(off)) byOff.set(off, "Oggi");
  }

  for (const [off, tickers] of tickersAtOff) {
    const list = [...tickers].sort();
    if (list.length === 1) byOff.set(off, `Oggi · ${list[0]}`);
    else if (list.length > 1) byOff.set(off, `Oggi (${list.join(", ")})`);
  }

  return [...byOff.entries()]
    .sort(([a], [b]) => a - b)
    .map(([offset, label]) => ({ offset, label }));
}

export function interpolateAtOffset(
  points: { offset: number; y: number | null | undefined }[],
  targetOffset: number,
  options?: { extrapolate?: boolean },
): number | null {
  const sorted = points
    .map((p) => ({ off: p.offset, y: p.y }))
    .filter((p): p is { off: number; y: number } => p.y != null && Number.isFinite(p.y))
    .sort((a, b) => a.off - b.off);
  if (!sorted.length) return null;

  const extrapolate = options?.extrapolate === true;

  if (!extrapolate) {
    if (targetOffset <= sorted[0].off) return sorted[0].y;
    if (targetOffset >= sorted[sorted.length - 1].off) return sorted[sorted.length - 1].y;
  } else if (sorted.length >= 2) {
    if (targetOffset <= sorted[0].off) {
      const a = sorted[0];
      const b = sorted[1];
      const t = (targetOffset - a.off) / (b.off - a.off);
      return a.y + t * (b.y - a.y);
    }
    if (targetOffset >= sorted[sorted.length - 1].off) {
      const a = sorted[sorted.length - 2];
      const b = sorted[sorted.length - 1];
      const t = (targetOffset - a.off) / (b.off - a.off);
      return a.y + t * (b.y - a.y);
    }
  } else {
    return sorted[0].y;
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (targetOffset >= a.off && targetOffset <= b.off) {
      const t = (b.off - a.off) === 0 ? 0 : (targetOffset - a.off) / (b.off - a.off);
      return a.y + t * (b.y - a.y);
    }
  }
  return null;
}
