import { closedDealsSummary, portfolioSummary } from "./mobilePortfolioTable";
import type { InvestSimInputs, SheetTable } from "./types";

/** @deprecated use DEFAULT_SIM_STARTING_CAPITAL_EUR from mobileSimCapitalPrefs */
export const MOBILE_SIM_STARTING_CAPITAL_EUR = 5000;

export type MobilePortfolioCash = {
  startingCapital: number;
  invested: number;
  available: number;
};

/** Open capital + cash left in the sim wallet (starting + closed P&L − invested). */
export function mobileSimCash(
  inputs: InvestSimInputs,
  sheet: SheetTable | null,
  startingCapital = MOBILE_SIM_STARTING_CAPITAL_EUR,
): MobilePortfolioCash {
  const invested = portfolioSummary(sheet, inputs).capital;
  const closed = closedDealsSummary(inputs);
  const start = startingCapital > 0 ? startingCapital : MOBILE_SIM_STARTING_CAPITAL_EUR;
  const available = start + closed.pnlEur - invested;
  return {
    startingCapital: start,
    invested,
    available: Math.round(available * 100) / 100,
  };
}
