/**
 * External keyed map with per-key listeners — used so table rows can subscribe
 * to a single ticker without re-rendering when a sibling key updates.
 *
 * UI bridge: keep writing into the map while the user scrolls/uses the app, but
 * pause listener notifications until an explicit data recall (Refresh).
 */
import { useCallback, useRef, useSyncExternalStore } from "react";
import { tickerRowShallowEqual } from "./catalystDeskColumnCache";

type Listener = () => void;

export type KeyedMapStore<T> = {
  get: (key: string) => T | undefined;
  peekAll: () => Record<string, T>;
  /** Merge incoming keys; omit wipe of keys not present in `rows`. */
  setMany: (rows: Record<string, T> | null | undefined) => number;
  /** Replace the working set for the given keys (drops keys not in `rows`). */
  replaceAll: (rows: Record<string, T>) => number;
  subscribe: (listener: Listener) => () => void;
  subscribeKey: (key: string, listener: Listener) => () => void;
  getVersion: () => number;
  /** When false, setMany/replaceAll still update memory but do not notify React. */
  setNotifyEnabled: (enabled: boolean) => void;
  getNotifyEnabled: () => boolean;
  /** Flush dirty keys accumulated while notifications were paused. */
  flushPending: () => number;
};

function normKey(raw: string): string {
  return raw.trim().toUpperCase();
}

export function createKeyedMapStore<T>(opts?: {
  equal?: (a: T, b: T) => boolean;
}): KeyedMapStore<T> {
  const equal = opts?.equal ?? ((a: T, b: T) => tickerRowShallowEqual(a, b));
  const map = new Map<string, T>();
  const globalListeners = new Set<Listener>();
  const keyListeners = new Map<string, Set<Listener>>();
  let version = 0;
  let notifyEnabled = true;
  const pendingKeys = new Set<string>();

  const notifyKey = (key: string) => {
    const set = keyListeners.get(key);
    if (set) for (const l of set) l();
  };

  const notifyGlobal = () => {
    for (const l of globalListeners) l();
  };

  const bump = (changedKeys: string[]) => {
    if (!changedKeys.length) return 0;
    if (!notifyEnabled) {
      for (const k of changedKeys) pendingKeys.add(k);
      return changedKeys.length;
    }
    version += 1;
    for (const k of changedKeys) notifyKey(k);
    notifyGlobal();
    return changedKeys.length;
  };

  return {
    get(key: string) {
      const k = normKey(key);
      return k ? map.get(k) : undefined;
    },
    peekAll() {
      const out: Record<string, T> = {};
      for (const [k, v] of map) out[k] = v;
      return out;
    },
    setMany(rows) {
      if (!rows) return 0;
      const changed: string[] = [];
      for (const [raw, row] of Object.entries(rows)) {
        const k = normKey(raw);
        if (!k || row == null) continue;
        const prev = map.get(k);
        if (prev !== undefined && equal(prev, row)) continue;
        map.set(k, row);
        changed.push(k);
      }
      return bump(changed);
    },
    replaceAll(rows) {
      const nextKeys = new Set<string>();
      const changed: string[] = [];
      for (const [raw, row] of Object.entries(rows)) {
        const k = normKey(raw);
        if (!k || row == null) continue;
        nextKeys.add(k);
        const prev = map.get(k);
        if (prev !== undefined && equal(prev, row)) continue;
        map.set(k, row);
        changed.push(k);
      }
      for (const k of [...map.keys()]) {
        if (!nextKeys.has(k)) {
          map.delete(k);
          changed.push(k);
        }
      }
      return bump(changed);
    },
    subscribe(listener) {
      globalListeners.add(listener);
      return () => {
        globalListeners.delete(listener);
      };
    },
    subscribeKey(key, listener) {
      const k = normKey(key);
      if (!k) return () => {};
      let set = keyListeners.get(k);
      if (!set) {
        set = new Set();
        keyListeners.set(k, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) keyListeners.delete(k);
      };
    },
    getVersion() {
      return version;
    },
    setNotifyEnabled(enabled: boolean) {
      notifyEnabled = enabled;
    },
    getNotifyEnabled() {
      return notifyEnabled;
    },
    flushPending() {
      if (!pendingKeys.size) return 0;
      const keys = [...pendingKeys];
      pendingKeys.clear();
      if (!notifyEnabled) {
        for (const k of keys) pendingKeys.add(k);
        return 0;
      }
      version += 1;
      for (const k of keys) notifyKey(k);
      notifyGlobal();
      return keys.length;
    },
  };
}

/** Subscribe a row to one key — re-renders only when that key changes. */
export function useKeyedMapEntry<T>(
  store: KeyedMapStore<T>,
  key: string | null | undefined,
): T | undefined {
  const k = key?.trim().toUpperCase() ?? "";
  /** While UI bridge is paused, keep returning the last painted value. */
  const frozenRef = useRef<{ k: string; v: T | undefined } | null>(null);
  const subscribe = useCallback(
    (onStoreChange: Listener) =>
      k ? store.subscribeKey(k, onStoreChange) : () => {},
    [store, k],
  );
  const getSnapshot = useCallback(() => {
    if (!k) return undefined;
    const cur = store.get(k);
    if (!store.getNotifyEnabled()) {
      if (frozenRef.current?.k === k) return frozenRef.current.v;
      frozenRef.current = { k, v: cur };
      return cur;
    }
    frozenRef.current = { k, v: cur };
    return cur;
  }, [store, k]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Bump parent (e.g. sort) when any key in the store changes. */
export function useKeyedMapVersion<T>(store: KeyedMapStore<T>): number {
  return useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
}