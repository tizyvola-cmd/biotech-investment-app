/**
 * Collect Manual EIS attributions and reintroduce them as mild priors on scores.
 * Pure aggregation over local drafts — no network, shrinkage-style pseudo-counts.
 */

import {
  hasManualMoveAttribution,
  type ManualCauseClass,
  type ManualEventSubtype,
  type ManualMoveAttribution,
} from "./manualMoveAttribution";

export type ManualAttributionMemoryBucket = {
  key: string;
  n: number;
  meanAbsMovePct: number;
  meanEisScore: number;
  causeClass: ManualCauseClass | null;
  eventSubtype: ManualEventSubtype | null;
};

export type ManualAttributionMemory = {
  updatedAt: string;
  totalAttributed: number;
  byCause: Record<string, ManualAttributionMemoryBucket>;
  bySubtype: Record<string, ManualAttributionMemoryBucket>;
  byLearningTag: Record<string, ManualAttributionMemoryBucket>;
  byTicker: Record<string, { n: number; lastCause: ManualCauseClass | null }>;
};

export type ManualAttributionMemorySource = {
  ticker: string;
  priceDropPct?: number | null;
  attribution?: ManualMoveAttribution | null;
  /** Pre-computed EIS score at collection time (optional). */
  eisScore?: number | null;
};

const PSEUDO_K = 6;
const MIN_N_FOR_PRIOR = 3;

function bucketKey(cause: string | null | undefined, subtype?: string | null): string {
  return `${cause ?? "unknown"}|${subtype ?? "any"}`;
}

function pushMean(prevMean: number, prevN: number, value: number): number {
  return (prevMean * prevN + value) / (prevN + 1);
}

function upsertBucket(
  map: Record<string, ManualAttributionMemoryBucket>,
  key: string,
  patch: {
    absMove: number | null;
    eis: number | null;
    causeClass: ManualCauseClass | null;
    eventSubtype: ManualEventSubtype | null;
  },
): void {
  const cur = map[key] ?? {
    key,
    n: 0,
    meanAbsMovePct: 0,
    meanEisScore: 0,
    causeClass: patch.causeClass,
    eventSubtype: patch.eventSubtype,
  };
  const n0 = cur.n;
  if (patch.absMove != null && Number.isFinite(patch.absMove)) {
    cur.meanAbsMovePct = pushMean(cur.meanAbsMovePct, n0, Math.abs(patch.absMove));
  }
  if (patch.eis != null && Number.isFinite(patch.eis)) {
    cur.meanEisScore = pushMean(cur.meanEisScore, n0, patch.eis);
  }
  cur.n = n0 + 1;
  cur.causeClass = patch.causeClass ?? cur.causeClass;
  cur.eventSubtype = patch.eventSubtype ?? cur.eventSubtype;
  map[key] = cur;
}

/** Rebuild memory snapshot from saved manual drafts (+ optional live EIS). */
export function buildManualAttributionMemory(
  sources: ManualAttributionMemorySource[],
): ManualAttributionMemory {
  const byCause: Record<string, ManualAttributionMemoryBucket> = {};
  const bySubtype: Record<string, ManualAttributionMemoryBucket> = {};
  const byLearningTag: Record<string, ManualAttributionMemoryBucket> = {};
  const byTicker: Record<string, { n: number; lastCause: ManualCauseClass | null }> = {};
  let totalAttributed = 0;

  for (const src of sources) {
    const attr = src.attribution;
    if (!hasManualMoveAttribution(attr)) continue;
    totalAttributed += 1;
    const absMove =
      src.priceDropPct != null && Number.isFinite(src.priceDropPct)
        ? Math.abs(src.priceDropPct)
        : null;
    const eis = src.eisScore != null && Number.isFinite(src.eisScore) ? src.eisScore : null;
    const cause = attr?.causeClass ?? null;
    const subtype = attr?.eventSubtype ?? null;

    if (cause) {
      upsertBucket(byCause, cause, {
        absMove,
        eis,
        causeClass: cause,
        eventSubtype: subtype,
      });
    }
    if (subtype) {
      upsertBucket(bySubtype, subtype, {
        absMove,
        eis,
        causeClass: cause,
        eventSubtype: subtype,
      });
    }
    if (attr?.learningTag) {
      upsertBucket(byLearningTag, attr.learningTag, {
        absMove,
        eis,
        causeClass: cause,
        eventSubtype: subtype,
      });
    }

    const tk = src.ticker.trim().toUpperCase();
    if (tk) {
      const prev = byTicker[tk] ?? { n: 0, lastCause: null };
      byTicker[tk] = { n: prev.n + 1, lastCause: cause ?? prev.lastCause };
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    totalAttributed,
    byCause,
    bySubtype,
    byLearningTag,
    byTicker,
  };
}

/**
 * Mild prior on EIS magnitude from historical same-cause samples.
 * Returns ~0.85…1.15 (1 = no effect). Inactive until MIN_N_FOR_PRIOR.
 */
export function memoryEisMultiplier(
  memory: ManualAttributionMemory | null | undefined,
  attr: ManualMoveAttribution | null | undefined,
  liveScore: number,
): number {
  if (!memory || !attr?.causeClass) return 1;
  const bucket =
    (attr.learningTag ? memory.byLearningTag[attr.learningTag] : null) ??
    memory.byCause[attr.causeClass] ??
    null;
  if (!bucket || bucket.n < MIN_N_FOR_PRIOR) return 1;
  if (!Number.isFinite(liveScore) || Math.abs(liveScore) < 0.05) return 1;
  if (!Number.isFinite(bucket.meanEisScore) || Math.abs(bucket.meanEisScore) < 0.05) return 1;

  // Shrink live |score| toward historical mean |score| for this cause.
  const liveAbs = Math.abs(liveScore);
  const histAbs = Math.abs(bucket.meanEisScore);
  const n = bucket.n;
  const blended = (n * histAbs + PSEUDO_K * liveAbs) / (n + PSEUDO_K);
  const ratio = blended / liveAbs;
  return Math.max(0.85, Math.min(1.15, ratio));
}

/** Latest structured attribution for a ticker (most recent draft with tags). */
export function latestTickerAttribution(
  sources: Array<{ ticker: string; createdAt?: string; attribution?: ManualMoveAttribution | null }>,
  ticker: string,
): ManualMoveAttribution | null {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;
  const rows = sources
    .filter((s) => s.ticker.trim().toUpperCase() === tk && hasManualMoveAttribution(s.attribution))
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  return rows[0]?.attribution ?? null;
}

export function memoryBucketKey(
  cause: ManualCauseClass | null | undefined,
  subtype?: ManualEventSubtype | null,
): string {
  return bucketKey(cause, subtype);
}
