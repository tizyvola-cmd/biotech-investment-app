/**
 * Heavy per-row KPI derivations — call from memoized row hooks, not inline in a parent map.
 */
import type { ChartPoint } from "../types";
import type { IntradayPricePoint } from "./simUniverse24hWhatIf";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";
import {
  softBuyDayNotRed,
  softBuyRisingStreakAllows,
  softBuyTapeNotCatastrophic,
} from "./investDecisionSimLoop";
import {
  currentPriceUsdFromSimRow,
  resolveLowSpotSignals,
  resolvePriceLowsUsd,
} from "./earlyPeakBuyMinTarget";
import {
  dailyChangePctFromRow,
  isWarrantTicker,
} from "./simulationPosition";
import { evaluateSoftBuyGrade1 } from "./softSignalGrades";

export function deriveKpiSoftBuyG1(opts: {
  item: PortfolioLossAnalysisItem;
  sdsScore: number | null;
  pplan: number | null | undefined;
  simRow: Record<string, unknown> | null;
  chartPts: ChartPoint[] | null;
  priorSessionPct: number | null | undefined;
}) {
  const { item, sdsScore, pplan, simRow, chartPts, priorSessionPct } = opts;
  const softBuyG1Raw = evaluateSoftBuyGrade1({
    hasPosition: item.hasPosition,
    sdsScore,
    pplan: pplan ?? item.recoveryProbabilityPct,
  });
  const dayPctSim = simRow ? dailyChangePctFromRow(simRow) : null;
  // Gen 4: Top2 / P(cont) are ranking-only — match Home Soft BUY G1.
  const hit =
    softBuyG1Raw.hit &&
    !item.hasPosition &&
    !isWarrantTicker(item.ticker) &&
    item.precatKind !== "sell" &&
    softBuyDayNotRed(item, dayPctSim) &&
    softBuyRisingStreakAllows(item, dayPctSim, {
      simRow,
      chartPts,
      priorSessionPcts:
        priorSessionPct != null && Number.isFinite(priorSessionPct)
          ? [priorSessionPct]
          : undefined,
    }) &&
    softBuyTapeNotCatastrophic(item, dayPctSim);
  return { ...softBuyG1Raw, hit };
}

export function deriveKpiPriceLowSpot(opts: {
  simRow: Record<string, unknown> | null;
  chartPts: ChartPoint[] | null;
  intradayPrior?: IntradayPricePoint[] | null;
  intradayLive?: IntradayPricePoint[] | null;
}) {
  const spotUsd = currentPriceUsdFromSimRow(opts.simRow);
  const priceLows = resolvePriceLowsUsd({
    simRow: opts.simRow,
    chartPts: opts.chartPts,
    intradayPrior: opts.intradayPrior,
    intradayLive: opts.intradayLive,
  });
  return {
    spotUsd,
    priceLows,
    lowSpot: resolveLowSpotSignals(
      spotUsd,
      priceLows.weekMinUsd,
      priceLows.dayMinUsd,
    ),
  };
}
