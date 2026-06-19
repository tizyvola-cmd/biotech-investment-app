/**
 * Dashboard — raccomandazioni attive (azioni da fare), filtri e ordinamento.
 */
import type { ChartPoint, SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { SIM_HOT_ZONE_DAYS } from "./cdHorizons";
import { buildSimRowByKeyMap } from "./investSimKeys";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { ackRecommendationAlert, recommendationSignature, meetsRecommendationAlertConfidence } from "./recommendationAlerts";
import type { LossAnalysisProbOptions } from "./portfolioLossAnalysis";
import {
  buildSuggestionMonitorRows,
  isAlertableRecommendation,
  type SuggestionMonitorRow,
} from "./suggestionMonitor";
import {
  computeSimulationPosition,
  computePositionReadingDelta,
  type SimulationPositionContext,
} from "./simulationPosition";
import { resolveReadingDelta } from "./priceReadingCache";
import { resolveExpectedGainPlan } from "./simulationPlanGain";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import { computeRecommendationGainIdea } from "./recommendationGainIdea";
import {
  classifyDealTemperature,
  dealEuroPerDayFromIdea,
} from "./recommendationDealUrgency";
import type { SimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";

export type DashboardRecProfileFilter = "all" | "portfolio" | "opportunity";
export type DashboardRecCdFilter = "all" | "near" | "far";
export type DashboardRecSortMode = "score" | "recent" | "deal";

export type DashboardRecommendationRow = SuggestionMonitorRow & {
  companyName: string;
  currPriceUsd: number | null;
  readingPct: number | null;
  readingPriorTs: string | null;
  readingCurrentTs: string | null;
  readingSource: "last_read" | "market_close" | "portfolio_history" | null;
  isNew: boolean;
  recommendationScorePct: number | null;
  dealEuroPerDay: number;
  dealTemperature: "hot" | "cold" | null;
  dealGainEur: number;
};

const DISMISSED_KEY = "supernova_dashboard_rec_dismissed_v1";

function loadSeenSignatures(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("supernova_recommendation_alerts_seen_v1");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function loadDismissedMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveDismissedMap(map: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(map));
  } catch {
    /* quota */
  }
}

/** Segna tutte le raccomandazioni visibili come riviste (chiude il delta visit rec). */
export function ackDashboardRecommendations(rows: SuggestionMonitorRow[]): void {
  for (const row of rows) {
    ackRecommendationAlert(row.key, recommendationSignature(row));
  }
}

export function dashboardRecommendationsKeySig(rows: SuggestionMonitorRow[]): string {
  return rows
    .map((r) => `${r.key}:${recommendationSignature(r)}`)
    .sort()
    .join("|");
}

/** Segna raccomandazione come gestita (X) — riappare se cambia firma/logica. */
export function dismissDashboardRecommendation(row: SuggestionMonitorRow): void {
  const sig = recommendationSignature(row);
  ackRecommendationAlert(row.key, sig);
  const map = loadDismissedMap();
  map[row.key] = sig;
  saveDismissedMap(map);
}

/** Raccomandazione ancora da eseguire (investi / disinvesti / hold attivo / trim synth). */
export function isPendingRecommendationAction(row: SuggestionMonitorRow): boolean {
  if (!isAlertableRecommendation(row)) {
    if (
      row.suggestedAction === "review" &&
      row.hasPosition &&
      row.profile === "portfolio" &&
      row.synthExposureKind === "trim_review"
    ) {
      return true;
    }
    return false;
  }
  if (row.suggestedAction === "buy" && !row.hasPosition) return true;
  if (row.suggestedAction === "sell" && row.hasPosition) return true;
  if (row.suggestedAction === "hold" && row.hasPosition) return true;
  if (
    row.suggestedAction === "review" &&
    row.hasPosition &&
    row.synthExposureKind === "trim_review"
  ) {
    return true;
  }
  return false;
}

function dailyPctFromSimRow(simRow: Record<string, unknown> | null | undefined): number | null {
  if (!simRow) return null;
  for (const col of ["Var. Giorn. %", "Var. Giorn.%", "Var. Giornaliera %"]) {
    const raw = simRow[col];
    if (raw == null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function companyFromSimRow(simRow: Record<string, unknown> | null | undefined): string {
  if (!simRow) return "";
  return String(
    simRow.Company ?? simRow.company ?? simRow.Società ?? simRow["Company Name"] ?? "",
  ).trim();
}

export function matchesDashboardRecCdFilter(
  daysToCd: number | null,
  filter: DashboardRecCdFilter,
): boolean {
  if (filter === "all") return true;
  if (daysToCd == null || !Number.isFinite(daysToCd) || daysToCd < 0) {
    return filter === "far";
  }
  if (filter === "near") return daysToCd <= SIM_HOT_ZONE_DAYS;
  return daysToCd > SIM_HOT_ZONE_DAYS;
}

export function matchesDashboardRecProfileFilter(
  profile: "portfolio" | "opportunity",
  filter: DashboardRecProfileFilter,
): boolean {
  if (filter === "all") return true;
  return profile === filter;
}

export function sortDashboardRecommendations(
  rows: DashboardRecommendationRow[],
  mode: DashboardRecSortMode,
): DashboardRecommendationRow[] {
  const actionRank = (a: SuggestionMonitorRow["suggestedAction"]) =>
    a === "sell" ? 0 : a === "hold" ? 1 : 2;

  return [...rows].sort((a, b) => {
    if (mode === "deal") {
      const tempRank = (t: DashboardRecommendationRow["dealTemperature"]) =>
        t === "hot" ? 2 : t === "cold" ? 1 : 0;
      const ta = tempRank(a.dealTemperature);
      const tb = tempRank(b.dealTemperature);
      if (tb !== ta) return tb - ta;
      if (a.dealTemperature === "hot" && b.dealTemperature === "hot") {
        const da = a.dealEuroPerDay ?? 0;
        const db = b.dealEuroPerDay ?? 0;
        if (db !== da) return db - da;
      }
      if (a.dealTemperature === "cold" && b.dealTemperature === "cold") {
        const ga = a.dealGainEur ?? 0;
        const gb = b.dealGainEur ?? 0;
        if (gb !== ga) return gb - ga;
      }
    }
    if (mode === "recent") {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      const ar = actionRank(a.suggestedAction);
      const br = actionRank(b.suggestedAction);
      if (ar !== br) return ar - br;
      const da = a.daysToCd ?? 9999;
      const db = b.daysToCd ?? 9999;
      if (da !== db) return da - db;
    }
    const sa = a.recommendationScorePct ?? -1;
    const sb = b.recommendationScorePct ?? -1;
    if (sb !== sa) return sb - sa;
    const ar = actionRank(a.suggestedAction);
    const br = actionRank(b.suggestedAction);
    if (ar !== br) return ar - br;
    return a.ticker.localeCompare(b.ticker);
  });
}

export function buildDashboardRecommendationRows(opts: {
  simTable: SheetTable | null | undefined;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  lang: "it" | "en";
  probOptions: LossAnalysisProbOptions | null;
  simTableVersion?: string | null;
  profileFilter: DashboardRecProfileFilter;
  cdFilter: DashboardRecCdFilter;
  sortMode: DashboardRecSortMode;
  synthAlloc?: SimLoopSynthAllocation | null;
}): DashboardRecommendationRow[] {
  if (!opts.simTable?.rows?.length) return [];

  const monitorRows = buildSuggestionMonitorRows({
    simTable: opts.simTable,
    inputs: opts.inputs,
    pointsBySeriesKey: opts.pointsBySeriesKey,
    lang: opts.lang,
    probOptions: opts.probOptions,
    paperPortfolio: [],
    synthAlloc: opts.synthAlloc,
  });

  const simRowByKey = buildSimRowByKeyMap(opts.simTable.rows);
  const seen = loadSeenSignatures();
  const dismissed = loadDismissedMap();
  const posCtx: SimulationPositionContext = { history: opts.history };

  const enriched: DashboardRecommendationRow[] = [];

  for (const row of monitorRows) {
    if (!isPendingRecommendationAction(row)) continue;
    if (!meetsRecommendationAlertConfidence(row)) continue;

    const sig = recommendationSignature(row);
    if (dismissed[row.key] === sig) continue;
    if (!matchesDashboardRecProfileFilter(row.profile, opts.profileFilter)) continue;
    if (!matchesDashboardRecCdFilter(row.daysToCd, opts.cdFilter)) continue;

    const simRow = simRowByKey.get(row.key) ?? null;
    const pos = simRow ? computeSimulationPosition(simRow, opts.inputs, posCtx) : null;
    const currPrice =
      pos?.currPrice ??
      (simRow ? Number(simRow["Prezzo Corrente ($)"]) : NaN);
    const currPriceUsd =
      currPrice != null && Number.isFinite(currPrice) && currPrice > 0 ? currPrice : null;

    const portfolioReadingRaw =
      pos && currPriceUsd != null
        ? computePositionReadingDelta(currPriceUsd, opts.history, row.key)
        : null;
    const portfolioReading = portfolioReadingRaw
      ? {
          pct: portfolioReadingRaw.pnlPct,
          priorTs: portfolioReadingRaw.priorTs,
          currentTs: null,
        }
      : undefined;

    const reading = resolveReadingDelta(row.key, currPriceUsd, portfolioReading, {
      marketDayClosePct: dailyPctFromSimRow(simRow),
    });

    const chartPts = chartPointsForKey(simRow, opts.pointsBySeriesKey);
    const gainPlan = gainPlanForRecommendationRow(simRow, opts.inputs, row.key, chartPts);
    const cap =
      opts.inputs[row.key]?.capital && opts.inputs[row.key]!.capital > 0
        ? opts.inputs[row.key]!.capital
        : DEFAULT_PLAN_CAPITAL_EUR;
    const gainIdea = computeRecommendationGainIdea({
      simRow,
      chartPoints: chartPts,
      capitalEur: cap,
      miiAngleDeg: row.miiAngleDeg,
      planReturnPct: row.planReturnPct ?? gainPlan.targetReturnPct,
      daysToTarget: gainPlan.daysToTarget,
      suggestedAction: row.suggestedAction,
      targetProvisional: gainPlan.targetProvisional,
    });

    enriched.push({
      ...row,
      companyName: row.company || companyFromSimRow(simRow),
      currPriceUsd,
      readingPct: reading.pct,
      readingPriorTs: reading.priorTs,
      readingCurrentTs: reading.currentTs,
      readingSource: reading.source ?? null,
      isNew: seen[row.key] !== sig,
      recommendationScorePct:
        row.probPct != null && Number.isFinite(row.probPct) ? row.probPct : null,
      dealEuroPerDay: dealEuroPerDayFromIdea(gainIdea),
      dealTemperature: classifyDealTemperature(gainIdea.gainEur, gainIdea.days),
      dealGainEur: gainIdea.gainEur ?? 0,
    });
  }

  return sortDashboardRecommendations(enriched, opts.sortMode);
}

export function gainPlanForRecommendationRow(
  simRow: Record<string, unknown> | null | undefined,
  inputs: InvestSimInputs,
  key: string,
  chartPts: ChartPoint[] | null,
): ReturnType<typeof resolveExpectedGainPlan> {
  const inp = inputs[key];
  const cap = inp?.capital && inp.capital > 0 ? inp.capital : DEFAULT_PLAN_CAPITAL_EUR;
  return resolveExpectedGainPlan(simRow ?? undefined, cap, { chartPoints: chartPts });
}

export function chartPointsForKey(
  simRow: Record<string, unknown> | null | undefined,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
): ChartPoint[] | null {
  if (!simRow) return null;
  const sk = simulationRowSeriesKey(simRow);
  return sk ? pointsBySeriesKey.get(sk) ?? null : null;
}
