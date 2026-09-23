/**
 * Client cache for Catalyst Decision columns.
 *
 * Morning (weekday server warm): Ticker/Event/Days + Insider + Exec Exit + FDA Brief + G-Trends.
 * Hourly (Nasdaq open): Vol, Expectation/Skew, Short Δ, vs XBI, Pre-Mkt.
 * Soft BUY/SELL unchanged.
 */
import type {
  CatalystAccumulationRow,
  CatalystShortInterestRow,
  CatalystVsXbiRow,
  EventVolIndexRow,
  PreMktConvictionRow,
  SearchInterestRow,
  VolumeVsPrevSessionRow,
} from "../api/supernova";
import type { FdaAdcomRow } from "./fdaAdcomCalendar";
import { romeDateKey } from "./catalystDeskNewLedger";
import { isUsEquitySessionDay, lastUsEquitySessionDayKey } from "./marketSession";
import {
  logDeskEmptyCell,
  noteDeskFieldFillsFromRow,
} from "./deskEmptyCellDiag";
import {
  coalesceDeskProvenance,
  stampDeskRowProvenance,
} from "./deskFieldProvenance";

const STORAGE_KEY = "supernova.catalystDeskColumnCache.v1";
/** Same-tab listeners (storage event only fires across tabs). */
export const CATALYST_DESK_CACHE_CHANGED = "supernova:catalyst-desk-cache-changed";
const MORNING_KEEP_MS = 36 * 60 * 60 * 1000;
/** Fri morning → Sun evening: keep G-Trends / Insider pack through the closed weekend. */
const MORNING_WEEKEND_KEEP_MS = 72 * 60 * 60 * 1000;
const HOURLY_KEEP_MS = 6 * 60 * 60 * 1000;
/** Hourly columns write one cache bump each — coalesce so Daily News doesn't refetch 5×. */
const CACHE_CHANGED_DEBOUNCE_MS = 400;
let cacheChangedTimer: ReturnType<typeof setTimeout> | null = null;

function notifyCatalystDeskCacheChanged(): void {
  if (typeof window === "undefined") return;
  if (cacheChangedTimer != null) clearTimeout(cacheChangedTimer);
  cacheChangedTimer = setTimeout(() => {
    cacheChangedTimer = null;
    try {
      window.dispatchEvent(new CustomEvent(CATALYST_DESK_CACHE_CHANGED));
    } catch {
      /* ignore */
    }
  }, CACHE_CHANGED_DEBOUNCE_MS);
}

export type CatalystDeskMorningCache = {
  updated_at?: string | null;
  rome_date?: string | null;
  events?: Array<{
    ticker?: string;
    event_date?: string;
    days_until?: number | null;
    event_type?: string;
    event_name?: string;
    company?: string;
    source?: string;
  }>;
  tickers?: string[];
  accumulation?: Record<string, CatalystAccumulationRow>;
  /** Once/day G-Trends snapshot (not Soft BUY/SELL). */
  trends?: Record<string, SearchInterestRow>;
  fda_brief?: Record<string, Partial<FdaAdcomRow> & { ticker?: string }>;
};

export type CatalystDeskHourlyCache = {
  updated_at?: string | null;
  rome_date?: string | null;
  vol?: Record<string, VolumeVsPrevSessionRow>;
  event_vol?: Record<string, EventVolIndexRow>;
  short_interest?: Record<string, CatalystShortInterestRow>;
  vs_xbi?: Record<string, CatalystVsXbiRow>;
  pre_mkt?: Record<string, PreMktConvictionRow>;
  /** @deprecated Trends moved to morning cache; kept for older local snapshots. */
  trends?: Record<string, SearchInterestRow>;
};

export type CatalystDeskCachePayload = {
  morning?: CatalystDeskMorningCache | null;
  hourly?: CatalystDeskHourlyCache | null;
  morning_updated_at?: string | null;
  hourly_updated_at?: string | null;
  horizon_days?: number;
};

type StoredFile = {
  version: 1;
  savedAt: number;
  romeDay: string;
  payload: CatalystDeskCachePayload;
};

