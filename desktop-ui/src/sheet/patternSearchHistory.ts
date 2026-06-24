/**
 * Pattern Search History — append-only localStorage store for PCSE snapshots.
 *
 * Persists the top-N combination results from each run so the UI can show
 * the evolution of lift over time. FIFO beyond MAX_SNAPSHOTS.
 *
 * Storage pattern identical to patternProposalStore.ts.
 */
import type { CombinationResult, PcseRunResult } from "./patternCombinationSearch";

const HISTORY_KEY = "supernova.pcse.history.v1";

export const MAX_SNAPSHOTS = 90;
/** How many top results to store per snapshot (by stabilityScore desc). */
export const TOP_N_PER_SNAPSHOT = 20;

// ── Types ─────────────────────────────────────────────────────────────────

export type PatternSearchSnapshot = {
  /** ISO timestamp of the run. */
  ts: string;
  /** Total historical closed trades at run time. */
  totalClosedN: number;
  /** Total open positions matched (portfolio + sim loop) at run time. */
  totalLiveN: number;
  /** Global loss rate (%) at run time. */
  globalLossRate: number;
  /** Top-N combinations by stabilityScore desc. */
  topCandidates: CombinationResult[];
};

export type PatternSearchHistory = PatternSearchSnapshot[];

// ── localStorage helpers ───────────────────────────────────────────────────

const __mem: Record<string, string> = {};

function safeGet(key: string): string | null {
  if (typeof window !== "undefined") {
    try {
      return window.localStorage.getItem(key);
    } catch {
      /* fall through */
    }
  }
  return Object.prototype.hasOwnProperty.call(__mem, key) ? __mem[key]! : null;
}

function safeSet(key: string, value: string): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, value);
      return;
    } catch {
      /* fall through */
    }
  }
  __mem[key] = value;
}

// ── Public API ────────────────────────────────────────────────────────────

export function loadPatternSearchHistory(): PatternSearchHistory {
  const raw = safeGet(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PatternSearchHistory) : [];
  } catch {
    return [];
  }
}

function saveHistory(h: PatternSearchHistory): void {
  try {
    safeSet(HISTORY_KEY, JSON.stringify(h));
  } catch {
    /* no-op */
  }
}

/**
 * Append a new snapshot from a completed PCSE run.
 * Trims to MAX_SNAPSHOTS (FIFO). Returns the updated history.
 */
export function appendPcseSnapshot(
  run: PcseRunResult,
  totalLiveN: number,
): PatternSearchHistory {
  const existing = loadPatternSearchHistory();
  const snap: PatternSearchSnapshot = {
    ts: run.computedAt,
    totalClosedN: run.totalHistoricalN,
    totalLiveN,
    globalLossRate: run.globalLossRate,
    topCandidates: run.results.slice(0, TOP_N_PER_SNAPSHOT),
  };
  const updated = [...existing, snap];
  const trimmed =
    updated.length > MAX_SNAPSHOTS ? updated.slice(updated.length - MAX_SNAPSHOTS) : updated;
  saveHistory(trimmed);
  return trimmed;
}

/**
 * Returns all snapshots in chronological order (oldest first).
 */
export function listSnapshots(): PatternSearchSnapshot[] {
  return loadPatternSearchHistory();
}

/**
 * For a given combination label, return the lift history across all snapshots
 * where that combination appeared in topCandidates.
 * Useful for rendering the per-combination lift evolution chart.
 */
export function liftHistoryForLabel(label: string): Array<{ ts: string; lift: number; stabilityScore: number }> {
  return loadPatternSearchHistory()
    .flatMap((snap) => {
      const match = snap.topCandidates.find((c) => c.label === label);
      if (!match) return [];
      return [{ ts: snap.ts, lift: match.historicalLift, stabilityScore: match.stabilityScore }];
    });
}

/** Reset for tests. */
export function __resetHistoryForTests(): void {
  safeSet(HISTORY_KEY, JSON.stringify([]));
}
