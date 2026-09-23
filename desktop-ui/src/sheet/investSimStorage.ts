import {
  scheduleRebuildInvestmentSimOutcomes,
  saveInvestSimInputsPersisted,
  fetchInvestSimHistoryPersisted,
  saveInvestSimHistoryPersisted,
  invalidateInvestSimHistoryCache,
} from "../api/investSim";
import {
  clearDashboardVisitBaselineSession,
  clearDashboardVisitSnapshot,
} from "./dashboardVisitSnapshot";

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
  /** P(plan) / composite score catturato al momento del buy (rescue / loss audit). */
  entryProbPct?: number | null;
  /** Origine posizione — distingue portfolio reale vs sim loop vs synth nei chiusi. */
  universe?: "real" | "simloop" | "synth";
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
/** Which email-book the browser INPUTS_KEY belongs to (`shared` or tester id). */
const INPUTS_OWNER_KEY = "supernova_invest_sim_inputs_owner";
export const INVEST_SIM_INPUTS_CHANGED_EVENT = "supernova:invest-sim-inputs-changed";
const PERSIST_REL = "invest_sim_inputs.json";
const HISTORY_KEY = "supernova_invest_sim_history";
const HISTORY_META_KEY = "supernova_invest_sim_history_updated_at";
export const INVEST_SIM_HISTORY_CHANGED_EVENT = "supernova:invest-sim-history-changed";
const HISTORY_PERSIST_REL = "invest_sim_history.json";
const UI_KEY = "supernova_invest_sim_ui";
const MAX_HISTORY = 240;

async function resolveInvestBookOwnerId(): Promise<string> {
  const { getActiveInvestTesterId } = await import("./testerSession");
  return getActiveInvestTesterId()?.trim() || "shared";
}

