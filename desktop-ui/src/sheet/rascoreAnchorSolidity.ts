/**
 * RA / entry solidity computed as-of a CD calendar anchor (T−60, T−30, …).
 * Uses curve + timing at that offset; SDS/MII/calib remain current snapshots (documented).
 */
import type { ChartPoint } from "../types";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import type { EntrySolidityComposite } from "./entrySolidityComposite";
import { buildPrecatEntry } from "./precatCurve";
import {
  applyMarketContextGate,
  effectivePrecatKindForPick,
  getCachedMarketContext,
  loadMarketGateBypass,
} from "./marketContextGate";
import { computeSlopeStability, stabilityVerdict } from "./slopeStability";
import { daysFromToday } from "./simulationPlanGain";
import { extractSparklinePoints } from "./simulationSparkline";
import { resolveSimulationEntrySolidity, simulationSolidityVisible } from "./simulationEntrySolidity";
import { pickSignalFromSimRow } from "./top2FromSimulation";
import type { Top2PickSignal } from "./top2PortfolioPick";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import type { StrictTopOppOpts } from "./topOppsStrictPick";
import { resolveDisplayRecalibPoints } from "./predictionCurveGrid";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundPredPp(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Giorni al CD alla data ancoraggio (es. T−60 → ~60 se oggi siamo a T−20). */
export function daysToCdAtAnchor(
  daysToday: number | null,
  nowOff: number | null,
  anchor: number,
): number | null {
  if (daysToday == null || nowOff == null || !Number.isFinite(daysToday)) return null;
  if (nowOff < anchor) return null;
  return Math.round(daysToday + (nowOff - anchor));
}

export function anchorReachable(nowOff: number | null, anchor: number): boolean {
  return nowOff != null && Number.isFinite(nowOff) && nowOff >= anchor;
}

function modelPctSeries(chartPoints: ChartPoint[] | null | undefined): { offset: number; y: number }[] {
  if (!chartPoints?.length) return [];
  const overlaid = resolveDisplayRecalibPoints(chartPoints, {});
  const src = overlaid.length ? overlaid : chartPoints;
  return src
    .map((p) => {
      const y = p.pct_foglio ?? p.pct_modello ?? p.pct_curva;
      return y != null && Number.isFinite(y) ? { offset: p.offset, y } : null;
    })
    .filter((x): x is { offset: number; y: number } => x != null)
    .sort((a, b) => a.offset - b.offset);
}

function mergeModelSeries(
  chartSeries: { offset: number; y: number }[],
  row: Record<string, unknown>,
): { offset: number; y: number }[] {
  const sheet = extractSparklinePoints(row).map((p) => ({ offset: p.offset, y: p.val }));
  if (!chartSeries.length) return sheet;
  const byOff = new Map<number, number>();
  for (const p of sheet) byOff.set(p.offset, p.y);
  for (const p of chartSeries) byOff.set(p.offset, p.y);
  return [...byOff.entries()].map(([offset, y]) => ({ offset, y })).sort((a, b) => a.offset - b.offset);
}

function curveDeltaPp(
  series: { offset: number; y: number }[],
  fromOff: number,
  spanDays: number,
): number | null {
  if (series.length < 2) return null;
  const at = interpolateAtOffset(series, fromOff, { extrapolate: true });
  const fwd = interpolateAtOffset(series, fromOff + spanDays, { extrapolate: true });
  if (at == null || fwd == null) return null;
  return roundPredPp(fwd - at);
}

function runUp30dAtAnchor(
  series: { offset: number; y: number }[],
  anchor: number,
): number | null {
  const at = interpolateAtOffset(series, anchor, { extrapolate: true });
  const prev = interpolateAtOffset(series, anchor - 30, { extrapolate: true });
  if (at == null || prev == null) return null;
  return roundPredPp(at - prev);
}

function targetRoiAtAnchor(
  series: { offset: number; y: number }[],
  anchor: number,
  daysAt: number,
  flatThr = 0.05,
): number | null {
  if (series.length < 2 || daysAt <= 0) return null;
  const at = interpolateAtOffset(series, anchor, { extrapolate: true });
  if (at == null) return null;

  const endOff = Math.min(0, anchor + daysAt);
  let peakY = at;
  let prevY = at;
  for (let off = anchor + 1; off <= endOff; off += 1) {
    const y = interpolateAtOffset(series, off, { extrapolate: true });
    if (y == null) continue;
    if (y > peakY) peakY = y;
    if (y < prevY - flatThr * 3 && peakY - at > flatThr * 3) break;
    prevY = y;
  }
  const ret = roundPredPp(peakY - at);
  return ret > 0 ? ret : null;
}

export function buildPickAsOfCdAnchor(
  simRow: Record<string, unknown>,
  mergedInputs: InvestSimInputs,
  chartPts: ChartPoint[] | null | undefined,
  history: InvestSimHistoryPoint[] | null | undefined,
  anchor: number,
  opts?: { calibrationRelaxed?: boolean },
): Top2PickSignal | null {
  const relaxed = opts?.calibrationRelaxed === true;
  const base = pickSignalFromSimRow(simRow, mergedInputs, chartPts, history, undefined, {
    calibrationCohort: relaxed,
  });
  if (!base) return null;

  const nowOff = completionDateToNowOffset(simRow["Completion Date"]);
  if (!anchorReachable(nowOff, anchor)) return null;

  const daysToday = daysFromToday(String(simRow["Completion Date"] ?? ""));
  const daysAt = daysToCdAtAnchor(daysToday, nowOff, anchor);
  if (daysAt == null) return null;
  if (!relaxed && (daysAt < -45 || daysAt > 120)) return null;

  const series = mergeModelSeries(modelPctSeries(chartPts), simRow);
  const slope5d = curveDeltaPp(series, anchor, 5);
  const slope20d = curveDeltaPp(series, anchor, 20);
  const slope45d = curveDeltaPp(series, anchor, 45);
  const runUp30d = runUp30dAtAnchor(series, anchor);
  const pred5 = slope5d;

  const precatRaw = buildPrecatEntry(slope5d, slope20d, runUp30d, daysAt);
  const { gate } = applyMarketContextGate(precatRaw, getCachedMarketContext(), {
    bypass: loadMarketGateBypass(),
  });
  const gatedKind = effectivePrecatKindForPick(precatRaw.kind, gate);
  const stab = computeSlopeStability(slope5d, slope20d, slope45d);
  const effSlope = slope20d != null && Number.isFinite(slope20d) ? slope20d : slope5d ?? null;
  const verdict = stabilityVerdict(stab, effSlope);

  const targetReturn = targetRoiAtAnchor(series, anchor, daysAt);

  return {
    ...base,
    days: daysAt,
    pred5,
    slope20d,
    precatExpectedReturn: precatRaw.expectedReturnPct ?? null,
    precatKind: gatedKind,
    precatOriginalKind: precatRaw.kind,
    precatLabel: precatRaw.label,
    stabilityVerdict: verdict,
    slopeRotationFlag: stab.rotationFlag,
    planReturnPct: targetReturn,
    planDays: targetReturn != null ? Math.min(daysAt, Math.max(1, daysAt - 1)) : base.planDays,
    chartPoints: chartPts ?? null,
    simRow,
  };
}

export function computeRaCompositeAsOfAnchor(args: {
  simRow: Record<string, unknown>;
  mergedInputs: InvestSimInputs;
  chartPts: ChartPoint[] | null | undefined;
  history?: InvestSimHistoryPoint[] | null;
  anchor: number;
  opts?: StrictTopOppOpts;
  lang?: "it" | "en";
  /** Widen CD horizon filters for RA calibration / temporal ρ. */
  calibrationRelaxed?: boolean;
}): EntrySolidityComposite | null {
  const { simRow, mergedInputs, chartPts, history = null, anchor, opts, lang = "it", calibrationRelaxed } = args;
  const pick = buildPickAsOfCdAnchor(simRow, mergedInputs, chartPts, history, anchor, {
    calibrationRelaxed,
  });
  if (!pick) return null;

  const sol = resolveSimulationEntrySolidity(pick, opts, lang, "rascore");
  if (!simulationSolidityVisible(sol)) return null;
  return sol.composite;
}

export function computeRaScoreAsOfAnchor(args: {
  simRow: Record<string, unknown>;
  mergedInputs: InvestSimInputs;
  chartPts: ChartPoint[] | null | undefined;
  history?: InvestSimHistoryPoint[] | null;
  anchor: number;
  opts?: StrictTopOppOpts;
  lang?: "it" | "en";
}): number | null {
  const composite = computeRaCompositeAsOfAnchor(args);
  if (!composite) return null;
  return round1(composite.total);
}

export function buildRaScoresByAnchor(args: {
  simRow: Record<string, unknown>;
  mergedInputs: InvestSimInputs;
  chartPts: ChartPoint[] | null | undefined;
  history?: InvestSimHistoryPoint[] | null;
  anchors: readonly number[];
  opts?: StrictTopOppOpts;
  lang?: "it" | "en";
}): Partial<Record<number, number>> {
  const out: Partial<Record<number, number>> = {};
  for (const anchor of args.anchors) {
    const score = computeRaScoreAsOfAnchor({ ...args, anchor });
    if (score != null) out[anchor] = score;
  }
  return out;
}
