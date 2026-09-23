/**
 * Weekly KPI snapshots for continuation-sell prediction quality + stretch.
 */
import { parseMonitorIsoWeek } from "./modelEvolution";

const STORAGE_KEY = "supernova.contSellLearning.weekly.v1";
const MAX_WEEKS = 52;

export type ContSellWeeklySnapshot = {
  weekKey: string;
  weekLabel: string;
  weekTs: number;
  savedAt: string;
  rawHitPct: number | null;
  stretchHitPct: number | null;
  scoredN: number;
  pendingN: number;
  edgeMin: number;
  edgeStretch: number;
};

export type ContSellWeeklyRow = {
  week: string;
  rawHitPct: number | null;
  stretchHitPct: number | null;
  scoredN: number;
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

function ls(): Storage | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* ignore */
  }
  return null;
}

export function loadContSellWeeklySnapshots(): ContSellWeeklySnapshot[] {
  const store = ls();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ContSellWeeklySnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSnapshots(rows: ContSellWeeklySnapshot[]): void {
  const store = ls();
  if (!store) return;
  store.setItem(STORAGE_KEY, JSON.stringify(rows.slice(-MAX_WEEKS)));
}

export function recordContSellWeeklySnapshot(args: {
  rawHitPct: number | null;
  stretchHitPct: number | null;
  scoredN: number;
  pendingN: number;
  edgeMin: number;
  edgeStretch: number;
}): ContSellWeeklySnapshot[] {
  const parsed = parseMonitorIsoWeek(new Date().toISOString());
  if (!parsed) return loadContSellWeeklySnapshots();

  const snap: ContSellWeeklySnapshot = {
    weekKey: parsed.key,
    weekLabel: buildWeekLabel(parsed.key, parsed.mondayTs),
    weekTs: parsed.mondayTs,
    savedAt: new Date().toISOString(),
    rawHitPct: args.rawHitPct,
    stretchHitPct: args.stretchHitPct,
    scoredN: args.scoredN,
    pendingN: args.pendingN,
    edgeMin: args.edgeMin,
    edgeStretch: args.edgeStretch,
  };

  const existing = loadContSellWeeklySnapshots();
  const idx = existing.findIndex((w) => w.weekKey === snap.weekKey);
  const next = idx >= 0 ? [...existing] : [...existing, snap];
  if (idx >= 0) next[idx] = snap;
  next.sort((a, b) => a.weekTs - b.weekTs);
  saveSnapshots(next);
  return next;
}

export function buildContSellWeeklyRows(
  snapshots: ContSellWeeklySnapshot[] = loadContSellWeeklySnapshots(),
): ContSellWeeklyRow[] {
  return [...snapshots]
    .sort((a, b) => a.weekTs - b.weekTs)
    .map((w) => ({
      week: w.weekLabel,
      rawHitPct: w.rawHitPct,
      stretchHitPct: w.stretchHitPct,
      scoredN: w.scoredN,
    }));
}
