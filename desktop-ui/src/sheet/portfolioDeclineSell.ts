/**
 * Criteri «da vendere ora»: posizioni in portafoglio con decrescita sostenuta verso CD.
 * Condiviso tra filtro Simulation «To sell now» e Top 2 SELL nel Decision Lab.
 */
import type { ChartPoint } from "../types";
import { tradeCalibThreshold } from "./investmentTradeCalib";
import { extractCurveInputs } from "./precatCurve";
import { forwardRiseSegmentPeak } from "./simulationSparkline";
import { resolveExpectedGainPlan } from "./simulationPlanGain";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import {
  computeSlopeStability,
  SLOPE_FLAT_THRESHOLD_PP_PER_DAY,
  stabilityVerdict,
  type StabilityVerdict,
} from "./slopeStability";
import { RECOVERY_HOLD_PROB_MIN } from "./recoveryProbability";

export type SustainedDeclineInput = {
  /** ROI target (decisioni). */
  planReturnPct: number | null;
  /** ROI→CD solo se target assente (informativo). */
  planCdReturnPct?: number | null;
  slope5d: number | null;
  slope20d: number | null;
  slope45d: number | null;
  pred5Pp: number | null;
  stabilityVerdict: StabilityVerdict;
  rotationFlag: 0 | 1;
  /** Tratto modello in salita oggi → picco (% vs oggi). */
  forwardRiseReturnPct?: number | null;
  /** Var. giornaliera spot (%). */
  dailyVarPct?: number | null;
};

const FORWARD_RISE_HOLD_MIN_PCT = 0.12;
const DAILY_BOUNCE_MIN_PCT = 0.8;

