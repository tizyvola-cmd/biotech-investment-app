/**
 * Daily «new today» bookmarks (🔖) for desk / calendar tables.
 *
 * Observes the live ticker set and stamps first-seen. First bootstrap
 * backdates everyone so day zero is not flooded with bookmarks.
 * Display only — does not change Soft BUY/SELL.
 */

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const BOOTSTRAP_BACKDATE_MS = 36 * 60 * 60 * 1000;
const ROME_TZ = "Europe/Rome";

const CATALYST_DESK_KEY = "supernova.catalystDeskNewLedger.v1";
const CALENDAR_FORWARD_KEY = "supernova.calendarForwardNewLedger.v1";

export type CatalystDeskNewRecord = {
  ticker: string;
  firstSeenIso: string;
  lastSeenIso: string;
};

type LedgerFile = {
  version: 1;
  records: Record<string, CatalystDeskNewRecord>;
  bootstrapCompletedAtIso?: string;
};

function emptyFile(): LedgerFile {
  return { version: 1, records: {} };
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadLedger(storageKey: string): LedgerFile {
  if (!isBrowser()) return emptyFile();
  try {
    const raw = window.localStorage.getItem(storageKey);
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

function saveLedger(storageKey: string, file: LedgerFile): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(file));
  } catch {
    /* quota / private mode */
  }
}

export function normalizeCatalystDeskTicker(raw: string): string {
  return raw.trim().toUpperCase();
}

export function romeDateKey(ms = Date.now()): string {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: ROME_TZ });
}

export function isSameRomeDay(iso: string, nowMs = Date.now()): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return romeDateKey(t) === romeDateKey(nowMs);
}

/** Ms until the next Europe/Rome midnight (bookmark day roll). */
export function msUntilNextRomeMidnight(nowMs = Date.now()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ROME_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(nowMs));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const second = Number(parts.find((p) => p.type === "second")?.value ?? 0);
  const elapsed = ((hour * 60 + minute) * 60 + second) * 1000;
  return Math.max(1000, 24 * 60 * 60 * 1000 - elapsed + 250);
}

function listNewToday(
  storageKey: string,
  currentTickers: readonly string[],
  nowMs = Date.now(),
): string[] {
  const scope = new Set(
    currentTickers.map(normalizeCatalystDeskTicker).filter(Boolean),
  );
  const file = loadLedger(storageKey);
  const out: string[] = [];
  for (const rec of Object.values(file.records)) {
    const tk = normalizeCatalystDeskTicker(rec.ticker);
    if (!scope.has(tk)) continue;
    if (isSameRomeDay(rec.firstSeenIso, nowMs)) out.push(tk);
  }
  out.sort();
  return out;
}

function recordTickers(
  storageKey: string,
  currentTickers: readonly string[],
  nowMs = Date.now(),
): string[] {
  const nowIso = new Date(nowMs).toISOString();
  const file = loadLedger(storageKey);
  const isBootstrap =
    !file.bootstrapCompletedAtIso && Object.keys(file.records).length === 0;
  const bootstrapFirstSeenIso = new Date(nowMs - BOOTSTRAP_BACKDATE_MS).toISOString();
  let dirty = false;

  for (const raw of currentTickers) {
    const tk = normalizeCatalystDeskTicker(raw);
    if (!tk) continue;
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
    if (Number.isFinite(lastSeenMs) && nowMs - lastSeenMs > RETENTION_MS) {
      delete file.records[tk];
      dirty = true;
    }
  }

  if (dirty) saveLedger(storageKey, file);
  return listNewToday(storageKey, currentTickers, nowMs);
}

/**
 * Observe Catalyst desk tickers. New names get today's stamp;
 * already-known names keep their firstSeen. Returns tickers first seen today.
 */
export function recordCatalystDeskTickers(
  currentTickers: readonly string[],
  nowMs = Date.now(),
): string[] {
  return recordTickers(CATALYST_DESK_KEY, currentTickers, nowMs);
}

export function listCatalystDeskNewToday(
  currentTickers: readonly string[],
  nowMs = Date.now(),
): string[] {
  return listNewToday(CATALYST_DESK_KEY, currentTickers, nowMs);
}

/** Test helper. */
export function _resetCatalystDeskNewLedger(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(CATALYST_DESK_KEY);
  } catch {
    /* no-op */
  }
}

/** SEC forward Calendar — same bookmark semantics for newly queued Discovery names. */
export function recordCalendarForwardTickers(
  currentTickers: readonly string[],
  nowMs = Date.now(),
): string[] {
  return recordTickers(CALENDAR_FORWARD_KEY, currentTickers, nowMs);
}

export function listCalendarForwardNewToday(
  currentTickers: readonly string[],
  nowMs = Date.now(),
): string[] {
  return listNewToday(CALENDAR_FORWARD_KEY, currentTickers, nowMs);
}

export function _resetCalendarForwardNewLedger(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(CALENDAR_FORWARD_KEY);
  } catch {
    /* no-op */
  }
}
