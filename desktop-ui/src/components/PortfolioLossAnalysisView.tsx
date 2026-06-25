import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ChartBundle, ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { buildSimRowByKeyMap, lossAnalysisCardDomId, reconcileInvestSimInputs } from "../sheet/investSimKeys";
import type { Top2PickSignal } from "../sheet/top2PortfolioPick";
import type { ScoreBreakdown } from "../sheet/investSignalScore";
import type { SimulationSolidityResult } from "../sheet/simulationEntrySolidity";
import { buildMigResultByKey, buildMigSolidityByKey, migSolidityKey, type MigSoliditySnapshot } from "../sheet/entrySolidityMig";
import {
  blendCurveFromSimChart,
  loadSdsReferenceCurves,
  type SdsRoiProfileId,
} from "../sheet/sdsRoiBlend";
import {
  blendOverlayColor,
  buildOverlayCurve,
  type SdsBlendOverlayCurve,
} from "../sheet/sdsCompareOverlay";
import {
  canonicalTodayOffset,
  transformBlendVsToday,
  transformOverlayVsToday,
} from "../sheet/assessmentChartHarmony";
import { supernovaOffsetLabel } from "../sheet/sdsHistoryCurve";
import { PortfolioPlanTargetChip, PlanTargetSummaryCell } from "./PortfolioPlanTargetChip";
import {
  countOffPortfolioByCdHorizon,
  loadSimCdHorizonScope,
  saveSimCdHorizonScope,
  SIM_HOT_ZONE_DAYS,
  SIM_MONITOR_HORIZON_DAYS,
  type SimCdHorizonScope,
} from "../sheet/simCdHorizonScope";
import { SdsSupernovaCompareChart } from "./SdsSupernovaCompareChart";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";
import { SlopeTrajectoryChart } from "./SlopeTrajectoryChart";
import { buildSlopeTrajectory, canRenderSlopeTrajectory } from "../sheet/slopeRecalibCurve";
import { DEFAULT_PLAN_CAPITAL_EUR } from "../sheet/expectedRoiDisplay";
import { computeRecommendationGainIdea } from "../sheet/recommendationGainIdea";
import { RecommendationGainIdeaCell } from "./RecommendationGainIdeaCell";
import { resolveExpectedGainPlan } from "../sheet/simulationPlanGain";
import {
  fmtPortfolioPnlPct,
  fmtPortfolioPnlUsd,
  portfolioPnlAccentClass,
} from "../sheet/portfolioGainLossStyle";
import {
  buildLossAnalysisItems,
  resolvePlanProbHeroPayload,
  summarizeLossAnalysis,
  type LossAnalysisProfile,
  type LossExitDecision,
  type PortfolioLossAnalysisItem,
} from "../sheet/portfolioLossAnalysis";
import { evaluateSimBuyGate, sortLossItemsByActionSolidity, deriveSuggestedAction, planProbDecisionForDisplay } from "../sheet/investDecisionSimLoop";
import {
  FWD_ENTRY_MIN,
  isForwardBelowEntryThreshold,
} from "../sheet/recoveryProbability";
import { PortfolioBuyPnlBadge } from "./ModelCurveGapCell";
import { PnlDualMetricStrip } from "./PnlDualMetricStrip";
import { SlopeVerdictPill } from "./SlopeVerdictPill";
import { PlanProbHero } from "./PlanProbHero";
import { exitDecisionBadgeClass } from "../sheet/exitDecisionUi";
import {
  fmtSlopeCapitalLossEur,
  slopeCapitalLossTone,
} from "../sheet/slopeStockPrices";
import { useLang, useT, type TranslationKey } from "../shared/i18n";
import { PortfolioExitButton, type PortfolioSellHandler } from "./PortfolioExitButton";
import { PortfolioRegisterBuyButton, type PortfolioRegisterBuyHandler } from "./PortfolioRegisterBuyButton";
import { EisDetailDrawer } from "./EisDetailDrawer";
import { useLossRiskCatalog, lookupLossRisk, lookupLossRiskByRowKey } from "../hooks/useLossRiskCatalog";
import {
  RiskBenefitScaleCell,
  deriveBenefitFillPct,
} from "./RiskBenefitScaleIcon";
import {
  LossRiskBreakdownModal,
  type LossRiskEntry,
} from "./LossRiskPoopCell";
import { clinicalKpiFromSimRow } from "../sheet/tickerEisSummary";
import {
  PortfolioGainPlanSingleChart,
  buildHypotheticalGainPlanRow,
  buildPortfolioGainPlanRowFromSim,
  type PortfolioGainChartRow,
} from "./PortfolioGainPlanChart";
import type { InvestSimHistoryPoint } from "../sheet/investSimStorage";
import { MigMarketModelSlopesDrawer } from "./MigMarketModelSlopesDrawer";
import { MigMarketModelSlopesCard } from "./MigMarketModelSlopesCard";
import { CdPatternWithEisSection } from "./CdPatternWithEisSection";
import { CdPatternSummaryCell } from "./CdPatternSummaryCell";
import {
  buildCdPatternTickerRecommendation,
  type CdPatternTickerRecommendation,
} from "../sheet/cdPatternRecommendation";
import { loadEisSuperScoreState, type EisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";

import { ModalChartHorizonBanner } from "./ModalChartHorizonBanner";
import { slopeWindowCaptionSuffix } from "../sheet/modalChartCaptions";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";

const LOSS_ANALYSIS_PROFILE_KEY = "supernova_loss_analysis_profile_v1";
const LOSS_SUMMARY_TABLE_COLLAPSED_KEY = "supernova_loss_summary_collapsed_v1";
const LOSS_ASSESSMENT_CHART_H = 200;

function loadSummaryTableCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(LOSS_SUMMARY_TABLE_COLLAPSED_KEY) === "1";
  } catch {
    return false;
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

function sortLossItemsByPolygonMatch(
  items: PortfolioLossAnalysisItem[],
  patternRecByKey: Map<string, CdPatternTickerRecommendation>,
): PortfolioLossAnalysisItem[] {
  return [...items].sort((a, b) => {
    const am = patternRecByKey.get(a.key)?.matchPct ?? -1;
    const bm = patternRecByKey.get(b.key)?.matchPct ?? -1;
    if (bm !== am) return bm - am;
    const da = a.daysToCd ?? 9999;
    const db = b.daysToCd ?? 9999;
    if (da !== db) return da - db;
    return a.ticker.localeCompare(b.ticker);
  });
}

function LossAnalysisChartTile({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="invest-trend-chart-panel rounded-lg border p-2 flex flex-col gap-1">
      <h4 className="text-[10px] font-bold uppercase tracking-wide text-ink-muted leading-tight">
        {title}
      </h4>
      <p className="text-[9px] text-ink-muted leading-snug">{caption}</p>
      <div className="h-[200px] min-h-[200px] w-full shrink-0 rounded-lg overflow-hidden">
        {children}
      </div>
    </div>
  );
}

type OpportunityPnl24Filter = "all" | "gain24h" | "loss24h";

type LossRascoreDetail = {
  result: SimulationSolidityResult;
  pick: Top2PickSignal;
  breakdown: ScoreBreakdown | null;
  ticker: string;
  cd: string;
  daysToCd: number | null;
};

function matchesOpportunityPnl24Filter(
  item: PortfolioLossAnalysisItem,
  filter: OpportunityPnl24Filter,
): boolean {
  if (filter === "all") return true;
  const pct = item.pnlPct24h;
  if (pct == null || !Number.isFinite(pct)) return false;
  if (filter === "gain24h") return pct > 0;
  if (filter === "loss24h") return pct < 0;
  return true;
}

/** Apply 24h move + best-picks filters — single pipeline for counts and visible rows. */
function applyOpportunityListFilters(
  items: PortfolioLossAnalysisItem[],
  pnlFilter: OpportunityPnl24Filter,
  bestOnly: boolean,
): PortfolioLossAnalysisItem[] {
  let out = items;
  if (pnlFilter !== "all") {
    out = out.filter((item) => matchesOpportunityPnl24Filter(item, pnlFilter));
  }
  if (bestOnly) {
    out = out.filter(isOpportunityBestPick);
  }
  return out;
}

function countOpportunityPnl24(
  items: PortfolioLossAnalysisItem[],
  filter: "gain24h" | "loss24h",
): number {
  return items.filter((item) => matchesOpportunityPnl24Filter(item, filter)).length;
}

function isOpportunityBestPick(item: PortfolioLossAnalysisItem): boolean {
  return item.exitDecision !== "exit";
}

function countOpportunityBestPicks(items: PortfolioLossAnalysisItem[]): number {
  return items.filter(isOpportunityBestPick).length;
}

function opportunityBestRank(
  item: PortfolioLossAnalysisItem,
  ra: LossRascoreDetail | null,
): number {
  const decisionWeight =
    item.exitDecision === "hold" ? 1_000_000 : item.exitDecision === "review" ? 100_000 : 0;
  const roi = (item.planReturnPct ?? -999) * 100;
  const raScore = ra?.result.composite.total ?? ra?.result.reliabilityScore ?? 0;
  const pnl24 = item.pnlPct24h ?? 0;
  const days = item.daysToCd ?? 9999;
  const cdBonus = Math.max(0, 365 - days);
  return decisionWeight + raScore * 1000 + roi * 10 + pnl24 * 5 + cdBonus;
}

function sortOpportunityBestFirst(
  items: PortfolioLossAnalysisItem[],
): PortfolioLossAnalysisItem[] {
  return [...items].sort(
    (a, b) =>
      opportunityBestRank(b, null) -
      opportunityBestRank(a, null),
  );
}

function loadLossAnalysisProfile(): LossAnalysisProfile {
  if (typeof window === "undefined") return "portfolio";
  try {
    const raw = localStorage.getItem(LOSS_ANALYSIS_PROFILE_KEY);
    if (raw === "opportunities" || raw === "portfolio") return raw;
  } catch {
    /* ignore */
  }
  return "portfolio";
}

function saveLossAnalysisProfile(profile: LossAnalysisProfile): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOSS_ANALYSIS_PROFILE_KEY, profile);
}

