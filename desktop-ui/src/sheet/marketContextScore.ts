/**
 * Market Context Score (MCS) — load snapshot + per-ticker adjustment (corr 20d).
 */
import { fetchProjectJson } from "../data/projectData";
import { pearsonR } from "./statSignificance";

export type McsDataQuality = "full_data" | "partial" | "proxy_semplificato" | "neutral_unknown" | "null" | string;

export type McsDayComponents = {
  sector?: {
    score?: number | null;
    xbi_slope_5d_pct?: number | null;
    xbi_slope_score?: number | null;
    ratio_slope_5d_pct?: number | null;
    ratio_score?: number | null;
    corr_score?: number | null;
    subcomponents_used?: string[];
  };
  macro?: {
    score?: number | null;
    vix_level?: number | null;
    vix_score?: number | null;
    spread_score?: number | null;
    subcomponents_used?: string[];
  };
  breadth?: { score?: number | null; proxy?: boolean };
  fda?: { score?: number | null; data_quality?: string };
};

export type McsHistoryDay = {
  date: string;
  mcs_global?: number | null;
  mcs_ticker?: number | null;
  components?: McsDayComponents;
  weights_used?: Record<string, number>;
  components_used?: string[];
  data_quality?: Record<string, McsDataQuality>;
};

export type MarketContextSnapshotDoc = {
  version?: number;
  updated_at?: string;
  last_successful_update?: string | null;
  update_status?: "ok" | "partial" | "failed" | "missing";
  stale_days?: number;
  fetch_errors?: Record<string, string>;
  series?: Record<string, Array<{ date: string; close: number; volume?: number | null }>>;
  history?: McsHistoryDay[];
  latest?: McsHistoryDay | null;
};

export type McsBand = "favorable" | "ambiguous" | "adverse" | "unknown";

export type MarketContextDecisionCtx = {
  mcs: number | null;
  mcsAvailable: boolean;
  mcsStaleDays: number;
  mcsBand: McsBand;
  updateStatus?: string;
};

const MCS_WEIGHTS = {
  sector: 0.4,
  macro: 0.3,
  breadth: 0.2,
  fda: 0.1,
} as const;

const SECTOR_SUB = {
  xbi_slope: 0.375,
  ratio_slope: 0.375,
  corr: 0.25,
} as const;

let cachedSnapshot: MarketContextSnapshotDoc | null = null;

export function getCachedMarketContextSnapshot(): MarketContextSnapshotDoc | null {
  return cachedSnapshot;
}

export function setCachedMarketContextSnapshot(doc: MarketContextSnapshotDoc | null): void {
  cachedSnapshot = doc;
}

export async function loadMarketContextSnapshot(): Promise<MarketContextSnapshotDoc> {
  const res = await fetchProjectJson<MarketContextSnapshotDoc>("market_context_snapshot.json");
  const doc = res.data ?? { update_status: "missing", stale_days: 999, history: [], latest: null };
  cachedSnapshot = doc;
  return doc;
}

/**
 * MCS is a **stress** score (Python market_context_score.py):
 * high (>65) = external sector/macro stress → adverse;
 * low (<35) = calm / idiosyncratic → favorable for exit reading.
 */
export function mcsBand(score: number | null | undefined): McsBand {
  if (score == null || !Number.isFinite(score)) return "unknown";
  if (score > 65) return "adverse";
  if (score < 35) return "favorable";
  return "ambiguous";
}

export function mcsBandLabel(band: McsBand, it: boolean): string {
  if (band === "adverse") {
    return it ? "Stress esterno" : "External stress";
  }
  if (band === "favorable") {
    return it ? "Mercato calmo" : "Calm market";
  }
  if (band === "ambiguous") return it ? "Ambiguo" : "Ambiguous";
  return it ? "Non disponibile" : "Unavailable";
}

