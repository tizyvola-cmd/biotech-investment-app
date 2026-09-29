/**
 * Top KPI Trends column — Rome-day local cache.
 * G-Trends is refreshed server-side ~once/day; Soft BUY/SELL unchanged.
 * Weekend/holiday: keep last session day's prints so the column is not blank.
 */
import type { SearchInterestRow } from "../api/supernova";
import { romeDateKey } from "./catalystDeskNewLedger";
import { isUsEquitySessionDay, lastUsEquitySessionDayKey } from "./marketSession";
import { isSearchInterestScored, rememberSearchInterestRows } from "./searchInterestStore";

const STORAGE_KEY = "supernova.topKpiTrendsDailyCache.v1";
const WEEKEND_KEEP_MS = 72 * 60 * 60 * 1000;

export type TopKpiTrendsDailyPayload = {
  romeDay: string;
  savedAt: number;
  trends: Record<string, SearchInterestRow>;
};

function store(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function trendsFromPayload(
  parsed: TopKpiTrendsDailyPayload | null,
): Record<string, SearchInterestRow> | null {
  const trends = parsed?.trends;
  if (!trends || typeof trends !== "object") return null;
  return trends;
}

export function peekTopKpiTrendsDailyCache(
  romeDay = romeDateKey(),
  now: Date = new Date(),
): Record<string, SearchInterestRow> | null {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TopKpiTrendsDailyPayload;
    if (!parsed) return null;
    if (parsed.romeDay === romeDay) return trendsFromPayload(parsed);

    // Closed market: serve last recorded day (Fri prints on Sat/Sun).
    const age = Date.now() - (parsed.savedAt || 0);
    if (!isUsEquitySessionDay(now) && age >= 0 && age < WEEKEND_KEEP_MS) {
      const last = lastUsEquitySessionDayKey(now);
      if (parsed.romeDay === last || parsed.romeDay) return trendsFromPayload(parsed);
    }
    return null;
  } catch {
    return null;
  }
}

export function rememberTopKpiTrendsDailyCache(
  trends: Record<string, SearchInterestRow>,
  romeDay = romeDateKey(),
): void {
  try {
    const prev = peekTopKpiTrendsDailyCache(romeDay) ?? {};
    const merged: Record<string, SearchInterestRow> = { ...prev };
    for (const [raw, row] of Object.entries(trends)) {
      const tk = raw.trim().toUpperCase();
      if (!tk || !row) continue;
      if (isSearchInterestScored(row) || !isSearchInterestScored(merged[tk])) {
        merged[tk] = { ...row, ticker: row.ticker || tk };
      }
    }
    const file: TopKpiTrendsDailyPayload = {
      romeDay,
      savedAt: Date.now(),
      trends: merged,
    };
    store()?.setItem(STORAGE_KEY, JSON.stringify(file));
    rememberSearchInterestRows(merged);
  } catch {
    /* quota / private */
  }
}

export function missingTopKpiTrendsTickers(
  tickers: readonly string[],
  romeDay = romeDateKey(),
): string[] {
  const cached = peekTopKpiTrendsDailyCache(romeDay) ?? {};
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tickers) {
    const tk = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    if (!isSearchInterestScored(cached[tk])) out.push(tk);
  }
  return out;
}
