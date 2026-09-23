/**
 * Home chart series: portfolio aggregate + per-ticker equity curves.
 *
 * Per-ticker curve is the classic cash-out recovery shape:
 *   starts at −capital (red, money out) → climbs with mark-to-market
 *   → crosses $0 at breakeven → green when the position is ahead.
 */
import type {
  InvestSimHistoryPoint,
  InvestSimInputEntry,
  InvestSimInputs,
} from "./investSimStorage";
import { resolveInvestedAt } from "./investSimStorage";
import { compressInvestTrendHistory } from "./investTrendOutlook";
import {
  buildPositions,
  resolveInvestSimEntryForRow,
  tradeableTickerFromRow,
  warrantCommonTicker,
} from "./simulationPosition";
import { bookMarkToMarket } from "./bookMarkToMarket";
import { buildSimRowByKeyMap } from "./investSimKeys";
import {
  calendarDayKeyInTimeZone,
  isAfterUsEquityRegularClose,
  isUsEquityTradingDay,
  lastUsEquityCloseSessionKey,
  nySessionCloseIso,
  portfolioHistoryMarkIso,
} from "./marketSession";
import type { SheetTable } from "../types";

const NY_TZ = "America/New_York";

export type HomePortfolioPnlHistoryRow = {
  day: string;
  ts: string;
  capital: number;
  pnlOpen: number;
  pnlClosed: number;
  pnlTotal: number;
};

export type HomeTickerOption = {
  key: string;
  ticker: string;
  status: "open" | "closed";
  /** Entry / closed capital used for the equity curve seed. */
  capital: number;
  lastEquity: number | null;
};

export type HomeTickerEquityRow = {
  day: string;
  ts: string;
  /** Classic curve: −capital at entry, then value − capital (= P&L). */
  equity: number;
  capital: number;
  value: number;
};

/** Chart zoom window on the home investment curve. */
export type HomePnlHistoryRange = "all" | "24h" | "3d" | "7d";

const RANGE_MS: Record<Exclude<HomePnlHistoryRange, "all">, number> = {
  "24h": 24 * 3_600_000,
  "3d": 3 * 86_400_000,
  "7d": 7 * 86_400_000,
};

/** ISO cutoff for a range, or null when showing the full history. */
export function homePnlHistoryCutoffIso(
  range: HomePnlHistoryRange,
  now: Date = new Date(),
): string | null {
  if (range === "all") return null;
  return new Date(now.getTime() - RANGE_MS[range]).toISOString();
}

function isCurveSeedLabel(day: string | undefined): boolean {
  const d = (day ?? "").trim().toLowerCase();
  return d === "entry" || d === "ingresso";
}

/** Minimum points to draw a readable short-window curve (pad with prior marks). */
const RANGE_MIN_POINTS: Record<Exclude<HomePnlHistoryRange, "all">, number> = {
  // Keep 24h tight — heavy padding made the window look like «All» and janked Recharts.
  "24h": 2,
  "3d": 4,
  "7d": 6,
};

/**
 * Keep points on/after the range cutoff.
 * Always attach the last pre-cutoff mark (not the Entry seed) so 24h / 3d
 * windows still draw a segment when history is ~1 sample/day.
 * If the window is still too sparse, pad with earlier real marks (minPoints).
 */
export function filterHomeSeriesByRange<T extends { ts: string; day?: string }>(
  rows: T[],
  range: HomePnlHistoryRange,
  now: Date = new Date(),
): T[] {
  const cutoff = homePnlHistoryCutoffIso(range, now);
  if (!cutoff || !rows.length) return rows;
  const cutMs = Date.parse(cutoff);
  if (!Number.isFinite(cutMs)) return rows;

  const real = rows.filter((r) => !isCurveSeedLabel(r.day));
  const inWindow: T[] = [];
  let anchor: T | null = null;
  for (const r of rows) {
    const ms = Date.parse(r.ts);
    if (!Number.isFinite(ms)) continue;
    if (ms < cutMs) {
      if (!isCurveSeedLabel(r.day)) anchor = r;
      continue;
    }
    inWindow.push(r);
  }

  let out: T[];
  if (!inWindow.length) {
    out = real.length >= 2 ? real.slice(-2) : rows.slice(-2);
  } else if (anchor) {
    out = [anchor, ...inWindow];
  } else if (inWindow.length === 1) {
    const seed = rows.find((r) => isCurveSeedLabel(r.day));
    out = seed ? [seed, ...inWindow] : inWindow;
  } else {
    out = inWindow;
  }

  const minPts = RANGE_MIN_POINTS[range as Exclude<HomePnlHistoryRange, "all">] ?? 2;
  if (out.length >= minPts || real.length <= out.length) return out;

  const need = minPts - out.length;
  const oldestOutTs = Date.parse(out[0]!.ts);
  const prior = real.filter((r) => {
    const ms = Date.parse(r.ts);
    return Number.isFinite(ms) && ms < oldestOutTs;
  });
  if (!prior.length) return out;
  return [...prior.slice(-need), ...out];
}

