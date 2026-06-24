import { useEffect, useMemo, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import { chartSeriesReady, peekSimulationChartsBundle } from "../data/simulationCharts";
import { buildCdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";
import { buildMigSolidityByKey, buildMigResultByKey, migSolidityKey } from "../sheet/entrySolidityMig";
import { SimulationSparkline } from "../sheet/simulationSparkline";
import { SlopeTrajectoryChart } from "./SlopeTrajectoryChart";
import { buildSlopeTrajectory, canRenderSlopeTrajectory } from "../sheet/slopeRecalibCurve";
import { daysFromToday } from "../sheet/simulationPlanGain";
import { dailyChangePctFromRow } from "../sheet/simulationPosition";
import type { RecommendationAlertPayload } from "../sheet/recommendationAlerts";
import {
  buildSuggestionPipelineSteps,
  suggestedActionLabel,
  uiSuggestedAction,
  type SuggestionMonitorRow,
  type SuggestionPipelineStep,
} from "../sheet/suggestionMonitor";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import {
  PortfolioGainPlanSingleChart,
  buildPortfolioGainPlanRowFromSim,
} from "./PortfolioGainPlanChart";
import { SlopeVerdictBanner } from "./SlopeVerdictBanner";
import { slopeVerdictContextFromSlopes } from "../sheet/slopeVerdictContext";
import { PortfolioTickerMark } from "./PortfolioScopeToggle";
import { PlanProbHero } from "./PlanProbHero";
import { CdPatternArcPanel } from "./CdPatternArcPanel";
import { PortfolioPlanTargetChip } from "./PortfolioPlanTargetChip";
import type { StabilityVerdict } from "../sheet/slopeStability";
import { loadEisSuperScoreState, type EisSuperScoreState } from "../api/eisSuperScore";
import { planProbDecisionForDisplay } from "../sheet/investDecisionSimLoop";
import { topCompositeDrivers } from "../lib/scoring/compositeScore";
import { useLang, useT } from "../shared/i18n";
import { ModalChartTile } from "./ModalChartTile";
import { ModalChartHorizonBanner } from "./ModalChartHorizonBanner";
import { MigMarketModelSlopesCard } from "./MigMarketModelSlopesCard";
import {
  modalGainPlanCaption,
  modalGainPlanMarkerLabel,
  modalMiiCaption,
  modalPatternCaption,
  modalPredSparklineCaption,
  modalSlopeTrajectoryCaption,
} from "../sheet/modalChartCaptions";

const MODAL_CHART_H = 168;

function stepToneClass(tone: SuggestionPipelineStep["tone"]): string {
  switch (tone) {
    case "good":
      return "border-emerald-500/30 bg-emerald-500/8";
    case "bad":
      return "border-rose-500/30 bg-rose-500/8";
    case "warn":
      return "border-amber-500/30 bg-amber-500/8";
    default:
      return "border-[rgb(var(--border))]/40 bg-surface/40";
  }
}

function actionTheme(action: "buy" | "sell" | "hold" | "review") {
  if (action === "buy") {
    return {
      icon: "📈",
      shellBorder: "border-emerald-500/45",
      headerBorder: "border-emerald-500/25",
      headerBg: "bg-emerald-500/8",
      titleClass: "text-emerald-800 dark:text-emerald-200",
      badge: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-emerald-500/35",
    };
  }
  if (action === "hold") {
    return {
      icon: "⏳",
      shellBorder: "border-sky-500/45",
      headerBorder: "border-sky-500/25",
      headerBg: "bg-sky-500/8",
      titleClass: "text-sky-900 dark:text-sky-100",
      badge: "bg-sky-500/15 text-sky-900 dark:text-sky-100 border-sky-500/35",
    };
  }
  if (action === "review") {
    return {
      icon: "⚖️",
      shellBorder: "border-amber-500/50",
      headerBorder: "border-amber-500/30",
      headerBg: "bg-amber-500/10",
      titleClass: "text-amber-900 dark:text-amber-100",
      badge: "bg-amber-500/15 text-amber-900 dark:text-amber-100 border-amber-500/40",
    };
  }
  return {
    icon: "📉",
    shellBorder: "border-rose-500/45",
    headerBorder: "border-rose-500/25",
    headerBg: "bg-rose-500/8",
    titleClass: "text-rose-800 dark:text-rose-200",
    badge: "bg-rose-500/15 text-rose-800 dark:text-rose-200 border-rose-500/35",
  };
}

export function RecommendationAlertModal({
  open,
  alerts,
  activeIndex,
  onActiveIndexChange,
  monitorRow,
  simTable,
  inputs = {},
  chartsBundle: chartsBundleProp,
  sdsRows,
  onClose,
  onOpenSimulationRow,
  onTrimToSynth,
}: {
  open: boolean;
  alerts: RecommendationAlertPayload[];
  activeIndex: number;
  onActiveIndexChange: (idx: number) => void;
  monitorRow: SuggestionMonitorRow | null;
  simTable: SheetTable | null;
  inputs?: InvestSimInputs;
  chartsBundle?: ChartBundle | null;
  sdsRows?: SdsRow[] | null;
  onClose: () => void;
  onOpenSimulationRow: (ticker: string, cd?: string, opts?: { syncToSynth?: boolean }) => void;
  onTrimToSynth?: (rowKey: string) => void;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";
  const history = useInvestSimPortfolioHistory().history;
  const chartsBundle =
    chartsBundleProp !== undefined ? chartsBundleProp : peekSimulationChartsBundle();

  const alert = alerts[activeIndex] ?? null;

  const simRow = useMemo(() => {
    if (!alert || !simTable?.rows?.length) return null;
    return buildSimRowByKeyMap(simTable.rows).get(alert.key) ?? null;
  }, [alert, simTable]);

  const chartPts = useMemo(() => {
    if (!alert?.seriesKey || !chartsBundle?.series) return null;
    return chartsBundle.series[alert.seriesKey]?.points ?? null;
  }, [alert?.seriesKey, chartsBundle]);

  const chartsReady = !alert?.seriesKey || chartSeriesReady(chartsBundle, alert.seriesKey);

  const [eisSuperScoreState, setEisSuperScoreState] = useState<EisSuperScoreState | null>(null);

  useEffect(() => {
    void loadEisSuperScoreState().then(setEisSuperScoreState);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const migSolidityByKey = useMemo(
    () => buildMigSolidityByKey(simTable, chartsBundle, sdsRows),
    [simTable, chartsBundle, sdsRows],
  );

  const migResultByKey = useMemo(
    () => buildMigResultByKey(simTable, chartsBundle, sdsRows),
    [simTable, chartsBundle, sdsRows],
  );

  const migRow = useMemo(() => {
    if (!alert) return null;
    return migResultByKey.get(migSolidityKey(alert.ticker, alert.completionDate)) ?? null;
  }, [alert, migResultByKey]);

  const slopeTrajectory = useMemo(() => {
    if (!simRow || !chartPts?.length || !chartsReady) return null;
    const days = daysFromToday(alert?.completionDate ?? "") ?? 30;
    if (!canRenderSlopeTrajectory({ chartPoints: chartPts, simRow, daysToCd: days })) {
      return null;
    }
    return buildSlopeTrajectory({ chartPoints: chartPts, simRow, daysToCd: days });
  }, [simRow, chartPts, alert?.completionDate, chartsReady]);

  const patternRec = useMemo(() => {
    if (!alert || !simRow || !simTable?.rows?.length) return null;
    return buildCdPatternTickerRecommendation({
      row: simRow,
      chartPoints: chartPts,
      investInputs: inputs,
      sdsRows,
      migByKey: migSolidityByKey,
      lang: it ? "it" : "en",
      includeEis: true,
      eisSuperScoreState,
    });
  }, [alert, simRow, simTable, chartPts, inputs, sdsRows, migSolidityByKey, it, eisSuperScoreState]);

  const gainPlanRow = useMemo(() => {
    if (!alert || !simRow) return null;
    return buildPortfolioGainPlanRowFromSim(alert.key, simRow, inputs, history, chartPts);
  }, [alert, simRow, inputs, history, chartPts]);

  const pipelineSteps = useMemo(() => {
    if (!monitorRow) return [];
    if (monitorRow.pipelineSteps.length > 0) return monitorRow.pipelineSteps;
    return buildSuggestionPipelineSteps(monitorRow, it ? "it" : "en");
  }, [monitorRow, it]);

  if (!open || !alert || !monitorRow) return null;

  if (!chartsReady) {
    return (
      <div
        className="fixed inset-0 z-[69] flex items-center justify-center bg-black/60 p-3 sm:p-4"
        role="presentation"
        aria-busy="true"
      >
        <p className="text-sm text-ink-muted bg-surface/95 px-4 py-3 rounded-lg border border-[rgb(var(--border))]/50 shadow-lg">
          {t("recommendationAlert.preparing")}
        </p>
      </div>
    );
  }

  const portfolioHoldDisplay =
    monitorRow.hasPosition && alert.suggestedAction === "buy";
  const uiAction = uiSuggestedAction(
    alert.suggestedAction === "review" ? "review" : alert.suggestedAction,
    monitorRow.hasPosition,
  );
  const theme = actionTheme(uiAction as "buy" | "sell" | "hold" | "review");
  const isSynthAlert = alert.alertKind === "synth_trim" || alert.alertKind === "synth_sell";
  const synthRationale = monitorRow.synthExposureRationale;
  const hasMultiple = alerts.length > 1;
  const slope5d = monitorRow.readings.slope5d;
  const slope20d = monitorRow.readings.slope20d;
  const dailyMovePct = simRow ? dailyChangePctFromRow(simRow) : null;
  const slopeCtx = slopeVerdictContextFromSlopes({
    ticker: alert.ticker,
    cd: alert.completionDate,
    slope5d,
    slope20d,
    slope45d: null,
    pred5Pp: monitorRow.readings.pred5Pp,
    stabilityVerdict: monitorRow.stabilityVerdict as StabilityVerdict,
  });

  const titleKey = isSynthAlert && alert.suggestedAction === "review"
    ? "recommendationAlert.title.synthTrim"
    : isSynthAlert && alert.suggestedAction === "sell"
      ? "recommendationAlert.title.synthSell"
      : portfolioHoldDisplay
        ? "recommendationAlert.title.holdPortfolio"
        : alert.suggestedAction === "buy"
          ? "recommendationAlert.title.buy"
          : alert.suggestedAction === "hold"
            ? "recommendationAlert.title.hold"
            : alert.suggestedAction === "review"
              ? "recommendationAlert.title.review"
              : "recommendationAlert.title.sell";
  const actionLabel = suggestedActionLabel(
    alert.suggestedAction === "review" ? "review" : alert.suggestedAction,
    it ? "it" : "en",
    monitorRow.hasPosition,
  );

  return (
    <div
      className="fixed inset-0 z-[69] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`card w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border-2 ${theme.shellBorder}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recommendation-alert-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`shrink-0 border-b px-4 py-3 ${theme.headerBorder} ${theme.headerBg}`}>
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none shrink-0" aria-hidden>
              {theme.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <h2
                  id="recommendation-alert-title"
                  className={`text-base font-bold inline-flex flex-wrap items-center gap-x-1.5 ${theme.titleClass}`}
                >
                  {t(titleKey)}
                  <PortfolioTickerMark
                    ticker={alert.ticker}
                    inPortfolio={monitorRow.hasPosition}
                    pnlPct={monitorRow.pnlPct}
                    pnlPct24h={monitorRow.pnlPct24h}
                    className="text-base shrink-0"
                  />
                </h2>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${theme.badge}`}
                >
                  {actionLabel}
                </span>
              </div>
              <p className="text-xs text-ink-muted mt-1 leading-snug">
                {portfolioHoldDisplay
                  ? t("recommendationAlert.subtitle.holdPortfolio")
                  : t("recommendationAlert.subtitle", {
                      action: actionLabel,
                      profile:
                        monitorRow.profile === "portfolio"
                          ? it
                            ? "portafoglio"
                            : "portfolio"
                          : it
                            ? "opportunità"
                            : "opportunity",
                    })}
              </p>
              {isSynthAlert && synthRationale ? (
                <div
                  className={`mt-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold leading-snug ${theme.badge}`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wide opacity-75 mr-1.5">
                    {t("recommendationAlert.whySynthTrim")}
                  </span>
                  {synthRationale}
                </div>
              ) : null}
              {alert.suggestedAction === "buy" && monitorRow.buyReason ? (
                <div
                  className={`mt-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold leading-snug ${theme.badge}`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wide opacity-75 mr-1.5">
                    {t(
                      portfolioHoldDisplay
                        ? "recommendationAlert.whyHoldPortfolio"
                        : "recommendationAlert.whyBuy",
                    )}
                  </span>
                  {monitorRow.buyReason}
                </div>
              ) : null}
              {alert.suggestedAction === "buy" && monitorRow.buyWarning ? (
                <p className="mt-1.5 text-[11px] text-amber-800 dark:text-amber-200 leading-snug">
                  {monitorRow.buyWarning}
                </p>
              ) : null}
              {alert.suggestedAction === "sell" && monitorRow.sellReason ? (
                <div
                  className={`mt-2 rounded-md border px-2.5 py-1.5 text-xs font-semibold leading-snug ${theme.badge}`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wide opacity-75 mr-1.5">
                    {t("recommendationAlert.whySell")}
                  </span>
                  {monitorRow.sellReason}
                </div>
              ) : null}
              {monitorRow.holdThesis && alert.suggestedAction !== "sell" ? (
                <div className="mt-2 rounded-md border border-sky-500/35 bg-sky-500/8 px-2.5 py-1.5 text-xs font-semibold leading-snug text-sky-900 dark:text-sky-100">
                  <span className="text-[10px] font-bold uppercase tracking-wide opacity-75 mr-1.5">
                    {t("recommendationAlert.holdThesis")}
                  </span>
                  {monitorRow.holdThesis}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <PlanProbHero
                  probPct={monitorRow.probPct}
                  decision={planProbDecisionForDisplay(
                    monitorRow.exitDecision,
                    monitorRow.suggestedAction,
                  )}
                  suggestedAction={monitorRow.suggestedAction}
                  exitDecision={monitorRow.exitDecision}
                  inLoss={monitorRow.inLoss}
                  variant="compact"
                  hasPosition={monitorRow.hasPosition}
                  profile={monitorRow.profile === "portfolio" ? "portfolio" : "opportunities"}
                />
                <span
                  className="text-[10px] font-semibold tabular-nums px-2 py-1 rounded-md border border-[rgb(var(--border))]/50 bg-surface/60 text-ink-muted"
                  title={t("recommendationAlert.compositeDrivers", {
                    drivers: topCompositeDrivers(monitorRow.scoreBreakdown),
                  })}
                >
                  {t("recommendationAlert.compositeScore", {
                    zone: t(`recommendationAlert.scoringZone.${monitorRow.scoringZone}`),
                    score: monitorRow.compositeScore,
                    dampened: monitorRow.compositeDampened
                      ? t("recommendationAlert.compositeDampened")
                      : "",
                  })}
                </span>
                {monitorRow.planReturnPct != null && monitorRow.planReturnPct > 0 ? (
                  <PortfolioPlanTargetChip
                    pnlPct={monitorRow.pnlPct}
                    planReturnPct={monitorRow.planReturnPct}
                    size={16}
                  />
                ) : null}
              </div>
            </div>
            <button
              type="button"
              className="shrink-0 text-ink-muted hover:text-ink text-lg leading-none px-1"
              onClick={onClose}
              aria-label={t("recommendationAlert.close")}
            >
              ✕
            </button>
          </div>
          {hasMultiple ? (
            <div className={`flex flex-wrap items-center gap-2 mt-3 pt-2 border-t ${theme.headerBorder}`}>
              <span className="text-[10px] text-ink-muted">
                {t("recommendationAlert.positionOf", {
                  n: activeIndex + 1,
                  total: alerts.length,
                })}
              </span>
              <button
                type="button"
                className="btn-ghost text-[10px] py-0.5"
                disabled={activeIndex <= 0}
                onClick={() => onActiveIndexChange(activeIndex - 1)}
              >
                ← {it ? "Prec." : "Prev"}
              </button>
              <button
                type="button"
                className="btn-ghost text-[10px] py-0.5"
                disabled={activeIndex >= alerts.length - 1}
                onClick={() => onActiveIndexChange(activeIndex + 1)}
              >
                {it ? "Succ." : "Next"} →
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          <SlopeVerdictBanner
            ctx={slopeCtx}
            simRow={simRow}
            simTable={simTable}
            chartPts={chartPts}
            sdsRows={sdsRows}
            variant="hero"
            alwaysShow
            suggestedAction={uiAction}
            exitDecision={monitorRow.exitDecision}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {pipelineSteps.slice(0, 8).map((step) => (
              <div
                key={step.id}
                className={`rounded-md border px-2 py-1.5 text-[10px] leading-snug ${stepToneClass(step.tone)}`}
              >
                <span className="font-semibold text-ink-muted uppercase tracking-wide text-[9px]">
                  {it ? step.labelIt : step.labelEn}
                </span>
                <p className="mt-0.5 text-ink">{step.value}</p>
              </div>
            ))}
          </div>

          {monitorRow.misalignmentLabels.length > 0 ? (
            <p className="text-[10px] text-amber-800 dark:text-amber-200 border border-amber-500/30 bg-amber-500/8 rounded-md px-2 py-1.5">
              {t("recommendationAlert.misalignments")}: {monitorRow.misalignmentLabels.join(" · ")}
            </p>
          ) : null}

          <ModalChartHorizonBanner variant="modals" />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <ModalChartTile
              title={t("portfolioLoss.modal.chart.pred")}
              caption={modalPredSparklineCaption(t)}
              height={MODAL_CHART_H}
            >
              {simRow ? (
                <div className="h-full w-full flex items-center justify-center px-1">
                  <SimulationSparkline
                    row={simRow}
                    points={chartPts}
                    width={360}
                    height={MODAL_CHART_H - 12}
                    showCdZones
                    portfolio={{
                      pnlPct: monitorRow.pnlPct,
                    }}
                  />
                </div>
              ) : (
                <p className="text-xs text-ink-muted h-full flex items-center justify-center px-2 text-center">
                  {t("portfolioLoss.modal.noChart")}
                </p>
              )}
            </ModalChartTile>

            <ModalChartTile
              title={t("sim.lossAnalysis.miiDrawer.title")}
              caption={modalMiiCaption(t)}
              height={MODAL_CHART_H}
            >
              <MigMarketModelSlopesCard
                row={migRow}
                pnlPct24h={monitorRow.pnlPct24h}
                embedded
              />
            </ModalChartTile>

            <ModalChartTile
              title={t("portfolioLoss.modal.chart.slope")}
              caption={modalSlopeTrajectoryCaption(t, { slope5d, slope20d })}
              height={MODAL_CHART_H}
            >
              {slopeTrajectory && slopeTrajectory.points.length >= 2 ? (
                <SlopeTrajectoryChart
                  points={slopeTrajectory.points}
                  todayOffset={slopeTrajectory.todayOffset}
                  lang={it ? "it" : "en"}
                  predName={it ? "Modello + ricalib." : "Model + recalib."}
                  actualName={it ? "Reale" : "Actual"}
                  slope5d={slope5d}
                  slope20d={slope20d}
                  dailyMovePct={dailyMovePct}
                  showSlopeWindows
                  chartOnly
                  height={MODAL_CHART_H}
                />
              ) : (
                <p className="text-xs text-ink-muted h-full flex items-center justify-center px-2 text-center">
                  {t("portfolioLoss.modal.slopeMissing")}
                </p>
              )}
            </ModalChartTile>

            <ModalChartTile
              title={t("decisionLab.pattern.arcTitle")}
              caption={modalPatternCaption(t, patternRec?.matchPct)}
              height={MODAL_CHART_H}
            >
              {patternRec ? (
                <div className="h-full w-full min-h-0 overflow-hidden flex items-center justify-center">
                  <CdPatternArcPanel
                    rec={patternRec}
                    variant="mini"
                    hideMetrics
                    chartHeight={MODAL_CHART_H - 4}
                    className="border-0 bg-transparent p-0 w-full shadow-none"
                  />
                </div>
              ) : (
                <p className="text-xs text-ink-muted h-full flex items-center justify-center px-2 text-center">
                  {t("decisionLab.pattern.empty")}
                </p>
              )}
            </ModalChartTile>
          </div>

          {gainPlanRow ? (
            <ModalChartTile
              title={t("sim.gainPlan.title")}
              caption={modalGainPlanCaption(t, {
                recoveryDays:
                  monitorRow.holdThesis && alert.suggestedAction !== "sell"
                    ? (gainPlanRow.daysToTarget ?? gainPlanRow.expectedHoldDays)
                    : null,
              })}
              height={MODAL_CHART_H}
            >
              <PortfolioGainPlanSingleChart
                row={gainPlanRow}
                history={history}
                embedded
                hideLegend
                height={MODAL_CHART_H}
                planMarkerLabel={modalGainPlanMarkerLabel(
                  gainPlanRow.daysToTarget ?? gainPlanRow.expectedHoldDays,
                  it,
                )}
              />
            </ModalChartTile>
          ) : null}
        </div>

        <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-[rgb(var(--border))]/50 px-4 py-3 bg-surface/50">
          {isSynthAlert && onTrimToSynth && alert.synthTargetCapEur != null ? (
            <button
              type="button"
              className="btn-primary text-xs bg-amber-600 hover:bg-amber-700 border-amber-700/40"
              onClick={() => {
                onTrimToSynth(alert.key);
                onClose();
              }}
            >
              {t("recommendationAlert.trimToSynth", {
                amount: `€${Math.round(alert.synthTargetCapEur!).toLocaleString(it ? "it-IT" : "en-US")}`,
              })}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost text-xs border border-[rgb(var(--border))]/50"
            onClick={() => {
              onOpenSimulationRow(alert.ticker, alert.completionDate, {
                syncToSynth: isSynthAlert,
              });
              onClose();
            }}
          >
            {t("recommendationAlert.openSimulation")}
          </button>
          <button type="button" className="btn-primary text-xs" onClick={onClose}>
            {t("recommendationAlert.acknowledge")}
          </button>
        </div>
      </div>
    </div>
  );
}
