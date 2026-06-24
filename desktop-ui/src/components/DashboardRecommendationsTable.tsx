import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import { useLang, useT } from "../shared/i18n";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import type { SdsRow } from "../api/supernova";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import {
  buildDashboardRecommendationRows,
  chartPointsForKey,
  dismissDashboardRecommendation,
  ackDashboardRecommendations,
  dashboardRecommendationsKeySig,
  gainPlanForRecommendationRow,
  type DashboardRecCdFilter,
  type DashboardRecProfileFilter,
  type DashboardRecSortMode,
  type DashboardRecommendationRow,
} from "../sheet/dashboardRecommendationsView";
import {
  suggestedActionLabel,
  suggestedActionToneClass,
  recommendationRationale,
} from "../sheet/suggestionMonitor";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import {
  computeSimulationPosition,
  positionGainUsd,
} from "../sheet/simulationPosition";
import { clinicalKpiFromSimRow } from "../sheet/tickerEisSummary";
import { INVEST_SIM_INPUTS_CHANGED_EVENT } from "../sheet/investSimStorage";
import { DEFAULT_PLAN_CAPITAL_EUR } from "../sheet/expectedRoiDisplay";
import { computeRecommendationGainIdea } from "../sheet/recommendationGainIdea";
import { RecommendationGainIdeaCell } from "./RecommendationGainIdeaCell";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import { PortfolioTickerMark } from "./PortfolioScopeToggle";
import { EisScoreBadge } from "./EisScoreBadge";
import { EisDetailDrawer } from "./EisDetailDrawer";
import { PnlDeltaCell } from "./PnlDeltaCell";
import { ModelTargetPriceCell } from "./ModelTargetPriceCell";
import { PortfolioExitButton, type PortfolioSellHandler } from "./PortfolioExitButton";
import {
  PortfolioRegisterBuyButton,
  type PortfolioRegisterBuyHandler,
} from "./PortfolioRegisterBuyButton";
import { DealUrgencyFlame } from "./DealUrgencyFlame";
import {
  buildDealUrgencyByKey,
  dealUrgencyRowStyle,
} from "../sheet/recommendationDealUrgency";
import {
  syncPriceReadingCache,
} from "../sheet/priceReadingCache";
import { buildSimTablePriceVersion, simTablePriceRows } from "../sheet/simTablePriceVersion";
import { useLossRiskCatalog, lookupLossRisk } from "../hooks/useLossRiskCatalog";
import {
  LossRiskBreakdownModal,
  type LossRiskEntry,
} from "./LossRiskPoopCell";
import {
  RiskBenefitScaleCell,
  deriveBenefitFillPct,
} from "./RiskBenefitScaleIcon";
import { useSimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";
import { loadUiPrefsLocal } from "../sheet/uiPrefs";
import {
  closedSimOutcomeRowsFromDoc,
  loadInvestmentSimOutcomes,
  type SimOutcomesDoc,
} from "../data/investmentSimOutcomesData";
import { buildSuggestionMonitorRows } from "../sheet/suggestionMonitor";
import { buildAdviceCalibrationFromLiveRows } from "../sheet/investDecisionSimAdviceCalibration";
import {
  attachDaysToCdOnAdvicePoints,
  buildAuditPeakItemsFromClosedRows,
  buildCombinedAdviceOutcomeSummary,
  readDaysToCdFromSimRow,
} from "../sheet/accuracyPeakCdOffset";
import { dailyChangePctFromRow } from "../sheet/simulationPosition";

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 100) return `$${v.toFixed(2)}`;
  if (v >= 10) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(2)}`;
}

export function DashboardRecommendationsTable({
  simTable,
  simLoading,
  chartBundle,
  sdsRows,
  simTableVersion,
  onOpenSimulationSheet,
  onOpen24hAssessment,
  onRegisterBuy,
  onSell,
  className,
  variant = "panel",
  onClose,
  onBindClose,
  onStatsChange,
}: {
  simTable: SheetTable | null;
  simLoading: boolean;
  chartBundle: ChartBundle | null;
  sdsRows: SdsRow[] | null;
  simTableVersion?: string | null;
  /** Decision Lab → Simulation workspace row (Buy/Sell in Actions). */
  onOpenSimulationSheet?: (focus: {
    ticker: string;
    cd?: string;
    action?: "buy" | "sell";
  }) => void;
  /** Simulation tab 24h assessment with scroll to ticker card. */
  onOpen24hAssessment?: (focus: { ticker: string; cd?: string }) => void;
  onRegisterBuy?: PortfolioRegisterBuyHandler;
  onSell?: PortfolioSellHandler;
  className?: string;
  /** panel = dashboard card; modal = inside dismissible popup */
  variant?: "panel" | "modal";
  onClose?: () => void;
  onBindClose?: (closeWithAck: () => void) => void;
  onStatsChange?: (stats: { total: number; newCount: number; keySig: string }) => void;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const inputs = useInvestSimInputs(simTable);
  const history = useInvestSimPortfolioHistory().history;
  const [inputsTick, setInputsTick] = useState(0);
  const [dismissTick, setDismissTick] = useState(0);
  const [priceReadingRevision, setPriceReadingRevision] = useState(0);
  const prevSimTableVersionRef = useRef<string | null>(null);

  const simTablePriceVersion = useMemo(
    () => buildSimTablePriceVersion(simTable, inputs),
    [simTable, inputs],
  );

  useEffect(() => {
    if (!simTable || simLoading) return;
    const priceRows = simTablePriceRows(simTable.rows);
    if (!priceRows.length) return;

    const versionChanged =
      prevSimTableVersionRef.current != null &&
      prevSimTableVersionRef.current !== simTablePriceVersion;
    prevSimTableVersionRef.current = simTablePriceVersion;

    const id = requestAnimationFrame(() => {
      syncPriceReadingCache(priceRows, {
        simTableVersion: simTablePriceVersion,
        versionChanged,
      });
      setPriceReadingRevision((r) => r + 1);
    });
    return () => cancelAnimationFrame(id);
  }, [simTable, simLoading, simTablePriceVersion]);

  const [profileFilter, setProfileFilter] = useState<DashboardRecProfileFilter>("all");
  const [cdFilter, setCdFilter] = useState<DashboardRecCdFilter>("all");
  const [sortMode, setSortMode] = useState<DashboardRecSortMode>("deal");
  const [eisDrawer, setEisDrawer] = useState<{ ticker: string; kpi: number | null } | null>(
    null,
  );
  const [riskModalEntry, setRiskModalEntry] = useState<LossRiskEntry | null>(null);

  // Loss-risk catalog — keyed by uppercase ticker, reuses the same Phase A
  // screening as ThreePortfolioCompareView so risk scores match exactly.
  const { catalog: lossRiskCatalog } = useLossRiskCatalog({
    simTable,
    sdsRows,
    chartBundle,
  });

  useEffect(() => {
    const bump = () => setInputsTick((n) => n + 1);
    window.addEventListener(INVEST_SIM_INPUTS_CHANGED_EVENT, bump);
    return () => window.removeEventListener(INVEST_SIM_INPUTS_CHANGED_EVENT, bump);
  }, []);

  const pointsBySeriesKey = useMemo(
    () => chartPointsMapFromBundle(chartBundle),
    [chartBundle],
  );
  const polygonOverview = useCdPatternPolygonOverview();
  const simRowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable?.rows],
  );

  const [eisState, setEisState] = useState<Awaited<
    ReturnType<typeof loadEisSuperScoreState>
  > | null>(null);

  useEffect(() => {
    void loadEisSuperScoreState().then(setEisState);
  }, []);

  const probOptions = useMemo((): LossAnalysisProbOptions | null => {
    if (!simTable) return null;
    return {
      sdsRows,
      migSolidityByKey: buildMigSolidityByKey(simTable, chartBundle, sdsRows),
      eisSuperScoreState: eisState,
      polygonOverview,
      lightweightPolygon: true,
      mergedInputs: inputs,
    };
  }, [simTable, chartBundle, sdsRows, eisState, polygonOverview, inputs]);

  const topCapital = useMemo(() => {
    const pref = loadUiPrefsLocal().topCapital;
    if (pref != null && Number.isFinite(pref) && pref > 0) return pref;
    let sum = 0;
    for (const v of Object.values(inputs)) {
      if (v.capital > 0) sum += v.capital;
    }
    return sum > 0 ? sum : 5000;
  }, [inputs, inputsTick]);

  const synthAlloc = useSimLoopSynthAllocation({
    simTable,
    sdsRows,
    investInputs: inputs,
    pointsBySeriesKey,
    totalCapitalEur: topCapital,
    enabled: Boolean(simTable?.rows?.length) && topCapital > 0,
  });

  const [outcomesDoc, setOutcomesDoc] = useState<SimOutcomesDoc | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadInvestmentSimOutcomes().then(({ doc }) => {
      if (!cancelled) setOutcomesDoc(doc ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const adviceOutcomeBins = useMemo(() => {
    if (!simTable?.rows?.length) return null;
    const lang = it ? "it" : "en";
    const monitorRows = buildSuggestionMonitorRows({
      simTable,
      inputs,
      pointsBySeriesKey,
      lang,
      probOptions,
      paperPortfolio: [],
      synthAlloc,
    });
    const resolveDaysToCd = (key: string): number | null =>
      readDaysToCdFromSimRow(simRowByKey.get(key));
    const liveCalibRows = monitorRows.map((row) => {
      const simRow = simRowByKey.get(row.key);
      const dailyVar = simRow ? dailyChangePctFromRow(simRow) : null;
      const pnlPct24h =
        row.pnlPct24h != null && Number.isFinite(row.pnlPct24h) ? row.pnlPct24h : dailyVar;
      return {
        key: row.key,
        ticker: row.ticker,
        suggestedAction: row.suggestedAction,
        inPaperPortfolio: row.inPaperPortfolio,
        hasPosition: row.hasPosition,
        exitDecision: row.exitDecision,
        probPct: row.probPct,
        probPctAtAdvice: row.probPct,
        planReturnPct: row.planReturnPct,
        miiAngleDeg: row.miiAngleDeg,
        pnlPct: row.pnlPct,
        pnlPct24h,
        daysToCdAtAdvice: resolveDaysToCd(row.key),
      };
    });
    const monitorPoints = attachDaysToCdOnAdvicePoints(
      buildAdviceCalibrationFromLiveRows(liveCalibRows, lang),
      resolveDaysToCd,
    );
    const closedRows = outcomesDoc ? closedSimOutcomeRowsFromDoc(outcomesDoc) : [];
    const auditItems = buildAuditPeakItemsFromClosedRows(closedRows, simRowByKey, lang);
    return buildCombinedAdviceOutcomeSummary(monitorPoints, auditItems);
  }, [simTable, inputs, pointsBySeriesKey, it, probOptions, synthAlloc, simRowByKey, outcomesDoc]);

  const rows = useMemo(
    () =>
      buildDashboardRecommendationRows({
        simTable,
        inputs,
        history,
        pointsBySeriesKey,
        lang: it ? "it" : "en",
        probOptions,
        simTableVersion,
        profileFilter,
        cdFilter,
        sortMode,
        synthAlloc,
        adviceOutcomeBins,
      }),
    [
      simTable,
      inputs,
      history,
      pointsBySeriesKey,
      it,
      probOptions,
      simTableVersion,
      profileFilter,
      cdFilter,
      sortMode,
      inputsTick,
      dismissTick,
      priceReadingRevision,
      synthAlloc,
      adviceOutcomeBins,
    ],
  );

  const counts = useMemo(() => {
    const all = buildDashboardRecommendationRows({
      simTable,
      inputs,
      history,
      pointsBySeriesKey,
      lang: it ? "it" : "en",
      probOptions,
      simTableVersion,
      profileFilter: "all",
      cdFilter,
      sortMode: "score",
      synthAlloc,
      adviceOutcomeBins,
    });
    return {
      all: all.length,
      portfolio: all.filter((r) => r.profile === "portfolio").length,
      opportunity: all.filter((r) => r.profile === "opportunity").length,
      new: all.filter((r) => r.isNew).length,
    };
  }, [
    simTable,
    inputs,
    history,
    pointsBySeriesKey,
    it,
    probOptions,
    simTableVersion,
    cdFilter,
    inputsTick,
    dismissTick,
    priceReadingRevision,
    synthAlloc,
    adviceOutcomeBins,
  ]);

  useEffect(() => {
    if (!onStatsChange) return;
    const allRows = buildDashboardRecommendationRows({
      simTable,
      inputs,
      history,
      pointsBySeriesKey,
      lang: it ? "it" : "en",
      probOptions,
      simTableVersion,
      profileFilter: "all",
      cdFilter: "all",
      sortMode: "score",
      synthAlloc,
      adviceOutcomeBins,
    });
    onStatsChange({
      total: allRows.length,
      newCount: allRows.filter((r) => r.isNew).length,
      keySig: dashboardRecommendationsKeySig(allRows),
    });
  }, [
    onStatsChange,
    simTable,
    inputs,
    history,
    pointsBySeriesKey,
    it,
    probOptions,
    simTableVersion,
    inputsTick,
    dismissTick,
    priceReadingRevision,
    synthAlloc,
    adviceOutcomeBins,
  ]);

  const handleModalClose = useCallback(() => {
    if (variant === "modal" && rows.length) {
      ackDashboardRecommendations(rows);
      setDismissTick((n) => n + 1);
    }
    onClose?.();
  }, [variant, rows, onClose]);

  useEffect(() => {
    if (variant !== "modal" || !onBindClose) return;
    onBindClose(handleModalClose);
  }, [variant, onBindClose, handleModalClose]);

  const handleDismiss = useCallback((row: DashboardRecommendationRow) => {
    dismissDashboardRecommendation(row);
    setDismissTick((n) => n + 1);
  }, []);

  const rowGainIdeas = useMemo(() => {
    const map = new Map<
      string,
      ReturnType<typeof computeRecommendationGainIdea>
    >();
    for (const row of rows) {
      const simRow = simRowByKey.get(row.key) ?? null;
      const chartPts = chartPointsForKey(simRow, pointsBySeriesKey);
      const gainPlan = gainPlanForRecommendationRow(simRow, inputs, row.key, chartPts);
      const cap =
        inputs[row.key]?.capital && inputs[row.key]!.capital > 0
          ? inputs[row.key]!.capital
          : DEFAULT_PLAN_CAPITAL_EUR;
      map.set(
        row.key,
        computeRecommendationGainIdea({
          simRow,
          chartPoints: chartPts,
          capitalEur: cap,
          miiAngleDeg: row.miiAngleDeg,
          planReturnPct: row.planReturnPct ?? gainPlan.targetReturnPct,
          daysToTarget: gainPlan.daysToTarget,
          suggestedAction: row.suggestedAction,
          targetProvisional: gainPlan.targetProvisional,
        }),
      );
    }
    return map;
  }, [rows, simRowByKey, pointsBySeriesKey, inputs]);

  const dealUrgencyByKey = useMemo(
    () =>
      buildDealUrgencyByKey(
        rows.map((row) => ({ key: row.key, idea: rowGainIdeas.get(row.key) })),
      ),
    [rows, rowGainIdeas],
  );

  const renderRow = (row: DashboardRecommendationRow) => {
    const simRow = simRowByKey.get(row.key) ?? null;
    const cd = String(simRow?.["Completion Date"] ?? "").trim();
    const chartPts = chartPointsForKey(simRow, pointsBySeriesKey);
    const gainPlan = gainPlanForRecommendationRow(simRow, inputs, row.key, chartPts);
    const cap = inputs[row.key]?.capital && inputs[row.key]!.capital > 0
      ? inputs[row.key]!.capital
      : DEFAULT_PLAN_CAPITAL_EUR;
    const gainIdea = rowGainIdeas.get(row.key) ?? computeRecommendationGainIdea({
      simRow,
      chartPoints: chartPts,
      capitalEur: cap,
      miiAngleDeg: row.miiAngleDeg,
      planReturnPct: row.planReturnPct ?? gainPlan.targetReturnPct,
      daysToTarget: gainPlan.daysToTarget,
      suggestedAction: row.suggestedAction,
      targetProvisional: gainPlan.targetProvisional,
    });
    const dealVisual = dealUrgencyByKey.get(row.key);
    const dealStyle = dealVisual
      ? dealUrgencyRowStyle(dealVisual.intensity, dealVisual.temperature)
      : undefined;
    const rationale = recommendationRationale(row);
    const clinicalKpi = clinicalKpiFromSimRow(simRow);
    const navFocus = { ticker: row.ticker, cd: cd || undefined };
    const sheetAction: "buy" | "sell" =
      row.suggestedAction === "sell" || (row.suggestedAction === "hold" && row.hasPosition)
        ? "sell"
        : "buy";
    const pos =
      simRow && row.hasPosition
        ? computeSimulationPosition(simRow, inputs, { history })
        : null;

    return (
      <tr
        key={row.key}
        className={`dashboard-rec-row border-t border-[rgb(var(--border))]/25 hover:brightness-[0.98] ${
          row.isNew ? "ring-1 ring-inset ring-[rgb(var(--accent))]/20" : ""
        }`}
        style={dealStyle}
      >
        <td className={`${gridTd("left")} py-2 whitespace-nowrap`}>
          <div className="flex items-center gap-1.5">
            {dealVisual && dealVisual.intensity > 0 && dealVisual.temperature ? (
              <DealUrgencyFlame
                visual={dealVisual}
                gainEur={gainIdea?.gainEur ?? 0}
                days={gainIdea?.days ?? 0}
                lang={it ? "it" : "en"}
              />
            ) : (
              <div 
                className="w-6 h-6 shrink-0 flex items-center justify-center opacity-20"
                title={it ? "Dati insufficienti per calcolare urgenza" : "Insufficient data to calculate urgency"}
              >
                <span className="text-[10px] text-ink-muted">—</span>
              </div>
            )}
            <PortfolioTickerMark
            ticker={row.ticker}
            inPortfolio={row.hasPosition}
            pnlPct={row.pnlPct ?? row.pnlPct24h}
            className="text-sm font-bold"
          />
          </div>
        </td>
        <td className={`${gridTd("left")} py-2 text-xs text-ink-muted max-w-[9rem] truncate`}>
          {row.companyName || "—"}
        </td>
        <td className={`${gridTd("center")} py-2`}>
          <div className="flex flex-col items-center gap-0.5">
            <span
              className={`text-xs font-bold uppercase ${suggestedActionToneClass(
                row.suggestedAction,
                row.hasPosition,
              )}`}
            >
              {suggestedActionLabel(row.suggestedAction, it ? "it" : "en", row.hasPosition)}
            </span>
            {row.recommendationScorePct != null ? (
              <span
                className={`text-xs font-bold tabular-nums leading-none ${suggestedActionToneClass(
                  row.suggestedAction,
                  row.hasPosition,
                )}`}
              >
                {Math.round(row.recommendationScorePct)}%
              </span>
            ) : null}
            {row.expectedAdviceAccuracyHint ? (
              <span
                className="text-[9px] text-ink-muted tabular-nums leading-tight text-center max-w-[7rem]"
                title={
                  it
                    ? "Accuratezza storica consigli nello stesso bin T rispetto al CD"
                    : "Historical advice success in the same T bin vs CD"
                }
              >
                {row.expectedAdviceAccuracyHint}
              </span>
            ) : null}
            <RecommendationGainIdeaCell
              idea={gainIdea}
              lang={it ? "it" : "en"}
              miiAngleDeg={row.miiAngleDeg}
              variant="inline"
              dealIntensity={dealVisual?.intensity ?? 0}
              dealTemperature={dealVisual?.temperature ?? null}
            />
          </div>
        </td>
        <td className={`${gridTd("center")} py-2`}>
          <button
            type="button"
            className="inline-flex flex-col items-center gap-0.5 hover:opacity-85 transition"
            title={t("sim.lossAnalysis.action.eisTip")}
            onClick={() => setEisDrawer({ ticker: row.ticker, kpi: clinicalKpi })}
          >
            <EisScoreBadge
              ticker={row.ticker}
              clinicalKpi={clinicalKpi}
              it={it}
              compact
            />
            <span className="text-xs text-accent/80 underline underline-offset-2">
              {t("sim.lossAnalysis.action.eis")}
            </span>
          </button>
        </td>
        {/* Risk & Benefit (skull + heart balance) — same loss-risk catalog
            used by every other surface, plus a heart whose fill grows with the
            expected % growth per day toward the plan target. */}
        <td className={`${gridTd("center")} py-2`} onClick={(e) => e.stopPropagation()}>
          {(() => {
            const entry =
              lookupLossRisk(lossRiskCatalog, row.ticker) ??
              ({
                ticker: row.ticker,
                phaseLabel: cd || "",
                riskScore: null,
                lossRisk: null,
              } satisfies LossRiskEntry);
            const expectedReturnPct =
              gainPlan?.expectedReturnPct ?? row.planReturnPct ?? null;
            const daysToTarget = gainPlan?.daysToTarget ?? null;
            const benefitFillPct = deriveBenefitFillPct({
              expectedReturnPct,
              daysToTarget,
              dailyChangePct: row.pnlPct24h ?? null,
            });
            const perDayPct =
              expectedReturnPct != null &&
              Number.isFinite(expectedReturnPct) &&
              daysToTarget != null &&
              daysToTarget > 0
                ? expectedReturnPct / daysToTarget
                : row.pnlPct24h ?? null;
            return (
              <RiskBenefitScaleCell
                entry={entry}
                benefitFillPct={benefitFillPct}
                perDayPct={perDayPct}
                onClick={() => setRiskModalEntry(entry)}
                it={it}
              />
            );
          })()}
        </td>
        <td className={`${gridTd("center")} py-2 tabular-nums font-semibold text-xs`}>
          {fmtUsd(row.currPriceUsd)}
        </td>
        <td className={`${gridTd("center")} py-2`}>
          <PnlDeltaCell
            pct={row.readingPct}
            measuredAt={row.readingCurrentTs}
            locale={it ? "it-IT" : "en-GB"}
            title={
              row.readingSource === "portfolio_history"
                ? t("dashboard.rec.lastReadPortfolioTip")
                : row.readingSource === "market_close"
                  ? t("dashboard.rec.lastReadMarketCloseTip")
                  : row.readingPriorTs
                    ? `${t("sim.workspace.table.pnlReadingTip")} · ${new Date(row.readingPriorTs).toLocaleString(it ? "it-IT" : "en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
                    : t("sim.workspace.table.pnlReadingTip")
            }
          />
        </td>
        <td className={`${gridTd("center")} py-2`}>
          <ModelTargetPriceCell
            simRow={simRow ?? undefined}
            columns={simTable?.columns}
            currPriceUsd={row.currPriceUsd}
            planReturnPct={row.planReturnPct}
            buyPriceUsd={pos?.buyPrice ?? (row.hasPosition ? inputs[row.key]?.buyPrice : null)}
            inPortfolio={row.hasPosition}
            daysToTarget={gainIdea.days ?? gainPlan?.daysToTarget ?? null}
            suggestedAction={row.suggestedAction}
            pnlPct={row.pnlPct}
            pnlUsd={pos ? positionGainUsd(pos) : null}
            shares={pos?.shares ?? null}
          />
        </td>
        <td
          className={`${gridTd("left")} py-2 text-xs text-ink-muted max-w-[10rem] truncate`}
          title={rationale ?? undefined}
        >
          {rationale ?? "—"}
        </td>
        <td className={`${gridTd("center")} py-2`} onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap items-center justify-center gap-1">
            {row.hasPosition && onSell ? (
              <PortfolioExitButton
                simKey={row.key}
                simRow={simRow}
                onSell={onSell}
                compact
                exitDecision={row.suggestedAction === "sell" ? "exit" : "review"}
              />
            ) : !row.hasPosition && onRegisterBuy ? (
              <PortfolioRegisterBuyButton
                ticker={row.ticker}
                simKey={row.key}
                capitalEur={DEFAULT_PLAN_CAPITAL_EUR}
                onRegisterBuy={onRegisterBuy}
                compact
              />
            ) : null}
            {onOpenSimulationSheet ? (
              <button
                type="button"
                className="btn-ghost text-xs px-1.5 py-0.5 border border-[rgb(var(--border))]/45"
                title={t("decisionLab.nav.openSimulationTip")}
                onClick={() =>
                  onOpenSimulationSheet({ ...navFocus, action: sheetAction })
                }
              >
                {t("dashboard.rec.openSim")}
              </button>
            ) : null}
            {onOpen24hAssessment ? (
              <button
                type="button"
                className="btn-ghost text-xs px-1.5 py-0.5 border border-[rgb(var(--border))]/45"
                title={t("sim.workspace.tab.lossAnalysisTip")}
                onClick={() => onOpen24hAssessment(navFocus)}
              >
                {t("dashboard.rec.open24h")}
              </button>
            ) : null}
          </div>
        </td>
        <td className={`${gridTd("center")} py-2 w-8`} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="w-6 h-6 rounded-full text-ink-muted hover:text-ink hover:bg-surface/80 border border-transparent hover:border-[rgb(var(--border))]/50 text-sm leading-none"
            title={t("dashboard.rec.dismissTip")}
            aria-label={t("dashboard.rec.dismissTip")}
            onClick={() => handleDismiss(row)}
          >
            ×
          </button>
        </td>
      </tr>
    );
  };

  const shellClass =
    variant === "modal"
      ? `flex flex-col w-full max-h-[min(88vh,820px)] overflow-hidden ${className ?? ""}`
      : `card dashboard-rec-panel dashboard-middle-panel flex flex-col w-full ${className ?? ""}`;

  return (
    <div className={shellClass}>
      <div className="dashboard-rec-head shrink-0 flex flex-col gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-elevated))]">
        <div className="min-w-0 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2
              id={variant === "modal" ? "dashboard-rec-modal-title" : undefined}
              className="text-base font-semibold text-ink"
            >
              {variant === "modal" ? t("dashboard.rec.modalTitle") : t("dashboard.rec.title")}
            </h2>
            <p
              className="mt-1 text-[11px] leading-snug text-ink-muted"
              title={t("dashboard.rec.sub", { n: counts.all, new: counts.new })}
            >
              {t("dashboard.rec.sub", { n: counts.all, new: counts.new })}
            </p>
          </div>
          {variant === "modal" && onClose ? (
            <button
              type="button"
              className="shrink-0 text-ink-muted hover:text-ink text-lg leading-none px-1"
              onClick={handleModalClose}
              aria-label={t("dashboard.rec.modalClose")}
            >
              ✕
            </button>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex rounded-lg border border-[rgb(var(--border))]/45 overflow-hidden text-[11px] font-semibold">
            {(
              [
                ["all", t("dashboard.rec.filterAll"), counts.all],
                ["portfolio", t("dashboard.rec.filterPortfolio"), counts.portfolio],
                ["opportunity", t("dashboard.rec.filterOpportunity"), counts.opportunity],
              ] as const
            ).map(([id, label, n]) => (
              <button
                key={id}
                type="button"
                className={`px-2 py-1 transition ${
                  profileFilter === id
                    ? "bg-[rgb(var(--accent))]/12 text-[rgb(var(--accent))]"
                    : "text-ink-muted hover:bg-surface/60"
                }`}
                onClick={() => setProfileFilter(id)}
              >
                {label}
                <span className="ml-1 tabular-nums opacity-80">{n}</span>
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-[rgb(var(--border))]/45 overflow-hidden text-[11px] font-semibold">
            {(
              [
                ["near", t("dashboard.rec.cdNear")],
                ["far", t("dashboard.rec.cdFar")],
                ["all", t("dashboard.rec.cdAll")],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`px-2 py-1 transition ${
                  cdFilter === id
                    ? "bg-[rgb(var(--accent))]/12 text-[rgb(var(--accent))]"
                    : "text-ink-muted hover:bg-surface/60"
                }`}
                onClick={() => setCdFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            className="input text-[11px] py-1 min-w-[8.5rem]"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as DashboardRecSortMode)}
            aria-label={t("dashboard.rec.sortLabel")}
          >
            <option value="recent">{t("dashboard.rec.sortRecent")}</option>
            <option value="score">{t("dashboard.rec.sortScore")}</option>
            <option value="deal">{t("dashboard.rec.sortDeal")}</option>
          </select>
        </div>
      </div>

      <div className={`dashboard-rec-table-wrap overflow-x-auto w-full ${variant === "modal" ? "flex-1 min-h-0 overflow-y-auto" : ""}`}>
        {simLoading ? (
          <div className="p-4 space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-9 rounded bg-[rgb(var(--panel-feed-row-hover))]/50 animate-pulse"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-ink-muted text-sm p-8 text-center leading-relaxed max-w-md mx-auto">
            {counts.all > 0 && (profileFilter !== "all" || cdFilter !== "all")
              ? t("dashboard.rec.emptyFiltered")
              : t("dashboard.rec.empty")}
          </p>
        ) : (
          <table className={`${SHEET_GRID_TABLE_CLASS} text-xs border-collapse w-full min-w-full`}>
            <SheetGridColgroup columnCount={11} />
            <thead className="sticky top-0 z-10 bg-[rgb(var(--surface-elevated))]">
              <tr className="text-xs uppercase tracking-wide text-ink-muted/70">
                <th className={gridTh("left", "py-2 font-semibold")}>Ticker</th>
                <th className={gridTh("left", "py-2 font-semibold")}>{t("dashboard.rec.colCompany")}</th>
                <th className={gridTh("center", "py-2 font-semibold")}>{t("dashboard.rec.colRec")}</th>
                <th className={gridTh("center", "py-2 font-semibold")}>EIS</th>
                <th
                  className={gridTh("center", "py-2 font-semibold")}
                  title={
                    it
                      ? "Bilancia rischio vs beneficio. Teschio (sx): rischio investimento 0-100. Cuore (dx): % crescita prezzo per giorno verso il target. Click per il dettaglio Phase A/B."
                      : "Risk vs benefit balance. Skull (left): investment-risk 0-100. Heart (right): expected % growth per day toward target. Click for the Phase A/B breakdown."
                  }
                >
                  Risk &amp; Benefit
                </th>
                <th className={gridTh("center", "py-2 font-semibold")}>{t("dashboard.rec.colPrice")}</th>
                <th className={gridTh("center", "py-2 font-semibold")}>
                  {t("sim.workspace.table.pnlReading")}
                </th>
                <th className={gridTh("center", "py-2 font-semibold")}>{t("sim.col.gainVsLoss")}</th>
                <th className={gridTh("left", "py-2 font-semibold")}>{t("dashboard.rec.colReason")}</th>
                <th className={gridTh("center", "py-2 font-semibold")}>{t("dashboard.rec.colActions")}</th>
                <th className={gridTh("center", "py-2 font-semibold w-8")} aria-label={t("dashboard.rec.dismissTip")} />
              </tr>
            </thead>
            <tbody>{rows.map(renderRow)}</tbody>
          </table>
        )}
      </div>

      <EisDetailDrawer
        open={eisDrawer != null}
        onClose={() => setEisDrawer(null)}
        ticker={eisDrawer?.ticker ?? null}
        clinicalKpi={eisDrawer?.kpi}
        it={it}
      />

      <LossRiskBreakdownModal
        entry={riskModalEntry}
        onClose={() => setRiskModalEntry(null)}
        it={it}
      />

      {variant === "modal" ? (
        <div className="shrink-0 flex justify-end gap-2 border-t border-[rgb(var(--border))]/50 px-4 py-3 bg-surface/50">
          <button type="button" className="btn-primary text-xs" onClick={handleModalClose}>
            {t("dashboard.rec.modalClose")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