function decisionLabelKey(
  decision: LossExitDecision,
  profile: LossAnalysisProfile,
): TranslationKey {
  if (profile === "opportunities") {
    if (decision === "hold") return "sim.lossAnalysis.entryDecision.enter";
    if (decision === "exit") return "sim.lossAnalysis.entryDecision.skip";
    return "sim.lossAnalysis.entryDecision.wait";
  }
  return `sim.lossAnalysis.decision.${decision}` as TranslationKey;
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

// 10 columns — ticker · company · planProb · polygon · risk · targetRoi · gainIdea · pnl24h · miiAngle · slope
const SUMMARY_COL_PCT = [9, 12, 10, 10, 8, 10, 11, 10, 10, 10];

function LossAnalysisSummaryTable({
  items,
  patternRecByKey,
  migSolidityByKey,
  profile,
  collapsed,
  onToggleCollapsed,
  sortByPolygonMatch,
  onTogglePolygonSort,
  sortByActionSolidity,
  onToggleActionSoliditySort,
  onScrollTo,
  rowByKey,
  pointsBySeriesKey,
  inputs,
  lossRiskCatalog,
  catalogByRowKey,
  onOpenRiskModal,
  highlightedKey,
}: {
  items: PortfolioLossAnalysisItem[];
  patternRecByKey: Map<string, CdPatternTickerRecommendation>;
  migSolidityByKey: Map<string, MigSoliditySnapshot>;
  profile: LossAnalysisProfile;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sortByPolygonMatch: boolean;
  onTogglePolygonSort: () => void;
  sortByActionSolidity: boolean;
  onToggleActionSoliditySort: () => void;
  onScrollTo: (key: string) => void;
  rowByKey: Map<string, Record<string, unknown>>;
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  inputs: InvestSimInputs;
  /** Per-ticker loss-risk entries — `null` falls back to "—" cells. */
  lossRiskCatalog: import("../hooks/useLossRiskCatalog").LossRiskCatalog;
  catalogByRowKey: Map<string, LossRiskEntry>;
  onOpenRiskModal: (entry: LossRiskEntry) => void;
  /** Item key currently highlighted (mirrors the card highlight that fires
   *  when the user jumps here from the dashboard 24h shortcut). Renders an
   *  amber row background + amber underline on the company cell so the
   *  user's eye can lock onto the same ticker in both surfaces. */
  highlightedKey?: string | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  if (!items.length) return null;

  return (
    <div className="rounded-xl border border-[rgb(var(--border))]/50 bg-white/95 shadow-sm overflow-hidden">
      <div className="px-4 py-2 border-b border-[rgb(var(--border))]/30 bg-surface/40 flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
            <span className="ml-1.5 text-[10px] font-normal tabular-nums text-ink-muted/80">
              ({items.length})
            </span>
          </span>
        </button>
        <p
          className="ui-caption-clamp flex-1 min-w-0 max-w-[280px]"
          title={
            sortByActionSolidity
              ? t("sim.lossAnalysis.summaryTable.hintActionSort")
              : sortByPolygonMatch
                ? (it ? "Ordinate per probabilità raccomandazione (P(rec)) decrescente" : "Sorted by recommendation probability (P(rec)) descending")
                : t("sim.lossAnalysis.summaryTable.hint")
          }
        >
          {sortByActionSolidity
            ? t("sim.lossAnalysis.summaryTable.hintActionSort")
            : sortByPolygonMatch
              ? (it ? "Ordinate per P(rec) alta → bassa" : "Sorted by P(rec) high → low")
              : t("sim.lossAnalysis.summaryTable.hint")}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <SelectionChip
            active={sortByActionSolidity}
            onClick={onToggleActionSoliditySort}
            title={t("sim.lossAnalysis.summaryTable.sortActionSolidityTip")}
          >
            {t("sim.lossAnalysis.summaryTable.sortActionSolidity")}
          </SelectionChip>
          <SelectionChip
            active={sortByPolygonMatch}
            onClick={onTogglePolygonSort}
            title={t("sim.lossAnalysis.summaryTable.sortPolygonTip")}
          >
            {it ? "↓ P(rec) alte" : "↓ High P(rec)"}
          </SelectionChip>
        </div>
      </div>
      {!collapsed ? (
        <div className="panel-table-scroll overflow-x-auto">
          <table className={`${SHEET_GRID_TABLE_CLASS} text-[10px] border-collapse min-w-[780px]`}>
            <SheetGridColgroup columnCount={SUMMARY_COL_PCT.length} widths={SUMMARY_COL_PCT} />
            <thead>
              <tr className="text-[9px] uppercase text-ink-muted">
                <th className={gridTh("left")}>{t("sim.lossAnalysis.summaryTable.ticker")}</th>
                <th className={gridTh("left")}>{t("sim.lossAnalysis.summaryTable.company")}</th>
                <th
                  className={gridTh("center")}
                  title={t("sim.lossAnalysis.summaryTable.planProbTip")}
                >
                  {profile === "portfolio"
                    ? t("sim.lossAnalysis.summaryTable.planProbPortfolio")
                    : t("sim.lossAnalysis.summaryTable.planProb")}
                </th>
                <th className={gridTh("center")} title={t("sim.lossAnalysis.summaryTable.polygonTip")}>
                  {t("sim.lossAnalysis.summaryTable.polygon")}
                </th>
                <th
                  className={gridTh("center")}
                  title={
                    it
                      ? "Bilancia rischio vs beneficio. Teschio (sx): rischio investimento 0-100. Cuore (dx): % crescita prezzo per giorno verso il target. Click per il dettaglio Phase A/B."
                      : "Risk vs benefit balance. Skull (left): investment-risk 0-100. Heart (right): expected % growth per day toward target. Click for the Phase A/B breakdown."
                  }
                >
                  Risk &amp; Benefit
                </th>
                <th className={gridTh("center")}>{t("sim.lossAnalysis.metric.targetRoi")}</th>
                <th className={gridTh("center")} title={t("recommendation.gainIdea.tip")}>
                  {t("sim.lossAnalysis.metric.gainIdea")}
                </th>
                <th className={gridTh("center")} title={t("sim.lossAnalysis.metric.pnl24h")}>
                  {t("sim.lossAnalysis.summaryTable.pnl24h")}
                </th>
                <th className={gridTh("center")} title={t("signals.mig.col.miiAngleTip")}>
                  {t("signals.mig.col.miiAngle")}
                </th>
                <th className={gridTh("center")}>{t("sim.lossAnalysis.metric.slopeVerdict")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const patternRec = patternRecByKey.get(item.key) ?? null;
                const migSnap = migSolidityByKey.get(migSolidityKey(item.ticker, item.completionDate)) ?? null;
                const pnl24Accent = portfolioPnlAccentClass(item.pnlEur24h, item.pnlPct24h);
                const simRow = rowByKey.get(item.key) ?? null;
                const chartPts = item.seriesKey ? pointsBySeriesKey.get(item.seriesKey) ?? null : null;
                const cap =
                  inputs[item.key]?.capital && inputs[item.key]!.capital > 0
                    ? inputs[item.key]!.capital
                    : DEFAULT_PLAN_CAPITAL_EUR;
                const gainPlan = simRow
                  ? resolveExpectedGainPlan(simRow, cap, { chartPoints: chartPts })
                  : null;
                const gainIdea = computeRecommendationGainIdea({
                  simRow,
                  chartPoints: chartPts,
                  capitalEur: cap,
                  miiAngleDeg: migSnap?.slopeAngleDeg ?? null,
                  planReturnPct: item.planReturnPct ?? gainPlan?.targetReturnPct,
                  daysToTarget: gainPlan?.daysToTarget,
                  daysToCurvePeak: item.daysToCurvePeak,
                  curvePeakReturnPct: item.curvePeakReturnPct,
                  suggestedAction: deriveSuggestedAction(item, false),
                  holdDaysElapsed: item.holdDaysElapsed,
                  targetProvisional: item.planTargetProvisional,
                });
                const isRowHighlighted = highlightedKey === item.key;
                return (
                  <tr
                    key={item.key}
                    className={`hover:bg-[rgb(var(--surface-3))]/25 transition-colors ${
                      isRowHighlighted
                        ? "bg-amber-50 dark:bg-amber-900/20 outline outline-2 outline-amber-400/80 outline-offset-[-1px]"
                        : ""
                    }`}
                  >
                    <td className={gridTd("left")}>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="font-bold text-[rgb(var(--accent))] hover:underline tabular-nums inline-flex items-center gap-1"
                          title={t("sim.lossAnalysis.summaryTable.jumpTip")}
                          onClick={() => onScrollTo(item.key)}
                        >
                          <span>{item.ticker}</span>
                          {item.hasPosition ? (
                            <span
                              className="text-[10px] leading-none shrink-0"
                              title={t("sim.lossAnalysis.summaryTable.portfolioMark")}
                              aria-label={t("sim.lossAnalysis.summaryTable.portfolioMark")}
                            >
                              💼
                            </span>
                          ) : null}
                        </button>
                      </div>
                    </td>
                    <td
                      className={`${gridTd("left")} truncate max-w-[88px] transition-colors ${
                        isRowHighlighted
                          ? "text-amber-700 dark:text-amber-300 font-semibold underline decoration-amber-400/80 decoration-2 underline-offset-2"
                          : "text-ink-muted"
                      }`}
                    >
                      {item.company || "—"}
                    </td>
                    <td className={gridTd("center")}>
                      {(() => {
                        const simAction = deriveSuggestedAction(item, false);
                        const payload = resolvePlanProbHeroPayload(item, {
                          matchPct: patternRec?.matchPct ?? null,
                          miiAngleDeg: migSnap?.slopeAngleDeg ?? null,
                          lang: it ? "it" : "en",
                        });
                        return (
                          <PlanProbHero
                            variant="table"
                            probPct={payload.probPct}
                            decision={planProbDecisionForDisplay(payload.decision, simAction)}
                            suggestedAction={simAction}
                            inLoss={item.inLoss}
                            hasPosition={item.hasPosition}
                            profile={profile}
                            summary={payload.summary}
                          />
                        );
                      })()}
                    </td>
                    <td className={gridTd("center")}>
                      <CdPatternSummaryCell
                        rec={patternRec}
                        inPortfolio={item.hasPosition}
                      />
                    </td>
                    <td className={gridTd("center")} onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const entry =
                          lookupLossRiskByRowKey(catalogByRowKey, item.key) ??
                          lookupLossRisk(lossRiskCatalog, item.ticker) ??
                          ({
                            ticker: item.ticker,
                            phaseLabel: item.completionDate ?? "",
                            riskScore: null,
                            lossRisk: null,
                          } satisfies LossRiskEntry);
                        const expectedReturnPct =
                          gainPlan?.expectedReturnPct ??
                          item.planReturnPct ??
                          null;
                        const daysToTarget = gainPlan?.daysToTarget ?? null;
                        const benefitFillPct = deriveBenefitFillPct({
                          expectedReturnPct,
                          daysToTarget,
                          dailyChangePct: item.pnlPct24h ?? null,
                        });
                        const perDayPct =
                          expectedReturnPct != null &&
                          Number.isFinite(expectedReturnPct) &&
                          daysToTarget != null &&
                          daysToTarget > 0
                            ? expectedReturnPct / daysToTarget
                            : item.pnlPct24h ?? null;
                        return (
                          <RiskBenefitScaleCell
                            entry={entry}
                            benefitFillPct={benefitFillPct}
                            perDayPct={perDayPct}
                            onClick={() => onOpenRiskModal(entry)}
                            it={it}
                          />
                        );
                      })()}
                    </td>
                    <td className={gridTd("center")}>
                      <PlanTargetSummaryCell
                        pnlPct={item.hasPosition ? item.pnlPct : null}
                        planReturnPct={item.planReturnPct}
                        daysToCd={item.daysToCd}
                        chartPointsLoaded={item.chartPointsLoaded}
                        targetProvisional={item.planTargetProvisional}
                      />
                    </td>
                    <td className={gridTd("center")}>
                      <RecommendationGainIdeaCell
                        idea={gainIdea}
                        lang={it ? "it" : "en"}
                        miiAngleDeg={migSnap?.slopeAngleDeg ?? null}
                      />
                    </td>
                    <td className={`${gridTd("center")} tabular-nums font-semibold ${pnl24Accent}`}>
                      {item.pnlPct24h != null ? fmtPortfolioPnlPct(item.pnlPct24h) : "—"}
                    </td>
                    <td className={`${gridTd("center")} tabular-nums font-semibold`}>
                      {migSnap ? (
                        <span
                          className={
                            migSnap.slopeAngleDeg >= 0
                              ? "text-[rgb(var(--signal-up))]"
                              : "text-[rgb(var(--signal-down))]"
                          }
                          title={t("signals.mig.col.miiAngleTip")}
                        >
                          {migSnap.slopeAngleDeg >= 0 ? "+" : ""}
                          {migSnap.slopeAngleDeg.toFixed(1)}°
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className={gridTd("center")}>
                      <SlopeVerdictPill
                        verdict={item.stabilityVerdict}
                        size="sm"
                        showFlatWhenNone
                        curveRisingHold={item.curveRisingHold}
                        lang={it ? "it" : "en"}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function LossAnalysisCard({
  item,
  simRow,
  chartPts,
  sdsRow,
  migSnap,
  migRow,
  refCurves,
  onSell,
  onRegisterBuy,
  onOpenSlopeCharts,
  onOpenPredictionCharts,
  onOpenDecisionLab,
  onOpenEisDetail,
  profile,
  cardDomId,
  gainPlanRow,
  history,
  patternRec,
  highlighted = false,
}: {
  item: PortfolioLossAnalysisItem;
  simRow: Record<string, unknown> | null;
  chartPts: import("../types").ChartPoint[] | null;
  sdsRow?: SdsRow | null;
  migSnap?: MigSoliditySnapshot | null;
  migRow?: import("../sheet/marketInterestGate").MIGResult | null;
  refCurves: Partial<Record<SdsRoiProfileId, (number | null)[]>>;
  onSell: PortfolioSellHandler;
  onRegisterBuy?: PortfolioRegisterBuyHandler;
  onOpenSlopeCharts?: (ticker: string) => void;
  onOpenPredictionCharts: (focus: {
    ticker: string;
    completionDate: string;
    seriesKey: string | null;
  }) => void;
  onOpenDecisionLab?: (focus: { ticker: string; cd?: string }) => void;
  onOpenEisDetail?: (ticker: string, clinicalKpi?: number | null) => void;
  profile: LossAnalysisProfile;
  cardDomId: string;
  gainPlanRow?: PortfolioGainChartRow | null;
  history: InvestSimHistoryPoint[];
  patternRec?: CdPatternTickerRecommendation | null;
  /** When true, pulse + glow the card so the user instantly spots it after
   *  navigating here from the dashboard "24h" button. */
  highlighted?: boolean;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";

  const simBuyGate = useMemo(
    () => evaluateSimBuyGate(item, false, it ? "it" : "en"),
    [item, it],
  );

  const simAction = useMemo(() => deriveSuggestedAction(item, false), [item]);

  const todayOff = useMemo(
    () => (simRow ? canonicalTodayOffset(simRow, item.daysToCd) : null),
    [simRow, item.daysToCd],
  );

  const slopeTrajectory = useMemo(() => {
    if (!simRow || !chartPts?.length) return null;
    const days = item.daysToCd ?? Math.abs(todayOff ?? 30);
    if (!canRenderSlopeTrajectory({ chartPoints: chartPts, simRow, daysToCd: days })) {
      return null;
    }
    return buildSlopeTrajectory({ chartPoints: chartPts, simRow, daysToCd: days });
  }, [simRow, chartPts, item.daysToCd, todayOff]);

  const overlayCurve = useMemo(() => {
    if (!simRow || !chartPts?.length) return null;
    const raw = buildOverlayCurve(item.ticker, chartPts, simRow, 0, { extendedPostCd: true });
    if (!raw || todayOff == null) return raw;
    return transformOverlayVsToday(raw, todayOff);
  }, [simRow, chartPts, item.ticker, todayOff]);

  const blendOverlays = useMemo((): SdsBlendOverlayCurve[] => {
    if (!overlayCurve || !simRow || !chartPts?.length || !sdsRow) return [];
    const values = blendCurveFromSimChart(chartPts, simRow, refCurves, {
      sds: sdsRow.sds,
      days_to_cd: sdsRow.days_to_cd,
      cluster_scores: sdsRow.cluster_scores,
      cluster_a: sdsRow.cluster_a,
      cluster_b: sdsRow.cluster_b,
      cluster_c: sdsRow.cluster_c,
      cluster_d: sdsRow.cluster_d,
    }, {
      extendedPostCd: true,
      nowOffset: todayOff,
      offsets: overlayCurve.offsets,
    });
    if (!values) return [];
    const rebased = todayOff != null ? transformBlendVsToday(values, todayOff) : values;
    return [
      {
        ticker: item.ticker.toUpperCase(),
        color: blendOverlayColor(overlayCurve.color),
        values: rebased,
        offsets: overlayCurve.offsets,
      },
    ];
  }, [overlayCurve, simRow, chartPts, sdsRow, refCurves, item.ticker, todayOff]);

  const nowMarkers = useMemo(() => {
    if (todayOff == null || !Number.isFinite(todayOff)) return [];
    return [
      {
        offset: todayOff,
        label: t("decisionLab.sds.compareChart.nowMarkerShort", {
          offset: supernovaOffsetLabel(todayOff),
        }),
      },
    ];
  }, [todayOff, t]);

  const showGainPlanChart = Boolean(gainPlanRow);
  const [miiDrawerOpen, setMiiDrawerOpen] = useState(false);

  const slopeCaption = useMemo(() => {
    const base = t("sim.lossAnalysis.chart.caption.slope24h");
    const suffix = slopeWindowCaptionSuffix(item.slope5d, item.slope20d);
    return suffix ? `${base} · ${suffix}` : base;
  }, [item.slope5d, item.slope20d, t]);

  const predCaption = useMemo(() => {
    let cap = t("sim.lossAnalysis.chart.caption.predBlend");
    if (todayOff != null) {
      cap += ` · ${supernovaOffsetLabel(todayOff)}`;
    }
    if (item.daysToCurvePeak != null && item.curvePeakReturnPct != null) {
      cap += it
        ? ` · picco da oggi +${item.curvePeakReturnPct.toFixed(1)}% @ T−${item.daysToCurvePeak}`
        : ` · peak from today +${item.curvePeakReturnPct.toFixed(1)}% @ T−${item.daysToCurvePeak}`;
    }
    return cap;
  }, [item.curvePeakReturnPct, item.daysToCurvePeak, it, t, todayOff]);

  const planProb = useMemo(
    () =>
      resolvePlanProbHeroPayload(item, {
        matchPct: patternRec?.matchPct ?? null,
        sdsScore: sdsRow?.sds ?? null,
        sdsVeto: Boolean(sdsRow?.veto),
        miiAngleDeg: migSnap?.slopeAngleDeg ?? migRow?.slopeAngleDeg ?? null,
        eisSuperScore:
          patternRec?.nearestEis?.superScore ?? patternRec?.nearestEis?.score ?? null,
        lang: it ? "it" : "en",
      }),
    [item, patternRec, sdsRow, migSnap, migRow, it],
  );

  const entryForwardPct =
    item.curvePeakReturnPct != null && item.curvePeakReturnPct > 0
      ? item.curvePeakReturnPct
      : item.planReturnPct;
  const showForwardTooLowBadge =
    !item.hasPosition &&
    isForwardBelowEntryThreshold(entryForwardPct, {
      inLoss: false,
      matchPct: patternRec?.matchPct ?? null,
      dailyPct24h: item.pnlPct24h,
      daysToCd: item.daysToCd,
      sdsScore: sdsRow?.sds ?? null,
      eisSuperScore:
        patternRec?.nearestEis?.superScore ?? patternRec?.nearestEis?.score ?? null,
    });

  return (
    <article
      id={cardDomId}
      className={`rounded-xl shadow-sm overflow-hidden scroll-mt-4 transition-shadow duration-500 ${cardShellClass(item)}`}
    >
      <div className={`px-3 py-2 ${cardHeaderClass(item)}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-start gap-x-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pr-1">
                  <div className="inline-flex items-center gap-1.5">
                    <h3 className="text-base font-bold text-ink leading-tight">{item.ticker}</h3>
                  </div>
                  {item.hasPosition ? (
                    <PortfolioExitButton
                      simKey={item.key}
                      simRow={simRow}
                      onSell={onSell}
                      exitDecision={planProb.decision}
                    />
                  ) : (
                    <>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${exitDecisionBadgeClass(item.exitDecision)}`}
                      >
                        {t(decisionLabelKey(item.exitDecision, profile))}
                      </span>
                      {onRegisterBuy && simBuyGate.allowed ? (
                        <PortfolioRegisterBuyButton
                          ticker={item.ticker}
                          simKey={item.key}
                          capitalEur={DEFAULT_PLAN_CAPITAL_EUR}
                          onRegisterBuy={onRegisterBuy}
                          compact
                        />
                      ) : onRegisterBuy && simBuyGate.reason ? (
                        <span
                          className="inline-flex max-w-[220px] items-center rounded-full border border-[rgb(var(--border))]/50 bg-surface/50 px-2 py-0.5 text-[9px] font-medium text-ink-muted leading-tight"
                          title={simBuyGate.reason}
                        >
                          {t("sim.lossAnalysis.registerBuy.gatedShort")}
                        </span>
                      ) : null}
                      {showForwardTooLowBadge ? (
                        <span
                          className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200"
                          title={t("sim.lossAnalysis.badge.forwardTooLow", {
                            min: String(FWD_ENTRY_MIN),
                          })}
                        >
                          {t("sim.lossAnalysis.badge.forwardTooLow", {
                            min: String(FWD_ENTRY_MIN),
                          })}
                        </span>
                      ) : null}
                    </>
                  )}
                </div>
                {item.company ? (
                  <p
                    className={`text-[11px] truncate leading-tight transition-colors ${
                      highlighted
                        ? "text-amber-700 dark:text-amber-300 font-semibold underline decoration-amber-400/80 decoration-2 underline-offset-2"
                        : "text-ink-muted"
                    }`}
                  >
                    {item.company}
                  </p>
                ) : null}
                {item.hasPosition ? (
                  <>
                    <PnlDualMetricStrip
                      pnlEur={item.pnlEur}
                      pnlPct={item.pnlPct}
                      pnlEurSinceReading={item.pnlEurSinceReading}
                      pnlPctSinceReading={item.pnlPctSinceReading}
                      priorReadingTs={item.priorReadingTs}
                      pnlEurToday={item.pnlEur24h}
                      pnlPctToday={item.pnlPct24h}
                      hasToday={item.pnlPct24h != null || item.pnlEur24h != null}
                      hasReadingDelta={
                        item.pnlPctSinceReading != null || item.pnlEurSinceReading != null
                      }
                      capitalEur={item.capital}
                    />
                    <PortfolioBuyPnlBadge pnlPct={item.pnlPct} pnlEur={item.pnlEur} />
                  </>
                ) : (
                  <>
                    <PnlDualMetricStrip
                      pnlPctToday={item.pnlPct24h}
                      pnlEurToday={item.pnlEur24h}
                      hasToday
                    />
                    <p className="text-[13px] font-semibold tabular-nums leading-snug text-ink-muted">
                      {t("sim.lossAnalysis.opportunity.planCap", {
                        eur: DEFAULT_PLAN_CAPITAL_EUR.toLocaleString("en-US", { maximumFractionDigits: 0 }),
                      })}
                      {item.daysToCd != null ? (
                        <span className="text-xs font-normal ml-1.5">T−{item.daysToCd}d</span>
                      ) : null}
                    </p>
                  </>
                )}
              </div>
            </div>

            {(item.modelGapLossEur != null ||
              (item.planReturnPct != null && item.planReturnPct > 0)) ? (
              <div className="text-[11px] text-ink leading-snug flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                {item.modelGapLossEur != null ? (
                  <span
                    className={`font-semibold tabular-nums ${slopeCapitalLossTone(item.modelGapLossEur)}`}
                    title={t("signals.slope.col.capitalLoss.body")}
                  >
                    {t("sim.lossAnalysis.metric.capLossSummary", {
                      loss: fmtSlopeCapitalLossEur(item.modelGapLossEur, lang),
                    })}
                  </span>
                ) : null}
                {item.planReturnPct != null && item.planReturnPct > 0 ? (
                  <>
                    {item.modelGapLossEur != null ? (
                      <span className="text-ink-muted/70" aria-hidden>
                        ·
                      </span>
                    ) : null}
                    <PortfolioPlanTargetChip
                      pnlPct={item.pnlPct}
                      planReturnPct={item.planReturnPct}
                    />
                  </>
                ) : null}
              </div>
            ) : null}

            {item.daysToCurvePeak != null && item.curvePeakReturnPct != null ? (
              <p
                className="text-[10px] font-semibold text-slate-700 tabular-nums leading-snug line-clamp-2"
                title={t("sim.lossAnalysis.peak.tip")}
              >
                {it ? (
                  <>
                    Apice curva tra {item.daysToCurvePeak} giorni (
                    {item.curvePeakReturnPct >= 0 ? "+" : ""}
                    {item.curvePeakReturnPct.toFixed(1)}% poi appiattimento) — rimani fino all&apos;apice se pendenza{" "}
                    <span className="text-emerald-700 font-bold">resta ↑</span>
                  </>
                ) : (
                  <>
                    Curve peak in {item.daysToCurvePeak} days (
                    {item.curvePeakReturnPct >= 0 ? "+" : ""}
                    {item.curvePeakReturnPct.toFixed(1)}% then flattening) — hold until apex if slope{" "}
                    <span className="text-emerald-700 font-bold">stays ↑</span>
                  </>
                )}
              </p>
            ) : (
              <p className="text-[10px] text-ink-muted/80 leading-snug line-clamp-2">
                {t("sim.lossAnalysis.peak.missing")}
              </p>
            )}
          </div>

          <div className="shrink-0 pt-0.5">
            <PlanProbHero
              probPct={planProb.probPct}
              decision={planProbDecisionForDisplay(planProb.decision, simAction)}
              suggestedAction={simAction}
              inLoss={item.inLoss}
              hasPosition={item.hasPosition}
              profile={profile}
              summary={planProb.summary}
              variant={profile === "opportunities" ? "compact" : "hero"}
            />
          </div>
        </div>
      </div>

      {patternRec ? (
        <div className="px-4 py-3 border-b border-[rgb(var(--border))]/30 bg-white">
          <CdPatternWithEisSection
            rec={patternRec}
            inPortfolio={item.hasPosition}
            sheetClinicalKpi={clinicalKpiFromSimRow(simRow)}
            onOpenEisDetail={
              onOpenEisDetail
                ? () => onOpenEisDetail(item.ticker, clinicalKpiFromSimRow(simRow))
                : undefined
            }
          />
        </div>
      ) : null}

      <div className="px-3 pb-3">
        <ModalChartHorizonBanner variant="lossAnalysis" />
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 mt-2">
          <LossAnalysisChartTile title={t("sim.lossAnalysis.chart.predBlend")} caption={predCaption}>
            {overlayCurve ? (
              <SdsSupernovaCompareChart
                overlayCurves={[overlayCurve]}
                blendOverlays={blendOverlays}
                nowMarkers={nowMarkers}
                refCurves={refCurves}
                defaultVisiblePostRefs={["post_rialzo"]}
                compact
                companyFocus
                embedded
                chartOnly
              />
            ) : (
              <p className="text-xs text-ink-muted h-full flex items-center justify-center text-center px-2">
                {t("sim.lossAnalysis.noChart")}
              </p>
            )}
          </LossAnalysisChartTile>

          <LossAnalysisChartTile
            title={t("sim.gainPlan.title")}
            caption={
              showGainPlanChart
                ? item.hasPosition
                  ? t("sim.lossAnalysis.chart.caption.gainPlan")
                  : t("sim.lossAnalysis.chart.caption.gainPlanHypothesis")
                : t("sim.lossAnalysis.chart.caption.gainPlanMissing")
            }
          >
            {showGainPlanChart && gainPlanRow ? (
              <PortfolioGainPlanSingleChart
                row={gainPlanRow}
                history={history}
                embedded
                hideLegend
                height={LOSS_ASSESSMENT_CHART_H}
              />
            ) : (
              <p className="text-xs text-ink-muted h-full flex items-center justify-center text-center px-2">
                {t("sim.lossAnalysis.chart.gainPlanMissing")}
              </p>
            )}
          </LossAnalysisChartTile>

          <LossAnalysisChartTile title={t("sim.lossAnalysis.chart.slope24h")} caption={slopeCaption}>
            {slopeTrajectory && slopeTrajectory.points.length >= 2 ? (
              <SlopeTrajectoryChart
                points={slopeTrajectory.points}
                todayOffset={slopeTrajectory.todayOffset}
                lang={it ? "it" : "en"}
                predName={it ? "Modello + ricalib." : "Model + recalib."}
                actualName={it ? "Reale" : "Actual"}
                dailyMovePct={item.pnlPct24h}
                height={LOSS_ASSESSMENT_CHART_H}
                chartOnly
              />
            ) : (
              <p className="text-xs text-ink-muted h-full flex items-center justify-center text-center px-2 leading-snug">
                {t("sim.lossAnalysis.slopeMissing")}
              </p>
            )}
          </LossAnalysisChartTile>

          <LossAnalysisChartTile
            title={t("sim.lossAnalysis.miiDrawer.title")}
            caption={t("sim.lossAnalysis.chart.caption.mii")}
          >
            <button
              type="button"
              className="h-full w-full min-h-0 text-left rounded-lg transition hover:ring-2 hover:ring-sky-300/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/55"
              onClick={() => setMiiDrawerOpen(true)}
              title={t("sim.lossAnalysis.miiDrawer.openHint")}
            >
              <MigMarketModelSlopesCard
                row={migRow ?? null}
                pnlPct24h={item.pnlPct24h}
                pnlEur24h={item.pnlEur24h}
                embedded
              />
            </button>
          </LossAnalysisChartTile>
        </div>
      </div>

      <MigMarketModelSlopesDrawer
        open={miiDrawerOpen}
        onClose={() => setMiiDrawerOpen(false)}
        ticker={item.ticker}
        row={migRow ?? null}
        pnlPct24h={item.pnlPct24h}
        pnlEur24h={item.pnlEur24h}
      />

      <div className="px-4 pb-4 flex flex-wrap items-center gap-2">
        {onOpenSlopeCharts ? (
          <button
            type="button"
            className="btn-ghost text-xs border border-[rgb(var(--border))]/50"
            onClick={() => onOpenSlopeCharts(item.ticker)}
          >
            {t("sim.lossAnalysis.action.slope")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ghost text-xs border border-[rgb(var(--border))]/50"
          onClick={() =>
            onOpenPredictionCharts({
              ticker: item.ticker,
              completionDate: item.completionDate,
              seriesKey: item.seriesKey,
            })
          }
        >
          {t("sim.lossAnalysis.action.curves")}
        </button>
        {onOpenDecisionLab ? (
          <button
            type="button"
            className="btn-ghost text-xs border border-[rgb(var(--border))]/50"
            onClick={() =>
              onOpenDecisionLab({ ticker: item.ticker, cd: item.completionDate })
            }
          >
            {t("sim.lossAnalysis.action.decisionLab")}
          </button>
        ) : null}
        {onOpenEisDetail ? (
          <button
            type="button"
            className="btn-ghost text-xs border border-[rgb(var(--border))]/50"
            onClick={() =>
              onOpenEisDetail(item.ticker, clinicalKpiFromSimRow(simRow))
            }
            title={t("sim.lossAnalysis.action.eisTip")}
          >
            {t("sim.lossAnalysis.action.eis")}
          </button>
        ) : null}
        {migRow || migSnap ? (
          <button
            type="button"
            className="btn-ghost text-xs border border-[rgb(var(--border))]/50"
            onClick={() => setMiiDrawerOpen(true)}
            title={t("sim.lossAnalysis.miiDrawer.openHint")}
          >
            {t("sim.lossAnalysis.action.mii")}
          </button>
        ) : null}
      </div>
    </article>
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
  onFocusTickerConsumed,
  gainPlanRows,
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
  onFocusTickerConsumed?: () => void;
  /** Curva gain vs plan (stesso motore tab P&L). */
  gainPlanRows?: PortfolioGainChartRow[];
}) {
  const t = useT();
  const { lang } = useLang();
  const [profile, setProfile] = useState<LossAnalysisProfile>(() => loadLossAnalysisProfile());
  const [oppCdScope, setOppCdScope] = useState<SimCdHorizonScope>(() => loadSimCdHorizonScope());
  const [oppPnl24Filter, setOppPnl24Filter] = useState<OpportunityPnl24Filter>("all");
  const [oppPrioritizeBest, setOppPrioritizeBest] = useState(false);
  const [sortByPolygonMatch, setSortByPolygonMatch] = useState(false);
  const [sortByActionSolidity, setSortByActionSolidity] = useState(false);
  const [summaryTableCollapsed, setSummaryTableCollapsed] = useState(() => loadSummaryTableCollapsed());
  const [eisDrawer, setEisDrawer] = useState<{
    ticker: string;
    clinicalKpi: number | null;
  } | null>(null);
  const [riskModalEntry, setRiskModalEntry] = useState<LossRiskEntry | null>(null);
  /**
   * Key of the card that should briefly pulse / glow when the user lands on
   * this view via the dashboard "24h" button. Auto-clears after a few seconds
   * so it does not become permanent visual noise.
   */
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);

  // Per-ticker loss-risk catalog (Phase A screening + Phase B pattern) —
  // shared with the Three-portfolios table and the dashboard so risk scores
  // stay numerically identical across every surface.
  const { catalog: lossRiskCatalog, catalogByRowKey } = useLossRiskCatalog({
    simTable,
    sdsRows: sdsRows ?? null,
    chartBundle,
  });
  const [refCurves, setRefCurves] = useState<
    Partial<Record<SdsRoiProfileId, (number | null)[]>>
  >({});
  const [eisSuperScoreState, setEisSuperScoreState] = useState<EisSuperScoreState | null>(null);
  const polygonOverview = useCdPatternPolygonOverview();

  const setProfileAndPersist = (next: LossAnalysisProfile) => {
    setProfile(next);
    saveLossAnalysisProfile(next);
    if (next !== "opportunities") {
      setOppPnl24Filter("all");
      setOppPrioritizeBest(false);
    } else {
      setSummaryTableCollapsed(true);
    }
  };

  const setOppCdScopeAndPersist = (next: SimCdHorizonScope) => {
    setOppCdScope(next);
    saveSimCdHorizonScope(next);
    setOppPnl24Filter("all");
    setOppPrioritizeBest(false);
  };

  const oppHorizonCounts = useMemo(
    () => countOffPortfolioByCdHorizon(simTable?.rows ?? [], inputs),
    [simTable?.rows, inputs],
  );

  const opportunitySubtitle = useMemo(() => {
    if (oppCdScope === "watch") {
      return t("sim.lossAnalysis.subtitleOpportunitiesWatch", {
        min: SIM_HOT_ZONE_DAYS + 1,
        max: SIM_MONITOR_HORIZON_DAYS,
      });
    }
    return t("sim.lossAnalysis.subtitleOpportunitiesHot", { days: SIM_HOT_ZONE_DAYS });
  }, [oppCdScope, t]);

  const toggleSummaryTableCollapsed = () => {
    setSummaryTableCollapsed((prev) => {
      const next = !prev;
      saveSummaryTableCollapsed(next);
      return next;
    });
  };

  const scrollToItem = (key: string) => {
    const el = document.getElementById(lossAnalysisCardDomId(key));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openEisDetail = useCallback((ticker: string, clinicalKpi?: number | null) => {
    setEisDrawer({ ticker, clinicalKpi: clinicalKpi ?? null });
  }, []);

  useEffect(() => {
    void loadSdsReferenceCurves().then(({ refs }) => setRefCurves(refs));
  }, []);

  useEffect(() => {
    void loadEisSuperScoreState().then(setEisSuperScoreState);
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

  const portfolioItems = useMemo(
    () =>
      profile === "portfolio"
        ? buildLossAnalysisItems(
            "portfolio",
            simTable,
            inputs,
            pointsBySeriesKey,
            lang,
            history,
            lossProbOptions,
          )
        : [],
    [profile, simTable, inputs, pointsBySeriesKey, lang, history, lossProbOptions],
  );

  const opportunityItems = useMemo(
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
            oppCdScope,
          )
        : [],
    [
      simTable,
      inputs,
      pointsBySeriesKey,
      lang,
      history,
      lossProbOptions,
      oppCdScope,
    ],
  );

  const opportunityTotalCount = oppHorizonCounts.hot + oppHorizonCounts.watch;

  const items = profile === "portfolio" ? portfolioItems : opportunityItems;

  /** Base list for chip counts — respects «Best picks» when active so badges
   *  match what the user will see after applying the 24h filter too. */
  const opportunityCountBase = useMemo(
    () =>
      oppPrioritizeBest
        ? opportunityItems.filter(isOpportunityBestPick)
        : opportunityItems,
    [opportunityItems, oppPrioritizeBest],
  );

  const oppGain24Count = useMemo(
    () => countOpportunityPnl24(opportunityCountBase, "gain24h"),
    [opportunityCountBase],
  );
  const oppLoss24Count = useMemo(
    () => countOpportunityPnl24(opportunityCountBase, "loss24h"),
    [opportunityCountBase],
  );
  const oppBestCount = useMemo(
    () => countOpportunityBestPicks(opportunityItems),
    [opportunityItems],
  );

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

  const visibleItems = useMemo(() => {
    let base =
      profile === "opportunities"
        ? applyOpportunityListFilters(
            opportunityItems,
            oppPnl24Filter,
            oppPrioritizeBest,
          )
        : items;
    if (sortByActionSolidity) {
      const withinTier = sortByPolygonMatch
        ? (tierItems: PortfolioLossAnalysisItem[]) =>
            sortLossItemsByPolygonMatch(tierItems, patternRecByKey)
        : undefined;
      base = sortLossItemsByActionSolidity(base, false, withinTier);
    } else if (sortByPolygonMatch) {
      base = sortLossItemsByPolygonMatch(base, patternRecByKey);
    } else if (profile === "opportunities" && oppPrioritizeBest) {
      base = sortOpportunityBestFirst(base);
    }
    return base;
  }, [
    items,
    opportunityItems,
    profile,
    oppPnl24Filter,
    oppPrioritizeBest,
    sortByPolygonMatch,
    sortByActionSolidity,
    patternRecByKey,
  ]);

  const gainPlanByKey = useMemo(() => {
    const m = new Map<string, PortfolioGainChartRow>();
    for (const row of gainPlanRows ?? []) {
      m.set(row.key, row);
    }
    for (const item of items) {
      if (m.has(item.key)) continue;
      const simRow = rowByKey.get(item.key);
      if (!simRow) continue;
      const chartPts = item.seriesKey
        ? pointsBySeriesKey.get(item.seriesKey) ?? null
        : null;
      const built = item.hasPosition
        ? buildPortfolioGainPlanRowFromSim(
            item.key,
            simRow,
            inputs,
            history ?? [],
            chartPts,
          )
        : buildHypotheticalGainPlanRow(item.key, simRow, chartPts);
      if (built) m.set(item.key, built);
    }
    return m;
  }, [gainPlanRows, items, rowByKey, pointsBySeriesKey, inputs, history]);

  useEffect(() => {
    const rowKey = focusRowKey?.trim();
    if (rowKey) {
      const inPortfolio = portfolioItems.some((i) => i.key === rowKey);
      const inOpportunities = opportunityItems.some((i) => i.key === rowKey);
      if (inOpportunities && !inPortfolio && profile !== "opportunities") {
        setProfile("opportunities");
      } else if (inPortfolio && profile !== "portfolio") {
        setProfile("portfolio");
      }
    }
  }, [focusRowKey, portfolioItems, opportunityItems, profile]);

  useEffect(() => {
    const rowKey = focusRowKey?.trim();
    if (rowKey) {
      const hit =
        visibleItems.find((i) => i.key === rowKey) ??
        [...portfolioItems, ...opportunityItems].find((i) => i.key === rowKey);
      if (hit) {
        setHighlightedKey(hit.key);
        const scrollId = window.setTimeout(() => {
          scrollToItem(hit.key);
          onFocusTickerConsumed?.();
        }, profile === "opportunities" || portfolioItems.some((i) => i.key === rowKey) ? 120 : 220);
        const clearId = window.setTimeout(() => {
          setHighlightedKey((prev) => (prev === hit.key ? null : prev));
        }, 3800);
        return () => {
          window.clearTimeout(scrollId);
          window.clearTimeout(clearId);
        };
      }
    }

    if (!focusTicker?.trim()) return;
    const up = focusTicker.trim().toUpperCase();
    const hit = visibleItems.find((i) => i.ticker.toUpperCase() === up);
    if (!hit) return;
    // Light the matching card immediately so the eye locks onto it as soon as
    // the smooth-scroll finishes — without waiting for the scroll callback.
    setHighlightedKey(hit.key);
    const scrollId = window.setTimeout(() => {
      scrollToItem(hit.key);
      onFocusTickerConsumed?.();
    }, 120);
    const clearId = window.setTimeout(() => {
      setHighlightedKey((prev) => (prev === hit.key ? null : prev));
    }, 3800);
    return () => {
      window.clearTimeout(scrollId);
      window.clearTimeout(clearId);
    };
  }, [focusRowKey, focusTicker, onFocusTickerConsumed, visibleItems, portfolioItems, opportunityItems, profile]);

  const summary = useMemo(() => summarizeLossAnalysis(visibleItems), [visibleItems]);

  const totalAccent = portfolioPnlAccentClass(summary.totalPnlEur, null);
  const total24hAccent = portfolioPnlAccentClass(summary.totalPnlEur24h, null);
  const totalGapAccent = slopeCapitalLossTone(summary.totalModelGapLossEur);

  return (
    <section
      className={`sim-harmonize flex flex-col flex-1 ${embedded ? "" : "card"}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[rgb(var(--border))]/40 bg-surface/50 px-3 py-2 shrink-0">
        {!embedded && onBack ? (
          <button type="button" className="btn-ghost text-xs" onClick={onBack}>
            {t("sim.lossAnalysis.back")}
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className={`font-semibold text-ink inline-flex items-center gap-2 ${embedded ? "text-sm" : "text-base"}`}>
            <span aria-hidden>⏱</span>
            {embedded ? t("catalystHub.tab.portfolioStatus") : t("sim.lossAnalysis.title")}
          </h2>
          <p
            className="ui-subtitle-clamp mt-0.5"
            title={
              profile === "portfolio"
                ? t("sim.lossAnalysis.subtitle")
                : opportunitySubtitle
            }
          >
            {profile === "portfolio"
              ? t("sim.lossAnalysis.subtitle")
              : opportunitySubtitle}
          </p>
        </div>
        <div className="flex gap-0.5 p-0.5 rounded-md seg-toggle-track shrink-0">
          {(
            [
              ["portfolio", t("sim.lossAnalysis.profile.portfolio"), portfolioItems.length],
              [
                "opportunities",
                t("sim.lossAnalysis.profile.opportunities"),
                opportunityTotalCount,
              ],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              className={profile === id ? "seg-btn-active" : "seg-btn"}
              onClick={() => setProfileAndPersist(id)}
            >
              {label}
              {count > 0 ? (
                <span className="ml-1 tabular-nums opacity-80">({count})</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-sm text-ink-muted text-center max-w-md leading-relaxed">
            {profile === "portfolio"
              ? t("sim.lossAnalysis.empty")
              : oppCdScope === "watch"
                ? t("sim.lossAnalysis.emptyOpportunitiesWatch")
                : t("sim.lossAnalysis.emptyOpportunitiesHot")}
          </p>
        </div>
      ) : (
        <div className="panel-stack flex-1">
          <div className="panel-stack-pin px-3 pt-2 pb-2 space-y-2 border-b border-[rgb(var(--border))]/30">
          <p
            className="text-[10px] leading-snug text-ink-muted rounded-md border border-[rgb(var(--border))]/40 bg-surface/50 px-2 py-1.5"
            title={t("sim.raVerdict.col.tip", { investMin: 50, divestBelow: 35 })}
          >
            {t("sim.raVerdict.lossAnalysis.banner")}
          </p>
          {profile === "opportunities" ? (
            <div className="space-y-1.5 sim-workspace-toolbar">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[8px] font-medium uppercase tracking-wide text-ink-muted/70 shrink-0">
                  {t("sim.lossAnalysis.oppHorizon.label")}
                </span>
                <SelectionChipGroup>
                  <SelectionChip
                    active={oppCdScope === "hot"}
                    onClick={() => setOppCdScopeAndPersist("hot")}
                    title={t("sim.lossAnalysis.oppHorizon.hotTip", { days: SIM_HOT_ZONE_DAYS })}
                  >
                    {t("sim.lossAnalysis.oppHorizon.hot", { days: SIM_HOT_ZONE_DAYS })}
                    <span className="ml-1 tabular-nums opacity-80">({oppHorizonCounts.hot})</span>
                  </SelectionChip>
                  <SelectionChip
                    active={oppCdScope === "watch"}
                    onClick={() => setOppCdScopeAndPersist("watch")}
                    title={t("sim.lossAnalysis.oppHorizon.watchTip", {
                      min: SIM_HOT_ZONE_DAYS + 1,
                      max: SIM_MONITOR_HORIZON_DAYS,
                    })}
                    disabled={oppHorizonCounts.watch === 0}
                  >
                    {t("sim.lossAnalysis.oppHorizon.watch", {
                      min: SIM_HOT_ZONE_DAYS + 1,
                      max: SIM_MONITOR_HORIZON_DAYS,
                    })}
                    {oppHorizonCounts.watch > 0 ? (
                      <span className="ml-1 tabular-nums opacity-80">({oppHorizonCounts.watch})</span>
                    ) : null}
                  </SelectionChip>
                </SelectionChipGroup>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[8px] font-medium uppercase tracking-wide text-ink-muted/70 shrink-0">
                  {t("sim.lossAnalysis.oppFilter.label")}
                </span>
                <SelectionChipGroup>
                <SelectionChip
                  active={oppPnl24Filter === "all"}
                  onClick={() => setOppPnl24Filter("all")}
                >
                  {t("sim.lossAnalysis.oppFilter.all")}
                  <span className="ml-1 tabular-nums opacity-80">({opportunityItems.length})</span>
                </SelectionChip>
                <SelectionChip
                  active={oppPnl24Filter === "gain24h"}
                  onClick={() =>
                    setOppPnl24Filter((f) => (f === "gain24h" ? "all" : "gain24h"))
                  }
                >
                  {t("sim.lossAnalysis.oppFilter.gain24h")}
                  {oppGain24Count > 0 ? (
                    <span className="ml-1 tabular-nums opacity-80">({oppGain24Count})</span>
                  ) : null}
                </SelectionChip>
                <SelectionChip
                  active={oppPnl24Filter === "loss24h"}
                  onClick={() =>
                    setOppPnl24Filter((f) => (f === "loss24h" ? "all" : "loss24h"))
                  }
                >
                  {t("sim.lossAnalysis.oppFilter.loss24h")}
                  {oppLoss24Count > 0 ? (
                    <span className="ml-1 tabular-nums opacity-80">({oppLoss24Count})</span>
                  ) : null}
                </SelectionChip>
              </SelectionChipGroup>
              <span className="hidden sm:block w-px h-5 bg-[rgb(var(--border))]/50 shrink-0" aria-hidden />
              <SelectionChip
                active={oppPrioritizeBest}
                onClick={() => setOppPrioritizeBest((v) => !v)}
                title={t("sim.lossAnalysis.oppFilter.bestTip")}
                disabled={oppBestCount === 0}
              >
                <span aria-hidden className="mr-0.5">
                  ★
                </span>
                {t("sim.lossAnalysis.oppFilter.best")}
                {oppBestCount > 0 ? (
                  <span className="ml-1 tabular-nums opacity-80">({oppBestCount})</span>
                ) : null}
              </SelectionChip>
              </div>
            </div>
          ) : null}

          {visibleItems.length === 0 &&
          profile === "opportunities" &&
          (oppPnl24Filter !== "all" || oppPrioritizeBest) ? (
            <div className="py-8 px-2 flex items-center justify-center">
              <p className="text-sm text-ink-muted text-center max-w-md leading-relaxed">
                {oppPrioritizeBest && oppPnl24Filter !== "all"
                  ? t("sim.lossAnalysis.oppFilter.emptyCombined")
                  : oppPrioritizeBest
                    ? t("sim.lossAnalysis.oppFilter.emptyBest")
                    : t("sim.lossAnalysis.oppFilter.empty")}
              </p>
            </div>
          ) : visibleItems.length > 0 ? (
            <>
          {/* KPI snapshot eliminata per il portafoglio (consolidata nella
              tabella Pick stocks). Resta per le opportunità fuori portafoglio,
              dove non è ridondante. */}
          {profile === "opportunities" ? (
          <LossAnalysisSummaryTable
            items={visibleItems}
            patternRecByKey={patternRecByKey}
            migSolidityByKey={migSolidityByKey}
            profile={profile}
            collapsed={summaryTableCollapsed}
            onToggleCollapsed={toggleSummaryTableCollapsed}
            sortByPolygonMatch={sortByPolygonMatch}
            onTogglePolygonSort={() => setSortByPolygonMatch((v) => !v)}
            sortByActionSolidity={sortByActionSolidity}
            onToggleActionSoliditySort={() => setSortByActionSolidity((v) => !v)}
            onScrollTo={scrollToItem}
            rowByKey={rowByKey}
            pointsBySeriesKey={pointsBySeriesKey}
            inputs={inputs}
            lossRiskCatalog={lossRiskCatalog}
            catalogByRowKey={catalogByRowKey}
            onOpenRiskModal={setRiskModalEntry}
            highlightedKey={highlightedKey}
          />
          ) : null}

          <div className="panel-summary-strip">
            <span className="font-semibold tabular-nums shrink-0">
              {profile === "portfolio"
                ? t("sim.lossAnalysis.summary.count", { n: summary.count })
                : t("sim.lossAnalysis.summary.oppCount", { n: summary.count })}
            </span>
            {profile === "portfolio" ? (
              <>
                <span className="text-xs text-ink-muted tabular-nums">
                  {t("sim.lossAnalysis.summary.inLoss", { n: summary.lossCount })}
                  {" · "}
                  {t("sim.lossAnalysis.summary.inGain", { n: summary.gainCount })}
                </span>
                <span className={`font-semibold tabular-nums ${totalAccent}`}>
                  {t("sim.lossAnalysis.summary.totalPnl")}: {fmtPortfolioPnlUsd(summary.totalPnlEur)}
                </span>
                <span className="text-ink-muted text-xs tabular-nums">
                  €{summary.totalCapital.toLocaleString("en-US", { maximumFractionDigits: 0 })}{" "}
                  {t("sim.lossAnalysis.summary.invested")}
                </span>
              </>
            ) : null}
            <span className={`font-semibold tabular-nums ${total24hAccent}`}>
              {t("sim.lossAnalysis.summary.pnl24h")}: {fmtPortfolioPnlUsd(summary.totalPnlEur24h)}
            </span>
            <span className={`font-semibold tabular-nums text-xs ${totalGapAccent}`}>
              {t("sim.lossAnalysis.summary.totalGapLoss")}:{" "}
              {fmtSlopeCapitalLossEur(summary.totalModelGapLossEur, lang)}
            </span>
            <span className="text-xs text-ink-muted ml-auto flex flex-wrap gap-2">
              {profile === "portfolio" ? (
                <>
                  <span className="text-[rgb(var(--signal-down))] font-semibold">
                    {t("sim.lossAnalysis.summary.exit", { n: summary.exitCount })}
                  </span>
                  <span className="text-[rgb(var(--signal-up))] font-semibold">
                    {t("sim.lossAnalysis.summary.hold", { n: summary.holdCount })}
                  </span>
                  <span className="text-[rgb(var(--warn))] font-semibold">
                    {t("sim.lossAnalysis.summary.review", { n: summary.reviewCount })}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[rgb(var(--signal-up))] font-semibold">
                    {t("sim.lossAnalysis.summary.enter", { n: summary.holdCount })}
                  </span>
                  <span className="text-[rgb(var(--warn))] font-semibold">
                    {t("sim.lossAnalysis.summary.waitEntry", { n: summary.reviewCount })}
                  </span>
                  <span className="text-[rgb(var(--signal-down))] font-semibold">
                    {t("sim.lossAnalysis.summary.skip", { n: summary.exitCount })}
                  </span>
                </>
              )}
            </span>
          </div>
            </>
          ) : null}
          </div>

          {visibleItems.length > 0 ? (
          <div className="panel-stack-scroll px-3 py-3 space-y-3">
            {visibleItems.map((item) => (
              <LossAnalysisCard
                key={item.key}
                item={item}
                profile={profile}
                cardDomId={lossAnalysisCardDomId(item.key)}
                gainPlanRow={gainPlanByKey.get(item.key) ?? null}
                history={history ?? []}
                simRow={rowByKey.get(item.key) ?? null}
                chartPts={
                  item.seriesKey ? pointsBySeriesKey.get(item.seriesKey) ?? null : null
                }
                sdsRow={sdsRowByTicker.get(item.ticker.trim().toUpperCase()) ?? null}
                migSnap={
                  migSolidityByKey.get(migSolidityKey(item.ticker, item.completionDate)) ??
                  null
                }
                migRow={
                  migResultByKey.get(migSolidityKey(item.ticker, item.completionDate)) ??
                  null
                }
                refCurves={refCurves}
                patternRec={patternRecByKey.get(item.key) ?? null}
                onSell={onSell}
                onRegisterBuy={
                  profile === "opportunities" ? onRegisterBuy : undefined
                }
                onOpenSlopeCharts={embedded ? undefined : onOpenSlopeCharts}
                onOpenPredictionCharts={onOpenPredictionCharts}
                onOpenDecisionLab={onOpenDecisionLab}
                onOpenEisDetail={openEisDetail}
                highlighted={highlightedKey === item.key}
              />
            ))}
          </div>
          ) : null}
        </div>
      )}
      <EisDetailDrawer
        open={eisDrawer != null}
        onClose={() => setEisDrawer(null)}
        ticker={eisDrawer?.ticker ?? null}
        clinicalKpi={eisDrawer?.clinicalKpi}
        it={lang === "it"}
      />

      <LossRiskBreakdownModal
        entry={riskModalEntry}
        onClose={() => setRiskModalEntry(null)}
        it={lang === "it"}
      />
    </section>
  );
}
