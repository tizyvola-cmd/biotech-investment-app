/**
 * Persist hidden Clinical / Financial / migrated Daily News cards so ×
 * removes them from Deep Dive lists without coming back on next render.
 */
import { useEffect, useState } from "react";

export const EIS_NEWS_DISMISS_KEY = "supernova.eisNews.dismissed.v1";
export const EIS_NEWS_DISMISS_EVENT = "supernova:eisNewsDismissed";

const listeners = new Set<() => void>();

export function subscribeEisNewsDismiss(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyDismissListeners(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      /* ignore subscriber errors */
    }
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EIS_NEWS_DISMISS_EVENT));
  }
}

export function eisClinicalNewsStableId(ev: {
  ticker?: string | null;
  eventDate?: string | null;
  title?: string | null;
  link?: string | null;
  sourceType?: string | null;
}): string {
  return [
    (ev.ticker ?? "").trim().toUpperCase(),
    "clin",
    String(ev.eventDate ?? "").slice(0, 10),
    (ev.sourceType ?? "").trim().toLowerCase(),
    (ev.link ?? "").trim().slice(0, 160),
    (ev.title ?? "").trim().slice(0, 120),
  ].join("|");
}

export function eisFinancialNewsStableId(ev: {
  ticker?: string | null;
  filingDate?: string | null;
  title?: string | null;
  link?: string | null;
  form?: string | null;
}): string {
  return [
    (ev.ticker ?? "").trim().toUpperCase(),
    "fin",
    String(ev.filingDate ?? "").slice(0, 10),
    (ev.form ?? "8-K").trim().toUpperCase(),
    (ev.link ?? "").trim().slice(0, 160),
    (ev.title ?? "").trim().slice(0, 120),
  ].join("|");
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

export function loadDismissedEisNewsIds(): Set<string> {
  if (memoryIds) return new Set(memoryIds);
  try {
    memoryIds = parseStored(localStorage.getItem(EIS_NEWS_DISMISS_KEY));
  } catch {
    memoryIds = new Set();
  }
  return new Set(memoryIds);
}

function persist(next: Set<string>) {
  memoryIds = new Set(next);
  try {
    localStorage.setItem(EIS_NEWS_DISMISS_KEY, JSON.stringify([...memoryIds]));
  } catch {
    /* private mode */
  }
  notifyDismissListeners();
}

export function dismissEisNews(id: string): void {
  const key = id.trim();
  if (!key) return;
  const next = loadDismissedEisNewsIds();
  next.add(key);
  persist(next);
}

export function resetEisNewsDismissForTests(): void {
  memoryIds = null;
  listeners.clear();
  try {
    localStorage.removeItem(EIS_NEWS_DISMISS_KEY);
  } catch {
    /* ignore */
  }
}

export function useDismissedEisNewsIds(): Set<string> {
  const [ids, setIds] = useState(() => loadDismissedEisNewsIds());
  useEffect(() => {
    const sync = () => setIds(loadDismissedEisNewsIds());
    const unsub = subscribeEisNewsDismiss(sync);
    window.addEventListener(EIS_NEWS_DISMISS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      unsub();
      window.removeEventListener(EIS_NEWS_DISMISS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return ids;
}
