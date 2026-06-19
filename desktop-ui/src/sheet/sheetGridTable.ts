/**

 * Griglie foglio — colonne uniformi, header allineati ai dati.

 *

 * Uso standard:

 * ```tsx

 * import { SHEET_GRID_TABLE_CLASS, SheetGridColgroup, sheetGridThClassAlign, sheetGridTdClassAlign, sheetGridAlignForColumn } from "./sheetGridTable";

 *

 * <table className={SHEET_GRID_TABLE_CLASS}>

 *   <SheetGridColgroup columnCount={6} />

 *   <th className={sheetGridThClassAlign("left")}>Ticker</th>

 *   <td className={sheetGridTdClassAlign("center")}>…</td>

 * </table>

 * ```

 */



export type SheetGridAlign = "left" | "center" | "right";



/** Classe base per tutte le tabelle dell'app. */

export const SHEET_GRID_TABLE_CLASS =

  "sheet-grid-table w-full border-collapse table-fixed";

/** Financial — molte colonne: larghezza naturale + scroll orizzontale nel contenitore. */

export const FINANCIAL_SHEET_TABLE_CLASS =

  "sheet-grid-table financial-sheet-table border-collapse whitespace-nowrap";



const ALIGN_CLASS: Record<SheetGridAlign, string> = {

  left: "sheet-grid-col-left",

  center: "sheet-grid-col-center",

  right: "sheet-grid-col-right",

};



/** Larghezze % (somma 100) — Performance / Price Δ% (12 colonne). */

export const VARIATIONS_GRID_COL_PCT = [
  3, 7, 9, 8, 7, 7, 6, 6, 6, 6, 10, 12, 13,
] as const;



/** Larghezze % (somma 100) — Simulation workspace full (10 colonne). */

export const SIM_FULL_GRID_COL_PCT = [

  4, 7, 8, 11, 9, 11, 12, 10, 11, 11, 6,

] as const;

/** Decision Lab Performance — 13 colonne (+ synth cap). */
export const DECISION_LAB_GRID_COL_COUNT = 13;
export const DECISION_LAB_GRID_COL_PCT: readonly number[] = equalGridColPct(
  DECISION_LAB_GRID_COL_COUNT,
);

/** Simulation workspace full — senza curva; Δ lettura + Δ ingresso + synth cap (14 cols). */
export const SIM_WORKSPACE_FULL_GRID_COL_PCT = [
  4, 7, 7, 10, 7, 6, 6, 10, 9, 9, 8, 8, 5, 4,
] as const;

/** SuperNova SDS score table (10 cols). */
export const SDS_SCORE_GRID_COL_PCT = [
  15, 10, 10, 7, 7, 8, 9, 9, 9, 6,
] as const;



/** Larghezze % (somma 100) — Dashboard portfolio (6 colonne). */

export const DASHBOARD_GRID_COL_PCT = [18, 14, 14, 12, 24, 18] as const;



/** MII tab — ticker, curva, inclinometro MII, calib, gate, ΔP, vol, indice raw. */
export const MIG_INTEREST_GRID_COL_PCT = [10, 12, 16, 11, 8, 8, 9, 8, 18] as const;

/** Larghezze % (somma 100) — Slope errors overview (10 colonne con prezzi). */
export const SLOPE_OVERVIEW_GRID_COL_PCT = [
  4, 8, 20, 20, 10, 10, 10, 6, 6, 6,
] as const;

/** Larghezze % — Slope events detail (base 9 col + opzionali). */
export const SLOPE_EVENTS_GRID_COL_PCT = [
  4, 8, 18, 18, 10, 10, 10, 8, 6, 8,
] as const;

export type SheetGridColKey =

  | "sel"

  | "cd"

  | "ticker"

  | "rascore"

  | "trajectory"

  | "model_today"

  | "real_today"

  | "gap_vs_curve"

  | "d1"

  | "d7"

  | "m1"

  | "roi_cd"

  | "slope_delta"

  | "actions"

  | "curva"

  | "pnl_reading"

  | "pnl_entry"

  | "px"

  | "target"

  | "target_roi"

  | "buy"

  | "cap"

  | "synth_cap"

  | "score"

  | "risk"

  | "var_spark"

  | "last_read"

  | "roi_sn"

  | "sds"

  | "mig_slope"

  | "mig_curve"

  | "mig_delta"

  | "mig_vol"

  | "mig_mii"

  | "mig_gate"

  | "mig_pnl24h"

  | "mig_calib"

  | "mig_calib_pre"

  | "mig_calib_post";



