import type { ChartPoint, ChartSeries } from "../types";
import { resolvePriceVariationHorizons } from "./priceVariationHorizons";
import { resolveVarHorizonPct } from "./simulationStyles";

function parsePct(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "—") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ".").replace(/%/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function varFromRow(row: Record<string, unknown>, ...cols: string[]): number | null {
  for (const c of cols) {
    if (c in row) {
      const n = parsePct(row[c]);
      if (n != null) return n;
    }
    const key = Object.keys(row).find((k) => k.toLowerCase() === c.toLowerCase());
    if (key) {
      const n = parsePct(row[key]);
      if (n != null) return n;
    }
  }
  return null;
}

/** Var.% horizons for loss-analysis charts — bundle meta first, then sheet columns. */
export function buildLossAnalysisVarHorizons(
  simRow: Record<string, unknown> | null | undefined,
  chartPts?: ChartPoint[] | null,
  seriesMeta?: Pick<ChartSeries, "var_horizons"> | null,
): { label: string; pct: number | null }[] {
  const meta = seriesMeta?.var_horizons;
  if (meta?.length) return meta;

  const row = simRow ?? {};
  const priceVar = resolvePriceVariationHorizons(row, chartPts, seriesMeta ?? null);

  return [
    { label: "6M", pct: varFromRow(row, "Var. 6M %", "Var. 6M%") },
    { label: "3M", pct: varFromRow(row, "Var. 3M %", "Var. 3M%") },
    { label: "1M", pct: priceVar.m1 ?? varFromRow(row, "Var. 1M %", "Var. 1M%") },
    { label: "7d", pct: priceVar.d7 },
    { label: "1d", pct: priceVar.d1 },
  ];
}

export function longHorizonVarSeries(
  horizons: { label: string; pct: number | null }[],
  ticker: string,
): {
  id: string;
  label: string;
  color: string;
  horizons: { label: string; pct: number | null }[];
}[] {
  const hasLong = (["6M", "3M", "1M"] as const).some(
    (lab) => resolveVarHorizonPct(horizons, lab) != null,
  );
  if (!hasLong) return [];
  return [
    {
      id: ticker.toLowerCase(),
      label: ticker,
      color: "#2563eb",
      horizons,
    },
  ];
}
