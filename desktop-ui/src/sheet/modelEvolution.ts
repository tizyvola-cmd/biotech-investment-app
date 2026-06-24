/**
 * modelEvolution — weekly aggregation of monitor metrics.
 *
 * Groups MonitorEntry[] by ISO-week, computes WoW deltas and linear trend
 * to answer the question "is the model improving?".
 */
import type { MonitorEntry } from "./accuracyMetrics";

export type WeeklyEvolutionRow = {
  weekKey: string;            // "2025-W22"
  weekLabel: string;          // "W22·25 (Mon May 26)"
  weekStartApprox: string;    // "May 26"
  nRuns: number;
  // Snapshot of the last run of the week
  accV4Pct: number | null;
  m2Mae7: number | null;
  m2HitD5: number | null;
  m2Bias7: number | null;
  nEval: number | null;
  affMisurata: number | null;
  // Deltas vs previous week
  deltaAcc: number | null;
  deltaMae7: number | null;
  // Week triggers
  triggers: string[];
  hasModelChange: boolean;
  weekTs: number;             // Unix ms of the Monday of the week
};

export type EvolutionTrend = {
  label: "improving" | "stable" | "degrading" | "unknown";
  accSlope: number | null;   // pp/week (OLS over the last 4)
  description: string;
};

export type EvolutionSummary = {
  weeks: WeeklyEvolutionRow[];   // ordered from oldest
  trend: EvolutionTrend;
  currentWeek: WeeklyEvolutionRow | null;
  prevWeek: WeeklyEvolutionRow | null;
  totalRuns: number;
  totalWeeks: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseMonitorIsoWeek(dateStr: string): { key: string; mondayTs: number } | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const dow = d.getDay() || 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - dow + 1);
  monday.setHours(0, 0, 0, 0);
  const thursday = new Date(monday);
  thursday.setDate(monday.getDate() + 3);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  const weekNum = Math.ceil(
    ((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7
  );
  const key = `${thursday.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
  return { key, mondayTs: monday.getTime() };
}

function buildWeekLabel(key: string, mondayTs: number): string {
  const [yearStr, wStr] = key.split("-W");
  const day = new Date(mondayTs).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
  return `W${wStr}·${yearStr.slice(2)} (${day})`;
}

function linearSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((s, v) => s + v, 0) / n;
  const num = ys.reduce((s, y, i) => s + (i - xMean) * (y - yMean), 0);
  const den = ys.reduce((s, _, i) => s + (i - xMean) ** 2, 0);
  return den > 0 ? num / den : 0;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function buildWeeklyEvolution(entries: MonitorEntry[]): EvolutionSummary {
  const valid = entries.filter(
    (e) => !e.invalid && e.accV4Pct != null && e.runIso
  );

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

  const sortedKeys = [...weekMap.keys()].sort();
  const weeks: WeeklyEvolutionRow[] = [];

  for (let i = 0; i < sortedKeys.length; i++) {
    const key = sortedKeys[i];
    const { rows, mondayTs } = weekMap.get(key)!;
    const sortedRuns = [...rows].sort(
      (a, b) => Date.parse(a.runIso) - Date.parse(b.runIso)
    );
    const last = sortedRuns[sortedRuns.length - 1];
    const triggers = [
      ...new Set(
        sortedRuns.map((r) => r.trigger).filter((t): t is string => !!t)
      ),
    ];
    const hasModelChange = triggers.some(
      (t) => t.includes("model") || t.includes("change") || t.includes("calib")
    );
    const prev = i > 0 ? weeks[i - 1] : null;

    weeks.push({
      weekKey: key,
      weekLabel: buildWeekLabel(key, mondayTs),
      weekStartApprox: new Date(mondayTs).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
      }),
      nRuns: sortedRuns.length,
      accV4Pct: last.accV4Pct,
      m2Mae7: last.m2Mae7,
      m2HitD5: last.m2HitD5,
      m2Bias7: last.m2Bias7,
      nEval: last.nEval,
      affMisurata: last.affMisurata,
      deltaAcc:
        prev?.accV4Pct != null && last.accV4Pct != null
          ? last.accV4Pct - prev.accV4Pct
          : null,
      deltaMae7:
        prev?.m2Mae7 != null && last.m2Mae7 != null
          ? last.m2Mae7 - prev.m2Mae7
          : null,
      triggers,
      hasModelChange,
      weekTs: mondayTs,
    });
  }

  const recent = weeks.filter((w) => w.accV4Pct != null).slice(-4);
  let trend: EvolutionTrend;

  if (recent.length >= 3) {
    const slope = linearSlope(recent.map((w) => w.accV4Pct!));
    const n = recent.length;
    let label: EvolutionTrend["label"];
    let description: string;
    if (slope > 0.5) {
      label = "improving";
      description = `Getting better over the last ${n} weeks.`;
    } else if (slope < -0.5) {
      label = "degrading";
      description = `Getting worse over the last ${n} weeks.`;
    } else {
      label = "stable";
      description = `About the same over the last ${n} weeks.`;
    }
    trend = { label, accSlope: slope, description };
  } else {
    trend = {
      label: "unknown",
      accSlope: null,
      description:
        recent.length === 0
          ? "Not enough data yet."
          : "Need a few more weeks of data to see a trend.",
    };
  }

  return {
    weeks,
    trend,
    currentWeek: weeks.length > 0 ? weeks[weeks.length - 1] : null,
    prevWeek: weeks.length > 1 ? weeks[weeks.length - 2] : null,
    totalRuns: valid.length,
    totalWeeks: weeks.length,
  };
}
