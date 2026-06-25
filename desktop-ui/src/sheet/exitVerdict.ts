// ── "When to exit" verdict ──────────────────────────────────────────────────
//
// Combines slope_20d + P&L + pre-CD gain plan (same engine as Decision Lab cards).
// EXIT on negative slope only when there is no active pre-CD upside thesis.
//
//   EXIT  → slope ≤ −0.3 pp/d AND P&L < +10%, unless an active pre-CD thesis
//   WATCH → flat / uncertain slope
//   HOLD  → positive slope, profit ≥ +10%, or pre-CD with material upside
//
// Extracted from InvestmentSimOutcomesPanel so the unified portfolio table
// (InvestmentSimulationView) can show the same verdict.

import { resolveExpectedGainPlan } from "./simulationPlanGain";
import { buildSlopeAwareTargetStop } from "./dynamicTargetStop";
import { classifyRegime, extractCurveInputs } from "./precatCurve";
import { computeSlopeStability, stabilityVerdict } from "./slopeStability";
import { SIM_MONITOR_HORIZON_DAYS } from "./cdHorizons";

export type ExitVerdict = "hold" | "watch" | "exit" | "n/d";

export type ExitVerdictContext = {
  daysToCd?: number | null;
  daysToTarget?: number | null;
  targetReturnPct?: number | null;
  /** ROI→CD — informational only when target is absent. */
  expectedReturnPct?: number | null;
  sellTriggerPct?: number | null;
  /** BTR + CD ≤15d → do not force a pre-CD hold */
  btrLateRisk?: boolean;
  rotationFlag?: 0 | 1;
};

