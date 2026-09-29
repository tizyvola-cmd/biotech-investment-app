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
  /** Capitale iniziale per esperimento — se assente si usa topCapital come fallback. */
  topCapitalPortfolio?: number;
  topCapitalSimLoop?: number;
  topCapitalSynth?: number;
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
  /**
   * Pick-stocks / Pulse campanella — % of open G/L won that triggers the alert
   * (default 10). Not the G2 book auto-sell fraction.
   */
  glWinAlertPct?: number;
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
/**
 * Session-scoped memoization for {@link hydrateUiPrefsFromDisk}. The
 * hydration used to be re-invoked from every mount of every view that
 * needs `topCapital` / `experimentCapitals` (InvestmentSimulationView
 * alone fires it twice per mount), which on the remote web build meant
 * a fresh HTTP round-trip to `/project-data/desktop_ui_prefs.json` for
 * every navigation — that file is never present in web mode, so every
 * call was ~100-300 ms of wasted latency plus a red 404 in the console.
 *
 * By caching the very first hydration promise for the lifetime of the
 * tab we guarantee at most ONE network request per session regardless of
 * how many components want the disk value. If the request succeeds the
 * cached prefs are already primed via {@link writeLocal}; if it fails
 * (404, offline, timeout) subsequent callers get the null result
 * immediately without hitting the network again.
 *
 * A full page reload clears the module state, so any legitimate disk
 * update that happens after the tab opened will be picked up on next
 * launch.
 */
let hydrationPromise: Promise<UiPrefs | null> | null = null;

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

const CAPITAL_BY_TESTER_KEY = "supernova_ui_capital_by_tester_v1";
const DEFAULT_ACCOUNT_CAPITAL = 5000;

type CapitalPrefs = Pick<
  UiPrefs,
  "topCapital" | "topCapitalPortfolio" | "topCapitalSimLoop" | "topCapitalSynth"
>;

function readCapitalByTester(): Record<string, CapitalPrefs> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(CAPITAL_BY_TESTER_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    return obj && typeof obj === "object" ? (obj as Record<string, CapitalPrefs>) : {};
  } catch {
    return {};
  }
}

/** Persist current capital pots under the previous email before switching accounts. */
export function stashCapitalPrefsForTester(testerId: string | null | undefined): void {
  const id = testerId?.trim();
  if (!id || typeof window === "undefined") return;
  const cur = loadUiPrefsLocal();
  const all = readCapitalByTester();
  all[id] = {
    topCapital: cur.topCapital,
    topCapitalPortfolio: cur.topCapitalPortfolio,
    topCapitalSimLoop: cur.topCapitalSimLoop,
    topCapitalSynth: cur.topCapitalSynth,
  };
  try {
    localStorage.setItem(CAPITAL_BY_TESTER_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** Load this email's capital pots (default empty-account €5k) — never inherit another email's budget. */
export function loadCapitalPrefsForTester(testerId: string | null | undefined): void {
  const id = testerId?.trim();
  const all = id ? readCapitalByTester() : {};
  const saved = id ? all[id] : undefined;
  const fallback = DEFAULT_ACCOUNT_CAPITAL;
  saveUiPrefs({
    topCapital: saved?.topCapital ?? fallback,
    topCapitalPortfolio: saved?.topCapitalPortfolio ?? fallback,
    topCapitalSimLoop: saved?.topCapitalSimLoop ?? fallback,
    topCapitalSynth: saved?.topCapitalSynth ?? fallback,
  });
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
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("supernova-ui-prefs-changed", { detail: next }));
    } catch {
      /* ignore */
    }
  }
  return next;
}

/**
 * Async hydrate from `data/desktop_ui_prefs.json`. Returns the disk prefs
 * if the disk copy is newer than the local snapshot (so the caller can
 * adopt them), otherwise returns null.
 *
 * Also primes the in-memory cache + localStorage with the disk value when
 * disk is newer, so future synchronous reads see the recovered value.
 *
 * Deduped for the lifetime of the tab via {@link hydrationPromise}: many
 * views mount independently and each fires this on mount, but on the
 * remote web build the disk file never exists and every call would
 * otherwise waste an HTTP round-trip on a guaranteed 404.
 */
export async function hydrateUiPrefsFromDisk(): Promise<UiPrefs | null> {
  if (typeof window === "undefined") return null;
  if (hydrationPromise) return hydrationPromise;
  hydrationPromise = (async (): Promise<UiPrefs | null> => {
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
  })();
  return hydrationPromise;
}
