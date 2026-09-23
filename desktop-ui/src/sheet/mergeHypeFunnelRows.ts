import type { SheetTable } from "../types";

/** Upsert Hype funnel rows: append missing tickers and refresh the Hype flag. */
export function mergeHypeFunnelRowsIntoTable(
  table: SheetTable | null | undefined,
  entries: Array<Record<string, unknown>> | null | undefined,
): SheetTable | null {
  if (!table?.rows) return table ?? null;
  if (!entries?.length) return table;

  const byTicker = new Map<string, number>();
  const rows = table.rows.map((row, i) => {
    const tk = String(row.Ticker ?? "").trim().toUpperCase();
    if (tk) byTicker.set(tk, i);
    return { ...row };
  });

  let changed = false;
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const tk = String(raw.Ticker ?? raw.ticker ?? "").trim().toUpperCase();
    if (!tk) continue;
    const idx = byTicker.get(tk);
    if (idx != null) {
      const prev = rows[idx]!;
      if (!prev.hype_volume_funnel) {
        rows[idx] = { ...prev, hype_volume_funnel: true };
        changed = true;
      }
      continue;
    }
    rows.push({
      ...raw,
      Ticker: tk,
      hype_volume_funnel: true,
    });
    byTicker.set(tk, rows.length - 1);
    changed = true;
  }
  if (!changed) return table;
  return {
    ...table,
    rows,
  };
}
