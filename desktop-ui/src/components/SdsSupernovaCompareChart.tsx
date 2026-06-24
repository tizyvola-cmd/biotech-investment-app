import { useCallback, useMemo, useState } from "react";
import {
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtAxisPctTick } from "../sheet/chartAxisFormat";
import {
  CHART_LAB_AXIS_TICK,
  CHART_LAB_GRID,
  CHART_LAB_PANEL,
} from "../sheet/chartTheme";
import { renderCdZones } from "../sheet/chartCdZones";
import type { NowOffsetMarker } from "../sheet/chartNowOffset";
import { pickSparseCalTickOffsets } from "../sheet/chartNowOffset";
import { calendarOffsetsForValueCount } from "../sheet/chartNodes";
import { assessmentChartOffsetsForNow } from "../sheet/predictionCurveGrid";
import { ChartNowPinLabel } from "../sheet/nowTimelineMarker";
import {
  HISTORY_CASES,
  HISTORY_MEAN_PEAK_ROI,
  SUPERNova_HISTORY_CURVE,
  SUPERNova_MEAN_COLOR,
  SUPERNova_OFFSETS,
  supernovaOffsetLabel,
  type HistoryCaseId,
} from "../sheet/sdsHistoryCurve";
import { interpolateAtOffset } from "../sheet/chartNowOffset";
import {
  formatEstRoiPct,
  formatEstRoiSigned,
  formatOverlayPeakLabel,
  type SdsBlendOverlayCurve,
  type SdsOverlayCurve,
} from "../sheet/sdsCompareOverlay";
import {
  ROI_STANDARD_OFFSETS,
  SDS_REF_PROFILE_LABELS,
  SDS_ROI_PROFILES,
  type SdsRoiProfileId,
} from "../sheet/sdsRoiBlend";
import { useT, useLang } from "../shared/i18n";

const POST_REF_IDS = ["post_rialzo", "post_ribasso", "post_neutro", "cluster0"] as const;

/** Post-CD reference lines — semantic colors on white chart. */
const COMPARE_POST_REF_COLORS: Partial<Record<SdsRoiProfileId, string>> = {
  post_rialzo: "#00c896",
  post_ribasso: "#ef4444",
  post_neutro: "#94a3b8",
  cluster0: "#9ca3af",
};

function refDataKey(id: SdsRoiProfileId): string {
  return `ref_${id}`;
}

function overlayDataKey(ticker: string): string {
  return `ovl_${ticker.toUpperCase()}`;
}

function blendDataKey(ticker: string): string {
  return `blend_${ticker.toUpperCase()}`;
}

const BLEND_TABLE_KNOTS = new Set<number>(ROI_STANDARD_OFFSETS);

function peakLabelPlacement(
  peakOffset: number,
  nowOffsets: number[],
): { dy: number; dx: number; anchor: "start" | "middle" | "end" } {
  const nearNow = nowOffsets.some((n) => Math.abs(n - peakOffset) < 14);
  const rightCluster = peakOffset >= -12;
  if (rightCluster) {
    return {
      dy: nearNow ? 14 : 12,
      dx: 6,
      anchor: "start",
    };
  }
  return { dy: -8, dx: 0, anchor: "middle" };
}

const REFERENCE_IDS = ["mean", ...HISTORY_CASES.map((c) => c.id)] as const;
type ReferenceId = (typeof REFERENCE_IDS)[number];
type SeriesId = ReferenceId | `ovl_${string}`;

function computeYDomain(
  rows: Record<string, number | string>[],
  visibleKeys: string[],
): [number, number] {
  if (!visibleKeys.length) return [0, 20];

  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    for (const key of visibleKeys) {
      const raw = row[key];
      if (raw == null || raw === "") continue;
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 20];

  const span = max - min;
  const pad = Math.max(2, span * 0.15);
  let yMin = min - pad;
  let yMax = max + pad;
  if (yMin > 0 && min >= 0) yMin = 0;
  if (yMax <= yMin) yMax = yMin + 10;

  const step = span > 80 ? 20 : span > 30 ? 10 : span > 10 ? 5 : 2;
  yMin = Math.floor(yMin / step) * step;
  yMax = Math.ceil(yMax / step) * step;
  return [yMin, yMax];
}

