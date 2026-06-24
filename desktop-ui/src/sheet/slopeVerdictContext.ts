import type { StabilityVerdict } from "./slopeStability";
import type { PortfolioLossAnalysisItem, LossExitResolution } from "./portfolioLossAnalysis";
import type { PortfolioLossAlert } from "./portfolioLossUrgent";

export type SlopeVerdictContext = {
  ticker: string;
  completionDate?: string;
  slope5d: number | null;
  slope20d: number | null;
  slope45d?: number | null;
  pred5Pp?: number | null;
  stabilityVerdict: StabilityVerdict;
  /** Curva modello in salita nonostante pendenza sotto soglia rumore. */
  curveRisingHold?: boolean;
};

export function slopeVerdictContextFromLossItem(
  item: PortfolioLossAnalysisItem,
): SlopeVerdictContext {
  return {
    ticker: item.ticker,
    completionDate: item.completionDate,
    slope5d: item.slope5d,
    slope20d: item.slope20d,
    slope45d: item.slope45d,
    pred5Pp: item.pred5Pp,
    stabilityVerdict: item.stabilityVerdict,
    curveRisingHold: item.curveRisingHold,
  };
}

export function slopeVerdictContextFromExit(
  alert: PortfolioLossAlert,
  resolution: LossExitResolution,
): SlopeVerdictContext {
  return {
    ticker: alert.ticker,
    completionDate: alert.completionDate,
    slope5d: resolution.slope5d,
    slope20d: resolution.slope20d,
    slope45d: resolution.slope45d ?? null,
    pred5Pp: resolution.pred5Pp,
    stabilityVerdict: resolution.stabilityVerdict,
    curveRisingHold: resolution.curveRisingHold,
  };
}

export function slopeVerdictContextFromSlopes(opts: {
  ticker: string;
  cd?: string;
  slope5d: number | null;
  slope20d: number | null;
  slope45d?: number | null;
  pred5Pp?: number | null;
  stabilityVerdict: StabilityVerdict;
}): SlopeVerdictContext {
  return {
    ticker: opts.ticker,
    completionDate: opts.cd,
    slope5d: opts.slope5d,
    slope20d: opts.slope20d,
    slope45d: opts.slope45d ?? null,
    pred5Pp: opts.pred5Pp ?? null,
    stabilityVerdict: opts.stabilityVerdict,
  };
}
