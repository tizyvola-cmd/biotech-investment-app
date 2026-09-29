import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CLOSED_PIGGY_BANK_CHANGED_EVENT,
  clearClosedPiggyBankBaseline,
  computeClosedPiggyBankDisplay,
  loadClosedPiggyBankBaseline,
  resetClosedPiggyBankBaseline,
  summarizeClosedPiggyBankFromLedger,
  type ClosedPiggyBankDisplay,
} from "../sheet/closedPiggyBank";
import type { PortfolioDailyPnlLedger } from "../sheet/simulationPosition";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { loadInvestSimInputs } from "../sheet/investSimStorage";

/** One-shot: drop the old Reset baseline that hid all-time closed gains on the glass. */
const CLEAR_BASELINE_ONCE_KEY = "supernova_closed_piggy_clear_baseline_alltime_v1";

export function useClosedPiggyBank(
  ledger: PortfolioDailyPnlLedger | null | undefined,
  inputs?: InvestSimInputs | null,
): {
  display: ClosedPiggyBankDisplay;
  reset: () => void;
} {
  const [baselineTick, setBaselineTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem(CLEAR_BASELINE_ONCE_KEY) !== "1") {
        clearClosedPiggyBankBaseline();
        localStorage.setItem(CLEAR_BASELINE_ONCE_KEY, "1");
      }
    } catch {
      /* ignore */
    }
    const bump = () => setBaselineTick((n) => n + 1);
    window.addEventListener(CLOSED_PIGGY_BANK_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CLOSED_PIGGY_BANK_CHANGED_EVENT, bump);
  }, []);

  const summary = useMemo(
    () => summarizeClosedPiggyBankFromLedger(ledger, inputs ?? loadInvestSimInputs()),
    [ledger, inputs],
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