function readInvestBookOwner(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(INPUTS_OWNER_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function writeInvestBookOwner(owner: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(INPUTS_OWNER_KEY, owner);
  } catch {
    /* ignore */
  }
}

/** Treat gamil/gmail typo ids as the same book owner (avoids wipe on email fix). */
function canonicalInvestOwnerId(owner: string | null | undefined): string {
  const o = (owner ?? "").trim();
  if (!o || o === "shared") return o;
  return o.replace(/_at_gamil\.com$/i, "_at_gmail.com");
}

function isSameInvestBookOwner(
  owner: string | null | undefined,
  testerId: string | null | undefined,
): boolean {
  const a = canonicalInvestOwnerId(owner);
  const b = canonicalInvestOwnerId(testerId);
  if (!a || !b) return false;
  return a === b;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let historyPersistTimer: ReturnType<typeof setTimeout> | null = null;
/** Coalesce concurrent hydrates (App + MainDashboard both call on mount). */
let hydrateInvestSimInputsInFlight: Promise<InvestSimInputs> | null = null;
/** Bumped on account switch so stale hydrates cannot rewrite the new email's book. */
let investBookEpoch = 0;
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

/** Force reload from localStorage (cross-tab storage events, sell confirm). */
export function reloadInvestSimInputsSnapshotFromStorage(): InvestSimInputs {
  investSimInputsCache = sanitizeInvestSimInputs(loadInvestSimInputs());
  return investSimInputsCache;
}

/** Test / debug: drop in-memory cache so the next read hits localStorage. */
export function resetInvestSimInputsSnapshotCache(): void {
  investSimInputsCache = null;
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
  /** Bump on every deep-link click so the same ticker re-scrolls Top KPI. */
  focusNonce?: number;
  /** Prefer Top KPI sub-tab (vs Decision Chart) when opening lossAnalysis. */
  preferTopKpi?: boolean;
  /** Home Suggested BUY/SELL → open the company deep-dive tab. */
  openDeepDive?: boolean;
  /** Open EIS sub-tab inside Evaluation deep-dive (not a sidebar screen). */
  openEis?: boolean;
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

/**
 * True when incoming book drops open capital sharply by vanishing positions
 * without an explicit Sell (ignoreSheet+soldAt). This is what wiped the
 * restored BNTX/CERS/… book after force-restore (stale React state re-persisted).
 */
function isBogusOpenBookCollapse(
  incoming: InvestSimInputs,
  existing: InvestSimInputs,
): boolean {
  let incomingOpen = 0;
  let existingOpen = 0;
  let incomingN = 0;
  let existingN = 0;
  for (const e of Object.values(incoming)) {
    if (e && !e.ignoreSheet && (e.capital ?? 0) > 0) {
      incomingOpen += e.capital ?? 0;
      incomingN += 1;
    }
  }
  for (const e of Object.values(existing)) {
    if (e && !e.ignoreSheet && (e.capital ?? 0) > 0) {
      existingOpen += e.capital ?? 0;
      existingN += 1;
    }
  }
  // Capital collapse OR losing 3+ open names without Sell → bogus.
  const capitalCollapsed = existingOpen >= 8_000 && incomingOpen < existingOpen * 0.7;
  const countCollapsed = existingN >= 5 && incomingN <= existingN - 3;
  if (!capitalCollapsed && !countCollapsed) return false;
  for (const [k, e] of Object.entries(existing)) {
    if (!e || e.ignoreSheet || !(e.capital > 0)) continue;
    const n = incoming[k];
    const stillOpen = Boolean(n && !n.ignoreSheet && (n.capital ?? 0) > 0);
    if (stillOpen) continue;
    if (!(n?.ignoreSheet && n.soldAt)) return true;
  }
  return false;
}

export function saveInvestSimInputs(
  inputs: InvestSimInputs,
  opts?: { allowBogusCollapse?: boolean },
): void {
  if (typeof window === "undefined") return;
  const clean = sanitizeInvestSimInputs(inputs);
  if (!opts?.allowBogusCollapse) {
    const existing = loadInvestSimInputs();
    if (isBogusOpenBookCollapse(clean, existing)) {
      console.warn(
        "[investSim] refuse to overwrite localStorage with collapsed open book (missing sells)",
      );
      return;
    }
  }
  setInvestSimInputsCache(clean);
  const updatedAt = new Date().toISOString();
  localStorage.setItem(INPUTS_KEY, JSON.stringify(clean));
  localStorage.setItem(INPUTS_META_KEY, updatedAt);
  void resolveInvestBookOwnerId().then((owner) => writeInvestBookOwner(owner));
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
  const before = loadInvestSimInputs();
  if (isBogusOpenBookCollapse(clean, before)) {
    console.warn("[investSim] refuse persistInvestSimInputs collapsed book");
    return;
  }
  saveInvestSimInputs(clean);
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void flushInvestSimInputsToDisk(clean);
  }, 350);
}

/** After Sell/Clear: save immediately so portfolio filter updates and disk stays in sync. */
export async function persistInvestSimInputsNow(inputs: InvestSimInputs): Promise<boolean> {
  const clean = sanitizeInvestSimInputs(inputs);
  const before = loadInvestSimInputs();
  // Real sells mark ignoreSheet+soldAt — not a bogus collapse.
  if (isBogusOpenBookCollapse(clean, before)) {
    console.warn("[investSim] refuse persistInvestSimInputsNow collapsed book");
    return false;
  }
  saveInvestSimInputs(clean);
  if (typeof window === "undefined") return true;
  if (persistTimer) clearTimeout(persistTimer);
  return flushInvestSimInputsToDisk(clean);
}

async function flushInvestSimInputsToDisk(inputs: InvestSimInputs): Promise<boolean> {
  const { getActiveInvestTesterId, usesSharedOperatorInvestBook } = await import(
    "./testerSession"
  );
  const testerId = getActiveInvestTesterId();
  writeInvestBookOwner(testerId?.trim() || "shared");

  // Never overwrite a healthy server book with a collapsed browser book.
  // Skip this guard for email tester books — they may legitimately be empty.
  if (!testerId) {
    try {
      const { fetchInvestSimInputsPersisted } = await import("../api/investSim");
      const { sumOpenCapital } = await import("./investSimKeys");
      const server = await fetchInvestSimInputsPersisted();
      if (server?.inputs) {
        const localOpen = sumOpenCapital(inputs);
        const serverOpen = sumOpenCapital(server.inputs);
        if (serverOpen >= 8_000 && localOpen < serverOpen * 0.7) {
          console.warn(
            `[investSim] refuse to persist collapsed book (local open $${Math.round(localOpen)} vs server $${Math.round(serverOpen)})`,
          );
          return false;
        }
      }
    } catch {
      /* proceed if check unavailable */
    }
  }

  const payload: InvestSimPersistedFile = {
    version: 1,
    updated_at: new Date().toISOString(),
    inputs,
  };
  try {
    await saveInvestSimInputsPersisted(inputs);
    try {
      scheduleRebuildInvestmentSimOutcomes();
    } catch {
      /* outcomes opzionali se API non disponibile */
    }
    // Mobile companion: bump snapshot book even if Home is not mounted.
    void import("../api/mobileDashboardSnapshot")
      .then((m) => m.bumpMobileDashboardSnapshotBook(inputs))
      .catch(() => {
        /* best-effort */
      });
    return true;
  } catch (err) {
    console.warn(
      "[investSim] flush to API failed",
      testerId ? `(tester ${testerId})` : "(shared)",
      err,
    );
  }
  // Shared project-data file is lab/operator only — never dump a tester book there.
  if (
    usesSharedOperatorInvestBook() &&
    typeof window !== "undefined" &&
    window.supernova?.writeProjectDataFile
  ) {
    try {
      await window.supernova.writeProjectDataFile(PERSIST_REL, payload);
      return true;
    } catch {
      /* ignore */
    }
  }
  return false;
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
 * Prefer an explicit entry stamp (Register Buy / purchaseDate). Do **not** rewind
 * to the earliest history hit — that broke Soft Soft giveback after rebuy
 * (stale prior-hold peak → Suggested SELL at €0 MTM on a fresh open).
 * History is only a fallback when the entry has no investedAt / purchaseDate.
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
  const stored = entry?.investedAt?.trim();
  if (stored) return stored;
  return inferInvestedAtFromHistory(key, history);
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
  if (hydrateInvestSimInputsInFlight) {
    const base = await hydrateInvestSimInputsInFlight;
    if (!simRows?.length) return base;
    const { reconcileInvestSimInputs } = await import("./investSimKeys");
    const reconciled = reconcileInvestSimInputs(base, simRows);
    const out = sanitizeInvestSimInputs(reconciled);
    setInvestSimInputsCache(out);
    return out;
  }
  const run = hydrateInvestSimInputsUncoalesced(simRows).finally(() => {
    hydrateInvestSimInputsInFlight = null;
  });
  hydrateInvestSimInputsInFlight = run;
  return run;
}

/**
 * Wipe browser portfolio state that is NOT scoped by email.
 * Call on every account switch / signup so accounts never share open/closed books,
 * P&L history, CLOSED tube, or visit-Δ banners.
 */
export function clearLocalInvestBookForAccountSwitch(): void {
  investBookEpoch += 1;
  hydrateInvestSimInputsInFlight = null;
  investSimInputsCache = null;
  historyHydrationDone = false;
  invalidateInvestSimHistoryCache();
  try {
    localStorage.removeItem(INPUTS_KEY);
    localStorage.removeItem(INPUTS_META_KEY);
    localStorage.removeItem(INPUTS_OWNER_KEY);
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(HISTORY_META_KEY);
    localStorage.removeItem("supernova_closed_piggy_bank_baseline");
    localStorage.removeItem("dashboard.piggy.lastPnlEur");
    localStorage.removeItem("dashboard.piggy.lastTrend");
    localStorage.removeItem("supernova_prior_day_book_activity_dismiss_v1");
    localStorage.removeItem("invest_decision_sim_v1");
    sessionStorage.removeItem("supernova_force_restore_open_book_v1");
  } catch {
    /* ignore */
  }
  clearDashboardVisitSnapshot();
  clearDashboardVisitBaselineSession();
  try {
    window.dispatchEvent(
      new CustomEvent(INVEST_SIM_INPUTS_CHANGED_EVENT, {
        detail: { updatedAt: new Date().toISOString() },
      }),
    );
    window.dispatchEvent(
      new CustomEvent(INVEST_SIM_HISTORY_CHANGED_EVENT, {
        detail: { updatedAt: new Date().toISOString() },
      }),
    );
    window.dispatchEvent(new CustomEvent("supernova:closed-piggy-bank-changed"));
    window.dispatchEvent(new CustomEvent("invest-decision-sim-changed"));
  } catch {
    /* ignore */
  }
}

/**
 * After desktop email signup / switch — load THAT account's book into the browser.
 * Fetch first; only then replace local state (never leave the UI empty if the server has data).
 */
export async function adoptRemoteTesterInvestBook(
  simRows?: Record<string, unknown>[],
): Promise<InvestSimInputs> {
  const { getActiveInvestTesterId, getStoredTester, ownsSharedInvestBook } = await import(
    "./testerSession"
  );
  try {
    const { loadCapitalPrefsForTester } = await import("./uiPrefs");
    const stored = getStoredTester();
    loadCapitalPrefsForTester(
      ownsSharedInvestBook(stored?.email) ? stored?.testerId : getActiveInvestTesterId(),
    );
  } catch {
    /* optional */
  }

  // Bump epoch so in-flight hydrates from the previous email cannot rewrite this book.
  investBookEpoch += 1;
  hydrateInvestSimInputsInFlight = null;
  const epoch = investBookEpoch;

  const tid = getActiveInvestTesterId()?.trim() || "";
  const ownerBefore = readInvestBookOwner();
  const { sumOpenCapital } = await import("./investSimKeys");
  // Snapshot this email's browser book before hydrate/clear.
  // Never publish the shared Pulse (`owner=shared`) into a tester file.
  const canReuseLocal =
    Boolean(tid) &&
    ownerBefore !== "shared" &&
    (isSameInvestBookOwner(ownerBefore, tid) || ownerBefore == null);
  const sameOwnerLocal = canReuseLocal
    ? sanitizeInvestSimInputs(loadInvestSimInputs())
    : sanitizeInvestSimInputs({});
  const sameOwnerLocalOpen = sumOpenCapital(sameOwnerLocal);
  // Real account switch only — typo gamil↔gmail must NOT wipe the book.
  if (
    tid &&
    ownerBefore &&
    ownerBefore !== "shared" &&
    !isSameInvestBookOwner(ownerBefore, tid)
  ) {
    clearLocalInvestBookForAccountSwitch();
  } else if (tid && isSameInvestBookOwner(ownerBefore, tid) && ownerBefore !== tid) {
    // Remap owner tag after email typo normalize (gamil → gmail).
    writeInvestBookOwner(tid);
  }

  const inputs = await hydrateInvestSimInputs(simRows);
  if (epoch !== investBookEpoch) return sanitizeInvestSimInputs(loadInvestSimInputs());

  const serverOpen = sumOpenCapital(inputs);

  if (tid && serverOpen < 500 && sameOwnerLocalOpen >= 500) {
    saveInvestSimInputs(sameOwnerLocal, { allowBogusCollapse: true });
    void flushInvestSimInputsToDisk(sameOwnerLocal);
    return sameOwnerLocal;
  }

  // Empty VPS + empty local: clear ghosts. Never clear when hydrate returned capital.
  if (serverOpen < 500 && sameOwnerLocalOpen < 500) {
    clearLocalInvestBookForAccountSwitch();
  }
  saveInvestSimInputs(inputs, { allowBogusCollapse: true });
  if (tid && serverOpen >= 500) {
    void flushInvestSimInputsToDisk(inputs);
  }

  try {
    if (sumOpenCapital(inputs) >= 1_000 && loadInvestSimHistory().length === 0) {
      const { api } = await import("../api/supernova");
      const shared = await api<{ points?: InvestSimHistoryPoint[] }>(
        "/api/investment/sim-history",
      );
      if (Array.isArray(shared?.points) && shared.points.length > 0) {
        writeInvestSimHistoryLocal(shared.points);
        markInvestSimHistoryHydrated();
      }
    }
  } catch {
    /* history optional */
  }
  return inputs;
}

async function hydrateInvestSimInputsUncoalesced(
  simRows?: Record<string, unknown>[]
): Promise<InvestSimInputs> {
  const epoch = investBookEpoch;
  const stillCurrent = () => epoch === investBookEpoch;

  const {
    mergeInvestSimInputs,
    reconcileInvestSimInputs,
    restoreOpenCapitalFromDisk,
    collapseGhostOpensAfterCompanySell,
  } = await import("./investSimKeys");
  const { fetchProjectJson } = await import("../data/projectData");

  // Remote email accounts: only their per-tester book (starts empty). Never merge
  // the operator Pulse / richest shared book into a new user.
  const { getActiveInvestTesterId, usesSharedOperatorInvestBook } = await import(
    "./testerSession"
  );
  if (getActiveInvestTesterId()) {
    // Load ONLY this email's server book. Never import operator Pulse.
    // If VPS is empty but this browser already has opens for the session, keep
    // local and publish it — otherwise mobile companion stays empty forever.
    const { fetchInvestSimInputsPersisted } = await import("../api/investSim");
    const { sumOpenCapital } = await import("./investSimKeys");
    const apiFile = await fetchInvestSimInputsPersisted();
    if (!stillCurrent()) return sanitizeInvestSimInputs(loadInvestSimInputs());
    let inputs = sanitizeInvestSimInputs(
      apiFile?.inputs && typeof apiFile.inputs === "object" ? apiFile.inputs : {},
    );
    const local = sanitizeInvestSimInputs(loadInvestSimInputs());
    const serverOpen = sumOpenCapital(inputs);
    const localOpen = sumOpenCapital(local);
    const owner = readInvestBookOwner();
    const tid = getActiveInvestTesterId()?.trim() || "";
    const localIsThisEmail =
      tid &&
      owner !== "shared" &&
      (isSameInvestBookOwner(owner, tid) || owner == null);
    // Prefer richer local book — never let an empty/thin VPS file wipe Andrea's opens.
    if (localIsThisEmail && localOpen > serverOpen && localOpen >= 1) {
      inputs = local;
      if (stillCurrent()) {
        saveInvestSimInputs(inputs, { allowBogusCollapse: true });
        if (localOpen >= 500) void flushInvestSimInputsToDisk(inputs);
      }
      return inputs;
    }
    if (simRows?.length) {
      inputs = sanitizeInvestSimInputs(
        reconcileInvestSimInputs(inputs, simRows),
      );
    }
    // Do not overwrite a richer local book with empty server inputs.
    if (stillCurrent()) {
      if (serverOpen > 0 || localOpen < 1) {
        saveInvestSimInputs(inputs, { allowBogusCollapse: true });
      }
    }
    return inputs;
  }

  // Signed-out / gate screen: keep an empty local book — never pull shared Pulse.
  if (!usesSharedOperatorInvestBook()) {
    const empty = sanitizeInvestSimInputs({});
    if (stillCurrent()) saveInvestSimInputs(empty, { allowBogusCollapse: true });
    return empty;
  }

  const localAtStart = loadInvestSimInputs();
  const localWasEmpty = Object.keys(localAtStart).length === 0;
  let collapseDiskForReassert: InvestSimInputs | null = null;

  // Prefer live API book, then /project-data/ file (API is source of truth on VPS).
  // Also prefer the richest open book (localhost often ahead of a stale VPS).
  const richest = await fetchRichestInvestSimBook();
  const { fetchInvestSimInputsPersisted } = await import("../api/investSim");
  const apiFile = await fetchInvestSimInputsPersisted();
  const { data: projectFile } = await fetchProjectJson<InvestSimPersistedFile>(PERSIST_REL);
  const apiTs = Date.parse(apiFile?.updated_at ?? "") || 0;
  const projectTs = Date.parse(projectFile?.updated_at ?? "") || 0;
  let diskFile: InvestSimPersistedFile | null =
    apiFile?.inputs && Object.keys(apiFile.inputs).length > 0
      ? apiTs >= projectTs || !projectFile?.inputs
        ? apiFile
        : projectFile
      : projectFile;
  let diskSource =
    diskFile === apiFile ? "api" : diskFile === projectFile ? "project-data" : "none";
  // If richest open capital beats the timestamp-picked file, use richest (book-collapse).
  if (richest && diskFile?.inputs) {
    const { sumOpenCapital } = await import("./investSimKeys");
    const pickedOpen = sumOpenCapital(diskFile.inputs);
    if (richest.openCapital > pickedOpen * 1.15) {
      diskFile = {
        version: 1,
        updated_at: new Date().toISOString(),
        inputs: richest.inputs,
      };
      diskSource = `richest:${richest.source}`;
    }
  } else if (richest && !diskFile?.inputs) {
    diskFile = {
      version: 1,
      updated_at: new Date().toISOString(),
      inputs: richest.inputs,
    };
    diskSource = `richest:${richest.source}`;
  }
  const diskInputs =
    diskFile?.inputs && typeof diskFile.inputs === "object" ? diskFile.inputs : null;
  const diskKeys = diskInputs ? Object.keys(diskInputs) : [];

  // Re-read local AFTER awaits — concurrent hydrates may have written a fuller
  // book while we waited. Merging from a stale pre-await snapshot was wiping
  // restored BNTX/CERS/… back to the collapsed ~$8k browser book.
  let merged = { ...loadInvestSimInputs() };
  const localTs = localInputsUpdatedAt();

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

    // Soft restore + automatic book-collapse recovery (disk open ≫ local open).
    // Prefer the larger of (post-merge, live LS) so a parallel restore wins.
    const { sumOpenCapital } = await import("./investSimKeys");
    const liveNow = loadInvestSimInputs();
    if (sumOpenCapital(liveNow) > sumOpenCapital(merged)) {
      merged = mergeInvestSimInputs(merged, liveNow);
    }
    // Richest local book can outrank the API file and drop company sells
    // (CMPX/GPCR sold on another CD). Re-merge API so collapse can see them.
    if (apiFile?.inputs && typeof apiFile.inputs === "object") {
      merged = mergeInvestSimInputs(merged, apiFile.inputs);
    }
    const recovered = restoreOpenCapitalFromDisk(merged, diskInputs);
    merged = collapseGhostOpensAfterCompanySell(recovered.inputs);
    const ghostCollapsed = sumOpenCapital(merged) < sumOpenCapital(liveNow);
    if (recovered.restoredKeys.length > 0 || ghostCollapsed) {
      if (recovered.restoredKeys.length > 0) {
        console.info(
          `[investSim] restored ${recovered.restoredKeys.length} open position(s) from ${diskSource}` +
            (recovered.bookCollapsed ? " (book-collapse force)" : "") +
            ":",
          recovered.restoredKeys.join(", "),
        );
      }
      // Ghost collapse marks soldAt — allowBogusCollapse so the guard cannot
      // refuse to drop CMPX/GPCR/MLTX that the VPS already sold.
      saveInvestSimInputs(merged, { allowBogusCollapse: true });
      if (ghostCollapsed) void flushInvestSimInputsToDisk(merged);
    }
    if (recovered.bookCollapsed) collapseDiskForReassert = diskInputs;
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
  if (!stillCurrent()) return sanitizeInvestSimInputs(loadInvestSimInputs());
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
    const {
      purgeSoldAliasesForOpenTickers,
      reassertOpenBookFromDisk,
      sumOpenCapital,
    } = await import("./investSimKeys");
    let reconciled = reconcileInvestSimInputs(merged, simRows);
    if (collapseDiskForReassert) {
      reconciled = reassertOpenBookFromDisk(
        purgeSoldAliasesForOpenTickers(reconciled),
        collapseDiskForReassert,
        simRows,
      );
      reconciled = purgeSoldAliasesForOpenTickers(reconciled);
      console.info(
        `[investSim] post-reconcile reassert open book → $${Math.round(sumOpenCapital(reconciled))}`,
      );
    }
    if (JSON.stringify(reconciled) !== JSON.stringify(merged)) {
      merged = reconciled;
      saveInvestSimInputs(merged, { allowBogusCollapse: Boolean(collapseDiskForReassert) });
    }
  }
  if (!stillCurrent()) return sanitizeInvestSimInputs(loadInvestSimInputs());
  const out = sanitizeInvestSimInputs(merged);
  setInvestSimInputsCache(out);
  // Persist restored disk snapshot so a browser refresh does not lose portfolio again.
  if ((localWasEmpty || collapseDiskForReassert) && Object.keys(out).length > 0) {
    saveInvestSimInputs(out, { allowBogusCollapse: Boolean(collapseDiskForReassert) });
  }
  return out;
}

