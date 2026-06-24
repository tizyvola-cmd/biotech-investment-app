/**
 * Weekly improvement KPIs shared by Home dashboard and Model Quality.
 */
import { parseMonitorEntries } from "./accuracyMetrics";
import { buildWeeklyEvolution } from "./modelEvolution";
import { buildModelSizeErrorView, type ModelSizeErrorView } from "./modelSizeErrorView";
import type { SdsPredictionWeeklySnapshot } from "./sdsPredictionCalibrationHistory";

export type ModelQualityWeeklyTrends = {
  accV4Pct: number | null;
  deltaPpLastMonitor: number | null;
  accSlopePpPerWeek: number | null;
  accTrendLabel: "improving" | "stable" | "degrading" | "unknown";
  modelSizeError: ModelSizeErrorView;
  sdsRhoDelta: number | null;
  sdsRhoTrendLabel: "improving" | "stable" | "degrading" | "unknown";
  monitorWeekCount: number;
};

function parseNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function rhoTrendFromSnapshots(
  snapshots: SdsPredictionWeeklySnapshot[],
): { delta: number | null; label: ModelQualityWeeklyTrends["sdsRhoTrendLabel"] } {
  const withRho = snapshots.filter((s) => s.rho != null && Number.isFinite(s.rho));
  if (withRho.length < 2) return { delta: null, label: "unknown" };
  const first = withRho[0]!.rho!;
  const last = withRho[withRho.length - 1]!.rho!;
  const delta = Math.round((last - first) * 1000) / 1000;
  let label: ModelQualityWeeklyTrends["sdsRhoTrendLabel"] = "stable";
  if (delta > 0.02) label = "improving";
  else if (delta < -0.02) label = "degrading";
  return { delta, label };
}

export function buildModelQualityWeeklyTrends(
  monitorDoc: { entries?: unknown[] } | null | undefined,
  sdsSnapshots: SdsPredictionWeeklySnapshot[] = [],
): ModelQualityWeeklyTrends | null {
  const entries = parseMonitorEntries(monitorDoc ?? { entries: [] });
  const valid = entries.filter((e) => !e.invalid);
  if (!valid.length && !sdsSnapshots.length) return null;

  const evolution = buildWeeklyEvolution(entries);
  const modelSizeError = buildModelSizeErrorView(entries);

  const rawSorted = [...(monitorDoc?.entries ?? [])]
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .sort((a, b) => Date.parse(String(b.run_iso ?? "")) - Date.parse(String(a.run_iso ?? "")));
  const rawLast = rawSorted[0];
  const lastValid = [...valid].sort((a, b) => Date.parse(b.runIso) - Date.parse(a.runIso))[0];

  const sdsTrend = rhoTrendFromSnapshots(sdsSnapshots);

  return {
    accV4Pct: lastValid?.accV4Pct ?? null,
    deltaPpLastMonitor: rawLast ? parseNum(rawLast.delta_pp_vs_prev) : evolution.currentWeek?.deltaAcc ?? null,
    accSlopePpPerWeek: evolution.trend.accSlope,
    accTrendLabel: evolution.trend.label,
    modelSizeError,
    sdsRhoDelta: sdsTrend.delta,
    sdsRhoTrendLabel: sdsTrend.label,
    monitorWeekCount: evolution.totalWeeks,
  };
}

export function fmtPpDelta(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)} pp`;
}

export function trendLabelIt(
  label: "improving" | "stable" | "degrading" | "unknown",
): string {
  switch (label) {
    case "improving":
      return "in miglioramento";
    case "degrading":
      return "in calo";
    case "stable":
      return "stabile";
    default:
      return "—";
  }
}

export function trendLabelEn(
  label: "improving" | "stable" | "degrading" | "unknown",
): string {
  switch (label) {
    case "improving":
      return "improving";
    case "degrading":
      return "degrading";
    case "stable":
      return "stable";
    default:
      return "—";
  }
}
