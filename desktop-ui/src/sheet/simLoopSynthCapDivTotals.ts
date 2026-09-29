/**
 * Synth dashboard KPIs — same Cap Div / 3-experiment snapshot as
 * `harmonizeAllocationRealized(allocateFromShares(...))`, not paper-tick replay.
 */
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { computeSdsGainBreakdown } from "./sdsGainBreakdown";
import { buildSynthCurveAllocation } from "./buildSynthCurveAllocation";
import { runUnivariateScreening, extractAllRowFeatures } from "../riskPattern/lossRiskScreening";
import { loadApprovedPattern } from "../riskPattern/patternProposalStore";
import { matchPattern } from "../riskPattern/lossRiskPattern";
import type { ComparisonDeal } from "./threePortfolioCompare";
import {
  allocateFromShares,
  buildThreePortfolioComparison,
} from "./threePortfolioCompare";
import {
  harmonizeAllocationRealized,
  scenarioGainEur,
  scenarioGainPct,
} from "./portfolioScenarioGain";
import type { PaperPosition } from "./investDecisionSimLoop";
import type { InvestSimInputs } from "./investSimStorage";
import type { SimLoopPulseTotals } from "./simLoopPulseView";
import { buildCashFlowSnapshot } from "./experimentCashFlow";
import { positionCapitalPnlPct } from "./simulationPosition";
import { floorPaperBookSynthShares } from "./simLoopCausalSynth";

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cap € for one sim-loop deal row — uses row_key share, not capByTicker (last-write per ticker). */
function capEurForDealRow(
  rowKey: string,
  totalCapitalEur: number,
  shares: Record<string, number>,
): number {
  let sumShares = 0;
  for (const v of Object.values(shares)) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) sumShares += v;
  }
  if (sumShares <= 0) return 0;
  const sh = shares[rowKey];
  if (sh == null || !Number.isFinite(sh) || sh < 0) return 0;
  return roundEur((totalCapitalEur * sh) / sumShares);
}

