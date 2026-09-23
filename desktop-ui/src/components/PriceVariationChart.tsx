import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchIntraday1h, type VolumeHistoryBar } from "../api/supernova";
import { fetchOhlcvHistory } from "../sheet/ohlcvHistoryStore";
import { useLang, useT } from "../shared/i18n";
import type { IntradayPricePoint } from "../sheet/simUniverse24hWhatIf";
import {
  CATALYST_BADGE_GAP_PX,
  CATALYST_TYPE_LABELS,
  assignOverlapLanesByX,
  catalystBadgeBox,
  catalystLaneTopPad,
} from "../sheet/catalystChartLanes";
import {
  formatPriceVariationPct,
  formatSignedPriceVariationUsd,
  priceVariationTone,
} from "../sheet/priceVariationHorizons";
import {
  buildDailyPriceLineSeries,
  buildIntradayPriceLineSeries,
  detectSixMonthHighBreakout,
  dailyHistoryCoversCutoff,
  latestTickerPrice,
  CD_GOLD,
  cdChartXKey,
  chartFuturePadDays,
  collectTickerChartCdIsos,
  ensureIsoTicksInSeries,
  fmtDailyLabel,
  futureChartPadIsos,
  guidanceEventAnchorIso,
  isCatalystCalendarRange,
  nearestDailyRow,
  resolveCatalystPlotIso,
  PRICE_VAR_CHART_CURSOR,
  PRICE_VAR_CHART_RANGE_ORDER,
  priceLineSeriesDelta,
  rangeToCalendarCutoff,
  rangeToFetchDays,
  rangeToWindowKey,
  priceVarRangeLabel,
  resolveIntradaySessionTradingDate,
  type PriceLinePoint,
  type PriceVarChartRange,
} from "../sheet/priceVariationSeries";
import {
  getDeltaLabel,
  windowDelta,
  type TimeWindowData,
} from "../sheet/priceVariationVsMarket";
import type { MarketContextSnapshotDoc } from "../sheet/marketContextScore";
import { xbiBarsFromSnapshot, xbiSnapshotAvailable } from "../sheet/xbiMarketVariations";
import type { CatalystCyclePrimary, CatalystTickerCycleAlert } from "../api/catalystPatterns";
import { resolveCycleDisplayPrimary } from "../api/catalystPatterns";
import type { DecisionRec } from "../sheet/decisionChartLogic";
import {
  attachCycleMarkersToPriceSeries,
  CHART_OVERLAY_PHASES,
  cycleMarkerHasAny,
  type ChartOverlayPhase,
  type PriceChartCycleRow,
} from "../sheet/priceCycleChartMarkers";
import {
  buyPeakHorizonsTip,
  catalystVolumeCoincidentTip,
  overlayPhaseCompactLabel,
  overlayPhaseTip,
} from "../sheet/cyclePhaseDisplay";
import { cycleTooltip } from "../sheet/catalystCycleState";
import { ChartIsoDateTick } from "./ChartIsoDateTick";
import {
  clampRecIsoToSeries,
  ensureClosedRecEpisodesDrawable,
  ensureOpenRecHasDrawableSpan,
  loadTickerOperationalRecEpisodes,
  mergeRecEpisodes,
  recBoundariesForPoints,
  recFillForPoints,
  sameRecEpisodes,
  syncTickerOperationalRec,
  type OperationalRecEpisode,
} from "../sheet/tickerOperationalRecEpisodes";
import {
  latestBuyStreakStartIso,
  recEpisodesFromHistory,
} from "../sheet/decisionChartRecHistory";

const TICKER_LINE = "#7C6CF3";
const MARKET_LINE = "#5B6580";
const LAST_PRICE_LINE = "#F87185";

import type { ClinicalPreCdRecord, GuidanceCalendarEvent } from "../api/supernova";
import {
  catalystEventStableId,
  cdIsoEventId,
  useDismissedCatalystIds,
} from "../sheet/catalystEventDismiss";
import { findClinicalPreCdRecord } from "../sheet/eisPolyAdjust";
import { CdStudyEisModal } from "./CdStudyEisModal";
import { RegulatoryCatalystDetailModal } from "./RegulatoryCatalystDetailModal";

export type PriceVariationChartProps = {
  ticker: string;
  windows: TimeWindowData[];
  marketLabel?: string;
  marketDoc?: MarketContextSnapshotDoc | null;
  /** Hourly Yahoo curves (batch-loaded by parent). */
  intradayPrior?: IntradayPricePoint[];
  intradayLive?: IntradayPricePoint[];
  /** XBI hourly — batch-loaded once by parent (avoids N duplicate fetches). */
  marketIntradayPrior?: IntradayPricePoint[];
  marketIntradayLive?: IntradayPricePoint[];
  /** Parent batch in flight — child defers its own intraday fetch. */
  intradayBatchLoading?: boolean;
  /** Override last price (e.g. sheet live quote). */
  currentPriceUsd?: number | null;
  embedded?: boolean;
  dense?: boolean;
  narrow?: boolean;
  height?: number;
  /** Controlled range — sync with Volume vs EIS chart. */
  range?: PriceVarChartRange;
  onRangeChange?: (range: PriceVarChartRange) => void;
  /** Hide horizon pills (rendered by parent frame). */
  hideRangeControls?: boolean;
  /** Catalyst cycle alert — enables cycle marker overlay. */
  cycleAlert?: CatalystTickerCycleAlert | null;
  /** Operational rec from Decision Chart / Soft BUY — filled green/red, not cycle diamonds. */
  operationalRec?: DecisionRec | null;
  /** Decision Chart row key — used to backdate Soft BUY fill from rec history. */
  recHistoryKey?: string | null;
  /** Shared with the Volume vs EIS chart — one dashed crosshair across both. */
  syncId?: string;
  /** Guidance calendar events for this ticker — renders tornado markers near catalyst windows. */
  guidanceEvents?: GuidanceCalendarEvent[];
  /** Completion Date (dd/mm/yyyy or ISO) — golden-yellow CD banner on the timeline. */
  completionDate?: string | null;
  /** NCT / clinical CD dates — extra gold CD banners besides Simulation CD. */
  clinicalRecords?: ClinicalPreCdRecord[];
  /**
   * Shared Yahoo daily bars from the parent price+volume frame (one fetch).
   * When set, skips this chart's own ticker OHLCV request.
   */
  sharedOhlcvBars?: import("../api/supernova").VolumeHistoryBar[] | null;
  sharedOhlcvLoading?: boolean;
  /** Simulation row — Product column for CD study modal / patents. */
  simRow?: Record<string, unknown> | null;
};

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1000) return `$${v.toFixed(0)}`;
  if (v >= 100) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}

function fmtVolumeAxis(v: number): string {
  return fmtUsd(v).replace("$", "");
}

function rangeLabel(range: PriceVarChartRange, it: boolean): string {
  return priceVarRangeLabel(range, it);
}

/**
 * CONTRATTO VISIVO: questi marker sono descrittivi/geometrici, MAI un'azione consigliata.
 * Non usare fill pieno né i colori verde/rosso riservati a Soft BUY/SELL.
 * Forma = rombo a solo stroke ambra/oro (non cerchio/pillola piena).
 * Vedi handoff "Cycle overlay" + schema "Due Livelli, Due Segni".
 * (Già successo: exhaustion_exit era "Sell", poi "Buy" sullo stesso calcolo di picco.)
 */
const CYCLE_AMBER_STROKE = "#d97706";
const CYCLE_AMBER_STROKE_STRONG = "#b45309";

const BASE_OVERLAY_STYLE: Record<
  ChartOverlayPhase,
  { stroke: string; glyph: string }
> = {
  pre_volume_watch: { stroke: CYCLE_AMBER_STROKE, glyph: "⚡" },
  dump_entry: { stroke: CYCLE_AMBER_STROKE_STRONG, glyph: "↓" },
  rise: { stroke: CYCLE_AMBER_STROKE, glyph: "↗" },
  exhaustion_exit: { stroke: CYCLE_AMBER_STROKE_STRONG, glyph: "H" },
};

