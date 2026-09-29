/**
 * Tickers the user enrolled by hand (Companies of interest).
 * Red ★ on Catalyst / Top KPI / Deep Dive — distinct from yellow attention stars.
 */
const CHANGED_EVENT = "supernova:catalyst-interest-tickers-changed";

type Listener = () => void;

const listeners = new Set<Listener>();
let cache = new Set<string>();
let version = 0;

function norm(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function notify(): void {
  version += 1;
  try {
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

export function setCatalystInterestTickers(tickers: Iterable<string>): void {
  const next = new Set<string>();
  for (const raw of tickers) {
    const tk = norm(String(raw ?? ""));
    if (tk) next.add(tk);
  }
  cache = next;
  notify();
}

export function isCatalystInterestTicker(ticker: string): boolean {
  const tk = norm(ticker);
  return tk ? cache.has(tk) : false;
}

export function listCatalystInterestTickers(): string[] {
  return [...cache].sort();
}

export function getCatalystInterestVersion(): number {
  return version;
}

export function subscribeCatalystInterest(listener: Listener): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") {
    window.addEventListener(CHANGED_EVENT, listener);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener(CHANGED_EVENT, listener);
    }
  };
}
