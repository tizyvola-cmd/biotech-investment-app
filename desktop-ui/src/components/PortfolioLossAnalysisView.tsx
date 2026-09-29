import { useCallback, useEffect, useLayoutEffect, memo, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import type { ChartBundle, ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { RealTimeSheetUpdater } from "./RealTimeSheetUpdater";
import {
  isDebugRendersEnabled,
  useDebugRenderCount,
  formatDebugRenderBadge,
} from "../sheet/debugRenderCount";
import { useKeyedMapEntry } from "../sheet/keyedMapStore";
import { createKpiLiveStores, type KpiLiveStores } from "../sheet/kpiLiveStores";
import {
  fetchCatalystAccumulation,
  fetchCatalystDeskCache,
  fetchCatalystVsXbi,
  fetchEventVolIndex,
  fetchIntraday1h,
  fetchDailyNews,
  fetchFdaDesignationsBatch,
  fetchRegulatoryRiskSnapshot,
  fetchSearchInterest,
  fetchVolumeAcceleration,
  fetchVolumeHistory,
  fetchVolumeVsPrevSession,
  eventVolPairKey,
  type FdaDesignationRow,
  type RegulatoryRiskSnapshot,
  type SearchInterestRow,
  type VolumeAccelRow,
  type VolumeVsPrevSessionRow,
} from "../api/supernova";
import {
  cycleAlertForKey,
  fetchCatalystCycleAlerts,
  normalizeCycleTickerKey,
  cycleTickersFromKey,
  peekCatalystCycleAlertsCache,
  type CatalystCycleAlertsResponse,
} from "../api/catalystPatterns";
import { GoogleTrendsLegendModal } from "./GoogleTrendsLegendModal";
import { buildPriorSessionPctByTicker } from "../sheet/softBuyRisingStreak";
import { buildOperationalEnhanceForItem } from "../sheet/operationalRecommendation";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { buildSimRowByKeyMap, lossAnalysisCardDomId, lossAnalysisChartSectionDomId, lossAnalysisTopKpiRowDomId, lossAnalysisTopKpiTickerDomId, normalizedRowKey, type LossAnalysisScoreSection, reconcileInvestSimInputs } from "../sheet/investSimKeys";
import { scrollToDomIdWhenReady, findScrollableParent, offsetInScrollContent } from "../sheet/scrollInContainer";
import {
  useVirtualTableBody,
  VirtualTablePadRow,
} from "../sheet/useVirtualTableBody";

// #region agent log
function dbgKpiLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
  runId = "post-fix-v4",
): void {
  const payload = {
    sessionId: "adfce3",
    runId,
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };
  if (import.meta.env.DEV) console.debug("[kpi-debug]", payload);
  fetch("http://127.0.0.1:7443/ingest/63a622b5-654b-444c-ad8f-190102d8c47d", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "adfce3" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
// #endregion

import { buildMigResultByKey, buildMigSolidityByKey, migSolidityKey, type MigSoliditySnapshot } from "../sheet/entrySolidityMig";
import {
  cdHorizonToMobileDecisionView,
  loadSimCdHorizonScope,
  SIM_HOT_ZONE_DAYS,
  SIM_PEAK_ZONE_DAYS,
  type SimCdHorizonScope,
} from "../sheet/simCdHorizonScope";
import { DESK_CALENDAR_HORIZON_DAYS, DESK_POST_CD_RETENTION_DAYS } from "../sheet/deskCalendarEvents";
import {
  assignTickerMapsPreserving,
  mergeTickerMaps,
  peekCatalystDeskColumnCache,
  rememberCatalystDeskColumnCache,
  tickerRowShallowEqual,
} from "../sheet/catalystDeskColumnCache";
import {
  formatBiasCell,
  priceVolKindFromLabel,
} from "../sheet/catalystBiasDisplay";
import { toDeskIndexTone } from "../sheet/deskIndexTone";
import { PriceVariationChart, PriceVarChartRangeToolbar } from "./PriceVariationChart";
import { pairOhlcvFetchDays, useOhlcvHistory } from "../sheet/ohlcvHistoryStore";
import { TickerCatalystEventsTable, useTickerGuidanceEvents, useGuidanceKpiByTicker, type GuidanceKpiByTicker } from "./TickerCatalystEventsTable";
import { ClinicalDevelopmentLaneChart } from "./ClinicalDevelopmentLaneChart";
import { SelectionChip } from "./SelectionChip";
import { DEFAULT_PLAN_CAPITAL_EUR } from "../sheet/expectedRoiDisplay";
import {
  evaluateSoftBuyGateStrength,
  softBuyCapitalFromGateStrength,
} from "../sheet/softBuyGateStrength";
import type { IntradayPricePoint } from "../sheet/simUniverse24hWhatIf";
import { buildIntradaySeriesByTicker } from "../sheet/earlyPeakBuyMinTarget";
import { deriveKpiSoftBuyG1 } from "../sheet/lossAnalysisRowDerived";
import { StudyTypeTickerIcon, STUDY_DRUG_ICON_PX } from "./StudyTypeTickerIcon";
import { AttentionStarToggle } from "./AttentionStarToggle";
import {
  getAttentionStarsVersion,
  listAttentionStars,
} from "../sheet/attentionStarStore";
import { useCatalystInterestTickers } from "../hooks/useCatalystInterestTickers";
import { findClinicalMetaForTicker } from "../sheet/studyClassifier";
import {
  allDeskClinicalStudiesForModal,
  deskRowStudyPhaseLabel,
  resolveDeskRowClinicalStudies,
  type DeskClinicalStudyListItem,
} from "../sheet/deskClinicalStudies";
import { TickerClinicalStudiesModal } from "./TickerClinicalStudiesModal";
import {
  clinicalDrugFromSimRow,
  clinicalNctFromSimRow,
} from "../sheet/simRowClinicalMeta";
import { clinicalAssetProductName } from "../sheet/eisProductBriefing";
import { designationsFromText, formatSourceList, normalizeFdaDesignationLabel } from "../sheet/calendarPhase1";
import {
  formatProductDesignationCell,
  newsProductDesignationByTicker,
  type NewsProductDesignationHint,
} from "../sheet/dailyNewsProductDesignations";
import {
  clinicalDimensionScoresByTicker,
  DIMENSION_SCORE_LOOKBACK_DAYS,
  mergeDimensionScoreMaps,
  newsDimensionScoresByTicker,
  newsDimSortKey,
  type NewsDimensionScores,
} from "../sheet/newsDimensionScores";
import { marketCapUsdFromSimRow } from "../sheet/issuerResilience";
import { PriceChange24hCell } from "./PriceChange24hCell";
import { NewsDimensionScoreCell } from "./NewsDimensionScoreCell";
import { DeepDiveKpiRibbon } from "./DeepDiveKpiRibbon";
import { formatMarketCap } from "../finance/financialRow";
import { eisColor } from "../sheet/eventImpactScore";
import {
  fmtPortfolioPnlPct,
  fmtPortfolioPnlUsd,
  portfolioPnlAccentClass,
} from "../sheet/portfolioGainLossStyle";
import {
  buildForcedLossAnalysisItem,
  buildLossAnalysisItems,
  resolvePlanProbHeroPayload,
  summarizeLossAnalysis,
  type LossAnalysisProfile,
  type PortfolioLossAnalysisItem,
} from "../sheet/portfolioLossAnalysis";
import {
  evaluateSimBuyGate,
  sortLossItemsByActionSolidity,
  sortLossItemsByDisplayedRec,
  deriveSuggestedAction,
  type SuggestedActionEnhanceCtx,
} from "../sheet/investDecisionSimLoop";
import { purgeRecoveredManualFeedEvents } from "../sheet/manualFeedDropPrompt";
import { refreshGainStarLedger } from "../sheet/gainStarLedger";
import { slopeCapitalLossTone } from "../sheet/slopeStockPrices";
import { useLang, useT } from "../shared/i18n";
import { PortfolioExitButton, type PortfolioSellHandler } from "./PortfolioExitButton";
import { PortfolioRegisterBuyButton, type PortfolioRegisterBuyHandler } from "./PortfolioRegisterBuyButton";
import { EisDeepDiveView } from "./EisDeepDiveView";
import { TickerFinancial8kPanel } from "./TickerFinancial8kPanel";
import {
  setEisDeepDiveFocus,
  getEisDeepDiveFocus,
} from "../sheet/eisDeepDiveFocusStore";
import { useLossRiskCatalog, lookupLossRisk, lookupLossRiskByRowKey } from "../hooks/useLossRiskCatalog";
import {
  LossRiskBreakdownModal,
  type LossRiskEntry,
} from "./LossRiskPoopCell";
import { clinicalKpiFromSimRow, buildTickerEisDetail } from "../sheet/tickerEisSummary";
import {
  classifyPeakAnomaly,
  type OhlcvBar,
  type VolumeCharacterResult,
} from "../sheet/volumeCharacter";
import type { InvestSimHistoryPoint } from "../sheet/investSimStorage";
import {
  formatDeskVolumeQtyOnly,
  deskVolumeQtyTooltip,
  fillDeskSessionPriceFromSim,
  formatPriceVolDivergence,
  isVolumeSurge,
  peekVolumeVsPrevCache,
} from "../sheet/volumeVsPrevSession";
import { isDuringUsEquityRegularHours } from "../sheet/marketSession";
import {
  formatNextCatalystChip,
  precatEventTypeLabel,
  resolveNextCatalystEvent,
  type PrecatEventType,
} from "../sheet/nextCatalystEvent";
import {
  TickerImpactEventsPanelProvider,
  TickerImpactEventsContextSection,
  TickerImpactEventsCdStudyStrip,
  useTickerImpactEventsCtx,
  fmtSignedEis,
} from "./TickerImpactEventsPanel";
import {
  buildResidualMoveBreakdownForTicker,
  formatResidualSummary,
} from "../sheet/residualMoveAttribution";
import { CompanyProfileModal } from "./CompanyProfileModal";
import {
  buildCompanyProfileOverview,
  simRowsForTicker,
} from "../sheet/companyProfileOverview";
import { TickerVolumeEisChart } from "./TickerVolumeEisChart";
import { maybeTriggerEisForHighVol } from "../sheet/volumeAccelEisTrigger";
import {
  collectPastCdOffBookTickers,
  tickerHasHighVol,
} from "../sheet/evaluationMomentumInclude";
import { useClinicalPreCdRecords } from "../hooks/useClinicalPreCdRecords";
import {
  buildCdPatternTickerRecommendation,
  resolveNearestEisForTicker,
  type CdPatternTickerRecommendation,
} from "../sheet/cdPatternRecommendation";
import { loadEisSuperScoreState, type EisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import {
  buildDecisionChartRow,
  loadDecisionChartMcsDoc,
  resolveRegSignedScoreForTicker,
} from "../sheet/decisionChartBuild";
import {
  decisionRecLabel,
  decisionRecTextClass,
  summarizeDecisionRecs,
  type DecisionChartTickerRow,
  type DecisionRec,
} from "../sheet/decisionChartLogic";
import {
  attachContCutPriority,
  evaluateSoftSellGrade1,
  evaluateUrgentSellGrade2Book,
  isUrgentSellGrade2Key,
} from "../sheet/softSignalGrades";
import { priorSessionDayPnlByKey } from "../sheet/urgentSellBookLegs";
import { recordDecisionRecSnapshots } from "../sheet/decisionChartRecHistory";
import {
  lossAnalysisCapitalDenominatorEur,
} from "../sheet/lossAnalysisSummaryCapitalKpi";
import type { MarketContextSnapshotDoc } from "../sheet/marketContextScore";
import { buildPriceVariationWindows } from "../sheet/priceVariationVsMarket";
import type { PriceVarChartRange } from "../sheet/priceVariationSeries";
import { currentPriceFromRow, dailyChangePctFromRow } from "../sheet/simulationPosition";
import { useInViewOnce } from "../hooks/useInViewOnce";
import { pushMobileDecisionChartNow, scheduleMobileDecisionChartPublish, MOBILE_DECISION_SYNC_FAILED_EVENT, type MobileDecisionChartPushResult } from "../api/mobileDashboardSnapshot";
import { hasStoredApiToken } from "../api/supernova";
import { resolveMobileSyncApiBase } from "../shared/remoteHost";
import {
  buildMobileDecisionChartViews,
  unionDecisionChartRows,
  type MobileDecisionChartViewId,
  type MobileDecisionChartViews,
} from "../api/mobileDecisionChartSnapshot";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";

import { ModalChartHorizonBanner } from "./ModalChartHorizonBanner";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import { getEvalLabProfile, setEvalLabProfile, useEvalLabProfile } from "../sheet/evalLabProfileStore";
import {
  isSearchInterestScored,
  missingSearchInterestTickers,
  peekSearchInterestRows,
  rememberSearchInterestRows,
  subscribeSearchInterestStore,
} from "../sheet/searchInterestStore";
import {
  missingTopKpiTrendsTickers,
  peekTopKpiTrendsDailyCache,
  rememberTopKpiTrendsDailyCache,
} from "../sheet/topKpiTrendsDailyCache";
import { SearchInterestDualMark } from "./SearchInterestTrendMark";

const LOSS_SUMMARY_TABLE_COLLAPSED_KEY = "supernova_loss_summary_collapsed_v1";
/** Shared plot height — Price variation & Volume vs EIS (full tab width). */
const LOSS_ASSESSMENT_PAIR_PLOT_H = 212;
/** Dense cards — charts are the analysis centerpiece, but keep the card scannable. */
const LOSS_ANALYSIS_PAIR_PLOT_H = 172;
const CHART_INVIEW_MARGIN_OPP = "200px 0px";
const CHART_INVIEW_MARGIN_PORTFOLIO = "80px 0px";

function matchLossItemByFocus(
  list: PortfolioLossAnalysisItem[],
  rowKey?: string,
  tk?: string,
): PortfolioLossAnalysisItem | undefined {
  if (rowKey) {
    const hit = list.find((i) => i.key === rowKey);
    if (hit) return hit;
  }
  if (tk) return list.find((i) => i.ticker.toUpperCase() === tk);
  return undefined;
}

function resolveTopKpiLandTarget(
  rowKey: string | undefined,
  tk: string | undefined,
  portfolioItems: PortfolioLossAnalysisItem[],
  opportunityItems: PortfolioLossAnalysisItem[],
  catalystItems: PortfolioLossAnalysisItem[],
): { item: PortfolioLossAnalysisItem; profile: LossAnalysisProfile } | null {
  const p = matchLossItemByFocus(portfolioItems, rowKey, tk);
  if (p) return { item: p, profile: "portfolio" };
  const o = matchLossItemByFocus(opportunityItems, rowKey, tk);
  if (o) return { item: o, profile: "opportunities" };
  const c = matchLossItemByFocus(catalystItems, rowKey, tk);
  if (c) return { item: c, profile: "catalysts" };
  return null;
}

function loadSummaryTableCollapsed(profile: LossAnalysisProfile): boolean {
  if (typeof window === "undefined") return profile === "portfolio";
  try {
    const raw = localStorage.getItem(LOSS_SUMMARY_TABLE_COLLAPSED_KEY);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return profile === "portfolio";
  } catch {
    return profile === "portfolio";
  }
}

function saveSummaryTableCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LOSS_SUMMARY_TABLE_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function sortLossItemsByVolPct(
  items: PortfolioLossAnalysisItem[],
  volByTicker: Record<string, VolumeVsPrevSessionRow>,
): PortfolioLossAnalysisItem[] {
  const pctOf = (ticker: string) => {
    const pct = volByTicker[ticker.trim().toUpperCase()]?.pct_of_prev;
    return pct != null && Number.isFinite(pct) ? pct : Number.NEGATIVE_INFINITY;
  };
  return [...items].sort((a, b) => {
    const va = pctOf(a.ticker);
    const vb = pctOf(b.ticker);
    if (vb !== va) return vb - va;
    const da = a.daysToCd ?? 9999;
    const db = b.daysToCd ?? 9999;
    if (da !== db) return da - db;
    return a.ticker.localeCompare(b.ticker);
  });
}

function LossAnalysisChartSectionHeader({
  title,
  caption,
  dense = false,
}: {
  title: string;
  caption: string;
  dense?: boolean;
}) {
  return (
    <div className="shrink-0">
      <h4
        className={`font-bold uppercase tracking-wide text-ink leading-tight${
          dense ? " text-[10px]" : " text-[11px]"
        }`}
      >
        {title}
      </h4>
      {caption ? (
        <p
          className={`text-ink-muted leading-snug${
            dense ? " text-[9px] line-clamp-2" : " text-[10px] line-clamp-2"
          }`}
          title={caption}
        >
          {caption}
        </p>
      ) : null}
    </div>
  );
}

function LossAnalysisChartPairFrame({
  rowKey,
  item,
  simRow,
  priceVariationWindows,
  mcsDoc,
  intradayPrior,
  intradayLive,
  marketIntradayPrior,
  marketIntradayLive,
  intradayBatchLoading = false,
  cycleAlertsByKey = null,
  clinicalRecords,
  clinicalKpi,
  pairRange,
  onPairRangeChange,
  pairPlotH,
  dense,
  it,
  className = "",
  operationalRec = null,
}: {
  rowKey: string;
  item: PortfolioLossAnalysisItem;
  simRow: Record<string, unknown> | null;
  priceVariationWindows: ReturnType<typeof buildPriceVariationWindows>;
  mcsDoc?: MarketContextSnapshotDoc | null;
  intradayPrior?: import("../sheet/simUniverse24hWhatIf").IntradayPricePoint[];
  intradayLive?: import("../sheet/simUniverse24hWhatIf").IntradayPricePoint[];
  marketIntradayPrior?: IntradayPricePoint[];
  marketIntradayLive?: IntradayPricePoint[];
  intradayBatchLoading?: boolean;
  cycleAlertsByKey?: CatalystCycleAlertsResponse["alerts"] | null;
  clinicalRecords?: import("../api/supernova").ClinicalPreCdRecord[];
  clinicalKpi?: number | null;
  pairRange: PriceVarChartRange;
  onPairRangeChange: (range: PriceVarChartRange) => void;
  pairPlotH: number;
  dense?: boolean;
  it: boolean;
  className?: string;
  operationalRec?: DecisionRec | null;
}) {
  const t = useT();
  const cycleAlert = useMemo(
    () => cycleAlertForKey(cycleAlertsByKey, rowKey, item.ticker),
    [cycleAlertsByKey, rowKey, item.ticker],
  );
  const guidanceEvents = useTickerGuidanceEvents(item.ticker);
  /** One OHLCV fetch for both price + volume (covers volume-character floor). */
  const pairOhlcvDays = pairOhlcvFetchDays(pairRange);
  const sharedOhlcv = useOhlcvHistory(item.ticker, pairOhlcvDays);
  /** One dashed crosshair across price + volume for the same calendar day. */
  const pairSyncId = `price-volume-${rowKey}`;
  return (
    <div
      className={`invest-trend-chart-panel rounded-lg border flex flex-col w-full min-w-0${
        dense ? " p-1.5 gap-1.5" : " p-2.5 gap-2"
      }${className ? ` ${className}` : ""}`}
    >
      <div id={lossAnalysisChartSectionDomId(rowKey, "priceVar")} className="flex flex-col gap-0.5 shrink-0">
        <LossAnalysisChartSectionHeader
          title={t("sim.lossAnalysis.chart.varCombined")}
          caption={t("sim.lossAnalysis.chart.caption.varCombined")}
          dense={dense}
        />
        <PriceVariationChart
          ticker={item.ticker}
          windows={priceVariationWindows}
          marketLabel="XBI"
          marketDoc={mcsDoc}
          intradayPrior={intradayPrior}
          intradayLive={intradayLive}
          marketIntradayPrior={marketIntradayPrior}
          marketIntradayLive={marketIntradayLive}
          intradayBatchLoading={intradayBatchLoading}
          cycleAlert={cycleAlert}
          currentPriceUsd={simRow ? currentPriceFromRow(simRow) : null}
          embedded
          dense={dense}
          height={pairPlotH}
          range={pairRange}
          onRangeChange={onPairRangeChange}
          hideRangeControls
          operationalRec={operationalRec}
          recHistoryKey={rowKey}
          syncId={pairSyncId}
          guidanceEvents={guidanceEvents}
          completionDate={item.completionDate}
          clinicalRecords={clinicalRecords}
          sharedOhlcvBars={sharedOhlcv.bars}
          sharedOhlcvLoading={sharedOhlcv.loading}
          simRow={simRow}
        />
      </div>

      <div className="border-t border-[rgb(var(--border))]/25 shrink-0" aria-hidden />

      <div
        id={lossAnalysisChartSectionDomId(rowKey, "volumeEis")}
        className="flex flex-col gap-0.5 shrink-0 flex-1 min-h-0"
      >
        <LossAnalysisChartSectionHeader
          title={t("sim.lossAnalysis.chart.volumeEis.title")}
          caption={t("sim.lossAnalysis.chart.volumeEis.caption")}
          dense={dense}
        />
        <TickerVolumeEisChart
          ticker={item.ticker}
          clinicalRecords={clinicalRecords}
          sheetClinicalKpi={clinicalKpi}
          simRow={simRow}
          lang={it ? "it" : "en"}
          height={pairPlotH}
          dense={dense}
          range={pairRange}
          onRangeChange={onPairRangeChange}
          intradayPrior={intradayPrior}
          intradayLive={intradayLive}
          intradayBatchLoading={intradayBatchLoading}
          syncId={pairSyncId}
          guidanceEvents={guidanceEvents}
          operationalRec={operationalRec}
          recHistoryKey={rowKey}
          sharedOhlcvBars={sharedOhlcv.bars}
          sharedOhlcvLoading={sharedOhlcv.loading}
          sharedOhlcvError={sharedOhlcv.error}
        />
      </div>

      <PriceVarChartRangeToolbar
        range={pairRange}
        onRangeChange={onPairRangeChange}
        it={it}
        dense={dense}
      />
    </div>
  );
}

function cardShellClass(item: PortfolioLossAnalysisItem): string {
  if (item.exitDecision === "exit") {
    return "border-2 border-[rgb(var(--signal-down))]/35 bg-[rgb(var(--signal-down))]/[0.04]";
  }
  if (item.inLoss) {
    return "border-2 border-[rgb(var(--warn))]/35 bg-[rgb(var(--warn))]/[0.05]";
  }
  if ((item.pnlPct ?? 0) > 0.05) {
    return "border-2 border-[rgb(var(--signal-up))]/30 bg-[rgb(var(--signal-up))]/[0.04]";
  }
  return "border-2 border-[rgb(var(--border))]/45 bg-white/90";
}

function cardHeaderClass(item: PortfolioLossAnalysisItem): string {
  if (item.exitDecision === "exit") {
    return "border-b border-[rgb(var(--signal-down))]/20 bg-[rgb(var(--signal-down))]/6";
  }
  if (item.inLoss) {
    return "border-b border-[rgb(var(--warn))]/25 bg-[rgb(var(--warn))]/8";
  }
  return "border-b border-[rgb(var(--border))]/30 bg-surface/40";
}

/** Compact CD chip date: "2026-09-21" → "21 Sep". */
function fmtCompactCdDate(iso: string, it: boolean): string {
  const raw = iso.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return raw;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(it ? "it-IT" : "en-GB", { day: "numeric", month: "short" });
}

/** ★ · Ticker · Product·Desig · News scores · Momentum · Product · Designation · Catalyst · Study Phase · Days · 24h · Volume · G-Trends · Recommendation
 *  (catalysts profile adds Source Quote → +1) */
const KPI_SUMMARY_COL_COUNT = 14;
const KPI_SUMMARY_COL_COUNT_CATALYSTS = 15;

/** Narrow star col, remaining data cols share the rest evenly. */
function kpiSummaryColWidths(columnCount: number): number[] {
  if (columnCount <= 1) return [100];
  const star = 2.4;
  const each = Math.floor(((100 - star) * 100) / (columnCount - 1)) / 100;
  const widths = [star, ...Array.from({ length: columnCount - 1 }, () => each)];
  const sum = widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] =
    Math.round((widths[widths.length - 1]! + (100 - sum)) * 100) / 100;
  return widths;
}

/** Match Catalyst Days desk table chrome exactly (HomeSignalsDesk DESK_CELL / DESK_TH). */
const KPI_DESK_CELL = "px-1 py-0.5 align-middle border-b border-[rgb(var(--border))]/25";
const KPI_TH = `${KPI_DESK_CELL} font-medium bg-[rgb(var(--surface))]`;
/** Body text — same as Catalyst row spans (`text-[10px] font-medium`). */
const KPI_DATA_TEXT = "text-[10px] font-medium tabular-nums leading-tight";
/** Header row — same as Catalyst `<tr>` (`text-[9px] uppercase tracking-[0.05em]`). */
const KPI_THEAD_TR =
  "text-[9px] uppercase tracking-[0.05em] text-ink-muted text-left border-b border-[rgb(var(--border))]/50";

/** Sortable Top KPI columns (click header like Catalyst desk). */
type KpiSortCol =
  | "ticker"
  | "productDesig"
  | "newsScores"
  | "momentum"
  | "product"
  | "designation"
  | "catalyst"
  | "phase"
  | "days"
  | "var24h"
  | "volume"
  | "trends"
  | "rec";
type KpiSortDir = "asc" | "desc";

function defaultKpiSortDir(col: KpiSortCol): KpiSortDir {
  if (
    col === "ticker" ||
    col === "productDesig" ||
    col === "product" ||
    col === "designation" ||
    col === "catalyst" ||
    col === "phase" ||
    col === "days"
  ) {
    return "asc";
  }
  return "desc";
}

function compareKpiSortValues(
  a: number | string | null,
  b: number | string | null,
  dir: KpiSortDir,
): number {
  const aNull =
    a == null || a === "" || (typeof a === "number" && !Number.isFinite(a));
  const bNull =
    b == null || b === "" || (typeof b === "number" && !Number.isFinite(b));
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  let c = 0;
  if (typeof a === "string" && typeof b === "string") {
    c = a.localeCompare(b, undefined, { sensitivity: "base" });
  } else {
    c = Number(a) - Number(b);
  }
  return dir === "asc" ? c : -c;
}

function KpiSortHeader({
  col,
  sortKey,
  sortDir,
  onSort,
  align = "center",
  it,
  title,
  children,
}: {
  col: KpiSortCol;
  sortKey: KpiSortCol | null;
  sortDir: KpiSortDir;
  onSort: (col: KpiSortCol) => void;
  align?: "left" | "center";
  it: boolean;
  title?: string;
  children: ReactNode;
}) {
  const active = sortKey === col;
  return (
    <button
      type="button"
      className={`text-[9px] font-medium uppercase tracking-[0.06em] leading-tight hover:text-[rgb(var(--accent))] ${
        active ? "text-[rgb(var(--accent))]" : "text-ink-muted"
      } ${align === "center" ? "w-full text-center" : "text-left"}`}
      title={
        title
          ? `${title}\n${
              it
                ? "Clic: ordina · di nuovo clic: inverti"
                : "Click: sort · click again: reverse"
            }`
          : it
            ? "Clic: valori più alti in alto · di nuovo clic: inverti"
            : "Click: highest on top · click again: reverse"
      }
      aria-sort={
        active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      }
      onClick={(e) => {
        e.stopPropagation();
        onSort(col);
      }}
    >
      <span className="inline-flex items-center gap-0.5">
        {children}
        {active ? (
          <span className="text-[8px] opacity-80" aria-hidden>
            {col === "days" ||
            col === "ticker" ||
            col === "product" ||
            col === "designation" ||
            col === "catalyst" ||
            col === "phase"
              ? sortDir === "asc"
                ? "↑"
                : "↓"
              : sortDir === "desc"
                ? "↑"
                : "↓"}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function kpiTh(align: "center" | "left" = "center"): string {
  const a = align === "left" ? "text-left" : "text-center";
  return `${KPI_TH} ${a}`;
}

function kpiDataTd(align: "center" | "left" = "center"): string {
  const a = align === "left" ? "text-left" : "text-center";
  return `${KPI_DESK_CELL} ${a} ${KPI_DATA_TEXT}`;
}

function resolveSummaryStudyPhase(
  simRow: Record<string, unknown> | null | undefined,
  clinicalRecords: import("../api/supernova").ClinicalPreCdRecord[] | null | undefined,
  ticker: string,
  it: boolean,
  opts?: { completionDate?: unknown; drugHint?: string | null },
): string {
  const { primary } = resolveDeskRowClinicalStudies(ticker, clinicalRecords ?? null, {
    simRow,
    completionDate: opts?.completionDate,
    drugHint: opts?.drugHint,
  });
  return deskRowStudyPhaseLabel(simRow, primary, it);
}

/** Batched session volume as % of last market close for the KPI snapshot rows. */
function useVolumeVsPrevSession(tickers: string[], enabled: boolean) {
  const tickerKey = tickers.join(",");
  const [rows, setRows] = useState<Record<string, VolumeVsPrevSessionRow>>(
    () => peekVolumeVsPrevCache(tickers).rows,
  );
  useEffect(() => {
    if (!enabled || !tickerKey) return;
    let alive = true;
    const list = tickerKey.split(",");
    const peeked = peekVolumeVsPrevCache(list).rows;
    if (Object.keys(peeked).length) {
      setRows((prev) => mergeTickerMaps(prev, peeked));
    }
    fetchVolumeVsPrevSession(list)
      .then((payload) => {
        if (!alive) return;
        setRows((prev) => mergeTickerMaps(prev, payload.rows ?? {}));
      })
      .catch(() => {
        /* keep the last good snapshot — the Vol % cell falls back to "—" */
      });
    return () => {
      alive = false;
    };
  }, [tickerKey, enabled]);
  return rows;
}

function useSearchInterestByTicker(tickers: string[], enabled: boolean) {
  const unique = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const tickerKey = unique.join(",");
  const [rows, setRows] = useState<Record<string, SearchInterestRow>>(() => {
    const daily = peekTopKpiTrendsDailyCache() ?? {};
    return { ...daily, ...peekSearchInterestRows(unique) };
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tickerKey) {
      // Keep last scored prints — do not wipe when the table briefly mounts empty.
      setLoading(false);
      return;
    }
    const list = tickerKey.split(",");
    const sync = () => {
      const daily = peekTopKpiTrendsDailyCache() ?? {};
      // Seed shared store from Rome-day cache so other desks / live map stay warm.
      if (Object.keys(daily).length) rememberSearchInterestRows(daily);
      const merged = { ...daily, ...peekSearchInterestRows(list) };
      setRows((prev) => assignTickerMapsPreserving(prev, merged));
    };
    sync();
    return subscribeSearchInterestStore(sync);
  }, [tickerKey]);

  useEffect(() => {
    if (!enabled || !tickerKey) {
      setLoading(false);
      return;
    }
    let alive = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const list = tickerKey.split(",");

    const daily = peekTopKpiTrendsDailyCache();
    if (daily && Object.keys(daily).length) {
      rememberTopKpiTrendsDailyCache(daily);
    }

    const loadMissing = () => {
      void (async () => {
        // Prefer Rome-day gaps; also pull anything still missing from the shared store.
        const need = [
          ...new Set([
            ...missingTopKpiTrendsTickers(list),
            ...missingSearchInterestTickers(list),
          ]),
        ].filter((tk) => !isSearchInterestScored(peekSearchInterestRows([tk])[tk]));
        if (!need.length) {
          const have = peekSearchInterestRows(list);
          if (Object.keys(have).length) rememberTopKpiTrendsDailyCache(have);
          if (alive) {
            setRows((prev) =>
              assignTickerMapsPreserving(prev, {
                ...(peekTopKpiTrendsDailyCache() ?? {}),
                ...have,
              }),
            );
            setLoading(false);
          }
          return;
        }
        if (alive) setLoading(true);
        let warming = false;
        for (let i = 0; i < need.length; i += 8) {
          if (!alive) return;
          const chunk = need.slice(i, i + 8);
          try {
            const payload = await fetchSearchInterest(chunk);
            if (!alive) return;
            if (payload.warming) warming = true;
            if (payload.rows) rememberTopKpiTrendsDailyCache(payload.rows);
          } catch {
            warming = true;
          }
        }
        if (!alive) return;
        const still = [
          ...new Set([
            ...missingTopKpiTrendsTickers(list),
            ...missingSearchInterestTickers(list),
          ]),
        ].filter((tk) => !isSearchInterestScored(peekSearchInterestRows([tk])[tk]));
        if ((warming || still.length > 0) && attempt < 4) {
          attempt += 1;
          timer = setTimeout(loadMissing, attempt <= 2 ? 2500 : 5000);
          return;
        }
        setLoading(false);
      })();
    };

    const cachedMissing = missingTopKpiTrendsTickers(list);
    const storeMissing = missingSearchInterestTickers(list);
    if (cachedMissing.length === 0 && storeMissing.length === 0) {
      const have = {
        ...(peekTopKpiTrendsDailyCache() ?? {}),
        ...peekSearchInterestRows(list),
      };
      rememberSearchInterestRows(have);
      setRows((prev) => assignTickerMapsPreserving(prev, have));
      setLoading(false);
      return () => {
        alive = false;
      };
    }
    loadMissing();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [tickerKey, enabled]);

  return { rows, loading };
}

function useVolumeAcceleration(tickers: string[], enabled: boolean) {
  const [rows, setRows] = useState<Record<string, VolumeAccelRow>>({});
  const tickerKey = tickers.join(",");
  useEffect(() => {
    if (!enabled || !tickerKey) {
      setRows({});
      return;
    }
    let alive = true;
    fetchVolumeAcceleration(tickerKey.split(","))
      .then((payload) => {
        if (alive) setRows(payload.rows ?? {});
      })
      .catch(() => {
        /* keep last */
      });
    return () => {
      alive = false;
    };
  }, [tickerKey, enabled]);
  return rows;
}

const VOLUME_CHARACTER_EVAL_MAX = 16;
const VOLUME_CHARACTER_FETCH_DAYS = 60;

function barsFromVolumeHistory(
  bars: { date: string; volume: number | null; close?: number | null; open?: number | null; high?: number | null; low?: number | null }[],
): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  for (const b of bars) {
    if (!b.date || b.volume == null || !(Number(b.volume) > 0)) continue;
    const row: OhlcvBar = {
      date: String(b.date).slice(0, 10),
      volume: Number(b.volume),
      close: b.close != null && Number(b.close) > 0 ? Number(b.close) : 0,
    };
    if (b.open != null && Number(b.open) > 0) row.open = Number(b.open);
    if (b.high != null && Number(b.high) > 0) row.high = Number(b.high);
    if (b.low != null && Number(b.low) > 0) row.low = Number(b.low);
    out.push(row);
  }
  return out;
}

/** Character tags for High Vol / accel names only (bounded Yahoo fetches). */
function useVolumeCharacterByTicker(
  tickers: string[],
  enabled: boolean,
  clinicalRecords: import("../api/supernova").ClinicalPreCdRecord[] | undefined,
  lang: "it" | "en",
): Record<string, VolumeCharacterResult> {
  const [rows, setRows] = useState<Record<string, VolumeCharacterResult>>({});
  const limited = tickers.slice(0, VOLUME_CHARACTER_EVAL_MAX);
  const tickerKey = limited.join(",");
  const recordsRef = useRef(clinicalRecords);
  recordsRef.current = clinicalRecords;

  useEffect(() => {
    if (!enabled || !tickerKey) {
      setRows({});
      return;
    }
    let alive = true;
    const list = tickerKey.split(",").filter(Boolean);
    void (async () => {
      const next: Record<string, VolumeCharacterResult> = {};
      await Promise.all(
        list.map(async (tk) => {
          try {
            const doc = await fetchVolumeHistory(tk, VOLUME_CHARACTER_FETCH_DAYS);
            const bars = barsFromVolumeHistory(doc.bars ?? []);
            const detail = buildTickerEisDetail(tk, lang, null, recordsRef.current, null);
            const eisDates = detail.events
              .map((ev) => ev.eventDate)
              .filter((d): d is string => Boolean(d));
            const hit = classifyPeakAnomaly(bars, eisDates, 5, true);
            if (hit) next[tk] = hit;
          } catch {
            /* skip ticker */
          }
        }),
      );
      if (alive) setRows(next);
    })();
    return () => {
      alive = false;
    };
  }, [tickerKey, enabled, lang]);

  return rows;
}

/** Days-to-catalyst cell (replaces T−CD column). Past = bold orange. */
function kpiDaysToCatalystDisplay(
  days: number,
  it: boolean,
): { label: string; className: string } {
  const unit = it ? "g" : "d";
  if (days < 0) {
    return {
      label: `+${Math.abs(days)}${unit}`,
      className: "font-bold text-orange-600 dark:text-orange-400",
    };
  }
  if (days <= SIM_PEAK_ZONE_DAYS) {
    return { label: `${days}${unit}`, className: "text-[rgb(var(--signal-up))]" };
  }
  if (days <= SIM_HOT_ZONE_DAYS) {
    return { label: `${days}${unit}`, className: "text-ink" };
  }
  return { label: `${days}${unit}`, className: "text-ink-muted" };
}

const KPI_CATALYST_TYPE_COLORS: Record<string, string> = {
  readout: "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200",
  submission: "bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200",
  approval: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200",
  pdufa: "bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200",
  partnership: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200",
  preclinical: "bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300",
  initiation: "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-800 dark:text-cyan-200",
  fda_vote: "bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200",
  fda_safety: "bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300",
  trial_primary_completion: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200",
  cd: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200",
  other: "bg-gray-100 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300",
};


/** Top KPI table row — memoized; live props are per-ticker slices (not whole maps). */
const LossAnalysisSummaryTableRow = memo(function LossAnalysisSummaryTableRow({
  item,
  it,
  t,
  profile,
  simRow,
  live,
  guidanceKpi,
  isRowHighlighted,
  dcRow,
  decisionRec,
  sdsScore,
  urgentSellG2,
  capitalDenominatorEur: _capitalDenominatorEur,
  inputs: _inputs,
  clinicalRecords,
  history: _history,
  sdsRow: _sdsRow,
  chartPts,
  priorSessionPct,
  intraday: _intraday,
  trendsLoading = false,
  fdaDesignation,
  newsProductDesig,
  newsScores = null,
  onScrollTo,
  onOpenClinicalStudies,
}: {
  item: PortfolioLossAnalysisItem;
  it: boolean;
  t: ReturnType<typeof useT>;
  profile: LossAnalysisProfile;
  simRow: Record<string, unknown> | null;
  live: KpiLiveStores;
  guidanceKpi: NonNullable<ReturnType<GuidanceKpiByTicker["get"]>> | undefined;
  isRowHighlighted: boolean;
  dcRow: DecisionChartTickerRow | undefined;
  decisionRec: DecisionRec;
  sdsScore: number | null;
  urgentSellG2: ReturnType<typeof evaluateUrgentSellGrade2Book>;
  capitalDenominatorEur: number;
  inputs: InvestSimInputs;
  clinicalRecords?: import("../api/supernova").ClinicalPreCdRecord[];
  history?: InvestSimHistoryPoint[];
  sdsRow: SdsRow | null;
  chartPts: ChartPoint[] | null;
  priorSessionPct: number | null | undefined;
  intraday: { prior?: IntradayPricePoint[]; live?: IntradayPricePoint[] } | undefined;
  trendsLoading?: boolean;
  /** Discovery + FDA-site designations for this ticker (product search). */
  fdaDesignation?: FdaDesignationRow | null;
  /** Product + designations mined from Daily News / Manual. */
  newsProductDesig?: NewsProductDesignationHint | null;
  /** Daily News taxonomy scores (EIS + Clin/Fin/…). */
  newsScores?: NewsDimensionScores | null;
  onScrollTo: (key: string) => void;
  onOpenClinicalStudies?: (payload: {
    ticker: string;
    company: string | null;
    primaryNctId: string | null;
    studies: DeskClinicalStudyListItem[];
  }) => void;
}) {
  const tk = item.ticker.trim().toUpperCase();
  const debugRenders = isDebugRendersEnabled();
  const renderN = useDebugRenderCount(debugRenders, item.key);
  const volumeVsPrev = useKeyedMapEntry(live.vol, tk) ?? null;
  const searchInterestRow = useKeyedMapEntry(live.trend, tk);
  const accumRow = useKeyedMapEntry(live.accum, tk);
  const vsXbiRow = useKeyedMapEntry(live.vsXbi, tk);
  const gkpi = guidanceKpi;
                const bestEv = gkpi?.bestEvent;

                const nextCatalyst = resolveNextCatalystEvent({
                  ticker: item.ticker,
                  completionDate: item.completionDate,
                  daysToCd: item.daysToCd,
                  guidanceEvent: bestEv,
                });
  const eventDateForVol = (
    nextCatalyst?.eventDate ||
    item.completionDate ||
    ""
  )
    .toString()
    .slice(0, 10);
  const eventVol = useKeyedMapEntry(
    live.eventVol,
    eventDateForVol ? eventVolPairKey(tk, eventDateForVol) : "",
  );
  const filledVol = fillDeskSessionPriceFromSim(volumeVsPrev, {
    lastPrice: simRow ? currentPriceFromRow(simRow) : null,
    dailyChangePct:
      (simRow ? dailyChangePctFromRow(simRow) : null) ?? priorSessionPct,
  });
  const diverge = formatPriceVolDivergence(filledVol, it);
  const momentumCell = formatBiasCell(
    {
      rr10: eventVol?.rr10 ?? null,
      priceVolKind: priceVolKindFromLabel(diverge.label),
      insiderNetBuy30d: accumRow?.insider_net_buy_30d ?? null,
      relativeMove: vsXbiRow?.relative_move ?? null,
    },
    it,
  );
  const momentumTone = toDeskIndexTone(momentumCell.tone);
                const daysToCatalyst =
                  nextCatalyst?.daysUntil ??
                  (item.daysToCd != null && Number.isFinite(item.daysToCd)
                    ? Math.round(item.daysToCd)
                    : null);
                const daysKpi =
                  daysToCatalyst == null
                    ? null
                    : kpiDaysToCatalystDisplay(daysToCatalyst, it);
                const catalystTypeKey = (
                  (bestEv?.event_type && String(bestEv.event_type)) ||
                  nextCatalyst?.eventType ||
                  ""
                )
                  .toString()
                  .toLowerCase()
                  .trim();
                const catalystTypeLabel = (() => {
                  if (nextCatalyst && (!bestEv?.event_type || nextCatalyst.source === "sim_cd")) {
                    return precatEventTypeLabel(nextCatalyst.eventType, it);
                  }
                  if (!catalystTypeKey) return null;
                  const known: PrecatEventType[] = [
                    "trial_primary_completion",
                    "trial_study_completion",
                    "pdufa",
                    "readout",
                    "submission",
                    "approval",
                    "conference_abstract",
                    "cd",
                    "other",
                  ];
                  if ((known as string[]).includes(catalystTypeKey)) {
                    return precatEventTypeLabel(catalystTypeKey as PrecatEventType, it);
                  }
                  // fda_vote → "AdCom", etc.
                  if (catalystTypeKey === "fda_vote") return it ? "AdCom" : "AdCom";
                  if (catalystTypeKey === "fda_safety") return it ? "FDA safety" : "FDA safety";
                  return catalystTypeKey.replace(/_/g, " ");
                })();
  // Soft BUY streak + price lows: memoized so parent ticks don't redo them.
  const softBuyG1 = useMemo(
    () =>
      deriveKpiSoftBuyG1({
        item,
                  sdsScore,
                  pplan: dcRow?.scores.pplan ?? item.recoveryProbabilityPct,
        simRow,
        chartPts,
        priorSessionPct,
      }),
    [
      item,
      sdsScore,
      dcRow?.scores.pplan,
      simRow,
      chartPts,
      priorSessionPct,
    ],
  );
                const softSellG1 = evaluateSoftSellGrade1({
                  hasPosition: item.hasPosition,
                  pnlPct: item.pnlPct,
                  pplan: dcRow?.scores.pplan ?? item.recoveryProbabilityPct,
                  riskV2: dcRow?.scores.riskV2 ?? null,
                  regRisk: dcRow?.scores.regRisk ?? null,
                  simRow,
                  investedAt: item.investedAt,
                });
                const urgentG2 = isUrgentSellGrade2Key(urgentSellG2, item.key);
                const urgentG2Hit = urgentSellG2.hits.find((h) => h.key === item.key);
                const change24hPct = item.pnlPct24h ?? null;
                /** Row wash = Momentum column bullish only (same as Catalyst Bias). Not 24h %. */
                const momentumPos = momentumCell.tone === "up";
                const clinicalStudyCtx = resolveDeskRowClinicalStudies(
                  item.ticker,
                  clinicalRecords,
                  {
                    simRow,
                    completionDate: item.completionDate,
                    drugHint:
                      clinicalDrugFromSimRow(simRow ?? undefined) ||
                      (bestEv?.asset_name && String(bestEv.asset_name).trim()) ||
                      null,
                  },
                );
                const studyPhase = deskRowStudyPhaseLabel(
                  simRow,
                  clinicalStudyCtx.primary,
                  it,
                );
                const simRowForMeta = simRow ?? undefined;
                const assetLabel =
                  clinicalAssetProductName(clinicalRecords, {
                    ticker: item.ticker,
                    nctId: clinicalNctFromSimRow(simRowForMeta),
                  }) ||
                  (bestEv?.asset_name && String(bestEv.asset_name).trim()) ||
                  clinicalDrugFromSimRow(simRowForMeta) ||
                  newsProductDesig?.product ||
                  fdaDesignation?.product ||
                  "";
                const designationLabel = (() => {
                  const parts = new Set<string>();
                  const addDesig = (raw: string | null | undefined) => {
                    const n = normalizeFdaDesignationLabel(raw);
                    if (n) parts.add(n);
                    else {
                      for (const x of designationsFromText(raw)) parts.add(x);
                    }
                  };
                  for (const d of fdaDesignation?.designations ?? []) addDesig(d);
                  for (const d of newsProductDesig?.designations ?? []) addDesig(d);
                  const pushEv = (ev: typeof bestEv) => {
                    if (!ev) return;
                    for (const d of ev.regulatory_designations ?? []) addDesig(d);
                    for (const d of designationsFromText(
                      ev.timing_quote,
                      ev.asset_name,
                      ev.indication,
                    )) {
                      parts.add(d);
                    }
                  };
                  pushEv(bestEv);
                  for (const ev of gkpi?.events ?? []) {
                    if (ev === bestEv) continue;
                    pushEv(ev);
                  }
                  for (const d of designationsFromText(
                    clinicalDrugFromSimRow(simRowForMeta),
                    String(simRowForMeta?.guidance_indication ?? ""),
                    String(simRowForMeta?.Drug ?? simRowForMeta?.guidance_asset_name ?? ""),
                  )) {
                    parts.add(d);
                  }
                  for (const rec of clinicalRecords ?? []) {
                    if (String(rec.ticker ?? "").trim().toUpperCase() !== tk) continue;
                    const raw = rec.ai?.study_clinical_profile?.fda_designation;
                    const norm = normalizeFdaDesignationLabel(raw);
                    if (norm) parts.add(norm);
                    for (const d of designationsFromText(raw)) parts.add(d);
                  }
                  return formatSourceList([...parts]);
                })();
                const productDesigLabel = formatProductDesignationCell(
                  newsProductDesig?.product ||
                    fdaDesignation?.product ||
                    assetLabel ||
                    "",
                  designationLabel,
                );
                const designationTip = (() => {
                  const bits: string[] = [];
                  if (designationLabel) bits.push(designationLabel);
                  if (fdaDesignation?.discovery_designations?.length) {
                    bits.push(it ? "Fonte: Discovery" : "Source: Discovery");
                  }
                  if (newsProductDesig?.designations?.length) {
                    bits.push(it ? "Fonte: Daily News" : "Source: Daily News");
                  }
                  for (const s of fdaDesignation?.sources ?? []) {
                    const lab = (s.label || "").trim();
                    const title = (s.title || "").trim();
                    if (lab || title) bits.push([lab, title].filter(Boolean).join(" — "));
                  }
                  if (fdaDesignation?.product) {
                    bits.push(
                      it
                        ? `Ricerca FDA prodotto: ${fdaDesignation.product}`
                        : `FDA product search: ${fdaDesignation.product}`,
                    );
                  }
                  if (newsProductDesig?.product) {
                    bits.push(
                      it
                        ? `Prodotto da news: ${newsProductDesig.product}`
                        : `Product from news: ${newsProductDesig.product}`,
                    );
                  }
                  return bits.join("\n") || undefined;
                })();
                return (
                  <tr
                    id={lossAnalysisTopKpiRowDomId(item.key)}
                    className={`transition-colors hover:bg-[rgb(var(--accent))]/[0.03] ${
                      isRowHighlighted
                        ? "outline outline-2 outline-[rgb(var(--accent))]/55 outline-offset-[-1px] bg-[rgb(var(--accent))]/[0.07]"
                        : momentumPos
                          ? "bg-emerald-500/[0.09]"
                          : ""
                    }`}
                  >
                    <td className={`${kpiDataTd("center")} !px-0.5 w-[1.25rem]`}>
                      <AttentionStarToggle ticker={item.ticker} it={it} sizeClass="text-[12px]" />
                    </td>
                    <td className={`${kpiDataTd("left")} font-semibold text-ink`}>
                      <div className="flex flex-col leading-tight">
                        <div className="flex items-center gap-1 flex-wrap">
                          <button
                            type="button"
                            id={lossAnalysisTopKpiTickerDomId(item.key)}
                            data-top-kpi-ticker=""
                            className={`inline-flex items-center gap-x-1 max-w-full hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-1 ${
                              isRowHighlighted
                                ? "text-[rgb(var(--accent))] underline decoration-[rgb(var(--accent))] decoration-2 underline-offset-2"
                                : "font-semibold text-[rgb(var(--accent))]"
                            }`}
                            title={t("sim.lossAnalysis.summaryTable.jumpTip")}
                            onClick={() => onScrollTo(item.key)}
                          >
                            <StudyTypeTickerIcon
                              ticker={item.ticker}
                              simRow={simRow}
                              clinicalMeta={findClinicalMetaForTicker(clinicalRecords, item.ticker)}
                              size={STUDY_DRUG_ICON_PX}
                            />
                            <span className="min-w-0 truncate text-[10px] font-semibold">{item.ticker}</span>
                            {debugRenders ? (
                              <span
                                className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-black tabular-nums bg-amber-400 text-black border border-amber-600"
                                title="Debug render count (Step 1 isolation)"
                              >
                                {formatDebugRenderBadge(renderN, item.key)}
                              </span>
                            ) : null}
                          </button>
                          {simRow?.hype_volume_funnel ? (
                            <span
                              className="inline-flex items-center shrink-0 rounded-sm px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide leading-none text-violet-800 dark:text-violet-200 border border-violet-400/60 bg-violet-500/15 whitespace-nowrap"
                              title={t("sim.lossAnalysis.summaryTable.hypeTip")}
                            >
                              {t("sim.lossAnalysis.summaryTable.hype")}
                            </span>
                          ) : null}
                          {item.livePriceDead ? (
                            <span
                              className="shrink-0 rounded px-1 py-px text-[8px] font-bold uppercase tracking-wide leading-none text-ink-muted border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-3))]/80 whitespace-nowrap"
                              title={t("sim.lossAnalysis.summaryTable.livePriceDead")}
                            >
                              {t("sim.lossAnalysis.summaryTable.livePriceDeadShort")}
                            </span>
                          ) : null}
                        </div>
                        {item.company ? (
                          <button
                            type="button"
                            className={`truncate max-w-[11rem] text-left text-[9px] leading-snug mt-0.5 hover:underline ${
                              isRowHighlighted
                                ? "text-[rgb(var(--accent))]/90"
                                : "text-ink-muted"
                            }`}
                            title={item.company}
                            onClick={() => onScrollTo(item.key)}
                          >
                            {item.company}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className={`${kpiDataTd("center")} overflow-hidden`}>
                      {assetLabel || designationLabel ? (
                        <span
                          className="inline-flex max-w-full flex-col items-center leading-tight"
                          title={designationTip || productDesigLabel || undefined}
                        >
                          <span className="block w-full truncate text-[10px] font-medium text-ink">
                            {assetLabel ||
                              newsProductDesig?.product ||
                              fdaDesignation?.product ||
                              "—"}
                          </span>
                          {designationLabel ? (
                            <span className="block w-full truncate text-[8px] text-ink-muted leading-snug">
                              {designationLabel}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-ink-muted" title={designationTip}>
                          n/a
                        </span>
                      )}
                    </td>
                    <td className={`${kpiDataTd("center")} overflow-hidden`}>
                      <NewsDimensionScoreCell scores={newsScores} it={it} />
                    </td>
                    <td
                      className={kpiDataTd("center")}
                      title={momentumCell.tip}
                    >
                      <span
                        className={`inline-flex flex-col items-center leading-tight ${
                          momentumTone === "pos"
                            ? "text-emerald-700 dark:text-emerald-300"
                            : momentumTone === "neg"
                              ? "text-rose-700 dark:text-rose-300"
                              : momentumTone === "neu"
                                ? "text-ink"
                                : "text-ink-muted"
                        }`}
                      >
                        <span className="text-[10px] font-medium">{momentumCell.label}</span>
                        {momentumCell.sub ? (
                          <span className="text-[8px] text-ink-muted tabular-nums">
                            {momentumCell.sub}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className={`${kpiDataTd("center")} overflow-hidden`}>
                      {assetLabel ? (
                        <span className="block truncate font-medium text-ink" title={assetLabel}>
                          {assetLabel}
                        </span>
                      ) : (
                        <span className="text-ink-muted">n/a</span>
                      )}
                    </td>
                    <td className={`${kpiDataTd("center")} overflow-hidden`}>
                      {designationLabel ? (
                        <span
                          className="block truncate text-[10px] text-ink leading-snug"
                          title={designationTip}
                        >
                          {designationLabel}
                        </span>
                      ) : (
                        <span className="text-ink-muted" title={designationTip}>
                          n/a
                        </span>
                      )}
                    </td>
                    <td className={kpiDataTd("center")}>
                      {catalystTypeLabel ? (
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide ${
                            KPI_CATALYST_TYPE_COLORS[catalystTypeKey] ||
                            KPI_CATALYST_TYPE_COLORS[nextCatalyst?.eventType ?? ""] ||
                            KPI_CATALYST_TYPE_COLORS.other
                          }`}
                          title={
                            nextCatalyst
                              ? formatNextCatalystChip(nextCatalyst, it)
                              : catalystTypeLabel
                          }
                        >
                          {catalystTypeLabel}
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className={kpiDataTd("center")}>
                      {profile === "catalysts" ? (
                        (() => {
                          const ph = (bestEv?.trial_phase ?? "").trim();
                          if (!ph) return <span className="text-ink-muted">—</span>;
                          return (
                            <span className="truncate max-w-full inline-block" title={`Phase ${ph}`}>
                              Ph {ph}
                            </span>
                          );
                        })()
                      ) : studyPhase || clinicalStudyCtx.others.length ? (
                        <span className="inline-flex max-w-full items-center justify-center gap-0.5">
                          {studyPhase ? (
                            <span
                              className="truncate max-w-[4.5rem] inline-block"
                              title={studyPhase}
                            >
                              {studyPhase}
                            </span>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                          {clinicalStudyCtx.others.length > 0 ? (
                            <button
                              type="button"
                              className="shrink-0 rounded px-0.5 text-[9px] font-bold leading-none text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/10"
                              title={
                                it
                                  ? `Altri ${clinicalStudyCtx.others.length} studi clinici`
                                  : `${clinicalStudyCtx.others.length} more clinical studies`
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenClinicalStudies?.({
                                  ticker: item.ticker,
                                  company: item.company?.trim() || null,
                                  primaryNctId: clinicalStudyCtx.primary?.nctId ?? null,
                                  studies: allDeskClinicalStudiesForModal(
                                    clinicalStudyCtx.primary,
                                    clinicalStudyCtx.others,
                                  ),
                                });
                              }}
                            >
                              +
                            </button>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className={kpiDataTd("center")}>
                      {daysKpi ? (
                        <span
                          className={daysKpi.className}
                          title={
                            nextCatalyst
                              ? formatNextCatalystChip(nextCatalyst, it)
                              : daysToCatalyst != null && daysToCatalyst < 0
                                ? it
                                  ? `Catalyst passato da ${Math.abs(daysToCatalyst)} giorni`
                                  : `Catalyst passed ${Math.abs(daysToCatalyst)} days ago`
                                : undefined
                          }
                        >
                          {daysKpi.label}
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className={kpiDataTd("center")}>
                      <PriceChange24hCell pct={change24hPct} uniform />
                    </td>
                    <td className={kpiDataTd("center")}>
                      {(() => {
                        const qty = formatDeskVolumeQtyOnly(volumeVsPrev?.pct_of_prev);
                        const tip = deskVolumeQtyTooltip(
                          volumeVsPrev,
                          it,
                          isDuringUsEquityRegularHours(),
                        );
                        const toneClass =
                          qty.tone === "up"
                            ? "font-medium text-emerald-700 dark:text-emerald-300"
                            : qty.tone === "down"
                              ? "font-medium text-rose-700 dark:text-rose-300"
                              : qty.tone === "flat"
                                ? "font-medium text-ink-muted"
                                : "text-ink-muted";
                        return (
                          <span className={`tabular-nums ${toneClass}`} title={tip}>
                            {qty.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className={kpiDataTd("center")}>
                      <SearchInterestDualMark
                        row={searchInterestRow}
                        loading={Boolean(trendsLoading && !isSearchInterestScored(searchInterestRow))}
                        ticker={tk}
                        it={it}
                        align="center"
                      />
                    </td>
                    <td className={kpiDataTd("center")}>
                      <div
                        className="flex flex-col items-center gap-0.5 leading-tight"
                        title={dcRow?.diagnostic ?? undefined}
                      >
                        <span className={`uppercase ${decisionRecTextClass(decisionRec)}`}>
                          {decisionRecLabel(decisionRec, it)}
                        </span>
                        {dcRow?.scores.pplan != null ? (
                          <span className="text-ink-muted">
                            P {Math.round(dcRow.scores.pplan)}%
                          </span>
                        ) : dcRow?.insufficientScores ? (
                          <span className="text-ink-muted">—</span>
                        ) : null}
                        {softBuyG1.hit ? (
                          <span
                            className="text-[8px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400"
                            title={
                              it
                                ? "Soft BUY G1/G1w: SDS/P · vento (10d+Pcont) o Top2≠NO·↑≥2d (stesso Suggested BUY Home)"
                                : "Soft BUY G1/G1w: SDS/P · wind (10d+Pcont) or Top2≠NO·↑≥2d (same Home Suggested BUY)"
                            }
                          >
                            Soft BUY G1
                          </span>
                        ) : null}
                        {softSellG1.hit ? (
                          <span
                            className="text-[8px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-400"
                            title={
                              softSellG1.reason
                                ? `${it ? "Soft SELL G1 (solo segnale)" : "Soft SELL G1 (signal only)"}: ${softSellG1.reason}`
                                : it
                                  ? "Soft SELL G1 (solo segnale) — non cambia la REC"
                                  : "Soft SELL G1 (signal only) — does not change REC"
                            }
                          >
                            Soft SELL G1
                          </span>
                        ) : null}
                        {urgentG2 ? (
                          <span
                            className="text-[8px] font-bold uppercase tracking-wide text-rose-800 dark:text-rose-300 bg-rose-100/80 dark:bg-rose-950/50 px-1 rounded"
                            title={
                              urgentG2Hit?.reason ??
                              (it
                                ? "Urgent SELL G2 — perdite day book > 20% di (acquistato + guadagnato)"
                                : "Urgent SELL G2 — book day losses > 20% of (purchased + gains)")
                            }
                          >
                            {it ? "Urgent SELL G2" : "Urgent SELL G2"}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    {profile === "catalysts" && (
                      <td className={`${kpiDataTd("left")} overflow-hidden`}>
                        {(() => {
                          const quote = (bestEv?.timing_quote ?? "").trim();
                          if (!quote) return <span className="text-ink-muted">—</span>;
                          return (
                            <span
                              className="text-[9px] text-ink-muted italic leading-snug line-clamp-2 inline-block max-w-full"
                              title={quote}
                            >
                              &ldquo;{quote}&rdquo;
                            </span>
                          );
                        })()}
                      </td>
                    )}
                  </tr>
                );
}, (prev, next) => {
  if (prev.item.key !== next.item.key) return false;
  if (prev.item.ticker !== next.item.ticker) return false;
  if (prev.item.company !== next.item.company) return false;
  if (prev.item.hasPosition !== next.item.hasPosition) return false;
  if (prev.item.daysToCd !== next.item.daysToCd) return false;
  // Live PnL floats can jitter without meaningful UI change.
  if (
    prev.item.pnlPct24h !== next.item.pnlPct24h &&
    !(
      prev.item.pnlPct24h != null &&
      next.item.pnlPct24h != null &&
      Math.abs(prev.item.pnlPct24h - next.item.pnlPct24h) < 1e-6
    )
  )
    return false;
  if (
    prev.item.pnlPct !== next.item.pnlPct &&
    !(
      prev.item.pnlPct != null &&
      next.item.pnlPct != null &&
      Math.abs(prev.item.pnlPct - next.item.pnlPct) < 1e-6
    )
  )
    return false;
  if (prev.item.livePriceDead !== next.item.livePriceDead) return false;
  if (prev.item.completionDate !== next.item.completionDate) return false;
  if (prev.item.seriesKey !== next.item.seriesKey) return false;
  if (prev.item.recoveryProbabilityPct !== next.item.recoveryProbabilityPct) return false;
  if (prev.item.precatKind !== next.item.precatKind) return false;
  if (prev.item.investedAt !== next.item.investedAt) return false;
  if (prev.it !== next.it) return false;
  if (prev.profile !== next.profile) return false;
  if (!tickerRowShallowEqual(prev.simRow, next.simRow)) return false;
  if (prev.live !== next.live) return false;
  if (prev.guidanceKpi !== next.guidanceKpi) return false;
  if (prev.isRowHighlighted !== next.isRowHighlighted) return false;
  if (prev.decisionRec !== next.decisionRec) return false;
  if (prev.sdsScore !== next.sdsScore) return false;
  // Shared book total — ignore sub-euro churn that would re-render every row.
  if (Math.abs(prev.capitalDenominatorEur - next.capitalDenominatorEur) >= 1) return false;
  if (prev.priorSessionPct !== next.priorSessionPct) return false;
  if (prev.sdsRow !== next.sdsRow) return false;
  if (prev.chartPts !== next.chartPts) return false;
  const prevDc = prev.dcRow;
  const nextDc = next.dcRow;
  if (prevDc !== nextDc) {
    if (!prevDc || !nextDc) return false;
    if (prevDc.rec !== nextDc.rec) return false;
    if (prevDc.diagnostic !== nextDc.diagnostic) return false;
    if (prevDc.insufficientScores !== nextDc.insufficientScores) return false;
    if (prevDc.scores.pplan !== nextDc.scores.pplan) return false;
    if (prevDc.scores.riskV2 !== nextDc.scores.riskV2) return false;
    if (prevDc.scores.regRisk !== nextDc.scores.regRisk) return false;
  }
  const prevIntra = prev.intraday;
  const nextIntra = next.intraday;
  if (prevIntra !== nextIntra) {
    if (prevIntra?.prior !== nextIntra?.prior) return false;
    if (prevIntra?.live !== nextIntra?.live) return false;
  }
  if (prev.trendsLoading !== next.trendsLoading) return false;
  if (prev.fdaDesignation !== next.fdaDesignation) {
    const a = prev.fdaDesignation?.designations?.join("|") ?? "";
    const b = next.fdaDesignation?.designations?.join("|") ?? "";
    if (a !== b) return false;
  }
  if (prev.newsProductDesig !== next.newsProductDesig) {
    const a = `${prev.newsProductDesig?.product ?? ""}|${(prev.newsProductDesig?.designations ?? []).join("|")}`;
    const b = `${next.newsProductDesig?.product ?? ""}|${(next.newsProductDesig?.designations ?? []).join("|")}`;
    if (a !== b) return false;
  }
  if (prev.newsScores !== next.newsScores) {
    const a = prev.newsScores;
    const b = next.newsScores;
    if (!a || !b) return false;
    if (
      a.eis !== b.eis ||
      a.clinical !== b.clinical ||
      a.financial !== b.financial ||
      a.corporate !== b.corporate ||
      a.marketAccess !== b.marketAccess
    ) {
      return false;
    }
  }
  // Ignore t / urgentSellG2 whole object / inputs / history / clinicalRecords /
  // onScrollTo — those change identity on every parent render without per-row meaning.
  const prevUrgent = isUrgentSellGrade2Key(prev.urgentSellG2, prev.item.key);
  const nextUrgent = isUrgentSellGrade2Key(next.urgentSellG2, next.item.key);
  if (prevUrgent !== nextUrgent) return false;
  return true;
});

function LossAnalysisSummaryTable({
  items,
  collapsed,
  onToggleCollapsed,
  sortByHighVol,
  onToggleHighVolSort,
  sortByActionSolidity,
  onToggleActionSoliditySort,
  onScrollTo,
  rowByKey,
  inputs,
  highlightedKey,
  decisionChartByKey,
  clinicalRecords,
  history,
  sdsRowByTicker,
  pointsBySeriesKey,
  priorSessionPctByTicker = null,
  intradayByTicker = null,
  alwaysExpanded = false,
  tableBodyScroll = false,
  fillPage = false,
  hideSortChips = false,
  profile = "portfolio" as LossAnalysisProfile,
  guidanceKpiByTicker,
  scrollToKeyRef = null,
}: {
  items: PortfolioLossAnalysisItem[];
  decisionChartByKey: Map<string, DecisionChartTickerRow>;
  profile?: LossAnalysisProfile;
  guidanceKpiByTicker?: GuidanceKpiByTicker;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sortByHighVol: boolean;
  onToggleHighVolSort: () => void;
  sortByActionSolidity: boolean;
  onToggleActionSoliditySort: () => void;
  onScrollTo: (key: string) => void;
  rowByKey: Map<string, Record<string, unknown>>;
  inputs: InvestSimInputs;
  /** Item key currently highlighted (jump from Catalyst / dashboard). Accent outline — no yellow wash. */
  highlightedKey?: string | null;
  clinicalRecords?: import("../api/supernova").ClinicalPreCdRecord[];
  history?: InvestSimHistoryPoint[];
  sdsRowByTicker: Map<string, SdsRow>;
  /** Yahoo prior-session % for Soft BUY ↑≥2d badge. */
  priorSessionPctByTicker?: Map<string, number> | null;
  /** Yahoo hourly prior + live curves for 24h session low. */
  intradayByTicker?: Map<
    string,
    { prior?: IntradayPricePoint[]; live?: IntradayPricePoint[] }
  > | null;
  /** Chart prices — Soft BUY badge requires rising ≥2 sessions. */
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
  /** When true, the collapse toggle is hidden and the table body is always
   *  rendered — used from the dedicated "Top KPI" sub-tab where the tab pill
   *  itself acts as the table's label, so a redundant collapse arrow would
   *  just hide the tab's only content. */
  alwaysExpanded?: boolean;
  /** Legacy inner table scroll — do not enable on Evaluation Lab. */
  tableBodyScroll?: boolean;
  /** Evaluation Lab 24h: table is page flow (no nested scrollport). */
  fillPage?: boolean;
  /** Sort chips rendered by parent (above the card) — hide duplicates in table header. */
  hideSortChips?: boolean;
  /** Parent registers scroll-to-row (virtual index) for deep-links. */
  scrollToKeyRef?: MutableRefObject<((key: string) => void) | null> | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const kpiTableScrollRef = useRef<HTMLDivElement | null>(null);
  const kpiLiveRef = useRef<KpiLiveStores | null>(null);
  if (!kpiLiveRef.current) kpiLiveRef.current = createKpiLiveStores();
  const kpiLive = kpiLiveRef.current;
  const [itemsWithRealTime, setItemsWithRealTime] = useState<PortfolioLossAnalysisItem[]>(items);
  const [clinicalStudiesModal, setClinicalStudiesModal] = useState<{
    ticker: string;
    company: string | null;
    primaryNctId: string | null;
    studies: DeskClinicalStudyListItem[];
  } | null>(null);

  /** Dormant while SHEET_WS_REALTIME_ENABLED is false (FASE 1 Step 4). Do not wire registerRow here. */
  const handleRealTimeUpdate = useCallback((updates: Map<number, Record<string, unknown>>) => {
    setItemsWithRealTime((prev) => {
      let changed = false;
      const next = prev.slice();
      for (const [index, update] of updates) {
        if (index >= next.length) continue;
        const cur = next[index]!;
        let rowChanged = false;
        const merged = { ...cur } as PortfolioLossAnalysisItem & Record<string, unknown>;
        for (const [k, v] of Object.entries(update)) {
          if ((cur as Record<string, unknown>)[k] !== v) {
            merged[k] = v;
            rowChanged = true;
          }
        }
        if (rowChanged) {
          next[index] = merged;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const realTimeColumns = useMemo(() => [
    "currentPrice",
    "pnlPct24h",
  ], []);

  // Sync itemsWithRealTime when items prop changes
  useEffect(() => {
    setItemsWithRealTime(items);
  }, [items]);

  const displayItems = itemsWithRealTime;

  const realTimeTableData = useMemo(
    () =>
      displayItems.map((item) => ({
        symbol: item.ticker,
        ticker: item.ticker,
        pnlPct24h: item.pnlPct24h,
      })),
    [displayItems],
  );

  const urgentSellG2 = useMemo(() => {
    const open = items.filter((i) => i.hasPosition);
    const prior = priorSessionDayPnlByKey(
      history,
      open.map((i) => i.key),
    );
    const legs = open.map((i) =>
      attachContCutPriority(
        {
          key: i.key,
          ticker: i.ticker,
          dayPnlEur: Math.round(((i.pnlEur24h ?? 0) + (prior.get(i.key) ?? 0)) * 100) / 100,
          dayPnlPct: i.pnlPct24h ?? null,
          totalPnlPct: i.pnlPct ?? null,
          capitalEur: i.capital,
          pnlEur: i.pnlEur,
        },
        rowByKey.get(i.key) ?? null,
      ),
    );
    return evaluateUrgentSellGrade2Book(legs);
  }, [items, history, rowByKey]);

  const decisionRecByKey = useMemo(() => {
    const m = new Map<string, DecisionRec>();
    for (const item of items) {
      m.set(item.key, decisionChartByKey.get(item.key)?.rec ?? "review");
    }
    return m;
  }, [items, decisionChartByKey]);

  const capitalDenominatorEur = useMemo(
    () => lossAnalysisCapitalDenominatorEur(items, decisionRecByKey),
    [items, decisionRecByKey],
  );

  const bodyVisible = alwaysExpanded || !collapsed;

  const kpiTickers = useMemo(
    () => items.map((i) => i.ticker.trim().toUpperCase()).filter(Boolean),
    [items],
  );
  const volumeVsPrevByTicker = useVolumeVsPrevSession(kpiTickers, bodyVisible);
  const searchInterest = useSearchInterestByTicker(kpiTickers, bodyVisible);
  const [trendLegendOpen, setTrendLegendOpen] = useState(false);
  const [kpiSort, setKpiSort] = useState<{ key: KpiSortCol | null; dir: KpiSortDir }>({
    key: null,
    dir: "desc",
  });
  const [kpiTickerQuery, setKpiTickerQuery] = useState("");
  const toggleKpiSort = useCallback((col: KpiSortCol) => {
    setKpiSort((prev) => {
      if (prev.key === col) {
        return { key: col, dir: prev.dir === "asc" ? "desc" : "asc" };
      }
      return { key: col, dir: defaultKpiSortDir(col) };
    });
  }, []);
  const surgeTickers = useMemo(
    () =>
      Object.entries(volumeVsPrevByTicker)
        .filter(([, row]) => isVolumeSurge(row.pct_of_prev))
        .map(([tk]) => tk),
    [volumeVsPrevByTicker],
  );
  const volumeAccelByTicker = useVolumeAcceleration(surgeTickers, bodyVisible);
  const characterTickers = useMemo(() => {
    const set = new Set(surgeTickers);
    for (const [tk, row] of Object.entries(volumeAccelByTicker)) {
      if (row?.flagged) set.add(tk);
    }
    return [...set];
  }, [surgeTickers, volumeAccelByTicker]);
  const volumeCharacterByTicker = useVolumeCharacterByTicker(
    characterTickers,
    bodyVisible,
    clinicalRecords,
    it ? "it" : "en",
  );

  useEffect(() => {
    kpiLive.vol.setMany(volumeVsPrevByTicker);
  }, [kpiLive, volumeVsPrevByTicker]);
  useEffect(() => {
    kpiLive.trend.setMany(searchInterest.rows);
  }, [kpiLive, searchInterest.rows]);
  useEffect(() => {
    kpiLive.accel.setMany(volumeAccelByTicker);
  }, [kpiLive, volumeAccelByTicker]);
  useEffect(() => {
    kpiLive.character.setMany(volumeCharacterByTicker);
  }, [kpiLive, volumeCharacterByTicker]);

  /** Discovery + FDA-site designations by product name for Top KPI Designation column. */
  const [fdaDesigByTicker, setFdaDesigByTicker] = useState<Record<string, FdaDesignationRow>>(
    {},
  );
  /** Product + designations mined from Daily News / Manual analyses. */
  const [newsDesigByTicker, setNewsDesigByTicker] = useState<
    Record<string, NewsProductDesignationHint>
  >({});
  /** Daily News taxonomy scores (EIS + Clin/Fin/Corp/Access) by ticker. */
  const [newsOnlyScoresByTicker, setNewsOnlyScoresByTicker] = useState<
    Record<string, NewsDimensionScores>
  >({});
  const newsScoresByTicker = useMemo(
    () =>
      mergeDimensionScoreMaps(
        clinicalDimensionScoresByTicker(clinicalRecords, it ? "it" : "en", {
          lookbackDays: DIMENSION_SCORE_LOOKBACK_DAYS,
        }),
        newsOnlyScoresByTicker,
      ),
    [clinicalRecords, newsOnlyScoresByTicker, it],
  );
  const fdaQueryKey = useMemo(() => {
    const parts: string[] = [];
    for (const item of displayItems) {
      const tk = item.ticker.trim().toUpperCase();
      if (!tk) continue;
      const sim = rowByKey.get(item.key) ?? null;
      const product =
        clinicalAssetProductName(clinicalRecords, {
          ticker: tk,
          nctId: clinicalNctFromSimRow(sim ?? undefined),
        }) ||
        clinicalDrugFromSimRow(sim ?? undefined) ||
        "";
      parts.push(`${tk}|${product}`);
    }
    return parts.sort().join(";");
  }, [displayItems, rowByKey, clinicalRecords]);

  useEffect(() => {
    if (!bodyVisible || !fdaQueryKey) {
      return;
    }
    let cancelled = false;
    const items = fdaQueryKey.split(";").filter(Boolean).map((part) => {
      const [ticker, ...rest] = part.split("|");
      return { ticker: ticker || "", product: rest.join("|") || undefined };
    });
    void fetchFdaDesignationsBatch(items).then((payload) => {
      if (cancelled) return;
      setFdaDesigByTicker(payload.by_ticker ?? {});
    });
    return () => {
      cancelled = true;
    };
  }, [bodyVisible, fdaQueryKey]);

  useEffect(() => {
    if (!bodyVisible) return;
    let cancelled = false;
    void fetchDailyNews()
      .then((payload) => {
        if (cancelled) return;
        setNewsDesigByTicker(newsProductDesignationByTicker(payload));
        setNewsOnlyScoresByTicker(
          newsDimensionScoresByTicker(payload, {
            lookbackDays: DIMENSION_SCORE_LOOKBACK_DAYS,
          }),
        );
      })
      .catch(() => {
        if (cancelled) return;
        setNewsDesigByTicker({});
        setNewsOnlyScoresByTicker({});
      });
    return () => {
      cancelled = true;
    };
  }, [bodyVisible, fdaQueryKey]);

  const tableItems = useMemo(() => {
    const base = sortByHighVol
      ? sortLossItemsByVolPct(displayItems, volumeVsPrevByTicker)
      : displayItems;
    const key = kpiSort.key;
    if (!key || base.length < 2) return base;

    const valueFor = (item: PortfolioLossAnalysisItem): number | string | null => {
      const tk = item.ticker.trim().toUpperCase();
      const sim = rowByKey.get(item.key) ?? null;
      const gkpi = guidanceKpiByTicker?.get(tk);
      const bestEv = gkpi?.bestEvent;
      switch (key) {
        case "ticker":
          return tk;
        case "momentum": {
          const vol = volumeVsPrevByTicker[tk];
          const filled = fillDeskSessionPriceFromSim(vol, {
            lastPrice: sim ? currentPriceFromRow(sim) : null,
            dailyChangePct:
              (sim ? dailyChangePctFromRow(sim) : null) ??
              priorSessionPctByTicker?.get(tk) ??
              null,
          });
          const divergeSort = formatPriceVolDivergence(filled, it);
          const next = resolveNextCatalystEvent({
            ticker: item.ticker,
            completionDate: item.completionDate,
            daysToCd: item.daysToCd,
            guidanceEvent: bestEv,
          });
          const ed = (next?.eventDate || item.completionDate || "").toString().slice(0, 10);
          const ev = ed
            ? kpiLive.eventVol.get(eventVolPairKey(tk, ed))
            : undefined;
          const cell = formatBiasCell(
            {
              rr10: ev?.rr10 ?? null,
              priceVolKind: priceVolKindFromLabel(divergeSort.label),
              insiderNetBuy30d: kpiLive.accum.get(tk)?.insider_net_buy_30d ?? null,
              relativeMove: kpiLive.vsXbi.get(tk)?.relative_move ?? null,
            },
            it,
          );
          return cell.score;
        }
        case "product":
          return (
            clinicalAssetProductName(clinicalRecords, {
              ticker: item.ticker,
              nctId: clinicalNctFromSimRow(sim ?? undefined),
            }) ||
            (bestEv?.asset_name && String(bestEv.asset_name).trim()) ||
            clinicalDrugFromSimRow(sim ?? undefined) ||
            newsDesigByTicker[tk]?.product ||
            fdaDesigByTicker[tk]?.product ||
            ""
          );
        case "productDesig": {
          const news = newsDesigByTicker[tk];
          const fda = fdaDesigByTicker[tk];
          const product =
            news?.product ||
            fda?.product ||
            clinicalAssetProductName(clinicalRecords, {
              ticker: item.ticker,
              nctId: clinicalNctFromSimRow(sim ?? undefined),
            }) ||
            (bestEv?.asset_name && String(bestEv.asset_name).trim()) ||
            clinicalDrugFromSimRow(sim ?? undefined) ||
            "";
          const des = new Set<string>();
          const addDesig = (raw: string | null | undefined) => {
            const n = normalizeFdaDesignationLabel(raw);
            if (n) des.add(n);
            else {
              for (const x of designationsFromText(raw)) des.add(x);
            }
          };
          for (const d of fda?.designations ?? []) addDesig(d);
          for (const d of news?.designations ?? []) addDesig(d);
          for (const d of bestEv?.regulatory_designations ?? []) addDesig(d);
          return formatProductDesignationCell(product, [...des]) || null;
        }
        case "newsScores":
          return newsDimSortKey(newsScoresByTicker[tk]);
        case "designation": {
          const parts = new Set<string>();
          const addDesig = (raw: string | null | undefined) => {
            const n = normalizeFdaDesignationLabel(raw);
            if (n) parts.add(n);
            else {
              for (const x of designationsFromText(raw)) parts.add(x);
            }
          };
          for (const d of fdaDesigByTicker[tk]?.designations ?? []) addDesig(d);
          for (const d of newsDesigByTicker[tk]?.designations ?? []) addDesig(d);
          for (const d of bestEv?.regulatory_designations ?? []) addDesig(d);
          return [...parts].sort().join(", ") || null;
        }
        case "catalyst": {
          const next = resolveNextCatalystEvent({
            ticker: item.ticker,
            completionDate: item.completionDate,
            daysToCd: item.daysToCd,
            guidanceEvent: bestEv,
          });
          return next?.eventType ?? bestEv?.event_type ?? null;
        }
        case "phase":
          return (
            resolveSummaryStudyPhase(sim, clinicalRecords, item.ticker, it, {
              completionDate: item.completionDate,
              drugHint:
                clinicalDrugFromSimRow(sim ?? undefined) ||
                (bestEv?.asset_name && String(bestEv.asset_name).trim()) ||
                null,
            }) || null
          );
        case "days": {
          const next = resolveNextCatalystEvent({
            ticker: item.ticker,
            completionDate: item.completionDate,
            daysToCd: item.daysToCd,
            guidanceEvent: bestEv,
          });
          const d =
            next?.daysUntil ??
            (item.daysToCd != null && Number.isFinite(item.daysToCd)
              ? Math.round(item.daysToCd)
              : null);
          return d;
        }
        case "var24h":
          return item.pnlPct24h ?? null;
        case "volume": {
          const pct = volumeVsPrevByTicker[tk]?.pct_of_prev;
          return pct != null && Number.isFinite(pct) ? pct : null;
        }
        case "trends": {
          const trend = searchInterest.rows[tk];
          const score = trend?.interest_score;
          if (score != null && Number.isFinite(score)) return score;
          return null;
        }
        case "rec": {
          const rec = decisionChartByKey.get(item.key)?.rec ?? "review";
          if (rec === "buy") return 4;
          if (rec === "review") return 3;
          if (rec === "hold") return 2;
          if (rec === "sell") return 1;
          return 0;
        }
        default:
          return null;
      }
    };

    const decorated = base.map((item, idx) => ({
      item,
      idx,
      v: valueFor(item),
    }));
    decorated.sort((a, b) => {
      const c = compareKpiSortValues(a.v, b.v, kpiSort.dir);
      return c !== 0 ? c : a.idx - b.idx;
    });
    return decorated.map((d) => d.item);
  }, [
    displayItems,
    sortByHighVol,
    volumeVsPrevByTicker,
    kpiSort,
    rowByKey,
    clinicalRecords,
    guidanceKpiByTicker,
    searchInterest.rows,
    decisionChartByKey,
    kpiLive,
    it,
    priorSessionPctByTicker,
    fdaDesigByTicker,
    newsDesigByTicker,
    newsScoresByTicker,
  ]);

  // Momentum column inputs (same Catalyst Days Bias stack): desk cache + gap fill.
  const kpiTickerKey = useMemo(
    () => [...new Set(kpiTickers)].sort().join(","),
    [kpiTickers],
  );

  useEffect(() => {
    if (!bodyVisible || !kpiTickerKey) return;
    let cancelled = false;
    const list = kpiTickerKey.split(",");

    const seedLocal = () => {
      const local = peekCatalystDeskColumnCache();
      if (local?.morning?.accumulation) {
        kpiLive.accum.setMany(local.morning.accumulation);
      }
      if (local?.hourly?.event_vol) {
        kpiLive.eventVol.setMany(local.hourly.event_vol);
      }
      if (local?.hourly?.vs_xbi) {
        kpiLive.vsXbi.setMany(local.hourly.vs_xbi);
      }
    };
    seedLocal();

    void (async () => {
      try {
        const desk = await fetchCatalystDeskCache();
        if (cancelled) return;
        if (desk.morning?.accumulation) {
          kpiLive.accum.setMany(desk.morning.accumulation);
        }
        if (desk.hourly?.event_vol) {
          kpiLive.eventVol.setMany(desk.hourly.event_vol);
        }
        if (desk.hourly?.vs_xbi) {
          kpiLive.vsXbi.setMany(desk.hourly.vs_xbi);
        }
        rememberCatalystDeskColumnCache(desk);

        const missingAccum = list.filter((tk) => !kpiLive.accum.get(tk));
        const missingVs = list.filter((tk) => !kpiLive.vsXbi.get(tk));
        const pairs: Array<{ ticker: string; eventDate: string }> = [];
        for (const item of items) {
          const tk = item.ticker.trim().toUpperCase();
          if (!tk) continue;
          const gkpi = guidanceKpiByTicker?.get(tk);
          const next = resolveNextCatalystEvent({
            ticker: item.ticker,
            completionDate: item.completionDate,
            daysToCd: item.daysToCd,
            guidanceEvent: gkpi?.bestEvent,
          });
          const ed = (next?.eventDate || item.completionDate || "").toString().slice(0, 10);
          if (!ed || !/^20\d{2}-\d{2}-\d{2}/.test(ed)) continue;
          const key = eventVolPairKey(tk, ed);
          if (!kpiLive.eventVol.get(key)) pairs.push({ ticker: tk, eventDate: ed });
        }

        const tasks: Promise<void>[] = [];
        if (missingAccum.length) {
          tasks.push(
            fetchCatalystAccumulation(missingAccum).then((p) => {
              if (!cancelled && p.rows) kpiLive.accum.setMany(p.rows);
            }),
          );
        }
        if (missingVs.length) {
          tasks.push(
            fetchCatalystVsXbi(missingVs).then((p) => {
              if (!cancelled && p.rows) kpiLive.vsXbi.setMany(p.rows);
            }),
          );
        }
        if (pairs.length) {
          tasks.push(
            fetchEventVolIndex(pairs.slice(0, 24)).then((p) => {
              if (!cancelled && p.rows) kpiLive.eventVol.setMany(p.rows);
            }),
          );
        }
        await Promise.all(tasks);
      } catch {
        /* keep seeded cache */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bodyVisible, kpiTickerKey, kpiLive, items, guidanceKpiByTicker]);

  const filteredTableItems = useMemo(() => {
    const q = kpiTickerQuery.trim().toUpperCase();
    if (!q) return tableItems;
    return tableItems.filter((item) => {
      const tk = item.ticker.trim().toUpperCase();
      if (tk.includes(q)) return true;
      const company = String(item.company ?? "").trim().toUpperCase();
      return Boolean(company && company.includes(q));
    });
  }, [tableItems, kpiTickerQuery]);

  const [kpiScrollEl, setKpiScrollEl] = useState<HTMLElement | null>(null);
  const [kpiScrollMargin, setKpiScrollMargin] = useState(0);
  useLayoutEffect(() => {
    if (!bodyVisible) {
      setKpiScrollEl(null);
      return;
    }
    const wrap = kpiTableScrollRef.current;
    if (!wrap) return;
    if (fillPage) {
      setKpiScrollEl(
        (wrap.closest(".desk-page-scroll") as HTMLElement | null) ??
          findScrollableParent(wrap) ??
          document.documentElement,
      );
    } else if (tableBodyScroll) {
      setKpiScrollEl(wrap);
    } else {
      setKpiScrollEl(findScrollableParent(wrap) ?? wrap);
    }
  }, [bodyVisible, fillPage, tableBodyScroll, filteredTableItems.length]);

  useLayoutEffect(() => {
    const wrap = kpiTableScrollRef.current;
    const scroll = kpiScrollEl;
    if (!wrap || !scroll || scroll === wrap) {
      setKpiScrollMargin(0);
      return;
    }
    const measure = () => {
      setKpiScrollMargin(
        Math.max(0, Math.round(offsetInScrollContent(wrap, scroll))),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    if (wrap.parentElement) ro.observe(wrap.parentElement);
    ro.observe(scroll);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [kpiScrollEl, filteredTableItems.length, bodyVisible]);

  const virtualizeKpi = filteredTableItems.length > 20;
  const kpiVirtual = useVirtualTableBody({
    count: filteredTableItems.length,
    scrollElement: kpiScrollEl,
    estimateSize: 48,
    overscan: 10,
    scrollMargin: kpiScrollMargin,
    enabled: virtualizeKpi && Boolean(kpiScrollEl),
  });
  const kpiRowsToRender = useMemo(() => {
    if (!virtualizeKpi || !kpiScrollEl || kpiVirtual.virtualRows.length === 0) {
      return filteredTableItems.map((item, index) => ({ item, index }));
    }
    return kpiVirtual.virtualRows.map((vr) => ({
      item: filteredTableItems[vr.index]!,
      index: vr.index,
    }));
  }, [virtualizeKpi, kpiScrollEl, kpiVirtual.virtualRows, filteredTableItems]);

  useEffect(() => {
    if (!scrollToKeyRef) return;
    scrollToKeyRef.current = (key: string) => {
      setKpiTickerQuery("");
      const idx = tableItems.findIndex((i) => i.key === key);
      if (idx < 0) return;
      if (virtualizeKpi && kpiScrollEl) {
        kpiVirtual.virtualizer.scrollToIndex(idx, { align: "start", behavior: "smooth" });
      } else {
        const el = document.getElementById(lossAnalysisTopKpiRowDomId(key));
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    };
    return () => {
      if (scrollToKeyRef) scrollToKeyRef.current = null;
    };
  }, [
    scrollToKeyRef,
    tableItems,
    virtualizeKpi,
    kpiScrollEl,
    kpiVirtual.virtualizer,
  ]);

  const kpiColSpan =
    profile === "catalysts" ? KPI_SUMMARY_COL_COUNT_CATALYSTS : KPI_SUMMARY_COL_COUNT;

  // #region agent log
  useLayoutEffect(() => {
    if (!bodyVisible || !tableBodyScroll) return;
    const el = kpiTableScrollRef.current;
    if (!el) return;
    dbgKpiLog("H1", "LossAnalysisSummaryTable:scrollport", "table scroll metrics", {
      itemCount: items.length,
      clientH: el.clientHeight,
      scrollH: el.scrollHeight,
      canScroll: el.scrollHeight > el.clientHeight + 1,
      overflowY: getComputedStyle(el).overflowY,
    });
  }, [bodyVisible, tableBodyScroll, items.length, sortByHighVol, sortByActionSolidity]);
  // #endregion

  if (!items.length) return null;

  const tickerSearchBar = (
    <div className="flex items-center gap-2 min-w-0 shrink-0">
      <div className="relative">
        <input
          type="search"
          value={kpiTickerQuery}
          onChange={(e) => setKpiTickerQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const q = kpiTickerQuery.trim().toUpperCase();
            if (!q) return;
            const hit =
              filteredTableItems.find((i) => i.ticker.trim().toUpperCase() === q) ??
              filteredTableItems.find((i) => i.ticker.trim().toUpperCase().startsWith(q)) ??
              filteredTableItems[0];
            if (!hit) return;
            const el = document.getElementById(lossAnalysisTopKpiRowDomId(hit.key));
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          placeholder={it ? "Cerca ticker…" : "Search ticker…"}
          aria-label={it ? "Cerca ticker in Top KPI" : "Search ticker in Top KPI"}
          className={`rounded-md border border-[rgb(var(--border))]/55 bg-[rgb(var(--surface))] px-2 py-1 text-[11px] text-ink placeholder:text-ink-muted/70 focus:outline-none focus:ring-1 focus:ring-[rgb(var(--accent))]/40 w-[8.5rem] ${
            kpiTickerQuery.trim() ? "pr-6" : ""
          }`}
        />
        {kpiTickerQuery.trim() ? (
          <button
            type="button"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-4 w-4 rounded text-[12px] leading-none text-ink-muted hover:text-ink hover:bg-ink/10"
            title={it ? "Cancella ricerca" : "Clear search"}
            aria-label={it ? "Cancella ricerca ticker" : "Clear ticker search"}
            onClick={() => setKpiTickerQuery("")}
          >
            ×
          </button>
        ) : null}
      </div>
      <span className="text-[10px] tabular-nums text-ink-muted whitespace-nowrap">
        {kpiTickerQuery.trim()
          ? `${filteredTableItems.length}/${tableItems.length}`
          : `${tableItems.length}`}
      </span>
    </div>
  );

  return (
    <div
      className={
        fillPage
          ? "min-w-0 w-full overflow-visible"
          : "rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 shadow-sm min-w-0"
      }
    >
      <div
        className={
          fillPage
            ? "px-0.5 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5"
            : "sticky top-0 z-20 px-4 py-2 border-b border-[rgb(var(--border))]/30 bg-[rgb(var(--surface))] flex flex-wrap items-center gap-x-3 gap-y-1.5"
        }
      >
        {tickerSearchBar}
        {!fillPage || !hideSortChips || !alwaysExpanded ? (
          <>
        {alwaysExpanded ? (
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
              {t("sim.lossAnalysis.summaryTable.title")}
            </span>
          </span>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 min-w-0 text-left group"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            title={
              collapsed
                ? t("sim.lossAnalysis.summaryTable.expand")
                : t("sim.lossAnalysis.summaryTable.collapse")
            }
          >
            <span
              className={`text-ink-muted transition-transform text-[10px] shrink-0 ${
                collapsed ? "" : "rotate-90"
              }`}
              aria-hidden
            >
              ▶
            </span>
            <span className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted group-hover:text-ink">
                {t("sim.lossAnalysis.summaryTable.title")}
              </span>
            </span>
          </button>
        )}
        <p
          className="ui-caption-clamp min-w-0 max-w-[280px] shrink"
          title={
            sortByActionSolidity
              ? t("sim.lossAnalysis.summaryTable.hintActionSort")
              : sortByHighVol
                ? t("sim.lossAnalysis.summaryTable.hintHighVolSort")
                : t("sim.lossAnalysis.summaryTable.hint")
          }
        >
          {sortByActionSolidity
            ? t("sim.lossAnalysis.summaryTable.hintActionSort")
            : sortByHighVol
              ? t("sim.lossAnalysis.summaryTable.hintHighVolSort")
              : t("sim.lossAnalysis.summaryTable.hint")}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0 ml-auto">
          {!hideSortChips ? (
            <>
          <SelectionChip
            active={sortByActionSolidity}
            onClick={onToggleActionSoliditySort}
            title={t("sim.lossAnalysis.summaryTable.sortActionSolidityTip")}
          >
            {t("sim.lossAnalysis.summaryTable.sortActionSolidity")}
          </SelectionChip>
          <SelectionChip
            active={sortByHighVol}
            onClick={onToggleHighVolSort}
            title={t("sim.lossAnalysis.summaryTable.sortHighVolTip")}
          >
            {t("sim.lossAnalysis.summaryTable.sortHighVol")}
          </SelectionChip>
            </>
          ) : null}
        </div>
          </>
        ) : (
          <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">
            {t("sim.lossAnalysis.summaryTable.title")}
          </span>
        )}
      </div>
      {fillPage || alwaysExpanded ? (
        <p className="px-0.5 pb-1 text-[9px] font-medium text-ink-muted">
          {it
            ? "Riga verde chiaro = colonna Momentum positiva (Build rialzista)"
            : "Light green row = positive Momentum column (Bullish build)"}
        </p>
      ) : null}
      {urgentSellG2.hits.length > 0 ? (
        <div className="mb-1.5 rounded-md border border-rose-400/50 bg-rose-50/90 dark:bg-rose-950/40 px-2.5 py-1.5 text-[10px] text-rose-900 dark:text-rose-100">
          <span className="font-bold uppercase tracking-wide">
            {it ? "Urgent SELL G2" : "Urgent SELL G2"}
          </span>
          <span className="mx-1.5 text-rose-700/80 dark:text-rose-300/80">·</span>
          <span>
            {it
              ? `Budget book 20% di (acquistato + guadagnato) €${Math.round(urgentSellG2.budgetEur)} sforato — taglio perdite day più drastiche:`
              : `Book budget 20% of (purchased + gains) €${Math.round(urgentSellG2.budgetEur)} breached — cut fastest day losers:`}{" "}
            <span className="font-semibold tabular-nums">
              {urgentSellG2.hits.map((h) => h.ticker).join(", ")}
            </span>
          </span>
        </div>
      ) : null}
      {bodyVisible ? (
        <div
          ref={kpiTableScrollRef}
          className={
            fillPage
              ? "loss-kpi-page-table min-w-0 w-full"
              : tableBodyScroll
                ? "kpi-summary-table-scroll"
                : "overflow-x-auto overflow-y-hidden"
          }
          data-virtual-kpi={virtualizeKpi ? "1" : "0"}
        >
          <table className="w-full min-w-[72rem] text-[10px] border-collapse kpi-summary-table">
            <SheetGridColgroup
              widths={kpiSummaryColWidths(
                profile === "catalysts" ? KPI_SUMMARY_COL_COUNT_CATALYSTS : KPI_SUMMARY_COL_COUNT,
              )}
            />
            <thead className="sticky top-0 z-[2] bg-[rgb(var(--surface))] shadow-[0_1px_0_rgb(var(--border)/0.55)]">
              <tr className={KPI_THEAD_TR}>
                <th
                  className={`${kpiTh("center")} !px-0.5`}
                  title={it ? "Attenzione (stellina)" : "Attention star"}
                >
                  <span className="text-ink-muted/50" aria-hidden>
                    ★
                  </span>
                </th>
                <th className={kpiTh("left")}>
                  <KpiSortHeader
                    col="ticker"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    align="left"
                    it={it}
                  >
                    {t("sim.lossAnalysis.summaryTable.ticker")}
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="productDesig"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.productDesigTip")}
                  >
                    {t("sim.lossAnalysis.summaryTable.productDesig")}
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="newsScores"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.newsScoresTip")}
                  >
                    {t("sim.lossAnalysis.summaryTable.newsScores")}
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="momentum"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.momentumTip")}
                  >
                    {t("sim.lossAnalysis.summaryTable.momentum")}
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="product"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.assetTip")}
                  >
                    {t("sim.lossAnalysis.summaryTable.asset")}
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="designation"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.designationTip")}
                  >
                    {t("sim.lossAnalysis.summaryTable.designation")}
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="catalyst"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.catalystTip")}
                  >
                    {t("sim.lossAnalysis.summaryTable.catalyst")}
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="phase"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.studyPhaseTip")}
                  >
                    {t("sim.lossAnalysis.summaryTable.studyPhase")}
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="days"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.daysToCatalystTip")}
                  >
                    {t("sim.lossAnalysis.summaryTable.daysToCatalyst")}
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="var24h"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.var24hTip")}
                  >
                    {t("sim.lossAnalysis.summaryTable.var24h")}
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="volume"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.volumePctCloseTip")}
                  >
                    {t("sim.lossAnalysis.summaryTable.volumePctClose")}
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="trends"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.trendTip")}
                  >
                    <span
                      className="cursor-help select-none"
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTrendLegendOpen(true);
                      }}
                    >
                      {t("sim.lossAnalysis.summaryTable.trend")}
                    </span>
                  </KpiSortHeader>
                </th>
                <th className={kpiTh("center")}>
                  <KpiSortHeader
                    col="rec"
                    sortKey={kpiSort.key}
                    sortDir={kpiSort.dir}
                    onSort={toggleKpiSort}
                    it={it}
                    title={t("sim.lossAnalysis.summaryTable.recommendationTip")}
                  >
                    {t("sim.lossAnalysis.summaryTable.recommendation")}
                  </KpiSortHeader>
                </th>
                {profile === "catalysts" && (
                  <th className={kpiTh("left")} title={it ? "Citazione dalla fonte originale" : "Quote from the original source"}>
                    Source Quote
                  </th>
                )}
              </tr>
            </thead>
            <tbody data-kpi-row-count={filteredTableItems.length}>
              {filteredTableItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={kpiColSpan}
                    className="px-2 py-4 text-center text-[11px] text-ink-muted"
                  >
                    {it
                      ? `Nessun ticker per “${kpiTickerQuery.trim()}”`
                      : `No ticker match for “${kpiTickerQuery.trim()}”`}
                  </td>
                </tr>
              ) : null}
              {virtualizeKpi && kpiScrollEl ? (
                <VirtualTablePadRow height={kpiVirtual.paddingTop} colSpan={kpiColSpan} />
              ) : null}
              {kpiRowsToRender.map(({ item }) => {
                const tk = item.ticker.trim().toUpperCase();
                const simRow = rowByKey.get(item.key) ?? null;
                const dcRow = decisionChartByKey.get(item.key);
                const decisionRec = dcRow?.rec ?? "review";
                const sdsScore =
                  sdsRowByTicker.get(tk)?.sds ??
                  item.sdsScore ??
                  null;
                return (
                  <LossAnalysisSummaryTableRow
                    key={item.key}
                    item={item}
                    it={it}
                    t={t}
                    profile={profile}
                    simRow={simRow}
                    live={kpiLive}
                    guidanceKpi={guidanceKpiByTicker?.get(tk)}
                    isRowHighlighted={highlightedKey === item.key}
                    dcRow={dcRow}
                    decisionRec={decisionRec}
                    sdsScore={sdsScore}
                    urgentSellG2={urgentSellG2}
                    capitalDenominatorEur={capitalDenominatorEur}
                    inputs={inputs}
                    clinicalRecords={clinicalRecords}
                    history={history}
                    sdsRow={sdsRowByTicker.get(tk) ?? null}
                    chartPts={
                      item.seriesKey
                        ? pointsBySeriesKey?.get(item.seriesKey) ?? null
                        : null
                    }
                    priorSessionPct={priorSessionPctByTicker?.get(tk)}
                    intraday={intradayByTicker?.get(tk)}
                    trendsLoading={searchInterest.loading}
                    fdaDesignation={fdaDesigByTicker[tk] ?? null}
                    newsProductDesig={newsDesigByTicker[tk] ?? null}
                    newsScores={newsScoresByTicker[tk] ?? null}
                    onScrollTo={onScrollTo}
                    onOpenClinicalStudies={setClinicalStudiesModal}
                  />
                );
              })}
              {virtualizeKpi && kpiScrollEl ? (
                <VirtualTablePadRow height={kpiVirtual.paddingBottom} colSpan={kpiColSpan} />
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {clinicalStudiesModal ? (
        <TickerClinicalStudiesModal
          open
          it={it}
          ticker={clinicalStudiesModal.ticker}
          company={clinicalStudiesModal.company}
          studies={clinicalStudiesModal.studies}
          primaryNctId={clinicalStudiesModal.primaryNctId}
          onClose={() => setClinicalStudiesModal(null)}
        />
      ) : null}
      <GoogleTrendsLegendModal
        open={trendLegendOpen}
        it={it}
        onClose={() => setTrendLegendOpen(false)}
      />
      {/* No-op until SHEET_WS_REALTIME_ENABLED — see RealTimeSheetUpdater FASE 1 Step 4 note. */}
      <RealTimeSheetUpdater
        realTimeColumns={realTimeColumns}
        tableData={realTimeTableData}
        onUpdate={handleRealTimeUpdate}
      />
    </div>
  );
}

/** Top KPI table retired — keep implementation for possible restore; silence noUnusedLocals. */
void LossAnalysisSummaryTable;

/** Heavy chart block — mounted only when the card scrolls into view. */
function LossAnalysisCardCharts({
  item,
  simRow,
  chartPts,
  chartSeriesMeta,
  mcsDoc,
  it,
  dense = false,
  clinicalKpi,
  clinicalRecords,
  clinicalFeedLoading = false,
  clinicalFeedUpdatedAt = null,
  regulatoryScore,
  autoRegSnap = null,
  onOpenEisDetail,
  intradayPrior,
  intradayLive,
  marketIntradayPrior,
  marketIntradayLive,
  intradayBatchLoading = false,
  cycleAlertsByKey = null,
  operationalRec = null,
  /** Provider + study strip live above (next to Beta/Liq/Pcont). */
  eisProviderNested = false,
  sdsRow = null,
}: {
  item: PortfolioLossAnalysisItem;
  simRow: Record<string, unknown> | null;
  chartPts: ChartPoint[] | null;
  chartSeriesMeta?: import("../types").ChartSeries | null;
  mcsDoc?: MarketContextSnapshotDoc | null;
  it: boolean;
  dense?: boolean;
  clinicalKpi?: number | null;
  clinicalRecords?: import("../api/supernova").ClinicalPreCdRecord[];
  clinicalFeedLoading?: boolean;
  clinicalFeedUpdatedAt?: string | null;
  regulatoryScore?: number | null;
  autoRegSnap?: import("../api/supernova").RegulatoryRiskSnapshot | null;
  onOpenEisDetail?: (
    ticker: string,
    clinicalKpi?: number | null,
    simRow?: Record<string, unknown> | null,
  ) => void;
  intradayPrior?: import("../sheet/simUniverse24hWhatIf").IntradayPricePoint[];
  intradayLive?: import("../sheet/simUniverse24hWhatIf").IntradayPricePoint[];
  marketIntradayPrior?: IntradayPricePoint[];
  marketIntradayLive?: IntradayPricePoint[];
  intradayBatchLoading?: boolean;
  cycleAlertsByKey?: CatalystCycleAlertsResponse["alerts"] | null;
  operationalRec?: DecisionRec | null;
  eisProviderNested?: boolean;
  sdsRow?: SdsRow | null;
}) {
  const rowKey = item.key;
  const [pairRange, setPairRange] = useState<PriceVarChartRange>("cat6M");
  const alignToCal6M = useCallback(() => setPairRange("cat6M"), []);

  const priceVariationWindows = useMemo(
    () =>
      buildPriceVariationWindows({
        simRow,
        chartPts,
        seriesMeta: chartSeriesMeta,
        marketDoc: mcsDoc,
      }),
    [simRow, chartPts, chartSeriesMeta, mcsDoc],
  );

  const pairPlotH = dense ? LOSS_ANALYSIS_PAIR_PLOT_H : LOSS_ASSESSMENT_PAIR_PLOT_H;
  const guidanceEvents = useTickerGuidanceEvents(item.ticker);

  const chartPair = (
    <LossAnalysisChartPairFrame
      rowKey={rowKey}
      item={item}
      simRow={simRow}
      priceVariationWindows={priceVariationWindows}
      mcsDoc={mcsDoc}
      intradayPrior={intradayPrior}
      intradayLive={intradayLive}
      marketIntradayPrior={marketIntradayPrior}
      marketIntradayLive={marketIntradayLive}
      intradayBatchLoading={intradayBatchLoading}
      cycleAlertsByKey={cycleAlertsByKey}
      clinicalRecords={clinicalRecords}
      clinicalKpi={clinicalKpi}
      pairRange={pairRange}
      onPairRangeChange={setPairRange}
      pairPlotH={pairPlotH}
      dense={dense}
      it={it}
      operationalRec={operationalRec}
      className={dense ? " mt-1" : " mt-2"}
    />
  );

  const devLane = (
    <div id={lossAnalysisChartSectionDomId(rowKey, "devLane")} className="min-w-0 w-full">
      <ClinicalDevelopmentLaneChart
        ticker={item.ticker}
        completionDate={item.completionDate}
        records={clinicalRecords}
        guidanceEvents={guidanceEvents}
        sdsRow={sdsRow}
        clinicalKpi={clinicalKpi}
        simRow={simRow}
        onAlignToCal6M={alignToCal6M}
      />
    </div>
  );

  if (!onOpenEisDetail) {
    return (
      <>
        {!dense ? <ModalChartHorizonBanner variant="lossAnalysis" /> : null}
        {devLane}
        {chartPair}
      </>
    );
  }

  /** Charts full tab width; EIS Market/Clinical lives in the trading-day banner. */
  const body = (
    <div className={`flex flex-col w-full min-w-0${dense ? " gap-1.5" : " gap-2"}`}>
      {devLane}
      {chartPair}
      {!eisProviderNested ? (
        <div id={lossAnalysisChartSectionDomId(rowKey, "eisReg")} className="min-w-0 w-full self-start">
          <TickerImpactEventsContextSection />
        </div>
      ) : null}
      <TickerCatalystEventsTable
        ticker={item.ticker}
        showAll={true}
        completionDate={item.completionDate}
        clinicalRecords={clinicalRecords}
        simRow={simRow}
      />
    </div>
  );

  return (
    <>
      {!dense ? <ModalChartHorizonBanner variant="lossAnalysis" /> : null}
      {eisProviderNested ? (
        body
      ) : (
        <TickerImpactEventsPanelProvider
          ticker={item.ticker}
          sheetClinicalKpi={clinicalKpi}
          lang={it ? "it" : "en"}
          clinicalRecords={clinicalRecords}
          clinicalFeedLoading={clinicalFeedLoading}
          regulatoryScore={regulatoryScore}
          simRow={simRow}
          autoRegSnap={autoRegSnap}
          layout="split"
          expanded
          feedUpdatedAt={clinicalFeedUpdatedAt}
          onOpenAllEvents={() => onOpenEisDetail(item.ticker, clinicalKpi ?? null, simRow)}
        >
          {body}
        </TickerImpactEventsPanelProvider>
      )}
    </>
  );
}

function LossAnalysisDeepDiveKpiBand({
  it,
  item,
  simRow,
  chartPts,
  marketCapUsd,
  sdsRow,
  clinicalRecords,
  showClinical = true,
}: {
  it: boolean;
  item: PortfolioLossAnalysisItem;
  simRow: Record<string, unknown> | null;
  chartPts: import("../types").ChartPoint[] | null;
  marketCapUsd: number | null;
  sdsRow?: SdsRow | null;
  clinicalRecords?: import("../api/supernova").ClinicalPreCdRecord[];
  showClinical?: boolean;
}) {
  const { eisMarketSum, eisClinicalSum, onOpenAllEvents } = useTickerImpactEventsCtx();
  const mcapLabel =
    marketCapUsd != null && Number.isFinite(marketCapUsd) && marketCapUsd > 0
      ? `$${formatMarketCap(marketCapUsd)}`
      : "—";

  const residualBreakdown = useMemo(
    () =>
      buildResidualMoveBreakdownForTicker({
        ticker: item.ticker,
        observedPct: item.pnlPct24h ?? (item.hasPosition ? item.pnlPct : null),
        curveGapPct: item.curveGapPct,
        sdsRow: sdsRow ?? null,
        lang: it ? "it" : "en",
        clinicalRecords,
      }),
    [item.ticker, item.pnlPct24h, item.hasPosition, item.pnlPct, item.curveGapPct, sdsRow, it, clinicalRecords],
  );

  const shortTrendPct = item.pnlPctSinceReading ?? item.pnlPct24h;
  const recovering =
    item.hasPosition &&
    item.pnlPct != null &&
    shortTrendPct != null &&
    Number.isFinite(item.pnlPct) &&
    Number.isFinite(shortTrendPct) &&
    item.pnlPct < -0.05 &&
    shortTrendPct > 0.05;

  const note = useMemo(() => {
    const parts: string[] = [];
    if (recovering) {
      parts.push(
        it
          ? "↗ In recupero oggi, ancora sotto acqua"
          : "↗ Recovering today, still underwater",
      );
    }
    if (residualBreakdown) {
      const day =
        item.pnlPct24h != null && Number.isFinite(item.pnlPct24h)
          ? fmtPortfolioPnlPct(item.pnlPct24h)
          : null;
      if (residualBreakdown.flags.marketOnly && day) {
        const resid =
          residualBreakdown.unexplainedPct >= 0
            ? `+${residualBreakdown.unexplainedPct.toFixed(1)}%`
            : `${residualBreakdown.unexplainedPct.toFixed(1)}%`;
        parts.push(
          it
            ? `${day} oggi sembra guidato dal settore, residuale ${resid}`
            : `${day} today looks sector-driven, residual ${resid}`,
        );
      } else {
        parts.push(formatResidualSummary(residualBreakdown, it ? "it" : "en"));
      }
    }
    return parts.length ? parts.join(" · ") : null;
  }, [recovering, residualBreakdown, item.pnlPct24h, it]);

  return (
    <DeepDiveKpiRibbon
      it={it}
      pnlPctLast={item.pnlPctSinceReading}
      pnlEurLast={item.pnlEurSinceReading}
      pnlPct24h={item.pnlPct24h}
      pnlEur24h={item.pnlEur24h}
      simRow={simRow}
      chartPts={chartPts}
      marketCapLabel={mcapLabel}
      eisMarketLabel={fmtSignedEis(eisMarketSum)}
      eisClinicalLabel={fmtSignedEis(eisClinicalSum)}
      eisMarketColor={eisMarketSum != null ? eisColor(eisMarketSum) : undefined}
      eisClinicalColor={
        eisClinicalSum != null ? eisColor(eisClinicalSum) : "rgb(var(--ink-muted))"
      }
      onOpenEis={onOpenAllEvents}
      note={note}
      clinicalSlot={showClinical ? <TickerImpactEventsCdStudyStrip /> : null}
    />
  );
}

const LossAnalysisCard = memo(function LossAnalysisCard({
  item,
  simRow,
  chartPts,
  chartSeriesMeta,
  sdsRow,
  migSnap,
  migRow,
  onSell,
  onRegisterBuy,
  onOpenSlopeCharts: _onOpenSlopeCharts,
  onOpenPredictionCharts: _onOpenPredictionCharts,
  onOpenDecisionLab,
  onOpenEisDetail,
  profile,
  cardDomId,
  patternRec,
  eisSuperScoreState,
  highlighted = false,
  clinicalRecords,
  clinicalFeedLoading = false,
  clinicalFeedUpdatedAt = null,
  regulatoryScore,
  autoRegSnap = null,
  mcsDoc = null,
  decisionRec = null,
  intradayPrior,
  intradayLive,
  marketIntradayPrior,
  marketIntradayLive,
  intradayBatchLoading = false,
  cycleAlertsByKey = null,
  tickerSimRows = [],
}: {
  item: PortfolioLossAnalysisItem;
  simRow: Record<string, unknown> | null;
  chartPts: import("../types").ChartPoint[] | null;
  chartSeriesMeta?: import("../types").ChartSeries | null;
  sdsRow?: SdsRow | null;
  migSnap?: MigSoliditySnapshot | null;
  migRow?: import("../sheet/marketInterestGate").MIGResult | null;
  onSell: PortfolioSellHandler;
  onRegisterBuy?: PortfolioRegisterBuyHandler;
  /** Kept for parent API; link row removed — use Decision Lab only. */
  onOpenSlopeCharts?: (ticker: string) => void;
  onOpenPredictionCharts: (focus: {
    ticker: string;
    completionDate: string;
    seriesKey: string | null;
  }) => void;
  onOpenDecisionLab?: (focus: { ticker: string; cd?: string }) => void;
  onOpenEisDetail?: (
    ticker: string,
    clinicalKpi?: number | null,
    simRow?: Record<string, unknown> | null,
  ) => void;
  profile: LossAnalysisProfile;
  cardDomId: string;
  patternRec?: CdPatternTickerRecommendation | null;
  eisSuperScoreState?: EisSuperScoreState | null;
  /** When true, pulse + glow the card so the user instantly spots it after
   *  navigating here from the dashboard "24h" button. */
  highlighted?: boolean;
  clinicalRecords?: import("../api/supernova").ClinicalPreCdRecord[];
  clinicalFeedLoading?: boolean;
  clinicalFeedUpdatedAt?: string | null;
  regulatoryScore?: number | null;
  autoRegSnap?: import("../api/supernova").RegulatoryRiskSnapshot | null;
  mcsDoc?: MarketContextSnapshotDoc | null;
  /** Buy/Hold/Review/Sell — stessa raccomandazione del decision chart. */
  decisionRec?: DecisionRec | null;
  intradayPrior?: import("../sheet/simUniverse24hWhatIf").IntradayPricePoint[];
  intradayLive?: import("../sheet/simUniverse24hWhatIf").IntradayPricePoint[];
  marketIntradayPrior?: IntradayPricePoint[];
  marketIntradayLive?: IntradayPricePoint[];
  intradayBatchLoading?: boolean;
  cycleAlertsByKey?: CatalystCycleAlertsResponse["alerts"] | null;
  tickerSimRows?: Record<string, unknown>[];
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const [companyProfileOpen, setCompanyProfileOpen] = useState(false);
  const guidanceEvents = useTickerGuidanceEvents(item.ticker);
  const companyProfile = useMemo(
    () =>
      buildCompanyProfileOverview({
        ticker: item.ticker,
        company: item.company,
        simRows: tickerSimRows.length ? tickerSimRows : simRow ? [simRow] : [],
        clinicalRecords,
        guidanceEvents,
        sdsRow,
      }),
    [item.ticker, item.company, tickerSimRows, simRow, clinicalRecords, guidanceEvents, sdsRow],
  );

  const softBuyEnhance = useMemo(
    (): SuggestedActionEnhanceCtx => ({
      simRow,
      chartPts,
    }),
    [simRow, chartPts],
  );

  const simBuyGate = useMemo(
    () => evaluateSimBuyGate(item, false, it ? "it" : "en", softBuyEnhance),
    [item, it, softBuyEnhance],
  );

  const softBuyRegisterCapitalEur = useMemo(
    () =>
      softBuyCapitalFromGateStrength(
        DEFAULT_PLAN_CAPITAL_EUR,
        evaluateSoftBuyGateStrength(item, softBuyEnhance),
      ),
    [item, softBuyEnhance],
  );

  const lazyBody = profile === "portfolio";
  const chartMargin = lazyBody ? CHART_INVIEW_MARGIN_PORTFOLIO : CHART_INVIEW_MARGIN_OPP;
  const { ref: bodyHostRef, inView: bodyInView } = useInViewOnce(highlighted, chartMargin);
  const { ref: chartsHostRef, inView: chartsLazyInView } = useInViewOnce(highlighted, chartMargin);
  const showBody = !lazyBody || bodyInView || highlighted;
  const chartsInView = lazyBody ? showBody : chartsLazyInView || highlighted;

  const clinicalKpi = clinicalKpiFromSimRow(simRow);
  const nearestEis = useMemo(
    () =>
      resolveNearestEisForTicker({
        patternRec,
        ticker: item.ticker,
        completionDate: item.completionDate,
        lang: it ? "it" : "en",
        eisSuperScoreState,
        clinicalKpi,
        clinicalPreCdRecords: clinicalRecords,
      }),
    [patternRec, item.ticker, item.completionDate, it, eisSuperScoreState, clinicalKpi, clinicalRecords],
  );

  const planProb = useMemo(
    () =>
      resolvePlanProbHeroPayload(item, {
        matchPct: patternRec?.matchPct ?? null,
        sdsScore: sdsRow?.sds ?? null,
        sdsVeto: Boolean(sdsRow?.veto),
        miiAngleDeg: migSnap?.slopeAngleDeg ?? migRow?.slopeAngleDeg ?? null,
        eisSuperScore: nearestEis?.superScore ?? nearestEis?.score ?? null,
        lang: it ? "it" : "en",
      }),
    [item, patternRec, sdsRow, migSnap, migRow, nearestEis, it],
  );

  const cardDense = true;

  const marketCapUsd = useMemo(() => {
    const fromSim = marketCapUsdFromSimRow(simRow);
    if (fromSim != null && fromSim > 0) return fromSim;
    const bn = sdsRow?.cluster_d?.mc_pipeline_ratio?.market_cap_bn;
    if (bn != null && Number.isFinite(bn) && bn > 0) return bn * 1e9;
    return null;
  }, [simRow, sdsRow]);

  return (
    <article
      id={cardDomId}
      className={`rounded-xl shadow-sm overflow-x-clip overflow-y-visible scroll-mt-24 transition-shadow duration-500 ${cardShellClass(item)} ${
        highlighted ? "ring-2 ring-amber-400/90 ring-offset-2 ring-offset-white dark:ring-offset-slate-900" : ""
      }`}
    >
      <TickerImpactEventsPanelProvider
        ticker={item.ticker}
        sheetClinicalKpi={clinicalKpi}
        lang={it ? "it" : "en"}
        clinicalRecords={clinicalRecords}
        clinicalFeedLoading={clinicalFeedLoading}
        regulatoryScore={regulatoryScore}
        simRow={simRow}
        autoRegSnap={autoRegSnap}
        layout="split"
        expanded
        feedUpdatedAt={clinicalFeedUpdatedAt}
        onOpenAllEvents={() => onOpenEisDetail?.(item.ticker, clinicalKpi ?? null, simRow)}
      >
      <div className={`${cardDense ? "px-2.5 py-1.5" : "px-3 py-2"} ${cardHeaderClass(item)}`}>
        <div className={`flex items-center justify-between ${cardDense ? "gap-2" : "gap-3"}`}>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pr-1">
              <div className="inline-flex items-center gap-x-1.5 min-w-0">
                <AttentionStarToggle ticker={item.ticker} it={it} sizeClass="text-[14px]" />
                <StudyTypeTickerIcon
                  ticker={item.ticker}
                  simRow={simRow}
                  clinicalMeta={findClinicalMetaForTicker(clinicalRecords, item.ticker)}
                  size={STUDY_DRUG_ICON_PX}
                />
                <h3 className={`font-bold text-ink leading-tight shrink-0${cardDense ? " text-sm" : " text-base"}`}>
                  {item.ticker}
                </h3>
                {item.company ? (
                  <button
                    type="button"
                    className={`text-[11px] truncate leading-tight transition-colors text-left max-w-[14rem] hover:underline ${
                      highlighted
                        ? "text-[rgb(var(--warn))] font-semibold underline decoration-[rgb(var(--warn))]/80 decoration-2 underline-offset-2"
                        : "text-ink/90"
                    }`}
                    title={it ? "Mission, pipeline e prodotti approvati" : "Mission, pipeline and approved products"}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setCompanyProfileOpen(true);
                    }}
                  >
                    {item.company}
                  </button>
                ) : null}
                {item.daysToCd != null ||
                (item.completionDate && item.completionDate !== "—") ? (
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                      item.daysToCd != null && item.daysToCd < 0
                        ? "border-[rgb(var(--signal-down))]/35 bg-[rgb(var(--signal-down))]/10 text-[rgb(var(--signal-down))]"
                        : "border-[rgb(var(--border))]/20 bg-[rgb(var(--surface-elevated))] text-ink"
                    }`}
                    title={
                      it
                        ? "Giorni alla Completion Date dello studio"
                        : "Days to study Completion Date"
                    }
                  >
                    {item.completionDate && item.completionDate !== "—" ? (
                      <span>
                        <span className="uppercase tracking-wide font-bold">CD</span>{" "}
                        {fmtCompactCdDate(item.completionDate, it)}
                      </span>
                    ) : null}
                    {item.daysToCd != null ? (
                      <span
                        className={
                          item.daysToCd < 0
                            ? "text-[rgb(var(--signal-down))] font-bold"
                            : undefined
                        }
                      >
                        ·{" "}
                        {item.daysToCd > 0
                          ? `${item.daysToCd}${it ? "g" : "d"}`
                          : item.daysToCd === 0
                            ? it
                              ? "oggi"
                              : "today"
                            : `−${Math.abs(item.daysToCd)}${it ? "g" : "d"}`}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
              {item.livePriceDead ? (
                <span
                  className="inline-flex items-center rounded-full border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-3))]/80 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-muted"
                  title={t("sim.lossAnalysis.summaryTable.livePriceDead")}
                >
                  {t("sim.lossAnalysis.summaryTable.livePriceDeadShort")}
                </span>
              ) : null}
              {item.hasPosition ? (
                <PortfolioExitButton
                  simKey={item.key}
                  simRow={simRow}
                  onSell={onSell}
                  exitDecision={planProb.decision}
                />
              ) : onRegisterBuy && simBuyGate.allowed ? (
                <PortfolioRegisterBuyButton
                  ticker={item.ticker}
                  simKey={item.key}
                  capitalEur={softBuyRegisterCapitalEur}
                  onRegisterBuy={onRegisterBuy}
                  compact
                />
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-1.5 min-w-0">
          <LossAnalysisDeepDiveKpiBand
            it={it}
            item={item}
            simRow={simRow}
            chartPts={chartPts}
            marketCapUsd={marketCapUsd}
            sdsRow={sdsRow}
            clinicalRecords={clinicalRecords}
            showClinical={Boolean(onOpenEisDetail)}
          />
        </div>
      </div>

      {showBody ? (
        <div ref={lazyBody ? bodyHostRef : undefined}>
          {onOpenEisDetail ? (
            <>
              <div
                id={lossAnalysisChartSectionDomId(item.key, "eisReg")}
                className="sr-only"
                aria-hidden
              />

              <div ref={lazyBody ? undefined : chartsHostRef} className="px-2 pb-2 w-full min-w-0">
                {chartsInView ? (
                  <LossAnalysisCardCharts
                    item={item}
                    simRow={simRow}
                    chartPts={chartPts}
                    chartSeriesMeta={chartSeriesMeta}
                    mcsDoc={mcsDoc}
                    it={it}
                    dense
                    clinicalKpi={clinicalKpi}
                    clinicalRecords={clinicalRecords}
                    clinicalFeedLoading={clinicalFeedLoading}
                    clinicalFeedUpdatedAt={clinicalFeedUpdatedAt}
                    regulatoryScore={regulatoryScore}
                    autoRegSnap={autoRegSnap}
                    onOpenEisDetail={onOpenEisDetail}
                    eisProviderNested
                    sdsRow={sdsRow}
                    intradayPrior={intradayPrior}
                    intradayLive={intradayLive}
                    marketIntradayPrior={marketIntradayPrior}
                    marketIntradayLive={marketIntradayLive}
                    intradayBatchLoading={intradayBatchLoading}
                    cycleAlertsByKey={cycleAlertsByKey}
                    operationalRec={decisionRec}
                  />
                ) : (
                  <div
                    className="min-h-[7rem] rounded-lg border border-dashed border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-2))]/25 flex items-center justify-center"
                    aria-hidden
                  >
                    <p className="text-[10px] text-ink-muted px-4 text-center">
                      {t("sim.lossAnalysis.chart.deferred")}
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div ref={lazyBody ? undefined : chartsHostRef} className="px-2 pb-2 w-full min-w-0">
                {chartsInView ? (
                  <LossAnalysisCardCharts
                    item={item}
                    simRow={simRow}
                    chartPts={chartPts}
                    chartSeriesMeta={chartSeriesMeta}
                    mcsDoc={mcsDoc}
                    it={it}
                    dense
                    clinicalKpi={clinicalKpi}
                    clinicalRecords={clinicalRecords}
                    clinicalFeedLoading={clinicalFeedLoading}
                    clinicalFeedUpdatedAt={clinicalFeedUpdatedAt}
                    regulatoryScore={regulatoryScore}
                    autoRegSnap={autoRegSnap}
                    onOpenEisDetail={onOpenEisDetail}
                    sdsRow={sdsRow}
                    intradayPrior={intradayPrior}
                    intradayLive={intradayLive}
                    marketIntradayPrior={marketIntradayPrior}
                    marketIntradayLive={marketIntradayLive}
                    intradayBatchLoading={intradayBatchLoading}
                    cycleAlertsByKey={cycleAlertsByKey}
                    operationalRec={decisionRec}
                  />
                ) : (
                  <div
                    className="min-h-[7rem] rounded-lg border border-dashed border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-2))]/25 flex items-center justify-center"
                    aria-hidden
                  >
                    <p className="text-[10px] text-ink-muted px-4 text-center">
                      {t("sim.lossAnalysis.chart.deferred")}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}

          {onOpenDecisionLab ? (
            <div className="px-2 py-2 flex flex-wrap items-center gap-1 border-t border-[rgb(var(--border))]/30">
              <button
                type="button"
                className="btn-ghost border border-[rgb(var(--border))]/50 text-[10px] px-2 py-1"
                onClick={() =>
                  onOpenDecisionLab({ ticker: item.ticker, cd: item.completionDate })
                }
              >
                {t("sim.lossAnalysis.action.decisionLab")}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div
          ref={bodyHostRef}
          className="min-h-[2.5rem] border-b border-dashed border-[rgb(var(--border))]/35 bg-[rgb(var(--surface-2))]/20 flex items-center justify-center"
          aria-hidden
        >
          <p className="text-[10px] text-ink-muted px-3">{t("sim.lossAnalysis.chart.deferred")}</p>
        </div>
      )}

      </TickerImpactEventsPanelProvider>
      <CompanyProfileModal
        open={companyProfileOpen}
        onClose={() => setCompanyProfileOpen(false)}
        profile={companyProfile}
        it={it}
      />
    </article>
  );
});

function seedDeepDiveKey(rowKey?: string | null, ticker?: string | null): string | null {
  const rk = rowKey?.trim();
  if (rk) return rk;
  const tk = ticker?.trim().toUpperCase();
  return tk || null;
}

function DeepDiveSplash({
  onBack,
  backLabel,
}: {
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <div className="relative flex min-h-[52vh] flex-col items-center justify-center overflow-hidden px-4 py-12">
      <svg
        aria-hidden
        viewBox="0 0 400 400"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[min(70vw,420px)] w-[min(70vw,420px)] -translate-x-1/2 -translate-y-[46%] opacity-90"
      >
        <defs>
          <linearGradient id="deepDiveStarFill" x1="18%" y1="6%" x2="86%" y2="94%">
            <stop offset="0%" stopColor="#A79AFF" stopOpacity="0.55" />
            <stop offset="42%" stopColor="#7C6CF3" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#121729" stopOpacity="0.18" />
          </linearGradient>
        </defs>
        <path
          fill="url(#deepDiveStarFill)"
          d="M200 12 L243.8 156.2 L388 200 L243.8 243.8 L200 388 L156.2 243.8 L12 200 L156.2 156.2 Z"
        />
        <path fill="rgba(167,154,255,0.22)" d="M200 12 L243.8 156.2 L200 200 L156.2 156.2 Z" />
      </svg>
      <p className="relative z-10 text-[2.15rem] font-semibold tracking-tight text-ink sm:text-[2.4rem]">
        DeepDive
      </p>
      {onBack ? (
        <button
          type="button"
          className="relative z-10 mt-7 inline-flex items-center gap-1.5 text-[13px] text-ink-muted transition-colors hover:text-ink"
          onClick={onBack}
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 5.5 8.5 12l7 6.5" />
          </svg>
          {backLabel}
        </button>
      ) : null}
    </div>
  );
}

export function PortfolioLossAnalysisView({
  simTable,
  inputs,
  history,
  chartBundle,
  sdsRows,
  onBack,
  onSell,
  onRegisterBuy,
  onOpenPredictionCharts,
  onOpenDecisionLab,
  onOpenSlopeCharts,
  embedded = false,
  focusTicker,
  focusRowKey,
  focusNonce = null,
  preferTopKpi = false,
  openDeepDive = false,
  openEis = false,
  onFocusTickerConsumed,
  mode = "full",
  onOpenFullAssessment,
  onEvalPaneChange,
}: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  history?: import("../sheet/investSimStorage").InvestSimHistoryPoint[];
  chartBundle: ChartBundle | null;
  sdsRows?: SdsRow[] | null;
  onBack?: () => void;
  onSell: PortfolioSellHandler;
  /** Register buy (capital + entry price) for off-portfolio opportunities. */
  onRegisterBuy?: PortfolioRegisterBuyHandler;
  onOpenPredictionCharts: (focus: {
    ticker: string;
    completionDate: string;
    seriesKey: string | null;
  }) => void;
  onOpenDecisionLab?: (focus: { ticker: string; cd?: string }) => void;
  onOpenSlopeCharts?: (ticker: string) => void;
  /** Embedded in Catalyst Hub — no back button, compact chrome. */
  embedded?: boolean;
  focusTicker?: string | null;
  /** Preferito su focusTicker — scroll alla card TICKER|CD esatta. */
  focusRowKey?: string | null;
  /** Re-triggers Top KPI scroll when the same ticker is clicked again. */
  focusNonce?: number | null;
  /** Home cutoff / Pulse deep-link → scroll Top KPI yellow row. */
  preferTopKpi?: boolean;
  /** Home Suggested BUY/SELL → Top KPI row (yellow highlight + ticker focus). */
  openDeepDive?: boolean;
  /** Dashboard / Pulse → EIS sub-tab inside Evaluation deep-dive. */
  openEis?: boolean;
  onFocusTickerConsumed?: () => void;
  /**
   * Rendering mode:
   * - "full" (default): profile toggle + Top KPI table; ticker click opens deep-dive tab.
   * - "hub": home-page mount → profile toggle + Top KPI table only (no dive tab).
   * - "cards": 24h assessment tab → same as full (deep-dive tab).
   */
  mode?: "full" | "hub" | "cards";
  /**
   * When mode === "hub" (home mount) there is no deep-dive modal on this
   * surface, so clicking a Top KPI row should navigate to the full
   * 24h Assessment tab focused on that ticker.
   */
  onOpenFullAssessment?: (focus: { ticker: string; cd?: string }) => void;
  /** Parent chrome (Deep Dive page title) — hide «Top KPI» while EIS is open. */
  onEvalPaneChange?: (pane: "kpi" | "dive" | "eis" | "financial") => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const profile = useEvalLabProfile();
  const interestTickers = useCatalystInterestTickers();
  const [starVersion, setStarVersion] = useState(() => getAttentionStarsVersion());
  useEffect(() => {
    const onStars = () => setStarVersion(getAttentionStarsVersion());
    window.addEventListener("supernova:attention-stars-changed", onStars);
    return () => window.removeEventListener("supernova:attention-stars-changed", onStars);
  }, []);
  const [oppCdScope] = useState<SimCdHorizonScope>(() => loadSimCdHorizonScope());
  const [sortByHighVol, setSortByHighVol] = useState(false);
  const [sortByActionSolidity, setSortByActionSolidity] = useState(false);
  /** Yahoo prior-session % — Soft BUY ↑≥2d (same as Home Cutoff). */
  const [priorSessionPctByTicker, setPriorSessionPctByTicker] = useState<Map<string, number>>(
    () => new Map(),
  );
  const [volumeAccelByTicker, setVolumeAccelByTicker] = useState<
    Map<
      string,
      {
        flagged: boolean;
        score: number | null;
        doublingMinutes: number | null;
        rvol: number | null;
      }
    >
  >(() => new Map());
  const [intradayByTicker, setIntradayByTicker] = useState<
    Map<string, { prior?: IntradayPricePoint[]; live?: IntradayPricePoint[] }>
  >(() => new Map());
  const [intradayBatchLoading, setIntradayBatchLoading] = useState(false);
  const [marketIntradayPrior, setMarketIntradayPrior] = useState<
    IntradayPricePoint[] | undefined
  >();
  const [marketIntradayLive, setMarketIntradayLive] = useState<
    IntradayPricePoint[] | undefined
  >();
  const [summaryTableCollapsed, setSummaryTableCollapsed] = useState(() =>
    loadSummaryTableCollapsed(getEvalLabProfile()),
  );
  const [riskModalEntry, setRiskModalEntry] = useState<LossRiskEntry | null>(null);
  /**
   * Key of the card that should briefly pulse / glow when the user lands on
   * this view via the dashboard "24h" button. Auto-clears after a few seconds
   * so it does not become permanent visual noise.
   */
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  /** Keep a deep-linked row visible in Top KPI even if watch filters would hide it. */
  const [kpiFocusPinKey, setKpiFocusPinKey] = useState<string | null>(null);
  /** Virtual table scroll-to-index (row may not be in DOM until scrolled). */
  const kpiScrollToKeyRef = useRef<((key: string) => void) | null>(null);
  /** Seed from the incoming ticker so Catalyst clicks skip the empty interstitial. */
  const [deepDiveKey, setDeepDiveKey] = useState<string | null>(() =>
    seedDeepDiveKey(focusRowKey, focusTicker),
  );
  const [deepDiveSection, setDeepDiveSection] = useState<LossAnalysisScoreSection | undefined>();
  const [evalPane, setEvalPane] = useState<"kpi" | "dive" | "eis" | "financial">("dive");

  useEffect(() => {
    onEvalPaneChange?.(evalPane);
  }, [evalPane, onEvalPaneChange]);

  /** Top KPI pane retired — never stay on kpi when a company dive is open. */
  useEffect(() => {
    if (evalPane === "kpi" && deepDiveKey) setEvalPane("dive");
  }, [evalPane, deepDiveKey]);
  const [autoRegSnap, setAutoRegSnap] = useState<RegulatoryRiskSnapshot | null>(null);
  const [mcsDoc, setMcsDoc] = useState<MarketContextSnapshotDoc | null>(null);
  const mobileChartPatchRef = useRef<{
    decisionChartViews: MobileDecisionChartViews;
    decisionChartRows: ReturnType<typeof unionDecisionChartRows>;
    decisionChartScope: MobileDecisionChartViewId;
  } | null>(null);
  const [mobileChartReady, setMobileChartReady] = useState(false);
  const [mobileSyncBusy, setMobileSyncBusy] = useState(false);
  const [mobileSyncNote, setMobileSyncNote] = useState<string | null>(null);
  const [mobileSyncOk, setMobileSyncOk] = useState<boolean | null>(null);
  const {
    records: clinicalRecords,
    reload: reloadClinicalFeed,
  } = useClinicalPreCdRecords();

  /** Fresh clinical snapshot every time this tab opens. */
  useEffect(() => {
    reloadClinicalFeed();
  }, [reloadClinicalFeed]);

  // Per-ticker loss-risk catalog (Phase A screening + Phase B pattern) —
  // shared with the Three-portfolios table and the dashboard so risk scores
  // stay numerically identical across every surface.
  const { catalog: lossRiskCatalog, catalogByRowKey } = useLossRiskCatalog({
    simTable,
    sdsRows: sdsRows ?? null,
    chartBundle,
  });
  const [eisSuperScoreState, setEisSuperScoreState] = useState<EisSuperScoreState | null>(null);
  const polygonOverview = useCdPatternPolygonOverview();

  /** Last focus tag we auto-aligned profile for — do not re-fight a manual toggle. */
  const alignedFocusTagRef = useRef<string | null>(null);
  /** Last focus tag we already auto-scrolled — avoid yanking back to Top KPI on re-render. */
  const scrolledFocusTagRef = useRef<string | null>(null);
  /** Home chip → Top KPI scroll timers. Must outlive catalog re-renders. */
  const kpiLandTimersRef = useRef<number[]>([]);
  const clearKpiLandTimers = () => {
    for (const id of kpiLandTimersRef.current) window.clearTimeout(id);
    kpiLandTimersRef.current = [];
  };
  useEffect(() => () => {
    for (const id of kpiLandTimersRef.current) window.clearTimeout(id);
    kpiLandTimersRef.current = [];
  }, []);

  const toggleSummaryTableCollapsed = () => {
    setSummaryTableCollapsed((prev) => {
      const next = !prev;
      saveSummaryTableCollapsed(next);
      return next;
    });
  };

  const closeDeepDive = useCallback(() => {
    setDeepDiveKey(null);
    setDeepDiveSection(undefined);
    setHighlightedKey(null);
    // Top KPI removed — closing returns to Catalyst (or parent back handler).
    if (onBack) {
      onBack();
      return;
    }
    setEvalPane("dive");
  }, [onBack]);

  const scrollToItem = useCallback((
    key: string,
    section?: LossAnalysisScoreSection,
    opts?: { eis?: boolean },
  ) => {
    // Home-page "hub" mount: no modal here — open the full Assessment tab.
    if (mode === "hub" && onOpenFullAssessment) {
      const [ticker, cd] = key.split("|");
      onOpenFullAssessment({ ticker, cd });
      return;
    }
    scrolledFocusTagRef.current = `${focusRowKey?.trim() ?? ""}|${focusTicker?.trim().toUpperCase() ?? ""}|${focusNonce ?? 0}`;
    // Commit dive key before clearing parent focus — avoids bounce-to-Catalyst race.
    setHighlightedKey(key);
    setKpiFocusPinKey(key);
    setDeepDiveSection(section);
    setDeepDiveKey(key);
    setEvalPane(opts?.eis ? "eis" : "dive");
    onFocusTickerConsumed?.();
  }, [
    mode,
    onOpenFullAssessment,
    onFocusTickerConsumed,
    focusRowKey,
    focusTicker,
    focusNonce,
  ]);

  const openEisDetail = useCallback(
    (ticker: string, clinicalKpi?: number | null, simRow?: Record<string, unknown> | null) => {
      const tk = ticker.trim().toUpperCase();
      if (!tk) return;
      setEisDeepDiveFocus({
        ticker: tk,
        clinicalKpi: clinicalKpi ?? null,
        simRow: simRow ?? null,
      });
      if (!deepDiveKey) {
        const row =
          simRow ??
          (simTable?.rows ?? []).find(
            (r) => String(r["Ticker"] ?? "").trim().toUpperCase() === tk,
          );
        const key = row
          ? normalizedRowKey(tk, String(row["Completion Date"] ?? ""))
          : `${tk}|`;
        setDeepDiveKey(key);
        setHighlightedKey(key);
        setKpiFocusPinKey(key);
      }
      setEvalPane("eis");
    },
    [deepDiveKey, simTable?.rows],
  );


  useEffect(() => {
    void loadEisSuperScoreState().then(setEisSuperScoreState);
  }, []);

  useEffect(() => {
    void fetchRegulatoryRiskSnapshot()
      .then(setAutoRegSnap)
      .catch(() => setAutoRegSnap(null));
  }, []);

  useEffect(() => {
    void loadDecisionChartMcsDoc().then(setMcsDoc);
  }, []);

  const pointsBySeriesKey = useMemo(() => {
    const m = new Map<string, import("../types").ChartPoint[]>();
    if (!chartBundle?.series) return m;
    for (const [k, s] of Object.entries(chartBundle.series)) {
      if (s?.points?.length) m.set(k, s.points);
    }
    return m;
  }, [chartBundle]);

  const migSolidityByKey = useMemo(
    () => buildMigSolidityByKey(simTable, chartBundle, sdsRows),
    [simTable, chartBundle, sdsRows],
  );

  const lossProbOptions = useMemo(
    () => ({
      sdsRows,
      migSolidityByKey,
      eisSuperScoreState,
      polygonOverview,
    }),
    [sdsRows, migSolidityByKey, eisSuperScoreState, polygonOverview],
  );

  // Always build both catalogs (not gated on active profile). Soft BUY/SELL
  // deep-links from Home must resolve the row while the profile chip is still
  // flipping — empty cross-profile lists were the Top KPI yellow-row miss.
  const portfolioItems = useMemo(
    () =>
      buildLossAnalysisItems(
        "portfolio",
        simTable,
        inputs,
        pointsBySeriesKey,
        lang,
        history,
        lossProbOptions,
      ),
    [simTable, inputs, pointsBySeriesKey, lang, history, lossProbOptions],
  );

  const pastCdOffBookTickers = useMemo(
    () => collectPastCdOffBookTickers(simTable, inputs),
    [simTable, inputs],
  );
  const rescueVolByTicker = useVolumeVsPrevSession(
    pastCdOffBookTickers,
    pastCdOffBookTickers.length > 0,
  );
  const highVolRescueTickers = useMemo(() => {
    const s = new Set<string>();
    for (const tk of pastCdOffBookTickers) {
      if (tickerHasHighVol(tk, rescueVolByTicker)) s.add(tk);
    }
    return s;
  }, [pastCdOffBookTickers, rescueVolByTicker]);

  const opportunityItemsHot = useMemo(
    () =>
      simTable?.rows?.length
        ? buildLossAnalysisItems(
            "opportunities",
            simTable,
            inputs,
            pointsBySeriesKey,
            lang,
            history,
            lossProbOptions,
            "hot",
          )
        : [],
    [simTable, inputs, pointsBySeriesKey, lang, history, lossProbOptions],
  );

  const opportunityItemsWatch = useMemo(
    () =>
      simTable?.rows?.length
        ? buildLossAnalysisItems(
            "opportunities",
            simTable,
            inputs,
            pointsBySeriesKey,
            lang,
            history,
            lossProbOptions,
            "watch",
            highVolRescueTickers,
          )
        : [],
    [simTable, inputs, pointsBySeriesKey, lang, history, lossProbOptions, highVolRescueTickers],
  );

  const opportunityItemsAllScopes = useMemo(() => {
    const m = new Map<string, PortfolioLossAnalysisItem>();
    for (const it of opportunityItemsHot) m.set(it.key, it);
    for (const it of opportunityItemsWatch) m.set(it.key, it);
    return [...m.values()];
  }, [opportunityItemsHot, opportunityItemsWatch]);

  const catalystItems = useMemo(
    () =>
      buildLossAnalysisItems(
        "catalysts",
        simTable,
        inputs,
        pointsBySeriesKey,
        lang,
        undefined,
        lossProbOptions,
      ),
    [simTable, inputs, pointsBySeriesKey, lang, lossProbOptions],
  );

  /** Guidance Calendar snapshot data — used for catalyst KPI columns (window, type, phase, quote). */
  const guidanceKpiByTicker = useGuidanceKpiByTicker();

  /**
   * Evaluation Lab Top KPI: open book first, then other companies with
   * catalyst deadline within ~2 months (same horizon as Catalyst Days).
   * Display-only — does not change Soft BUY/SELL scoring.
   */
  const unifiedTopKpiItems = useMemo(() => {
    const seenKeys = new Set<string>();
    const seenTickers = new Set<string>();
    const out: PortfolioLossAnalysisItem[] = [];
    for (const item of portfolioItems) {
      seenKeys.add(item.key);
      seenTickers.add(item.ticker.trim().toUpperCase());
      out.push(item);
    }
    for (const item of opportunityItemsHot) {
      const days = item.daysToCd;
      if (
        days == null ||
        !Number.isFinite(days) ||
        days < -DESK_POST_CD_RETENTION_DAYS ||
        days > DESK_CALENDAR_HORIZON_DAYS
      ) {
        continue;
      }
      const tk = item.ticker.trim().toUpperCase();
      if (seenKeys.has(item.key) || seenTickers.has(tk)) continue;
      seenKeys.add(item.key);
      seenTickers.add(tk);
      out.push(item);
    }
    const pinned = new Set<string>();
    for (const tk of interestTickers) {
      const n = tk.trim().toUpperCase();
      if (n) pinned.add(n);
    }
    for (const tk of listAttentionStars()) pinned.add(tk);
    void starVersion;
    for (const tk of pinned) {
      if (seenTickers.has(tk)) continue;
      const forced =
        opportunityItemsAllScopes.find((i) => i.ticker.trim().toUpperCase() === tk) ??
        catalystItems.find((i) => i.ticker.trim().toUpperCase() === tk) ??
        buildForcedLossAnalysisItem(
          tk,
          simTable,
          inputs,
          pointsBySeriesKey,
          lang,
          history,
          lossProbOptions,
        );
      if (!forced) continue;
      seenKeys.add(forced.key);
      seenTickers.add(tk);
      out.push(forced);
    }
    return out;
  }, [portfolioItems, opportunityItemsHot, opportunityItemsAllScopes, catalystItems, interestTickers, starVersion, simTable, inputs, pointsBySeriesKey, lang, history, lossProbOptions]);

  /** Full CD-window list for deep-dive / Decision helpers (includes watch). */
  const items = unifiedTopKpiItems;

  const deepDiveItem = useMemo(() => {
    if (!deepDiveKey) return null;
    return (
      items.find((i) => i.key === deepDiveKey) ??
      opportunityItemsAllScopes.find((i) => i.key === deepDiveKey) ??
      portfolioItems.find((i) => i.key === deepDiveKey) ??
      catalystItems.find((i) => i.key === deepDiveKey) ??
      items.find((i) => i.ticker.toUpperCase() === deepDiveKey.split("|")[0]?.toUpperCase()) ??
      opportunityItemsAllScopes.find(
        (i) => i.ticker.toUpperCase() === deepDiveKey.split("|")[0]?.toUpperCase(),
      ) ??
      portfolioItems.find(
        (i) => i.ticker.toUpperCase() === deepDiveKey.split("|")[0]?.toUpperCase(),
      ) ??
      catalystItems.find(
        (i) => i.ticker.toUpperCase() === deepDiveKey.split("|")[0]?.toUpperCase(),
      ) ??
      buildForcedLossAnalysisItem(
        deepDiveKey,
        simTable,
        inputs,
        pointsBySeriesKey,
        lang,
        history,
        lossProbOptions,
      )
    );
  }, [
    deepDiveKey,
    items,
    opportunityItemsAllScopes,
    portfolioItems,
    catalystItems,
    simTable,
    inputs,
    pointsBySeriesKey,
    lang,
    history,
    lossProbOptions,
  ]);

  /**
   * Top KPI table removed — Deep Dive is company-only.
   * If a dive key is open, keep the shell (missing-item UI) — never bounce to Catalyst
   * just because the row is still resolving. Only bounce empty landings with no key.
   */
  useEffect(() => {
    if (!onBack) return;
    if (deepDiveKey) return;
    const awaitingFocus = Boolean(
      focusTicker?.trim() || focusRowKey?.trim(),
    );
    if (awaitingFocus) return;
    if (openDeepDive || preferTopKpi) {
      onBack();
    }
  }, [
    onBack,
    deepDiveKey,
    focusTicker,
    focusRowKey,
    openDeepDive,
    preferTopKpi,
  ]);

  useEffect(() => {
    if ((evalPane !== "dive" && evalPane !== "eis" && evalPane !== "financial") || !deepDiveKey) return;
    // Document scroll is on DeskPageScroll, not window (app-main is overflow:hidden).
    const page = document.querySelector(
      '.desk-page-scroll[data-page="deep-dive"]',
    ) as HTMLElement | null;
    if (page) page.scrollTo({ top: 0, behavior: "smooth" });
  }, [evalPane, deepDiveKey]);

  useEffect(() => {
    if (evalPane !== "dive" || !deepDiveKey || !deepDiveSection) return;
    const targetId = lossAnalysisChartSectionDomId(deepDiveKey, deepDiveSection);
    const timer = window.setTimeout(() => {
      scrollToDomIdWhenReady(targetId, {
        offset: 16,
        behavior: "smooth",
        maxAttempts: 24,
        intervalMs: 50,
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [evalPane, deepDiveKey, deepDiveSection]);

  const rowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable?.rows],
  );

  const sdsRowByTicker = useMemo(() => {
    const m = new Map<string, SdsRow>();
    for (const row of sdsRows ?? []) {
      m.set(row.ticker.trim().toUpperCase(), row);
    }
    return m;
  }, [sdsRows]);

  const migResultByKey = useMemo(
    () => buildMigResultByKey(simTable, chartBundle, sdsRows),
    [simTable, chartBundle, sdsRows],
  );

  const patternRecByKey = useMemo(() => {
    const map = new Map<string, CdPatternTickerRecommendation>();
    if (!simTable?.rows?.length) return map;
    const merged = reconcileInvestSimInputs(inputs, simTable.rows);
    const langCode = lang === "it" ? "it" : "en";
    for (const item of items) {
      const simRow = rowByKey.get(item.key);
      if (!simRow) continue;
      const chartPts = item.seriesKey ? pointsBySeriesKey.get(item.seriesKey) ?? null : null;
      const rec = buildCdPatternTickerRecommendation({
        row: simRow,
        chartPoints: chartPts,
        investInputs: merged,
        sdsRows,
        migByKey: migSolidityByKey,
        lang: langCode,
        includeEis: true,
        eisSuperScoreState: eisSuperScoreState,
      });
      if (rec) map.set(item.key, rec);
    }
    return map;
  }, [
    simTable,
    items,
    inputs,
    sdsRows,
    migSolidityByKey,
    rowByKey,
    pointsBySeriesKey,
    lang,
    eisSuperScoreState,
  ]);

  /** Top KPI table only — portfolio first, then ≤2 mo off-book catalysts. */
  const visibleKpiItems = useMemo(() => {
    let base = unifiedTopKpiItems;
    if (
      kpiFocusPinKey &&
      !base.some((i) => i.key === kpiFocusPinKey)
    ) {
      const pinned =
        portfolioItems.find((i) => i.key === kpiFocusPinKey) ??
        opportunityItemsAllScopes.find((i) => i.key === kpiFocusPinKey) ??
        catalystItems.find((i) => i.key === kpiFocusPinKey) ??
        buildForcedLossAnalysisItem(
          kpiFocusPinKey,
          simTable,
          inputs,
          pointsBySeriesKey,
          lang,
          history,
          lossProbOptions,
        );
      if (pinned) base = [pinned, ...base];
    }
    if (sortByActionSolidity) {
      base = sortLossItemsByActionSolidity(base, false);
    }
    return base;
  }, [
    unifiedTopKpiItems,
    sortByActionSolidity,
    kpiFocusPinKey,
    portfolioItems,
    opportunityItemsAllScopes,
    catalystItems,
    simTable,
    inputs,
    pointsBySeriesKey,
    lang,
    history,
    lossProbOptions,
  ]);

  /** Top KPI rows only — same tickers the table shows (not full hot+watch union). */
  const visibleKpiTickersKey = useMemo(
    () => normalizeCycleTickerKey(visibleKpiItems.map((i) => i.ticker)),
    [visibleKpiItems],
  );

  /** Stable intraday batch key (Top KPI tickers + XBI) — avoids cancel/restart loops. */
  const kpiIntradayTickersKey = useMemo(() => {
    const set = new Set(cycleTickersFromKey(visibleKpiTickersKey));
    set.add("XBI");
    return normalizeCycleTickerKey([...set]);
  }, [visibleKpiTickersKey]);

  const intradayFetchGenRef = useRef(0);

  // One Yahoo intraday batch for KPI cards + XBI overlay (avoids N× duplicate fetches).
  useEffect(() => {
    const tickers = cycleTickersFromKey(kpiIntradayTickersKey);
    if (!tickers.length) {
      setPriorSessionPctByTicker(new Map());
      setIntradayByTicker(new Map());
      setMarketIntradayPrior(undefined);
      setMarketIntradayLive(undefined);
      setIntradayBatchLoading(false);
      return;
    }
    const gen = ++intradayFetchGenRef.current;
    setIntradayBatchLoading(true);
    void (async () => {
      try {
        const payload = await fetchIntraday1h(tickers);
        if (intradayFetchGenRef.current !== gen) return;
        setPriorSessionPctByTicker((prev) => {
          const next = buildPriorSessionPctByTicker(payload);
          if (prev.size === next.size) {
            let same = true;
            for (const [k, v] of next) {
              if (prev.get(k) !== v) {
                same = false;
                break;
              }
            }
            if (same) return prev;
          }
          return next;
        });
        const byTicker = buildIntradaySeriesByTicker(payload);
        const xbi = byTicker.get("XBI");
        setMarketIntradayPrior(xbi?.prior);
        setMarketIntradayLive(xbi?.live);
        byTicker.delete("XBI");
        setIntradayByTicker((prev) => {
          let changed = prev.size !== byTicker.size;
          const out = new Map<
            string,
            { prior?: IntradayPricePoint[]; live?: IntradayPricePoint[] }
          >();
          for (const [k, v] of byTicker) {
            const old = prev.get(k);
            if (old && old.prior === v.prior && old.live === v.live) {
              out.set(k, old);
            } else {
              out.set(k, v);
              if (old !== v) changed = true;
            }
          }
          return changed ? out : prev;
        });
      } catch {
        if (intradayFetchGenRef.current !== gen) return;
        setPriorSessionPctByTicker(new Map());
        setIntradayByTicker(new Map());
        setMarketIntradayPrior(undefined);
        setMarketIntradayLive(undefined);
      } finally {
        if (intradayFetchGenRef.current === gen) setIntradayBatchLoading(false);
      }
    })();
  }, [kpiIntradayTickersKey]);

  const [cycleAlertsByKey, setCycleAlertsByKey] = useState<
    CatalystCycleAlertsResponse["alerts"] | null
  >(null);
  const cycleFetchGenRef = useRef(0);

  useEffect(() => {
    if (!visibleKpiTickersKey) {
      setCycleAlertsByKey(null);
      return;
    }
    const tickers = cycleTickersFromKey(visibleKpiTickersKey);
    const gen = ++cycleFetchGenRef.current;
    const cached = peekCatalystCycleAlertsCache(tickers);
    if (cached) {
      setCycleAlertsByKey(cached.alerts ?? {});
    }
    void (async () => {
      try {
        const resp = await fetchCatalystCycleAlerts(tickers);
        if (cycleFetchGenRef.current !== gen) return;
        setCycleAlertsByKey(resp.alerts ?? {});
      } catch {
        if (cycleFetchGenRef.current !== gen) return;
        setCycleAlertsByKey({});
      }
    })();
  }, [visibleKpiTickersKey]);

  // #region agent log
  useEffect(() => {
    dbgKpiLog("H3", "PortfolioLossAnalysisView:sortOrder", "visible kpi order", {
      sortByHighVol,
      sortByActionSolidity,
      count: visibleKpiItems.length,
      firstTickers: visibleKpiItems.slice(0, 6).map((i) => i.ticker),
    });
  }, [sortByHighVol, sortByActionSolidity, visibleKpiItems]);
  // #endregion

  /** Decision Chart + manual-news / focus: full scope, no watch KPI filter. */
  const visibleItems = useMemo(() => {
    let base = items;
    if (sortByActionSolidity) {
      base = sortLossItemsByActionSolidity(base, false);
    }
    return base;
  }, [items, sortByActionSolidity]);

  const kpiTickerKey = useMemo(
    () =>
      [...new Set(items.map((i) => i.ticker.trim().toUpperCase()).filter(Boolean))]
        .slice(0, 80)
        .join(","),
    [items],
  );

  useEffect(() => {
    if (!kpiTickerKey) {
      setVolumeAccelByTicker(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const vsPrev = await fetchVolumeVsPrevSession(kpiTickerKey.split(","));
        if (cancelled) return;
        const surge = Object.entries(vsPrev.rows ?? {})
          .filter(([, row]) => isVolumeSurge(row.pct_of_prev))
          .map(([tk]) => tk);
        maybeTriggerEisForHighVol(surge);
        if (!surge.length) {
          setVolumeAccelByTicker(new Map());
          return;
        }
        const accel = await fetchVolumeAcceleration(surge);
        if (cancelled) return;
        const map = new Map<
          string,
          {
            flagged: boolean;
            score: number | null;
            doublingMinutes: number | null;
            rvol: number | null;
          }
        >();
        for (const [tk, row] of Object.entries(accel.rows ?? {})) {
          map.set(tk, {
            flagged: Boolean(row.flagged),
            score: row.score ?? null,
            doublingMinutes: row.doubling_time_minutes ?? null,
            rvol: row.rvol ?? null,
          });
        }
        setVolumeAccelByTicker(map);
      } catch {
        if (!cancelled) setVolumeAccelByTicker(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kpiTickerKey]);

  useEffect(() => {
    const removed = purgeRecoveredManualFeedEvents(visibleItems);
    if (removed.length > 0) void reloadClinicalFeed();
  }, [visibleItems, reloadClinicalFeed]);

  const urgentSellG2Book = useMemo(() => {
    const open = items.filter((i) => i.hasPosition);
    const prior = priorSessionDayPnlByKey(
      history,
      open.map((i) => i.key),
    );
    const legs = open.map((i) =>
      attachContCutPriority(
        {
          key: i.key,
          ticker: i.ticker,
          dayPnlEur: Math.round(((i.pnlEur24h ?? 0) + (prior.get(i.key) ?? 0)) * 100) / 100,
          dayPnlPct: i.pnlPct24h ?? null,
          totalPnlPct: i.pnlPct ?? null,
          capitalEur: i.capital,
          pnlEur: i.pnlEur,
        },
        rowByKey.get(i.key) ?? null,
      ),
    );
    return evaluateUrgentSellGrade2Book(legs);
  }, [items, history, rowByKey]);

  const decisionChartRows = useMemo(() => {
    refreshGainStarLedger();
    return visibleItems.map((item) => {
      const simRow = rowByKey.get(item.key) ?? null;
      const patternRec = patternRecByKey.get(item.key) ?? null;
      const chartPts = item.seriesKey ? pointsBySeriesKey.get(item.seriesKey) ?? null : null;
      const sdsRow = sdsRowByTicker.get(item.ticker.trim().toUpperCase()) ?? null;
      const lossRisk =
        lookupLossRiskByRowKey(catalogByRowKey, item.key) ??
        lookupLossRisk(lossRiskCatalog, item.ticker);
      const regSigned = resolveRegSignedScoreForTicker(item.ticker, simRow, autoRegSnap);
      // Gen 4 Soft Soft parity with Home — peak giveback + post-sell cooldown.
      const enhance = buildOperationalEnhanceForItem(item, {
        simRow,
        chartPts,
        urgentKeys: urgentSellG2Book.urgentKeys,
        lossRiskCatalog,
        catalogByRowKey,
        autoRegSnap,
        priorSessionPctByTicker,
        volumeAccelByTicker,
        inputs,
        history,
      });
      const suggestedAction = deriveSuggestedAction(item, false, null, null, enhance);
      return buildDecisionChartRow({
        item,
        patternRec,
        sdsRow,
        lossRisk,
        regSignedScore: regSigned,
        mcsDoc,
        chartPts,
        simRow,
        lang: lang === "it" ? "it" : "en",
        eisSuperScoreState,
        suggestedAction,
        clinicalPreCdRecords: clinicalRecords,
        urgentSellG2: urgentSellG2Book.urgentKeys.has(item.key),
      });
    });
  }, [
    visibleItems,
    rowByKey,
    patternRecByKey,
    pointsBySeriesKey,
    sdsRowByTicker,
    catalogByRowKey,
    lossRiskCatalog,
    autoRegSnap,
    mcsDoc,
    lang,
    eisSuperScoreState,
    clinicalRecords,
    urgentSellG2Book,
    priorSessionPctByTicker,
    volumeAccelByTicker,
    inputs,
    history,
  ]);

  const decisionRecSummary = useMemo(
    () => summarizeDecisionRecs(decisionChartRows),
    [decisionChartRows],
  );

  const decisionChartByKey = useMemo(() => {
    const m = new Map<string, DecisionChartTickerRow>();
    for (const row of decisionChartRows) m.set(row.key, row);
    return m;
  }, [decisionChartRows]);

  useEffect(() => {
    recordDecisionRecSnapshots(decisionChartRows);
  }, [decisionChartRows]);

  /** Keep mobile decision chart in sync with Evaluation Lab (same buildMobileDecisionChartViews pipeline). */
  useEffect(() => {
    if (embedded || !simTable?.rows?.length) return;
    const timer = window.setTimeout(() => {
      const migByKey = buildMigSolidityByKey(simTable, chartBundle, sdsRows ?? null);
      const probOptions: LossAnalysisProbOptions = {
        sdsRows: sdsRows ?? null,
        migSolidityByKey: migByKey,
        eisSuperScoreState,
        clinicalPreCdRecords: clinicalRecords,
        polygonOverview: polygonOverview ?? null,
        mergedInputs: inputs,
      };
      const views = buildMobileDecisionChartViews({
        simTable,
        inputs,
        history: history ?? [],
        chartBundle,
        probOptions,
        lang: lang === "it" ? "it" : "en",
        autoRegSnap,
        mcsDoc,
        lossRiskCatalog,
        catalogByRowKey,
      });
      const patch = {
        decisionChartViews: views,
        decisionChartRows: unionDecisionChartRows(views),
        decisionChartScope: cdHorizonToMobileDecisionView(oppCdScope),
      };
      mobileChartPatchRef.current = patch;
      setMobileChartReady(true);
      scheduleMobileDecisionChartPublish(patch);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    embedded,
    simTable,
    inputs,
    history,
    chartBundle,
    sdsRows,
    eisSuperScoreState,
    clinicalRecords,
    polygonOverview,
    lang,
    autoRegSnap,
    mcsDoc,
    lossRiskCatalog,
    catalogByRowKey,
    oppCdScope,
  ]);

  const handleMobileDecisionSync = useCallback(async () => {
    const patch = mobileChartPatchRef.current;
    if (!patch) return;
    setMobileSyncBusy(true);
    setMobileSyncNote(null);
    setMobileSyncOk(null);
    const res = await pushMobileDecisionChartNow(patch);
    setMobileSyncBusy(false);
    if (res.ok) {
      setMobileSyncOk(true);
      setMobileSyncNote(t("sim.lossAnalysis.decisionChart.mobileSyncOk"));
    } else if (res.error === "MISSING_API_TOKEN") {
      setMobileSyncOk(false);
      setMobileSyncNote(t("sim.lossAnalysis.decisionChart.mobileSyncNoToken"));
    } else {
      setMobileSyncOk(false);
      setMobileSyncNote(
        t("sim.lossAnalysis.decisionChart.mobileSyncFail", {
          detail: res.error.slice(0, 120),
        }),
      );
    }
  }, [t]);

  useEffect(() => {
    if (embedded) return;
    const onAutoSyncFail = (ev: Event) => {
      const res = (ev as CustomEvent<MobileDecisionChartPushResult>).detail;
      if (!res || res.ok) return;
      if (res.error === "MISSING_API_TOKEN") {
        setMobileSyncOk(false);
        setMobileSyncNote(t("sim.lossAnalysis.decisionChart.mobileSyncNoToken"));
        return;
      }
      setMobileSyncOk(false);
      setMobileSyncNote(
        t("sim.lossAnalysis.decisionChart.mobileSyncFail", {
          detail: res.error.slice(0, 120),
        }),
      );
    };
    window.addEventListener(MOBILE_DECISION_SYNC_FAILED_EVENT, onAutoSyncFail);
    return () => window.removeEventListener(MOBILE_DECISION_SYNC_FAILED_EVENT, onAutoSyncFail);
  }, [embedded, t]);

  /** Top KPI table when Buy/Sell sort is on — same REC the column shows (Soft BUY included). */
  const kpiTableItems = useMemo(() => {
    if (!sortByActionSolidity) return visibleKpiItems;
    return sortLossItemsByDisplayedRec(
      visibleKpiItems,
      (item) => decisionChartByKey.get(item.key)?.rec,
    );
  }, [sortByActionSolidity, visibleKpiItems, decisionChartByKey]);

  useEffect(() => {
    const rowKey = focusRowKey?.trim();
    const tk = focusTicker?.trim().toUpperCase();
    if (!rowKey && !tk) {
      alignedFocusTagRef.current = null;
      return;
    }
    const focusTag = `${rowKey ?? ""}|${tk ?? ""}|${focusNonce ?? 0}`;
    // Align once per deep-link. Re-running on every `profile` change made
    // the Portfolio chip appear broken (click → opportunities snapped back).
    if (alignedFocusTagRef.current === focusTag) return;
    alignedFocusTagRef.current = focusTag;

    const land = resolveTopKpiLandTarget(
      rowKey,
      tk,
      portfolioItems,
      opportunityItemsAllScopes,
      catalystItems,
    );
    const next: LossAnalysisProfile = land?.profile ?? "opportunities";
    setEvalLabProfile(next);
  }, [
    focusRowKey,
    focusTicker,
    focusNonce,
    portfolioItems,
    opportunityItemsAllScopes,
    catalystItems,
  ]);

  useEffect(() => {
    const rowKey = focusRowKey?.trim();
    const tk = focusTicker?.trim().toUpperCase();
    if (!rowKey && !tk) {
      scrolledFocusTagRef.current = null;
      return;
    }
    const focusTag = `${rowKey ?? ""}|${tk ?? ""}|${focusNonce ?? 0}`;
    const land = resolveTopKpiLandTarget(
      rowKey,
      tk,
      portfolioItems,
      opportunityItemsAllScopes,
      catalystItems,
    );
    const hit =
      land?.item ??
      (rowKey ? visibleItems.find((i) => i.key === rowKey) : undefined) ??
      (tk ? visibleItems.find((i) => i.ticker.toUpperCase() === tk) : undefined);

    /** Top KPI table removed — catalyst deep-links always open the company dive. */
    const landOnCompanyDive = (key: string) => {
      scrollToItem(key, undefined, { eis: openEis });
    };

    if (!hit) {
      if (openDeepDive || preferTopKpi || tk) {
        const simRow = tk
          ? (simTable?.rows ?? []).find(
              (r) => String(r["Ticker"] ?? "").trim().toUpperCase() === tk,
            )
          : undefined;
        const diveKey =
          rowKey ||
          (tk && simRow
            ? normalizedRowKey(tk, String(simRow["Completion Date"] ?? ""))
            : null) ||
          tk ||
          null;
        if (!diveKey) return;
        if (scrolledFocusTagRef.current === focusTag) return;
        scrolledFocusTagRef.current = focusTag;
        if (openEis && tk) {
          const rowRec = (simRow as Record<string, unknown> | undefined) ?? null;
          const focus = getEisDeepDiveFocus();
          if (!focus || focus.ticker !== tk) {
            setEisDeepDiveFocus({
              ticker: tk,
              clinicalKpi: clinicalKpiFromSimRow(rowRec),
              simRow: rowRec,
            });
          }
        }
        landOnCompanyDive(diveKey);
        return;
      }
      return;
    }

    // Direct ticker → company Deep Dive — skip profile / CD-horizon gates.
    if (scrolledFocusTagRef.current === focusTag) return;
    scrolledFocusTagRef.current = focusTag;
    if (openEis) {
      const rowRec = rowByKey.get(hit.key) ?? null;
      const focus = getEisDeepDiveFocus();
      if (!focus || focus.ticker !== hit.ticker.trim().toUpperCase()) {
        setEisDeepDiveFocus({
          ticker: hit.ticker,
          clinicalKpi: clinicalKpiFromSimRow(rowRec),
          simRow: rowRec,
        });
      }
    }
    landOnCompanyDive(hit.key);
  }, [
    focusRowKey,
    focusTicker,
    focusNonce,
    preferTopKpi,
    openDeepDive,
    openEis,
    scrollToItem,
    onFocusTickerConsumed,
    visibleItems,
    visibleKpiItems,
    portfolioItems,
    opportunityItemsAllScopes,
    catalystItems,
    simTable,
    rowByKey,
  ]);

  const summary = useMemo(() => summarizeLossAnalysis(visibleItems), [visibleItems]);

  // Formerly used by the panel-summary-strip (removed on user request to
  // lighten the Decision Chart tab). Kept as references for future
  // re-introduction; noUnusedLocals satisfied via void below.
  const totalAccent = portfolioPnlAccentClass(summary.totalPnlEur, null);
  const total24hAccent = portfolioPnlAccentClass(summary.totalPnlEur24h, null);
  const totalGapAccent = slopeCapitalLossTone(summary.totalModelGapLossEur);

  // Removed UI bits (panel-summary-strip, mobile-sync button) still
  // referenced by dead code paths above. Silences TypeScript
  // noUnusedLocals without physically deleting the state machinery, so
  // a future re-introduction only requires re-mounting the JSX.
  void totalAccent;
  void total24hAccent;
  void totalGapAccent;
  void decisionRecSummary;
  void handleMobileDecisionSync;
  void mobileChartReady;
  void mobileSyncBusy;
  void mobileSyncNote;
  void mobileSyncOk;
  void fmtPortfolioPnlUsd;
  void hasStoredApiToken;
  void resolveMobileSyncApiBase;
  // Top KPI table UI removed — keep sort/search machinery compilable.
  void setSortByHighVol;
  void setSortByActionSolidity;
  void summaryTableCollapsed;
  void highlightedKey;
  void kpiScrollToKeyRef;
  void clearKpiLandTimers;
  void toggleSummaryTableCollapsed;
  void guidanceKpiByTicker;
  void kpiTableItems;

  /** cards/full: content grows — DeskPageScroll (Deep Dive) owns the scrollport. */
  const pageDocumentScroll = mode === "cards" || mode === "full";

  return (
    <section
      className={`sim-harmonize w-full min-w-0 ${
        pageDocumentScroll
          ? "flex flex-col shrink-0"
          : "flex flex-col flex-1 min-h-0 overflow-hidden h-full"
      } ${embedded || mode === "cards" || pageDocumentScroll ? "" : "card"}`}
    >
      {/* Parent page: only deep-dive tabs when a company is open (no duplicate Top KPI chrome). */}
      {!(embedded && pageDocumentScroll && !deepDiveKey) ? (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[rgb(var(--border))]/40 bg-transparent px-0.5 py-1.5 shrink-0">
        {!embedded && onBack ? (
          <button type="button" className="btn-ghost text-xs" onClick={onBack}>
            {t("sim.lossAnalysis.back")}
          </button>
        ) : null}
        {!(embedded && pageDocumentScroll) && evalPane !== "eis" && evalPane !== "financial" ? (
        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
          <h2
            className={`font-semibold text-ink inline-flex items-center gap-2 ${embedded ? "text-[15px]" : "text-base"}`}
            title={
              lang === "it"
                ? `Portafoglio + catalyst entro ${DESK_CALENDAR_HORIZON_DAYS} giorni`
                : `Portfolio + catalysts within ${DESK_CALENDAR_HORIZON_DAYS} days`
            }
          >
            {pageDocumentScroll
              ? t("sim.lossAnalysis.pane.diveTip")
              : embedded
                ? t("catalystHub.tab.portfolioStatus")
                : t("sim.lossAnalysis.title")}
          </h2>
        </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        {mode !== "hub" && deepDiveKey ? (
          <div className="flex gap-0.5 p-0.5 rounded-md seg-toggle-track shrink-0">
              <span
                className={`inline-flex items-center gap-0.5 ${
                  evalPane === "dive" ? "seg-btn-active" : "seg-btn"
                } !pr-0.5`}
              >
                <AttentionStarToggle
                  ticker={
                    deepDiveItem?.ticker ?? deepDiveKey.split("|")[0] ?? ""
                  }
                  it={lang === "it"}
                  sizeClass="text-[12px]"
                />
                <button
                  type="button"
                  className="inline-flex items-center gap-1 bg-transparent px-1.5 py-0 font-bold tabular-nums"
                  title={
                    deepDiveItem
                      ? `${deepDiveItem.ticker}${deepDiveItem.company ? ` · ${deepDiveItem.company}` : ""}`
                      : t("sim.lossAnalysis.pane.diveTip")
                  }
                  onClick={() => setEvalPane("dive")}
                >
                  {deepDiveItem?.ticker ?? deepDiveKey.split("|")[0]}
                </button>
                <button
                  type="button"
                  className="mr-0.5 inline-flex h-4 w-4 items-center justify-center rounded text-[11px] leading-none text-ink-muted hover:bg-ink/10 hover:text-ink"
                  aria-label={t("sim.lossAnalysis.pane.close")}
                  title={t("sim.lossAnalysis.pane.close")}
                  onClick={closeDeepDive}
                >
                  ×
                </button>
              </span>
              <button
                  type="button"
                  className={evalPane === "eis" ? "seg-btn-active" : "seg-btn"}
                  title={t("sim.lossAnalysis.pane.eisTip")}
                  onClick={() => {
                    const tk = (
                      deepDiveItem?.ticker ??
                      deepDiveKey.split("|")[0] ??
                      ""
                    )
                      .trim()
                      .toUpperCase();
                    if (tk) {
                      const rowRec =
                        (deepDiveItem ? rowByKey.get(deepDiveItem.key) : null) ??
                        null;
                      const focus = getEisDeepDiveFocus();
                      if (!focus || focus.ticker !== tk) {
                        setEisDeepDiveFocus({
                          ticker: tk,
                          clinicalKpi: clinicalKpiFromSimRow(rowRec),
                          simRow: rowRec,
                        });
                      }
                    }
                    setEvalPane("eis");
                  }}
                >
                  {t("sim.lossAnalysis.pane.eis")}
                </button>
              <button
                  type="button"
                  className={evalPane === "financial" ? "seg-btn-active" : "seg-btn"}
                  title={t("sim.lossAnalysis.pane.financialTip")}
                  onClick={() => setEvalPane("financial")}
                >
                  {t("sim.lossAnalysis.pane.financial")}
                </button>
          </div>
        ) : null}
      </div>
      ) : null}

      <div
        className={
          pageDocumentScroll
            ? "deep-dive-body min-w-0 w-full shrink-0 pt-2 pb-1 space-y-2 overflow-visible"
            : "panel-stack-scroll flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 pt-2 pb-3 space-y-2"
        }
      >
        {mode !== "hub" && evalPane === "eis" ? (
          <EisDeepDiveView
            simTable={simTable}
            it={lang === "it"}
            embedded
            onBack={() => setEvalPane("dive")}
            backLabel={
              deepDiveItem?.ticker ??
              deepDiveKey?.split("|")[0] ??
              t("sim.lossAnalysis.pane.diveTip")
            }
          />
        ) : null}
        {/* Keep Financial mounted while Deep Dive is open so US revenue + 8-K
            Gemini/EDGAR work starts with the card, not only when the tab opens. */}
        {mode !== "hub" &&
        (deepDiveItem?.ticker || deepDiveKey?.split("|")[0]) ? (
          <div
            className={evalPane === "financial" ? "block" : "hidden"}
            aria-hidden={evalPane !== "financial"}
          >
            <TickerFinancial8kPanel
              ticker={
                deepDiveItem?.ticker ??
                deepDiveKey?.split("|")[0] ??
                ""
              }
              company={deepDiveItem?.company ?? null}
              it={lang === "it"}
            />
          </div>
        ) : null}
        {mode !== "hub" && evalPane === "dive" ? (
          deepDiveItem ? (
            <LossAnalysisCard
              item={deepDiveItem}
              profile={profile}
              cardDomId={lossAnalysisCardDomId(deepDiveItem.key)}
              simRow={
                rowByKey.get(deepDiveItem.key) ??
                (simTable?.rows ?? []).find(
                  (r) =>
                    String(r["Ticker"] ?? "").trim().toUpperCase() ===
                    deepDiveItem.ticker.trim().toUpperCase(),
                ) ??
                null
              }
              chartPts={
                deepDiveItem.seriesKey
                  ? pointsBySeriesKey.get(deepDiveItem.seriesKey) ?? null
                  : null
              }
              sdsRow={sdsRowByTicker.get(deepDiveItem.ticker.trim().toUpperCase()) ?? null}
              migSnap={
                migSolidityByKey.get(
                  migSolidityKey(deepDiveItem.ticker, deepDiveItem.completionDate),
                ) ?? null
              }
              migRow={
                migResultByKey.get(
                  migSolidityKey(deepDiveItem.ticker, deepDiveItem.completionDate),
                ) ?? null
              }
              patternRec={patternRecByKey.get(deepDiveItem.key) ?? null}
              eisSuperScoreState={eisSuperScoreState}
              clinicalRecords={clinicalRecords}
              autoRegSnap={autoRegSnap}
              mcsDoc={mcsDoc}
              decisionRec={decisionChartByKey.get(deepDiveItem.key)?.rec ?? null}
              onSell={onSell}
              onRegisterBuy={
                profile === "opportunities" ? onRegisterBuy : undefined
              }
              onOpenSlopeCharts={embedded ? undefined : onOpenSlopeCharts}
              onOpenPredictionCharts={onOpenPredictionCharts}
              onOpenDecisionLab={onOpenDecisionLab}
              onOpenEisDetail={openEisDetail}
              tickerSimRows={simRowsForTicker(simTable?.rows, deepDiveItem.ticker)}
              highlighted
              intradayPrior={
                intradayByTicker.get(deepDiveItem.ticker.trim().toUpperCase())?.prior
              }
              intradayLive={
                intradayByTicker.get(deepDiveItem.ticker.trim().toUpperCase())?.live
              }
              marketIntradayPrior={marketIntradayPrior}
              marketIntradayLive={marketIntradayLive}
              intradayBatchLoading={intradayBatchLoading}
              cycleAlertsByKey={cycleAlertsByKey}
            />
          ) : (
            <DeepDiveSplash
              onBack={onBack}
              backLabel={t("sim.lossAnalysis.pane.close")}
            />
          )
        ) : null}
      </div>

      <LossRiskBreakdownModal
        entry={riskModalEntry}
        onClose={() => setRiskModalEntry(null)}
        it={lang === "it"}
      />

    </section>
  );
}
