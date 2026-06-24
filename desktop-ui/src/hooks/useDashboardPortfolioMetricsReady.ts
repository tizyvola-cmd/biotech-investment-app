import { useEffect, useState } from "react";
import type { SheetTable } from "../types";
import { hydrateInvestSimInputs } from "../sheet/investSimStorage";

/**
 * True when dashboard portfolio P&L can be shown without a mid-load jump:
 * remote Simulation sheet fetch finished AND inputs disk merge done.
 * Caller must also wait on portfolio historyReady (see useInvestSimPortfolioHistory).
 */
export function useDashboardPortfolioMetricsReady(
  simTable: SheetTable | null,
  simLoading: boolean,
  reloadToken = 0,
): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (simLoading) {
      setReady(false);
      return;
    }
    const rows = simTable?.rows ?? [];
    if (!rows.length) {
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    void (async () => {
      await hydrateInvestSimInputs(rows);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [simLoading, simTable, reloadToken]);

  return ready;
}
