import { useEffect, useMemo, useState } from "react";
import {
  hydrateInvestSimHistory,
  INVEST_SIM_HISTORY_CHANGED_EVENT,
  loadInvestSimHistory,
  type InvestSimHistoryPoint,
} from "../sheet/investSimStorage";
import type { SimulationPositionContext } from "../sheet/simulationPosition";

export type InvestSimPortfolioHistoryState = {
  history: InvestSimHistoryPoint[];
  /** True after disk merge — P&L totals must not render before this. */
  historyReady: boolean;
};

/** Storico portafoglio — stesso source del tab Simulation → P&L. */
export function useInvestSimPortfolioHistory(reloadToken?: number): InvestSimPortfolioHistoryState {
  const [history, setHistory] = useState(() => loadInvestSimHistory());
  const [historyReady, setHistoryReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHistoryReady(false);
    void hydrateInvestSimHistory().then((merged) => {
      if (cancelled) return;
      setHistory((prev) =>
        JSON.stringify(prev) === JSON.stringify(merged) ? prev : merged,
      );
      setHistoryReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    const bump = () => setHistory(loadInvestSimHistory());
    const onStorage = (e: StorageEvent) => {
      if (e.key === "supernova_invest_sim_history") bump();
    };
    window.addEventListener(INVEST_SIM_HISTORY_CHANGED_EVENT, bump);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(INVEST_SIM_HISTORY_CHANGED_EVENT, bump);
      window.removeEventListener("storage", onStorage);
    };
  }, [reloadToken]);

  return { history, historyReady };
}

export function useInvestSimPositionCtx(reloadToken?: number): SimulationPositionContext {
  const { history } = useInvestSimPortfolioHistory(reloadToken);
  return useMemo(() => ({ history }), [history]);
}
