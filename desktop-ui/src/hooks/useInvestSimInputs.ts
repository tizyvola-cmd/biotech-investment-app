/**

 * Single source of truth for open Simulation portfolio positions (buy/sell in UI).

 * Listens to same-tab sells (custom event) and cross-tab storage updates.

 */

import { useCallback, useEffect, useMemo, useState } from "react";

import type { SheetTable } from "../types";

import {
  buildSimRowByKeyMap,
  normalizedRowKey,
  preserveRecentManualOpens,
  reconcileInvestSimInputs,
} from "../sheet/investSimKeys";
import {
  currentPriceFromRow,
  rowHasActivePortfolio,
} from "../sheet/simulationPosition";
import { pickSignalFromSimRow } from "../sheet/top2FromSimulation";
import { resolveSimulationEntrySolidity } from "../sheet/simulationEntrySolidity";
import {
  prepareExternalHolding,
  type ExternalHoldingDraft,
  type ExternalHoldingFail,
} from "../sheet/externalHolding";
import { executePortfolioSellAsync } from "../sheet/portfolioSell";
import { DEFAULT_PLAN_CAPITAL_EUR } from "../sheet/expectedRoiDisplay";
import {
  capitalDrawGateMessage,
  computeExperimentCash,
  experimentLabel,
  planCapitalDraw,
} from "../sheet/experimentCash";
import { loadUiPrefsLocal } from "../sheet/uiPrefs";

import {

  getInvestSimInputsSnapshot,
  reloadInvestSimInputsSnapshotFromStorage,

  INVEST_SIM_INPUTS_CHANGED_EVENT,

  forceRestoreOpenBookFromServer,

  hydrateInvestSimInputs,

  loadInvestSimInputs,

  persistInvestSimInputs,

  persistInvestSimInputsNow,

  saveInvestSimInputs,

  sanitizeInvestSimInputs,

  type InvestSimInputs,

} from "../sheet/investSimStorage";

const SESSION_FORCE_RESTORE_KEY = "supernova_force_restore_open_book_v1";

/** After hydrate: if browser open capital ≪ richest server book, force-open it. */
function commitPreservedManualOpens(
  incoming: InvestSimInputs,
  localBefore: InvestSimInputs,
): InvestSimInputs {
  const kept = preserveRecentManualOpens(incoming, localBefore);
  if (kept === incoming) return incoming;
  persistInvestSimInputs(kept);
  return kept;
}