/** Last mark per calendar day — for long «All» views only. */
export function compressHomeSeriesByDay<T extends { ts: string }>(rows: T[]): T[] {
  if (rows.length <= 40) return rows;
  const byDay = new Map<string, T>();
  for (const r of rows) {
    const d = new Date(r.ts);
    const key = Number.isFinite(d.getTime())
      ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      : r.ts;
    const prev = byDay.get(key);
    if (!prev || Date.parse(r.ts) >= Date.parse(prev.ts)) byDay.set(key, r);
  }
  return [...byDay.values()].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** All history keys that share the same ticker symbol (CD remaps, e.g. BNTX|…). */
export function historyKeysForTickerSymbol(
  key: string,
  history: InvestSimHistoryPoint[] | null | undefined,
): string[] {
  const ticker = tickerFromKey(key);
  const keys = new Set<string>([key]);
  if (!ticker) return [key];
  for (const h of history ?? []) {
    for (const k of Object.keys(h.byTicker ?? {})) {
      if (tickerFromKey(k) === ticker) keys.add(k);
    }
  }
  return [...keys];
}

function dayEndMs(iso: string): number {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 0;
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function formatDayLabel(iso: string, lang: "it" | "en"): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(lang === "it" ? "it-IT" : "en-GB", {
    day: "numeric",
    month: "short",
  });
}

function calendarDayKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function tickerFromKey(key: string): string {
  return key.split("|")[0]?.trim().toUpperCase() || key;
}

/** Sum of closedPnlEur for sells completed on or before `asOfMs`. */
export function cumulativeClosedPnlAt(
  inputs: InvestSimInputs | null | undefined,
  asOfMs: number,
): number {
  if (!inputs || !Number.isFinite(asOfMs)) return 0;
  let sum = 0;
  for (const e of Object.values(inputs)) {
    if (!e?.ignoreSheet || !e.soldAt) continue;
    if (e.closedPnlEur == null || !Number.isFinite(e.closedPnlEur)) continue;
    const soldMs = Date.parse(e.soldAt);
    if (!Number.isFinite(soldMs) || soldMs > asOfMs) continue;
    sum += e.closedPnlEur;
  }
  return round2(sum);
}

export function buildHomePortfolioPnlHistorySeries(
  history: InvestSimHistoryPoint[] | null | undefined,
  inputs: InvestSimInputs | null | undefined,
  lang: "it" | "en" = "en",
  opts?: { compress?: boolean },
): HomePortfolioPnlHistoryRow[] {
  if (!history?.length) return [];
  // Keep raw snapshots by default so 24h / 3d / 7d can show intra-day refreshes.
  // Day-compression is applied later only for the long «All» view.
  const src = opts?.compress ? compressInvestTrendHistory(history) : history;
  return src.map((h) => {
    const end = dayEndMs(h.ts);
    const fromTick =
      h.closedPnlEur != null && Number.isFinite(h.closedPnlEur)
        ? h.closedPnlEur
        : null;
    const pnlClosed =
      fromTick != null ? round2(fromTick) : cumulativeClosedPnlAt(inputs, end);
    const pnlOpen = round2(h.pnl);
    const capital = round2(h.capital);
    return {
      day: formatDayLabel(h.ts, lang),
      ts: h.ts,
      capital,
      pnlOpen,
      pnlClosed,
      pnlTotal: round2(pnlOpen + pnlClosed),
    };
  });
}

export type HomePortfolioBreakevenRow = HomePortfolioPnlHistoryRow & {
  /**
   * Classic recovery curve (same idea as per-ticker equity):
   * Entry seed = −invested capital; later points = P&L (gain on that capital).
   * $0 = breakeven (capital recovered on mark-to-market).
   */
  pnlPlot: number;
};

/**
 * Portfolio aggregate curve matching the breakeven example:
 * starts at −total invested, then tracks P&L so gain is read against capital.
 */
export function toHomePortfolioBreakevenPlot(
  rows: HomePortfolioPnlHistoryRow[],
  book: "open" | "closed",
  lang: "it" | "en" = "en",
  closedCapitalInvested = 0,
  opts?: { includeEntrySeed?: boolean },
): HomePortfolioBreakevenRow[] {
  if (!rows.length) return [];
  const mapped: HomePortfolioBreakevenRow[] = rows.map((r) => ({
    ...r,
    pnlPlot: book === "closed" ? r.pnlClosed : r.pnlOpen,
  }));
  if (opts?.includeEntrySeed === false) return mapped;
  if (isCurveSeedLabel(mapped[0]?.day)) return mapped;

  const first = rows[0]!;
  const seedCap =
    book === "closed" && closedCapitalInvested > 0
      ? round2(closedCapitalInvested)
      : first.capital > 0
        ? first.capital
        : mapped.find((r) => r.capital > 0)?.capital ?? 0;
  if (!(seedCap > 0)) return mapped;

  // Unique ts (1s before first mark) — same ts as the first row breaks Recharts
  // category axes / ReferenceArea when the chart keys on timestamp.
  const firstMs = Date.parse(first.ts);
  const seedTs = Number.isFinite(firstMs)
    ? new Date(firstMs - 1000).toISOString()
    : first.ts;
  const seed: HomePortfolioBreakevenRow = {
    day: lang === "it" ? "Ingresso" : "Entry",
    ts: seedTs,
    capital: seedCap,
    pnlOpen: round2(-seedCap),
    pnlClosed: round2(-seedCap),
    pnlTotal: round2(-seedCap),
    pnlPlot: round2(-seedCap),
  };
  return [seed, ...mapped];
}

/**
 * Current open-book mark from Simulation (same math as post-refresh history).
 * Null when there is no live sheet / no open capital.
 */
export function buildLiveHomePortfolioHistoryPoint(
  simTable: SheetTable | null | undefined,
  inputs: InvestSimInputs | null | undefined,
  history: InvestSimHistoryPoint[] | null | undefined,
  now: Date = new Date(),
): InvestSimHistoryPoint | null {
  if (!simTable?.rows?.length) return null;
  const inp = inputs ?? {};
  const positions = buildPositions(simTable, inp, history).filter(
    (p) => p.capital > 0 && p.buyPrice > 0,
  );
  if (!positions.length) return null;

  const rowByKey = buildSimRowByKeyMap(simTable.rows ?? []);
  const byTicker: NonNullable<InvestSimHistoryPoint["byTicker"]> = {};
  let capital = 0;
  let value = 0;
  for (const p of positions) {
    const row = rowByKey.get(p.key);
    const entry = row ? resolveInvestSimEntryForRow(row, inp) : inp[p.key];
    const book = bookMarkToMarket(entry, p.currPrice);
    const cap = book ? (entry?.capital ?? p.capital) : p.capital;
    const val = book?.valueNow ?? p.valueNow;
    const rowPnl = book?.pnlEur ?? p.pnlEur;
    const rowPct = book?.pnlPct ?? p.pnlPct;
    capital += cap;
    value += val;
    byTicker[p.key] = {
      value: round2(val),
      pnl: round2(rowPnl),
      pnlPct: round2(rowPct),
    };
  }
  capital = round2(capital);
  value = round2(value);
  const pnl = round2(value - capital);
  const pnlPct = capital > 0 ? round2((pnl / capital) * 100) : 0;
  return {
    // Weekend/holiday → last Nasdaq close, not “Sunday when you opened the app”.
    ts: portfolioHistoryMarkIso(now),
    capital,
    value,
    pnl,
    pnlPct,
    byTicker,
    closedPnlEur: cumulativeClosedPnlAt(inp, now.getTime()),
  };
}

/**
 * Remap off-session wall-clock stamps (Sat/Sun opens) onto the last US equity
 * close so Home’s X-axis tracks market time. Same NY session day → keep latest.
 */
export function alignInvestSimHistoryToSessionAxis(
  history: InvestSimHistoryPoint[] | null | undefined,
): InvestSimHistoryPoint[] {
  const hist = history ?? [];
  if (!hist.length) return hist;
  const byNyDay = new Map<string, InvestSimHistoryPoint>();
  for (const p of hist) {
    const t = new Date(p.ts);
    if (!Number.isFinite(t.getTime())) {
      byNyDay.set(p.ts, p);
      continue;
    }
    const alignedTs =
      isUsEquityTradingDay(t) && !isAfterUsEquityRegularClose(t)
        ? p.ts
        : nySessionCloseIso(lastUsEquityCloseSessionKey(t));
    const dayKey = calendarDayKeyInTimeZone(new Date(alignedTs), NY_TZ);
    const prev = byNyDay.get(dayKey);
    if (!prev || Date.parse(alignedTs) >= Date.parse(prev.ts)) {
      byNyDay.set(dayKey, { ...p, ts: alignedTs });
    }
  }
  return [...byNyDay.values()].sort(
    (a, b) => Date.parse(a.ts) - Date.parse(b.ts),
  );
}

/**
 * Display-only tip: when the last stored snapshot is older than today (or same
 * day but stale), extend the series with live Simulation marks so Home does
 * not freeze on e.g. 21 Jul while the sheet already has 23 Jul prices.
 * Off-session tips reuse the last close timestamp (no phantom Sunday marks).
 */
export function withLiveHomePortfolioHistoryTip(
  history: InvestSimHistoryPoint[] | null | undefined,
  inputs: InvestSimInputs | null | undefined,
  simTable: SheetTable | null | undefined,
  now: Date = new Date(),
): InvestSimHistoryPoint[] {
  const hist = alignInvestSimHistoryToSessionAxis(history);
  const live = buildLiveHomePortfolioHistoryPoint(simTable, inputs, hist, now);
  if (!live) return hist;
  const last = hist[hist.length - 1];
  if (!last) return [live];

  // Merge on NY session day (not local calendar — weekend tips → Friday).
  const lastDay = calendarDayKeyInTimeZone(new Date(last.ts), NY_TZ);
  const liveDay = calendarDayKeyInTimeZone(new Date(live.ts), NY_TZ);
  if (!lastDay || !liveDay) return [...hist, live];

  if (lastDay === liveDay) {
    return [...hist.slice(0, -1), live];
  }
  return [...hist, live];
}

/** Lifecycle KPIs for the single cumulative P&L curve (portfolio aggregate). */
export type HomePortfolioPnlCurveStats = {
  peakPnl: number;
  troughPnl: number;
  /** Peak → trough drop on the curve (≤ 0). */
  maxDrawdown: number;
  /** First day label where cumulative P&L returns to ≥ 0 after a trough, if any. */
  breakevenDay: string | null;
  /** Peak minus latest (points “left on the table” if exited now). */
  leftOnTable: number;
};

export function summarizeHomePortfolioPnlCurve(
  rows: ReadonlyArray<Pick<HomePortfolioPnlHistoryRow, "day" | "pnlTotal">>,
): HomePortfolioPnlCurveStats | null {
  if (!rows.length) return null;
  let peakPnl = -Infinity;
  let troughPnl = Infinity;
  let troughIdx = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i]!.pnlTotal;
    if (v > peakPnl) peakPnl = v;
    if (v < troughPnl) {
      troughPnl = v;
      troughIdx = i;
    }
  }
  if (!Number.isFinite(peakPnl) || !Number.isFinite(troughPnl)) return null;

  // Max drawdown = worst peak-to-trough drop where trough follows a running peak.
  let runPeak = rows[0]!.pnlTotal;
  let maxDrawdown = 0;
  for (const r of rows) {
    runPeak = Math.max(runPeak, r.pnlTotal);
    maxDrawdown = Math.min(maxDrawdown, r.pnlTotal - runPeak);
  }

  let breakevenDay: string | null = null;
  if (troughPnl < 0) {
    for (let i = troughIdx + 1; i < rows.length; i++) {
      if (rows[i]!.pnlTotal >= 0) {
        breakevenDay = rows[i]!.day;
        break;
      }
    }
  }

  const latest = rows[rows.length - 1]!.pnlTotal;
  return {
    peakPnl: round2(peakPnl),
    troughPnl: round2(troughPnl),
    maxDrawdown: round2(maxDrawdown),
    breakevenDay,
    leftOnTable: round2(Math.max(0, peakPnl - latest)),
  };
}