function store(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function peekCatalystDeskColumnCache(
  now = Date.now(),
): CatalystDeskCachePayload | null {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredFile;
    if (!parsed?.payload || parsed.version !== 1) return null;
    // Weekdays: 36h. Closed weekend: keep through Sun so G-Trends / morning pack survive.
    const keepMs = isUsEquitySessionDay(new Date(now))
      ? MORNING_KEEP_MS
      : MORNING_WEEKEND_KEEP_MS;
    if (now - parsed.savedAt > keepMs) return null;
    return parsed.payload;
  } catch {
    return null;
  }
}

export function rememberCatalystDeskColumnCache(payload: CatalystDeskCachePayload): void {
  try {
    const prev = peekCatalystDeskColumnCache();
    const merged = mergeCatalystDeskCachePayload(prev, payload);
    const file: StoredFile = {
      version: 1,
      savedAt: Date.now(),
      romeDay: romeDateKey(),
      payload: merged,
    };
    store()?.setItem(STORAGE_KEY, JSON.stringify(file));
    notifyCatalystDeskCacheChanged();
  } catch {
    /* quota / private */
  }
}

/** Prefer non-empty morning/hourly maps — never wipe a warm local peek with an empty server stub.
 *  Hourly maps are merged per-ticker/per-field so a sparse Yahoo reprint cannot delete
 *  Friday vs XBI / skew / short / vol closes.
 */
export function mergeCatalystDeskCachePayload(
  prev: CatalystDeskCachePayload | null | undefined,
  next: CatalystDeskCachePayload | null | undefined,
): CatalystDeskCachePayload {
  const morningHasData = (m: CatalystDeskMorningCache | null | undefined) =>
    Boolean(
      m &&
        (Object.keys(m.accumulation || {}).length ||
          Object.keys(m.trends || {}).length ||
          Object.keys(m.fda_brief || {}).length),
    );
  const morning = morningHasData(next?.morning)
    ? next!.morning
    : morningHasData(prev?.morning)
      ? prev!.morning
      : (next?.morning ?? prev?.morning ?? null);
  const hourly = mergeHourlyDeskCache(prev?.hourly, next?.hourly);
  return {
    ...prev,
    ...next,
    morning,
    hourly,
    morning_updated_at: morning?.updated_at ?? next?.morning_updated_at ?? prev?.morning_updated_at ?? null,
    hourly_updated_at: hourly?.updated_at ?? next?.hourly_updated_at ?? prev?.hourly_updated_at ?? null,
  };
}

/**
 * Deep-merge hourly column maps. A new null/empty field never clears a prior valid value;
 * an empty map never replaces a warm map.
 */
export function mergeHourlyDeskCache(
  prev: CatalystDeskHourlyCache | null | undefined,
  next: CatalystDeskHourlyCache | null | undefined,
): CatalystDeskHourlyCache | null {
  if (!next && !prev) return null;
  if (!next) return prev ?? null;
  if (!prev) return next;
  if (!hourlyDeskCacheHasData(next) && hourlyDeskCacheHasData(prev)) return prev;

  const mergeCol = <T extends object>(
    a: Record<string, T> | null | undefined,
    b: Record<string, T> | null | undefined,
    keys: readonly string[],
  ): Record<string, T> | undefined => {
    const left = a && Object.keys(a).length ? a : null;
    const right = b && Object.keys(b).length ? b : null;
    if (!right && !left) return undefined;
    if (!right) return left ?? undefined;
    if (!left) return right;
    return mergeTickerMapsPreferSignal(left, right, keys);
  };

  return {
    ...prev,
    ...next,
    updated_at: next.updated_at ?? prev.updated_at ?? null,
    rome_date: next.rome_date ?? prev.rome_date ?? null,
    vol: mergeCol(prev.vol, next.vol, DESK_SIGNAL_KEYS.vol),
    event_vol: mergeCol(prev.event_vol, next.event_vol, DESK_SIGNAL_KEYS.eventVol),
    short_interest: mergeCol(
      prev.short_interest,
      next.short_interest,
      DESK_SIGNAL_KEYS.shortInterest,
    ),
    vs_xbi: mergeCol(prev.vs_xbi, next.vs_xbi, DESK_SIGNAL_KEYS.vsXbi),
    pre_mkt: mergeCol(prev.pre_mkt, next.pre_mkt, DESK_SIGNAL_KEYS.preMkt),
    trends: mergeCol(prev.trends, next.trends, DESK_SIGNAL_KEYS.trends),
  };
}