function readDailyVarPctFromRow(row: Record<string, unknown>): number | null {
  for (const k of Object.keys(row)) {
    const flat = k.replace(/\n/g, " ").toLowerCase();
    if (!flat.includes("var") || !flat.includes("giorn")) continue;
    const v = row[k];
    if (v == null || v === "" || v === "—") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ".").replace(/%/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Curva modello in recupero da oggi — non vendere solo per pendenza storica ↓. */
export function shouldHoldForForwardModelRecovery(
  simRow: Record<string, unknown> | null | undefined,
  chartPoints?: ChartPoint[] | null,
  planReturnPct?: number | null,
): boolean {
  if (!simRow) return false;
  const flatThr = tradeCalibThreshold("dynamic_slope_flat_pp_per_day");
  const peak = forwardRiseSegmentPeak(simRow, chartPoints ?? null, flatThr);
  if (peak != null && peak.returnPct >= FORWARD_RISE_HOLD_MIN_PCT) {
    const plan =
      planReturnPct ??
      resolveExpectedGainPlan(simRow, DEFAULT_PLAN_CAPITAL_EUR, {
        chartPoints: chartPoints ?? null,
      }).targetReturnPct;
    if (plan == null || plan > 0) return true;
  }
  const daily = readDailyVarPctFromRow(simRow);
  if (
    daily != null &&
    daily >= DAILY_BOUNCE_MIN_PCT &&
    peak != null &&
    peak.returnPct > 0
  ) {
    return true;
  }
  return false;
}

function slopeMeaningfullyNegative(s: number | null | undefined): boolean {
  return s != null && Number.isFinite(s) && s < -SLOPE_FLAT_THRESHOLD_PP_PER_DAY;
}

function slopeMeaningfullyPositive(s: number | null | undefined): boolean {
  return s != null && Number.isFinite(s) && s > SLOPE_FLAT_THRESHOLD_PP_PER_DAY;
}

/** Portafoglio con traiettoria in decrescita sostenita verso CD — candidato vendita. */
export function isSustainedDeclineSell(ctx: SustainedDeclineInput): boolean {
  const plan = ctx.planReturnPct;
  const s5 = ctx.slope5d;
  const s20 = ctx.slope20d;
  const s45 = ctx.slope45d;

  if (
    ctx.forwardRiseReturnPct != null &&
    ctx.forwardRiseReturnPct >= FORWARD_RISE_HOLD_MIN_PCT &&
    (plan == null || plan > 0)
  ) {
    return false;
  }

  if (
    ctx.dailyVarPct != null &&
    ctx.dailyVarPct >= DAILY_BOUNCE_MIN_PCT &&
    ctx.forwardRiseReturnPct != null &&
    ctx.forwardRiseReturnPct > 0 &&
    (plan == null || plan > 0)
  ) {
    return false;
  }

  // Outlook positivo + pendenza ↑ → tenere: tempo per monetizzare verso target.
  if (plan != null && plan > 0) {
    if (slopeMeaningfullyPositive(s20) || slopeMeaningfullyPositive(s5)) {
      return false;
    }
  }

  if (ctx.stabilityVerdict === "exit" || ctx.stabilityVerdict === "avoid") {
    if (plan != null && plan > 0 && slopeMeaningfullyPositive(s5)) {
      return false;
    }
    if (
      ctx.forwardRiseReturnPct != null &&
      ctx.forwardRiseReturnPct >= FORWARD_RISE_HOLD_MIN_PCT &&
      (plan == null || plan > 0)
    ) {
      return false;
    }
    return true;
  }

  if (plan != null && plan <= 0) return true;
  if (plan == null && ctx.planCdReturnPct != null && ctx.planCdReturnPct <= 0) {
    return true;
  }

  // Decrescita sostenuta: 5d e 20d entrambe negativamente significative.
  if (slopeMeaningfullyNegative(s5) && slopeMeaningfullyNegative(s20)) {
    return true;
  }

  // Trend medio-termine negativo confermato da 45d o breve periodo + pred negativa.
  if (slopeMeaningfullyNegative(s20)) {
    if (slopeMeaningfullyNegative(s45) || slopeMeaningfullyNegative(s5)) {
      return true;
    }
    if (ctx.pred5Pp != null && ctx.pred5Pp < 0) return true;
  }

  // Rotazione verso il basso — salvo recupero breve ↑ (gestito sopra).
  if (ctx.rotationFlag === 1 && slopeMeaningfullyNegative(s5)) {
    return true;
  }

  return false;
}

/** Curva in salita — tenere fino al target; vendere solo quando la pendenza gira ↓. */
export function isCurveRisingForHold(ctx: SustainedDeclineInput): boolean {
  if (
    ctx.forwardRiseReturnPct != null &&
    ctx.forwardRiseReturnPct >= FORWARD_RISE_HOLD_MIN_PCT &&
    (ctx.planReturnPct == null || ctx.planReturnPct > 0)
  ) {
    return true;
  }
  if (isSustainedDeclineSell(ctx)) return false;
  const plan = ctx.planReturnPct;
  if (plan == null || plan <= 0) return false;
  return slopeMeaningfullyPositive(ctx.slope20d) || slopeMeaningfullyPositive(ctx.slope5d);
}

export function sustainedDeclineFromSimRow(
  simRow: Record<string, unknown>,
  planReturnPct: number | null,
  pred5Pp: number | null,
  planCdReturnPct?: number | null,
  chartPoints?: ChartPoint[] | null,
): boolean {
  if (shouldHoldForForwardModelRecovery(simRow, chartPoints, planReturnPct)) {
    return false;
  }
  const { slope5d, slope20d, slope45d } = extractCurveInputs(simRow);
  const stab = computeSlopeStability(slope5d, slope20d, slope45d);
  const effSlope =
    slope20d != null && Number.isFinite(slope20d) ? slope20d : slope5d ?? null;
  const verdict = stabilityVerdict(stab, effSlope);
  const flatThr = tradeCalibThreshold("dynamic_slope_flat_pp_per_day");
  const forwardRiseReturnPct =
    forwardRiseSegmentPeak(simRow, chartPoints ?? null, flatThr)?.returnPct ?? null;
  const dailyVarPct = readDailyVarPctFromRow(simRow);
  return isSustainedDeclineSell({
    planReturnPct,
    planCdReturnPct: planCdReturnPct ?? null,
    slope5d,
    slope20d,
    slope45d,
    pred5Pp,
    stabilityVerdict: verdict,
    rotationFlag: stab.rotationFlag,
    forwardRiseReturnPct,
    dailyVarPct,
  });
}

export function declineInputFromSignalLike(s: {
  planReturnPct?: number | null;
  planCdReturnPct?: number | null;
  pred5?: number | null;
  slope5d?: number | null;
  slope20d?: number | null;
  slope45d?: number | null;
  stabilityVerdict?: StabilityVerdict;
  slopeRotationFlag?: 0 | 1;
  simRow?: Record<string, unknown>;
  chartPoints?: ChartPoint[] | null;
}): SustainedDeclineInput {
  let slope5d = s.slope5d ?? null;
  let slope20d = s.slope20d ?? null;
  let slope45d = s.slope45d ?? null;

  if (s.simRow) {
    const curves = extractCurveInputs(s.simRow);
    if (slope5d == null) slope5d = curves.slope5d;
    if (slope20d == null) slope20d = curves.slope20d;
    if (slope45d == null) slope45d = curves.slope45d;
  }

  let verdict = s.stabilityVerdict ?? "none";
  let rotationFlag: 0 | 1 = s.slopeRotationFlag ?? 0;

  if (s.simRow) {
    const stab = computeSlopeStability(slope5d, slope20d, slope45d);
    if (!s.stabilityVerdict) {
      const effSlope =
        slope20d != null && Number.isFinite(slope20d) ? slope20d : slope5d ?? null;
      verdict = stabilityVerdict(stab, effSlope);
    }
    if (s.slopeRotationFlag == null) {
      rotationFlag = stab.rotationFlag;
    }
  }

  let forwardRiseReturnPct: number | null = null;
  let dailyVarPct: number | null = null;
  if (s.simRow) {
    dailyVarPct = readDailyVarPctFromRow(s.simRow);
    const flatThr = tradeCalibThreshold("dynamic_slope_flat_pp_per_day");
    forwardRiseReturnPct =
      forwardRiseSegmentPeak(s.simRow, s.chartPoints ?? null, flatThr)?.returnPct ?? null;
  }

  return {
    planReturnPct: s.planReturnPct ?? null,
    planCdReturnPct: s.planCdReturnPct ?? null,
    slope5d,
    slope20d,
    slope45d,
    pred5Pp: s.pred5 ?? null,
    stabilityVerdict: verdict,
    rotationFlag,
    forwardRiseReturnPct,
    dailyVarPct,
  };
}

export function isSustainedDeclineSignal(s: {
  planReturnPct?: number | null;
  pred5?: number | null;
  slope20d?: number | null;
  stabilityVerdict?: StabilityVerdict;
  slopeRotationFlag?: 0 | 1;
  simRow?: Record<string, unknown>;
  chartPoints?: ChartPoint[] | null;
}): boolean {
  if (
    s.simRow &&
    shouldHoldForForwardModelRecovery(s.simRow, s.chartPoints, s.planReturnPct)
  ) {
    return false;
  }
  return isSustainedDeclineSell(declineInputFromSignalLike(s));
}

/** Block SELL when spot rallies — symmetric to sim-loop BUY momentum gate. */
export const MOMENTUM_24H_SELL_HOLD_MIN = 0.5;

export type PortfolioExitRecoveryGuardInput = {
  curveRisingHold?: boolean;
  investVerdict?: string | null;
  recoveryProbabilityPct?: number | null;
  recoveryCoversLoss?: boolean | null;
  pnlPct24h?: number | null;
  planReturnPct?: number | null;
  curvePeakReturnPct?: number | null;
  stabilityVerdict?: StabilityVerdict;
};

/** Var. 24h above this on a positive plan → not clearly falling; defer paper exit. */
export const AMBIGUOUS_EXIT_MOMENTUM_FLOOR_PCT = -0.5;

/**
 * Recovery guards before paper/real portfolio exit — shared by sim loop,
 * synth bridge, and dashboard sell chips.
 */
export function portfolioExitRecoveryGuardsActive(
  input: PortfolioExitRecoveryGuardInput | null | undefined,
): boolean {
  if (!input) return false;
  if (input.curveRisingHold) return true;
  if (input.investVerdict === "wait") return true;

  const mom24 = input.pnlPct24h;
  if (mom24 != null && Number.isFinite(mom24) && mom24 >= MOMENTUM_24H_SELL_HOLD_MIN) {
    return true;
  }

  const plan = input.planReturnPct;
  const peak = input.curvePeakReturnPct;
  if (
    peak != null &&
    Number.isFinite(peak) &&
    peak >= FORWARD_RISE_HOLD_MIN_PCT &&
    (plan == null || plan > 0)
  ) {
    return true;
  }
  if (
    mom24 != null &&
    Number.isFinite(mom24) &&
    mom24 >= DAILY_BOUNCE_MIN_PCT &&
    peak != null &&
    peak > 0 &&
    (plan == null || plan > 0)
  ) {
    return true;
  }

  if (
    input.recoveryProbabilityPct != null &&
    input.recoveryProbabilityPct >= RECOVERY_HOLD_PROB_MIN &&
    input.recoveryCoversLoss !== false
  ) {
    return true;
  }

  // 24h not clearly ↓ on a positive plan — avoid premature exit before bounce (learning loop pattern).
  const stab = input.stabilityVerdict;
  if (
    mom24 != null &&
    Number.isFinite(mom24) &&
    mom24 > AMBIGUOUS_EXIT_MOMENTUM_FLOOR_PCT &&
    mom24 < MOMENTUM_24H_SELL_HOLD_MIN &&
    (plan == null || plan > 0) &&
    stab !== "exit" &&
    stab !== "avoid"
  ) {
    return true;
  }

  return false;
}