function entryCapitalForKey(
  key: string,
  entry: InvestSimInputEntry | undefined,
  history: InvestSimHistoryPoint[],
): number {
  if (entry?.ignoreSheet) {
    if (entry.closedCapital != null && entry.closedCapital > 0) return round2(entry.closedCapital);
  } else if (entry && entry.capital > 0) {
    return round2(entry.capital);
  }
  for (const h of history) {
    const snap = h.byTicker?.[key];
    if (!snap) continue;
    const cap = round2(snap.value - snap.pnl);
    if (cap > 0) return cap;
  }
  return 0;
}

function lastEquityForKey(
  key: string,
  entry: InvestSimInputEntry | undefined,
  history: InvestSimHistoryPoint[],
  capital: number,
): number | null {
  if (entry?.ignoreSheet && entry.closedPnlEur != null && Number.isFinite(entry.closedPnlEur)) {
    return round2(entry.closedPnlEur);
  }
  const aliases = historyKeysForTickerSymbol(key, history);
  for (let i = history.length - 1; i >= 0; i--) {
    const bt = history[i]!.byTicker ?? {};
    let snap: { value: number; pnl: number } | undefined;
    for (const ak of aliases) {
      const s = bt[ak];
      if (s) {
        snap = s;
        break;
      }
    }
    if (!snap) continue;
    const cap = snap.value - snap.pnl;
    if (cap > 0) return round2(snap.pnl);
    if (capital > 0) return round2(snap.value - capital);
  }
  return null;
}

