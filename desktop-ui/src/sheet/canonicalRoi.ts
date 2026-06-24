/**
 * ROI canonico per decisioni UI: **target** (fine tratto in salita / cambio pendenza).
 * ROI verso CD resta disponibile solo come contesto informativo.
 */
import {
  DEFAULT_PLAN_CAPITAL_EUR,
  expectedGainEurFromPct,
} from "./expectedRoiDisplay";
import type { ExpectedGainPlan } from "./simulationPlanGain";
import { roiPerDayFromPlan } from "./topOppQuality";

export type PlanRoiBundle = {
  /** ROI al target — ranking, colori, Top 2, filtri. */
  planReturnPct: number | null;
  planDays: number | null;
  planGainEur: number | null;
  /** ROI oggi → CD (informativo). */
  planCdReturnPct: number | null;
  planCdDays: number | null;
  planCdGainEur: number | null;
  /** Alias espliciti (stesso valore di planReturnPct / planDays). */
  planTargetReturnPct: number | null;
  planTargetDays: number | null;
  planTargetHighPct: number | null;
};

export function primaryReturnPctFromGainPlan(
  plan: Pick<ExpectedGainPlan, "targetReturnPct">,
): number | null {
  const v = plan.targetReturnPct;
  return v != null && Number.isFinite(v) ? v : null;
}

export function cdReturnPctFromGainPlan(
  plan: Pick<ExpectedGainPlan, "expectedReturnPct">,
): number | null {
  const v = plan.expectedReturnPct;
  return v != null && Number.isFinite(v) ? v : null;
}

export function primaryDaysFromGainPlan(
  plan: Pick<ExpectedGainPlan, "targetReturnPct" | "daysToTarget" | "daysToCd">,
): number | null {
  if (plan.targetReturnPct == null) return null;
  const d = plan.daysToTarget ?? plan.daysToCd;
  return d != null && Number.isFinite(d) ? d : null;
}

export function roiPerDayPrimaryFromGainPlan(plan: ExpectedGainPlan): number {
  return roiPerDayFromPlan(
    primaryReturnPctFromGainPlan(plan),
    primaryDaysFromGainPlan(plan),
  );
}

/** Campi piano per SignalRow / Top2 / pipeline — target = primario. */
export function planRoiBundleFromGainPlan(
  plan: ExpectedGainPlan,
  capitalEur: number,
  daysFallback?: number | null,
): PlanRoiBundle {
  const cap = capitalEur > 0 ? capitalEur : DEFAULT_PLAN_CAPITAL_EUR;
  const primary = primaryReturnPctFromGainPlan(plan);
  const cd = cdReturnPctFromGainPlan(plan);
  const primaryDays = primaryDaysFromGainPlan(plan) ?? daysFallback ?? plan.daysToCd;
  const cdDays = plan.daysToCd ?? daysFallback ?? null;
  return {
    planReturnPct: primary,
    planDays: primaryDays,
    planGainEur: expectedGainEurFromPct(primary, cap),
    planCdReturnPct: cd,
    planCdDays: cdDays,
    planCdGainEur: expectedGainEurFromPct(cd, cap),
    planTargetReturnPct: primary,
    planTargetDays: plan.daysToTarget,
    planTargetHighPct: plan.targetHighPct,
  };
}

/** Legge ROI primario da oggetti signal-like (dopo migrazione campi). */
export function resolvePrimaryReturnPct(s: {
  planReturnPct?: number | null;
  planTargetReturnPct?: number | null;
  targetReturnPct?: number | null;
}): number | null {
  const v = s.planTargetReturnPct ?? s.planReturnPct ?? s.targetReturnPct;
  return v != null && Number.isFinite(v) ? v : null;
}

export function resolvePrimaryDays(s: {
  planDays?: number | null;
  planTargetDays?: number | null;
  days?: number | null;
}): number | null {
  const v = s.planTargetDays ?? s.planDays ?? s.days;
  return v != null && Number.isFinite(v) ? v : null;
}
