import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileCurveChartsPayload } from "../dashboardTypes";
import { SPARKLINE_AXIS_MAX, SPARKLINE_AXIS_MIN } from "../mobileRecalibCurve";
import {
  isMarketSlopeWatchView,
  marketSlopeWatchDomain,
  MARKET_SLOPE_WATCH_MAX,
  MARKET_SLOPE_WATCH_MIN,
  MARKET_SLOPE_WATCH_TICKS,
} from "../mobileSlopeTrajectory";
import { interpolateSeriesAtOffset } from "../mobileChartCalendar";
import {
  CHART_CD,
  CHART_GREEN,
  CHART_GRID,
  CHART_GRID_MAJOR,
  CHART_PURPLE,
  CHART_TODAY,
  CHART_TICK,
  CHART_TEAL,
  MOBILE_CHART_H,
  MOBILE_CHART_W,
  ZONE_HOT_W1,
  ZONE_HOT_W2,
  ZONE_PAST,
  ZONE_POST_CD,
  ZONE_RUNWAY,
} from "./mobileChartTheme";

const PURPLE = CHART_PURPLE;
const ACTUAL_GREEN = CHART_GREEN;
const TEAL = CHART_TEAL;
const TODAY = CHART_TODAY;
const TICK = CHART_TICK;
const GRID = CHART_GRID;
const CD = CHART_CD;
const CHART_H = MOBILE_CHART_H;

const MII_GREEN = "#059669";
const MII_RED = "#dc2626";
const PRE_COLOR = "#7c3aed";
const POST_COLOR = "#2563eb";
const GAP_ARC = "#d97706";

function chartPad(w: number, h: number) {
  return { left: 38, right: 10, top: 26, bottom: 34, w, h, iw: w - 48, ih: h - 60 };
}

function xAxisLabelY(pad: ReturnType<typeof chartPad>): number {
  return pad.top + pad.ih + 16;
}

function domain(vals: number[], padRatio = 0.14): [number, number] {
  const finite = vals.filter((v) => Number.isFinite(v));
  if (!finite.length) return [-1, 1];
  let min = Math.min(...finite, 0);
  let max = Math.max(...finite, 0);
  if (min === max) {
    const p = Math.max(1, Math.abs(max) * 0.2);
    return [min - p, max + p];
  }
  const pad = (max - min) * padRatio || 1;
  return [min - pad, max + pad];
}

/** Asse X allineato allo sparkline: include oggi, CD (0) e finestra T−120…T+7. */
function offsetDomain(offsets: number[], todayOffset: number | null): [number, number] {
  const dataMin = offsets.length ? Math.min(...offsets) : SPARKLINE_AXIS_MIN;
  const dataMax = offsets.length ? Math.max(...offsets) : SPARKLINE_AXIS_MAX;
  const min = Math.min(dataMin, SPARKLINE_AXIS_MIN, todayOffset ?? SPARKLINE_AXIS_MIN, 0);
  const max = Math.max(dataMax, SPARKLINE_AXIS_MAX, todayOffset ?? SPARKLINE_AXIS_MAX, 0);
  const span = max - min || 1;
  const pad = Math.max(2, span * 0.03);
  return [min - pad, max + pad];
}

function xScaleFromDomain(xMin: number, xMax: number, pad: ReturnType<typeof chartPad>) {
  return (off: number) => pad.left + ((off - xMin) / (xMax - xMin || 1)) * pad.iw;
}

function yScale(min: number, max: number, pad: ReturnType<typeof chartPad>) {
  return (v: number) => pad.top + (1 - (v - min) / (max - min || 1)) * pad.ih;
}

function polyline(pts: Array<{ x: number; y: number }>): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
}

function pickWatchOffsetTicks(xMin: number, xMax: number): Array<{ offset: number; label: string }> {
  return MARKET_SLOPE_WATCH_TICKS.filter((off) => off >= xMin - 0.5 && off <= xMax + 0.5).map((off) => ({
    offset: off,
    label: off > 0 ? `T+${off}` : `T${off}`,
  }));
}

