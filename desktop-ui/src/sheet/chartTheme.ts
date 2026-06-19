/** Dark navy chart chrome — Catalyst curves / legacy plots. */

import { rechartsGridStroke, rechartsTickFill } from "../utils/chartGrad";

export const CHART_BG = "#0b1025";
export const CHART_BG_GRADIENT = "linear-gradient(180deg, rgb(15 23 42) 0%, rgb(11 16 37) 100%)";

export const CHART_PANEL_PAD =
  "chart-dark-panel rounded-lg border p-3 flex flex-col min-h-0";
export const CHART_PANEL = "chart-dark-panel rounded-lg border p-3";
export const CHART_PANEL_EMPTY = "chart-dark-panel rounded-lg border p-4";

export const CHART_TITLE = "text-sm font-semibold chart-dark-title mb-2 shrink-0";
export const CHART_TITLE_SIMPLE = "text-sm font-semibold chart-dark-title mb-2";
export const CHART_FOOTER = "text-[10px] chart-dark-muted mt-1 shrink-0";
export const CHART_EMPTY_MSG = "text-xs chart-dark-muted py-6 text-center";

export const CHART_AXIS_TICK = { fontSize: 10, fill: "#94a3b8" };
export const CHART_AXIS_LINE = { stroke: "#475569" };
export const CHART_GRID = {
  strokeDasharray: "3 3",
  stroke: "rgba(148, 163, 184, 0.22)",
};

export function chartLegendStyle(extra?: Record<string, unknown>) {
  return {
    wrapperStyle: {
      fontSize: 11,
      color: "#cbd5e1",
      ...extra,
    },
  };
}

export const CHART_TOOLTIP =
  "rounded-lg border border-slate-600/70 bg-slate-900/95 px-3 py-2 text-xs shadow-lg";
export const CHART_TOOLTIP_TITLE = "font-semibold text-slate-100";
export const CHART_TOOLTIP_MUTED = "text-slate-400";

/** Light lab chart — white/blue plot, mint Decision Lab shell. */
export const CHART_LAB_PANEL = "chart-lab-panel rounded-lg border p-3";
export const CHART_LAB_TITLE = "text-sm font-semibold chart-lab-title mb-2 shrink-0";
export const CHART_LAB_FOOTER = "text-[10px] chart-lab-muted mt-1 shrink-0";
export const CHART_LAB_AXIS_TICK = { fontSize: 10, fill: "#475569" };
export const CHART_LAB_AXIS_LINE = { stroke: "#94a3b8" };
export const CHART_LAB_GRID = {
  strokeDasharray: "3 3",
  stroke: "rgba(59, 130, 246, 0.18)",
};
/** Fixed curve colors — do not vary with violet/mint appearance theme. */
export const CHART_LAB_LINE_PRED = "var(--chart-model, #6b4fc8)";
export const CHART_LAB_LINE_ACTUAL = "var(--chart-actual-long, #3baf8a)";
export const CHART_LAB_LINE_EXPECTED = "var(--chart-expected, #c8508a)";
export const CHART_LAB_DOT_PRED = "var(--chart-model, #6b4fc8)";
export const CHART_LAB_DOT_ACTUAL = "var(--chart-actual-long, #3baf8a)";

export function chartLabLegendStyle(extra?: Record<string, unknown>) {
  return {
    wrapperStyle: {
      fontSize: 11,
      color: "#334155",
      ...extra,
    },
  };
}

export const CHART_LAB_TOOLTIP =
  "rounded-lg border border-[rgb(var(--panel-lab-border))] bg-white px-3 py-2 text-xs shadow-md";
export const CHART_LAB_TOOLTIP_TITLE = "font-semibold text-[rgb(5,150,105)]";
export const CHART_LAB_TOOLTIP_MUTED = "text-slate-600";

/** Curves view (Catalyst menu) — white / blue / yellow gradient, white predominates. */
export const CHART_CURVES_PANEL_PAD =
  "invest-trend-chart-panel rounded-lg border p-3 flex flex-col min-h-0";
export const CHART_CURVES_PANEL = "invest-trend-chart-panel rounded-lg border p-3";
export const CHART_CURVES_PANEL_EMPTY = "invest-trend-chart-panel rounded-lg border p-4";
export const CHART_CURVES_TITLE = "text-sm font-semibold text-ink mb-2 shrink-0";
export const CHART_CURVES_TITLE_SIMPLE = "text-sm font-semibold text-ink mb-2";
export const CHART_CURVES_FOOTER = "text-[10px] chart-trend-muted mt-1 shrink-0";
export const CHART_CURVES_EMPTY_MSG = "text-xs chart-trend-muted py-6 text-center";

export function chartCurvesAxisTick() {
  return { fontSize: 10, fill: rechartsTickFill() };
}

export function chartCurvesAxisLine() {
  return { stroke: rechartsTickFill() };
}

export function chartCurvesGrid() {
  return {
    strokeDasharray: "4 6",
    stroke: rechartsGridStroke(),
    strokeOpacity: 1,
  };
}

/** @deprecated prefer chartCurvesAxisTick() for theme-aware ticks */
export const CHART_CURVES_AXIS_TICK = { fontSize: 10, fill: "#64748b" };
export const CHART_CURVES_AXIS_LINE = { stroke: "#cbd5e1" };
export const CHART_CURVES_GRID = {
  strokeDasharray: "4 6",
  stroke: "#93c5fd",
  strokeOpacity: 0.38,
};

export function chartCurvesLegendStyle(extra?: Record<string, unknown>) {
  return {
    wrapperStyle: {
      fontSize: 11,
      color: "#334155",
      ...extra,
    },
  };
}

export const CHART_CURVES_TOOLTIP =
  "rounded-lg border border-slate-200/90 bg-white px-3 py-2 text-xs shadow-md";
export const CHART_CURVES_TOOLTIP_TITLE = "font-semibold text-ink";
export const CHART_CURVES_TOOLTIP_MUTED = "text-slate-600";
