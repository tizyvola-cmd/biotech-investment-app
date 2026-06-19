/**

 * Single source of truth for open Simulation portfolio positions (buy/sell in UI).

 * Listens to same-tab sells (custom event) and cross-tab storage updates.

 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { SheetTable } from "../types";

import { buildSimRowByKeyMap, normalizedRowKey, reconcileInvestSimInputs } from "../sheet/investSimKeys";
import {
  currentPriceFromRow,
  rowHasActivePortfolio,
  sheetBuyPriceFromRow,
} from "../sheet/simulationPosition";
import { executePortfolioSell } from "../sheet/portfolioSell";
import { DEFAULT_PLAN_CAPITAL_EUR } from "../sheet/expectedRoiDisplay";

import {

  getInvestSimInputsSnapshot,

  INVEST_SIM_INPUTS_CHANGED_EVENT,

  hydrateInvestSimInputs,

  loadInvestSimInputs,

  persistInvestSimInputs,

  persistInvestSimInputsNow,

  sanitizeInvestSimInputs,

  type InvestSimInputs,

} from "../sheet/investSimStorage";



export function tickerFromSimRow(row: Record<string, unknown>): string {

  return String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();

}



function mergeInputsFromStorage(

  simRows: Record<string, unknown>[]

): InvestSimInputs {

  const loaded = getInvestSimInputsSnapshot();

  return simRows.length ? reconcileInvestSimInputs(loaded, simRows) : loaded;

}



function applySnapshot(

  simRows: Record<string, unknown>[]

): InvestSimInputs {

  const snap = getInvestSimInputsSnapshot();

  return simRows.length ? reconcileInvestSimInputs(snap, simRows) : snap;

}



export function useInvestSimInputs(

  simTable: SheetTable | null,

  reloadToken?: number

): InvestSimInputs {

  const rows = simTable?.rows ?? [];

  const [inputs, setInputs] = useState<InvestSimInputs>(() =>

    mergeInputsFromStorage(rows)

  );



  const syncFromCache = useCallback(() => {

    setInputs(applySnapshot(rows));

  }, [rows]);



  useEffect(() => {

    let cancelled = false;

    void (async () => {

      const merged = rows.length

        ? await hydrateInvestSimInputs(rows)

        : sanitizeInvestSimInputs(loadInvestSimInputs());

      if (!cancelled) setInputs(merged);

    })();

    return () => {

      cancelled = true;

    };

  }, [rows, reloadToken]);



  useEffect(() => {

    if (typeof window === "undefined") return;

    const onChanged = () => syncFromCache();

    window.addEventListener(INVEST_SIM_INPUTS_CHANGED_EVENT, onChanged);

    const onStorage = (e: StorageEvent) => {

      if (e.key === "supernova_invest_sim_inputs") onChanged();

    };

    window.addEventListener("storage", onStorage);

    return () => {

      window.removeEventListener(INVEST_SIM_INPUTS_CHANGED_EVENT, onChanged);

      window.removeEventListener("storage", onStorage);

    };

  }, [syncFromCache]);



  return inputs;

}



function simRowsSignature(rows: Record<string, unknown>[]): string {

  const parts: string[] = [];

  for (const r of rows) {

    const tk = String(r.Ticker ?? "")

      .trim()

      .toUpperCase();

    if (!tk || tk.includes("TOTALE")) continue;

    parts.push(normalizedRowKey(tk, r["Completion Date"]));

  }

  parts.sort();

  return parts.join("|");

}



/**

 * Mutable portfolio inputs for Simulation (buy/sell/capital edits).

 * Uses in-memory cache + localStorage (no async hydrate on mount — avoids undoing Sell on tab change).

 */

