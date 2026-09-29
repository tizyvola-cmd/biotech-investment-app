/**
 * Server interest-watchlist tickers. Enrolled names belong on Catalyst /
 * Top KPI / Deep Dive (not as chips under the search field).
 */
import { useCallback, useEffect, useState } from "react";
import { fetchCatalystInterest } from "../api/supernova";
import { setCatalystInterestTickers } from "../sheet/catalystInterestStore";

export const CATALYST_INTEREST_CHANGED = "supernova:catalyst-interest-changed";

export function notifyCatalystInterestChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(CATALYST_INTEREST_CHANGED));
  } catch {
    /* ignore */
  }
}

export function useCatalystInterestTickers(): string[] {
  const [tickers, setTickers] = useState<string[]>([]);

  const reload = useCallback(async () => {
    try {
      const snap = await fetchCatalystInterest();
      const next = (snap.entries ?? [])
        .map((e) => String(e.ticker || "").trim().toUpperCase())
        .filter(Boolean);
      setCatalystInterestTickers(next);
      setTickers(next);
    } catch {
      /* panel still usable */
    }
  }, []);

  useEffect(() => {
    void reload();
    const onChange = () => {
      void reload();
    };
    window.addEventListener(CATALYST_INTEREST_CHANGED, onChange);
    return () => window.removeEventListener(CATALYST_INTEREST_CHANGED, onChange);
  }, [reload]);

  return tickers;
}
