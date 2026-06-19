import type { InvestSimInputs, SheetTable } from "./types";

/** Firma tabella Simulation — cambia quando prezzo o Var. Giorn. % cambiano. */
export function computeSimTableVersion(
  sheet: SheetTable | null,
  _inputs: InvestSimInputs = {},
): string {
  if (!sheet?.rows?.length) return "";
  const parts = [String(sheet.row_count ?? sheet.rows.length)];
  for (const r of sheet.rows) {
    const tk = String(r.Ticker ?? "");
    if (!tk || tk.includes("TOTALE")) continue;
    parts.push(
      `${tk}:${String(r["Prezzo Corrente ($)"] ?? "")}:${String(r["Var. Giorn. %"] ?? "")}`,
    );
  }
  return parts.join("|");
}
