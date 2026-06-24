import { useMemo } from "react";
import type { SheetTable } from "../types";
import type { PaperPosition, TickerSimEvaluation } from "../sheet/investDecisionSimLoop";
import {
  buildLivePositionSnapshot,
  type LivePositionSnapshot,
} from "../sheet/livePositionSnapshot";

/**
 * Memoized wrapper around `buildLivePositionSnapshot`.
 * Returns a stable `LivePositionSnapshot` that all consumers can share.
 */
export function useLivePositionSnapshot(
  simTable: SheetTable | null | undefined,
  paperPortfolio: PaperPosition[],
  latestEvaluations: TickerSimEvaluation[],
): LivePositionSnapshot {
  return useMemo(
    () => buildLivePositionSnapshot(simTable, paperPortfolio, latestEvaluations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [simTable, paperPortfolio, latestEvaluations],
  );
}