export function hourlyDeskCacheHasData(
  hourly: CatalystDeskHourlyCache | null | undefined,
): boolean {
  if (!hourly) return false;
  return (
    Object.keys(hourly.vol || {}).length +
      Object.keys(hourly.event_vol || {}).length +
      Object.keys(hourly.short_interest || {}).length +
      Object.keys(hourly.vs_xbi || {}).length +
      Object.keys(hourly.pre_mkt || {}).length >
    0
  );
}

export function fdaRowsFromMorningBrief(
  brief: CatalystDeskMorningCache["fda_brief"] | null | undefined,
): FdaAdcomRow[] {
  if (!brief) return [];
  const out: FdaAdcomRow[] = [];
  for (const [tk, row] of Object.entries(brief)) {
    if (!row || typeof row !== "object") continue;
    const ticker = String(row.ticker || tk).trim().toUpperCase();
    if (!ticker) continue;
    out.push({
      id: String(row.id || `${ticker}|${row.date || ""}`),
      date: String(row.date || "").slice(0, 10),
      ticker,
      company: String(row.company || ticker),
      product: String(row.product || ""),
      eventEn: String(row.eventEn || "FDA AdCom"),
      eventIt: String(row.eventIt || row.eventEn || "FDA AdCom"),
      committee: String(row.committee || ""),
      kind: (row.kind as FdaAdcomRow["kind"]) || "vote",
      href: String(row.href || ""),
      briefing: row.briefing ?? null,
    });
  }
  return out;
}

export function isHourlyDeskCacheFresh(
  updatedAt: string | null | undefined,
  now = Date.now(),
  maxAgeMs = 55 * 60 * 1000,
): boolean {
  if (!updatedAt) return false;
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return false;
  return now - t <= maxAgeMs;
}

/** True when hourly snapshot is fresh and has at least one column map to paint. */
export function isHourlyDeskCacheUsable(
  hourly: CatalystDeskHourlyCache | null | undefined,
  now = Date.now(),
  opts?: {
    sameRomeDayOk?: boolean;
    nowRomeDay?: string;
    /** Fri hourly → Sat/Sun: keep vol / vs XBI / skew through the closed weekend. */
    weekendCarryOk?: boolean;
  },
): boolean {
  if (!hourlyDeskCacheHasData(hourly)) return false;
  const maxAgeMs = opts?.sameRomeDayOk ? 18 * 60 * 60 * 1000 : 55 * 60 * 1000;
  const freshByAge = isHourlyDeskCacheFresh(hourly!.updated_at, now, maxAgeMs);
  const freshByDay =
    Boolean(opts?.sameRomeDayOk) &&
    Boolean(hourly!.rome_date) &&
    hourly!.rome_date === (opts?.nowRomeDay ?? romeDateKey());
  // Local live-persist may lack rome_date; still treat same-day age window as OK when data exists.
  if (freshByAge || freshByDay) return true;

  // Weekend / holiday: keep last NASDAQ-session hourly pack (same window as morning G-Trends).
  const weekendOk = Boolean(opts?.weekendCarryOk ?? opts?.sameRomeDayOk);
  if (weekendOk && !isUsEquitySessionDay(new Date(now))) {
    const stamp = hourly!.updated_at ? Date.parse(hourly!.updated_at) : NaN;
    const ageMs = Number.isFinite(stamp) ? now - stamp : Number.POSITIVE_INFINITY;
    if (ageMs < MORNING_WEEKEND_KEEP_MS) {
      const lastSession = lastUsEquitySessionDayKey(new Date(now));
      if (hourly!.rome_date && hourly!.rome_date === lastSession) return true;
      // Rome vs NY session date can differ near midnight — age gate is enough.
      if (hourly!.rome_date || Number.isFinite(stamp)) return true;
    }
  }

  if (opts?.sameRomeDayOk && hourly!.updated_at) {
    return isHourlyDeskCacheFresh(hourly!.updated_at, now, 18 * 60 * 60 * 1000);
  }
  // Warm local peek with column data but missing timestamps — paint, don't block boot.
  if (opts?.sameRomeDayOk && !hourly!.updated_at && !hourly!.rome_date) return true;
  return false;
}

