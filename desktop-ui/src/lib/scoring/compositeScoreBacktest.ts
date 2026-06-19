import type { ScoringZone } from "./zoneWeights";

/** Target metriche per calibrazione pesi v1.0 → v1.1. */
export type CompositeBacktestResult = {
  zone: ScoringZone;
  truePositiveBuy: number;
  falsePositiveBuy: number;
  trueSell: number;
  falseSell: number;
  avgScoreAtBuy: number;
  avgScoreAtSell: number;
};

export const COMPOSITE_BACKTEST_TARGETS = {
  hot: { buyPrecisionMin: 0.65, falseSellMax: 0.15 },
  watch: { buyPrecisionMin: 0.55, falseSellMax: 0.2 },
} as const;

/**
 * Stub — popolare da Decision Sim history / missed-opportunity audit.
 * Non modificare ZONE_WEIGHTS senza output documentato da questa funzione.
 */
export function summarizeCompositeBacktest(
  _rows: unknown[],
): CompositeBacktestResult[] {
  return [];
}
