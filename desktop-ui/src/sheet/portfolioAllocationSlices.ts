/**
 * Open-book capital allocation slices for the Home portfolio pie.
 */
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { buildPositions, rowHasActivePortfolio } from "./simulationPosition";
import { buildSimRowByKeyMap } from "./investSimKeys";
import type { SheetTable } from "../types";

export type PortfolioAllocationSlice = {
  key: string;
  ticker: string;
  capitalEur: number;
  pct: number;
};

/** Distinct, non-purple palette for pie slices (readable on light/dark). */
export const PORTFOLIO_ALLOCATION_COLORS = [
  "#0d9488", // teal
  "#2563eb", // blue
  "#ca8a04", // gold
  "#dc2626", // red
  "#059669", // green
  "#ea580c", // orange
  "#0891b2", // cyan
  "#b45309", // amber
  "#4d7c0f", // lime
  "#be123c", // rose
  "#0f766e", // dark teal
  "#1d4ed8", // indigo-ish blue
];

export function buildPortfolioAllocationSlices(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  history?: InvestSimHistoryPoint[] | null,
): PortfolioAllocationSlice[] {
  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const positions = buildPositions(simTable, inputs, history ?? undefined);
  const byTicker = new Map<string, { key: string; capital: number }>();

  for (const p of positions) {
    if (!(p.capital > 0)) continue;
    const row = rowByKey.get(p.key);
    if (row && !rowHasActivePortfolio(row, inputs)) continue;
    const tk = p.ticker.trim().toUpperCase();
    if (!tk) continue;
    const prev = byTicker.get(tk);
    if (prev) {
      prev.capital += p.capital;
    } else {
      byTicker.set(tk, { key: p.key, capital: p.capital });
    }
  }

  const total = [...byTicker.values()].reduce((s, x) => s + x.capital, 0);
  if (total <= 0) return [];

  return [...byTicker.entries()]
    .map(([ticker, v]) => ({
      key: v.key,
      ticker,
      capitalEur: Math.round(v.capital * 100) / 100,
      pct: Math.round((v.capital / total) * 1000) / 10,
    }))
    .sort((a, b) => b.capitalEur - a.capitalEur);
}