export function isMorningDeskCacheFreshForToday(
  morning: CatalystDeskMorningCache | null | undefined,
  nowRomeDay = romeDateKey(),
  now: Date = new Date(),
): boolean {
  if (!morning) return false;
  if (morning.rome_date && morning.rome_date === nowRomeDay) return true;

  const stamp = morning.updated_at ? Date.parse(morning.updated_at) : NaN;
  const ageMs = Number.isFinite(stamp) ? Date.now() - stamp : Number.POSITIVE_INFINITY;

  // Weekend / holiday: keep last NASDAQ-session morning pack (G-Trends is once/day).
  if (!isUsEquitySessionDay(now) && ageMs < MORNING_WEEKEND_KEEP_MS) {
    const lastSession = lastUsEquitySessionDayKey(now);
    if (morning.rome_date && morning.rome_date === lastSession) return true;
    // Rome date vs NY session date can differ by a day near midnight — age gate is enough.
    if (morning.rome_date || Number.isFinite(stamp)) return true;
  }

  if (!morning.rome_date && ageMs < MORNING_KEEP_MS) return true;
  return false;
}

/** True when morning Insider/Exec Exit map can skip a live accumulation fetch. */
export function isMorningAccumulationUsable(
  morning: CatalystDeskMorningCache | null | undefined,
  tickers: string[],
): boolean {
  if (!isMorningDeskCacheFreshForToday(morning)) return false;
  const accum = morning?.accumulation;
  if (!accum || !Object.keys(accum).length) return false;
  // Warm morning map is enough to skip live SEC — partial ticker overlap is OK.
  if (!tickers.length) return true;
  const hit = tickers.some((t) => Boolean(accum[t.trim().toUpperCase()]));
  return hit || Object.keys(accum).length >= 8;
}

/** Shallow field equality — keeps prior object identity when a fetch reprints the same values. */
export function tickerRowShallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (ao[k] !== bo[k]) return false;
  }
  return true;
}

/**
 * Merge hourly maps without wiping keys the refresh omitted.
 * Returns the previous map reference when no entry actually changed (React setState bail-out)
 * and reuses prior per-ticker object refs when incoming rows are shallow-equal.
 */
export function mergeTickerMaps<T>(
  prev: Record<string, T>,
  next: Record<string, T> | null | undefined,
): Record<string, T> {
  if (!next || !Object.keys(next).length) return prev;
  let changed = false;
  const out: Record<string, T> = { ...prev };
  for (const [raw, row] of Object.entries(next)) {
    const tk = raw.trim().toUpperCase();
    if (!tk || row == null) continue;
    const old = out[tk];
    if (old !== undefined && tickerRowShallowEqual(old, row)) continue;
    out[tk] = row;
    changed = true;
  }
  return changed ? out : prev;
}

/** True when a single field is displayable (not null/NaN/"" / "—"). */
export function deskSignalValueUsable(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "boolean") return true;
  if (typeof v === "string") {
    const s = v.trim();
    return Boolean(s) && s !== "—" && s.toLowerCase() !== "nan";
  }
  if (Array.isArray(v)) return v.length > 0;
  return false;
}

/** Normalize ticker map keys once at ingest (trim + upper). */
export function normalizeDeskTickerMap<T>(
  rows: Record<string, T> | null | undefined,
): Record<string, T> {
  if (!rows) return {};
  const out: Record<string, T> = {};
  for (const [raw, row] of Object.entries(rows)) {
    const tk = raw.trim().toUpperCase();
    if (!tk || row == null) continue;
    out[tk] = row;
  }
  return out;
}

