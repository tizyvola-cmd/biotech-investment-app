import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  loadSimulationChartsBundle,
  invalidateSimulationChartsCache,
  simulationRowSeriesKey,
} from "../data/simulationCharts";
import {
  appendHistoryPoint,
  clearInvestSimHistory,
  holdingDaysFromInvestedAt,
  loadInvestSimHistory,
  persistInvestSimHistoryNow,
  resolveInvestedAt,
  inferInvestedAt,
  loadInvestSimUi,
  saveInvestSimUi,
  type InvestSimHistoryPoint,
  type InvestSimInputEntry,
  type InvestSimInputs,
  type InvestSimView,
  type SimulationNavFocus,
} from "../sheet/investSimStorage";
import { buildSimRowByKeyMap, normalizedRowKey, reconcileInvestSimInputs } from "../sheet/investSimKeys";
import { executePortfolioSell } from "../sheet/portfolioSell";
import {
  aggregateOpenPortfolioPnl,
  buildPortfolioDailyPnlLedger,
  buildPositions,
  currentPriceFromRow,
  dailyChangePctFromRow,
  positionCapitalPnlPct,
  resolvePositionPnlBreakdown,
  pnlTabNeedsPriorLegNote,
  rowHasActivePortfolio,
  positionPnlForOpenRow,
  sheetBuyPriceFromRow,
  type SimulationPosition,
} from "../sheet/simulationPosition";
import { fetchDesktopManifest } from "../data/projectData";
import { resolveDataRefreshIso } from "../shared/dataFreshness";
import type { ChartBundle, ChartPoint, SheetTable } from "../types";
import { TABLE_COLORS_ENABLED } from "../sheet/tableColorsEnabled";
import { SimulationSparkline } from "../sheet/simulationSparkline";
import { sparklineTargetStopFromSimRow } from "../sheet/simRowTargetStop";
import {
  buildSimScoreTooltip,
  signalMetricsFromSimRow,
} from "../sheet/investSignalScore";
import { loadSignCurveDailyDoc } from "../data/signCurveDailyData";
import { buildSignAccuracyCurveView, type SignAccuracyCurveView } from "../sheet/signAccuracyCurve";
import { SignalScoreBar } from "./SignalScoreBar";
import { ScoreAnalysisDrawer } from "./ScoreAnalysisDrawer";
import { PortfolioDailyPnlDrawer, DailyLedgerIcon } from "./PortfolioDailyPnlDrawer";
import {
  buildPortfolioGainAuditExport,
  downloadPortfolioGainAuditExcel,
} from "../sheet/portfolioGainAuditExport";
import { ClosedPiggyBankBeerGlass } from "./ClosedPiggyBankBeerGlass";
import { useClosedPiggyBank } from "../hooks/useClosedPiggyBank";
import type { ScoreDetailSignal } from "./SignalScoreDetailPanel";
import { RefreshControls } from "./RefreshControls";
import { useRefreshStatus } from "../shared/refreshStatusStore";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import { SelectionChip, SelectionChipGroup } from "./SelectionChip";
import { PortfolioTickerMark } from "./PortfolioScopeToggle";
import { PortfolioPnlTrendIcon } from "./PortfolioPnlTrendIcon";
import { PortfolioGainPlanChart } from "./PortfolioGainPlanChart";
import { PortfolioPnlBarChart } from "./PortfolioPnlBarChart";
import { PortfolioPnlSheetTable } from "./PortfolioPnlSheetTable";
import { PnlTabRankIcon, RankAnimalIcon } from "./DealRankBadge";
import { buildPnlRankIndexMap, dealRankVisual, sortByPnlRank, WORST_RANK_EMOJI } from "../sheet/dealRankIcon";
import { sortByPipelineReturnPct } from "../sheet/pipelineOpportunity";
import { ModelTargetPriceCell } from "./ModelTargetPriceCell";
import { isPlanTargetReached } from "./PortfolioPlanTargetChip";
import {
  LossRiskBreakdownModal,
  type LossRiskEntry,
} from "./LossRiskPoopCell";
import {
  RiskBenefitScaleCell,
  deriveBenefitFillPct,
} from "./RiskBenefitScaleIcon";
import { useLossRiskCatalog, lookupLossRisk } from "../hooks/useLossRiskCatalog";
import {
  resolveEntryGainPlan,
  resolveExpectedGainPlan,
  sortRowsByExpectedGain,
} from "../sheet/simulationPlanGain";
import { primaryReturnPctFromGainPlan } from "../sheet/canonicalRoi";
import { extractCurveInputs } from "../sheet/precatCurve";
import {
  DEFAULT_PLAN_CAPITAL_EUR,
  ExpectedRoiCell,
  TargetRoiCell,
} from "../sheet/expectedRoiDisplay";
import {
  portfolioDailyChangeLabel,
  portfolioPnlTabShellClass,
  portfolioPnlAccentClass,
  portfolioPnlTone,
  portfolioPnlValueClass,
  type PortfolioPnlTone,
  ptfBlockTotalClassName,
  ptfBlockDayClassName,
  ptfBlockDaySecondaryClassName,
  portfolioTableOutlookClass,
  resolvePnlRowOutlook,
  type PortfolioTableOutlook,
  portfolioPtfBlockTheme,
  portfolioPtfDayBlockTheme,
  portfolioRowArticleClass,
  fmtSignedEurPnl,
  summarizePortfolioWinRate,
} from "../sheet/portfolioGainLossStyle";
import {
  exitVerdict,
  buildExitVerdictContext,
  verdictTone,
} from "../sheet/exitVerdict";
import { auditSimulationBuyPrice } from "../sheet/simulationBuyPriceAudit";
import { useInvestSimInputsMutable } from "../hooks/useInvestSimInputs";
import { CapitalNumberInput } from "./CapitalNumberInput";
import { hydrateUiPrefsFromDisk, loadUiPrefsLocal, saveUiPrefs } from "../sheet/uiPrefs";
import { useSimLoopSynthAllocation } from "../hooks/useSimLoopSynthAllocation";
import { useSynthCapitalAutoSync } from "../hooks/useSynthCapitalAutoSync";
import { resolveSimTableSynthShare } from "../sheet/synthCapitalSyncLog";
import { SimTableCapitalCell } from "./SimTableCapitalCell";
import { DecimalTextInput } from "./DecimalTextInput";
import { formatDecimalInput } from "../sheet/decimalInput";
import {
  fmtAxisEurTick,
  fmtAxisPctTick,
  paddedEurDomain,
  paddedPctDomain,
} from "../sheet/chartAxisFormat";
import {
  compressInvestTrendHistory,
  investTrendEurDomain,
  investTrendPnlDomain,
  resolveInvestTrendOutlook,
  type InvestTrendOutlook,
} from "../sheet/investTrendOutlook";
import { EntrySolidityModal } from "./EntrySolidityModal";
import { pickSignalFromSimRow } from "../sheet/top2FromSimulation";
import { pickScoreBreakdown } from "../sheet/entrySolidityReliability";
import type { Top2PickSignal } from "../sheet/top2PortfolioPick";
import type { ScoreBreakdown } from "../sheet/investSignalScore";
import {
  resolveSimulationEntrySolidity,
  simulationSolidityVisible,
  type SimulationSolidityResult,
} from "../sheet/simulationEntrySolidity";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import { useLang, useT } from "../shared/i18n";
import {
  getActiveTopOpps,
  subscribeTopOpps,
  type TopOppsSnapshot,
} from "../sheet/topOppsStore";
import { recommendationTierForKey } from "../sheet/recommendationTiers";
import { loadTopOppMinAffidPct } from "../sheet/topOppQuality";
import {
  getTop2BuySell,
  subscribeTop2BuySell,
  type Top2BuySellSnapshot,
} from "../sheet/top2BuySellStore";
import {
  buildSimTableFilterCounts,
  filterActivePortfolioPositions,
  filterSimTablePositions,
  loadSimTableFilter,
  saveSimTableFilter,
  sortSimPositionsByDecline,
  sortSimPositionsByRoiPerDay,
  type SimTableFilterId,
} from "../sheet/simTableFilters";
import {
  countPositionsByCdHorizon,
  daysToCdForPosition,
  filterPositionsByCdHorizon,
  loadSimCdHorizonScope,
  saveSimCdHorizonScope,
  SIM_HOT_ZONE_DAYS,
  SIM_MONITOR_HORIZON_DAYS,
  type SimCdHorizonScope,
} from "../sheet/simCdHorizonScope";
import {
  loadSimTableSort,
  saveSimTableSort,
  sortSimPositionsBySortId,
  toggleRoiDescSort,
  type SimTableSortId,
} from "../sheet/simTableSort";
import {
  loadSimTableLayout,
  saveSimTableLayout,
  type SimTableLayoutId,
} from "../sheet/simTableLayout";
import {
  SHEET_GRID_TABLE_CLASS,
  sheetGridThClass,
  sheetGridTdClass,
  DECISION_LAB_GRID_COL_PCT,
  SIM_WORKSPACE_FULL_GRID_COL_PCT,
  type SheetGridColKey,
} from "../sheet/sheetGridTable";
import { loadSdsCohort, readLocalSdsSnapshot, type SdsRow } from "../api/supernova";
import { buildSdsByTicker, setCachedSdsForTopOpps, type SdsGateInfo } from "../sheet/sdsTopOppGate";
import { resolveSupernovaTargetRoi } from "../sheet/supernovaTargetRoi";
import { VariationHorizonSparkline } from "./VariationHorizonSparkline";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import { resolvePriceVariationHorizons } from "../sheet/priceVariationHorizons";
import {
  buildSlopeFeedForPanel,
  groupSlopeFeedByTicker,
  type UnifiedSlopeFeedRow,
} from "../sheet/slopeEventsFeed";
import { loadDismissedSlopeCharts } from "../sheet/slopeErrorCharts";
import { pickCompanyDisplayRow } from "../sheet/slopeCompanyRank";
import { slopePriceGapFromSimRow } from "../sheet/slopeStockPrices";
import { resolveSimRowSlopeDisplay } from "../sheet/simTableSlopeDisplay";
import { PriceVariationCell } from "./PriceVariationCell";
import { syncPriceReadingCache } from "../sheet/priceReadingCache";
import { buildSimTablePriceVersion, simTablePriceRows } from "../sheet/simTablePriceVersion";
import { refreshRaPolarityStore } from "../sheet/rascorePolarityStore";
import {
  CurveGapVsModelCell,
  CurveModelPriceCell,
  CurveRealPriceCell,
} from "./ModelCurveGapCell";
import {
  buildSimulationStyleContext,
  fmtSimulationCell,
  simulationCellStyle,
} from "../sheet/simulationStyles";
import { SimTableSlopeCell, SimTableSlopeColumnHeader } from "./SimTableSlopeCell";
import { resolveTodayExpectedVsRealUsd } from "../sheet/priceVariationHorizons";
import { detectPortfolioPositionAlerts } from "../sheet/portfolioLossUrgent";
import { detectOpportunityAnalysisAlerts, buildLossAnalysisItems } from "../sheet/portfolioLossAnalysis";
import { PortfolioLossAnalysisView } from "./PortfolioLossAnalysisView";
import { buildSimBuyGateByKey, evaluateSimBuyGate } from "../sheet/investDecisionSimLoop";
import { evaluateSimLoopPolicy, loadSimLoopPolicy } from "../sheet/simLoopAcceptancePolicy";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";

export type { InvestSimInputs };
export { buildPositions } from "../sheet/simulationPosition";

type Position = SimulationPosition;

/** Blocchi 1–2 neutri; giornata e totale seguono gain/loss. */
const PTF_BLK_NEUTRAL = portfolioPtfBlockTheme("flat");

/** Block-card layout (colori da portfolioPtfBlockTheme / DayBlockTheme). */
const PTF_CARD = {
  list: "flex flex-col gap-2.5",
  rowTotal: "rounded-xl border-2 p-3 shadow-sm",
  grid: "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2",
  blockTitle: "text-[10px] uppercase tracking-wide text-slate-600 font-semibold mb-1.5",
  blockTitleTotal: "text-[10px] uppercase tracking-wide font-semibold mb-1.5",
  metricGrid: "grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-1.5",
  metricGrid2: "grid grid-cols-2 gap-x-2 gap-y-1",
  field: "text-[10px] text-slate-600 font-medium leading-tight",
  value: "text-[11px] font-semibold text-slate-900 tabular-nums leading-tight",
  sub: "text-[10px] text-slate-600 tabular-nums mt-0.5",
} as const;

function ptfPnlToneFromDisplay(tone: PortfolioPnlTone): string {
  if (!TABLE_COLORS_ENABLED) return "text-slate-900";
  return portfolioPnlValueClass(tone);
}

function PtfField({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: string;
  title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <p className={`ptf-field-label ${PTF_CARD.field}`}>{label}</p>
      <p className={`ptf-field-value ${PTF_CARD.value} ${tone ?? ""}`}>{value}</p>
      {sub ? <p className={`ptf-field-sub ${PTF_CARD.sub}`}>{sub}</p> : null}
    </div>
  );
}

function formatHistoryTsLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatHistoryDayLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "2-digit" });
}

/** Find the X axis label closest to the investment moment. */
function investedAtToChartLabel(
  investedAt: string,
  history: InvestSimHistoryPoint[]
): string | null {
  if (!history.length) return null;
  const targetMs = Date.parse(investedAt);
  if (!Number.isFinite(targetMs)) return formatHistoryTsLabel(investedAt);

  let best = history[0];
  let bestDiff = Infinity;
  for (const h of history) {
    const ms = Date.parse(h.ts);
    if (!Number.isFinite(ms)) continue;
    const diff = Math.abs(ms - targetMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = h;
    }
  }
  return formatHistoryTsLabel(best.ts);
}

type InvestTrendMarker = {
  ts: string;
  tickers: string[];
  investedAt: string;
};

function buildInvestTrendMarkers(
  positions: Position[],
  inputs: InvestSimInputs,
  history: InvestSimHistoryPoint[],
  selectedKey: string | null
): InvestTrendMarker[] {
  const byTs = new Map<string, InvestTrendMarker>();

  for (const p of positions.filter(isActiveSimPosition)) {
    const investedAt = resolveInvestedAt(p.key, inputs[p.key], history);
    if (!investedAt) continue;
    const ts = investedAtToChartLabel(investedAt, history);
    if (!ts) continue;
    const prev = byTs.get(ts);
    if (prev) {
      if (!prev.tickers.includes(p.ticker)) prev.tickers.push(p.ticker);
      if (Date.parse(investedAt) < Date.parse(prev.investedAt)) prev.investedAt = investedAt;
    } else {
      byTs.set(ts, { ts, tickers: [p.ticker], investedAt });
    }
  }

  const markers = [...byTs.values()].sort(
    (a, b) => Date.parse(a.investedAt) - Date.parse(b.investedAt)
  );

  if (selectedKey) {
    const sel = positions.find((p) => p.key === selectedKey);
    if (sel) {
      const selAt = inferInvestedAt(sel.key, inputs[sel.key], history);
      const selTs = selAt ? investedAtToChartLabel(selAt, history) : null;
      if (selTs && !markers.some((m) => m.ts === selTs)) {
        markers.push({ ts: selTs, tickers: [sel.ticker], investedAt: selAt! });
        markers.sort((a, b) => Date.parse(a.investedAt) - Date.parse(b.investedAt));
      }
    }
  }

  return markers;
}

function InvestTrendMarkersLayer({
  markers,
  selectedTicker,
}: {
  markers: InvestTrendMarker[];
  selectedTicker?: string | null;
}) {
  if (!markers.length) return null;
  return (
    <>
      {markers.map((m) => {
        const isSelected = selectedTicker != null && m.tickers.includes(selectedTicker);
        const label =
          m.tickers.length === 1
            ? m.tickers[0]
            : `${m.tickers.slice(0, 2).join(" · ")}${m.tickers.length > 2 ? " +" + (m.tickers.length - 2) : ""}`;
        return (
          <ReferenceLine
            key={`inv-${m.ts}-${m.tickers.join("-")}`}
            x={m.ts}
            stroke={isSelected ? "#2563eb" : "#93c5fd"}
            strokeWidth={isSelected ? 1.5 : 1}
            strokeDasharray="3 4"
            strokeOpacity={isSelected ? 0.85 : 0.5}
            ifOverflow="extendDomain"
            label={{
              value: label,
              position: "insideTopLeft",
              fontSize: 9,
              fontWeight: 600,
              fill: isSelected ? "#1d4ed8" : "#64748b",
            }}
          />
        );
      })}
    </>
  );
}

const TREND_AXIS_TICK = { fontSize: 10, fill: "#64748b" };
const TREND_GRID = {
  strokeDasharray: "4 6",
  vertical: false as const,
  stroke: "#93c5fd",
  strokeOpacity: 0.38,
};
const TREND_PANEL_CLASS = "invest-trend-chart-panel rounded-xl border p-3 shadow-sm";

function InvestTrendBreakevenLayers({
  yDomain,
  breakevenLabel,
}: {
  yDomain: [number, number];
  breakevenLabel: string;
}) {
  return (
    <>
      <ReferenceArea
        y1={0}
        y2={yDomain[1]}
        fill="#dbeafe"
        fillOpacity={0.55}
        ifOverflow="extendDomain"
      />
      <ReferenceArea
        y1={yDomain[0]}
        y2={0}
        fill="#fef9c3"
        fillOpacity={0.45}
        ifOverflow="extendDomain"
      />
      <ReferenceLine
        y={0}
        stroke="#2563eb"
        strokeOpacity={0.55}
        strokeDasharray="5 4"
        label={{
          value: breakevenLabel,
          position: "right",
          fontSize: 9,
          fill: "#1d4ed8",
        }}
      />
    </>
  );
}

