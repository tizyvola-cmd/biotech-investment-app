import {
  rebuildInvestmentSimOutcomes,
  saveInvestSimInputsPersisted,
  fetchInvestSimHistoryPersisted,
  saveInvestSimHistoryPersisted,
} from "../api/investSim";

export type InvestSimInputEntry = {
  buyPrice: number;
  capital: number;
  /** Ignora valori dal foglio Excel per questa riga (simulazione azzerata dall'utente). */
  ignoreSheet?: boolean;
  /** ISO timestamp: primo momento in cui capitale + prezzo acquisto sono attivi. */
  investedAt?: string;
  /** User-entered purchase date "YYYY-MM-DD". Overrides investedAt for display. */
  purchaseDate?: string;
  /** ISO timestamp when the position was sold (keeps holding-period display). */
  soldAt?: string;
  /** Capitale al momento della vendita — alimenta closed piggy bank se lo storico manca. */
  closedCapital?: number;
  /** Valore mark-to-market al momento della vendita (€). */
  closedValue?: number;
  /** P&L realizzato al momento della vendita (€) — closed piggy bank. */
  closedPnlEur?: number;
};

export type ClosedSimExitSnapshot = Pick<
  InvestSimInputEntry,
  "closedCapital" | "closedValue" | "closedPnlEur"
>;

/** Closed/sold row: never read capital from Excel again. */
export function closedSimEntry(
  investedAt?: string,
  purchaseDate?: string,
  soldAt?: string,
  exit?: ClosedSimExitSnapshot,
): InvestSimInputEntry {
  return {
    buyPrice: 0,
    capital: 0,
    ignoreSheet: true,
    ...(investedAt ? { investedAt } : {}),
    ...(purchaseDate ? { purchaseDate } : {}),
    ...(soldAt ? { soldAt } : {}),
    ...(exit?.closedCapital != null && Number.isFinite(exit.closedCapital)
      ? { closedCapital: exit.closedCapital }
      : {}),
    ...(exit?.closedValue != null && Number.isFinite(exit.closedValue)
      ? { closedValue: exit.closedValue }
      : {}),
    ...(exit?.closedPnlEur != null && Number.isFinite(exit.closedPnlEur)
      ? { closedPnlEur: exit.closedPnlEur }
      : {}),
  };
}

export function sanitizeInvestSimEntry(e: InvestSimInputEntry): InvestSimInputEntry {
  if (!e.ignoreSheet) return e;
  return closedSimEntry(e.investedAt, e.purchaseDate, e.soldAt, {
    closedCapital: e.closedCapital,
    closedValue: e.closedValue,
    closedPnlEur: e.closedPnlEur,
  });
}

export function sanitizeInvestSimInputs(inputs: InvestSimInputs): InvestSimInputs {
  const out: InvestSimInputs = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (v) out[k] = sanitizeInvestSimEntry(v);
  }
  return out;
}

export type InvestSimInputs = Record<string, InvestSimInputEntry>;

export type InvestSimPersistedFile = {
  version: number;
  updated_at: string | null;
  inputs: InvestSimInputs;
};

const INPUTS_KEY = "supernova_invest_sim_inputs";
const INPUTS_META_KEY = "supernova_invest_sim_inputs_updated_at";
export const INVEST_SIM_INPUTS_CHANGED_EVENT = "supernova:invest-sim-inputs-changed";
const PERSIST_REL = "invest_sim_inputs.json";
const HISTORY_KEY = "supernova_invest_sim_history";
const HISTORY_META_KEY = "supernova_invest_sim_history_updated_at";
export const INVEST_SIM_HISTORY_CHANGED_EVENT = "supernova:invest-sim-history-changed";
const HISTORY_PERSIST_REL = "invest_sim_history.json";
const UI_KEY = "supernova_invest_sim_ui";
const MAX_HISTORY = 240;

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let historyPersistTimer: ReturnType<typeof setTimeout> | null = null;
/** Blocks disk flush with empty history before hydrate merges local + file. */
let historyHydrationDone = false;

export function isInvestSimHistoryHydrated(): boolean {
  return historyHydrationDone;
}

