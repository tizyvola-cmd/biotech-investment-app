/**
 * User attention stars — clickable ★ on Market Insight / Deep Dive / Catalyst.
 * Persisted locally; not Soft BUY/SELL.
 */
import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "supernova.attentionStars.v1";
const CHANGED_EVENT = "supernova:attention-stars-changed";

type Listener = () => void;

const listeners = new Set<Listener>();
let cache: Set<string> | null = null;
let version = 0;

function norm(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function readSet(): Set<string> {
  if (cache) return cache;
  const next = new Set<string>();
  try {
    if (typeof window === "undefined") {
      cache = next;
      return next;
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = next;
      return next;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      for (const t of parsed) {
        const tk = norm(String(t ?? ""));
        if (tk) next.add(tk);
      }
    }
  } catch {
    /* ignore */
  }
  cache = next;
  return next;
}

function writeSet(set: Set<string>): void {
  cache = set;
  version += 1;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...set].sort()));
  } catch {
    /* quota */
  }
  try {
    window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
  } catch {
    /* ignore */
  }
  for (const l of listeners) l();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      cache = null;
      version += 1;
      listener();
    }
  };
  const onCustom = () => listener();
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGED_EVENT, onCustom);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGED_EVENT, onCustom);
    }
  };
}

export function isAttentionStarred(ticker: string): boolean {
  const tk = norm(ticker);
  return tk ? readSet().has(tk) : false;
}

export function addAttentionStar(ticker: string): boolean {
  const tk = norm(ticker);
  if (!tk) return false;
  const next = new Set(readSet());
  if (next.has(tk)) return true;
  next.add(tk);
  writeSet(next);
  return true;
}

export function toggleAttentionStar(ticker: string): boolean {
  const tk = norm(ticker);
  if (!tk) return false;
  const next = new Set(readSet());
  if (next.has(tk)) next.delete(tk);
  else next.add(tk);
  writeSet(next);
  return next.has(tk);
}

export function listAttentionStars(): string[] {
  return [...readSet()].sort();
}

export function getAttentionStarsVersion(): number {
  readSet();
  return version;
}

/** Subscribe to one ticker’s star state. */
export function useAttentionStar(ticker: string | null | undefined): {
  starred: boolean;
  toggle: () => void;
} {
  const tk = norm(ticker ?? "");
  const starred = useSyncExternalStore(
    subscribe,
    () => (tk ? readSet().has(tk) : false),
    () => false,
  );
  const toggle = useCallback(() => {
    if (tk) toggleAttentionStar(tk);
  }, [tk]);
  return { starred, toggle };
}
