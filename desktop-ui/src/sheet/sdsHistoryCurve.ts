/**
 * SuperNova cluster reference curves — k-means cluster 1 (4 historical surges).
 * Offsets align with SIMULATION_PRED_CAL_OFFSETS / Accuracy sheet (% vs T−60).
 */
import { STANDARD_CAL_OFFSETS } from "./chartNodes";

export const SUPERNova_OFFSETS = STANDARD_CAL_OFFSETS;

export type HistoryCurvePoint = {
  offset: number;
  label: string;
  supernovaMean: number;
  mdgl?: number;
  antx?: number;
  ctmx?: number;
  acrs?: number;
};

function offsetLabel(off: number): string {
  if (off === 0) return "CD";
  return off > 0 ? `T+${off}` : `T${off}`;
}

/** Etichetta asse X SuperNova (es. T-30, CD). */
export function supernovaOffsetLabel(off: number): string {
  return offsetLabel(off);
}

/** μ SuperNova (cl.1) — mean of ACRS, ANTX, CTMX, MDGL seq_curve_pct_vs_m60. */
const _MEAN = [0.0, 38.99, 256.19, 318.23, 386.94, 377.94, 377.74, 390.5];
const _MDGL = [0.0, 4.18, 303.37, 348.89, 348.89, 341.42, 361.58, 363.93];
const _ANTX = [0.0, -16.67, 6.35, 126.19, 316.67, 303.97, 266.67, 217.46];
const _CTMX = [0.0, 108.7, 384.78, 421.74, 476.09, 445.65, 471.74, 513.04];
const _ACRS = [0.0, 59.76, 330.24, 376.1, 406.1, 420.73, 410.98, 467.56];

/** Peak historical ROI (% vs T−60) across calendar knots. */
export function historyPeakRoi(values: number[]): number {
  return values.length ? Math.max(...values) : 0;
}

export const HISTORY_MEAN_PEAK_ROI = historyPeakRoi(_MEAN);

export const SUPERNova_HISTORY_CURVE: HistoryCurvePoint[] = SUPERNova_OFFSETS.map((off, i) => ({
  offset: off,
  label: offsetLabel(off),
  supernovaMean: _MEAN[i] ?? 0,
  mdgl: _MDGL[i],
  antx: _ANTX[i],
  ctmx: _CTMX[i],
  acrs: _ACRS[i],
}));

export type HistoryCaseId = "mdgl" | "antx" | "ctmx" | "acrs";

export const HISTORY_CASES: {
  id: HistoryCaseId;
  ticker: string;
  cd: string;
  company: string;
  color: string;
  curveKey: keyof Pick<HistoryCurvePoint, "mdgl" | "antx" | "ctmx" | "acrs">;
  peakRoi: number;
}[] = [
  {
    id: "mdgl",
    ticker: "MDGL",
    cd: "2023-01-06",
    company: "Madrigal Pharmaceuticals",
    color: "#c8ff00",
    curveKey: "mdgl",
    peakRoi: historyPeakRoi(_MDGL),
  },
  {
    id: "antx",
    ticker: "ANTX",
    cd: "2026-03-14",
    company: "AN2 Therapeutics",
    color: "#78c8ff",
    curveKey: "antx",
    peakRoi: historyPeakRoi(_ANTX),
  },
  {
    id: "ctmx",
    ticker: "CTMX",
    cd: "2025-06-04",
    company: "CytomX Therapeutics",
    color: "#f472b6",
    curveKey: "ctmx",
    peakRoi: historyPeakRoi(_CTMX),
  },
  {
    id: "acrs",
    ticker: "ACRS",
    cd: "2021-02-04",
    company: "Aclaris Therapeutics",
    color: "#fb7185",
    curveKey: "acrs",
    peakRoi: historyPeakRoi(_ACRS),
  },
];

export const SUPERNova_MEAN_COLOR = "#c8ff00";

export function caseCurveValues(id: HistoryCaseId): number[] {
  const meta = HISTORY_CASES.find((c) => c.id === id);
  if (!meta) return [];
  return SUPERNova_HISTORY_CURVE.map((p) => p[meta.curveKey] ?? 0);
}
