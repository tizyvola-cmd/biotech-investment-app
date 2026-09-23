import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ClinicalPreCdRecord, GuidanceCalendarEvent, VolumeHistoryBar } from "../api/supernova";
import { fetchIntraday1h } from "../api/supernova";
import {
  fetchOhlcvHistory,
  OHLCV_VOLUME_CHARACTER_MIN_DAYS,
} from "../sheet/ohlcvHistoryStore";
import { useT } from "../shared/i18n";
import type { IntradayPricePoint } from "../sheet/simUniverse24hWhatIf";
import { buildTickerEisDetail, type TickerEisEventDetail } from "../sheet/tickerEisSummary";
import { catalystEventStableId, useDismissedCatalystIds } from "../sheet/catalystEventDismiss";
import {
  buildDailyVolumeLineSeries,
  buildIntradayVolumeLineSeries,
  chartFuturePadDays,
  collectTickerChartCdIsos,
  ensureIsoTicksInSeries,
  fmtDailyLabel,
  futureChartPadIsos,
  guidanceEventAnchorIso,
  latestVolume,
  PRICE_VAR_CHART_CURSOR,
  PRICE_VAR_CHART_RANGE_ORDER,
  priceVarRangeLabel,
  resolveIntradaySessionTradingDate,
  rangeToCalendarCutoff,
  rangeToFetchDays,
  type PriceVarChartRange,
  type VolumeLinePoint,
} from "../sheet/priceVariationSeries";
import { lastDailyBarVolumeSurge, volumePlotCeiling } from "../sheet/volumeVsPrevSession";
import {
  classifyPeakAnomaly,
  VOLUME_CHARACTER_COLOR,
  volumeCharacterLabel,
  volumeCharacterTitle,
  type OhlcvBar,
  type VolumeCharacterResult,
} from "../sheet/volumeCharacter";
import { resolvePrimaryEisScore } from "../sheet/eventImpactScore";
import { maybeTriggerEisForHighVol } from "../sheet/volumeAccelEisTrigger";
import type { DecisionRec } from "../sheet/decisionChartLogic";
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
import { EisEventDetailModal } from "./EisEventDetailModal";
import { rangeHorizonBtnClass, rangeHorizonTip } from "./PriceVariationChart";
import { ChartIsoDateTick } from "./ChartIsoDateTick";

type VolumeChartRow = VolumeLinePoint & {
  eisEvents: TickerEisEventDetail[];
  eisPick: TickerEisEventDetail | null;
  highVolSearch: boolean;
  volumePlot: number | null;
  buyFill?: number | null;
  sellFill?: number | null;
};

const SOFT_BUY_FILL = "#16a34a";
const SOFT_SELL_FILL = "#dc2626";
const REC_BOUNDARY_STROKE = "#ca8a04";

const HIGH_VOL_RING = "#f97316";

/** Always pull enough sessions for RVOL median(t-20..t-1) even on short chart ranges. */
const VOLUME_CHARACTER_MIN_FETCH_DAYS = OHLCV_VOLUME_CHARACTER_MIN_DAYS;

const VOLUME_LINE = "#059669";
/** Ochre dashed baseline — last recorded volume in the visible window. */
const LAST_VOLUME_LINE = "#C9A227";
/** Published EIS day markers — sign of event score. */
const EIS_DOT_POS = { fill: "#A79AFF", stroke: "#7C6CF3" };
const EIS_DOT_NEG = { fill: "#F87185", stroke: "#E11D48" };
const EIS_DOT_NEUTRAL = { fill: "#94a3b8", stroke: "#5B6580" };

/** Band around 0 treated as neutral (slate), not sky. */
const EIS_DOT_NEUTRAL_ABS = 0.5;

export function eisVolumeDotColors(score: number | null | undefined): {
  fill: string;
  stroke: string;
} {
  if (score == null || !Number.isFinite(score)) return EIS_DOT_NEUTRAL;
  if (score < -EIS_DOT_NEUTRAL_ABS) return EIS_DOT_NEG;
  if (score > EIS_DOT_NEUTRAL_ABS) return EIS_DOT_POS;
  return EIS_DOT_NEUTRAL;
}