type Props = {
  overlayCurves?: SdsOverlayCurve[];
  /** SDS-calibrated μ blend — one per active ticker overlay. */
  blendOverlays?: SdsBlendOverlayCurve[];
  onRemoveOverlay?: (ticker: string) => void;
  compact?: boolean;
  /** Solo curve company (pred + blend); benchmark e Post-CD nascosti all'avvio. */
  companyFocus?: boolean;
  /** Incorporato in card esterna — senza bordo/titolo duplicato. */
  embedded?: boolean;
  /** Segnalibro «oggi» rispetto al CD (offset calendario). */
  nowMarkers?: NowOffsetMarker[];
  /** μ Post-CD / cluster 0 from Prediction Guide. */
  refCurves?: Partial<Record<SdsRoiProfileId, (number | null)[]>>;
  /** Post-CD refs shown on first paint (e.g. post_rialzo in 24h assessment). */
  defaultVisiblePostRefs?: (typeof POST_REF_IDS)[number][];
  /** Solo area grafico — niente toggle/legenda (tile 24h assessment). */
  chartOnly?: boolean;
};

function initialHiddenSeries(
  companyFocus: boolean,
  defaultVisiblePostRefs: (typeof POST_REF_IDS)[number][] = [],
): Set<string> {
  if (!companyFocus) return new Set();
  const next = new Set<string>();
  next.add("mean");
  for (const c of HISTORY_CASES) next.add(c.id);
  const visiblePost = new Set(defaultVisiblePostRefs);
  for (const rid of POST_REF_IDS) {
    if (!visiblePost.has(rid)) next.add(refDataKey(rid));
  }
  return next;
}

