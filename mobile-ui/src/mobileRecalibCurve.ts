/** Punti curva Pred+ricalibrazione da colonne foglio simulazione (fallback desktop). */

export type RecalibCurvePoint = { offset: number; val: number };

const FORWARD_TREND_THRESHOLD_PP = 0.1;

export function extractRecalibCurvePoints(row: Record<string, unknown>): RecalibCurvePoint[] {
  const raw = Object.entries(row)
    .filter(([k]) => k.startsWith("Δ%") && k.includes("Pred\n"))
    .map(([k, v]) => {
      const m = k.match(/([+−-])(\d+)\s*$/u);
      if (!m) return null;
      const sign = m[1] === "+" ? 1 : -1;
      const offset = Number(m[2]) * sign;
      const val = Number(v);
      return Number.isFinite(offset) && Number.isFinite(val) ? { offset, val } : null;
    })
    .filter((x): x is RecalibCurvePoint => x !== null);

  const maxAbs = raw.reduce((m, p) => Math.max(m, Math.abs(p.val)), 0);
  const scale = maxAbs > 0 && maxAbs < 1 ? 100 : 1;
  return raw
    .map((p) => ({ offset: p.offset, val: p.val * scale }))
    .sort((a, b) => a.offset - b.offset);
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
  return Number.isFinite(ms) ? new Date(ms) : null;
}

export function completionDateToNowOffset(completionDate: unknown): number | null {
  const cd = parseCompletionDate(completionDate);
  if (!cd) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  cd.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - cd.getTime()) / 86400000);
}

function interpolateAtOffset(
  points: { offset: number; y: number }[],
  targetOffset: number,
): number | null {
  const sorted = [...points].sort((a, b) => a.offset - b.offset);
  if (!sorted.length) return null;
  if (targetOffset <= sorted[0].offset) return sorted[0].y;
  if (targetOffset >= sorted[sorted.length - 1].offset) return sorted[sorted.length - 1].y;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (targetOffset >= a.offset && targetOffset <= b.offset) {
      const t = (targetOffset - a.offset) / (b.offset - a.offset);
      return a.y + t * (b.y - a.y);
    }
  }
  return null;
}

export function recalibCurveStrokeColor(
  pts: RecalibCurvePoint[],
  nowOff: number | null,
): string {
  if (pts.length < 2) return "rgb(var(--ink-muted))";
  const vals = pts.map((p) => p.val);
  const mapped = pts.map((p) => ({ offset: p.offset, y: p.val }));
  const lastVal = vals[vals.length - 1];
  const nowVal =
    nowOff != null && Number.isFinite(nowOff)
      ? interpolateAtOffset(mapped, nowOff)
      : null;
  const T5_FWD = 5;
  const maxOff = Math.max(...pts.map((p) => p.offset));
  const t5Val =
    nowOff != null && Number.isFinite(nowOff) && nowOff < T5_FWD
      ? interpolateAtOffset(mapped, T5_FWD)
      : null;
  const fwdDelta =
    t5Val != null && nowVal != null
      ? t5Val - nowVal
      : nowVal != null && nowOff != null && nowOff < maxOff
        ? lastVal - nowVal
        : null;
  if (fwdDelta == null) return "rgb(var(--ink-muted))";
  if (fwdDelta >= FORWARD_TREND_THRESHOLD_PP) return "rgb(var(--signal-up))";
  if (fwdDelta <= -FORWARD_TREND_THRESHOLD_PP) return "rgb(var(--signal-down))";
  return "rgb(var(--ink-muted))";
}

/** Asse calendario fisso pre/post CD — evita che «oggi» finisca sempre a sinistra. */
export const SPARKLINE_AXIS_MIN = -120;
export const SPARKLINE_AXIS_MAX = 7;

export function resolveTodayOffset(opts: {
  completionDate?: unknown;
  todayOffset?: number | null;
  daysToCd?: number | null;
}): number | null {
  const fromCd = completionDateToNowOffset(opts.completionDate);
  if (fromCd != null && Number.isFinite(fromCd)) return fromCd;
  if (opts.todayOffset != null && Number.isFinite(opts.todayOffset)) return opts.todayOffset;
  if (opts.daysToCd != null && Number.isFinite(opts.daysToCd) && opts.daysToCd > 0) {
    return -Math.round(opts.daysToCd);
  }
  return null;
}

export function sparklineAxisBounds(
  points: RecalibCurvePoint[],
  nowOff: number | null,
): { minOff: number; maxOff: number } {
  const minOffData = points.length ? Math.min(...points.map((p) => p.offset)) : SPARKLINE_AXIS_MIN;
  const maxOffData = points.length ? Math.max(...points.map((p) => p.offset)) : SPARKLINE_AXIS_MAX;
  return {
    minOff: Math.min(minOffData, SPARKLINE_AXIS_MIN, nowOff ?? SPARKLINE_AXIS_MIN),
    maxOff: Math.max(maxOffData, SPARKLINE_AXIS_MAX, 0, nowOff ?? SPARKLINE_AXIS_MAX),
  };
}

export function xForCurveOffset(
  offset: number,
  minOff: number,
  maxOff: number,
  width: number,
  padX: number,
): number {
  if (maxOff === minOff) return width / 2;
  const t = (offset - minOff) / (maxOff - minOff);
  return padX + t * (width - 2 * padX);
}

export function yForCurveVal(
  val: number,
  min: number,
  range: number,
  height: number,
  padY: number,
): number {
  return padY + (1 - (val - min) / range) * (height - 2 * padY);
}
