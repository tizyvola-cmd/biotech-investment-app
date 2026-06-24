import { parseMonitorIsoWeek } from "./modelEvolution";

const STORAGE_KEY = "supernova_sds_prediction_calibration_weekly_v1";
const MAX_WEEKS = 52;

export type SdsPredictionWeeklySnapshot = {
  weekKey: string;
  weekLabel: string;
  weekTs: number;
  savedAt: string;
  mae: number | null;
  coverage: number | null;
  rho: number | null;
  /** Paired pred+actual count used for ρ. */
  rhoN: number;
  nSignals: number;
};

export type SdsPredictionWeeklyRow = {
  week: string;
  mae: number | null;
  coverage: number | null;
  rho: number | null;
  rhoN: number | null;
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

export function loadSdsPredictionCalibrationSnapshots(): SdsPredictionWeeklySnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SdsPredictionWeeklySnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSnapshots(rows: SdsPredictionWeeklySnapshot[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-MAX_WEEKS)));
}

export function recordSdsPredictionWeeklySnapshot(args: {
  mae: number | null;
  coverage: number | null;
  rho: number | null;
  rhoN: number;
  nSignals: number;
}): SdsPredictionWeeklySnapshot[] {
  const parsed = parseMonitorIsoWeek(new Date().toISOString());
  if (!parsed) return loadSdsPredictionCalibrationSnapshots();

  const snap: SdsPredictionWeeklySnapshot = {
    weekKey: parsed.key,
    weekLabel: buildWeekLabel(parsed.key, parsed.mondayTs),
    weekTs: parsed.mondayTs,
    savedAt: new Date().toISOString(),
    mae: args.mae,
    coverage: args.coverage,
    rho: args.rho,
    rhoN: args.rhoN,
    nSignals: args.nSignals,
  };

  const existing = loadSdsPredictionCalibrationSnapshots();
  const idx = existing.findIndex((w) => w.weekKey === snap.weekKey);
  const next = idx >= 0 ? [...existing] : [...existing, snap];
  if (idx >= 0) next[idx] = snap;
  next.sort((a, b) => a.weekTs - b.weekTs);
  saveSnapshots(next);
  return next;
}

export function buildSdsPredictionWeeklyRows(
  snapshots: SdsPredictionWeeklySnapshot[] = loadSdsPredictionCalibrationSnapshots(),
): SdsPredictionWeeklyRow[] {
  return [...snapshots]
    .sort((a, b) => a.weekTs - b.weekTs)
    .map((w) => ({
      week: w.weekLabel,
      mae: w.mae,
      coverage: w.coverage,
      rho: w.rho,
      rhoN: w.rhoN > 0 ? w.rhoN : null,
    }));
}