export { PERSIST_REL };

async function fetchInvestSimBookFromUrl(
  url: string,
): Promise<{ inputs: InvestSimInputs; source: string } | null> {
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const data = (await res.json()) as InvestSimPersistedFile;
    if (!data?.inputs || typeof data.inputs !== "object") return null;
    return { inputs: data.inputs, source: url };
  } catch {
    return null;
  }
}

/**
 * Prefer the richest open book among reachable APIs + project-data.
 *
 * Do **not** poll 127.0.0.1 when the UI is on the VPS (or any non-loopback
 * page): a fat local Electron book was re-opening CMPX/GPCR/MLTX that the
 * shared Pulse book had already sold.
 */
export async function fetchRichestInvestSimBook(): Promise<{
  inputs: InvestSimInputs;
  source: string;
  openCapital: number;
  openCount: number;
} | null> {
  const { sumOpenCapital } = await import("./investSimKeys");
  const { resolveApiBase, getRemoteApiBase, defaultRemoteHostHint } = await import(
    "../shared/remoteHost"
  );
  const { fetchProjectJson } = await import("../data/projectData");

  const isLoopback = (base: string) => {
    try {
      const host = new URL(base).hostname;
      return host === "localhost" || host === "127.0.0.1";
    } catch {
      return false;
    }
  };

  const pageHost =
    typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
  const pageIsLoopback =
    !pageHost || pageHost === "localhost" || pageHost === "127.0.0.1";

  const bases = new Set<string>();
  const configured = resolveApiBase();
  if (configured) bases.add(configured);
  // Same-origin VPS web: only the page host. Loopback UI may also probe local API.
  if (pageIsLoopback) {
    bases.add("http://127.0.0.1:8765");
    bases.add("http://localhost:8765");
  }
  const remote = getRemoteApiBase();
  if (remote) bases.add(remote);
  const hint = defaultRemoteHostHint();
  if (hint) bases.add(hint);

  // If the active API is remote, drop loopback candidates even on Vite localhost
  // with sn_api_base → VPS (otherwise local data/ re-opens sold Pulse names).
  if (configured && !isLoopback(configured)) {
    for (const b of [...bases]) {
      if (isLoopback(b)) bases.delete(b);
    }
  }

  type Cand = { inputs: InvestSimInputs; source: string; open: number; n: number };
  const cands: Cand[] = [];

  await Promise.all(
    [...bases].map(async (base) => {
      const hit = await fetchInvestSimBookFromUrl(`${base}/api/investment/sim-inputs`);
      if (!hit) return;
      let open = 0;
      let n = 0;
      for (const e of Object.values(hit.inputs)) {
        if (e && !e.ignoreSheet && (e.capital ?? 0) > 0) {
          open += e.capital ?? 0;
          n += 1;
        }
      }
      cands.push({ inputs: hit.inputs, source: hit.source, open, n });
    }),
  );

  // project-data on a remote page is the VPS file — OK. On Electron it can be
  // the fat local book; still useful as a candidate, but API sells merge later.
  try {
    const { data: projectFile } = await fetchProjectJson<InvestSimPersistedFile>(PERSIST_REL);
    if (projectFile?.inputs) {
      const open = sumOpenCapital(projectFile.inputs);
      let n = 0;
      for (const e of Object.values(projectFile.inputs)) {
        if (e && !e.ignoreSheet && (e.capital ?? 0) > 0) n += 1;
      }
      cands.push({
        inputs: projectFile.inputs,
        source: "project-data/invest_sim_inputs.json",
        open,
        n,
      });
    }
  } catch {
    /* ignore */
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.open - a.open || b.n - a.n);
  const best = cands[0]!;
  console.info(
    `[investSim] richest book: $${Math.round(best.open)} / ${best.n} open ← ${best.source}`,
    cands.map((c) => `${c.n}@$${Math.round(c.open)}`).join(" | "),
  );
  return {
    inputs: best.inputs,
    source: best.source,
    openCapital: best.open,
    openCount: best.n,
  };
}

