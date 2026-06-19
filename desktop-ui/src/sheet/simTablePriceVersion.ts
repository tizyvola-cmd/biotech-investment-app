import type { SheetTable } from "../types";
import type { InvestSimInputs } from "./investSimStorage";
import { reconcileInvestSimInputs, normalizedRowKey } from "./investSimKeys";
import type { SimTablePriceRow } from "./priceReadingCache";

/** Firma tabella Simulation per rilevare refresh prezzi (manifest / reload). */
export function buildSimTablePriceVersion(
  simTable: SheetTable | null | undefined,
  inputs: InvestSimInputs,
): string {
  if (!simTable?.rows?.length) return "";
  const merged = reconcileInvestSimInputs(inputs, simTable.rows);
  const inputParts = Object.keys(merged)
    .sort()
    .map((k) => `${k}:${merged[k]?.capital ?? ""}:${merged[k]?.buyPrice ?? ""}`);
  const parts = [String(simTable.row_count ?? simTable.rows.length)];
  for (const r of simTable.rows) {
    const tk = String(r.Ticker ?? "");
    if (!tk || tk.includes("TOTALE")) continue;
    parts.push(`${tk}:${String(r["Prezzo Corrente ($)"] ?? "")}`);
  }
  return `${parts.join("|")}#${inputParts.join("|")}`;
}

function parseDailyPctFromRow(row: Record<string, unknown>): number | null {
  for (const col of ["Var. Giorn. %", "Var. Giorn.%", "Var. Giornaliera %"]) {
    const raw = row[col];
    if (raw == null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function simTablePriceRows(rows: SheetTable["rows"]): SimTablePriceRow[] {
  const out: SimTablePriceRow[] = [];
  for (const row of rows ?? []) {
    const ticker = String(row.Ticker ?? "").trim().toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;
    const raw = row["Prezzo Corrente ($)"];
    const priceUsd = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(",", "."));
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) continue;
    out.push({
      key: normalizedRowKey(ticker, row["Completion Date"]),
      priceUsd,
      dailyPct: parseDailyPctFromRow(row),
    });
  }
  return out;
}