/** Tickers in `wanted` whose row lacks any usable signal field. */
export function listTickersMissingSignal<T extends object>(
  wanted: string[],
  byTicker: Record<string, T> | null | undefined,
  signalKeys: readonly string[],
): string[] {
  const map = byTicker ?? {};
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const raw of wanted) {
    const tk = raw.trim().toUpperCase();
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    if (!deskRowHasSignal(map[tk], signalKeys)) missing.push(tk);
  }
  return missing;
}

/** Drop Yahoo/empty shells before planting into a warm desk map. */
export function filterRowsWithDeskSignal<T extends object>(
  rows: Record<string, T> | null | undefined,
  signalKeys: readonly string[],
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [raw, row] of Object.entries(normalizeDeskTickerMap(rows))) {
    if (deskRowHasSignal(row, signalKeys)) out[raw] = row;
  }
  return out;
}

/** True when any listed field carries a usable display value. */
export function deskRowHasSignal(
  row: unknown,
  signalKeys: readonly string[],
): boolean {
  if (!row || typeof row !== "object") return false;
  const o = row as Record<string, unknown>;
  for (const k of signalKeys) {
    if (deskSignalValueUsable(o[k])) return true;
  }
  return false;
}

/**
 * Prefer a live row when it has signal; otherwise keep the prior warm cell.
 * When both have signal, fill empty signal fields on `next` from `prev`
 * so a partial Yahoo reprint cannot punch holes in an already-painted desk.
 * Empty = null, NaN, "", "—", blank — not only strict null.
 */
export function coalesceDeskTickerRow<T extends object>(
  prev: T,
  next: T,
  signalKeys: readonly string[],
  source = "live",
): T {
  const nextOk = deskRowHasSignal(next, signalKeys);
  const prevOk = deskRowHasSignal(prev, signalKeys);
  // Never let an empty/shell reprint replace prior (or plant a new shell).
  if (!nextOk) {
    if (prevOk) {
      logDeskEmptyCell({
        ticker: String((next as { ticker?: string }).ticker ?? ""),
        field: signalKeys.join(","),
        reason: "shell_rejected_kept_prev",
        wipeSource: source,
      });
    }
    return prev;
  }
  if (!prevOk) {
    noteDeskFieldFillsFromRow(
      String((next as { ticker?: string }).ticker ?? ""),
      next,
      signalKeys,
      source,
      deskSignalValueUsable,
    );
    return stampDeskRowProvenance(next, source, { signalKeys });
  }
  const out = { ...(next as Record<string, unknown>) };
  const p = prev as Record<string, unknown>;
  let filled = false;
  for (const k of signalKeys) {
    if (deskSignalValueUsable(out[k])) continue;
    if (!deskSignalValueUsable(p[k])) continue;
    out[k] = p[k];
    filled = true;
    logDeskEmptyCell({
      ticker: String((next as { ticker?: string }).ticker ?? ""),
      field: k,
      reason: "partial_shell_field_restored",
      wipeSource: source,
    });
  }
  const merged = (filled ? out : next) as T;
  noteDeskFieldFillsFromRow(
    String((merged as { ticker?: string }).ticker ?? ""),
    merged,
    signalKeys,
    source,
    deskSignalValueUsable,
  );
  const stamped = stampDeskRowProvenance(merged, source, { signalKeys });
  return coalesceDeskProvenance(prev, stamped, true) as T;
}

export function mergeTickerMapsPreferSignal<T extends object>(
  prev: Record<string, T>,
  next: Record<string, T> | null | undefined,
  signalKeys: readonly string[],
  source = "merge",
): Record<string, T> {
  if (!next || !Object.keys(next).length) return prev;
  let changed = false;
  const out: Record<string, T> = { ...prev };
  for (const [raw, row] of Object.entries(next)) {
    const tk = raw.trim().toUpperCase();
    if (!tk || row == null) continue;
    const old = out[tk];
    if (!old) {
      // Do not plant empty shells for tickers never seen (weekend pack holes).
      if (!deskRowHasSignal(row, signalKeys)) {
        logDeskEmptyCell({
          ticker: tk,
          field: signalKeys[0] ?? "row",
          reason: "skip_plant_shell",
          wipeSource: source,
        });
        continue;
      }
      out[tk] = row;
      noteDeskFieldFillsFromRow(tk, row, signalKeys, source, deskSignalValueUsable);
      changed = true;
      continue;
    }
    const merged = coalesceDeskTickerRow(old, row, signalKeys, source);
    if (tickerRowShallowEqual(old, merged)) continue;
    out[tk] = merged;
    changed = true;
  }
  return changed ? out : prev;
}