async function hydrateAndForceRestoreOpenBook(
  rows: Record<string, unknown>[],
): Promise<InvestSimInputs> {
  // Capture before await — hydrate overwrites the in-memory cache with the server book.
  const localBefore = { ...getInvestSimInputsSnapshot() };
  let merged = rows.length
    ? await hydrateInvestSimInputs(rows)
    : sanitizeInvestSimInputs(loadInvestSimInputs());
  try {
    // Email accounts are independent — never auto-import the shared Pulse book.
    const { getActiveInvestTesterId, usesSharedOperatorInvestBook } = await import(
      "../sheet/testerSession"
    );
    if (getActiveInvestTesterId() || !usesSharedOperatorInvestBook()) {
      return commitPreservedManualOpens(merged, localBefore);
    }
    const { sumOpenCapital } = await import("../sheet/investSimKeys");
    const { fetchRichestInvestSimBook } = await import("../sheet/investSimStorage");
    const best = await fetchRichestInvestSimBook();
    if (best?.inputs) {
      const localOpen = sumOpenCapital(merged);
      const serverOpen = best.openCapital;
      const collapsed = serverOpen >= 10_000 && localOpen < serverOpen * 0.5;
      // Keep retrying while clearly collapsed — session "done" used to skip a failed restore.
      if (collapsed || (serverOpen >= 10_000 && localOpen < 15_000)) {
        const forced = await forceRestoreOpenBookFromServer(rows.length ? rows : undefined);
        if (forced.ok && forced.inputs) {
          // Prefer the post-reassert book written by forceRestore; only fall back
          // to applySnapshot when it did not shrink open capital.
          const fromLs = rows.length
            ? applySnapshot(rows)
            : sanitizeInvestSimInputs(loadInvestSimInputs());
          merged =
            sumOpenCapital(fromLs) >= serverOpen * 0.5 ? fromLs : forced.inputs;
          if (merged === forced.inputs) {
            saveInvestSimInputs(forced.inputs, { allowBogusCollapse: true });
          }
          try {
            sessionStorage.setItem(SESSION_FORCE_RESTORE_KEY, "done");
          } catch {
            /* ignore */
          }
        }
      } else {
        try {
          sessionStorage.setItem(SESSION_FORCE_RESTORE_KEY, "done");
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* keep hydrate result */
  }
  return commitPreservedManualOpens(merged, localBefore);
}



export function tickerFromSimRow(row: Record<string, unknown>): string {

  return String(row.Ticker ?? row.ticker ?? "").trim().toUpperCase();

}

const EMPTY_ROWS: Record<string, unknown>[] = [];



function mergeInputsFromStorage(

  simRows: Record<string, unknown>[]

): InvestSimInputs {

  const loaded = getInvestSimInputsSnapshot();

  return simRows.length ? reconcileInvestSimInputs(loaded, simRows) : loaded;

}



function applySnapshot(

  simRows: Record<string, unknown>[]

): InvestSimInputs {

  const snap = reloadInvestSimInputsSnapshotFromStorage();

  return simRows.length ? reconcileInvestSimInputs(snap, simRows) : snap;

}



export function useInvestSimInputs(

  simTable: SheetTable | null,

  reloadToken?: number

): InvestSimInputs {

  const rows = simTable?.rows ?? EMPTY_ROWS;

  const rowsSig = useMemo(() => simRowsSignature(rows), [rows]);

  const [inputs, setInputs] = useState<InvestSimInputs>(() =>

    mergeInputsFromStorage(rows)

  );



  const syncFromCache = useCallback(() => {

    setInputs(applySnapshot(rows));

  }, [rows]);



  useEffect(() => {

    let cancelled = false;

    void (async () => {

      const merged = await hydrateAndForceRestoreOpenBook(rows);

      if (!cancelled) setInputs(merged);

    })();

    return () => {

      cancelled = true;

    };

  }, [rowsSig, rows, reloadToken]);



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

  const rows = simTable?.rows ?? EMPTY_ROWS;

  const rowsSig = useMemo(() => simRowsSignature(rows), [rows]);

  const [inputs, setInputs] = useState<InvestSimInputs>(() =>

    mergeInputsFromStorage(rows)

  );



  const syncFromCache = useCallback(() => {

    setInputs(applySnapshot(rows));

  }, [rows]);



  // Always merge disk → local on mount / sheet change. restoreOpenCapitalFromDisk
  // inside hydrate recovers open capital lost in localStorage without undoing
  // explicit Sells (ignoreSheet + soldAt). Previously skipped whenever LS was
  // non-empty — so a partial book (e.g. only BIIB/VIR/CHRS) never got BNTX/CERS back.
  useEffect(() => {
    if (!rows.length) return;
    let cancelled = false;
    void (async () => {
      const merged = await hydrateAndForceRestoreOpenBook(rows);
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

      const merged = await hydrateAndForceRestoreOpenBook(rows);

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

  // Email tester books → push open capital to VPS so mobile companion stays in sync
  // (Electron otherwise only wrote localhost).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const push = () => {
      void (async () => {
        try {
          const { getActiveInvestTesterId } = await import("../sheet/testerSession");
          const tid = getActiveInvestTesterId();
          if (!tid || cancelled) return;
          const { sumOpenCapital } = await import("../sheet/investSimKeys");
          const book = getInvestSimInputsSnapshot();
          if (sumOpenCapital(book) < 1) return;
          const { persistInvestSimInputsNow } = await import("../sheet/investSimStorage");
          await persistInvestSimInputsNow(book);
        } catch {
          /* best-effort VPS sync */
        }
      })();
    };
    push();
    const id = window.setInterval(push, 20_000);
    const onVis = () => {
      if (document.visibilityState === "visible") push();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [rowsSig]);



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

  /** Force-open the server book into this browser (collapsed Pulse → full portfolio). */
  const restoreOpenBookFromServer = useCallback(async () => {
    const result = await forceRestoreOpenBookFromServer(rows.length ? rows : undefined);
    if (result.inputs) {
      setInputs(
        rows.length ? reconcileInvestSimInputs(result.inputs, rows) : result.inputs,
      );
      // Prefer LS clean book written by forceRestore (already reasserted).
      const fromLs = applySnapshot(rows);
      const { sumOpenCapital } = await import("../sheet/investSimKeys");
      if (sumOpenCapital(fromLs) >= sumOpenCapital(result.inputs) * 0.5) {
        setInputs(fromLs);
      } else {
        setInputs(result.inputs);
      }
    } else {
      setInputs(applySnapshot(rows));
    }
    return result;
  }, [rows]);



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



  return { inputs, setInputs, commitInputs, patchInputs, restoreOpenBookFromServer };

}



/** Close an open Simulation portfolio row (all tabs share localStorage + cache). */
export function usePortfolioSell(simTable: SheetTable | null) {
  const rows = simTable?.rows ?? EMPTY_ROWS;
  const rowByKey = useMemo(() => buildSimRowByKeyMap(rows), [rows]);

  return useCallback(
    async (key: string, simRowHint?: Record<string, unknown> | null, opts?: { confirm?: boolean }) => {
      return executePortfolioSellAsync({
        key,
        simRow: simRowHint ?? rowByKey.get(key) ?? null,
        simTable,
        inputs: getInvestSimInputsSnapshot(),
        confirm: opts?.confirm ?? true,
        recordHistory: true,
      });
    },
    [rowByKey, simTable],
  );
}

export type RegisterExternalHoldingResult =
  | { ok: true; ticker: string; key: string }
  | { ok: false; reason: ExternalHoldingFail };

export type RegisterExternalHoldingHandler = (
  draft: ExternalHoldingDraft,
) => RegisterExternalHoldingResult;

export type PortfolioRegisterBuyHandler = (key: string, capitalEur?: number) => boolean;

/** Quick register buy from dashboard / 24h cards (shared investSim storage). */
export function usePortfolioRegisterBuy(simTable: SheetTable | null): PortfolioRegisterBuyHandler {
  const rows = simTable?.rows ?? EMPTY_ROWS;
  const rowByKey = useMemo(() => buildSimRowByKeyMap(rows), [rows]);
  const { patchInputs: patchInvestInputs } = useInvestSimInputsMutable(simTable);

  return useCallback(
    (key: string, capitalEur = DEFAULT_PLAN_CAPITAL_EUR) => {
      const alertMsg = (msg: string) => {
        if (typeof window !== "undefined") window.alert(msg);
      };
      const row = rowByKey.get(key);
      if (!row) {
        alertMsg(
          `Cannot register buy — row not found for key ${key}. Refresh the Simulation sheet and retry.`,
        );
        return false;
      }
      const inputs = getInvestSimInputsSnapshot();
      const ticker = String(row.Ticker ?? "").trim().toUpperCase() || key;
      if (rowHasActivePortfolio(row, inputs)) {
        const openCap = inputs[key]?.capital ?? 0;
        alertMsg(
          `${ticker} is already open in the portfolio` +
            (openCap > 0 ? ` (€${Math.round(openCap).toLocaleString("en-US")}).` : ".") +
            ` Sell or edit capital in Simulation — Register Buy only opens new positions.`,
        );
        return false;
      }
      const curr = currentPriceFromRow(row);
      if (curr == null || curr <= 0) {
        alertMsg(
          `Current price unavailable for ${ticker} — run Refresh / Live signals on Simulation first, then retry.`,
        );
        return false;
      }
      const eur = Math.round(capitalEur > 0 ? capitalEur : DEFAULT_PLAN_CAPITAL_EUR);
      const prefs = loadUiPrefsLocal();
      const starting =
        prefs.topCapitalPortfolio != null &&
        Number.isFinite(prefs.topCapitalPortfolio) &&
        prefs.topCapitalPortfolio > 0
          ? prefs.topCapitalPortfolio
          : prefs.topCapital != null && Number.isFinite(prefs.topCapital) && prefs.topCapital > 0
            ? prefs.topCapital
            : 50_000;
      const cash = computeExperimentCash(inputs, "portfolio", starting);
      const draw = planCapitalDraw(cash, eur);
      if (!draw.affordable) {
        alertMsg(
          capitalDrawGateMessage(draw, {
            it: false,
            experimentLabel: experimentLabel("portfolio", false),
          }).text,
        );
        return false;
      }
      if (typeof window !== "undefined") {
        const gainsNote =
          draw.needsGainsConfirm
            ? `\n\nBudget free $${Math.round(draw.budgetFree).toLocaleString("en-US")} — this uses $${Math.round(draw.fromGains).toLocaleString("en-US")} from closed gains (available $${Math.round(draw.gainsFree).toLocaleString("en-US")}).`
            : "";
        const ok = window.confirm(
          `Register ${ticker} in portfolio at ~$${curr.toFixed(2)} with €${eur.toLocaleString("en-US")}?${gainsNote}`,
        );
        if (!ok) return false;
      }
      // Capture raScore now (at buy time) as entryProbPct for rescue score consistency
      const pick = pickSignalFromSimRow(row, getInvestSimInputsSnapshot(), null, null);
      const sol = resolveSimulationEntrySolidity(pick, undefined, "en", "rascore");
      const entryProbPct = sol?.composite.total != null ? Math.round(sol.composite.total) : null;
      // Merge onto the live LS snapshot — not a possibly-stale React `prev`
      // from a second useInvestSimInputsMutable (collapse guard was swallowing buys).
      const base = getInvestSimInputsSnapshot();
      const next: InvestSimInputs = {
        ...base,
        [key]: {
          buyPrice: curr,
          capital: eur,
          ignoreSheet: false,
          investedAt: new Date().toISOString(),
          universe: "real" as const,
          ...(entryProbPct != null ? { entryProbPct } : {}),
        },
      };
      const reconciled = rows.length ? reconcileInvestSimInputs(next, rows) : next;
      const beforeOpen = Object.values(base).filter(
        (e) => e && !e.ignoreSheet && (e.capital ?? 0) > 0,
      ).length;
      persistInvestSimInputs(reconciled);
      const after = getInvestSimInputsSnapshot();
      const saved = after[key];
      const okSaved =
        Boolean(saved) &&
        !saved!.ignoreSheet &&
        (saved!.capital ?? 0) > 0 &&
        Math.abs((saved!.buyPrice ?? 0) - curr) < 1e-6;
      if (!okSaved) {
        alertMsg(
          `Buy for ${ticker} did not persist (book guard or sync). Check console for [investSim] warnings and retry.`,
        );
        return false;
      }
      // Keep any mounted mutable hooks in sync.
      patchInvestInputs(() => after);
      void beforeOpen;
      return true;
    },
    [rowByKey, patchInvestInputs, rows],
  );
}

/**
 * Record a holding bought on another platform.
 * Same Pulse table / real book — no Soft BUY gates, no experiment cash draw.
 */
export function useRegisterExternalHolding(
  simTable: SheetTable | null,
): RegisterExternalHoldingHandler {
  const rows = simTable?.rows ?? EMPTY_ROWS;

  return useCallback(
    (draft: ExternalHoldingDraft) => {
      if (!rows.length) return { ok: false, reason: "not_in_universe" };
      const base = getInvestSimInputsSnapshot();
      const ready = prepareExternalHolding(rows, base, draft);
      if (!ready.ok) return ready;

      let entryProbPct: number | null = null;
      try {
        const pick = pickSignalFromSimRow(ready.row, base, null, null);
        const sol = resolveSimulationEntrySolidity(pick, undefined, "en", "rascore");
        entryProbPct = sol?.composite.total != null ? Math.round(sol.composite.total) : null;
      } catch {
        /* RA is optional — never block a typed holding */
      }
      const next: InvestSimInputs = {
        ...base,
        [ready.key]: {
          buyPrice: ready.buyPrice,
          capital: ready.capitalEur,
          ignoreSheet: false,
          investedAt: ready.investedAt,
          universe: "real",
          ...(ready.purchaseDate ? { purchaseDate: ready.purchaseDate } : {}),
          ...(entryProbPct != null ? { entryProbPct } : {}),
        },
      };
      const reconciled = reconcileInvestSimInputs(next, rows);
      persistInvestSimInputs(reconciled);
      void persistInvestSimInputsNow(reconciled);
      const after = getInvestSimInputsSnapshot();
      const saved = after[ready.key];
      const okSaved =
        Boolean(saved) &&
        !saved!.ignoreSheet &&
        (saved!.capital ?? 0) > 0;
      if (!okSaved) return { ok: false, reason: "persist" };
      return { ok: true, ticker: ready.ticker, key: ready.key };
    },
    [rows],
  );
}



export function portfolioTickerSet(

  simTable: SheetTable | null,

  inputs: InvestSimInputs

): Set<string> {

  const s = new Set<string>();

  for (const row of simTable?.rows ?? EMPTY_ROWS) {

    if (!rowHasActivePortfolio(row, inputs)) continue;

    const tk = String(row.Ticker ?? "").trim().toUpperCase();

    if (tk && !tk.includes("TOTALE")) s.add(tk);

  }

  return s;

}