type EisVolumeDotProps = {
  cx?: number;
  cy?: number;
  payload?: VolumeChartRow;
  onPick: (ev: TickerEisEventDetail) => void;
};

/** Viola = EIS > +0.5 · rosso = EIS < −0.5 · slate = ~0 / chart-only. Orange ring = High Vol. */
function EisVolumeDot({ cx, cy, payload, onPick }: EisVolumeDotProps) {
  if (cx == null || cy == null || !payload) return null;
  const eis = payload.eisPick;
  const highVol = payload.highVolSearch;
  if (!eis && !highVol) return null;
  const chartOnly = Boolean(eis?.chartOnly);
  const eisColors = eis && !chartOnly
    ? eisVolumeDotColors(resolvePrimaryEisScore(eis.breakdown))
    : eis
      ? { fill: "transparent", stroke: EIS_DOT_NEUTRAL.stroke }
      : null;
  const clickable = Boolean(eis);
  /** Visible radius — slightly larger than before for easier targeting. */
  const visualR = eis ? 5.5 : 4.5;
  /** Invisible hit pad so the hand cursor / click are forgiving. */
  const hitR = 14;
  return (
    <g
      style={{
        cursor: clickable ? "pointer" : highVol ? "help" : "default",
        pointerEvents: "auto",
      }}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={
        clickable
          ? String(eis?.title || eis?.sourceLabel || "EIS news")
          : undefined
      }
      onClick={(e) => {
        if (!eis) return;
        e.stopPropagation();
        onPick(eis);
      }}
      onMouseDown={(e) => {
        // Keep click from being eaten by the Recharts tooltip / crosshair layer.
        if (eis) e.stopPropagation();
      }}
      onKeyDown={(e) => {
        if (!eis) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onPick(eis);
        }
      }}
    >
      {/* Larger transparent target — pad around the visible pallino */}
      <circle
        cx={cx}
        cy={cy}
        r={hitR}
        fill="transparent"
        stroke="none"
        style={{ pointerEvents: "all" }}
      />
      {highVol ? (
        <circle
          cx={cx}
          cy={cy}
          r={visualR + 3.5}
          fill="none"
          stroke={HIGH_VOL_RING}
          strokeWidth={2}
          style={{ pointerEvents: "none" }}
        />
      ) : null}
      {eis && eisColors ? (
        <circle
          cx={cx}
          cy={cy}
          r={visualR}
          fill={eisColors.fill}
          stroke={eisColors.stroke}
          strokeWidth={chartOnly ? 1.75 : 1.35}
          strokeDasharray={chartOnly ? "2.5 1.5" : undefined}
          style={{ pointerEvents: "none" }}
        />
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={visualR}
          fill={HIGH_VOL_RING}
          stroke="#fff"
          strokeWidth={1}
          style={{ pointerEvents: "none" }}
        />
      )}
    </g>
  );
}

function fmtVolume(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(Math.round(v));
}

function eventsByDate(
  events: TickerEisEventDetail[],
  tradingDates: string[],
): Map<string, TickerEisEventDetail[]> {
  const m = new Map<string, TickerEisEventDetail[]>();
  const sortedDates = [...tradingDates].sort();
  const first = sortedDates[0];
  const last = sortedDates[sortedDates.length - 1];
  for (const ev of events) {
    const d = ev.eventDate?.slice(0, 10);
    if (!d) continue;
    let target = d;
    if (!sortedDates.includes(d) && sortedDates.length) {
      const t = Date.parse(`${d}T12:00:00`);
      let best = sortedDates[0]!;
      let bestDt = Infinity;
      for (const td of sortedDates) {
        const dt = Math.abs(Date.parse(`${td}T12:00:00`) - t);
        if (dt < bestDt) {
          bestDt = dt;
          best = td;
        }
      }
      if (bestDt <= 3 * 24 * 60 * 60 * 1000) target = best;
    }
    if (first && last && (target < first || target > last)) continue;
    const list = m.get(target) ?? [];
    list.push(ev);
    m.set(target, list);
  }
  return m;
}

