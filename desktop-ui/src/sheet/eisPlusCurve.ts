import type { ChartPoint } from "../types";
import type { ClinicalPreCdRecord } from "../api/supernova";
import {
  buildEisClinicalSignal,
  findClinicalPreCdRecord,
  type EisClinicalSignal,
} from "./eisPolyAdjust";

function basePct(p: ChartPoint): number | null {
  const v = p.pct_foglio ?? p.pct_curva ?? p.pct_modello;
  return v != null && Number.isFinite(v) ? v : null;
}

function numCell(v: unknown): number | null {
  if (v == null || v === "" || v === "—") return null;
  const x = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(x) ? x : null;
}

/** Residual EIS shift for UI overlay when backend already applied ``eis_poly_shift_pp``. */
export function residualEisShiftPp(
  signalShiftPp: number,
  row: Record<string, unknown> | null | undefined,
): number {
  if (!row) return signalShiftPp;
  const applied =
    row.eis_poly_applied === true ||
    row.eis_poly_applied === 1 ||
    String(row.eis_poly_applied).toLowerCase() === "true";
  const backend = numCell(row.eis_poly_shift_pp);
  if (!applied || backend == null) return signalShiftPp;
  const residual = signalShiftPp - backend;
  return Math.abs(residual) < 0.05 ? 0 : Math.round(residual * 10) / 10;
}

/** Apply uniform EIS polynomial shift on top of the recalibrated prediction path. */
export function applyEisPlusShiftToPoints(
  points: ChartPoint[],
  shiftPp: number,
): ChartPoint[] {
  if (!shiftPp) {
    return points.map((p) => ({ ...p, pct_eis_plus: basePct(p) }));
  }
  return points.map((p) => {
    const base = basePct(p);
    if (base == null) return { ...p, pct_eis_plus: null };
    return {
      ...p,
      pct_eis_plus: Math.round((base + shiftPp) * 10) / 10,
    };
  });
}

export function resolveEisPlusCurve(
  points: ChartPoint[],
  ticker: string,
  cdIso: string | null,
  records: ClinicalPreCdRecord[],
  row?: Record<string, unknown> | null,
): { points: ChartPoint[]; signal: EisClinicalSignal } {
  const rec = findClinicalPreCdRecord(ticker, cdIso, records);
  const signal = buildEisClinicalSignal(rec);
  const shift = residualEisShiftPp(signal.shiftPp, row);
  return {
    points: applyEisPlusShiftToPoints(points, shift),
    signal: { ...signal, shiftPp: shift },
  };
}

export function formatEisPlusLegendShift(signal: EisClinicalSignal): string {
  if (!signal.eventCount && signal.shiftPp === 0) return "+EIS (N/D)";
  const sign = signal.shiftPp >= 0 ? "+" : "";
  return `+EIS (${sign}${signal.shiftPp.toFixed(1)} pp)`;
}