function densifySeriesForDraw(
  points: NonNullable<MobileCurveChartsPayload["slopeTrajectory"]>,
  field: "pred" | "actual",
  xMin: number,
  xMax: number,
  todayOffset: number | null,
  step = 3,
): Array<{ offset: number; val: number }> {
  const src = points
    .filter((p) => p[field] != null && Number.isFinite(p[field] as number))
    .map((p) => ({ offset: p.offset, val: p[field] as number }));
  if (src.length < 2) return src;

  const out: Array<{ offset: number; val: number }> = [];
  const lo = Math.ceil(xMin);
  const hi = Math.floor(xMax);
  for (let off = lo; off <= hi; off += step) {
    if (field === "actual" && todayOffset != null && off > todayOffset + 0.01) continue;
    const val =
      field === "pred"
        ? interpolateSeriesAtOffset(
            src.map((p) => ({ offset: p.offset, y: p.val })),
            off,
            { extrapolate: true },
          )
        : interpolateAtOffset(
            src.map((p) => ({ offset: p.offset, val: p.val })),
            off,
          );
    if (val != null && Number.isFinite(val)) out.push({ offset: off, val });
  }
  for (const p of src) {
    if (p.offset >= xMin && p.offset <= xMax) {
      if (field === "actual" && todayOffset != null && p.offset > todayOffset + 0.01) continue;
      if (!out.some((q) => q.offset === p.offset)) out.push(p);
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}

function pickOffsetTicks(
  points: Array<{ offset: number; label: string }>,
  xMin: number,
  xMax: number,
  maxTicks = 5,
): Array<{ offset: number; label: string }> {
  const byOff = new Map(points.map((p) => [p.offset, p]));
  const unique = [...new Set(points.map((p) => p.offset))].sort((a, b) => a - b);
  if (unique.length <= maxTicks) {
    return unique.map((off) => ({
      offset: off,
      label: byOff.get(off)?.label ?? String(off),
    }));
  }

  const chosen = new Set<number>();
  const span = xMax - xMin || 1;
  for (let i = 0; i < maxTicks; i++) {
    const target = xMin + (span * i) / Math.max(1, maxTicks - 1);
    let best = unique[0];
    let bestDist = Math.abs(unique[0] - target);
    for (const off of unique) {
      const dist = Math.abs(off - target);
      if (dist < bestDist) {
        best = off;
        bestDist = dist;
      }
    }
    chosen.add(best);
  }

  if (0 >= xMin && 0 <= xMax) {
    const cdOff = unique.reduce((best, off) => (Math.abs(off) < Math.abs(best) ? off : best));
    chosen.add(cdOff);
  }

  return [...chosen]
    .sort((a, b) => a - b)
    .map((off) => ({
      offset: off,
      label: byOff.get(off)?.label ?? String(off),
    }));
}

function renderOffsetTicks(
  ticks: Array<{ offset: number; label: string }>,
  x: (off: number) => number,
  pad: ReturnType<typeof chartPad>,
  placed: Array<{ x: number; label: string }>,
  minGap = 28,
): ReactNode[] {
  const labelY = xAxisLabelY(pad);
  const out: ReactNode[] = [];
  for (const tick of ticks) {
    const px = x(tick.offset);
    if (placed.some((p) => Math.abs(p.x - px) < minGap && p.label !== tick.label)) continue;
    placed.push({ x: px, label: tick.label });
    out.push(
      <text key={tick.offset} x={px} y={labelY} textAnchor="middle" fontSize={9} fill={TICK}>
        {tick.label}
      </text>,
    );
  }
  return out;
}

let _gradSeq = 0;

function MobileChartPlot({
  children,
  height = CHART_H,
  className = "",
  footer,
}: {
  children: ReactNode;
  height?: number;
  className?: string;
  footer?: ReactNode;
}) {
  return (
    <div className="curve-chart-plot-wrap">
      <div
        className={`curve-chart-tile-panel invest-trend-chart-panel ${className}`.trim()}
        style={{ height, minHeight: height }}
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

function renderChartDefs(uid: string): ReactNode {
  return (
    <defs>
      <filter id={`${uid}-shadow`} x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#1e40af" floodOpacity="0.18" />
      </filter>
      <filter id={`${uid}-glow-today`} x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={TODAY} floodOpacity="0.65" />
      </filter>
      <filter id={`${uid}-glow-cd`} x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="0" stdDeviation="2" floodColor={CD} floodOpacity="0.55" />
      </filter>
    </defs>
  );
}

function renderPlotBackground(pad: ReturnType<typeof chartPad>, uid: string): ReactNode {
  const x = pad.left - 4;
  const y = pad.top - 4;
  const w = pad.iw + 8;
  const h = pad.ih + 8;
  return (
    <>
      {renderChartDefs(uid)}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill="rgba(14, 14, 24, 0.35)"
        stroke="rgba(255, 255, 255, 0.14)"
        strokeWidth={1}
      />
    </>
  );
}

function renderTimelineZones(
  x: (off: number) => number,
  pad: ReturnType<typeof chartPad>,
  xMin: number,
  xMax: number,
  todayOffset: number | null,
): ReactNode {
  const y = pad.top;
  const h = pad.ih;
  const bands: ReactNode[] = [];
  const band = (key: string, from: number, to: number, fill: string, opacity: number) => {
    const lo = Math.max(from, xMin);
    const hi = Math.min(to, xMax);
    if (hi <= lo) return;
    const x1 = x(lo);
    const x2 = x(hi);
    if (x2 - x1 < 1) return;
    bands.push(<rect key={key} x={x1} y={y} width={x2 - x1} height={h} fill={fill} opacity={opacity} />);
  };
  band("hot-w1", -30, -10, ZONE_HOT_W1, 0.22);
  band("hot-w2", -10, -3, ZONE_HOT_W2, 0.28);
  if (todayOffset != null) band("past", xMin, todayOffset, ZONE_PAST, 0.18);
  if (todayOffset != null && todayOffset < 0) band("runway", todayOffset, 0, ZONE_RUNWAY, 0.22);
  if (0 <= xMax) band("postcd", 0, xMax, ZONE_POST_CD, 0.14);
  return <g>{bands}</g>;
}

export function ChartTimelineLegend() {
  const { t } = useMobileLang();
  return (
    <div className="curve-timeline-legend" aria-hidden>
      <span className="curve-zone-chip curve-zone-chip--past">{t("curve.zonePast")}</span>
      <span className="curve-zone-chip curve-zone-chip--hot">{t("curve.zonePreCdHot")}</span>
      <span className="curve-zone-chip curve-zone-chip--cd">CD</span>
      <span className="curve-zone-chip curve-zone-chip--today">{t("curve.zoneToday")}</span>
    </div>
  );
}

function PredBlendSeriesLegend({ showBlend }: { showBlend: boolean }) {
  const { t } = useMobileLang();
  return (
    <div className="curve-series-legend" aria-hidden>
      <span className="curve-series-chip">
        <span className="curve-series-line curve-series-line--model" />
        {t("curve.legendModelRecalib")}
      </span>
      {showBlend ? (
        <span className="curve-series-chip">
          <span className="curve-series-line curve-series-line--blend" />
          {t("curve.legendSdsBlend")}
        </span>
      ) : null}
    </div>
  );
}

function fmtPctAxis(v: number): string {
  const abs = Math.abs(v);
  const digits = abs < 0.05 ? 2 : abs < 10 ? 1 : 0;
  const body = v.toFixed(digits);
  return v > 0 ? `+${body}%` : `${body}%`;
}

function renderCartesianGrid(
  pad: ReturnType<typeof chartPad>,
  width: number,
  yMin: number,
  yMax: number,
  y: (v: number) => number,
  levels = 5,
): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i <= levels; i++) {
    const val = yMin + ((yMax - yMin) * i) / levels;
    const py = y(val);
    const isMid = i === Math.floor(levels / 2);
    out.push(
      <line
        key={`grid-${i}`}
        x1={pad.left}
        x2={width - pad.right}
        y1={py}
        y2={py}
        stroke={isMid ? CHART_GRID_MAJOR : GRID}
        strokeDasharray="3 5"
        strokeWidth={isMid ? 0.9 : 0.75}
      />,
    );
  }
  return out;
}

function renderYAxisTicks(
  pad: ReturnType<typeof chartPad>,
  yMin: number,
  yMax: number,
  y: (v: number) => number,
  fmt: (v: number) => string,
  levels = 4,
): ReactNode[] {
  const out: ReactNode[] = [];
  for (let i = 0; i <= levels; i++) {
    const val = yMin + ((yMax - yMin) * i) / levels;
    const py = y(val);
    out.push(
      <text key={`yt-${i}`} x={pad.left - 4} y={py + 3} textAnchor="end" fontSize={8} fill={TICK}>
        {fmt(val)}
      </text>,
    );
  }
  return out;
}

function renderVerticalGrid(
  ticks: Array<{ offset: number; label: string }>,
  x: (off: number) => number,
  pad: ReturnType<typeof chartPad>,
): ReactNode[] {
  return ticks.map((tick) => (
    <line
      key={`vg-${tick.offset}`}
      x1={x(tick.offset)}
      x2={x(tick.offset)}
      y1={pad.top}
      y2={pad.top + pad.ih}
      stroke={tick.offset === 0 ? CHART_GRID_MAJOR : GRID}
      strokeDasharray="3 5"
      strokeWidth={tick.offset === 0 ? 0.9 : 0.75}
    />
  ));
}

function renderCdMarker(xCd: number, pad: ReturnType<typeof chartPad>, uid: string): ReactNode {
  const badgeY = pad.top - 12;
  return (
    <g filter={`url(#${uid}-glow-cd)`}>
      <line
        x1={xCd}
        y1={pad.top}
        x2={xCd}
        y2={pad.top + pad.ih}
        stroke={CD}
        strokeWidth={2}
        strokeDasharray="5 4"
      />
      <rect x={xCd - 13} y={badgeY} width={26} height={13} rx={4} fill={CD} />
      <text x={xCd} y={badgeY + 9.5} textAnchor="middle" fontSize={8} fontWeight={800} fill="#fff">
        CD
      </text>
    </g>
  );
}

function renderTodayMarker(
  xToday: number,
  pad: ReturnType<typeof chartPad>,
  yOnCurve: number | null,
  todayVal: number | null,
  todayLabel: string,
  uid: string,
): ReactNode {
  const pinY = pad.top - 4;
  return (
    <g filter={`url(#${uid}-glow-today)`}>
      <line
        x1={xToday}
        y1={pad.top}
        x2={xToday}
        y2={pad.top + pad.ih}
        stroke={TODAY}
        strokeDasharray="4 3"
        strokeWidth={2}
      />
      <polygon
        points={`${xToday},${pinY + 7} ${xToday - 5},${pinY} ${xToday + 5},${pinY}`}
        fill={TODAY}
        stroke="#fff"
        strokeWidth={0.75}
      />
      <text x={xToday} y={pinY - 3} textAnchor="middle" fontSize={8} fontWeight={800} fill={TODAY}>
        {todayLabel}
      </text>
      {yOnCurve != null && todayVal != null ? (
        <>
          <circle cx={xToday} cy={yOnCurve} r={5.5} fill={TODAY} stroke="#fff" strokeWidth={1.5} />
          <rect
            x={Math.min(xToday + 6, pad.left + pad.iw - 44)}
            y={yOnCurve - 18}
            width={40}
            height={14}
            rx={4}
            fill="rgba(245,158,11,0.92)"
          />
          <text
            x={Math.min(xToday + 26, pad.left + pad.iw - 24)}
            y={yOnCurve - 8}
            textAnchor="middle"
            fontSize={8}
            fill="#fff"
            fontWeight={700}
          >
            {todayVal >= 0 ? "+" : ""}
            {todayVal.toFixed(1)}%
          </text>
        </>
      ) : null}
    </g>
  );
}

function interpolateAtOffset(
  points: Array<{ offset: number; val: number | null }>,
  target: number,
): number | null {
  const sorted = points
    .filter((p) => p.val != null && Number.isFinite(p.val))
    .sort((a, b) => a.offset - b.offset);
  if (!sorted.length) return null;
  const exact = sorted.find((p) => p.offset === target);
  if (exact) return exact.val;
  if (target <= sorted[0].offset) return sorted[0].val;
  if (target >= sorted[sorted.length - 1].offset) return sorted[sorted.length - 1].val;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (target >= a.offset && target <= b.offset) {
      const t = (target - a.offset) / (b.offset - a.offset || 1);
      return a.val! + t * (b.val! - a.val!);
    }
  }
  return null;
}

function fmtDeg(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}°`;
}

function armEnd(cx: number, cy: number, arm: number, angleDeg: number): { x: number; y: number } {
  const clamped = Math.max(-42, Math.min(42, angleDeg));
  const rad = (clamped * Math.PI) / 180;
  return { x: cx + arm * Math.cos(-rad), y: cy + arm * Math.sin(-rad) };
}

function miiStroke(angleDeg: number | null | undefined): string {
  if (angleDeg == null || !Number.isFinite(angleDeg)) return MII_GREEN;
  return angleDeg >= 0 ? MII_GREEN : MII_RED;
}

export function MobilePredBlendChart({
  points,
  todayOffset,
  width = MOBILE_CHART_W,
  height = CHART_H,
}: {
  points: NonNullable<MobileCurveChartsPayload["predBlend"]>;
  todayOffset: number | null;
  width?: number;
  height?: number;
}) {
  const { t } = useMobileLang();
  const pad = chartPad(width, height);
  const offsets = points.map((p) => p.offset);
  const [xMin, xMax] = offsetDomain(offsets, todayOffset);
  const vals = points.flatMap((p) => [p.model, p.blend].filter((v): v is number => v != null));
  const [yMin, yMax] = domain(vals);
  const x = xScaleFromDomain(xMin, xMax, pad);
  const y = yScale(yMin, yMax, pad);
  const modelPts = points
    .filter((p) => p.model != null)
    .map((p) => ({ x: x(p.offset), y: y(p.model as number), off: p.offset }));
  const blendPts = points
    .filter((p) => p.blend != null)
    .map((p) => ({ x: x(p.offset), y: y(p.blend as number) }));

  const zeroY = y(0);
  const showZero = zeroY >= pad.top && zeroY <= pad.top + pad.ih;
  const ticks = pickOffsetTicks(
    points.map((p) => ({ offset: p.offset, label: p.label })),
    xMin,
    xMax,
  );
  const placedTicks: Array<{ x: number; label: string }> = [];
  const todayVal =
    todayOffset != null
      ? interpolateAtOffset(
          points.map((p) => ({ offset: p.offset, val: p.model })),
          todayOffset,
        )
      : null;
  const todayY = todayVal != null ? y(todayVal) : null;
  const showCd = 0 >= xMin && 0 <= xMax;
  const showToday = todayOffset != null && todayOffset >= xMin && todayOffset <= xMax;
  const todayTick = ticks.find((t) => t.offset === todayOffset);
  const todayLabel = todayTick?.label ? todayTick.label : t("curve.zoneToday");
  const showBlend = blendPts.length >= 2;
  const uid = `pred-${++_gradSeq}`;

  return (
    <MobileChartPlot
      height={height}
      footer={
        <>
          <PredBlendSeriesLegend showBlend={showBlend} />
          <ChartTimelineLegend />
        </>
      }
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="curve-chart-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        {renderPlotBackground(pad, uid)}
        {renderTimelineZones(x, pad, xMin, xMax, todayOffset)}
        {renderCartesianGrid(pad, width, yMin, yMax, y)}
        {renderVerticalGrid(ticks, x, pad)}
        {renderYAxisTicks(pad, yMin, yMax, y, fmtPctAxis)}
        {showZero ? (
          <line
            x1={pad.left}
            x2={width - pad.right}
            y1={zeroY}
            y2={zeroY}
            stroke={CHART_GRID_MAJOR}
            strokeWidth={1}
            opacity={0.85}
          />
        ) : null}
        {modelPts.length >= 2 ? (
          <path
            d={polyline(modelPts)}
            fill="none"
            stroke={PURPLE}
            strokeWidth={2.25}
            strokeLinejoin="round"
            filter={`url(#${uid}-shadow)`}
          />
        ) : null}
        {modelPts.map((p) => (
          <circle key={p.off} cx={p.x} cy={p.y} r={3.5} fill={PURPLE} stroke="#fff" strokeWidth={1} />
        ))}
        {blendPts.length >= 2 ? (
          <path
            d={polyline(blendPts)}
            fill="none"
            stroke={TEAL}
            strokeWidth={2}
            strokeDasharray="5 3"
            strokeLinejoin="round"
          />
        ) : null}
        {showCd ? renderCdMarker(x(0), pad, uid) : null}
        {showToday
          ? renderTodayMarker(x(todayOffset!), pad, todayY, todayVal, todayLabel, uid)
          : null}
        {renderOffsetTicks(ticks, x, pad, placedTicks)}
      </svg>
    </MobileChartPlot>
  );
}