function overlayMarkerStyle(
  phase: ChartOverlayPhase,
  buyPeakTier?: number,
): { stroke: string; glyph: string } {
  if (phase === "exhaustion_exit" && buyPeakTier != null && buyPeakTier >= 1) {
    return { stroke: CYCLE_AMBER_STROKE_STRONG, glyph: `${buyPeakTier}H` };
  }
  return BASE_OVERLAY_STYLE[phase];
}

type CyclePriceDotProps = {
  cx?: number;
  cy?: number;
  payload?: PriceChartCycleRow;
  it: boolean;
  primary: CatalystCyclePrimary | null;
  matches?: CatalystTickerCycleAlert["matches"];
};

function CyclePriceDot({ cx, cy, payload, it, primary, matches }: CyclePriceDotProps) {
  if (cx == null || cy == null || !payload?.cycleMarker) return null;
  const phase = payload.cycleMarker;
  const style = overlayMarkerStyle(phase, payload.buyPeakTier);
  const confirmed = payload.cycleMarkerConfirmed === true;
  const isApiPhase = phase !== "rise";
  const match = isApiPhase ? matches?.find((m) => m.phase === phase) : undefined;
  let tip =
    isApiPhase && primary?.phase === phase
      ? cycleTooltip(primary, it, {
          lift: match?.historical_lift,
          n: match?.historical_n,
        })
      : confirmed && isApiPhase
        ? overlayPhaseTip(phase, it)
        : it
          ? `${overlayPhaseTip(phase, it)} · Riferimento sulla curva visibile.`
          : `${overlayPhaseTip(phase, it)} · Reference on visible curve.`;
  if (payload.buyPeakTier != null && payload.buyPeakHorizons?.length) {
    tip += buyPeakHorizonsTip(payload.buyPeakHorizons, payload.buyPeakTier, it);
  }
  if (payload.catalystOnBuyBar) tip += catalystVolumeCoincidentTip(it);

  const r = confirmed ? 7 : 6;
  // Diamond = square rotated 45° (hollow stroke only — never Soft BUY pill/circle fill).
  const diamond = `0,${-r} ${r},0 0,${r} ${-r},0`;

  return (
    <g transform={`translate(${cx},${cy})`} style={{ pointerEvents: "auto" }}>
      <title>{tip}</title>
      <polygon
        points={diamond}
        fill="none"
        stroke={style.stroke}
        strokeWidth={confirmed ? 2 : 1.5}
        strokeDasharray={confirmed ? undefined : "3 2"}
        strokeLinejoin="round"
      />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={phase === "exhaustion_exit" ? 7 : 8}
        fontWeight="600"
        fill={style.stroke}
        y={0.5}
      >
        {style.glyph}
      </text>
    </g>
  );
}

function MoneyFlagGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0" aria-hidden>
      <g transform="translate(12, 12)">
        <line x1="0" y1="-8" x2="0" y2="8" stroke="rgb(var(--signal-up))" strokeWidth="1.5" />
        <path
          d="M 0,-8 L 8,-6 L 8,-2 L 0,-4 Z"
          fill="rgb(var(--signal-up))"
          stroke="rgb(var(--signal-up))"
          strokeWidth="0.5"
        />
        <text
          x="4"
          y="-3"
          fontSize="6"
          fontWeight="bold"
          fill="white"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          $
        </text>
      </g>
    </svg>
  );
}

const SOFT_BUY_FILL = "#16a34a";
const SOFT_SELL_FILL = "#dc2626";
const REC_BOUNDARY_STROKE = "#ca8a04";

function SixMonthHighFlagDot({ cx, cy, tip }: { cx?: number; cy?: number; tip: string }) {
  if (cx == null || cy == null) return null;
  return (
    <g transform={`translate(${cx},${cy - 14})`} style={{ pointerEvents: "auto" }}>
      <title>{tip}</title>
      <MoneyFlagGlyph size={18} />
    </g>
  );
}

/* ── Catalyst type-name badge on chart ────────────────────────────────────── */

const CATALYST_BADGE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  cd:          { bg: "#f5e6b8", border: "#D4AF37", text: "#3d2e00" },
  readout:     { bg: "#dbeafe", border: "#3b82f6", text: "#1e40af" },
  submission:  { bg: "#f3e8ff", border: "#a855f7", text: "#6b21a8" },
  approval:    { bg: "#d1fae5", border: "#10b981", text: "#065f46" },
  pdufa:       { bg: "#dcfce7", border: "#22c55e", text: "#166534" },
  partnership: { bg: "#fef3c7", border: "#f59e0b", text: "#92400e" },
  preclinical: { bg: "#f1f5f9", border: "#94a3b8", text: "#475569" },
  initiation:  { bg: "#cffafe", border: "#06b6d4", text: "#155e75" },
  fda_vote:    { bg: "#d1fae5", border: "#10b981", text: "#065f46" },
  fda_safety:  { bg: "#e2e8f0", border: "#64748b", text: "#334155" },
  other:       { bg: "#f3f4f6", border: "#9ca3af", text: "#374151" },
};

function CatalystTypeBadgeDot({
  cx,
  cy,
  eventType,
  imminent,
  onClick,
  lane = 0,
  phase = null,
  dateLabel = null,
  title,
}: {
  cx?: number;
  cy?: number;
  eventType: string;
  imminent: boolean;
  onClick?: () => void;
  lane?: number;
  phase?: string | null;
  dateLabel?: string | null;
  title?: string;
}) {
  if (cx == null || cy == null) return null;

  const colors = CATALYST_BADGE_COLORS[eventType || "other"] || CATALYST_BADGE_COLORS.other!;
  const { w, h, label } = catalystBadgeBox(eventType, phase, dateLabel);
  const y0 = 4 + lane * (h + CATALYST_BADGE_GAP_PX);

  return (
    <g
      transform={`translate(${cx - w / 2}, 0)`}
      style={{ pointerEvents: "auto", cursor: onClick ? "pointer" : "default" }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }
      }}
    >
      <line
        x1={w / 2}
        y1={y0 + h}
        x2={w / 2}
        y2={cy}
        stroke={colors.border}
        strokeWidth={1}
        strokeDasharray="2 1"
      />
      <circle cx={w / 2} cy={cy} r={2.5} fill={colors.border} />

      {imminent ? (
        <rect x={-2} y={y0 - 2} width={w + 4} height={h + 4} rx={5} fill={colors.border} fillOpacity={0.15}>
          <animate attributeName="fill-opacity" values="0.2;0.06;0.2" dur="1.5s" repeatCount="indefinite" />
        </rect>
      ) : null}

      <rect
        x={0}
        y={y0}
        width={w}
        height={h}
        rx={3}
        fill={colors.bg}
        stroke={colors.border}
        strokeWidth={imminent ? 1.5 : 0.8}
      />

      <text
        x={w / 2}
        y={dateLabel ? y0 + 9 : y0 + h / 2 + 0.5}
        textAnchor="middle"
        dominantBaseline="central"
        fill={colors.text}
        fontSize={8}
        fontWeight={imminent ? 800 : 700}
        fontFamily="system-ui, -apple-system, sans-serif"
        letterSpacing="0.4"
      >
        {label}
      </text>
      {dateLabel ? (
        <text
          x={w / 2}
          y={y0 + 18}
          textAnchor="middle"
          dominantBaseline="central"
          fill={colors.text}
          fontSize={7}
          fontWeight={600}
          fontFamily="system-ui, -apple-system, sans-serif"
          opacity={0.85}
        >
          {dateLabel}
        </text>
      ) : null}
    </g>
  );
}

type CatalystMarkerPoint = PriceLinePoint & {
  catalystEvent: GuidanceCalendarEvent;
  catalystImminent: boolean;
  catalystLane: number;
  catalystDateLabel: string | null;
};

/**
 * One tag per table catalyst (CD + guidance rows).
 * Plot ISO is clamped onto the visible domain so year-long / off-pad windows still show.
 * Same calendar day + same event_type → a single banner (Simulation CD + NCT CD must not stack).
 */
