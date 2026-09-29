/**
 * Capital KPI for Loss Analysis TOP KPI SNAPSHOT table.
 * Invested $ / % plus decision-chart-aligned buy/sell sizing (rescue score).
 */
import type { DecisionRec } from "./decisionChartLogic";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";
import type { InvestSimInputs, InvestSimHistoryPoint } from "./investSimStorage";
import type { ClinicalPreCdRecord } from "../api/supernova";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import { computeEisFeedWindowScore, computeRescueScoreBreakdown } from "./lossRescueEngine";
import {
  buildResidualMoveBreakdownForTicker,
  type ResidualMoveBreakdown,
} from "./residualMoveAttribution";
import type { SdsRow } from "../api/supernova";
import {
  APPROVED_WEIGHTS_ACTION_DUST_EUR,
  RESCUE_DISINVEST_THRESHOLD,
  rescueAddFraction,
  rescueSellFraction,
  resolveInvestedCapitalUsd,
} from "./approvedWeightsCapitalKpi";

export type LossAnalysisSummaryCapitalKpi = {
  investedUsd: number;
  investedPct: number | null;
  actionUsd: number | null;
  actionPct: number | null;
  actionSide: "buy" | "sell" | null;
  rescueScore: number | null;
  residualBreakdown: ResidualMoveBreakdown | null;
  /**
   * Target allocation size in $ derived from P(plan): every ticker with a
   * P(plan) score gets a suggested position size (`P(plan) × planSlotEur`),
   * regardless of the decision recommendation. Populated for HOLD/REVIEW
   * too (unlike `actionUsd` which is only a BUY/SELL delta).
   *
   * Use case: user sees "Rec. size $3,250 (P 65%)" for a HOLD ticker not
   * yet in the portfolio and can decide whether the size matches what they
   * would actually deploy.
   *
   * `targetUsd` is the raw amount, `targetPct` normalizes it against the
   * same denominator used for `investedPct` for consistency.
   */
  targetUsd: number | null;
  targetPct: number | null;
};

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

function pctOf(usd: number, denom: number): number | null {
  if (denom <= 0 || usd <= 0) return null;
  return usd / denom;
}

function computeActionUsd(args: {
  decisionRec: DecisionRec;
  investedUsd: number;
  hasPosition: boolean;
  inLoss: boolean;
  rescueScore: number | null;
  planSlotEur: number;
}): { side: "buy" | "sell"; usd: number } | null {
  const { decisionRec, investedUsd, hasPosition, inLoss, rescueScore, planSlotEur } = args;
  const dust = APPROVED_WEIGHTS_ACTION_DUST_EUR;

  if (decisionRec === "buy") {
    if (!hasPosition || investedUsd <= 0) {
      if (planSlotEur <= dust) return null;
      return { side: "buy", usd: planSlotEur };
    }
    const gap = roundEur(planSlotEur - investedUsd);
    if (gap <= dust) return null;
    if (inLoss && rescueScore != null && rescueScore >= RESCUE_DISINVEST_THRESHOLD) {
      const add = roundEur(gap * rescueAddFraction(rescueScore));
      return add > dust ? { side: "buy", usd: add } : null;
    }
    return { side: "buy", usd: gap };
  }

  if (decisionRec === "sell") {
    if (investedUsd <= dust) return null;
    const score = rescueScore ?? 40;
    const sellUsd = roundEur(investedUsd * rescueSellFraction(score));
    return sellUsd > dust ? { side: "sell", usd: sellUsd } : null;
  }

  if (decisionRec === "review") {
    if (investedUsd > planSlotEur + dust) {
      const score = rescueScore ?? 50;
      const over = roundEur(investedUsd - planSlotEur);
      if (score < RESCUE_DISINVEST_THRESHOLD || over > planSlotEur * 0.15) {
        const sellUsd = roundEur(over * rescueSellFraction(score));
        if (sellUsd > dust) return { side: "sell", usd: sellUsd };
      }
    }
    if (!hasPosition || investedUsd <= 0) return null;
    const under = roundEur(planSlotEur - investedUsd);
    if (under > dust && inLoss && rescueScore != null && rescueScore >= RESCUE_DISINVEST_THRESHOLD) {
      const add = roundEur(under * rescueAddFraction(rescueScore));
      if (add > dust) return { side: "buy", usd: add };
    }
  }

  return null;
}

