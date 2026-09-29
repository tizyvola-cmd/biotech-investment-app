/**
 * Simulation table "Rec $" column — Learning Lab approved weights (not Weight Sim Exp).
 *
 * Universe:
 *   · in-portfolio rows → normalize across open positions (mine deals)
 *   · other rows → normalize across sim-loop BUY + hot-zone pre-CD (≤60d) opportunities
 */
import type { FrozenWeights } from "../calibration/calibrationTypes";
import { computeFrozenWeightMultiplier } from "../calibration/sizingRules";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { SIM_HOT_ZONE_DAYS } from "./cdHorizons";
import { buildSimRowByKeyMap, normalizedRowKey } from "./investSimKeys";
import { daysToCdFromSimRow } from "./sdsCohortScope";
import { looksLikeTicker } from "./simulationTickers";
import {
  buildComparisonDealForLossRisk,
  type ComparisonDeal,
  type ThreePortfolioComparison,
} from "./threePortfolioCompare";
import {
  computeApprovedWeightShares,
  sharesByRowKeyFromDeals,
} from "./approvedWeightPortfolioShares";
import type { CalibrationSnapshot } from "../calibration/calibrationTypes";
import type { SdsGainBreakdown } from "./sdsGainBreakdown";
import type { PhaseAResult, RiskPattern } from "../riskPattern/riskPatternTypes";
import type { SuggestionMonitorRow } from "./suggestionMonitor";

export type SimTableApprovedWeightHint = {
  multiplier: number;
  share: number;
  patternPenalty: boolean;
};

export type SimTableApprovedWeightMaps = {
  portfolioApprovedShareByRowKey: Record<string, number>;
  opportunityApprovedShareByRowKey: Record<string, number>;
  multiplierByRowKey: Record<string, number>;
  patternPenaltyByRowKey: Record<string, boolean>;
};

const PATTERN_PENALTY = 0.5;

function isHotZoneOpportunityRow(row: Record<string, unknown>): boolean {
  const ticker = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
  if (!looksLikeTicker(ticker)) return false;
  const days = daysToCdFromSimRow(row);
  if (days == null || !Number.isFinite(days)) return false;
  if (days < 0) return false;
  return days <= SIM_HOT_ZONE_DAYS;
}

export function selectOpportunityHintDeals(args: {
  simLoopDeals: ComparisonDeal[];
  simTable: SheetTable;
  monitorByKey: Map<string, SuggestionMonitorRow>;
  dealCtx: {
    sdsByTicker: Map<string, SdsRow>;
    snapshot: CalibrationSnapshot | null;
    sdsBreakdown: SdsGainBreakdown | null;
    phaseA: PhaseAResult | null;
    approvedPattern: RiskPattern | null;
  };
}): ComparisonDeal[] {
  const seen = new Set(args.simLoopDeals.map((d) => d.rowKey));
  const out = [...args.simLoopDeals];
  const simRowByKey = buildSimRowByKeyMap(args.simTable.rows ?? []);

  for (const rec of args.simTable.rows ?? []) {
    const row = rec as Record<string, unknown>;
    if (!isHotZoneOpportunityRow(row)) continue;
    const ticker = String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();
    const cd = String(
      row["Completion Date"] ?? row["Catalyst Date"] ?? row.CD ?? "",
    ).trim();
    const rowKey = normalizedRowKey(ticker, cd);
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    const monitor = args.monitorByKey.get(rowKey);
    out.push(
      buildComparisonDealForLossRisk(
        rowKey,
        ticker,
        simRowByKey.get(rowKey) ?? row,
        monitor?.probPct ?? null,
        args.dealCtx,
      ),
    );
  }
  return out;
}

function multiplierMapsForDeals(
  deals: ComparisonDeal[],
  frozen: FrozenWeights,
  matchesStep2Pattern: (deal: ComparisonDeal) => boolean,
): {
  multiplierByRowKey: Record<string, number>;
  patternPenaltyByRowKey: Record<string, boolean>;
} {
  const multiplierByRowKey: Record<string, number> = {};
  const patternPenaltyByRowKey: Record<string, boolean> = {};
  for (const d of deals) {
    let mult = computeFrozenWeightMultiplier(d.cells, frozen);
    const penalized = matchesStep2Pattern(d);
    if (penalized) mult *= PATTERN_PENALTY;
    multiplierByRowKey[d.rowKey] = mult;
    patternPenaltyByRowKey[d.rowKey] = penalized;
  }
  return { multiplierByRowKey, patternPenaltyByRowKey };
}

export function buildSimTableApprovedWeightMaps(args: {
  comparison: ThreePortfolioComparison;
  simTable: SheetTable;
  frozen: FrozenWeights;
  matchesStep2Pattern: (deal: ComparisonDeal) => boolean;
  monitorByKey: Map<string, SuggestionMonitorRow>;
  dealCtx: {
    sdsByTicker: Map<string, SdsRow>;
    snapshot: CalibrationSnapshot | null;
    sdsBreakdown: SdsGainBreakdown | null;
    phaseA: PhaseAResult | null;
    approvedPattern: RiskPattern | null;
  };
}): SimTableApprovedWeightMaps {
  const { mineDeals, simLoopDeals } = args.comparison;
  const opportunityDeals = selectOpportunityHintDeals({
    simLoopDeals,
    simTable: args.simTable,
    monitorByKey: args.monitorByKey,
    dealCtx: args.dealCtx,
  });

  const portfolioShares = computeApprovedWeightShares(
    mineDeals,
    args.frozen,
    args.matchesStep2Pattern,
    PATTERN_PENALTY,
  );
  const opportunityShares = computeApprovedWeightShares(
    opportunityDeals,
    args.frozen,
    args.matchesStep2Pattern,
    PATTERN_PENALTY,
  );

  const allDeals = [...mineDeals];
  const seen = new Set(mineDeals.map((d) => d.rowKey));
  for (const d of opportunityDeals) {
    if (seen.has(d.rowKey)) continue;
    seen.add(d.rowKey);
    allDeals.push(d);
  }
  const { multiplierByRowKey, patternPenaltyByRowKey } = multiplierMapsForDeals(
    allDeals,
    args.frozen,
    args.matchesStep2Pattern,
  );

  return {
    portfolioApprovedShareByRowKey: sharesByRowKeyFromDeals(mineDeals, portfolioShares),
    opportunityApprovedShareByRowKey: sharesByRowKeyFromDeals(
      opportunityDeals,
      opportunityShares,
    ),
    multiplierByRowKey,
    patternPenaltyByRowKey,
  };
}

export function resolveSimTableApprovedShare(
  maps: SimTableApprovedWeightMaps | null | undefined,
  rowKey: string,
  inPortfolio: boolean,
): number | null {
  if (!maps) return null;
  const map = inPortfolio
    ? maps.portfolioApprovedShareByRowKey
    : maps.opportunityApprovedShareByRowKey;
  const share = map[rowKey];
  if (share == null || !Number.isFinite(share) || share <= 0) return null;
  return share;
}

export function resolveSimTableApprovedWeightHint(
  maps: SimTableApprovedWeightMaps | null | undefined,
  rowKey: string,
  inPortfolio: boolean,
): SimTableApprovedWeightHint | null {
  const share = resolveSimTableApprovedShare(maps, rowKey, inPortfolio);
  if (share == null) return null;
  const multiplier = maps?.multiplierByRowKey[rowKey];
  if (multiplier == null || !Number.isFinite(multiplier)) return null;
  return {
    multiplier,
    share,
    patternPenalty: maps?.patternPenaltyByRowKey[rowKey] === true,
  };
}
