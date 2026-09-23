/**
 * Aggregate Clin / Fin / Corp / Access for Catalyst / Top KPI.
 *
 * Each dimension sums only with itself (Clin≠Fin≠Acc).
 * EIS is a per-event market reaction (12h/24h/36h) — never summed here.
 * Desk Daily Score window: last 36 hours (Deep Dive + Daily News).
 * Daily News fills gaps only when Deep Dive has no scored events yet.
 */
import type {
  ClinicalPreCdRecord,
  ClinicalPublicationEvent,
  DailyNewsHighlight,
  DailyNewsPayload,
  DailyNewsUserAnalysis,
} from "../api/supernova";
import { isUnverifiedHypothesis } from "./eventImpactScore";

export type NewsDimensionScores = {
  clinical: number | null;
  financial: number | null;
  corporate: number | null;
  marketAccess: number | null;
  /** Always null — EIS is per-event only (kept for type compat). */
  eis: number | null;
  /** How many scored articles/events contributed. */
  n: number;
  /** Title / label for tooltip. */
  tipTitle?: string;
  /** Where the scores came from (tooltip). */
  source?: "daily_news" | "deep_dive" | "mixed";
  /** Lookback window used for this rollup (hours). */
  lookbackHours?: number;
};

/** Desk Daily Score rollup (Deep Dive + Daily News). */
export const DIMENSION_SCORE_LOOKBACK_HOURS = 36;

