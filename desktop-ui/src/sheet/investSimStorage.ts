export type InvestSimInputEntry = {
  buyPrice: number;
  capital: number;
  /** Ignora valori dal foglio Excel per questa riga (simulazione azzerata dall'utente). */
  ignoreSheet?: boolean;
};

export type InvestSimInputs = Record<string, InvestSimInputEntry>;

export type InvestSimPersistedFile = {
  version: number;
  updated_at: string | null;
  inputs: InvestSimInputs;
};

const INPUTS_KEY = "supernova_invest_sim_inputs";
const INPUTS_META_KEY = "supernova_invest_sim_inputs_updated_at";
const PERSIST_REL = "invest_sim_inputs.json";
const HISTORY_KEY = "supernova_invest_sim_history";
const UI_KEY = "supernova_invest_sim_ui";
const MAX_HISTORY = 240;

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export type InvestSimHistoryPoint = {
  ts: string;
  capital: number;
  value: number;
  pnl: number;
  pnlPct: number;
  byTicker: Record<string, { value: number; pnl: number; pnlPct: number }>;
};

export type InvestSimView = "workspace" | "trendChart" | "snapshotBar";

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
  const updatedAt = new Date().toISOString();
  localStorage.setItem(INPUTS_KEY, JSON.stringify(inputs));
  localStorage.setItem(INPUTS_META_KEY, updatedAt);
}

/** Salva in localStorage e, in background, su ``data/invest_sim_inputs.json`` (API / Electron). */
export function persistInvestSimInputs(inputs: InvestSimInputs): void {
  saveInvestSimInputs(inputs);
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void flushInvestSimInputsToDisk(inputs);
  }, 350);
}

async function flushInvestSimInputsToDisk(inputs: InvestSimInputs): Promise<void> {
  const payload: InvestSimPersistedFile = {
    version: 1,
    updated_at: new Date().toISOString(),
    inputs,
  };
  try {
    const { saveInvestSimInputsPersisted, rebuildInvestmentSimOutcomes } = await import(
      "../api/investSim"
    );
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

/** Unisce localStorage, file ``data/`` e opzionale riconciliazione righe Simulation. */
export async function hydrateInvestSimInputs(
  simRows?: Record<string, unknown>[]
): Promise<InvestSimInputs> {
  const { mergeInvestSimInputs, reconcileInvestSimInputs } = await import("./investSimKeys");
  const { fetchProjectJson } = await import("../data/projectData");

  let merged = loadInvestSimInputs();
  const localTs = localInputsUpdatedAt();

  const { data: diskFile } = await fetchProjectJson<InvestSimPersistedFile>(PERSIST_REL);
  if (diskFile?.inputs && typeof diskFile.inputs === "object") {
    const diskTs = Date.parse(diskFile.updated_at ?? "") || 0;
    if (diskTs > localTs && Object.keys(diskFile.inputs).length > 0) {
      merged = mergeInvestSimInputs(diskFile.inputs, merged);
    } else if (Object.keys(merged).length === 0 && Object.keys(diskFile.inputs).length > 0) {
      merged = { ...diskFile.inputs };
    } else if (Object.keys(diskFile.inputs).length > 0) {
      merged = mergeInvestSimInputs(merged, diskFile.inputs);
    }
  }

  if (simRows?.length) {
    const reconciled = reconcileInvestSimInputs(merged, simRows);
    if (JSON.stringify(reconciled) !== JSON.stringify(merged)) {
      merged = reconciled;
      saveInvestSimInputs(merged);
    }
  }
  return merged;
}

export { PERSIST_REL };

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

export function saveInvestSimHistory(points: InvestSimHistoryPoint[]): void {
  if (typeof window === "undefined") return;
  const trimmed = points.slice(-MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

export function loadInvestSimUi(): InvestSimUiState {
  if (typeof window === "undefined") {
    return { selectedKey: null, view: "workspace", tableSplitPct: DEFAULT_TABLE_SPLIT_PCT };
  }
  try {
    const raw = localStorage.getItem(UI_KEY);
    if (!raw) return { selectedKey: null, view: "workspace", tableSplitPct: DEFAULT_TABLE_SPLIT_PCT };
    const p = JSON.parse(raw) as Partial<InvestSimUiState>;
    return {
      selectedKey: p.selectedKey ?? null,
      view:
        p.view === "trendChart" || p.view === "snapshotBar" ? p.view : "workspace",
      tableSplitPct: clampTableSplitPct(
        typeof p.tableSplitPct === "number" ? p.tableSplitPct : DEFAULT_TABLE_SPLIT_PCT
      ),
    };
  } catch {
    return { selectedKey: null, view: "workspace", tableSplitPct: DEFAULT_TABLE_SPLIT_PCT };
  }
}

export function saveInvestSimUi(ui: InvestSimUiState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(UI_KEY, JSON.stringify(ui));
}

/** Evita punti duplicati se valore invariato nell'ultima ora. */
export function appendHistoryPoint(
  points: InvestSimHistoryPoint[],
  next: Omit<InvestSimHistoryPoint, "ts"> & { ts?: string },
  opts?: { force?: boolean }
): InvestSimHistoryPoint[] {
  const ts = next.ts ?? new Date().toISOString();
  const last = points[points.length - 1];
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
  if (typeof window === "undefined") return;
  localStorage.removeItem(HISTORY_KEY);
}