export function buildSimLoopSynthCapDivTotals(opts: {
  closedRows: SimOutcomeRow[];
  simTable: SheetTable | null;
  sdsRows: SdsRow[] | null;
  investInputs?: InvestSimInputs;
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  totalCapitalEur: number;
  paperPortfolio: PaperPosition[];
  lang: "it" | "en";
}): SimLoopPulseTotals | null {
  if (!opts.simTable?.rows?.length || opts.totalCapitalEur <= 0) return null;

  let calibrationSnapshot = null;
  try {
    calibrationSnapshot = computeCalibrationSnapshot(opts.closedRows, {
      simTable: opts.simTable,
      sdsRows: opts.sdsRows,
    });
  } catch {
    return null;
  }

  let phaseA = null;
  try {
    phaseA = runUnivariateScreening(opts.closedRows, {
      simTable: opts.simTable,
      sdsRows: opts.sdsRows,
    });
  } catch {
    phaseA = null;
  }

  const approvedPattern = (() => {
    try {
      return loadApprovedPattern().current ?? null;
    } catch {
      return null;
    }
  })();

  const matchesStep2Pattern = (() => {
    if (!approvedPattern) return () => false;
    const map = new Map<string, boolean>();
    try {
      const features = extractAllRowFeatures(opts.closedRows, {
        simTable: opts.simTable,
        sdsRows: opts.sdsRows,
      });
      for (const [fk, fc] of features) {
        const ticker = fk.split("|")[0]?.toUpperCase();
        if (!ticker) continue;
        if (matchPattern(approvedPattern, fc)) map.set(ticker, true);
      }
    } catch {
      /* empty */
    }
    return (deal: ComparisonDeal) => map.get(deal.ticker.toUpperCase()) === true;
  })();

  const sdsBreakdown = computeSdsGainBreakdown(opts.closedRows, {
    simTable: opts.simTable,
    sdsRows: opts.sdsRows,
  });

  const targetGainEur = Math.max(50, Math.round(opts.totalCapitalEur * 0.005));

  const comparison = buildThreePortfolioComparison({
    closedRows: opts.closedRows,
    simTable: opts.simTable,
    sdsRows: opts.sdsRows,
    inputs: opts.investInputs,
    pointsBySeriesKey: opts.pointsBySeriesKey,
    lang: opts.lang,
    calibrationSnapshot,
    sdsBreakdown,
    totalCapitalEur: opts.totalCapitalEur,
    phaseA,
    approvedPattern,
    matchesStep2Pattern,
    paperPortfolio: opts.paperPortfolio,
  });

  const synthCurve = buildSynthCurveAllocation({
    closedRows: opts.closedRows,
    simTable: opts.simTable,
    sdsRows: opts.sdsRows,
    investInputs: opts.investInputs,
    pointsBySeriesKey: opts.pointsBySeriesKey,
    lang: opts.lang,
    calibrationSnapshot,
    sdsBreakdown,
    totalCapitalEur: opts.totalCapitalEur,
    targetGainEur,
    phaseA,
    approvedPattern,
    matchesStep2Pattern,
    paperPortfolio: opts.paperPortfolio,
  });

  const rawShares = synthCurve?.simLoopSharesByRowKey;
  if (!rawShares || comparison.simLoopDeals.length === 0) return null;

  const capitalPerTrade =
    opts.paperPortfolio.find((p) => p.capital > 0)?.capital ??
    opts.totalCapitalEur / Math.max(1, opts.paperPortfolio.length);
  const shares = floorPaperBookSynthShares(rawShares, opts.paperPortfolio, {
    totalCapitalEur: opts.totalCapitalEur,
    capitalPerTrade,
  });

  const alloc = harmonizeAllocationRealized(
    allocateFromShares(comparison.simLoopDeals, opts.totalCapitalEur, shares),
    comparison.simLoopDeals,
  );

  const openKeys = new Set(opts.paperPortfolio.map((p) => p.key));
  let openPnlEur = 0;
  let openCap = 0;
  let closedPnlEur = 0;
  let closedDealCount = 0;
  let capitalReturnedFromClosedEur = 0;
  let realizedGainsFromClosedEur = 0;
  let pnlEurToday = 0;
  let todayCovered = 0;

  for (const deal of comparison.simLoopDeals) {
    const cap = capEurForDealRow(deal.rowKey, opts.totalCapitalEur, shares);
    if (!(cap > 0)) continue;
    const gain = scenarioGainEur(cap, deal.realizedReturnPct);
    if (openKeys.has(deal.rowKey)) {
      openPnlEur += gain;
      openCap += cap;
      if (deal.realizedReturnPct24h != null && Number.isFinite(deal.realizedReturnPct24h)) {
        pnlEurToday += scenarioGainEur(cap, deal.realizedReturnPct24h);
        todayCovered += 1;
      }
    } else if (deal.realizedReturnPct != null && Number.isFinite(deal.realizedReturnPct)) {
      closedPnlEur += gain;
      closedDealCount += 1;
      capitalReturnedFromClosedEur += cap;
      if (gain > 0) realizedGainsFromClosedEur += gain;
    }
  }

  openPnlEur = roundEur(openPnlEur);
  closedPnlEur = roundEur(closedPnlEur);
  const pnlEur = roundEur(openPnlEur + closedPnlEur);
  const capital = roundEur(alloc.totalCapitalEur);
  const capitalInOpenEur = roundEur(openCap);
  const capitalReturned = roundEur(capitalReturnedFromClosedEur);
  const cashFlow = buildCashFlowSnapshot({
    capitalReturnedFromClosedEur: capitalReturned,
    capitalInOpenEur,
    closedDealCount,
    realizedGainsFromClosedEur: realizedGainsFromClosedEur,
    startingCapitalEur: alloc.totalCapitalEur > 0 ? alloc.totalCapitalEur : null,
  });

  return {
    pnlEur,
    pnlPct: capital > 0 ? positionCapitalPnlPct(pnlEur, capital) : null,
    pnlEurToday: todayCovered > 0 ? roundEur(pnlEurToday) : null,
    todayCovered,
    capital,
    openPnlEur,
    openPnlPct: openCap > 0 ? scenarioGainPct(openPnlEur, openCap) : null,
    closedPnlEur,
    closedDealCount,
    capitalReturnedFromClosedEur: cashFlow.capitalReturnedFromClosedEur,
    capitalInOpenEur: cashFlow.capitalInOpenEur,
    capitalReinvestedEur: cashFlow.capitalReinvestedEur,
    freshCapitalDeployedEur: cashFlow.freshCapitalDeployedEur,
    realizedGainsFromClosedEur: cashFlow.realizedGainsFromClosedEur,
    gainsRecycledInOpenEur: cashFlow.gainsRecycledInOpenEur,
    capitalNotFromGainsEur: cashFlow.capitalNotFromGainsEur,
  };
}
