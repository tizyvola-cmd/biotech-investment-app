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
import { buildPortfolioAllocationSlices } from "../sheet/portfolioAllocationSlices";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import type { PaperPosition } from "../sheet/investDecisionSimLoop";
import type { AdviceFeedback } from "../sheet/adviceFeedback";
import {
  buildOperationalRecResult,
  type OperationalRecResult,
  type OperationalSellTag,
} from "../sheet/operationalRecommendation";
import { softBuyCapitalMultFromTier } from "../sheet/softBuyGateStrength";
import {
  aggregateOpenPortfolioPnl,
  buildDashboardPortfolioChips,
  currentPriceFromRow,
  dailyChangePctFromRow,
} from "../sheet/simulationPosition";
import {
  resolveContBand,
  resolveContG10,
  resolveDisplayPContinuation,
} from "../sheet/continuationScore";
import {
  type DashboardVisitSnapshot,
} from "../sheet/dashboardVisitSnapshot";
import { resolveEffectiveVisitSnapshot } from "../sheet/dashboardPulseView";
import { normNctId } from "../sheet/clinicalSimulationFilter";
import { nctClinicalTrialsUrl, sheetCellAsLink } from "../sheet/cellLinks";
import { daysFromToday } from "../sheet/simulationPlanGain";
import { clinicalKpiFromSimRow, summarizeTickerEis } from "../sheet/tickerEisSummary";
import { resolveModelTargetDisplay } from "../sheet/simRowTargetStop";
import { peakPnlEurFromHistory } from "../sheet/softSignalGrades";
import { buildPriorDayBookActivity } from "../sheet/priorDayBookActivity";
import { getStoredToken, hasStoredApiToken } from "./supernova";
import { resolveMobileSyncApiBase } from "../shared/remoteHost";
import {
  buildMobileCurveChartsByKey,
  buildMobileDecisionChartViews,
  unionDecisionChartRows,
  type MobileDecisionChartSnapshotRow,
  type MobileDecisionChartViews,
  type MobileDecisionChartViewId,
} from "./mobileDecisionChartSnapshot";
import {
  cdHorizonToMobileDecisionView,
  loadSimCdHorizonScope,
} from "../sheet/simCdHorizonScope";
import { exportGainStarsForSnapshot, refreshGainStarLedger } from "../sheet/gainStarLedger";
import type { RegulatoryRiskSnapshot } from "./supernova";
import type { ClinicalPreCdRecord } from "./supernova";
import type { MarketContextSnapshotDoc } from "../sheet/marketContextScore";
import type { LossRiskCatalog } from "../hooks/useLossRiskCatalog";
import type { LossRiskEntry } from "../components/LossRiskPoopCell";

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
  /** Pre-computed Decision chart rows (desktop Loss Analysis pipeline). */
  decisionChartRows?: MobileDecisionChartSnapshotRow[];
  /** Portfolio / hot CD / watch CD decision chart slices. */
  decisionChartViews?: MobileDecisionChartViews;
  /** Default mobile tab — mirrors desktop Loss Analysis CD window (hot vs watch). */
  decisionChartScope?: MobileDecisionChartViewId;
  /** Curve charts keyed by row key — includes tickers outside top recommendations. */
  curveChartsByKey?: Record<string, MobileCurveChartsPayload>;
  /** Daily gain ★ per ticker (colored sequence — synced from desktop ledger). */
  gainStarsByTicker?: Record<string, import("../sheet/gainStarLedger").GainStarDisplay[]>;
  /** Open-book allocation pie — same slices as desktop Pulse (capital %). */
  allocation?: MobileAllocationSlice[];
  /**
   * Soft BUY / Soft·Urgent·continuation SELL — same lists as Home Recommendations
   * (`buildOperationalRecResult`). Empty array = none now (do not invent locally).
   */
  softBuys?: MobileSoftBuySlice[];
  softSells?: MobileSoftSellSlice[];
  /**
   * Live desktop invest_sim book at publish time — mobile prefers this over
   * stale VPS `/api/investment/sim-inputs` (often weeks behind).
   */
  investSimInputs?: InvestSimInputs;
  investSimInputsUpdatedAt?: string;
  /**
   * Open positions — same P&L / P(cont) / Rec as desktop Pulse OPEN POSITIONS.
   * Mobile must prefer this over recomputing from a stale VPS Simulation sheet.
   */
  openPositions?: MobileOpenPositionSlice[];
  /**
   * Urgent G2 (or other) auto-sells from desktop — mobile shows a dismissible popup.
   * Preserved across snapshot republishes for ~36h.
   */
  autoSold?: MobileAutoSoldEvent | null;
  /**
   * Prior-day buys + yesterday/today sells — same recap as desktop Home banner.
   * Built from the Pulse book at publish time (not the fat VPS merge).
   */
  priorDayBook?: MobilePriorDayBookSlice | null;
};

