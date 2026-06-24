import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle, loadSimulationChartsBundle } from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import { useDecisionSimPairPrechartHeight } from "../hooks/useDecisionSimPairPrechartHeight";
import { buildPortfolioDailyPnlLedger } from "../sheet/simulationPosition";
import { buildCumulativePortfolioMaturationSeries } from "../sheet/portfolioScenarioGain";
import { useLang, useT } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import type { SdsRow } from "../api/supernova";
import { loadSdsCohort } from "../api/supernova";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import { runDecisionSimTick, buildDecisionSimEvaluations } from "../sheet/investDecisionSimLoop";
import { publishSimLoopTradeAlerts } from "../sheet/simLoopTradeAlerts";
import { scheduleGapInvestigationAfterTick } from "../sheet/gapInvestigationGate";
import { pendingGapInvestigationRecords } from "../sheet/gapInvestigationAudit";
import { GAP_INVESTIGATION_EVENT } from "../sheet/gapInvestigationTypes";
import { fmtPortfolioPnlPct } from "../sheet/portfolioGainLossStyle";
import { buildSuggestionMonitorRows, isAlertableRecommendation, type SuggestionMonitorRow } from "../sheet/suggestionMonitor";
import {
  appendDecisionSimTick,
  DECISION_SIM_CHANGED_EVENT,
  DECISION_SIM_DEFAULT_INTERVAL_H,
  DECISION_SIM_RUN_DAYS,
  DECISION_SIM_STORAGE_KEY,
  loadDecisionSimState,
  rollupDecisionSimByWeek,
  startDecisionSimWeek,
  startDecisionSimExperiment,
  stopDecisionSimRun,
  type DecisionSimState,
} from "../sheet/investDecisionSimStorage";
import {
  auditDecisionSimState,
  formatSimLoopDiagnosticReport,
} from "../sheet/simLoopDiagnostics";
import {
  MISALIGN_CHART_LABELS,
  criticalMisalignmentSummaryFromEvaluations,
  type CurveMisalignmentId,
} from "../sheet/investDecisionSimLoop";
import { AppSuggestionsMonitorModal } from "./AppSuggestionsMonitorModal";
import { DecisionSimPnlCharts } from "./DecisionSimPnlCharts";
import { DecisionSimMaturationChart } from "./DecisionSimMaturationChart";
import { DecisionSimMisalignTypesChart } from "./DecisionSimMisalignTypesChart";
import { DecisionSimAdviceCalibrationPanel } from "./DecisionSimAdviceCalibrationPanel";
import { summarizeAdviceCalibrationFromLiveRows } from "../sheet/investDecisionSimAdviceCalibration";
import {
  ADVICE_FEEDBACK_CHANGED_EVENT,
  loadAdviceFeedback,
  type AdviceFeedback,
} from "../sheet/adviceFeedback";
import { useLiveExperimentPiggy } from "../hooks/useLiveExperimentPiggy";
import type { ClosedSuccessMetrics } from "../sheet/portfolioSuccessBridge";
import {
  buildUnifiedAdviceSuccess,
  unifiedAdviceSuccessSub,
  unifiedAdviceSuccessTooltip,
} from "../sheet/unifiedAdviceSuccess";
import { summarizePaperClosedDeals } from "../sheet/paperSimMaturation";
import {
  buildAdviceComplementKpis,
  formatCapturePct,
} from "../sheet/adviceComplementKpis";
import { buildSimLoopSynthMaturationSeries } from "../sheet/simLoopSynthMaturation";
import { resolveSimLoopCapitalPot } from "../sheet/investDecisionSimCharts";
import { useSimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";
import type { SimLoopSizingVariant } from "../sheet/simLoopSizingVariant";
import {
  buildSimLoopGainAuditExport,
  downloadSimLoopGainAuditExcel,
} from "../sheet/simLoopGainAuditExport";

function Kpi({
  label,
  value,
  sub,
  title,
}: {
  label: string;
  value: string | number;
  sub?: string;
  title?: string;
}) {
  return (
    <div
      className="tester-monitor-kpi tester-monitor-panel rounded-xl px-4 py-3 min-w-[110px]"
      title={title}
    >
      <p className="tester-monitor-kpi-label text-[10px] uppercase tracking-wide font-semibold">{label}</p>
      <p className="tester-monitor-kpi-value text-xl font-bold tabular-nums mt-0.5">{value}</p>
      {sub ? <p className="tester-monitor-muted text-[10px] mt-0.5">{sub}</p> : null}
    </div>
  );
}

function fmtEurKpi(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `€${n.toLocaleString("it-IT", { maximumFractionDigits: digits })}`;
}

function fmtTs(iso: string | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function InvestDecisionSimPanel({
  simTable,
  chartsBundle,
  closedSuccess = null,
}: {
  simTable: SheetTable | null;
  chartsBundle: ChartBundle | null;
  /** Round-trip Simulation chiusi — per metrica unificata (non pesati se n<8). */
  closedSuccess?: ClosedSuccessMetrics | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const locale = it ? "it-IT" : "en-US";

  const investInputs = useInvestSimInputs(simTable);
  const portfolioHistory = useInvestSimPortfolioHistory().history;
  const [state, setState] = useState<DecisionSimState>(() => loadDecisionSimState());
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [expandedTick, setExpandedTick] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [simLoopSizingVariant, setSimLoopSizingVariant] = useState<SimLoopSizingVariant>("equal");
  const tickInFlightRef = useRef(false);

  const [sdsRows, setSdsRows] = useState<SdsRow[] | null>(null);
  const [eisState, setEisState] = useState<Awaited<ReturnType<typeof loadEisSuperScoreState>> | null>(
    null,
  );
  const [localCharts, setLocalCharts] = useState<ChartBundle | null>(chartsBundle);
  const polygonOverview = useCdPatternPolygonOverview();

  useEffect(() => {
    setLocalCharts(chartsBundle);
  }, [chartsBundle]);

  useEffect(() => {
    if (chartsBundle) return;
    void loadSimulationChartsBundle().then(({ bundle }) => setLocalCharts(bundle));
  }, [chartsBundle]);

  useEffect(() => {
    void loadSdsCohort(false).then((p) => setSdsRows(p.rows ?? null));
    void loadEisSuperScoreState().then(setEisState);
  }, []);

  const pointsBySeriesKey = useMemo(() => {
    return chartPointsMapFromBundle(localCharts);
  }, [localCharts]);

  const pendingGapReviews = useMemo(
    () => pendingGapInvestigationRecords(state.gapInvestigationLog),
    [state.gapInvestigationLog],
  );

  const openFirstPendingGapReview = useCallback(() => {
    const first = pendingGapReviews[0];
    if (!first || typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(GAP_INVESTIGATION_EVENT, {
        detail: {
          recordId: first.id,
          event: first.event,
          rowKey: first.rowKey,
          finding: first.finding,
        },
      }),
    );
  }, [pendingGapReviews]);

  const actualPortfolioSeries = useMemo(() => {
    if (!simTable?.rows?.length) return { closed: [], open: [] };
    const ledger = buildPortfolioDailyPnlLedger(simTable, investInputs, portfolioHistory);
    return buildCumulativePortfolioMaturationSeries(ledger);
  }, [simTable, investInputs, portfolioHistory]);

  const probOptions = useMemo((): LossAnalysisProbOptions | null => {
    if (!simTable) return null;
    const migByKey = buildMigSolidityByKey(simTable, localCharts, sdsRows);
    return {
      sdsRows,
      migSolidityByKey: migByKey,
      eisSuperScoreState: eisState,
      polygonOverview,
      lightweightPolygon: true,
      mergedInputs: investInputs,
    };
  }, [simTable, localCharts, sdsRows, polygonOverview, investInputs, eisState]);

  useEffect(() => {
    const onChange = () => setState(loadDecisionSimState());
    window.addEventListener(DECISION_SIM_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DECISION_SIM_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    const s = loadDecisionSimState();
    if (!s.ticks.length && !s.config.enabled) return;
    const raw =
      typeof window !== "undefined" ? localStorage.getItem(DECISION_SIM_STORAGE_KEY) : null;
    const report = auditDecisionSimState(s, {
      storageJsonBytes: raw != null ? raw.length * 2 : null,
    });
    if (!report.healthy) {
      console.warn(formatSimLoopDiagnosticReport(report));
    }
  }, []);

  const [adviceFeedback, setAdviceFeedback] = useState<AdviceFeedback | null>(() =>
    typeof window !== "undefined" ? loadAdviceFeedback() : null,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setAdviceFeedback(loadAdviceFeedback());
    window.addEventListener(ADVICE_FEEDBACK_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(ADVICE_FEEDBACK_CHANGED_EVENT, onChange);
  }, []);

  const executeTick = useCallback(async () => {
    if (tickInFlightRef.current) return;
    if (!simTable?.rows?.length) {
      setMsg(it ? "Tabella Simulation non caricata." : "Simulation table not loaded.");
      return;
    }
    tickInFlightRef.current = true;
    setRunning(true);
    setMsg(null);
    try {
      const current = loadDecisionSimState();
      const tick = runDecisionSimTick({
        simTable,
        inputs: investInputs,
        pointsBySeriesKey,
        lang: it ? "it" : "en",
        probOptions,
        paperPortfolio: current.paperPortfolio,
        capitalPerTrade: current.config.capitalPerTrade,
        maxOpenPositions: current.config.maxOpenPositions,
        closedTradeCount: current.closedTradeCount,
        cumulativeClosedPnlEur: current.cumulativePaperPnlEur,
        badBuyScoredKeys: new Set(current.badBuyScoredKeys),
        adviceFeedback,
      });
      const next = appendDecisionSimTick(current, tick);
      setState(next);
      scheduleGapInvestigationAfterTick(tick);
      setExpandedTick(tick.id);
      publishSimLoopTradeAlerts(tick, {
        lang: it ? "it" : "en",
        simTable,
        inputs: investInputs,
        pointsBySeriesKey,
        probOptions,
      });
      const openTickers =
        tick.portfolioAfter.length > 0
          ? tick.portfolioAfter.map((p) => p.ticker).join(", ")
          : it
            ? "nessuna"
            : "none";
      setMsg(
        t("testerMonitor.decisionSim.tickSummary", {
          time: fmtTs(tick.at, locale),
          trades: tick.summary.tradesExecuted,
          open: tick.portfolioAfter.length,
          tickers: openTickers,
          buy: tick.summary.buySignals,
          piggy: tick.summary.piggyBank?.totalPnlEur?.toFixed(0) ?? "0",
          missed: tick.summary.missedBuyCount ?? 0,
        }),
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      tickInFlightRef.current = false;
      setRunning(false);
    }
  }, [simTable, investInputs, pointsBySeriesKey, it, locale, probOptions, t, adviceFeedback]);

  const liveEvaluations = useMemo(() => {
    if (!simTable?.rows?.length) return [];
    return buildDecisionSimEvaluations({
      simTable,
      inputs: investInputs,
      pointsBySeriesKey,
      lang: it ? "it" : "en",
      probOptions,
      paperPortfolio: state.paperPortfolio,
      adviceFeedback,
    });
  }, [simTable, investInputs, pointsBySeriesKey, it, probOptions, state.paperPortfolio, adviceFeedback]);

  const showDecisionSimChartPair = Boolean(simTable?.rows?.length);
  const { preChartRef, preChartHeight } = useDecisionSimPairPrechartHeight(showDecisionSimChartPair);

  const monitorRows = useMemo((): SuggestionMonitorRow[] => {
    if (!simTable?.rows?.length) return [];
    return buildSuggestionMonitorRows({
      simTable,
      inputs: investInputs,
      pointsBySeriesKey,
      lang: it ? "it" : "en",
      probOptions,
      paperPortfolio: state.paperPortfolio,
      adviceFeedback,
    });
  }, [simTable, investInputs, pointsBySeriesKey, it, probOptions, state.paperPortfolio, adviceFeedback]);

  const liveMisalign = useMemo(
    () => criticalMisalignmentSummaryFromEvaluations(liveEvaluations),
    [liveEvaluations],
  );

  const { piggy: livePiggy, adjusted: piggyGuardAdjusted } = useLiveExperimentPiggy(
    state.paperPortfolio,
    liveEvaluations,
    state.cumulativePaperPnlEur,
    state.closedTradeCount,
  );

  const simLoopCapitalPot = useMemo(
    () =>
      resolveSimLoopCapitalPot(
        state.config.capitalPerTrade,
        state.config.maxOpenPositions,
      ),
    [state.config.capitalPerTrade, state.config.maxOpenPositions],
  );

  const synthAlloc = useSimLoopSynthAllocation({
    simTable,
    sdsRows,
    investInputs,
    pointsBySeriesKey,
    totalCapitalEur: simLoopCapitalPot,
    enabled: Boolean(simTable?.rows?.length),
  });

  const simLoopSynthMaturation = useMemo(() => {
    if (!synthAlloc) return null;
    return buildSimLoopSynthMaturationSeries(state.ticks, {
      totalCapitalEur: synthAlloc.totalCapitalEur,
      capitalPerTrade: state.config.capitalPerTrade,
      targetGainEur: synthAlloc.targetGainEur,
      sizingMode: "causal_rebalance",
      live: {
        paperPortfolio: state.paperPortfolio,
        evaluations: liveEvaluations,
        piggyBank: livePiggy,
      },
    });
  }, [
    synthAlloc,
    state.ticks,
    state.paperPortfolio,
    state.config.capitalPerTrade,
    liveEvaluations,
    livePiggy,
  ]);

  const simLoopWeightedMaturation = useMemo(() => {
    if (!synthAlloc?.simLoopApprovedShareByRowKey) return null;
    const keys = Object.keys(synthAlloc.simLoopApprovedShareByRowKey);
    if (keys.length === 0) return null;
    return buildSimLoopSynthMaturationSeries(state.ticks, {
      shareByRowKey: synthAlloc.simLoopApprovedShareByRowKey,
      totalCapitalEur: synthAlloc.totalCapitalEur,
      capitalPerTrade: state.config.capitalPerTrade,
      sizingMode: "static_approved",
      live: {
        paperPortfolio: state.paperPortfolio,
        evaluations: liveEvaluations,
        piggyBank: livePiggy,
      },
    });
  }, [
    synthAlloc,
    state.ticks,
    state.paperPortfolio,
    state.config.capitalPerTrade,
    liveEvaluations,
    livePiggy,
  ]);

  const closedPiggy = useMemo(() => summarizePaperClosedDeals(state.ticks), [state.ticks]);

  const closedPiggySub = useMemo(() => {
    if (closedPiggy.dealCount === 0) return t("testerMonitor.decisionSim.kpi.closedPiggyEmpty");
    const tickers =
      closedPiggy.tickers.length <= 4
        ? closedPiggy.tickers.join(", ")
        : `${closedPiggy.tickers.slice(0, 3).join(", ")} +${closedPiggy.tickers.length - 3}`;
    return t("testerMonitor.decisionSim.kpi.closedPiggySub", {
      n: closedPiggy.dealCount,
      wins: closedPiggy.winCount,
      losses: closedPiggy.lossCount,
      tickers,
    });
  }, [closedPiggy, t]);

  const misalignChart = useMemo(() => {
    const ids = Object.keys(MISALIGN_CHART_LABELS) as CurveMisalignmentId[];
    return ids
      .map((id) => ({
        id,
        label: MISALIGN_CHART_LABELS[id][lang],
        count: liveMisalign.misalignmentByType[id] ?? 0,
      }))
      .filter((r) => r.count > 0);
  }, [liveMisalign.misalignmentByType, lang]);

  const liveMisalignPctDisplay = useMemo(() => {
    if (liveMisalign.evaluatedTickers <= 0) return null;
    return Math.round((liveMisalign.misalignedTickers / liveMisalign.evaluatedTickers) * 100);
  }, [liveMisalign]);

  const weekRollups = useMemo(() => rollupDecisionSimByWeek(state.ticks), [state.ticks]);

  const recommendationCounts = useMemo(() => {
    const recommended = monitorRows.filter((e) => isAlertableRecommendation(e));
    return {
      all: monitorRows.length,
      recommended: recommended.length,
      buy: recommended.filter((e) => e.suggestedAction === "buy").length,
      sell: recommended.filter((e) => e.suggestedAction === "sell").length,
      hold: recommended.filter((e) => e.suggestedAction === "hold").length,
      missedBuy: recommended.filter((e) => e.suggestedAction === "buy" && !e.inPaperPortfolio).length,
    };
  }, [monitorRows]);

  const liveMissedBuyStats = useMemo(() => {
    let eurEst = 0;
    let count = 0;
    const capital = state.config.capitalPerTrade;
    for (const row of monitorRows) {
      if (row.suggestedAction !== "buy" || row.inPaperPortfolio) continue;
      count += 1;
      const estPct = row.planReturnPct ?? 0;
      eurEst += (capital * Math.max(0, estPct)) / 100;
    }
    return { count, eurEst };
  }, [monitorRows, state.config.capitalPerTrade]);

  const liveAdviceReliability = useMemo(() => {
    const entryProbByKey = new Map(
      state.paperPortfolio
        .filter((p) => p.entryProbPct != null && Number.isFinite(p.entryProbPct))
        .map((p) => [p.key, p.entryProbPct!]),
    );
    return summarizeAdviceCalibrationFromLiveRows(
      monitorRows.map((row) => ({
        key: row.key,
        ticker: row.ticker,
        suggestedAction: row.suggestedAction,
        inPaperPortfolio: row.inPaperPortfolio,
        hasPosition: row.hasPosition,
        probPct: row.probPct,
        probPctAtAdvice: row.inPaperPortfolio
          ? (entryProbByKey.get(row.key) ?? row.probPct)
          : row.probPct,
        planReturnPct: row.planReturnPct,
        miiAngleDeg: row.miiAngleDeg,
        pnlPct: row.pnlPct,
        pnlPct24h: row.pnlPct24h,
      })),
      it ? "it" : "en",
    );
  }, [monitorRows, state.paperPortfolio, it]);

  const unifiedAdviceSuccess = useMemo(
    () =>
      buildUnifiedAdviceSuccess({
        live: liveAdviceReliability,
        paperPrecisionPct: state.scorecard.advicePrecisionPct,
        paperGood: state.scorecard.goodBuyCount + state.scorecard.goodSellCount,
        paperBad: state.scorecard.badBuyCount + state.scorecard.badSellCount,
        closed: closedSuccess,
      }),
    [liveAdviceReliability, state.scorecard, closedSuccess],
  );

  const adviceComplement = useMemo(
    () =>
      buildAdviceComplementKpis({
        unified: unifiedAdviceSuccess,
        liveAdvice: liveAdviceReliability,
        monitorRows,
        capitalPerTrade: state.config.capitalPerTrade,
        livePiggy,
        closedPiggy,
      }),
    [
      unifiedAdviceSuccess,
      liveAdviceReliability,
      monitorRows,
      state.config.capitalPerTrade,
      livePiggy,
      closedPiggy,
    ],
  );

  const runProgressPct = useMemo(() => {
    if (!state.config.startedAt || !state.config.endsAt) return null;
    const start = new Date(state.config.startedAt).getTime();
    const end = new Date(state.config.endsAt).getTime();
    const now = Date.now();
    return Math.min(100, Math.round(((now - start) / (end - start)) * 100));
  }, [state.config.startedAt, state.config.endsAt]);

  const openTickerSummary = useMemo(() => {
    if (state.paperPortfolio.length === 0) return "";
    return state.paperPortfolio.map((p) => p.ticker).join(", ");
  }, [state.paperPortfolio]);

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `decision_sim_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadGainAuditExcel = useCallback(() => {
    const exp = buildSimLoopGainAuditExport({
      ticks: state.ticks,
      weightMaturation: simLoopWeightedMaturation,
      synthMaturation: simLoopSynthMaturation,
      closedDeals: closedPiggy.deals,
      live: {
        piggyBank: livePiggy,
        paperPortfolio: state.paperPortfolio,
        evaluations: liveEvaluations,
      },
      capitalPerTrade: state.config.capitalPerTrade,
      maxOpenPositions: state.config.maxOpenPositions,
      totalCapitalPotEur: synthAlloc?.totalCapitalEur,
    });
    downloadSimLoopGainAuditExcel(exp, lang);
  }, [
    state.ticks,
    state.paperPortfolio,
    state.config.capitalPerTrade,
    state.config.maxOpenPositions,
    simLoopWeightedMaturation,
    simLoopSynthMaturation,
    closedPiggy.deals,
    livePiggy,
    liveEvaluations,
    synthAlloc?.totalCapitalEur,
    lang,
  ]);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div className="tester-monitor-panel rounded-2xl px-4 py-3 shrink-0">
        <p className="tester-monitor-text text-sm font-semibold">
          {t("testerMonitor.decisionSim.title")}
        </p>
        <p className="tester-monitor-muted text-[11px] leading-relaxed mt-1 max-w-[900px]">
          {t("testerMonitor.decisionSim.subtitle")}
        </p>
        <p className="tester-monitor-muted text-[10px] leading-snug mt-1 max-w-[900px] opacity-90">
          {t("testerMonitor.decisionSim.compositeHint")}
        </p>
        <div className="flex flex-wrap gap-2 mt-3 items-center">
          {!state.config.enabled ? (
            <>
              <button
                type="button"
                className="btn text-xs py-1.5"
                disabled={running || !simTable?.rows?.length}
                onClick={() => setState(startDecisionSimExperiment(state, DECISION_SIM_DEFAULT_INTERVAL_H))}
              >
                {t("testerMonitor.decisionSim.startExperiment")}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs py-1.5"
                disabled={running || !simTable?.rows?.length}
                onClick={() => setState(startDecisionSimWeek(state, DECISION_SIM_DEFAULT_INTERVAL_H))}
              >
                {t("testerMonitor.decisionSim.startWeek", { days: DECISION_SIM_RUN_DAYS })}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn-ghost text-xs py-1.5"
              disabled={running}
              onClick={() => setState(stopDecisionSimRun(state))}
            >
              {t("testerMonitor.decisionSim.stop")}
            </button>
          )}
          <button
            type="button"
            className="btn-ghost text-xs py-1.5"
            disabled={running || !simTable?.rows?.length}
            onClick={() => void executeTick()}
          >
            {running ? "…" : t("testerMonitor.decisionSim.runNow")}
          </button>
          <button type="button" className="btn-ghost text-xs py-1.5" onClick={downloadJson}>
            {t("testerMonitor.decisionSim.download")}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs py-1.5"
            disabled={!state.ticks.length}
            onClick={downloadGainAuditExcel}
            title={t("testerMonitor.decisionSim.exportGainAuditTip")}
          >
            {t("testerMonitor.decisionSim.exportGainAudit")}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs py-1.5 border border-[rgb(var(--accent))]/35 text-[rgb(var(--accent))]"
            disabled={!simTable?.rows?.length}
            onClick={() => setSuggestionsOpen(true)}
          >
            {t("testerMonitor.decisionSim.openSuggestionsMonitor")}
          </button>
          {state.config.enabled && runProgressPct != null && !state.config.experimentMode ? (
            <span className="tester-monitor-muted text-[10px] tabular-nums">
              {t("testerMonitor.decisionSim.progress", { pct: runProgressPct })}
              {" · "}
              {t("testerMonitor.decisionSim.marketSchedule")}
            </span>
          ) : null}
          {state.config.enabled && state.config.experimentMode ? (
            <span className="tester-monitor-muted text-[10px] tabular-nums">
              {t("testerMonitor.decisionSim.experimentRunning")}
              {" · "}
              {t("testerMonitor.decisionSim.marketSchedule")}
            </span>
          ) : null}
          {state.lastTickAt ? (
            <span className="tester-monitor-muted text-[10px] tabular-nums">
              {t("testerMonitor.decisionSim.lastTick")}: {fmtTs(state.lastTickAt, locale)}
            </span>
          ) : null}
        </div>
        {msg ? <p className="tester-monitor-text text-[10px] mt-2 font-medium">{msg}</p> : null}
        {pendingGapReviews.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-300/60 bg-amber-50/70 px-2.5 py-1.5 dark:border-amber-600/40 dark:bg-amber-950/30">
            <span className="text-[10px] font-medium text-amber-900 dark:text-amber-100">
              {t("gapInvestigation.pendingBanner", { n: String(pendingGapReviews.length) })}
            </span>
            <button
              type="button"
              className="rounded border border-amber-400/70 px-2 py-0.5 text-[10px] font-semibold text-amber-900 hover:bg-amber-100/80 dark:text-amber-100 dark:hover:bg-amber-900/40"
              onClick={openFirstPendingGapReview}
            >
              {t("gapInvestigation.reviewOpen")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 shrink-0">
        <Kpi
          label={t("testerMonitor.decisionSim.kpi.piggyTotal")}
          value={fmtEurKpi(livePiggy.totalPnlEur)}
          sub={`${t("testerMonitor.decisionSim.kpi.open")} ${fmtEurKpi(livePiggy.openMtmPnlEur)} · ${t("testerMonitor.decisionSim.kpi.closed")} ${fmtEurKpi(livePiggy.closedPnlEur)}`}
          title={
            piggyGuardAdjusted
              ? it
                ? "Piggy ricalcolato: totale = chiuso + open MTM (snapshot precedente incoerente)"
                : "Piggy recomputed: total = closed + open MTM (prior snapshot was inconsistent)"
              : undefined
          }
        />
        <Kpi
          label={t("testerMonitor.decisionSim.kpi.closedPiggy")}
          value={fmtEurKpi(closedPiggy.rawPnlEur)}
          sub={closedPiggySub}
          title={t("testerMonitor.decisionSim.kpi.closedPiggyTip")}
        />
        <Kpi
          label={t("testerMonitor.decisionSim.kpi.paperSim")}
          value={
            Number.isFinite(state.config.maxOpenPositions)
              ? `${livePiggy.openPositionCount}/${state.config.maxOpenPositions}`
              : liveMissedBuyStats.count > 0
                ? `${livePiggy.openPositionCount} · ⏳ ${liveMissedBuyStats.count}`
                : `${livePiggy.openPositionCount}`
          }
          sub={
            livePiggy.openPositionCount > 0
              ? `${fmtEurKpi(livePiggy.openCapitalEur)} ${t("testerMonitor.decisionSim.kpi.deployed")} · ${openTickerSummary}`
              : t("testerMonitor.decisionSim.kpi.paperSimEmpty")
          }
          title={
            liveMissedBuyStats.count > 0
              ? `${t("testerMonitor.decisionSim.kpi.paperSimTip")} · ${liveMissedBuyStats.count} ${it ? "BUY in attesa del prossimo tick" : "BUY waiting for next tick"}`
              : t("testerMonitor.decisionSim.kpi.paperSimTip")
          }
        />
        <Kpi
          label={t("testerMonitor.decisionSim.kpi.buySignals")}
          value={recommendationCounts.buy}
          sub={t("testerMonitor.decisionSim.kpi.buySignalsSub")}
        />
        <Kpi
          label={t("testerMonitor.decisionSim.kpi.missedOpp")}
          value={liveMissedBuyStats.count}
          sub={t("testerMonitor.decisionSim.kpi.missedOppSub", {
            eur: fmtEurKpi(liveMissedBuyStats.eurEst),
          })}
        />
        <Kpi
          label={t("testerMonitor.decisionSim.kpi.adviceSuccess")}
          value={
            unifiedAdviceSuccess.headlinePct != null
              ? `${unifiedAdviceSuccess.headlinePct}%`
              : "—"
          }
          sub={unifiedAdviceSuccessSub(unifiedAdviceSuccess, it ? "it" : "en")}
          title={unifiedAdviceSuccessTooltip(unifiedAdviceSuccess, it ? "it" : "en")}
        />
        <Kpi
          label={t("testerMonitor.decisionSim.kpi.captureVsRecs")}
          value={formatCapturePct(adviceComplement.capture.capturePct)}
          sub={t("testerMonitor.decisionSim.kpi.captureVsRecsSub", {
            actual: fmtEurKpi(adviceComplement.capture.actualEur),
            potential: fmtEurKpi(adviceComplement.capture.potentialEur),
          })}
          title={t("testerMonitor.decisionSim.kpi.captureVsRecsTip")}
        />
        <Kpi
          label={t("testerMonitor.decisionSim.kpi.closedPnlSuccess")}
          value={
            adviceComplement.closedPnl.winRatePct != null
              ? `${adviceComplement.closedPnl.winRatePct}%`
              : "—"
          }
          sub={t("testerMonitor.decisionSim.kpi.closedPnlSuccessSub", {
            wins: adviceComplement.closedPnl.winCount,
            losses: adviceComplement.closedPnl.lossCount,
          })}
          title={t("testerMonitor.decisionSim.kpi.closedPnlSuccessTip")}
        />
        <Kpi
          label={t("testerMonitor.decisionSim.kpi.paperBookReturn")}
          value={
            adviceComplement.paperReturn.returnPct != null
              ? `${adviceComplement.paperReturn.returnPct >= 0 ? "+" : ""}${adviceComplement.paperReturn.returnPct}%`
              : "—"
          }
          sub={t("testerMonitor.decisionSim.kpi.paperBookReturnSub", {
            pnl: fmtEurKpi(adviceComplement.paperReturn.totalPnlEur),
            book: fmtEurKpi(adviceComplement.paperReturn.bookEur),
          })}
          title={t("testerMonitor.decisionSim.kpi.paperBookReturnTip")}
        />
        <Kpi
          label={t("testerMonitor.decisionSim.kpi.misalign")}
          value={
            liveMisalign.evaluatedTickers > 0 && liveMisalignPctDisplay != null
              ? `${liveMisalignPctDisplay}%`
              : "—"
          }
          sub={t("testerMonitor.decisionSim.kpi.misalignSub")}
        />
      </div>

      <p className="tester-monitor-muted text-[10px] leading-relaxed shrink-0 px-0.5">
        {t("testerMonitor.decisionSim.buyRulesHint", { n: recommendationCounts.recommended })}
      </p>

      {simTable?.rows?.length ? (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch shrink-0 min-w-0 min-h-[320px]">
          <DecisionSimAdviceCalibrationPanel
            monitorRows={monitorRows}
            paperPortfolio={state.paperPortfolio}
            decisionSimTicks={state.ticks}
            liveEvaluations={liveEvaluations}
            simTable={simTable}
            lang={lang}
            unifiedAdviceSuccess={unifiedAdviceSuccess}
            adviceComplement={adviceComplement}
            compact
            className="tester-monitor-panel min-w-0"
            preChartMeasureRef={preChartRef}
          />
          <DecisionSimPnlCharts
            ticks={state.ticks}
            livePiggy={livePiggy}
            liveEvaluations={liveEvaluations}
            paperPortfolio={state.paperPortfolio}
            simTable={simTable}
            capitalPerTrade={state.config.capitalPerTrade}
            maxOpenPositions={state.config.maxOpenPositions}
            lang={lang}
            compact
            className="min-w-0"
            pairPreChartHeight={preChartHeight}
            simLoopSynthMaturation={simLoopSynthMaturation}
            simLoopWeightedMaturation={simLoopWeightedMaturation}
            simLoopSizedTotalCapitalEur={synthAlloc?.totalCapitalEur}
            sizingVariant={simLoopSizingVariant}
            onSizingVariantChange={setSimLoopSizingVariant}
          />
        </div>
        {state.ticks.length > 0 || liveMisalign.evaluatedTickers > 0 ? (
          <>
            <p className="tester-monitor-muted text-[10px] leading-relaxed shrink-0 px-0.5">
              {t("testerMonitor.decisionSim.misalignGuide")}
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch shrink-0 min-w-0 min-h-[280px]">
              {state.ticks.length > 0 ? (
                <DecisionSimMaturationChart
                  ticks={state.ticks}
                  livePiggy={livePiggy}
                  liveEvaluations={liveEvaluations}
                  paperPortfolio={state.paperPortfolio}
                  actualPortfolioSeries={actualPortfolioSeries}
                  simLoopSynthSeries={simLoopSynthMaturation ?? undefined}
                  simLoopWeightedSeries={simLoopWeightedMaturation ?? undefined}
                  sizingVariant={simLoopSizingVariant}
                  onSizingVariantChange={setSimLoopSizingVariant}
                  compact
                  className="min-w-0"
                />
              ) : (
                <div className="tester-monitor-panel rounded-xl flex items-center justify-center p-3 min-h-[208px]">
                  <p className="tester-monitor-muted text-[10px] text-center">
                    {t("testerMonitor.decisionSim.chart.maturationEmpty")}
                  </p>
                </div>
              )}
              <DecisionSimMisalignTypesChart
                rows={misalignChart}
                misalignedTickers={liveMisalign.misalignedTickers}
                evaluatedTickers={liveMisalign.evaluatedTickers}
                compact
                className="min-w-0"
              />
            </div>
          </>
        ) : null}
        </>
      ) : null}

      {closedPiggy.deals.length > 0 ? (
        <details className="tester-monitor-panel-soft rounded-xl p-3 shrink-0">
          <summary className="text-[11px] font-semibold cursor-pointer">
            {t("testerMonitor.decisionSim.closedDealsTable")} ({closedPiggy.dealCount})
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className={`${SHEET_GRID_TABLE_CLASS} tester-monitor-table text-[10px] min-w-[560px]`}>
              <SheetGridColgroup columnCount={7} />
              <thead>
                <tr className="uppercase tracking-wide text-[9px]">
                  <th className={gridTh("left", "py-1")}>Ticker</th>
                  <th className={gridTh("center", "py-1")}>{it ? "Ingresso" : "Entry"}</th>
                  <th className={gridTh("center", "py-1")}>{it ? "Uscita" : "Exit"}</th>
                  <th className={gridTh("center", "py-1")}>{it ? "Giorni" : "Days"}</th>
                  <th className={gridTh("center", "py-1")}>P(plan)</th>
                  <th className={gridTh("center", "py-1")}>P&L</th>
                  <th className={gridTh("center", "py-1")}>%</th>
                </tr>
              </thead>
              <tbody>
                {closedPiggy.deals.map((d) => (
                  <tr key={`${d.key}|${d.exitAt}`}>
                    <td className={`${gridTd("left", "py-1")} font-bold`}>{d.ticker}</td>
                    <td className={`${gridTd("center", "py-1")} tabular-nums text-[9px]`}>
                      {fmtTs(d.entryAt, locale)}
                    </td>
                    <td className={`${gridTd("center", "py-1")} tabular-nums text-[9px]`}>
                      {fmtTs(d.exitAt, locale)}
                    </td>
                    <td className={`${gridTd("center", "py-1")} tabular-nums`}>{d.holdDays}</td>
                    <td className={`${gridTd("center", "py-1")} tabular-nums`}>
                      {d.entryProbPct != null ? `${Math.round(d.entryProbPct)}%` : "—"}
                    </td>
                    <td
                      className={`${gridTd("center", "py-1")} tabular-nums font-semibold ${
                        d.pnlEur >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {fmtEurKpi(d.pnlEur)}
                    </td>
                    <td className={`${gridTd("center", "py-1")} tabular-nums`}>
                      {d.pnlPct != null ? fmtPortfolioPnlPct(d.pnlPct) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {weekRollups.length > 0 ? (
        <div className="tester-monitor-panel rounded-xl overflow-hidden shrink-0">
          <p className="tester-monitor-text text-[11px] font-semibold px-3 py-2 border-b border-[rgb(var(--tester-monitor-border))]/40">
            {t("testerMonitor.decisionSim.weekTable")}
          </p>
          <div className="overflow-x-auto">
            <table className={`${SHEET_GRID_TABLE_CLASS} tester-monitor-table text-[11px] min-w-[640px]`}>
              <SheetGridColgroup columnCount={9} />
              <thead>
                <tr className="text-left uppercase tracking-wide text-[10px]">
                  <th className={gridTh("left", "py-2")}>{it ? "Settimana" : "Week"}</th>
                  <th className={gridTh("center", "py-2")}>Ticks</th>
                  <th className={gridTh("center", "py-2")}>Trades</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Disallineati" : "Misaligned"}</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Accordo segnali" : "Signal agree"}</th>
                  <th className={gridTh("center", "py-2")}>P&L paper</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Win sell" : "Win sell"}</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Opp. perse" : "Missed"}</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Piggy tot" : "Total piggy"}</th>
                </tr>
              </thead>
              <tbody>
                {weekRollups.map((w) => (
                  <tr key={w.weekKey}>
                    <td className={`${gridTd("left", "py-2")} font-mono font-semibold`}>{w.weekKey}</td>
                    <td className={`${gridTd("center", "py-2")} tabular-nums`}>{w.tickCount}</td>
                    <td className={`${gridTd("center", "py-2")} tabular-nums`}>{w.tradeCount}</td>
                    <td className={`${gridTd("center", "py-2")} tabular-nums`}>
                      {w.misalignmentRatePct != null ? `${w.misalignmentRatePct}%` : "—"}
                    </td>
                    <td className={`${gridTd("center", "py-2")} tabular-nums`}>
                      {w.signalAgreementPct != null ? `${w.signalAgreementPct}%` : "—"}
                    </td>
                    <td
                      className={`${gridTd("center", "py-2")} tabular-nums font-semibold ${
                        w.paperPnlEur >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {fmtEurKpi(w.paperPnlEur)}
                    </td>
                    <td className={`${gridTd("center", "py-2")} tabular-nums text-[10px]`}>
                      {w.winSellCount}/{w.winSellCount + w.lossSellCount}
                    </td>
                    <td className={`${gridTd("center", "py-2")} tabular-nums`}>{w.missedBuyCount}</td>
                    <td
                      className={`${gridTd("center", "py-2")} tabular-nums font-semibold ${
                        (w.totalPnlEur ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {w.totalPnlEur != null && Number.isFinite(w.totalPnlEur)
                        ? fmtEurKpi(w.totalPnlEur)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {state.adviceLog.length > 0 ? (
        <details className="tester-monitor-panel-soft rounded-xl p-3 shrink-0" open>
          <summary className="text-[11px] font-semibold cursor-pointer">
            {t("testerMonitor.decisionSim.adviceLog")} ({state.adviceLog.length})
          </summary>
          <div className="mt-2 overflow-auto max-h-40">
            <table className={`${SHEET_GRID_TABLE_CLASS} tester-monitor-table text-[10px] min-w-[640px]`}>
              <SheetGridColgroup columnCount={5} />
              <thead>
                <tr className="uppercase tracking-wide text-[9px]">
                  <th className={gridTh("left", "py-1")}>{it ? "Quando" : "When"}</th>
                  <th className={gridTh("left", "py-1")}>Ticker</th>
                  <th className={gridTh("center", "py-1")}>{it ? "Tipo" : "Kind"}</th>
                  <th className={gridTh("center", "py-1")}>P&L</th>
                  <th className={gridTh("left", "py-1")}>{it ? "Nota" : "Note"}</th>
                </tr>
              </thead>
              <tbody>
                {[...state.adviceLog].reverse().slice(0, 30).map((ev, i) => (
                  <tr key={`${ev.tickId}-${ev.key}-${i}`}>
                    <td className={`${gridTd("left", "py-1")} tabular-nums`}>{fmtTs(ev.at, locale)}</td>
                    <td className={`${gridTd("left", "py-1")} font-bold`}>{ev.ticker}</td>
                    <td className={`${gridTd("center", "py-1")} uppercase text-[9px]`}>{ev.kind.replace("_", " ")}</td>
                    <td className={`${gridTd("center", "py-1")} tabular-nums`}>
                      {ev.pnlEur != null ? `€${ev.pnlEur.toFixed(0)}` : "—"}
                    </td>
                    <td className={`${gridTd("left", "py-1")} text-ink-muted`}>{ev.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {state.ticks.length > 0 ? (
        <details className="tester-monitor-panel-soft rounded-xl p-3 shrink-0">
          <summary className="text-[11px] font-semibold cursor-pointer">
            {t("testerMonitor.decisionSim.tickLog")} ({state.ticks.length})
          </summary>
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {[...state.ticks].reverse().slice(0, 20).map((tk) => (
              <button
                key={tk.id}
                type="button"
                className={`w-full text-left text-[10px] px-2 py-1 rounded border ${
                  expandedTick === tk.id
                    ? "border-[rgb(var(--accent))]/50 bg-[rgb(var(--accent))]/5"
                    : "border-transparent hover:bg-surface/60"
                }`}
                onClick={() => setExpandedTick(expandedTick === tk.id ? null : tk.id)}
              >
                <span className="font-mono tabular-nums">{fmtTs(tk.at, locale)}</span>
                {" · "}
                {tk.summary.evaluatedTickers} tickers · {tk.summary.tradesExecuted} trades ·{" "}
                {tk.summary.misalignedTickers} misalign
                {tk.trades.length > 0 ? (
                  <span className="block text-ink-muted mt-0.5 truncate">
                    {tk.trades.map((tr: (typeof tk.trades)[number]) => `${tr.side} ${tr.ticker}`).join(", ")}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </details>
      ) : null}

      <AppSuggestionsMonitorModal
        open={suggestionsOpen}
        onClose={() => setSuggestionsOpen(false)}
        simTable={simTable}
        chartsBundle={localCharts}
        paperPortfolio={state.paperPortfolio}
        evaluatedAt={state.lastTickAt}
      />
    </div>
  );
}
