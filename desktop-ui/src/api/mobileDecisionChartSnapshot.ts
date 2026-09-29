/**
 * Pre-compute Decision chart rows for mobile (option A — server/desktop payload).
 * Same pipeline as PortfolioLossAnalysisView decision chart.
 */
import type { RegulatoryRiskSnapshot, SdsRow } from "./supernova";
import type { ChartBundle, ChartPoint, SheetTable } from "../types";
import { chartPointsMapFromBundle, simulationRowSeriesKey } from "../data/simulationCharts";
import { buildCdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";
import {
  buildDecisionChartRow,
  resolveRegSignedScoreForTicker,
} from "../sheet/decisionChartBuild";
import {
  regRiskFromSignedScore,
  type DecisionChartTickerRow,
} from "../sheet/decisionChartLogic";
import { buildSimRowByKeyMap, reconcileInvestSimInputs } from "../sheet/investSimKeys";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import {
  buildLossAnalysisItems,
  type LossAnalysisProbOptions,
  type PortfolioLossAnalysisItem,
} from "../sheet/portfolioLossAnalysis";
import {
  lookupLossRisk,
  lookupLossRiskByRowKey,
  type LossRiskCatalog,
} from "../hooks/useLossRiskCatalog";
import type { LossRiskEntry } from "../components/LossRiskPoopCell";
import {
  loadMarketContextSnapshot,
  type MarketContextSnapshotDoc,
} from "../sheet/marketContextScore";
import {
  buildMobileCurveChartsPayload,
  type MobileCurveChartsPayload,
} from "./mobileCurveChartsPayload";
import type { SdsRoiProfileId } from "../sheet/sdsRoiBlend";
import { deriveSuggestedAction } from "../sheet/investDecisionSimLoop";
import {
  attachContCutPriority,
  evaluateUrgentSellGrade2Book,
} from "../sheet/softSignalGrades";
import { softBuyBlockedByBookSell } from "../sheet/softBuyPostSellCooldown";
import { rowHasActivePortfolio } from "../sheet/simulationPosition";
import { daysFromToday } from "../sheet/simulationPlanGain";
import type { SimCdHorizonScope } from "../sheet/simCdHorizonScope";

export type MobileDecisionChartSnapshotRow = DecisionChartTickerRow;

export type MobileDecisionChartViewId = import("../sheet/simCdHorizonScope").MobileDecisionChartViewId;

export type MobileDecisionChartViews = Record<MobileDecisionChartViewId, MobileDecisionChartSnapshotRow[]>;

function sdsRowByTicker(sdsRows: SdsRow[] | null | undefined): Map<string, SdsRow> {
  const m = new Map<string, SdsRow>();
  for (const row of sdsRows ?? []) {
    m.set(row.ticker.trim().toUpperCase(), row);
  }
  return m;
}

function lossItemsForView(
  view: MobileDecisionChartViewId,
  simTable: SheetTable,
  inputs: InvestSimInputs,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
  lang: "it" | "en",
  history: InvestSimHistoryPoint[],
  probOptions: LossAnalysisProbOptions | null,
): PortfolioLossAnalysisItem[] {
  if (view === "portfolio") {
    return buildLossAnalysisItems(
      "portfolio",
      simTable,
      inputs,
      pointsBySeriesKey,
      lang,
      history,
      probOptions,
    );
  }
  const scope: SimCdHorizonScope = view === "oppHot" ? "hot" : "watch";
  return buildLossAnalysisItems(
    "opportunities",
    simTable,
    inputs,
    pointsBySeriesKey,
    lang,
    history,
    probOptions,
    scope,
  );
}

export type BuildMobileDecisionChartOpts = {
  simTable: SheetTable;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  chartBundle: ChartBundle | null;
  probOptions: LossAnalysisProbOptions | null;
  lang: "it" | "en";
  autoRegSnap?: RegulatoryRiskSnapshot | null;
  mcsDoc?: MarketContextSnapshotDoc | null;
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry>;
  /** Yahoo prior-session % for Soft BUY rising ≥2d. */
  priorSessionPctByTicker?: Map<string, number> | Record<string, number> | null;
};

function buildRowsFromItems(
  items: PortfolioLossAnalysisItem[],
  opts: BuildMobileDecisionChartOpts,
): MobileDecisionChartSnapshotRow[] {
  const {
    simTable,
    inputs,
    chartBundle,
    probOptions,
    lang,
    autoRegSnap = null,
    mcsDoc = null,
    lossRiskCatalog = null,
    catalogByRowKey = null,
    priorSessionPctByTicker = null,
  } = opts;

  const pointsBySeriesKey = chartPointsMapFromBundle(chartBundle);
  const rowByKey = buildSimRowByKeyMap(simTable.rows);
  const merged = reconcileInvestSimInputs(inputs, simTable.rows);
  const langCode = lang === "it" ? "it" : "en";
  const sdsMap = sdsRowByTicker(probOptions?.sdsRows ?? null);
  const migByKey = probOptions?.migSolidityByKey ?? new Map();
  const eisState = probOptions?.eisSuperScoreState ?? null;

  const urgentG2 = evaluateUrgentSellGrade2Book(
    items
      .filter((i) => i.hasPosition)
      .map((i) =>
        attachContCutPriority(
          {
            key: i.key,
            ticker: i.ticker,
            dayPnlEur: i.pnlEur24h ?? 0,
            dayPnlPct: i.pnlPct24h ?? null,
            totalPnlPct: i.pnlPct ?? null,
            capitalEur: i.capital,
            pnlEur: i.pnlEur,
          },
          rowByKey.get(i.key) ?? null,
        ),
      ),
  );

  const rows: MobileDecisionChartSnapshotRow[] = [];
  for (const item of items) {
    const simRow = rowByKey.get(item.key) ?? null;
    if (!simRow) continue;
    const chartPts = item.seriesKey ? pointsBySeriesKey.get(item.seriesKey) ?? null : null;
    const patternRec = buildCdPatternTickerRecommendation({
      row: simRow,
      chartPoints: chartPts,
      investInputs: merged,
      sdsRows: probOptions?.sdsRows ?? null,
      migByKey,
      lang: langCode,
      includeEis: true,
      eisSuperScoreState: eisState,
      clinicalPreCdRecords: probOptions?.clinicalPreCdRecords,
    });
    const sdsRow = sdsMap.get(item.ticker.trim().toUpperCase()) ?? null;
    const lossRisk =
      (catalogByRowKey ? lookupLossRiskByRowKey(catalogByRowKey, item.key) : null) ??
      (lossRiskCatalog ? lookupLossRisk(lossRiskCatalog, item.ticker) : null);
    const regSigned = resolveRegSignedScoreForTicker(item.ticker, simRow, autoRegSnap);
    const regRisk = regRiskFromSignedScore(regSigned);
    const priorPct =
      priorSessionPctByTicker instanceof Map
        ? priorSessionPctByTicker.get(item.ticker.trim().toUpperCase())
        : priorSessionPctByTicker?.[item.ticker.trim().toUpperCase()];
    const suggestedAction = deriveSuggestedAction(item, false, null, null, {
      urgentSellG2Keys: urgentG2.urgentKeys,
      riskV2: lossRisk?.riskScore ?? null,
      regRisk,
      regulatoryRiskScore: regRisk,
      simRow,
      chartPts,
      priorSessionPcts:
        priorPct != null && Number.isFinite(priorPct) ? [priorPct] : undefined,
      recentlySoldBlocked: softBuyBlockedByBookSell(inputs, {
        key: item.key,
        ticker: item.ticker,
      }),
    });

    const built = buildDecisionChartRow({
      item,
      patternRec,
      sdsRow,
      lossRisk,
      regSignedScore: regSigned,
      mcsDoc,
      chartPts,
      simRow,
      lang: langCode,
      eisSuperScoreState: eisState,
      suggestedAction,
      clinicalPreCdRecords: probOptions?.clinicalPreCdRecords,
      urgentSellG2: urgentG2.urgentKeys.has(item.key),
    });
    rows.push({
      ...built,
      pnlPct24h:
        item.pnlPct24h != null && Number.isFinite(item.pnlPct24h) ? item.pnlPct24h : null,
    });
  }

  const recOrder: Record<string, number> = { buy: 0, review: 1, hold: 2, sell: 3 };
  return rows.sort(
    (a, b) =>
      (recOrder[a.rec] ?? 9) - (recOrder[b.rec] ?? 9) || a.ticker.localeCompare(b.ticker),
  );
}

export function buildMobileDecisionChartViews(opts: BuildMobileDecisionChartOpts): MobileDecisionChartViews {
  if (!opts.simTable.rows?.length) {
    return { portfolio: [], oppHot: [], oppWatch: [] };
  }
  const pointsBySeriesKey = chartPointsMapFromBundle(opts.chartBundle);
  const langCode = opts.lang === "it" ? "it" : "en";

  return {
    portfolio: buildRowsFromItems(
      lossItemsForView(
        "portfolio",
        opts.simTable,
        opts.inputs,
        pointsBySeriesKey,
        langCode,
        opts.history,
        opts.probOptions,
      ),
      opts,
    ),
    oppHot: buildRowsFromItems(
      lossItemsForView(
        "oppHot",
        opts.simTable,
        opts.inputs,
        pointsBySeriesKey,
        langCode,
        opts.history,
        opts.probOptions,
      ),
      opts,
    ),
    oppWatch: buildRowsFromItems(
      lossItemsForView(
        "oppWatch",
        opts.simTable,
        opts.inputs,
        pointsBySeriesKey,
        langCode,
        opts.history,
        opts.probOptions,
      ),
      opts,
    ),
  };
}

/** Portfolio rows only — backward compat. */
export function buildMobileDecisionChartSnapshotRows(
  opts: BuildMobileDecisionChartOpts,
): MobileDecisionChartSnapshotRow[] {
  return buildMobileDecisionChartViews(opts).portfolio;
}

export function unionDecisionChartRows(views: MobileDecisionChartViews): MobileDecisionChartSnapshotRow[] {
  const seen = new Set<string>();
  const out: MobileDecisionChartSnapshotRow[] = [];
  for (const list of [views.portfolio, views.oppHot, views.oppWatch]) {
    for (const row of list) {
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      out.push(row);
    }
  }
  return out;
}

export function buildMobileCurveChartsByKey(opts: {
  simTable: SheetTable;
  inputs: InvestSimInputs;
  history: InvestSimHistoryPoint[];
  chartBundle: ChartBundle | null;
  probOptions: LossAnalysisProbOptions | null;
  lang: "it" | "en";
  decisionRows: MobileDecisionChartSnapshotRow[];
  recommendations: Array<{ key: string; curveCharts?: MobileCurveChartsPayload | null }>;
  refCurves?: Partial<Record<SdsRoiProfileId, (number | null)[]>>;
}): Record<string, MobileCurveChartsPayload> {
  const out: Record<string, MobileCurveChartsPayload> = {};
  for (const rec of opts.recommendations) {
    if (rec.curveCharts) out[rec.key] = rec.curveCharts;
  }

  if (!opts.simTable.rows?.length || !opts.decisionRows.length) return out;

  const pointsBySeriesKey = chartPointsMapFromBundle(opts.chartBundle);
  const rowByKey = buildSimRowByKeyMap(opts.simTable.rows);
  const migByKey = opts.probOptions?.migSolidityByKey ?? new Map();

  for (const row of opts.decisionRows) {
    if (out[row.key]) continue;
    const simRow = rowByKey.get(row.key);
    if (!simRow) continue;
    const chartPts = chartPointsForSimRow(simRow, pointsBySeriesKey);
    const hasPosition = rowHasActivePortfolio(simRow, opts.inputs);
    const cdDays = parseDaysToCd(simRow);

    const payload = buildMobileCurveChartsPayload({
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
      hasPosition,
      daysToCd: cdDays,
      lang: opts.lang,
      refCurves: opts.refCurves,
    });
    if (payload) out[row.key] = payload;
  }

  return out;
}

function chartPointsForSimRow(
  simRow: Record<string, unknown>,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
): ChartPoint[] | null {
  const sk = simulationRowSeriesKey(simRow);
  if (!sk) return null;
  return pointsBySeriesKey.get(sk) ?? null;
}

function parseDaysToCd(simRow: Record<string, unknown>): number | null {
  const cd = String(simRow["Completion Date"] ?? "").trim();
  if (!cd || cd === "—") return null;
  return daysFromToday(cd);
}

/** Load MCS doc for snapshot build (browser or Node script). */
export async function loadMobileSnapshotMcsDoc(): Promise<MarketContextSnapshotDoc | null> {
  try {
    return await loadMarketContextSnapshot();
  } catch {
    return null;
  }
}
