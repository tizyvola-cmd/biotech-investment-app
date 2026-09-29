import { buildMobileOpportunities } from "./opportunityLogic";
import { rowHasActivePortfolio } from "./simLogic";
import type { InvestSimInputs, SheetTable } from "./types";

export type MobilePickStockRow = {
  key: string;
  ticker: string;
  name: string;
  daysToCd: number | null;
  pred5: number | null;
  planReturnPct: number | null;
  affidPct: number | null;
  roiPerDay: number | null;
  zone: "hot" | "watch";
};

/** Off-portfolio hot/watch picks — mirrors desktop Pick stocks (simplified). */
export function buildMobilePickStocks(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  limit = 6,
): MobilePickStockRow[] {
  const opps = buildMobileOpportunities(sheet, inputs);
  const rows = [...opps.hot, ...opps.watch]
    .filter((o) => !rowHasActivePortfolio({ Ticker: o.ticker, "Completion Date": o.completionDate } as Record<string, unknown>, inputs))
    .sort((a, b) => (b.roiPerDay ?? 0) - (a.roiPerDay ?? 0))
    .slice(0, limit);
  return rows.map((o) => ({
    key: o.key,
    ticker: o.ticker,
    name: o.name,
    daysToCd: o.daysToCd,
    pred5: o.pred5,
    planReturnPct: o.planReturnPct,
    affidPct: o.affidPct,
    roiPerDay: o.roiPerDay,
    zone: o.zone,
  }));
}
