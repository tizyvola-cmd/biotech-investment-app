/**
 * Shared synth-curve allocation builder — used by Step 3 and Three-Portfolio
 * compare so both surfaces stay on the same approved-weight → Weight Sim Exp pipeline.
 */
import { loadFrozenWeights } from "../calibration/proposalStore";
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { CalibrationSnapshot } from "../calibration/calibrationTypes";
import type { InvestSimInputs } from "./investSimStorage";
import {
  buildSynthCurveAllocationPayload,
  computeApprovedWeightShares,
  type SynthCurveAllocationPayload,
} from "./approvedWeightPortfolioShares";
import { buildThreePortfolioComparison } from "./threePortfolioCompare";
import {
  applyLossAwareSynthShare,
  effectiveSynthMovePct,
} from "./synthLossAwareCap";
import { optimizeWeightSimExp } from "./weightSimExpOptimizer";
import type { SdsGainBreakdown } from "./sdsGainBreakdown";
import type { PhaseAResult, RiskPattern } from "../riskPattern/riskPatternTypes";

export type BuildSynthCurveAllocationArgs = {
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  investInputs?: InvestSimInputs;
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
  lang: "it" | "en";
  calibrationSnapshot: CalibrationSnapshot | null;
  sdsBreakdown: SdsGainBreakdown;
  totalCapitalEur: number;
  targetGainEur: number;
  phaseA: PhaseAResult | null;
  approvedPattern: RiskPattern | null;
  matchesStep2Pattern: (deal: import("./threePortfolioCompare").ComparisonDeal) => boolean;
};

export function buildSynthCurveAllocation(
  args: BuildSynthCurveAllocationArgs,
): SynthCurveAllocationPayload | null {
  if (!args.simTable?.rows?.length || args.totalCapitalEur <= 0) return null;

  const comparison = buildThreePortfolioComparison({
    closedRows: args.closedRows,
    simTable: args.simTable,
    sdsRows: args.sdsRows ?? null,
    inputs: args.investInputs,
    pointsBySeriesKey: args.pointsBySeriesKey,
    lang: args.lang,
    calibrationSnapshot: args.calibrationSnapshot,
    sdsBreakdown: args.sdsBreakdown,
    totalCapitalEur: args.totalCapitalEur,
    phaseA: args.phaseA,
    approvedPattern: args.approvedPattern,
    matchesStep2Pattern: args.matchesStep2Pattern,
  });

  const frozen = loadFrozenWeights();
  const mineDeals = comparison.mineDeals;
  const simLoopDeals = comparison.simLoopDeals;

  const portfolioApproved = computeApprovedWeightShares(
    mineDeals,
    frozen,
    args.matchesStep2Pattern,
  );
  const simLoopApproved = computeApprovedWeightShares(
    simLoopDeals,
    frozen,
    args.matchesStep2Pattern,
  );

  const mineDealKeys = new Set(mineDeals.map((d) => d.rowKey));
  const moveByRowKey = new Map<string, number>();
  for (const d of [...mineDeals, ...simLoopDeals]) {
    if (moveByRowKey.has(d.rowKey)) continue;
    const move24h =
      d.realizedReturnPct24h != null && Number.isFinite(d.realizedReturnPct24h)
        ? d.realizedReturnPct24h
        : d.realizedReturnPct != null && Number.isFinite(d.realizedReturnPct)
          ? d.realizedReturnPct
          : 0;
    moveByRowKey.set(
      d.rowKey,
      effectiveSynthMovePct({
        movePct24h: move24h,
        totalPnlPct: d.realizedReturnPct,
        isOpenPortfolio: mineDealKeys.has(d.rowKey),
      }),
    );
  }

  const portfolioWeightSimExp =
    mineDeals.length > 0
      ? optimizeWeightSimExp(
          mineDeals.map((d, i) => ({
            rowKey: d.rowKey,
            ticker: d.ticker,
            movePct24h: moveByRowKey.get(d.rowKey) ?? 0,
            baselineShare: portfolioApproved[i] ?? 0,
          })),
          args.totalCapitalEur,
          args.targetGainEur,
        )
      : null;

  const simLoopWeightSimExp =
    simLoopDeals.length > 0
      ? optimizeWeightSimExp(
          simLoopDeals.map((d, i) => ({
            rowKey: d.rowKey,
            ticker: d.ticker,
            movePct24h: moveByRowKey.get(d.rowKey) ?? 0,
            baselineShare: simLoopApproved[i] ?? 0,
          })),
          args.totalCapitalEur,
          args.targetGainEur,
        )
      : null;

  const portfolioSynth =
    portfolioWeightSimExp?.shares ?? portfolioApproved;
  const simLoopSynth = simLoopWeightSimExp?.shares ?? simLoopApproved;

  const payload = buildSynthCurveAllocationPayload({
    targetGainEur: args.targetGainEur,
    frozen,
    mineDeals,
    simLoopDeals,
    portfolioApprovedShares: portfolioApproved,
    simLoopApprovedShares: simLoopApproved,
    portfolioSynthShares: portfolioSynth,
    simLoopSynthShares: simLoopSynth,
  });
  if (!payload || !args.investInputs || args.totalCapitalEur <= 0) return payload;

  const adjustedDisplay: Record<string, number> = {
    ...payload.portfolioDisplaySharesByRowKey,
  };
  for (const d of mineDeals) {
    const raw = adjustedDisplay[d.rowKey];
    if (raw == null) continue;
    adjustedDisplay[d.rowKey] = applyLossAwareSynthShare(
      raw,
      args.investInputs[d.rowKey]?.capital ?? 0,
      args.totalCapitalEur,
      d.realizedReturnPct,
    );
  }
  return { ...payload, portfolioDisplaySharesByRowKey: adjustedDisplay };
}
