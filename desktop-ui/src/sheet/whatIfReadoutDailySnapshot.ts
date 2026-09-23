/**
 * P2 — immutable daily readout snapshots keyed by (sessionDate, ticker).
 * Append-only: once written, never overwritten. Enables point-in-time SDS/EIS/P(plan).
 */
import { resolveApiBase } from "../shared/remoteHost";
import { fetchProjectJson, invalidateProjectJsonCache } from "../data/projectData";
import {
  buildWhatIfCrownReadoutFromSimRow,
  type WhatIfCrownReadout,
  type WhatIfCrownReadoutContext,
} from "./whatIfCrownReadout";
import { normalizedRowKey } from "./investSimKeys";
import type { SheetTable } from "../types";
import type { InvestSimInputs } from "./investSimStorage";
import { calendarDayKeyInTimeZone, lastUsEquityTradingDayKey } from "./marketSession";

export const WHATIF_READOUT_DAILY_STORAGE_KEY = "supernova.whatIf.readoutDaily.v1";
export const WHATIF_READOUT_DAILY_DISK_REL = "whatif_readout_daily_snapshot.json";
export const WHATIF_READOUT_DAILY_CHANGED_EVENT = "supernova:whatIfReadoutDailyChanged";

/** ~2 weeks NYSE sessions before chart-forward bucket analysis. */
export const WHATIF_FORWARD_ANALYSIS_MIN_SESSION_DAYS = 10;
/** Accumulated ticker×day rows (universe × days). */
export const WHATIF_FORWARD_ANALYSIS_MIN_TICKER_DAYS = 200;
/** Ticker×day rows with SDS + EIS + P(plan) all present. */
export const WHATIF_FORWARD_ANALYSIS_MIN_COMPLETE_TICKER_DAYS = 150;

const SCHEMA_VERSION = 1 as const;

export type WhatIfReadoutDailyEntry = {
  sds: number | null;
  eis: number | null;
  pPlan: number | null;
  precatKind: string | null;
  pCont: number | null;
  contG10: number | null;
  exhaustEdge: number | null;
  dailyPct24h: number | null;
  miiAngleDeg: number | null;
  simKey: string | null;
  capturedAt: string;
};

export type WhatIfReadoutDailySnapshotStore = {
  schemaVersion: typeof SCHEMA_VERSION;
  updatedAt: string;
  /** sessionDate (YYYY-MM-DD) → ticker → frozen readout */
  days: Record<string, Record<string, WhatIfReadoutDailyEntry>>;
};

export function emptyWhatIfReadoutDailySnapshotStore(): WhatIfReadoutDailySnapshotStore {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: new Date(0).toISOString(), days: {} };
}

export function readoutDailyEntryFromCrownReadout(
  readout: WhatIfCrownReadout,
  simKey: string | null,
): WhatIfReadoutDailyEntry {
  return {
    sds: readout.sds,
    eis: readout.eis,
    pPlan: readout.pPlan,
    precatKind: readout.precatKind,
    pCont: readout.pCont,
    contG10: readout.contG10,
    exhaustEdge: readout.exhaustEdge,
    dailyPct24h: readout.dailyPct24h,
    miiAngleDeg: readout.miiAngleDeg,
    simKey,
    capturedAt: readout.frozenAt,
  };
}

export function crownReadoutFromDailyEntry(entry: WhatIfReadoutDailyEntry): WhatIfCrownReadout {
  return {
    sds: entry.sds,
    eis: entry.eis,
    pPlan: entry.pPlan,
    precatKind: entry.precatKind,
    pCont: entry.pCont,
    contG10: entry.contG10,
    exhaustEdge: entry.exhaustEdge,
    dailyPct24h: entry.dailyPct24h,
    miiAngleDeg: entry.miiAngleDeg,
    frozenAt: entry.capturedAt,
    source: "snapshot",
  };
}

