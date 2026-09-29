/**
 * Persist operational BUY/SELL episodes so the price chart can fill under the
 * curve and draw start/end dashed lines after the rec changes.
 */

export type OperationalRecSide = "buy" | "sell";

export type OperationalRecEpisode = {
  rec: OperationalRecSide;
  startIso: string;
  /** Null = still active. */
  endIso: string | null;
};

const STORAGE_KEY = "supernova_ticker_operational_rec_episodes_v1";
const MAX_TICKERS = 80;
const MAX_EPISODES_PER_TICKER = 24;

function isSide(v: unknown): v is OperationalRecSide {
  return v === "buy" || v === "sell";
}

function loadAll(): Record<string, OperationalRecEpisode[]> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { byTicker?: unknown };
    if (!parsed?.byTicker || typeof parsed.byTicker !== "object") return {};
    const out: Record<string, OperationalRecEpisode[]> = {};
    for (const [tk, list] of Object.entries(parsed.byTicker as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const eps: OperationalRecEpisode[] = [];
      for (const row of list) {
        if (!row || typeof row !== "object") continue;
        const rec = (row as OperationalRecEpisode).rec;
        const startIso = String((row as OperationalRecEpisode).startIso ?? "");
        const endRaw = (row as OperationalRecEpisode).endIso;
        if (!isSide(rec) || !startIso) continue;
        eps.push({
          rec,
          startIso,
          endIso: endRaw == null || endRaw === "" ? null : String(endRaw),
        });
      }
      if (eps.length) out[tk] = eps.slice(-MAX_EPISODES_PER_TICKER);
    }
    return out;
  } catch {
    return {};
  }
}

function saveAll(byTicker: Record<string, OperationalRecEpisode[]>): void {
  if (typeof localStorage === "undefined") return;
  try {
    const keys = Object.keys(byTicker);
    const trimmed =
      keys.length <= MAX_TICKERS
        ? byTicker
        : Object.fromEntries(keys.slice(-MAX_TICKERS).map((k) => [k, byTicker[k]!]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, byTicker: trimmed }));
  } catch {
    /* quota */
  }
}

export function loadTickerOperationalRecEpisodes(ticker: string): OperationalRecEpisode[] {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return [];
  return loadAll()[tk] ?? [];
}

function lastOpen(eps: OperationalRecEpisode[]): OperationalRecEpisode | null {
  for (let i = eps.length - 1; i >= 0; i--) {
    if (eps[i]!.endIso == null) return eps[i]!;
  }
  return null;
}

/**
 * Record today's operational rec. Opening a BUY/SELL starts a fill; HOLD/REVIEW
 * closes the open episode (end dashed line). Same rec left open is a no-op
 * (unless preferStartIso backdates an open BUY/SELL window).
 */
export function syncTickerOperationalRec(
  ticker: string,
  rec: "buy" | "sell" | "hold" | "review" | "none" | null | undefined,
  asOfIso: string,
  opts?: { preferStartIso?: string | null },
): OperationalRecEpisode[] {
  const tk = ticker.trim().toUpperCase();
  if (!tk || !asOfIso.trim()) return [];
  const all = loadAll();
  const prev = [...(all[tk] ?? [])];
  const open = lastOpen(prev);
  const side: OperationalRecSide | null = rec === "buy" || rec === "sell" ? rec : null;
  const prefer = opts?.preferStartIso?.trim() || null;

  if (open && side === open.rec) {
    if (prefer && prefer.slice(0, 10) < open.startIso.slice(0, 10)) {
      open.startIso = prefer.length <= 10 ? prefer : prefer.slice(0, 10);
      all[tk] = prev;
      saveAll(all);
    }
    return prev;
  }
  if (open) open.endIso = asOfIso;
  if (side) {
    const start =
      prefer && prefer.slice(0, 10) <= asOfIso.slice(0, 10)
        ? prefer.length <= 10
          ? prefer
          : prefer.slice(0, 10)
        : asOfIso;
    prev.push({ rec: side, startIso: start, endIso: null });
  }
  const next = prev.slice(-MAX_EPISODES_PER_TICKER);
  all[tk] = next;
  saveAll(all);
  return next;
}

/** Value equality, so a chart re-render can skip a no-op state update. */
export function sameRecEpisodes(
  a: OperationalRecEpisode[],
  b: OperationalRecEpisode[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((ep, i) => {
    const other = b[i]!;
    return ep.rec === other.rec && ep.startIso === other.startIso && ep.endIso === other.endIso;
  });
}

function episodeDayRange(ep: OperationalRecEpisode): { start: string; end: string } {
  return {
    start: ep.startIso.slice(0, 10),
    end: ep.endIso?.slice(0, 10) ?? "9999-12-31",
  };
}

function episodesOverlap(a: OperationalRecEpisode, b: OperationalRecEpisode): boolean {
  const ra = episodeDayRange(a);
  const rb = episodeDayRange(b);
  return ra.start <= rb.end && rb.start <= ra.end;
}

/**
 * Union of persisted episodes with windows rebuilt from Decision Chart rec
 * history. Persisted episodes win on overlap (they carry the clamped /
 * backdated start), derived ones fill the gaps the app never saw live.
 */
export function mergeRecEpisodes(
  stored: OperationalRecEpisode[],
  derived: OperationalRecEpisode[],
): OperationalRecEpisode[] {
  const out = [...stored];
  for (const d of derived) {
    if (out.some((s) => s.rec === d.rec && episodesOverlap(s, d))) continue;
    out.push(d);
  }
  return out.sort((a, b) => a.startIso.localeCompare(b.startIso));
}

function visibleIndexes(
  points: { key: string }[],
  ep: OperationalRecEpisode,
): number[] {
  const idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (pointInRecWindow(points[i]!.key, ep.startIso, ep.endIso)) idx.push(i);
  }
  return idx;
}