const LEFT_COL_KEYS = new Set<SheetGridColKey>(["ticker", "cd"]);



function alignForColKey(col: SheetGridColKey): SheetGridAlign {

  return LEFT_COL_KEYS.has(col) ? "left" : "center";

}



/** Distribuisce 100% in modo uniforme tra N colonne. */

export function equalGridColPct(columnCount: number): number[] {

  if (columnCount <= 0) return [];

  const each = Math.floor((10000 / columnCount)) / 100;

  const widths = Array.from({ length: columnCount }, () => each);

  const sum = widths.reduce((a, b) => a + b, 0);

  widths[widths.length - 1] =

    Math.round((widths[widths.length - 1]! + (100 - sum)) * 100) / 100;

  return widths;

}



/** Normalizza larghezze arbitrarie a somma 100%. */

export function normalizeGridColPct(widths: readonly number[]): number[] {

  const sum = widths.reduce((a, b) => a + b, 0);

  if (sum <= 0) return equalGridColPct(widths.length);

  return widths.map((w) => Math.round((w / sum) * 10000) / 100);

}



/** Allineamento euristico da etichetta colonna (header Excel o UI). */

export function sheetGridAlignForLabel(label: string): SheetGridAlign {

  const norm = label.replace(/\n/g, " ").trim().toLowerCase();

  if (!norm) return "center";

  if (

    /^(ticker|cd|completion|company|name|drug|event|type|module|kind|week|trigger|when|tester|direction|dir|regime|detected|verdict|outcome|sponsor|reason|note|payload|node|run time|run|pos\.|position|brief|summary|indicators|link|azioni|actions?)$/.test(

      norm,

    ) ||

    norm.includes("exclusion") ||

    norm.includes("ticker") ||

    norm.includes("company") ||

    (norm.includes("date") && !norm.includes("roi"))

  ) {

    return "left";

  }

  return "center";

}



/** Allineamento per colonne foglio Excel (ConfigurableSheetGrid). */

export function sheetGridAlignForColumn(column: string): SheetGridAlign {

  const norm = column.replace(/\n/g, " ").trim();

  if (norm === "Ticker") return "left";

  if (

    norm === "Completion Date" ||

    norm === "CD" ||

    norm.startsWith("Prima data") ||

    norm.startsWith("Data filing") ||

    norm === "Exact·Partial vs Unmatch" ||

    (norm.toLowerCase().includes("sponsor") && norm.toLowerCase().includes("match"))

  ) {

    return "left";

  }

  return "center";

}



export function sheetGridColAlignClass(align: SheetGridAlign): string {

  return ALIGN_CLASS[align];

}



export function sheetGridThClassAlign(align: SheetGridAlign = "center"): string {

  return `sheet-grid-th ${ALIGN_CLASS[align]}`;

}



export function sheetGridTdClassAlign(

  align: SheetGridAlign = "center",

  extra = "",

): string {

  return `sheet-grid-td ${ALIGN_CLASS[align]} tabular-nums${extra ? ` ${extra}` : ""}`;

}



/** @deprecated prefer sheetGridThClassAlign — mantiene compat Performance layout */

export function sheetGridColAlignClassFromKey(col: SheetGridColKey): string {

  return sheetGridColAlignClass(alignForColKey(col));

}



export function sheetGridThClass(col: SheetGridColKey): string {

  return sheetGridThClassAlign(alignForColKey(col));

}



export function sheetGridTdClass(col: SheetGridColKey): string {

  return sheetGridTdClassAlign(alignForColKey(col));

}

/** Intestazione colonna con padding standard. */
export function gridTh(align: SheetGridAlign = "center", extra = "py-1.5 font-medium"): string {
  return `${sheetGridThClassAlign(align)} ${extra}`;
}

/** Cella dati con padding standard. */
export function gridTd(align: SheetGridAlign = "center", extra = "py-1.5"): string {
  return `${sheetGridTdClassAlign(align)} ${extra}`;
}