/** μ SuperNova vs historical surges + Post-CD refs + cohort overlays. */
export function SdsSupernovaCompareChart({
  overlayCurves = [],
  blendOverlays = [],
  onRemoveOverlay,
  compact = false,
  companyFocus = false,
  embedded = false,
  nowMarkers = [],
  refCurves = {},
  defaultVisiblePostRefs = [],
  chartOnly = false,
}: Props) {
  const t = useT();
  const { lang } = useLang();
  const tileChart = chartOnly;
  const mainLineW = tileChart ? 1.85 : 2.5;
  const secondaryLineW = tileChart ? 1.5 : 1.75;
  const blendLineW = tileChart ? 1.65 : 2;
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() =>
    initialHiddenSeries(companyFocus, defaultVisiblePostRefs),
  );

  const isVisible = useCallback((id: string) => !hiddenSeries.has(id), [hiddenSeries]);

  const toggleSeries = useCallback((id: SeriesId) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const showAllReference = useCallback(() => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      for (const id of REFERENCE_IDS) next.delete(id);
      return next;
    });
  }, []);

  const hideAllReference = useCallback(() => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      for (const id of REFERENCE_IDS) next.add(id);
      return next;
    });
  }, []);

  const referenceHidden = REFERENCE_IDS.every((id) => hiddenSeries.has(id));

  const availablePostRefs = useMemo(
    () => POST_REF_IDS.filter((id) => (refCurves[id]?.filter((v) => v != null).length ?? 0) >= 3),
    [refCurves],
  );

  const chartOffsets = useMemo((): readonly number[] => {
    const extended =
      overlayCurves.some((o) => o.values.length > SUPERNova_OFFSETS.length) ||
      blendOverlays.some((b) => b.values.length > SUPERNova_OFFSETS.length);
    const nowOff = nowMarkers.length ? nowMarkers[0]!.offset : null;
    const base = extended ? assessmentChartOffsetsForNow(nowOff) : SUPERNova_OFFSETS;
    const merged = new Set<number>(base);
    for (const m of nowMarkers) merged.add(m.offset);
    for (const ovl of overlayCurves) {
      for (const off of ovl.offsets ?? []) merged.add(off);
    }
    return [...merged].sort((a, b) => a - b);
  }, [overlayCurves, blendOverlays, nowMarkers]);

  const data = useMemo(() => {
    return chartOffsets.map((off) => {
      const histIdx = SUPERNova_OFFSETS.indexOf(off as (typeof SUPERNova_OFFSETS)[number]);
      const hist = histIdx >= 0 ? SUPERNova_HISTORY_CURVE[histIdx] : null;
      const row: Record<string, number | string> = {
        label: supernovaOffsetLabel(off),
        offset: off,
        mean: hist?.supernovaMean ?? (Number.NaN as unknown as number),
      };
      for (const c of HISTORY_CASES) {
        row[c.id] = hist ? (hist[c.curveKey] ?? 0) : (Number.NaN as unknown as number);
      }
      for (const rid of availablePostRefs) {
        const refVals = refCurves[rid];
        if (histIdx >= 0) {
          row[refDataKey(rid)] = refVals?.[histIdx] ?? 0;
        } else if (refVals?.length) {
          const series = SUPERNova_OFFSETS.map((o, j) => ({ offset: o, y: refVals[j] ?? 0 }));
          const v = interpolateAtOffset(series, off, { extrapolate: true });
          row[refDataKey(rid)] = v ?? (Number.NaN as unknown as number);
        } else {
          row[refDataKey(rid)] = Number.NaN as unknown as number;
        }
      }
      for (const ovl of overlayCurves) {
        const ovlOffsets = ovl.offsets ?? calendarOffsetsForValueCount(ovl.values.length);
        const ovlIdx = ovlOffsets.indexOf(off);
        if (ovlIdx >= 0) {
          row[overlayDataKey(ovl.ticker)] = ovl.values[ovlIdx] ?? 0;
        } else {
          const series = ovlOffsets.map((o, i) => ({ offset: o, y: ovl.values[i] ?? 0 }));
          const v = interpolateAtOffset(series, off, { extrapolate: true });
          row[overlayDataKey(ovl.ticker)] =
            v != null && Number.isFinite(v) ? v : (Number.NaN as unknown as number);
        }
      }
      for (const blend of blendOverlays) {
        const blendOffsets = blend.offsets ?? calendarOffsetsForValueCount(blend.values.length);
        const blendIdx = blendOffsets.indexOf(off);
        let v: number | null = null;
        if (blendIdx >= 0) {
          v = blend.values[blendIdx] ?? null;
        } else {
          const series = blendOffsets
            .map((o, i) => ({ offset: o, y: blend.values[i] }))
            .filter((p): p is { offset: number; y: number } => p.y != null && Number.isFinite(p.y));
          v = interpolateAtOffset(series, off, { extrapolate: true });
        }
        row[blendDataKey(blend.ticker)] =
          v != null && Number.isFinite(v) ? v : (Number.NaN as unknown as number);
      }
      return row;
    });
  }, [overlayCurves, blendOverlays, refCurves, availablePostRefs, chartOffsets]);

  const visibleKeys = useMemo(() => {
    const keys: string[] = [];
    if (isVisible("mean")) keys.push("mean");
    for (const c of HISTORY_CASES) {
      if (isVisible(c.id)) keys.push(c.id);
    }
    for (const ovl of overlayCurves) {
      const key = overlayDataKey(ovl.ticker);
      if (isVisible(key)) keys.push(key);
    }
    for (const rid of availablePostRefs) {
      const key = refDataKey(rid);
      if (isVisible(key)) keys.push(key);
    }
    for (const blend of blendOverlays) {
      const key = blendDataKey(blend.ticker);
      if (isVisible(key)) keys.push(key);
    }
    return keys;
  }, [overlayCurves, blendOverlays, isVisible, availablePostRefs]);

  const yDomain = useMemo(() => computeYDomain(data, visibleKeys), [data, visibleKeys]);

  const xDomain = useMemo((): [number, number] => {
    const offs = [...chartOffsets, ...nowMarkers.map((m) => m.offset)];
    return [Math.min(...offs), Math.max(...offs)];
  }, [chartOffsets, nowMarkers]);

  const nowOffsets = useMemo(() => nowMarkers.map((m) => m.offset), [nowMarkers]);

  const xTicks = useMemo(
    () => pickSparseCalTickOffsets(chartOffsets, nowOffsets, compact ? 11 : 10),
    [chartOffsets, nowOffsets, compact],
  );

  const filterBtnClass = (visible: boolean, active?: boolean) =>
    `rounded px-2 py-0.5 text-[10px] font-medium border bg-white/80 transition ${
      visible
        ? active
          ? "border-[#3b82f6] text-ink shadow-sm"
          : "border-[#e2e8f0] text-ink-muted hover:border-[#93c5fd]"
        : "border-[#e2e8f0]/60 text-ink-muted/45 line-through opacity-50"
    }`;

  return (
    <section
      className={
        chartOnly
          ? "h-full w-full min-h-0"
          : embedded
            ? "space-y-2"
            : "rounded-xl border border-slate-200/90 bg-white p-3 space-y-3 shadow-sm"
      }
    >
      {!chartOnly && !embedded ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="text-xs font-semibold text-ink">{t("decisionLab.sds.compareChart.title")}</h4>
            <p className="text-[10px] text-ink-muted mt-0.5 max-w-2xl">
              {t("decisionLab.sds.compareChart.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap gap-1 max-w-xl justify-end">
            <button
              type="button"
              className={filterBtnClass(!referenceHidden, !referenceHidden)}
              onClick={showAllReference}
              title={t("decisionLab.sds.compareChart.showReferenceTip")}
            >
              {t("decisionLab.sds.compareChart.all")}
            </button>
            <button
              type="button"
              className={`rounded px-2 py-0.5 text-[10px] font-medium border transition ${
                referenceHidden
                  ? "border-[#3b82f6] bg-[#3b82f6]/10 text-[#1e40af] shadow-sm"
                  : "border-[#e2e8f0] bg-white/80 text-ink-muted hover:border-[#93c5fd]"
              }`}
              onClick={hideAllReference}
              title={t("decisionLab.sds.compareChart.onlyOverlaysTip")}
            >
              {t("decisionLab.sds.compareChart.onlyOverlays")}
            </button>
            <button
              type="button"
              className={filterBtnClass(isVisible("mean"))}
              style={isVisible("mean") ? { color: SUPERNova_MEAN_COLOR } : undefined}
              onClick={() => toggleSeries("mean")}
              title={t("decisionLab.sds.compareChart.toggleSeriesTip")}
            >
              μ +{HISTORY_MEAN_PEAK_ROI.toFixed(0)}%
            </button>
            {HISTORY_CASES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={filterBtnClass(isVisible(c.id))}
                style={isVisible(c.id) ? { color: c.color } : undefined}
                onClick={() => toggleSeries(c.id)}
                title={t("decisionLab.sds.compareChart.toggleSeriesTip")}
              >
                {c.ticker} +{c.peakRoi.toFixed(0)}%
              </button>
            ))}
            {availablePostRefs.map((rid) => (
              <button
                key={rid}
                type="button"
                className={filterBtnClass(isVisible(refDataKey(rid)))}
                style={isVisible(refDataKey(rid)) ? { color: COMPARE_POST_REF_COLORS[rid] } : undefined}
                onClick={() => toggleSeries(refDataKey(rid) as SeriesId)}
                title={t("decisionLab.sds.compareChart.postRefTitle")}
              >
                {SDS_REF_PROFILE_LABELS[rid]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {!chartOnly && embedded ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted mr-0.5">
            {t("sim.lossAnalysis.chart.overlayToggles")}
          </span>
          {companyFocus ? (
            <button
              type="button"
              className={filterBtnClass(!referenceHidden)}
              onClick={referenceHidden ? showAllReference : hideAllReference}
              title={t("decisionLab.sds.compareChart.showReferenceTip")}
            >
              {referenceHidden
                ? t("sim.lossAnalysis.chart.showBenchmarks")
                : t("sim.lossAnalysis.chart.hideBenchmarks")}
            </button>
          ) : null}
          {availablePostRefs.map((rid) => (
            <button
              key={rid}
              type="button"
              className={filterBtnClass(isVisible(refDataKey(rid)))}
              style={isVisible(refDataKey(rid)) ? { color: COMPARE_POST_REF_COLORS[rid] } : undefined}
              onClick={() => toggleSeries(refDataKey(rid) as SeriesId)}
              title={t("decisionLab.sds.compareChart.postRefTitle")}
            >
              {SDS_REF_PROFILE_LABELS[rid]}
            </button>
          ))}
        </div>
      ) : null}

      {!chartOnly && !embedded && availablePostRefs.length > 0 ? (
        <p className="text-[9px] text-ink-muted">{t("decisionLab.sds.compareChart.postRefTitle")}</p>
      ) : null}

      {!chartOnly ? (
      <div className="flex flex-wrap gap-2 text-[10px]">
        {!embedded ? (
          <>
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 border transition ${
                isVisible("mean")
                  ? "bg-[#fefce8]/90 border-[#eab308]/40 hover:bg-[#fefce8]"
                  : "bg-white/40 border-[#e2e8f0]/50 opacity-50 line-through"
              }`}
              onClick={() => toggleSeries("mean")}
            >
              <span className="w-3 h-0.5 rounded" style={{ background: SUPERNova_MEAN_COLOR }} />
              <span className="font-medium" style={{ color: "#a16207" }}>
                μ SuperNova
              </span>
              <span className="font-semibold tabular-nums" style={{ color: SUPERNova_MEAN_COLOR }}>
                peak +{HISTORY_MEAN_PEAK_ROI.toFixed(1)}%
              </span>
            </button>
            {HISTORY_CASES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 border transition ${
                  isVisible(c.id)
                    ? "bg-white/70 border-[#93c5fd]/50 hover:bg-white"
                    : "bg-white/40 border-[#e2e8f0]/50 opacity-50 line-through"
                }`}
                onClick={() => toggleSeries(c.id as HistoryCaseId)}
              >
                <span className="w-3 h-0.5 rounded" style={{ background: c.color }} />
                <span className="font-medium" style={{ color: c.color }}>
                  {c.ticker}
                </span>
                <span className="tabular-nums text-ink-muted">ROI +{c.peakRoi.toFixed(1)}%</span>
              </button>
            ))}
            {availablePostRefs.map((rid) => {
              const key = refDataKey(rid);
              const color = COMPARE_POST_REF_COLORS[rid] ?? "#64748b";
              return (
                <button
                  key={rid}
                  type="button"
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 border transition ${
                    isVisible(key)
                      ? "bg-white/70 border-[#93c5fd]/50 hover:bg-white"
                      : "bg-white/40 border-[#e2e8f0]/50 opacity-50 line-through"
                  }`}
                  onClick={() => toggleSeries(key as SeriesId)}
                >
                  <span className="w-3 h-0.5 rounded" style={{ background: color }} />
                  <span className="font-medium text-[10px]" style={{ color }}>
                    {SDS_REF_PROFILE_LABELS[rid]}
                  </span>
                </button>
              );
            })}
          </>
        ) : null}
        {overlayCurves.map((ovl) => {
          const key = overlayDataKey(ovl.ticker);
          const blendKey = blendDataKey(ovl.ticker);
          const blend = blendOverlays.find((b) => b.ticker === ovl.ticker);
          const absSeries = SUPERNova_OFFSETS.map((off, i) => ({
            offset: off,
            y: ovl.values[i] ?? 0,
          }));
          const absAtPeak = interpolateAtOffset(absSeries, ovl.peakOffset);
          const peakLabel = formatOverlayPeakLabel(
            ovl.peakRoi,
            ovl.peakOffset,
            ovl.peakKind,
            lang,
          );
          return (
            <span
              key={ovl.ticker}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 border border-dashed ${
                isVisible(key) ? "bg-white/90" : "bg-white/50 opacity-50"
              }`}
              style={{ borderColor: ovl.color }}
            >
              <button
                type="button"
                className="inline-flex items-center gap-1"
                onClick={() => toggleSeries(key as SeriesId)}
                title={t("decisionLab.sds.compareChart.overlayPeakTooltip", {
                  label: peakLabel,
                  level: absAtPeak != null ? fmtAxisPctTick(absAtPeak) : "—",
                  offset: supernovaOffsetLabel(ovl.peakOffset),
                })}
              >
                <span className="w-3 h-0.5 rounded" style={{ background: ovl.color }} />
                <span className="font-semibold" style={{ color: ovl.color }}>
                  {ovl.ticker}
                </span>
                <span className="tabular-nums font-semibold" style={{ color: ovl.color }}>
                  {peakLabel}
                </span>
              </button>
              {blend ? (
                <button
                  type="button"
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 border border-dotted transition ${
                    isVisible(blendKey) ? "bg-white/80" : "opacity-45 line-through"
                  }`}
                  style={{ borderColor: blend.color }}
                  onClick={() => toggleSeries(blendKey as SeriesId)}
                  title={t("decisionLab.sds.compareChart.blendCurveTooltip")}
                >
                  <span
                    className="w-3 h-0.5 rounded"
                    style={{
                      background: blend.color,
                      backgroundImage: `repeating-linear-gradient(90deg, ${blend.color} 0 3px, transparent 3px 6px)`,
                    }}
                  />
                  <span className="font-medium text-[9px]" style={{ color: blend.color }}>
                    {t("decisionLab.sds.compareChart.blendCurveShort", { ticker: ovl.ticker })}
                  </span>
                </button>
              ) : null}
              {onRemoveOverlay ? (
                <button
                  type="button"
                  className="ml-0.5 text-ink-muted hover:text-ink leading-none"
                  onClick={() => onRemoveOverlay(ovl.ticker)}
                  aria-label={`Remove ${ovl.ticker}`}
                >
                  ×
                </button>
              ) : null}
            </span>
          );
        })}
        {embedded
          ? defaultVisiblePostRefs
              .filter((rid) => availablePostRefs.includes(rid))
              .map((rid) => {
                const key = refDataKey(rid);
                const color = COMPARE_POST_REF_COLORS[rid] ?? "#64748b";
                return (
                  <button
                    key={key}
                    type="button"
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 border transition ${
                      isVisible(key)
                        ? "bg-white/70 border-[#93c5fd]/50 hover:bg-white"
                        : "bg-white/40 border-[#e2e8f0]/50 opacity-50 line-through"
                    }`}
                    onClick={() => toggleSeries(key as SeriesId)}
                    title={t("decisionLab.sds.compareChart.postRefTitle")}
                  >
                    <span
                      className="w-3 h-0.5 rounded"
                      style={{ background: color, backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` }}
                    />
                    <span className="font-medium text-[10px]" style={{ color }}>
                      {SDS_REF_PROFILE_LABELS[rid]}
                    </span>
                  </button>
                );
              })
          : null}
      </div>
      ) : null}

      {!chartOnly && overlayCurves.length > 0 ? (
        <p className="text-[9px] text-ink-muted/85 leading-snug max-w-3xl">
          {t("decisionLab.sds.compareChart.roiLegend")}
        </p>
      ) : null}

      {!chartOnly && visibleKeys.length > 0 ? (
        <p className="text-[9px] text-ink-muted/80 tabular-nums">
          {t("decisionLab.sds.compareChart.yAxisAuto", {
            min: yDomain[0].toFixed(0),
            max: yDomain[1].toFixed(0),
          })}
        </p>
      ) : null}

      <div
        className={`${
          chartOnly ? "h-full min-h-[200px]" : compact ? "h-[200px]" : "h-[260px]"
        } w-full ${chartOnly ? "" : CHART_LAB_PANEL} ${chartOnly ? "" : "p-2"}`}
      >
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          <LineChart
            data={data}
            margin={{
              top: nowMarkers.length ? (embedded ? 18 : 22) : 14,
              right: embedded ? 36 : 28,
              left: 4,
              bottom: 2,
            }}
          >
            <CartesianGrid {...CHART_LAB_GRID} />
            {renderCdZones({ cdX: 0, xMin: xDomain[0], xMax: xDomain[1] })}
            <XAxis
              dataKey="offset"
              type="number"
              domain={xDomain}
              ticks={xTicks}
              tick={CHART_LAB_AXIS_TICK}
              tickFormatter={(v) => supernovaOffsetLabel(Number(v))}
              interval={0}
              angle={compact ? -20 : -25}
              textAnchor="end"
              height={compact ? 40 : 44}
            />
            <YAxis
              domain={yDomain}
              tick={CHART_LAB_AXIS_TICK}
              tickFormatter={(v) => fmtAxisPctTick(Number(v))}
              width={52}
            />
            <Tooltip
              formatter={(v: number, name: string, item: { payload?: { offset?: number } }) => {
                if (name === "mean") return [`${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, "μ SuperNova"];
                const hist = HISTORY_CASES.find((c) => c.id === name);
                if (hist) return [`${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, `${hist.ticker} (peak +${hist.peakRoi.toFixed(0)}%)`];
                const postRef = SDS_ROI_PROFILES.find((id) => refDataKey(id) === name);
                if (postRef) {
                  return [`${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, SDS_REF_PROFILE_LABELS[postRef]];
                }
                const ovl = overlayCurves.find((o) => overlayDataKey(o.ticker) === name);
                if (ovl) {
                  const off = Number(item?.payload?.offset);
                  const knotIdx = SUPERNova_OFFSETS.indexOf(off as (typeof SUPERNova_OFFSETS)[number]);
                  const abs = knotIdx >= 0 ? ovl.values[knotIdx] : undefined;
                  return [
                    `${fmtAxisPctTick(v)}%`,
                    abs != null
                      ? `${ovl.ticker} · ${fmtAxisPctTick(abs)}% vs T−60`
                      : `${ovl.ticker} (% vs T−60)`,
                  ];
                }
                const blend = blendOverlays.find((b) => blendDataKey(b.ticker) === name);
                if (blend) {
                  const off = Number(item?.payload?.offset);
                  const tableKnot = BLEND_TABLE_KNOTS.has(off)
                    ? ` · ${t("decisionLab.sds.compareChart.blendTableKnot")}`
                    : "";
                  return [
                    `${fmtAxisPctTick(v)}%`,
                    `${t("decisionLab.sds.compareChart.blendCurveLabel", { ticker: blend.ticker })}${tableKnot}`,
                  ];
                }
                return [`${v >= 0 ? "+" : ""}${v.toFixed(1)}%`, name];
              }}
              labelFormatter={(l) => `${supernovaOffsetLabel(Number(l))} vs T−60`}
              contentStyle={{
                fontSize: 11,
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
              }}
            />
            {nowMarkers.map((m, i) => (
              <ReferenceLine
                key={`now-${m.offset}-${m.label}-${i}`}
                x={m.offset}
                stroke="none"
                ifOverflow="extendDomain"
                label={
                  <ChartNowPinLabel text={m.label} />
                }
              />
            ))}
            {companyFocus ? (
              <ReferenceLine x={-3} stroke="#2563eb" strokeDasharray="4 4" />
            ) : (
              <ReferenceLine
                x={-3}
                stroke="#2563eb"
                strokeDasharray="4 4"
                label={{
                  value: t("decisionLab.sds.history.cdMarker"),
                  position: "insideTopRight",
                  fontSize: 9,
                  fill: "#2563eb",
                }}
              />
            )}
            {isVisible("mean") ? (
              <Line
                type="monotone"
                dataKey="mean"
                name="mean"
                stroke={SUPERNova_MEAN_COLOR}
                strokeWidth={mainLineW}
                dot={{ r: 2, fill: SUPERNova_MEAN_COLOR }}
                isAnimationActive={false}
              />
            ) : null}
            {HISTORY_CASES.map((c) =>
              isVisible(c.id) ? (
                <Line
                  key={c.id}
                  type="monotone"
                  dataKey={c.id}
                  name={c.id}
                  stroke={c.color}
                  strokeWidth={1.5}
                  dot={{ r: 2, fill: c.color }}
                  isAnimationActive={false}
                />
              ) : null,
            )}
            {availablePostRefs.map((rid) => {
              const key = refDataKey(rid);
              if (!isVisible(key)) return null;
              const color = COMPARE_POST_REF_COLORS[rid] ?? "#64748b";
              return (
                <Line
                  key={rid}
                  type="monotone"
                  dataKey={key}
                  name={key}
                  stroke={color}
                  strokeWidth={secondaryLineW}
                  strokeDasharray="4 3"
                  dot={{ r: 2, fill: color }}
                  isAnimationActive={false}
                />
              );
            })}
            {overlayCurves.map((ovl) => {
              const key = overlayDataKey(ovl.ticker);
              if (!isVisible(key)) return null;
              const peakChartIdx = chartOffsets.indexOf(ovl.peakOffset);
              const peakPlace = peakLabelPlacement(ovl.peakOffset, nowOffsets);
              return (
                <Line
                  key={ovl.ticker}
                  type="monotone"
                  dataKey={key}
                  name={key}
                  stroke={ovl.color}
                  strokeWidth={mainLineW}
                  strokeDasharray={companyFocus ? undefined : "6 3"}
                  dot={{ r: tileChart ? 2 : 2.5, fill: ovl.color }}
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey={key}
                    content={(props) => {
                      const { x, y, index } = props;
                      if (peakChartIdx < 0 || index !== peakChartIdx || x == null || y == null) {
                        return null;
                      }
                      return (
                        <text
                          x={Number(x) + peakPlace.dx}
                          y={Number(y) + peakPlace.dy}
                          fill={ovl.color}
                          fontSize={9}
                          fontWeight={700}
                          textAnchor={peakPlace.anchor}
                        >
                          {formatEstRoiSigned(ovl.peakRoi)}%
                        </text>
                      );
                    }}
                  />
                </Line>
              );
            })}
            {blendOverlays.map((blend) => {
              const key = blendDataKey(blend.ticker);
              if (!isVisible(key)) return null;
              return (
                <Line
                  key={`blend-${blend.ticker}`}
                  type="monotone"
                  dataKey={key}
                  name={key}
                  stroke={blend.color}
                  strokeWidth={blendLineW}
                  strokeDasharray="3 5"
                  strokeOpacity={0.9}
                  connectNulls={false}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    if (cx == null || cy == null) return <g />;
                    const off = Number(payload?.offset);
                    const isTableKnot = BLEND_TABLE_KNOTS.has(off);
                    const r = isTableKnot ? (tileChart ? 3.25 : 4) : tileChart ? 1.75 : 2;
                    return (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={r}
                        fill={blend.color}
                        stroke={isTableKnot ? "#ffffff" : blend.color}
                        strokeWidth={isTableKnot ? 1.5 : 0}
                      />
                    );
                  }}
                  isAnimationActive={false}
                />
              );
            })}
            {!embedded ? (
              <Legend
                wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
                formatter={(value) => {
                  if (value === "mean") return `μ SuperNova (+${HISTORY_MEAN_PEAK_ROI.toFixed(0)}%)`;
                  const hist = HISTORY_CASES.find((c) => c.id === value);
                  if (hist) return `${hist.ticker} (+${hist.peakRoi.toFixed(0)}%)`;
                  const postRef = availablePostRefs.find((id) => refDataKey(id) === value);
                  if (postRef) return SDS_REF_PROFILE_LABELS[postRef];
                  const ovl = overlayCurves.find((o) => overlayDataKey(o.ticker) === value);
                  if (ovl) {
                    return `${ovl.ticker} (${t("decisionLab.sds.compareChart.estimatedRoi", {
                      pct: formatEstRoiPct(ovl.peakRoi),
                      offset: supernovaOffsetLabel(ovl.peakOffset),
                    })})`;
                  }
                  const blend = blendOverlays.find((b) => blendDataKey(b.ticker) === value);
                  if (blend) {
                    return t("decisionLab.sds.compareChart.blendCurveLabel", { ticker: blend.ticker });
                  }
                  return value;
                }}
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {!chartOnly && overlayCurves.length === 0 ? (
        <p className="text-[10px] text-ink-muted">{t("decisionLab.sds.compareChart.clickTickerHint")}</p>
      ) : null}
    </section>
  );
}
