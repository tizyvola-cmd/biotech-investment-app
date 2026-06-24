/**
 * Pattern Search Scheduler — throttle gate for PCSE re-runs.
 *
 * Sits between `appendDecisionSimTick` (where new closed trades arrive) and
 * `runPatternCombinationSearch`. Never triggers more than once per cooldown
 * window, and only when enough new closed trades have accumulated.
 *
 * Storage: same localStorage pattern as patternProposalStore.ts.
 */

const SCHEDULER_KEY = "supernova.pcse.scheduler.v1";

// ── Tuneable constants ────────────────────────────────────────────────────

/** Minimum ms between two full PCSE runs (default 6 hours). */
export const MIN_RERUN_INTERVAL_MS = 1_000 * 60 * 60 * 6;

/**
 * Minimum number of newly-closed trades since the last run before we
 * trigger again. Avoids re-running the full enumeration for a single trade.
 */
export const MIN_NEW_CLOSED_CASES_TO_TRIGGER = 3;

// ── Types ─────────────────────────────────────────────────────────────────

export type PcseSchedulerState = {
  /** ISO timestamp of last completed run, or null if never run. */
  lastRunTs: string | null;
  /** Total closed trade count at the time of the last run. */
  closedCasesAtLastRun: number;
  /**
   * Row keys of positions that were open (live) at the time of the last run.
   * Used to identify which open positions have since closed when computing
   * liveLossPct in the next run.
   */
  liveMatchKeysAtLastRun: string[];
};

// ── localStorage helpers (mirrors patternProposalStore.ts pattern) ─────────

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

export function loadSchedulerState(): PcseSchedulerState {
  const raw = safeGet(SCHEDULER_KEY);
  if (!raw) return { lastRunTs: null, closedCasesAtLastRun: 0, liveMatchKeysAtLastRun: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      lastRunTs: parsed.lastRunTs ?? null,
      closedCasesAtLastRun: parsed.closedCasesAtLastRun ?? 0,
      liveMatchKeysAtLastRun: Array.isArray(parsed.liveMatchKeysAtLastRun)
        ? parsed.liveMatchKeysAtLastRun
        : [],
    };
  } catch {
    return { lastRunTs: null, closedCasesAtLastRun: 0, liveMatchKeysAtLastRun: [] };
  }
}

export function saveSchedulerState(state: PcseSchedulerState): void {
  try {
    safeSet(SCHEDULER_KEY, JSON.stringify(state));
  } catch {
    /* no-op */
  }
}

/**
 * Returns true when a new PCSE run should be triggered.
 *
 * Rules (both must hold):
 *  1. At least MIN_NEW_CLOSED_CASES_TO_TRIGGER new trades closed since last run.
 *  2. At least MIN_RERUN_INTERVAL_MS elapsed since last run (or never run).
 */
export function shouldRerunSearch(
  state: PcseSchedulerState,
  currentClosedN: number,
  nowMs: number = Date.now(),
): boolean {
  const newCases = currentClosedN - state.closedCasesAtLastRun;
  if (newCases < MIN_NEW_CLOSED_CASES_TO_TRIGGER) return false;
  if (!state.lastRunTs) return true;
  const elapsed = nowMs - new Date(state.lastRunTs).getTime();
  return elapsed >= MIN_RERUN_INTERVAL_MS;
}

/**
 * Mark a run as completed. Call this immediately after `runPatternCombinationSearch`
 * succeeds, passing the live match keys from the run result.
 */
export function markRunCompleted(
  currentClosedN: number,
  liveMatchKeys: string[],
): PcseSchedulerState {
  const next: PcseSchedulerState = {
    lastRunTs: new Date().toISOString(),
    closedCasesAtLastRun: currentClosedN,
    liveMatchKeysAtLastRun: liveMatchKeys,
  };
  saveSchedulerState(next);
  return next;
}

/** Reset for tests. */
export function __resetSchedulerForTests(): void {
  safeSet(SCHEDULER_KEY, JSON.stringify({ lastRunTs: null, closedCasesAtLastRun: 0, liveMatchKeysAtLastRun: [] }));
}
