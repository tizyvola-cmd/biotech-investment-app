/**
 * Fire a scoped EIS / clinical-pre-CD search once per ticker per NY session day
 * when volume explodes (daily last-bar surge or live VOL vs prev ≥ 150%).
 *
 * Yellow dots on Volume vs EIS stay published events — this only starts the
 * search. A new dot appears only if enrichment finds an event.
 */
import { runClinicalPreCdRefresh } from "../api/supernova";

const STORAGE_KEY = "supernova.volAccel.eisFired.v1";
const MAX_TICKERS = 20;
const inFlight = new Set<string>();

function todayKey(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function loadFired(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { day?: string; tickers?: string[] }) : null;
    if (!parsed || parsed.day !== todayKey() || !Array.isArray(parsed.tickers)) {
      return new Set();
    }
    return new Set(parsed.tickers);
  } catch {
    return new Set();
  }
}

function saveFired(tickers: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ day: todayKey(), tickers: [...tickers] }),
    );
  } catch {
    /* ignore quota */
  }
}

export function hasEisSearchFiredToday(ticker: string): boolean {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return false;
  return loadFired().has(tk) || inFlight.has(tk);
}

/** Idempotent: only POSTs newly surged names. Marks fired after the job starts. */
export function maybeTriggerEisForHighVol(tickers: string[]): void {
  const next = tickers
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_TICKERS);
  if (!next.length) return;
  const fired = loadFired();
  const fresh = next.filter((t) => !fired.has(t) && !inFlight.has(t));
  if (!fresh.length) return;
  for (const t of fresh) inFlight.add(t);
  void runClinicalPreCdRefresh(false, { force: true, deep: true, tickers: fresh })
    .then((res) => {
      if (!res?.started) return;
      const stored = loadFired();
      for (const t of fresh) stored.add(t);
      saveFired(stored);
    })
    .catch(() => {
      /* next dashboard / chart tick retries — do not mark fired */
    })
    .finally(() => {
      for (const t of fresh) inFlight.delete(t);
    });
}