/**
 * Keys with a live open position on the Simulation sheet (same universe as
 * Pulse «OPEN POSITIONS»). Capital left in inputs without a sheet row is NOT open.
 */
export function liveOpenPortfolioKeys(
  simTable: SheetTable | null | undefined,
  inputs: InvestSimInputs | null | undefined,
  history?: InvestSimHistoryPoint[] | null,
): Set<string> {
  const inp = inputs ?? {};
  const keys = new Set<string>();
  for (const p of buildPositions(simTable ?? null, inp, history)) {
    if (p.capital > 0) keys.add(p.key);
  }
  return keys;
}

/**
 * Open + closed tickers for the home P&L book.
 * «open» must match Pulse OPEN POSITIONS when `liveOpenKeys` / `simTable` is passed;
 * leftover capital on sold/off-sheet names is classified closed.
 */
export function listHomeInvestedTickers(
  history: InvestSimHistoryPoint[] | null | undefined,
  inputs: InvestSimInputs | null | undefined,
  opts?: {
    liveOpenKeys?: Iterable<string> | null;
    simTable?: SheetTable | null;
  },
): HomeTickerOption[] {
  const hist = history ?? [];
  const inp = inputs ?? {};
  const keys = new Set<string>();

  for (const [k, e] of Object.entries(inp)) {
    if (!k.trim()) continue;
    if (e?.ignoreSheet) {
      keys.add(k);
      continue;
    }
    if ((e?.capital ?? 0) > 0) keys.add(k);
  }
  for (const h of hist) {
    for (const k of Object.keys(h.byTicker ?? {})) {
      if (k.trim()) keys.add(k);
    }
  }

  const liveOpen =
    opts?.liveOpenKeys != null
      ? new Set(
          [...opts.liveOpenKeys].map((k) => k.trim()).filter(Boolean),
        )
      : opts?.simTable !== undefined
        ? liveOpenPortfolioKeys(opts.simTable, inp, hist)
        : null;

  const rowByKey =
    opts?.simTable != null ? buildSimRowByKeyMap(opts.simTable.rows ?? []) : null;

  const out: HomeTickerOption[] = [];
  for (const key of keys) {
    const entry = inp[key];
    const capital = entryCapitalForKey(key, entry, hist);
    if (capital <= 0 && !entry?.ignoreSheet) continue;

    const soldClosed =
      Boolean(entry?.ignoreSheet) ||
      (entry != null && (entry.capital ?? 0) <= 0 && Boolean(entry.soldAt));

    let status: "open" | "closed";
    if (soldClosed) {
      status = "closed";
    } else if (liveOpen) {
      // Align with OPEN POSITIONS — stale capital without a sheet row → closed.
      status = liveOpen.has(key) ? "open" : "closed";
    } else {
      status =
        entry != null && (entry.capital ?? 0) > 0 ? "open" : "closed";
    }

    // Skip pure history ghosts with no capital and no closed exit.
    if (capital <= 0 && status === "closed" && entry?.closedPnlEur == null) continue;
    const sheetTk = tickerFromKey(key);
    const simRow = rowByKey?.get(key);
    const displayTk = simRow
      ? tradeableTickerFromRow(simRow)
      : warrantCommonTicker(sheetTk) ?? sheetTk;
    out.push({
      key,
      ticker: displayTk,
      status,
      capital: capital > 0 ? capital : 0,
      lastEquity: lastEquityForKey(key, entry, hist, capital),
    });
  }

  out.sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    return a.ticker.localeCompare(b.ticker) || a.key.localeCompare(b.key);
  });
  return out;
}