/** Longer window for Portfolio Loss Analysis KPI table (legacy). */
export const DIMENSION_SCORE_LOOKBACK_DAYS = 90;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a + b;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Parse ISO datetime or YYYY-MM-DD (noon UTC) → ms, or NaN. */
export function parseScoreTimestampMs(iso: string | null | undefined): number {
  const raw = String(iso || "").trim();
  if (!raw) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return Date.parse(`${raw}T12:00:00Z`);
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function resolveLookbackHours(opts?: {
  lookbackHours?: number;
  lookbackDays?: number;
}): number {
  if (opts?.lookbackHours != null && Number.isFinite(opts.lookbackHours)) {
    return Math.max(0, opts.lookbackHours);
  }
  if (opts?.lookbackDays != null && Number.isFinite(opts.lookbackDays)) {
    return Math.max(0, opts.lookbackDays * 24);
  }
  return DIMENSION_SCORE_LOOKBACK_HOURS;
}

/**
 * True when the stamp falls inside the lookback window (default 36h).
 * Date-only stamps use noon UTC. Far-future (>1d) stamps are rejected.
 */
export function eventDateWithinLookback(
  iso: string | null | undefined,
  opts?: { nowMs?: number; lookbackDays?: number; lookbackHours?: number },
): boolean {
  const nowMs = opts?.nowMs ?? Date.now();
  const lookbackHours = resolveLookbackHours(opts);
  const ms = parseScoreTimestampMs(iso);
  if (!Number.isFinite(ms)) return false;
  const ageMs = nowMs - ms;
  if (ageMs < -86_400_000) return false; // far future
  return ageMs <= lookbackHours * 3_600_000;
}

function newsItemStamp(
  item: Pick<DailyNewsHighlight, "published_at" | "found_at" | "event_date">,
): string | null {
  return item.published_at || item.found_at || item.event_date || null;
}

function clinicalEventStamp(ev: ClinicalPublicationEvent): string | null {
  return ev.published_at || ev.event_date || null;
}

function fromDims(opts: {
  clinical?: unknown;
  financial?: unknown;
  corporate?: unknown;
  marketAccess?: unknown;
  tipTitle?: string;
  source?: NewsDimensionScores["source"];
}): NewsDimensionScores | null {
  const clinical = num(opts.clinical);
  const financial = num(opts.financial);
  const corporate = num(opts.corporate);
  const marketAccess = num(opts.marketAccess);
  // Sticky unclassified 0.0 rows are not real News chips (match UI CHIP_MIN).
  const CHIP_MIN = 0.25;
  const hasSignal = [clinical, financial, corporate, marketAccess].some(
    (v) => v != null && Math.abs(v) >= CHIP_MIN,
  );
  if (!hasSignal) return null;
  return {
    clinical,
    financial,
    corporate,
    marketAccess,
    eis: null,
    n: 1,
    tipTitle: opts.tipTitle,
    source: opts.source,
  };
}

function fromHighlight(h: DailyNewsHighlight): NewsDimensionScores | null {
  return fromDims({
    clinical: h.clinical_score,
    financial: h.financial_score,
    corporate: h.corporate_score,
    marketAccess: h.market_access_score,
    tipTitle: String(h.title || "").trim() || undefined,
    source: "daily_news",
  });
}

function fromAnalysis(a: DailyNewsUserAnalysis): NewsDimensionScores | null {
  return fromDims({
    clinical: a.clinical_score,
    financial: a.financial_score,
    corporate: a.corporate_score,
    marketAccess: a.market_access_score,
    tipTitle: String(a.summary_10w || a.detail_summary || "").trim() || undefined,
    source: "daily_news",
  });
}

function fromClinicalEvent(ev: ClinicalPublicationEvent): NewsDimensionScores | null {
  if (isUnverifiedHypothesis(ev)) return null;
  return fromDims({
    clinical: ev.clinical_score,
    financial: ev.financial_score,
    corporate: ev.corporate_score,
    marketAccess: ev.market_access_score,
    tipTitle: String(ev.event_title || ev.summary || "").trim() || undefined,
    source: "deep_dive",
  });
}

/** Sum taxonomy legs only (never EIS). */
function mergeSum(
  prev: NewsDimensionScores | undefined,
  next: NewsDimensionScores,
): NewsDimensionScores {
  if (!prev) return next;
  const source: NewsDimensionScores["source"] =
    prev.source && next.source && prev.source !== next.source
      ? "mixed"
      : next.source || prev.source;
  return {
    clinical: sumNullable(prev.clinical, next.clinical),
    financial: sumNullable(prev.financial, next.financial),
    corporate: sumNullable(prev.corporate, next.corporate),
    marketAccess: sumNullable(prev.marketAccess, next.marketAccess),
    eis: null,
    n: prev.n + next.n,
    tipTitle: prev.tipTitle || next.tipTitle,
    source,
    lookbackHours: prev.lookbackHours ?? next.lookbackHours,
  };
}

function addToMap(
  out: Record<string, NewsDimensionScores>,
  tkRaw: string | null | undefined,
  hint: NewsDimensionScores | null,
) {
  const tk = String(tkRaw || "")
    .trim()
    .toUpperCase();
  if (!tk || !hint) return;
  out[tk] = mergeSum(out[tk], hint);
}

function lookbackTipHours(
  opts?: { lookbackHours?: number; lookbackDays?: number },
): number {
  return resolveLookbackHours(opts);
}

/** Daily News payload → ticker → Σ Clin/Fin/Corp/Acc within lookback (default 36h). */
export function newsDimensionScoresByTicker(
  payload: DailyNewsPayload | null | undefined,
  opts?: { nowMs?: number; lookbackHours?: number; lookbackDays?: number },
): Record<string, NewsDimensionScores> {
  const nowMs = opts?.nowMs ?? Date.now();
  const out: Record<string, NewsDimensionScores> = {};
  const inWindow = (
    item: Pick<DailyNewsHighlight, "published_at" | "found_at" | "event_date">,
  ) => {
    const stamp = newsItemStamp(item);
    // Undated live-pack rows stay in (payload is already session-scoped).
    if (!stamp) return true;
    return eventDateWithinLookback(stamp, { ...opts, nowMs });
  };

  for (const h of payload?.highlights ?? []) {
    if (!inWindow(h)) continue;
    addToMap(out, h.ticker, fromHighlight(h));
  }
  for (const h of payload?.top_news ?? []) {
    if (!inWindow(h)) continue;
    addToMap(out, h.ticker, fromHighlight(h));
  }
  // Items can still carry taxonomy when highlights were age-pruned client-side.
  for (const h of payload?.items ?? []) {
    if (!inWindow(h)) continue;
    addToMap(out, h.ticker, fromHighlight(h));
  }
  for (const a of payload?.user_analyses ?? []) {
    if (!inWindow(a)) continue;
    addToMap(out, a.ticker, fromAnalysis(a));
  }
  const hours = lookbackTipHours(opts);
  for (const tk of Object.keys(out)) {
    const row = out[tk]!;
    row.lookbackHours = hours;
    row.tipTitle =
      row.n > 1
        ? `Σ ${row.n} Daily News · ${hours}h`
        : row.tipTitle || `Daily News · ${hours}h`;
  }
  return out;
}

/**
 * Deep Dive clinical events → ticker → Σ Clin/Fin/Corp/Acc within lookback (default 36h).
 * EIS is never rolled up.
 */
export function clinicalDimensionScoresByTicker(
  records: ClinicalPreCdRecord[] | null | undefined,
  lang: "it" | "en" = "it",
  opts?: { nowMs?: number; lookbackHours?: number; lookbackDays?: number },
): Record<string, NewsDimensionScores> {
  const nowMs = opts?.nowMs ?? Date.now();
  const hours = lookbackTipHours(opts);
  const out: Record<string, NewsDimensionScores> = {};
  for (const rec of records ?? []) {
    const tk = String(rec.ticker || "")
      .trim()
      .toUpperCase();
    if (!tk) continue;
    for (const ev of rec.clinical_events ?? rec.timeline_events ?? []) {
      if (!ev || typeof ev !== "object") continue;
      if (!eventDateWithinLookback(clinicalEventStamp(ev), { ...opts, nowMs })) continue;
      addToMap(out, tk, fromClinicalEvent(ev));
    }
  }
  for (const tk of Object.keys(out)) {
    const row = out[tk]!;
    if (row.clinical != null) row.clinical = round1(row.clinical);
    if (row.financial != null) row.financial = round1(row.financial);
    if (row.corporate != null) row.corporate = round1(row.corporate);
    if (row.marketAccess != null) row.marketAccess = round1(row.marketAccess);
    row.eis = null;
    row.lookbackHours = hours;
    row.tipTitle =
      lang === "it"
        ? `Σ Clin/Fin/Acc ultime ${hours}h (Deep Dive)`
        : `Σ Clin/Fin/Acc last ${hours}h (Deep Dive)`;
  }
  return out;
}

/**
 * Merge maps: Deep Dive wins when present for a leg.
 * Daily News only fills empty taxonomy legs (no EIS).
 */
export function mergeDimensionScoreMaps(
  clinical: Record<string, NewsDimensionScores> | null | undefined,
  news: Record<string, NewsDimensionScores> | null | undefined,
): Record<string, NewsDimensionScores> {
  const out: Record<string, NewsDimensionScores> = { ...(clinical ?? {}) };
  for (const [tk, newsRow] of Object.entries(news ?? {})) {
    const prev = out[tk];
    if (!prev) {
      out[tk] = { ...newsRow, eis: null };
      continue;
    }
    out[tk] = {
      clinical: prev.clinical ?? newsRow.clinical,
      financial: prev.financial ?? newsRow.financial,
      corporate: prev.corporate ?? newsRow.corporate,
      marketAccess: prev.marketAccess ?? newsRow.marketAccess,
      eis: null,
      n: Math.max(prev.n, newsRow.n),
      tipTitle: prev.tipTitle || newsRow.tipTitle,
      lookbackHours: prev.lookbackHours ?? newsRow.lookbackHours,
      source:
        prev.source && newsRow.source && (prev.clinical == null || prev.financial == null)
          ? "mixed"
          : prev.source || newsRow.source,
    };
  }
  return out;
}

export function formatNewsDimScore(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const r = Math.round(n * 10) / 10;
  return `${r >= 0 ? "+" : ""}${r.toFixed(1)}`;
}

/** Sort key = Σ of taxonomy legs (never EIS). */
export function newsDimSortKey(s: NewsDimensionScores | null | undefined): number | null {
  if (!s) return null;
  const parts = [s.clinical, s.financial, s.corporate, s.marketAccess].filter(
    (x): x is number => x != null && Number.isFinite(x),
  );
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0);
}

/** Soft BUY day-1 catalyst: at least one positive Clin/Fin/Corp/Access leg (Σ > 0). */
export function newsDimensionBullish(
  s: NewsDimensionScores | null | undefined,
): boolean {
  const key = newsDimSortKey(s);
  return key != null && key > 0;
}

/** Soft SELL catalyst boost: Σ Clin/Fin/Corp/Access < 0. */
export function newsDimensionBearish(
  s: NewsDimensionScores | null | undefined,
): boolean {
  const key = newsDimSortKey(s);
  return key != null && key < 0;
}