function buildCatalystMarkerPoints(
  series: PriceLinePoint[],
  events: GuidanceCalendarEvent[],
  opts?: { it?: boolean },
): CatalystMarkerPoint[] {
  if (!events.length || !series.length) return [];

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const todayMs = today.getTime();
  const it = Boolean(opts?.it);
  const firstIso = series[0]!.key.slice(0, 10);
  const lastIso = series[series.length - 1]!.key.slice(0, 10);
  const lastPx = [...series].reverse().find((p) => Number.isFinite(p.tickerPrice));

  const richness = (ev: GuidanceCalendarEvent) => {
    let s = 0;
    if (ev.trial_phase) s += 3;
    if (ev.asset_name) s += 1;
    if (ev.indication) s += 1;
    if (ev.timing_quote) s += 1;
    return s;
  };

  // Prefer one event per (plot day × type). CD from clinical feed wins over a thin guidance clone.
  const bestByDayType = new Map<string, GuidanceCalendarEvent>();
  for (const ev of events) {
    const plotIso = resolveCatalystPlotIso(ev.window_start, ev.window_end, firstIso, lastIso);
    if (!plotIso) continue;
    const type = String(ev.event_type || "other").toLowerCase();
    const key = `${plotIso}|${type}`;
    const prev = bestByDayType.get(key);
    if (!prev || richness(ev) > richness(prev)) bestByDayType.set(key, ev);
  }

  const markers: CatalystMarkerPoint[] = [];

  for (const ev of bestByDayType.values()) {
    const plotIso = resolveCatalystPlotIso(ev.window_start, ev.window_end, firstIso, lastIso);
    if (!plotIso) continue;
    const hit = nearestDailyRow(series, plotIso);
    if (!hit) continue;

    const anchor = guidanceEventAnchorIso(ev) ?? plotIso;
    const wsDate = new Date(`${anchor}T12:00:00`);
    const daysUntil = Number.isNaN(wsDate.getTime())
      ? null
      : Math.round((wsDate.getTime() - todayMs) / 86_400_000);
    const imminent = daysUntil != null && daysUntil >= 0 && daysUntil <= 3;

    markers.push({
      ...hit,
      tickerPrice: Number.isFinite(hit.tickerPrice)
        ? hit.tickerPrice
        : (lastPx?.tickerPrice ?? 0),
      catalystEvent: ev,
      catalystImminent: imminent,
      catalystLane: 0,
      catalystDateLabel: fmtDailyLabel(anchor, it),
    });
  }

  return assignCatalystChartLanes(markers, series);
}

/**
 * Same calendar day → shared x (one stem). Nearby dates that would overlap
 * horizontally get distinct vertical lanes so banners never cover each other.
 * Identical type on the same day is already collapsed upstream — keep at most
 * one marker per day×type here as a safety net.
 */
function assignCatalystChartLanes(
  markers: CatalystMarkerPoint[],
  series: PriceLinePoint[],
): CatalystMarkerPoint[] {
  if (!markers.length) return markers;

  const groups = new Map<string, CatalystMarkerPoint[]>();
  for (const m of markers) {
    const col = m.catalystDateLabel
      ? `${m.key.slice(0, 4)}|${m.catalystDateLabel}`
      : m.key.slice(0, 10);
    const list = groups.get(col) ?? [];
    list.push(m);
    groups.set(col, list);
  }
  const snapped: CatalystMarkerPoint[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const ar = a.catalystEvent.event_type === "cd" ? 0 : 1;
      const br = b.catalystEvent.event_type === "cd" ? 0 : 1;
      if (ar !== br) return ar - br;
      return (a.catalystEvent.event_type || "").localeCompare(b.catalystEvent.event_type || "");
    });
    const at = list[0]!;
    const seenType = new Set<string>();
    for (const m of list) {
      const type = String(m.catalystEvent.event_type || "other").toLowerCase();
      if (seenType.has(type)) continue;
      seenType.add(type);
      snapped.push({
        ...m,
        key: at.key,
        label: at.label,
        tickerPrice: at.tickerPrice,
      });
    }
  }

  const keyIndex = new Map(series.map((p, i) => [p.key, i]));
  const lanes = assignOverlapLanesByX(
    snapped.map((m) => {
      const box = catalystBadgeBox(
        m.catalystEvent.event_type || "other",
        m.catalystEvent.trial_phase || null,
        m.catalystDateLabel,
      );
      return { xIndex: keyIndex.get(m.key) ?? 0, widthPx: box.w };
    }),
    series.length,
  );
  return snapped
    .map((m, i) => ({ ...m, catalystLane: lanes[i] ?? 0 }))
    .filter((m) => m.catalystLane >= 0);
}

type PricePlotRow = PriceLinePoint & {
  buyFill?: number | null;
  sellFill?: number | null;
};

