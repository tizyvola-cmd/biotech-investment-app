/** Desktop-aligned curve palette (invest-trend-chart-panel / chartTheme.ts). */

export const MOBILE_CHART_H = 280;
export const MOBILE_CHART_W = 340;

/** Model / pred line — CHART_LAB_LINE_PRED */
export const CHART_LINE_PRED = "#6b4fc8";
/** Actual path — CHART_LAB_LINE_ACTUAL */
export const CHART_LINE_ACTUAL = "#3baf8a";
/** SDS blend / historical teal */
export const CHART_LINE_BLEND = "#0d9488";

export const CHART_GAIN_PLANNED = "#6366f1";
export const CHART_GAIN_ACTUAL = "#00B050";
export const CHART_GAIN_HISTORICAL = "#0d9488";

export const CHART_TODAY = "#dc2626";
export const CHART_CD_STROKE = "rgba(15, 23, 42, 0.55)";
export const CHART_CD_LABEL = "rgb(15 23 42)";

export const CHART_TICK = "#64748b";
export const CHART_GRID = "rgba(59, 130, 246, 0.16)";
export const CHART_GRID_MAJOR = "rgba(120, 120, 120, 0.45)";

/** Pre/post CD bands — desktop :root chart-zone vars */
export const ZONE_PRE_FILL = "#1e3a8a";
export const ZONE_PRE_OPACITY = 0.045;
export const ZONE_POST_FILL = "#ca8a04";
export const ZONE_POST_OPACITY = 0.06;

/** Slope hot-window overlays (desktop SlopeTrajectoryChart) */
export const ZONE_HOT_W1 = "#bfdbfe";
export const ZONE_HOT_W1_OPACITY = 0.18;
export const ZONE_HOT_W2 = "#fde68a";
export const ZONE_HOT_W2_OPACITY = 0.2;
export const ZONE_RUNWAY = "#94a3b8";
export const ZONE_RUNWAY_OPACITY = 0.18;

/** Legacy aliases used by chart SVG modules */
export const CHART_PURPLE = CHART_LINE_PRED;
export const CHART_GREEN = CHART_LINE_ACTUAL;
export const CHART_TEAL = CHART_LINE_BLEND;
export const CHART_CD = CHART_CD_LABEL;
export const ZONE_PAST = ZONE_PRE_FILL;
export const ZONE_POST_CD = ZONE_POST_FILL;
