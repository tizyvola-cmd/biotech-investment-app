/**
 * "New entries of the week" ledger.
 *
 * Persists a first-seen timestamp for every ticker that has appeared in the
 * simulation table within the SDS cohort window (≤ 4 months to CD). The home
 * dashboard consumes this to render a table of the companies newly detected
 * in the last 7 days.
 *
 * Design notes
 * ------------
 * - The sim table itself carries no "date added" column, so we have to build
 *   the mapping ourselves by observing the ticker set on every dashboard
 *   mount and recording brand-new tickers with `firstSeen = now()`.
 * - Entries are kept for 60 days (well beyond the 7-day query window) so we
 *   can distinguish "genuinely new this week" from "seen for months" even
 *   after the user re-installs / clears local data mid-week.
 * - Existing entries are NOT re-stamped when the ticker reappears, otherwise
 *   drop-outs that come back would be double-counted as "new this week".
 * - Warrant vs common (JSPRW / JSPR) share one ledger key — the tradeable
 *   common — so a late-appearing common row is not treated as "new this week"
 *   when the warrant was already tracked.
 * - Snapshotting is best-effort. On write errors (quota, non-browser env)
 *   the ledger silently degrades to in-memory only.
 */

import { warrantCommonTicker } from "./simulationPosition";

// v2 rolls over from v1 because the v1 initial bootstrap stamped every
// currently-in-scope ticker with `firstSeen = now()`, causing all of them
// to show up as "new this week" on day zero. v2 introduces a bootstrap
// backdate so only tickers appearing AFTER the first snapshot are surfaced.
// The v1 key is intentionally left orphaned in localStorage (cleaned up on
// the next `_resetNewEntriesLedger` call) — safer than deleting user data.
const STORAGE_KEY = "supernova.newEntriesLedger.v2";
const LEGACY_STORAGE_KEYS = ["supernova.newEntriesLedger.v1"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
/**
 * When we first bootstrap the ledger (i.e. the first `recordCurrentTickers`
 * call ever, or after a `_resetNewEntriesLedger`), all currently-in-scope
 * tickers must be treated as "already known" — otherwise they'd flood the
 * "new this week" list on day 0. We stamp them with a firstSeen 8 days in
 * the past so the weekly-new query (which cuts at 7d) excludes them.
 */
const BOOTSTRAP_BACKDATE_MS = 8 * 24 * 60 * 60 * 1000;
const CHANGE_EVENT = "supernova.newEntriesLedger.changed";

export interface NewEntryLedgerRecord {
  /** Uppercased ticker symbol. */
  ticker: string;
  /** ISO timestamp (ms epoch → ISO string) of the very first observation. */
  firstSeenIso: string;
  /** ISO timestamp of the most recent observation (rolling). */
  lastSeenIso: string;
}

interface LedgerFile {
  version: 1;
  records: Record<string, NewEntryLedgerRecord>;
  /**
   * ISO of the moment the ledger was first populated. Absent on legacy
   * (v1-pre-bootstrap-flag) files, in which case we treat all existing
   * records as already-bootstrapped to avoid double-marking.
   */
  bootstrapCompletedAtIso?: string;
}

function emptyFile(): LedgerFile {
  return { version: 1, records: {} };
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadLedger(): LedgerFile {
  if (!isBrowser()) return emptyFile();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cleanupLegacyKeys();
      return emptyFile();
    }
    const parsed = JSON.parse(raw) as Partial<LedgerFile> | null;
    if (!parsed || parsed.version !== 1 || !parsed.records) return emptyFile();
    return {
      version: 1,
      records: parsed.records,
      bootstrapCompletedAtIso: parsed.bootstrapCompletedAtIso,
    };
  } catch {
    return emptyFile();
  }
}

function cleanupLegacyKeys(): void {
  if (!isBrowser()) return;
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // no-op
    }
  }
}

function saveLedger(file: LedgerFile): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  } catch {
    // storage quota / private mode — accept silent degradation
  }
}

function normalizeTicker(t: string): string {
  return t.trim().toUpperCase();
}

/** Ledger identity: warrant suffix → tradeable common (JSPRW → JSPR). */
export function normalizeNewEntryTicker(t: string): string {
  const tk = normalizeTicker(t);
  if (!tk) return tk;
  return warrantCommonTicker(tk) ?? tk;
}

/** Fold legacy warrant keys into the common key (keep earliest firstSeen). */
function foldWarrantAliasRecords(file: LedgerFile): boolean {
  let dirty = false;
  for (const [tk, rec] of Object.entries(file.records)) {
    const common = warrantCommonTicker(tk);
    if (!common || common === tk) continue;
    const existing = file.records[common];
    if (!existing) {
      file.records[common] = { ...rec, ticker: common };
    } else {
      const a = Date.parse(rec.firstSeenIso);
      const b = Date.parse(existing.firstSeenIso);
      if (Number.isFinite(a) && (!Number.isFinite(b) || a < b)) {
        existing.firstSeenIso = rec.firstSeenIso;
      }
      const la = Date.parse(rec.lastSeenIso);
      const lb = Date.parse(existing.lastSeenIso);
      if (Number.isFinite(la) && (!Number.isFinite(lb) || la > lb)) {
        existing.lastSeenIso = rec.lastSeenIso;
      }
      existing.ticker = common;
    }
    delete file.records[tk];
    dirty = true;
  }
  return dirty;
}

