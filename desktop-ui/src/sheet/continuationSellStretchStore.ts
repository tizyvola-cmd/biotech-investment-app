/**
 * Live stretch thresholds for continuation soft-SELL (edge / g10 gate).
 * Separated so continuationScore can read without importing the full learning loop.
 */

export const CONT_SELL_LEARNING_STRETCH_KEY = "supernova.contSellLearning.stretch.v1";
export const CONT_SELL_LEARNING_CHANGED_EVENT = "supernova-cont-sell-learning-changed";

export const CONT_SELL_EDGE_MIN_MAX = 8;
/** Keep in sync with P_CONT_SELL_MIN_G10 in continuationScore.ts */
export const CONT_SELL_STRETCH_BASE_G10 = 5;

export type ContSellStretchThresholds = {
  edgeMin: number;
  edgeStretch: number;
  g10MinOffset: number;
};

export type ContSellStretchProposal = {
  from: ContSellStretchThresholds;
  to: ContSellStretchThresholds;
  reason: string;
  reasonIt: string;
  evidenceN: number;
  hitRate: number;
  computedAt: string;
};

export type ContSellStretchState = {
  version: 1;
  applied: ContSellStretchThresholds;
  pending: ContSellStretchProposal | null;
  lastEvaluatedAt: string | null;
  lastScoredN: number;
};

export const CONT_SELL_STRETCH_BASELINE: ContSellStretchThresholds = {
  edgeMin: 0,
  edgeStretch: 1,
  g10MinOffset: 0,
};

export function clipContSellEdgeMin(v: number): number {
  return Math.max(0, Math.min(CONT_SELL_EDGE_MIN_MAX, Math.round(v * 10) / 10));
}

export function clipContSellEdgeStretch(v: number): number {
  return Math.max(0.5, Math.min(1.5, Math.round(v * 100) / 100));
}

export function defaultContSellStretchState(): ContSellStretchState {
  return {
    version: 1,
    applied: { ...CONT_SELL_STRETCH_BASELINE },
    pending: null,
    lastEvaluatedAt: null,
    lastScoredN: 0,
  };
}

function ls(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* ignore */
  }
  return null;
}

export function emitContSellLearningChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CONT_SELL_LEARNING_CHANGED_EVENT));
}

export function loadContSellStretchState(): ContSellStretchState {
  const store = ls();
  if (!store) return defaultContSellStretchState();
  try {
    const raw = store.getItem(CONT_SELL_LEARNING_STRETCH_KEY);
    if (!raw) return defaultContSellStretchState();
    const j = JSON.parse(raw) as Partial<ContSellStretchState>;
    if (!j || j.version !== 1 || !j.applied) return defaultContSellStretchState();
    return {
      version: 1,
      applied: {
        edgeMin: clipContSellEdgeMin(Number(j.applied.edgeMin) || 0),
        edgeStretch: clipContSellEdgeStretch(Number(j.applied.edgeStretch) || 1),
        g10MinOffset: Number.isFinite(Number(j.applied.g10MinOffset))
          ? Number(j.applied.g10MinOffset)
          : 0,
      },
      pending: j.pending ?? null,
      lastEvaluatedAt: j.lastEvaluatedAt ?? null,
      lastScoredN: j.lastScoredN ?? 0,
    };
  } catch {
    return defaultContSellStretchState();
  }
}

export function saveContSellStretchState(state: ContSellStretchState): void {
  const store = ls();
  if (!store) return;
  store.setItem(CONT_SELL_LEARNING_STRETCH_KEY, JSON.stringify(state));
}

export function resolveContSellStretchThresholds(): ContSellStretchThresholds {
  return loadContSellStretchState().applied;
}

export function contSellPassesStretch(
  opts: { g10: number | null; edge: number | null },
  thr: ContSellStretchThresholds = resolveContSellStretchThresholds(),
  baseG10: number = CONT_SELL_STRETCH_BASE_G10,
): boolean {
  if (opts.g10 == null || !Number.isFinite(opts.g10)) return false;
  if (opts.g10 < baseG10 + thr.g10MinOffset) return false;
  if (opts.edge == null || !Number.isFinite(opts.edge)) return false;
  return opts.edge * thr.edgeStretch > thr.edgeMin;
}