export function lookupDailyReadoutAsCrown(
  store: WhatIfReadoutDailySnapshotStore | null | undefined,
  sessionDate: string,
  ticker: string,
): WhatIfCrownReadout | null {
  const day = (sessionDate ?? "").trim();
  const tk = ticker.trim().toUpperCase();
  if (!day || !tk || !store?.days?.[day]?.[tk]) return null;
  return crownReadoutFromDailyEntry(store.days[day]![tk]!);
}

/** Merge two stores append-only; on conflict keep the earlier capturedAt. */
export function mergeReadoutDailyStoresAppendOnly(
  a: WhatIfReadoutDailySnapshotStore,
  b: WhatIfReadoutDailySnapshotStore,
): WhatIfReadoutDailySnapshotStore {
  const out: WhatIfReadoutDailySnapshotStore = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    days: { ...a.days },
  };
  for (const [sessionDate, bucket] of Object.entries(b.days ?? {})) {
    if (!out.days[sessionDate]) out.days[sessionDate] = {};
    for (const [ticker, entry] of Object.entries(bucket ?? {})) {
      const tk = ticker.trim().toUpperCase();
      if (!tk) continue;
      const prev = out.days[sessionDate]![tk];
      if (!prev) {
        out.days[sessionDate]![tk] = entry;
        continue;
      }
      const prevTs = Date.parse(prev.capturedAt);
      const nextTs = Date.parse(entry.capturedAt);
      if (Number.isFinite(nextTs) && (!Number.isFinite(prevTs) || nextTs < prevTs)) {
        out.days[sessionDate]![tk] = entry;
      }
    }
  }
  return out;
}

function safeStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
}

export function loadWhatIfReadoutDailySnapshotLocal(): WhatIfReadoutDailySnapshotStore {
  const storage = safeStorage();
  if (!storage) return emptyWhatIfReadoutDailySnapshotStore();
  try {
    const raw = storage.getItem(WHATIF_READOUT_DAILY_STORAGE_KEY);
    if (!raw) return emptyWhatIfReadoutDailySnapshotStore();
    const parsed = JSON.parse(raw) as WhatIfReadoutDailySnapshotStore;
    if (parsed?.schemaVersion !== SCHEMA_VERSION || !parsed.days) {
      return emptyWhatIfReadoutDailySnapshotStore();
    }
    return parsed;
  } catch {
    return emptyWhatIfReadoutDailySnapshotStore();
  }
}

function saveWhatIfReadoutDailySnapshotLocal(store: WhatIfReadoutDailySnapshotStore): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(WHATIF_READOUT_DAILY_STORAGE_KEY, JSON.stringify(store));
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent(WHATIF_READOUT_DAILY_CHANGED_EVENT));
    }
  } catch {
    /* ignore quota */
  }
}

export type WhatIfReadoutDailySummary = {
  sessionDays: number;
  totalTickerSnapshots: number;
  completeReadouts: number;
  medianTickersPerDay: number;
  latestSessionDate: string | null;
  firstSessionDate: string | null;
};

export type WhatIfForwardAnalysisGate = {
  ready: boolean;
  progress: number;
  sessionDaysProgress: number;
  tickerDaysProgress: number;
  completeProgress: number;
  minSessionDays: number;
  minTickerDays: number;
  minCompleteTickerDays: number;
  summary: WhatIfReadoutDailySummary;
};

export function dailyEntryHasCompleteCoreReadout(entry: WhatIfReadoutDailyEntry): boolean {
  return entry.sds != null && entry.eis != null && entry.pPlan != null;
}

