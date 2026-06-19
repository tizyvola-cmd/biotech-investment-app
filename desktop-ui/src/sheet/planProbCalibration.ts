/**
 * Post-hoc P(plan) calibration — misalignment dampener + isotonic shrink (70–79% band).
 *
 * Empirical anchor: decision-sim advice audit showed ~43% hit rate when P(plan) ≥ 70%
 * vs higher success at moderate confidence — classic overconfidence in the high band.
 */
import type { ChartPoint } from "../types";
import {
  auditAssessmentChartHarmony,
  canonicalTodayOffset,
  transformOverlayVsToday,
} from "./assessmentChartHarmony";
import { buildOverlayCurve } from "./sdsCompareOverlay";
import { buildSlopeTrajectory } from "./slopeRecalibCurve";
import { resolveSupernovaTargetRoi } from "./supernovaTargetRoi";
import { daysFromToday } from "./simulationPlanGain";

export type PlanProbMisalignmentId =
  | "harmony_pred_slope"
  | "target_vs_supernova"
  | "precat_vs_verdict"
  | "spot_vs_model"
  | "slope_sign_mismatch";

export type PlanProbMisalignInput = {
  curveGapPct?: number | null;
  planReturnPct?: number | null;
  planTargetProvisional?: boolean;
  supernovaPeakPct?: number | null;
  harmonyAligned?: boolean | null;
  harmonyMaxGapPp?: number | null;
  precatKind?: string | null;
  investVerdict?: string | null;
  slope5d?: number | null;
  pred5Pp?: number | null;
  /** When set, skips inline detection (e.g. from decision-sim loop). */
  misalignmentIds?: PlanProbMisalignmentId[];
};

const TARGET_SN_GAP_PP = 2.5;
const SPOT_MODEL_GAP_PCT = 8;
const SLOPE_PRED_MIN = 0.05;
const PRED5_MIN_PP = 0.3;

const MISALIGN_DAMP: Record<PlanProbMisalignmentId, number> = {
  spot_vs_model: 0.92,
  harmony_pred_slope: 0.94,
  target_vs_supernova: 0.9,
  precat_vs_verdict: 0.88,
  slope_sign_mismatch: 0.93,
};

/** Isotonic anchors: raw P(plan) mid → calibrated mid (monotonic non-decreasing). */
export const PLAN_PROB_ISOTONIC_ANCHORS: readonly [number, number][] = [
  [0, 0],
  [69.999, 69.999],
  [70, 62],
  [79, 57],
  [80, 66],
  [85, 70],
  [90, 73],
  [100, 76],
];

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(100, Math.max(0, n)) * 10) / 10;
}

