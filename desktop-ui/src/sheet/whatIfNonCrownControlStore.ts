/**
 * Non-crown control populations for Grade 3 (offline export + live session).
 */
import type { WhatIfCurveStats } from "./simUniverse24hWhatIf";
import {
  crownHitDedupeKey,
  type WhatIfCrownHitEvent,
} from "./whatIfCrownHitStore";
import {
  buildWhatIfCrownReadoutFromSimRow,
  type WhatIfCrownReadoutContext,
} from "./whatIfCrownReadout";
import { fetchProjectJson, invalidateProjectJsonCache } from "../data/projectData";
import { isWhatIfStrongNow } from "./simUniverse24hWhatIf";

export const WHATIF_NONCROWN_STORAGE_KEY = "supernova.whatIf.nonCrownControl.v1";
export const WHATIF_NONCROWN_EXPORT_REL = "whatif_noncrown_export.json";

export type NonCrownPopulation = "strong_offbook" | "pf_nonstrong";

export type NonCrownControlEvent = WhatIfCrownHitEvent & {
  population: NonCrownPopulation;
  outcomeType?: "simPnl" | "fwdReturnPct";
  fwdReturnPct?: number | null;
};

export type NonCrownControlStore = {
  schemaVersion: number;
  events: NonCrownControlEvent[];
};

export type Grade3RowKind = "crown" | NonCrownPopulation;

export type Grade3AnalysisRow = {
  kind: Grade3RowKind;
  sessionDate: string;
  ticker: string;
  simKey: string | null;
  endPnl: number;
  pathMax: number;
  pathMin: number;
  oscillating: boolean;
  readout?: WhatIfCrownHitEvent["readout"];
  /** live | import | export */
  sourceLayer: "live" | "import" | "export";
};

function dedupeKey(sessionDate: string, ticker: string): string {
  return crownHitDedupeKey(sessionDate, ticker);
}

export function loadNonCrownControlFromLocalStorage(): NonCrownControlEvent[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(WHATIF_NONCROWN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as NonCrownControlStore;
    if (!parsed?.events?.length) return [];
    return parsed.events.filter(
      (e) =>
        e.population === "strong_offbook" ||
        e.population === "pf_nonstrong",
    );
  } catch {
    return [];
  }
}

export function saveNonCrownControlToLocalStorage(events: NonCrownControlEvent[]): void {
  if (typeof localStorage === "undefined") return;
  const store: NonCrownControlStore = { schemaVersion: 1, events };
  localStorage.setItem(WHATIF_NONCROWN_STORAGE_KEY, JSON.stringify(store));
}

function filterNonCrownEvents(events: unknown): NonCrownControlEvent[] {
  if (!Array.isArray(events)) return [];
  return (events as NonCrownControlEvent[]).filter(
    (e) =>
      e.population === "strong_offbook" ||
      e.population === "pf_nonstrong",
  );
}

export async function fetchNonCrownControlExport(): Promise<NonCrownControlEvent[]> {
  try {
    invalidateProjectJsonCache(WHATIF_NONCROWN_EXPORT_REL);
    const { data } = await fetchProjectJson<NonCrownControlStore>(WHATIF_NONCROWN_EXPORT_REL);
    return filterNonCrownEvents(data?.events);
  } catch {
    return [];
  }
}

export function importNonCrownControlFromJson(text: string): NonCrownControlEvent[] {
  const doc = JSON.parse(text) as NonCrownControlStore;
  const events = filterNonCrownEvents(doc?.events);
  saveNonCrownControlToLocalStorage(events);
  return events;
}

