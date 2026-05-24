import type { InvestSimInputEntry, InvestSimInputs } from "./investSimStorage";
import { normalizedRowKey } from "./investSimKeys";
import type { SheetTable } from "../types";

export const SIM_PNL_NA_TOOLTIP =
  "Prezzo corrente non disponibile — aggiorna il foglio Simulation o attendi il refresh prezzi.";

export const SIM_COMPUTED_COLUMNS = [
  "N° Azioni Implicite",
  "Valore Attuale ($)",
  "P&L ($)",
  "P&L (%)",
] as const;

export type SimulationPosition = {
  key: string;
  ticker: string;
  name: string;
  completionDate: string;
  currPrice: number | null;
  buyPrice: number;
  capital: number;
  shares: number;
  valueNow: number;
  pnlEur: number;
  pnlPct: number;
  /** P&L non calcolabile: manca prezzo corrente. */
  pnlUnavailable: boolean;
};

export function rowKey(ticker: string, cd: string) {
  return normalizedRowKey(ticker, cd);
}

export function parseNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—" || v === "-" || v === "N/D") return null;
  const n =
    typeof v === "number"
      ? v
      : Number(String(v).replace(/\s/g, "").replace(/,/g, ".").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function isSheetCellEmpty(v: unknown): boolean {
  return v == null || v === "" || v === "—" || v === "-" || v === "N/D";
}

export function effectiveBuyPrice(
  inp: InvestSimInputEntry,
  curr: number | null
): number {
  if (inp.buyPrice > 0) return inp.buyPrice;
  if (curr != null && curr > 0) return curr;
  return 0;
}

export function mergedSimInputs(
  r: Record<string, unknown>,
  inp: InvestSimInputEntry
): { buyPrice: number; capital: number } {
  if (inp.ignoreSheet) {
    return { buyPrice: 0, capital: 0 };
  }
  const hasLocal = inp.buyPrice > 0 || inp.capital > 0;
  if (hasLocal) {
    return {
      buyPrice: inp.buyPrice > 0 ? inp.buyPrice : 0,
      capital: inp.capital > 0 ? inp.capital : 0,
    };
  }
  const sheetBuy = parseNum(r["Prezzo Acquisto ($)"]);
  const sheetCap = parseNum(r["Capitale Investito ($)"]);
  return {
    buyPrice: sheetBuy ?? 0,
    capital: sheetCap ?? 0,
  };
}

export function sheetPnlPct(r: Record<string, unknown>): number | null {
  const raw = parseNum(r["P&L (%)"]);
  if (raw === null) return null;
  return Math.abs(raw) <= 1.5 ? raw * 100 : raw;
}

export function currentPriceFromRow(r: Record<string, unknown>): number | null {
  return (
    parseNum(r["Prezzo Corrente ($)"]) ??
    parseNum(r["Prezzo Corrente"]) ??
    parseNum(r["Prezzo Attuale"]) ??
    null
  );
}

/** Metriche posizione (stessa logica di Simulation investimento). */
export function computeSimulationPosition(
  r: Record<string, unknown>,
  inputs: InvestSimInputs
): SimulationPosition | null {
  const ticker = String(r.Ticker ?? "").trim().toUpperCase();
  if (!ticker || ticker.includes("TOTALE")) return null;
  const cd = String(r["Completion Date"] ?? "—");
  const key = rowKey(ticker, cd);
  const curr = currentPriceFromRow(r);
  const inp = mergedSimInputs(r, inputs[key] ?? { buyPrice: 0, capital: 0 });
  const buyPrice = effectiveBuyPrice(inp, curr);
  const capital = inp.capital > 0 ? inp.capital : 0;
  let shares = 0;
  let valueNow = 0;
  let pnlEur = 0;
  let pnlPct = 0;
  let pnlUnavailable = false;
  if (buyPrice > 0 && capital > 0) {
    shares = capital / buyPrice;
    if (curr != null && curr > 0) {
      valueNow = shares * curr;
      pnlEur = valueNow - capital;
      pnlPct = ((curr - buyPrice) / buyPrice) * 100;
    } else {
      pnlUnavailable = true;
      const sheetPct = sheetPnlPct(r);
      const sheetEur = parseNum(r["P&L ($)"]);
      if (sheetPct !== null) pnlPct = sheetPct;
      if (sheetEur !== null) pnlEur = sheetEur;
    }
  }
  return {
    key,
    ticker,
    name: String(r.Nome ?? r.Company ?? r["Società"] ?? ""),
    completionDate: cd,
    currPrice: curr,
    buyPrice,
    capital,
    shares,
    valueNow,
    pnlEur,
    pnlPct,
    pnlUnavailable,
  };
}

/** Riga con posizione simulata attiva (locale o foglio, rispettando ignoreSheet). */
export function rowHasActivePortfolio(
  row: Record<string, unknown>,
  inputs: InvestSimInputs
): boolean {
  const pos = computeSimulationPosition(row, inputs);
  return pos != null && pos.capital > 0 && pos.buyPrice > 0;
}

export function buildPositions(
  simTable: SheetTable | null,
  inputs: InvestSimInputs
): SimulationPosition[] {
  const rows = simTable?.rows ?? [];
  const out: SimulationPosition[] = [];
  for (const r of rows) {
    const p = computeSimulationPosition(r, inputs);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Riempie colonne formula vuote nello snapshot JSON (Excel: formule non valutate con data_only).
 */
export function enrichSimulationRow(
  r: Record<string, unknown>,
  inputs: InvestSimInputs
): Record<string, unknown> {
  const pos = computeSimulationPosition(r, inputs);
  if (!pos || pos.buyPrice <= 0 || pos.capital <= 0) return r;

  const out: Record<string, unknown> = { ...r };

  if (isSheetCellEmpty(r["N° Azioni Implicite"])) {
    out["N° Azioni Implicite"] = pos.shares;
  }

  if (pos.pnlUnavailable) {
    if (isSheetCellEmpty(r["Valore Attuale ($)"])) out["Valore Attuale ($)"] = "N/D";
    if (isSheetCellEmpty(r["P&L ($)"])) out["P&L ($)"] = "N/D";
    if (isSheetCellEmpty(r["P&L (%)"])) out["P&L (%)"] = "N/D";
    out.__simPnlMissing = true;
  } else if (pos.shares > 0) {
    if (isSheetCellEmpty(r["Valore Attuale ($)"])) out["Valore Attuale ($)"] = pos.valueNow;
    if (isSheetCellEmpty(r["P&L ($)"])) out["P&L ($)"] = pos.pnlEur;
    if (isSheetCellEmpty(r["P&L (%)"])) out["P&L (%)"] = pos.pnlPct;
  }

  return out;
}

export function enrichSimulationRows(
  rows: Record<string, unknown>[],
  inputs: InvestSimInputs
): Record<string, unknown>[] {
  return rows.map((r) => enrichSimulationRow(r, inputs));
}

export function enrichSimulationTable(
  table: SheetTable | null,
  inputs: InvestSimInputs
): SheetTable | null {
  if (!table) return null;
  const rows = enrichSimulationRows(table.rows ?? [], inputs);
  return { ...table, rows, row_count: rows.length };
}
