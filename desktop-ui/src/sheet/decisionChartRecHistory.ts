import type { DecisionChartTickerRow, DecisionRec } from "./decisionChartLogic";

export type StoredRecSnapshot = { at: string; rec: DecisionRec };

export type RecTransitionDisplay = {
  at: string;
  atLabel: string;
  from: DecisionRec;
  to: DecisionRec;
  letter: "B" | "S" | "H" | "R";
  /** 0–100 position on the timeline strip (time-ordered). */
  posPct: number;
};

const STORAGE_KEY = "supernova_decision_rec_history.v1";
const MAX_SNAPSHOTS_PER_KEY = 48;
const TIMELINE_MS = 21 * 86_400_000;

type RecHistoryStore = Record<string, StoredRecSnapshot[]>;

function recToLetter(rec: DecisionRec): RecTransitionDisplay["letter"] {
  switch (rec) {
    case "buy":
      return "B";
    case "sell":
      return "S";
    case "hold":
      return "H";
    default:
      return "R";
  }
}

// Every mounted price chart reads this store on each rec refresh; re-parsing the
// whole snapshot history per chart is pure garbage, so keep the last parse.
let parsedRaw: string | null = null;
let parsedStore: RecHistoryStore = {};

function loadStore(): RecHistoryStore {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    if (raw === parsedRaw) return parsedStore;
    const p = JSON.parse(raw) as RecHistoryStore;
    parsedStore = p && typeof p === "object" ? p : {};
    parsedRaw = raw;
    return parsedStore;
  } catch {
    return {};
  }
}

function saveStore(store: RecHistoryStore): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = JSON.stringify(store);
    localStorage.setItem(STORAGE_KEY, raw);
    parsedRaw = raw;
    parsedStore = store;
  } catch {
    /* quota */
  }
}

function fmtDayLabel(iso: string, it: boolean): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(it ? "it-IT" : "en-GB", { day: "2-digit", month: "2-digit" });
}

/** Append snapshots when recommendation changes (Evaluation Lab refresh). */
export function recordDecisionRecSnapshots(rows: DecisionChartTickerRow[]): void {
  if (typeof localStorage === "undefined" || !rows.length) return;
  const store = loadStore();
  const now = new Date().toISOString();
  let changed = false;

  for (const row of rows) {
    const hist = store[row.key] ?? [];
    const last = hist[hist.length - 1];
    if (last?.rec === row.rec && last.at.slice(0, 10) === now.slice(0, 10)) continue;
    const next = [...hist, { at: now, rec: row.rec }];
    store[row.key] = next.slice(-MAX_SNAPSHOTS_PER_KEY);
    changed = true;
  }

  if (changed) saveStore(store);
}

/** Zone crossings to Buy/Sell (and from Review) for the detail timeline. */
export function getDecisionRecTransitions(
  key: string,
  it: boolean,
  nowMs: number = Date.now(),
): RecTransitionDisplay[] {
  const hist = (loadStore()[key] ?? []).filter((s) => Number.isFinite(Date.parse(s.at)));
  if (hist.length < 2) return [];

  const windowStart = nowMs - TIMELINE_MS;
  const inWindow = hist.filter((s) => Date.parse(s.at) >= windowStart);
  const series = inWindow.length >= 2 ? inWindow : hist.slice(-Math.min(hist.length, 12));

  const transitions: Omit<RecTransitionDisplay, "posPct">[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1]!;
    const cur = series[i]!;
    if (cur.rec === prev.rec) continue;
    if (cur.rec !== "buy" && cur.rec !== "sell") continue;
    if (prev.rec === "review" || prev.rec === "hold" || prev.rec !== cur.rec) {
      transitions.push({
        at: cur.at,
        atLabel: fmtDayLabel(cur.at, it),
        from: prev.rec,
        to: cur.rec,
        letter: recToLetter(cur.rec),
      });
    }
  }

  if (!transitions.length) return [];

  const t0 = Date.parse(series[0]!.at);
  const t1 = Date.parse(series[series.length - 1]!.at);
  const span = Math.max(t1 - t0, 86_400_000);

  return transitions.map((t) => ({
    ...t,
    posPct: Math.max(4, Math.min(96, ((Date.parse(t.at) - t0) / span) * 100)),
  }));
}

export type RecEpisodeFromHistory = {
  rec: "buy" | "sell";
  startIso: string;
  /** Null = still the current rec. */
  endIso: string | null;
};

/**
 * Every BUY/SELL window ever recorded for this row key — the price chart keeps
 * closed windows painted so the user sees the recommendation track, not only
 * the live one.
 */
export function recEpisodesFromHistory(key: string): RecEpisodeFromHistory[] {
  const k = key.trim();
  if (!k) return [];
  const hist = (loadStore()[k] ?? [])
    .filter((s) => Number.isFinite(Date.parse(s.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!hist.length) return [];

  const out: RecEpisodeFromHistory[] = [];
  let i = 0;
  while (i < hist.length) {
    const rec = hist[i]!.rec;
    let last = i;
    while (last + 1 < hist.length && hist[last + 1]!.rec === rec) last += 1;
    if (rec === "buy" || rec === "sell") {
      out.push({
        rec,
        startIso: hist[i]!.at,
        endIso: last + 1 < hist.length ? hist[last + 1]!.at : null,
      });
    }
    i = last + 1;
  }
  return out;
}

/** ISO start of the current contiguous BUY streak for this Decision Chart row key. */
export function latestBuyStreakStartIso(key: string): string | null {
  const k = key.trim();
  if (!k) return null;
  const hist = loadStore()[k] ?? [];
  if (!hist.length) return null;
  let i = hist.length - 1;
  if (hist[i]!.rec !== "buy") return null;
  while (i > 0 && hist[i - 1]!.rec === "buy") i -= 1;
  return hist[i]!.at;
}

/** Test helper */
export function __clearDecisionRecHistoryForTests(): void {
  parsedRaw = null;
  parsedStore = {};
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}
