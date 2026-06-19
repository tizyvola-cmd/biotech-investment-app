/**
 * Durable persistence for small UI preferences that must survive across
 * sessions, even if the browser drops localStorage (private mode, cleared
 * site data, different origin).
 *
 * Storage layers (priority):
 *  1. In-memory cache (per tab).
 *  2. localStorage (fast cache, same origin).
 *  3. `data/desktop_ui_prefs.json` on disk via Electron preload bridge
 *     (`window.supernova.writeProjectDataFile`). Mirrors the dual-channel
 *     pattern already used by `invest_sim_inputs.json`.
 *
 * Disk writes only happen in the Electron desktop shell; remote browser
 * sessions get the localStorage-only behaviour (still better than per-mount
 * defaults that snap-reset to 5000).
 */
import { fetchProjectJson } from "../data/projectData";

export type UiPrefs = {
  /** Capital pot € sopra il widget di breakeven (Capital & Diversification). */
  topCapital?: number;
  /** Open state of the "Bad advice ✗" details section in the Advice
   *  Calibration panel. Defaults to `true` (open) so the user always sees
   *  the failure detail table on landing. */
  badAdviceListOpen?: boolean;
  /** Learnings status + P(plan)/SELL chips + sell-warning in Advice Calibration. */
  adviceCalibInsightsOpen?: boolean;
  /** Pulse dashboard — per-position table under Gain vs plan (default open). */
  pulsePositionsOpen?: boolean;
  /** Capital & Diversification — three-portfolio compare block (default open). */
  threePortfolioCompareOpen?: boolean;
  /** Synth gain impact tables under three-portfolio charts (default closed). */
  synthGainImpactOpen?: boolean;
};

type PersistedUiPrefsFile = {
  version: number;
  updated_at: string;
  prefs: UiPrefs;
};

const LOCAL_KEY = "supernova_ui_prefs";
const LOCAL_META_KEY = "supernova_ui_prefs_updated_at";
const DISK_REL = "desktop_ui_prefs.json";

let cache: UiPrefs | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function readLocalRaw(): UiPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    return obj && typeof obj === "object" ? (obj as UiPrefs) : {};
  } catch {
    return {};
  }
}

function readLocalUpdatedAtMs(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(LOCAL_META_KEY);
    if (!raw) return 0;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

function writeLocal(prefs: UiPrefs, updatedAt: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(prefs));
    window.localStorage.setItem(LOCAL_META_KEY, updatedAt);
  } catch {
    /* localStorage unavailable — non-fatal */
  }
}

async function flushToDisk(prefs: UiPrefs, updatedAt: string): Promise<void> {
  if (typeof window === "undefined") return;
  const bridge = window.supernova;
  if (!bridge?.writeProjectDataFile) return;
  const payload: PersistedUiPrefsFile = {
    version: 1,
    updated_at: updatedAt,
    prefs,
  };
  try {
    await bridge.writeProjectDataFile(DISK_REL, payload);
  } catch {
    /* ignore — disk write best-effort, localStorage already up to date */
  }
}

/** Synchronous read of the cached UI prefs (localStorage + in-memory). */
export function loadUiPrefsLocal(): UiPrefs {
  if (cache) return cache;
  cache = readLocalRaw();
  return cache;
}

/**
 * Merges `patch` into the existing prefs and persists synchronously to
 * localStorage and (debounced) to disk. Returns the merged prefs.
 */
export function saveUiPrefs(patch: UiPrefs): UiPrefs {
  const prev = loadUiPrefsLocal();
  const next: UiPrefs = { ...prev, ...patch };
  cache = next;
  const updatedAt = new Date().toISOString();
  writeLocal(next, updatedAt);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    void flushToDisk(next, updatedAt);
  }, 350);
  return next;
}

/**
 * Async hydrate from `data/desktop_ui_prefs.json`. Returns the disk prefs
 * if the disk copy is newer than the local snapshot (so the caller can
 * adopt them), otherwise returns null.
 *
 * Also primes the in-memory cache + localStorage with the disk value when
 * disk is newer, so future synchronous reads see the recovered value.
 */
export async function hydrateUiPrefsFromDisk(): Promise<UiPrefs | null> {
  if (typeof window === "undefined") return null;
  try {
    const { data } = await fetchProjectJson<PersistedUiPrefsFile>(DISK_REL);
    if (!data || typeof data !== "object" || !data.prefs) return null;
    const diskTs = Date.parse(data.updated_at ?? "") || 0;
    const localTs = readLocalUpdatedAtMs();
    if (diskTs <= localTs) return null;
    cache = data.prefs;
    writeLocal(data.prefs, data.updated_at);
    return data.prefs;
  } catch {
    return null;
  }
}