export function MobileSlopeTrajectoryChart({
  points,
  todayOffset,
  width = MOBILE_CHART_W,
  height = CHART_H,
  xDomain = null,
  useWatchTicks = false,
}: {
  points: NonNullable<MobileCurveChartsPayload["slopeTrajectory"]>;
  todayOffset: number | null;
  width?: number;
  height?: number;
  /** Fixed calendar window (e.g. T−120…T−7 watch arc). */
  xDomain?: [number, number] | null;
  useWatchTicks?: boolean;
}) {
  const { t } = useMobileLang();
  const pad = chartPad(width, height);
  const offsets = points.map((p) => p.offset);
  const [xMin, xMax] = xDomain ?? offsetDomain(offsets, todayOffset);
  const vals = points.flatMap((p) => [p.pred, p.actual].filter((v): v is number => v != null));
  const [yMin, yMax] = domain(vals);
  const x = xScaleFromDomain(xMin, xMax, pad);
  const y = yScale(yMin, yMax, pad);

  const predDraw = densifySeriesForDraw(points, "pred", xMin, xMax, todayOffset, 2);
  const actDraw = densifySeriesForDraw(points, "actual", xMin, xMax, todayOffset, 2);
  const predPts = predDraw.map((p) => ({ x: x(p.offset), y: y(p.val) }));
  const actPts = actDraw.map((p) => ({ x: x(p.offset), y: y(p.val) }));

  const ticks = useWatchTicks
    ? pickWatchOffsetTicks(xMin, xMax)
    : pickOffsetTicks(
        points.map((p) => ({ offset: p.offset, label: p.label })),
        xMin,
        xMax,
      );
  const placedTicks: Array<{ x: number; label: string }> = [];
  const todayVal =
    todayOffset != null
      ? interpolateAtOffset(
          points.map((p) => ({ offset: p.offset, val: p.actual ?? p.pred })),
          todayOffset,
        )
      : null;
  const todayY = todayVal != null ? y(todayVal) : null;
  const showCd = 0 >= xMin && 0 <= xMax;
  const showToday = todayOffset != null && todayOffset >= xMin && todayOffset <= xMax;
  const uid = `slope-${++_gradSeq}`;

  return (
    <MobileChartPlot height={height} footer={<ChartTimelineLegend />}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="curve-chart-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        {renderPlotBackground(pad, uid)}
        {renderTimelineZones(x, pad, xMin, xMax, todayOffset)}
        {renderCartesianGrid(pad, width, yMin, yMax, y)}
        {renderVerticalGrid(ticks, x, pad)}
        {renderYAxisTicks(pad, yMin, yMax, y, (v) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`)}
        {predPts.length >= 2 ? (
          <path
            d={polyline(predPts)}
            fill="none"
            stroke={PURPLE}
            strokeWidth={2}
            strokeDasharray="5 3"
            strokeLinejoin="round"
          />
        ) : null}
        {actPts.length >= 2 ? (
          <>
            <path
              d={polyline(actPts)}
              fill="none"
              stroke={ACTUAL_GREEN}
              strokeWidth={2.25}
              strokeLinejoin="round"
              filter={`url(#${uid}-shadow)`}
            />
            {actPts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={4} fill={ACTUAL_GREEN} stroke="#fff" strokeWidth={1} />
            ))}
          </>
        ) : null}
        {showCd ? renderCdMarker(x(0), pad, uid) : null}
        {showToday
          ? renderTodayMarker(x(todayOffset!), pad, todayY, todayVal, t("curve.zoneToday"), uid)
          : null}
        {renderOffsetTicks(ticks, x, pad, placedTicks)}
      </svg>
    </MobileChartPlot>
  );
}

