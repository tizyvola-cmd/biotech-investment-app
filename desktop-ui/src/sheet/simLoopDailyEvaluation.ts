/**
 * Daily sim-loop evaluation (18:00 Rome) — solid BUY gate + synth risk capital.
 *
 * Equal paper path: flat capitalPerTrade on accepted solid BUYs.
 * Synth paper execution: same BUY set, capital scaled by SDS + volatility + EIS + feed fragility.
 */
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import type { LossAnalysisProbOptions } from "./portfolioLossAnalysis";
import { buildSdsByTicker } from "./sdsTopOppGate";
import type { TickerSimEvaluation } from "./investDecisionSimLoop";
import { evaluateSimLoopPolicy, type SimLoopAcceptancePolicy } from "./simLoopAcceptancePolicy";
import {
  computeEisFeedWindowScore,
  computeEisFragilityPt,
  computeFeedFragilityAnalogPt,
  feedFragilityWindowStartIso,
} from "./lossRescueEngine";
import { buildCdPatternTickerRecommendation } from "./cdPatternRecommendation";
import { buildSimRowByKeyMap, reconcileInvestSimInputs } from "./investSimKeys";
import { type InvestSimInputs, loadInvestSimHistory } from "./investSimStorage";

/** Rome daily evaluation hour — Mon–Fri once per session. */
export const SIM_LOOP_DAILY_EVAL_H = 18;

/**
 * Solid-confidence defaults for auto paper BUYs (stricter than manual register-buy policy).
 * P(plan) ≥ 55% · SDS ≥ 45 · composite ≥ 60 OR Top2 yes with P ≥ 55%.
 */
export const SOLID_DAILY_BUY_DEFAULTS = {
  minPplanPct: 55,
  minSds: 45,
  minCompositeScore: 60,
} as const;

export type SolidDailyBuyGate = typeof SOLID_DAILY_BUY_DEFAULTS;

export type EntryRiskBreakdown = {
  sdsRiskPt: number;
  volRiskPt: number;
  confRiskPt: number;
  eisFragPt: number;
  feedFragPt: number;
};

export type EntryRiskScore = {
  /** 0 = safest · 100 = most fragile / volatile. */
  riskScore: number;
  /** Inverse safety 0–100 (higher → more capital). */
  safetyScore: number;
  eisWindowScore: number | null;
  eisSuperScore: number | null;
  breakdown: EntryRiskBreakdown;
};

export type SimLoopExecutionOpts = {
  filterEvaluations: (evaluations: TickerSimEvaluation[]) => TickerSimEvaluation[];
  resolveBuyCapital: (ev: TickerSimEvaluation) => number;
};

