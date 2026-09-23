/**
 * Open-book capital allocation slices for the mobile dashboard pie.
 * Must match the Open positions table — same invested capital per ticker.
 */
import { buildMobileDashOpenPositions } from "./mobileDashWindTable";
import type { InvestSimInputs, SheetTable } from "./types";
import type { MobileDashboardSnapshot } from "./dashboardTypes";

export type MobileAllocationSlice = {
  key: string;
  ticker: string;
  capitalEur: number;
  pct: number;
};

export const MOBILE_ALLOCATION_COLORS = [
  "#0d9488",
  "#2563eb",
  "#ca8a04",
  "#dc2626",
  "#059669",
  "#ea580c",
  "#0891b2",
  "#b45309",
  "#4d7c0f",
  "#be123c",
  "#0f766e",
  "#1d4ed8",
];

type OpenCapRow = {
  key: string;
  ticker: string;
  invested: number;
};

/** Aggregate open-row invested capital by ticker (same total as the open table). */
export function allocationSlicesFromOpenRows(
  rows: OpenCapRow[] | null | undefined,
): MobileAllocationSlice[] {
  const byTicker = new Map<string, { key: string; capital: number }>();
  for (const r of rows ?? []) {
    if (!r || !(r.invested > 0)) continue;
    const tk = String(r.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk) continue;
    const prev = byTicker.get(tk);
    if (prev) {
      prev.capital += r.invested;
    } else {
      byTicker.set(tk, { key: r.key, capital: r.invested });
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

/**
 * Prefer live open rows (dashboard table). Snapshot allocation only when no
 * open rows were supplied — never mix operator Pulse pie with a tester book.
 */
export function buildMobilePortfolioAllocation(
  sheet: SheetTable | null,
  inputs: InvestSimInputs,
  dashSnapshot?: MobileDashboardSnapshot | null,
  openRows?: OpenCapRow[] | null,
): MobileAllocationSlice[] {
  if (openRows != null) {
    return allocationSlicesFromOpenRows(openRows);
  }

  const fromSnap = dashSnapshot?.allocation;
  if (Array.isArray(fromSnap) && fromSnap.length > 0) {
    return fromSnap
      .filter(
        (s) =>
          s &&
          typeof s.ticker === "string" &&
          Number.isFinite(s.capitalEur) &&
          s.capitalEur > 0,
      )
      .map((s) => ({
        key: String(s.key || s.ticker),
        ticker: String(s.ticker).trim().toUpperCase(),
        capitalEur: Math.round(Number(s.capitalEur) * 100) / 100,
        pct: Number(s.pct) || 0,
      }))
      .sort((a, b) => b.capitalEur - a.capitalEur);
  }

  // Same authority as Open positions when snapshot pie is absent.
  const liveOpens = buildMobileDashOpenPositions(
    sheet,
    inputs,
    undefined,
    "en",
    true,
    dashSnapshot?.openPositions,
    dashSnapshot?.allocation,
  );
  return allocationSlicesFromOpenRows(liveOpens);
}