/**
 * A closed window that lands on a single visible bar would paint no Area.
 * Stretch it by one bar so the historical BUY/SELL track stays readable.
 * Episodes fully outside the visible range are left untouched.
 */
export function ensureClosedRecEpisodesDrawable(
  points: { key: string }[],
  episodes: OperationalRecEpisode[],
): OperationalRecEpisode[] {
  if (points.length < 2 || !episodes.length) return episodes;
  return episodes.map((ep) => {
    if (ep.endIso == null) return ep;
    const idx = visibleIndexes(points, ep);
    if (idx.length !== 1) return ep;
    const i = idx[0]!;
    if (i + 1 < points.length) {
      return { ...ep, endIso: points[i + 1]!.key.slice(0, 10) };
    }
    return { ...ep, startIso: points[i - 1]!.key.slice(0, 10) };
  });
}

/**
 * Soft BUY/SELL Area needs ≥2 points on the *visible* series.
 * Also clamps open windows that start after the last chart bar (common on 6M:
 * asOf=today while daily series ends on the previous session).
 */
export function ensureOpenRecHasDrawableSpan(
  points: { key: string }[],
  episodes: OperationalRecEpisode[],
): OperationalRecEpisode[] {
  if (points.length < 2 || !episodes.length) return episodes;
  const open = lastOpen(episodes);
  if (!open || open.endIso != null) return episodes;

  const firstKey = points[0]!.key;
  const lastKey = points[points.length - 1]!.key;
  const firstDay = firstKey.slice(0, 10);
  const lastDay = lastKey.slice(0, 10);
  let startDay = open.startIso.slice(0, 10);

  // Episode opens "today" but daily chart ends yesterday → zero fill points.
  if (startDay > lastDay) startDay = lastDay;
  if (startDay < firstDay) startDay = firstDay;

  const filledIdx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (pointInRecWindow(points[i]!.key, startDay, open.endIso)) filledIdx.push(i);
  }

  if (filledIdx.length < 2) {
    const lastIdx = points.length - 1;
    // Prefer a short visible Soft BUY strip (~5 bars) so Area + ochre start line paint.
    const minBars = Math.min(5, points.length);
    startDay = points[Math.max(0, lastIdx - (minBars - 1))]!.key.slice(0, 10);
  }

  if (startDay === open.startIso.slice(0, 10)) return episodes;
  return episodes.map((e) => (e === open ? { ...e, startIso: startDay } : e));
}

/** Clamp an ISO/as-of to the visible series date range (YYYY-MM-DD). */
export function clampRecIsoToSeries(
  iso: string,
  points: { key: string }[],
): string {
  if (!points.length) return iso.trim().slice(0, 10) || iso;
  const day = iso.trim().slice(0, 10);
  const first = points[0]!.key.slice(0, 10);
  const last = points[points.length - 1]!.key.slice(0, 10);
  if (day > last) return last;
  if (day < first) return first;
  return day;
}

function normStart(iso: string): string {
  const s = iso.trim();
  return s.length <= 10 ? `${s}T00:00:00` : s;
}

function normEnd(iso: string): string {
  const s = iso.trim();
  return s.length <= 10 ? `${s}T23:59:59` : s;
}

export function pointInRecWindow(
  pointKey: string,
  startIso: string,
  endIso: string | null,
): boolean {
  const pk = pointKey.trim();
  const pt = pk.length <= 10 ? `${pk}T12:00:00` : pk;
  if (pt < normStart(startIso)) return false;
  if (endIso && pt > normEnd(endIso)) return false;
  return true;
}

export function recFillForPoints<T extends { key: string }>(
  points: T[],
  episodes: OperationalRecEpisode[],
  heightOf?: (point: T) => number | null,
): { buyFill: number | null; sellFill: number | null }[] {
  return points.map((p) => {
    let rec: OperationalRecSide | null = null;
    for (const ep of episodes) {
      if (!pointInRecWindow(p.key, ep.startIso, ep.endIso)) continue;
      rec = ep.rec;
    }
    const fallback = (p as Record<string, unknown>).tickerPrice;
    const raw = heightOf?.(p) ?? (typeof fallback === "number" ? fallback : null);
    const h = raw != null && Number.isFinite(raw) ? raw : null;
    return {
      buyFill: rec === "buy" ? h : null,
      sellFill: rec === "sell" ? h : null,
    };
  });
}

export type RecBoundaryMark = {
  pointKey: string;
  kind: "start" | "end";
  rec: OperationalRecSide;
};

/** Start/end marks that fall on a visible chart point. */
export function recBoundariesForPoints(
  points: { key: string }[],
  episodes: OperationalRecEpisode[],
): RecBoundaryMark[] {
  if (!points.length) return [];
  const out: RecBoundaryMark[] = [];
  for (const ep of episodes) {
    const startPt = points.find((p) => pointInRecWindow(p.key, ep.startIso, ep.endIso));
    if (startPt) out.push({ pointKey: startPt.key, kind: "start", rec: ep.rec });
    if (ep.endIso) {
      let endPt: { key: string } | undefined;
      for (let i = points.length - 1; i >= 0; i--) {
        if (pointInRecWindow(points[i]!.key, ep.startIso, ep.endIso)) {
          endPt = points[i];
          break;
        }
      }
      if (endPt && endPt.key !== startPt?.key) {
        out.push({ pointKey: endPt.key, kind: "end", rec: ep.rec });
      }
    }
  }
  return out;
}
