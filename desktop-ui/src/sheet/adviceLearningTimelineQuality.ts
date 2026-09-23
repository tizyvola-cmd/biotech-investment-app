/**
 * Sample-size / staleness gates for the advice learning timeline UI.
 * Tracks BUY and SELL operative success only.
 */
import type { AdviceLearningSnapshot } from "./adviceLearningHistory";

/** Minimum scored BUY recs at latest checkpoint to trust Δ BUY. */
export const ADVICE_TIMELINE_MIN_BUY_FOR_TREND = 5;
/** Minimum scored SELL recs at latest checkpoint to trust Δ SELL. */
export const ADVICE_TIMELINE_MIN_SELL_FOR_TREND = 5;
/** Warn when the latest checkpoint is older than this many calendar days. */
export const ADVICE_TIMELINE_STALE_CHECKPOINT_DAYS = 7;

export type AdviceTimelineQuality = {
  latest: AdviceLearningSnapshot | null;
  daysSinceLatest: number | null;
  staleCheckpoint: boolean;
  buyLowSample: boolean;
  sellLowSample: boolean;
  showBuyTrend: boolean;
  showSellTrend: boolean;
  showLowSampleBanner: boolean;
};

function daysSinceIso(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso?.trim()) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / (24 * 60 * 60 * 1000)));
}

export function assessAdviceTimelineQuality(
  snaps: AdviceLearningSnapshot[],
  nowMs: number = Date.now(),
): AdviceTimelineQuality {
  const latest = snaps[snaps.length - 1] ?? null;
  const daysSinceLatest = latest ? daysSinceIso(latest.ts, nowMs) : null;
  const staleCheckpoint =
    daysSinceLatest != null && daysSinceLatest > ADVICE_TIMELINE_STALE_CHECKPOINT_DAYS;

  const buyLowSample =
    latest == null || (latest.buyScored ?? 0) < ADVICE_TIMELINE_MIN_BUY_FOR_TREND;
  const sellLowSample =
    latest == null || (latest.sellScored ?? 0) < ADVICE_TIMELINE_MIN_SELL_FOR_TREND;

  const showLowSampleBanner =
    snaps.length > 0 && (buyLowSample || sellLowSample || staleCheckpoint);

  return {
    latest,
    daysSinceLatest,
    staleCheckpoint,
    buyLowSample,
    sellLowSample,
    showBuyTrend: !buyLowSample,
    showSellTrend: !sellLowSample,
    showLowSampleBanner,
  };
}