const PRECD_MIN_EXPECTED_PCT = 8;
const PRECD_MAX_DRAWDOWN_PCT = -10;
const PRECD_MIN_DAYS_TO_CD = 6;

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtSlope(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} pp/d`;
}

export function buildExitVerdictContext(
  simRow: Record<string, unknown> | undefined,
  capital: number,
): ExitVerdictContext {
  if (!simRow || capital <= 0) return {};
  const gainPlan = resolveExpectedGainPlan(simRow, capital);
  const { slope5d, slope20d, slope45d, runUp30d } = extractCurveInputs(simRow);
  const stab = computeSlopeStability(slope5d, slope20d, slope45d);
  const effSlope =
    slope20d != null && Number.isFinite(slope20d) ? slope20d : slope5d ?? null;
  const dynamic = buildSlopeAwareTargetStop({
    slope5d,
    slope20d,
    slope45d,
    runUp30d,
    days: gainPlan.daysToCd,
    isLong: true,
    stabilityVerdict: stabilityVerdict(stab, effSlope),
    rotationFlag: stab.rotationFlag,
  });
  const regime = classifyRegime(runUp30d);
  const days = gainPlan.daysToCd;
  return {
    daysToCd: days,
    daysToTarget: gainPlan.daysToTarget,
    targetReturnPct: gainPlan.targetReturnPct,
    expectedReturnPct: gainPlan.expectedReturnPct,
    sellTriggerPct: dynamic?.sellTriggerPct ?? null,
    btrLateRisk: regime === "btr" && days != null && days <= 15,
    rotationFlag: stab.rotationFlag,
  };
}

function preCdHoldThesis(ctx: ExitVerdictContext, pnlPct: number | null): boolean {
  const days = ctx.daysToTarget ?? ctx.daysToCd;
  const exp = ctx.targetReturnPct ?? ctx.expectedReturnPct;
  if (days == null || days < PRECD_MIN_DAYS_TO_CD || days > SIM_MONITOR_HORIZON_DAYS) {
    return false;
  }
  if (exp == null || exp < PRECD_MIN_EXPECTED_PCT) return false;
  if (ctx.btrLateRisk) return false;
  if (ctx.rotationFlag === 1) return false;
  if (pnlPct != null && pnlPct <= PRECD_MAX_DRAWDOWN_PCT) return false;
  if (
    ctx.sellTriggerPct != null &&
    pnlPct != null &&
    pnlPct < ctx.sellTriggerPct
  ) {
    return false;
  }
  return true;
}

export function exitVerdict(
  slope20d: number | null,
  pnlPct: number | null,
  ctx: ExitVerdictContext = {},
): { verdict: ExitVerdict; reason: string } {
  if (slope20d == null) {
    if (pnlPct == null) return { verdict: "n/d", reason: "Slope data unavailable" };
    return { verdict: "n/d", reason: "Curve slope unavailable (register T-60..T-1)" };
  }
  // Dynamic stop / deep loss — always exit
  if (
    ctx.sellTriggerPct != null &&
    pnlPct != null &&
    pnlPct < ctx.sellTriggerPct
  ) {
    return {
      verdict: "exit",
      reason: `P&L ${fmtPct(pnlPct)} below dynamic stop (${ctx.sellTriggerPct.toFixed(1)}%)`,
    };
  }
  if (pnlPct != null && pnlPct <= PRECD_MAX_DRAWDOWN_PCT) {
    return {
      verdict: "exit",
      reason: `P&L ${fmtPct(pnlPct)} beyond max drawdown (${PRECD_MAX_DRAWDOWN_PCT}%)`,
    };
  }

  // Target reached (within 1% tolerance) — EXIT to capture gain
  const targetReached =
    ctx.targetReturnPct != null &&
    pnlPct != null &&
    pnlPct >= (ctx.targetReturnPct - 1);

  if (targetReached) {
    return {
      verdict: "exit",
      reason: `Target ${fmtPct(ctx.targetReturnPct!)} reached (P&L ${fmtPct(pnlPct!)}) — capture gain`,
    };
  }

  // Strong curve reversal with rotation flag — EXIT even with profit
  if (ctx.rotationFlag && slope20d <= -0.2 && pnlPct != null && pnlPct < 8) {
    return {
      verdict: "exit",
      reason: `Curve rotation + negative slope ${fmtSlope(slope20d)} — exit before erosion`,
    };
  }

  // Consolidated profit: let it run only if slope still favorable
  if (pnlPct != null && pnlPct >= 10) {
    if (slope20d <= -0.4) {
      return {
        verdict: "exit",
        reason: `P&L +${pnlPct.toFixed(1)}% but strong reversal ${fmtSlope(slope20d)} — secure profit`,
      };
    }
    return {
      verdict: "hold",
      reason: `P&L +${pnlPct.toFixed(1)}% consolidated — let it run, manage with trailing stop`,
    };
  }

  // Target thesis: upside toward end of rise segment — do not exit on slope alone
  if (preCdHoldThesis(ctx, pnlPct)) {
    const exp = (ctx.targetReturnPct ?? ctx.expectedReturnPct)!;
    const days = (ctx.daysToTarget ?? ctx.daysToCd)!;

    // If the curve reversed STRONGLY even with a pre-CD thesis → EXIT
    if (slope20d <= -0.5 || (ctx.rotationFlag && slope20d <= -0.3)) {
      return {
        verdict: "exit",
        reason: `Strong curve reversal ${fmtSlope(slope20d)} — exit despite pre-CD thesis`,
      };
    }

    if (slope20d <= -0.3) {
      return {
        verdict: "watch",
        reason: `Pre-CD thesis (+${exp.toFixed(0)}% expected in ${days}d): temporary drawdown (slope ${fmtSlope(slope20d)}) — monitor closely`,
      };
    }
    if (slope20d < 0.1) {
      return {
        verdict: "hold",
        reason: `Pre-CD thesis (+${exp.toFixed(0)}% in ${days}d) — hold toward CD, monitor slope`,
      };
    }
    return {
      verdict: "hold",
      reason: `Pre-CD +${exp.toFixed(0)}% in ${days}d — favorable hold toward CD`,
    };
  }

  // Clearly negative slope = exit suggested (no pre-CD thesis)
  if (slope20d <= -0.3) {
    return {
      verdict: "exit",
      reason: `Slope 20d ${fmtSlope(slope20d)} (negative) — divestment signal`,
    };
  }
  // Flat or slightly negative slope = watch
  if (slope20d < 0.1) {
    return {
      verdict: "watch",
      reason: `Slope 20d ${fmtSlope(slope20d)} (flat/uncertain) — await direction confirmation`,
    };
  }
  // Positive slope = hold
  return {
    verdict: "hold",
    reason: `Slope 20d ${fmtSlope(slope20d)} (positive) — favorable momentum, hold`,
  };
}

export function verdictTone(v: ExitVerdict): { label: string; color: string; bg: string } {
  switch (v) {
    case "hold":
      return { label: "HOLD", color: "text-[rgb(var(--signal-up))]", bg: "bg-[rgb(var(--signal-up))]/15" };
    case "watch":
      return { label: "WATCH", color: "text-[rgb(var(--warn))]", bg: "bg-[rgb(var(--warn))]/15" };
    case "exit":
      return { label: "EXIT", color: "text-[rgb(var(--signal-down))]", bg: "bg-[rgb(var(--signal-down))]/15" };
    case "n/d":
    default:
      return { label: "N/A", color: "text-ink-muted", bg: "bg-surface/40" };
  }
}
