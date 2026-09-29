/**
 * Under-curve color blend for the Pulse Gain-vs-plan (breakeven) chart.
 * Each Soft BUY / Soft SELL index has its own RGB; intensity = clearance
 * past the minimum entrance gate (fades when restrictive / below gate).
 */
import type { AggregateGainPlanPoint } from "./dashboardPulseAggregate";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import {
  SOFT_BUY_G1_PPLAN_MIN,
  SOFT_BUY_G1_SDS_MIN,
  SOFT_SELL_G1_DEEP_PNL_PCT,
  SOFT_SELL_G1_PNL_PCT,
  SOFT_SELL_G1_PPLAN_MAX,
  SOFT_SELL_G1_REG,
  SOFT_SELL_G1_RISK_V2,
} from "./softSignalGrades";
import { SOFT_BUY_MIN_PCONT } from "./continuationScore";

export type BreakevenLogicMode = "buy" | "sell";

export type BreakevenLogicPosition = {
  key: string;
  ticker: string;
  capital: number;
  pplan: number | null;
  sds: number | null;
  pcont: number | null;
  pnlPct: number | null;
  riskV2: number | null;
  regRisk: number | null;
};

export type BreakevenLogicFillPoint = AggregateGainPlanPoint & {
  /** Actual € for Area (nulls dropped). */
  actualFill: number | null;
  fillColor: string;
  fillAlpha: number;
};

type Rgb = { r: number; g: number; b: number };

/** Distinct color per Soft BUY entrance index. */
export const BUY_INDEX_RGB: Record<"sds" | "pplan" | "pcont", Rgb> = {
  sds: { r: 124, g: 58, b: 237 }, // violet
  pplan: { r: 5, g: 150, b: 105 }, // emerald
  pcont: { r: 2, g: 132, b: 199 }, // sky
};

/** Distinct color per Soft SELL pressure index. */
export const SELL_INDEX_RGB: Record<"pnl" | "pplan" | "riskV2" | "reg" | "pcont", Rgb> = {
  pnl: { r: 225, g: 29, b: 72 }, // rose
  pplan: { r: 217, g: 119, b: 6 }, // amber (weak plan)
  riskV2: { r: 234, g: 88, b: 12 }, // orange
  reg: { r: 147, g: 51, b: 234 }, // purple
  pcont: { r: 13, g: 148, b: 136 }, // teal
};

export const BUY_INDEX_LEGEND: { id: keyof typeof BUY_INDEX_RGB; label: string; hex: string }[] = [
  { id: "sds", label: "SDS", hex: "#7c3aed" },
  { id: "pplan", label: "P(plan)", hex: "#059669" },
  { id: "pcont", label: "P(cont)", hex: "#0284c7" },
];

export const SELL_INDEX_LEGEND: { id: keyof typeof SELL_INDEX_RGB; label: string; hex: string }[] = [
  { id: "pnl", label: "MTM %", hex: "#e11d48" },
  { id: "pplan", label: "P(plan)↓", hex: "#d97706" },
  { id: "riskV2", label: "Risk v2", hex: "#ea580c" },
  { id: "reg", label: "Reg", hex: "#9333ea" },
  { id: "pcont", label: "P(cont)", hex: "#0d9488" },
];

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Intensity above a minimum gate: 0 below gate (faint), rises toward 1 as
 * the index clears the gate with more headroom (looser / stronger pass).
 */
export function clearanceAboveGate(
  value: number | null | undefined,
  minGate: number,
  headroom = 30,
): number {
  if (value == null || !Number.isFinite(value)) return 0;
  if (value < minGate) {
    // Restrictive / failed gate — faint residual so the blend still breathes.
    return clamp01(value / Math.max(minGate, 1)) * 0.18;
  }
  return clamp01(0.32 + 0.68 * ((value - minGate) / Math.max(headroom, 1)));
}

/** Soft SELL MTM: deeper loss → stronger rose (gate −2.5%, floor −12%). */
export function clearanceSellPnl(pnlPct: number | null | undefined): number {
  if (pnlPct == null || !Number.isFinite(pnlPct) || pnlPct >= 0) return 0;
  const soft = SOFT_SELL_G1_PNL_PCT; // -2.5
  const deep = SOFT_SELL_G1_DEEP_PNL_PCT; // -12
  if (pnlPct > soft) return clamp01((-pnlPct / -soft) * 0.2);
  return clamp01(0.35 + 0.65 * ((soft - pnlPct) / (soft - deep)));
}

