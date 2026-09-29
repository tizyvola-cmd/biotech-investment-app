/**
 * Capital KPI rows for the Learning Lab approved-weights table:
 * recommended vs invested $ / %, plus rescue-score action hints (buy/sell).
 */
import type { SheetTable } from "../types";
import type { ComparisonDeal } from "./threePortfolioCompare";
import type { InvestSimInputs } from "./investSimStorage";
import type { SuggestionMonitorRow } from "./suggestionMonitor";
import { buildSimRowByKeyMap } from "./investSimKeys";
import { mergedSimInputs, rowHasActivePortfolio } from "./simulationPosition";
import { computeRescueScoreBreakdown } from "./lossRescueEngine";

export const APPROVED_WEIGHTS_ACTION_DUST_EUR = 25;
export const RESCUE_DISINVEST_THRESHOLD = 30;

export type ApprovedWeightsActionReason =
  | "buy_new"
  | "buy_add"
  | "rescue_add"
  | "trim"
  | "rescue_sell"
  | "sell";

export type ApprovedWeightsCapitalAction = {
  side: "buy" | "sell";
  usd: number;
  /** Share of total capital pot (0–1). */
  pct: number;
  reason: ApprovedWeightsActionReason;
};

export type ApprovedWeightsCapitalRow = {
  rowKey: string;
  recommendedUsd: number;
  recommendedPct: number;
  investedUsd: number;
  investedPct: number;
  rescueScore: number | null;
  action: ApprovedWeightsCapitalAction | null;
};

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

export function resolveInvestedCapitalUsd(
  rowKey: string,
  simRow: Record<string, unknown> | undefined,
  inputs: InvestSimInputs,
): number {
  if (!simRow || !rowHasActivePortfolio(simRow, inputs)) return 0;
  const entry = inputs[rowKey];
  const merged = mergedSimInputs(simRow, entry ?? { buyPrice: 0, capital: 0 });
  return merged.capital > 0 ? roundEur(merged.capital) : 0;
}

export function rescueSellFraction(rescueScore: number): number {
  if (rescueScore < RESCUE_DISINVEST_THRESHOLD) return 1;
  if (rescueScore < 45) return 0.85;
  if (rescueScore < 60) return 0.65;
  return 0.45;
}

export function rescueAddFraction(rescueScore: number): number {
  if (rescueScore >= 70) return 1;
  if (rescueScore >= 45) return 0.75;
  if (rescueScore >= RESCUE_DISINVEST_THRESHOLD) return 0.5;
  return 0;
}

