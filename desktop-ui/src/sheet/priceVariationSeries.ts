import type { IntradayPricePoint } from "./simUniverse24hWhatIf";
import type { PriceVarWindow } from "./xbiMarketVariations";
import { normalizeCompletionDateForKey } from "./investSimKeys";

export type PriceVarChartRange = "24h" | "7d" | "1M" | "3M" | "6M" | "1Y" | "cat6M";

export const PRICE_VAR_CHART_RANGE_ORDER: PriceVarChartRange[] = [
  "24h",
  "7d",
  "1M",
  "3M",
  "6M",
  "1Y",
  "cat6M",
];

export function isCatalystCalendarRange(range: PriceVarChartRange): boolean {
  return range === "cat6M";
}

/**
 * Dashed vertical crosshair shared by the price and volume charts.
 * With a common `syncId` + `syncMethod="value"` both charts land on the same
 * calendar label, so the reader compares price and volume for one day.
 */
export const PRICE_VAR_CHART_CURSOR = {
  stroke: "rgb(var(--ink-muted))",
  strokeOpacity: 0.75,
  strokeWidth: 1.5,
  strokeDasharray: "4 4",
} as const;

export type PriceLinePoint = {
  key: string;
  label: string;
  tickerPrice: number;
  /** XBI rebased to ticker $ scale at period start (for overlay). */
  marketScaled: number | null;
};

export type DailyCloseBar = { date: string; close: number };

const MS_DAY = 24 * 60 * 60 * 1000;

export function rangeToWindowKey(range: PriceVarChartRange): PriceVarWindow {
  if (range === "24h") return "1D";
  if (range === "7d") return "7D";
  if (range === "cat6M") return "6M";
  return range;
}

export function rangeToFetchDays(range: PriceVarChartRange): number {
  switch (range) {
    case "24h":
      return 3;
    case "7d":
      return 10;
    case "1M":
      return 35;
    case "3M":
      return 95;
    case "6M":
    case "cat6M":
      return 200;
    case "1Y":
      return 370;
  }
}

export function rangeToCalendarCutoff(range: PriceVarChartRange, nowMs = Date.now()): string {
  const days =
    range === "24h"
      ? 1
      : range === "7d"
        ? 7
        : range === "1M"
          ? 31
          : range === "3M"
            ? 93
            : range === "6M" || range === "cat6M"
              ? 186
              : 365;
  return new Date(nowMs - days * MS_DAY).toISOString().slice(0, 10);
}

/** True when daily bars start near `cutoffDate` (not merely N recent points). */
export function dailyHistoryCoversCutoff(
  bars: { date: string }[],
  cutoffDate: string,
  minBars = 20,
  slackDays = 21,
): boolean {
  const inRange = bars.filter((b) => b.date >= cutoffDate);
  if (inRange.length < minBars) return false;
  const earliest = inRange.reduce((min, b) => (b.date < min ? b.date : min), inRange[0]!.date);
  const cutoffMs = Date.parse(`${cutoffDate}T12:00:00Z`);
  const earliestMs = Date.parse(`${earliest}T12:00:00Z`);
  if (!Number.isFinite(cutoffMs) || !Number.isFinite(earliestMs)) return false;
  return earliestMs <= cutoffMs + slackDays * MS_DAY;
}

function fmtIntradayLabel(iso: string, it: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 16);
  return d.toLocaleTimeString(it ? "it-IT" : "en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDailyLabel(iso: string, it: boolean): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(5);
  return d.toLocaleDateString(it ? "it-IT" : "en-GB", { day: "numeric", month: "short" });
}

/** Empty future pad on daily charts so CD / upcoming catalysts can sit past last close. */
export const CHART_FUTURE_DAYS = 7;
/** Catalyst calendar view — next ~6 months of empty X so event tags can land. */
export const CATALYST_CALENDAR_FUTURE_DAYS = 186;

export function chartFuturePadDays(range: PriceVarChartRange): number {
  if (range === "24h") return 0;
  if (range === "cat6M") return CATALYST_CALENDAR_FUTURE_DAYS;
  return CHART_FUTURE_DAYS;
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Calendar days after `lastIso` (inclusive of weekends) for the shared price/volume X pad. */
export function futureChartDayIsos(lastIso: string, days = CHART_FUTURE_DAYS): string[] {
  const last = lastIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(last) || days <= 0) return [];
  const out: string[] = [];
  for (let d = 1; d <= days; d++) out.push(isoAddDays(last, d));
  return out;
}

