/**
 * Catalyst desk empty-cell diagnostics.
 * Enable: localStorage.setItem("supernova:desk-empty-diag", "1") then reload.
 * Logs ticker, field, last fill source, and what wiped / left it empty.
 */
const DIAG_KEY = "supernova:desk-empty-diag";

export type DeskFieldFillMeta = {
  source: string;
  at: string;
};

const lastFillByCell = new Map<string, DeskFieldFillMeta>();

function cellKey(ticker: string, field: string): string {
  return `${ticker.trim().toUpperCase()}|${field}`;
}

export function isDeskEmptyDiagEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DIAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function noteDeskFieldFill(
  ticker: string,
  field: string,
  source: string,
): void {
  const tk = ticker.trim().toUpperCase();
  if (!tk || !field) return;
  lastFillByCell.set(cellKey(tk, field), {
    source,
    at: new Date().toISOString(),
  });
}

export function noteDeskFieldFillsFromRow(
  ticker: string,
  row: object | null | undefined,
  signalKeys: readonly string[],
  source: string,
  valueOk: (v: unknown) => boolean,
): void {
  if (!row) return;
  const o = row as Record<string, unknown>;
  for (const k of signalKeys) {
    if (valueOk(o[k])) noteDeskFieldFill(ticker, k, source);
  }
}

export function logDeskEmptyCell(opts: {
  ticker: string;
  field: string;
  reason: string;
  wipeSource?: string | null;
}): void {
  if (!isDeskEmptyDiagEnabled()) return;
  const tk = opts.ticker.trim().toUpperCase();
  const prev = lastFillByCell.get(cellKey(tk, opts.field));
  // eslint-disable-next-line no-console -- intentional desk diag
  console.warn(
    `[desk-empty] ${tk} ${opts.field} reason=${opts.reason}` +
      ` lastFill=${prev ? `${prev.source}@${prev.at}` : "never"}` +
      ` wipe=${opts.wipeSource ?? "—"}`,
  );
}

/** Audit watchlist gaps after a pack paint / hole-fill. */
export function auditDeskMissingSignals(opts: {
  tickers: string[];
  column: string;
  signalKeys: readonly string[];
  byTicker: Record<string, object | undefined | null>;
  valueOk: (v: unknown) => boolean;
  reason: string;
}): void {
  if (!isDeskEmptyDiagEnabled()) return;
  for (const raw of opts.tickers) {
    const tk = raw.trim().toUpperCase();
    if (!tk) continue;
    const row = opts.byTicker[tk];
    const hasAny =
      row &&
      opts.signalKeys.some((k) =>
        opts.valueOk((row as Record<string, unknown>)[k]),
      );
    if (hasAny) continue;
    logDeskEmptyCell({
      ticker: tk,
      field: opts.column,
      reason: opts.reason,
      wipeSource: null,
    });
  }
}
