import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ChartBundle, SheetTable } from "../types";
import type { AppScreen } from "../types";
import { chartPointsMapFromBundle, simulationRowSeriesKey } from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import { useDecisionSimPairPrechartHeight } from "../hooks/useDecisionSimPairPrechartHeight";
import { useLang } from "../shared/i18n";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import type { SdsRow } from "../api/supernova";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import {
  buildMissedOpportunityAudit,
  loadMissedOppHistory,
  saveMissedOppSnapshot,
  type MissedOppDailySnapshot,
} from "../sheet/missedOpportunityAudit";
import { buildPortfolioDailyPnlLedger } from "../sheet/simulationPosition";
import { buildCumulativePortfolioMaturationSeries } from "../sheet/portfolioScenarioGain";
import { buildDecisionSimEvaluations } from "../sheet/investDecisionSimLoop";
import {
  DECISION_SIM_CHANGED_EVENT,
  loadDecisionSimState,
  type DecisionSimState,
} from "../sheet/investDecisionSimStorage";
import { useLiveExperimentPiggy } from "../hooks/useLiveExperimentPiggy";
import { buildSuggestionMonitorRows } from "../sheet/suggestionMonitor";
import { resolveSimLoopCapitalPot } from "../sheet/investDecisionSimCharts";
import { buildSimLoopSynthMaturationSeries } from "../sheet/simLoopSynthMaturation";
import { useSimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";
import { DashboardAiFeedCard, type DashboardAiFeedItem } from "./DashboardAiFeedCard";
import { DashboardPanelUpdatedLabel } from "./DashboardPanelUpdatedLabel";
import { DecisionSimAdviceCalibrationPanel } from "./DecisionSimAdviceCalibrationPanel";
import { DashboardDaily24hPnlChart } from "./DashboardDaily24hPnlChart";
import { DecisionSimMaturationChart } from "./DecisionSimMaturationChart";
import { latestDashboardPanelIso } from "../sheet/dashboardPanelDailyRefresh";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import { dailyChangePctFromRow } from "../sheet/simulationPosition";
import {
  buildAdviceCalibrationFromLiveRows,
  buildAdviceCalibrationFromLog,
  buildAdviceCalibrationFromPaperSells,
  buildDealLevelCalibrationPoints,
  countPaperSellExecutions,
  summarizePaperSellOperativeCoverage,
  adviceMonitorPointsExcludingPaperSells,
  keysWithPaperSellExecution,
  liveCalibRowsExcludingPaperSells,
  mergeAdviceCalibrationPoints,
  summarizeAdviceCalibration,
} from "../sheet/investDecisionSimAdviceCalibration";
import { computeSynthGainImpact } from "../sheet/threePortfolioCompare";
import { summarizePaperClosedDeals } from "../sheet/paperSimMaturation";
import { summarizeClosedPnlAdvice } from "../sheet/adviceComplementKpis";
import {
  countInflatedTickCalibrationEvents,
  countPendingAdvicePoints,
  countUnverifiedSellEvitaFromMonitor,
  filterPaperExecutedCalibrationPoints,
  summarizeDecisionPrecision,
  summarizeWeightedGrowthFromImpact,
} from "../sheet/accuracySummary";
import { buildUnifiedAdviceSuccess } from "../sheet/unifiedAdviceSuccess";
import {
  closedSimOutcomeRowsFromDoc,
  loadInvestmentSimOutcomes,
  type SimOutcomesDoc,
} from "../data/investmentSimOutcomesData";
import { buildRealPortfolioAccuracySummary } from "../sheet/realPortfolioAccuracy";
import type {
  PortfolioSellEnrichContext,
  RealPortfolioAccuracySummary,
} from "../sheet/realPortfolioAccuracy";
import { buildIntrinsicRecommendationSummary } from "../sheet/intrinsicRecommendationEfficiency";
import type { IntrinsicRecommendationSummary } from "../sheet/intrinsicRecommendationEfficiency";
import {
  attachDaysToCdOnAdvicePoints,
  buildAuditPeakItemsFromClosedRows,
  enrichIntrinsicWithPeakCd,
  readDaysToCdFromSimRow,
} from "../sheet/accuracyPeakCdOffset";
import { loadSignCurveDailyDoc } from "../data/signCurveDailyData";
import {
  buildModelIntrinsicForecastSummary,
  buildSignAccuracyCurveView,
  type SignAccuracyCurveView,
} from "../sheet/signAccuracyCurve";
import { aggregateOpenPortfolioPnl } from "../sheet/simulationPosition";
import { realizedPnlEurFromOutcome } from "../sheet/outcomePnlDisplay";
import type { OperativeColumnProps, OperativeGainSummary } from "./AccuracySummaryPanel";
import { AccuracySummaryPanel } from "./AccuracySummaryPanel";
import { fetchAccuracyMonitorHistory } from "../api/supernova";
import { buildModelQualityWeeklyTrends } from "../sheet/modelQualityWeeklyTrends";
import { loadSdsPredictionCalibrationSnapshots } from "../sheet/sdsPredictionCalibrationHistory";

const DASHBOARD_SIM_CHART_CLASS = "card dashboard-middle-panel min-h-0 h-full flex flex-col";

function ChartCard({
  title,
  sub,
  updatedAt,
  children,
}: {
  title: string;
  sub?: string;
  updatedAt?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="invest-trend-chart-panel rounded-xl border flex flex-col min-w-0 w-full">
      <div className="px-4 py-2 border-b border-[rgb(var(--border))]/60 shrink-0">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {sub ? <p className="text-[11px] text-ink-muted leading-snug mt-0.5">{sub}</p> : null}
        <DashboardPanelUpdatedLabel updatedAt={updatedAt} />
      </div>
      <div className="px-3 py-2 flex-1 min-h-0">{children}</div>
    </div>
  );
}

export function DashboardChartsRow({
  simTable,
  chartBundle,
  sdsRows,
  aiFeed,
  dataUpdatedAt,
  onNavigate,
}: {
  simTable: SheetTable | null;
  chartBundle: ChartBundle | null;
  sdsRows: SdsRow[] | null;
  dataUpdatedAt?: string | null;
  onNavigate?: (screen: AppScreen) => void;
  aiFeed?: {
    feed: DashboardAiFeedItem[];
    recentCount: number;
    loading: boolean;
    loadError: string | null;
    updatedAt?: string | null;
    scopeLabel: string;
    onOpenFeed: () => void;
  };
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const inputs = useInvestSimInputs(simTable);
  const portfolioHistory = useInvestSimPortfolioHistory().history;
  const polygonOverview = useCdPatternPolygonOverview();
  const [eisState, setEisState] = useState<Awaited<ReturnType<typeof loadEisSuperScoreState>> | null>(
    null,
  );
  // Daily snapshots still persisted for downstream analytics (Model Lab missed-
  // opportunity panel) even though the dashboard no longer renders the
  // "Daily 24h P&L" card on this row.
  const [missedHistory, setMissedHistory] = useState<MissedOppDailySnapshot[]>(() =>
    loadMissedOppHistory(),
  );
  const [decisionSimState, setDecisionSimState] = useState<DecisionSimState>(() =>
    loadDecisionSimState(),
  );
  const [outcomesDoc, setOutcomesDoc] = useState<SimOutcomesDoc | null>(null);
  const [signCurveView, setSignCurveView] = useState<SignAccuracyCurveView | null>(null);
  const [monitorDoc, setMonitorDoc] = useState<{ entries?: unknown[] } | null>(null);

  useEffect(() => {
    void loadEisSuperScoreState().then(setEisState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadSignCurveDailyDoc().then(({ doc }) => {
      if (cancelled) return;
      setSignCurveView(buildSignAccuracyCurveView(null, doc));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadInvestmentSimOutcomes().then(({ doc }) => {
      if (cancelled) return;
      setOutcomesDoc(doc ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAccuracyMonitorHistory()
      .then((doc) => {
        if (!cancelled) setMonitorDoc(doc);
      })
      .catch(() => {
        if (!cancelled) setMonitorDoc(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const weeklyTrends = useMemo(
    () => buildModelQualityWeeklyTrends(monitorDoc, loadSdsPredictionCalibrationSnapshots()),
    [monitorDoc],
  );

  useEffect(() => {
    const onChange = () => setDecisionSimState(loadDecisionSimState());
    window.addEventListener(DECISION_SIM_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DECISION_SIM_CHANGED_EVENT, onChange);
  }, []);

  const pointsBySeriesKey = useMemo(
    () => chartPointsMapFromBundle(chartBundle),
    [chartBundle],
  );

  const probOptions = useMemo((): LossAnalysisProbOptions | null => {
    if (!simTable?.rows?.length) return null;
    return {
      sdsRows,
      migSolidityByKey: buildMigSolidityByKey(simTable, chartBundle, sdsRows),
      eisSuperScoreState: eisState,
      polygonOverview,
      lightweightPolygon: true,
      mergedInputs: inputs,
    };
  }, [simTable, chartBundle, sdsRows, eisState, polygonOverview, inputs]);

  const missedSummary = useMemo(() => {
    if (!simTable?.rows?.length) return null;
    return buildMissedOpportunityAudit({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang: it ? "it" : "en",
      probOptions,
    });
  }, [simTable, inputs, pointsBySeriesKey, it, probOptions]);

  const pnlActualEur = useMemo(() => {
    if (!simTable?.rows?.length) return null;
    const ledger = buildPortfolioDailyPnlLedger(simTable, inputs, portfolioHistory);
    const todayKey = new Date().toISOString().slice(0, 10);
    const open = ledger.openDayTotals[todayKey];
    if (open != null && Number.isFinite(open)) return open;
    const all = ledger.dayTotals[todayKey];
    return all != null && Number.isFinite(all) ? all : null;
  }, [simTable, inputs, portfolioHistory]);

  const actualPortfolioSeries = useMemo(() => {
    if (!simTable?.rows?.length) return { closed: [], open: [] };
    const ledger = buildPortfolioDailyPnlLedger(simTable, inputs, portfolioHistory);
    return buildCumulativePortfolioMaturationSeries(ledger);
  }, [simTable, inputs, portfolioHistory]);

  const portfolioLedger = useMemo(() => {
    if (!simTable?.rows?.length) return null;
    return buildPortfolioDailyPnlLedger(simTable, inputs, portfolioHistory);
  }, [simTable, inputs, portfolioHistory]);

  useEffect(() => {
    if (!missedSummary || missedSummary.with24hN === 0) return;
    setMissedHistory(saveMissedOppSnapshot(missedSummary, pnlActualEur));
  }, [missedSummary, pnlActualEur]);

  const liveEvaluations = useMemo(() => {
    if (!simTable?.rows?.length) return [];
    return buildDecisionSimEvaluations({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang: it ? "it" : "en",
      probOptions,
      paperPortfolio: decisionSimState.paperPortfolio,
    });
  }, [simTable, inputs, pointsBySeriesKey, it, probOptions, decisionSimState.paperPortfolio]);

  const monitorRows = useMemo(() => {
    if (!simTable?.rows?.length) return [];
    return buildSuggestionMonitorRows({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang: it ? "it" : "en",
      probOptions,
      paperPortfolio: decisionSimState.paperPortfolio,
    });
  }, [simTable, inputs, pointsBySeriesKey, it, probOptions, decisionSimState.paperPortfolio]);

  const { piggy: livePiggy } = useLiveExperimentPiggy(
    decisionSimState.paperPortfolio,
    liveEvaluations,
    decisionSimState.cumulativePaperPnlEur,
    decisionSimState.closedTradeCount,
  );

  const decisionSimUpdatedAt = useMemo(() => {
    const lastTick = decisionSimState.ticks[decisionSimState.ticks.length - 1];
    return latestDashboardPanelIso(lastTick?.at ?? null, dataUpdatedAt);
  }, [decisionSimState.ticks, dataUpdatedAt]);

  const simLoopCapitalPot = useMemo(
    () =>
      resolveSimLoopCapitalPot(
        decisionSimState.config.capitalPerTrade,
        decisionSimState.config.maxOpenPositions,
      ),
    [decisionSimState.config.capitalPerTrade, decisionSimState.config.maxOpenPositions],
  );

  const synthAlloc = useSimLoopSynthAllocation({
    simTable,
    sdsRows,
    investInputs: inputs,
    pointsBySeriesKey,
    totalCapitalEur: simLoopCapitalPot,
    enabled: Boolean(simTable?.rows?.length),
  });

  const simLoopSynthMaturation = useMemo(() => {
    if (!synthAlloc) return null;
    return buildSimLoopSynthMaturationSeries(decisionSimState.ticks, {
      totalCapitalEur: synthAlloc.totalCapitalEur,
      capitalPerTrade: decisionSimState.config.capitalPerTrade,
      targetGainEur: synthAlloc.targetGainEur,
      sizingMode: "causal_rebalance",
      live: {
        paperPortfolio: decisionSimState.paperPortfolio,
        evaluations: liveEvaluations,
        piggyBank: livePiggy,
      },
    });
  }, [
    synthAlloc,
    decisionSimState.ticks,
    decisionSimState.paperPortfolio,
    decisionSimState.config.capitalPerTrade,
    liveEvaluations,
    livePiggy,
  ]);

  const showDecisionSimChartPair = Boolean(simTable?.rows?.length);
  const { preChartRef } = useDecisionSimPairPrechartHeight(showDecisionSimChartPair);

  const simRowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable?.rows],
  );

  const outcomeDocRows = outcomesDoc?.rows ?? [];
  const closedOutcomeRows = useMemo(
    () => (outcomesDoc ? closedSimOutcomeRowsFromDoc(outcomesDoc) : []),
    [outcomesDoc],
  );

  const portfolioSellEnrich = useMemo((): PortfolioSellEnrichContext | undefined => {
    if (!simTable?.rows?.length) return undefined;
    return {
      simRowByKey,
      pointsBySeriesKey,
      seriesKeyForSimRow: (row) => simulationRowSeriesKey(row) ?? null,
    };
  }, [simTable?.rows?.length, simRowByKey, pointsBySeriesKey]);

  const realPortfolioAccuracy = useMemo(
    (): RealPortfolioAccuracySummary =>
      buildRealPortfolioAccuracySummary(
        outcomeDocRows,
        closedOutcomeRows,
        portfolioSellEnrich,
      ),
    [outcomeDocRows, closedOutcomeRows, portfolioSellEnrich],
  );

  const modelIntrinsic = useMemo(
    () => buildModelIntrinsicForecastSummary(signCurveView),
    [signCurveView],
  );

  const accuracySummary = useMemo(() => {
    if (!simTable?.rows?.length) {
      return {
        decision: null,
        growth: null,
        unifiedAdvice: { headlinePct: null, primarySource: "none" as const },
        closedPaperWinRatePct: null,
        paperPointCount: 0,
        livePointCount: 0,
        tickEventExcludedCount: 0,
      };
    }

    const entryProbByKey = new Map(
      decisionSimState.paperPortfolio
        .filter((p) => p.entryProbPct != null && Number.isFinite(p.entryProbPct))
        .map((p) => [p.key, p.entryProbPct!]),
    );

    const lang = it ? "it" : "en";
    const resolveDaysToCd = (key: string): number | null =>
      readDaysToCdFromSimRow(simRowByKey.get(key));

    const liveCalibRows = monitorRows.map((row) => {
      const simRow = simRowByKey.get(row.key);
      const dailyVar = simRow ? dailyChangePctFromRow(simRow) : null;
      const pnlPct24h =
        row.pnlPct24h != null && Number.isFinite(row.pnlPct24h)
          ? row.pnlPct24h
          : dailyVar;
      return {
        key: row.key,
        ticker: row.ticker,
        suggestedAction: row.suggestedAction,
        inPaperPortfolio: row.inPaperPortfolio,
        hasPosition: row.hasPosition,
        exitDecision: row.exitDecision,
        probPct: row.probPct,
        probPctAtAdvice: row.inPaperPortfolio
          ? (entryProbByKey.get(row.key) ?? row.probPct)
          : row.probPct,
        planReturnPct: row.planReturnPct,
        miiAngleDeg: row.miiAngleDeg,
        pnlPct: row.pnlPct,
        pnlPct24h,
        daysToCdAtAdvice: resolveDaysToCd(row.key),
      };
    });

    const resolvePostMove24h = (key: string): number | null => {
      const ev = liveEvaluations.find((e) => e.key === key);
      if (ev?.pnlPct24h != null && Number.isFinite(ev.pnlPct24h)) return ev.pnlPct24h;
      const row = simRowByKey.get(key);
      if (row) {
        const daily = dailyChangePctFromRow(row);
        if (daily != null && Number.isFinite(daily)) return daily;
      }
      return null;
    };

    const points = mergeAdviceCalibrationPoints(
      buildAdviceCalibrationFromLiveRows(liveCalibRows, lang),
      buildAdviceCalibrationFromPaperSells(
        decisionSimState.ticks,
        resolvePostMove24h,
        lang,
      ),
      buildAdviceCalibrationFromLog(
        decisionSimState.adviceLog,
        decisionSimState.ticks,
        lang,
      ),
    );

    const unverified = countUnverifiedSellEvitaFromMonitor(liveCalibRows);
    const tickLevelPaper = filterPaperExecutedCalibrationPoints(points);
    let dealPoints = buildDealLevelCalibrationPoints(
      decisionSimState.ticks,
      resolvePostMove24h,
      lang,
      {
        paperPortfolio: decisionSimState.paperPortfolio,
        liveEvaluations,
      },
    );
    dealPoints = attachDaysToCdOnAdvicePoints(dealPoints, resolveDaysToCd);
    const paperSoldKeys = keysWithPaperSellExecution(decisionSimState.ticks);
    const liveMonitorPoints = attachDaysToCdOnAdvicePoints(
      buildAdviceCalibrationFromLiveRows(liveCalibRows, lang),
      resolveDaysToCd,
    );
    const { points: adviceMonitorPoints, excludedSellCount: paperSellExcludedCount } =
      adviceMonitorPointsExcludingPaperSells(liveMonitorPoints, paperSoldKeys);
    const adviceMonitorRows = liveCalibRowsExcludingPaperSells(liveCalibRows, paperSoldKeys);
    const adviceMonitorDecision = summarizeDecisionPrecision(
      adviceMonitorPoints,
      countUnverifiedSellEvitaFromMonitor(adviceMonitorRows),
    );
    const decision = summarizeDecisionPrecision(dealPoints, unverified);

    const closedPaper = summarizePaperClosedDeals(decisionSimState.ticks);
    const closedPaperKpi = summarizeClosedPnlAdvice(closedPaper);
    const dealGood = (decision.buy.good ?? 0) + (decision.sell.good ?? 0);
    const dealBad = (decision.buy.bad ?? 0) + (decision.sell.bad ?? 0);
    const unifiedAdvice = buildUnifiedAdviceSuccess({
      live: summarizeAdviceCalibration([]),
      paperPrecisionPct:
        dealGood + dealBad > 0
          ? Math.round((dealGood / (dealGood + dealBad)) * 1000) / 10
          : null,
      paperGood: dealGood,
      paperBad: dealBad,
      closed: null,
    });

    let growth = null;
    if (simLoopSynthMaturation?.length && synthAlloc) {
      const last = simLoopSynthMaturation[simLoopSynthMaturation.length - 1]!;
      const cost = synthAlloc.totalCapitalEur;
      const impact = computeSynthGainImpact(
        livePiggy.totalPnlEur,
        cost,
        last.simLoopSynthTotalPnlEur,
        cost,
      );
      growth = summarizeWeightedGrowthFromImpact(
        impact,
        "simLoop",
        livePiggy.closedTradeCount + livePiggy.openPositionCount,
        {
          equalClosedEur: livePiggy.closedPnlEur,
          equalOpenEur: livePiggy.openMtmPnlEur,
          synthClosedEur: last.simLoopSynthClosedPnlEur,
          synthOpenEur: last.simLoopSynthOpenMtmEur,
        },
      );
    }

    return {
      decision,
      growth,
      unifiedAdvice,
      closedPaperWinRatePct: closedPaperKpi.winRatePct,
      paperPointCount: dealPoints.length,
      paperOpenDealCount: dealPoints.filter((p) => p.kind === "deal_buy_open").length,
      paperClosedDealCount: dealPoints.filter((p) => p.kind === "deal_buy_closed").length,
      paperSellExecutedCount: countPaperSellExecutions(decisionSimState.ticks),
      paperSellScoredCount: dealPoints.filter(
        (p) => p.suggestedAction === "sell" && (p.outcome === "good" || p.outcome === "bad"),
      ).length,
      paperSellCoverage: summarizePaperSellOperativeCoverage(
        decisionSimState.ticks,
        resolvePostMove24h,
      ),
      livePointCount: points.length - tickLevelPaper.length,
      tickEventExcludedCount: countInflatedTickCalibrationEvents(tickLevelPaper, dealPoints),
      unverifiedSellCount: decision.unverifiedSellEvitaCount,
      adviceMonitor:
        adviceMonitorPoints.length > 0 || paperSellExcludedCount > 0
          ? {
              decision: adviceMonitorDecision,
              pendingCount: countPendingAdvicePoints(adviceMonitorPoints),
              paperSellExcludedCount,
            }
          : null,
    };
  }, [
    simTable?.rows?.length,
    monitorRows,
    decisionSimState.paperPortfolio,
    decisionSimState.ticks,
    decisionSimState.adviceLog,
    liveEvaluations,
    simRowByKey,
    it,
    simLoopSynthMaturation,
    synthAlloc,
    livePiggy,
  ]);

  const intrinsicRecommendation = useMemo((): IntrinsicRecommendationSummary | null => {
    if (!simTable?.rows?.length && closedOutcomeRows.length === 0) return null;
    const lang = it ? "it" : "en";
    const entryProbByKey = new Map(
      decisionSimState.paperPortfolio
        .filter((p) => p.entryProbPct != null && Number.isFinite(p.entryProbPct))
        .map((p) => [p.key, p.entryProbPct!]),
    );
    const liveCalibRows = monitorRows.map((row) => {
      const simRow = simRowByKey.get(row.key);
      const dailyVar = simRow ? dailyChangePctFromRow(simRow) : null;
      const pnlPct24h =
        row.pnlPct24h != null && Number.isFinite(row.pnlPct24h)
          ? row.pnlPct24h
          : dailyVar;
      return {
        key: row.key,
        ticker: row.ticker,
        suggestedAction: row.suggestedAction,
        inPaperPortfolio: row.inPaperPortfolio,
        hasPosition: row.hasPosition,
        exitDecision: row.exitDecision,
        probPct: row.probPct,
        probPctAtAdvice: row.inPaperPortfolio
          ? (entryProbByKey.get(row.key) ?? row.probPct)
          : row.probPct,
        planReturnPct: row.planReturnPct,
        miiAngleDeg: row.miiAngleDeg,
        pnlPct: row.pnlPct,
        pnlPct24h,
        daysToCdAtAdvice: readDaysToCdFromSimRow(simRow),
      };
    });
    const base = buildIntrinsicRecommendationSummary({
      monitorRows: liveCalibRows,
      closedRows: closedOutcomeRows,
      simRowByKey,
      lang,
    });
    if (!base) return null;
    const resolveDaysToCd = (key: string): number | null =>
      readDaysToCdFromSimRow(simRowByKey.get(key));
    const monitorPoints = attachDaysToCdOnAdvicePoints(
      buildAdviceCalibrationFromLiveRows(liveCalibRows, lang),
      resolveDaysToCd,
    );
    const auditItems = buildAuditPeakItemsFromClosedRows(
      closedOutcomeRows,
      simRowByKey,
      lang,
    );
    const enriched = enrichIntrinsicWithPeakCd(
      base,
      monitorPoints,
      auditItems,
      lang,
      signCurveView,
    );
    return {
      ...base,
      combinedRangeLabel: enriched.combinedRangeLabel,
      combinedAdviceBins: enriched.combinedAdviceBins,
      combinedPeakCdLabel: enriched.combinedRangeLabel,
      monitor: enriched.monitor,
      closedReplay: enriched.closedReplay,
    };
  }, [
    simTable?.rows?.length,
    monitorRows,
    decisionSimState.paperPortfolio,
    closedOutcomeRows,
    simRowByKey,
    it,
    signCurveView,
  ]);

  const portfolioOperative = useMemo((): OperativeColumnProps | null => {
    if (!realPortfolioAccuracy.outcomeRowCount && closedOutcomeRows.length === 0) return null;
    const closed = realPortfolioAccuracy.closed;
    let closedPnlEur = 0;
    for (const r of closedOutcomeRows) {
      closedPnlEur += realizedPnlEurFromOutcome(r) ?? 0;
    }
    const open =
      simTable?.rows?.length
        ? aggregateOpenPortfolioPnl(simTable, inputs, portfolioHistory)
        : null;
    const openMtmEur = open?.pnlEur ?? 0;
    return {
      decision: realPortfolioAccuracy.decision,
      growth: null,
      sellCoverage: realPortfolioAccuracy.sellCoverage,
      operativeGain: {
        closedPnlEur,
        openMtmEur,
        totalPnlEur: closedPnlEur + openMtmEur,
        winRatePct: closed?.winRatePct ?? null,
        closedSampleN: closed?.sampleSize ?? 0,
        lowSample: closed?.lowSample,
      },
    };
  }, [
    realPortfolioAccuracy,
    closedOutcomeRows,
    simTable,
    inputs,
    portfolioHistory,
  ]);

  const simLoopOperative = useMemo((): OperativeColumnProps | null => {
    const closedPaper = summarizePaperClosedDeals(decisionSimState.ticks);
    const closedPaperKpi = summarizeClosedPnlAdvice(closedPaper);
    const closedScored = closedPaperKpi.winCount + closedPaperKpi.lossCount;
    const operativeGain: OperativeGainSummary | null =
      closedScored > 0
        ? {
            closedPnlEur: livePiggy.closedPnlEur,
            openMtmEur: livePiggy.openMtmPnlEur,
            totalPnlEur: livePiggy.totalPnlEur,
            winRatePct: closedPaperKpi.winRatePct,
            closedSampleN: closedScored,
          }
        : null;

    if (!accuracySummary.decision && !accuracySummary.growth && !operativeGain) return null;
    const footnotes: string[] = [];
    if (accuracySummary.tickEventExcludedCount > 0) {
      footnotes.push(
        it
          ? `${accuracySummary.tickEventExcludedCount} eventi tick duplicati esclusi.`
          : `${accuracySummary.tickEventExcludedCount} duplicate tick events excluded.`,
      );
    }
    if (accuracySummary.livePointCount > 0) {
      footnotes.push(
        it
          ? `${accuracySummary.livePointCount} snapshot live esclusi dall'operativa.`
          : `${accuracySummary.livePointCount} live snapshots excluded from operative.`,
      );
    }
    const openPaper = decisionSimState.paperPortfolio.length;
    const openScored = accuracySummary.paperOpenDealCount ?? 0;
    const closedRoundTrips = accuracySummary.paperClosedDealCount ?? 0;
    if (openPaper > 0) {
      footnotes.push(
        it
          ? `Deal paper: ${closedRoundTrips} chiusi + ${openScored}/${openPaper} aperti valutati (flat/senza mark esclusi).`
          : `Paper deals: ${closedRoundTrips} closed + ${openScored}/${openPaper} open scored (flat/no mark excluded).`,
      );
    }
    footnotes.push(
      it
        ? "Auto BUY: 18:00 Roma · P≥55% · SDS≥45 · synth ∝ SDS+Var+EIS/rescue feed."
        : "Auto BUY: 18:00 Rome · P≥55% · SDS≥45 · synth ∝ SDS+vol+EIS/rescue feed.",
    );
    return {
      decision: accuracySummary.decision,
      growth: accuracySummary.growth,
      operativeGain,
      sellCoverage: accuracySummary.paperSellCoverage ?? null,
      adviceMonitor: accuracySummary.adviceMonitor ?? null,
      footnotes: footnotes.length ? footnotes : undefined,
    };
  }, [
    accuracySummary,
    it,
    decisionSimState.paperPortfolio.length,
    decisionSimState.ticks,
    livePiggy.closedPnlEur,
    livePiggy.openMtmPnlEur,
    livePiggy.totalPnlEur,
  ]);

  if (!simTable?.rows?.length && !realPortfolioAccuracy.outcomeRowCount) return null;

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <AccuracySummaryPanel
        portfolioOperative={portfolioOperative}
        simLoopOperative={simLoopOperative}
        modelIntrinsic={modelIntrinsic}
        intrinsic={intrinsicRecommendation}
        weeklyTrends={weeklyTrends}
        it={it}
        onNavigate={onNavigate}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 min-w-0 items-stretch">
        <DecisionSimAdviceCalibrationPanel
          monitorRows={monitorRows}
          paperPortfolio={decisionSimState.paperPortfolio}
          decisionSimTicks={decisionSimState.ticks}
          liveEvaluations={liveEvaluations}
          simTable={simTable}
          lang={it ? "it" : "en"}
          updatedAt={decisionSimUpdatedAt}
          compact
          className={DASHBOARD_SIM_CHART_CLASS}
          preChartMeasureRef={preChartRef}
        />
        <DashboardDaily24hPnlChart
          history={missedHistory}
          ticks={decisionSimState.ticks}
          livePiggyTotalPnlEur={livePiggy.totalPnlEur}
          pnlActualEur={pnlActualEur}
          className={DASHBOARD_SIM_CHART_CLASS}
        />
      </div>

      <div className="min-w-0">
        <ChartCard
          title={it ? "Maturazione titoli nel tempo" : "Stock maturation over time"}
          sub={
            it
              ? "Portfolio reale · Sim loop equal · Sim loop synth — P&L deal chiusi (continua) e aperti MTM (tratteggiato). Sotto: deal attivi/chiusi, totale, 24h."
              : "Actual portfolio · Sim loop equal · Sim loop synth — closed deals P&L (solid) and open MTM (dashed). Below: active/closed deal counts, total, 24h."
          }
          updatedAt={decisionSimUpdatedAt}
        >
          {decisionSimState.ticks.length > 0 ? (
            <DecisionSimMaturationChart
              ticks={decisionSimState.ticks}
              livePiggy={livePiggy}
              liveEvaluations={liveEvaluations}
              paperPortfolio={decisionSimState.paperPortfolio}
              actualPortfolioSeries={actualPortfolioSeries}
              simLoopSynthSeries={simLoopSynthMaturation ?? undefined}
              portfolioLedger={portfolioLedger}
              simTable={simTable}
              synthSizing={
                synthAlloc
                  ? {
                      shareByRowKey: synthAlloc.shareByRowKey,
                      totalCapitalEur: synthAlloc.totalCapitalEur,
                    }
                  : null
              }
              compact
            />
          ) : (
            <p className="text-xs text-ink-muted py-4 text-center leading-relaxed">
              {it
                ? "Nessun dato di simulazione disponibile. Avvia la simulazione Decision Lab per vedere questo grafico."
                : "No simulation data available. Start the Decision Lab simulation to see this chart."}
            </p>
          )}
        </ChartCard>
      </div>

      {aiFeed ? (
        <div className="w-full">
          <DashboardAiFeedCard
            feed={aiFeed.feed}
            recentCount={aiFeed.recentCount}
            loading={aiFeed.loading}
            loadError={aiFeed.loadError}
            updatedAt={aiFeed.updatedAt}
            scopeLabel={aiFeed.scopeLabel}
            onOpenFeed={aiFeed.onOpenFeed}
            fill
            className="min-h-0"
          />
        </div>
      ) : null}
    </div>
  );
}