function InvestTrendChartTooltip({
  active,
  label,
  payload,
  valueMode,
}: {
  active?: boolean;
  label?: string;
  payload?: { dataKey: string; value: number; name: string; color: string }[];
  valueMode: "eur" | "pct";
}) {
  if (!active || !payload?.length) return null;
  const fmt = (v: number) =>
    valueMode === "eur"
      ? `€ ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
      : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/70 bg-[rgb(var(--surface-elevated))]/95 backdrop-blur-sm px-3 py-2 text-xs shadow-lg min-w-[9rem]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1.5">
        {label}
      </p>
      <div className="space-y-1">
        {payload
          .filter((p) => p.value != null && Number.isFinite(Number(p.value)))
          .map((p) => (
            <div key={p.dataKey} className="flex items-center justify-between gap-4 tabular-nums">
              <span className="flex items-center gap-1.5 text-ink-muted">
                <span
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{ background: p.color }}
                />
                {p.name}
              </span>
              <span className="font-semibold text-ink">{fmt(Number(p.value))}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function InvestTrendLegend({
  items,
}: {
  items: { key: string; label: string; color: string; dashed?: boolean }[];
}) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2 px-1">
      {items.map((it) => (
        <span key={it.key} className="inline-flex items-center gap-1.5 text-[10px] text-ink-muted">
          <span
            className="w-4 shrink-0"
            style={
              it.dashed
                ? { borderTop: `2px dashed ${it.color}`, height: 0, marginTop: 1 }
                : { height: 2, borderRadius: 9999, background: it.color }
            }
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function InvestTrendMessageBanner({
  outlook,
  pnlPct,
  pnlEur,
  pnlUnavailable,
}: {
  outlook: InvestTrendOutlook;
  pnlPct: number;
  pnlEur: number;
  pnlUnavailable: boolean;
}) {
  const pnlAccent = pnlUnavailable
    ? "text-ink-muted"
    : portfolioPnlAccentClass(pnlEur, pnlPct);
  const pnlLabel = pnlUnavailable
    ? "—"
    : `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%`;
  return (
    <div
      className={`rounded-xl border px-4 py-3.5 shadow-sm shrink-0 ${outlook.bannerShell}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <span className="text-2xl leading-none shrink-0" aria-hidden>
          {outlook.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className={`text-base font-bold leading-snug ${outlook.bannerTitle}`}>
            {outlook.title}
          </h3>
          <p className={`text-sm mt-1 leading-snug ${outlook.bannerBody}`}>{outlook.body}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
            P&amp;L totale
          </p>
          <p className={`text-2xl font-bold tabular-nums ${pnlAccent}`}>{pnlLabel}</p>
          {!pnlUnavailable ? (
            <p className={`text-xs tabular-nums mt-0.5 ${pnlAccent}`}>
              {pnlEur >= 0 ? "+" : ""}€ {Math.abs(pnlEur).toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InvestTrendCapitalGap({
  capital,
  valueNow,
  outlook,
}: {
  capital: number;
  valueNow: number;
  outlook: InvestTrendOutlook;
}) {
  const gap = valueNow - capital;
  const gapPct = capital > 0 ? (gap / capital) * 100 : 0;
  const maxVal = Math.max(capital, valueNow, 1);
  const capitalPct = (capital / maxVal) * 100;
  const valuePct = (valueNow / maxVal) * 100;
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-[rgb(var(--surface-elevated))]/40 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <span className="text-ink-muted">Capitale investito → Valore oggi</span>
        <span className="font-semibold tabular-nums" style={{ color: outlook.lineColor }}>
          {gap >= 0 ? "+" : ""}€ {gap.toLocaleString("en-US", { maximumFractionDigits: 0 })}
          <span className="text-ink-muted font-normal ml-1">
            ({gapPct >= 0 ? "+" : ""}{gapPct.toFixed(2)}%)
          </span>
        </span>
      </div>
      <div className="relative h-3 rounded-full bg-[rgb(var(--border))]/20 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[rgb(var(--border))]/45"
          style={{ width: `${capitalPct}%` }}
          title="Capitale investito"
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all"
          style={{
            width: `${valuePct}%`,
            background: outlook.lineColor,
            opacity: 0.9,
          }}
          title="Valore oggi"
        />
      </div>
      <div className="flex justify-between text-[10px] text-ink-muted tabular-nums">
        <span>€ {capital.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
        <span>€ {valueNow.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
      </div>
    </div>
  );
}

const DEFAULT_SIM_BUY_CAPITAL_EUR = DEFAULT_PLAN_CAPITAL_EUR;

function parseSimDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // dd/mm/yyyy
  const mIt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (mIt) {
    const d = Number(mIt[1]);
    const m = Number(mIt[2]);
    const y = Number(mIt[3]);
    const out = new Date(y, m - 1, d);
    return Number.isFinite(out.getTime()) ? out : null;
  }
  // yyyy-mm-dd
  const mIso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (mIso) {
    const y = Number(mIso[1]);
    const m = Number(mIso[2]);
    const d = Number(mIso[3]);
    const out = new Date(y, m - 1, d);
    return Number.isFinite(out.getTime()) ? out : null;
  }
  const out = new Date(s);
  return Number.isFinite(out.getTime()) ? out : null;
}

function fmtDdMmYyyy(raw: string | null | undefined): string {
  const d = parseSimDate(raw);
  if (!d) return raw && String(raw).trim() ? String(raw).trim() : "—";
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Data ingresso per card P&L: purchaseDate utente, altrimenti investedAt. */
function resolvePurchaseDateLabel(
  entry: InvestSimInputEntry | undefined,
  investedAt: string | null,
): string | null {
  if (entry?.purchaseDate?.trim()) {
    const d = fmtDdMmYyyy(entry.purchaseDate);
    if (d !== "—") return d;
  }
  if (investedAt?.trim()) {
    const d = fmtDdMmYyyy(investedAt);
    if (d !== "—") return d;
  }
  return null;
}

function fmtSnapshotPriceLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Simulated position with allocated capital (buy price optional for P&L). */
function isActiveSimPosition(p: Position): boolean {
  return p.capital > 0;
}

function portfolioSnapshot(
  positions: Position[],
  rowByKey: Map<string, Record<string, unknown>>,
  inputs: InvestSimInputs,
  history: InvestSimHistoryPoint[],
) {
  const withCapital = positions.filter((p) => p.capital > 0);
  let cap = 0;
  let val = 0;
  let capPriced = 0;
  let pnlSum = 0;
  const byTicker: InvestSimHistoryPoint["byTicker"] = {};
  for (const p of withCapital) {
    cap += p.capital;
    if (p.buyPrice <= 0 || p.pnlUnavailable) continue;
    const row = rowByKey.get(p.key);
    const m = row ? positionPnlForOpenRow(row, inputs, history) : null;
    const pnlEur = m?.pnlEur ?? p.pnlEur;
    const pnlPct = m?.pnlPct ?? p.pnlPct;
    const value = p.capital + (Number.isFinite(pnlEur) ? pnlEur : 0);
    capPriced += p.capital;
    val += value;
    pnlSum += Number.isFinite(pnlEur) ? pnlEur : 0;
    byTicker[p.key] = {
      value,
      pnl: pnlEur,
      pnlPct: pnlPct ?? 0,
    };
  }
  const pnl = pnlSum;
  const pct = capPriced > 0 ? (pnl / capPriced) * 100 : 0;
  return { cap, val, pnl, pct, n: withCapital.length, byTicker };
}

export type InvestmentSimulationViewProps = {
  simTable: SheetTable | null;
  simLoading: boolean;
  simError: string | null;
  onReloadSimulation: () => void;
  /** Opens Catalyst & curves → Charts with prediction curves for the ticker. */
  onOpenPredictionCharts: (focus: {
    ticker: string;
    completionDate: string;
    seriesKey: string | null;
  }) => void;
  /** Opens Decision Lab → matching opportunity card for the ticker/CD. */
  onOpenDecisionLabBlock?: (focus: { ticker: string; cd?: string }) => void;
  /** Opens Catalyst Hub → Simulation table. */
  onOpenCatalystCharts?: () => void;
  /** Opens Catalyst Hub → Slope errors charts. */
  onOpenSlopeCharts?: (ticker: string) => void;
  focusTicker?: SimulationNavFocus | null;
  onFocusConsumed?: () => void;
  /** Embedded in Decision Lab: Price Δ% table only (variations layout). */
  embedMode?: "full" | "decisionLab";
  /** Decision Lab Performance → Simulation workspace row. */
  onOpenSimulationRow?: (focus: { ticker: string; cd?: string }) => void;
  /** Full Decision Lab sidebar screen. */
  onOpenDecisionLabScreen?: () => void;
  /** Decision Lab → SuperNova (SDS) tab; optional ticker focus. */
  onOpenSupernovaScreen?: (ticker?: string) => void;
  /** Decision Lab → CD Pattern recommendation tab; optional ticker focus. */
  onOpenPatternScreen?: (ticker?: string) => void;
  /** Parent Pick stocks refresh — sync embedded tables/charts with snapshot reload. */
  parentReloadToken?: number;
};

export function InvestmentSimulationView({
  simTable,
  simLoading,
  simError,
  onReloadSimulation,
  onOpenPredictionCharts,
  onOpenDecisionLabBlock,
  onOpenCatalystCharts,
  onOpenSlopeCharts,
  focusTicker,
  onFocusConsumed,
  embedMode = "full",
  onOpenSimulationRow,
  onOpenDecisionLabScreen,
  onOpenSupernovaScreen,
  onOpenPatternScreen,
  parentReloadToken = 0,
}: InvestmentSimulationViewProps) {
  const isDecisionLabEmbed = embedMode === "decisionLab";
  const [simTableLayout, setSimTableLayout] = useState<SimTableLayoutId>(() =>
    loadSimTableLayout(),
  );
  /** Decision Lab: tabella unificata (sim + var spark + ROI-Target SN). */
  const effectiveTableLayout: SimTableLayoutId | "decisionLab" = isDecisionLabEmbed
    ? "decisionLab"
    : simTableLayout;
  const [sdsByTicker, setSdsByTicker] = useState<Map<string, SdsGateInfo>>(() => new Map());
  const [sdsRowsForMig, setSdsRowsForMig] = useState<SdsRow[] | null>(null);
  const [eisSuperScoreState, setEisSuperScoreState] = useState<
    Awaited<ReturnType<typeof loadEisSuperScoreState>> | null
  >(null);
  const polygonOverview = useCdPatternPolygonOverview();
  const [simInputsReloadToken, setSimInputsReloadToken] = useState(0);
  const { inputs, patchInputs } = useInvestSimInputsMutable(simTable, simInputsReloadToken);
  const history = useInvestSimPortfolioHistory(simInputsReloadToken).history;
  const [solidityModalKey, setSolidityModalKey] = useState<string | null>(null);
  const [ui, setUi] = useState(() => loadInvestSimUi());

  const TOP_CAPITAL_DEFAULT = 5000;
  const isTopCapitalUserSetRef = useRef(false);
  const [topCapital, setTopCapital] = useState<number>(() => {
    const v = loadUiPrefsLocal().topCapital;
    if (v != null && Number.isFinite(v) && v >= 0) {
      isTopCapitalUserSetRef.current = true;
      return v;
    }
    return TOP_CAPITAL_DEFAULT;
  });
  useEffect(() => {
    if (isTopCapitalUserSetRef.current) return;
    let cancelled = false;
    void (async () => {
      const disk = await hydrateUiPrefsFromDisk();
      if (cancelled || !disk) return;
      if (
        disk.topCapital != null &&
        Number.isFinite(disk.topCapital) &&
        disk.topCapital >= 0
      ) {
        isTopCapitalUserSetRef.current = true;
        setTopCapital(disk.topCapital);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!isTopCapitalUserSetRef.current) return;
    saveUiPrefs({ topCapital });
  }, [topCapital]);

  useEffect(() => {
    let cancelled = false;
    void loadSignCurveDailyDoc().then(({ doc }) => {
      if (cancelled) return;
      setSignCurveView(buildSignAccuracyCurveView(null, doc));
    });
    return () => {
      cancelled = true;
    };
  }, [simTable]);

  useEffect(() => {
    let cancelled = false;
    const apply = (rows: Parameters<typeof buildSdsByTicker>[0]) => {
      const map = buildSdsByTicker(rows);
      setSdsByTicker(map);
      setCachedSdsForTopOpps(map);
      setSdsRowsForMig(rows ?? null);
    };
    void loadSdsCohort(false)
      .then((doc) => {
        if (!cancelled && doc?.rows?.length) apply(doc.rows);
      })
      .catch(() => {
        void readLocalSdsSnapshot().then((doc) => {
          if (!cancelled && doc?.rows?.length) apply(doc.rows);
        });
      });
    return () => {
      cancelled = true;
    };
  }, [simTable, parentReloadToken]);

  useEffect(() => {
    void loadEisSuperScoreState().then(setEisSuperScoreState);
  }, [parentReloadToken]);

  const [priceDataHint, setPriceDataHint] = useState<string | null>(null);
  const [priceSnapshotAt, setPriceSnapshotAt] = useState<string | null>(null);
  const [simTableFilter, setSimTableFilter] = useState<SimTableFilterId>(() =>
    loadSimTableFilter(),
  );
  const [simCdHorizonScope, setSimCdHorizonScope] = useState<SimCdHorizonScope>(() =>
    loadSimCdHorizonScope(),
  );
  const [simTableSort, setSimTableSort] = useState<SimTableSortId>(() => loadSimTableSort());
  const [scoreDrawerOpen, setScoreDrawerOpen] = useState(false);
  const [dailyPnlLedgerOpen, setDailyPnlLedgerOpen] = useState(false);
  const [scoreFocusTicker, setScoreFocusTicker] = useState<string | null>(null);
  const [signCurveView, setSignCurveView] = useState<SignAccuracyCurveView | null>(null);
  const [topOpps, setTopOpps] = useState<TopOppsSnapshot>(() => getActiveTopOpps());
  const [top2BuySell, setTop2BuySell] = useState<Top2BuySellSnapshot>(() => getTop2BuySell());
  const [lastRecalcAt, setLastRecalcAt] = useState(() => Date.now());
  const [cdScanBusy, setCdScanBusy] = useState(false);
  const [cdScanPhase, setCdScanPhase] = useState<string | null>(null);
  const [cdScanError, setCdScanError] = useState<string | null>(null);
  const tableBodyRef = useRef<HTMLDivElement>(null);
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;
  const t = useT();
  const { lang } = useLang();
  const { apiOk: refreshApiOk, dataUpdatedAt, life: refreshLife, finishedAt: refreshFinishedAt } =
    useRefreshStatus();

  useEffect(() => {
    const unsubTop = subscribeTopOpps(setTopOpps);
    const unsubTop2 = subscribeTop2BuySell(setTop2BuySell);
    return () => {
      unsubTop();
      unsubTop2();
    };
  }, []);

  const simTableVersion = useMemo(
    () => buildSimTablePriceVersion(simTable, inputs),
    [simTable, inputs],
  );

  const refreshPriceManifest = useCallback(() => {
    let cancelled = false;
    void fetchDesktopManifest().then((m) => {
      if (cancelled) return;
      const at = resolveDataRefreshIso(m?.updated_at, m?.workbook_mtime);
      setPriceSnapshotAt(at);
      if (!at) {
        setPriceDataHint(null);
        return;
      }
      const atMs = Date.parse(at);
      if (!Number.isFinite(atMs)) {
        setPriceDataHint(null);
        return;
      }
      const ageH = (Date.now() - atMs) / 3_600_000;
      if (ageH < 2) {
        setPriceDataHint(null);
        return;
      }
      const when = new Date(atMs).toLocaleString(lang === "it" ? "it-IT" : "en-US", {
        hour12: false,
      });
      setPriceDataHint(
        lang === "it"
          ? `Ultimo aggiornamento prezzi @ ${when} (${Math.round(ageH)}h fa). Su VPS i prezzi si aggiornano soli ogni ora lun–ven 15:30–22:00 (Roma); l'app ricarica i fogli entro ~20s. Se resta vecchio: API server spenta o non connesso al VPS.`
          : `Last price update @ ${when} (${Math.round(ageH)}h ago). On VPS, prices refresh hourly Mon–Fri 15:30–22:00 Rome; the app reloads sheets within ~20s. If still stale: server API off or not connected to VPS.`
      );
    });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  useEffect(() => {
    const cleanup = refreshPriceManifest();
    return cleanup;
  }, [simTableVersion, refreshPriceManifest]);

  const simKpi = useMemo(() => {
    const rows = simTable?.rows ?? [];
    const totalTickers = rows.length;
    const allPositions = buildPositions(simTable, inputs, history);
    const rowByKey = buildSimRowByKeyMap(rows);
    const withPosition = filterActivePortfolioPositions(allPositions, rowByKey, inputs).length;
    const portfolioTotals = aggregateOpenPortfolioPnl(simTable, inputs, history);
    const totalCapital = portfolioTotals.capital;
    const pnlSum = portfolioTotals.pnlEur;
    const pnlPct = portfolioTotals.pnlPct;
    const affCol = rows.find((r) =>
      Object.keys(r).some((k) => k.startsWith("Affidabilità"))
    );
    const affKey = affCol
      ? Object.keys(affCol).find((k) => k.startsWith("Affidabilità")) ?? ""
      : "";
    const affVals = affKey
      ? rows.map((r) => Number(r[affKey])).filter((n) => Number.isFinite(n))
      : [];
    const avgAff =
      affVals.length > 0
        ? ((affVals.reduce((a, b) => a + b, 0) / affVals.length) * 100).toFixed(0)
        : "—";
    const dated = rows
      .filter((r) => r["Completion Date"])
      .sort(
        (a, b) =>
          new Date(String(a["Completion Date"])).getTime() -
          new Date(String(b["Completion Date"])).getTime()
      );
    const next = dated[0];
    return { totalTickers, withPosition, totalCapital, pnlSum, pnlPct, avgAff, next };
  }, [simTable, inputs, history]);

  const view = ui.view;
  const selectedKey = ui.selectedKey;

  const setView = useCallback(
    (v: InvestSimView) => {
      setUi((prev) => {
        const next = { ...prev, view: v };
        saveInvestSimUi(next);
        return next;
      });
      onFocusConsumed?.();
    },
    [onFocusConsumed],
  );

  const applyView = useCallback((v: InvestSimView) => {
    setUi((prev) => {
      const next = { ...prev, view: v };
      saveInvestSimUi(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (isDecisionLabEmbed) {
      if (view !== "workspace") applyView("workspace");
      return;
    }
    if (view === "workspace" || (view as string) === "curves") applyView("lossAnalysis");
  }, [isDecisionLabEmbed, view, applyView]);

  const setSelectedKey = useCallback((key: string | null) => {
    setUi((prev) => {
      const next = { ...prev, selectedKey: key };
      saveInvestSimUi(next);
      return next;
    });
  }, []);

  const positions = useMemo(
    () => buildPositions(simTable, inputs, history),
    [simTable, inputs, history]
  );

  const selectedPosition = useMemo(
    () => positions.find((p) => p.key === selectedKey) ?? null,
    [positions, selectedKey]
  );

  const simRowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable?.rows]
  );

  // Dense chart bundle (recalibrated model curve T-60..T+10).
  // Needed because the 8 sheet columns (Pred −60..+7) are too smoothed and
  // lead to misleading sparklines (e.g. OLMA green on past peak + recent
  // drop). The dense `pct_modello` shows the true recalibrated trajectory.
  const [chartBundle, setChartBundle] = useState<ChartBundle | null>(null);
  const reloadChartBundle = useCallback(async () => {
    const res = await loadSimulationChartsBundle();
    setChartBundle(res.bundle);
    return res;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void reloadChartBundle().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [simTableVersion, reloadChartBundle]);

  const pointsBySeriesKey = useMemo(() => {
    const map = new Map<string, ChartPoint[]>();
    const series = chartBundle?.series;
    if (!series) return map;
    for (const [k, s] of Object.entries(series)) {
      if (!k.startsWith("co:")) continue;
      if (Array.isArray(s?.points) && s.points.length > 0) {
        map.set(k, s.points);
      }
    }
    return map;
  }, [chartBundle]);

  const synthAlloc = useSimLoopSynthAllocation({
    simTable,
    sdsRows: sdsRowsForMig,
    investInputs: inputs,
    pointsBySeriesKey,
    totalCapitalEur: topCapital,
    enabled: Boolean(simTable?.rows?.length) && topCapital > 0,
  });

  const synthCapitalSync = useSynthCapitalAutoSync({
    synthAlloc,
    topCapital,
    inputs,
    positions,
    simRowByKey,
    patchInputs,
    simRowByKeyForBuy: simRowByKey,
    enabled: Boolean(simTable?.rows?.length) && topCapital > 0,
  });

  /**
   * Loss-risk catalog — shared across every UI surface that shows the
   * "Rischio" poop-emoji cell. Drives the new Risk column inserted right
   * after the Ticker column in the Pick stocks (decisionLab) table.
   */
  const { catalog: lossRiskCatalog } = useLossRiskCatalog({
    simTable,
    sdsRows: sdsRowsForMig,
    chartBundle,
    reloadToken: simInputsReloadToken + parentReloadToken,
  });
  const [riskModalEntry, setRiskModalEntry] = useState<LossRiskEntry | null>(null);

  // Decision Lab / Dashboard «→ Simulation»: tab P&L o workspace + filtro All + scroll riga.
  const focusHandledSigRef = useRef("");
  const dailyLedgerFocusRef = useRef(false);
  useEffect(() => {
    if (focusTicker?.openDailyLedger && !dailyLedgerFocusRef.current) {
      dailyLedgerFocusRef.current = true;
      applyView("snapshotBar");
      setDailyPnlLedgerOpen(true);
      onFocusConsumed?.();
    }
    if (!focusTicker?.openDailyLedger) {
      dailyLedgerFocusRef.current = false;
    }
  }, [focusTicker, onFocusConsumed, applyView]);

  useEffect(() => {
    if (!focusTicker) {
      focusHandledSigRef.current = "";
      return;
    }

    const sig = JSON.stringify({
      ticker: focusTicker.ticker ?? "",
      cd: focusTicker.cd ?? "",
      view: focusTicker.view ?? "",
      action: focusTicker.action ?? "",
      syncToSynth: focusTicker.syncToSynth ?? false,
      rowKey: focusTicker.rowKey ?? "",
    });
    const isNewFocus = focusHandledSigRef.current !== sig;
    if (isNewFocus) {
      focusHandledSigRef.current = sig;
      if (focusTicker.view && (focusTicker.view as string) !== "curves") {
        applyView(focusTicker.view);
      } else if (!isDecisionLabEmbed) {
        applyView("lossAnalysis");
      }
    }

    if (!focusTicker.ticker?.trim()) {
      if (isNewFocus) onFocusConsumed?.();
      return;
    }

    if (isNewFocus && simTableFilter !== "all") {
      setSimTableFilter("all");
      saveSimTableFilter("all");
      return;
    }

    const tickerUp = focusTicker.ticker.toUpperCase();
    const targetKey = focusTicker.cd
      ? normalizedRowKey(focusTicker.ticker, focusTicker.cd)
      : null;

    const matched =
      (targetKey && positions.find((p) => p.key === targetKey)) ||
      positions.find((p) => p.ticker.toUpperCase() === tickerUp) ||
      null;

    if (isNewFocus && matched && selectedKey !== matched.key) {
      setSelectedKey(matched.key);
      const simRow = simRowByKey.get(matched.key);
      const sk = simRow ? simulationRowSeriesKey(simRow) : null;
      const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
      const days = daysToCdForPosition(matched, simRow, inputs, chartPts);
      if (days != null && days > SIM_HOT_ZONE_DAYS && days <= SIM_MONITOR_HORIZON_DAYS) {
        setSimCdHorizonScope("watch");
        saveSimCdHorizonScope("watch");
      }
    }

    if (isNewFocus && focusTicker.syncToSynth && matched) {
      window.setTimeout(() => {
        synthCapitalSync.syncRowToSynth(matched.key, "manual");
      }, 350);
    }

    if (!isNewFocus) return;

    if (simTableFilter !== "all") return;
    if (!isDecisionLabEmbed) return;

    const scrollToRow = (): boolean => {
      const root = tableBodyRef.current;
      if (!root) return false;
      const selector = matched
        ? `[data-row-key="${CSS.escape(matched.key)}"]`
        : `[data-ticker="${CSS.escape(tickerUp)}"]`;
      const el = root.querySelector<HTMLTableRowElement>(selector);
      if (!el) return false;
      el.scrollIntoView({ behavior: "auto", block: "nearest" });
      return true;
    };

    let retryTimer: number | undefined;
    let retry2Timer: number | undefined;
    const raf = window.requestAnimationFrame(() => {
      if (!scrollToRow()) {
        retryTimer = window.setTimeout(() => {
          if (!scrollToRow()) {
            retry2Timer = window.setTimeout(scrollToRow, 420);
          }
        }, 180);
      }
    });

    const consumeTimer = window.setTimeout(() => onFocusConsumed?.(), 8000);
    return () => {
      window.cancelAnimationFrame(raf);
      if (retryTimer != null) window.clearTimeout(retryTimer);
      if (retry2Timer != null) window.clearTimeout(retry2Timer);
      window.clearTimeout(consumeTimer);
    };
  }, [
    focusTicker,
    view,
    simTableFilter,
    positions,
    selectedKey,
    simLoading,
    simTable?.rows?.length,
    applyView,
    setSelectedKey,
    onFocusConsumed,
    simRowByKey,
    inputs,
    pointsBySeriesKey,
    isDecisionLabEmbed,
    synthCapitalSync,
  ]);

  /** Evento pendenza per ticker — stesso feed di Catalyst → Slope errors. */
  const slopeFeedByTicker = useMemo(() => {
    if (!simTable?.rows?.length) return new Map<string, UnifiedSlopeFeedRow>();
    const gapByTicker = new Map<string, number | null>();
    for (const row of simTable.rows) {
      const tk = String(row.Ticker ?? row.ticker ?? "")
        .trim()
        .toUpperCase();
      if (!tk || gapByTicker.has(tk)) continue;
      const sk = simulationRowSeriesKey(row);
      const pts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
      gapByTicker.set(tk, slopePriceGapFromSimRow(row, pts));
    }
    const feed = buildSlopeFeedForPanel({
      dismissed: loadDismissedSlopeCharts(),
      portfolioOnly: false,
      simTable,
      chartsBundle: chartBundle,
      inputs,
      resolveGapUsd: (tk) => gapByTicker.get(tk) ?? null,
    });
    const out = new Map<string, UnifiedSlopeFeedRow>();
    for (const co of groupSlopeFeedByTicker(feed)) {
      const pick = pickCompanyDisplayRow(co.rows);
      if (pick) out.set(co.ticker.toUpperCase(), pick);
    }
    return out;
  }, [simTable, chartBundle, inputs, pointsBySeriesKey]);

  /** Pipeline rank (ROI target) — icone maialino e sort tabella All. */
  const pipelinePlanRows = useMemo(() => {
    return positions
      .filter((p) => p.capital > 0)
      .map((p) => {
        const simRow = simRowByKey.get(p.key);
        const sk = simRow ? simulationRowSeriesKey(simRow) : null;
        const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
        const planCap =
          inputs[p.key]?.capital > 0 ? inputs[p.key]!.capital : DEFAULT_PLAN_CAPITAL_EUR;
        const gainPlan = resolveExpectedGainPlan(simRow, planCap, { chartPoints: chartPts });
        return { key: p.key, planReturnPct: primaryReturnPctFromGainPlan(gainPlan) };
      });
  }, [positions, simRowByKey, pointsBySeriesKey, inputs]);

  const planReturnByKey = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const r of pipelinePlanRows) m.set(r.key, r.planReturnPct);
    return m;
  }, [pipelinePlanRows]);

  const tablePositionsSorted = useMemo(() => {
    const rankable = positions.filter((p) => p.capital > 0);
    const rest = positions.filter((p) => !(p.capital > 0));
    return [
      ...sortByPipelineReturnPct(
        rankable,
        (p) => planReturnByKey.get(p.key) ?? null,
      ),
      ...rest,
    ];
  }, [positions, planReturnByKey]);

  const cdHorizonCounts = useMemo(
    () =>
      countPositionsByCdHorizon(
        positions,
        simRowByKey,
        inputs,
        pointsBySeriesKey,
      ),
    [positions, simRowByKey, inputs, pointsBySeriesKey],
  );

  const positionsInCdHorizon = useMemo(
    () =>
      filterPositionsByCdHorizon(
        tablePositionsSorted,
        simCdHorizonScope,
        simRowByKey,
        inputs,
        pointsBySeriesKey,
      ),
    [tablePositionsSorted, simCdHorizonScope, simRowByKey, inputs, pointsBySeriesKey],
  );

  const migSolidityByKey = useMemo(
    () => buildMigSolidityByKey(simTable, chartBundle, sdsRowsForMig),
    [simTable, chartBundle, sdsRowsForMig],
  );

  const lossProbOptions = useMemo(
    () => ({
      sdsRows: sdsRowsForMig,
      migSolidityByKey,
      eisSuperScoreState,
      polygonOverview,
    }),
    [sdsRowsForMig, migSolidityByKey, eisSuperScoreState, polygonOverview],
  );

  const simBuyGateByKey = useMemo(() => {
    if (!simTable?.rows?.length) return new Map<string, ReturnType<typeof evaluateSimBuyGate>>();
    const langCode = lang === "it" ? "it" : "en";
    const items = buildLossAnalysisItems(
      "opportunities",
      simTable,
      inputs,
      pointsBySeriesKey,
      langCode,
      history,
      lossProbOptions,
      "watch",
    );
    return buildSimBuyGateByKey(items, langCode);
  }, [simTable, inputs, pointsBySeriesKey, lang, history, lossProbOptions]);

  const simBuyGateByKeyRef = useRef(simBuyGateByKey);
  simBuyGateByKeyRef.current = simBuyGateByKey;

  /** Bump when polarità RA refresh — ricalcola colonna RAscore allineata. */
  const [raPolarityRevision, setRaPolarityRevision] = useState(0);

  const entrySolidityDetailByKey = useMemo(() => {
    const map = new Map<
      string,
      {
        result: SimulationSolidityResult;
        pick: Top2PickSignal;
        breakdown: ScoreBreakdown | null;
        ticker: string;
        cd: string;
        daysToCd: number | null;
      }
    >();
    if (!simTable?.rows?.length) return map;
    const merged = reconcileInvestSimInputs(inputs, simTable.rows);
    const keysToEval = new Set<string>();
    for (const p of positionsInCdHorizon) keysToEval.add(p.key);
    for (const p of filterActivePortfolioPositions(
      tablePositionsSorted,
      simRowByKey,
      inputs,
    )) {
      keysToEval.add(p.key);
    }
    for (const key of keysToEval) {
      const p = tablePositionsSorted.find((row) => row.key === key);
      if (!p) continue;
      const simRow = simRowByKey.get(key);
      if (!simRow) continue;
      const sk = simulationRowSeriesKey(simRow);
      const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
      const pick = pickSignalFromSimRow(simRow, merged, chartPts, history);
      if (!pick) continue;
      const solidityOpts = {
        sdsByTicker,
        migByKey: migSolidityByKey,
        reliabilityMetricsOptions: {
          chartPoints: chartPts,
          signCurveView,
        },
        simColumns: simTable.columns,
      };
      const sol = resolveSimulationEntrySolidity(
        pick,
        solidityOpts,
        lang === "it" ? "it" : "en",
        "rascore",
      );
      if (simulationSolidityVisible(sol)) {
        map.set(key, {
          result: sol,
          pick,
          breakdown: pickScoreBreakdown(pick, solidityOpts),
          ticker: pick.ticker,
          cd: pick.cd,
          daysToCd: pick.days ?? null,
        });
      }
    }
    return map;
  }, [
    positionsInCdHorizon,
    tablePositionsSorted,
    simRowByKey,
    inputs,
    simTable?.rows,
    pointsBySeriesKey,
    history,
    sdsByTicker,
    migSolidityByKey,
    lang,
    signCurveView,
    simTable?.columns,
    raPolarityRevision,
  ]);

  const simTableFilterCounts = useMemo(
    () =>
      buildSimTableFilterCounts(
        positionsInCdHorizon,
        simRowByKey,
        inputs,
        topOpps,
        top2BuySell.sell,
        pointsBySeriesKey,
        simTable?.columns,
        tablePositionsSorted,
      ),
    [
      positionsInCdHorizon,
      tablePositionsSorted,
      simRowByKey,
      inputs,
      topOpps,
      top2BuySell.sell,
      pointsBySeriesKey,
      simTable?.columns,
    ],
  );

  const filteredTablePositions = useMemo(() => {
    const filtered = filterSimTablePositions(
      positionsInCdHorizon,
      simTableFilter,
      simRowByKey,
      inputs,
      topOpps,
      top2BuySell.sell,
      pointsBySeriesKey,
      simTable?.columns,
      tablePositionsSorted,
    );
    if (simTableSort !== "default") {
      return sortSimPositionsBySortId(
        filtered,
        simTableSort,
        simRowByKey,
        inputs,
        pointsBySeriesKey,
        simulationRowSeriesKey,
      );
    }
    if (simTableFilter === "topOpps") {
      return sortSimPositionsByRoiPerDay(
        filtered,
        simRowByKey,
        inputs,
        pointsBySeriesKey,
      );
    }
    if (simTableFilter === "sellNow") {
      return sortSimPositionsByDecline(
        filtered,
        simRowByKey,
        inputs,
        pointsBySeriesKey,
      );
    }
    return filtered;
  }, [
      positionsInCdHorizon,
      simTableFilter,
      simTableSort,
      simRowByKey,
      inputs,
      topOpps,
      top2BuySell.sell,
      pointsBySeriesKey,
      simTable?.columns,
  ]);

  const scoreDetailSignals = useMemo((): ScoreDetailSignal[] => {
    const cols = simTable?.columns;
    if (!cols?.length) return [];
    const out: ScoreDetailSignal[] = [];
    for (const p of filteredTablePositions) {
      const simRow = simRowByKey.get(p.key);
      if (!simRow) continue;
      const sk = simulationRowSeriesKey(simRow);
      const chartPts = sk ? pointsBySeriesKey.get(sk) ?? null : null;
      const m = signalMetricsFromSimRow(simRow, cols, {
        chartPoints: chartPts,
        signCurveView,
      });
      if (m.score == null) continue;
      const cd = String(simRow["Completion Date"] ?? p.completionDate ?? "—");
      out.push({
        ticker: p.ticker,
        cd,
        days: m.daysToCd,
        score: m.score,
        action: "monitor",
        affid: m.affidPct != null ? m.affidPct / 100 : null,
        r2: m.r2,
        pred5: m.pred5Pp,
        gapPct: m.gapPct,
        simRow,
      });
    }
    return out;
  }, [filteredTablePositions, simRowByKey, simTable?.columns, pointsBySeriesKey, signCurveView]);

  const simTableFilterDefs = useMemo((): { id: SimTableFilterId; label: string; tip: string }[] => {
    const defs: { id: SimTableFilterId; label: string; tip: string }[] = [
      { id: "all", label: t("sim.workspace.filter.all"), tip: "" },
      { id: "portfolio", label: t("sim.workspace.filter.portfolio"), tip: "" },
      { id: "topOpps", label: t("sim.workspace.filter.topOpps"), tip: t("sim.workspace.filter.topOppsTip") },
      { id: "sellNow", label: t("sim.workspace.filter.sellNow"), tip: t("sim.workspace.filter.sellNowTip") },
    ];
    if (isDecisionLabEmbed) {
      return defs.filter((d) => d.id !== "topOpps");
    }
    return defs;
  }, [t, isDecisionLabEmbed]);

  useEffect(() => {
    if (isDecisionLabEmbed && simTableFilter === "topOpps") {
      setSimTableFilter("all");
    }
  }, [isDecisionLabEmbed, simTableFilter]);

  const workspacePaneSubtitle = useMemo(() => {
    const priceBit = priceSnapshotAt
      ? lang === "it"
        ? ` · prezzi al ${fmtSnapshotPriceLabel(priceSnapshotAt)}`
        : ` · prices as of ${fmtSnapshotPriceLabel(priceSnapshotAt)}`
      : "";
    if (simCdHorizonScope === "watch") {
      return `${t("sim.workspace.cdScope.watchSubtitle", {
        min: SIM_HOT_ZONE_DAYS + 1,
        max: SIM_MONITOR_HORIZON_DAYS,
      })}${priceBit}`;
    }
    return `${t("sim.workspace.cdScope.hotSubtitle", { days: SIM_HOT_ZONE_DAYS })}${priceBit}`;
  }, [simCdHorizonScope, lang, priceSnapshotAt, t]);

  const toggleCdHorizonScope = useCallback(() => {
    setSimCdHorizonScope((prev) => {
      const next: SimCdHorizonScope = prev === "hot" ? "watch" : "hot";
      saveSimCdHorizonScope(next);
      return next;
    });
  }, []);

  const workspaceTableEmptyMessage = useMemo(() => {
    if (positions.length === 0) {
      return "No Simulation rows — run refresh and snapshot export.";
    }
    if (positionsInCdHorizon.length === 0) {
      return simCdHorizonScope === "watch"
        ? t("sim.workspace.cdScope.emptyWatch")
        : t("sim.workspace.cdScope.emptyHot");
    }
    return t("sim.workspace.filter.empty");
  }, [positions.length, positionsInCdHorizon.length, simCdHorizonScope, t]);

  const portfolio = useMemo(
    () => portfolioSnapshot(positions, simRowByKey, inputs, history),
    [positions, simRowByKey, inputs, history],
  );

  const recordSnapshot = useCallback(
    (mode: boolean | "hourly" = true) => {
      if (portfolio.n === 0 || portfolio.cap <= 0) return;
      const prev = loadInvestSimHistory();
      const next = appendHistoryPoint(
        prev,
        {
          capital: portfolio.cap,
          value: portfolio.val,
          pnl: portfolio.pnl,
          pnlPct: portfolio.pct,
          byTicker: portfolio.byTicker,
        },
        { force: mode === "hourly" ? "hourly" : mode },
      );
      persistInvestSimHistoryNow(next);
    },
    [portfolio],
  );

  /** Dopo refresh prezzi / reload: snapshot orario per curve gain vs plan. */
  const lastPriceSigRef = useRef("");
  useEffect(() => {
    if (!simTable || simLoading || portfolio.n === 0) return;
    const sig = simTableVersion;
    if (lastPriceSigRef.current === sig) return;
    const isFirst = lastPriceSigRef.current === "";
    lastPriceSigRef.current = sig;
    if (!isFirst) recordSnapshot("hourly");
  }, [simTable, simLoading, portfolio.n, simTableVersion, recordSnapshot]);

  /** Cache prezzi per Δ ultima lettura — baseline al mount, snapshot solo su refresh prezzi. */
  const prevSimTableVersionForPricesRef = useRef<string | null>(null);
  useEffect(() => {
    if (!simTable || simLoading) return;
    const priceRows = simTablePriceRows(simTable.rows);
    if (!priceRows.length) return;

    const versionChanged =
      prevSimTableVersionForPricesRef.current != null &&
      prevSimTableVersionForPricesRef.current !== simTableVersion;
    prevSimTableVersionForPricesRef.current = simTableVersion;

    const id = requestAnimationFrame(() => {
      syncPriceReadingCache(priceRows, { simTableVersion, versionChanged });
    });
    return () => cancelAnimationFrame(id);
  }, [simTable, simLoading, simTableVersion]);

  /** Polarità indici RA (ρ vs prezzo) → score live allineato in colonna RAscore. */
  useEffect(() => {
    if (!simTable || simLoading || !chartBundle) return;
    const id = requestAnimationFrame(() => {
      refreshRaPolarityStore({
        simTable,
        chartBundle,
        sdsRows: sdsRowsForMig,
        inputs,
        history,
        lang: lang === "it" ? "it" : "en",
      });
      setRaPolarityRevision((r) => r + 1);
    });
    return () => cancelAnimationFrame(id);
  }, [
    simTable,
    simLoading,
    chartBundle,
    sdsRowsForMig,
    inputs,
    history,
    lang,
    simTableVersion,
  ]);

  /** First history point when you open a simulation with capital. */
  useEffect(() => {
    if (portfolio.n === 0) return;
    const prev = loadInvestSimHistory();
    if (prev.length > 0) return;
    persistInvestSimHistoryNow(
      appendHistoryPoint(prev, {
        capital: portfolio.cap,
        value: portfolio.val,
        pnl: portfolio.pnl,
        pnlPct: portfolio.pct,
        byTicker: portfolio.byTicker,
      }),
    );
  }, [portfolio.cap, portfolio.val, portfolio.pnl, portfolio.pct, portfolio.byTicker, portfolio.n]);

  const chartData = useMemo(
    () =>
      positions.filter(isActiveSimPosition).map((p) => {
        const investedAt = resolveInvestedAt(p.key, inputs[p.key], history);
        const investedAtDate = parseSimDate(investedAt ?? null);
        const expectedExitDate = p.completionDate;
        const expectedExit = parseSimDate(expectedExitDate);
        const expectedHoldDays =
          investedAtDate && expectedExit
            ? Math.max(0, Math.round((expectedExit.getTime() - investedAtDate.getTime()) / 86400000))
            : null;
        const holdDaysElapsed = investedAt
          ? holdingDaysFromInvestedAt(investedAt)
          : null;
        const simRow = simRowByKey.get(p.key);
        const chartPts = simRow
          ? pointsBySeriesKey.get(simulationRowSeriesKey(simRow) ?? "") ?? null
          : null;
        const gainPlan = resolveEntryGainPlan(
          simRow,
          p.capital,
          expectedHoldDays,
          holdDaysElapsed,
          { chartPoints: chartPts },
        );
        const forwardPlan = resolveExpectedGainPlan(simRow, p.capital, { chartPoints: chartPts });
        const targetGainPct = forwardPlan.targetReturnPct;
        const expectedGainPct = gainPlan.expectedReturnPct;
        const expectedGainEur = gainPlan.expectedGainEur;
        const expectedGainSource = gainPlan.source;
        const forwardGainPct = forwardPlan.expectedReturnPct;
        const seriesKey = simRow ? simulationRowSeriesKey(simRow) : null;
        const topStatus = evaluateTopStatus(
          simRow,
          p.capital > 0,
          targetGainPct ?? expectedGainPct,
          seriesKey,
          topOpps,
        );
        const pnlBreakdown = resolvePositionPnlBreakdown(p, simRow, investedAt, history, inputs);
        const pnlEurToday = pnlBreakdown.pnlEurToday;
        const pnlPctToday = pnlBreakdown.pnlPctToday;
        const hasToday = pnlBreakdown.hasToday;
        const dailyPnlSource = pnlBreakdown.todaySource;
        const priorLegEur = pnlBreakdown.priorLegEur;
        const pnlEurSinceReading = pnlBreakdown.pnlEurSinceReading;
        const pnlPctSinceReading = pnlBreakdown.pnlPctSinceReading;
        const hasReadingDelta = pnlBreakdown.hasReadingDelta;
        const priorReadingTs = pnlBreakdown.priorReadingTs;
        const showPriorLegNote = pnlTabNeedsPriorLegNote(pnlBreakdown, holdDaysElapsed);
        const buyAudit = auditSimulationBuyPrice(
          simRow ?? { Ticker: p.ticker, "Completion Date": p.completionDate },
          inputs[p.key],
          p,
          history,
        );

        return {
          key: p.key,
          name:
            p.completionDate && p.completionDate !== "—"
              ? `${p.ticker} · ${p.completionDate}`
              : p.ticker,
          ticker: p.ticker,
          completionDate: p.completionDate,
          holdDaysElapsed,
          currentPriceUsd: p.currPrice,
          buyPriceUsd: p.buyPrice > 0 ? p.buyPrice : null,
          buyPriceAuditNote: buyAudit.note,
          buyPriceDrift: buyAudit.driftFromLocal,
          shares: p.shares > 0 ? p.shares : null,
          capital: p.capital,
          valueNow: p.valueNow,
          pnlUnavailable: p.pnlUnavailable,
          // Total (MTM) — % su capitale, allineato alla card Σ€
          pnlPct: p.pnlUnavailable
            ? null
            : positionCapitalPnlPct(p.pnlEur, p.capital) ?? p.pnlPct,
          pnlEur: p.pnlUnavailable ? null : p.pnlEur,
          // Today (vs prior trading day)
          pnlPctToday,
          pnlEurToday,
          hasToday,
          pnlPctSinceReading,
          pnlEurSinceReading,
          hasReadingDelta,
          priorReadingTs,
          dailyPnlSource,
          priorLegEur,
          showPriorLegNote,
          investedAt,
          purchaseDateLabel: resolvePurchaseDateLabel(inputs[p.key], investedAt),
          expectedExitDate,
          expectedHoldDays,
          daysToTarget: forwardPlan.daysToTarget ?? gainPlan.daysToTarget ?? null,
          expectedGainPct,
          targetGainPct,
          expectedGainEur,
          expectedGainSource,
          forwardGainPct,
          daysToCd: gainPlan.daysToCd,
          topStatus,
          simRow: simRow ?? undefined,
          chartPoints: chartPts,
          seriesKey: simRow ? simulationRowSeriesKey(simRow) : null,
        };
      }),
    [positions, inputs, history, simRowByKey, topOpps, pointsBySeriesKey]
  );

  // ── snapshotBar: scope (total vs trading day) + metric (% / €) ─────────────
  const [snapshotMetric, setSnapshotMetric] = useState<"pct" | "eur">("pct");
  const [snapshotScope, setSnapshotScope] = useState<"total" | "today" | "reading">("today");

  /** Card «Plan at entry» e curva gain: ordinati per gain atteso (come Top Opps). */
  const chartDataByExpectedGain = useMemo(
    () => sortRowsByExpectedGain(chartData),
    [chartData],
  );

  const chartDataSorted = useMemo(
    () => sortByPnlRank(chartData, snapshotScope),
    [chartData, snapshotScope],
  );

  const pnlCardRankScope = snapshotScope;
  const pnlCardRank = useMemo(
    () => buildPnlRankIndexMap(chartData, pnlCardRankScope, (r) => r.key),
    [chartData, pnlCardRankScope],
  );

  /** Gain vs loss tra posizioni attive — sfondo area blocchi P&L (>50% / <50%). */
  const pnlWinRate = useMemo(
    () => summarizePortfolioWinRate(chartDataSorted),
    [chartDataSorted],
  );
  const pnlBlocksShellClass = portfolioPnlTabShellClass(pnlWinRate.winPct);

  // Net totals across the whole portfolio (sum of all active tickers).
  const snapshotTotals = useMemo(
    () => aggregateOpenPortfolioPnl(simTable, inputs, history),
    [simTable, inputs, history],
  );

  const dailyPnlLedger = useMemo(
    () => buildPortfolioDailyPnlLedger(simTable, inputs, history),
    [simTable, inputs, history],
  );

  const downloadGainAudit = useCallback(() => {
    const exp = buildPortfolioGainAuditExport({
      simTable,
      inputs,
      history,
      portfolioOnly: simTableFilter === "portfolio",
    });
    if (exp.rows.length === 0) {
      window.alert(t("sim.audit.export.empty"));
      return;
    }
    downloadPortfolioGainAuditExcel(exp, lang === "it" ? "it" : "en");
  }, [simTable, inputs, history, simTableFilter, lang, t]);

  const { display: closedPiggyDisplay, reset: resetClosedPiggy } =
    useClosedPiggyBank(dailyPnlLedger);

  const portfolioPriorLegEur = useMemo(
    () => (snapshotTotals.todayCovered > 0 ? snapshotTotals.priorLegEur : null),
    [snapshotTotals],
  );

  const ptfSumTotalTone = portfolioPnlTone(snapshotTotals.pnlEur, snapshotTotals.pnlPct);
  const ptfSumDayTone: PortfolioPnlTone =
    snapshotTotals.todayCovered > 0
      ? portfolioPnlTone(snapshotTotals.pnlEurToday, snapshotTotals.pnlPctToday)
      : "flat";
  const ptfSumBlkDay = portfolioPtfDayBlockTheme(ptfSumDayTone);
  const ptfSumBlkTotal = portfolioPtfBlockTheme(ptfSumTotalTone);

  useEffect(() => {
    if (ui.view !== "snapshotBar") return;
    const cleanup = refreshPriceManifest();
    return cleanup;
  }, [ui.view, refreshPriceManifest]);

  const pnlPctDomain = useMemo(
    (): [number, number] =>
      paddedPctDomain(
        chartData.map((d) => d.pnlPct),
        [-5, 5]
      ),
    [chartData]
  );

  const pnlEurDomain = useMemo(
    (): [number, number] =>
      paddedEurDomain(
        chartData.map((d) => d.pnlEur),
        [-100, 100]
      ),
    [chartData]
  );

  const pnlPctTodayDomain = useMemo(
    (): [number, number] =>
      paddedPctDomain(
        chartData.map((d) => d.pnlPctToday),
        [-3, 3]
      ),
    [chartData]
  );

  const pnlEurTodayDomain = useMemo(
    (): [number, number] =>
      paddedEurDomain(
        chartData.map((d) => d.pnlEurToday),
        [-50, 50]
      ),
    [chartData]
  );

  const pnlPctReadingDomain = useMemo(
    (): [number, number] =>
      paddedPctDomain(
        chartData.map((d) => d.pnlPctSinceReading),
        [-3, 3]
      ),
    [chartData]
  );

  const pnlEurReadingDomain = useMemo(
    (): [number, number] =>
      paddedEurDomain(
        chartData.map((d) => d.pnlEurSinceReading),
        [-50, 50]
      ),
    [chartData]
  );

  const hasActivePositions = useMemo(
    () => positions.some(isActiveSimPosition),
    [positions]
  );

  const trendActivePositions = useMemo(
    () =>
      positions
        .filter(isActiveSimPosition)
        .sort((a, b) => a.ticker.localeCompare(b.ticker)),
    [positions]
  );

  const trendCompressedHistory = useMemo(
    () => compressInvestTrendHistory(history),
    [history],
  );

  const trendChartData = useMemo(() => {
    const useDayLabels = trendCompressedHistory.length < history.length;
    return trendCompressedHistory.map((h) => {
      const label = useDayLabels ? formatHistoryDayLabel(h.ts) : formatHistoryTsLabel(h.ts);
      const row: Record<string, string | number> = {
        ts: label,
        valore: Math.round(h.value * 100) / 100,
        capitale: Math.round(h.capital * 100) / 100,
        pnl: Math.round(h.pnl * 100) / 100,
        pnlPct: Math.round(h.pnlPct * 100) / 100,
      };
      if (selectedKey && h.byTicker[selectedKey]) {
        const snap = h.byTicker[selectedKey];
        row.valoreSel = Math.round(snap.value * 100) / 100;
        row.pnlPctSel = Math.round(snap.pnlPct * 100) / 100;
        row.pnlSel = Math.round(snap.pnl * 100) / 100;
        row.capitaleSel = Math.round((snap.value - snap.pnl) * 100) / 100;
      }
      return row;
    });
  }, [history.length, trendCompressedHistory, selectedKey]);

  const trendPnlPctDomain = useMemo(
    (): [number, number] =>
      investTrendPnlDomain(
        trendChartData.flatMap((r) => {
          const vals = [Number(r.pnlPct)];
          if (selectedKey) vals.push(Number(r.pnlPctSel));
          return vals;
        }),
        [-3, 3],
      ),
    [trendChartData, selectedKey],
  );

  const trendPnlEurDomain = useMemo(
    (): [number, number] =>
      investTrendEurDomain(
        trendChartData.flatMap((r) => {
          const vals = [Number(r.pnl)];
          if (selectedKey) vals.push(Number(r.pnlSel));
          return vals;
        }),
        [-100, 100],
      ),
    [trendChartData, selectedKey],
  );

  const trendOutlookContext = useMemo(() => {
    if (selectedPosition && selectedKey) {
      const row = simRowByKey.get(selectedKey) ?? null;
      const sk = row ? simulationRowSeriesKey(row) : null;
      const pts = sk ? chartBundle?.series?.[sk]?.points ?? null : null;
      return {
        simRow: row,
        chartPts: pts,
        capital: selectedPosition.capital,
        completionDate: selectedPosition.completionDate,
      };
    }
    return { simRow: null, chartPts: null, capital: 0, completionDate: "" };
  }, [selectedPosition, selectedKey, simRowByKey, chartBundle]);

  const trendDisplayMetrics = useMemo(() => {
    if (selectedPosition) {
      return {
        label: selectedPosition.ticker,
        capital: selectedPosition.capital,
        valueNow: selectedPosition.valueNow,
        pnl: selectedPosition.pnlEur,
        pct: selectedPosition.pnlPct,
        pnlUnavailable: selectedPosition.pnlUnavailable,
      };
    }
    return {
      label: "Portfolio",
      capital: portfolio.cap,
      valueNow: portfolio.val,
      pnl: portfolio.pnl,
      pct: portfolio.pct,
      pnlUnavailable: false,
    };
  }, [selectedPosition, portfolio]);

  const trendOutlook = useMemo(
    () =>
      resolveInvestTrendOutlook({
        scopeLabel:
          trendDisplayMetrics.label === "Portfolio"
            ? lang === "it"
              ? "Portafoglio"
              : "Portfolio"
            : trendDisplayMetrics.label,
        pnlEur: trendDisplayMetrics.pnl,
        pnlPct: trendDisplayMetrics.pct,
        pnlUnavailable: trendDisplayMetrics.pnlUnavailable,
        simRow: trendOutlookContext.simRow,
        chartPts: trendOutlookContext.chartPts,
        capital: trendOutlookContext.capital,
        completionDate: trendOutlookContext.completionDate,
        lang: lang === "it" ? "it" : "en",
        aggregateScope: !selectedKey,
      }),
    [trendDisplayMetrics, trendOutlookContext, lang, selectedKey],
  );

  const investTrendMarkers = useMemo(
    () => buildInvestTrendMarkers(positions, inputs, history, selectedKey),
    [positions, inputs, history, selectedKey]
  );

  const setInput = useCallback(
    (key: string, field: "buyPrice" | "capital", v: number) => {
      patchInputs((prev) => {
        const cur = prev[key] ?? { buyPrice: 0, capital: 0 };
        const next: InvestSimInputEntry = {
          ...cur,
          buyPrice: field === "buyPrice" ? v : cur.buyPrice,
          capital: field === "capital" ? v : cur.capital,
        };
        delete next.soldAt;
        const wasCapitalActive = cur.capital > 0;
        const nowCapitalActive = next.capital > 0;
        if (nowCapitalActive && !wasCapitalActive && !next.investedAt) {
          next.investedAt = new Date().toISOString();
        }
        if (field === "capital" && v > 0 && next.buyPrice <= 0) {
          const row = simRowByKey.get(key);
          const sheetBuy = row ? sheetBuyPriceFromRow(row) : null;
          if (sheetBuy != null && sheetBuy > 0) {
            next.buyPrice = sheetBuy;
          } else {
            const curr = row ? currentPriceFromRow(row) : null;
            if (curr != null && curr > 0) next.buyPrice = curr;
          }
        }
        if (v > 0 || next.capital > 0 || next.buyPrice > 0) {
          next.ignoreSheet = false;
        }
        return { ...prev, [key]: next };
      });
    },
    [patchInputs, simRowByKey]
  );

  const buyRowSimulation = useCallback(
    (key: string, capitalEur = DEFAULT_SIM_BUY_CAPITAL_EUR) => {
      const row = simRowByKey.get(key);
      if (!row) return;
      if (rowHasActivePortfolio(row, inputsRef.current)) return;
      const gate = simBuyGateByKeyRef.current.get(key);
      if (gate && !gate.allowed) {
        window.alert(
          t("sim.lossAnalysis.registerBuy.gatedAlert", {
            reason: gate.reason ?? (lang === "it" ? "Gate sim non superato" : "Sim gate not passed"),
          }),
        );
        return;
      }
      // ── Sim Loop Acceptance Policy check ────────────────────────────────
      const policy = loadSimLoopPolicy();
      if (policy.minSds > 0 || policy.minPplanPct > 0 || policy.rejectOnLossPattern) {
        const sdsVal: number | null = (() => {
          const raw = row["SDS"] ?? row["sds"];
          if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
          return null;
        })();
        const pplanVal: number | null = (() => {
          const raw = row["Plan_Prob_Pct"] ?? row["Affidabilità\ncalib %"] ?? row["Affidabilità\n%"];
          if (raw == null) return null;
          const n = Number(String(raw).replace("%", "").replace(",", "."));
          if (!Number.isFinite(n)) return null;
          return Math.abs(n) <= 1.5 ? n * 100 : n;
        })();
        const suggestedAction = String(row["suggestedAction"] ?? row["Suggested Action"] ?? "buy");
        const policyResult = evaluateSimLoopPolicy(sdsVal, pplanVal, false, suggestedAction, policy);
        if (!policyResult.accepted) {
          window.alert(
            lang === "it"
              ? `Sim Loop Policy: BUY rifiutato — ${policyResult.reason}\n\nModifica le soglie in Step 1 > Sim Loop Policy.`
              : `Sim Loop Policy: BUY rejected — ${policyResult.reason}\n\nAdjust thresholds in Step 1 > Sim Loop Policy.`,
          );
          return;
        }
      }
      // ────────────────────────────────────────────────────────────────────
      const curr = currentPriceFromRow(row);
      if (curr == null || curr <= 0) {
        window.alert(
          "Current price unavailable — run Refresh data on the Simulation sheet first."
        );
        return;
      }
      const sheetBuy = sheetBuyPriceFromRow(row);
      patchInputs((prev) => {
        const cur = prev[key] ?? { buyPrice: 0, capital: 0 };
        const entryBuy =
          cur.buyPrice > 0
            ? cur.buyPrice
            : sheetBuy != null && sheetBuy > 0
              ? sheetBuy
              : curr;
        return {
          ...prev,
          [key]: {
            buyPrice: entryBuy,
            capital: capitalEur > 0 ? capitalEur : DEFAULT_SIM_BUY_CAPITAL_EUR,
            ignoreSheet: false,
            investedAt: cur.investedAt ?? new Date().toISOString(),
            universe: "simloop" as const,
            ...(cur.purchaseDate ? { purchaseDate: cur.purchaseDate } : {}),
          },
        };
      });
      setSelectedKey(key);
      recordSnapshot("hourly");
    },
    [simRowByKey, patchInputs, recordSnapshot, setSelectedKey, t, lang],
  );

  // "Sell" — closes the position at the current price:
  //   1) Shows a confirmation with the computed final P&L.
  //   2) Forces recording a history snapshot (to track the exit in the
  //      history / decision log).
  //   3) Clears the row from the portfolio inputs.
  const sellRowSimulation = useCallback(
    (key: string, simRowHint?: Record<string, unknown> | null, opts?: { confirm?: boolean }) => {
      const result = executePortfolioSell({
        key,
        simRow: simRowByKey.get(key) ?? simRowHint ?? null,
        simTable,
        inputs: inputsRef.current,
        confirm: opts?.confirm ?? true,
        recordHistory: true,
      });
      if (result.ok) {
        patchInputs(() => result.inputs);
        if (selectedKey === key) setSelectedKey(null);
        recordSnapshot("hourly");
      }
      return result;
    },
    [simRowByKey, simTable, selectedKey, setSelectedKey, patchInputs, recordSnapshot],
  );

  // Execute BUY/SELL from row Actions only — «→ Simulation» naviga senza auto-trade.

  const seriesKeyForPosition = useCallback(
    (p: Position): string | null => {
      const row = simRowByKey.get(p.key);
      return row ? simulationRowSeriesKey(row) : null;
    },
    [simRowByKey]
  );

  const openPredictionChartsFor = useCallback(
    (p: Position) => {
      onOpenPredictionCharts({
        ticker: p.ticker,
        completionDate: p.completionDate,
        seriesKey: seriesKeyForPosition(p),
      });
    },
    [onOpenPredictionCharts, seriesKeyForPosition]
  );

  const openDecisionLabBlockFor = useCallback(
    (p: Position) => {
      onOpenDecisionLabBlock?.({
        ticker: p.ticker,
        cd: p.completionDate,
      });
    },
    [onOpenDecisionLabBlock]
  );

  const openSimulationRowFor = useCallback(
    (p: Position) => {
      onOpenSimulationRow?.({
        ticker: p.ticker,
        cd: p.completionDate,
      });
    },
    [onOpenSimulationRow]
  );

  const pnlReloadInFlightRef = useRef(false);

  const handleReload = useCallback(async () => {
    if (pnlReloadInFlightRef.current) return;
    setCdScanError(null);
    pnlReloadInFlightRef.current = true;
    setCdScanBusy(true);
    try {
      await Promise.resolve(onReloadSimulation());
      await reloadChartBundle();
      setSimInputsReloadToken((tok) => tok + 1);
      refreshPriceManifest();
      recordSnapshot("hourly");
      setLastRecalcAt(Date.now());
    } catch (err) {
      setCdScanError(err instanceof Error ? err.message : String(err));
    } finally {
      pnlReloadInFlightRef.current = false;
      setCdScanBusy(false);
      setCdScanPhase(null);
    }
  }, [onReloadSimulation, recordSnapshot, refreshPriceManifest, reloadChartBundle, view]);

  const parentReloadHandledRef = useRef(0);
  useEffect(() => {
    if (!parentReloadToken || parentReloadToken === parentReloadHandledRef.current) return;
    parentReloadHandledRef.current = parentReloadToken;
    void (async () => {
      await reloadChartBundle();
      setSimInputsReloadToken((tok) => tok + 1);
      refreshPriceManifest();
      recordSnapshot("hourly");
      setLastRecalcAt(Date.now());
    })();
  }, [
    parentReloadToken,
    reloadChartBundle,
    refreshPriceManifest,
    recordSnapshot,
  ]);

  const lastHandledRefreshTsRef = useRef(0);

  /** Dopo Refresh data completato: aggiorna P&L + grafici senza attendere Reload manuale. */
  useEffect(() => {
    if (refreshLife.state !== "ok" || !refreshFinishedAt) return;
    const ts = refreshFinishedAt.getTime();
    if (ts <= lastHandledRefreshTsRef.current) return;
    lastHandledRefreshTsRef.current = ts;
    invalidateSimulationChartsCache();
    void (async () => {
      try {
        await Promise.resolve(onReloadSimulation());
        await reloadChartBundle();
        setSimInputsReloadToken((tok) => tok + 1);
        refreshPriceManifest();
        recordSnapshot("hourly");
        setLastRecalcAt(Date.now());
      } catch {
        /* parent reload may surface error */
      }
    })();
  }, [
    refreshLife.state,
    refreshFinishedAt,
    onReloadSimulation,
    reloadChartBundle,
    refreshPriceManifest,
    recordSnapshot,
  ]);

  const reloadBusy = simLoading || cdScanBusy;
  const reloadBusyLabel = cdScanPhase ?? (cdScanBusy ? t("refresh.sim.cdScan.running") : undefined);

  const renderSimulationRefreshControls = (extraInfo?: string) => {
    if (isDecisionLabEmbed) return null;
    return (
      <RefreshControls
        onRefresh={handleReload}
        loading={reloadBusy}
        loadingLabel={reloadBusyLabel}
        tooltip={t("refresh.page.simulation.tooltip")}
        dataUpdatedAt={dataUpdatedAt}
        extraInfo={extraInfo}
        className="!items-end"
      />
    );
  };

  const positionAssessmentCount = useMemo(
    () => detectPortfolioPositionAlerts(simTable, inputs, history).length,
    [simTable, inputs, history],
  );
  const opportunityAssessmentCount = useMemo(
    () => detectOpportunityAnalysisAlerts(simTable, inputs).length,
    [simTable, inputs],
  );
  const totalAssessmentCount = positionAssessmentCount + opportunityAssessmentCount;

  const renderWorkspaceViewTabs = useCallback(
    (opts?: { trailing?: React.ReactNode; className?: string }) => (
      <div
        className={`flex items-center gap-0.5 px-3 py-1.5 border-b border-[rgb(var(--border))]/40 shrink-0 sim-workspace-toolbar flex-wrap ${
          opts?.className ?? ""
        }`}
      >
        <div className="flex items-center gap-0.5 mr-2 flex-wrap">
          {(
            [
              [
                "lossAnalysis",
                t("sim.workspace.tab.lossAnalysis"),
                !hasActivePositions,
                t("sim.workspace.tab.lossAnalysisTip"),
              ],
              ["snapshotBar", t("sim.workspace.tab.pnl"), !hasActivePositions, t("sim.workspace.tab.pnlTip")],
              ["trendChart", t("sim.workspace.tab.chart"), portfolio.n === 0, t("sim.workspace.tab.chartTip")],
            ] as const
          ).map(([id, label, disabled, tip]) => {
            const active = view === id;
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                title={tip}
                className={`disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1 ${
                  active ? "seg-btn-active" : "seg-btn"
                }`}
                onClick={() => setView(id as InvestSimView)}
              >
                {id === "lossAnalysis" ? (
                  <span className="opacity-80" aria-hidden>
                    ⏱
                  </span>
                ) : null}
                {id === "snapshotBar" ? <PnlTabRankIcon active={active} /> : null}
                {label}
                {id === "lossAnalysis" && totalAssessmentCount > 0 ? (
                  <span className="tabular-nums opacity-80">({totalAssessmentCount})</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {opts?.trailing}
      </div>
    ),
    [
      view,
      setView,
      t,
      portfolio.n,
      hasActivePositions,
      totalAssessmentCount,
    ],
  );

  if (!isDecisionLabEmbed && view === "trendChart") {
    return (
      <section className="card sim-harmonize flex flex-col flex-1">
        {renderWorkspaceViewTabs({
          trailing: (
            <div className="ml-auto shrink-0 flex items-center gap-2">
              {renderSimulationRefreshControls(
                history.length ? `${history.length} history pts` : undefined,
              )}
            </div>
          ),
        })}
        <div className="flex flex-wrap items-center gap-2 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
          <h2 className="text-lg font-semibold">
            {lang === "it" ? "Andamento investimento" : "Investment trend"}
          </h2>
          <p className="text-xs text-ink-muted w-full sm:w-auto">
            {lang === "it"
              ? `${history.length} letture · snapshot automatico dopo refresh prezzi`
              : `${history.length} readings · auto snapshot after price refresh`}
          </p>
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                if (window.confirm("Clear all chart history?")) {
                  clearInvestSimHistory();
                  lastPriceSigRef.current = "";
                }
              }}
            >
              Clear history
            </button>
          </div>
        </div>
        <div className="p-4 pb-6 flex-1 flex flex-col gap-4">
          {trendChartData.length < 2 ? (
            <p className="text-sm text-ink-muted text-center py-8">
              {lang === "it"
                ? "Servono almeno 2 letture. Inserisci capitale sulle righe, poi «Aggiorna dati» o Reload — lo snapshot è automatico."
                : "At least 2 readings are needed. Enter capital on rows, then Refresh data or Reload — snapshots are automatic."}
            </p>
          ) : (
            <>
              {trendActivePositions.length > 0 ? (
                <div className="space-y-1.5 shrink-0">
                  <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
                    Company in portfolio
                  </p>
                  <SelectionChipGroup>
                    <SelectionChip
                      active={!selectedKey}
                      onClick={() => setSelectedKey(null)}
                      title="Aggregate portfolio (all positions)"
                    >
                      All portfolio
                    </SelectionChip>
                    {trendActivePositions.map((p) => {
                      const row = simRowByKey.get(p.key);
                      const company = row
                        ? String(row["Società"] ?? row["Societa"] ?? "").trim()
                        : "";
                      return (
                        <SelectionChip
                          key={p.key}
                          active={selectedKey === p.key}
                          onClick={() => setSelectedKey(p.key)}
                          title={company ? `${p.ticker} — ${company}` : p.ticker}
                        >
                          <span className="inline-flex items-center gap-1 tabular-nums">
                            <PortfolioPnlTrendIcon
                              pnlPct={p.pnlUnavailable ? null : p.pnlPct}
                              pnlEur={p.pnlUnavailable ? null : p.pnlEur}
                              size="sm"
                            />
                            {p.ticker}
                          </span>
                        </SelectionChip>
                      );
                    })}
                  </SelectionChipGroup>
                </div>
              ) : null}
              <InvestTrendMessageBanner
                outlook={trendOutlook}
                pnlPct={trendDisplayMetrics.pct}
                pnlEur={trendDisplayMetrics.pnl}
                pnlUnavailable={trendDisplayMetrics.pnlUnavailable}
              />
              {!trendDisplayMetrics.pnlUnavailable ? (
                <InvestTrendCapitalGap
                  capital={trendDisplayMetrics.capital}
                  valueNow={trendDisplayMetrics.valueNow}
                  outlook={trendOutlook}
                />
              ) : null}
              <div className="flex flex-col gap-4 shrink-0">
              <div
                className={`${TREND_PANEL_CLASS} border-t-[3px] ${trendOutlook.panelAccent}`}
              >
                <p className="text-[10px] uppercase tracking-wide chart-trend-muted font-semibold mb-0.5">
                  P&amp;L % — {lang === "it" ? "rendimento sul capitale" : "return on capital"}
                </p>
                <p className="text-[11px] chart-trend-muted mb-3">
                  {lang === "it"
                    ? "Sopra 0% = guadagno · sotto 0% = perdita · linea tratteggiata = pareggio"
                    : "Above 0% = gain · below 0% = loss · dashed line = breakeven"}
                </p>
                <div className="h-[min(40vh,360px)] min-h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={trendChartData}
                    margin={{ top: investTrendMarkers.length ? 20 : 10, right: 12, left: 0, bottom: 4 }}
                  >
                    <defs>
                      <linearGradient id="investTrendPnlFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={trendOutlook.fillColor} stopOpacity={0.22} />
                        <stop offset="100%" stopColor={trendOutlook.fillColor} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...TREND_GRID} />
                    <XAxis
                      dataKey="ts"
                      tick={TREND_AXIS_TICK}
                      tickLine={false}
                      axisLine={{ stroke: "#93c5fd", strokeOpacity: 0.35 }}
                      interval="preserveStartEnd"
                      minTickGap={48}
                      height={32}
                    />
                    <YAxis
                      tick={TREND_AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      domain={trendPnlPctDomain}
                      tickFormatter={(v) => `${fmtAxisPctTick(v)}%`}
                    />
                    <InvestTrendBreakevenLayers
                      yDomain={trendPnlPctDomain}
                      breakevenLabel={lang === "it" ? "Pareggio" : "Breakeven"}
                    />
                    <InvestTrendMarkersLayer
                      markers={investTrendMarkers}
                      selectedTicker={selectedPosition?.ticker}
                    />
                    <Tooltip content={<InvestTrendChartTooltip valueMode="pct" />} />
                    {!selectedKey && (
                      <Area
                        type="monotone"
                        dataKey="pnlPct"
                        fill="url(#investTrendPnlFill)"
                        stroke="none"
                        isAnimationActive={false}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="pnlPct"
                      name={lang === "it" ? "P&L portafoglio %" : "Portfolio P&L %"}
                      stroke={trendOutlook.lineColor}
                      strokeWidth={selectedKey ? 1.75 : 2.5}
                      strokeOpacity={selectedKey ? 0.4 : 1}
                      dot={false}
                      activeDot={{
                        r: 4,
                        strokeWidth: 2,
                        stroke: "#fff",
                        fill: trendOutlook.lineColor,
                      }}
                    />
                    {selectedKey && (
                      <Line
                        type="monotone"
                        dataKey="pnlPctSel"
                        name={selectedPosition?.ticker ?? "Selection"}
                        stroke={trendOutlook.lineColor}
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{
                          r: 4,
                          strokeWidth: 2,
                          stroke: "#fff",
                          fill: trendOutlook.lineColor,
                        }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                </div>
                <InvestTrendLegend
                  items={[
                    {
                      key: "pnl",
                      label: lang === "it" ? "P&L %" : "P&L %",
                      color: trendOutlook.lineColor,
                    },
                    {
                      key: "be",
                      label: lang === "it" ? "Pareggio (0%)" : "Breakeven (0%)",
                      color: "#2563eb",
                      dashed: true,
                    },
                    ...(selectedKey
                      ? [
                          {
                            key: "selPnl",
                            label: selectedPosition?.ticker ?? "Selection",
                            color: trendOutlook.lineColor,
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
              <div
                className={`${TREND_PANEL_CLASS} border-t-[3px] ${trendOutlook.panelAccent}`}
              >
                <p className="text-[10px] uppercase tracking-wide chart-trend-muted font-semibold mb-0.5">
                  P&amp;L €
                </p>
                <p className="text-[11px] chart-trend-muted mb-3">
                  {lang === "it"
                    ? "Sopra €0 = guadagno · sotto €0 = perdita · linea tratteggiata = pareggio"
                    : "Above €0 = gain · below €0 = loss · dashed line = breakeven"}
                </p>
                <div className="h-[min(28vh,260px)] min-h-[180px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={trendChartData}
                    margin={{ top: investTrendMarkers.length ? 20 : 10, right: 12, left: 0, bottom: 4 }}
                  >
                    <defs>
                      <linearGradient id="investTrendPnlEurFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={trendOutlook.fillColor} stopOpacity={0.18} />
                        <stop offset="100%" stopColor={trendOutlook.fillColor} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...TREND_GRID} />
                    <XAxis
                      dataKey="ts"
                      tick={TREND_AXIS_TICK}
                      tickLine={false}
                      axisLine={{ stroke: "#93c5fd", strokeOpacity: 0.35 }}
                      interval="preserveStartEnd"
                      minTickGap={48}
                      height={32}
                    />
                    <YAxis
                      tick={TREND_AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      domain={trendPnlEurDomain}
                      tickFormatter={(v) => `€${fmtAxisEurTick(v)}`}
                    />
                    <InvestTrendBreakevenLayers
                      yDomain={trendPnlEurDomain}
                      breakevenLabel={lang === "it" ? "Pareggio" : "Breakeven"}
                    />
                    <InvestTrendMarkersLayer
                      markers={investTrendMarkers}
                      selectedTicker={selectedPosition?.ticker}
                    />
                    <Tooltip content={<InvestTrendChartTooltip valueMode="eur" />} />
                    {!selectedKey && (
                      <Area
                        type="monotone"
                        dataKey="pnl"
                        fill="url(#investTrendPnlEurFill)"
                        stroke="none"
                        isAnimationActive={false}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="pnl"
                      name={lang === "it" ? "P&L portafoglio €" : "Portfolio P&L €"}
                      stroke={trendOutlook.lineColor}
                      strokeWidth={selectedKey ? 1.75 : 2.5}
                      strokeOpacity={selectedKey ? 0.4 : 1}
                      dot={false}
                      activeDot={{
                        r: 4,
                        strokeWidth: 2,
                        stroke: "#fff",
                        fill: trendOutlook.lineColor,
                      }}
                    />
                    {selectedKey && (
                      <Line
                        type="monotone"
                        dataKey="pnlSel"
                        name={selectedPosition?.ticker ?? "Selection"}
                        stroke={trendOutlook.lineColor}
                        strokeWidth={2.5}
                        dot={false}
                        activeDot={{
                          r: 4,
                          strokeWidth: 2,
                          stroke: "#fff",
                          fill: trendOutlook.lineColor,
                        }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                </div>
                <InvestTrendLegend
                  items={[
                    {
                      key: "pnlEur",
                      label: lang === "it" ? "P&L €" : "P&L €",
                      color: trendOutlook.lineColor,
                    },
                    {
                      key: "beEur",
                      label: lang === "it" ? "Pareggio (€0)" : "Breakeven (€0)",
                      color: "#2563eb",
                      dashed: true,
                    },
                    ...(selectedKey
                      ? [
                          {
                            key: "selEur",
                            label: selectedPosition?.ticker ?? "Selection",
                            color: trendOutlook.lineColor,
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
              {investTrendMarkers.length > 0 && (
                <p className="text-[10px] text-ink-muted shrink-0 px-1">
                  {lang === "it"
                    ? "Linea verticale tratteggiata = data di acquisto registrata."
                    : "Vertical dashed line = buy date recorded."}
                  {selectedPosition
                    ? lang === "it"
                      ? ` Evidenziata per ${selectedPosition.ticker}.`
                      : ` Highlighted for ${selectedPosition.ticker}.`
                    : lang === "it"
                      ? " Seleziona un titolo sopra per confrontarlo col portafoglio."
                      : " Select a company above to compare with the portfolio."}
                </p>
              )}
              </div>
            </>
          )}
        </div>
      </section>
    );
  }

  if (!isDecisionLabEmbed && view === "snapshotBar") {
    const barDataKey =
      snapshotMetric === "pct"
        ? snapshotScope === "today"
          ? "pnlPctToday"
          : snapshotScope === "reading"
            ? "pnlPctSinceReading"
            : "pnlPct"
        : snapshotScope === "today"
          ? "pnlEurToday"
          : snapshotScope === "reading"
            ? "pnlEurSinceReading"
            : "pnlEur";
    const barName =
      snapshotMetric === "pct"
        ? snapshotScope === "today"
          ? t("sim.pnl.bar.pctDay")
          : snapshotScope === "reading"
            ? t("sim.pnl.bar.pctReading")
            : t("sim.pnl.bar.pctTotal")
        : snapshotScope === "today"
          ? t("sim.pnl.bar.eurDay")
          : snapshotScope === "reading"
            ? t("sim.pnl.bar.eurReading")
            : t("sim.pnl.bar.eurTotal");
    const fmtPct = (v: number | null | undefined) =>
      v == null || !Number.isFinite(v)
        ? "—"
        : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
    const fmtEur = (v: number | null | undefined) =>
      v == null || !Number.isFinite(v)
        ? "—"
        : `${v >= 0 ? "+" : ""}€ ${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    const fmtEurVal = (v: number | null | undefined) =>
      v == null || !Number.isFinite(v)
        ? "—"
        : `€ ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const fmtRecalcTime = (ms: number) =>
      new Date(ms).toLocaleTimeString(lang === "it" ? "it-IT" : "en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    const barYDomain: [number, number] =
      snapshotMetric === "pct"
        ? snapshotScope === "today"
          ? pnlPctTodayDomain
          : snapshotScope === "reading"
            ? pnlPctReadingDomain
            : pnlPctDomain
        : snapshotScope === "today"
          ? pnlEurTodayDomain
          : snapshotScope === "reading"
            ? pnlEurReadingDomain
            : pnlEurDomain;
    const barPortfolioReference: number | null =
      snapshotScope === "reading"
        ? null
        : snapshotMetric === "pct"
          ? snapshotScope === "today"
            ? snapshotTotals.pnlPctToday
            : snapshotTotals.pnlPct
          : snapshotScope === "today"
            ? snapshotTotals.todayCovered > 0
              ? snapshotTotals.pnlEurToday
              : null
            : snapshotTotals.pnlEur;
    const accentOf = (v: number | null | undefined) =>
      v == null ? "" : portfolioPnlAccentClass(v);
    return (
      <>
      <section className="card sim-harmonize flex flex-col flex-1 min-h-[28rem]">
        {renderWorkspaceViewTabs()}
        <div className="flex flex-wrap items-center gap-2 border-b border-[rgb(var(--border))] px-4 py-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold inline-flex items-center gap-2">
              <PnlTabRankIcon active />
              {t("sim.pnl.title")}
            </h2>
            <p className="text-[11px] text-ink-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span>
                {t("sim.pnl.subtitle.meta", {
                  n: chartData.length,
                  scope:
                    snapshotScope === "today"
                      ? t("sim.pnl.scope.today")
                      : snapshotScope === "reading"
                        ? t("sim.pnl.scope.reading")
                        : t("sim.pnl.scope.total"),
                })}
              </span>
              {priceSnapshotAt ? (
                <span className="text-ink-muted/80">
                  · {t("sim.pnl.pricesAt")} {fmtSnapshotPriceLabel(priceSnapshotAt)}
                </span>
              ) : null}
            </p>
          </div>
          <div className="ml-auto shrink-0 flex items-center gap-2">
            {renderSimulationRefreshControls(
              chartData.length
                ? `${chartData.length} active · ${history.length} history pts`
                : undefined,
            )}
          </div>
        </div>
        <div className="p-4 flex-1 flex flex-col gap-3">
          {chartData.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-8">
              {t("sim.pnl.empty")}
            </p>
          ) : (
            <>
              {refreshApiOk === false ? (
                <p className="text-[11px] text-[rgb(var(--signal-down))] bg-[rgb(var(--signal-down))]/8 border border-[rgb(var(--signal-down))]/30 rounded-md px-3 py-2 leading-snug">
                  {t("refresh.btn.refreshData.offline")}
                </p>
              ) : null}
              {priceDataHint ? (
                <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-md px-3 py-2 leading-snug">
                  {priceDataHint}
                </p>
              ) : null}

              {/* ── Hero: risposta chiara «quanto sono in rosso/verde» (totale dall'ingresso) ── */}
              <div
                className={`${ptfBlockTotalClassName(ptfSumTotalTone)} px-4 py-3`}
                title={t("sim.pnl.sumTotalTip")}
              >
                <p className={`${ptfSumBlkTotal.blockTitleTotal} text-[11px]`}>
                  {t("sim.pnl.hero.label")}
                </p>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-1">
                  <span className={`text-3xl font-bold tabular-nums${accentOf(snapshotTotals.pnlEur)}`}>
                    {fmtEur(snapshotTotals.pnlEur)}
                  </span>
                  <span className={`text-xl font-semibold tabular-nums${accentOf(snapshotTotals.pnlPct)}`}>
                    {fmtPct(snapshotTotals.pnlPct)}
                  </span>
                </div>
                <p className="text-[11px] text-ink-muted/85 mt-1 tabular-nums">
                  {t("sim.pnl.onInvested", {
                    capital: fmtEurVal(snapshotTotals.capital),
                    value: fmtEurVal(snapshotTotals.valueNow),
                  })}
                  {" · "}
                  {t("sim.pnl.recalc")} {fmtRecalcTime(lastRecalcAt)}
                </p>
                {portfolioPriorLegEur != null &&
                snapshotTotals.todayCovered > 0 &&
                Math.abs(portfolioPriorLegEur) > 0.01 ? (
                  <p className="text-[11px] text-ink-muted/90 mt-2 tabular-nums leading-snug border-t border-[rgb(var(--border))]/35 pt-2">
                    {t(
                      snapshotTotals.anyHistoryUncertainContamination
                        ? "sim.pnl.hero.breakdownUncertain"
                        : snapshotTotals.priorLegIsImplicitEstimate
                          ? "sim.pnl.hero.breakdownImplicit"
                          : "sim.pnl.hero.breakdown",
                      {
                        prior: fmtSignedEurPnl(portfolioPriorLegEur),
                        today: fmtSignedEurPnl(snapshotTotals.pnlEurToday ?? 0),
                        todayPct: fmtPct(snapshotTotals.pnlPctToday),
                      },
                    )}
                  </p>
                ) : snapshotTotals.todayCovered > 0 ? (
                  <p className="text-[11px] text-ink-muted/90 mt-2 tabular-nums leading-snug border-t border-[rgb(var(--border))]/35 pt-2">
                    {t("sim.pnl.hero.breakdownTodayOnly", {
                      today: fmtSignedEurPnl(snapshotTotals.pnlEurToday ?? 0),
                      todayPct: fmtPct(snapshotTotals.pnlPctToday),
                    })}
                  </p>
                ) : null}
              </div>

              {/* ── KPI secondari: giornata + closed piggy ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div
                  className={`${ptfBlockDaySecondaryClassName()}`}
                  title={t("sim.pnl.kpi.todayTitleTip")}
                >
                  <p className="text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
                    {t("sim.pnl.kpi.todayTitle")}
                  </p>
                  <div className="flex items-baseline gap-3 mt-0.5">
                    <span
                      className={`text-xl font-bold tabular-nums${
                        snapshotTotals.todayCovered > 0 ? accentOf(snapshotTotals.pnlEurToday) : ""
                      }`}
                    >
                      {snapshotTotals.todayCovered > 0
                        ? fmtEur(snapshotTotals.pnlEurToday ?? 0)
                        : "—"}
                    </span>
                    <span
                      className={`text-sm tabular-nums${
                        snapshotTotals.todayCovered > 0 ? accentOf(snapshotTotals.pnlPctToday) : ""
                      }`}
                    >
                      {snapshotTotals.todayCovered > 0 && snapshotTotals.pnlPctToday != null
                        ? fmtPct(snapshotTotals.pnlPctToday)
                        : "—"}
                    </span>
                  </div>
                  <p className="text-[10px] text-ink-muted/80 mt-0.5 leading-snug">
                    {t("sim.pnl.tickersWithDaily", {
                      covered: snapshotTotals.todayCovered,
                      total: snapshotTotals.todayTotal,
                    })}
                    {priceSnapshotAt ? (
                      <> · {t("sim.pnl.pricesAt")} {fmtSnapshotPriceLabel(priceSnapshotAt)}</>
                    ) : null}
                  </p>
                </div>
                <ClosedPiggyBankBeerGlass
                  display={closedPiggyDisplay}
                  onReset={resetClosedPiggy}
                  compact
                  showExplain={false}
                />
              </div>
              <p className="text-[10px] text-ink-muted/65 leading-snug -mt-1">
                {t("sim.pnl.hintReload")}
              </p>
              <p className="text-[10px] text-[rgb(var(--panel-feed-accent-strong))]/75 leading-snug border-l-2 border-[rgb(var(--panel-feed-accent))]/35 pl-2">
                {t("sim.pnl.slopeHarmonyNote")}
              </p>

              {/* ── Toggle: scope + metric ── */}
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[rgb(var(--border))]/40 bg-[rgb(var(--surface))]/50 px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-ink-muted">
                    {t("sim.pnl.chartLabel")}
                  </span>
                  {(
                    [
                      ["today", t("sim.pnl.chart.today"), t("sim.pnl.chart.todayTip")] as const,
                      ["reading", t("sim.pnl.chart.reading"), t("sim.pnl.chart.readingTip")] as const,
                      ["total", t("sim.pnl.chart.total"), t("sim.pnl.chart.totalTip")] as const,
                    ] as const
                  ).map(([scopeKey, lab, tip]) => {
                    const active = snapshotScope === scopeKey;
                    return (
                      <button
                        key={scopeKey}
                        type="button"
                        onClick={() => setSnapshotScope(scopeKey)}
                        className={active ? "seg-btn-active" : "seg-btn-outline"}
                        title={tip}
                      >
                        {lab}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-ink-muted">
                    {t("sim.pnl.metric")}
                  </span>
                  {([
                    ["pct", "%"],
                    ["eur", "€"],
                  ] as const).map(([k, lab]) => {
                    const active = snapshotMetric === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setSnapshotMetric(k)}
                        className={active ? "seg-btn-active" : "seg-btn-outline"}
                      >
                        {lab}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--border))]/45 bg-[rgb(var(--surface-2))]/50 px-2.5 py-1 text-[11px] font-medium text-ink-muted hover:border-[rgb(var(--panel-feed-accent))]/35 hover:text-ink hover:bg-[rgb(var(--surface-3))]/60 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  disabled={chartData.length === 0}
                  onClick={() => setDailyPnlLedgerOpen(true)}
                  title={t("sim.pnl.ledger.openTitle")}
                >
                  <DailyLedgerIcon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                  {t("sim.pnl.ledger.open")}
                </button>
              </div>

              <PortfolioPnlBarChart
                key={`${snapshotScope}-${snapshotMetric}`}
                data={chartDataSorted}
                dataKey={barDataKey}
                seriesName={barName}
                metric={snapshotMetric}
                yDomain={barYDomain}
                showDualInTooltip={snapshotScope === "total"}
                portfolioReference={barPortfolioReference}
                portfolioReferenceLabel={
                  snapshotScope === "reading"
                    ? ""
                    : snapshotMetric === "pct"
                      ? snapshotScope === "today"
                        ? t("sim.pnl.chart.refToday", {
                            value: fmtPct(snapshotTotals.pnlPctToday),
                          })
                        : t("sim.pnl.chart.refTotal", {
                            value: fmtPct(snapshotTotals.pnlPct),
                          })
                      : snapshotScope === "today"
                        ? t("sim.pnl.chart.refToday", {
                            value: fmtEur(
                              snapshotTotals.todayCovered > 0
                                ? snapshotTotals.pnlEurToday
                                : null,
                            ),
                          })
                        : t("sim.pnl.chart.refTotal", {
                            value: fmtEur(snapshotTotals.pnlEur),
                          })
                }
              />
              {snapshotScope === "total" ? (
                <p className="text-[10px] text-ink-muted/80 leading-snug -mt-1 px-0.5">
                  {t("sim.pnl.chart.totalDualHint")}
                </p>
              ) : snapshotScope === "reading" ? (
                <p className="text-[10px] text-ink-muted/80 leading-snug -mt-1 px-0.5">
                  {t("sim.pnl.chart.readingHint")}
                </p>
              ) : (
                <p className="text-[10px] text-ink-muted/80 leading-snug -mt-1 px-0.5">
                  {t("sim.pnl.chart.todayVsTotalHint")}
                </p>
              )}

              <PortfolioGainPlanChart rows={chartDataByExpectedGain} history={history} />

              {/* ── Portfolio positions: tabella stile Simulation ── */}
              <div className={`flex flex-col gap-2.5 ${pnlBlocksShellClass}`}>
                {pnlWinRate.decisive > 0 ? (
                  <p
                    className={`text-[10px] tabular-nums font-medium px-0.5 ${
                      pnlWinRate.winPct != null && pnlWinRate.winPct > 50
                        ? "text-emerald-800/90"
                        : pnlWinRate.winPct != null && pnlWinRate.winPct < 50
                          ? "text-rose-800/90"
                          : "text-ink-muted/80"
                    }`}
                    title={
                      lang === "it"
                        ? "Quota posizioni in gain vs in loss (flat esclusi)"
                        : "Share of positions in gain vs loss (flat excluded)"
                    }
                  >
                    {lang === "it"
                      ? `${pnlWinRate.gainCount} in gain · ${pnlWinRate.lossCount} in loss`
                      : `${pnlWinRate.gainCount} gaining · ${pnlWinRate.lossCount} losing`}
                    {pnlWinRate.winPct != null ? (
                      <span className="font-semibold">
                        {" "}
                        · {pnlWinRate.winPct.toFixed(0)}% gain
                      </span>
                    ) : null}
                    {pnlWinRate.winPct === 50 ? (
                      <span className="font-normal opacity-80">
                        {" "}
                        ({lang === "it" ? "pari — sfondo neutro" : "even — neutral backdrop"})
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                  <p className="text-[10px] text-ink-muted/85">
                    {t("sim.pnl.sortedBestWorst", {
                      scope:
                        snapshotScope === "today"
                          ? t("sim.pnl.scope.today")
                          : t("sim.pnl.scope.total"),
                    })}
                  </p>
                  <p className="text-[10px] text-ink-muted flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="inline-flex items-center gap-1">
                      <RankAnimalIcon visual={dealRankVisual(0, 3)} basePx={14} />
                      {lang === "it" ? "top deal" : "top deal"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <RankAnimalIcon
                        visual={{
                          kind: "worst",
                          emoji: WORST_RANK_EMOJI,
                          crown: false,
                          scale: 1.05,
                        }}
                        basePx={14}
                      />
                      {lang === "it" ? "in perdita" : "in loss"}
                    </span>
                  </p>
                </div>
                <PortfolioPnlSheetTable
                  rows={chartDataSorted}
                  rankByKey={pnlCardRank.rankByKey}
                  rankTotal={pnlCardRank.total}
                  simTableColumns={simTable?.columns}
                  lang={lang === "it" ? "it" : "en"}
                  onOpenCurve={(row) =>
                    onOpenPredictionCharts({
                      ticker: row.ticker,
                      completionDate: row.completionDate ?? "—",
                      seriesKey: row.seriesKey ?? null,
                    })
                  }
                  onSell={sellRowSimulation}
                />

                {/* Somma gain portafoglio (Σ ticker attivi) */}
                <article className={`${portfolioRowArticleClass(ptfSumTotalTone)} mt-0`}>
                  <p className={`${ptfSumBlkTotal.blockTitleTotal} mb-2 text-[11px]`}>
                    {t("sim.pnl.portfolioSumTitle")}
                  </p>
                  <div className={PTF_CARD.grid}>
                    <div className={PTF_BLK_NEUTRAL.block}>
                      <p className={PTF_BLK_NEUTRAL.blockTitle}>{t("sim.pnl.portfolio.capital")}</p>
                      <PtfField label={t("sim.pnl.portfolio.invested")} value={fmtEurVal(snapshotTotals.capital)} />
                      <PtfField label={t("sim.pnl.portfolio.valueNow")} value={fmtEurVal(snapshotTotals.valueNow)} />
                    </div>
                    <div className={PTF_BLK_NEUTRAL.block}>
                      <p className={PTF_BLK_NEUTRAL.blockTitle}>{t("sim.pnl.portfolio.dayCoverage")}</p>
                      <PtfField
                        label={t("sim.pnl.portfolio.tickersDaily")}
                        value={`${snapshotTotals.todayCovered}/${snapshotTotals.todayTotal}`}
                      />
                    </div>
                    <div className={ptfBlockDayClassName(ptfSumDayTone)}>
                      <p className={`ptf-block-day-title ${ptfSumBlkDay.blockTitleDay}`}>
                        {snapshotTotals.todayCovered > 0
                          ? portfolioDailyChangeLabel(lang === "it", ptfSumDayTone)
                          : t("sim.pnl.sumTodayShort")}
                      </p>
                      <div className={PTF_CARD.metricGrid2}>
                        <PtfField
                          label={t("sim.pnl.field.gainPct")}
                          value={
                            snapshotTotals.todayCovered > 0
                              ? fmtPct(snapshotTotals.pnlPctToday)
                              : "—"
                          }
                          tone={
                            snapshotTotals.todayCovered > 0
                              ? ptfPnlToneFromDisplay(ptfSumDayTone)
                              : "text-slate-500"
                          }
                        />
                        <PtfField
                          label={t("sim.pnl.field.gainEur")}
                          value={
                            snapshotTotals.todayCovered > 0
                              ? fmtSignedEurPnl(snapshotTotals.pnlEurToday)
                              : "—"
                          }
                          tone={
                            snapshotTotals.todayCovered > 0
                              ? ptfPnlToneFromDisplay(ptfSumDayTone)
                              : "text-slate-500"
                          }
                        />
                      </div>
                    </div>
                    <div className={ptfBlockTotalClassName(ptfSumTotalTone)}>
                      <p className={ptfSumBlkTotal.blockTitleTotal}>{t("sim.pnl.sumTotalShort")}</p>
                      <div className={PTF_CARD.metricGrid2}>
                        <PtfField
                          label={t("sim.pnl.field.gainPct")}
                          value={fmtPct(snapshotTotals.pnlPct)}
                          tone={ptfPnlToneFromDisplay(ptfSumTotalTone)}
                        />
                        <PtfField
                          label={t("sim.pnl.field.gainEur")}
                          value={fmtSignedEurPnl(snapshotTotals.pnlEur)}
                          tone={ptfPnlToneFromDisplay(ptfSumTotalTone)}
                        />
                      </div>
                    </div>
                  </div>
                </article>
              </div>
            </>
          )}
        </div>
      </section>
      <PortfolioDailyPnlDrawer
        open={dailyPnlLedgerOpen}
        onClose={() => setDailyPnlLedgerOpen(false)}
        ledger={dailyPnlLedger}
      />
    </>
    );
  }

  if (!isDecisionLabEmbed && view === "lossAnalysis") {
    return (
      <div className="card sim-harmonize flex flex-col flex-1">
        {renderWorkspaceViewTabs({
          trailing: (
            <div className="ml-auto shrink-0 flex items-center gap-2">
              {renderSimulationRefreshControls(
                hasActivePositions
                  ? `${positionAssessmentCount}/${totalAssessmentCount}`
                  : undefined,
              )}
            </div>
          ),
        })}
        <PortfolioLossAnalysisView
          key={lastRecalcAt}
          simTable={simTable}
          inputs={inputs}
          history={history}
          chartBundle={chartBundle}
          sdsRows={sdsRowsForMig}
          gainPlanRows={chartDataByExpectedGain}
          onBack={() => setView("snapshotBar")}
          onSell={sellRowSimulation}
          onRegisterBuy={buyRowSimulation}
          onOpenPredictionCharts={onOpenPredictionCharts}
          onOpenDecisionLab={onOpenDecisionLabBlock}
          onOpenSlopeCharts={onOpenSlopeCharts}
          focusTicker={
            focusTicker?.view === "lossAnalysis" ? focusTicker.ticker ?? null : null
          }
          focusRowKey={
            focusTicker?.view === "lossAnalysis" ? focusTicker.rowKey ?? null : null
          }
          onFocusTickerConsumed={onFocusConsumed}
        />
      </div>
    );
  }

  if (!isDecisionLabEmbed) {
    return null;
  }

  // ── Next CD display (safe date parse) — Decision Lab embed table only ─────
  const nextCdLabel = (() => {
    if (!simKpi.next) return "—";
    const raw = simKpi.next["Completion Date"];
    const d = raw ? new Date(String(raw)) : null;
    const dateStr =
      d && !isNaN(d.getTime())
        ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : String(raw ?? "—");
    return `${String(simKpi.next.Ticker ?? "—")} · ${dateStr}`;
  })();

  return (
    <section
      className={`${
        isDecisionLabEmbed ? "flex flex-col flex-1 w-full" : "card sim-harmonize flex flex-col flex-1 w-full h-full"
      }`}
    >

      {!isDecisionLabEmbed ? (
      <>
      {/* ── Top bar: title + reload actions ─────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-[rgb(var(--border))]/60 shrink-0">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-tight">{t("sim.page.title")}</h2>
          <p className="text-[11px] text-ink-muted mt-0.5">
            {simLoading
              ? "Loading…"
              : `${positions.length} rows · ${history.length} history snapshots${
                  priceSnapshotAt
                    ? ` · prices ${fmtSnapshotPriceLabel(priceSnapshotAt)}`
                    : ""
                }`}
          </p>
        </div>
        <div className="ml-auto shrink-0 flex items-center gap-2">
          {onOpenSupernovaScreen ? (
            <button
              type="button"
              className="btn-ghost text-[11px] font-semibold border border-[rgb(var(--border))]/50"
              title={t("sim.workspace.openSupernovaTip")}
              onClick={() => onOpenSupernovaScreen()}
            >
              {t("sim.workspace.openSupernova")}
            </button>
          ) : null}
          {onOpenPatternScreen ? (
            <button
              type="button"
              className="btn-ghost text-[11px] font-semibold border border-[rgb(var(--border))]/50"
              title={t("sim.workspace.openPatternTip")}
              onClick={() => onOpenPatternScreen()}
            >
              {t("sim.workspace.openPattern")}
            </button>
          ) : null}
          {!isDecisionLabEmbed && onOpenDecisionLabScreen ? (
            <button
              type="button"
              className="btn-ghost text-[11px] font-semibold border border-[rgb(var(--border))]/50"
              title={t("sim.workspace.openDecisionLabTip")}
              onClick={onOpenDecisionLabScreen}
            >
              {t("sim.workspace.openDecisionLab")}
            </button>
          ) : null}
          {!isDecisionLabEmbed ? renderSimulationRefreshControls(
            positions.length ? `${positions.length} rows` : undefined,
          ) : null}
        </div>
      </div>

      {simError && <p className="px-4 py-2 text-sm text-negative shrink-0">{simError}</p>}
      {cdScanError && (
        <p className="px-4 py-2 text-sm text-negative shrink-0">{cdScanError}</p>
      )}
      {priceDataHint && (
        <p className="px-4 py-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
          {priceDataHint}
        </p>
      )}

      {/* ── KPI strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-[rgb(var(--border))]/30 border-b border-[rgb(var(--border))]/40 shrink-0 text-[11px]">
        <KpiCard label="Active portfolio" value={`${simKpi.withPosition} / ${simKpi.totalTickers}`} />
        <KpiCard
          label="Invested capital"
          value={`$${simKpi.totalCapital.toLocaleString("en-US")}`}
        />
        <div title={t("sim.pnl.sumTotalTip")}>
          <KpiCard
            label={t("sim.pnl.sumTotalShort")}
            value={
              simKpi.pnlSum !== 0 || simKpi.withPosition > 0
                ? `${simKpi.pnlSum >= 0 ? "+" : ""}$${Math.round(simKpi.pnlSum).toLocaleString("en-US")}${
                    simKpi.withPosition > 0
                      ? ` (${simKpi.pnlPct >= 0 ? "+" : ""}${simKpi.pnlPct.toFixed(1)}%)`
                      : ""
                  }`
                : "—"
            }
            accent={
              portfolioPnlTone(simKpi.pnlSum, simKpi.pnlPct) === "gain"
                ? "positive"
                : portfolioPnlTone(simKpi.pnlSum, simKpi.pnlPct) === "loss"
                  ? "negative"
                  : undefined
            }
          />
        </div>
        <KpiCard label="Avg reliability" value={`${simKpi.avgAff}%`} />
        <KpiCard label="Next CD" value={nextCdLabel} />
      </div>

      {/* ── Combined nav bar ─────────────────────────────────────────────── */}
      {renderWorkspaceViewTabs({
        trailing: onOpenCatalystCharts ? (
          <button
            type="button"
            className="ml-auto text-[11px] text-[rgb(var(--accent))] hover:underline font-medium shrink-0"
            onClick={onOpenCatalystCharts}
          >
            {t("sim.workspace.openCatalyst")}
          </button>
        ) : null,
      })}
      </>
      ) : null}

      <div className={`flex flex-col flex-1 w-full`}>
        <div className={`flex flex-col flex-1 w-full`}>
          <PaneHeader
            title={
              simCdHorizonScope === "watch"
                ? t("sim.workspace.cdScope.watchTitle")
                : t("sim.workspace.cdScope.hotTitle")
            }
            subtitle={workspacePaneSubtitle}
            trailing={
              <button
                type="button"
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition shrink-0 ${
                  simCdHorizonScope === "watch"
                    ? "border-[rgb(var(--accent))] bg-[rgb(var(--accent))] text-white shadow-sm"
                    : "border-[rgb(var(--border))]/60 bg-surface text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/10"
                }`}
                title={
                  simCdHorizonScope === "hot"
                    ? t("sim.workspace.cdScope.showWatchTip")
                    : t("sim.workspace.cdScope.backToHotTip")
                }
                onClick={toggleCdHorizonScope}
              >
                {simCdHorizonScope === "hot"
                  ? t("sim.workspace.cdScope.showWatch", {
                      count: cdHorizonCounts.watch,
                    })
                  : t("sim.workspace.cdScope.backToHot")}
              </button>
            }
          />
          <div className="shrink-0 px-3 py-2 border-b border-[rgb(var(--border))]/30 bg-surface/30 space-y-2 sim-workspace-toolbar">
            <p
              className="text-[10px] text-ink-muted leading-snug max-w-4xl"
              title={t("sim.rascore.col.tip")}
            >
              {t("sim.rascore.harmonization.banner")}
            </p>
            <div className="flex flex-wrap items-center gap-2 w-full">
            <SelectionChipGroup>
              {simTableFilterDefs.map(({ id, label, tip }) => {
                const count = simTableFilterCounts[id];
                const active = simTableFilter === id;
                return (
                  <SelectionChip
                    key={id}
                    active={active}
                    title={tip || undefined}
                    onClick={() => {
                      setSimTableFilter(id);
                      saveSimTableFilter(id);
                      onFocusConsumed?.();
                    }}
                    className="tabular-nums"
                  >
                    {label}
                    <span className={`ml-1 ${active ? "opacity-90" : "opacity-60"}`}>
                      ({count})
                    </span>
                  </SelectionChip>
                );
              })}
            </SelectionChipGroup>
            <div className="ml-auto flex flex-wrap items-center gap-2 shrink-0">
              <div
                className="flex flex-col gap-1 rounded-lg border border-[rgb(var(--border))]/45 bg-surface/50 px-2 py-1"
                title={
                  lang === "it"
                    ? "Capitale totale portfolio per stimare € e % synth (Weight Sim Exp · stesso pot di Capital & Diversification)."
                    : "Total portfolio capital to estimate synth € and % (Weight Sim Exp · same pot as Capital & Diversification)."
                }
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-ink-muted/75 whitespace-nowrap">
                    {lang === "it" ? "Cap. totale" : "Total cap."}
                  </span>
                  <CapitalNumberInput
                    className="input w-[5.5rem] py-0.5 text-xs tabular-nums text-center"
                    value={topCapital}
                    onCommit={(n) => {
                      isTopCapitalUserSetRef.current = true;
                      setTopCapital(Math.max(0, n));
                    }}
                  />
                  <span className="text-[10px] text-ink-muted/80">€</span>
                </div>
              </div>
              {synthCapitalSync.portfolioDriftCount > 0 ? (
                <button
                  type="button"
                  className="rounded-lg border border-teal-500/45 bg-teal-500/12 px-2.5 py-1 text-[11px] font-semibold text-teal-800 dark:text-teal-200 hover:bg-teal-500/20 transition tabular-nums"
                  title={
                    lang === "it"
                      ? `Allinea il capitale di ${synthCapitalSync.portfolioDriftCount} posizioni al synth (max 25%/deal · no upsize in perdita)`
                      : `Align capital on ${synthCapitalSync.portfolioDriftCount} positions to synth (max 25%/deal · no upsize when underwater)`
                  }
                  onClick={() => {
                    const n = synthCapitalSync.syncAllPortfolioToSynth();
                    if (n === 0) {
                      window.alert(
                        lang === "it"
                          ? "Nessuna posizione da allineare — capitale già uguale al synth."
                          : "Nothing to sync — capital already matches synth.",
                      );
                    }
                  }}
                >
                  {lang === "it"
                    ? `Sync → Synth (${synthCapitalSync.portfolioDriftCount})`
                    : `Sync → Synth (${synthCapitalSync.portfolioDriftCount})`}
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-lg border border-[rgb(var(--border))]/55 bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-[rgb(var(--surface-2))]/80 transition tabular-nums"
                title={t("sim.audit.export.title")}
                onClick={downloadGainAudit}
              >
                {t("sim.audit.export.label")}
              </button>
              <button
                type="button"
                className="rounded-lg border border-[rgb(var(--accent))]/35 bg-[rgb(var(--accent))]/10 px-2.5 py-1 text-[11px] font-semibold text-[rgb(var(--accent))] hover:bg-[rgb(var(--accent))]/18 transition"
                title={
                  lang === "it"
                    ? "Apri breakdown punteggio 0–100 (Conf, R², Timing, Align, Pred)"
                    : "Open 0–100 score breakdown (Conf, R², Timing, Align, Pred)"
                }
                onClick={() => {
                  setScoreFocusTicker(null);
                  setScoreDrawerOpen(true);
                }}
              >
                {lang === "it" ? "Analisi score" : "Score analysis"}
              </button>
            </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {!isDecisionLabEmbed ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-ink-muted/70 shrink-0">
                  {lang === "it" ? "Vista" : "View"}
                </span>
                <SelectionChipGroup>
                  <SelectionChip
                    active={simTableLayout === "full"}
                    title={
                      lang === "it"
                        ? "Buy €, Capitale €, ROI target, score — simulazione investimento"
                        : "Buy €, Capital €, target ROI, score — full investment simulation"
                    }
                    onClick={() => {
                      setSimTableLayout("full");
                      saveSimTableLayout("full");
                    }}
                  >
                    {t("sim.workspace.table.layoutFull")}
                  </SelectionChip>
                  <SelectionChip
                    active={simTableLayout === "variations"}
                    title={
                      lang === "it"
                        ? "Curva $, reale, Δ vs curva, variazioni 1g/7g/1M"
                        : "Curve $, real price, Δ vs curve, 1d/7d/1M variations"
                    }
                    onClick={() => {
                      setSimTableLayout("variations");
                      saveSimTableLayout("variations");
                    }}
                  >
                    {t("sim.workspace.table.layoutVariations")}
                  </SelectionChip>
                </SelectionChipGroup>
              </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-ink-muted/70 shrink-0">
                {t("sim.workspace.sort.label")}
              </span>
              <SelectionChipGroup>
                <SelectionChip
                  active={simTableSort === "roiDesc"}
                  title={t("sim.workspace.sort.roiDescTip")}
                  onClick={() => {
                    const next = toggleRoiDescSort(simTableSort);
                    setSimTableSort(next);
                    saveSimTableSort(next);
                  }}
                  className="text-[10px] tabular-nums"
                >
                  {t("sim.workspace.sort.roiDesc")}
                </SelectionChip>
              </SelectionChipGroup>
              </div>
            </div>
          </div>
          <div
            className={`sim-workspace-table-scroll w-full ${
              isDecisionLabEmbed
                ? "overflow-x-hidden overflow-y-visible"
                : "overflow-x-auto"
            } overscroll-contain`}
            ref={tableBodyRef}
          >
        {effectiveTableLayout === "variations" ? (
          <p className="shrink-0 px-2 py-1 text-[10px] text-ink-muted/85 bg-surface/80 border-b border-[rgb(var(--border))]/20 leading-snug">
            {t("sim.workspace.table.variationsLegend")}
          </p>
        ) : null}
        <table
          className={`${SHEET_GRID_TABLE_CLASS} sim-workspace-table text-[11px] w-full min-w-full`}
          data-layout={
            effectiveTableLayout === "variations"
              ? "variations"
              : effectiveTableLayout === "decisionLab"
                ? "decisionLab"
                : "full"
          }
        >
          <SheetGridColgroup
            columnCount={
              effectiveTableLayout === "variations"
                ? 14
                : effectiveTableLayout === "decisionLab"
                  ? DECISION_LAB_GRID_COL_PCT.length
                  : SIM_WORKSPACE_FULL_GRID_COL_PCT.length
            }
            widths={
              effectiveTableLayout === "decisionLab"
                ? DECISION_LAB_GRID_COL_PCT
                : effectiveTableLayout === "full"
                  ? SIM_WORKSPACE_FULL_GRID_COL_PCT
                  : undefined
            }
          />
          <thead className="text-left">
            <tr>
              {(effectiveTableLayout === "decisionLab"
                ? [
                    { k: "sel", label: "", tip: undefined as string | undefined },
                    { k: "ticker", label: "Ticker", tip: undefined },
                    {
                      k: "risk",
                      label: "Risk & Benefit",
                      tip:
                        lang === "it"
                          ? "Bilancia rischio vs beneficio. Teschio (sx): rischio investimento 0-100 — più nero = più critico. Cuore (dx): crescita prezzo % per giorno verso il target — più rosso = ritorno atteso più rapido. Sotto: capitale suggerito su budget 50k. Clicca per il dettaglio per-bucket Phase A/B."
                          : "Risk vs benefit balance. Skull (left): investment-risk 0-100 — blacker = more critical. Heart (right): expected % growth per day toward target — redder = faster expected return. Below: suggested capital on a 50k budget. Click for the per-bucket Phase A/B breakdown.",
                    },
                    {
                      k: "cd",
                      label: "CD",
                      tip:
                        lang === "it"
                          ? "Completion Date — data catalizzatore"
                          : "Completion Date — catalyst date",
                    },
                    { k: "px", label: "Price $", tip: undefined },
                    {
                      k: "target",
                      label: t("sim.col.gainVsLoss"),
                      tip: t("sim.col.gainVsLossTip"),
                    },
                    {
                      k: "var_spark",
                      label: t("sim.workspace.table.varSpark"),
                      tip: t("sim.workspace.table.varSparkTip"),
                    },
                    {
                      k: "last_read",
                      label: lang === "it" ? "Var. 24h" : "24h Var.",
                      tip: lang === "it"
                        ? "Variazione % nelle ultime 24h e timestamp ultimo aggiornamento"
                        : "24h price variation % and last update timestamp",
                    },
                    { k: "buy", label: "Buy €", tip: undefined },
                    { k: "cap", label: "Capital €", tip: undefined },
                    {
                      k: "synth_cap",
                      label: lang === "it" ? "Synth €" : "Synth €",
                      tip:
                        lang === "it"
                          ? "Capitale suggerito dal sintetizzatore (Weight Sim Exp) sul pot totale — tra parentesi la quota % del deal."
                          : "Suggested capital from the synthesizer (Weight Sim Exp) on the total pot — share % in parentheses.",
                    },
                    {
                      k: "score",
                      label: lang === "it" ? "Affidabilità" : "Reliability",
                      tip:
                        lang === "it"
                          ? "Affidabilità predizione 0–100 per questo ticker (Conf + R² + coerenza + prezzo oggi). Colori: verde=alta/buona, ambra=moderata."
                          : "Prediction reliability 0–100 for this ticker (Conf + R² + coherence + price today). Colors: green=high/good, amber=moderate.",
                    },
                    { k: "actions", label: "", tip: undefined },
                  ]
                : effectiveTableLayout === "variations"
                ? [
                    { k: "sel", label: "", tip: undefined as string | undefined },
                    { k: "ticker", label: "Ticker", tip: undefined },
                    {
                      k: "cd",
                      label: "CD",
                      tip:
                        lang === "it"
                          ? "Completion Date — data catalizzatore"
                          : "Completion Date — catalyst date",
                    },
                    {
                      k: "trajectory",
                      label: t("sim.workspace.table.trajectory"),
                      tip: t("sim.workspace.table.trajectoryTip"),
                    },
                    {
                      k: "model_today",
                      label: t("sim.workspace.table.modelToday"),
                      tip: t("sim.workspace.table.modelTodayTip"),
                    },
                    {
                      k: "real_today",
                      label: t("sim.workspace.table.realToday"),
                      tip: t("sim.workspace.table.realTodayTip"),
                    },
                    {
                      k: "gap_vs_curve",
                      label: t("sim.workspace.table.gapVsCurve"),
                      tip: t("sim.workspace.table.gapVsCurveTip"),
                    },
                    {
                      k: "d1",
                      label: t("sim.workspace.table.var1d"),
                      tip:
                        lang === "it"
                          ? "Variazione % vs chiusura di ieri"
                          : "Price change % vs previous close",
                    },
                    {
                      k: "d7",
                      label: t("sim.workspace.table.var7d"),
                      tip:
                        lang === "it"
                          ? "Variazione % vs 7 giorni fa (storico prezzo)"
                          : "Price change % vs 7 days ago (historical price)",
                    },
                    {
                      k: "m1",
                      label: t("sim.workspace.table.var1m"),
                      tip:
                        lang === "it"
                          ? "Variazione % vs 1 mese fa"
                          : "Price change % vs 1 month ago",
                    },
                    {
                      k: "roi_cd",
                      label: t("sim.workspace.table.roiCd"),
                      tip: t("sim.col.expectedRoiTip"),
                    },
                    {
                      k: "slope_delta",
                      label: t("signals.slope.col.slopeDelta.label"),
                      tip: t("signals.slope.col.slopeDelta.body"),
                    },
                    { k: "actions", label: "", tip: undefined },
                  ]
                : [
                { k: "sel",      label: "",          tip: undefined as string | undefined },
                { k: "ticker",   label: "Ticker",    tip: undefined },
                {
                  k: "cd",
                  label: "CD",
                  tip:
                    lang === "it"
                      ? "Completion Date — data catalizzatore"
                      : "Completion Date — catalyst date",
                },
                { k: "px",       label: "Price $",   tip: undefined },
                {
                  k: "target",
                  label: t("sim.col.gainVsLoss"),
                  tip: t("sim.col.gainVsLossTip"),
                },
                {
                  k: "target_roi",
                  label: t("sim.col.targetRoi"),
                  tip: `${t("sim.col.targetRoiTip")}${lang === "it" ? " · Clic per ROI più alte in cima" : " · Click for highest ROI first"}`,
                  sortable: "roi" as const,
                },
                { k: "buy",      label: "Buy €",     tip: undefined },
                { k: "cap",      label: "Capital €", tip: undefined },
                {
                  k: "synth_cap",
                  label: lang === "it" ? "Synth €" : "Synth €",
                  tip:
                    lang === "it"
                      ? "Capitale suggerito dal sintetizzatore (Weight Sim Exp) sul pot totale — tra parentesi la quota % del deal."
                      : "Suggested capital from the synthesizer (Weight Sim Exp) on the total pot — share % in parentheses.",
                },
                {
                  k: "score",
                  label: lang === "it" ? "Affidabilità" : "Reliability",
                  tip:
                    lang === "it"
                      ? "Affidabilità predizione 0–100 (Conf + R² + coerenza + prezzo oggi)."
                      : "Prediction reliability 0–100 (Conf + R² + coherence + price today).",
                },
                { k: "actions",  label: "",           tip: undefined },
              ]).map((h) => (
                <th
                  key={h.k}
                  data-col={h.k}
                  className={`${
                    sheetGridThClass(h.k as SheetGridColKey)
                  } py-1.5 font-medium border-b border-[rgb(var(--border))]/50 align-bottom ${
                    "sortable" in h && h.sortable
                      ? "cursor-pointer select-none hover:text-[rgb(var(--accent))] transition"
                      : ""
                  } ${
                    h.k === "target_roi" && simTableSort === "roiDesc"
                      ? "text-[rgb(var(--accent))]"
                      : ""
                  }`}
                  title={h.tip}
                  onClick={
                    "sortable" in h && h.sortable === "roi"
                      ? () => {
                          const next = toggleRoiDescSort(simTableSort);
                          setSimTableSort(next);
                          saveSimTableSort(next);
                        }
                      : undefined
                  }
                >
                  {h.k === "slope_delta" ? (
                    <SimTableSlopeColumnHeader
                      lang={lang === "it" ? "it" : "en"}
                      compact={effectiveTableLayout === "variations"}
                      showGap={effectiveTableLayout !== "variations"}
                    />
                  ) : (
                    h.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredTablePositions.map((p) => {
              const inp = inputs[p.key] ?? { buyPrice: 0, capital: 0 };
              const simRow = simRowByKey.get(p.key);
              const selected = selectedKey === p.key;
              const inPortfolio = simRow
                ? rowHasActivePortfolio(simRow, inputs)
                : p.capital > 0 && !inp.ignoreSheet;
              // Re-buy allowed after Sell (ignoreSheet); buyRowSimulation clears ignoreSheet.
              const buyGate = simBuyGateByKey.get(p.key);
              const canBuy =
                !inPortfolio && (p.currPrice ?? 0) > 0 && (buyGate?.allowed ?? false);
              const buyBlockReason = buyGate?.reason ?? null;
              const planCap = inp.capital > 0 ? inp.capital : DEFAULT_SIM_BUY_CAPITAL_EUR;
              const chartPts = simRow
                ? pointsBySeriesKey.get(simulationRowSeriesKey(simRow) ?? "") ?? null
                : null;
              const gainPlan = simRow
                ? resolveExpectedGainPlan(simRow, planCap, { chartPoints: chartPts })
                : null;
              const localEntry = Boolean(
                inputs[p.key] &&
                  (inputs[p.key]!.ignoreSheet ||
                    inputs[p.key]!.buyPrice > 0 ||
                    inputs[p.key]!.capital > 0)
              );
              const signalMetrics = simRow && simTable?.columns?.length
                ? signalMetricsFromSimRow(simRow, simTable.columns, {
                    chartPoints: chartPts,
                    signCurveView,
                  })
                : null;
              const isFocused =
                !!focusTicker?.ticker &&
                focusTicker.ticker.toUpperCase() === p.ticker.toUpperCase() &&
                (!focusTicker?.cd ||
                  normalizedRowKey(p.ticker, focusTicker.cd) === p.key);
              const focusStyle: React.CSSProperties | undefined = isFocused
                ? focusTicker?.action === "buy"
                  ? { backgroundColor: "rgba(34,197,94,0.15)", borderLeft: "4px solid rgba(34,197,94,0.8)" }
                  : { backgroundColor: "rgba(239,68,68,0.15)", borderLeft: "4px solid rgba(239,68,68,0.8)" }
                : undefined;
              const simRowForTone = simRowByKey.get(p.key);
              const curvesForTone = simRowForTone ? extractCurveInputs(simRowForTone) : null;
              const rowForChart = simRowForTone ?? {};
              const seriesKeyForRow = simulationRowSeriesKey(rowForChart);
              const chartPtsForRow = seriesKeyForRow
                ? pointsBySeriesKey.get(seriesKeyForRow) ?? null
                : null;
              const pnlAligned =
                inPortfolio && simRow
                  ? positionPnlForOpenRow(simRow, inputs, history)
                  : null;
              const rowOutlook: PortfolioTableOutlook = resolvePnlRowOutlook({
                inPortfolio,
                pnlUnavailable: p.pnlUnavailable,
                pnlEur: pnlAligned?.pnlEur ?? (inPortfolio ? p.pnlEur : null),
                pnlPct: pnlAligned?.pnlPct ?? (inPortfolio ? p.pnlPct : null),
              });
              const rowStyle: React.CSSProperties | undefined = focusStyle;
              const portfolioRowCls =
                !isFocused && TABLE_COLORS_ENABLED
                  ? portfolioTableOutlookClass(rowOutlook)
                  : "";
              // Verdetto d'uscita unificato (stesso motore della ex tab
              // "Open positions → when to exit"): mostrato accanto a Sell.
              const exitV = inPortfolio
                ? exitVerdict(
                    curvesForTone?.slope20d ?? null,
                    pnlAligned?.pnlPct ?? p.pnlPct ?? null,
                    buildExitVerdictContext(simRowForTone, p.capital),
                  )
                : null;
              const exitTone = exitV ? verdictTone(exitV.verdict) : null;
              const planReturnTone =
                gainPlan?.targetReturnPct ?? planReturnByKey.get(p.key) ?? null;
              const entryBuyPrice =
                inp.buyPrice > 0
                  ? inp.buyPrice
                  : p.buyPrice > 0
                    ? p.buyPrice
                    : p.currPrice ?? 0;

              const targetStop =
                simRow && simTable?.columns?.length
                  ? sparklineTargetStopFromSimRow(simRow, simTable.columns)
                  : null;
              const priceVar = resolvePriceVariationHorizons(
                simRow,
                chartPtsForRow,
                seriesKeyForRow ? chartBundle?.series?.[seriesKeyForRow] : null,
              );
              const todayPrices =
                effectiveTableLayout === "variations"
                  ? resolveTodayExpectedVsRealUsd(simRow, chartPtsForRow)
                  : null;
              const slopeFeedRow = slopeFeedByTicker.get(p.ticker.toUpperCase()) ?? null;
              const slopeDisplay =
                effectiveTableLayout === "variations" && simRow
                  ? resolveSimRowSlopeDisplay(
                      simRow,
                      slopeFeedRow,
                      lang === "it" ? "it" : "en",
                    )
                  : null;
              const slopeRowHighlight =
                effectiveTableLayout === "variations" &&
                !isFocused &&
                slopeDisplay?.hasSlopeFeedEvent
                  ? "ring-1 ring-inset ring-[rgb(var(--warn))]/45"
                  : "";
              const snTargetRoi =
                effectiveTableLayout === "decisionLab"
                  ? resolveSupernovaTargetRoi(p.ticker, simRow, chartPtsForRow)
                  : null;
              const entryPct =
                inPortfolio && !p.pnlUnavailable
                  ? (pnlAligned?.pnlPct ?? p.pnlPct ?? null)
                  : null;
              const synthShare = resolveSimTableSynthShare(synthAlloc, p.key, inPortfolio);
              return (
                <tr
                  key={p.key}
                  data-ticker={p.ticker}
                  data-row-key={p.key}
                  data-pnl-outlook={rowOutlook !== "flat" ? rowOutlook : undefined}
                  style={rowStyle}
                  className={`border-t border-[rgb(var(--border))]/40 cursor-pointer ${
                    portfolioRowCls || "hover:bg-surface/80"
                  } ${slopeRowHighlight} ${
                    !isFocused && selected
                      ? portfolioRowCls
                        ? "ring-1 ring-inset ring-[rgb(var(--accent))]/35"
                        : "bg-surface/80"
                      : ""
                  }`}
                  onClick={() => setSelectedKey(p.key)}
                >
                  <td className={sheetGridTdClass("sel")} data-col="sel">
                    <input
                      type="radio"
                      name="sim_row"
                      checked={selected}
                      className="cursor-pointer"
                      onChange={() => setSelectedKey(p.key)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className={sheetGridTdClass("ticker")} data-col="ticker">
                    <button
                      type="button"
                      className="group text-left bg-transparent border-0 p-0 cursor-pointer max-w-full w-full"
                      title={
                        isDecisionLabEmbed && onOpenSimulationRow
                          ? t("sim.workspace.tickerSimulationTip")
                          : t("sim.workspace.tickerDecisionLabTip")
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isDecisionLabEmbed && onOpenSimulationRow) {
                          openSimulationRowFor(p);
                        } else {
                          openDecisionLabBlockFor(p);
                        }
                      }}
                    >
                      <span className="inline-flex items-center gap-1 max-w-full">
                        <PortfolioTickerMark
                          ticker={p.ticker}
                          inPortfolio={inPortfolio}
                          pnlPct={pnlAligned?.pnlPct ?? null}
                          pnlEur={pnlAligned?.pnlEur ?? null}
                          slope5d={curvesForTone?.slope5d ?? null}
                          slope20d={curvesForTone?.slope20d ?? null}
                          pnlUnavailable={p.pnlUnavailable}
                          tableOutlook={inPortfolio ? rowOutlook : null}
                          className={
                            isDecisionLabEmbed && onOpenSimulationRow
                              ? "font-semibold text-[rgb(var(--accent))] group-hover:underline"
                              : inPortfolio
                                ? "group-hover:underline"
                                : "font-semibold text-[rgb(var(--accent))] group-hover:underline"
                          }
                        />
                      </span>
                    </button>
                  </td>
                  {effectiveTableLayout === "decisionLab" ? (
                    <td
                      className={sheetGridTdClass("risk")}
                      data-col="risk"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        const entry =
                          lookupLossRisk(lossRiskCatalog, p.ticker) ?? ({
                            ticker: p.ticker,
                            phaseLabel: "",
                            riskScore: null,
                            lossRisk: null,
                          } satisfies LossRiskEntry);
                        const dailyChangePct = simRow
                          ? dailyChangePctFromRow(simRow)
                          : null;
                        const benefitDays =
                          snTargetRoi?.daysToTarget ??
                          gainPlan?.daysToTarget ??
                          gainPlan?.daysToCd ??
                          null;
                        const expectedReturnPct =
                          gainPlan?.expectedReturnPct ?? null;
                        const benefitFillPct = deriveBenefitFillPct({
                          expectedReturnPct,
                          daysToTarget: benefitDays,
                          dailyChangePct,
                        });
                        const perDayPct =
                          expectedReturnPct != null &&
                          Number.isFinite(expectedReturnPct) &&
                          benefitDays != null &&
                          benefitDays > 0
                            ? expectedReturnPct / benefitDays
                            : dailyChangePct ?? null;
                        return (
                          <RiskBenefitScaleCell
                            entry={entry}
                            benefitFillPct={benefitFillPct}
                            perDayPct={perDayPct}
                            onClick={() => setRiskModalEntry(entry)}
                            it={lang === "it"}
                          />
                        );
                      })()}
                    </td>
                  ) : null}
                  {(() => {
                    const cdRaw = simRow?.["Completion Date"] ?? p.completionDate;
                    const cdRow = simRow ?? { "Completion Date": cdRaw };
                    const cdLabel = fmtSimulationCell("Completion Date", cdRaw);
                    const cdExtras = simulationCellStyle(
                      "Completion Date",
                      cdRaw,
                      cdRow,
                      buildSimulationStyleContext([]),
                    );
                    return (
                      <td className={sheetGridTdClass("cd")} data-col="cd">
                        <span
                          className="text-[11px] whitespace-nowrap"
                          style={cdExtras?.style}
                          title={cdLabel !== "—" ? cdLabel : undefined}
                        >
                          {cdExtras?.icon ? (
                            <span
                              className="mr-0.5"
                              style={{ color: cdExtras.iconColor }}
                              aria-hidden
                            >
                              {cdExtras.icon}
                            </span>
                          ) : null}
                          {cdLabel}
                        </span>
                      </td>
                    );
                  })()}
                  {effectiveTableLayout === "variations" ? (
                    <td
                      className={`${sheetGridTdClass("trajectory")} overflow-hidden`}
                      data-col="trajectory"
                    >
                      <div className="flex justify-center min-w-0 overflow-hidden isolate">
                        <button
                          type="button"
                          className="rounded-md border border-transparent p-0.5 -m-0.5 transition hover:border-accent/35 hover:bg-[rgb(var(--surface-3))]/35 cursor-pointer"
                          title={t("sim.pnl.openCurveDetailTitle", { ticker: p.ticker })}
                          onClick={(e) => {
                            e.stopPropagation();
                            openPredictionChartsFor(p);
                          }}
                        >
                          <SimulationSparkline
                            row={rowForChart}
                            points={chartPtsForRow}
                            width={94}
                            height={30}
                            showCdZones
                            showZoneLabels={false}
                            targetStop={targetStop}
                            portfolio={
                              inPortfolio && !p.pnlUnavailable
                                ? {
                                    pnlPct: p.pnlPct,
                                    buyPriceUsd: p.buyPrice > 0 ? p.buyPrice : null,
                                  }
                                : null
                            }
                          />
                        </button>
                      </div>
                    </td>
                  ) : null}
                  {effectiveTableLayout === "variations" ? (
                    <>
                      <td
                        className={`${sheetGridTdClass("model_today")} overflow-hidden`}
                        data-col="model_today"
                      >
                        {todayPrices ? (
                          <CurveModelPriceCell modelUsd={todayPrices.modelUsd} />
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td
                        className={`${sheetGridTdClass("real_today")} overflow-hidden`}
                        data-col="real_today"
                      >
                        {todayPrices ? (
                          <CurveRealPriceCell realUsd={todayPrices.realUsd} />
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td
                        className={`${sheetGridTdClass("gap_vs_curve")} overflow-hidden`}
                        data-col="gap_vs_curve"
                      >
                        <CurveGapVsModelCell
                          gapPct={todayPrices?.gapPct ?? null}
                          gapUsd={todayPrices?.gapUsd ?? null}
                          hideLabel
                        />
                      </td>
                      <td
                        className={`${sheetGridTdClass("d1")} overflow-hidden`}
                        data-col="d1"
                      >
                        <PriceVariationCell pct={priceVar?.d1 ?? null} />
                      </td>
                      <td
                        className={`${sheetGridTdClass("d7")} overflow-hidden`}
                        data-col="d7"
                      >
                        <PriceVariationCell pct={priceVar?.d7 ?? null} />
                      </td>
                      <td
                        className={`${sheetGridTdClass("m1")} overflow-hidden`}
                        data-col="m1"
                      >
                        <PriceVariationCell pct={priceVar?.m1 ?? null} />
                      </td>
                      <td
                        className={`${sheetGridTdClass("roi_cd")} align-top overflow-hidden`}
                        data-col="roi_cd"
                      >
                        <ExpectedRoiCell
                          lang={lang === "it" ? "it" : "en"}
                          days={gainPlan?.daysToCd ?? null}
                          returnPct={gainPlan?.expectedReturnPct ?? null}
                          capitalEur={planCap}
                          source={gainPlan?.source}
                          variant="table"
                          slope5d={curvesForTone?.slope5d ?? null}
                          slope20d={curvesForTone?.slope20d ?? null}
                        />
                      </td>
                      <td
                        className={`${sheetGridTdClass("slope_delta")} overflow-hidden`}
                        data-col="slope_delta"
                      >
                        <SimTableSlopeCell
                          display={slopeDisplay}
                          compact
                          showGap={false}
                        />
                      </td>
                    </>
                  ) : effectiveTableLayout === "decisionLab" ? (
                    <>
                  <td className={sheetGridTdClass("px")} data-col="px">
                    <div>{fmtUsd(p.currPrice)}</div>
                    {priceSnapshotAt ? (
                      <div className="text-[11px] text-ink-muted/65 font-normal leading-tight">
                        {fmtSnapshotPriceLabel(priceSnapshotAt)}
                      </div>
                    ) : null}
                  </td>
                  <td className={`${sheetGridTdClass("target")} align-middle`} data-col="target">
                    <ModelTargetPriceCell
                      simRow={simRow}
                      columns={simTable?.columns}
                      currPriceUsd={p.currPrice}
                      planReturnPct={planReturnTone}
                      buyPriceUsd={entryBuyPrice > 0 ? entryBuyPrice : null}
                      inPortfolio={inPortfolio}
                      daysToTarget={snTargetRoi?.daysToTarget ?? gainPlan?.daysToTarget ?? null}
                      suggestedAction={inPortfolio && isPlanTargetReached(p.pnlPct, planReturnTone) ? "sell" : null}
                      pnlPct={p.pnlPct}
                      pnlUsd={p.pnlEur}
                      shares={p.shares}
                    />
                  </td>
                  <td
                    className={`${sheetGridTdClass("var_spark")} overflow-hidden`}
                    data-col="var_spark"
                  >
                    <VariationHorizonSparkline
                      d1={priceVar?.d1 ?? null}
                      d7={priceVar?.d7 ?? null}
                      m1={priceVar?.m1 ?? null}
                    />
                  </td>
                  <td className={sheetGridTdClass("last_read")} data-col="last_read">
                    <div className="flex flex-col items-center gap-0.5 text-center leading-tight">
                      {(() => {
                        const dailyPct = simRow ? dailyChangePctFromRow(simRow) : null;
                        return dailyPct != null ? (
                          <>
                            <span
                              className={`text-[11px] font-semibold tabular-nums ${
                                dailyPct > 0
                                  ? "text-[rgb(var(--signal-up))]"
                                  : dailyPct < 0
                                    ? "text-[rgb(var(--signal-down))]"
                                    : "text-ink-muted"
                              }`}
                            >
                              {dailyPct >= 0 ? "+" : ""}
                              {dailyPct.toFixed(2)}%
                            </span>
                            {priceSnapshotAt && (
                              <span className="text-[11px] text-ink-muted/70 whitespace-nowrap">
                                {fmtSnapshotPriceLabel(priceSnapshotAt)}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[11px] text-ink-muted/80 font-normal">
                            {priceSnapshotAt ? fmtSnapshotPriceLabel(priceSnapshotAt) : "—"}
                          </span>
                        );
                      })()}
                    </div>
                  </td>
                  <td className={sheetGridTdClass("buy")} data-col="buy" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      {inPortfolio && entryPct != null && (
                        <span
                          className={`text-[11px] font-bold leading-none ${
                            entryPct > 0
                              ? "text-[rgb(var(--signal-up))]"
                              : "text-[rgb(var(--signal-down))]"
                          }`}
                          title={
                            entryPct > 0
                              ? `+${entryPct.toFixed(2)}%`
                              : `${entryPct.toFixed(2)}%`
                          }
                        >
                          {entryPct > 0 ? "▲" : "▼"}
                        </span>
                      )}
                      <DecimalTextInput
                        className="input w-full py-0.5 text-[11px] tabular-nums"
                        value={inp.buyPrice > 0 ? inp.buyPrice : 0}
                        placeholder={
                          localEntry || inp.ignoreSheet
                            ? undefined
                            : p.buyPrice > 0
                              ? formatDecimalInput(p.buyPrice)
                              : p.currPrice != null
                                ? formatDecimalInput(p.currPrice)
                                : undefined
                        }
                        onCommit={(n) => setInput(p.key, "buyPrice", n)}
                      />
                    </div>
                  </td>
                  <td className={sheetGridTdClass("cap")} data-col="cap" onClick={(e) => e.stopPropagation()}>
                    <SimTableCapitalCell
                      capital={inp.capital}
                      placeholder={
                        localEntry || inp.ignoreSheet
                          ? undefined
                          : p.capital > 0 && inp.capital <= 0
                            ? String(p.capital)
                            : undefined
                      }
                      inputClassName="input w-full py-0.5 text-[11px] tabular-nums"
                      onCommit={(n) => setInput(p.key, "capital", n)}
                    />
                  </td>
                  <td className={sheetGridTdClass("synth_cap")} data-col="synth_cap">
                    {renderSynthCapSuggestion(synthShare, topCapital, lang === "it" ? "it" : "en")}
                  </td>
                  <td className={sheetGridTdClass("score")} data-col="score" onClick={(e) => e.stopPropagation()}>
                    {signalMetrics?.score != null ? (
                      <SignalScoreBar
                        score={signalMetrics.score}
                        stacked
                        showLabel
                        lang={lang === "it" ? "it" : "en"}
                        detailTitle={buildSimScoreTooltip(
                          signalMetrics,
                          lang === "it" ? "it" : "en",
                        )}
                        onClick={() => {
                          setScoreFocusTicker(p.ticker);
                          setScoreDrawerOpen(true);
                        }}
                      />
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                    </>
                  ) : (
                    <>
                  <td className={sheetGridTdClass("px")} data-col="px">
                    <div>{fmtUsd(p.currPrice)}</div>
                    {priceSnapshotAt ? (
                      <div className="text-[11px] text-ink-muted/65 font-normal leading-tight">
                        {fmtSnapshotPriceLabel(priceSnapshotAt)}
                      </div>
                    ) : null}
                  </td>
                  <td className={`${sheetGridTdClass("target")} align-middle`} data-col="target">
                    <ModelTargetPriceCell
                      simRow={simRow}
                      columns={simTable?.columns}
                      currPriceUsd={p.currPrice}
                      planReturnPct={planReturnTone}
                      buyPriceUsd={entryBuyPrice > 0 ? entryBuyPrice : null}
                      inPortfolio={inPortfolio}
                      daysToTarget={snTargetRoi?.daysToTarget ?? gainPlan?.daysToTarget ?? null}
                      suggestedAction={inPortfolio && isPlanTargetReached(p.pnlPct, planReturnTone) ? "sell" : null}
                      pnlPct={p.pnlPct}
                      pnlUsd={p.pnlEur}
                      shares={p.shares}
                    />
                  </td>
                  <td className={`${sheetGridTdClass("target_roi")} align-top`} data-col="target_roi">
                    <TargetRoiCell
                      lang={lang === "it" ? "it" : "en"}
                      daysToTarget={gainPlan?.daysToTarget ?? null}
                      returnPct={gainPlan?.targetReturnPct ?? null}
                      capitalEur={planCap}
                      targetHighPct={gainPlan?.targetHighPct ?? null}
                      variant="table"
                      slope5d={curvesForTone?.slope5d ?? null}
                      slope20d={curvesForTone?.slope20d ?? null}
                    />
                  </td>
                  <td className={sheetGridTdClass("buy")} data-col="buy" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      {inPortfolio && entryPct != null && (
                        <span
                          className={`text-[11px] font-bold leading-none ${
                            entryPct > 0
                              ? "text-[rgb(var(--signal-up))]"
                              : "text-[rgb(var(--signal-down))]"
                          }`}
                          title={
                            entryPct > 0
                              ? `+${entryPct.toFixed(2)}%`
                              : `${entryPct.toFixed(2)}%`
                          }
                        >
                          {entryPct > 0 ? "▲" : "▼"}
                        </span>
                      )}
                      <DecimalTextInput
                        className="input w-full max-w-[7.5rem] py-0.5 text-[11px] tabular-nums"
                        value={inp.buyPrice > 0 ? inp.buyPrice : 0}
                        placeholder={
                          localEntry || inp.ignoreSheet
                            ? undefined
                            : p.buyPrice > 0
                              ? formatDecimalInput(p.buyPrice)
                              : p.currPrice != null
                                ? formatDecimalInput(p.currPrice)
                                : undefined
                        }
                        onCommit={(n) => setInput(p.key, "buyPrice", n)}
                      />
                    </div>
                  </td>
                  <td className={sheetGridTdClass("cap")} data-col="cap" onClick={(e) => e.stopPropagation()}>
                    <SimTableCapitalCell
                      capital={inp.capital}
                      placeholder={
                        localEntry || inp.ignoreSheet
                          ? undefined
                          : p.capital > 0 && inp.capital <= 0
                            ? String(p.capital)
                            : undefined
                      }
                      inputClassName="input w-full max-w-[7.5rem] py-0.5 text-[11px] tabular-nums"
                      wrapperClassName="flex flex-col gap-0.5 min-w-0"
                      onCommit={(n) => setInput(p.key, "capital", n)}
                    />
                  </td>
                  <td className={sheetGridTdClass("synth_cap")} data-col="synth_cap">
                    {renderSynthCapSuggestion(synthShare, topCapital, lang === "it" ? "it" : "en")}
                  </td>
                  <td className={sheetGridTdClass("score")} data-col="score" onClick={(e) => e.stopPropagation()}>
                    {signalMetrics?.score != null ? (
                      <SignalScoreBar
                        score={signalMetrics.score}
                        stacked
                        showLabel
                        lang={lang === "it" ? "it" : "en"}
                        detailTitle={buildSimScoreTooltip(
                          signalMetrics,
                          lang === "it" ? "it" : "en",
                        )}
                        onClick={() => {
                          setScoreFocusTicker(p.ticker);
                          setScoreDrawerOpen(true);
                        }}
                      />
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                    </>
                  )}
                  <td
                    className={`${sheetGridTdClass("actions")} whitespace-nowrap`}
                    data-col="actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canBuy ? (
                      <button
                        type="button"
                        className="btn-ghost text-[11px] px-1 text-positive font-semibold"
                        title={`Open position · €${DEFAULT_SIM_BUY_CAPITAL_EUR} at current price`}
                        onClick={() => buyRowSimulation(p.key)}
                      >
                        Buy
                      </button>
                    ) : !inPortfolio && (p.currPrice ?? 0) > 0 && buyBlockReason ? (
                      <button
                        type="button"
                        disabled
                        className="btn-ghost text-[11px] px-1 text-ink-muted opacity-60 cursor-not-allowed"
                        title={buyBlockReason}
                      >
                        Buy
                      </button>
                    ) : null}
                    {inPortfolio && exitTone && exitV && exitV.verdict !== "n/d" && (
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${exitTone.color} ${exitTone.bg}`}
                        title={exitV.reason}
                      >
                        {exitTone.label}
                      </span>
                    )}
                    {inPortfolio && (
                      <button
                        type="button"
                        className="btn-ghost text-[11px] px-1 text-positive"
                        title={
                          p.currPrice != null
                            ? `Sell ${p.ticker} at $${p.currPrice.toFixed(2)}`
                            : "Sell position at current price"
                        }
                        onClick={() => sellRowSimulation(p.key)}
                      >
                        Sell
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!simLoading && filteredTablePositions.length === 0 && (
          <p className="p-6 text-center text-sm text-ink-muted">
            {workspaceTableEmptyMessage}
          </p>
        )}
          </div>
        </div>
      </div>

      <ScoreAnalysisDrawer
        open={scoreDrawerOpen}
        onClose={() => {
          setScoreDrawerOpen(false);
          setScoreFocusTicker(null);
        }}
        signals={scoreDetailSignals}
        focusTicker={scoreFocusTicker}
        onFocusConsumed={() => setScoreFocusTicker(null)}
        signCurveView={signCurveView}
      />
      {solidityModalKey && entrySolidityDetailByKey.has(solidityModalKey) ? (
        <EntrySolidityModal
          open
          onClose={() => setSolidityModalKey(null)}
          ticker={entrySolidityDetailByKey.get(solidityModalKey)!.ticker}
          cd={entrySolidityDetailByKey.get(solidityModalKey)!.cd}
          daysToCd={entrySolidityDetailByKey.get(solidityModalKey)!.daysToCd}
          pick={entrySolidityDetailByKey.get(solidityModalKey)!.pick}
          result={entrySolidityDetailByKey.get(solidityModalKey)!.result}
          breakdown={entrySolidityDetailByKey.get(solidityModalKey)!.breakdown}
        />
      ) : null}

      <LossRiskBreakdownModal
        entry={riskModalEntry}
        onClose={() => setRiskModalEntry(null)}
        it={lang === "it"}
      />
    </section>
  );
}

function PaneHeader({
  title,
  subtitle,
  extra,
  trailing,
}: {
  title: string;
  subtitle: string;
  extra?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="shrink-0 bg-surface/40 border-b border-[rgb(var(--border))]/30">
      <div className="flex items-center gap-2 px-4 py-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium leading-tight">{title}</p>
          <p className="text-[10px] text-ink-muted truncate">{subtitle}</p>
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>
      {extra ? <div className="px-4 pb-1.5">{extra}</div> : null}
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "positive" | "negative";
}) {
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 px-3 py-2 bg-surface/50">
      <p className="text-[10px] text-ink-muted">{label}</p>
      <p
        className={`font-semibold tabular-nums ${
          accent === "positive"
            ? "text-positive"
            : accent === "negative"
              ? "text-negative"
              : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "positive" | "negative";
}) {
  return <Metric label={label} value={value} accent={accent} />;
}

function fmtUsd(v: number | null): string {
  if (v == null) return "—";
  return `$ ${v.toFixed(2)}`;
}

function renderSynthCapSuggestion(
  share: number | null,
  totalCapitalEur: number,
  lang: "it" | "en",
): React.ReactNode {
  if (share == null || totalCapitalEur <= 0) {
    return <span className="text-ink-muted text-[11px]">—</span>;
  }
  const eur = share * totalCapitalEur;
  const pct = share * 100;
  const locale = lang === "it" ? "it-IT" : "en-US";
  const eurLabel = `${Math.round(eur).toLocaleString(locale)} €`;
  return (
    <div
      className="flex flex-col items-center leading-tight tabular-nums"
      title={
        lang === "it"
          ? `Synth operativo (max 25%/deal): ${eurLabel} (${pct.toFixed(1)}% del pot). Su posizioni in perdita non suggerisce aumento capitale — solo riduzione verso il target.`
          : `Actionable synth (max 25%/deal): ${eurLabel} (${pct.toFixed(1)}% of pot). Underwater positions are never upsized — only reduced toward target.`
      }
    >
      <span className="text-[11px] font-semibold">{eurLabel}</span>
      <span className="text-[11px] text-ink-muted/75">({pct.toFixed(1)}%)</span>
    </div>
  );
}

// ── Top Status: allineato alle tier pubblicate da Decision Lab ──────────────

type TopStatusKind =
  | "top"
  | "watch"
  | "top2_buy"
  | "low_aff"
  | "low_pred"
  | "neg_pred"
  | "missing"
  | "inactive";

function evaluateTopStatus(
  simRow: Record<string, unknown> | undefined,
  hasPosition: boolean,
  planReturnPct?: number | null,
  seriesKey?: string | null,
  topOpps?: TopOppsSnapshot,
): { kind: TopStatusKind; affPct: number | null; pred5Pp: number | null; reasons: string[] } {
  if (!hasPosition) {
    if (seriesKey && topOpps) {
      const tier = recommendationTierForKey(seriesKey, false, topOpps);
      if (tier === "top2_buy") {
        return {
          kind: "top2_buy",
          affPct: null,
          pred5Pp: null,
          reasons: ["Top 2 BUY — published by Decision Lab (best ROI/day, hot zone)"],
        };
      }
      if (tier === "hot_top") {
        return {
          kind: "top",
          affPct: null,
          pred5Pp: null,
          reasons: ["Hot zone Top Opportunity — published by Decision Lab"],
        };
      }
      if (tier === "watch_top") {
        return {
          kind: "watch",
          affPct: null,
          pred5Pp: null,
          reasons: ["Watch zone Early opportunity — published by Decision Lab"],
        };
      }
    }
    return { kind: "inactive", affPct: null, pred5Pp: null, reasons: ["No capital: position inactive"] };
  }
  if (!simRow) {
    return { kind: "missing", affPct: null, pred5Pp: null, reasons: ["Sim data not available"] };
  }

  const findCol = (...parts: string[]): string | null => {
    for (const k of Object.keys(simRow)) {
      const flat = k.replace(/\n/g, " ");
      if (parts.every((p) => flat.toLowerCase().includes(p.toLowerCase()))) return k;
    }
    return null;
  };
  const numv = (v: unknown): number | null => {
    if (v == null || v === "" || v === "—") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ".").replace(/%/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const toPp = (v: number | null, raw: unknown): number | null => {
    if (v == null) return null;
    const hasPct = typeof raw === "string" && raw.includes("%");
    return Math.abs(v) <= 1.5 && !hasPct ? v * 100 : v;
  };

  const cAff    = findCol("Affidabilit", "calib") ?? findCol("Affidabilit") ?? "";
  const cPred4  = findCol("Pred", "+4") ?? "";
  const cPred7  = findCol("Pred", "+7") ?? "";

  let aff = numv(simRow[cAff]);
  if (aff != null && aff <= 1.5) aff *= 100;
  const pred4 = toPp(numv(simRow[cPred4]), simRow[cPred4]);
  const pred7 = toPp(numv(simRow[cPred7]), simRow[cPred7]);
  let pred5: number | null;
  if (pred4 != null && pred7 != null) pred5 = pred4 + (pred7 - pred4) * (1 / 3);
  else if (pred7 != null) pred5 = pred7;
  else if (pred4 != null) pred5 = pred4;
  else pred5 = null;

  const affMin = loadTopOppMinAffidPct();
  const PRED_MIN_DEFAULT_PP = 0.5;

  const reasons: string[] = [];
  if (aff == null) reasons.push("Reliability missing");
  else if (aff < affMin) reasons.push(`Reliability ${aff.toFixed(0)}% < ${affMin}% (Decision Lab threshold)`);

  if (pred5 == null) reasons.push("Pred +5 missing");
  else if (pred5 <= 0) reasons.push(`Pred +5 ${pred5.toFixed(2)}pp (negative direction)`);
  else if (pred5 < PRED_MIN_DEFAULT_PP) reasons.push(`Pred +5 ${pred5.toFixed(2)}pp < ${PRED_MIN_DEFAULT_PP}pp (UI threshold)`);

  if (planReturnPct != null && planReturnPct <= 0) {
    reasons.push(
      `ROI target ${planReturnPct.toFixed(1)}% (no rise segment / slope turn-down)`,
    );
  }

  let kind: TopStatusKind;
  if (reasons.length === 0) kind = "top";
  else if (planReturnPct != null && planReturnPct <= 0) kind = "neg_pred";
  else if (pred5 != null && pred5 <= 0) kind = "neg_pred";
  else if (aff != null && aff < affMin) kind = "low_aff";
  else kind = "low_pred";

  return { kind, affPct: aff, pred5Pp: pred5, reasons };
}

