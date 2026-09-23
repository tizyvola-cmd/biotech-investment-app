/**
 * KPI snapshot "Vol %" column: session volume as % of last market close.
 */
import type { VolumeVsPrevSessionRow } from "../api/supernova";
import { nyseSessionsElapsedSince } from "./marketSession";
import { formatShareVolume } from "./todayShareVolume";

/** Reuse last Yahoo print without another round-trip (same TTL as the API). */
export const VOLUME_VS_PREV_CLIENT_FRESH_MS = 5 * 60 * 1000;
/** Keep a stale cell on screen after restart; refresh in the background. */
export const VOLUME_VS_PREV_CLIENT_KEEP_MS = 24 * 60 * 60 * 1000;
const VOLUME_VS_PREV_STORAGE_KEY = "sn_vol_vs_prev_v1";

type VolumeVsPrevCacheEntry = { at: number; row: VolumeVsPrevSessionRow };

let volumeVsPrevMem: Record<string, VolumeVsPrevCacheEntry> = {};
let volumeVsPrevHydrated = false;

function volumeVsPrevStore(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function resetVolumeVsPrevClientCache(): void {
  volumeVsPrevMem = {};
  volumeVsPrevHydrated = true;
  try {
    volumeVsPrevStore()?.removeItem(VOLUME_VS_PREV_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function hydrateVolumeVsPrevCache(): void {
  if (volumeVsPrevHydrated) return;
  volumeVsPrevHydrated = true;
  try {
    const raw = volumeVsPrevStore()?.getItem(VOLUME_VS_PREV_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, VolumeVsPrevCacheEntry>;
    if (!parsed || typeof parsed !== "object") return;
    const now = Date.now();
    for (const [tk, ent] of Object.entries(parsed)) {
      if (!tk || !ent?.row || typeof ent.at !== "number") continue;
      if (now - ent.at > VOLUME_VS_PREV_CLIENT_KEEP_MS) continue;
      volumeVsPrevMem[tk.trim().toUpperCase()] = ent;
    }
  } catch {
    /* ignore corrupt cache */
  }
}

function persistVolumeVsPrevCache(): void {
  try {
    volumeVsPrevStore()?.setItem(VOLUME_VS_PREV_STORAGE_KEY, JSON.stringify(volumeVsPrevMem));
  } catch {
    /* quota / private mode */
  }
}

export function peekVolumeVsPrevCache(
  tickers: string[],
  opts?: { freshMs?: number; keepMs?: number; now?: number },
): { rows: Record<string, VolumeVsPrevSessionRow>; stale: string[] } {
  hydrateVolumeVsPrevCache();
  const now = opts?.now ?? Date.now();
  const freshMs = opts?.freshMs ?? VOLUME_VS_PREV_CLIENT_FRESH_MS;
  const keepMs = opts?.keepMs ?? VOLUME_VS_PREV_CLIENT_KEEP_MS;
  const rows: Record<string, VolumeVsPrevSessionRow> = {};
  const stale: string[] = [];
  const seen = new Set<string>();
  for (const raw of tickers) {
    const tk = raw.trim().toUpperCase();
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    const hit = volumeVsPrevMem[tk];
    if (hit && now - hit.at <= keepMs) rows[tk] = hit.row;
    if (!hit || now - hit.at > freshMs) stale.push(tk);
  }
  return { rows, stale };
}

export function rememberVolumeVsPrevRows(
  rows: Record<string, VolumeVsPrevSessionRow>,
  opts?: { now?: number },
): void {
  hydrateVolumeVsPrevCache();
  const now = opts?.now ?? Date.now();
  let wrote = false;
  for (const [raw, row] of Object.entries(rows)) {
    const tk = raw.trim().toUpperCase();
    if (!tk || !row) continue;
    const prev = volumeVsPrevMem[tk]?.row;
    volumeVsPrevMem[tk] = {
      at: now,
      row: prev ? coalesceVolumeVsPrevRow(prev, row) : row,
    };
    wrote = true;
  }
  if (wrote) persistVolumeVsPrevCache();
}

function finitePositiveClose(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Keep last/prev close when a live Yahoo reprint omits them (weekend holes). */
export function coalesceVolumeVsPrevRow(
  prev: VolumeVsPrevSessionRow,
  next: VolumeVsPrevSessionRow,
): VolumeVsPrevSessionRow {
  const nextLast = finitePositiveClose(next.last_close);
  const nextPrev = finitePositiveClose(next.prev_close);
  const prevLast = finitePositiveClose(prev.last_close);
  const prevPrevClose = finitePositiveClose(prev.prev_close);
  const keepHour =
    next.hour_chg_pct == null && prev.hour_chg_pct != null
      ? {
          hour_chg_pct: prev.hour_chg_pct,
          ...(prev.prev_hour_close != null
            ? { prev_hour_close: prev.prev_hour_close }
            : {}),
        }
      : {};
  // Full live print — take it, but don't wipe hourly Δ visit stamped by the server.
  if (nextLast != null && nextPrev != null) {
    return Object.keys(keepHour).length ? { ...next, ...keepHour } : next;
  }
  // Empty shell with nothing warm to keep — do not invent; caller should skip plant.
  if (nextLast == null && nextPrev == null && prevLast == null && prevPrevClose == null) {
    return prev;
  }
  const keepLast = nextLast ?? prevLast;
  const keepPrev = nextPrev ?? prevPrevClose;
  return {
    ...next,
    ...(keepLast != null ? { last_close: keepLast } : {}),
    ...(keepPrev != null ? { prev_close: keepPrev } : {}),
    ...keepHour,
  };
}

/** mergeTickerMaps for vol rows — never wipe session closes with an incomplete fetch. */
export function mergeVolumeVsPrevMaps(
  prev: Record<string, VolumeVsPrevSessionRow>,
  next: Record<string, VolumeVsPrevSessionRow> | null | undefined,
): Record<string, VolumeVsPrevSessionRow> {
  if (!next || !Object.keys(next).length) return prev;
  let changed = false;
  const out: Record<string, VolumeVsPrevSessionRow> = { ...prev };
  for (const [raw, row] of Object.entries(next)) {
    const tk = raw.trim().toUpperCase();
    if (!tk || row == null) continue;
    const old = out[tk];
    if (!old) {
      if (
        finitePositiveClose(row.last_close) == null &&
        finitePositiveClose(row.prev_close) == null
      ) {
        continue;
      }
      out[tk] = row;
      changed = true;
      continue;
    }
    const merged = coalesceVolumeVsPrevRow(old, row);
    if (tickerRowShallowEqualVol(old, merged)) continue;
    out[tk] = merged;
    changed = true;
  }
  return changed ? out : prev;
}

/**
 * Patch a live vol store without wiping last/prev close when Yahoo omits them.
 * Returns the coalesced patch written to the store.
 */
export function setVolumeVsPrevManyCoalesced(
  getPrev: (ticker: string) => VolumeVsPrevSessionRow | undefined,
  setMany: (rows: Record<string, VolumeVsPrevSessionRow>) => void,
  next: Record<string, VolumeVsPrevSessionRow> | null | undefined,
): Record<string, VolumeVsPrevSessionRow> {
  if (!next || !Object.keys(next).length) return {};
  const patch: Record<string, VolumeVsPrevSessionRow> = {};
  for (const [raw, row] of Object.entries(next)) {
    const tk = raw.trim().toUpperCase();
    if (!tk || row == null) continue;
    const old = getPrev(tk);
    if (!old) {
      const last = finitePositiveClose(row.last_close);
      const prevC = finitePositiveClose(row.prev_close);
      // Skip planting empty Yahoo shells for tickers never warm in the store.
      if (last == null && prevC == null) continue;
      patch[tk] = row;
      continue;
    }
    patch[tk] = coalesceVolumeVsPrevRow(old, row);
  }
  if (Object.keys(patch).length) setMany(patch);
  return patch;
}

function tickerRowShallowEqualVol(
  a: VolumeVsPrevSessionRow,
  b: VolumeVsPrevSessionRow,
): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (
      (a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]
    ) {
      return false;
    }
  }
  return true;
}

/** At or above this share of the prior session the volume is a surge (bold green). */
export const VOLUME_SURGE_PCT = 150;

/** Last bar must be at least this share of the window peak to count as High Vol on the chart. */
export const VOLUME_SURGE_MIN_SHARE_OF_WINDOW_PEAK = 0.04;

/** Last completed daily bar still counts as "now" for EIS search (today + 2 sessions). */
export const VOLUME_SURGE_EIS_MAX_SESSIONS_AGO = 2;

/**
 * Y-axis cap when one historical print (e.g. 54.7M) would flatten every other day.
 * Peak is kept for the Max caption; the line is clipped to `ceiling`.
 */
export function volumePlotCeiling(volumes: number[]): {
  peak: number;
  ceiling: number;
  clipped: boolean;
} {
  const vals = volumes.filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) return { peak: 0, ceiling: 1, clipped: false };
  const sorted = [...vals].sort((a, b) => a - b);
  const peak = sorted[sorted.length - 1]!;
  const p90Idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * 0.9) - 1),
  );
  const body = sorted.length >= 8 ? sorted[p90Idx]! : (sorted[sorted.length - 2] ?? peak);
  if (body > 0 && peak > body * 4) {
    return { peak, ceiling: body * 1.25, clipped: true };
  }
  return { peak, ceiling: peak, clipped: false };
}

