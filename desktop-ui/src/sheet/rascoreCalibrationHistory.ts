import { parseMonitorIsoWeek } from "./modelEvolution";
import type {
  RascoreCalibrationQuality,
  RascoreSignalImpactView,
  RascoreThresholdHints,
} from "./rascoreSignalImpactView";

const STORAGE_KEY = "supernova_rascore_calibration_weekly_v1";
const MAX_WEEKS = 52;

export type RascoreWeeklySnapshot = {
  weekKey: string;
  weekLabel: string;
  weekTs: number;
  savedAt: string;
  spearmanGrow7d: number | null;
  tier: RascoreCalibrationQuality["tier"];
  nBinsUsed: number;
  nSignals: number;
  nWith7d: number;
  investMinScore: number | null;
  peakGrow7dPct: number | null;
  deltaRho: number | null;
};

export type RascoreEvolutionTrend = {
  label: "improving" | "stable" | "degrading" | "unknown";
  rhoSlope: number | null;
  descriptionIt: string;
  descriptionEn: string;
};

export type RascoreEvolutionSummary = {
  weeks: RascoreWeeklySnapshot[];
  trend: RascoreEvolutionTrend;
  currentWeek: RascoreWeeklySnapshot | null;
  prevWeek: RascoreWeeklySnapshot | null;
  totalWeeks: number;
};

export type RascoreCalibrationChartRow = {
  weekKey: string;
  label: string;
  rho: number | null;
  rhoN: number | null;
  peakGrow7d: number | null;
  investMin: number | null;
  nSignals: number;
};

function buildWeekLabel(key: string, mondayTs: number): string {
  const [, wStr] = key.split("-W");
  const yearStr = key.split("-W")[0] ?? "";
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

export function loadRascoreCalibrationSnapshots(): RascoreWeeklySnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RascoreWeeklySnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRascoreCalibrationSnapshots(rows: RascoreWeeklySnapshot[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-MAX_WEEKS)));
}

export function snapshotFromView(view: RascoreSignalImpactView): Omit<RascoreWeeklySnapshot, "deltaRho"> | null {
  const parsed = parseMonitorIsoWeek(new Date().toISOString());
  if (!parsed) return null;
  const th: RascoreThresholdHints = view.thresholds;
  const cq = view.calibrationQuality;
  return {
    weekKey: parsed.key,
    weekLabel: buildWeekLabel(parsed.key, parsed.mondayTs),
    weekTs: parsed.mondayTs,
    savedAt: new Date().toISOString(),
    spearmanGrow7d: cq.spearmanGrow7d,
    tier: cq.tier,
    nBinsUsed: cq.nBinsUsed,
    nSignals: view.nTotal,
    nWith7d: view.nWith7d,
    investMinScore: th.investMinScore,
    peakGrow7dPct: th.peakGrow7dPct,
  };
}

/** Registra/aggiorna snapshot settimanale (ultimo della settimana ISO corrente). */
export function recordRascoreWeeklySnapshot(view: RascoreSignalImpactView): RascoreWeeklySnapshot[] {
  const snap = snapshotFromView(view);
  if (!snap || !view.hasData) return loadRascoreCalibrationSnapshots();

  const existing = loadRascoreCalibrationSnapshots();
  const idx = existing.findIndex((w) => w.weekKey === snap.weekKey);
  const row: RascoreWeeklySnapshot = { ...snap, deltaRho: null };

  let next: RascoreWeeklySnapshot[];
  if (idx >= 0) {
    next = [...existing];
    next[idx] = row;
  } else {
    next = [...existing, row];
  }

  next.sort((a, b) => a.weekTs - b.weekTs);
  for (let i = 0; i < next.length; i += 1) {
    const prev = i > 0 ? next[i - 1] : null;
    const cur = next[i]!;
    next[i] = {
      ...cur,
      deltaRho:
        prev?.spearmanGrow7d != null && cur.spearmanGrow7d != null
          ? Math.round((cur.spearmanGrow7d - prev.spearmanGrow7d) * 1000) / 1000
          : null,
    };
  }

  saveRascoreCalibrationSnapshots(next);
  return next;
}

export function buildRascoreEvolutionSummary(
  snapshots: RascoreWeeklySnapshot[] = loadRascoreCalibrationSnapshots(),
): RascoreEvolutionSummary {
  const weeks = [...snapshots].sort((a, b) => a.weekTs - b.weekTs);
  const withRho = weeks.filter((w) => w.spearmanGrow7d != null);
  const recent = withRho.slice(-4);

  let trend: RascoreEvolutionTrend;
  if (recent.length >= 3) {
    const slope = linearSlope(recent.map((w) => w.spearmanGrow7d!));
    const n = recent.length;
    if (slope > 0.04) {
      trend = {
        label: "improving",
        rhoSlope: Math.round(slope * 1000) / 1000,
        descriptionIt: `Monotonicità ρ in crescita sulle ultime ${n} settimane — RA score più allineato al prezzo su a 7g.`,
        descriptionEn: `ρ monotonicity rising over the last ${n} weeks — RA score better aligned with 7d price-up.`,
      };
    } else if (slope < -0.04) {
      trend = {
        label: "degrading",
        rhoSlope: Math.round(slope * 1000) / 1000,
        descriptionIt: `ρ in calo sulle ultime ${n} settimane — rivedi pesi RA o componenti.`,
        descriptionEn: `ρ falling over the last ${n} weeks — review RA weights or components.`,
      };
    } else {
      trend = {
        label: "stable",
        rhoSlope: Math.round(slope * 1000) / 1000,
        descriptionIt: `ρ stabile sulle ultime ${n} settimane — calibrazione RA invariata.`,
        descriptionEn: `ρ stable over the last ${n} weeks — RA calibration unchanged.`,
      };
    }
  } else {
    trend = {
      label: "unknown",
      rhoSlope: null,
      descriptionIt:
        weeks.length === 0
          ? "Nessuno snapshot ancora — si accumula aprendo questo pannello ogni settimana."
          : "Servono almeno 3 settimane con ρ per stimare il trend.",
      descriptionEn:
        weeks.length === 0
          ? "No snapshots yet — they accumulate each week you open this panel."
          : "Need at least 3 weeks with ρ to estimate a trend.",
    };
  }

  return {
    weeks,
    trend,
    currentWeek: weeks.length > 0 ? weeks[weeks.length - 1]! : null,
    prevWeek: weeks.length > 1 ? weeks[weeks.length - 2]! : null,
    totalWeeks: weeks.length,
  };
}

export function buildRascoreCalibrationChartRows(
  summary: RascoreEvolutionSummary,
): RascoreCalibrationChartRow[] {
  return summary.weeks.map((w) => ({
    weekKey: w.weekKey,
    label: w.weekLabel,
    rho: w.spearmanGrow7d,
    rhoN: w.nBinsUsed > 0 ? w.nBinsUsed : null,
    peakGrow7d: w.peakGrow7dPct,
    investMin: w.investMinScore,
    nSignals: w.nSignals,
  }));
}

export function clearRascoreCalibrationHistory(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