/** Market path (real) vs model slope on the same calendar axis. */
export function MobileMarketSlopeTrajectoryChart(props: {
  points: NonNullable<MobileCurveChartsPayload["slopeTrajectory"]>;
  todayOffset: number | null;
  width?: number;
  height?: number;
}) {
  const { points, todayOffset, width = MOBILE_CHART_W, height = CHART_H } = props;
  const { t } = useMobileLang();
  const watchView = isMarketSlopeWatchView(todayOffset);
  const [xZoom, setXZoom] = useState(1);

  const xDomain = useMemo((): [number, number] | null => {
    if (!watchView) return null;
    return marketSlopeWatchDomain(todayOffset, xZoom);
  }, [watchView, todayOffset, xZoom]);

  const bumpXZoom = (delta: number) => {
    setXZoom((z) => Math.min(4, Math.max(1, Math.round((z + delta) * 4) / 4)));
  };

  return (
    <div className="curve-market-slope-wrap">
      <div className="curve-market-slope-row">
        <div className="curve-market-slope-plot">
          <MobileSlopeTrajectoryChart
            points={points}
            todayOffset={todayOffset}
            width={width}
            height={height}
            xDomain={xDomain}
            useWatchTicks={watchView}
          />
        </div>
        {watchView ? (
          <div className="curve-chart-zoom-rail" aria-label={t("curve.zoomRail")}>
            <button
              type="button"
              className="curve-chart-zoom-btn"
              aria-label={t("curve.zoomXIn")}
              onClick={() => bumpXZoom(0.25)}
            >
              +
            </button>
            <button
              type="button"
              className="curve-chart-zoom-btn"
              aria-label={t("curve.zoomXOut")}
              onClick={() => bumpXZoom(-0.25)}
            >
              −
            </button>
          </div>
        ) : null}
      </div>
      {watchView ? (
        <p className="curve-watch-axis-hint">
          {t("curve.watchAxisHint", { min: MARKET_SLOPE_WATCH_MIN, max: MARKET_SLOPE_WATCH_MAX })}
        </p>
      ) : null}
      <div className="curve-market-slope-legend" aria-hidden>
        <span className="curve-legend-item curve-legend-item--mii">
          <i /> MII market
        </span>
        <span className="curve-legend-item curve-legend-item--model">
          <i /> Model
        </span>
      </div>
    </div>
  );
}