/** Compact prior-day / today book activity for the mobile companion. */
export type MobilePriorDayBookItem = {
  key: string;
  ticker: string;
  side: "buy" | "sell";
  pnlEur: number | null;
  capitalEur: number | null;
  atIso: string;
};

export type MobilePriorDayBookSlice = {
  dayKey: string;
  todayKey: string;
  buys: MobilePriorDayBookItem[];
  sells: MobilePriorDayBookItem[];
};

/** One auto-closed name (Urgent G2 budget cut, etc.). */
export type MobileAutoSoldItem = {
  key: string;
  ticker: string;
  dayPnlPct?: number | null;
  dayPnlEur?: number | null;
  reason?: string;
};

/** Desktop → mobile alert when the open book shrinks via automatic sell. */
export type MobileAutoSoldEvent = {
  id: string;
  at: string;
  kind: "urgent_g2" | string;
  items: MobileAutoSoldItem[];
  /** Open-book size after the cuts (pipeline shrunk). */
  openCountAfter?: number | null;
};

export type MobileAllocationSlice = {
  key: string;
  ticker: string;
  capitalEur: number;
  pct: number;
};

export type MobileSoftBuySlice = {
  key: string;
  ticker: string;
  /** Gen 4 Grade 3 — strong 1 · mid 0.7 · weak 0.4 */
  capitalMult?: number;
  /** Suggested € at desktop plan base × gate tier. */
  suggestedCapitalEur?: number;
  gateTier?: "weak" | "mid" | "strong";
};

export type MobileSoftSellSlice = {
  key: string;
  ticker: string;
  tag?: OperationalSellTag;
  capitalEur?: number | null;
  pnlEur?: number | null;
};

export type MobileOpenPositionSlice = {
  key: string;
  ticker: string;
  capitalEur: number;
  pnlEur: number;
  pnlPct: number;
  pnlEur24h?: number | null;
  pnlPct24h?: number | null;
  currPriceUsd?: number | null;
  pCont?: number | null;
  contBand?: string | null;
  g10?: number | null;
  d1?: number | null;
  investedAt?: string | null;
  daysToCd?: number | null;
  /** € P&L change since last Home visit (Pulse Δ visit). */
  deltaPnlEurSinceVisit?: number | null;
  /** Peak open MTM € this hold — tooltip context; red bell is −5% of position capital. */
  peakPnlEur?: number | null;
  /** Pulse Rec — buy | sell | hold | review | none */
  recAction?: string | null;
};

