import type { SimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";
import { SIM_TABLE_SYNTH_MAX_SHARE } from "./approvedWeightPortfolioShares";
import type { InvestSimInputs } from "./investSimStorage";
import {
  currentPriceFromRow,
  sheetBuyPriceFromRow,
} from "./simulationPosition";
import { applyLossAwareSynthCapEur } from "./synthLossAwareCap";

export const SYNTH_CAPITAL_LOG_CHANGED_EVENT = "supernova:synth-capital-log-changed";
export const SYNTH_SYNC_COMPLETED_EVENT = "supernova:synth-sync-completed";

export type SynthSyncSummaryLine = {
  rowKey: string;
  ticker: string;
  fromCapitalEur: number;
  toCapitalEur: number;
  deltaEur: number;
};

export type SynthSyncSummary = {
  at: string;
  source: SynthCapitalSyncSource;
  upsized: SynthSyncSummaryLine[];
  trimmed: SynthSyncSummaryLine[];
};

/** Classify sync log entries for the post-sync summary modal. */
export function buildSynthSyncSummary(
  entries: SynthCapitalSyncEntry[],
  source?: SynthCapitalSyncSource,
): SynthSyncSummary | null {
  if (entries.length === 0) return null;
  const upsized: SynthSyncSummaryLine[] = [];
  const trimmed: SynthSyncSummaryLine[] = [];
  for (const e of entries) {
    const from = Math.round(e.fromCapitalEur);
    const to = Math.round(e.toCapitalEur);
    if (from === to) continue;
    const line: SynthSyncSummaryLine = {
      rowKey: e.rowKey,
      ticker: e.ticker,
      fromCapitalEur: from,
      toCapitalEur: to,
      deltaEur: to - from,
    };
    if (to > from) upsized.push(line);
    else trimmed.push(line);
  }
  if (upsized.length === 0 && trimmed.length === 0) return null;
  return {
    at: entries[0]!.at,
    source: source ?? entries[0]!.source ?? "manual",
    upsized,
    trimmed,
  };
}

export function dispatchSynthSyncCompleted(summary: SynthSyncSummary): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SYNTH_SYNC_COMPLETED_EVENT, { detail: summary }));
}

export type SynthCapitalSnapshot = {
  synthEur: number;
  synthShare: number;
  topCapitalEur: number;
  at: string;
};

export type SynthCapitalSyncSource = "auto" | "manual" | "bulk" | "revert";

export type SynthCapitalSyncEntry = {
  at: string;
  rowKey: string;
  ticker: string;
  fromCapitalEur: number;
  toCapitalEur: number;
  synthEur: number;
  synthSharePct: number;
  topCapitalEur: number;
  source?: SynthCapitalSyncSource;
};

const LOG_KEY = "supernova_synth_capital_sync_log_v1";
const SNAPSHOT_KEY = "supernova_last_synth_snapshot_v1";
const BATCHES_KEY = "supernova_synth_sync_batches_v1";
const MAX_ENTRIES_PER_ROW = 30;
const MAX_SYNC_BATCHES = 20;

/** One sync operation (bulk or per-row) — used by Synth revert. */
export type SynthCapitalSyncBatch = {
  at: string;
  source: SynthCapitalSyncSource;
  rows: Record<string, { fromCapitalEur: number; toCapitalEur: number }>;
};

export function resolveSimTableSynthShare(
  alloc: SimLoopSynthAllocation | null,
  rowKey: string,
  inPortfolio: boolean,
): number | null {
  if (!alloc) return null;
  const map = inPortfolio
    ? alloc.portfolioDisplayShareByRowKey
    : alloc.simLoopDisplayShareByRowKey;
  const share = map[rowKey];
  if (share == null || !Number.isFinite(share) || share <= 0) return null;
  return Math.min(share, SIM_TABLE_SYNTH_MAX_SHARE);
}