function interpolateAnchors(rawPct: number, anchors: readonly [number, number][]): number {
  if (rawPct <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i += 1) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (rawPct <= x1) {
      if (x1 === x0) return y1;
      const t = (rawPct - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return anchors[anchors.length - 1][1];
}

export function detectPlanProbMisalignments(input: PlanProbMisalignInput): PlanProbMisalignmentId[] {
  if (input.misalignmentIds?.length) return [...input.misalignmentIds];

  const ids: PlanProbMisalignmentId[] = [];

  if (input.harmonyAligned === false && input.harmonyMaxGapPp != null && Number.isFinite(input.harmonyMaxGapPp)) {
    ids.push("harmony_pred_slope");
  }

  const snPeak = input.supernovaPeakPct;
  if (
    !input.planTargetProvisional &&
    input.planReturnPct != null &&
    snPeak != null &&
    snPeak > 0.05 &&
    Math.abs(input.planReturnPct - snPeak) > TARGET_SN_GAP_PP
  ) {
    ids.push("target_vs_supernova");
  }

  const precatKind = input.precatKind ?? "";
  const verdict = input.investVerdict ?? "";
  const precatBuy = precatKind === "enter" || precatKind === "accumulate";
  const precatSell = precatKind === "avoid" || precatKind === "sell";
  const verdictBuy = verdict === "yes";
  const verdictBlock = verdict === "no";
  if ((precatBuy && verdictBlock) || (precatSell && verdictBuy)) {
    ids.push("precat_vs_verdict");
  }

  if (input.curveGapPct != null && Math.abs(input.curveGapPct) > SPOT_MODEL_GAP_PCT) {
    ids.push("spot_vs_model");
  }

  if (
    input.slope5d != null &&
    input.pred5Pp != null &&
    Math.abs(input.slope5d) > SLOPE_PRED_MIN &&
    Math.abs(input.pred5Pp) > PRED5_MIN_PP &&
    Math.sign(input.slope5d) !== Math.sign(input.pred5Pp)
  ) {
    ids.push("slope_sign_mismatch");
  }

  return ids;
}

export function misalignmentDampFactor(ids: PlanProbMisalignmentId[]): number {
  if (!ids.length) return 1;
  let damp = 1;
  for (const id of ids) {
    damp *= MISALIGN_DAMP[id] ?? 0.95;
  }
  return Math.max(0.72, damp);
}

/** Pull 70–79% raw scores toward observed hit-rate band (~43–55%). */
export function applyPlanProbIsotonicShrink(rawPct: number): number {
  if (rawPct < 70) return clampPct(rawPct);
  return clampPct(interpolateAnchors(rawPct, PLAN_PROB_ISOTONIC_ANCHORS));
}

export type PlanProbPostCalibration = {
  probabilityPct: number;
  rawPct: number;
  misalignmentIds: PlanProbMisalignmentId[];
  dampFactor: number;
  dampenedPct: number;
};

export function applyPlanProbPostCalibration(
  rawPct: number,
  misalignInput: PlanProbMisalignInput,
): PlanProbPostCalibration {
  const misalignmentIds = detectPlanProbMisalignments(misalignInput);
  const dampFactor = misalignmentDampFactor(misalignmentIds);
  const dampenedPct = clampPct(rawPct * dampFactor);
  const probabilityPct = applyPlanProbIsotonicShrink(dampenedPct);
  return {
    probabilityPct,
    rawPct,
    misalignmentIds,
    dampFactor,
    dampenedPct,
  };
}

function harmonyForSimRow(
  row: Record<string, unknown>,
  chartPts: ChartPoint[] | null | undefined,
  ticker: string,
) {
  if (!chartPts?.length) return null;
  const days = daysFromToday(String(row["Completion Date"] ?? ""));
  const todayOff = canonicalTodayOffset(row, days);
  const raw = buildOverlayCurve(ticker, chartPts, row, 0, { extendedPostCd: true });
  if (!raw) return null;
  const overlay = transformOverlayVsToday(raw, todayOff);
  const traj = buildSlopeTrajectory({
    chartPoints: chartPts,
    simRow: row,
    daysToCd: days ?? 30,
  });
  if (!traj?.points.length) return null;
  return auditAssessmentChartHarmony({
    overlayVsToday: overlay,
    slopePoints: traj.points,
    todayOffset: todayOff,
  });
}

/** Build misalignment context from Simulation row + chart bundle (no circular imports). */
export function planProbMisalignContextFromRow(args: {
  ticker: string;
  simRow: Record<string, unknown> | null;
  chartPts: ChartPoint[] | null | undefined;
  planReturnPct: number | null;
  targetProvisional?: boolean;
  precatKind?: string | null;
  investVerdict?: string | null;
  slope5d?: number | null;
  pred5Pp?: number | null;
  curveGapPct?: number | null;
}): PlanProbMisalignInput {
  const harmony =
    args.simRow && args.chartPts?.length
      ? harmonyForSimRow(args.simRow, args.chartPts, args.ticker)
      : null;
  const supernovaPeakPct =
    args.simRow && args.chartPts?.length
      ? resolveSupernovaTargetRoi(args.ticker, args.simRow, args.chartPts)?.returnPct ?? null
      : null;

  return {
    curveGapPct: args.curveGapPct ?? null,
    planReturnPct: args.planReturnPct,
    planTargetProvisional: args.targetProvisional ?? false,
    supernovaPeakPct,
    harmonyAligned: harmony?.aligned ?? null,
    harmonyMaxGapPp: harmony?.maxPredGapPp ?? null,
    precatKind: args.precatKind ?? null,
    investVerdict: args.investVerdict ?? null,
    slope5d: args.slope5d ?? null,
    pred5Pp: args.pred5Pp ?? null,
  };
}
