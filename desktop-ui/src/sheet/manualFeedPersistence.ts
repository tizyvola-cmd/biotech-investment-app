/**
 * Durable persistence for manual feed events + gain-star ledger.
 * Mirrors the dual-channel pattern in `uiPrefs.ts` / `investSimStorage.ts`.
 */
import { fetchProjectJson } from "../data/projectData";
import {
  MANUAL_FEED_EVENTS_STORAGE_KEY,
  MANUAL_FEED_LOSS_PANEL_DISMISSED_KEY,
  type ManualFeedEventDraft,
} from "./manualFeedEvents";
import {
  GAIN_STAR_LEDGER_STORAGE_KEY,
  loadGainStarLedger,
  type GainStarLedger,
} from "./gainStarLedger";

export type ManualFeedStoreFile = {
  version: 1;
  updated_at: string;
  events: ManualFeedEventDraft[];
  gain_star_ledger?: GainStarLedger;
  loss_panel_dismissed?: string[];
};

const DISK_REL = "manual_feed_store.json";
const LOCAL_META_KEY = "biotech.manual_feed_store_updated_at";

let flushTimer: ReturnType<typeof setTimeout> | null = null;

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

function readLossPanelDismissedIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MANUAL_FEED_LOSS_PANEL_DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildStorePayload(): ManualFeedStoreFile {
  const updatedAt = new Date().toISOString();
  let events: ManualFeedEventDraft[] = [];
  try {
    const raw = window.localStorage.getItem(MANUAL_FEED_EVENTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ManualFeedEventDraft[];
      events = Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    events = [];
  }
  return {
    version: 1,
    updated_at: updatedAt,
    events,
    gain_star_ledger: loadGainStarLedger(),
    loss_panel_dismissed: readLossPanelDismissedIds(),
  };
}

function writeLocalMeta(updatedAt: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_META_KEY, updatedAt);
  } catch {
    /* non-fatal */
  }
}

async function flushToDisk(payload: ManualFeedStoreFile): Promise<void> {
  if (typeof window === "undefined") return;
  const bridge = window.supernova;
  if (!bridge?.writeProjectDataFile) return;
  try {
    await bridge.writeProjectDataFile(DISK_REL, payload);
  } catch {
    /* best-effort — localStorage already updated */
  }
}

/** Debounced disk flush after manual feed or gain-star changes. */
export function scheduleManualFeedStoreDiskFlush(): void {
  if (typeof window === "undefined") return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    const payload = buildStorePayload();
    writeLocalMeta(payload.updated_at);
    void flushToDisk(payload);
  }, 350);
}

function applyStoreToLocal(store: ManualFeedStoreFile): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MANUAL_FEED_EVENTS_STORAGE_KEY, JSON.stringify(store.events ?? []));
    if (store.gain_star_ledger && typeof store.gain_star_ledger === "object") {
      window.localStorage.setItem(
        GAIN_STAR_LEDGER_STORAGE_KEY,
        JSON.stringify(store.gain_star_ledger),
      );
    }
    if (Array.isArray(store.loss_panel_dismissed)) {
      window.localStorage.setItem(
        MANUAL_FEED_LOSS_PANEL_DISMISSED_KEY,
        JSON.stringify(store.loss_panel_dismissed),
      );
    }
    writeLocalMeta(store.updated_at);
  } catch {
    /* quota */
  }
}

/**
 * Hydrate from `data/manual_feed_store.json` when disk copy is newer than local.
 * Dispatches change events so open views refresh.
 */
export async function hydrateManualFeedStoreFromDisk(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { data } = await fetchProjectJson<ManualFeedStoreFile>(DISK_REL);
    if (!data || typeof data !== "object" || !Array.isArray(data.events)) return false;
    const diskTs = Date.parse(data.updated_at ?? "") || 0;
    const localTs = readLocalUpdatedAtMs();
    if (diskTs <= localTs) return false;
    applyStoreToLocal(data);
    window.dispatchEvent(new CustomEvent("supernova:manual-feed-events-changed"));
    window.dispatchEvent(new CustomEvent("supernova:gain-star-ledger-changed"));
    return true;
  } catch {
    return false;
  }
}