function computeAction(args: {
  investedUsd: number;
  recommendedUsd: number;
  totalCapitalEur: number;
  monitor: SuggestionMonitorRow | undefined;
  rescueScore: number | null;
}): ApprovedWeightsCapitalAction | null {
  const { investedUsd, recommendedUsd, totalCapitalEur, monitor, rescueScore } = args;
  if (totalCapitalEur <= 0) return null;

  const suggested = monitor?.suggestedAction ?? "none";
  const inLoss = monitor?.inLoss ?? (monitor?.pnlPct != null && monitor.pnlPct < 0);
  const hasPosition = investedUsd > 0;
  const gap = roundEur(investedUsd - recommendedUsd);
  const absGap = Math.abs(gap);

  if (!hasPosition) {
    if (suggested !== "buy") return null;
    if (recommendedUsd <= APPROVED_WEIGHTS_ACTION_DUST_EUR) return null;
    return {
      side: "buy",
      usd: recommendedUsd,
      pct: recommendedUsd / totalCapitalEur,
      reason: "buy_new",
    };
  }

  const synthTrim =
    monitor?.synthExposureKind === "trim_review" ||
    monitor?.synthExposureKind === "trim_sell" ||
    monitor?.synthExposureKind === "sell_confirm";
  const synthTarget =
    synthTrim && monitor?.synthTargetCapEur != null && Number.isFinite(monitor.synthTargetCapEur)
      ? roundEur(Math.max(0, monitor.synthTargetCapEur))
      : null;

  if (synthTarget != null && investedUsd - synthTarget > APPROVED_WEIGHTS_ACTION_DUST_EUR) {
    const sellUsd = roundEur(investedUsd - synthTarget);
    return {
      side: "sell",
      usd: sellUsd,
      pct: sellUsd / totalCapitalEur,
      reason: "trim",
    };
  }

  if (suggested === "sell" && investedUsd > APPROVED_WEIGHTS_ACTION_DUST_EUR) {
    const score = rescueScore ?? 50;
    const over = gap > APPROVED_WEIGHTS_ACTION_DUST_EUR ? gap : investedUsd;
    const sellUsd = roundEur(over * rescueSellFraction(score));
    if (sellUsd <= APPROVED_WEIGHTS_ACTION_DUST_EUR) return null;
    return {
      side: "sell",
      usd: sellUsd,
      pct: sellUsd / totalCapitalEur,
      reason: score < RESCUE_DISINVEST_THRESHOLD ? "rescue_sell" : "sell",
    };
  }

  if (gap > APPROVED_WEIGHTS_ACTION_DUST_EUR) {
    const score = rescueScore ?? 50;
    if (score < RESCUE_DISINVEST_THRESHOLD || suggested === "review") {
      const sellUsd = roundEur(gap * rescueSellFraction(score));
      if (sellUsd <= APPROVED_WEIGHTS_ACTION_DUST_EUR) return null;
      return {
        side: "sell",
        usd: sellUsd,
        pct: sellUsd / totalCapitalEur,
        reason: score < RESCUE_DISINVEST_THRESHOLD ? "rescue_sell" : "trim",
      };
    }
  }

  if (recommendedUsd > investedUsd + APPROVED_WEIGHTS_ACTION_DUST_EUR) {
    const underGap = roundEur(recommendedUsd - investedUsd);
    if (inLoss && rescueScore != null && rescueScore >= RESCUE_DISINVEST_THRESHOLD) {
      const addUsd = roundEur(underGap * rescueAddFraction(rescueScore));
      if (addUsd <= APPROVED_WEIGHTS_ACTION_DUST_EUR) return null;
      return {
        side: "buy",
        usd: addUsd,
        pct: addUsd / totalCapitalEur,
        reason: "rescue_add",
      };
    }
    if (suggested === "buy") {
      return {
        side: "buy",
        usd: underGap,
        pct: underGap / totalCapitalEur,
        reason: "buy_add",
      };
    }
  }

  if (
    absGap <= APPROVED_WEIGHTS_ACTION_DUST_EUR &&
    suggested === "buy" &&
    !hasPosition &&
    recommendedUsd > APPROVED_WEIGHTS_ACTION_DUST_EUR
  ) {
    return {
      side: "buy",
      usd: recommendedUsd,
      pct: recommendedUsd / totalCapitalEur,
      reason: "buy_new",
    };
  }

  return null;
}

export function buildApprovedWeightsCapitalRows(args: {
  deals: ComparisonDeal[];
  weightedShares: number[];
  totalCapitalEur: number;
  simTable?: SheetTable | null;
  inputs: InvestSimInputs;
  monitorByKey: Map<string, SuggestionMonitorRow>;
}): ApprovedWeightsCapitalRow[] {
  const { deals, weightedShares, totalCapitalEur, simTable, inputs, monitorByKey } = args;
  const simRowByKey = simTable?.rows?.length
    ? buildSimRowByKeyMap(simTable.rows)
    : new Map<string, Record<string, unknown>>();

  return deals.map((deal, i) => {
    const wShare = weightedShares[i] ?? (deals.length > 0 ? 1 / deals.length : 0);
    const recommendedUsd =
      totalCapitalEur > 0 ? roundEur(totalCapitalEur * wShare) : 0;
    const recommendedPct = totalCapitalEur > 0 ? wShare : 0;

    const simRow = simRowByKey.get(deal.rowKey);
    const investedUsd = resolveInvestedCapitalUsd(deal.rowKey, simRow, inputs);
    const investedPct = totalCapitalEur > 0 ? investedUsd / totalCapitalEur : 0;

    const monitor = monitorByKey.get(deal.rowKey);
    const pnlPct = monitor?.pnlPct ?? deal.realizedReturnPct ?? null;
    const entryProbPct = monitor?.probPct ?? deal.winRate * 100;

    let rescueScore: number | null = null;
    if (investedUsd > 0 || monitor?.suggestedAction === "buy" || monitor?.suggestedAction === "sell") {
      rescueScore = computeRescueScoreBreakdown({
        entryProbPct,
        lastMarkPct: pnlPct,
        eisWindowScore: null,
      }).rescoreScore;
    }

    const action = computeAction({
      investedUsd,
      recommendedUsd,
      totalCapitalEur,
      monitor,
      rescueScore,
    });

    return {
      rowKey: deal.rowKey,
      recommendedUsd,
      recommendedPct,
      investedUsd,
      investedPct,
      rescueScore,
      action,
    };
  });
}