export function attachEisToVolumeRows(
  rows: Array<VolumeLinePoint & { volumePlot?: number | null }>,
  eisEvents: TickerEisEventDetail[],
  highVolDate: string | null,
): VolumeChartRow[] {
  const calendarDates = rows.map((r) => r.key.slice(0, 10));
  const byDate = eventsByDate(eisEvents, calendarDates);

  const lastIndexByDate = new Map<string, number>();
  rows.forEach((r, i) => {
    lastIndexByDate.set(r.key.slice(0, 10), i);
  });

  return rows.map((row, i) => {
    const date = row.key.slice(0, 10);
    const events = byDate.get(date) ?? [];
    const isLastOfDay = lastIndexByDate.get(date) === i;
    const eisPick = isLastOfDay && events.length > 0 ? events[0]! : null;
    const highVolSearch = Boolean(highVolDate && isLastOfDay && date === highVolDate);
    const inherited = row.volumePlot;
    let volumePlot: number | null =
      inherited !== undefined
        ? inherited
        : Number.isFinite(row.volume)
          ? row.volume
          : null;
    if (volumePlot == null && (eisPick || highVolSearch)) volumePlot = 0;
    return {
      ...row,
      eisEvents: events,
      eisPick,
      highVolSearch,
      volumePlot,
    };
  });
}