/**
 * Manual / emergency: force-open the richest known server book into this browser.
 * Prefer localhost when it has more open capital than the configured VPS.
 */
export async function forceRestoreOpenBookFromServer(
  simRows?: Record<string, unknown>[],
): Promise<{
  restoredKeys: string[];
  openCapital: number;
  ok: boolean;
  source?: string;
  message?: string;
  inputs?: InvestSimInputs;
}> {
  const {
    sumOpenCapital,
    sumClosedPnlEur,
    reconcileInvestSimInputs,
    purgeSoldAliasesForOpenTickers,
    reassertOpenBookFromDisk,
    mergeClosedBooksFromCandidates,
  } = await import("./investSimKeys");

  const { getActiveInvestTesterId, usesSharedOperatorInvestBook } = await import(
    "./testerSession"
  );
  // Email accounts are independent — never import the operator Pulse book into them.
  if (getActiveInvestTesterId() || !usesSharedOperatorInvestBook()) {
    return {
      restoredKeys: [],
      openCapital: sumOpenCapital(loadInvestSimInputs()),
      ok: false,
      message:
        "Restore from shared server is lab-only. Each email account keeps its own empty or private book.",
    };
  }

  const best = await fetchRichestInvestSimBook();
  if (!best || !Object.keys(best.inputs).length) {
    return {
      restoredKeys: [],
      openCapital: sumOpenCapital(loadInvestSimInputs()),
      ok: false,
      message: "Nessun libro trovato (locale :8765 / VPS / project-data).",
    };
  }

  // Collect every known book so closed deals survive even if "richest open" host lost them.
  const closedSources: InvestSimInputs[] = [best.inputs, loadInvestSimInputs()];
  try {
    const { resolveApiBase, getRemoteApiBase, defaultRemoteHostHint } = await import(
      "../shared/remoteHost"
    );
    const bases = new Set<string>([
      "http://127.0.0.1:8765",
      "http://localhost:8765",
    ]);
    const configured = resolveApiBase();
    if (configured) bases.add(configured);
    const remote = getRemoteApiBase();
    if (remote) bases.add(remote);
    const hint = defaultRemoteHostHint();
    if (hint) bases.add(hint);
    await Promise.all(
      [...bases].map(async (base) => {
        const hit = await fetchInvestSimBookFromUrl(`${base}/api/investment/sim-inputs`);
        if (hit?.inputs) closedSources.push(hit.inputs);
      }),
    );
  } catch {
    /* optional */
  }

  const diskInputs = best.inputs;
  // Nuclear: clear in-memory cache + rebuild open keys from richest source.
  resetInvestSimInputsSnapshotCache();
  let next: InvestSimInputs = { ...loadInvestSimInputs() };
  const restoredKeys: string[] = [];
  for (const [k, diskEntry] of Object.entries(diskInputs)) {
    if (!diskEntry || diskEntry.ignoreSheet) continue;
    const diskCap = diskEntry.capital ?? 0;
    if (!(diskCap > 0)) continue;
    const prev = next[k];
    next[k] = {
      // Prefer disk buy — browser often kept capital but lost entry price after collapse.
      buyPrice:
        diskEntry.buyPrice > 0
          ? diskEntry.buyPrice
          : prev?.buyPrice && prev.buyPrice > 0
            ? prev.buyPrice
            : 0,
      capital: diskCap,
      ignoreSheet: false,
      // Prefer disk investedAt so Pulse can show "invested on …" after restore.
      investedAt: diskEntry.investedAt || prev?.investedAt,
      purchaseDate: diskEntry.purchaseDate || prev?.purchaseDate,
    };
    restoredKeys.push(k);
  }
  // Drop only sold markers on exact reopened keys — keep other-CD closed PnL.
  next = purgeSoldAliasesForOpenTickers(next, { restoredKeys });
  next = mergeClosedBooksFromCandidates(next, ...closedSources);
  if (simRows?.length) {
    next = reconcileInvestSimInputs(next, simRows);
    next = reassertOpenBookFromDisk(next, diskInputs, simRows);
    next = purgeSoldAliasesForOpenTickers(next, { restoredKeys });
    next = mergeClosedBooksFromCandidates(next, ...closedSources);
  } else {
    next = reassertOpenBookFromDisk(next, diskInputs);
    next = mergeClosedBooksFromCandidates(next, ...closedSources);
  }
  const clean = sanitizeInvestSimInputs(next);
  saveInvestSimInputs(clean, { allowBogusCollapse: true });

  // Always push richest book to the configured API (VPS often still has June's 6-name book).
  try {
    const { saveInvestSimInputsPersisted } = await import("../api/investSim");
    const { resolveApiBase } = await import("../shared/remoteHost");
    await saveInvestSimInputsPersisted(clean);
    console.info(`[investSim] synced restored book → ${resolveApiBase() || "(relative)"}`);
  } catch (e) {
    console.warn("[investSim] could not sync restored book to configured API", e);
  }

  const openCapital = sumOpenCapital(clean);
  const closedPnl = sumClosedPnlEur(clean);
  const message = `Ripristinate ${restoredKeys.length} open ($${Math.round(openCapital)}) + closed Σ $${Math.round(closedPnl)} da ${best.source}`;
  console.info(`[investSim] force-restore: ${message}`, restoredKeys.join(", "));

  if (typeof window !== "undefined") {
    try {
      (window as unknown as { __supernovaRestorePortfolio?: unknown }).__supernovaRestorePortfolio =
        forceRestoreOpenBookFromServer;
    } catch {
      /* ignore */
    }
  }

  return {
    restoredKeys,
    openCapital,
    ok: openCapital >= 10_000 || restoredKeys.length >= 5,
    source: best.source,
    message,
    inputs: clean,
  };
}

function historyCalendarDayKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Merge two same-day snapshots. Open-book `byTicker` comes from the newer mark
 * only — do not keep tickers that left the book (sell → rebuy must not inherit
 * the prior hold's peak € inside the same calendar day).
 */
export function mergeInvestSimHistoryPointPair(
  a: InvestSimHistoryPoint,
  b: InvestSimHistoryPoint,
): InvestSimHistoryPoint {
  const newer = Date.parse(a.ts) >= Date.parse(b.ts) ? a : b;
  const byTicker = { ...(newer.byTicker ?? {}) };
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

function isLocalStorageQuotaExceeded(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as DOMException;
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

/** Drop per-ticker breakdown — keeps chart totals, shrinks JSON a lot. */
function slimInvestSimHistoryPoints(
  points: InvestSimHistoryPoint[],
): InvestSimHistoryPoint[] {
  return points.map((p) => ({
    ts: p.ts,
    capital: p.capital,
    value: p.value,
    pnl: p.pnl,
    pnlPct: p.pnlPct,
    ...(typeof p.closedPnlEur === "number" ? { closedPnlEur: p.closedPnlEur } : {}),
    byTicker: {},
  }));
}

function writeInvestSimHistoryLocal(points: InvestSimHistoryPoint[]): InvestSimHistoryPoint[] {
  let trimmed = points.slice(-MAX_HISTORY);
  if (typeof window === "undefined") return trimmed;
  const updatedAt = new Date().toISOString();

  const persist = (candidate: InvestSimHistoryPoint[]): "ok" | "quota" | "fail" => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(candidate));
      localStorage.setItem(HISTORY_META_KEY, updatedAt);
      return "ok";
    } catch (err) {
      if (isLocalStorageQuotaExceeded(err)) return "quota";
      console.warn("[investSim] history localStorage write failed", err);
      return "fail";
    }
  };

  let result = persist(trimmed);
  if (result === "quota") {
    const n = trimmed.length;
    const fallbacks: InvestSimHistoryPoint[][] = [
      trimmed.slice(-Math.max(60, Math.floor(n / 2))),
      trimmed.slice(-Math.max(30, Math.floor(n / 4))),
      slimInvestSimHistoryPoints(trimmed.slice(-90)),
      slimInvestSimHistoryPoints(trimmed.slice(-30)),
      slimInvestSimHistoryPoints(trimmed.slice(-7)),
    ];
    for (const candidate of fallbacks) {
      try {
        localStorage.removeItem(HISTORY_KEY);
      } catch {
        /* ignore */
      }
      result = persist(candidate);
      if (result === "ok") {
        trimmed = candidate;
        console.warn(
          `[investSim] history localStorage near quota — kept ${candidate.length} points`,
        );
        break;
      }
      if (result === "fail") break;
    }
    if (result !== "ok") {
      try {
        localStorage.removeItem(HISTORY_KEY);
        localStorage.removeItem(HISTORY_META_KEY);
      } catch {
        /* ignore */
      }
      console.warn(
        "[investSim] history localStorage quota exceeded — dropped browser cache (disk persist still runs)",
      );
      trimmed = [];
    }
  }

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
    const { getActiveInvestTesterId, usesSharedOperatorInvestBook } = await import(
      "./testerSession"
    );
    // Per-email books: never merge shared operator history (or leftover local from another account).
    if (getActiveInvestTesterId()) {
      const local = loadInvestSimHistory();
      return local;
    }
    if (!usesSharedOperatorInvestBook()) {
      writeInvestSimHistoryLocal([]);
      return [];
    }

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