export function synthCapEurFromShare(share: number, topCapitalEur: number): number {
  if (!Number.isFinite(share) || !Number.isFinite(topCapitalEur) || topCapitalEur <= 0) {
    return 0;
  }
  return Math.round(share * topCapitalEur);
}

/** Raw portfolio synth share (0 allowed — near-zero exposure target). */
export function resolvePortfolioSynthShareRaw(
  alloc: SimLoopSynthAllocation | null,
  rowKey: string,
): number | null {
  if (!alloc) return null;
  const raw = alloc.portfolioDisplayShareByRowKey[rowKey];
  if (raw == null || !Number.isFinite(raw)) return null;
  return Math.max(0, raw);
}

/** Target capital € after loss-aware cap — includes trim-to-dust when share = 0. */
export function resolvePortfolioSynthTargetEur(
  alloc: SimLoopSynthAllocation | null,
  rowKey: string,
  topCapitalEur: number,
  currentCapitalEur: number,
  totalPnlPct?: number | null,
): number | null {
  const rawShare = resolvePortfolioSynthShareRaw(alloc, rowKey);
  if (rawShare == null) return null;
  if (rawShare <= 0) {
    return applyLossAwareSynthCapEur(currentCapitalEur, 0, totalPnlPct);
  }
  const share = resolveSimTableSynthShare(alloc, rowKey, true);
  if (share == null) return null;
  return resolveActionableSynthCapEur(share, topCapitalEur, currentCapitalEur, totalPnlPct);
}

export function resolveActionableSynthCapEur(
  share: number | null,
  topCapitalEur: number,
  currentCapitalEur: number,
  totalPnlPct: number | null | undefined,
): number | null {
  if (share == null || topCapitalEur <= 0) return null;
  const raw = synthCapEurFromShare(share, topCapitalEur);
  if (raw <= 0) return null;
  return applyLossAwareSynthCapEur(currentCapitalEur, raw, totalPnlPct);
}

export function hasSynthCapChanged(
  prev: SynthCapitalSnapshot | undefined,
  next: SynthCapitalSnapshot,
): boolean {
  if (!prev) return false;
  if (prev.topCapitalEur !== next.topCapitalEur) return true;
  if (Math.abs(prev.synthShare - next.synthShare) > 0.0001) return true;
  return Math.abs(prev.synthEur - next.synthEur) >= 1;
}

export function loadSynthCapitalSyncLog(): Record<string, SynthCapitalSyncEntry[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object") return {};
    return obj as Record<string, SynthCapitalSyncEntry[]>;
  } catch {
    return {};
  }
}

export function saveSynthCapitalSyncLog(log: Record<string, SynthCapitalSyncEntry[]>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(log));
    window.dispatchEvent(new CustomEvent(SYNTH_CAPITAL_LOG_CHANGED_EVENT));
  } catch {
    /* non-fatal */
  }
}

export function appendSynthCapitalSyncEntries(
  log: Record<string, SynthCapitalSyncEntry[]>,
  entries: SynthCapitalSyncEntry[],
): Record<string, SynthCapitalSyncEntry[]> {
  if (entries.length === 0) return log;
  const next = { ...log };
  for (const entry of entries) {
    const prev = next[entry.rowKey] ?? [];
    next[entry.rowKey] = [entry, ...prev].slice(0, MAX_ENTRIES_PER_ROW);
  }
  return next;
}

export function loadSynthSyncBatches(): SynthCapitalSyncBatch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BATCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SynthCapitalSyncBatch[]) : [];
  } catch {
    return [];
  }
}

function saveSynthSyncBatches(batches: SynthCapitalSyncBatch[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BATCHES_KEY, JSON.stringify(batches.slice(0, MAX_SYNC_BATCHES)));
  } catch {
    /* non-fatal */
  }
}

