import { useEffect, useMemo, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle, loadSimulationChartsBundle, simulationRowSeriesKey } from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import { useLang, useT } from "../shared/i18n";
import {
  buildMissedOppErrorTrend,
  buildMissedOppPnlDailySeries,
  buildMissedOppPnlTrend,
  buildMissedOpportunityAudit,
  loadMissedOppHistory,
  MISSED_OPP_CAPITAL_EUR,
  saveMissedOppSnapshot,
  summarizeMissedOppImprovement,
  type MissedOppDailySnapshot,
  type MissedOppRow,
  type MissedOpportunitySummary,
} from "../sheet/missedOpportunityAudit";
import { buildMissedOppCalibrationPlan } from "../sheet/missedOpportunityCalibration";
import { buildCdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";
import { buildSimRowByKeyMap, reconcileInvestSimInputs } from "../sheet/investSimKeys";
import { MissedOpportunityDetailDrawer } from "./MissedOpportunityDetailDrawer";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import type { SdsRow } from "../api/supernova";
import { loadSdsCohort } from "../api/supernova";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import { buildPortfolioDailyPnlLedger, rowHasActivePortfolio } from "../sheet/simulationPosition";
import { buildPortfolioVsSimLoopInsight } from "../sheet/portfolioVsSimLoopAnalysis";
import { buildDecisionSimEvaluations } from "../sheet/investDecisionSimLoop";
import {
  DECISION_SIM_CHANGED_EVENT,
  loadDecisionSimState,
  type DecisionSimState,
} from "../sheet/investDecisionSimStorage";
import { useLiveExperimentPiggy } from "../hooks/useLiveExperimentPiggy";
import {
  buildDecisionSimPnlDailySeries,
  mergeMissedOppDailyWithSimLoop,
  mergeMissedOppTrendWithSimLoop,
  resolveLiveSimLoopTotalPnl,
} from "../sheet/decisionSimPnlDaily";
import { buildMissedOppPnlLineDefs } from "./missedOppPnlChartLines";
import { MissedOppPnlLineChart, MISSED_OPP_PNL_PAIR_CHART_HEIGHT_LG } from "./MissedOppPnlLineChart";
import { MissedGainersScatterChart } from "./MissedGainersScatterChart";
import { MissedOppErrorTrendChart } from "./MissedOppErrorTrendChart";

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtEur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("it-IT", { maximumFractionDigits: 0 })} €`;
}

export function MissedOpportunityPanel({
  simTable,
  reloadToken = 0,
}: {
  simTable: SheetTable | null;
  reloadToken?: number;
}) {
  const t = useT();
  const { lang } = useLang();
  const inputs = useInvestSimInputs(simTable);
  const portfolioHistory = useInvestSimPortfolioHistory(reloadToken).history;
  const polygonOverview = useCdPatternPolygonOverview();
  const [chartBundle, setChartBundle] = useState<ChartBundle | null>(null);
  const [chartsLoading, setChartsLoading] = useState(false);
  const [eisState, setEisState] = useState<Awaited<ReturnType<typeof loadEisSuperScoreState>> | null>(
    null,
  );
  const [sdsRows, setSdsRows] = useState<SdsRow[] | null>(null);
  const [history, setHistory] = useState<MissedOppDailySnapshot[]>(() => loadMissedOppHistory());
  const [selectedRow, setSelectedRow] = useState<MissedOppRow | null>(null);
  const [decisionSimState, setDecisionSimState] = useState<DecisionSimState>(() =>
    loadDecisionSimState(),
  );

  useEffect(() => {
    const onChange = () => setDecisionSimState(loadDecisionSimState());
    window.addEventListener(DECISION_SIM_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(DECISION_SIM_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    setChartsLoading(true);
    void loadSimulationChartsBundle().then(({ bundle }) => {
      setChartBundle(bundle);
      setChartsLoading(false);
    });
  }, [reloadToken]);

  useEffect(() => {
    void loadEisSuperScoreState().then(setEisState);
    void loadSdsCohort(false).then((p) => setSdsRows(p.rows ?? null));
  }, [reloadToken]);

  const pointsBySeriesKey = useMemo(
    () => chartPointsMapFromBundle(chartBundle),
    [chartBundle],
  );

  const migSolidityByKey = useMemo(
    () => buildMigSolidityByKey(simTable, chartBundle, sdsRows),
    [simTable, chartBundle, sdsRows],
  );

  const probOptions = useMemo((): LossAnalysisProbOptions | null => {
    if (!simTable?.rows?.length) return null;
    return {
      sdsRows,
      migSolidityByKey,
      eisSuperScoreState: eisState,
      polygonOverview,
      lightweightPolygon: true,
      mergedInputs: inputs,
    };
  }, [simTable?.rows?.length, sdsRows, migSolidityByKey, eisState, polygonOverview, inputs]);

  const summary = useMemo((): MissedOpportunitySummary | null => {
    if (!simTable?.rows?.length) return null;
    return buildMissedOpportunityAudit({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang: lang === "it" ? "it" : "en",
      probOptions,
    });
  }, [simTable, inputs, pointsBySeriesKey, lang, probOptions]);

  const pnlActualEur = useMemo(() => {
    if (!simTable?.rows?.length) return null;
    const ledger = buildPortfolioDailyPnlLedger(simTable, inputs, portfolioHistory);
    const todayKey = new Date().toISOString().slice(0, 10);
    const open = ledger.openDayTotals[todayKey];
    if (open != null && Number.isFinite(open)) return open;
    const all = ledger.dayTotals[todayKey];
    return all != null && Number.isFinite(all) ? all : null;
  }, [simTable, inputs, portfolioHistory]);

  useEffect(() => {
    if (!summary || summary.with24hN === 0) return;
    setHistory(saveMissedOppSnapshot(summary, pnlActualEur));
  }, [
    summary?.detectedN,
    summary?.missedN,
    summary?.recallPct,
    summary?.with24hN,
    summary?.pnlAllGainersEur,
    summary?.pnlRecommendationsEur,
    summary?.pnlFairRecommendationsEur,
    pnlActualEur,
  ]);

  const pnlTrendData = useMemo(() => buildMissedOppPnlTrend(history), [history]);
  const pnlDailyData = useMemo(() => buildMissedOppPnlDailySeries(history), [history]);

  /**
   * Calendar-time trend for the signed % error chart. Today's snapshot lives
   * inside `summary.errorByBucket`; `history` carries the previous days. We
   * splice today's value into the trend so the user sees the line up to and
   * including the current snapshot even before the daily save effect fires.
   */
  const errorTrendClose = useMemo(() => {
    const todayDate = summary?.evaluatedAt
      ? summary.evaluatedAt.slice(0, 10)
      : null;
    const merged: MissedOppDailySnapshot[] =
      summary && todayDate
        ? [
            ...history.filter((h) => h.date !== todayDate),
            {
              date: todayDate,
              recallPct: summary.recallPct,
              missedN: summary.missedN,
              detectedN: summary.detectedN,
              gainersN: summary.gainersN,
              errorClose: summary.errorByBucket.close,
              errorFar: summary.errorByBucket.far,
            } satisfies MissedOppDailySnapshot,
          ]
        : history;
    return buildMissedOppErrorTrend(merged, "close");
  }, [history, summary]);

  const errorTrendFar = useMemo(() => {
    const todayDate = summary?.evaluatedAt
      ? summary.evaluatedAt.slice(0, 10)
      : null;
    const merged: MissedOppDailySnapshot[] =
      summary && todayDate
        ? [
            ...history.filter((h) => h.date !== todayDate),
            {
              date: todayDate,
              recallPct: summary.recallPct,
              missedN: summary.missedN,
              detectedN: summary.detectedN,
              gainersN: summary.gainersN,
              errorClose: summary.errorByBucket.close,
              errorFar: summary.errorByBucket.far,
            } satisfies MissedOppDailySnapshot,
          ]
        : history;
    return buildMissedOppErrorTrend(merged, "far");
  }, [history, summary]);

  const liveEvaluations = useMemo(() => {
    if (!simTable?.rows?.length) return [];
    return buildDecisionSimEvaluations({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang: lang === "it" ? "it" : "en",
      probOptions,
      paperPortfolio: decisionSimState.paperPortfolio,
    });
  }, [simTable, inputs, pointsBySeriesKey, lang, probOptions, decisionSimState.paperPortfolio]);

  const { piggy: livePiggy } = useLiveExperimentPiggy(
    decisionSimState.paperPortfolio,
    liveEvaluations,
    decisionSimState.cumulativePaperPnlEur,
    decisionSimState.closedTradeCount,
  );

  const simPnlDaily = useMemo(() => {
    const liveTotal = resolveLiveSimLoopTotalPnl(
      decisionSimState.ticks,
      livePiggy.totalPnlEur,
    );
    return buildDecisionSimPnlDailySeries(decisionSimState.ticks, liveTotal);
  }, [decisionSimState.ticks, livePiggy.totalPnlEur]);

  const pnlDailyWithSim = useMemo(
    () => mergeMissedOppDailyWithSimLoop(pnlDailyData, simPnlDaily),
    [pnlDailyData, simPnlDaily],
  );

  /**
   * Fair-window comparison between the real portfolio and the paper sim loop.
   *
   * Background: `pnlActualEur` is a single-day snapshot — the open portfolio's
   * 24h move on today's date — while `livePiggy.totalPnlEur` is the running
   * cumulative paper P&L since the sim loop was started (which usually spans
   * many days). Previously the panel rendered the first as "ACTUAL PORTFOLIO
   * GAIN" next to the second as "SIM LOOP EXPERIMENT GAIN", which made the
   * actual side look much smaller even on days the real portfolio outperformed
   * the sim loop within the same 24h. To remove the apples-to-oranges
   * comparison we re-aggregate both sides over the exact same calendar window
   * — the dates for which an actual snapshot exists in localStorage — and
   * surface the sim loop's full-history total separately as additional
   * context.
   */
  const matchedComparison = useMemo(() => {
    if (!pnlDailyData.length) {
      const fallbackActual = pnlActualEur ?? 0;
      return {
        actualCumEur: fallbackActual,
        simLoopCumEur: 0,
        matchedDays: pnlActualEur != null ? 1 : 0,
        firstDate: null as string | null,
        lastDate: null as string | null,
      };
    }
    const simByDate = new Map(
      simPnlDaily.map((s) => [s.date.length >= 10 ? s.date.slice(5) : s.date, s.daySimLoop]),
    );
    let actualCumEur = 0;
    let simLoopCumEur = 0;
    for (const d of pnlDailyData) {
      actualCumEur += d.dayActual ?? 0;
      simLoopCumEur += simByDate.get(d.date) ?? 0;
    }
    return {
      actualCumEur,
      simLoopCumEur,
      matchedDays: pnlDailyData.length,
      firstDate: pnlDailyData[0]?.date ?? null,
      lastDate: pnlDailyData[pnlDailyData.length - 1]?.date ?? null,
    };
  }, [pnlDailyData, simPnlDaily, pnlActualEur]);

  const pnlTrendWithSim = useMemo(
    () => mergeMissedOppTrendWithSimLoop(pnlTrendData, simPnlDaily),
    [pnlTrendData, simPnlDaily],
  );

  const pnlLineDefs = useMemo(() => buildMissedOppPnlLineDefs(t), [t]);
  const improvement = useMemo(
    () => summarizeMissedOppImprovement(history, summary, pnlActualEur),
    [history, summary, pnlActualEur],
  );

  const portfolioTickers = useMemo(() => {
    if (!simTable?.rows?.length) return [];
    return simTable.rows
      .filter((r) => rowHasActivePortfolio(r, inputs))
      .map((r) => String(r.Ticker ?? "").trim().toUpperCase())
      .filter((t) => t && !t.includes("TOTALE"));
  }, [simTable, inputs]);

  const vsSimLoopInsight = useMemo(
    () =>
      buildPortfolioVsSimLoopInsight({
        pnlActualEur,
        simLoopTotalEur: livePiggy.totalPnlEur,
        dailyWithSim: pnlDailyWithSim,
        scorecard: decisionSimState.scorecard,
        paperPortfolio: decisionSimState.paperPortfolio,
        portfolioTickers,
        gapVsFairRecToday: improvement.gapVsFairRecToday,
      }),
    [
      pnlActualEur,
      livePiggy.totalPnlEur,
      pnlDailyWithSim,
      decisionSimState.scorecard,
      decisionSimState.paperPortfolio,
      portfolioTickers,
      improvement.gapVsFairRecToday,
    ],
  );

  const calibrationPlan = useMemo(() => {
    if (!summary || summary.missedN === 0) return null;
    return buildMissedOppCalibrationPlan(summary, lang === "it" ? "it" : "en");
  }, [summary, lang]);

  const rowByKey = useMemo(
    () => (simTable?.rows?.length ? buildSimRowByKeyMap(simTable.rows) : new Map()),
    [simTable?.rows],
  );

  const mergedInputs = useMemo(
    () => reconcileInvestSimInputs(inputs, simTable?.rows ?? []),
    [inputs, simTable?.rows],
  );

  const selectedPatternRec = useMemo(() => {
    if (!selectedRow) return null;
    const simRow = rowByKey.get(selectedRow.key) ?? null;
    if (!simRow) return null;
    const sk = simulationRowSeriesKey(simRow);
    const pts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
    return buildCdPatternTickerRecommendation({
      row: simRow,
      chartPoints: pts,
      investInputs: mergedInputs,
      sdsRows: sdsRows ?? undefined,
      migByKey: migSolidityByKey,
      lang: lang === "it" ? "it" : "en",
      includeEis: true,
      eisSuperScoreState: eisState,
    });
  }, [
    selectedRow,
    rowByKey,
    pointsBySeriesKey,
    mergedInputs,
    sdsRows,
    migSolidityByKey,
    lang,
    eisState,
  ]);

  if (!simTable?.rows?.length) {
    return (
      <p className="text-sm text-ink-muted py-4 text-center">{t("modelLab.missedOpp.emptySim")}</p>
    );
  }

  if (chartsLoading && !summary) {
    return (
      <p className="text-sm text-ink-muted py-4 text-center">{t("modelLab.missedOpp.loading")}</p>
    );
  }

  if (!summary || summary.with24hN === 0) {
    return (
      <p className="text-sm text-ink-muted py-4 text-center">{t("modelLab.missedOpp.no24h")}</p>
    );
  }

  const oppGainers = summary.detectedN + summary.missedN;
  const excludedGainers = summary.gainersN - oppGainers;
  const operationalWord = t(
    oppGainers === 1
      ? "modelLab.missedOpp.funnelOperationalOne"
      : "modelLab.missedOpp.funnelOperationalMany",
  );
  const missedWord = t(
    summary.missedN === 1
      ? "modelLab.missedOpp.funnelMissedOne"
      : "modelLab.missedOpp.funnelMissedMany",
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/40 px-3 py-2.5 space-y-1">
        <p className="text-[11px] font-medium text-ink">{t("modelLab.missedOpp.introTitle")}</p>
        <p className="text-[11px] leading-relaxed text-ink-muted">{t("modelLab.missedOpp.introBody")}</p>
      </div>


      <div
        className="rounded-lg border border-[rgb(var(--border))]/50 bg-[rgb(var(--surface-3))]/20 px-3 py-2 space-y-0.5"
        title={t("modelLab.missedOpp.funnelLineTip")}
      >
        <p className="text-[11px] font-semibold tabular-nums text-ink leading-snug">
          {t("modelLab.missedOpp.funnelLine", {
            total: summary.gainersN,
            operational: oppGainers,
            operationalWord,
            missed: summary.missedN,
            missedWord,
          })}
        </p>
        {excludedGainers > 0 ? (
          <p className="text-[10px] text-ink-muted tabular-nums leading-snug">
            {t("modelLab.missedOpp.funnelExcluded", {
              excluded: excludedGainers,
              held: summary.heldGainerN,
              cdDistant: summary.cdDistantGainerN,
              outside: summary.outsideWindowGainerN,
            })}
          </p>
        ) : null}
        {summary.watchGainerN > 0 ? (
          <p className="text-[10px] text-ink-muted tabular-nums leading-snug">
            {t("modelLab.missedOpp.funnelWatchLine", {
              recall: summary.watchRecallPct != null ? summary.watchRecallPct.toFixed(0) : "—",
              detected: summary.watchDetectedN,
              total: summary.watchGainerN,
            })}
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">{t("modelLab.missedOpp.chartPnlTitle")}</h3>
          <p className="text-[10px] text-ink-muted">
            {t("modelLab.missedOpp.chartPnlSub", { capital: MISSED_OPP_CAPITAL_EUR.toLocaleString("it-IT") })}
          </p>
          <p className="text-[9px] text-ink-muted/80 mt-0.5">{t("modelLab.missedOpp.chartPnlSnapshotNote")}</p>
        </div>

        {improvement.daysTracked >= 1 ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-md border border-[rgb(var(--border))]/40 bg-surface/30 p-3">
              <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/50 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">
                  {lang === "it"
                    ? `Portafoglio reale · cumulativo ${matchedComparison.matchedDays}g`
                    : `Actual portfolio · ${matchedComparison.matchedDays}-day cumulative`}
                </p>
                <p
                  className={`text-2xl font-bold tabular-nums ${
                    matchedComparison.actualCumEur === 0
                      ? "text-ink-muted"
                      : matchedComparison.actualCumEur > 0
                        ? "text-[rgb(var(--signal-up))]"
                        : "text-[rgb(var(--signal-down))]"
                  }`}
                >
                  {fmtEur(matchedComparison.actualCumEur)}
                </p>
                <p className="text-[9px] text-ink-muted/85 mt-1 leading-snug">
                  {lang === "it"
                    ? "Somma movimenti 24h giorno per giorno — non è il P&L MTM Piggy Bank."
                    : "Sum of daily 24h moves — not Piggy Bank MTM total."}
                </p>
                {pnlDailyWithSim.length > 0 && pnlDailyWithSim[pnlDailyWithSim.length - 1]?.dayActual != null ? (
                  <p className="text-[10px] text-ink-muted mt-1">
                    <span className="font-medium">{lang === "it" ? "Ultime 24h:" : "Last 24h:"}</span>{" "}
                    <span
                      className={`font-semibold tabular-nums ${
                        (pnlDailyWithSim[pnlDailyWithSim.length - 1]?.dayActual ?? 0) >= 0
                          ? "text-[rgb(var(--signal-up))]"
                          : "text-[rgb(var(--signal-down))]"
                      }`}
                    >
                      {fmtEur(pnlDailyWithSim[pnlDailyWithSim.length - 1]?.dayActual)}
                    </span>
                  </p>
                ) : null}
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/50 px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-muted mb-1">
                  {lang === "it"
                    ? `Sim loop · cumulativo ${matchedComparison.matchedDays}g (stessa finestra)`
                    : `Sim loop · ${matchedComparison.matchedDays}-day cumulative (matched window)`}
                </p>
                <p
                  className={`text-2xl font-bold tabular-nums ${
                    matchedComparison.simLoopCumEur === 0
                      ? "text-ink-muted"
                      : matchedComparison.simLoopCumEur > 0
                        ? "text-[rgb(var(--signal-up))]"
                        : "text-[rgb(var(--signal-down))]"
                  }`}
                >
                  {fmtEur(matchedComparison.simLoopCumEur)}
                </p>
                <p className="text-[9px] text-ink-muted/85 mt-1 leading-snug">
                  {lang === "it"
                    ? "Somma gain 24h paper per tick — universo sim loop, non portafoglio reale."
                    : "Sum of paper 24h gains per tick — sim loop universe, not real portfolio."}
                </p>
                {pnlDailyWithSim.length > 0 && pnlDailyWithSim[pnlDailyWithSim.length - 1]?.daySimLoop != null ? (
                  <p className="text-[10px] text-ink-muted mt-1">
                    <span className="font-medium">{lang === "it" ? "Ultime 24h:" : "Last 24h:"}</span>{" "}
                    <span
                      className={`font-semibold tabular-nums ${
                        (pnlDailyWithSim[pnlDailyWithSim.length - 1]?.daySimLoop ?? 0) >= 0
                          ? "text-[rgb(var(--signal-up))]"
                          : "text-[rgb(var(--signal-down))]"
                      }`}
                    >
                      {fmtEur(pnlDailyWithSim[pnlDailyWithSim.length - 1]?.daySimLoop)}
                    </span>
                  </p>
                ) : null}
                {vsSimLoopInsight.summary.simLoopTotalEur != null &&
                Math.abs(
                  (vsSimLoopInsight.summary.simLoopTotalEur ?? 0) -
                    matchedComparison.simLoopCumEur,
                ) > 0.5 ? (
                  <p
                    className="text-[10px] text-ink-muted/85 mt-1 leading-snug"
                    title={
                      lang === "it"
                        ? "Totale dell'intero esperimento sim loop, anche sui giorni in cui la dashboard non è stata aperta."
                        : "Total across the entire sim loop experiment, including days the dashboard wasn't opened."
                    }
                  >
                    {lang === "it" ? "Intero esperimento: " : "Full experiment: "}
                    <span
                      className={`font-semibold tabular-nums ${
                        vsSimLoopInsight.summary.simLoopTotalEur >= 0
                          ? "text-[rgb(var(--signal-up))]"
                          : "text-[rgb(var(--signal-down))]"
                      }`}
                    >
                      {fmtEur(vsSimLoopInsight.summary.simLoopTotalEur)}
                    </span>
                  </p>
                ) : null}
              </div>
            </div>
            <p className="text-[10px] text-ink-muted/85 leading-snug px-1">
              {lang === "it" ? (
                <>
                  Confronto su una <strong>finestra coerente</strong>:{" "}
                  <span className="tabular-nums">{matchedComparison.matchedDays}</span>{" "}
                  giorno/i di snapshot reali
                  {matchedComparison.firstDate
                    ? ` dal ${matchedComparison.firstDate}`
                    : ""}
                  . Il portafoglio reale traccia solo i giorni in cui apri la dashboard
                  (snapshot salvata in localStorage); il sim loop accumula in
                  continuo. Per evitare un confronto 1 giorno vs N giorni i due
                  totali sopra sommano <strong>le stesse giornate</strong>.
                </>
              ) : (
                <>
                  Comparison over a <strong>matched window</strong>:{" "}
                  <span className="tabular-nums">{matchedComparison.matchedDays}</span>{" "}
                  day(s) of real snapshots
                  {matchedComparison.firstDate
                    ? ` since ${matchedComparison.firstDate}`
                    : ""}
                  . The actual portfolio only tracks days when you opened the
                  dashboard (snapshot saved to localStorage); the sim loop runs
                  continuously. To avoid a 1-day-vs-N-days mismatch the two
                  totals above sum the <strong>same calendar days</strong>.
                </>
              )}
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-stretch">
          <div className="min-w-0 space-y-0.5">
            <h4 className="text-[10px] font-medium text-ink">{t("modelLab.missedOpp.chartPnlDailyTitle")}</h4>
            <p className="text-[8px] text-ink-muted leading-snug">{t("modelLab.missedOpp.chartPnlDailySub")}</p>
            {pnlDailyWithSim.length ? (
              <MissedOppPnlLineChart
                data={pnlDailyWithSim.map((d) => ({
                  date: d.date,
                  allGainers: d.dayAllGainers,
                  simLoop: d.daySimLoop,
                  fairRecommendations: d.dayFairRecommendations,
                  actual: d.dayActual,
                }))}
                lines={pnlLineDefs}
                height={MISSED_OPP_PNL_PAIR_CHART_HEIGHT_LG}
                curveType="monotone"
              />
            ) : (
              <p className="text-xs text-ink-muted py-4 text-center">{t("modelLab.missedOpp.trendPending")}</p>
            )}
          </div>

          <div className="min-w-0 space-y-0.5 md:border-l md:border-[rgb(var(--border))]/35 md:pl-3">
            <h4 className="text-[10px] font-medium text-ink">{t("modelLab.missedOpp.chartPnlCumTitle")}</h4>
            <p className="text-[8px] text-ink-muted leading-snug">{t("modelLab.missedOpp.chartPnlCumSub")}</p>
            {pnlTrendWithSim.length ? (
              <MissedOppPnlLineChart
                data={pnlTrendWithSim.map((d) => ({
                  date: d.date,
                  allGainers: d.cumAllGainers,
                  simLoop: d.cumSimLoop,
                  fairRecommendations: d.cumFairRecommendations,
                  actual: d.cumActual,
                }))}
                lines={pnlLineDefs}
                height={MISSED_OPP_PNL_PAIR_CHART_HEIGHT_LG}
                curveType="natural"
                areaFill
              />
            ) : (
              <p className="text-xs text-ink-muted py-4 text-center">{t("modelLab.missedOpp.trendPending")}</p>
            )}
          </div>
        </div>
      </div>

      {calibrationPlan?.actions.length ? (
        <div className="rounded-lg border border-[rgb(var(--accent))]/30 bg-[rgb(var(--accent))]/5 p-3 space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-[rgb(var(--accent))]">
              {t("modelLab.missedOpp.calibrationTitle")}
            </h3>
            <p className="text-[10px] text-ink-muted">{t("modelLab.missedOpp.calibrationSub")}</p>
          </div>
          <ul className="space-y-2">
            {calibrationPlan.actions.map((action) => (
              <li
                key={action.id}
                className="rounded-md border border-[rgb(var(--border))]/50 bg-white/80 dark:bg-surface/60 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      action.priority === "high"
                        ? "bg-[rgb(var(--signal-down))]/15 text-[rgb(var(--signal-down))]"
                        : action.priority === "medium"
                          ? "bg-[rgb(var(--warn))]/15 text-[rgb(var(--warn))]"
                          : "bg-surface text-ink-muted"
                    }`}
                  >
                    {action.priority}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-ink">
                      {lang === "it" ? action.titleIt : action.titleEn}
                    </p>
                    <p className="text-[10px] text-ink-muted leading-snug mt-0.5">
                      {lang === "it" ? action.detailIt : action.detailEn}
                    </p>
                    {action.param ? (
                      <p className="text-[9px] text-ink-muted mt-1 tabular-nums">
                        {action.param}: {action.currentValue ?? "—"}
                        {action.suggestedValue ? ` → ${action.suggestedValue}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.blockerStats.length ? (
        <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 space-y-2">
          <div>
            <h3 className="text-sm font-semibold">{t("modelLab.missedOpp.blockersTitle")}</h3>
            <p className="text-[10px] text-ink-muted">{t("modelLab.missedOpp.blockersSub")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {summary.blockerStats.map((b) => (
              <span
                key={b.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--border))]/50 bg-surface/60 px-2.5 py-1 text-[10px]"
              >
                <span className="font-semibold tabular-nums text-[rgb(var(--warn))]">{b.count}</span>
                <span className="text-ink-muted">{lang === "it" ? b.labelIt : b.labelEn}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 space-y-3">
        <div>
          <h3 className="text-sm font-semibold">
            {t("modelLab.missedOpp.errorTrendSectionTitle")}
          </h3>
          <p className="text-[10px] text-ink-muted">
            {t("modelLab.missedOpp.errorTrendSectionSub")}
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="min-w-0 rounded-md border border-[rgb(var(--border))]/40 bg-surface/30 p-2 space-y-1">
            <h4 className="text-[11px] font-semibold text-ink">
              {t("modelLab.missedOpp.errorTrendCloseTitle")}
            </h4>
            <MissedOppErrorTrendChart
              points={errorTrendClose}
              bucketLabel={t("modelLab.missedOpp.errorTrendCloseTitle")}
              lang={lang === "it" ? "it" : "en"}
              height={240}
            />
          </div>
          <div className="min-w-0 rounded-md border border-[rgb(var(--border))]/40 bg-surface/30 p-2 space-y-1">
            <h4 className="text-[11px] font-semibold text-ink">
              {t("modelLab.missedOpp.errorTrendFarTitle")}
            </h4>
            <MissedOppErrorTrendChart
              points={errorTrendFar}
              bucketLabel={t("modelLab.missedOpp.errorTrendFarTitle")}
              lang={lang === "it" ? "it" : "en"}
              height={240}
            />
          </div>
        </div>
      </div>

      {summary.missedRows.length || summary.watchMissedRows.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {summary.missedRows.length ? (
            <div className="rounded-lg border border-[rgb(var(--border))]/50 overflow-hidden">
              <div className="px-3 py-2 border-b border-[rgb(var(--border))]/40 bg-surface/40">
                <h3 className="text-sm font-semibold">{t("modelLab.missedOpp.tableTitle")}</h3>
                <p className="text-[10px] text-ink-muted">{t("modelLab.missedOpp.tableSub")}</p>
              </div>
              <div className="p-3 bg-surface/20">
                <MissedGainersScatterChart
                  rows={summary.missedRows}
                  onSelect={setSelectedRow}
                  height={220}
                />
              </div>
          <details className="border-t border-[rgb(var(--border))]/40">
            <summary className="cursor-pointer px-3 py-2 bg-surface/30 hover:bg-surface/50 transition text-[11px] font-medium text-ink-muted">
              {t("modelLab.missedOpp.showTableDetail")} ({summary.missedRows.length})
            </summary>
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-surface/95 z-10">
                  <tr className="text-left text-ink-muted border-b border-[rgb(var(--border))]/40">
                    <th className="py-2 px-2 font-medium">Ticker</th>
                    <th className="py-2 px-2 font-medium text-right">24h</th>
                    <th className="py-2 px-2 font-medium text-right">P(plan)</th>
                    <th className="py-2 px-2 font-medium text-right">Target</th>
                    <th className="py-2 px-2 font-medium text-right">Match</th>
                    <th className="py-2 px-2 font-medium">{t("modelLab.missedOpp.colBlockers")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.missedRows.slice(0, 25).map((row) => (
                    <tr
                      key={row.key}
                      className="border-b border-[rgb(var(--border))]/25 hover:bg-surface/30 cursor-pointer"
                      onClick={() => setSelectedRow(row)}
                    >
                      <td className="py-1.5 px-2 font-medium">
                        {row.ticker}
                        {row.daysToCd != null ? (
                          <span className="text-[9px] text-ink-muted ml-1">
                            T{row.daysToCd >= 0 ? "+" : ""}
                            {row.daysToCd}d
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[rgb(var(--signal-up))]">
                        {fmtPct(row.dailyPct24h)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {row.probPct != null ? `${row.probPct.toFixed(0)}%` : "—"}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{fmtPct(row.planReturnPct)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {row.matchPct != null ? `${Math.round(row.matchPct)}%` : "—"}
                      </td>
                      <td className="py-1.5 px-2 text-ink-muted leading-snug">
                        {row.blockers.slice(0, 2).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
            </div>
          ) : null}

          {summary.watchMissedRows.length ? (
            <div className="rounded-lg border border-[rgb(var(--border))]/50 overflow-hidden">
              <div className="px-3 py-2 border-b border-[rgb(var(--border))]/40 bg-surface/40">
                <h3 className="text-sm font-semibold">{t("modelLab.missedOpp.watchTableTitle")}</h3>
                <p className="text-[10px] text-ink-muted">{t("modelLab.missedOpp.watchTableSub")}</p>
              </div>
              <div className="p-3 bg-surface/20">
                <MissedGainersScatterChart
                  rows={summary.watchMissedRows}
                  onSelect={setSelectedRow}
                  height={220}
                />
              </div>
          <details className="border-t border-[rgb(var(--border))]/40">
            <summary className="cursor-pointer px-3 py-2 bg-surface/30 hover:bg-surface/50 transition text-[11px] font-medium text-ink-muted">
              {t("modelLab.missedOpp.showTableDetail")} ({summary.watchMissedRows.length})
            </summary>
            <div className="overflow-x-auto max-h-64 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-surface/95 z-10">
                  <tr className="text-left text-ink-muted border-b border-[rgb(var(--border))]/40">
                    <th className="py-2 px-2 font-medium">Ticker</th>
                    <th className="py-2 px-2 font-medium text-right">24h</th>
                    <th className="py-2 px-2 font-medium text-right">P(plan)</th>
                    <th className="py-2 px-2 font-medium text-right">Target</th>
                    <th className="py-2 px-2 font-medium text-right">Match</th>
                    <th className="py-2 px-2 font-medium">{t("modelLab.missedOpp.colBlockers")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.watchMissedRows.slice(0, 25).map((row) => (
                    <tr
                      key={row.key}
                      className="border-b border-[rgb(var(--border))]/25 hover:bg-surface/30 cursor-pointer"
                      onClick={() => setSelectedRow(row)}
                    >
                      <td className="py-1.5 px-2 font-medium">
                        {row.ticker}
                        {row.daysToCd != null ? (
                          <span className="text-[9px] text-ink-muted ml-1">
                            T{row.daysToCd >= 0 ? "+" : ""}
                            {row.daysToCd}d
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-[rgb(var(--signal-up))]">
                        {fmtPct(row.dailyPct24h)}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {row.probPct != null ? `${row.probPct.toFixed(0)}%` : "—"}
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{fmtPct(row.planReturnPct)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">
                        {row.matchPct != null ? `${Math.round(row.matchPct)}%` : "—"}
                      </td>
                      <td className="py-1.5 px-2 text-ink-muted leading-snug">
                        {row.blockers.slice(0, 2).join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
            </div>
          ) : null}
        </div>
      ) : null}

      <MissedOpportunityDetailDrawer
        open={selectedRow != null}
        row={selectedRow}
        patternRec={selectedPatternRec}
        onClose={() => setSelectedRow(null)}
      />
    </div>
  );
}