export type DailySimLoopExecutionContext = {
  probOptions: LossAnalysisProbOptions | null | undefined;
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  lang: "it" | "en";
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function sdsForTicker(
  ticker: string,
  sdsRows: SdsRow[] | null | undefined,
): { sds: number | null; veto: boolean } {
  const info = buildSdsByTicker(sdsRows).get(ticker.trim().toUpperCase());
  return { sds: info?.sds ?? null, veto: Boolean(info?.veto) };
}

export function resolveEntryEisInputs(
  ev: TickerSimEvaluation,
  ctx: DailySimLoopExecutionContext,
): { eisWindowScore: number | null; eisSuperScore: number | null } {
  const simRow = ctx.simTable?.rows?.length
    ? buildSimRowByKeyMap(ctx.simTable.rows).get(ev.key) ?? null
    : null;
  const sk = simRow ? simulationRowSeriesKey(simRow) : null;
  const chartPts = sk ? ctx.pointsBySeriesKey.get(sk) : undefined;
  const merged = reconcileInvestSimInputs(ctx.inputs, ctx.simTable?.rows ?? []);

  const rec = simRow
    ? buildCdPatternTickerRecommendation({
        row: simRow,
        chartPoints: chartPts,
        investInputs: merged,
        sdsRows: ctx.probOptions?.sdsRows ?? undefined,
        migByKey: ctx.probOptions?.migSolidityByKey ?? new Map(),
        lang: ctx.lang,
        includeEis: ctx.probOptions?.lightweightPolygon !== true,
        eisSuperScoreState: ctx.probOptions?.eisSuperScoreState ?? undefined,
      })
    : null;

  const eisSuperScore = rec?.nearestEis?.superScore ?? rec?.nearestEis?.score ?? null;
  const eisWindowScore = computeEisFeedWindowScore(
    ev.ticker,
    ctx.lang,
    feedFragilityWindowStartIso(14),
    loadInvestSimHistory(),
  );

  return { eisWindowScore, eisSuperScore };
}

/** Entry fragility: SDS + vol + P(plan) + EIS feed + rescue analogue (off-book). */
export function computeEntryRiskScore(args: {
  sds: number | null;
  pplanPct: number | null;
  pnlPct24h: number | null;
  eisWindowScore?: number | null;
  eisSuperScore?: number | null;
}): EntryRiskScore {
  const sdsRiskPt =
    args.sds != null ? clamp(72 - args.sds * 0.72, 0, 72) : 38;
  const volRiskPt =
    args.pnlPct24h != null ? clamp(Math.abs(args.pnlPct24h) * 5.5, 0, 28) : 0;
  const confRiskPt =
    args.pplanPct != null
      ? clamp(SOLID_DAILY_BUY_DEFAULTS.minPplanPct + 5 - args.pplanPct, 0, 18)
      : 10;
  const eisFragPt = computeEisFragilityPt({
    eisWindowScore: args.eisWindowScore ?? null,
    eisSuperScore: args.eisSuperScore ?? null,
  });
  const feedFragPt = computeFeedFragilityAnalogPt({
    pplanPct: args.pplanPct,
    eisWindowScore: args.eisWindowScore ?? null,
    eisSuperScore: args.eisSuperScore ?? null,
  });

  const riskScore = clamp(
    Math.round(
      sdsRiskPt * 0.35 +
        volRiskPt * 0.2 +
        confRiskPt * 0.12 +
        eisFragPt * 0.18 +
        feedFragPt * 0.15,
    ),
    0,
    100,
  );
  const safetyScore = clamp(100 - riskScore, 0, 100);
  return {
    riskScore,
    safetyScore,
    eisWindowScore: args.eisWindowScore ?? null,
    eisSuperScore: args.eisSuperScore ?? null,
    breakdown: {
      sdsRiskPt: Math.round(sdsRiskPt),
      volRiskPt: Math.round(volRiskPt),
      confRiskPt: Math.round(confRiskPt),
      eisFragPt,
      feedFragPt,
    },
  };
}

/** Synth capital: safer entries get up to 100% of base; fragile/low-SDS down to 35%. */
export function synthCapitalFromSafety(
  baseCapitalEur: number,
  safetyScore: number,
): number {
  if (baseCapitalEur <= 0) return 0;
  const mult = clamp(0.35 + (safetyScore / 100) * 0.65, 0.35, 1);
  return Math.max(50, Math.round((baseCapitalEur * mult) / 50) * 50);
}

export function passesSolidDailyBuyGate(
  ev: TickerSimEvaluation,
  sds: number | null,
  sdsVeto: boolean,
  gate: SolidDailyBuyGate = SOLID_DAILY_BUY_DEFAULTS,
  policy?: SimLoopAcceptancePolicy,
): boolean {
  if (ev.suggestedAction !== "buy") return true;
  if (sdsVeto) return false;

  const policyCheck = evaluateSimLoopPolicy(
    sds,
    ev.probPct,
    false,
    "buy",
    {
      minSds: gate.minSds,
      minPplanPct: gate.minPplanPct,
      rejectOnLossPattern: policy?.rejectOnLossPattern ?? false,
      requireExplicitBuy: true,
      updatedAt: policy?.updatedAt ?? null,
      note: policy?.note ?? "",
    },
  );
  if (!policyCheck.accepted) return false;

  if (ev.investVerdict === "yes" && (ev.probPct ?? 0) >= gate.minPplanPct) {
    return true;
  }
  return ev.compositeScore >= gate.minCompositeScore;
}

export function filterEvaluationsForSolidDailyBuys(
  evaluations: TickerSimEvaluation[],
  probOptions: LossAnalysisProbOptions | null | undefined,
  gate: SolidDailyBuyGate = SOLID_DAILY_BUY_DEFAULTS,
): TickerSimEvaluation[] {
  const sdsRows = probOptions?.sdsRows ?? null;
  return evaluations.map((ev) => {
    if (ev.suggestedAction !== "buy") return ev;
    const { sds, veto } = sdsForTicker(ev.ticker, sdsRows);
    if (passesSolidDailyBuyGate(ev, sds, veto, gate)) return ev;
    return {
      ...ev,
      suggestedAction: "hold" as const,
      exitReason: "daily solid gate — below P(plan)/SDS/composite threshold",
    };
  });
}

export function buildDailySimLoopExecution(
  baseCapitalEur: number,
  ctx: DailySimLoopExecutionContext,
  gate: SolidDailyBuyGate = SOLID_DAILY_BUY_DEFAULTS,
): SimLoopExecutionOpts {
  const sdsRows = ctx.probOptions?.sdsRows ?? null;

  const filterEvaluations = (evaluations: TickerSimEvaluation[]) =>
    filterEvaluationsForSolidDailyBuys(evaluations, ctx.probOptions, gate);

  const resolveBuyCapital = (ev: TickerSimEvaluation): number => {
    const { sds } = sdsForTicker(ev.ticker, sdsRows);
    const { eisWindowScore, eisSuperScore } = resolveEntryEisInputs(ev, ctx);
    const { safetyScore } = computeEntryRiskScore({
      sds,
      pplanPct: ev.probPct,
      pnlPct24h: ev.pnlPct24h,
      eisWindowScore,
      eisSuperScore,
    });
    return synthCapitalFromSafety(baseCapitalEur, safetyScore);
  };

  return { filterEvaluations, resolveBuyCapital };
}
