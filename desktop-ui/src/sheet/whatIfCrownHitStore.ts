/**
 * Grado 2 — log first-hit crown events (Strong ∩ portfolio) per session day.
 * Dedup key: sessionDate|ticker. End P&L may refresh on later polls.
 */
import {
  isWhatIfPortfolioStrongHit,
  isWhatIfStrongNow,
} from "./simUniverse24hWhatIf";
import type { WhatIfCurveStats } from "./simUniverse24hWhatIf";
import type { WhatIfCrownReadout } from "./whatIfCrownReadout";
import {
  buildWhatIfCrownReadoutFromSimRow,
  mergeWhatIfCrownReadouts,
  stickyWhatIfCrownReadoutSource,
  whatIfCrownReadoutNeedsEnrichment,
  type WhatIfCrownReadoutContext,
} from "./whatIfCrownReadout";
import {
  loadWhatIfReadoutDailySnapshotLocal,
  lookupDailyReadoutAsCrown,
  type WhatIfReadoutDailySnapshotStore,
} from "./whatIfReadoutDailySnapshot";

export const WHATIF_CROWN_HIT_STORAGE_KEY = "supernova.whatIf.crownHits.v1";
export const WHATIF_CROWN_HIT_CHANGED_EVENT = "supernova:whatIfCrownHitsChanged";
/** User dismissed the lit Grado-3 ready window (until thresholds rise again). */
export const WHATIF_GRADE3_READY_DISMISS_KEY = "supernova.whatIf.grade3Ready.dismissed.v1";

const SCHEMA_VERSION = 1;
const MAX_EVENTS = 400;

/** Unlock Grado 3 (readout freeze / analysis) after enough crown-log sample. */
export const WHATIF_GRADE3_MIN_HISTORY_DAYS = 14;
export const WHATIF_GRADE3_MIN_HISTORY_HITS = 5;

export type WhatIfGrade3Gate = {
  ready: boolean;
  historyDays: number;
  historyHits: number;
  minDays: number;
  minHits: number;
  /** 0…1 overall progress (min of the two bars). */
  progress: number;
  daysProgress: number;
  hitsProgress: number;
};

export type WhatIfCrownHitEvent = {
  sessionDate: string;
  ticker: string;
  simKey: string | null;
  endPnl: number;
  pathMax: number;
  pathMin: number;
  oscillating: boolean;
  /** ISO time of first detection this session day. */
  capturedAt: string;
  /** Last time endPnl / path stats were refreshed for this hit. */
  updatedAt: string;
  /** Grado 3 — frozen at first capture (optional on legacy hits). */
  readout?: WhatIfCrownReadout | null;
};

export type WhatIfCrownHitStore = {
  schemaVersion: typeof SCHEMA_VERSION;
  events: WhatIfCrownHitEvent[];
};

export type WhatIfCrownHitCandidate = {
  ticker: string;
  simKey?: string | null;
  inPortfolio: boolean;
  /** Sheet Var. Giorn. % — red day demotes path-Strong (no crown). */
  dailyPct24h?: number | null;
  stats: Pick<
    WhatIfCurveStats,
    "strong" | "endPnl" | "pathMax" | "pathMin" | "oscillating"
  > | null;
  /** Grado 3 readout — attached only on first insert. */
  readout?: WhatIfCrownReadout | null;
};

export type WhatIfCrownSessionSummary = {
  sessionDate: string;
  /** Distinct crown tickers logged for this session day. */
  crownHits: number;
  /** Live portfolio names with hourly data at log time (denominator for KPI). */
  portfolioWithData: number;
  tickers: string[];
  /** Distinct session days retained in the store. */
  historyDays: number;
  /** Total crown events across all days. */
  historyHits: number;
};

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function emptyWhatIfCrownHitStore(): WhatIfCrownHitStore {
  return { schemaVersion: SCHEMA_VERSION, events: [] };
}