/** Remember capital € immediately before a sync command (bulk or row). */
export function pushSynthSyncBatch(entries: SynthCapitalSyncEntry[]): void {
  if (entries.length === 0) return;
  const rows: SynthCapitalSyncBatch["rows"] = {};
  for (const e of entries) {
    rows[e.rowKey] = {
      fromCapitalEur: Math.round(e.fromCapitalEur),
      toCapitalEur: Math.round(e.toCapitalEur),
    };
  }
  const batch: SynthCapitalSyncBatch = {
    at: entries[0]!.at,
    source: entries[0]!.source ?? "manual",
    rows,
  };
  saveSynthSyncBatches([batch, ...loadSynthSyncBatches()].slice(0, MAX_SYNC_BATCHES));
}

export function peekLastSynthSyncBatch(): SynthCapitalSyncBatch | null {
  const batches = loadSynthSyncBatches();
  return batches[0] ?? null;
}

/** Reconstruct the latest bulk sync from row logs (pre-batch migrations). */
export function synthesizeBatchFromLog(
  log: Record<string, SynthCapitalSyncEntry[]>,
): SynthCapitalSyncBatch | null {
  let latestAt = "";
  for (const entries of Object.values(log)) {
    const head = entries.find((e) => e.source !== "revert");
    if (!head?.at || head.at <= latestAt) continue;
    latestAt = head.at;
  }
  if (!latestAt) return null;

  const rows: SynthCapitalSyncBatch["rows"] = {};
  let source: SynthCapitalSyncSource = "manual";
  for (const [rowKey, entries] of Object.entries(log)) {
    const head = entries.find((e) => e.source !== "revert");
    if (!head || head.at !== latestAt) continue;
    rows[rowKey] = {
      fromCapitalEur: Math.round(head.fromCapitalEur),
      toCapitalEur: Math.round(head.toCapitalEur),
    };
    if (head.source) source = head.source;
  }
  if (!Object.keys(rows).length) return null;
  return { at: latestAt, source, rows };
}

export function popLastSynthSyncBatch(): SynthCapitalSyncBatch | null {
  const batches = loadSynthSyncBatches();
  if (!batches.length) return null;
  const [head, ...rest] = batches;
  saveSynthSyncBatches(rest);
  return head ?? null;
}

export function loadLastSynthSnapshot(): Record<string, SynthCapitalSnapshot> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw) as unknown;
    if (!obj || typeof obj !== "object") return {};
    return obj as Record<string, SynthCapitalSnapshot>;
  } catch {
    return {};
  }
}

export function saveLastSynthSnapshot(snapshot: Record<string, SynthCapitalSnapshot>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    /* non-fatal */
  }
}

export type SynthCapitalSyncPlan = {
  snapshot: Record<string, SynthCapitalSnapshot>;
  snapshotChanged: boolean;
  entries: SynthCapitalSyncEntry[];
  capitalUpdates: Record<string, number>;
};

