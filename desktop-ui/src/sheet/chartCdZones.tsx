/**
 * CD (Catalyst Date) chart zones — shared across simulation curves and sparklines.
 *
 * Provides:
 *  - Legacy zone constants (HOT / WATCH / POST opacities + RGB references)
 *  - `chartXAnchorRows`  → anchor rows to keep Recharts ComposedChart aligned
 *  - `ChartCdZoneAreas`  → ReferenceArea overlay for simulation curve charts
 *  - `renderCdZones`     → standard pre/post-CD vertical bands used by ALL
 *    analytical charts (Pre-CD ≈ white/blue tint, Post-CD ≈ white/ochre tint)
 */
import type { ReactNode } from "react";
import { ReferenceArea, ReferenceLine } from "recharts";
import { SIM_HOT_ZONE_DAYS, SIM_MONITOR_HORIZON_DAYS } from "./cdHorizons";

// -----------------------------------------------------------------------------
// Legacy CD zones (curves + sparkline)
// -----------------------------------------------------------------------------

export const CD_HOT_ZONE_RGB = "rgb(var(--cd-hot-zone))";
export const CD_WATCH_ZONE_RGB = "rgb(var(--cd-watch-zone))";
export const CD_POST_ZONE_RGB = "rgb(var(--cd-post-zone))";

/** Opacity for hot zone (close-to-CD) inside detailed curve charts. */
export const CD_HOT_ZONE_OPACITY_CURVES = 0.14;
/** Opacity for watch zone (mid-range pre-CD) inside detailed curve charts. */
export const CD_WATCH_ZONE_OPACITY_CURVES = 0.09;
/** Opacity for post-CD zone (T > 0) inside detailed curve charts. */
export const CD_POST_ZONE_OPACITY_CURVES = 0.08;
/** Background tint behind plot area (white wash). */
export const CD_BG_LIGHT_OPACITY = 0.0;

/** Opacity for hot zone overlay inside sparklines (lower than curves). */
export const CD_HOT_ZONE_OPACITY_SPARK = 0.18;
/** Opacity for watch zone overlay inside sparklines. */
export const CD_WATCH_ZONE_OPACITY_SPARK = 0.12;

/** Anchor rows used as `data` for ComposedChart wrappers that only render
 *  ReferenceArea/ReferenceLine and need both X endpoints in the dataset. */
export function chartXAnchorRows(xMin: number, xMax: number) {
  return [
    { x: xMin, offset: xMin },
    { x: xMax, offset: xMax },
  ];
}

/** ReferenceArea overlay for simulation curve / detail charts. */
export function ChartCdZoneAreas({
  xMin,
  xMax,
  hotOpacity = CD_HOT_ZONE_OPACITY_CURVES,
  watchOpacity = CD_WATCH_ZONE_OPACITY_CURVES,
  postOpacity = CD_POST_ZONE_OPACITY_CURVES,
  bgOpacity = CD_BG_LIGHT_OPACITY,
}: {
  xMin: number;
  xMax: number;
  hotOpacity?: number;
  watchOpacity?: number;
  postOpacity?: number;
  bgOpacity?: number;
}) {
  const watchFrom = Math.max(xMin, -SIM_MONITOR_HORIZON_DAYS);
  const watchTo = Math.min(xMax, -SIM_HOT_ZONE_DAYS);
  const hotFrom = Math.max(xMin, -SIM_HOT_ZONE_DAYS);
  const hotTo = Math.min(xMax, 0);
  const postFrom = Math.max(xMin, 0);
  const postTo = xMax;

  return (
    <>
      {bgOpacity > 0 ? (
        <ReferenceArea
          x1={xMin}
          x2={xMax}
          fill="#ffffff"
          fillOpacity={bgOpacity}
          stroke="none"
          ifOverflow="visible"
        />
      ) : null}
      {watchTo > watchFrom ? (
        <ReferenceArea
          x1={watchFrom}
          x2={watchTo}
          fill={CD_WATCH_ZONE_RGB}
          fillOpacity={watchOpacity}
          stroke="none"
          ifOverflow="visible"
        />
      ) : null}
      {hotTo > hotFrom ? (
        <ReferenceArea
          x1={hotFrom}
          x2={hotTo}
          fill={CD_HOT_ZONE_RGB}
          fillOpacity={hotOpacity}
          stroke="none"
          ifOverflow="visible"
        />
      ) : null}
      {postTo > postFrom ? (
        <ReferenceArea
          x1={postFrom}
          x2={postTo}
          fill={CD_POST_ZONE_RGB}
          fillOpacity={postOpacity}
          stroke="none"
          ifOverflow="visible"
        />
      ) : null}
    </>
  );
}

