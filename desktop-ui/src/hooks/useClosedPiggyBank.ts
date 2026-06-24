import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CLOSED_PIGGY_BANK_CHANGED_EVENT,
  computeClosedPiggyBankDisplay,
  loadClosedPiggyBankBaseline,
  resetClosedPiggyBankBaseline,
  summarizeClosedPiggyBankFromLedger,
  type ClosedPiggyBankDisplay,
} from "../sheet/closedPiggyBank";
import type { PortfolioDailyPnlLedger } from "../sheet/simulationPosition";

export function useClosedPiggyBank(
  ledger: PortfolioDailyPnlLedger | null | undefined,
): {
  display: ClosedPiggyBankDisplay;
  reset: () => void;
} {
  const [baselineTick, setBaselineTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const bump = () => setBaselineTick((n) => n + 1);
    window.addEventListener(CLOSED_PIGGY_BANK_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CLOSED_PIGGY_BANK_CHANGED_EVENT, bump);
  }, []);

  const summary = useMemo(
    () => summarizeClosedPiggyBankFromLedger(ledger),
    [ledger],
  );

  const display = useMemo(() => {
    void baselineTick;
    const baseline = loadClosedPiggyBankBaseline();
    return computeClosedPiggyBankDisplay(summary, baseline);
  }, [summary, baselineTick]);

  const reset = useCallback(() => {
    resetClosedPiggyBankBaseline(summary.rawPnlEur);
  }, [summary.rawPnlEur]);

  return { display, reset };
}