/**
 * Future X keys for price+volume sync.
 * Short pad = every calendar day. Catalyst 6M pad = weekly ticks + extra event dates
 * so the axis is not 180 empty daily slots.
 */
export function futureChartPadIsos(
  lastIso: string,
  days: number,
  extraIsos: Iterable<string> = [],
): string[] {
  const last = lastIso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(last) || days <= 0) return [];
  const end = isoAddDays(last, days);
  const keys = new Set<string>();
  if (days <= CHART_FUTURE_DAYS) {
    for (const iso of futureChartDayIsos(last, days)) keys.add(iso);
  } else {
    for (let d = 7; d <= days; d += 7) keys.add(isoAddDays(last, d));
    keys.add(end);
  }
  for (const raw of extraIsos) {
    const iso = String(raw || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    if (iso > last && iso <= end) keys.add(iso);
  }
  return [...keys].sort();
}

function isoDateOrNull(raw: string | null | undefined): string | null {
  const s = String(raw || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Event date to pin on the calendar pad (window start, else end). */
export function guidanceEventAnchorIso(
  ev: { window_start?: string | null; window_end?: string | null },
): string | null {
  return isoDateOrNull(ev.window_start) ?? isoDateOrNull(ev.window_end);
}

/**
 * ISO to plot on the visible X domain for a catalyst window.
 * In-range start/end win. Windows that overlap the domain clamp to an edge
 * (year-long 2026 → end or first day). Future-only windows pin to lastIso.
 * Fully-past point CDs are omitted — pinning them all to the first tick
 * stacked banners and ate the price-line plot area.
 */
export function resolveCatalystPlotIso(
  windowStart: string | null | undefined,
  windowEnd: string | null | undefined,
  firstIso: string,
  lastIso: string,
): string | null {
  const s = isoDateOrNull(windowStart);
  const e = isoDateOrNull(windowEnd);
  const inRange = (iso: string) => iso >= firstIso && iso <= lastIso;

  if (s && inRange(s)) return s;
  if (e && inRange(e)) return e;

  const winStart = s ?? e;
  const winEnd = e ?? s;
  if (winStart && winEnd && winStart <= lastIso && winEnd >= firstIso) {
    if (s && s < firstIso) return firstIso;
    if (e && e > lastIso) return lastIso;
  }

  if (s && s > lastIso) return lastIso;
  if (e && e > lastIso) return lastIso;
  return null;
}

/** Closest series row by calendar date (weekends snap to the nearest trading day). */
export function nearestDailyRow<T extends { key: string }>(rows: T[], iso: string): T | null {
  const target = isoDateOrNull(iso);
  if (!target || !rows.length) return null;
  const targetMs = Date.parse(`${target}T12:00:00`);
  if (!Number.isFinite(targetMs)) return null;
  let best: T | null = null;
  let bestAbs = Infinity;
  for (const row of rows) {
    const k = isoDateOrNull(row.key);
    if (!k) continue;
    const ms = Date.parse(`${k}T12:00:00`);
    if (!Number.isFinite(ms)) continue;
    const dist = Math.abs(ms - targetMs);
    if (dist < bestAbs) {
      bestAbs = dist;
      best = row;
    }
  }
  return best;
}

/** Golden-yellow CD banner (stroke + pill). */
export const CD_GOLD = "#D4AF37";
export const CD_GOLD_INK = "#3d2e00";

/** Parse Simulation / CT.gov CD (`dd/mm/yyyy`, ISO, or Date.parse-able) → `YYYY-MM-DD`. */
export function parseCompletionDateIso(raw: string | null | undefined): string | null {
  const k = normalizeCompletionDateForKey(raw);
  return k !== "—" && /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null;
}

/** Unique CD dates to pin on the chart: Simulation CD + every trusted NCT cd_date. */
export function collectTickerChartCdIsos(
  ticker: string,
  simCompletionDate: unknown,
  records?: { ticker?: string; cd_date?: string | null; sponsor_match?: string }[] | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (raw: unknown) => {
    const iso = parseCompletionDateIso(raw == null ? null : String(raw));
    if (!iso || seen.has(iso)) return;
    seen.add(iso);
    out.push(iso);
  };
  add(simCompletionDate);
  const tk = ticker.trim().toUpperCase();
  for (const rec of records ?? []) {
    if ((rec.ticker ?? "").trim().toUpperCase() !== tk) continue;
    if (String(rec.sponsor_match ?? "").trim().toLowerCase() === "no match") continue;
    add(rec.cd_date);
  }
  out.sort();
  return out;
}

/** Insert missing calendar keys (weekend CD, NCT CD) so ReferenceLine has an X tick. */
export function ensureIsoTicksInSeries<T extends { key: string; label: string }>(
  rows: T[],
  extraIsos: Iterable<string>,
  it: boolean,
): T[] {
  if (!rows.length) return rows;
  const have = new Set(rows.map((r) => r.key.slice(0, 10)));
  const first = rows[0]!.key.slice(0, 10);
  const last = rows[rows.length - 1]!.key.slice(0, 10);
  const added: T[] = [];
  for (const raw of extraIsos) {
    const iso = String(raw || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || have.has(iso)) continue;
    if (iso < first || iso > last) continue;
    const near = nearestDailyRow(rows, iso);
    if (!near) continue;
    added.push({ ...near, key: iso, label: fmtDailyLabel(iso, it) });
    have.add(iso);
  }
  if (!added.length) return rows;
  return [...rows, ...added].sort((a, b) => a.key.localeCompare(b.key));
}

/** X-axis category (`key`) for a CD — snaps to nearest row; never drops off-chart CDs. */
export function cdChartXKey(rows: { key: string }[], cdIso: string | null): string | null {
  if (!cdIso || !rows.length) return null;
  const exact = rows.find((r) => r.key.slice(0, 10) === cdIso);
  if (exact) return exact.key;
  return nearestDailyRow(rows, cdIso)?.key ?? null;
}

/** X-axis `label` for a CD — snaps to the nearest series row (weekend CD still plots). */
export function cdChartLabelForIso(
  rows: { key: string; label: string }[],
  cdIso: string | null,
  it: boolean,
): string | null {
  if (!cdIso || !rows.length) return null;
  const exact = rows.find((r) => r.key.slice(0, 10) === cdIso);
  if (exact) return exact.label;
  const first = rows[0]!.key.slice(0, 10);
  const last = rows[rows.length - 1]!.key.slice(0, 10);
  if (cdIso < first || cdIso > last) return null;
  return nearestDailyRow(rows, cdIso)?.label ?? fmtDailyLabel(cdIso, it);
}

function mergeIntradayPoints(
  prior: IntradayPricePoint[] | undefined,
  live: IntradayPricePoint[] | undefined,
): IntradayPricePoint[] {
  const seen = new Set<string>();
  const out: IntradayPricePoint[] = [];
  for (const pt of [...(prior ?? []), ...(live ?? [])]) {
    if (!pt?.t || !Number.isFinite(pt.price) || pt.price <= 0) continue;
    if (seen.has(pt.t)) continue;
    seen.add(pt.t);
    out.push(pt);
  }
  out.sort((a, b) => a.t.localeCompare(b.t));
  return out;
}

function scaleMarketToTicker(
  tickerStart: number,
  marketStart: number,
  marketPrice: number,
): number | null {
  if (!Number.isFinite(tickerStart) || tickerStart <= 0) return null;
  if (!Number.isFinite(marketStart) || marketStart <= 0) return null;
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) return null;
  return Math.round(tickerStart * (marketPrice / marketStart) * 10000) / 10000;
}

function nearestMarketPrice(
  marketPts: IntradayPricePoint[],
  tIso: string,
): number | null {
  const target = Date.parse(tIso);
  if (!Number.isFinite(target) || !marketPts.length) return null;
  let best: IntradayPricePoint | null = null;
  let bestDt = Infinity;
  for (const pt of marketPts) {
    const dt = Math.abs(Date.parse(pt.t) - target);
    if (dt < bestDt) {
      bestDt = dt;
      best = pt;
    }
  }
  return best?.price ?? null;
}

/** Latest RTH session: live when present, else prior (weekend / pre-open). Not calendar 24h. */
function pickIntradaySessionPoints(
  prior: IntradayPricePoint[] | undefined,
  live: IntradayPricePoint[] | undefined,
): IntradayPricePoint[] {
  const livePts = mergeIntradayPoints(undefined, live);
  if (livePts.length >= 2) return livePts;
  const priorPts = mergeIntradayPoints(prior, undefined);
  if (priorPts.length >= 2) return priorPts;
  return mergeIntradayPoints(prior, live);
}

/** Calendar date (YYYY-MM-DD) of the active RTH session shown in 24h charts. */
export function resolveIntradaySessionTradingDate(
  tickerPrior?: IntradayPricePoint[],
  tickerLive?: IntradayPricePoint[],
): string | null {
  const pts = pickIntradaySessionPoints(tickerPrior, tickerLive);
  if (!pts.length) return null;
  return pts[pts.length - 1]!.t.slice(0, 10);
}

/** Hourly ticker + XBI overlay for the active trading session (~24h view). */
export function buildIntradayPriceLineSeries(opts: {
  tickerPrior?: IntradayPricePoint[];
  tickerLive?: IntradayPricePoint[];
  marketPrior?: IntradayPricePoint[];
  marketLive?: IntradayPricePoint[];
  it?: boolean;
}): PriceLinePoint[] {
  const it = opts.it ?? false;
  const tickerPts = pickIntradaySessionPoints(opts.tickerPrior, opts.tickerLive);
  const tickerUsesLive = (opts.tickerLive?.length ?? 0) >= 2;
  const marketPts = tickerUsesLive
    ? pickIntradaySessionPoints(undefined, opts.marketLive)
    : pickIntradaySessionPoints(opts.marketPrior, undefined);
  const marketPtsFinal = marketPts.length
    ? marketPts
    : pickIntradaySessionPoints(opts.marketPrior, opts.marketLive);
  if (!tickerPts.length) return [];

  const tickerStart = tickerPts[0]!.price;
  const firstMarket = marketPtsFinal.length
    ? nearestMarketPrice(marketPtsFinal, tickerPts[0]!.t)
    : null;
  const marketStart = firstMarket;

  return tickerPts.map((p) => {
    const mRaw = marketPtsFinal.length ? nearestMarketPrice(marketPtsFinal, p.t) : null;
    const marketScaled =
      mRaw != null && marketStart != null
        ? scaleMarketToTicker(tickerStart, marketStart, mRaw)
        : null;
    return {
      key: p.t,
      label: fmtIntradayLabel(p.t, it),
      tickerPrice: p.price,
      marketScaled,
    };
  });
}

function barsByDate(bars: DailyCloseBar[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bars) {
    if (b.date && Number.isFinite(b.close) && b.close > 0) m.set(b.date, b.close);
  }
  return m;
}

/** Daily close series — XBI overlaid on ticker $ scale. */
export function buildDailyPriceLineSeries(opts: {
  tickerBars: DailyCloseBar[];
  marketBars: DailyCloseBar[];
  cutoffDate: string;
  it?: boolean;
}): PriceLinePoint[] {
  const it = opts.it ?? false;
  const tickerMap = barsByDate(opts.tickerBars.filter((b) => b.date >= opts.cutoffDate));
  const marketMap = barsByDate(opts.marketBars.filter((b) => b.date >= opts.cutoffDate));
  const dates = [...tickerMap.keys()].sort();
  if (!dates.length) return [];

  const tickerStart = tickerMap.get(dates[0]!)!;
  const marketStart = marketMap.get(dates[0]!) ?? null;

  return dates.map((date) => {
    const tickerPrice = tickerMap.get(date)!;
    const mClose = marketMap.get(date);
    const marketScaled =
      mClose != null && marketStart != null
        ? scaleMarketToTicker(tickerStart, marketStart, mClose)
        : null;
    return {
      key: date,
      label: fmtDailyLabel(date, it),
      tickerPrice,
      marketScaled,
    };
  });
}

export function latestTickerPrice(points: PriceLinePoint[]): number | null {
  if (!points.length) return null;
  const last = points[points.length - 1]!.tickerPrice;
  return Number.isFinite(last) ? last : null;
}

/** First→last % / $ on the visible curve — fallback when sheet horizons lack 1Y. */
export function priceLineSeriesDelta(points: PriceLinePoint[]): {
  tickerChange: number | null;
  marketChange: number | null;
  tickerDeltaUsd: number | null;
} {
  if (points.length < 2) {
    return { tickerChange: null, marketChange: null, tickerDeltaUsd: null };
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const tickerChange =
    Number.isFinite(first.tickerPrice) && first.tickerPrice > 0 && Number.isFinite(last.tickerPrice)
      ? Math.round(((last.tickerPrice - first.tickerPrice) / first.tickerPrice) * 10000) / 100
      : null;
  const marketChange =
    first.marketScaled != null &&
    last.marketScaled != null &&
    Number.isFinite(first.marketScaled) &&
    first.marketScaled > 0 &&
    Number.isFinite(last.marketScaled)
      ? Math.round(((last.marketScaled - first.marketScaled) / first.marketScaled) * 10000) / 100
      : null;
  const tickerDeltaUsd =
    Number.isFinite(first.tickerPrice) && Number.isFinite(last.tickerPrice)
      ? Math.round((last.tickerPrice - first.tickerPrice) * 100) / 100
      : null;
  return { tickerChange, marketChange, tickerDeltaUsd };
}

export type SixMonthHighBreakout = {
  /** Highest daily close in the 6M window before the active session date. */
  histMax: number;
  livePrice: number;
};

/**
 * True when live price exceeds the highest daily close in the prior ~6 months
 * (excluding the active trading date so same-day prints do not inflate the max).
 */
export function detectSixMonthHighBreakout(opts: {
  dailyBars: DailyCloseBar[];
  livePrice: number | null;
  /** Active session YYYY-MM-DD — bars on/after this date are excluded from hist max. */
  asOfDate?: string | null;
  nowMs?: number;
}): SixMonthHighBreakout | null {
  const { dailyBars, livePrice, asOfDate, nowMs = Date.now() } = opts;
  if (livePrice == null || !Number.isFinite(livePrice) || livePrice <= 0) return null;

  const cutoff = rangeToCalendarCutoff("6M", nowMs);
  const sessionDate = asOfDate?.slice(0, 10) ?? new Date(nowMs).toISOString().slice(0, 10);
  const priorBars = dailyBars.filter(
    (b) => b.date >= cutoff && b.date < sessionDate && Number.isFinite(b.close) && b.close > 0,
  );
  if (priorBars.length < 2) return null;

  const histMax = Math.max(...priorBars.map((b) => b.close));
  if (!Number.isFinite(histMax) || livePrice <= histMax) return null;

  return { histMax, livePrice };
}

export type VolumeLinePoint = {
  key: string;
  label: string;
  volume: number;
};

export type DailyVolumeBar = { date: string; volume: number };

export function priceVarRangeLabel(range: PriceVarChartRange, it: boolean): string {
  const map: Record<PriceVarChartRange, [string, string]> = {
    "24h": ["24h", "24h"],
    "7d": ["1 sett.", "1W"],
    "1M": ["1 mese", "1M"],
    "3M": ["3 mesi", "3M"],
    "6M": ["6 mesi", "6M"],
    "1Y": ["1 anno", "1Y"],
    cat6M: ["Cal 6 mesi", "Cal 6M"],
  };
  return it ? map[range][0] : map[range][1];
}

function volumeByDate(bars: DailyVolumeBar[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of bars) {
    if (b.date && Number.isFinite(b.volume) && b.volume > 0) m.set(b.date, b.volume);
  }
  return m;
}

/** Daily volume — same calendar keys/labels as {@link buildDailyPriceLineSeries}. */
export function buildDailyVolumeLineSeries(opts: {
  volumeBars: DailyVolumeBar[];
  cutoffDate: string;
  it?: boolean;
}): VolumeLinePoint[] {
  const it = opts.it ?? false;
  const volMap = volumeByDate(opts.volumeBars.filter((b) => b.date >= opts.cutoffDate));
  const dates = [...volMap.keys()].sort();
  return dates.map((date) => ({
    key: date,
    label: fmtDailyLabel(date, it),
    volume: volMap.get(date)!,
  }));
}

/**
 * 24h view — reuse intraday price X keys/labels (last RTH session).
 * Volume = daily total for each session date (flat within that session).
 */
export function buildIntradayVolumeLineSeries(opts: {
  tickerPrior?: IntradayPricePoint[];
  tickerLive?: IntradayPricePoint[];
  volumeBars: DailyVolumeBar[];
  it?: boolean;
}): VolumeLinePoint[] {
  const priceSeries = buildIntradayPriceLineSeries({
    tickerPrior: opts.tickerPrior,
    tickerLive: opts.tickerLive,
    it: opts.it,
  });
  if (!priceSeries.length) return [];
  const volByDate = volumeByDate(opts.volumeBars);
  const sessionDate = resolveIntradaySessionTradingDate(opts.tickerPrior, opts.tickerLive);
  return priceSeries
    .map((p) => {
      const date = p.key.slice(0, 10);
      if (sessionDate && date !== sessionDate) return null;
      const volume = volByDate.get(date);
      if (volume == null) return null;
      return {
        key: p.key,
        label: p.label,
        volume,
      };
    })
    .filter((row): row is VolumeLinePoint => row != null);
}

export function latestVolume(points: VolumeLinePoint[]): number | null {
  if (!points.length) return null;
  const last = points[points.length - 1]!.volume;
  return Number.isFinite(last) && last > 0 ? last : null;
}
