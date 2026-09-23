/**
 * When G2 day-loss budget is breached, auto-sell hits (no confirm) and surface
 * only the tickers that were closed.
 */
import { useEffect, useRef, useState } from "react";
import type { SheetTable } from "../types";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { loadInvestSimHistory } from "../sheet/investSimStorage";
import type { PortfolioSellResult } from "../sheet/portfolioSell";
import {
  loadG2AutoSoldAck,
  markG2AutoSoldKeys,
  pendingUrgentSellG2Hits,
  toG2AutoSoldNotice,
  type G2AutoSoldNotice,
} from "../sheet/urgentSellG2AutoExecute";

export type UrgentSellG2SellFn = (
  key: string,
  simRow?: Record<string, unknown> | null,
  opts?: { confirm?: boolean },
) => PortfolioSellResult | void | Promise<PortfolioSellResult | void>;

export function useUrgentSellG2AutoExecute(opts: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  simLoading?: boolean;
  sell: UrgentSellG2SellFn;
  enabled?: boolean;
}): {
  soldNotices: G2AutoSoldNotice[];
  clearSoldNotices: () => void;
} {
  const [soldNotices, setSoldNotices] = useState<G2AutoSoldNotice[]>([]);
  const inFlightRef = useRef(false);
  const sellRef = useRef(opts.sell);
  sellRef.current = opts.sell;

  useEffect(() => {
    if (opts.enabled === false) return;
    if (opts.simLoading) return;
    if (!opts.simTable?.rows?.length) return;
    if (inFlightRef.current) return;

    const ack = loadG2AutoSoldAck();
    const pending = pendingUrgentSellG2Hits({
      simTable: opts.simTable,
      inputs: opts.inputs,
      history: loadInvestSimHistory(),
      ackKeys: ack.keys,
    });
    if (!pending.length) return;

    let cancelled = false;
    inFlightRef.current = true;

    void (async () => {
      const sold: G2AutoSoldNotice[] = [];
      const resolvedKeys: string[] = [];
      try {
        for (const hit of pending) {
          if (cancelled) break;
          const result = await sellRef.current(hit.key, null, { confirm: false });
          if (result?.ok) {
            sold.push(toG2AutoSoldNotice(hit));
            resolvedKeys.push(hit.key);
          } else if (
            result &&
            !result.ok &&
            (result.reason === "not_in_portfolio" || result.reason === "no_capital")
          ) {
            // Already gone — ack so we do not retry forever.
            resolvedKeys.push(hit.key);
          }
        }
        if (resolvedKeys.length) markG2AutoSoldKeys(resolvedKeys);
        if (!cancelled && sold.length) {
          setSoldNotices((prev) => {
            const seen = new Set(prev.map((p) => p.key));
            const next = [...prev];
            for (const s of sold) {
              if (!seen.has(s.key)) next.push(s);
            }
            return next;
          });
        }
      } finally {
        inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [opts.simTable, opts.inputs, opts.simLoading, opts.enabled]);

  return {
    soldNotices,
    clearSoldNotices: () => setSoldNotices([]),
  };
}