// -----------------------------------------------------------------------------
// Standard pre/post-CD vertical bands shared by ALL analytical charts.
//   - Pre-CD : white background with a subtle dark-blue tint
//   - Post-CD: white background with a subtle ochre/yellow tint
// Colors come from CSS variables (see :root in index.css) so light/dark themes
// adapt automatically.
// -----------------------------------------------------------------------------

export const CHART_PRE_CD_FILL = "var(--chart-zone-pre-fill)";
export const CHART_POST_CD_FILL = "var(--chart-zone-post-fill)";
export const CHART_CD_STROKE = "var(--chart-zone-cd-stroke)";
export const CHART_TODAY_STROKE = "#dc2626";

/** Numeric defaults aligned with the CSS variables (Recharts cannot consume
 *  a CSS var for fillOpacity). */
export const CHART_PRE_CD_OPACITY = 0.06;
export const CHART_POST_CD_OPACITY = 0.085;

export type CdZoneProps = {
  /** Domain X coordinate where CD sits (e.g. 0 if axis is T-x). */
  cdX: number | string;
  /** Min value of the X axis (e.g. -100 for T-100). */
  xMin: number | string;
  /** Max value of the X axis (e.g. 90 for T+90). */
  xMax: number | string;
  /** Optional X coordinate of the "today" marker — rendered as a red dashed
   *  vertical line with a TODAY badge. Skip when chart already has its own. */
  todayX?: number | string | null;
  /** Hide the small PRE-CD / POST-CD badges (e.g. for very dense small tiles). */
  hideBadges?: boolean;
  /** Hide the CD label badge (the separator line is still drawn). */
  hideCdLabel?: boolean;
  /** Optional axis id when the chart has multiple X axes. */
  xAxisId?: string | number;
  /** Optional axis id when the chart has multiple Y axes. */
  yAxisId?: string | number;
};

/**
 * Render the standard pre-CD and post-CD vertical bands plus a styled CD
 * separator and (optionally) a red TODAY marker. Use as siblings inside any
 * LineChart / BarChart / ComposedChart.
 */
export function renderCdZones({
  cdX,
  xMin,
  xMax,
  todayX = null,
  hideBadges = false,
  hideCdLabel = false,
  xAxisId,
  yAxisId,
}: CdZoneProps) {
  const nodes: ReactNode[] = [
    <ReferenceArea
      key="pre-cd-zone"
      x1={xMin}
      x2={cdX}
      fill={CHART_PRE_CD_FILL}
      fillOpacity={CHART_PRE_CD_OPACITY}
      stroke="none"
      ifOverflow="visible"
      xAxisId={xAxisId}
      yAxisId={yAxisId}
      label={
        hideBadges
          ? undefined
          : {
              value: "PRE-CD",
              position: "insideTopLeft",
              fontSize: 9,
              fontWeight: 700,
              fill: "rgb(30 58 138)",
              fillOpacity: 0.55,
              letterSpacing: "0.08em",
              offset: 6,
            }
      }
    />,
    <ReferenceArea
      key="post-cd-zone"
      x1={cdX}
      x2={xMax}
      fill={CHART_POST_CD_FILL}
      fillOpacity={CHART_POST_CD_OPACITY}
      stroke="none"
      ifOverflow="visible"
      xAxisId={xAxisId}
      yAxisId={yAxisId}
      label={
        hideBadges
          ? undefined
          : {
              value: "POST-CD",
              position: "insideTopRight",
              fontSize: 9,
              fontWeight: 700,
              fill: "rgb(146 92 4)",
              fillOpacity: 0.65,
              letterSpacing: "0.08em",
              offset: 6,
            }
      }
    />,
    <ReferenceLine
      key="cd-separator"
      x={cdX}
      stroke="rgb(15 23 42)"
      strokeOpacity={0.55}
      strokeDasharray="4 4"
      strokeWidth={1.25}
      xAxisId={xAxisId}
      yAxisId={yAxisId}
      label={
        hideCdLabel
          ? undefined
          : {
              value: "CD",
              position: "top",
              fontSize: 10,
              fontWeight: 800,
              fill: "rgb(15 23 42)",
              fillOpacity: 0.9,
              offset: 4,
            }
      }
    />,
  ];

  if (todayX != null && todayX !== "" && Number.isFinite(Number(todayX))) {
    nodes.push(
      <ReferenceLine
        key="today-marker"
        x={todayX}
        stroke={CHART_TODAY_STROKE}
        strokeWidth={1.75}
        strokeDasharray="5 3"
        xAxisId={xAxisId}
        yAxisId={yAxisId}
        label={{
          value: "TODAY",
          position: "top",
          fontSize: 10,
          fontWeight: 800,
          fill: CHART_TODAY_STROKE,
          fillOpacity: 1,
          letterSpacing: "0.06em",
          offset: 4,
        }}
      />,
    );
  }

  return nodes;
}
