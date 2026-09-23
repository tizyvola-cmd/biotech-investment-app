import { useEffect, useMemo, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle, loadSimulationChartsBundle, simulationRowSeriesKey } from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import { useLang, useT } from "../shared/i18n";
import {
  buildMissedOppErrorTrend,
  buildMissedOpportunityAudit,
  loadMissedOppHistory,
  saveMissedOppSnapshot,
  type MissedOppDailySnapshot,
  type MissedOppRow,
  type MissedOpportunitySummary,
} from "../sheet/missedOpportunityAudit";
import { buildCdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";
import { buildSimRowByKeyMap, reconcileInvestSimInputs } from "../sheet/investSimKeys";
import { MissedOpportunityDetailDrawer } from "./MissedOpportunityDetailDrawer";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import type { SdsRow } from "../api/supernova";
import { loadSdsCohort } from "../api/supernova";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import { buildPortfolioDailyPnlLedger } from "../sheet/simulationPosition";
import { MissedGainersScatterChart } from "./MissedGainersScatterChart";
import { MissedOppErrorTrendChart } from "./MissedOppErrorTrendChart";
import { AdviceErrorChartsCard } from "./DecisionSimChartStrip";
import { buildMonitorAdviceCalibrationPoints } from "./DecisionSimAdviceCalibrationPanel";
import {
  prepareAdviceCalibrationPoints,
  useStableAdviceCalibrationPoints,
} from "../hooks/useStableAdviceCalibrationPoints";
import { buildSuggestionMonitorRows } from "../sheet/suggestionMonitor";
import type { TickerSimEvaluation } from "../sheet/investDecisionSimLoop";
import {
  DECISION_SIM_CHANGED_EVENT,
  loadDecisionSimState,
  type DecisionSimState,
} from "../sheet/investDecisionSimStorage";

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
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

  // BUY/SELL advice-error chart — moved here from the home dashboard.
  // Rebuilds the same suggestion-monitor + calibration-points pipeline that
  // DashboardChartsRow used to compute, so the chart behaves identically.
  const monitorRows = useMemo(() => {
    if (!simTable?.rows?.length) return [];
    return buildSuggestionMonitorRows({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang: lang === "it" ? "it" : "en",
      probOptions,
      paperPortfolio: decisionSimState.paperPortfolio,
    });
  }, [simTable, inputs, pointsBySeriesKey, lang, probOptions, decisionSimState.paperPortfolio]);

  const liveEvaluations = useMemo(
    () => monitorRows as TickerSimEvaluation[],
    [monitorRows],
  );

  const adviceCalibrationPoints = useStableAdviceCalibrationPoints(
    useMemo(
      () =>
        prepareAdviceCalibrationPoints(
          buildMonitorAdviceCalibrationPoints({
            monitorRows,
            paperPortfolio: decisionSimState.paperPortfolio,
            decisionSimTicks: decisionSimState.ticks,
            adviceLog: decisionSimState.adviceLog,
            liveEvaluations,
            simTable,
            lang: lang === "it" ? "it" : "en",
          }),
        ),
      [
        monitorRows,
        decisionSimState.paperPortfolio,
        decisionSimState.ticks,
        decisionSimState.adviceLog,
        liveEvaluations,
        simTable,
        lang,
      ],
    ),
  );

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

      {/* BUY/SELL advice-error chart — moved from the home dashboard. */}
      <AdviceErrorChartsCard
        points={adviceCalibrationPoints}
        lang={lang === "it" ? "it" : "en"}
        className="min-w-0"
      />

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
