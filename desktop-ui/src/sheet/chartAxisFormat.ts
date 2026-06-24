/** Y-axis tick labels: max 2 decimal places. */

export function fmtAxisPctTick(v: number): string {
  if (!Number.isFinite(v)) return "";
  return (Math.round(Number(v) * 100) / 100).toFixed(2);
}

export function fmtAxisEurTick(v: number): string {
  if (!Number.isFinite(v)) return "";
  const n = Math.round(Number(v) * 100) / 100;
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(2)}k`;
  return n.toFixed(2);
}

/** Pad and snap domain endpoints to 2 decimals; reject non-finite or absurd spans. */
export function paddedPctDomain(
  values: (number | null | undefined)[],
  fallback: [number, number] = [-5, 5]
): [number, number] {
  let min = 0;
  let max = 0;
  let n = 0;
  for (const raw of values) {
    if (raw == null || !Number.isFinite(raw) || Math.abs(raw) > 500) continue;
    min = n === 0 ? raw : Math.min(min, raw);
    max = n === 0 ? raw : Math.max(max, raw);
    n++;
  }
  if (n === 0) return fallback;
  if (min === max) {
    const pad = Math.max(0.5, Math.abs(min) * 0.15 + 0.5);
    return snap2(min - pad, max + pad);
  }
  const pad = Math.max(0.25, (max - min) * 0.12);
  return snap2(min - pad, max + pad);
}

export function paddedEurDomain(
  values: (number | null | undefined)[],
  fallback: [number, number] = [-100, 100]
): [number, number] {
  let min = 0;
  let max = 0;
  let n = 0;
  for (const raw of values) {
    if (raw == null || !Number.isFinite(raw) || Math.abs(raw) > 1e9) continue;
    min = n === 0 ? raw : Math.min(min, raw);
    max = n === 0 ? raw : Math.max(max, raw);
    n++;
  }
  if (n === 0) return fallback;
  if (min === max) {
    const pad = Math.max(10, Math.abs(min) * 0.15 + 10);
    return snap2(min - pad, max + pad);
  }
  const pad = Math.max(5, (max - min) * 0.12);
  return snap2(min - pad, max + pad);
}

function snap2(lo: number, hi: number): [number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-5, 5];
  const a = Math.floor(lo * 100) / 100;
  const b = Math.ceil(hi * 100) / 100;
  if (a >= b) return [a - 0.5, b + 0.5];
  return [a, b];
}
