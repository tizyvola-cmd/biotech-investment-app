/**
 * First-write snapshot of scores when Suggested SELL fires on an open run.
 * Comparison / outcomes only have entry scores; this freezes live scores at
 * the G1/G2 fire so later SELL-timer work is not circular.
 *
 * Keyed by row key + investedAt. localStorage with in-memory fallback (tests).
 */

const STORAGE_KEY = "supernova.softSell.fireSnapshots.v1";
const MAX_ENTRIES = 400;

export type SoftSellFireSnapshot = {
  key: string;
  ticker: string;
  investedAt: string | null;
  ts: string;
  pnlPct: number | null;
  pplan: number | null;
  riskV2: number | null;
  reg: number | null;
  sessionsElapsed: number | null;
  deepFloor: boolean;
  g1Hit: boolean;
  g2: boolean;
  reason: string | null;
};

type Store = Record<string, SoftSellFireSnapshot>;

const memory: Record<string, string> = {};

function fireId(key: string, investedAt: string | null): string {
  return `${key}::${investedAt ?? "nostamp"}`;
}

function safeGet(): string | null {
  if (typeof window !== "undefined") {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      /* fall through */
    }
  }
  return Object.prototype.hasOwnProperty.call(memory, STORAGE_KEY)
    ? memory[STORAGE_KEY]
    : null;
}

function safeSet(raw: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, raw);
      return;
    } catch {
      /* fall through */
    }
  }
  memory[STORAGE_KEY] = raw;
}

function loadStore(): Store {
  const raw = safeGet();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(store: Store): void {
  const entries = Object.entries(store);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => a[1].ts.localeCompare(b[1].ts));
    const trimmed = Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES));
    safeSet(JSON.stringify(trimmed));
    return;
  }
  safeSet(JSON.stringify(store));
}

/** First write wins for this open run. Returns the stored snap. */
export function recordSoftSellFireOnce(
  snap: SoftSellFireSnapshot,
): SoftSellFireSnapshot {
  const id = fireId(snap.key, snap.investedAt);
  const store = loadStore();
  const existing = store[id];
  if (existing) return existing;
  store[id] = snap;
  saveStore(store);
  return snap;
}

export function getSoftSellFireSnapshot(
  key: string,
  investedAt: string | null | undefined,
): SoftSellFireSnapshot | null {
  return loadStore()[fireId(key, investedAt ?? null)] ?? null;
}

export function listSoftSellFireSnapshots(): SoftSellFireSnapshot[] {
  return Object.values(loadStore()).sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Test helper. */
export function clearSoftSellFireSnapshotsForTests(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  delete memory[STORAGE_KEY];
}