export function planSynthCapitalSyncs(args: {
  synthAlloc: SimLoopSynthAllocation | null;
  topCapitalEur: number;
  inputs: Record<string, { capital?: number; ignoreSheet?: boolean }>;
  positions: Array<{ key: string; ticker: string; capital: number }>;
  inPortfolioByKey: Record<string, boolean>;
  prevSnapshot: Record<string, SynthCapitalSnapshot>;
  pnlPctByKey?: Record<string, number | null | undefined>;
  at?: string;
}): SynthCapitalSyncPlan {
  const {
    synthAlloc,
    topCapitalEur,
    inputs,
    positions,
    inPortfolioByKey,
    prevSnapshot,
    at = new Date().toISOString(),
  } = args;

  const snapshot = { ...prevSnapshot };
  let snapshotChanged = false;
  const entries: SynthCapitalSyncEntry[] = [];
  const capitalUpdates: Record<string, number> = {};

  if (!synthAlloc || topCapitalEur <= 0) {
    return { snapshot, snapshotChanged: false, entries, capitalUpdates };
  }

  for (const p of positions) {
    if (!inPortfolioByKey[p.key]) continue;

    const share = resolveSimTableSynthShare(synthAlloc, p.key, true);
    if (share == null) continue;

    const currentCapital = inputs[p.key]?.capital ?? 0;
    const synthEur = resolveActionableSynthCapEur(
      share,
      topCapitalEur,
      currentCapital,
      args.pnlPctByKey?.[p.key],
    );
    if (synthEur == null) continue;

    const nextSnap: SynthCapitalSnapshot = {
      synthEur,
      synthShare: share,
      topCapitalEur,
      at,
    };
    const prev = prevSnapshot[p.key];

    if (!prev) {
      snapshot[p.key] = nextSnap;
      snapshotChanged = true;
      continue;
    }

    if (!hasSynthCapChanged(prev, nextSnap)) continue;

    snapshot[p.key] = nextSnap;
    snapshotChanged = true;

    if (Math.round(currentCapital) === synthEur) continue;

    capitalUpdates[p.key] = synthEur;
    entries.push({
      at,
      rowKey: p.key,
      ticker: p.ticker,
      fromCapitalEur: currentCapital,
      toCapitalEur: synthEur,
      synthEur,
      synthSharePct: share * 100,
      topCapitalEur,
    });
  }

  return { snapshot, snapshotChanged, entries, capitalUpdates };
}

export function buildManualSynthSyncEntry(args: {
  rowKey: string;
  ticker: string;
  fromCapitalEur: number;
  synthShare: number;
  topCapitalEur: number;
  totalPnlPct?: number | null;
  source?: SynthCapitalSyncSource;
  at?: string;
}): SynthCapitalSyncEntry | null {
  const share = Math.max(0, args.synthShare);
  const synthEur =
    share <= 0
      ? applyLossAwareSynthCapEur(args.fromCapitalEur, 0, args.totalPnlPct)
      : resolveActionableSynthCapEur(
          share,
          args.topCapitalEur,
          args.fromCapitalEur,
          args.totalPnlPct,
        );
  if (synthEur == null) return null;
  if (Math.round(args.fromCapitalEur) === synthEur) return null;
  return {
    at: args.at ?? new Date().toISOString(),
    rowKey: args.rowKey,
    ticker: args.ticker,
    fromCapitalEur: args.fromCapitalEur,
    toCapitalEur: synthEur,
    synthEur,
    synthSharePct: share * 100,
    topCapitalEur: args.topCapitalEur,
    source: args.source ?? "manual",
  };
}

export function planManualSynthSyncs(args: {
  synthAlloc: SimLoopSynthAllocation | null;
  topCapitalEur: number;
  inputs: Record<string, { capital?: number }>;
  positions: Array<{ key: string; ticker: string }>;
  inPortfolioByKey: Record<string, boolean>;
  pnlPctByKey?: Record<string, number | null | undefined>;
  rowKeys?: string[];
  source?: SynthCapitalSyncSource;
  at?: string;
}): {
  entries: SynthCapitalSyncEntry[];
  capitalUpdates: Record<string, number>;
  snapshot: Record<string, SynthCapitalSnapshot>;
} {
  const {
    synthAlloc,
    topCapitalEur,
    inputs,
    positions,
    inPortfolioByKey,
    rowKeys,
    source = "manual",
    at = new Date().toISOString(),
  } = args;

  const entries: SynthCapitalSyncEntry[] = [];
  const capitalUpdates: Record<string, number> = {};
  const snapshot: Record<string, SynthCapitalSnapshot> = {};
  if (!synthAlloc || topCapitalEur <= 0) {
    return { entries, capitalUpdates, snapshot };
  }

  const targetKeys =
    rowKeys ??
    positions.filter((p) => inPortfolioByKey[p.key]).map((p) => p.key);

  for (const key of targetKeys) {
    if (!inPortfolioByKey[key]) continue;
    const rawShare = resolvePortfolioSynthShareRaw(synthAlloc, key);
    if (rawShare == null) continue;
    const pos = positions.find((p) => p.key === key);
    const fromCapital = inputs[key]?.capital ?? 0;
    const entry = buildManualSynthSyncEntry({
      rowKey: key,
      ticker: pos?.ticker ?? key.split("|")[0] ?? key,
      fromCapitalEur: fromCapital,
      synthShare: rawShare,
      topCapitalEur,
      totalPnlPct: args.pnlPctByKey?.[key],
      source,
      at,
    });
    const synthEur = resolvePortfolioSynthTargetEur(
      synthAlloc,
      key,
      topCapitalEur,
      fromCapital,
      args.pnlPctByKey?.[key],
    );
    if (synthEur == null) continue;
    const snapShare = rawShare > 0 ? (resolveSimTableSynthShare(synthAlloc, key, true) ?? rawShare) : 0;
    snapshot[key] = { synthEur, synthShare: snapShare, topCapitalEur, at };
    if (!entry) continue;
    entries.push(entry);
    capitalUpdates[key] = entry.toCapitalEur;
  }

  return { entries, capitalUpdates, snapshot };
}

