import type { SheetTable } from "../types";

/** Ticker validi dal foglio Simulation (esclude totali / righe sezione). */
export function tickersFromSimulationTable(sim: SheetTable | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of sim?.rows ?? []) {
    const t = String(row.Ticker ?? row.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!looksLikeTicker(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.sort();
}

export function looksLikeTicker(sym: string): boolean {
  if (!sym || sym.startsWith("──")) return false;
  if (/\s/.test(sym) || sym.includes("TOTALE") || sym.includes("PORTAFOGLIO")) return false;
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(sym);
}