export type { MobileDecisionChartSnapshotRow, MobileDecisionChartViews };

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
  autoRegSnap?: RegulatoryRiskSnapshot | null;
  mcsDoc?: MarketContextSnapshotDoc | null;
  clinicalPreCdRecords?: ClinicalPreCdRecord[];
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry>;
  /** Same Soft BUY/SELL parity as Home Actions / Pulse. */
  paperPortfolio?: PaperPosition[];
  adviceFeedback?: AdviceFeedback | null;
  /** Yahoo prior-session % — Soft BUY rising ≥2d (same as Evaluation). */
  priorSessionPctByTicker?: Map<string, number> | Record<string, number> | null;
  /** Prefer live Home arbiter (same instance as Cutoff / Pulse Rec). */
  operationalRec?: OperationalRecResult | null;
  /**
   * Frozen Home visit baseline (same as Pulse Δ). Do not re-read localStorage
   * at publish — alt-tab save overwrites storage and zeroes mobile Δ.
   * `undefined` = not captured yet → fall back to storage once.
   */
  priorVisitSnapshot?: DashboardVisitSnapshot | null;
}): MobileDashboardSnapshot {
  const pointsBySeriesKey = chartPointsMapFromBundle(opts.chartBundle);
  const simRowByKey = buildSimRowByKeyMap(opts.simTable.rows);
  const migByKey = buildMigSolidityByKey(opts.simTable, opts.chartBundle, opts.probOptions?.sdsRows ?? null);
  const operational =
    opts.operationalRec ??
    buildOperationalRecResult({
      simTable: opts.simTable,
      inputs: opts.inputs,
      pointsBySeriesKey,
      chartBundle: opts.chartBundle,
      history: opts.history,
      lang: opts.lang,
      sdsRows: opts.probOptions?.sdsRows ?? null,
      probOptions: opts.probOptions,
      lossRiskCatalog: opts.lossRiskCatalog ?? null,
      catalogByRowKey: opts.catalogByRowKey ?? null,
      autoRegSnap: opts.autoRegSnap ?? null,
      priorSessionPctByTicker: opts.priorSessionPctByTicker ?? null,
    });
  const softBuys: MobileSoftBuySlice[] = operational.buys.map((b) => ({
    key: b.key,
    ticker: b.ticker,
    capitalMult: b.gateStrength
      ? softBuyCapitalMultFromTier(b.gateStrength.tier)
      : undefined,
    suggestedCapitalEur: b.suggestedCapitalEur,
    gateTier: b.gateStrength?.tier,
  }));
  const softSells: MobileSoftSellSlice[] = operational.sells.map((s) => ({
    key: s.key,
    ticker: s.ticker,
    tag: s.tag,
    capitalEur: s.capitalEur,
    pnlEur: s.pnlEur,
  }));
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
    paperPortfolio: opts.paperPortfolio ?? [],
    adviceFeedback: opts.adviceFeedback ?? null,
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
    const eisSummary = summarizeTickerEis(
      row.ticker,
      opts.lang,
      clinicalKpi,
      opts.clinicalPreCdRecords,
    );
    const targetDisplay = simRow
      ? resolveModelTargetDisplay(
          simRow,
          row.currPriceUsd,
          opts.simTable.columns,
          row.planReturnPct ?? gainPlan.targetReturnPct,
        )
      : null;
    // Home Recommendations arbiter wins over Actions-table suggestedAction.
    const opAction = operational.byKey.get(row.key) ?? row.suggestedAction;
    return {
      key: row.key,
      ticker: row.ticker,
      action: suggestedActionLabel(opAction, opts.lang, row.hasPosition),
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

  const probOptions: LossAnalysisProbOptions = {
    sdsRows: opts.probOptions?.sdsRows ?? null,
    migSolidityByKey: migByKey,
    eisSuperScoreState: opts.probOptions?.eisSuperScoreState ?? null,
    clinicalPreCdRecords: opts.clinicalPreCdRecords,
    polygonOverview: opts.probOptions?.polygonOverview ?? null,
    lightweightPolygon: opts.probOptions?.lightweightPolygon,
    mergedInputs: opts.inputs,
  };

  /** Match PortfolioLossAnalysisView Decision chart — full EIS + polygon (no lightweight skip). */
  const decisionChartProbOptions: LossAnalysisProbOptions = {
    sdsRows: probOptions.sdsRows,
    migSolidityByKey: migByKey,
    eisSuperScoreState: probOptions.eisSuperScoreState,
    clinicalPreCdRecords: probOptions.clinicalPreCdRecords,
    polygonOverview: probOptions.polygonOverview,
    mergedInputs: opts.inputs,
  };

  const decisionChartBuildOpts = {
    simTable: opts.simTable,
    inputs: opts.inputs,
    history: opts.history,
    chartBundle: opts.chartBundle,
    probOptions: decisionChartProbOptions,
    lang: opts.lang,
    autoRegSnap: opts.autoRegSnap ?? null,
    mcsDoc: opts.mcsDoc ?? null,
    lossRiskCatalog: opts.lossRiskCatalog ?? null,
    catalogByRowKey: opts.catalogByRowKey ?? undefined,
    priorSessionPctByTicker: opts.priorSessionPctByTicker ?? null,
  };

  const decisionChartViews = buildMobileDecisionChartViews(decisionChartBuildOpts);
  const decisionChartRows = unionDecisionChartRows(decisionChartViews);

  const curveChartsByKey = buildMobileCurveChartsByKey({
    simTable: opts.simTable,
    inputs: opts.inputs,
    history: opts.history,
    chartBundle: opts.chartBundle,
    probOptions: opts.probOptions,
    lang: opts.lang,
    decisionRows: decisionChartRows,
    recommendations,
    refCurves: opts.refCurves,
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
    decisionChartRows,
    decisionChartViews,
    decisionChartScope: cdHorizonToMobileDecisionView(loadSimCdHorizonScope()),
    curveChartsByKey,
    gainStarsByTicker: (() => {
      refreshGainStarLedger();
      return exportGainStarsForSnapshot();
    })(),
    allocation: buildPortfolioAllocationSlices(
      opts.simTable,
      opts.inputs,
      opts.history,
    ),
    softBuys,
    softSells,
    investSimInputs: opts.inputs,
    investSimInputsUpdatedAt: new Date().toISOString(),
    openPositions: buildMobileOpenPositionSlices({
      simTable: opts.simTable,
      inputs: opts.inputs,
      history: opts.history,
      operational,
      simRowByKey,
      priorVisitSnapshot: opts.priorVisitSnapshot,
    }),
    priorDayBook: (() => {
      const act = buildPriorDayBookActivity(
        opts.inputs,
        undefined,
        opts.history,
        opts.simTable.rows ?? null,
      );
      if (!act.buys.length && !act.sells.length) return null;
      return {
        dayKey: act.dayKey,
        todayKey: act.todayKey,
        buys: act.buys.map((b) => ({
          key: b.key,
          ticker: b.ticker,
          side: b.side,
          pnlEur: b.pnlEur,
          capitalEur: b.capitalEur,
          atIso: b.atIso,
        })),
        sells: act.sells.map((s) => ({
          key: s.key,
          ticker: s.ticker,
          side: s.side,
          pnlEur: s.pnlEur,
          capitalEur: s.capitalEur,
          atIso: s.atIso,
        })),
      };
    })(),
  };
}

/** Keep a just-saved mobile Soft BUY (~15 min) when Pulse has not absorbed it yet. */
const RECENT_MOBILE_BUY_MS = 15 * 60 * 1000;

/**
 * Close VPS-only ghost opens that Pulse no longer lists.
 * Explicit soldAt is required so server merge accepts the close (otherwise
 * `invest_sim_inputs_merge` preserves the remote open).
 */
export function closeOrphanOpensNotInLocal(
  merged: InvestSimInputs,
  localOpenKeys: Set<string>,
  opts?: { nowMs?: number; allowRecentBuyMs?: number },
): InvestSimInputs {
  // Empty local book is NEVER authority — account switch / gate wipe would
  // otherwise mass-close every VPS open (SRPT Soft BUY + Pulse) in one sync.
  if (localOpenKeys.size === 0) return merged;

  const nowMs = opts?.nowMs ?? Date.now();
  const allowMs = opts?.allowRecentBuyMs ?? RECENT_MOBILE_BUY_MS;
  let changed = false;
  const out: InvestSimInputs = { ...merged };
  for (const [k, e] of Object.entries(merged)) {
    if (!e || e.ignoreSheet || !(e.capital > 0)) continue;
    if (localOpenKeys.has(k)) continue;
    const inv = e.investedAt ? Date.parse(e.investedAt) : NaN;
    if (Number.isFinite(inv) && nowMs - inv >= 0 && nowMs - inv < allowMs) {
      continue;
    }
    out[k] = {
      ...e,
      buyPrice: 0,
      capital: 0,
      ignoreSheet: true,
      soldAt: e.soldAt ?? new Date(nowMs).toISOString(),
      closedCapital: e.closedCapital ?? e.capital,
      closedValue: e.closedValue,
      closedPnlEur: e.closedPnlEur,
    };
    changed = true;
  }
  return changed ? out : merged;
}

function buildMobileOpenPositionSlices(opts: {
  simTable: SheetTable;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  operational: OperationalRecResult;
  simRowByKey: Map<string, Record<string, unknown>>;
  priorVisitSnapshot?: DashboardVisitSnapshot | null;
}): MobileOpenPositionSlice[] {
  const chips = buildDashboardPortfolioChips(
    opts.simTable,
    opts.inputs,
    opts.history,
  );
  const totals = aggregateOpenPortfolioPnl(
    opts.simTable,
    opts.inputs,
    opts.history,
  );
  // Prefer frozen Pulse baseline. Do not fall back to localStorage here —
  // a leave/alt-tab save equals live MTM and would publish Δ=0 to mobile.
  const rawPrior =
    opts.priorVisitSnapshot === undefined
      ? null
      : opts.priorVisitSnapshot;
  const priorVisit = resolveEffectiveVisitSnapshot(rawPrior, totals);
  return chips.map((chip) => {
    const row = opts.simRowByKey.get(chip.key) ?? null;
    const op = opts.operational.byKey.get(chip.key) ?? null;
    const inp = opts.inputs[chip.key];
    const prior = priorVisit?.tickers?.[chip.key];
    const deltaPnlEurSinceVisit =
      prior != null && Number.isFinite(prior.pnlEur)
        ? Math.round((chip.pnlEur - prior.pnlEur) * 100) / 100
        : null;
    const investedAt = inp?.investedAt ?? inp?.purchaseDate ?? null;
    const peakRaw = peakPnlEurFromHistory(opts.history, chip.key, investedAt);
    const peakPnlEur =
      peakRaw != null && Number.isFinite(peakRaw)
        ? Math.round(Math.max(peakRaw, chip.pnlEur) * 100) / 100
        : chip.pnlEur > 0
          ? Math.round(chip.pnlEur * 100) / 100
          : null;
    return {
      key: chip.key,
      ticker: chip.ticker,
      capitalEur: chip.capitalEur,
      pnlEur: chip.pnlEur,
      pnlPct: chip.pnlPct,
      pnlEur24h: chip.pnlEur24h,
      pnlPct24h: chip.pnlPct24h,
      currPriceUsd: row ? currentPriceFromRow(row) : null,
      pCont: resolveDisplayPContinuation(row),
      contBand: resolveContBand(row),
      g10: resolveContG10(row),
      d1: row ? dailyChangePctFromRow(row) : null,
      investedAt,
      daysToCd: row ? daysFromToday(String(row["Completion Date"] ?? "")) : null,
      deltaPnlEurSinceVisit,
      peakPnlEur,
      recAction: op,
    };
  });
}

let publishTimer: ReturnType<typeof setTimeout> | null = null;

let lastPublishSyncAt = 0;
const PUBLISH_INPUT_SYNC_MIN_MS = 60_000;

export function scheduleMobileDashboardSnapshotPublish(
  snapshot: MobileDashboardSnapshot,
  opts?: { syncInputsToVps?: boolean },
): void {
  if (typeof window === "undefined") return;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void (async () => {
      await saveMobileDashboardSnapshot(snapshot);
      // Companion poll owns frequent book sync — only rarely re-sync on publish
      // so Home deps (Yahoo 1h, visit Δ, Soft lists) don't GET+PUT every few seconds.
      const now = Date.now();
      const allowSync =
        opts?.syncInputsToVps === true ||
        (opts?.syncInputsToVps !== false &&
          now - lastPublishSyncAt >= PUBLISH_INPUT_SYNC_MIN_MS);
      if (allowSync && snapshot.investSimInputs && hasStoredApiToken()) {
        const { usesSharedOperatorInvestBook } = await import("../sheet/testerSession");
        // Shared Pulse book only in lab mode — never while an email account (or gate) is active.
        if (usesSharedOperatorInvestBook()) {
          lastPublishSyncAt = now;
          await syncInvestSimInputsBidirectional(snapshot.investSimInputs);
        }
      }
    })().catch(() => {
      /* mobile sync best-effort */
    });
  }, 1_500);
}