export function countSynthCapitalSyncRows(
  log: Record<string, SynthCapitalSyncEntry[]> = loadSynthCapitalSyncLog(),
): number {
  const batch = peekLastSynthSyncBatch() ?? synthesizeBatchFromLog(log);
  if (batch) return Object.keys(batch.rows).length;
  return Object.values(log).filter((entries) =>
    entries.some((e) => e.source !== "revert"),
  ).length;
}

function trimLatestLogEntry(
  log: Record<string, SynthCapitalSyncEntry[]>,
  rowKey: string,
): Record<string, SynthCapitalSyncEntry[]> {
  const next = { ...log };
  const syncEntries = (next[rowKey] ?? []).filter((e) => e.source !== "revert");
  if (syncEntries.length <= 1) {
    delete next[rowKey];
  } else {
    next[rowKey] = syncEntries.slice(1);
  }
  return next;
}

/** Undo the last sync command — restore capital € from immediately before that alignment. */
export function planSynthCapitalRevert(
  log: Record<string, SynthCapitalSyncEntry[]>,
  currentInputs: Record<string, { capital?: number }>,
  lastBatch: SynthCapitalSyncBatch | null,
): {
  capitalUpdates: Record<string, number>;
  logAfter: Record<string, SynthCapitalSyncEntry[]>;
  rowsReverted: number;
} {
  const capitalUpdates: Record<string, number> = {};
  let logAfter = { ...log };
  let rowsReverted = 0;

  const applyRow = (rowKey: string, restoreCapRaw: number) => {
    const restoreCap = Math.round(restoreCapRaw);
    const current = Math.round(currentInputs[rowKey]?.capital ?? 0);
    rowsReverted++;
    if (current !== restoreCap) {
      capitalUpdates[rowKey] = restoreCap;
    }
    logAfter = trimLatestLogEntry(logAfter, rowKey);
  };

  if (lastBatch && Object.keys(lastBatch.rows).length > 0) {
    for (const [rowKey, row] of Object.entries(lastBatch.rows)) {
      applyRow(rowKey, row.fromCapitalEur);
    }
    return { capitalUpdates, logAfter, rowsReverted };
  }

  for (const [rowKey, entries] of Object.entries(log)) {
    const syncEntries = entries.filter((e) => e.source !== "revert");
    if (syncEntries.length === 0) continue;
    applyRow(rowKey, syncEntries[0]!.fromCapitalEur);
  }

  return { capitalUpdates, logAfter, rowsReverted };
}