function LineTooltip({
  active,
  payload,
  ticker,
  marketLabel,
  it,
}: {
  active?: boolean;
  payload?: { payload?: PricePlotRow }[];
  ticker: string;
  marketLabel: string;
  it: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const recLabel =
    row.buyFill != null ? "BUY" : row.sellFill != null ? "SELL" : null;
  const recColor = row.buyFill != null ? SOFT_BUY_FILL : SOFT_SELL_FILL;
  return (
    <div className="rounded-md border border-[rgb(var(--border))]/60 bg-surface px-2 py-1.5 text-[10px] shadow-sm">
      <p className="font-semibold text-ink mb-0.5">{row.label}</p>
      <p className="tabular-nums text-[rgb(var(--accent))]">
        {ticker}: {fmtUsd(row.tickerPrice)}
      </p>
      {row.marketScaled != null ? (
        <p className="tabular-nums text-ink-muted">
          {marketLabel}: {fmtUsd(row.marketScaled)}
          <span className="opacity-70"> ({it ? "ricalibrato" : "rebased"})</span>
        </p>
      ) : null}
      {recLabel ? (
        <p className="font-semibold mt-0.5" style={{ color: recColor }}>
          {it ? "Rec" : "Rec"}: {recLabel}
        </p>
      ) : null}
    </div>
  );
}

export function PriceVariationChart({
  ticker,
  windows,
  marketLabel = "XBI",
  marketDoc = null,
  intradayPrior,
  intradayLive,
  marketIntradayPrior: marketIntradayPriorProp,
  marketIntradayLive: marketIntradayLiveProp,
  intradayBatchLoading: _intradayBatchLoading = false,
  currentPriceUsd = null,
  embedded = false,
  dense = false,
  narrow = false,
  height,
  range: rangeProp,
  onRangeChange,
  hideRangeControls = false,
  cycleAlert = null,
  operationalRec = null,
  recHistoryKey = null,
  syncId,
  guidanceEvents,
  completionDate = null,
  clinicalRecords,
  sharedOhlcvBars = null,
  sharedOhlcvLoading = false,
  simRow = null,
}: PriceVariationChartProps) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const dismissed = useDismissedCatalystIds();
  const [showCycleMarkers] = useState(false);
  const [recEpisodes, setRecEpisodes] = useState<OperationalRecEpisode[]>(() =>
    loadTickerOperationalRecEpisodes(ticker),
  );
  const cyclePrimary = useMemo(() => resolveCycleDisplayPrimary(cycleAlert), [cycleAlert]);
  const [internalRange, setInternalRange] = useState<PriceVarChartRange>("24h");
  const range = rangeProp ?? internalRange;
  const setRange = (next: PriceVarChartRange) => {
    onRangeChange?.(next);
    if (rangeProp === undefined) setInternalRange(next);
  };
  const [tickerDaily, setTickerDaily] = useState<{ date: string; close: number }[]>([]);
  const [tickerVolumeDaily, setTickerVolumeDaily] = useState<
    { date: string; volume: number; close: number }[]
  >([]);
  const [tickerDaily6M, setTickerDaily6M] = useState<{ date: string; close: number }[]>([]);
  const [marketDailyFetched, setMarketDailyFetched] = useState<{ date: string; close: number }[]>(
    [],
  );
  const [marketIntradayPrior, setMarketIntradayPrior] = useState<IntradayPricePoint[]>();
  const [marketIntradayLive, setMarketIntradayLive] = useState<IntradayPricePoint[]>();
  const [tickerIntradayPrior, setTickerIntradayPrior] = useState<IntradayPricePoint[]>();
  const [tickerIntradayLive, setTickerIntradayLive] = useState<IntradayPricePoint[]>();
  const [loading, setLoading] = useState(false);
  const [intradayLoading, setIntradayLoading] = useState(false);
  const dailyFetchGenRef = useRef(0);
  const intradayFetchGenRef = useRef(0);
  const useSharedOhlcv = sharedOhlcvBars != null;

  const applyTickerBars = (bars: VolumeHistoryBar[]) => {
    setTickerDaily(
      bars
        .filter((b) => b.date && b.close != null && b.close > 0)
        .map((b) => ({ date: b.date, close: Number(b.close) })),
    );
    setTickerVolumeDaily(
      bars
        .filter((b) => b.date && b.volume != null && b.volume > 0)
        .map((b) => ({
          date: b.date,
          volume: Number(b.volume),
          close: b.close != null ? Number(b.close) : 0,
        })),
    );
  };

  const effectiveTickerPrior =
    intradayPrior?.length ? intradayPrior : tickerIntradayPrior;
  const effectiveTickerLive = intradayLive?.length ? intradayLive : tickerIntradayLive;
  const effectiveMarketPrior = marketIntradayPriorProp?.length
    ? marketIntradayPriorProp
    : marketIntradayPrior;
  const effectiveMarketLive = marketIntradayLiveProp?.length
    ? marketIntradayLiveProp
    : marketIntradayLive;

  const plotH = height ?? (narrow ? 120 : dense ? 140 : 168);
  const xbiReady = xbiSnapshotAvailable(marketDoc);

  const mcsMarketBars = useMemo(
    () => xbiBarsFromSnapshot(marketDoc).map((b) => ({ date: b.date, close: b.close })),
    [marketDoc],
  );

  useEffect(() => {
    if (!useSharedOhlcv) return;
    applyTickerBars(sharedOhlcvBars ?? []);
    setLoading(Boolean(sharedOhlcvLoading));
  }, [useSharedOhlcv, sharedOhlcvBars, sharedOhlcvLoading]);

  useEffect(() => {
    if (useSharedOhlcv) return;
    const gen = ++dailyFetchGenRef.current;
    setLoading(true);
    const days = range === "24h" ? 3 : rangeToFetchDays(range);
    void fetchOhlcvHistory(ticker, days)
      .then((doc) => {
        if (dailyFetchGenRef.current !== gen) return;
        applyTickerBars(doc.bars ?? []);
      })
      .catch(() => {
        if (dailyFetchGenRef.current !== gen) return;
        setTickerDaily([]);
        setTickerVolumeDaily([]);
      })
      .finally(() => {
        if (dailyFetchGenRef.current === gen) setLoading(false);
      });
  }, [ticker, range, useSharedOhlcv]);

  useEffect(() => {
    if (range === "6M" || range === "1Y" || range === "cat6M") {
      setTickerDaily6M([]);
      return;
    }
    let cancelled = false;
    void fetchOhlcvHistory(ticker, rangeToFetchDays("6M"))
      .then((doc) => {
        if (cancelled) return;
        setTickerDaily6M(
          (doc.bars ?? [])
            .filter((b) => b.date && b.close != null && b.close > 0)
            .map((b) => ({ date: b.date, close: Number(b.close) })),
        );
      })
      .catch(() => {
        if (!cancelled) setTickerDaily6M([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, range]);

  useEffect(() => {
    if (range === "24h") return;
    const cutoff = rangeToCalendarCutoff(range);
    if (dailyHistoryCoversCutoff(mcsMarketBars, cutoff)) {
      setMarketDailyFetched([]);
      return;
    }
    let cancelled = false;
    void fetchOhlcvHistory("XBI", rangeToFetchDays(range))
      .then((doc) => {
        if (cancelled) return;
        setMarketDailyFetched(
          (doc.bars ?? [])
            .filter((b) => b.date && b.close != null && b.close > 0)
            .map((b) => ({ date: b.date, close: Number(b.close) })),
        );
      })
      .catch(() => {
        if (!cancelled) setMarketDailyFetched([]);
      });
    return () => {
      cancelled = true;
    };
  }, [range, mcsMarketBars]);

  useEffect(() => {
    if (range !== "24h") {
      setIntradayLoading(false);
      return;
    }
    if (intradayPrior?.length || intradayLive?.length) {
      setTickerIntradayPrior(undefined);
      setTickerIntradayLive(undefined);
      setIntradayLoading(false);
      return;
    }
    const gen = ++intradayFetchGenRef.current;
    setIntradayLoading(true);
    const tk = ticker.trim().toUpperCase();
    void fetchIntraday1h([tk])
      .then((payload) => {
        if (intradayFetchGenRef.current !== gen) return;
        setTickerIntradayPrior(
          payload.prior?.series?.[tk] ?? payload.prior?.series?.[ticker],
        );
        setTickerIntradayLive(
          payload.live?.series?.[tk] ??
            payload.live?.series?.[ticker] ??
            payload.series?.[tk] ??
            payload.series?.[ticker],
        );
      })
      .catch(() => {
        if (intradayFetchGenRef.current !== gen) return;
        setTickerIntradayPrior(undefined);
        setTickerIntradayLive(undefined);
      })
      .finally(() => {
        if (intradayFetchGenRef.current === gen) setIntradayLoading(false);
      });
  }, [range, ticker, intradayPrior, intradayLive]);

  useEffect(() => {
    if (range !== "24h") return;
    if (marketIntradayPriorProp?.length || marketIntradayLiveProp?.length) {
      setMarketIntradayPrior(undefined);
      setMarketIntradayLive(undefined);
      return;
    }
    let cancelled = false;
    void fetchIntraday1h(["XBI"])
      .then((payload) => {
        if (cancelled) return;
        const tk = "XBI";
        setMarketIntradayPrior(
          payload.prior?.series?.[tk] ?? payload.prior?.series?.["^XBI"],
        );
        setMarketIntradayLive(
          payload.live?.series?.[tk] ??
            payload.live?.series?.["^XBI"] ??
            payload.series?.[tk] ??
            payload.series?.["^XBI"],
        );
      })
      .catch(() => {
        if (!cancelled) {
          setMarketIntradayPrior(undefined);
          setMarketIntradayLive(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range, marketIntradayPriorProp, marketIntradayLiveProp]);

  const marketDaily = useMemo(() => {
    if (range === "24h") {
      return mcsMarketBars.length >= 5 ? mcsMarketBars : marketDailyFetched;
    }
    const cutoff = rangeToCalendarCutoff(range);
    const fetchedN = marketDailyFetched.filter((b) => b.date >= cutoff).length;
    const mcsN = mcsMarketBars.filter((b) => b.date >= cutoff).length;
    if (fetchedN >= mcsN && fetchedN >= 5) return marketDailyFetched;
    if (mcsMarketBars.length >= 5) return mcsMarketBars;
    return marketDailyFetched;
  }, [range, mcsMarketBars, marketDailyFetched]);

  const series = useMemo((): PriceLinePoint[] => {
    if (range === "24h") {
      const intraday = buildIntradayPriceLineSeries({
        tickerPrior: effectiveTickerPrior,
        tickerLive: effectiveTickerLive,
        marketPrior: effectiveMarketPrior,
        marketLive: effectiveMarketLive,
        it,
      });
      if (intraday.length >= 2) return intraday;
      const dailyFallback = buildDailyPriceLineSeries({
        tickerBars: tickerDaily,
        marketBars: marketDaily,
        cutoffDate: rangeToCalendarCutoff("7d"),
        it,
      });
      return dailyFallback.length >= 2 ? dailyFallback : intraday;
    }
    return buildDailyPriceLineSeries({
      tickerBars: tickerDaily,
      marketBars: marketDaily,
      cutoffDate: rangeToCalendarCutoff(range),
      it,
    });
  }, [
    range,
    effectiveTickerPrior,
    effectiveTickerLive,
    effectiveMarketPrior,
    effectiveMarketLive,
    tickerDaily,
    marketDaily,
    it,
  ]);

  const chartRows = useMemo((): PriceChartCycleRow[] => {
    if (!showCycleMarkers) {
      return series.map((p) => ({ ...p, cycleMarker: null, cycleMarkerConfirmed: false }));
    }
    const cutoff = rangeToCalendarCutoff(range);
    const volumeBars = tickerVolumeDaily
      .filter((b) => b.date >= cutoff)
      .map((b) => ({ date: b.date, volume: b.volume }));
    const dailyCloses =
      range === "6M" || range === "cat6M"
        ? tickerDaily6M.length
          ? tickerDaily6M
          : tickerVolumeDaily.map((b) => ({ date: b.date, close: b.close }))
        : tickerDaily.length
          ? tickerDaily
          : tickerVolumeDaily.map((b) => ({ date: b.date, close: b.close }));
    return attachCycleMarkersToPriceSeries(series, cycleAlert, cyclePrimary, {
      volumeBars,
      dailyCloses,
      livePrice:
        currentPriceUsd != null && Number.isFinite(currentPriceUsd) && currentPriceUsd > 0
          ? currentPriceUsd
          : latestTickerPrice(series),
      asOfDate: series.length ? series[series.length - 1]!.key.slice(0, 10) : null,
    });
  }, [
    series,
    showCycleMarkers,
    cycleAlert,
    cyclePrimary,
    tickerVolumeDaily,
    tickerDaily,
    tickerDaily6M,
    range,
    currentPriceUsd,
  ]);

  const overlayPhasesOnChart = useMemo(() => {
    const s = new Set<ChartOverlayPhase>();
    for (const row of chartRows) {
      if (row.cycleMarker) s.add(row.cycleMarker);
    }
    return s;
  }, [chartRows]);

  const hasCycleMarkers = showCycleMarkers && cycleMarkerHasAny(chartRows);
  const cycleMarkerPoints = useMemo(
    () => chartRows.filter((r) => r.cycleMarker != null),
    [chartRows],
  );

  const [catalystDetailEvent, setCatalystDetailEvent] = useState<GuidanceCalendarEvent | null>(null);

  const recAnchor = chartRows.length ? chartRows[chartRows.length - 1]! : null;

  useEffect(() => {
    setRecEpisodes(loadTickerOperationalRecEpisodes(ticker));
  }, [ticker]);

  // Closed BUY/SELL windows stay painted: persisted episodes are merged with the
  // full rec history so the chart shows the whole recommendation track.
  useEffect(() => {
    if (!chartRows.length) return;
    const rawAsOf = recAnchor?.key;
    let stored: OperationalRecEpisode[];
    if (operationalRec != null && rawAsOf) {
      const asOf = clampRecIsoToSeries(rawAsOf, chartRows);
      const preferRaw =
        operationalRec === "buy" && recHistoryKey
          ? latestBuyStreakStartIso(recHistoryKey)
          : null;
      const preferStart = preferRaw ? clampRecIsoToSeries(preferRaw, chartRows) : null;
      stored = syncTickerOperationalRec(ticker, operationalRec, asOf, {
        preferStartIso: preferStart,
      });
    } else {
      stored = loadTickerOperationalRecEpisodes(ticker);
    }
    let next = mergeRecEpisodes(
      stored,
      recHistoryKey ? recEpisodesFromHistory(recHistoryKey) : [],
    );
    next = ensureOpenRecHasDrawableSpan(chartRows, next);
    next = ensureClosedRecEpisodesDrawable(chartRows, next);
    // Parent re-renders rebuild chartRows: keep the old array when nothing moved
    // so the fill/boundary memos below are not recomputed for every chart.
    setRecEpisodes((prev) => (sameRecEpisodes(prev, next) ? prev : next));
  }, [ticker, operationalRec, recAnchor?.key, recHistoryKey, chartRows]);

  const plotRows = useMemo(() => {
    const fills = recFillForPoints(chartRows, recEpisodes);
    return chartRows.map((row, i) => ({
      ...row,
      buyFill: fills[i]?.buyFill ?? null,
      sellFill: fills[i]?.sellFill ?? null,
    }));
  }, [chartRows, recEpisodes]);

  const recBoundaryRows = useMemo(() => {
    const marks = recBoundariesForPoints(chartRows, recEpisodes);
    const byKey = new Map(chartRows.map((r) => [r.key, r]));
    const seen = new Set<string>();
    const out: { x: string; kind: "start" | "end" }[] = [];
    for (const m of marks) {
      const row = byKey.get(m.pointKey);
      if (!row || seen.has(row.key)) continue;
      seen.add(row.key);
      out.push({ x: row.key, kind: m.kind });
    }
    return out;
  }, [chartRows, recEpisodes]);

  /* ── Extend plotRows with future pad + CD banner ────────────────────────── */
  const chartCdIsos = useMemo(
    () =>
      collectTickerChartCdIsos(ticker, completionDate, clinicalRecords).filter(
        (iso) => !dismissed.has(cdIsoEventId(ticker, iso)),
      ),
    [ticker, completionDate, clinicalRecords, dismissed],
  );

  const visibleGuidanceEvents = useMemo(
    () => (guidanceEvents ?? []).filter((ev) => !dismissed.has(catalystEventStableId({ ...ev, ticker }))),
    [guidanceEvents, dismissed, ticker],
  );

  const { extendedPlotRows, cdXKeys } = useMemo(() => {
    if (range === "24h" || !plotRows.length) {
      return { extendedPlotRows: plotRows, cdXKeys: [] as string[] };
    }
    const lastKey = plotRows[plotRows.length - 1]!.key.slice(0, 10);
    const padDays = chartFuturePadDays(range);
    const extras: string[] = [...chartCdIsos];
    for (const ev of visibleGuidanceEvents) {
      const a = guidanceEventAnchorIso(ev);
      if (a) extras.push(a);
    }
    const futureIsos = futureChartPadIsos(lastKey, padDays, extras);
    const futurePts = futureIsos.map((iso) => ({
      key: iso,
      label: fmtDailyLabel(iso, it),
      tickerPrice: null as unknown as number,
      marketScaled: null,
      buyFill: null,
      sellFill: null,
      cycleMarker: null,
      cycleMarkerConfirmed: false,
    }));
    const padded = ensureIsoTicksInSeries(
      [...plotRows, ...futurePts] as typeof plotRows,
      extras,
      it,
    );
    const keys = chartCdIsos
      .map((iso) => cdChartXKey(padded, iso))
      .filter((k): k is string => Boolean(k));
    return {
      extendedPlotRows: padded,
      cdXKeys: [...new Set(keys)],
    };
  }, [plotRows, range, it, visibleGuidanceEvents, chartCdIsos]);

  const hasBuyFill = extendedPlotRows.some((r) => r.buyFill != null);
  const hasSellFill = extendedPlotRows.some((r) => r.sellFill != null);

  const catalystMarkerPoints = useMemo(() => {
    if (range === "24h") return [];
    const events: GuidanceCalendarEvent[] = [...visibleGuidanceEvents];
    const guidanceCdIsos = new Set(
      visibleGuidanceEvents
        .filter((ev) => String(ev.event_type || "").toLowerCase() === "cd")
        .map((ev) => guidanceEventAnchorIso(ev) || String(ev.window_start || "").slice(0, 10))
        .filter(Boolean),
    );
    for (const cdIso of [...chartCdIsos].reverse()) {
      // Already have a CD banner from guidance/calendar for this day.
      if (guidanceCdIsos.has(cdIso)) continue;
      const rec = findClinicalPreCdRecord(ticker, cdIso, clinicalRecords ?? []);
      events.unshift({
        ticker,
        company: rec?.company || rec?.meta?.lead_sponsor || "",
        event_type: "cd",
        asset_name: rec?.meta?.brief_title || ticker.trim().toUpperCase(),
        trial_phase: rec?.study_phase || rec?.meta?.phase || null,
        indication: rec?.meta?.conditions || null,
        window_start: cdIso,
        window_end: cdIso,
        timing_quote: rec?.nct_id
          ? `${rec.nct_id}${rec.meta?.brief_title ? ` · ${rec.meta.brief_title}` : ""}`
          : it
            ? "Data di completion (Simulation / NCT)"
            : "Completion date (Simulation / NCT)",
      });
    }
    return buildCatalystMarkerPoints(extendedPlotRows, events, { it });
  }, [extendedPlotRows, visibleGuidanceEvents, range, it, chartCdIsos, ticker, clinicalRecords]);

  const catalystTopPad = useMemo(() => {
    if (!catalystMarkerPoints.length) return isCatalystCalendarRange(range) ? 36 : 10;
    const lanes = Math.max(...catalystMarkerPoints.map((p) => p.catalystLane + 1), 1);
    return catalystLaneTopPad(lanes);
  }, [catalystMarkerPoints, range]);
  /** Banners sit in margin.top — grow the frame so the price line keeps `plotH`. */
  const chartFrameH = plotH + catalystTopPad + (range === "24h" ? 0 : 20);

  const livePrice =
    currentPriceUsd != null && Number.isFinite(currentPriceUsd) && currentPriceUsd > 0
      ? currentPriceUsd
      : latestTickerPrice(chartRows);

  const sessionDate = useMemo(
    () =>
      range === "24h"
        ? resolveIntradaySessionTradingDate(effectiveTickerPrior, effectiveTickerLive)
        : chartRows.length
          ? chartRows[chartRows.length - 1]!.key.slice(0, 10)
          : null,
    [range, effectiveTickerPrior, effectiveTickerLive, chartRows],
  );

  const dailyBars6M = range === "6M" || range === "1Y" || range === "cat6M" ? tickerDaily : tickerDaily6M;

  const sixMonthBreakout = useMemo(
    () =>
      detectSixMonthHighBreakout({
        dailyBars: dailyBars6M,
        livePrice,
        asOfDate: sessionDate,
      }),
    [dailyBars6M, livePrice, sessionDate],
  );

  const sixMonthHighTip =
    sixMonthBreakout != null
      ? t("priceVarChart.sixMonthHighTip", {
          live: fmtUsd(sixMonthBreakout.livePrice),
          hist: fmtUsd(sixMonthBreakout.histMax),
        })
      : "";

  const breakoutAnchor = chartRows.length ? chartRows[chartRows.length - 1]! : null;

  const yDomain = useMemo((): [number, number] | ["auto", "auto"] => {
    const vals: number[] = [];
    for (const p of plotRows) {
      if (Number.isFinite(p.tickerPrice)) vals.push(p.tickerPrice);
      if (p.marketScaled != null && Number.isFinite(p.marketScaled)) vals.push(p.marketScaled);
    }
    if (livePrice != null && Number.isFinite(livePrice)) vals.push(livePrice);
    if (vals.length < 2) return ["auto", "auto"];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min;
    const pad = span > 0 ? span * 0.12 : Math.max(max * 0.02, 0.05);
    return [min - pad, max + pad];
  }, [plotRows, livePrice]);

  const recFillBase: number | "dataMin" =
    typeof yDomain[0] === "number" ? yDomain[0] : "dataMin";

  const activeWindow = useMemo(
    () => windows.find((w) => w.window === rangeToWindowKey(range)) ?? null,
    [windows, range],
  );

  const seriesDelta = useMemo(() => priceLineSeriesDelta(chartRows), [chartRows]);
  const footerTickerChange = activeWindow?.tickerChange ?? seriesDelta.tickerChange;
  const footerMarketChange = activeWindow?.marketChange ?? seriesDelta.marketChange;
  const footerTickerDeltaUsd = activeWindow?.tickerDeltaUsd ?? seriesDelta.tickerDeltaUsd;

  const delta = windowDelta(footerTickerChange, footerMarketChange);
  const deltaInfo = delta != null ? getDeltaLabel(delta) : null;

  const hasAnyTicker = chartRows.length >= 2;
  const hasDailyBars = tickerDaily.length >= 2;
  const chartLoading =
    !hasAnyTicker &&
    !hasDailyBars &&
    (loading || (range === "24h" && intradayLoading));

  const rangeBtn = (id: PriceVarChartRange) => (
    <button
      key={id}
      type="button"
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold tabular-nums transition ${rangeHorizonBtnClass(id, range === id)}`}
      onClick={() => setRange(id)}
      aria-pressed={range === id}
      title={rangeHorizonTip(id, it)}
    >
      {id === "cat6M" ? "⚡ " : ""}
      {rangeLabel(id, it)}
    </button>
  );

  if (!hasAnyTicker && !chartLoading) {
    return (
      <p className="text-xs text-ink-muted h-full flex items-center justify-center text-center px-2 leading-snug py-4">
        {t("priceVarChart.unavailable")}
      </p>
    );
  }

  return (
    <div className={`w-full flex flex-col shrink-0${dense || narrow ? " gap-1" : " gap-1.5"}`}>
      <div className="flex flex-wrap items-center justify-between gap-1 px-0.5 shrink-0">
        {!embedded ? (
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink leading-snug uppercase tracking-wide">
              {t("priceVarChart.title")}
            </p>
          </div>
        ) : null}
        <div
          className={`flex items-center gap-2 text-ink-muted shrink-0${embedded ? " ml-auto" : ""}${
            dense ? " text-[9px]" : " text-[10px]"
          }`}
        >
          <span className="inline-flex items-center gap-1 font-medium text-ink">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: TICKER_LINE }}
            />
            {ticker}
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="inline-block w-2 h-0.5 rounded"
              style={{ background: MARKET_LINE }}
            />
            {marketLabel}
          </span>
          {livePrice != null ? (
            <span
              className="inline-flex items-center gap-1 font-medium tabular-nums"
              style={{ color: LAST_PRICE_LINE }}
              title={it ? "Ultimo prezzo registrato" : "Last recorded price"}
            >
              <span
                className="inline-block w-3 border-t border-dashed"
                style={{ borderColor: LAST_PRICE_LINE }}
              />
              {fmtUsd(livePrice)}
            </span>
          ) : null}
          {sixMonthBreakout ? (
            <span
              className="inline-flex items-center gap-0.5 font-semibold text-[rgb(var(--signal-up))]"
              title={sixMonthHighTip}
            >
              <MoneyFlagGlyph size={14} />
              {t("priceVarChart.sixMonthHighLegend")}
            </span>
          ) : null}
        </div>
      </div>

      {hasCycleMarkers || hasBuyFill || hasSellFill || recBoundaryRows.length ? (
        <div
          className={`flex flex-wrap items-center justify-end gap-2 px-0.5 shrink-0${
            dense ? " text-[8px]" : " text-[9px]"
          } text-ink-muted`}
        >
          {hasCycleMarkers
            ? CHART_OVERLAY_PHASES.map((phase) => {
            const st = overlayMarkerStyle(
              phase,
              phase === "exhaustion_exit" ? 4 : undefined,
            );
            return (
            <span
              key={phase}
              className="inline-flex items-center gap-0.5"
              title={overlayPhaseTip(phase, it)}
            >
              <span
                className="inline-flex w-3.5 h-3.5 items-center justify-center text-[7px] font-semibold"
                style={{
                  transform: "rotate(45deg)",
                  border: `1.5px solid ${st.stroke}`,
                  background: "transparent",
                  opacity: overlayPhasesOnChart.has(phase) ? 1 : 0.45,
                }}
                aria-hidden
              >
                <span style={{ transform: "rotate(-45deg)", color: st.stroke }}>
                  {st.glyph}
                </span>
              </span>
              {overlayPhaseCompactLabel(phase, it)}
            </span>
            );
          })
            : null}
          {recBoundaryRows.length ? (
            <span
              className="inline-flex items-center gap-0.5"
              title={t("priceVarChart.recBandBoundaryTip")}
            >
              <span
                className="inline-block w-3 border-t border-dashed"
                style={{ borderColor: REC_BOUNDARY_STROKE }}
                aria-hidden
              />
              {t("priceVarChart.recBandBoundary")}
            </span>
          ) : null}
          {hasBuyFill ? (
            <span
              className="inline-flex items-center gap-0.5 font-semibold"
              style={{ color: SOFT_BUY_FILL }}
              title={t("priceVarChart.softBuyTip")}
            >
              <span
                className="inline-block w-3 h-2 rounded-sm"
                style={{ background: SOFT_BUY_FILL, opacity: 0.45 }}
                aria-hidden
              />
              {t("priceVarChart.softBuyLegend")}
            </span>
          ) : null}
          {hasSellFill ? (
            <span
              className="inline-flex items-center gap-0.5 font-semibold"
              style={{ color: SOFT_SELL_FILL }}
              title={t("priceVarChart.softSellTip")}
            >
              <span
                className="inline-block w-3 h-2 rounded-sm"
                style={{ background: SOFT_SELL_FILL, opacity: 0.45 }}
                aria-hidden
              />
              {t("priceVarChart.softSellLegend")}
            </span>
          ) : null}
        </div>
      ) : null}

      {!xbiReady && range !== "24h" ? (
        <p className="text-[10px] text-amber-700/90 dark:text-amber-300/90 px-0.5 leading-snug shrink-0">
          {t("priceVarChart.xbiUnavailable", { market: marketLabel })}
        </p>
      ) : null}

      <div className="relative shrink-0" style={{ height: chartFrameH, minHeight: chartFrameH }}>
        {chartLoading && !chartRows.length ? (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-ink-muted">
            {t("priceVarChart.loading")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={extendedPlotRows}
              margin={{ top: catalystTopPad, right: 52, bottom: range === "24h" ? 2 : 22, left: 6 }}
              syncId={syncId}
              syncMethod="value"
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(124, 108, 243, 0.22)"
                strokeOpacity={1}
                vertical={false}
              />
              <XAxis
                dataKey="key"
                tick={<ChartIsoDateTick it={it} daily={range !== "24h"} />}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={28}
                height={range === "24h" ? 24 : 36}
              />
              <YAxis
                orientation="right"
                tick={{ fontSize: 9, fill: "#334155" }}
                tickLine={false}
                axisLine={false}
                width={46}
                tickMargin={6}
                tickFormatter={(v) => fmtVolumeAxis(Number(v))}
                domain={yDomain}
                allowDataOverflow={false}
              />
              <Tooltip
                cursor={PRICE_VAR_CHART_CURSOR}
                content={
                  <LineTooltip ticker={ticker} marketLabel={marketLabel} it={it} />
                }
              />
              {hasBuyFill ? (
                <Area
                  type="linear"
                  dataKey="buyFill"
                  stroke="none"
                  fill={SOFT_BUY_FILL}
                  fillOpacity={0.28}
                  baseValue={recFillBase}
                  connectNulls={false}
                  isAnimationActive={false}
                  legendType="none"
                  dot={false}
                  activeDot={false}
                />
              ) : null}
              {hasSellFill ? (
                <Area
                  type="linear"
                  dataKey="sellFill"
                  stroke="none"
                  fill={SOFT_SELL_FILL}
                  fillOpacity={0.28}
                  baseValue={recFillBase}
                  connectNulls={false}
                  isAnimationActive={false}
                  legendType="none"
                  dot={false}
                  activeDot={false}
                />
              ) : null}
              {chartRows.some((p) => p.marketScaled != null) ? (
                <Line
                  type="linear"
                  dataKey="marketScaled"
                  stroke={MARKET_LINE}
                  strokeWidth={1.8}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ) : null}
              <Line
                type="linear"
                dataKey="tickerPrice"
                stroke={TICKER_LINE}
                strokeWidth={2.25}
                dot={false}
                activeDot={{ r: 3, fill: TICKER_LINE, stroke: "#fff", strokeWidth: 1 }}
                isAnimationActive={false}
                connectNulls={false}
              />
              {showCycleMarkers
                ? cycleMarkerPoints.map((pt) => (
                    <ReferenceDot
                      key={`cycle-${pt.key}-${pt.cycleMarker}`}
                      x={pt.key}
                      y={pt.tickerPrice}
                      r={0}
                      isFront
                      ifOverflow="visible"
                      shape={(props: { cx?: number; cy?: number }) => (
                        <CyclePriceDot
                          cx={props.cx}
                          cy={props.cy}
                          payload={pt}
                          it={it}
                          primary={cyclePrimary}
                          matches={cycleAlert?.matches}
                        />
                      )}
                    />
                  ))
                : null}
              {[...catalystMarkerPoints]
                .sort((a, b) => a.catalystLane - b.catalystLane)
                .map((pt, idx) => (
                <ReferenceDot
                  key={`catalyst-${pt.key}-${pt.catalystLane}-${idx}`}
                  x={pt.key}
                  y={pt.tickerPrice}
                  r={0}
                  isFront
                  ifOverflow="visible"
                  shape={(props: { cx?: number; cy?: number }) => (
                    <CatalystTypeBadgeDot
                      cx={props.cx}
                      cy={props.cy}
                      eventType={pt.catalystEvent.event_type || "other"}
                      imminent={pt.catalystImminent}
                      lane={pt.catalystLane}
                      phase={pt.catalystEvent.trial_phase || null}
                      dateLabel={pt.catalystDateLabel}
                      title={
                        pt.catalystEvent.event_type === "cd"
                          ? it
                            ? "Apri studio e EIS"
                            : "Open study and EIS"
                          : undefined
                      }
                      onClick={() => setCatalystDetailEvent(pt.catalystEvent)}
                    />
                  )}
                />
              ))}
              {recBoundaryRows.map((b) => (
                <ReferenceLine
                  key={`rec-bound-${b.kind}-${b.x}`}
                  x={b.x}
                  stroke={REC_BOUNDARY_STROKE}
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  ifOverflow="visible"
                  isFront
                />
              ))}
              {sixMonthBreakout && breakoutAnchor ? (
                <ReferenceDot
                  key="six-month-high-breakout"
                  x={breakoutAnchor.key}
                  y={sixMonthBreakout.livePrice}
                  r={0}
                  isFront
                  ifOverflow="visible"
                  shape={(props: { cx?: number; cy?: number }) => (
                    <SixMonthHighFlagDot cx={props.cx} cy={props.cy} tip={sixMonthHighTip} />
                  )}
                />
              ) : null}
              {livePrice != null ? (
                <ReferenceLine
                  y={livePrice}
                  stroke={LAST_PRICE_LINE}
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                />
              ) : null}
              {cdXKeys.map((x) => (
                <ReferenceLine
                  key={`cd-gold-${x}`}
                  x={x}
                  stroke={CD_GOLD}
                  strokeWidth={2}
                  ifOverflow="visible"
                  isFront
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {!hideRangeControls ? (
        <div
          className={`flex flex-wrap items-center justify-center gap-0.5 shrink-0${dense || narrow ? " pt-0" : " pt-0.5"}`}
        >
          {PRICE_VAR_CHART_RANGE_ORDER.map(rangeBtn)}
        </div>
      ) : null}

      {activeWindow || footerTickerChange != null ? (
        <div className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-0 text-[10px] tabular-nums font-semibold shrink-0${dense || narrow ? "" : " border-t border-[rgb(var(--border))]/20 pt-1"}`}>
          <span style={{ color: pctTextColor(footerTickerChange) }}>
            {footerTickerChange != null
              ? formatPriceVariationPct(footerTickerChange)
              : "—"}
            {footerTickerDeltaUsd != null ? (
              <span className="font-normal opacity-80">
                {" "}
                ({formatSignedPriceVariationUsd(footerTickerDeltaUsd)})
              </span>
            ) : null}
          </span>
          <span className="text-ink-muted font-normal">
            {marketLabel}{" "}
            {footerMarketChange != null
              ? formatPriceVariationPct(footerMarketChange)
              : "—"}
          </span>
          {deltaInfo ? (
            <span
              className={
                deltaInfo.style === "out"
                  ? "text-[rgb(var(--signal-up))]"
                  : deltaInfo.style === "under"
                    ? "text-[rgb(var(--signal-down))]"
                    : "text-ink-muted"
              }
            >
              {deltaInfo.text}
            </span>
          ) : null}
        </div>
      ) : null}

      {catalystDetailEvent?.event_type === "cd" ? (
        <CdStudyEisModal
          ticker={ticker}
          cdIso={catalystDetailEvent.window_start || catalystDetailEvent.window_end}
          clinicalRecords={clinicalRecords}
          guidanceEvents={guidanceEvents}
          simRow={simRow}
          productHint={catalystDetailEvent.asset_name || null}
          it={it}
          onClose={() => setCatalystDetailEvent(null)}
        />
      ) : catalystDetailEvent &&
        (catalystDetailEvent.event_type === "pdufa" ||
          catalystDetailEvent.event_type === "approval" ||
          catalystDetailEvent.event_type === "submission") ? (
        <RegulatoryCatalystDetailModal
          event={catalystDetailEvent}
          ticker={ticker}
          clinicalRecords={clinicalRecords}
          it={it}
          onClose={() => setCatalystDetailEvent(null)}
        />
      ) : catalystDetailEvent ? (
        <CatalystDetailPopup
          event={catalystDetailEvent}
          it={it}
          onClose={() => setCatalystDetailEvent(null)}
        />
      ) : null}
    </div>
  );
}

/* ── Catalyst detail popup ─────────────────────────────────────────────────── */

function CatalystDetailPopup({
  event: ev,
  it,
  onClose,
}: {
  event: GuidanceCalendarEvent;
  it: boolean;
  onClose: () => void;
}) {
  const key = ev.event_type || "other";
  const colors = CATALYST_BADGE_COLORS[key] || CATALYST_BADGE_COLORS.other!;
  const label = CATALYST_TYPE_LABELS[key] || key.toUpperCase();

  const fmtDate = (iso: string | null | undefined): string => {
    if (!iso) return "—";
    try {
      const d = new Date(`${iso}T12:00:00`);
      return d.toLocaleDateString(it ? "it-IT" : "en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  const windowStr =
    ev.window_start && ev.window_end && ev.window_start !== ev.window_end
      ? `${fmtDate(ev.window_start)} → ${fmtDate(ev.window_end)}`
      : fmtDate(ev.window_start || ev.window_end);

  const daysUntil = (() => {
    if (!ev.window_start) return null;
    try {
      const ws = new Date(`${ev.window_start}T12:00:00`);
      const now = new Date();
      now.setHours(12, 0, 0, 0);
      return Math.round((ws.getTime() - now.getTime()) / 86_400_000);
    } catch {
      return null;
    }
  })();

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-surface border border-[rgb(var(--border))] rounded-xl shadow-xl max-w-sm w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{ backgroundColor: colors.bg, borderBottom: `2px solid ${colors.border}` }}
        >
          <span
            className="text-xs font-extrabold uppercase tracking-wider"
            style={{ color: colors.text }}
          >
            {label}
          </span>
          {daysUntil != null && daysUntil >= 0 ? (
            <span className="ml-auto text-[10px] font-bold tabular-nums" style={{ color: colors.text }}>
              {daysUntil === 0
                ? (it ? "Oggi" : "Today")
                : daysUntil === 1
                  ? (it ? "Domani" : "Tomorrow")
                  : (it ? `Tra ${daysUntil} giorni` : `In ${daysUntil} days`)}
            </span>
          ) : null}
          <button
            onClick={onClose}
            className="ml-auto text-muted hover:text-foreground transition-colors text-base leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-2 text-xs">
          {/* Window */}
          <div className="flex items-center gap-2">
            <span className="text-muted font-medium shrink-0 w-20">
              {it ? "Finestra" : "Window"}
            </span>
            <span className="font-semibold tabular-nums">{windowStr}</span>
          </div>

          {/* Asset */}
          {ev.asset_name ? (
            <div className="flex items-center gap-2">
              <span className="text-muted font-medium shrink-0 w-20">Asset</span>
              <span className="font-semibold">{ev.asset_name}</span>
            </div>
          ) : null}

          {/* Phase */}
          {ev.trial_phase ? (
            <div className="flex items-center gap-2">
              <span className="text-muted font-medium shrink-0 w-20">
                {it ? "Fase" : "Phase"}
              </span>
              <span className="font-semibold">Phase {ev.trial_phase}</span>
            </div>
          ) : null}

          {/* Indication */}
          {ev.indication ? (
            <div className="flex items-center gap-2">
              <span className="text-muted font-medium shrink-0 w-20">
                {it ? "Indicazione" : "Indication"}
              </span>
              <span className="font-semibold">{ev.indication}</span>
            </div>
          ) : null}

          {/* Source quote */}
          {ev.timing_quote ? (
            <div className="mt-1 pt-2 border-t border-[rgb(var(--border))]/20">
              <span className="text-muted font-medium text-[10px] uppercase tracking-wider block mb-1">
                {it ? "Dettaglio" : "Source quote"}
              </span>
              <p className="text-foreground/85 leading-relaxed italic text-[11px]">
                "{ev.timing_quote}"
              </p>
            </div>
          ) : null}

          {/* Source + confidence */}
          <div className="flex items-center gap-3 pt-1 text-[10px] text-muted">
            {ev.source_type ? (
              <span className="capitalize">{ev.source_type.replace(/_/g, " ")}</span>
            ) : null}
            {ev.source_date ? <span className="tabular-nums">{fmtDate(ev.source_date)}</span> : null}
            {ev.estimation_method ? (
              <span className="px-1 py-px rounded bg-[rgb(var(--border))]/15 text-[9px] font-medium">
                {ev.estimation_method.replace(/_/g, " ")}
              </span>
            ) : null}
            {ev.confidence != null ? (
              <span className="tabular-nums font-medium ml-auto">
                {it ? "Conf." : "Conf."} {Math.round(ev.confidence * 100)}%
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function pctTextColor(pct: number | null): string {
  const tone = priceVariationTone(pct);
  if (tone === "up") return "#059669";
  if (tone === "down") return "#E11D48";
  return "#5B6580";
}

export type { TimeWindowData };

export function rangeHorizonBtnClass(id: PriceVarChartRange, active: boolean): string {
  if (id === "cat6M") {
    return active
      ? "bg-amber-200 text-amber-950 shadow-sm ring-1 ring-amber-400/70"
      : "text-amber-800/80 hover:text-amber-950 hover:bg-amber-100/70 dark:text-amber-200/80 dark:hover:bg-amber-900/30";
  }
  return active
    ? "bg-[#7C6CF3] text-white shadow-sm"
    : "text-[#334155] hover:text-[#0B0D17] hover:bg-[#7C6CF3]/10";
}

export function rangeHorizonTip(id: PriceVarChartRange, it: boolean): string | undefined {
  if (id === "24h") {
    return it ? "Ultima sessione RTH (non 24h di calendario)" : "Last RTH session (not calendar 24h)";
  }
  if (id === "cat6M") {
    return it
      ? "Calendario catalyst: 6 mesi di prezzo + 6 mesi futuri con tag per ogni evento"
      : "Catalyst calendar: 6 months of price + next 6 months with a tag per event";
  }
  return undefined;
}
export function PriceVarChartRangeToolbar({
  range,
  onRangeChange,
  it,
  dense = false,
  narrow = false,
  className = "",
}: {
  range: PriceVarChartRange;
  onRangeChange: (range: PriceVarChartRange) => void;
  it: boolean;
  dense?: boolean;
  narrow?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-center gap-0.5 shrink-0 border-t border-[rgb(var(--border))]/25 pt-1${dense || narrow ? "" : " mt-0.5"}${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={it ? "Orizzonte grafico" : "Chart horizon"}
    >
      {PRICE_VAR_CHART_RANGE_ORDER.map((id) => (
        <button
          key={id}
          type="button"
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold tabular-nums transition ${rangeHorizonBtnClass(id, range === id)}`}
          onClick={() => onRangeChange(id)}
          aria-pressed={range === id}
          title={rangeHorizonTip(id, it)}
        >
          {id === "cat6M" ? "⚡ " : ""}
          {priceVarRangeLabel(id, it)}
        </button>
      ))}
    </div>
  );
}
