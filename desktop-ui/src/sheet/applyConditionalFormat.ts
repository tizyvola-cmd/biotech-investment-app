import type { CSSProperties } from "react";
import {
  DATA_BAR_COLORS,
  type CfDataBarRule,
  type CfRule,
  type ColorScalePreset,
  type ConditionalFormatPrefs,
  type IconSetPreset,
} from "./conditionalFormat";
import { colorScaleT, computeColorScaleStats, linearRgbDiverging } from "./variationColors";
import { TABLE_COLORS_ENABLED } from "./tableColorsEnabled";

export type ColumnStats = {
  min: number;
  max: number;
  mean: number;
  std: number;
  values: number[];
  thresholds: number[];
};

export type CfCellExtras = {
  style?: CSSProperties;
  icon?: string;
  iconColor?: string;
  iconOnly?: boolean;
};

export function parseCellNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "" || raw === "—" || raw === "-") {
    return null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const s = String(raw).replace(/%/g, "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Se il valore è frazione 0–1.5 tipica di % Excel, espandi in punti percentuali. */
export function normalizePercentLike(n: number, raw: unknown): number {
  if (Math.abs(n) <= 1.5 && !String(raw).includes("%")) return n * 100;
  return n;
}

export function buildColumnStats(
  rows: Record<string, unknown>[],
  column: string
): ColumnStats | null {
  const values: number[] = [];
  for (const row of rows) {
    const n = parseCellNumber(row[column]);
    if (n === null) continue;
    values.push(normalizePercentLike(n, row[column]));
  }
  if (values.length < 1) return null;
  values.sort((a, b) => a - b);
  const min = values[0];
  const max = values[values.length - 1];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.length > 1
      ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
      : 0;
  const std = Math.sqrt(variance);
  const thresholds = values.map((_, i) => {
    const p = values.length <= 1 ? 0.5 : i / (values.length - 1);
    return percentile(values, p);
  });
  return { min, max, mean, std, values, thresholds };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): string {
  return rgb(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
}

function colorScaleRgb(preset: ColorScalePreset, t: number): string {
  const x = Math.max(0, Math.min(1, t));
  switch (preset) {
    case "greenYellowRed":
      if (x <= 0.5) return lerpRgb([248, 105, 107], [255, 235, 132], x * 2);
      return lerpRgb([255, 235, 132], [99, 190, 123], (x - 0.5) * 2);
    case "blueWhiteRed":
      if (x <= 0.5) return lerpRgb([49, 54, 149], [255, 255, 255], x * 2);
      return lerpRgb([255, 255, 255], [165, 0, 38], (x - 0.5) * 2);
    case "greenWhite":
      return lerpRgb([99, 190, 123], [255, 255, 255], x);
    case "redWhite":
      return lerpRgb([248, 105, 107], [255, 255, 255], x);
    case "whiteGreen":
      return lerpRgb([255, 255, 255], [99, 190, 123], x);
    case "whiteRed":
      return lerpRgb([255, 255, 255], [248, 105, 107], x);
    case "greyScale":
      return lerpRgb([240, 240, 240], [80, 80, 80], x);
    case "diverging":
    default:
      return linearRgbDiverging(x);
  }
}

function textColorForBg(bg: string): string | undefined {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(bg);
  if (!m) return undefined;
  const lum = 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
  return lum < 140 ? "#FFFFFF" : undefined;
}

function tForValue(
  value: number,
  stats: ColumnStats,
  minOverride?: number | null,
  maxOverride?: number | null
): number {
  const lo = minOverride ?? stats.min;
  const hi = maxOverride ?? stats.max;
  if (hi <= lo) return 0.5;
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

function applyColorScale(
  value: number,
  rule: Extract<CfRule, { type: "colorScale" }>,
  stats: ColumnStats
): CSSProperties {
  let t: number;
  if (rule.preset === "diverging" && stats.std > 0) {
    const cs = computeColorScaleStats(stats.values);
    t = cs ? colorScaleT(value, cs) : tForValue(value, stats, rule.minValue, rule.maxValue);
  } else {
    t = tForValue(value, stats, rule.minValue, rule.maxValue);
  }
  const bg = colorScaleRgb(rule.preset, t);
  return {
    backgroundColor: bg,
    color: textColorForBg(bg),
  };
}

function barColor(rule: CfDataBarRule): string {
  if (rule.preset === "custom" && rule.barColor) return rule.barColor;
  if (rule.preset !== "custom") return DATA_BAR_COLORS[rule.preset];
  return DATA_BAR_COLORS.green;
}

function applyDataBar(
  value: number,
  rule: CfDataBarRule,
  stats: ColumnStats
): CSSProperties {
  const lo = stats.min;
  const hi = stats.max;
  if (hi <= lo) return {};
  const pct = Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));
  const col = barColor(rule);
  const axis = rule.axisColor ?? "rgba(128,128,128,0.35)";
  if (rule.gradient !== false) {
    return {
      background: `linear-gradient(to right, ${col}66 0%, ${col}66 ${pct}%, transparent ${pct}%), linear-gradient(to right, transparent 0%, transparent 100%)`,
      boxShadow: `inset 0 -1px 0 0 ${axis}`,
    };
  }
  return {
    background: `linear-gradient(to right, ${col} 0%, ${col} ${pct}%, transparent ${pct}%)`,
  };
}

type IconTier = { icon: string; color: string };

function percentileRank(value: number, stats: ColumnStats): number {
  const v = stats.values;
  if (v.length <= 1) return 0.5;
  let below = 0;
  for (const x of v) {
    if (x < value) below++;
  }
  return below / (v.length - 1);
}

function iconForPreset(preset: IconSetPreset, value: number, stats: ColumnStats): IconTier {
  const p = percentileRank(value, stats);

  const pick = (tiers: IconTier[]): IconTier => {
    const idx = Math.min(tiers.length - 1, Math.floor(p * tiers.length));
    return tiers[idx];
  };

  switch (preset) {
    case "arrows4":
      return pick([
        { icon: "↓", color: "#C00000" },
        { icon: "↘", color: "#E65100" },
        { icon: "↗", color: "#2E7D32" },
        { icon: "↑", color: "#1B5E20" },
      ]);
    case "arrows5":
      return pick([
        { icon: "↓↓", color: "#B71C1C" },
        { icon: "↓", color: "#C00000" },
        { icon: "→", color: "#757575" },
        { icon: "↑", color: "#2E7D32" },
        { icon: "↑↑", color: "#1B5E20" },
      ]);
    case "traffic4":
      return pick([
        { icon: "●", color: "#C00000" },
        { icon: "●", color: "#E65100" },
        { icon: "●", color: "#F9A825" },
        { icon: "●", color: "#2E7D32" },
      ]);
    case "flags3":
      return pick([
        { icon: "▮", color: "#C00000" },
        { icon: "▮", color: "#FFC000" },
        { icon: "▮", color: "#00B050" },
      ]);
    case "rating5": {
      const stars = Math.min(5, Math.max(1, Math.ceil(p * 5)));
      return { icon: "★".repeat(stars) + "☆".repeat(5 - stars), color: "#FFC000" };
    }
    case "quarters5":
      return pick([
        { icon: "○", color: "#BDBDBD" },
        { icon: "◔", color: "#90A4AE" },
        { icon: "◑", color: "#FFA726" },
        { icon: "◕", color: "#66BB6A" },
        { icon: "●", color: "#2E7D32" },
      ]);
    case "traffic3":
      return pick([
        { icon: "●", color: "#C00000" },
        { icon: "●", color: "#FFC000" },
        { icon: "●", color: "#00B050" },
      ]);
    case "arrows3":
    default:
      return pick([
        { icon: "↓", color: "#C00000" },
        { icon: "→", color: "#757575" },
        { icon: "↑", color: "#00B050" },
      ]);
  }
}

function ruleMatchesColumn(rule: CfRule, column: string): boolean {
  if (rule.column === "*") return true;
  return rule.column === column;
}

export function rulesForColumn(rules: CfRule[], column: string): CfRule[] {
  return rules
    .filter((r) => r.enabled && ruleMatchesColumn(r, column))
    .sort((a, b) => a.priority - b.priority);
}

export function applyConditionalFormatToCell(
  column: string,
  raw: unknown,
  prefs: ConditionalFormatPrefs,
  statsMap: Map<string, ColumnStats>
): CfCellExtras | null {
  if (!TABLE_COLORS_ENABLED) return null;
  if (!prefs.rules.length) return null;
  const n = parseCellNumber(raw);
  if (n === null) return null;
  const value = normalizePercentLike(n, raw);
  const active = rulesForColumn(prefs.rules, column);
  if (!active.length) return null;

  let style: CSSProperties = {};
  let icon: string | undefined;
  let iconColor: string | undefined;
  let iconOnly = false;

  for (const rule of active) {
    const stats =
      rule.column === "*"
        ? statsMap.get(column)
        : statsMap.get(rule.column) ?? statsMap.get(column);
    if (!stats) continue;

    if (rule.type === "colorScale") {
      Object.assign(style, applyColorScale(value, rule, stats));
    } else if (rule.type === "dataBar") {
      const bar = applyDataBar(value, rule, stats);
      if (style.backgroundColor && bar.background) {
        style = { ...style, background: bar.background, boxShadow: bar.boxShadow };
        delete style.backgroundColor;
      } else {
        Object.assign(style, bar);
      }
    } else if (rule.type === "iconSet") {
      const tier = iconForPreset(rule.preset, value, stats);
      icon = tier.icon;
      iconColor = tier.color;
      iconOnly = rule.iconOnly ?? false;
    }
  }

  if (!Object.keys(style).length && !icon) return null;
  return { style, icon, iconColor, iconOnly };
}

export function buildStatsMap(
  rows: Record<string, unknown>[],
  columns: string[],
  rules: CfRule[]
): Map<string, ColumnStats> {
  const needCols = new Set<string>();
  for (const r of rules) {
    if (!r.enabled) continue;
    if (r.column === "*") {
      for (const c of columns) needCols.add(c);
    } else {
      needCols.add(r.column);
    }
  }
  const map = new Map<string, ColumnStats>();
  for (const col of needCols) {
    const st = buildColumnStats(rows, col);
    if (st) map.set(col, st);
  }
  return map;
}

export function mergeCellStyles(
  base: CSSProperties | undefined,
  cf: CfCellExtras | null,
  overrideBuiltIn: boolean
): CSSProperties {
  if (!cf?.style && !base) return {};
  if (!cf?.style) return { ...base };
  if (!base || overrideBuiltIn) {
    return { ...base, ...cf.style };
  }
  return {
    ...base,
    ...cf.style,
    color: cf.style.color ?? base.color,
    fontWeight: cf.style.fontWeight ?? base.fontWeight,
    fontStyle: cf.style.fontStyle ?? base.fontStyle,
  };
}
