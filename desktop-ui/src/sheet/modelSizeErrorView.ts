import type { MonitorEntry } from "./accuracyMetrics";
import { parseMonitorIsoWeek } from "./modelEvolution";

export type ModelSizeErrorWeekPoint = {
  weekKey: string;
  label: string;
  maePp: number;
  nEval: number | null;
};

export type ModelSizeErrorTrend = "improving" | "worse" | "stable" | "unknown";

export type ModelSizeErrorView = {
  currentMaePp: number | null;
  deltaVsPrevWeek: number | null;
  trend: ModelSizeErrorTrend;
  weekPoints: ModelSizeErrorWeekPoint[];
  hasChart: boolean;
  horizonLabel: string;
};

function linearSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((s, v) => s + v, 0) / n;
  const num = ys.reduce((s, y, i) => s + (i - xMean) * (y - yMean), 0);
  const den = ys.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
  return den > 0 ? num / den : 0;
}

function shortWeekLabel(key: string, mondayTs: number): string {
  const wStr = key.split("-W")[1] ?? key;
  const day = new Date(mondayTs).toLocaleDateString("en-US", { day: "numeric", month: "short" });
  return `W${wStr} (${day})`;
}

export function buildModelSizeErrorView(entries: MonitorEntry[]): ModelSizeErrorView {
  const valid = entries.filter((e) => !e.invalid && e.runIso && e.m2Mae7 != null);

  const weekMap = new Map<string, { rows: MonitorEntry[]; mondayTs: number }>();
  for (const e of valid) {
    const parsed = parseMonitorIsoWeek(e.runIso);
    if (!parsed) continue;
    const existing = weekMap.get(parsed.key);
    if (existing) {
      existing.rows.push(e);
    } else {
      weekMap.set(parsed.key, { rows: [e], mondayTs: parsed.mondayTs });
    }
  }

  const weekPoints: ModelSizeErrorWeekPoint[] = [];
  for (const key of [...weekMap.keys()].sort()) {
    const { rows, mondayTs } = weekMap.get(key)!;
    const last = [...rows].sort((a, b) => Date.parse(a.runIso) - Date.parse(b.runIso)).at(-1);
    if (!last || last.m2Mae7 == null) continue;
    weekPoints.push({
      weekKey: key,
      label: shortWeekLabel(key, mondayTs),
      maePp: last.m2Mae7,
      nEval: last.nEval,
    });
  }

  const current = weekPoints.at(-1);
  const prev = weekPoints.length >= 2 ? weekPoints.at(-2) : null;
  const deltaVsPrevWeek =
    current && prev ? Math.round((current.maePp - prev.maePp) * 10) / 10 : null;

  const recent = weekPoints.slice(-4).map((p) => p.maePp);
  let trend: ModelSizeErrorTrend = "unknown";
  if (recent.length >= 3) {
    const slope = linearSlope(recent);
    if (slope < -0.3) trend = "improving";
    else if (slope > 0.3) trend = "worse";
    else trend = "stable";
  }

  return {
    currentMaePp: current?.maePp ?? null,
    deltaVsPrevWeek,
    trend,
    weekPoints,
    hasChart: weekPoints.length >= 2,
    horizonLabel: "T+7",
  };
}

export function sizeErrorTone(maePp: number | null | undefined): string {
  if (maePp == null || !Number.isFinite(maePp)) return "text-ink";
  if (maePp <= 8) return "text-positive";
  if (maePp <= 12) return "text-warn";
  return "text-negative";
}

export function sizeErrorTrendTone(trend: ModelSizeErrorTrend): string {
  if (trend === "improving") return "text-positive";
  if (trend === "worse") return "text-negative";
  if (trend === "stable") return "text-warn";
  return "text-ink-muted";
}