export function useInvestSimInputsMutable(simTable: SheetTable | null, reloadToken?: number) {

  const rows = simTable?.rows ?? [];

  const rowsSig = useMemo(() => simRowsSignature(rows), [rows]);

  const [inputs, setInputs] = useState<InvestSimInputs>(() =>

    mergeInputsFromStorage(rows)

  );



  const syncFromCache = useCallback(() => {

    setInputs(applySnapshot(rows));

  }, [rows]);



  // Restore from data/invest_sim_inputs.json when localStorage was cleared (browser cache reset).
  useEffect(() => {
    if (!rows.length) return;
    let cancelled = false;
    void (async () => {
      if (Object.keys(loadInvestSimInputs()).length > 0) return;
      const merged = await hydrateInvestSimInputs(rows);
      if (!cancelled) setInputs(merged);
    })();
    return () => {
      cancelled = true;
    };
  }, [rowsSig, rows]);

  // Disk hydrate on explicit reload (Decision Lab Reload, Simulation Reload).

  useEffect(() => {

    if (reloadToken == null || reloadToken <= 0) return;

    let cancelled = false;

    void (async () => {

      const merged = rows.length

        ? await hydrateInvestSimInputs(rows)

        : sanitizeInvestSimInputs(loadInvestSimInputs());

      if (!cancelled) setInputs(merged);

    })();

    return () => {

      cancelled = true;

    };

  }, [reloadToken, rows]);



  // Same-tab sells from modals / other views + cross-tab storage.
  useEffect(() => {

    if (typeof window === "undefined") return;

    const onChanged = () => syncFromCache();

    window.addEventListener(INVEST_SIM_INPUTS_CHANGED_EVENT, onChanged);

    const onStorage = (e: StorageEvent) => {

      if (e.key === "supernova_invest_sim_inputs") syncFromCache();

    };

    window.addEventListener("storage", onStorage);

    return () => {

      window.removeEventListener(INVEST_SIM_INPUTS_CHANGED_EVENT, onChanged);

      window.removeEventListener("storage", onStorage);

    };

  }, [syncFromCache]);



  // Re-key aliases when Simulation rows change; never re-fetch disk.

  useEffect(() => {

    if (!rowsSig) return;

    setInputs((prev) => {

      const next = reconcileInvestSimInputs(prev, rows);

      return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;

    });

  }, [rowsSig, rows]);



  const commitInputs = useCallback(

    (next: InvestSimInputs) => {

      const reconciled = rows.length

        ? reconcileInvestSimInputs(next, rows)

        : next;

      const clean = sanitizeInvestSimInputs(reconciled);

      setInputs(clean);

      persistInvestSimInputsNow(clean);

      return clean;

    },

    [rows]

  );



  const patchInputs = useCallback(

    (fn: (prev: InvestSimInputs) => InvestSimInputs): InvestSimInputs => {

      let clean!: InvestSimInputs;

      setInputs((prev) => {

        const merged = fn(prev);

        const reconciled = rows.length

          ? reconcileInvestSimInputs(merged, rows)

          : merged;

        clean = sanitizeInvestSimInputs(reconciled);

        persistInvestSimInputs(clean);

        return clean;

      });

      return clean;

    },

    [rows]

  );



  return { inputs, setInputs, commitInputs, patchInputs };

}



/** Close an open Simulation portfolio row (all tabs share localStorage + cache). */
export function usePortfolioSell(simTable: SheetTable | null) {
  const rows = simTable?.rows ?? [];
  const rowByKey = useMemo(() => buildSimRowByKeyMap(rows), [rows]);

  return useCallback(
    (key: string, simRowHint?: Record<string, unknown> | null, opts?: { confirm?: boolean }) => {
      const result = executePortfolioSell({
        key,
        simRow: rowByKey.get(key) ?? simRowHint ?? null,
        simTable,
        confirm: opts?.confirm ?? true,
        recordHistory: true,
      });
      return result;
    },
    [rowByKey, simTable],
  );
}

export type PortfolioRegisterBuyHandler = (key: string, capitalEur?: number) => boolean;

/** Quick register buy from dashboard / 24h cards (shared investSim storage). */
export function usePortfolioRegisterBuy(simTable: SheetTable | null): PortfolioRegisterBuyHandler {
  const rows = simTable?.rows ?? [];
  const rowByKey = useMemo(() => buildSimRowByKeyMap(rows), [rows]);
  const { patchInputs: patchInvestInputs } = useInvestSimInputsMutable(simTable);

  return useCallback(
    (key: string, capitalEur = DEFAULT_PLAN_CAPITAL_EUR) => {
      const row = rowByKey.get(key);
      if (!row) return false;
      const inputs = getInvestSimInputsSnapshot();
      if (rowHasActivePortfolio(row, inputs)) return false;
      const curr = currentPriceFromRow(row);
      if (curr == null || curr <= 0) {
        if (typeof window !== "undefined") {
          window.alert(
            "Current price unavailable — run Refresh data on the Simulation sheet first.",
          );
        }
        return false;
      }
      const eur = Math.round(capitalEur > 0 ? capitalEur : DEFAULT_PLAN_CAPITAL_EUR);
      const ticker = String(row.Ticker ?? "").trim().toUpperCase() || key;
      if (typeof window !== "undefined") {
        const ok = window.confirm(
          `Register ${ticker} in portfolio at ~$${curr.toFixed(2)} with €${eur.toLocaleString("en-US")}?`,
        );
        if (!ok) return false;
      }
      const sheetBuy = sheetBuyPriceFromRow(row);
      patchInvestInputs((prev: InvestSimInputs) => {
        const cur = prev[key] ?? { buyPrice: 0, capital: 0 };
        const entryBuy =
          cur.buyPrice > 0
            ? cur.buyPrice
            : sheetBuy != null && sheetBuy > 0
              ? sheetBuy
              : curr;
        return {
          ...prev,
          [key]: {
            buyPrice: entryBuy,
            capital: eur,
            ignoreSheet: false,
            investedAt: cur.investedAt ?? new Date().toISOString(),
            ...(cur.purchaseDate ? { purchaseDate: cur.purchaseDate } : {}),
          },
        };
      });
      return true;
    },
    [rowByKey, patchInvestInputs],
  );
}



export function portfolioTickerSet(

  simTable: SheetTable | null,

  inputs: InvestSimInputs

): Set<string> {

  const s = new Set<string>();

  for (const row of simTable?.rows ?? []) {

    if (!rowHasActivePortfolio(row, inputs)) continue;

    const tk = String(row.Ticker ?? "").trim().toUpperCase();

    if (tk && !tk.includes("TOTALE")) s.add(tk);

  }

  return s;

}


