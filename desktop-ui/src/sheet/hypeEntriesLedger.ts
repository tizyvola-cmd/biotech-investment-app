/**
 * "Hype detected this week" ledger.
 *
 * Persists a first-seen timestamp for every ticker that has appeared in the
 * volume-hype funnel (`hype_volume_funnel: true` on the simulation snapshot),
 * regardless of CD bucket (sim / off_book). The home dashboard consumes this
 * to render the companies newly flagged by the hype scanner in the last 7 days.
 *
 * Design notes
 * ------------
 * - Distinct from `newEntriesLedger` — that one is scoped to the ≤120d SDS
 *   cohort. The hype list is unscoped so far-CD hype (e.g. CANF 363d, BIAF
 *   942d) surfaces too.
 * - Entries kept for 60 days so we can still distinguish "new" from "seen for
 *   weeks" after a browser wipe / roll-back.
 * - Existing entries are NOT re-stamped when the ticker reappears in a later
 *   scan.
 * - Bootstrap backdate: on the very first snapshot ever, every currently-
 *   flagged ticker is stamped 8 days in the past so the whole hype list does
 *   NOT flood "this week" on day zero. Only tickers first observed on a
 *   subsequent snapshot surface as new-this-week.
 * - No warrant/common fold — hype tickers are always the tradeable common.
 * - Best-effort persistence (silent degradation on quota / non-browser env).
 */

const STORAGE_KEY = "supernova.hypeEntriesLedger.v1";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000;
const BOOTSTRAP_BACKDATE_MS = 8 * 24 * 60 * 60 * 1000;
const CHANGE_EVENT = "supernova.hypeEntriesLedger.changed";

export interface HypeEntryLedgerRecord {
  /** Uppercased ticker symbol. */
  ticker: string;
  /** ISO timestamp of the very first observation. */
  firstSeenIso: string;
  /** ISO timestamp of the most recent observation. */
  lastSeenIso: string;
}

interface LedgerFile {
  version: 1;
  records: Record<string, HypeEntryLedgerRecord>;
  /** ISO of the moment the ledger was first populated. */
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
    if (!raw) return emptyFile();
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

/**
 * Record the currently-flagged hype tickers. New tickers get a fresh first-
 * seen stamp; existing ones have their `lastSeenIso` refreshed. Stale entries
 * (last seen > 60d ago) are purged.
 *
 * On the very first call ever (empty ledger, no bootstrap flag) every
 * currently-flagged ticker is backdated to 8 days ago so it does NOT appear
 * as "new this week". Only tickers observed for the first time on a
 * subsequent call — i.e. genuine additions to the hype scanner after the
 * ledger was primed — will surface in the weekly-new list.
 *
 * Returns the updated set of in-week entries as a convenience.
 */
export function recordCurrentHypeTickers(
  currentTickers: readonly string[],
): HypeEntryLedgerRecord[] {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const file = loadLedger();
  let dirty = false;
  const isBootstrap =
    !file.bootstrapCompletedAtIso && Object.keys(file.records).length === 0;
  const bootstrapFirstSeenIso = new Date(now - BOOTSTRAP_BACKDATE_MS).toISOString();
  const seen = new Set<string>();

  for (const raw of currentTickers) {
    const tk = normalizeTicker(raw);
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

  return listWeeklyNewHypeEntries(seen);
}

/**
 * Returns the ledger entries whose `firstSeenIso` is within the last 7 days
 * AND whose ticker is currently present in `currentTickers` (so tickers
 * dropped from the funnel are not reported).
 */
export function listWeeklyNewHypeEntries(
  currentTickers: Set<string> | readonly string[],
): HypeEntryLedgerRecord[] {
  const now = Date.now();
  const cutoff = now - WEEK_MS;
  const scope =
    currentTickers instanceof Set
      ? currentTickers
      : new Set(currentTickers.map(normalizeTicker));
  const file = loadLedger();
  const out: HypeEntryLedgerRecord[] = [];
  for (const rec of Object.values(file.records)) {
    const tk = normalizeTicker(rec.ticker);
    if (!scope.has(tk)) continue;
    const firstMs = Date.parse(rec.firstSeenIso);
    if (!Number.isFinite(firstMs)) continue;
    if (firstMs >= cutoff) out.push({ ...rec, ticker: tk });
  }
  out.sort((a, b) => (a.firstSeenIso < b.firstSeenIso ? 1 : -1));
  return out;
}

export const HYPE_ENTRIES_LEDGER_CHANGED_EVENT = CHANGE_EVENT;

/** First-seen stamp for a currently flagged hype ticker (ledger or empty). */
export function hypeFirstSeenIso(ticker: string): string {
  const rec = loadLedger().records[normalizeTicker(ticker)];
  return rec?.firstSeenIso ?? "";
}

/**
 * Dismiss "Hype in pipeline" until a ticker appears that was not already
 * dismissed. Names dropping off the hold window must NOT reopen the panel.
 */
const DISMISS_SET_KEY = "supernova.hypeEntriesWeek.dismissedTickers.v2";
/** Legacy exact-signature key — migrated into DISMISS_SET_KEY on first write. */
const DISMISS_SIG_KEY = "supernova.hypeEntriesWeek.dismissedSig.v1";

function uniqueNormalizedTickers(tickers: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tickers) {
    const tk = normalizeTicker(raw);
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    out.push(tk);
  }
  return out;
}

/** Stable fingerprint of a ticker set (tests / debug). */
export function hypeEntriesDismissSignature(tickers: readonly string[]): string {
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
export function isHypeEntriesPanelDismissed(tickers: readonly string[]): boolean {
  const current = uniqueNormalizedTickers(tickers);
  if (!current.length) return false;
  const dismissed = loadDismissedTickerSet();
  if (!dismissed.size) return false;
  return current.every((tk) => dismissed.has(tk));
}

/** Union current tickers into the dismissed set. */
export function dismissHypeEntriesPanel(tickers: readonly string[]): void {
  const incoming = uniqueNormalizedTickers(tickers);
  if (!incoming.length) return;
  const dismissed = loadDismissedTickerSet();
  for (const tk of incoming) dismissed.add(tk);
  saveDismissedTickerSet(dismissed);
}

/** Test helper — wipes ledger. Not used by production code. */
export function _resetHypeEntriesLedger(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(DISMISS_SET_KEY);
    window.localStorage.removeItem(DISMISS_SIG_KEY);
  } catch {
    // no-op
  }
}
