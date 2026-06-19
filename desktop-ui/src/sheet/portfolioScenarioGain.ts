import type { PortfolioDailyPnlLedger, PortfolioTickerDailyRow } from "./simulationPosition";
import type { ComparisonDeal, PortfolioAllocation } from "./threePortfolioCompare";

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

function rowPnlThroughDay(row: PortfolioTickerDailyRow, dayKey: string): number {
  let sum = 0;
  for (const [dk, v] of Object.entries(row.pnlByDay)) {
    if (dk <= dayKey && v != null && Number.isFinite(v)) sum += v;
  }
  return roundEur(sum);
}

/** Last calendar day with a ledger leg — treat as exit day for archived rows. */
function rowExitDayKey(row: PortfolioTickerDailyRow): string {
  let last = "";
  for (const dk of Object.keys(row.pnlByDay)) {
    if (row.pnlByDay[dk] != null && dk > last) last = dk;
  }
  return last;
}

/** Realized P&L for a closed row — prefer stored exit P&L over Σ daily MTM legs. */
function archivedRowRealizedPnl(row: PortfolioTickerDailyRow): number {
  return roundEur(row.totalEur);
}

/** Unified MTM gain: cap × return% / 100 (same across Portfolio · Sim loop · Synth). */
export function scenarioGainEur(
  capEur: number,
  returnPct: number | null | undefined,
): number {
  if (!(capEur > 0) || returnPct == null || !Number.isFinite(returnPct)) return 0;
  return roundEur((capEur * returnPct) / 100);
}

export function scenarioGainPct(
  gainEur: number,
  capEur: number,
): number | null {
  if (!(capEur > 0) || !Number.isFinite(gainEur)) return null;
  return roundEur((gainEur / capEur) * 100);
}

/** Recompute per-ticker and total realized P&L from deal return % (fixes drift). */
export function harmonizeAllocationRealized(
  allocation: PortfolioAllocation,
  deals: ComparisonDeal[],
): PortfolioAllocation {
  const dealByTicker = new Map(deals.map((d) => [d.ticker, d]));
  const realizedEurByTicker: Record<string, number> = {};
  let totalRealized = 0;
  let realizedPositions = 0;

  for (const [ticker, cap] of Object.entries(allocation.capByTicker)) {
    if (!(cap > 0)) {
      realizedEurByTicker[ticker] = 0;
      continue;
    }
    const deal = dealByTicker.get(ticker);
    const realized = deal ? scenarioGainEur(cap, deal.realizedReturnPct) : 0;
    realizedEurByTicker[ticker] = realized;
    totalRealized += realized;
    if (
      deal?.realizedReturnPct != null &&
      Number.isFinite(deal.realizedReturnPct)
    ) {
      realizedPositions += 1;
    }
  }

  return {
    ...allocation,
    realizedEurByTicker,
    totalRealizedEur: roundEur(totalRealized),
    realizedPositionsCount: realizedPositions,
  };
}

export type PortfolioMaturationSeriesPoint = {
  at: string;
  totalPnlEur: number;
};

/** Cumulative open/closed P&L from daily ledger — aligned with Piggy Bank totals. */
export function buildCumulativePortfolioMaturationSeries(
  ledger: PortfolioDailyPnlLedger,
): {
  closed: PortfolioMaturationSeriesPoint[];
  open: PortfolioMaturationSeriesPoint[];
} {
  const closedRows = ledger.rows.filter((r) => r.archived);
  const openRows = ledger.rows.filter((r) => !r.archived);

  const closed: PortfolioMaturationSeriesPoint[] = ledger.dayKeys.map((dayKey) => {
    const total = closedRows.reduce((sum, row) => {
      const exitDay = rowExitDayKey(row);
      if (!exitDay || exitDay > dayKey) return sum;
      return sum + archivedRowRealizedPnl(row);
    }, 0);
    return { at: dayKey, totalPnlEur: roundEur(total) };
  });

  const open: PortfolioMaturationSeriesPoint[] = ledger.dayKeys.map((dayKey) => {
    const total = openRows.reduce((sum, row) => sum + rowPnlThroughDay(row, dayKey), 0);
    return { at: dayKey, totalPnlEur: roundEur(total) };
  });

  return { closed, open };
}

export type ThreeScenarioGainTotals = {
  portfolio: { capEur: number; gainEur: number; gainPct: number | null };
  simLoopEqual: { capEur: number; gainEur: number; gainPct: number | null };
  simLoopSynth: { capEur: number; gainEur: number; gainPct: number | null };
};

export function summarizeThreeScenarioGainTotals(args: {
  portfolio: PortfolioAllocation;
  simLoopEqual: PortfolioAllocation;
  simLoopSynth: PortfolioAllocation;
}): ThreeScenarioGainTotals {
  const pack = (a: PortfolioAllocation) => ({
    capEur: roundEur(a.totalCapitalEur),
    gainEur: roundEur(a.totalRealizedEur),
    gainPct: scenarioGainPct(a.totalRealizedEur, a.totalCapitalEur),
  });
  return {
    portfolio: pack(args.portfolio),
    simLoopEqual: pack(args.simLoopEqual),
    simLoopSynth: pack(args.simLoopSynth),
  };
}