function VolumeTooltip({
  active,
  payload,
  it,
}: {
  active?: boolean;
  payload?: { payload?: VolumeChartRow }[];
  it: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-md border border-[rgb(var(--border))]/60 bg-surface px-2 py-1.5 text-[10px] shadow-sm max-w-[14rem]">
      <p className="font-semibold text-ink">{row.label}</p>
      <p className="text-ink-muted tabular-nums">
        {it ? "Volume" : "Volume"}: {fmtVolume(row.volume)}
      </p>
      {row.buyFill != null || row.sellFill != null ? (
        <p
          className="font-semibold mt-0.5"
          style={{ color: row.buyFill != null ? SOFT_BUY_FILL : SOFT_SELL_FILL }}
        >
          Rec: {row.buyFill != null ? "BUY" : "SELL"}
        </p>
      ) : null}
      {row.highVolSearch ? (
        <p className="mt-1 font-semibold text-orange-700 dark:text-orange-300">
          {it ? "High Vol — ricerca EIS avviata" : "High Vol — EIS search started"}
        </p>
      ) : null}
      {row.eisEvents.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {row.eisEvents.slice(0, 3).map((ev, i) => {
            const primary = resolvePrimaryEisScore(ev.breakdown);
            const tone = ev.chartOnly
              ? "text-ink-muted"
              : primary < -0.5
                ? "text-[#E11D48]"
                : primary > 0.5
                  ? "text-[#7C6CF3]"
                  : "text-[#5B6580]";
            return (
              <li key={`${ev.eventDate}-${i}`} className={`line-clamp-2 ${tone}`}>
                {ev.chartOnly
                  ? it
                    ? "EIS (ipotesi)"
                    : "EIS (anticipated)"
                  : `EIS ${primary >= 0 ? "+" : ""}${primary.toFixed(0)}`}
                {" · "}
                {ev.title}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function TickerVolumeEisChart({
  ticker,
  clinicalRecords,
  sheetClinicalKpi,
  simRow = null,
  lang = "it",
  height = 140,
  dense = false,
  narrow = false,
  range: rangeProp,
  onRangeChange,
  intradayPrior,
  intradayLive,
  intradayBatchLoading: _intradayBatchLoading = false,
  syncId,
  guidanceEvents = [],
  operationalRec = null,
  recHistoryKey = null,
  sharedOhlcvBars = null,
  sharedOhlcvLoading = false,
  sharedOhlcvError = null,
}: {
  ticker: string;
  clinicalRecords?: ClinicalPreCdRecord[];
  sheetClinicalKpi?: number | null;
  simRow?: Record<string, unknown> | null;
  lang?: "it" | "en";
  height?: number;
  dense?: boolean;
  narrow?: boolean;
  range?: PriceVarChartRange;
  onRangeChange?: (range: PriceVarChartRange) => void;
  intradayPrior?: IntradayPricePoint[];
  intradayLive?: IntradayPricePoint[];
  /** Parent batch in flight — defer per-card intraday fetch. */
  intradayBatchLoading?: boolean;
  /** Shared with the price chart — one dashed crosshair across both. */
  syncId?: string;
  /** Same events as the price chart — pads identical future X keys. */
  guidanceEvents?: GuidanceCalendarEvent[];
  /** Same Soft BUY/SELL as the price chart — under-curve fill on volume. */
  operationalRec?: DecisionRec | null;
  recHistoryKey?: string | null;
  /** Shared Yahoo daily from parent pair frame — skips duplicate OHLCV fetch. */
  sharedOhlcvBars?: VolumeHistoryBar[] | null;
  sharedOhlcvLoading?: boolean;
  sharedOhlcvError?: string | null;
}) {
  const t = useT();
  const it = lang === "it";
  const resolvedTicker = ticker.trim().toUpperCase();
  const dismissed = useDismissedCatalystIds();
  const [internalRange, setInternalRange] = useState<PriceVarChartRange>("24h");
  const range = rangeProp ?? internalRange;
  const setRange = (next: PriceVarChartRange) => {
    onRangeChange?.(next);
    if (rangeProp === undefined) setInternalRange(next);
  };
  const [bars, setBars] = useState<OhlcvBar[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedEis, setSelectedEis] = useState<TickerEisEventDetail | null>(null);
  const [tickerIntradayPrior, setTickerIntradayPrior] = useState<IntradayPricePoint[]>();
  const [tickerIntradayLive, setTickerIntradayLive] = useState<IntradayPricePoint[]>();
  const [recEpisodes, setRecEpisodes] = useState<OperationalRecEpisode[]>([]);
  const volumeFetchGenRef = useRef(0);
  const useSharedOhlcv = sharedOhlcvBars != null;

  const mapBars = (raw: VolumeHistoryBar[]): OhlcvBar[] =>
    raw
      .filter((b) => b.date && b.volume != null && Number(b.volume) > 0)
      .map((b) => {
        const row: OhlcvBar = {
          date: String(b.date).slice(0, 10),
          volume: Number(b.volume),
          close: b.close != null && Number(b.close) > 0 ? Number(b.close) : 0,
        };
        if (b.open != null && Number(b.open) > 0) row.open = Number(b.open);
        if (b.high != null && Number(b.high) > 0) row.high = Number(b.high);
        if (b.low != null && Number(b.low) > 0) row.low = Number(b.low);
        return row;
      });

  const effectiveTickerPrior = intradayPrior?.length ? intradayPrior : tickerIntradayPrior;
  const effectiveTickerLive = intradayLive?.length ? intradayLive : tickerIntradayLive;
  const plotH = height ?? (narrow ? 120 : dense ? 140 : 168);

  useEffect(() => {
    if (!useSharedOhlcv) return;
    setBars(mapBars(sharedOhlcvBars ?? []));
    setLoading(Boolean(sharedOhlcvLoading));
    setFetchError(sharedOhlcvError);
  }, [useSharedOhlcv, sharedOhlcvBars, sharedOhlcvLoading, sharedOhlcvError]);

  useEffect(() => {
    if (useSharedOhlcv) return;
    const gen = ++volumeFetchGenRef.current;
    setLoading(true);
    setFetchError(null);
    const chartDays = range === "24h" ? 3 : rangeToFetchDays(range);
    const days = Math.max(chartDays, VOLUME_CHARACTER_MIN_FETCH_DAYS);
    fetchOhlcvHistory(resolvedTicker, days)
      .then((doc) => {
        if (volumeFetchGenRef.current !== gen) return;
        if (doc.error && !doc.bars?.length) {
          setFetchError(doc.error);
          setBars([]);
          return;
        }
        setBars(mapBars(doc.bars ?? []));
      })
      .catch(() => {
        if (volumeFetchGenRef.current !== gen) return;
        setFetchError("fetch_failed");
        setBars([]);
      })
      .finally(() => {
        if (volumeFetchGenRef.current === gen) setLoading(false);
      });
  }, [resolvedTicker, range, useSharedOhlcv]);

  useEffect(() => {
    if (range !== "24h") return;
    if (intradayPrior?.length || intradayLive?.length) {
      setTickerIntradayPrior(undefined);
      setTickerIntradayLive(undefined);
      return;
    }
    let cancelled = false;
    void fetchIntraday1h([resolvedTicker])
      .then((payload) => {
        if (cancelled) return;
        setTickerIntradayPrior(
          payload.prior?.series?.[resolvedTicker] ?? payload.prior?.series?.[ticker],
        );
        setTickerIntradayLive(
          payload.live?.series?.[resolvedTicker] ??
            payload.live?.series?.[ticker] ??
            payload.series?.[resolvedTicker] ??
            payload.series?.[ticker],
        );
      })
      .catch(() => {
        if (!cancelled) {
          setTickerIntradayPrior(undefined);
          setTickerIntradayLive(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range, resolvedTicker, ticker, intradayPrior, intradayLive]);

  const eisEvents = useMemo(() => {
    const completionDate = simRow?.["Completion Date"];
    const detail = buildTickerEisDetail(
      resolvedTicker,
      lang,
      sheetClinicalKpi,
      clinicalRecords,
      completionDate,
    );
    return detail.events.filter((ev) => ev.eventDate);
  }, [resolvedTicker, lang, sheetClinicalKpi, clinicalRecords, simRow]);

  const baseSeries = useMemo((): VolumeLinePoint[] => {
    if (range === "24h") {
      const intraday = buildIntradayVolumeLineSeries({
        tickerPrior: effectiveTickerPrior,
        tickerLive: effectiveTickerLive,
        volumeBars: bars,
        it,
      });
      if (intraday.length >= 1) return intraday;
      return buildDailyVolumeLineSeries({
        volumeBars: bars,
        cutoffDate: rangeToCalendarCutoff("7d"),
        it,
      });
    }
    return buildDailyVolumeLineSeries({
      volumeBars: bars,
      cutoffDate: rangeToCalendarCutoff(range),
      it,
    });
  }, [range, bars, effectiveTickerPrior, effectiveTickerLive, it]);

  const lastBarSurge = useMemo(() => lastDailyBarVolumeSurge(bars), [bars]);

  const volumeCharacter = useMemo((): VolumeCharacterResult | null => {
    const eisDates = eisEvents.map((ev) => ev.eventDate).filter(Boolean) as string[];
    return classifyPeakAnomaly(bars, eisDates, 5, true);
  }, [bars, eisEvents]);

  useEffect(() => {
    if (!lastBarSurge.surge || !resolvedTicker) return;
    maybeTriggerEisForHighVol([resolvedTicker]);
  }, [lastBarSurge.surge, resolvedTicker]);

  const chartRows = useMemo(
    () => attachEisToVolumeRows(baseSeries, eisEvents, lastBarSurge.surge ? lastBarSurge.date : null),
    [baseSeries, eisEvents, lastBarSurge],
  );

  const lastVol = useMemo(() => latestVolume(chartRows), [chartRows]);

  const maxVolume = useMemo(() => {
    if (!chartRows.length) return null;
    const peak = Math.max(...chartRows.map((r) => r.volume));
    return Number.isFinite(peak) && peak > 0 ? peak : null;
  }, [chartRows]);

  const plotScale = useMemo(
    () => volumePlotCeiling(chartRows.map((r) => r.volume)),
    [chartRows],
  );

  const plotRows = useMemo(
    () =>
      chartRows.map((row) => ({
        ...row,
        volumePlot: Math.min(row.volume, plotScale.ceiling),
      })),
    [chartRows, plotScale.ceiling],
  );

  const chartCdIsos = useMemo(
    () =>
      collectTickerChartCdIsos(
        resolvedTicker,
        simRow ? simRow["Completion Date"] : null,
        clinicalRecords,
      ),
    [resolvedTicker, simRow, clinicalRecords],
  );

  const extendedPlotRows = useMemo(() => {
    if (range === "24h" || !plotRows.length) return plotRows;
    const lastKey = plotRows[plotRows.length - 1]!.key.slice(0, 10);
    const extras: string[] = [...chartCdIsos];
    for (const ev of guidanceEvents) {
      if (dismissed.has(catalystEventStableId({ ...ev, ticker: resolvedTicker }))) continue;
      const a = guidanceEventAnchorIso(ev);
      if (a) extras.push(a);
    }
    const futurePts = futureChartPadIsos(lastKey, chartFuturePadDays(range), extras).map((iso) => ({
      key: iso,
      label: fmtDailyLabel(iso, it),
      volume: 0,
      volumePlot: null as number | null,
    }));
    const padded = ensureIsoTicksInSeries([...plotRows, ...futurePts], extras, it);
    return attachEisToVolumeRows(
      padded,
      eisEvents,
      lastBarSurge.surge ? lastBarSurge.date : null,
    ).map((row) => ({
      ...row,
      volumePlot:
        row.volumePlot == null ? null : Math.min(row.volumePlot, plotScale.ceiling),
    }));
  }, [
    plotRows,
    range,
    it,
    guidanceEvents,
    chartCdIsos,
    dismissed,
    resolvedTicker,
    eisEvents,
    lastBarSurge,
    plotScale.ceiling,
  ]);

  useEffect(() => {
    setRecEpisodes(loadTickerOperationalRecEpisodes(resolvedTicker));
  }, [resolvedTicker]);

  const recAnchor = plotRows.length ? plotRows[plotRows.length - 1]! : null;

  useEffect(() => {
    if (!plotRows.length) return;
    const rawAsOf = recAnchor?.key;
    let stored: OperationalRecEpisode[];
    if (operationalRec != null && rawAsOf) {
      const asOf = clampRecIsoToSeries(rawAsOf, plotRows);
      const preferRaw =
        operationalRec === "buy" && recHistoryKey
          ? latestBuyStreakStartIso(recHistoryKey)
          : null;
      const preferStart = preferRaw ? clampRecIsoToSeries(preferRaw, plotRows) : null;
      stored = syncTickerOperationalRec(resolvedTicker, operationalRec, asOf, {
        preferStartIso: preferStart,
      });
    } else {
      stored = loadTickerOperationalRecEpisodes(resolvedTicker);
    }
    let next = mergeRecEpisodes(
      stored,
      recHistoryKey ? recEpisodesFromHistory(recHistoryKey) : [],
    );
    next = ensureOpenRecHasDrawableSpan(plotRows, next);
    next = ensureClosedRecEpisodesDrawable(plotRows, next);
    setRecEpisodes((prev) => (sameRecEpisodes(prev, next) ? prev : next));
  }, [resolvedTicker, operationalRec, recAnchor?.key, recHistoryKey, plotRows]);

  const recPlotRows = useMemo(() => {
    const fills = recFillForPoints(extendedPlotRows, recEpisodes, (row) =>
      row.volumePlot != null && Number.isFinite(row.volumePlot) ? row.volumePlot : null,
    );
    return extendedPlotRows.map((row, i) => ({
      ...row,
      buyFill: fills[i]?.buyFill ?? null,
      sellFill: fills[i]?.sellFill ?? null,
    }));
  }, [extendedPlotRows, recEpisodes]);

  const hasBuyFill = recPlotRows.some((r) => r.buyFill != null);
  const hasSellFill = recPlotRows.some((r) => r.sellFill != null);

  const recBoundaryRows = useMemo(() => {
    const marks = recBoundariesForPoints(plotRows, recEpisodes);
    const byKey = new Map(plotRows.map((r) => [r.key, r]));
    const seen = new Set<string>();
    const out: { x: string; kind: "start" | "end" }[] = [];
    for (const m of marks) {
      const row = byKey.get(m.pointKey);
      if (!row || seen.has(row.key)) continue;
      seen.add(row.key);
      out.push({ x: row.key, kind: m.kind });
    }
    return out;
  }, [plotRows, recEpisodes]);

  const lastVolPlot =
    lastVol != null ? Math.min(lastVol, plotScale.ceiling) : null;

  const rthSessionDate = useMemo(
    () =>
      range === "24h"
        ? resolveIntradaySessionTradingDate(effectiveTickerPrior, effectiveTickerLive)
        : null,
    [range, effectiveTickerPrior, effectiveTickerLive],
  );

  const hasData = chartRows.length >= 1;
  const hasDailyBars = bars.length >= 1;
  const chartLoading = !hasData && !hasDailyBars && loading;
  const showRangePills = rangeProp === undefined;

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
      {priceVarRangeLabel(id, it)}
    </button>
  );

  if (!hasData && !chartLoading) {
    return (
      <p className="text-xs text-ink-muted h-full flex items-center justify-center text-center px-2 leading-snug py-4">
        {t("sim.lossAnalysis.chart.volumeEis.empty")}
      </p>
    );
  }

  return (
    <>
      <div className={`w-full flex flex-col shrink-0${dense || narrow ? " gap-1" : " gap-1.5"}`}>
        <div className="flex flex-wrap items-center justify-end gap-2 px-0.5 shrink-0 text-ink-muted ml-auto">
          <span
            className={`inline-flex items-center gap-1 font-medium text-ink${dense ? " text-[9px]" : " text-[10px]"}`}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: VOLUME_LINE }}
            />
            {it ? "Volume" : "Volume"}
          </span>
          <span
            className={`inline-flex items-center gap-1 font-medium${dense ? " text-[9px]" : " text-[10px]"}`}
              title={
                it
                  ? "Viola = News > +0.5 · rosso = News < −0.5 · grigio = ~0"
                  : "Purple = News > +0.5 · red = News < −0.5 · slate = ~0"
              }
          >
            <span
              className="inline-block w-2 h-2 rounded-full border"
              style={{
                background: EIS_DOT_POS.fill,
                borderColor: EIS_DOT_POS.stroke,
              }}
            />
            <span
              className="inline-block w-2 h-2 rounded-full border"
              style={{
                background: EIS_DOT_NEUTRAL.fill,
                borderColor: EIS_DOT_NEUTRAL.stroke,
              }}
            />
            <span
              className="inline-block w-2 h-2 rounded-full border"
              style={{
                background: EIS_DOT_NEG.fill,
                borderColor: EIS_DOT_NEG.stroke,
              }}
            />
            News
          </span>
          {lastBarSurge.surge ? (
            <span
              className={`inline-flex items-center gap-1 font-medium${dense ? " text-[9px]" : " text-[10px]"}`}
              style={{ color: HIGH_VOL_RING }}
              title={
                it
                  ? "Spike di volume recente (vs sessione precedente ≥150%) — ricerca EIS avviata"
                  : "Recent volume spike (vs prior session ≥150%) — EIS search started"
              }
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full border-2 bg-transparent"
                style={{ borderColor: HIGH_VOL_RING }}
              />
              High Vol
            </span>
          ) : null}
          {volumeCharacter ? (
            <span
              className={`inline-flex items-center gap-1 font-medium${dense ? " text-[9px]" : " text-[10px]"}`}
              style={{ color: VOLUME_CHARACTER_COLOR[volumeCharacter.tag] }}
              title={volumeCharacterTitle(volumeCharacter, it)}
            >
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ background: VOLUME_CHARACTER_COLOR[volumeCharacter.tag] }}
              />
              {volumeCharacterLabel(volumeCharacter.tag, it)}
              {volumeCharacter.rvol != null ? (
                <span className="tabular-nums opacity-80">
                  {volumeCharacter.extremeVol ? "E" : "R"}
                  {volumeCharacter.rvol.toFixed(1)}×
                </span>
              ) : null}
            </span>
          ) : null}
          {lastVol != null ? (
            <span
              className={`inline-flex items-center gap-1 font-medium tabular-nums${dense ? " text-[9px]" : " text-[10px]"}`}
              style={{ color: LAST_VOLUME_LINE }}
              title={it ? "Ultimo volume registrato" : "Last recorded volume"}
            >
              <span
                className="inline-block w-3 border-t border-dashed"
                style={{ borderColor: LAST_VOLUME_LINE }}
              />
              {fmtVolume(lastVol)}
            </span>
          ) : null}
        </div>

        <div className="relative shrink-0" style={{ height: plotH + (range === "24h" ? 0 : 20), minHeight: plotH + (range === "24h" ? 0 : 20) }}>
          {chartLoading && !hasData ? (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] text-ink-muted">
              {t("sim.lossAnalysis.chart.volumeEis.loading")}
            </div>
          ) : fetchError && !hasData ? (
            <div className="absolute inset-0 flex items-center justify-center text-[10px] text-ink-muted text-center px-2">
              {t("sim.lossAnalysis.chart.volumeEis.empty")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={recPlotRows}
                margin={{ top: 10, right: 52, bottom: range === "24h" ? 2 : 22, left: 6 }}
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
                  tickFormatter={fmtVolume}
                  domain={[0, plotScale.ceiling]}
                />
                <Tooltip cursor={PRICE_VAR_CHART_CURSOR} content={<VolumeTooltip it={it} />} />
                {hasBuyFill ? (
                  <Area
                    type="linear"
                    dataKey="buyFill"
                    stroke="none"
                    fill={SOFT_BUY_FILL}
                    fillOpacity={0.28}
                    baseValue={0}
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
                    baseValue={0}
                    connectNulls={false}
                    isAnimationActive={false}
                    legendType="none"
                    dot={false}
                    activeDot={false}
                  />
                ) : null}
                <Line
                  type="linear"
                  dataKey="volumePlot"
                  stroke={VOLUME_LINE}
                  strokeWidth={2}
                  dot={(props: EisVolumeDotProps) => (
                    <EisVolumeDot {...props} onPick={(ev) => setSelectedEis(ev)} />
                  )}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                />
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
                {lastVolPlot != null ? (
                  <ReferenceLine
                    y={lastVolPlot}
                    stroke={LAST_VOLUME_LINE}
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                  />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {showRangePills ? (
          <div
            className={`flex flex-wrap items-center justify-center gap-0.5 shrink-0${dense || narrow ? " pt-0" : " pt-0.5"}`}
          >
            {PRICE_VAR_CHART_RANGE_ORDER.map(rangeBtn)}
          </div>
        ) : null}

        {maxVolume != null ? (
          <div
            className={`flex flex-wrap items-center justify-center gap-x-2 gap-y-0 text-[10px] tabular-nums font-semibold shrink-0 text-ink-muted${dense || narrow ? "" : " border-t border-[rgb(var(--border))]/20 pt-1"}`}
          >
            <span>
              {it ? "Max" : "Max"} {fmtVolume(maxVolume)}
              {plotScale.clipped
                ? it
                  ? " · scala ritagliata (outlier)"
                  : " · scale clipped (outlier)"
                : ""}
            </span>
            {range === "24h" ? (
              <span className="font-normal opacity-80">
                {it
                  ? `volume sessione RTH${rthSessionDate ? ` · ${rthSessionDate}` : ""} (non 24h calendario)`
                  : `RTH session volume${rthSessionDate ? ` · ${rthSessionDate}` : ""} (not calendar 24h)`}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {selectedEis ? (
        <EisEventDetailModal
          ev={selectedEis}
          ticker={resolvedTicker}
          it={it}
          onClose={() => setSelectedEis(null)}
        />
      ) : null}
    </>
  );
}
