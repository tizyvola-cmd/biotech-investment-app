import type { ExperimentId } from "./experimentCash";

export type PiggyReallocationEntry = {
  at: string;
  experiment: ExperimentId;
  amountEur: number;
  note: string;
};

const LOG_KEY = "supernova_piggy_reallocation_log";
const MAX_ENTRIES = 100;

function loadRaw(): PiggyReallocationEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as PiggyReallocationEntry[]) : [];
  } catch {
    return [];
  }
}

function saveRaw(entries: PiggyReallocationEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* non-fatal */
  }
}

export function loadPiggyReallocationLog(): PiggyReallocationEntry[] {
  return loadRaw();
}

export function appendPiggyReallocation(
  entry: Omit<PiggyReallocationEntry, "at">,
): void {
  const log = loadRaw();
  log.push({ ...entry, at: new Date().toISOString() });
  saveRaw(log);
}

export function sumReallocatedFor(experiment: ExperimentId): number {
  return loadRaw()
    .filter((e) => e.experiment === experiment)
    .reduce((acc, e) => acc + e.amountEur, 0);
}
