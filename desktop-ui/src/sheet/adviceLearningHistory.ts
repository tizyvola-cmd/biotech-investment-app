/**
 * Persistent log of "advice learning" checkpoints — used to draw the
 * Model Quality timeline that shows how recommendation quality improves
 * as the system collects more feedback and applies corrections.
 *
 * A snapshot is appended every time:
 *   • the user clicks "Save & apply learnings" in the Decision Sim panel
 *     (forced, explicit checkpoint), OR
 *   • the panel observes a fresh advice-calibration summary and a full
 *     calendar day has passed since the last snapshot (auto checkpoint).
 *
 * Dedup rule: if the latest stored snapshot has the same day-stamp and
 * the same key metrics as the new one, we skip the write instead of
 * piling up identical rows.
 *
 * Storage cap: rolling window of 365 snapshots (≈ one year of dailies).
 */

import type { AdviceFeedback } from "./adviceFeedback";
import type { AdviceCalibrationSummary } from "./investDecisionSimAdviceCalibration";

const STORAGE_KEY = "supernova.adviceLearning.history.v1";
export const ADVICE_LEARNING_HISTORY_CHANGED_EVENT =
  "supernova-advice-learning-history-changed";

/** Hard cap on how many checkpoints we keep. */
export const ADVICE_LEARNING_HISTORY_LIMIT = 365;
/** Only auto-snapshot once per calendar day. */
export const ADVICE_LEARNING_AUTO_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000;
/**
 * Minimum scored points required before we even consider auto-snapshotting
 * (avoids polluting the timeline with empty/noisy days at boot).
 */
export const ADVICE_LEARNING_AUTO_SNAPSHOT_MIN_SCORED = 3;

export type AdviceLearningSnapshot = {
  /** ISO timestamp of when the snapshot was captured. */
  ts: string;
  /** Day stamp (YYYY-MM-DD) — used for dedup and X-axis labels. */
  day: string;
  /** True when the snapshot was written from a manual "Save & apply" click. */
  manual: boolean;
  /** Total good+bad advice points used to build the summary. */
  scoredPoints: number;
  /** Aggregated success rate (good / scored × 100). */
  overallSuccessRatePct: number | null;
  /** Low-prob band success (P(plan) ≤ 59%). */
  lowProbSuccessRatePct: number | null;
  /** Low-prob band scored count. */
  lowProbScored: number;
  /** High-prob band success (P(plan) ≥ 70%). */
  highProbSuccessRatePct: number | null;
  /** High-prob band scored count. */
  highProbScored: number;
  /** Number of bucket multipliers active at snapshot time. */
  bucketCorrectionsActive: number;
  /** Number of action demotions active at snapshot time. */
  actionDemotionsActive: number;
  /** Unified "Advice direction (24h)" headline KPI, if available. */
  unifiedAdviceSuccessPct: number | null;
  /** "Capture vs recs" complementary KPI, if available. */
  capturePct: number | null;
  /** Paper book return %, if available. */
  paperBookReturnPct: number | null;
  /** Closed P&L win rate %, if available. */
  closedPnlWinRatePct: number | null;
};

export type AdviceLearningHistory = {
  schemaVersion: 1;
  snapshots: AdviceLearningSnapshot[];
};

/** Build a snapshot DTO from the live metrics (does not persist). */
export function buildAdviceLearningSnapshot(input: {
  summary: AdviceCalibrationSummary | null;
  feedback: AdviceFeedback | null;
  unifiedAdviceSuccessPct?: number | null;
  capturePct?: number | null;
  paperBookReturnPct?: number | null;
  closedPnlWinRatePct?: number | null;
  manual?: boolean;
  now?: Date;
}): AdviceLearningSnapshot {
  const now = input.now ?? new Date();
  const ts = now.toISOString();
  const day = ts.slice(0, 10);
  const s = input.summary;
  const fb = input.feedback;
  return {
    ts,
    day,
    manual: input.manual ?? false,
    scoredPoints: s?.scoredCount ?? 0,
    overallSuccessRatePct: s?.overallSuccessRatePct ?? null,
    lowProbSuccessRatePct: s?.lowProb.successRatePct ?? null,
    lowProbScored: (s?.lowProb.good ?? 0) + (s?.lowProb.bad ?? 0),
    highProbSuccessRatePct: s?.highProb.successRatePct ?? null,
    highProbScored: (s?.highProb.good ?? 0) + (s?.highProb.bad ?? 0),
    bucketCorrectionsActive: fb?.bucketCorrections.size ?? 0,
    actionDemotionsActive: fb?.actionDemotions.size ?? 0,
    unifiedAdviceSuccessPct: input.unifiedAdviceSuccessPct ?? null,
    capturePct: input.capturePct ?? null,
    paperBookReturnPct: input.paperBookReturnPct ?? null,
    closedPnlWinRatePct: input.closedPnlWinRatePct ?? null,
  };
}

