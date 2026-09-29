import { useMemo, useRef } from "react";
import {
  applyAdviceOutcomeHysteresis,
  calibrationPointsSignature,
} from "../sheet/adviceCalibrationStability";
import type { AdviceCalibrationPoint } from "../sheet/investDecisionSimAdviceCalibration";

/** Sticky good/bad outcomes — stops P(plan) KPI chips flickering on micro 24h ticks. */
export function prepareAdviceCalibrationPoints(
  points: AdviceCalibrationPoint[],
): AdviceCalibrationPoint[] {
  return applyAdviceOutcomeHysteresis(points);
}

/** Hold last rendered points until signature changes (outcome / move / rounded P(plan)). */
export function useStableAdviceCalibrationPoints(
  points: AdviceCalibrationPoint[],
): AdviceCalibrationPoint[] {
  const stableRef = useRef(points);
  const sig = useMemo(() => calibrationPointsSignature(points), [points]);
  const sigRef = useRef(sig);
  if (sigRef.current !== sig) {
    sigRef.current = sig;
    stableRef.current = points;
  }
  return stableRef.current;
}
