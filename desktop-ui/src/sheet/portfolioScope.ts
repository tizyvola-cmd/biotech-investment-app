import { useMemo } from "react";

import type { SheetTable } from "../types";

import {
  useInvestSimInputs,
  portfolioTickerSet,
  tickerFromSimRow,
} from "../hooks/useInvestSimInputs";

export type PortfolioScopeMode = "all" | "portfolio" | "watch";

export { tickerFromSimRow };

export function useSimulationPortfolioScope(
  simTable: SheetTable | null,
  reloadToken?: number
) {
  const inputs = useInvestSimInputs(simTable, reloadToken);

  const portfolioTickers = useMemo(
    () => portfolioTickerSet(simTable, inputs),
    [simTable, inputs]
  );

  const watchTickers = useMemo(() => {
    const s = new Set<string>();
    for (const row of simTable?.rows ?? []) {
      const tk = tickerFromSimRow(row);
      if (tk && !portfolioTickers.has(tk)) s.add(tk);
    }
    return s;
  }, [simTable?.rows, portfolioTickers]);

  const simulationTickerCount = useMemo(() => {
    const s = new Set<string>();
    for (const row of simTable?.rows ?? []) {
      const tk = tickerFromSimRow(row);
      if (tk) s.add(tk);
    }
    return s.size;
  }, [simTable?.rows]);

  return {
    inputs,
    portfolioTickers,
    watchTickers,
    counts: {
      total: simulationTickerCount,
      portfolio: portfolioTickers.size,
      watch: watchTickers.size,
    },
    isPortfolioTicker: (ticker: string) =>
      portfolioTickers.has(ticker.trim().toUpperCase()),
    isWatchTicker: (ticker: string) => watchTickers.has(ticker.trim().toUpperCase()),
  };
}

export function recordMatchesScope(
  ticker: string | undefined,
  mode: PortfolioScopeMode,
  portfolioTickers: Set<string>,
  watchTickers: Set<string>
): boolean {
  const tk = String(ticker ?? "").trim().toUpperCase();
  if (!tk) return mode === "all";
  if (mode === "all") return true;
  if (mode === "portfolio") return portfolioTickers.has(tk);
  return watchTickers.has(tk);
}
