import type { DashboardAiFeedItem } from "../components/DashboardAiFeedCard";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { buildDashboardRecommendationRows } from "../sheet/dashboardRecommendationsView";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import {
  recommendationRationale,
  suggestedActionLabel,
} from "../sheet/suggestionMonitor";
import {
  chartPointsForKey,
  gainPlanForRecommendationRow,
} from "../sheet/dashboardRecommendationsView";
import {
  computeRecommendationGainIdea,
  formatRecommendationGainIdeaShort,
} from "../sheet/recommendationGainIdea";
import { extractSparklinePoints } from "../sheet/simulationSparkline";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import { buildCdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";
import { computeCdPatternPriorityIndex } from "../sheet/cdPatternPortfolioPriority";
import { buildPortfolioLossAnalysisItems } from "../sheet/portfolioLossAnalysis";
import {
  buildMobileCurveChartsPayload,
  type MobileCurveChartsPayload,
} from "./mobileCurveChartsPayload";
import type { SdsRoiProfileId } from "../sheet/sdsRoiBlend";
import { DEFAULT_PLAN_CAPITAL_EUR } from "../sheet/expectedRoiDisplay";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import { normNctId } from "../sheet/clinicalSimulationFilter";
import { nctClinicalTrialsUrl, sheetCellAsLink } from "../sheet/cellLinks";
import { daysFromToday } from "../sheet/simulationPlanGain";
import { clinicalKpiFromSimRow, summarizeTickerEis } from "../sheet/tickerEisSummary";
import { resolveModelTargetDisplay } from "../sheet/simRowTargetStop";
import { api } from "./supernova";

function cdMetaFromSimRow(r: Record<string, unknown>): Pick<
  MobileDashboardUpcomingRow,
  "companyName" | "nct" | "studyHref"
> {
  const companyName =
    String(r.Società ?? r.Nome ?? r.Company ?? r["Company Name"] ?? "").trim() || null;
  const studyHref =
    sheetCellAsLink(r["Link studio"])?.href ??
    sheetCellAsLink(r.NCT ?? r.nct)?.href ??
    (() => {
      const nct = normNctId(r.NCT ?? r.nct ?? r["Link studio"]);
      return nct ? nctClinicalTrialsUrl(nct) : null;
    })();
  const nct =
    normNctId(r.NCT ?? r.nct ?? r["Link studio"]) ??
    (studyHref ? normNctId(studyHref) : null);
  return { companyName, nct, studyHref };
}

export type MobilePortfolioCheckSnapshotRow = {
  key: string;
  ticker: string;
  ppi: number | null;
  probPct: number | null;
  gainIdeaText: string | null;
  planReturnPct?: number | null;
  daysToTarget?: number | null;
};

export type MobileDashboardUpcomingRow = {
  ticker: string;
  cd: string;
  days: number | null;
  pred7: number | null;
  companyName: string | null;
  nct: string | null;
  studyHref: string | null;
};

export type MobileDashboardRecRow = {
  key: string;
  ticker: string;
  action: string;
  probPct: number | null;
  reason: string | null;
  readingPct: number | null;
  readingCurrentTs?: string | null;
  planReturnPct: number | null;
  profile: "portfolio" | "opportunity";
  daysToCd: number | null;
  companyName?: string | null;
  currPriceUsd?: number | null;
  gainIdeaText?: string | null;
  scorePct?: number | null;
  isNew?: boolean;
  eisScore?: number | null;
  eisHint?: string | null;
  targetPriceUsd?: number | null;
  targetMode?: "rise" | "fall" | "flat" | null;
  daysToTarget?: number | null;
  curvePoints?: { offset: number; val: number }[];
  curveCharts?: MobileCurveChartsPayload | null;
};

export type MobileDashboardSnapshot = {
  version: number;
  updated_at: string;
  hero: {
    portfolioCount: number;
    opportunityCount: number;
    totalCapital: number;
    nextCdDaysPortfolio: number | null;
    nextCdDaysOpportunities: number | null;
    aiFeedRecentCount: number;
  };
  recommendations: MobileDashboardRecRow[];
  upcoming: {
    portfolio: MobileDashboardUpcomingRow[];
    topOpps: MobileDashboardUpcomingRow[];
  };
  aiFeed: DashboardAiFeedItem[];
  portfolioCheck: MobilePortfolioCheckSnapshotRow[];
};

function pred7FromRow(r: Record<string, unknown>): number | null {
  const raw = r["Δ% vs Pred−60\nPred\n+7"];
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", ".").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

function buildUpcomingFromRows(rows: Record<string, unknown>[]): MobileDashboardUpcomingRow[] {
  return rows
    .map((r) => ({
      ticker: String(r.Ticker ?? ""),
      cd: String(r["Completion Date"] ?? ""),
      days: daysFromToday(String(r["Completion Date"] ?? "")),
      pred7: pred7FromRow(r),
      ...cdMetaFromSimRow(r),
    }))
    .filter((r) => r.days != null && r.days >= 0)
    .sort((a, b) => (a.days ?? 999) - (b.days ?? 999))
    .slice(0, 6);
}

function nextCdDays(rows: Record<string, unknown>[]): number | null {
  return rows.reduce<number | null>((best, r) => {
    const days = daysFromToday(String(r["Completion Date"] ?? ""));
    if (days == null || days < 0) return best;
    return best == null || days < best ? days : best;
  }, null);
}

function buildMobilePortfolioCheckRows(opts: {
  simTable: SheetTable;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  chartBundle: ChartBundle | null;
  probOptions: LossAnalysisProbOptions | null;
  lang: "it" | "en";
  migByKey: ReturnType<typeof buildMigSolidityByKey>;
  pointsBySeriesKey: Map<string, import("../types").ChartPoint[]>;
}): MobilePortfolioCheckSnapshotRow[] {
  const items = buildPortfolioLossAnalysisItems(
    opts.simTable,
    opts.inputs,
    opts.pointsBySeriesKey,
    opts.lang,
    opts.history,
    opts.probOptions,
  ).filter((item) => item.hasPosition);

  const simRowByKey = buildSimRowByKeyMap(opts.simTable.rows);

  return items.map((item) => {
    const simRow = simRowByKey.get(item.key) ?? null;
    const chartPts = item.seriesKey
      ? opts.pointsBySeriesKey.get(item.seriesKey) ?? null
      : null;
    const cap =
      opts.inputs[item.key]?.capital && opts.inputs[item.key]!.capital > 0
        ? opts.inputs[item.key]!.capital
        : DEFAULT_PLAN_CAPITAL_EUR;

    let ppi: number | null = null;
    if (simRow) {
      try {
        const cdRec = buildCdPatternTickerRecommendation({
          row: simRow,
          chartPoints: chartPts,
          investInputs: opts.inputs,
          sdsRows: opts.probOptions?.sdsRows ?? null,
          migByKey: opts.migByKey,
          lang: opts.lang,
          includeEis: false,
        });
        if (cdRec) {
          ppi = computeCdPatternPriorityIndex({ rec: cdRec, inPortfolio: true });
        }
      } catch {
        ppi = null;
      }
    }

    const gainIdea = computeRecommendationGainIdea({
      simRow,
      chartPoints: chartPts,
      capitalEur: cap,
      planReturnPct: item.planReturnPct,
      daysToTarget: item.daysToCurvePeak,
      daysToCurvePeak: item.daysToCurvePeak,
      curvePeakReturnPct: item.curvePeakReturnPct,
      targetProvisional: item.planTargetProvisional,
    });

    return {
      key: item.key,
      ticker: item.ticker,
      ppi,
      probPct: item.recoveryProbabilityPct,
      gainIdeaText: formatRecommendationGainIdeaShort(gainIdea, opts.lang),
      planReturnPct: item.planReturnPct,
      daysToTarget: gainIdea.days ?? item.daysToCurvePeak ?? null,
    };
  });
}

export function buildMobileDashboardSnapshot(opts: {
  simTable: SheetTable;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  chartBundle: ChartBundle | null;
  probOptions: LossAnalysisProbOptions | null;
  simTableVersion?: string | null;
  portfolioRows: Record<string, unknown>[];
  opportunityRows: Record<string, unknown>[];
  totalCapital: number;
  aiFeed: DashboardAiFeedItem[];
  aiFeedRecentCount: number;
  lang: "it" | "en";
  refCurves?: Partial<Record<SdsRoiProfileId, (number | null)[]>>;
}): MobileDashboardSnapshot {
  const pointsBySeriesKey = chartPointsMapFromBundle(opts.chartBundle);
  const simRowByKey = buildSimRowByKeyMap(opts.simTable.rows);
  const migByKey = buildMigSolidityByKey(opts.simTable, opts.chartBundle, opts.probOptions?.sdsRows ?? null);
  const recRows = buildDashboardRecommendationRows({
    simTable: opts.simTable,
    inputs: opts.inputs,
    history: opts.history,
    pointsBySeriesKey,
    lang: opts.lang,
    probOptions: opts.probOptions,
    simTableVersion: opts.simTableVersion,
    profileFilter: "all",
    cdFilter: "all",
    sortMode: "deal",
  });

  const recommendations: MobileDashboardRecRow[] = recRows.map((row) => {
    const simRow = simRowByKey.get(row.key) ?? null;
    const chartPts = chartPointsForKey(simRow, pointsBySeriesKey);
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
    const clinicalKpi = clinicalKpiFromSimRow(simRow);
    const eisSummary = summarizeTickerEis(row.ticker, opts.lang, clinicalKpi);
    const targetDisplay = simRow
      ? resolveModelTargetDisplay(
          simRow,
          row.currPriceUsd,
          opts.simTable.columns,
          row.planReturnPct ?? gainPlan.targetReturnPct,
        )
      : null;
    return {
      key: row.key,
      ticker: row.ticker,
      action: suggestedActionLabel(row.suggestedAction, opts.lang, row.hasPosition),
      probPct: row.probPct != null && Number.isFinite(row.probPct) ? row.probPct : null,
      reason: recommendationRationale(row),
      readingPct: row.readingPct,
      readingCurrentTs: row.readingCurrentTs ?? null,
      planReturnPct: row.planReturnPct,
      profile: row.profile,
      daysToCd: row.daysToCd,
      companyName: row.companyName || null,
      currPriceUsd: row.currPriceUsd,
      gainIdeaText: formatRecommendationGainIdeaShort(gainIdea, opts.lang),
      scorePct: row.recommendationScorePct,
      isNew: row.isNew,
      eisScore: eisSummary.score,
      eisHint: eisSummary.breakdownHint || null,
      targetPriceUsd: targetDisplay?.targetPriceUsd ?? null,
      targetMode: targetDisplay?.mode ?? null,
      daysToTarget: gainIdea.days ?? gainPlan.daysToTarget ?? null,
      curvePoints: simRow ? extractSparklinePoints(simRow) : [],
      curveCharts: simRow
        ? buildMobileCurveChartsPayload({
            key: row.key,
            simRow,
            chartPts,
            simTable: opts.simTable,
            chartBundle: opts.chartBundle,
            inputs: opts.inputs,
            history: opts.history,
            sdsRows: opts.probOptions?.sdsRows ?? null,
            migByKey,
            eisState: opts.probOptions?.eisSuperScoreState ?? null,
            hasPosition: row.hasPosition,
            daysToCd: row.daysToCd,
            lang: opts.lang,
            refCurves: opts.refCurves,
          })
        : null,
    };
  });

  return {
    version: 1,
    updated_at: new Date().toISOString(),
    hero: {
      portfolioCount: opts.portfolioRows.length,
      opportunityCount: opts.opportunityRows.length,
      totalCapital: opts.totalCapital,
      nextCdDaysPortfolio: nextCdDays(opts.portfolioRows),
      nextCdDaysOpportunities: nextCdDays(opts.opportunityRows),
      aiFeedRecentCount: opts.aiFeedRecentCount,
    },
    recommendations,
    portfolioCheck: buildMobilePortfolioCheckRows({
      simTable: opts.simTable,
      inputs: opts.inputs,
      history: opts.history,
      chartBundle: opts.chartBundle,
      probOptions: opts.probOptions,
      lang: opts.lang,
      migByKey,
      pointsBySeriesKey,
    }),
    upcoming: {
      portfolio: buildUpcomingFromRows(opts.portfolioRows),
      topOpps: buildUpcomingFromRows(opts.opportunityRows),
    },
    aiFeed: opts.aiFeed.slice(0, 10),
  };
}

let publishTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleMobileDashboardSnapshotPublish(snapshot: MobileDashboardSnapshot): void {
  if (typeof window === "undefined") return;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void saveMobileDashboardSnapshot(snapshot).catch(() => {
      /* mobile sync best-effort */
    });
  }, 800);
}

export async function saveMobileDashboardSnapshot(snapshot: MobileDashboardSnapshot): Promise<void> {
  await api("/api/mobile/dashboard-snapshot", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
  });
}

/** Normalize action for mobile display (strip hold-as-buy portfolio case). */
export function mobileRecActionLabel(action: string): string {
  return action.trim().toUpperCase();
}

export function mobileRecActionTone(action: string): "up" | "down" | "warn" | "neutral" {
  const a = action.toUpperCase();
  if (a === "BUY") return "up";
  if (a === "SELL") return "down";
  if (a === "REVIEW" || a === "MANTIENI" || a === "HOLD") return "warn";
  return "neutral";
}