/** Soft SELL weak P(plan): stronger when below max gate. */
export function clearanceSellWeakPplan(pplan: number | null | undefined): number {
  if (pplan == null || !Number.isFinite(pplan)) return 0;
  if (pplan >= SOFT_SELL_G1_PPLAN_MAX) return 0.1;
  return clamp01((SOFT_SELL_G1_PPLAN_MAX - pplan) / SOFT_SELL_G1_PPLAN_MAX);
}

function mixRgb(
  parts: { rgb: Rgb; w: number }[],
): { rgb: Rgb; weight: number } {
  let tw = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of parts) {
    if (!(p.w > 0)) continue;
    tw += p.w;
    r += p.rgb.r * p.w;
    g += p.rgb.g * p.w;
    b += p.rgb.b * p.w;
  }
  if (!(tw > 0)) {
    return { rgb: { r: 148, g: 163, b: 184 }, weight: 0 };
  }
  return {
    rgb: { r: Math.round(r / tw), g: Math.round(g / tw), b: Math.round(b / tw) },
    weight: tw,
  };
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${clamp01(alpha).toFixed(3)})`;
}

export type IndexClearanceRow = {
  id: string;
  label: string;
  hex: string;
  /** Book-weighted average raw index (null if missing). */
  value: number | null;
  gate: number;
  /** 0…1 clearance past min gate. */
  clearance: number;
};

function capWeight(
  pos: BreakevenLogicPosition,
  weightByTicker?: Map<string, number> | null,
): number {
  const tk = pos.ticker.trim().toUpperCase();
  const w =
    weightByTicker?.get(tk) ?? (pos.capital > 0 ? pos.capital : 1);
  return w > 0 ? w : 0;
}

function weightedAvg(
  positions: BreakevenLogicPosition[],
  weightByTicker: Map<string, number> | null | undefined,
  pick: (p: BreakevenLogicPosition) => number | null,
): number | null {
  let tw = 0;
  let sum = 0;
  for (const pos of positions) {
    const v = pick(pos);
    if (v == null || !Number.isFinite(v)) continue;
    const w = capWeight(pos, weightByTicker);
    if (!(w > 0)) continue;
    tw += w;
    sum += v * w;
  }
  return tw > 0 ? sum / tw : null;
}

export type CollectClearanceOpts = {
  /**
   * Only include these scoreable index ids (era-aware).
   * When omitted, include the full current Soft Soft set.
   */
  activeIds?: Set<string> | null;
  /** Override SDS min gate for the era (e.g. 25 before volume trial). */
  sdsMin?: number;
  pplanBuyMin?: number;
};

/** Per-index Soft BUY clearances (capital-weighted). */
export function collectBuyIndexClearances(
  positions: BreakevenLogicPosition[],
  weightByTicker?: Map<string, number> | null,
  opts?: CollectClearanceOpts,
): IndexClearanceRow[] {
  const sdsMin = opts?.sdsMin ?? SOFT_BUY_G1_SDS_MIN;
  const pplanMin = opts?.pplanBuyMin ?? SOFT_BUY_G1_PPLAN_MIN;
  const sds = weightedAvg(positions, weightByTicker, (p) => p.sds);
  const pplan = weightedAvg(positions, weightByTicker, (p) => p.pplan);
  const pcont = weightedAvg(positions, weightByTicker, (p) => p.pcont);
  const all: IndexClearanceRow[] = [
    {
      id: "sds",
      label: "SDS",
      hex: "#7c3aed",
      value: sds,
      gate: sdsMin,
      clearance: clearanceAboveGate(sds, sdsMin, 40),
    },
    {
      id: "pplan",
      label: "P(plan)",
      hex: "#059669",
      value: pplan,
      gate: pplanMin,
      clearance: clearanceAboveGate(pplan, pplanMin, 30),
    },
    {
      id: "pcont",
      label: "P(cont)",
      hex: "#0284c7",
      value: pcont,
      gate: SOFT_BUY_MIN_PCONT,
      clearance: clearanceAboveGate(pcont, SOFT_BUY_MIN_PCONT, 30),
    },
  ];
  if (!opts?.activeIds) return all;
  return all.filter((r) => opts.activeIds!.has(r.id));
}

/** Per-index Soft SELL clearances (capital-weighted). */
export function collectSellIndexClearances(
  positions: BreakevenLogicPosition[],
  weightByTicker?: Map<string, number> | null,
  opts?: CollectClearanceOpts,
): IndexClearanceRow[] {
  const pnl = weightedAvg(positions, weightByTicker, (p) => p.pnlPct);
  const pplan = weightedAvg(positions, weightByTicker, (p) => p.pplan);
  const risk = weightedAvg(positions, weightByTicker, (p) => p.riskV2);
  const reg = weightedAvg(positions, weightByTicker, (p) => p.regRisk);
  const pcont = weightedAvg(positions, weightByTicker, (p) => p.pcont);
  const all: IndexClearanceRow[] = [
    {
      id: "mtm",
      label: "MTM %",
      hex: "#e11d48",
      value: pnl,
      gate: SOFT_SELL_G1_PNL_PCT,
      clearance: clearanceSellPnl(pnl),
    },
    {
      id: "pnl",
      label: "MTM %",
      hex: "#e11d48",
      value: pnl,
      gate: SOFT_SELL_G1_PNL_PCT,
      clearance: clearanceSellPnl(pnl),
    },
    {
      id: "pplan",
      label: "P(plan)↓",
      hex: "#d97706",
      value: pplan,
      gate: SOFT_SELL_G1_PPLAN_MAX,
      clearance: clearanceSellWeakPplan(pplan),
    },
    {
      id: "riskV2",
      label: "Risk v2",
      hex: "#ea580c",
      value: risk,
      gate: SOFT_SELL_G1_RISK_V2,
      clearance: clearanceAboveGate(risk, SOFT_SELL_G1_RISK_V2, 40),
    },
    {
      id: "reg",
      label: "Reg",
      hex: "#9333ea",
      value: reg,
      gate: SOFT_SELL_G1_REG,
      clearance: clearanceAboveGate(reg, SOFT_SELL_G1_REG, 40),
    },
    {
      id: "pcont",
      label: "P(cont)",
      hex: "#0d9488",
      value: pcont,
      gate: SOFT_BUY_MIN_PCONT,
      clearance: clearanceAboveGate(pcont, SOFT_BUY_MIN_PCONT, 30),
    },
  ];
  if (!opts?.activeIds) {
    // Default current Soft Soft set (unique labels).
    return all.filter((r) => r.id !== "pnl");
  }
  const seen = new Set<string>();
  return all.filter((r) => {
    if (!opts.activeIds!.has(r.id) && !(r.id === "pnl" && opts.activeIds!.has("mtm"))) {
      return false;
    }
    const key = r.label;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function meanClearance(rows: IndexClearanceRow[]): number {
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + r.clearance, 0) / rows.length;
}

export function blendPositionsLogicColor(
  positions: BreakevenLogicPosition[],
  mode: BreakevenLogicMode,
  weightByTicker?: Map<string, number> | null,
): { css: string; alpha: number } {
  const parts: { rgb: Rgb; w: number }[] = [];
  let weightSum = 0;

  for (const pos of positions) {
    const capW = capWeight(pos, weightByTicker);
    if (!(capW > 0)) continue;
    weightSum += capW;

    if (mode === "buy") {
      const sdsC = clearanceAboveGate(pos.sds, SOFT_BUY_G1_SDS_MIN, 40);
      const pplanC = clearanceAboveGate(pos.pplan, SOFT_BUY_G1_PPLAN_MIN, 30);
      const pcontC = clearanceAboveGate(pos.pcont, SOFT_BUY_MIN_PCONT, 30);
      parts.push({ rgb: BUY_INDEX_RGB.sds, w: capW * sdsC });
      parts.push({ rgb: BUY_INDEX_RGB.pplan, w: capW * pplanC });
      parts.push({ rgb: BUY_INDEX_RGB.pcont, w: capW * pcontC });
    } else {
      const pnlC = clearanceSellPnl(pos.pnlPct);
      const pplanC = clearanceSellWeakPplan(pos.pplan);
      const riskC = clearanceAboveGate(pos.riskV2, SOFT_SELL_G1_RISK_V2, 40);
      const regC = clearanceAboveGate(pos.regRisk, SOFT_SELL_G1_REG, 40);
      // P(cont) on sell side: high continuation while in profit / exhaustion proxy —
      // use clearance above coin-flip as teal contribution.
      const pcontC = clearanceAboveGate(pos.pcont, SOFT_BUY_MIN_PCONT, 30);
      parts.push({ rgb: SELL_INDEX_RGB.pnl, w: capW * pnlC });
      parts.push({ rgb: SELL_INDEX_RGB.pplan, w: capW * pplanC });
      parts.push({ rgb: SELL_INDEX_RGB.riskV2, w: capW * riskC });
      parts.push({ rgb: SELL_INDEX_RGB.reg, w: capW * regC });
      parts.push({ rgb: SELL_INDEX_RGB.pcont, w: capW * pcontC });
    }
  }

  const mixed = mixRgb(parts);
  // Alpha rises when gates clear (looser / stronger); stays pale when restrictive.
  const norm = weightSum > 0 ? mixed.weight / weightSum : 0;
  const alpha = 0.1 + 0.42 * clamp01(norm);
  return { css: rgba(mixed.rgb, alpha), alpha };
}

/** Nearest history snapshot for a chart timestamp (exported for week sessions). */
export function nearestHistoryForLogic(
  history: InvestSimHistoryPoint[],
  ts: string,
): InvestSimHistoryPoint | undefined {
  return nearestHistory(history, ts);
}

export function historyWeightsForLogic(
  h: InvestSimHistoryPoint | undefined,
  positions: BreakevenLogicPosition[],
): Map<string, number> | null {
  return weightsFromHistoryPoint(h, positions);
}

function weightsFromHistoryPoint(
  h: InvestSimHistoryPoint | undefined,
  positions: BreakevenLogicPosition[],
): Map<string, number> | null {
  if (!h?.byTicker) return null;
  const m = new Map<string, number>();
  for (const pos of positions) {
    const tk = pos.ticker.trim().toUpperCase();
    const snap = h.byTicker[pos.key] ?? h.byTicker[tk];
    if (!snap) continue;
    const entry = Number.isFinite(snap.value) && Number.isFinite(snap.pnl)
      ? Math.max(0, snap.value - snap.pnl)
      : Math.abs(snap.value);
    if (entry > 0) m.set(tk, entry);
  }
  return m.size ? m : null;
}

function nearestHistory(
  history: InvestSimHistoryPoint[],
  ts: string,
): InvestSimHistoryPoint | undefined {
  if (!history.length) return undefined;
  const target = Date.parse(ts);
  if (!Number.isFinite(target)) return history[history.length - 1];
  let best = history[0]!;
  let bestDist = Math.abs(Date.parse(best.ts) - target);
  for (let i = 1; i < history.length; i++) {
    const h = history[i]!;
    const d = Math.abs(Date.parse(h.ts) - target);
    if (d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  return best;
}

/** Enrich aggregate series with under-curve fill colors for the active mode. */
export function buildBreakevenLogicFillSeries(
  series: AggregateGainPlanPoint[],
  positions: BreakevenLogicPosition[],
  history: InvestSimHistoryPoint[],
  mode: BreakevenLogicMode,
): BreakevenLogicFillPoint[] {
  return series.map((p) => {
    const h = nearestHistory(history, p.ts);
    const weights = weightsFromHistoryPoint(h, positions);
    // Historical pnl% override for sell MTM intensity when snap exists.
    const posForPoint =
      mode === "sell" && h?.byTicker
        ? positions.map((pos) => {
            const snap = h.byTicker[pos.key] ?? h.byTicker[pos.ticker.trim().toUpperCase()];
            if (!snap || !Number.isFinite(snap.pnlPct)) return pos;
            return { ...pos, pnlPct: snap.pnlPct };
          })
        : positions;
    const { css, alpha } = blendPositionsLogicColor(posForPoint, mode, weights);
    return {
      ...p,
      actualFill: p.actual != null && Number.isFinite(p.actual) ? p.actual : null,
      fillColor: css,
      fillAlpha: alpha,
    };
  });
}