/**
 * Record the currently-in-scope tickers. New tickers get a fresh first-seen
 * stamp; existing tickers have their `lastSeenIso` refreshed. Stale entries
 * (last seen > 60d ago) are purged.
 *
 * On the very first call (empty ledger, no bootstrap flag) every currently-
 * in-scope ticker is backdated to 8 days ago so it does NOT appear as "new
 * this week". Only tickers observed for the first time on a subsequent call
 * — i.e. genuine additions to the SDS cohort after the ledger was primed —
 * will surface in the weekly-new list.
 *
 * Returns the updated set of in-week entries as a convenience.
 */
export function recordCurrentTickers(currentTickers: readonly string[]): NewEntryLedgerRecord[] {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const file = loadLedger();
  let dirty = foldWarrantAliasRecords(file);
  const isBootstrap =
    !file.bootstrapCompletedAtIso && Object.keys(file.records).length === 0;
  const bootstrapFirstSeenIso = new Date(now - BOOTSTRAP_BACKDATE_MS).toISOString();
  const seen = new Set<string>();

  for (const raw of currentTickers) {
    const tk = normalizeNewEntryTicker(raw);
    if (!tk) continue;
    seen.add(tk);
    const existing = file.records[tk];
    if (existing) {
      if (existing.lastSeenIso !== nowIso) {
        existing.lastSeenIso = nowIso;
        dirty = true;
      }
    } else {
      file.records[tk] = {
        ticker: tk,
        firstSeenIso: isBootstrap ? bootstrapFirstSeenIso : nowIso,
        lastSeenIso: nowIso,
      };
      dirty = true;
    }
  }

  if (isBootstrap) {
    file.bootstrapCompletedAtIso = nowIso;
    dirty = true;
  }

  for (const [tk, rec] of Object.entries(file.records)) {
    const lastSeenMs = Date.parse(rec.lastSeenIso);
    if (Number.isFinite(lastSeenMs) && now - lastSeenMs > RETENTION_MS) {
      delete file.records[tk];
      dirty = true;
    }
  }

  if (dirty) saveLedger(file);

  return listWeeklyNewEntries(seen);
}

/**
 * Returns the ledger entries whose firstSeen is within the last 7 days AND
 * whose ticker is present in the provided `currentTickers` (so drop-outs are
 * not reported).
 */
export function listWeeklyNewEntries(currentTickers: Set<string> | readonly string[]): NewEntryLedgerRecord[] {
  const now = Date.now();
  const cutoff = now - WEEK_MS;
  const rawScope =
    currentTickers instanceof Set
      ? currentTickers
      : new Set(currentTickers.map(normalizeTicker));
  const scope = new Set([...rawScope].map(normalizeNewEntryTicker));
  const file = loadLedger();
  if (foldWarrantAliasRecords(file)) saveLedger(file);
  const out: NewEntryLedgerRecord[] = [];
  for (const rec of Object.values(file.records)) {
    const tk = normalizeNewEntryTicker(rec.ticker);
    if (!scope.has(tk)) continue;
    const firstMs = Date.parse(rec.firstSeenIso);
    if (!Number.isFinite(firstMs)) continue;
    if (firstMs >= cutoff) out.push({ ...rec, ticker: tk });
  }
  out.sort((a, b) => (a.firstSeenIso < b.firstSeenIso ? 1 : -1));
  return out;
}

export const NEW_ENTRIES_LEDGER_CHANGED_EVENT = CHANGE_EVENT;

/**
 * Dismiss "New this week" until a ticker appears that was not already
 * dismissed. Names dropping off the list must NOT reopen the panel.
 */
const DISMISS_SET_KEY = "supernova.newEntriesWeek.dismissedTickers.v2";
/** Legacy exact-signature key — migrated into DISMISS_SET_KEY on first read. */
const DISMISS_SIG_KEY = "supernova.newEntriesWeek.dismissedSig.v1";

function uniqueNormalizedTickers(tickers: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tickers) {
    const tk = normalizeNewEntryTicker(raw);
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    out.push(tk);
  }
  return out;
}

/** Stable fingerprint of a ticker set (tests / debug). */
export function newEntriesDismissSignature(tickers: readonly string[]): string {
  return uniqueNormalizedTickers(tickers).sort().join("|");
}

function loadDismissedTickerSet(): Set<string> {
  if (!isBrowser()) return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISS_SET_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return new Set(uniqueNormalizedTickers(parsed.map((x) => String(x))));
      }
    }
    const sig = window.localStorage.getItem(DISMISS_SIG_KEY);
    if (sig) return new Set(uniqueNormalizedTickers(sig.split("|")));
  } catch {
    // quota / private mode / corrupt JSON
  }
  return new Set();
}

function saveDismissedTickerSet(tickers: Set<string>): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(DISMISS_SET_KEY, JSON.stringify([...tickers].sort()));
    window.localStorage.removeItem(DISMISS_SIG_KEY);
  } catch {
    // no-op
  }
}

/** True iff every current ticker was already dismissed (subset). */
export function isNewEntriesPanelDismissed(tickers: readonly string[]): boolean {
  const current = uniqueNormalizedTickers(tickers);
  if (!current.length) return false;
  const dismissed = loadDismissedTickerSet();
  if (!dismissed.size) return false;
  return current.every((tk) => dismissed.has(tk));
}

/** Union current tickers into the dismissed set. */
export function dismissNewEntriesPanel(tickers: readonly string[]): void {
  const incoming = uniqueNormalizedTickers(tickers);
  if (!incoming.length) return;
  const dismissed = loadDismissedTickerSet();
  for (const tk of incoming) dismissed.add(tk);
  saveDismissedTickerSet(dismissed);
}

/** Test helper — wipes ledger (both current + legacy keys). Not used by production code. */
export function _resetNewEntriesLedger(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(DISMISS_SET_KEY);
    window.localStorage.removeItem(DISMISS_SIG_KEY);
    for (const key of LEGACY_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // no-op
  }
}
