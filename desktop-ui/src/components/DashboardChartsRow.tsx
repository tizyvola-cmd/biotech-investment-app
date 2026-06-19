import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
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
import { syncSimLoopEntryShares } from "../sheet/simLoopPulseView";
import { useSimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";
import { DashboardAiFeedCard, type DashboardAiFeedItem } from "./DashboardAiFeedCard";
import { DashboardPanelUpdatedLabel } from "./DashboardPanelUpdatedLabel";
import { DecisionSimAdviceCalibrationPanel } from "./DecisionSimAdviceCalibrationPanel";
import { DecisionSimPnlCharts } from "./DecisionSimPnlCharts";
import { DecisionSimMaturationChart } from "./DecisionSimMaturationChart";
import { latestDashboardPanelIso } from "../sheet/dashboardPanelDailyRefresh";

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
}: {
  simTable: SheetTable | null;
  chartBundle: ChartBundle | null;
  sdsRows: SdsRow[] | null;
  dataUpdatedAt?: string | null;
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
  const [, setMissedHistory] = useState<MissedOppDailySnapshot[]>(() =>
    loadMissedOppHistory(),
  );
  const [decisionSimState, setDecisionSimState] = useState<DecisionSimState>(() =>
    loadDecisionSimState(),
  );

  useEffect(() => {
    void loadEisSuperScoreState().then(setEisState);
  }, []);

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

  // Keep `missedHistory` updates flowing for downstream analytics, but the
  // standalone "Daily 24h P&L" card is no longer rendered on the dashboard —
  // it was the discrete derivative of the cumulative curves in
  // `DecisionSimMaturationChart`, so showing both side by side just gave the
  // user the same story twice on two different X axes / aggregations.

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
    const entryShareByRowKey = syncSimLoopEntryShares(
      decisionSimState.paperPortfolio.map((p) => p.key),
      synthAlloc.shareByRowKey,
    );
    return buildSimLoopSynthMaturationSeries(decisionSimState.ticks, {
      shareByRowKey: synthAlloc.shareByRowKey,
      totalCapitalEur: synthAlloc.totalCapitalEur,
      capitalPerTrade: decisionSimState.config.capitalPerTrade,
      entryShareByRowKey,
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

  const simLoopWeightedMaturation = useMemo(() => {
    if (!synthAlloc?.simLoopApprovedShareByRowKey) return null;
    const keys = Object.keys(synthAlloc.simLoopApprovedShareByRowKey);
    if (keys.length === 0) return null;
    const entryShareByRowKey = syncSimLoopEntryShares(
      decisionSimState.paperPortfolio.map((p) => p.key),
      synthAlloc.simLoopApprovedShareByRowKey,
    );
    return buildSimLoopSynthMaturationSeries(decisionSimState.ticks, {
      shareByRowKey: synthAlloc.simLoopApprovedShareByRowKey,
      totalCapitalEur: synthAlloc.totalCapitalEur,
      capitalPerTrade: decisionSimState.config.capitalPerTrade,
      entryShareByRowKey,
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
  const { preChartRef, preChartHeight } = useDecisionSimPairPrechartHeight(showDecisionSimChartPair);

  if (!simTable?.rows?.length) return null;

  return (
    <div className="flex flex-col gap-3 min-w-0">
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
        <DecisionSimPnlCharts
          ticks={decisionSimState.ticks}
          livePiggy={livePiggy}
          liveEvaluations={liveEvaluations}
          paperPortfolio={decisionSimState.paperPortfolio}
          simTable={simTable}
          capitalPerTrade={decisionSimState.config.capitalPerTrade}
          maxOpenPositions={decisionSimState.config.maxOpenPositions}
          lang={it ? "it" : "en"}
          compact
          className={DASHBOARD_SIM_CHART_CLASS}
          pairPreChartHeight={preChartHeight}
          simLoopSynthMaturation={simLoopSynthMaturation}
          simLoopWeightedMaturation={simLoopWeightedMaturation}
          simLoopSizedTotalCapitalEur={synthAlloc?.totalCapitalEur}
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