/** Recompute staleness on read — JSON `stale_days` is frozen at write time. */
export function computeMcsStaleDays(
  doc: MarketContextSnapshotDoc | null | undefined,
  now: Date = new Date(),
): number {
  const lastOk = doc?.last_successful_update ?? doc?.updated_at ?? null;
  if (!lastOk?.trim()) return doc?.stale_days ?? 999;
  const t = Date.parse(lastOk);
  if (!Number.isFinite(t)) return doc?.stale_days ?? 999;
  const days = Math.floor((now.getTime() - t) / (24 * 60 * 60 * 1000));
  return Math.max(0, days);
}

/** Weather metaphor for MCS stress band (sun = calm/low stress, clouds = adverse). */
export function mcsBandWeatherIcon(band: McsBand): string {
  if (band === "favorable") return "☀";
  if (band === "ambiguous") return "⛅";
  if (band === "adverse") return "☁";
  return "—";
}

export function mcsStaleWarning(staleDays: number, it: boolean): string | null {
  if (staleDays >= 2) {
    return it
      ? `MCS non aggiornato da ${staleDays} giorni — le decisioni di exit richiedono revisione manuale.`
      : `MCS not updated for ${staleDays} days — exit decisions need manual review.`;
  }
  if (staleDays === 1) {
    return it ? "MCS datato (1 giorno) — verifica refresh giornaliero." : "MCS stale (1 day) — check daily refresh.";
  }
  return null;
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

/** Pearson corr of last 20 daily returns — ticker vs XBI. */
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

export function scoreCorr20d(corr: number | null): number | null {
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
    (e): e is [keyof typeof MCS_WEIGHTS, number] =>
      e[1] != null && Number.isFinite(e[1]),
  );
  if (!active.length) return null;
  const raw = active.reduce((s, [k]) => s + MCS_WEIGHTS[k], 0);
  return Math.round(active.reduce((s, [k, v]) => s + v * (MCS_WEIGHTS[k] / raw), 0) * 100) / 100;
}

/** Per-ticker MCS: global sector/macro/breadth/fda + rolling corr when ticker closes supplied. */
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

export function getMcsForDate(
  doc: MarketContextSnapshotDoc | null | undefined,
  dateIso: string,
): McsHistoryDay | null {
  if (!doc) return null;
  const key = dateIso.slice(0, 10);
  if (!doc.history?.length) return doc.latest ?? null;

  const sorted = [...doc.history].sort((a, b) => a.date.localeCompare(b.date));
  const exact = sorted.find((h) => h.date === key);
  if (exact) return exact;

  // MCS is daily — use the latest snapshot on or before assignment (weekends/holidays).
  let best: McsHistoryDay | null = null;
  for (const h of sorted) {
    if (h.date <= key) best = h;
    else break;
  }
  if (best) return best;
  const first = sorted[0];
  if (first && key < first.date) return null;
  return doc.latest ?? null;
}

export function buildMarketContextDecisionCtx(
  doc: MarketContextSnapshotDoc | null | undefined,
  now: Date = new Date(),
): MarketContextDecisionCtx {
  const latest = doc?.latest ?? doc?.history?.[doc.history.length - 1] ?? null;
  const mcs = latest?.mcs_global ?? null;
  const stale = computeMcsStaleDays(doc, now);
  const status = doc?.update_status ?? "missing";
  // Stale snapshot is still readable, but decision guards treat ≥2d as unavailable.
  const available = status !== "failed" && status !== "missing" && mcs != null;
  return {
    mcs,
    mcsAvailable: available,
    mcsStaleDays: stale,
    mcsBand: mcsBand(mcs),
    updateStatus: status,
  };
}

export function xbiClosesFromSnapshot(doc: MarketContextSnapshotDoc | null | undefined): number[] {
  const bars = doc?.series?.XBI ?? doc?.series?.["^XBI"] ?? [];
  return bars.map((b) => b.close).filter((v) => Number.isFinite(v));
}

export const MCS_HOLD_EXTERNAL_MIN = 55;
export const MCS_SELL_INTERNAL_MAX = 40;