export function isVolumeSurge(pct: number | null | undefined): boolean {
  return pct != null && Number.isFinite(pct) && pct >= VOLUME_SURGE_PCT;
}

/**
 * Daily-bar surge on the last point of Volume vs EIS (what the 6M chart shows).
 * Live VOL vs prev compares the *current* session — yesterday's 7.5M spike would
 * not flag today. This is the path that starts EIS search from that spike.
 */
export function lastDailyBarVolumeSurge(
  bars: { date: string; volume: number }[],
  opts?: { now?: Date; maxSessionsAgo?: number },
): { surge: boolean; date: string | null; pctOfPrev: number | null } {
  const sorted = bars
    .filter((b) => b.date && Number.isFinite(b.volume) && b.volume > 0)
    .map((b) => ({ date: String(b.date).slice(0, 10), volume: b.volume }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return { surge: false, date: null, pctOfPrev: null };
  const last = sorted[sorted.length - 1]!;
  const prev = sorted[sorted.length - 2]!;
  if (!(prev.volume > 0)) return { surge: false, date: last.date, pctOfPrev: null };
  const pctOfPrev = (last.volume / prev.volume) * 100;
  if (!isVolumeSurge(pctOfPrev)) {
    return { surge: false, date: last.date, pctOfPrev };
  }
  const peak = Math.max(...sorted.map((b) => b.volume));
  if (peak > 0 && last.volume < peak * VOLUME_SURGE_MIN_SHARE_OF_WINDOW_PEAK) {
    return { surge: false, date: last.date, pctOfPrev };
  }
  const elapsed = nyseSessionsElapsedSince(`${last.date}T16:00:00-04:00`, opts?.now);
  const maxAgo = opts?.maxSessionsAgo ?? VOLUME_SURGE_EIS_MAX_SESSIONS_AGO;
  if (elapsed == null || elapsed > maxAgo) {
    return { surge: false, date: last.date, pctOfPrev };
  }
  return { surge: true, date: last.date, pctOfPrev };
}

export function formatVolDoubling(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "";
  return `×2/${Math.max(1, Math.round(minutes))}m`;
}

export function formatVolumePctOfPrev(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${Math.round(pct)}%`;
}

export function volumeVsPrevTooltip(
  row: VolumeVsPrevSessionRow | null | undefined,
  it: boolean,
): string {
  if (!row) {
    return it
      ? "Volume in % rispetto all'ultima chiusura di mercato non disponibile — riprova al prossimo refresh."
      : "Volume as % of last market close unavailable — retry on next refresh.";
  }
  const parts = it
    ? [
        `Volume ${row.date}: ${formatShareVolume(row.volume)} azioni`,
        `Seduta precedente ${row.prev_date}: ${formatShareVolume(row.prev_volume)}`,
        `${formatVolumePctOfPrev(row.pct_of_prev)} dell'ultima chiusura di mercato`,
      ]
    : [
        `Volume ${row.date}: ${formatShareVolume(row.volume)} shares`,
        `Previous session ${row.prev_date}: ${formatShareVolume(row.prev_volume)}`,
        `${formatVolumePctOfPrev(row.pct_of_prev)} of last market close`,
      ];
  if (isVolumeSurge(row.pct_of_prev)) {
    parts.push(
      it
        ? `Incremento significativo (≥ ${VOLUME_SURGE_PCT}%)`
        : `Significant surge (≥ ${VOLUME_SURGE_PCT}%)`,
    );
  }
  if (row.volume_delta_signed != null && Number.isFinite(row.volume_delta_signed)) {
    const signed = row.volume_delta_signed;
    const tag =
      signed > 0
        ? it
          ? "il prezzo è salito: gli scambi di oggi sono andati col rialzo"
          : "price is up: today's trading went with the rise"
        : signed < 0
          ? it
            ? "il prezzo è sceso: gli scambi di oggi sono andati col calo"
            : "price is down: today's trading went with the drop"
          : it
            ? "prezzo fermo rispetto a ieri"
            : "price unchanged vs prior day";
    parts.push(tag);
  }
  if (row.obv_divergence_flag) {
    parts.push(
      it
        ? "negli ultimi giorni prezzo e volume non vanno d'accordo"
        : "over the last few days price and volume disagree",
    );
  }
  return parts.join(" · ");
}

export function volumeDeltaLabel(
  signed: number | null | undefined,
  it: boolean,
): string | null {
  if (signed == null || !Number.isFinite(signed) || signed === 0) return null;
  return signed > 0
    ? it
      ? "volume sul rialzo"
      : "volume on the rise"
    : it
      ? "volume sul calo"
      : "volume on the drop";
}

/** KPI Vol cell: one plain line + optional “they disagree” line. */
export function formatKpiVolumePlain(
  signed: number | null | undefined,
  diverge: boolean,
  it: boolean,
): { label: string; extra: string | null; tip: string } | null {
  const label = volumeDeltaLabel(signed, it);
  const extra = diverge
    ? it
      ? "prezzo e volume discordi"
      : "price and volume disagree"
    : null;
  if (!label && !extra) return null;
  const down = signed != null && Number.isFinite(signed) && signed < 0;
  const tip = [
    label
      ? down
        ? it
          ? "Oggi il prezzo è sceso: gli scambi sono andati col calo (più vendite che acquisti)."
          : "Price is down today: trading went with the drop (more selling than buying)."
        : it
          ? "Oggi il prezzo è salito: gli scambi sono andati col rialzo (più acquisti che vendite)."
          : "Price is up today: trading went with the rise (more buying than selling)."
      : null,
    extra
      ? it
        ? "Negli ultimi giorni il prezzo è andato da una parte e il volume dall'altra."
        : "Over the last few days price went one way and volume the other."
      : null,
    it ? "Non è Soft BUY/SELL." : "Not Soft BUY/SELL.",
  ]
    .filter(Boolean)
    .join(" ");
  return { label: label ?? extra!, extra: label ? extra : null, tip };
}

/** Quantity vs prior Nasdaq session — independent of today's price direction. */
export function deskVolumeQtyVsPrior(
  pct: number | null | undefined,
): "more" | "less" | "same" | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (pct >= 105) return "more";
  if (pct <= 95) return "less";
  return "same";
}

