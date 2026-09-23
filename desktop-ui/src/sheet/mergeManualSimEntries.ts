import type { SheetTable } from "../types";
import { mergeHypeFunnelRowsIntoTable } from "./mergeHypeFunnelRows";
import { normalizedRowKey } from "./investSimKeys";

/**
 * Re-inject ``data/manual_sim_entries.json`` rows (CPIX / GPCR / CMPX).
 *
 * Same rule as ``excel_sheet_reader._merge_manual_sim_entries``: append only
 * when ``Ticker|normalized CD`` is missing. Raw ``simulation_sheet_snapshot.json``
 * never stores these, so a local preview without this merge drops open-book
 * names from Pulse OPEN POSITIONS until the API snapshot returns.
 */
export function mergeManualSimEntriesIntoTable(
  table: SheetTable | null | undefined,
  entries: Array<Record<string, unknown>> | null | undefined,
): SheetTable | null {
  if (!table?.rows) return table ?? null;
  if (!entries?.length) return table;

  const existing = new Set<string>();
  for (const row of table.rows) {
    const tk = String(row.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    existing.add(normalizedRowKey(tk, row["Completion Date"]));
  }

  const extra: Record<string, unknown>[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const tk = String(raw.Ticker ?? raw.ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    const key = normalizedRowKey(tk, raw["Completion Date"]);
    if (existing.has(key)) continue;
    extra.push({ ...raw, Ticker: tk, _manual: true });
    existing.add(key);
  }
  if (!extra.length) return table;
  const rows = [...table.rows, ...extra];
  return {
    ...table,
    rows,
    row_count: rows.length,
  };
}

/** Append calendar-catalyst rows by Ticker|CD; stamp the flag when the same CD already exists. */
export function mergeCatalystSimEntriesIntoTable(
  table: SheetTable | null | undefined,
  entries: Array<Record<string, unknown>> | null | undefined,
): SheetTable | null {
  if (!table?.rows) return table ?? null;
  if (!entries?.length) return table;

  const rows = table.rows.map((row) => ({ ...row }));
  const existingKeys = new Set<string>();
  for (const row of rows) {
    const tk = String(row.Ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    existingKeys.add(normalizedRowKey(tk, row["Completion Date"]));
  }

  const extra: Record<string, unknown>[] = [];
  let stamped = false;
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const tk = String(raw.Ticker ?? raw.ticker ?? "").trim().toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    const key = normalizedRowKey(tk, raw["Completion Date"]);
    const idx = rows.findIndex(
      (row) =>
        normalizedRowKey(String(row.Ticker ?? ""), row["Completion Date"]) === key,
    );
    if (idx >= 0) {
      if (rows[idx]["guidance_calendar_catalyst"] !== true) {
        rows[idx] = { ...rows[idx], guidance_calendar_catalyst: true };
        stamped = true;
      }
      continue;
    }
    extra.push({ ...raw, Ticker: tk, guidance_calendar_catalyst: true });
    existingKeys.add(key);
  }
  if (!extra.length && !stamped) return table;
  const nextRows = extra.length ? [...rows, ...extra] : rows;
  return {
    ...table,
    rows: nextRows,
    row_count: nextRows.length,
  };
}

/** Hype + catalyst + manual sidecars — keep Pulse / Pick stocks stable during snapshot preview. */
export function applySimulationSidecarRows(
  table: SheetTable | null | undefined,
  opts?: {
    hypeEntries?: Array<Record<string, unknown>> | null;
    catalystEntries?: Array<Record<string, unknown>> | null;
    manualEntries?: Array<Record<string, unknown>> | null;
  },
): SheetTable | null {
  const withHype = mergeHypeFunnelRowsIntoTable(table, opts?.hypeEntries) ?? table ?? null;
  const withCat = mergeCatalystSimEntriesIntoTable(withHype, opts?.catalystEntries) ?? withHype;
  return mergeManualSimEntriesIntoTable(withCat, opts?.manualEntries) ?? withCat;
}
