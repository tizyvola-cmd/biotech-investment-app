/**
 * Feature snapshot store — workaround tattico per garantire l'immutabilità
 * delle feature al momento dell'ingresso per le dimensioni che oggi NON
 * sono persistite in `SimOutcomeRow` lato backend.
 *
 * SimOutcomeRow ha già snapshot immutabili per:
 *   entry_affidabilita_pct (= P(plan) al momento dell'ingresso)
 *   entry_slope_5d, entry_slope_20d, entry_pred7_pp, entry_r2_fit
 *
 * MA NON ha snapshot per:
 *   SDS (oggi letto live da SdsRow → derivabile silenziosamente nel tempo)
 *   clinical phase (oggi letto live da SheetTable)
 *   clinical indication (oggi letto live da SheetTable)
 *
 * Questo modulo "freeza" lato browser (localStorage) il primo valore osservato
 * di SDS/phase/indication per ciascun row_key di outcome chiuso. Dopo il freeze,
 * il calibration engine usa SEMPRE il valore congelato — anche se il sheet
 * cambia retroattivamente la classificazione di una ticker.
 *
 * NOTA: la fix strategica è aggiungere `entry_sds`, `entry_clinical_phase`,
 * `entry_clinical_indication` al record di outcome lato Python. Quando arriva,
 * questo store diventa opzionale (fallback per record vecchi).
 */

const STORAGE_KEY = "supernova.calibration.featureSnapshots.v1";

export type FrozenEntryFeatures = {
  rowKey: string;
  /** ISO timestamp when the feature was first observed and frozen. */
  frozenAt: string;
  /** "live" = snapshot taken at first render; "backend" = read from SimOutcomeRow directly */
  source: "live" | "backend";
  sds: number | null;
  clinicalPhase: string | null;
  clinicalIndication: string | null;
  /** P(plan) — we still freeze it here as a fallback, but normally prefer
   * SimOutcomeRow.entry_affidabilita_pct as the authoritative immutable value. */
  pplanPct: number | null;
};

type Store = Record<string, FrozenEntryFeatures>;

/**
 * In-memory fallback used when `window.localStorage` is not available
 * (tests in node, electron preload, SSR). Keyed by storage key.
 */
const __memoryStore: Record<string, string> = {};

function memGet(key: string): string | null {
  return Object.prototype.hasOwnProperty.call(__memoryStore, key)
    ? __memoryStore[key]
    : null;
}

function memSet(key: string, value: string): void {
  __memoryStore[key] = value;
}

function memDel(key: string): void {
  delete __memoryStore[key];
}

function safeGetItem(key: string): string | null {
  if (typeof window !== "undefined") {
    try {
      return window.localStorage.getItem(key);
    } catch {
      /* fall through to memory */
    }
  }
  return memGet(key);
}

function safeSetItem(key: string, value: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch {
      /* fall through to memory */
    }
  }
  memSet(key, value);
}

function safeRemoveItem(key: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* fall through */
    }
  }
  memDel(key);
}

function loadStore(): Store {
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Store;
    return {};
  } catch {
    return {};
  }
}

function saveStore(s: Store): void {
  try {
    safeSetItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* no-op */
  }
}

/**
 * Get the frozen feature snapshot for a row, or null if not yet frozen.
 */
export function getFrozenFeatures(rowKey: string): FrozenEntryFeatures | null {
  if (!rowKey) return null;
  const s = loadStore();
  return s[rowKey] ?? null;
}

/**
 * Freeze a snapshot for a row, ONLY if not already present.
 *
 * This is the critical invariant: once frozen, a snapshot is never overwritten
 * by subsequent observations. The first time we see a closed trade, we freeze
 * whatever values are currently associated with the ticker and persist them.
 *
 * Returns the (possibly already existing) snapshot.
 */
export function freezeFeaturesIfMissing(
  rowKey: string,
  live: {
    sds: number | null;
    clinicalPhase: string | null;
    clinicalIndication: string | null;
    pplanPct: number | null;
  },
): FrozenEntryFeatures {
  const s = loadStore();
  const existing = s[rowKey];
  if (existing) return existing;
  const snap: FrozenEntryFeatures = {
    rowKey,
    frozenAt: new Date().toISOString(),
    source: "live",
    sds: live.sds,
    clinicalPhase: live.clinicalPhase,
    clinicalIndication: live.clinicalIndication,
    pplanPct: live.pplanPct,
  };
  s[rowKey] = snap;
  saveStore(s);
  return snap;
}

/**
 * Amend an existing snapshot. Used ONLY when the trade is reopened / corrected
 * (treated as an event distinct from a new trade — see brief edge case).
 *
 * The original snapshot is kept under `prevSnapshots` to preserve audit trail.
 */
export function amendSnapshot(
  rowKey: string,
  updates: Partial<Omit<FrozenEntryFeatures, "rowKey" | "frozenAt" | "source">>,
): FrozenEntryFeatures | null {
  const s = loadStore();
  const existing = s[rowKey];
  if (!existing) return null;
  const amended: FrozenEntryFeatures = {
    ...existing,
    ...updates,
    frozenAt: new Date().toISOString(),
  };
  s[rowKey] = amended;
  saveStore(s);
  return amended;
}

/**
 * Bulk-export the snapshot store for debugging / backup.
 */
export function exportSnapshots(): FrozenEntryFeatures[] {
  return Object.values(loadStore());
}

/**
 * For tests / hard reset only. Never expose this from the UI.
 */
export function __resetSnapshotStoreForTests(): void {
  safeRemoveItem(STORAGE_KEY);
}
