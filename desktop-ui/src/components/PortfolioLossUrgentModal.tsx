import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import {
  chartSeriesReady,
  loadSimulationChartsBundle,
  peekSimulationChartsBundle,
} from "../data/simulationCharts";
import { buildSimRowByKeyMap, reconcileInvestSimInputs } from "../sheet/investSimKeys";
import { buildCdPatternTickerRecommendation } from "../sheet/cdPatternRecommendation";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import { SimulationSparkline } from "../sheet/simulationSparkline";
import { SlopeTrajectoryChart } from "./SlopeTrajectoryChart";
import { buildSlopeTrajectory, canRenderSlopeTrajectory } from "../sheet/slopeRecalibCurve";
import { daysFromToday } from "../sheet/simulationPlanGain";
import { dailyChangePctFromRow, rowHasActivePortfolio } from "../sheet/simulationPosition";
import {
  fmtPortfolioPnlPct,
  fmtPortfolioPnlUsd,
  portfolioPnlAccentClass,
} from "../sheet/portfolioGainLossStyle";
import type { PortfolioLossAlert } from "../sheet/portfolioLossUrgent";
import {
  buildRecoveryProbContextForAlert,
  lossAlertModalTheme,
  resolveLossExitForAlert,
  type LossAnalysisProbOptions,
  type LossExitDecision,
} from "../sheet/portfolioLossAnalysis";
import { loadEisSuperScoreState, type EisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { useLang, useT } from "../shared/i18n";
import { PortfolioExitButton, type PortfolioSellHandler } from "./PortfolioExitButton";
import { EisDetailDrawer } from "./EisDetailDrawer";
import { clinicalKpiFromSimRow } from "../sheet/tickerEisSummary";
import { SlopeVerdictBanner } from "./SlopeVerdictBanner";
import { slopeVerdictContextFromExit } from "../sheet/slopeVerdictContext";
import { verdictLabel } from "../sheet/slopeStability";
import { PortfolioPlanTargetChip } from "./PortfolioPlanTargetChip";
import { PortfolioTickerMark } from "./PortfolioScopeToggle";
import { PlanProbHero } from "./PlanProbHero";
import { CdPatternArcPanel } from "./CdPatternArcPanel";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import {
  PortfolioGainPlanSingleChart,
  buildPortfolioGainPlanRowFromSim,
} from "./PortfolioGainPlanChart";
import { ModalChartTile } from "./ModalChartTile";
import { ModalChartHorizonBanner } from "./ModalChartHorizonBanner";
import {
  modalGainPlanCaption,
  modalGainPlanMarkerLabel,
  modalPatternCaption,
  modalPredSparklineCaption,
  modalSlopeTrajectoryCaption,
} from "../sheet/modalChartCaptions";

const MODAL_CHART_H = 172;

export function PortfolioLossUrgentModal({
  open,
  alerts,
  activeIndex,
  onActiveIndexChange,
  simTable,
  inputs = {},
  chartsBundle: chartsBundleProp,
  sdsRows,
  onClose,
  onDismissTicker,
  onOpenSlopeCharts,
  onOpenPredictionCharts,
  onNavigateSimulation,
  onOpenLossAnalysis,
  onSellPosition,
}: {
  open: boolean;
  alerts: PortfolioLossAlert[];
  activeIndex: number;
  onActiveIndexChange: (idx: number) => void;
  simTable: SheetTable | null;
  inputs?: InvestSimInputs;
  chartsBundle?: ChartBundle | null;
  sdsRows?: SdsRow[] | null;
  onClose: () => void;
  onDismissTicker: (key: string, pnlPct: number) => void;
  onOpenSlopeCharts: (ticker: string) => void;
  onOpenPredictionCharts: (ticker: string, seriesKey: string | null) => void;
  onNavigateSimulation: (ticker: string, cd?: string) => void;
  onOpenLossAnalysis: (ticker?: string, cd?: string) => void;
  onSellPosition?: PortfolioSellHandler;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";
  const history = useInvestSimPortfolioHistory().history;
  const [eisDrawer, setEisDrawer] = useState<{
    ticker: string;
    clinicalKpi: number | null;
  } | null>(null);
  const chartsBundle =
    chartsBundleProp !== undefined ? chartsBundleProp : peekSimulationChartsBundle();

  useEffect(() => {
    if (!open || chartsBundleProp !== undefined) return;
    if (peekSimulationChartsBundle()) return;
    void loadSimulationChartsBundle();
  }, [open, chartsBundleProp]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    setEisDrawer(null);
  }, [activeIndex, open]);

  const openEisDetail = useCallback((ticker: string, clinicalKpi?: number | null) => {
    setEisDrawer({ ticker, clinicalKpi: clinicalKpi ?? null });
  }, []);

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
  const polygonOverview = useCdPatternPolygonOverview();

  useEffect(() => {
    void loadEisSuperScoreState().then(setEisSuperScoreState);
  }, []);

  const migSolidityByKey = useMemo(
    () => buildMigSolidityByKey(simTable, chartsBundle, sdsRows),
    [simTable, chartsBundle, sdsRows],
  );

  const lossProbOptions = useMemo((): LossAnalysisProbOptions | null => {
    if (!simTable?.rows?.length) return null;
    return {
      sdsRows,
      migSolidityByKey,
      eisSuperScoreState,
      polygonOverview,
    };
  }, [simTable?.rows?.length, sdsRows, migSolidityByKey, eisSuperScoreState, polygonOverview]);

  const exitResolution = useMemo(() => {
    if (!alert || !simTable || !chartsReady) return null;
    const columns = simTable.columns ?? Object.keys(simTable.rows[0] ?? {});
    const probCtx =
      lossProbOptions && simTable.rows.length
        ? buildRecoveryProbContextForAlert(
            alert,
            simRow,
            chartPts,
            inputs,
            simTable.rows,
            it ? "it" : "en",
            lossProbOptions,
          )
        : undefined;
    return resolveLossExitForAlert(
      alert,
      simRow,
      chartPts,
      inputs,
      columns,
      it ? "it" : "en",
      true,
      probCtx,
    );
  }, [alert, simTable, simRow, chartPts, inputs, chartsReady, it, lossProbOptions]);

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
    const merged = reconcileInvestSimInputs(inputs, simTable.rows);
    return buildCdPatternTickerRecommendation({
      row: simRow,
      chartPoints: chartPts,
      investInputs: merged,
      sdsRows,
      migByKey: migSolidityByKey,
      lang: it ? "it" : "en",
      includeEis: true,
      eisSuperScoreState,
    });
  }, [
    alert,
    simRow,
    simTable,
    chartPts,
    inputs,
    sdsRows,
    migSolidityByKey,
    it,
    eisSuperScoreState,
  ]);

  const gainPlanRow = useMemo(() => {
    if (!alert || !simRow) return null;
    return buildPortfolioGainPlanRowFromSim(
      alert.key,
      simRow,
      inputs,
      history,
      chartPts,
    );
  }, [alert, simRow, inputs, history, chartPts]);

  if (!open || !alert) return null;

  if (!chartsReady || !exitResolution) {
    return (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 sm:p-4"
        role="presentation"
        aria-busy="true"
      >
        <p className="text-sm text-ink-muted bg-surface/95 px-4 py-3 rounded-lg border border-[rgb(var(--border))]/50 shadow-lg">
          {t("portfolioLoss.modal.preparing")}
        </p>
      </div>
    );
  }

  const exitDecision: LossExitDecision = exitResolution.exitDecision;
  const theme = lossAlertModalTheme(exitDecision);
  const pnlAccent = portfolioPnlAccentClass(alert.pnlEur, alert.pnlPct);
  const hasMultiple = alerts.length > 1;
  const slope5d = exitResolution.slope5d;
  const slope20d = exitResolution.slope20d;
  const dailyMovePct = simRow ? dailyChangePctFromRow(simRow) : null;
  const slopeCtx = slopeVerdictContextFromExit(alert, exitResolution);
  const suggestedAction =
    exitDecision === "hold"
      ? ("hold" as const)
      : exitDecision === "exit" &&
          (exitResolution.curveRisingHold ||
            (exitResolution.recoveryProbabilityPct != null &&
              exitResolution.recoveryProbabilityPct >= 55))
        ? ("hold" as const)
        : exitDecision === "exit"
          ? ("sell" as const)
          : ("review" as const);

  const inPortfolio = simRow
    ? rowHasActivePortfolio(simRow, inputs)
    : alert.capital > 0;
  const titleKey = `portfolioLoss.modal.title.${exitDecision}` as
    | "portfolioLoss.modal.title.exit"
    | "portfolioLoss.modal.title.hold"
    | "portfolioLoss.modal.title.review";
  const titleFull = t(titleKey, { ticker: alert.ticker });
  const titleTickerIdx = titleFull.indexOf(alert.ticker);
  const titleParts =
    titleTickerIdx < 0
      ? { before: titleFull, after: "" }
      : {
          before: titleFull.slice(0, titleTickerIdx),
          after: titleFull.slice(titleTickerIdx + alert.ticker.length),
        };

  const handleDismissTicker = () => {
    onDismissTicker(alert.key, alert.pnlPct);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        className={`card w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border-2 ${theme.shellBorder}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="portfolio-loss-urgent-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`shrink-0 border-b px-4 py-3 ${theme.headerBorder} ${theme.headerBg}`}
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl leading-none shrink-0" aria-hidden>
              {theme.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <h2
                  id="portfolio-loss-urgent-title"
                  className={`text-base font-bold inline-flex flex-wrap items-center gap-x-1.5 gap-y-0 ${theme.titleClass}`}
                >
                  {titleParts.before ? <span>{titleParts.before}</span> : null}
                  <PortfolioTickerMark
                    ticker={alert.ticker}
                    inPortfolio={inPortfolio}
                    pnlPct={alert.pnlPct}
                    pnlEur={alert.pnlEur}
                    slope5d={slope5d}
                    slope20d={slope20d}
                    className="text-base shrink-0"
                  />
                  {titleParts.after ? <span>{titleParts.after}</span> : null}
                </h2>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                    exitDecision === "exit"
                      ? "bg-[rgb(var(--signal-down))]/15 text-[rgb(var(--signal-down))] border-[rgb(var(--signal-down))]/40"
                      : "bg-[rgb(var(--warn))]/12 text-[rgb(var(--warn))] border-[rgb(var(--warn))]/35"
                  }`}
                >
                  {t(`sim.lossAnalysis.decision.${exitDecision}`)}
                </span>
              </div>
              <p className="text-xs text-ink-muted mt-1 leading-snug">
                {t(`portfolioLoss.modal.subtitle.${exitDecision}` as "portfolioLoss.modal.subtitle.exit")}
              </p>
              <p className={`text-sm font-semibold tabular-nums mt-2 ${pnlAccent}`}>
                {fmtPortfolioPnlUsd(alert.pnlEur)} · {fmtPortfolioPnlPct(alert.pnlPct)}
                <span className="text-ink-muted font-normal text-xs ml-2">
                  {t("portfolioLoss.modal.capital", {
                    cap: alert.capital.toLocaleString("en-US", { maximumFractionDigits: 0 }),
                  })}
                </span>
              </p>
              {slope5d != null || slope20d != null ? (
                <p className="text-[10px] text-ink-muted mt-1 tabular-nums">
                  {t("portfolioLoss.modal.slopes", {
                    s5: slope5d?.toFixed(2) ?? "—",
                    s20: slope20d?.toFixed(2) ?? "—",
                  })}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              className="shrink-0 text-ink-muted hover:text-ink text-lg leading-none px-1"
              onClick={onClose}
              aria-label={t("portfolioLoss.modal.close")}
            >
              ✕
            </button>
          </div>
          {hasMultiple ? (
            <div className={`flex flex-wrap items-center gap-2 mt-3 pt-2 border-t ${theme.navDivider}`}>
              <span className="text-[10px] text-ink-muted">
                {t("portfolioLoss.modal.positionOf", {
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
            suggestedAction={suggestedAction}
            exitDecision={exitDecision}
          />

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-0.5">
            <div className="min-w-0 [&_*]:text-left">
              <PlanProbHero
                probPct={exitResolution.recoveryProbabilityPct}
                decision={exitDecision}
                suggestedAction={suggestedAction}
                inLoss
                summary={exitResolution.recoverySummary}
                variant="compact"
              />
            </div>
            {exitResolution.planReturnPct != null && exitResolution.planReturnPct > 0 ? (
              <PortfolioPlanTargetChip
                pnlPct={alert.pnlPct}
                planReturnPct={exitResolution.planReturnPct}
                size={16}
              />
            ) : null}
          </div>

          {exitResolution.stabilityVerdict === "exit" ||
          exitResolution.stabilityVerdict === "avoid" ? (
            <p className="text-xs font-semibold text-[rgb(var(--signal-down))] leading-snug border-l-4 border-[rgb(var(--signal-down))]/50 pl-2.5">
              {verdictLabel(exitResolution.stabilityVerdict)}
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
                      pnlPct: alert.pnlPct,
                      buyPriceUsd: alert.buyPrice > 0 ? alert.buyPrice : null,
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
              title={t("sim.gainPlan.title")}
              caption={modalGainPlanCaption(t, {
                recoveryDays:
                  exitDecision === "hold"
                    ? (gainPlanRow?.daysToTarget ?? gainPlanRow?.expectedHoldDays)
                    : null,
              })}
              height={MODAL_CHART_H}
            >
              {gainPlanRow ? (
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
              ) : (
                <p className="text-xs text-ink-muted h-full flex items-center justify-center px-2 text-center">
                  {t("sim.lossAnalysis.chart.gainPlanMissing")}
                </p>
              )}
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
                <p className="text-xs text-ink-muted h-full flex items-center justify-center px-2 text-center leading-snug">
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

          <div className="flex flex-wrap gap-2">
            {exitDecision === "exit" && onSellPosition ? (
              <PortfolioExitButton
                simKey={alert.key}
                simRow={simRow ?? null}
                onSell={(key, row, opts) => {
                  const result = onSellPosition(key, row, opts);
                  if (!result || result.ok) onClose();
                  return result;
                }}
              />
            ) : exitDecision === "exit" ? (
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => {
                  onNavigateSimulation(alert.ticker, alert.completionDate);
                  onClose();
                }}
              >
                {t("portfolioLoss.modal.action.sellSim")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-ghost text-xs border border-[rgb(var(--border))]/50"
              onClick={() => {
                onOpenLossAnalysis(alert.ticker, alert.completionDate);
                onClose();
              }}
            >
              {t("portfolioLoss.modal.action.lossTab")}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs border border-[rgb(var(--border))]/50"
              onClick={() => {
                onOpenSlopeCharts(alert.ticker);
                onClose();
              }}
            >
              {t("portfolioLoss.modal.action.slope")}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs border border-[rgb(var(--border))]/50"
              onClick={() => {
                onOpenPredictionCharts(alert.ticker, alert.seriesKey);
                onClose();
              }}
            >
              {t("portfolioLoss.modal.action.curves")}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs border border-[rgb(var(--border))]/50"
              onClick={() => openEisDetail(alert.ticker, clinicalKpiFromSimRow(simRow))}
              title={t("sim.lossAnalysis.action.eisTip")}
            >
              {t("portfolioLoss.modal.action.eis")}
            </button>
          </div>
        </div>

        <div className="shrink-0 flex flex-wrap items-center justify-end gap-2 border-t border-[rgb(var(--border))]/50 px-4 py-3 bg-surface/50">
          <button type="button" className="btn-ghost text-xs" onClick={handleDismissTicker}>
            {t("portfolioLoss.modal.dismissTicker", { ticker: alert.ticker })}
          </button>
          <button type="button" className="btn-primary text-xs" onClick={onClose}>
            {t("portfolioLoss.modal.acknowledge")}
          </button>
        </div>
      </div>
      <EisDetailDrawer
        open={eisDrawer != null}
        onClose={() => setEisDrawer(null)}
        ticker={eisDrawer?.ticker ?? null}
        clinicalKpi={eisDrawer?.clinicalKpi}
        it={it}
      />
    </div>
  );
}