export function markInvestSimHistoryHydrated(): void {
  historyHydrationDone = true;
}

/** In-memory snapshot survives Simulation screen unmount (sell must not revert on tab change). */
let investSimInputsCache: InvestSimInputs | null = null;

export function getInvestSimInputsSnapshot(): InvestSimInputs {
  if (investSimInputsCache) return investSimInputsCache;
  investSimInputsCache = sanitizeInvestSimInputs(loadInvestSimInputs());
  return investSimInputsCache;
}

function setInvestSimInputsCache(inputs: InvestSimInputs): InvestSimInputs {
  const clean = sanitizeInvestSimInputs(inputs);
  investSimInputsCache = clean;
  return clean;
}

export type InvestSimHistoryPersistedFile = {
  version: number;
  updated_at: string | null;
  points: InvestSimHistoryPoint[];
};

export type InvestSimHistoryPoint = {
  ts: string;
  capital: number;
  value: number;
  pnl: number;
  pnlPct: number;
  /** Cumulative closed realized € at this tick — used for chart open-MTM ramp. */
  closedPnlEur?: number;
  byTicker: Record<string, { value: number; pnl: number; pnlPct: number }>;
};

export type InvestSimView = "workspace" | "trendChart" | "snapshotBar" | "lossAnalysis";

/** Navigazione verso Simulation da Dashboard / Decision Lab. */
export type SimulationNavFocus = {
  ticker?: string;
  action?: "buy" | "sell";
  cd?: string;
  /** Chiave riga Simulation (TICKER|CD) — scroll preciso in 24h assessment. */
  rowKey?: string;
  /** Tab Simulation da aprire (es. snapshotBar = P&L). */
  view?: InvestSimView;
  /** Apri il drawer Daily P&L ledger al arrive. */
  openDailyLedger?: boolean;
  /** Allinea capitale al target synth al arrive (trim esposizione). */
  syncToSynth?: boolean;
};

export type InvestSimUiState = {
  selectedKey: string | null;
  view: InvestSimView;
  /** Altezza % pannello superiore (foglio prediction) nel layout Simulation. */
  tableSplitPct?: number;
};

export const DEFAULT_TABLE_SPLIT_PCT = 50;
export const MIN_TABLE_SPLIT_PCT = 15;
export const MAX_TABLE_SPLIT_PCT = 85;

export function clampTableSplitPct(pct: number): number {
  if (!Number.isFinite(pct)) return DEFAULT_TABLE_SPLIT_PCT;
  return Math.min(MAX_TABLE_SPLIT_PCT, Math.max(MIN_TABLE_SPLIT_PCT, pct));
}

export function loadInvestSimInputs(): InvestSimInputs {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(INPUTS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as InvestSimInputs;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

export function saveInvestSimInputs(inputs: InvestSimInputs): void {
  if (typeof window === "undefined") return;
  const clean = sanitizeInvestSimInputs(inputs);
  setInvestSimInputsCache(clean);
  const updatedAt = new Date().toISOString();
  localStorage.setItem(INPUTS_KEY, JSON.stringify(clean));
  localStorage.setItem(INPUTS_META_KEY, updatedAt);
  try {
    window.dispatchEvent(
      new CustomEvent(INVEST_SIM_INPUTS_CHANGED_EVENT, {
        detail: { updatedAt },
      }),
    );
  } catch {
    /* ignore */
  }
}

/** Salva in localStorage e, in background, su ``data/invest_sim_inputs.json`` (API / Electron). */
export function persistInvestSimInputs(inputs: InvestSimInputs): void {
  const clean = sanitizeInvestSimInputs(inputs);
  saveInvestSimInputs(clean);
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void flushInvestSimInputsToDisk(clean);
  }, 350);
}

/** After Sell/Clear: save immediately so portfolio filter updates and disk stays in sync. */
export function persistInvestSimInputsNow(inputs: InvestSimInputs): void {
  const clean = sanitizeInvestSimInputs(inputs);
  saveInvestSimInputs(clean);
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  void flushInvestSimInputsToDisk(clean);
}