export function buildLiveNonCrownControlEvents(opts: {
  sessionDate: string;
  tickersWithData: string[];
  curveStats: Map<string, WhatIfCurveStats>;
  tickerMeta: Map<
    string,
    {
      inPortfolio?: boolean;
      dailyPct24h?: number | null;
      key?: string | null;
    }
  >;
  simRowByKey: Map<string, Record<string, unknown>>;
  readoutCtx: WhatIfCrownReadoutContext;
  excludeCrownKeys: Set<string>;
  frozenAt: string;
}): NonCrownControlEvent[] {
  const {
    sessionDate,
    tickersWithData,
    curveStats,
    tickerMeta,
    simRowByKey,
    readoutCtx,
    excludeCrownKeys,
    frozenAt,
  } = opts;
  const out: NonCrownControlEvent[] = [];

  for (const ticker of tickersWithData) {
    const st = curveStats.get(ticker);
    if (!st) continue;
    const meta = tickerMeta.get(ticker);
    const inPf = Boolean(meta?.inPortfolio);
    const dailyPct = meta?.dailyPct24h ?? null;
    const strongNow = isWhatIfStrongNow(st.strong, dailyPct);

    let population: NonCrownPopulation | null = null;
    if (strongNow && !inPf) population = "strong_offbook";
    else if (inPf && !strongNow) population = "pf_nonstrong";
    else continue;

    const key = dedupeKey(sessionDate, ticker);
    if (excludeCrownKeys.has(key)) continue;

    const simKey = meta?.key?.trim() || null;
    const row = simKey ? simRowByKey.get(simKey) : null;
    const readout = buildWhatIfCrownReadoutFromSimRow(row, {
      source: "capture",
      frozenAt,
      hasPosition: inPf,
      ticker,
      simKey,
      ctx: readoutCtx,
    });

    out.push({
      sessionDate,
      ticker,
      simKey,
      population,
      outcomeType: "simPnl",
      endPnl: st.endPnl,
      pathMax: st.pathMax,
      pathMin: st.pathMin,
      oscillating: st.oscillating,
      capturedAt: frozenAt,
      updatedAt: frozenAt,
      readout,
    });
  }
  return out;
}

export function mergeGrade3AnalysisRows(opts: {
  crownEvents: readonly WhatIfCrownHitEvent[];
  importedNonCrown: readonly NonCrownControlEvent[];
  exportedNonCrown: readonly NonCrownControlEvent[];
  liveNonCrown: readonly NonCrownControlEvent[];
}): Grade3AnalysisRow[] {
  const crownKeys = new Set<string>();
  const rows: Grade3AnalysisRow[] = [];

  for (const ev of opts.crownEvents) {
    const key = dedupeKey(ev.sessionDate, ev.ticker);
    crownKeys.add(key);
    rows.push({
      kind: "crown",
      sessionDate: ev.sessionDate,
      ticker: ev.ticker,
      simKey: ev.simKey,
      endPnl: ev.endPnl,
      pathMax: ev.pathMax,
      pathMin: ev.pathMin,
      oscillating: ev.oscillating,
      readout: ev.readout,
      sourceLayer: "live",
    });
  }

  const addNonCrown = (
    events: readonly NonCrownControlEvent[],
    layer: Grade3AnalysisRow["sourceLayer"],
  ) => {
    for (const ev of events) {
      const key = dedupeKey(ev.sessionDate, ev.ticker);
      if (crownKeys.has(key)) continue;
      if (rows.some((r) => r.kind !== "crown" && dedupeKey(r.sessionDate, r.ticker) === key)) {
        continue;
      }
      rows.push({
        kind: ev.population,
        sessionDate: ev.sessionDate,
        ticker: ev.ticker,
        simKey: ev.simKey,
        endPnl: ev.endPnl,
        pathMax: ev.pathMax,
        pathMin: ev.pathMin,
        oscillating: ev.oscillating,
        readout: ev.readout,
        sourceLayer: layer,
      });
    }
  };

  addNonCrown(opts.exportedNonCrown, "export");
  addNonCrown(opts.importedNonCrown, "import");
  addNonCrown(opts.liveNonCrown, "live");

  return rows.sort((a, b) => {
    const d = b.sessionDate.localeCompare(a.sessionDate);
    if (d !== 0) return d;
    const k = a.kind.localeCompare(b.kind);
    if (k !== 0) return k;
    return a.ticker.localeCompare(b.ticker);
  });
}

export function populationLabel(kind: Grade3RowKind, it: boolean): string {
  if (kind === "crown") return it ? "Corona" : "Crown";
  if (kind === "strong_offbook") return it ? "Strong off-PF" : "Strong off-PF";
  return it ? "PF non-Strong" : "PF non-Strong";
}

export function rowSurfaceClass(kind: Grade3RowKind): string {
  if (kind === "crown") {
    return "bg-amber-50/95 dark:bg-amber-950/35 border-l-[3px] border-l-amber-400";
  }
  return "bg-sky-50/95 dark:bg-sky-950/30 border-l-[3px] border-l-sky-400";
}