export function crownHitDedupeKey(sessionDate: string, ticker: string): string {
  return `${sessionDate.trim()}|${ticker.trim().toUpperCase()}`;
}

export function loadWhatIfCrownHitStore(): WhatIfCrownHitStore {
  const storage = safeStorage();
  if (!storage) return emptyWhatIfCrownHitStore();
  try {
    const raw = storage.getItem(WHATIF_CROWN_HIT_STORAGE_KEY);
    if (!raw) return emptyWhatIfCrownHitStore();
    const parsed = JSON.parse(raw) as WhatIfCrownHitStore;
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.events)) {
      return emptyWhatIfCrownHitStore();
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      events: parsed.events
        .filter(
          (e): e is WhatIfCrownHitEvent =>
            !!e &&
            typeof e.sessionDate === "string" &&
            typeof e.ticker === "string" &&
            typeof e.capturedAt === "string",
        )
        .slice(-MAX_EVENTS),
    };
  } catch {
    return emptyWhatIfCrownHitStore();
  }
}

export function saveWhatIfCrownHitStore(store: WhatIfCrownHitStore): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(
      WHATIF_CROWN_HIT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        events: store.events.slice(-MAX_EVENTS),
      }),
    );
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent(WHATIF_CROWN_HIT_CHANGED_EVENT));
    }
  } catch {
    /* storage full or blocked */
  }
}

export function clearWhatIfCrownHitStore(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(WHATIF_CROWN_HIT_STORAGE_KEY);
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent(WHATIF_CROWN_HIT_CHANGED_EVENT));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Record first-hit crown events for the session. Returns newly inserted events.
 * Existing hits for the same sessionDate|ticker get endPnl / path stats refreshed.
 */
export function recordWhatIfCrownHits(
  sessionDate: string | null | undefined,
  candidates: readonly WhatIfCrownHitCandidate[],
  nowIso: string = new Date().toISOString(),
  store: WhatIfCrownHitStore = loadWhatIfCrownHitStore(),
): { store: WhatIfCrownHitStore; inserted: WhatIfCrownHitEvent[]; updated: number } {
  const day = (sessionDate ?? "").trim();
  if (!day || !candidates.length) {
    return { store, inserted: [], updated: 0 };
  }

  const byKey = new Map<string, number>();
  store.events.forEach((e, i) => byKey.set(crownHitDedupeKey(e.sessionDate, e.ticker), i));

  const events = [...store.events];
  const inserted: WhatIfCrownHitEvent[] = [];
  let updated = 0;

  for (const c of candidates) {
    const ticker = c.ticker.trim().toUpperCase();
    if (!ticker || !c.stats) continue;
    const strongNow = isWhatIfStrongNow(c.stats.strong, c.dailyPct24h);
    if (!isWhatIfPortfolioStrongHit(c.inPortfolio, strongNow)) continue;

    const key = crownHitDedupeKey(day, ticker);
    const existingIdx = byKey.get(key);
    if (existingIdx != null) {
      const prev = events[existingIdx]!;
      const readout = c.readout
        ? mergeWhatIfCrownReadouts(prev.readout, c.readout) ?? prev.readout
        : prev.readout;
      events[existingIdx] = {
        ...prev,
        endPnl: c.stats.endPnl,
        pathMax: c.stats.pathMax,
        pathMin: c.stats.pathMin,
        oscillating: c.stats.oscillating,
        simKey: c.simKey?.trim() || prev.simKey,
        updatedAt: nowIso,
        readout,
      };
      updated += 1;
      continue;
    }

    const ev: WhatIfCrownHitEvent = {
      sessionDate: day,
      ticker,
      simKey: c.simKey?.trim() || null,
      endPnl: c.stats.endPnl,
      pathMax: c.stats.pathMax,
      pathMin: c.stats.pathMin,
      oscillating: c.stats.oscillating,
      capturedAt: nowIso,
      updatedAt: nowIso,
      readout: c.readout ?? null,
    };
    byKey.set(key, events.length);
    events.push(ev);
    inserted.push(ev);
  }

  if (!inserted.length && updated === 0) {
    return { store, inserted: [], updated: 0 };
  }

  const next: WhatIfCrownHitStore = {
    schemaVersion: SCHEMA_VERSION,
    events: events.slice(-MAX_EVENTS),
  };
  saveWhatIfCrownHitStore(next);
  return { store: next, inserted, updated };
}