type DaySnap = { dayKey: string; ts: string; value: number; capital: number; pnl: number };

/**
 * Classic single-ticker equity curve:
 *  1) Entry seed at −capital (cash out, below breakeven)
 *  2) Each day: value − capital (P&L) — crosses $0 when the investment recovers
 */
export function buildHomeTickerEquityCurve(
  history: InvestSimHistoryPoint[] | null | undefined,
  inputs: InvestSimInputs | null | undefined,
  key: string,
  lang: "it" | "en" = "en",
): HomeTickerEquityRow[] {
  if (!key) return [];
  const hist = history ?? [];
  const entry = inputs?.[key];
  const capital = entryCapitalForKey(key, entry, hist);
  if (capital <= 0) return [];

  const investedAt = resolveInvestedAt(key, entry, hist);
  const investDay = investedAt ? calendarDayKey(investedAt) : "";
  const soldDay = entry?.soldAt ? calendarDayKey(entry.soldAt) : "";

  // Follow CD remaps (BNTX|2026-07-13 → BNTX|2026-07-31) so the curve is not truncated.
  const aliasKeys = historyKeysForTickerSymbol(key, hist);

  const byDay = new Map<string, DaySnap>();
  for (const h of hist) {
    let snap: { value: number; pnl: number; pnlPct?: number } | undefined;
    for (const ak of aliasKeys) {
      const s = h.byTicker?.[ak];
      if (s && (s.value > 0 || s.pnl != null)) {
        snap = s;
        break;
      }
    }
    if (!snap) continue;
    const dayKey = calendarDayKey(h.ts);
    if (!dayKey) continue;
    if (investDay && dayKey < investDay) continue;
    if (soldDay && dayKey > soldDay) continue;
    const snapCap = round2(snap.value - snap.pnl);
    const cap = snapCap > 0 ? snapCap : capital;
    const value = round2(snap.value);
    const pnl = round2(snap.pnl);
    const prev = byDay.get(dayKey);
    if (!prev || Date.parse(h.ts) >= Date.parse(prev.ts)) {
      byDay.set(dayKey, { dayKey, ts: h.ts, value, capital: cap, pnl });
    }
  }

  const days = [...byDay.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const rows: HomeTickerEquityRow[] = [];

  const seedTs = investedAt?.trim() || days[0]?.ts || new Date().toISOString();
  rows.push({
    day: lang === "it" ? "Ingresso" : "Entry",
    ts: seedTs,
    equity: round2(-capital),
    capital: round2(capital),
    value: 0,
  });

  for (const d of days) {
    rows.push({
      day: formatDayLabel(d.ts, lang),
      ts: d.ts,
      equity: d.pnl,
      capital: d.capital,
      value: d.value,
    });
  }

  // If sold and last history pnl differs from stored closed P&L, append terminal point.
  if (
    entry?.ignoreSheet &&
    entry.closedPnlEur != null &&
    Number.isFinite(entry.closedPnlEur)
  ) {
    const last = rows[rows.length - 1];
    const closed = round2(entry.closedPnlEur);
    if (!last || Math.abs(last.equity - closed) > 0.5) {
      const soldTs = entry.soldAt?.trim() || last?.ts || seedTs;
      rows.push({
        day: lang === "it" ? "Uscita" : "Exit",
        ts: soldTs,
        equity: closed,
        capital: round2(entry.closedCapital ?? capital),
        value: round2(entry.closedValue ?? capital + closed),
      });
    }
  }

  return rows;
}