export function applySimTableCapitalUpdates(
  patchInputs: (updater: (prev: InvestSimInputs) => InvestSimInputs) => void,
  capitalUpdates: Record<string, number>,
  simRowByKeyForBuy: Map<string, Record<string, unknown>>,
): void {
  const updateKeys = Object.keys(capitalUpdates);
  if (updateKeys.length === 0) return;

  patchInputs((prev) => {
    const next = { ...prev };
    for (const key of updateKeys) {
      const cap = capitalUpdates[key]!;
      const cur = next[key] ?? { buyPrice: 0, capital: 0 };
      const wasCapitalActive = cur.capital > 0;
      const entry: typeof cur = {
        ...cur,
        capital: cap,
        ignoreSheet: false,
      };
      delete entry.soldAt;
      if (cap > 0 && !wasCapitalActive && !entry.investedAt) {
        entry.investedAt = new Date().toISOString();
      }
      if (cap > 0 && entry.buyPrice <= 0) {
        const row = simRowByKeyForBuy.get(key);
        if (row) {
          const sheetBuy = sheetBuyPriceFromRow(row);
          if (sheetBuy != null && sheetBuy > 0) {
            entry.buyPrice = sheetBuy;
          } else {
            const curr = currentPriceFromRow(row);
            if (curr != null && curr > 0) entry.buyPrice = curr;
          }
        }
      }
      next[key] = entry;
    }
    return next;
  });
}

/** Apply one-row manual synth trim (including target €0) — for alert modal / Actions. */
export function runManualSynthSyncForRow(args: {
  rowKey: string;
  synthAlloc: SimLoopSynthAllocation;
  topCapitalEur: number;
  inputs: InvestSimInputs;
  positions: Array<{ key: string; ticker: string }>;
  inPortfolioByKey: Record<string, boolean>;
  pnlPctByKey?: Record<string, number | null | undefined>;
  patchInputs: (updater: (prev: InvestSimInputs) => InvestSimInputs) => void;
  simRowByKeyForBuy: Map<string, Record<string, unknown>>;
  source?: SynthCapitalSyncSource;
}): boolean {
  const plan = planManualSynthSyncs({
    synthAlloc: args.synthAlloc,
    topCapitalEur: args.topCapitalEur,
    inputs: args.inputs,
    positions: args.positions,
    inPortfolioByKey: args.inPortfolioByKey,
    pnlPctByKey: args.pnlPctByKey,
    rowKeys: [args.rowKey],
    source: args.source ?? "manual",
  });
  if (plan.entries.length === 0) return false;

  pushSynthSyncBatch(plan.entries);
  const log = appendSynthCapitalSyncEntries(loadSynthCapitalSyncLog(), plan.entries);
  saveSynthCapitalSyncLog(log);
  if (Object.keys(plan.snapshot).length > 0) {
    saveLastSynthSnapshot({ ...loadLastSynthSnapshot(), ...plan.snapshot });
  }
  applySimTableCapitalUpdates(args.patchInputs, plan.capitalUpdates, args.simRowByKeyForBuy);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SYNTH_CAPITAL_LOG_CHANGED_EVENT));
  }
  const summary = buildSynthSyncSummary(plan.entries, args.source ?? "manual");
  if (summary) dispatchSynthSyncCompleted(summary);
  return true;
}

export function revertSynthCapitalSyncs(
  patchInputs: (updater: (prev: InvestSimInputs) => InvestSimInputs) => void,
  currentInputs: InvestSimInputs,
  simRowByKeyForBuy: Map<string, Record<string, unknown>>,
  log: Record<string, SynthCapitalSyncEntry[]> = loadSynthCapitalSyncLog(),
): number {
  const storedBatch = peekLastSynthSyncBatch();
  const lastBatch = storedBatch ?? synthesizeBatchFromLog(log);
  const plan = planSynthCapitalRevert(log, currentInputs, lastBatch);
  if (plan.rowsReverted === 0) return 0;

  applySimTableCapitalUpdates(patchInputs, plan.capitalUpdates, simRowByKeyForBuy);

  if (storedBatch) popLastSynthSyncBatch();
  saveSynthCapitalSyncLog(plan.logAfter);
  return plan.rowsReverted;
}
