// Build PortfolioBuilderDeal[] from a real simTable + investInputs.
// Reuses the same suggestion-monitor pipeline used by the dashboard,
// so RA / SDS / planProb / planReturn are exactly what the user sees elsewhere.

import type { SheetTable, ChartPoint } from "../types";
import type { InvestSimInputs } from "./investSimStorage";
import { buildSuggestionMonitorRows } from "./suggestionMonitor";
import type { LossAnalysisProbOptions } from "./portfolioLossAnalysis";
import { buildSimRowByKeyMap } from "./investSimKeys";
import type { PortfolioBuilderDeal } from "./portfolioBuilderTypes";

const DEFAULT_CAPITAL = 5000;

function asNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.\-+eE]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function readPhase(row: Record<string, unknown>): string {
  const candidates = [
    "Fase Clinica",
    "Phase",
    "Fase",
    "Clinical Phase",
    "Stage",
  ];
  for (const k of candidates) {
    const v = row[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "—";
}

function readSector(row: Record<string, unknown>): string {
  const candidates = ["Sector", "Settore", "Therapeutic Area", "Area"];
  for (const k of candidates) {
    const v = row[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "Biotech";
}

function readPrice(row: Record<string, unknown>): number | null {
  const candidates = [
    "Prezzo Corrente ($)",
    "Current Price",
    "Price",
    "Prezzo",
    "Last Price",
  ];
  for (const k of candidates) {
    const n = asNumber(row[k]);
    if (n != null && n > 0) return n;
  }
  return null;
}

export function buildPortfolioBuilderDeals(opts: {
  simTable: SheetTable | null | undefined;
  inputs: InvestSimInputs;
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  lang: "it" | "en";
  probOptions?: LossAnalysisProbOptions | null;
}): PortfolioBuilderDeal[] {
  if (!opts.simTable?.rows?.length) return [];

  const monitor = buildSuggestionMonitorRows({
    simTable: opts.simTable,
    inputs: opts.inputs,
    pointsBySeriesKey: opts.pointsBySeriesKey,
    lang: opts.lang,
    probOptions: opts.probOptions ?? null,
    paperPortfolio: [],
  });

  const simByKey = buildSimRowByKeyMap(opts.simTable.rows);

  const deals: PortfolioBuilderDeal[] = [];
  for (const row of monitor) {
    // Only buyable opportunities (or in-portfolio positions worth re-evaluating).
    if (row.suggestedAction === "sell") continue;
    const isBuy = row.suggestedAction === "buy";
    const isHighScore = (row.probPct ?? 0) >= 50;
    if (!isBuy && !isHighScore && !row.hasPosition) continue;

    const simRow = simByKey.get(row.key);
    const phase = simRow ? readPhase(simRow) : "—";
    const sector = simRow ? readSector(simRow) : "Biotech";
    const currPriceUsd = simRow ? readPrice(simRow) : null;

    const userCap = opts.inputs[row.key]?.capital;
    const suggestedCapital =
      userCap != null && userCap > 0 ? userCap : DEFAULT_CAPITAL;

    const planReturnPct =
      row.planReturnPct != null && Number.isFinite(row.planReturnPct)
        ? row.planReturnPct
        : (row.planCdReturnPct ?? 25);

    deals.push({
      ticker: row.ticker,
      company: row.company || "",
      raScore: row.raScore,
      sdsScore: row.sdsScore,
      phase,
      sector,
      daysToCD: row.daysToCd ?? 30,
      suggestedCapital: Math.round(suggestedCapital),
      selectedCapital: Math.round(suggestedCapital),
      selected: row.hasPosition || (isBuy && (row.probPct ?? 0) >= 60),
      planProbPct: row.probPct ?? 50,
      planReturnPct: Number.isFinite(planReturnPct) ? planReturnPct : 25,
      currPriceUsd,
      inPortfolio: row.hasPosition,
    });
  }

  // Sort by highest probability × planReturnPct (expected value).
  deals.sort((a, b) => {
    const evA = (a.planProbPct / 100) * (a.planReturnPct ?? 0);
    const evB = (b.planProbPct / 100) * (b.planReturnPct ?? 0);
    return evB - evA;
  });

  return deals;
}