function medianInt(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function summarizeWhatIfReadoutDailySnapshot(
  store: WhatIfReadoutDailySnapshotStore,
): WhatIfReadoutDailySummary {
  const dayKeys = Object.keys(store.days ?? {}).filter((d) => {
    const bucket = store.days[d];
    return bucket && Object.keys(bucket).length > 0;
  });
  dayKeys.sort();
  let totalTickerSnapshots = 0;
  let completeReadouts = 0;
  const perDayCounts: number[] = [];
  for (const day of dayKeys) {
    const bucket = store.days[day]!;
    const entries = Object.values(bucket);
    perDayCounts.push(entries.length);
    totalTickerSnapshots += entries.length;
    for (const e of entries) {
      if (dailyEntryHasCompleteCoreReadout(e)) completeReadouts += 1;
    }
  }
  return {
    sessionDays: dayKeys.length,
    totalTickerSnapshots,
    completeReadouts,
    medianTickersPerDay: medianInt(perDayCounts),
    firstSessionDate: dayKeys[0] ?? null,
    latestSessionDate: dayKeys[dayKeys.length - 1] ?? null,
  };
}

export function evaluateWhatIfForwardAnalysisGate(
  store: WhatIfReadoutDailySnapshotStore = loadWhatIfReadoutDailySnapshotLocal(),
): WhatIfForwardAnalysisGate {
  const summary = summarizeWhatIfReadoutDailySnapshot(store);
  const sessionDaysProgress = Math.min(
    1,
    summary.sessionDays / WHATIF_FORWARD_ANALYSIS_MIN_SESSION_DAYS,
  );
  const tickerDaysProgress = Math.min(
    1,
    summary.totalTickerSnapshots / WHATIF_FORWARD_ANALYSIS_MIN_TICKER_DAYS,
  );
  const completeProgress = Math.min(
    1,
    summary.completeReadouts / WHATIF_FORWARD_ANALYSIS_MIN_COMPLETE_TICKER_DAYS,
  );
  const ready =
    summary.sessionDays >= WHATIF_FORWARD_ANALYSIS_MIN_SESSION_DAYS &&
    summary.totalTickerSnapshots >= WHATIF_FORWARD_ANALYSIS_MIN_TICKER_DAYS &&
    summary.completeReadouts >= WHATIF_FORWARD_ANALYSIS_MIN_COMPLETE_TICKER_DAYS;
  return {
    ready,
    progress: Math.min(sessionDaysProgress, tickerDaysProgress, completeProgress),
    sessionDaysProgress,
    tickerDaysProgress,
    completeProgress,
    minSessionDays: WHATIF_FORWARD_ANALYSIS_MIN_SESSION_DAYS,
    minTickerDays: WHATIF_FORWARD_ANALYSIS_MIN_TICKER_DAYS,
    minCompleteTickerDays: WHATIF_FORWARD_ANALYSIS_MIN_COMPLETE_TICKER_DAYS,
    summary,
  };
}

let hydratePromise: Promise<WhatIfReadoutDailySnapshotStore> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersist: WhatIfReadoutDailySnapshotStore | null = null;

/** Hydrate local store from data/ JSON (best-effort). */
export async function hydrateWhatIfReadoutDailySnapshot(): Promise<WhatIfReadoutDailySnapshotStore> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const local = loadWhatIfReadoutDailySnapshotLocal();
    try {
      const { data } = await fetchProjectJson<WhatIfReadoutDailySnapshotStore>(
        WHATIF_READOUT_DAILY_DISK_REL,
      );
      if (data?.schemaVersion === SCHEMA_VERSION && data.days) {
        const merged = mergeReadoutDailyStoresAppendOnly(local, data);
        saveWhatIfReadoutDailySnapshotLocal(merged);
        return merged;
      }
    } catch {
      /* offline */
    }
    return local;
  })();
  try {
    return await hydratePromise;
  } finally {
    hydratePromise = null;
  }
}