export function buildLossAnalysisSummaryCapitalKpi(args: {
  item: PortfolioLossAnalysisItem;
  simRow: Record<string, unknown> | null | undefined;
  inputs: InvestSimInputs;
  decisionRec: DecisionRec;
  totalDenominatorEur: number;
  planSlotEur?: number;
  clinicalRecords?: ClinicalPreCdRecord[] | null;
  history?: InvestSimHistoryPoint[] | null;
  lang?: "it" | "en";
  sdsRow?: SdsRow | null;
  /**
   * P(plan) score 0..100 used to compute `targetUsd`. Pass `dcRow.scores.pplan`
   * directly from the decision chart (so the target reflects exactly the same
   * probability that drives the Recommendation column). Optional: when null,
   * `targetUsd` stays null (no fabricated size for missing scores).
   */
  pplanPct?: number | null;
}): LossAnalysisSummaryCapitalKpi {
  const planSlotEur = args.planSlotEur ?? DEFAULT_PLAN_CAPITAL_EUR;
  const lang = args.lang ?? "it";
  const investedUsd =
    args.item.hasPosition && args.item.capital > 0
      ? roundEur(args.item.capital)
      : resolveInvestedCapitalUsd(args.item.key, args.simRow ?? undefined, args.inputs);

  const entryProbPct =
    args.item.recoveryProbabilityPct ??
    (args.item.planReturnPct != null ? Math.min(100, Math.max(0, args.item.planReturnPct)) : null);
  const pnlPct = args.item.hasPosition ? args.item.pnlPct : args.item.pnlPct24h ?? args.item.pnlPct;

  const eisWindowScore =
    investedUsd > 0 || args.item.inLoss
      ? computeEisFeedWindowScore(
          args.item.ticker,
          lang,
          null,
          args.history ?? null,
          args.clinicalRecords ?? null,
        )
      : null;

  let rescueScore: number | null = null;
  if (investedUsd > 0 || args.decisionRec === "buy" || args.decisionRec === "sell") {
    rescueScore = computeRescueScoreBreakdown({
      ticker: args.item.ticker,
      entryProbPct,
      lastMarkPct: pnlPct,
      eisWindowScore,
    }).rescoreScore;
  }

  const action = computeActionUsd({
    decisionRec: args.decisionRec,
    investedUsd,
    hasPosition: args.item.hasPosition,
    inLoss: args.item.inLoss,
    rescueScore,
    planSlotEur,
  });

  const denom = args.totalDenominatorEur;

  const movePct = args.item.pnlPct24h ?? pnlPct;
  const residualBreakdown = buildResidualMoveBreakdownForTicker({
    ticker: args.item.ticker,
    observedPct: movePct,
    curveGapPct: args.item.curveGapPct,
    sdsRow: args.sdsRow ?? null,
    lang,
    clinicalRecords: args.clinicalRecords ?? null,
  });

  // Target allocation size from P(plan): a suggested position size shown for
  // every ticker (including HOLD/REVIEW), computed as `P(plan) × planSlot`.
  // Sub-40% P(plan) is capped at 0 (the decision layer already sells at that
  // level, no target); above we scale linearly to the full plan slot at 100%.
  let targetUsd: number | null = null;
  if (
    args.pplanPct != null &&
    Number.isFinite(args.pplanPct) &&
    args.pplanPct >= 40
  ) {
    const clamped = Math.max(0, Math.min(100, args.pplanPct));
    const raw = (clamped / 100) * planSlotEur;
    targetUsd = raw > APPROVED_WEIGHTS_ACTION_DUST_EUR ? roundEur(raw) : null;
  }

  return {
    investedUsd,
    investedPct: investedUsd > 0 ? pctOf(investedUsd, denom) : null,
    actionUsd: action?.usd ?? null,
    actionPct: action ? pctOf(action.usd, denom) : null,
    actionSide: action?.side ?? null,
    rescueScore,
    residualBreakdown,
    targetUsd,
    targetPct: targetUsd != null ? pctOf(targetUsd, denom) : null,
  };
}

export function lossAnalysisCapitalDenominatorEur(
  items: PortfolioLossAnalysisItem[],
  decisionRecByKey: Map<string, DecisionRec>,
  planSlotEur = DEFAULT_PLAN_CAPITAL_EUR,
): number {
  let open = 0;
  let buySlots = 0;
  for (const it of items) {
    if (it.hasPosition && it.capital > 0) {
      open += it.capital;
    } else if (decisionRecByKey.get(it.key) === "buy") {
      buySlots += planSlotEur;
    }
  }
  return Math.max(open + buySlots, open, planSlotEur);
}