export function MobileGainPlanChart({
  points,
  hypothetical = false,
  width = MOBILE_CHART_W,
  height = CHART_H,
}: {
  points: NonNullable<MobileCurveChartsPayload["gainPlan"]>;
  hypothetical?: boolean;
  width?: number;
  height?: number;
}) {
  const { t } = useMobileLang();
  const sorted = [...points].sort((a, b) => a.day - b.day);
  const pad = chartPad(width, height);
  const days = sorted.map((p) => p.day);
  const vals = sorted.flatMap((p) => {
    if (hypothetical) return [p.planned].filter((v): v is number => v != null);
    return [p.planned, p.actual, p.historical].filter((v): v is number => v != null);
  });
  const [yMin, yMax] = domain(vals);
  const minDay = Math.min(...days, 0);
  const maxDay = Math.max(...days, 1);
  const x = (d: number) => pad.left + ((d - minDay) / (maxDay - minDay || 1)) * pad.iw;
  const y = yScale(yMin, yMax, pad);

  const actPts = hypothetical
    ? []
    : sorted
        .filter((p) => p.actual != null && Number.isFinite(p.actual))
        .map((p) => ({ x: x(p.day), y: y(p.actual as number), day: p.day }));
  const planPts = sorted
    .filter((p) => p.planned != null && Number.isFinite(p.planned))
    .map((p) => ({ x: x(p.day), y: y(p.planned as number) }));

  const showActual = !hypothetical && actPts.length >= 2;

  let exitDay: number | null = null;
  let peakPlanned = -Infinity;
  for (const p of sorted) {
    if (p.planned != null && p.planned >= peakPlanned) {
      peakPlanned = p.planned;
      exitDay = p.day;
    }
  }

  const dayTicks = (() => {
    const span = maxDay - minDay || 1;
    const step = span <= 4 ? 1 : span <= 80 ? Math.ceil(span / 4) : Math.ceil(span / 3);
    const ticks: Array<{ offset: number; label: string }> = [];
    for (let d = minDay; d <= maxDay; d += step) {
      ticks.push({ offset: d, label: String(Math.round(d)) });
    }
    if (ticks[ticks.length - 1]?.offset !== maxDay) {
      ticks.push({ offset: maxDay, label: String(Math.round(maxDay)) });
    }
    return ticks;
  })();
  const xDay = (d: number) => x(d);
  const todayPt = showActual ? actPts[actPts.length - 1] : null;
  const uid = `gain-${++_gradSeq}`;
  const GAIN_PLANNED = "#6366f1";

  return (
    <MobileChartPlot
      height={height}
      footer={
        <div className="curve-gain-legend" aria-hidden>
          {showActual ? (
            <span className="curve-legend-item curve-legend-item--gain-act">
              <i /> {t("curve.gainLegendActual")}
            </span>
          ) : null}
          <span className="curve-legend-item curve-legend-item--gain-plan">
            <i /> {t("curve.gainLegendPlanned")}
          </span>
        </div>
      }
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="curve-chart-svg"
        preserveAspectRatio="xMidYMid meet"
      >
        {renderPlotBackground(pad, uid)}
        {renderCartesianGrid(pad, width, yMin, yMax, y)}
        {renderVerticalGrid(dayTicks, xDay, pad)}
        {renderYAxisTicks(pad, yMin, yMax, y, (v) => `€${Math.round(v)}`)}
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={y(0)}
          y2={y(0)}
          stroke={CHART_GRID_MAJOR}
          strokeWidth={1}
          opacity={0.85}
        />
        {showActual ? (
          <>
            <path
              d={polyline(actPts)}
              fill="none"
              stroke={ACTUAL_GREEN}
              strokeWidth={2.25}
              strokeLinejoin="round"
              filter={`url(#${uid}-shadow)`}
            />
            {actPts.map((p) => (
              <circle key={p.day} cx={p.x} cy={p.y} r={3.5} fill={ACTUAL_GREEN} stroke="#fff" strokeWidth={1} />
            ))}
          </>
        ) : null}
        {planPts.length >= 2 ? (
          <path
            d={polyline(planPts)}
            fill="none"
            stroke={GAIN_PLANNED}
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinejoin="round"
          />
        ) : null}
        {todayPt ? (
          <g>
            <line
              x1={todayPt.x}
              y1={pad.top}
              x2={todayPt.x}
              y2={pad.top + pad.ih}
              stroke="rgba(167,139,250,0.75)"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <text
              x={todayPt.x}
              y={pad.top - 4}
              textAnchor="middle"
              fontSize={7}
              fontWeight={700}
              fill={TICK}
            >
              {t("curve.gainToday")}
            </text>
          </g>
        ) : null}
        {exitDay != null ? (
          <g>
            <line
              x1={x(exitDay)}
              y1={pad.top}
              x2={x(exitDay)}
              y2={pad.top + pad.ih}
              stroke="rgba(148,163,184,0.65)"
              strokeDasharray="2 4"
              strokeWidth={1}
            />
            <text
              x={x(exitDay)}
              y={pad.top - 4}
              textAnchor="middle"
              fontSize={7}
              fontWeight={700}
              fill={TICK}
            >
              Planned exit
            </text>
          </g>
        ) : null}
        {planPts.length ? (
          <circle
            cx={planPts[planPts.length - 1].x}
            cy={planPts[planPts.length - 1].y}
            r={3.5}
            fill={GAIN_PLANNED}
            stroke="#fff"
            strokeWidth={0.75}
          />
        ) : null}
        {dayTicks.map((tick) => (
          <text key={tick.offset} x={xDay(tick.offset)} y={xAxisLabelY(pad)} textAnchor="middle" fontSize={9} fill={TICK}>
            {tick.label}
          </text>
        ))}
      </svg>
    </MobileChartPlot>
  );
}