/**
 * Poll VPS shared `/api/investment/sim-inputs` for Soft BUY/SELL from mobile
 * and merge into desktop Pulse localStorage (fires INVEST_SIM_INPUTS_CHANGED).
 */
export async function pullCompanionInvestSimOpensIntoDesktop(
  localInputs: InvestSimInputs,
): Promise<void> {
  // Shared companion sync is lab-only. Email accounts use per-tester books via Soft BUY path.
  const { usesSharedOperatorInvestBook } = await import("../sheet/testerSession");
  if (!usesSharedOperatorInvestBook()) return;
  if (!hasStoredApiToken()) return;
  await syncInvestSimInputsBidirectional(localInputs);
}

function openBookFingerprint(inputs: InvestSimInputs): string {
  const parts: string[] = [];
  for (const [k, e] of Object.entries(inputs)) {
    if (!e || e.ignoreSheet || !(e.capital > 0)) continue;
    parts.push(`${k}:${Math.round(e.capital)}:${e.buyPrice ?? 0}`);
  }
  parts.sort();
  return parts.join("|");
}

let companionSyncInFlight: Promise<void> | null = null;

/** Merge local Pulse book ↔ VPS book, PUT union, pull remote opens into desktop LS. */
async function syncInvestSimInputsBidirectional(
  localInputs: InvestSimInputs,
): Promise<void> {
  if (companionSyncInFlight) return companionSyncInFlight;
  companionSyncInFlight = (async () => {
    const { mergeInvestSimInputs, sumOpenCapital } = await import(
      "../sheet/investSimKeys"
    );
    const { saveInvestSimInputs } = await import("../sheet/investSimStorage");

    let remoteInputs: InvestSimInputs = {};
    try {
      const remote = await mobileSyncApi<{
        inputs?: InvestSimInputs;
      }>("/api/investment/sim-inputs");
      remoteInputs =
        remote?.inputs && typeof remote.inputs === "object" ? remote.inputs : {};
    } catch {
      remoteInputs = {};
    }

    const localKeys = new Set(
      Object.entries(localInputs)
        .filter(([, e]) => e && !e.ignoreSheet && (e.capital ?? 0) > 0)
        .map(([k]) => k),
    );
    const remoteOpenKeys = new Set(
      Object.entries(remoteInputs)
        .filter(([, e]) => e && !e.ignoreSheet && (e.capital ?? 0) > 0)
        .map(([k]) => k),
    );
    const merged = mergeInvestSimInputs(localInputs, remoteInputs);
    // Pulse open set is authority — drop stale VPS ghosts (BNTX/ETON/… after sells).
    // Explicit soldAt so server merge accepts the close. Do NOT use replace:true —
    // a stale GET → replace races a concurrent mobile Soft BUY and wipes it.
    // If local is empty but VPS still has opens, prefer remote (do not prune).
    const pruned =
      localKeys.size === 0 && remoteOpenKeys.size > 0
        ? remoteInputs
        : closeOrphanOpensNotInLocal(merged, localKeys);

    const localFp = openBookFingerprint(localInputs);
    const remoteFp = openBookFingerprint(remoteInputs);
    const prunedFp = openBookFingerprint(pruned);
    // No open-set drift → skip PUT (was hammering VPS + sim-outcomes every 15s).
    if (prunedFp === remoteFp && prunedFp === localFp) {
      return;
    }

    // Refuse to publish a collapsed book when VPS still has real opens.
    const localOpen = sumOpenCapital(localInputs);
    const remoteOpen = sumOpenCapital(remoteInputs);
    const prunedOpen = sumOpenCapital(pruned);
    if (remoteOpen >= 500 && prunedOpen < remoteOpen * 0.35) {
      console.warn(
        "[investSim] refuse companion sync PUT — would collapse VPS open book",
        { remoteOpen, prunedOpen, localOpen },
      );
      if (remoteOpen > localOpen + 1) {
        saveInvestSimInputs(remoteInputs);
      }
      return;
    }

    await mobileSyncApi("/api/investment/sim-inputs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: pruned }),
    });

    // Pull recent mobile-only opens into desktop localStorage so Pulse lists them.
    const gainedOpen = Object.entries(pruned).some(
      ([k, e]) =>
        e && !e.ignoreSheet && (e.capital ?? 0) > 0 && !localKeys.has(k),
    );
    if (gainedOpen || prunedOpen > localOpen + 1) {
      saveInvestSimInputs(pruned);
    }
  })().finally(() => {
    companionSyncInFlight = null;
  });
  return companionSyncInFlight;
}