async function flushInvestSimInputsToDisk(inputs: InvestSimInputs): Promise<void> {
  const payload: InvestSimPersistedFile = {
    version: 1,
    updated_at: new Date().toISOString(),
    inputs,
  };
  try {
    await saveInvestSimInputsPersisted(inputs);
    try {
      await rebuildInvestmentSimOutcomes();
    } catch {
      /* outcomes opzionali se API non disponibile */
    }
    return;
  } catch {
    /* API assente o token mancante */
  }
  if (typeof window !== "undefined" && window.supernova?.writeProjectDataFile) {
    try {
      await window.supernova.writeProjectDataFile(PERSIST_REL, payload);
    } catch {
      /* ignore */
    }
  }
}

function localInputsUpdatedAt(): number {
  if (typeof window === "undefined") return 0;
  const raw = localStorage.getItem(INPUTS_META_KEY);
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

/** ISO timestamp of last portfolio input save in this browser tab. */
export function investSimInputsUpdatedAtIso(): string | null {
  const ms = localInputsUpdatedAt();
  return ms ? new Date(ms).toISOString() : null;
}

/** First portfolio snapshot that includes this row key. */
export function inferInvestedAtFromHistory(
  key: string,
  history: InvestSimHistoryPoint[]
): string | null {
  for (const h of history) {
    if (h.byTicker[key] != null) return h.ts;
  }
  return null;
}

/**
 * Prefer the earliest trustworthy timestamp: portfolio history beats a late
 * backfill stamp (buy-price backfill used to set investedAt = now).
 */
function purchaseDateToIso(date: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function resolveInvestedAt(
  key: string,
  entry: InvestSimInputEntry | undefined,
  history: InvestSimHistoryPoint[]
): string | null {
  if (entry?.purchaseDate) {
    const iso = purchaseDateToIso(entry.purchaseDate);
    if (iso) return iso;
  }
  const fromHistory = inferInvestedAtFromHistory(key, history);
  const stored = entry?.investedAt?.trim();
  if (!stored) return fromHistory;
  if (!fromHistory) return stored;
  const storedMs = Date.parse(stored);
  const histMs = Date.parse(fromHistory);
  if (Number.isFinite(storedMs) && Number.isFinite(histMs) && histMs < storedMs) {
    return fromHistory;
  }
  return stored;
}

/** @deprecated Use resolveInvestedAt */
export const inferInvestedAt = resolveInvestedAt;

/** Calendar-day holding period (local timezone). Optional end date (e.g. sell). */
export function holdingDaysFromInvestedAt(
  iso?: string | null,
  endIso?: string | null
): number | null {
  if (!iso) return null;
  const frac = holdingDayFractionFromInvestedAt(iso, endIso);
  if (frac == null) return null;
  return Math.max(0, Math.round(frac));
}

/** Giorni frazionari da entry (include ore) — per curve gain vs plan aggiornate ogni refresh. */
export function holdingDayFractionFromInvestedAt(
  iso?: string | null,
  endIso?: string | null,
): number | null {
  if (!iso) return null;
  const startMs = Date.parse(iso);
  if (!Number.isFinite(startMs)) return null;
  const endMs = endIso ? Date.parse(endIso) : Date.now();
  if (!Number.isFinite(endMs)) return null;
  return Math.max(0, (endMs - startMs) / 86_400_000);
}

/** Unisce localStorage, file ``data/`` e opzionale riconciliazione righe Simulation. */
export async function hydrateInvestSimInputs(
  simRows?: Record<string, unknown>[]
): Promise<InvestSimInputs> {
  const { mergeInvestSimInputs, reconcileInvestSimInputs } = await import("./investSimKeys");
  const { fetchProjectJson } = await import("../data/projectData");

  const localAtStart = loadInvestSimInputs();
  const localWasEmpty = Object.keys(localAtStart).length === 0;
  let merged = { ...localAtStart };
  const localTs = localInputsUpdatedAt();

  const { data: diskFile } = await fetchProjectJson<InvestSimPersistedFile>(PERSIST_REL);
  const diskInputs =
    diskFile?.inputs && typeof diskFile.inputs === "object" ? diskFile.inputs : null;
  const diskKeys = diskInputs ? Object.keys(diskInputs) : [];

  if (diskInputs && diskKeys.length > 0) {
    const diskTs = Date.parse(diskFile!.updated_at ?? "") || 0;
    if (diskTs > localTs && diskKeys.length > 0) {
      // Disk is newer globally, but merge per-key so a same-tab Sell (ignoreSheet)
      // in localStorage is not resurrected by stale open positions on disk.
      merged = mergeInvestSimInputs(diskInputs, loadInvestSimInputs());
    } else if (Object.keys(merged).length === 0) {
      merged = { ...diskInputs };
    } else {
      // localStorage is newer or same age: merge disk as secondary (fills in
      // missing keys only — do NOT override explicit local values).
      merged = mergeInvestSimInputs(merged, diskInputs);
    }
  }

  // Align / backfill investedAt from portfolio history only (never file updated_at).
  const history = loadInvestSimHistory();
  let backfilled = false;
  for (const [k, v] of Object.entries(merged)) {
    if (v.capital <= 0) continue;
    const resolved = resolveInvestedAt(k, v, history);
    if (resolved && resolved !== v.investedAt) {
      merged[k] = { ...v, investedAt: resolved };
      backfilled = true;
      continue;
    }
    if (!v.investedAt) {
      const fromHist = inferInvestedAtFromHistory(k, history);
      if (fromHist) {
        merged[k] = { ...v, investedAt: fromHist };
        backfilled = true;
      }
    }
  }
  if (backfilled) saveInvestSimInputs(merged);

  // Vendite precedenti senza closedPnlEur: ricostruisci da storico snapshot.
  let soldBackfilled = false;
  const { tickerDailyCloseSeries } = await import("./simulationPosition");
  for (const [k, v] of Object.entries(merged)) {
    if (!v.ignoreSheet || !v.soldAt || v.closedPnlEur != null) continue;
    const investedAt = resolveInvestedAt(k, v, history);
    const entryCap =
      v.closedCapital != null && v.closedCapital > 0
        ? v.closedCapital
        : (() => {
            for (const h of history) {
              const snap = h.byTicker?.[k];
              if (!snap) continue;
              const entry = Math.round((snap.value - snap.pnl) * 100) / 100;
              if (entry > 0) return entry;
            }
            return null;
          })();
    if (entryCap == null || entryCap <= 0) continue;
    const series = tickerDailyCloseSeries(history, k, investedAt);
    if (!series.length) continue;
    const last = series[series.length - 1]!;
    const pnl = Math.round((last.value - entryCap) * 100) / 100;
    merged[k] = {
      ...v,
      closedCapital: entryCap,
      closedValue: last.value,
      closedPnlEur: pnl,
    };
    soldBackfilled = true;
  }
  if (soldBackfilled) saveInvestSimInputs(merged);

  if (simRows?.length) {
    const reconciled = reconcileInvestSimInputs(merged, simRows);
    if (JSON.stringify(reconciled) !== JSON.stringify(merged)) {
      merged = reconciled;
      saveInvestSimInputs(merged);
    }
  }
  const out = sanitizeInvestSimInputs(merged);
  setInvestSimInputsCache(out);
  // Persist restored disk snapshot so a browser refresh does not lose portfolio again.
  if (localWasEmpty && Object.keys(out).length > 0) {
    saveInvestSimInputs(out);
  }
  return out;
}

export { PERSIST_REL };

function historyCalendarDayKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Unisce due snapshot dello stesso giorno — byTicker union (timestamp più recente vince per ticker). */
export function mergeInvestSimHistoryPointPair(
  a: InvestSimHistoryPoint,
  b: InvestSimHistoryPoint,
): InvestSimHistoryPoint {
  const newer = Date.parse(a.ts) >= Date.parse(b.ts) ? a : b;
  const older = newer === a ? b : a;
  const byTicker = { ...(older.byTicker ?? {}), ...(newer.byTicker ?? {}) };
  return { ...newer, byTicker };
}

/** Unisce snapshot per giorno di calendario (tiene il più recente per giorno + union byTicker). */
export function mergeInvestSimHistoryPoints(
  ...arrays: InvestSimHistoryPoint[][]
): InvestSimHistoryPoint[] {
  const byDay = new Map<string, InvestSimHistoryPoint>();
  for (const arr of arrays) {
    for (const h of arr) {
      if (!h || typeof h !== "object" || !h.ts) continue;
      const dayKey = historyCalendarDayKey(h.ts);
      const prev = byDay.get(dayKey);
      if (!prev) {
        byDay.set(dayKey, h);
      } else {
        byDay.set(dayKey, mergeInvestSimHistoryPointPair(prev, h));
      }
    }
  }
  return [...byDay.values()]
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
    .slice(-MAX_HISTORY);
}

export function loadInvestSimHistory(): InvestSimHistoryPoint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as InvestSimHistoryPoint[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeInvestSimHistoryLocal(points: InvestSimHistoryPoint[]): InvestSimHistoryPoint[] {
  const trimmed = points.slice(-MAX_HISTORY);
  if (typeof window === "undefined") return trimmed;
  const updatedAt = new Date().toISOString();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  localStorage.setItem(HISTORY_META_KEY, updatedAt);
  try {
    window.dispatchEvent(
      new CustomEvent(INVEST_SIM_HISTORY_CHANGED_EVENT, {
        detail: { updatedAt },
      }),
    );
  } catch {
    /* ignore */
  }
  return trimmed;
}

export function saveInvestSimHistory(points: InvestSimHistoryPoint[]): void {
  writeInvestSimHistoryLocal(points);
  scheduleInvestSimHistoryPersist(points);
}

/** Salva subito su disco (API / Electron) — dopo refresh o clear. */
export function persistInvestSimHistoryNow(points: InvestSimHistoryPoint[]): void {
  const trimmed = writeInvestSimHistoryLocal(points);
  if (typeof window === "undefined") return;
  if (historyPersistTimer) clearTimeout(historyPersistTimer);
  void flushInvestSimHistoryToDisk(trimmed);
}

function scheduleInvestSimHistoryPersist(points: InvestSimHistoryPoint[]): void {
  if (typeof window === "undefined") return;
  if (!historyHydrationDone && points.length === 0) return;
  if (historyPersistTimer) clearTimeout(historyPersistTimer);
  const snapshot = points.slice(-MAX_HISTORY);
  historyPersistTimer = setTimeout(() => {
    void flushInvestSimHistoryToDisk(snapshot);
  }, 350);
}

async function flushInvestSimHistoryToDisk(points: InvestSimHistoryPoint[]): Promise<void> {
  const trimmed = points.slice(-MAX_HISTORY);
  if (trimmed.length === 0) {
    try {
      const existing = await fetchInvestSimHistoryPersisted();
      if (existing?.points?.length) return;
    } catch {
      /* API assente — continua solo se clear esplicito */
    }
  }
  const payload: InvestSimHistoryPersistedFile = {
    version: 1,
    updated_at: new Date().toISOString(),
    points: trimmed,
  };
  try {
    await saveInvestSimHistoryPersisted(payload.points);
    return;
  } catch {
    /* API assente o token mancante */
  }
  if (typeof window !== "undefined" && window.supernova?.writeProjectDataFile) {
    try {
      await window.supernova.writeProjectDataFile(HISTORY_PERSIST_REL, payload);
    } catch {
      /* ignore */
    }
  }
}

/** Ripristina storico P&L da ``data/invest_sim_history.json`` (merge per giorno). */
export async function hydrateInvestSimHistory(): Promise<InvestSimHistoryPoint[]> {
  try {
    const { fetchProjectJson } = await import("../data/projectData");

    const local = loadInvestSimHistory();
    let diskPoints: InvestSimHistoryPoint[] = [];

    const fromApi = await fetchInvestSimHistoryPersisted();
    if (fromApi?.points && Array.isArray(fromApi.points)) {
      diskPoints = fromApi.points;
    } else {
      const { data: diskFile } = await fetchProjectJson<InvestSimHistoryPersistedFile>(
        HISTORY_PERSIST_REL,
      );
      if (diskFile?.points && Array.isArray(diskFile.points)) {
        diskPoints = diskFile.points;
      }
    }

    if (diskPoints.length === 0 && local.length === 0) return [];

    const merged = mergeInvestSimHistoryPoints(local, diskPoints);
    const changed =
      merged.length !== local.length ||
      JSON.stringify(merged) !== JSON.stringify(local);

    if (changed) {
      writeInvestSimHistoryLocal(merged);
    }

    const diskMerged = mergeInvestSimHistoryPoints(diskPoints);
    if (
      merged.length > diskMerged.length ||
      JSON.stringify(merged) !== JSON.stringify(diskMerged)
    ) {
      void flushInvestSimHistoryToDisk(merged);
    }

    return merged;
  } finally {
    markInvestSimHistoryHydrated();
  }
}

export function loadInvestSimUi(): InvestSimUiState {
  if (typeof window === "undefined") {
    return { selectedKey: null, view: "lossAnalysis", tableSplitPct: DEFAULT_TABLE_SPLIT_PCT };
  }
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return { selectedKey: null, view: "lossAnalysis", tableSplitPct: DEFAULT_TABLE_SPLIT_PCT };
    const p = JSON.parse(raw) as Partial<InvestSimUiState>;
    return {
      selectedKey: p.selectedKey ?? null,
      // Returns & Loss opens on 24h assessment; Decision Lab embed overrides to workspace; focusTicker sets other tabs.
      view: "lossAnalysis",
      tableSplitPct: clampTableSplitPct(
        typeof p.tableSplitPct === "number" ? p.tableSplitPct : DEFAULT_TABLE_SPLIT_PCT
      ),
    };
  } catch {
    return { selectedKey: null, view: "lossAnalysis", tableSplitPct: DEFAULT_TABLE_SPLIT_PCT };
  }
}

export function saveInvestSimUi(ui: InvestSimUiState): void {
  if (typeof window === "undefined") return;
  const { view: _view, ...persisted } = ui;
  localStorage.setItem(UI_KEY, JSON.stringify(persisted));
}

function historyCalendarDayKeyFromIso(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function historyHourKeyFromIso(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${historyCalendarDayKeyFromIso(iso)}T${String(d.getHours()).padStart(2, "0")}`;
}

/** Evita punti duplicati se valore invariato nell'ultima ora. Con ``force``, sostituisce l'ultimo punto dello stesso giorno di calendario. ``hourly`` = un punto per ora (gain vs plan). */
export function appendHistoryPoint(
  points: InvestSimHistoryPoint[],
  next: Omit<InvestSimHistoryPoint, "ts"> & { ts?: string },
  opts?: { force?: boolean | "hourly" },
): InvestSimHistoryPoint[] {
  const ts = next.ts ?? new Date().toISOString();
  const last = points[points.length - 1];

  if (opts?.force === "hourly" && last) {
    if (historyHourKeyFromIso(last.ts) === historyHourKeyFromIso(ts)) {
      return [...points.slice(0, -1), { ...next, ts }];
    }
    return [...points, { ...next, ts }].slice(-MAX_HISTORY);
  }

  if (opts?.force === true && last && historyCalendarDayKeyFromIso(last.ts) === historyCalendarDayKeyFromIso(ts)) {
    return [...points.slice(0, -1), mergeInvestSimHistoryPointPair(last, { ...next, ts })];
  }

  if (
    !opts?.force &&
    last &&
    Math.abs(last.value - next.value) < 0.01 &&
    Math.abs(last.capital - next.capital) < 0.01
  ) {
    const lastMs = Date.parse(last.ts);
    if (Number.isFinite(lastMs) && Date.now() - lastMs < 60 * 60 * 1000) {
      return points;
    }
  }
  return [...points, { ...next, ts }].slice(-MAX_HISTORY);
}

export function clearInvestSimHistory(): void {
  persistInvestSimHistoryNow([]);
}
