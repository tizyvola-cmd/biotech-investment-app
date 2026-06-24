import { useEffect } from "react";
import {
  applyAdviceFeedbackAutoIfDue,
  loadAdviceFeedback,
  type AdviceFeedback,
} from "../sheet/adviceFeedback";
import {
  buildAdviceLearningSnapshot,
  recordAdviceLearningSnapshot,
} from "../sheet/adviceLearningHistory";
import type { AdviceCalibrationSummary } from "../sheet/investDecisionSimAdviceCalibration";
import type { AdviceComplementKpis } from "../sheet/adviceComplementKpis";
import type { UnifiedAdviceSuccess } from "../sheet/unifiedAdviceSuccess";

/**
 * Persists advice learnings when calibration data crosses thresholds — no manual Apply click.
 */
export function useAdviceFeedbackAutoApply(args: {
  pendingFeedback: AdviceFeedback;
  summary: AdviceCalibrationSummary;
  unifiedAdviceSuccess?: UnifiedAdviceSuccess | null;
  adviceComplement?: AdviceComplementKpis | null;
}): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const result = applyAdviceFeedbackAutoIfDue(args.pendingFeedback, loadAdviceFeedback());
    if (!result.applied) return;

    recordAdviceLearningSnapshot(
      buildAdviceLearningSnapshot({
        summary: args.summary,
        feedback: args.pendingFeedback,
        unifiedAdviceSuccessPct: args.unifiedAdviceSuccess?.headlinePct ?? null,
        capturePct: args.adviceComplement?.capture.capturePct ?? null,
        paperBookReturnPct: args.adviceComplement?.paperReturn.returnPct ?? null,
        closedPnlWinRatePct: args.adviceComplement?.closedPnl.winRatePct ?? null,
        manual: false,
      }),
    );
  }, [
    args.pendingFeedback,
    args.summary,
    args.unifiedAdviceSuccess?.headlinePct,
    args.adviceComplement?.capture.capturePct,
    args.adviceComplement?.paperReturn.returnPct,
    args.adviceComplement?.closedPnl.winRatePct,
  ]);
}