export function listWhatIfCrownHitsForSession(
  sessionDate: string | null | undefined,
  store: WhatIfCrownHitStore = loadWhatIfCrownHitStore(),
): WhatIfCrownHitEvent[] {
  const day = (sessionDate ?? "").trim();
  if (!day) return [];
  return store.events
    .filter((e) => e.sessionDate === day)
    .slice()
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function summarizeWhatIfCrownSession(
  sessionDate: string | null | undefined,
  portfolioWithData: number,
  store: WhatIfCrownHitStore = loadWhatIfCrownHitStore(),
): WhatIfCrownSessionSummary {
  const day = (sessionDate ?? "").trim() || "—";
  const today = listWhatIfCrownHitsForSession(day === "—" ? null : day, store);
  const days = new Set(store.events.map((e) => e.sessionDate));
  return {
    sessionDate: day,
    crownHits: today.length,
    portfolioWithData: Math.max(0, Math.floor(portfolioWithData)),
    tickers: today.map((e) => e.ticker),
    historyDays: days.size,
    historyHits: store.events.length,
  };
}

export function evaluateWhatIfGrade3Gate(
  summary: Pick<WhatIfCrownSessionSummary, "historyDays" | "historyHits">,
): WhatIfGrade3Gate {
  const historyDays = Math.max(0, summary.historyDays);
  const historyHits = Math.max(0, summary.historyHits);
  const daysProgress = Math.min(1, historyDays / WHATIF_GRADE3_MIN_HISTORY_DAYS);
  const hitsProgress = Math.min(1, historyHits / WHATIF_GRADE3_MIN_HISTORY_HITS);
  const ready =
    historyDays >= WHATIF_GRADE3_MIN_HISTORY_DAYS &&
    historyHits >= WHATIF_GRADE3_MIN_HISTORY_HITS;
  return {
    ready,
    historyDays,
    historyHits,
    minDays: WHATIF_GRADE3_MIN_HISTORY_DAYS,
    minHits: WHATIF_GRADE3_MIN_HISTORY_HITS,
    progress: Math.min(daysProgress, hitsProgress),
    daysProgress,
    hitsProgress,
  };
}

type Grade3DismissState = {
  /** Snapshot when user dismissed — re-light if sample grows past this. */
  historyDays: number;
  historyHits: number;
  dismissedAt: string;
};

function readGrade3Dismiss(): Grade3DismissState | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(WHATIF_GRADE3_READY_DISMISS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Grade3DismissState;
    if (
      !parsed ||
      typeof parsed.historyDays !== "number" ||
      typeof parsed.historyHits !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** True when Grado 3 is ready and the lit window should show (not dismissed for this sample). */
export function shouldShowWhatIfGrade3ReadyWindow(gate: WhatIfGrade3Gate): boolean {
  if (!gate.ready) return false;
  const d = readGrade3Dismiss();
  if (!d) return true;
  // Re-light if the log grew after dismiss (new sample worth noticing).
  return gate.historyDays > d.historyDays || gate.historyHits > d.historyHits;
}

export function dismissWhatIfGrade3ReadyWindow(gate: WhatIfGrade3Gate): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    const payload: Grade3DismissState = {
      historyDays: gate.historyDays,
      historyHits: gate.historyHits,
      dismissedAt: new Date().toISOString(),
    };
    storage.setItem(WHATIF_GRADE3_READY_DISMISS_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** All crown hits newest-first (for Grado 3 analysis table). */
export function listAllWhatIfCrownHits(
  store: WhatIfCrownHitStore = loadWhatIfCrownHitStore(),
): WhatIfCrownHitEvent[] {
  return [...store.events].sort((a, b) => {
    const d = b.sessionDate.localeCompare(a.sessionDate);
    if (d !== 0) return d;
    return b.capturedAt.localeCompare(a.capturedAt);
  });
}

/** Serialize crown store for offline analysis (diag script / handoff). */
export function serializeWhatIfCrownHitStore(
  store: WhatIfCrownHitStore = loadWhatIfCrownHitStore(),
): string {
  return JSON.stringify(store, null, 2);
}

/** Trigger browser download of crown log JSON. No-op outside browser. */
export function downloadWhatIfCrownHitExport(
  filename = "whatif_crown_hits_export.json",
  store: WhatIfCrownHitStore = loadWhatIfCrownHitStore(),
): boolean {
  if (typeof document === "undefined") return false;
  try {
    const blob = new Blob([serializeWhatIfCrownHitStore(store)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fill missing readout fields from current Simulation rows (book today — not historical snapshot).
 * Manual only (Grade 3 panel button). Never overwrites non-null scores; capture source is sticky.
 */
export function backfillWhatIfCrownReadouts(
  resolveRow: (ev: WhatIfCrownHitEvent) => Record<string, unknown> | null,
  store: WhatIfCrownHitStore = loadWhatIfCrownHitStore(),
  nowIso: string = new Date().toISOString(),
  ctx?: WhatIfCrownReadoutContext,
  dailySnapshot: WhatIfReadoutDailySnapshotStore = loadWhatIfReadoutDailySnapshotLocal(),
): { store: WhatIfCrownHitStore; filled: number } {
  let filled = 0;
  const events = store.events.map((ev) => {
    const needsWork = !ev.readout || whatIfCrownReadoutNeedsEnrichment(ev.readout);
    if (!needsWork) return ev;

    const snap = lookupDailyReadoutAsCrown(dailySnapshot, ev.sessionDate, ev.ticker);
    let merged = mergeWhatIfCrownReadouts(ev.readout, snap);

    if (merged && !whatIfCrownReadoutNeedsEnrichment(merged)) {
      const changed =
        !ev.readout ||
        ev.readout.sds !== merged.sds ||
        ev.readout.eis !== merged.eis ||
        ev.readout.pPlan !== merged.pPlan ||
        ev.readout.miiAngleDeg !== merged.miiAngleDeg ||
        ev.readout.source !== merged.source;
      if (!changed) return ev;
      filled += 1;
      return { ...ev, readout: merged };
    }

    const row = resolveRow(ev);
    if (!row && !merged) return ev;

    const fresh = row
      ? buildWhatIfCrownReadoutFromSimRow(row, {
          source: stickyWhatIfCrownReadoutSource(ev.readout, snap) === "capture"
            ? "capture"
            : stickyWhatIfCrownReadoutSource(ev.readout, snap) === "snapshot"
              ? "snapshot"
              : "backfill",
          frozenAt: ev.readout?.frozenAt ?? snap?.frozenAt ?? nowIso,
          hasPosition: true,
          ticker: ev.ticker,
          simKey: ev.simKey,
          ctx,
        })
      : null;
    merged = mergeWhatIfCrownReadouts(merged ?? ev.readout, fresh);
    if (!merged) return ev;
    const changed =
      !ev.readout ||
      ev.readout.sds !== merged.sds ||
      ev.readout.eis !== merged.eis ||
      ev.readout.pPlan !== merged.pPlan ||
      ev.readout.miiAngleDeg !== merged.miiAngleDeg ||
      ev.readout.source !== merged.source;
    if (!changed) return ev;
    filled += 1;
    return { ...ev, readout: merged };
  });
  if (filled === 0) return { store, filled: 0 };
  const next: WhatIfCrownHitStore = { schemaVersion: SCHEMA_VERSION, events };
  saveWhatIfCrownHitStore(next);
  return { store: next, filled };
}