/**
 * One line that answers "how can 127% be money-out?":
 * % = share count vs prior close; second fact = today's close vs yesterday.
 */
export function formatDeskVolumeCombo(
  row: VolumeVsPrevSessionRow | null | undefined,
  it: boolean,
): string | null {
  if (!row) return null;
  const qty = deskVolumeQtyVsPrior(row.pct_of_prev);
  const signed = row.volume_delta_signed;
  const hasDir = signed != null && Number.isFinite(signed) && signed !== 0;
  const down = hasDir && signed < 0;
  if (!hasDir) {
    if (qty === "more") return it ? "più scambi di ieri" : "more trading than prior day";
    if (qty === "less") return it ? "meno scambi di ieri" : "less trading than prior day";
    return null;
  }
  if (qty === "more") {
    return down
      ? it
        ? "più scambi di ieri, ma il prezzo scende"
        : "more trading than prior day, but price is down"
      : it
        ? "più scambi di ieri, e il prezzo sale"
        : "more trading than prior day, and price is up";
  }
  if (qty === "less") {
    return down
      ? it
        ? "meno scambi di ieri, prezzo in calo"
        : "less trading than prior day, price is down"
      : it
        ? "meno scambi di ieri, prezzo in rialzo"
        : "less trading than prior day, price is up";
  }
  return down
    ? it
      ? "stessi scambi di ieri, prezzo in calo"
      : "same volume as prior day, price is down"
    : it
      ? "stessi scambi di ieri, prezzo in rialzo"
      : "same volume as prior day, price is up";
}