async function mobileSyncApi<T>(path: string, init?: RequestInit): Promise<T> {
  const base = resolveMobileSyncApiBase().replace(/\/$/, "");
  const headers = new Headers(init?.headers);
  const method = (init?.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const token = getStoredToken();
    if (token) headers.set("X-SuperNova-Token", token);
    const body = init?.body;
    if (
      body != null &&
      typeof body === "string" &&
      body.length > 0 &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }
  }
  const res = await fetch(`${base}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 240)}`);
  }
  return (await res.json()) as T;
}

const AUTO_SOLD_PRESERVE_MS = 36 * 60 * 60 * 1000;

function isFreshAutoSold(
  ev: MobileAutoSoldEvent | null | undefined,
): ev is MobileAutoSoldEvent {
  if (!ev?.id || !ev.at || !Array.isArray(ev.items) || ev.items.length === 0) return false;
  const age = Date.now() - Date.parse(ev.at);
  return Number.isFinite(age) && age >= 0 && age < AUTO_SOLD_PRESERVE_MS;
}

export async function saveMobileDashboardSnapshot(snapshot: MobileDashboardSnapshot): Promise<void> {
  let payload: MobileDashboardSnapshot = snapshot;
  // Home republish must not wipe a fresh auto-sell alert before testers see it.
  if (!isFreshAutoSold(snapshot.autoSold)) {
    try {
      const prev = await fetchMobileDashboardSnapshotFromApi();
      if (isFreshAutoSold(prev?.autoSold)) {
        payload = { ...snapshot, autoSold: prev!.autoSold };
      }
    } catch {
      /* best-effort preserve */
    }
  }
  await mobileSyncApi("/api/mobile/dashboard-snapshot", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Immediate PUT of an auto-sell alert for the mobile companion popup. */
export async function pushMobileAutoSoldEvent(
  event: MobileAutoSoldEvent,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasStoredApiToken()) return { ok: false, error: "MISSING_API_TOKEN" };
  if (!isFreshAutoSold(event)) return { ok: false, error: "INVALID_EVENT" };
  try {
    const prev = await fetchMobileDashboardSnapshotFromApi();
    if (!prev?.hero) {
      return { ok: false, error: "Mobile snapshot missing on target" };
    }
    const next: MobileDashboardSnapshot = {
      ...prev,
      version: 1,
      updated_at: new Date().toISOString(),
      autoSold: event,
    };
    // Bypass preserve merge — we intentionally set autoSold.
    await mobileSyncApi("/api/mobile/dashboard-snapshot", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchMobileDashboardSnapshotFromApi(): Promise<MobileDashboardSnapshot | null> {
  try {
    return await mobileSyncApi<MobileDashboardSnapshot>("/api/mobile/dashboard-snapshot");
  } catch {
    return null;
  }
}

/**
 * After desktop buy/sell — patch the live companion snapshot book without needing
 * Home mounted (Soft lists stay; openPositions + investSimInputs follow the book).
 */
export async function bumpMobileDashboardSnapshotBook(
  inputs: InvestSimInputs,
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!hasStoredApiToken()) return;
  try {
    const prev = await fetchMobileDashboardSnapshotFromApi();
    if (!prev?.hero) return;
    const openKeys = new Set(
      Object.entries(inputs)
        .filter(([, e]) => e && !e.ignoreSheet && (e.capital ?? 0) > 0)
        .map(([k]) => k),
    );
    const openPositions = (prev.openPositions ?? []).filter((p) =>
      openKeys.has(p.key),
    );
    const next: MobileDashboardSnapshot = {
      ...prev,
      version: 1,
      updated_at: new Date().toISOString(),
      investSimInputs: inputs,
      openPositions,
    };
    await mobileSyncApi("/api/mobile/dashboard-snapshot", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  } catch {
    /* best-effort companion sync */
  }
}

export type MobileDecisionChartPushResult =
  | { ok: true; updatedAt: string; target: string }
  | { ok: false; error: string; target: string };

export const MOBILE_DECISION_SYNC_FAILED_EVENT = "supernova:mobile-decision-sync-failed";

/** Immediate PUT of decision chart to mobile sync host (VPS when Electron is local). */
export async function pushMobileDecisionChartNow(
  patch: Pick<MobileDashboardSnapshot, "decisionChartViews" | "decisionChartRows" | "decisionChartScope">,
): Promise<MobileDecisionChartPushResult> {
  const target = resolveMobileSyncApiBase().replace(/\/$/, "");
  if (!hasStoredApiToken()) {
    return { ok: false, error: "MISSING_API_TOKEN", target };
  }
  try {
    const prev = await fetchMobileDashboardSnapshotFromApi();
    if (!prev?.hero) {
      return {
        ok: false,
        error: "Mobile snapshot missing on target — run VPS data refresh first.",
        target,
      };
    }
    const updatedAt = new Date().toISOString();
    const next: MobileDashboardSnapshot = {
      ...prev,
      ...patch,
      version: 1,
      updated_at: updatedAt,
    };
    await saveMobileDashboardSnapshot(next);
    return { ok: true, updatedAt, target };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      target,
    };
  }
}

let decisionChartPublishTimer: ReturnType<typeof setTimeout> | null = null;

/** Push decision chart slice to mobile snapshot (Evaluation Lab / Loss Analysis — same rec as desktop). */
export function scheduleMobileDecisionChartPublish(
  patch: Pick<MobileDashboardSnapshot, "decisionChartViews" | "decisionChartRows" | "decisionChartScope">,
): void {
  if (typeof window === "undefined") return;
  if (decisionChartPublishTimer) clearTimeout(decisionChartPublishTimer);
  decisionChartPublishTimer = setTimeout(() => {
    decisionChartPublishTimer = null;
    void pushMobileDecisionChartNow(patch).then((res) => {
      if (res.ok || typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent(MOBILE_DECISION_SYNC_FAILED_EVENT, { detail: res }),
      );
    });
  }, 900);
}

/** Normalize action for mobile display (strip hold-as-buy portfolio case). */
export function mobileRecActionLabel(action: string): string {
  return action.trim().toUpperCase();
}

export function mobileRecActionTone(action: string): "up" | "down" | "warn" | "neutral" {
  const a = action.toUpperCase();
  if (a === "BUY") return "up";
  if (a === "SELL") return "down";
  if (a === "REVIEW" || a === "UNCERTAIN" || a === "INCERTO" || a === "MANTIENI" || a === "HOLD") return "warn";
  return "neutral";
}
