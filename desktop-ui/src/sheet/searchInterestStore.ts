/**
 * Shared Google Trends (G-Trends) row cache for Wind + Top KPI + desks.
 * Wind fills it first; other tables reuse the same prints without re-fetching.
 */
import type { SearchInterestPayload, SearchInterestRow } from "../api/supernova";

type Listener = () => void;

const rowsByTicker: Record<string, SearchInterestRow> = {};
const listeners = new Set<Listener>();

export function isSearchInterestScored(
  row: SearchInterestRow | null | undefined,
): boolean {
  if (!row) return false;
  return (
    (row.interest_score != null && Number.isFinite(row.interest_score)) ||
    (row.interest_delta_pct != null && Number.isFinite(row.interest_delta_pct)) ||
    (row.zscore_vs_baseline != null && Number.isFinite(row.zscore_vs_baseline)) ||
    (row.rolling_baseline_20d != null && Number.isFinite(row.rolling_baseline_20d))
  );
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Merge scored prints; never replace a scored row with an empty one. */
export function rememberSearchInterestRows(
  incoming: Record<string, SearchInterestRow> | null | undefined,
): number {
  let added = 0;
  for (const [raw, row] of Object.entries(incoming ?? {})) {
    const tk = raw.trim().toUpperCase();
    if (!tk || !row) continue;
    const next: SearchInterestRow = { ...row, ticker: row.ticker || tk };
    if (isSearchInterestScored(next) || !isSearchInterestScored(rowsByTicker[tk])) {
      const prev = rowsByTicker[tk];
      const same =
        prev &&
        prev.interest_score === next.interest_score &&
        prev.interest_delta_pct === next.interest_delta_pct &&
        prev.zscore_vs_baseline === next.zscore_vs_baseline;
      if (!same) {
        rowsByTicker[tk] = next;
        added += 1;
      } else if (!prev) {
        rowsByTicker[tk] = next;
        added += 1;
      }
    }
  }
  if (added > 0) notify();
  return added;
}

export function rememberSearchInterestPayload(
  payload: Pick<SearchInterestPayload, "rows"> | null | undefined,
): number {
  return rememberSearchInterestRows(payload?.rows);
}

export function peekSearchInterestRows(
  tickers?: readonly string[],
): Record<string, SearchInterestRow> {
  if (!tickers?.length) return { ...rowsByTicker };
  const out: Record<string, SearchInterestRow> = {};
  for (const raw of tickers) {
    const tk = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (tk && rowsByTicker[tk]) out[tk] = rowsByTicker[tk]!;
  }
  return out;
}

export function missingSearchInterestTickers(tickers: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tickers) {
    const tk = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    if (!isSearchInterestScored(rowsByTicker[tk])) out.push(tk);
  }
  return out;
}

export function subscribeSearchInterestStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function searchInterestStoreSize(): number {
  return Object.keys(rowsByTicker).length;
}