export function MobileMarketModelSlopesChart({
  marketModel,
  width = MOBILE_CHART_W,
  height = CHART_H,
}: {
  marketModel: NonNullable<MobileCurveChartsPayload["marketModel"]>;
  width?: number;
  height?: number;
}) {
  const vbW = width;
  const vbH = height;
  const cx = vbW * 0.16;
  const cy = vbH * 0.54;
  const arm = vbW * 0.52;
  const miiDeg = marketModel.miiDeg ?? 0;
  const preDeg = marketModel.preModelDeg ?? marketModel.modelDeg;
  const postDeg = marketModel.postModelDeg ?? marketModel.modelDeg;
  const samePrePost =
    preDeg != null &&
    postDeg != null &&
    Math.abs(preDeg - postDeg) < 0.6;
  const modelDeg = samePrePost ? preDeg : postDeg ?? preDeg;
  const miiEnd = armEnd(cx, cy, arm, miiDeg);
  const modelEnd = modelDeg != null ? armEnd(cx, cy, arm * 0.92, modelDeg) : null;
  const preEnd = !samePrePost && preDeg != null ? armEnd(cx, cy, arm * 0.98, preDeg) : null;
  const postEnd = !samePrePost && postDeg != null ? armEnd(cx, cy, arm * 0.88, postDeg) : null;
  const miiColor = miiStroke(miiDeg);
  const gapPct = marketModel.gapPct;
  const gapArc =
    preDeg != null
      ? (() => {
          const r = arm * 0.38;
          const a = armEnd(cx, cy, r, preDeg);
          const b = armEnd(cx, cy, r, miiDeg);
          const sweep = miiDeg >= preDeg ? 1 : 0;
          const large = Math.abs(miiDeg - preDeg) > 180 ? 1 : 0;
          return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} ${sweep} ${b.x} ${b.y}`;
        })()
      : null;
  const gapMid =
    preDeg != null ? armEnd(cx, cy, arm * 0.38, (preDeg + miiDeg) / 2) : null;
  const bgPad = { left: 10, right: 10, top: 14, bottom: 22, w: vbW, h: vbH, iw: vbW - 20, ih: vbH - 36 };
  const uid = `mii-${++_gradSeq}`;

  return (
    <MobileChartPlot height={height}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${vbW} ${vbH}`}
        className="curve-chart-svg curve-chart-svg--market"
        preserveAspectRatio="xMidYMid meet"
      >
        {renderPlotBackground(bgPad, uid)}
        <line x1={16} y1={cy} x2={vbW - 16} y2={cy} stroke={CHART_GRID_MAJOR} strokeDasharray="5 4" strokeWidth={1} opacity={0.55} />
        <text x={18} y={cy - 8} fontSize={9} fill="#94a3b8" fontFamily="ui-monospace, monospace">
          0°
        </text>
        {gapArc ? (
          <path d={gapArc} fill="none" stroke={GAP_ARC} strokeWidth={1.65} strokeDasharray="5 3.5" opacity={0.8} />
        ) : null}
        {gapMid && gapPct != null ? (
          <text x={gapMid.x + 4} y={gapMid.y - 4} fontSize={9} fill={GAP_ARC} fontWeight={700}>
            Δ {gapPct.toFixed(0)}%
          </text>
        ) : null}
        {samePrePost && modelEnd ? (
          <>
            <line x1={cx} y1={cy} x2={modelEnd.x} y2={modelEnd.y} stroke={POST_COLOR} strokeWidth={2} strokeDasharray="8 5" />
            <circle cx={modelEnd.x} cy={modelEnd.y} r={4} fill={POST_COLOR} />
            <text x={Math.min(modelEnd.x + 8, vbW - 96)} y={modelEnd.y - 6} fontSize={10} fill={POST_COLOR} fontWeight={600}>
              pre/post {fmtDeg(modelDeg)}
            </text>
          </>
        ) : null}
        {preEnd ? (
          <>
            <line x1={cx} y1={cy} x2={preEnd.x} y2={preEnd.y} stroke={PRE_COLOR} strokeWidth={2} strokeDasharray="8 5" />
            <circle cx={preEnd.x} cy={preEnd.y} r={4} fill={PRE_COLOR} />
            <text x={Math.min(preEnd.x + 8, vbW - 72)} y={preEnd.y - 6} fontSize={10} fill={PRE_COLOR} fontWeight={600}>
              pre {fmtDeg(preDeg)}
            </text>
          </>
        ) : null}
        {!samePrePost && postEnd ? (
          <>
            <line x1={cx} y1={cy} x2={postEnd.x} y2={postEnd.y} stroke={POST_COLOR} strokeWidth={2} strokeDasharray="8 5" />
            <circle cx={postEnd.x} cy={postEnd.y} r={4} fill={POST_COLOR} />
            <text x={Math.min(postEnd.x + 8, vbW - 72)} y={postEnd.y + 14} fontSize={10} fill={POST_COLOR} fontWeight={600}>
              post {fmtDeg(postDeg)}
            </text>
          </>
        ) : null}
        <line x1={cx} y1={cy} x2={miiEnd.x} y2={miiEnd.y} stroke={miiColor} strokeWidth={2.75} strokeLinecap="round" />
        <circle cx={miiEnd.x} cy={miiEnd.y} r={4.5} fill={miiColor} />
        <text x={Math.min(miiEnd.x + 8, vbW - 72)} y={miiEnd.y + 12} fontSize={10} fill={miiColor} fontWeight={600}>
          MII {fmtDeg(miiDeg)}
        </text>
        <circle cx={cx} cy={cy} r={3} fill="#64748b" />
      </svg>
    </MobileChartPlot>
  );
}