/** Quantity-only vs prior session: +27% / −30% / =. Independent of price. */
export function formatDeskVolumeQtyOnly(
  pct: number | null | undefined,
): { label: string; tone: "up" | "down" | "flat" | "none" } {
  if (pct == null || !Number.isFinite(pct)) return { label: "—", tone: "none" };
  const delta = Math.round(pct) - 100;
  if (delta === 0) return { label: "=", tone: "flat" };
  return {
    label: `${delta > 0 ? "+" : ""}${delta}%`,
    tone: delta > 0 ? "up" : "down",
  };
}

export type DeskSessionPrice = {
  lastClose: number;
  prevClose: number;
  deltaUsd: number;
  deltaPct: number;
};

/**
 * When Yahoo vol/price is late or the cache predates last_close, fill $ from
 * the Simulation sheet (current price + daily %). Never invents volume %.
 */
export function fillDeskSessionPriceFromSim(
  row: VolumeVsPrevSessionRow | null | undefined,
  args?: { lastPrice?: number | null; dailyChangePct?: number | null },
): VolumeVsPrevSessionRow | null {
  const lastFromApi = finitePositive(row?.last_close);
  const lastFromSim = finitePositive(args?.lastPrice);
  const last = lastFromApi ?? lastFromSim;
  let prev = finitePositive(row?.prev_close);
  const dailyPct = args?.dailyChangePct;
  if (
    prev == null &&
    last != null &&
    dailyPct != null &&
    Number.isFinite(dailyPct) &&
    dailyPct !== -100
  ) {
    const implied = last / (1 + dailyPct / 100);
    prev = finitePositive(implied);
  }
  if (row) {
    if (lastFromApi != null && finitePositive(row.prev_close) != null) return row;
    if (last == null && prev == null) return row;
    return {
      ...row,
      ...(last != null ? { last_close: last } : {}),
      ...(prev != null ? { prev_close: prev } : {}),
    };
  }
  if (last == null || prev == null) return null;
  return {
    date: "",
    volume: 0,
    prev_date: "",
    prev_volume: 0,
    pct_of_prev: Number.NaN,
    last_close: last,
    prev_close: prev,
  };
}

