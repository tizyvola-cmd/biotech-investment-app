/** MCS snapshot types + per-ticker MCS (mirrors desktop marketContextScore). */

export type McsDayComponents = {
  sector?: {
    score?: number | null;
    xbi_slope_score?: number | null;
    ratio_score?: number | null;
  };
  macro?: { score?: number | null };
  breadth?: { score?: number | null };
  fda?: { score?: number | null };
};

export type McsHistoryDay = {
  date: string;
  mcs_global?: number | null;
  components?: McsDayComponents;
};

export type MarketContextSnapshotDoc = {
  version?: number;
  updated_at?: string;
  update_status?: "ok" | "partial" | "failed" | "missing";
  stale_days?: number;
  series?: Record<string, Array<{ date: string; close: number }>>;
  history?: McsHistoryDay[];
  latest?: McsHistoryDay | null;
};

const MCS_WEIGHTS = { sector: 0.4, macro: 0.3, breadth: 0.2, fda: 0.1 } as const;
const SECTOR_SUB = { xbi_slope: 0.375, ratio_slope: 0.375, corr: 0.25 } as const;

function pearsonR(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const x = xs[i]! - mx;
    const y = ys[i]! - my;
    num += x * y;
    dx += x * x;
    dy += y * y;
  }
  const den = Math.sqrt(dx * dy);
  return den > 0 ? num / den : null;
}

function dailyReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    if (prev > 0) out.push((cur - prev) / prev);
  }
  return out;
}

export function computeTickerXbiCorr20d(
  tickerCloses: number[],
  xbiCloses: number[],
): number | null {
  const n = Math.min(21, tickerCloses.length, xbiCloses.length);
  if (n < 6) return null;
  const tk = tickerCloses.slice(-n);
  const xb = xbiCloses.slice(-n);
  const tkR = dailyReturns(tk);
  const xbR = dailyReturns(xb);
  const m = Math.min(tkR.length, xbR.length);
  if (m < 5) return null;
  const r = pearsonR(tkR.slice(-m), xbR.slice(-m));
  return r != null && Number.isFinite(r) ? r : null;
}

function scoreCorr20d(corr: number | null): number | null {
  if (corr == null || !Number.isFinite(corr)) return null;
  return Math.round(Math.max(0, Math.min(100, corr * 100)) * 100) / 100;
}

function blendSectorGlobal(
  xbiSlopeScore: number | null,
  ratioScore: number | null,
  corrScore: number | null,
): number | null {
  const parts: { k: keyof typeof SECTOR_SUB; v: number }[] = [];
  if (xbiSlopeScore != null) parts.push({ k: "xbi_slope", v: xbiSlopeScore });
  if (ratioScore != null) parts.push({ k: "ratio_slope", v: ratioScore });
  if (corrScore != null) parts.push({ k: "corr", v: corrScore });
  if (!parts.length) return null;
  const raw = parts.reduce((s, p) => s + SECTOR_SUB[p.k], 0);
  return Math.round(parts.reduce((s, p) => s + p.v * (SECTOR_SUB[p.k] / raw), 0) * 100) / 100;
}

function blendMcs(parts: Partial<Record<keyof typeof MCS_WEIGHTS, number | null>>): number | null {
  const active = Object.entries(parts).filter(
    (e): e is [keyof typeof MCS_WEIGHTS, number] => e[1] != null && Number.isFinite(e[1]),
  );
  if (!active.length) return null;
  const raw = active.reduce((s, [k]) => s + MCS_WEIGHTS[k], 0);
  return Math.round(active.reduce((s, [k, v]) => s + v * (MCS_WEIGHTS[k] / raw), 0) * 100) / 100;
}

export function computeTickerMcs(
  day: McsHistoryDay,
  tickerCloses?: number[] | null,
  xbiCloses?: number[] | null,
): number | null {
  const sector = day.components?.sector;
  const corr = computeTickerXbiCorr20d(tickerCloses ?? [], xbiCloses ?? []);
  const corrScore = scoreCorr20d(corr);
  const sectorScore = blendSectorGlobal(
    sector?.xbi_slope_score ?? null,
    sector?.ratio_score ?? null,
    corrScore,
  );
  return blendMcs({
    sector: sectorScore ?? sector?.score ?? null,
    macro: day.components?.macro?.score ?? null,
    breadth: day.components?.breadth?.score ?? null,
    fda: day.components?.fda?.score ?? null,
  });
}

export function xbiClosesFromSnapshot(doc: MarketContextSnapshotDoc | null | undefined): number[] {
  const bars = doc?.series?.XBI ?? doc?.series?.["^XBI"] ?? [];
  return bars.map((b) => b.close).filter((v) => Number.isFinite(v));
}
