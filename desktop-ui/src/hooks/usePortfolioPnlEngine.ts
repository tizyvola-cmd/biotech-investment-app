import { useMemo } from "react";
import type { SheetTable } from "../types";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import {
  aggregateOpenPortfolioPnl,
  buildDashboardPortfolioChips,
  buildPositions,
  type PortfolioPnlTotals,
  type SimulationPosition,
  type SimulationPositionContext,
} from "../sheet/simulationPosition";
import { useInvestSimPortfolioHistory } from "./useInvestSimPortfolioHistory";

/** Motore P&L condiviso: Simulation P&L, Dashboard, Outcomes, Decision Lab. */
export function usePortfolioPnlEngine(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  reloadToken?: number,
): {
  history: ReturnType<typeof useInvestSimPortfolioHistory>;
  ctx: SimulationPositionContext;
  positions: SimulationPosition[];
  totals: PortfolioPnlTotals;
  chips: ReturnType<typeof buildDashboardPortfolioChips>;
} {
  const history = useInvestSimPortfolioHistory(reloadToken);
  const ctx = useMemo(() => ({ history }), [history]);
  const positions = useMemo(
    () => buildPositions(simTable, inputs, history),
    [simTable, inputs, history],
  );
  const totals = useMemo(
    () => aggregateOpenPortfolioPnl(simTable, inputs, history),
    [simTable, inputs, history],
  );
  const chips = useMemo(
    () => buildDashboardPortfolioChips(simTable, inputs, history),
    [simTable, inputs, history],
  );
  return { history, ctx, positions, totals, chips };
}