async function persistWhatIfReadoutDailySnapshotToDisk(
  store: WhatIfReadoutDailySnapshotStore,
): Promise<void> {
  const payload = { ...store, updatedAt: new Date().toISOString() };
  if (typeof window !== "undefined" && window.supernova?.writeProjectDataFile) {
    try {
      await window.supernova.writeProjectDataFile(WHATIF_READOUT_DAILY_DISK_REL, payload);
      invalidateProjectJsonCache(WHATIF_READOUT_DAILY_DISK_REL);
      return;
    } catch {
      /* fall through to API */
    }
  }
  const base = resolveApiBase();
  if (!base) return;
  try {
    await fetch(`${base}/api/whatif/readout-daily-snapshot`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    invalidateProjectJsonCache(WHATIF_READOUT_DAILY_DISK_REL);
  } catch {
    /* best-effort */
  }
}

function schedulePersistWhatIfReadoutDailySnapshot(store: WhatIfReadoutDailySnapshotStore): void {
  pendingPersist = store;
  if (persistTimer != null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const snap = pendingPersist;
    pendingPersist = null;
    if (snap) void persistWhatIfReadoutDailySnapshotToDisk(snap);
  }, 2500);
}

export type AppendDailyReadoutResult = {
  store: WhatIfReadoutDailySnapshotStore;
  appended: number;
  sessionDate: string;
};

/**
 * Snapshot universe readouts for one session day. Skips tickers already stored for that day.
 */
export function appendUniverseReadoutDailySnapshots(opts: {
  sessionDate: string;
  simTable: SheetTable | null | undefined;
  inputs?: InvestSimInputs;
  ctx: WhatIfCrownReadoutContext;
  store?: WhatIfReadoutDailySnapshotStore;
  nowIso?: string;
}): AppendDailyReadoutResult {
  const sessionDate = (opts.sessionDate ?? "").trim();
  const store = opts.store ?? loadWhatIfReadoutDailySnapshotLocal();
  if (!sessionDate || !opts.simTable?.rows?.length) {
    return { store, appended: 0, sessionDate };
  }

  const nowIso = opts.nowIso ?? new Date().toISOString();
  const seenTickers = new Set<string>();
  let appended = 0;

  if (!store.days[sessionDate]) store.days[sessionDate] = {};
  const dayBucket = store.days[sessionDate]!;

  for (const row of opts.simTable.rows) {
    const ticker = String(row.Ticker ?? row.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!ticker || seenTickers.has(ticker)) continue;
    seenTickers.add(ticker);
    if (dayBucket[ticker]) continue;

    const simKey = normalizedRowKey(ticker, row["Completion Date"]);
    const hasPosition = simKey
      ? Boolean(opts.inputs?.[simKey]?.capital && !opts.inputs[simKey]?.ignoreSheet)
      : false;

    const readout = buildWhatIfCrownReadoutFromSimRow(row, {
      source: "snapshot",
      frozenAt: nowIso,
      hasPosition,
      ticker,
      simKey,
      ctx: opts.ctx,
    });
    if (!readout) continue;

    dayBucket[ticker] = readoutDailyEntryFromCrownReadout(readout, simKey);
    appended += 1;
  }

  if (appended > 0) {
    store.updatedAt = nowIso;
    saveWhatIfReadoutDailySnapshotLocal(store);
    schedulePersistWhatIfReadoutDailySnapshot(store);
  }

  return { store, appended, sessionDate };
}

/** Default session key when intraday payload is unavailable (NYSE calendar). */
export function defaultReadoutSnapshotSessionDate(ref: Date = new Date()): string {
  return lastUsEquityTradingDayKey(ref) || calendarDayKeyInTimeZone(ref, "America/New_York");
}

/** Run once after sim + SDS/EIS context is ready (dashboard mount / refresh). */
export function maybeSnapshotUniverseReadouts(opts: {
  sessionDate?: string | null;
  simTable: SheetTable | null | undefined;
  inputs?: InvestSimInputs;
  ctx: WhatIfCrownReadoutContext;
}): AppendDailyReadoutResult | null {
  if (!opts.simTable?.rows?.length) return null;
  const sessionDate = (opts.sessionDate ?? "").trim() || defaultReadoutSnapshotSessionDate();
  return appendUniverseReadoutDailySnapshots({
    sessionDate,
    simTable: opts.simTable,
    inputs: opts.inputs,
    ctx: opts.ctx,
  });
}