function snapshotsMaterialMatch(
  a: AdviceLearningSnapshot,
  b: AdviceLearningSnapshot,
): boolean {
  return (
    a.scoredPoints === b.scoredPoints &&
    a.overallSuccessRatePct === b.overallSuccessRatePct &&
    a.lowProbSuccessRatePct === b.lowProbSuccessRatePct &&
    a.highProbSuccessRatePct === b.highProbSuccessRatePct &&
    a.bucketCorrectionsActive === b.bucketCorrectionsActive &&
    a.actionDemotionsActive === b.actionDemotionsActive
  );
}

/**
 * Decides whether the given snapshot should be appended.
 *
 * Returns one of:
 *   • { action: "skip" }                    — duplicate of last (same day, same metrics)
 *   • { action: "replace" }                 — same day, manual checkpoint, supersedes auto entry
 *   • { action: "append" }                  — otherwise (new day or fresh data)
 */
export function decideAppendStrategy(
  history: AdviceLearningHistory,
  candidate: AdviceLearningSnapshot,
): { action: "skip" | "append" | "replace" } {
  const last = history.snapshots[history.snapshots.length - 1];
  if (!last) return { action: "append" };
  if (last.day === candidate.day) {
    if (last.manual && !candidate.manual) return { action: "skip" };
    if (snapshotsMaterialMatch(last, candidate) && last.manual === candidate.manual) {
      return { action: "skip" };
    }
    if (candidate.manual) return { action: "replace" };
    if (!last.manual && snapshotsMaterialMatch(last, candidate)) return { action: "skip" };
    return { action: "replace" };
  }
  return { action: "append" };
}

export function appendSnapshotToHistory(
  history: AdviceLearningHistory,
  snapshot: AdviceLearningSnapshot,
): { history: AdviceLearningHistory; changed: boolean } {
  const strategy = decideAppendStrategy(history, snapshot);
  if (strategy.action === "skip") return { history, changed: false };
  const next: AdviceLearningSnapshot[] = strategy.action === "replace"
    ? [...history.snapshots.slice(0, -1), snapshot]
    : [...history.snapshots, snapshot];
  if (next.length > ADVICE_LEARNING_HISTORY_LIMIT) {
    next.splice(0, next.length - ADVICE_LEARNING_HISTORY_LIMIT);
  }
  return {
    history: { schemaVersion: 1, snapshots: next },
    changed: true,
  };
}

export function emptyAdviceLearningHistory(): AdviceLearningHistory {
  return { schemaVersion: 1, snapshots: [] };
}

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadAdviceLearningHistory(): AdviceLearningHistory {
  const storage = safeStorage();
  if (!storage) return emptyAdviceLearningHistory();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyAdviceLearningHistory();
    const parsed = JSON.parse(raw) as AdviceLearningHistory;
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.snapshots)) {
      return emptyAdviceLearningHistory();
    }
    return {
      schemaVersion: 1,
      snapshots: parsed.snapshots
        .filter((s): s is AdviceLearningSnapshot => !!s && typeof s.ts === "string")
        .slice(-ADVICE_LEARNING_HISTORY_LIMIT),
    };
  } catch {
    return emptyAdviceLearningHistory();
  }
}

export function saveAdviceLearningHistory(history: AdviceLearningHistory): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(history));
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent(ADVICE_LEARNING_HISTORY_CHANGED_EVENT));
    }
  } catch {
    /* storage full or blocked */
  }
}

export function clearAdviceLearningHistory(): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
    if (typeof window !== "undefined" && typeof CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent(ADVICE_LEARNING_HISTORY_CHANGED_EVENT));
    }
  } catch {
    /* ignore */
  }
}

/**
 * Convenience appender that loads, decides, and saves. Returns true when
 * the history was modified — callers use that to log/inform the user.
 */
export function recordAdviceLearningSnapshot(snapshot: AdviceLearningSnapshot): boolean {
  const current = loadAdviceLearningHistory();
  const next = appendSnapshotToHistory(current, snapshot);
  if (!next.changed) return false;
  saveAdviceLearningHistory(next.history);
  return true;
}

/**
 * Auto-snapshot eligibility: returns true iff enough time has elapsed
 * since the last snapshot and there is meaningful data to record.
 */
export function shouldAutoSnapshot(
  history: AdviceLearningHistory,
  scoredPoints: number,
  nowMs: number,
): boolean {
  if (scoredPoints < ADVICE_LEARNING_AUTO_SNAPSHOT_MIN_SCORED) return false;
  const last = history.snapshots[history.snapshots.length - 1];
  if (!last) return true;
  const lastMs = Date.parse(last.ts);
  if (!Number.isFinite(lastMs)) return true;
  return nowMs - lastMs >= ADVICE_LEARNING_AUTO_SNAPSHOT_INTERVAL_MS;
}
