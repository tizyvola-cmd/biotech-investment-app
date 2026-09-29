/**
 * Persist hidden CATALYSTS table rows (per event id) so the user can drop
 * noise without it coming back on the next card render.
 */
import { useEffect, useState } from "react";

export const CATALYST_ROW_DISMISS_KEY = "supernova.catalystRow.dismissed.v1";
export const CATALYST_ROW_DISMISS_EVENT = "supernova:catalystRowDismissed";

export function catalystEventStableId(ev: {
  ticker?: string | null;
  event_type?: string | null;
  window_start?: string | null;
  window_end?: string | null;
  asset_name?: string | null;
}): string {
  return [
    (ev.ticker ?? "").trim().toUpperCase(),
    ev.event_type || "other",
    String(ev.window_start ?? "").slice(0, 10),
    String(ev.window_end ?? "").slice(0, 10),
    (ev.asset_name ?? "").trim(),
  ].join("|");
}

/** Same id as the synthetic CD row in TickerCatalystEventsTable. */
export function cdIsoEventId(ticker: string, iso: string): string {
  const tk = ticker.trim().toUpperCase();
  return catalystEventStableId({
    ticker: tk,
    event_type: "cd",
    window_start: iso,
    window_end: iso,
    asset_name: tk,
  });
}

let memoryIds: Set<string> | null = null;

function parseStored(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((x) => String(x).trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function loadDismissedCatalystIds(): Set<string> {
  if (memoryIds) return new Set(memoryIds);
  try {
    memoryIds = parseStored(localStorage.getItem(CATALYST_ROW_DISMISS_KEY));
  } catch {
    memoryIds = new Set();
  }
  return new Set(memoryIds);
}

function persist(next: Set<string>) {
  memoryIds = new Set(next);
  try {
    localStorage.setItem(CATALYST_ROW_DISMISS_KEY, JSON.stringify([...memoryIds]));
  } catch {
    /* private mode */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CATALYST_ROW_DISMISS_EVENT));
  }
}

export function dismissCatalystEvent(id: string): void {
  const key = id.trim();
  if (!key) return;
  const next = loadDismissedCatalystIds();
  next.add(key);
  persist(next);
}

export function undismissCatalystEventsForTicker(ticker: string): void {
  const prefix = `${ticker.trim().toUpperCase()}|`;
  const next = loadDismissedCatalystIds();
  for (const id of [...next]) {
    if (id.startsWith(prefix)) next.delete(id);
  }
  persist(next);
}

export function resetCatalystEventDismissForTests(): void {
  memoryIds = null;
  try {
    localStorage.removeItem(CATALYST_ROW_DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

export function useDismissedCatalystIds(): Set<string> {
  const [ids, setIds] = useState(() => loadDismissedCatalystIds());
  useEffect(() => {
    const onChange = () => setIds(loadDismissedCatalystIds());
    window.addEventListener(CATALYST_ROW_DISMISS_EVENT, onChange);
    return () => window.removeEventListener(CATALYST_ROW_DISMISS_EVENT, onChange);
  }, []);
  return ids;
}