function finitePositive(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function deskSessionPrice(
  row: VolumeVsPrevSessionRow | null | undefined,
): DeskSessionPrice | null {
  const last = row?.last_close;
  const prev = row?.prev_close;
  if (
    last == null ||
    prev == null ||
    !Number.isFinite(last) ||
    !Number.isFinite(prev) ||
    prev === 0
  ) {
    return null;
  }
  const deltaUsd = last - prev;
  return {
    lastClose: last,
    prevClose: prev,
    deltaUsd,
    deltaPct: (deltaUsd / prev) * 100,
  };
}

/**
 * Catalyst desk Δ24h: sheet Var. Giorn. %, then Yahoo prior-session %,
 * then last recorded close vs prior trading-day close (vol cache).
 * Weekend / holiday: sheet and intraday are often empty; vol last/prev
 * still carries Friday close vs Thursday close.
 * Sticky: if a later refresh temporarily blanks all sources, keep the last
 * good % so the column does not flash empty after a full paint.
 */
const stickyDeskDelta24hByTicker = new Map<string, number>();

export function resetStickyDeskDelta24h(): void {
  stickyDeskDelta24hByTicker.clear();
}

export function resolveDeskDelta24hPct(opts: {
  ticker?: string | null;
  simDailyPct?: number | null;
  priorSessionPct?: number | null;
  volRow?: VolumeVsPrevSessionRow | null;
}): number | null {
  const sim = opts.simDailyPct;
  let resolved: number | null = null;
  if (sim != null && Number.isFinite(sim)) resolved = sim;
  else if (
    opts.priorSessionPct != null &&
    Number.isFinite(opts.priorSessionPct)
  ) {
    resolved = opts.priorSessionPct;
  } else {
    const session = deskSessionPrice(opts.volRow);
    if (session?.deltaPct != null && Number.isFinite(session.deltaPct)) {
      resolved = Math.round(session.deltaPct * 100) / 100;
    }
  }
  const tk = opts.ticker?.trim().toUpperCase() ?? "";
  if (resolved != null) {
    if (tk) stickyDeskDelta24hByTicker.set(tk, resolved);
    return resolved;
  }
  if (tk) {
    const sticky = stickyDeskDelta24hByTicker.get(tk);
    if (sticky != null && Number.isFinite(sticky)) return sticky;
  }
  return null;
}

export function formatDeskUsd(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 2 : 3;
  return `$${n.toFixed(digits)}`;
}

export function formatDeskSessionPriceCell(
  row: VolumeVsPrevSessionRow | null | undefined,
): {
  closeLabel: string;
  deltaLabel: string;
  tone: "up" | "down" | "flat" | "none";
} | null {
  const px = deskSessionPrice(row);
  if (!px) return null;
  const tone: "up" | "down" | "flat" =
    px.deltaUsd > 0 ? "up" : px.deltaUsd < 0 ? "down" : "flat";
  const usd = formatDeskUsd(Math.abs(px.deltaUsd));
  const signedUsd =
    px.deltaUsd > 0 ? `+${usd}` : px.deltaUsd < 0 ? `−${usd}` : usd;
  const signedPct =
    px.deltaPct > 0
      ? `+${px.deltaPct.toFixed(1)}%`
      : px.deltaPct < 0
        ? `−${Math.abs(px.deltaPct).toFixed(1)}%`
        : "0.0%";
  return {
    closeLabel: formatDeskUsd(px.lastClose),
    deltaLabel: `${signedUsd} · ${signedPct}`,
    tone,
  };
}

export function deskSessionCompareCaption(it: boolean, live: boolean): string {
  return live
    ? it
      ? "Live vs chiusura NASDAQ precedente (seduta ancora aperta)."
      : "Live vs prior Nasdaq close (session still open)."
    : it
      ? "Mercato chiuso: differenza tra le ultime due sedute NASDAQ."
      : "Market closed: difference between the last two Nasdaq sessions.";
}

export function formatDeskVolumeDiverge(it: boolean): string {
  return it
    ? "ultimi ~6g: prezzo e volume opposti"
    : "last ~6d: price and volume opposite";
}

/** Price vs volume: same direction vs disagreement (anticipation tell). */
export function formatPriceVolDivergence(
  row: VolumeVsPrevSessionRow | null | undefined,
  it: boolean,
): { label: string; tone: "up" | "down" | "warn" | "none"; tip: string } {
  if (!row) {
    return {
      label: "—",
      tone: "none",
      tip: it ? "Nessuna stampa prezzo/volume." : "No price/volume print.",
    };
  }
  const px = deskSessionPrice(row);
  const qty = deskVolumeQtyVsPrior(row.pct_of_prev);
  const signed = row.volume_delta_signed;
  const diverge = Boolean(row.obv_divergence_flag);
  const priceUp = px != null && px.deltaUsd > 0;
  const priceDown = px != null && px.deltaUsd < 0;
  const volUp = qty === "more" || (signed != null && signed > 0);
  const volDown = qty === "less" || (signed != null && signed < 0);
  if (diverge || (priceUp && volDown) || (priceDown && volUp)) {
    return {
      label: it ? "discordi" : "diverge",
      tone: "warn",
      tip: it
        ? "Prezzo e volume non vanno d'accordo — possibile accumulo/distribuzione silenziosa. Non è Soft BUY/SELL."
        : "Price and volume disagree — possible quiet accumulation/distribution. Not Soft BUY/SELL.",
    };
  }
  if (priceUp && volUp) {
    return {
      label: it ? "insieme ↑" : "together ↑",
      tone: "up",
      tip: it
        ? "Prezzo e volume salgono insieme (conferma). Non è Soft BUY/SELL."
        : "Price and volume rising together (confirmation). Not Soft BUY/SELL.",
    };
  }
  if (priceDown && volDown) {
    return {
      label: it ? "insieme ↓" : "together ↓",
      tone: "down",
      tip: it
        ? "Prezzo e volume scendono insieme. Non è Soft BUY/SELL."
        : "Price and volume falling together. Not Soft BUY/SELL.",
    };
  }
  return {
    label: "=",
    tone: "none",
    tip: it ? "Nessuna divergenza evidente." : "No clear divergence.",
  };
}

export function deskVolumeQtyTooltip(
  row: VolumeVsPrevSessionRow | null | undefined,
  it: boolean,
  live: boolean,
): string {
  if (!row) {
    return it
      ? "Volume vs ultima seduta NASDAQ non disponibile."
      : "Volume vs last Nasdaq session unavailable.";
  }
  const qty = formatDeskVolumeQtyOnly(row.pct_of_prev);
  const parts = it
    ? [
        deskSessionCompareCaption(it, live),
        `${row.date}: ${formatShareVolume(row.volume)} azioni.`,
        `${row.prev_date}: ${formatShareVolume(row.prev_volume)} azioni.`,
        qty.tone === "flat"
          ? "Stesso volume (=)."
          : `Quantità ${qty.label} rispetto alla seduta precedente. Non è il prezzo.`,
      ]
    : [
        deskSessionCompareCaption(it, live),
        `${row.date}: ${formatShareVolume(row.volume)} shares.`,
        `${row.prev_date}: ${formatShareVolume(row.prev_volume)} shares.`,
        qty.tone === "flat"
          ? "Same volume (=)."
          : `Quantity ${qty.label} vs the prior session. Not the price.`,
      ];
  return parts.join(" ");
}

export function deskSessionPriceTooltip(
  row: VolumeVsPrevSessionRow | null | undefined,
  it: boolean,
  live: boolean,
): string {
  const px = deskSessionPrice(row);
  if (!px || !row) {
    return it
      ? "Prezzo vs chiusura precedente non disponibile."
      : "Price vs prior close unavailable.";
  }
  return [
    deskSessionCompareCaption(it, live),
    it
      ? `Chiusura / last ${row.date}: ${formatDeskUsd(px.lastClose)}. Seduta prima ${row.prev_date}: ${formatDeskUsd(px.prevClose)}.`
      : `Close / last ${row.date}: ${formatDeskUsd(px.lastClose)}. Prior session ${row.prev_date}: ${formatDeskUsd(px.prevClose)}.`,
  ].join(" ");
}

export function deskVolumeTooltip(
  row: VolumeVsPrevSessionRow | null | undefined,
  it: boolean,
): string {
  if (!row) {
    return it
      ? "Volume oggi vs ultima chiusura NASDAQ non disponibile."
      : "Today vs last Nasdaq close volume unavailable.";
  }
  const combo = formatDeskVolumeCombo(row, it);
  const parts = it
    ? [
        `Oggi ${row.date}: ${formatShareVolume(row.volume)} azioni (stima; se il mercato è aperto il giorno non è finito).`,
        `Ultima chiusura NASDAQ ${row.prev_date}: ${formatShareVolume(row.prev_volume)} azioni.`,
        `${formatVolumePctOfPrev(row.pct_of_prev)} = quante azioni oggi rispetto a ieri. Non è la direzione del prezzo.`,
      ]
    : [
        `Today ${row.date}: ${formatShareVolume(row.volume)} shares (estimate; if the session is open the day is not finished).`,
        `Last Nasdaq close ${row.prev_date}: ${formatShareVolume(row.prev_volume)} shares.`,
        `${formatVolumePctOfPrev(row.pct_of_prev)} = how many shares today vs prior day. Not the price direction.`,
      ];
  if (combo) parts.push(combo);
  if (row.obv_divergence_flag) {
    parts.push(
      it
        ? "«Prezzo e volume opposti»: negli ultimi ~6 giorni il prezzo è andato da una parte e i giorni di volume sul rialzo/calo dall'altra. Non riguarda la % di oggi."
        : "“Price and volume opposite”: over the last ~6 days price went one way and up/down-day volume the other. Not about today's %.",
    );
  }
  return parts.join(" ");
}