/**
 * Patch a keyed live store without wiping warm signal fields.
 * Returns the coalesced patch written to the store.
 */
export function setDeskStoreManyPreferSignal<T extends object>(
  getPrev: (key: string) => T | undefined,
  setMany: (rows: Record<string, T>) => void,
  next: Record<string, T> | null | undefined,
  signalKeys: readonly string[],
  source = "store",
): Record<string, T> {
  if (!next || !Object.keys(next).length) return {};
  const patch: Record<string, T> = {};
  for (const [raw, row] of Object.entries(next)) {
    const tk = raw.trim().toUpperCase();
    if (!tk || row == null) continue;
    const old = getPrev(tk);
    if (!old) {
      if (!deskRowHasSignal(row, signalKeys)) {
        logDeskEmptyCell({
          ticker: tk,
          field: signalKeys[0] ?? "row",
          reason: "skip_plant_shell",
          wipeSource: source,
        });
        continue;
      }
      patch[tk] = row;
      noteDeskFieldFillsFromRow(tk, row, signalKeys, source, deskSignalValueUsable);
      continue;
    }
    patch[tk] = coalesceDeskTickerRow(old, row, signalKeys, source);
  }
  if (Object.keys(patch).length) setMany(patch);
  return patch;
}

/** Fields that make each Catalyst desk column show a non-"—" cell. */
export const DESK_SIGNAL_KEYS = {
  vol: ["last_close", "prev_close", "pct_of_prev"] as const,
  eventVol: ["ivr", "em_straddle", "em_event", "rr10", "skew_cboe", "pcr_vol", "skew_ratio"] as const,
  shortInterest: ["si_delta_pct", "days_to_cover", "si_shares", "squeeze_risk"] as const,
  vsXbi: ["relative_move", "stock_return"] as const,
  preMkt: ["pre_mkt_price_change_pct", "conviction", "pre_mkt_last"] as const,
  trends: [
    "interest_delta_pct",
    "interest_score",
    "zscore_vs_baseline",
    "search_spike",
    "interest_1d_delta_pct",
  ] as const,
  accumulation: [
    "insider_net_buy_30d",
    "silent_kind",
    "governance_flag",
    "filing_13d",
    "cluster_buy",
    "buy_value_30d",
  ] as const,
} as const;

/**
 * Replace/assign a map while preserving prior per-key object identity when values match.
 * Returns `prev` when the resulting map is identical by key set + shallow values.
 */
export function assignTickerMapsPreserving<T>(
  prev: Record<string, T>,
  next: Record<string, T>,
): Record<string, T> {
  const nextKeys = Object.keys(next);
  if (!nextKeys.length) return Object.keys(prev).length ? {} : prev;
  let changed = Object.keys(prev).length !== nextKeys.length;
  const out: Record<string, T> = {};
  for (const [raw, row] of Object.entries(next)) {
    const tk = raw.trim().toUpperCase();
    if (!tk || row == null) continue;
    const old = prev[tk];
    if (old !== undefined && tickerRowShallowEqual(old, row)) {
      out[tk] = old;
    } else {
      out[tk] = row;
      if (old !== row) changed = true;
    }
  }
  if (!changed) {
    for (const k of Object.keys(prev)) {
      if (!(k in out)) {
        changed = true;
        break;
      }
    }
  }
  return changed ? out : prev;
}

export const CATALYST_DESK_HOURLY_POLL_MS = 60 * 60 * 1000;
export { HOURLY_KEEP_MS, MORNING_KEEP_MS };
