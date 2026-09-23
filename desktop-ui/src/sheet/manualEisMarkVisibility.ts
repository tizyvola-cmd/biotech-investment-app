/**
 * Manual EIS ★ visibility — persists through NASDAQ closures (weekend + NYSE holidays)
 * until the next trading session opens.
 */
import {
  calendarDayKeyInTimeZone,
  isUsEquityTradingDayKey,
  lastUsEquityTradingDayKey,
} from "./marketSession";
import { loadManualFeedEvents } from "./manualFeedEvents";
import { tickerHasManualNews } from "./manualFeedDropPrompt";

const NY_TZ = "America/New_York";

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function normalizeEventDate(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/** Latest manual feed event date (YYYY-MM-DD) for a ticker. */
export function lastManualFeedEventDate(ticker: string): string | null {
  const tk = normalizeTicker(ticker);
  if (!tk) return null;
  let best: string | null = null;
  for (const ev of loadManualFeedEvents()) {
    if (normalizeTicker(ev.ticker) !== tk) continue;
    const d = normalizeEventDate(ev.eventDate);
    if (!d) continue;
    if (!best || d > best) best = d;
  }
  return best;
}

/**
 * Calendar day used to match the last manual EIS against “today”.
 * On weekends/holidays → last NYSE trading day (e.g. Friday on Sunday).
 */
export function manualEisMarkDisplayDayKey(ref: Date = new Date()): string {
  const nyToday = calendarDayKeyInTimeZone(ref, NY_TZ);
  if (isUsEquityTradingDayKey(nyToday)) return nyToday;
  return lastUsEquityTradingDayKey(ref);
}

/** Show ★+✍ when manual EIS matches the active display session (incl. weekend carry). */
export function shouldShowManualEisUpdatedMark(ticker: string, ref: Date = new Date()): boolean {
  if (!tickerHasManualNews(ticker)) return false;
  const lastDate = lastManualFeedEventDate(ticker);
  if (!lastDate) return false;
  return (
    normalizeManualEisSessionDayKey(lastDate) === manualEisMarkDisplayDayKey(ref)
  );
}

export function manualEisGainStarLookupDayKey(ref: Date = new Date()): string {
  return manualEisMarkDisplayDayKey(ref);
}

/** Map calendar event date → NYSE session key (weekend/holiday saves → last session). */
export function normalizeManualEisSessionDayKey(dayKey: string): string {
  if (isUsEquityTradingDayKey(dayKey)) return dayKey;
  return lastUsEquityTradingDayKey(new Date(`${dayKey}T12:00:00`));
}
