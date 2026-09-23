import { P_ENTRY_MIN } from "./recoveryProbability";
import {
  STUDY_EVIDENCE_EIS_MIN,
  STUDY_EVIDENCE_SDS_MIN,
} from "./investDecisionSimLoop";

export type SimLoopScoreId =
  | "pplan"
  | "sds"
  | "rescue"
  | "regulatory"
  | "eis"
  | "mcs";

export type RDownStrength = "strong" | "weak" | "noise" | "unmeasured" | "wrong_sign";

export type SimLoopScoreUsageInput = {
  id: SimLoopScoreId;
  rDown: number | null;
  nDown: number;
  /** Win rate in high-score bucket — BUY calibration KPI only. */
  buyWinPct: number | null;
  buyWinThreshold: number | null;
  buyWinN: number | null;
  unmeasured?: boolean;
};

export type SimLoopScoreUsageRow = SimLoopScoreUsageInput & {
  strength: RDownStrength;
  invertedScale: boolean;
  trimActionable: boolean;
};

/** Classify measured r↓ for downside TRIM/SELL rules (exploratory at n≈26). */
export function classifyRDownStrength(
  rDown: number | null,
  nDown: number,
  invertedScale: boolean,
  opts?: { minN?: number; forceUnmeasured?: boolean },
): RDownStrength {
  const minN = opts?.minN ?? 3;
  if (opts?.forceUnmeasured || nDown < minN || rDown == null) return "unmeasured";
  const abs = Math.abs(rDown);
  const goodSign = invertedScale ? rDown < 0 : rDown > 0;
  if (!goodSign && abs >= 0.1) return "wrong_sign";
  if (abs >= 0.3) return "strong";
  if (abs >= 0.1) return "weak";
  return "noise";
}

const INVERTED: Record<SimLoopScoreId, boolean> = {
  pplan: false,
  sds: false,
  rescue: false,
  regulatory: true,
  eis: false,
  mcs: true,
};

/** Reference thresholds wired in sim loop today (documentation only — no weight change). */
export const SIM_LOOP_USAGE_REFS = {
  pEntryMin: P_ENTRY_MIN,
  sdsStudyMin: STUDY_EVIDENCE_SDS_MIN,
  eisStudyMin: STUDY_EVIDENCE_EIS_MIN,
} as const;

export function buildSimLoopScoreUsageRows(
  inputs: SimLoopScoreUsageInput[],
): SimLoopScoreUsageRow[] {
  return inputs.map((row) => {
    const invertedScale = INVERTED[row.id];
    const strength = classifyRDownStrength(row.rDown, row.nDown, invertedScale, {
      forceUnmeasured: row.unmeasured,
    });
    const trimActionable =
      strength === "strong" || (strength === "weak" && row.id === "sds");
    return { ...row, strength, invertedScale, trimActionable };
  });
}

export function formatRDownDisplay(rDown: number | null): string {
  if (rDown == null) return "—";
  return `${rDown >= 0 ? "+" : ""}${rDown.toFixed(2)}`;
}
