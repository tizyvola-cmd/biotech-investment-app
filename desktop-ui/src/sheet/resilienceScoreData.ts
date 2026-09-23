/**
 * Resilience Score client-side helpers.
 *
 * The full document is fetched via `fetchResilienceSnapshot` (which
 * de-duplicates and caches). This module exposes a lightweight, lazily
 * hydrated per-ticker lookup useful for tables and small badges.
 *
 * Design intent — no overlap with SDS or Regulatory scores:
 *   - SDS score = pre-CD price pattern (`cluster_a`..`cluster_d` of SDS).
 *   - Regulatory score = CRL / PDUFA / CMC events impact.
 *   - Resilience score = intrinsic recovery + growth capacity, computed
 *     from a ticker's own 5y daily closes and XBI closes.
 *
 * See `prediction/resilience_score.py` for the authoritative formula.
 */

import {
  fetchResilienceSnapshot,
  type ResilienceEntryDoc,
  type ResilienceSnapshotDoc,
} from "../api/supernova";

export type { ResilienceEntryDoc, ResilienceSnapshotDoc } from "../api/supernova";

/** Event fired when the snapshot has been (re-)loaded into module cache. */
export const RESILIENCE_SNAPSHOT_UPDATED_EVENT = "supernova:resilience-snapshot-updated";

let cachedSnapshot: ResilienceSnapshotDoc | null = null;
let cachedIndex: Map<string, ResilienceEntryDoc> | null = null;
let hydrating: Promise<ResilienceSnapshotDoc | null> | null = null;

function indexEntries(doc: ResilienceSnapshotDoc): Map<string, ResilienceEntryDoc> {
  const m = new Map<string, ResilienceEntryDoc>();
  for (const [tk, entry] of Object.entries(doc.entries || {})) {
    m.set(tk.toUpperCase(), entry);
  }
  return m;
}

/** Best-effort hydrate; safe to call from many places at boot. */
export async function hydrateResilienceSnapshot(opts?: {
  force?: boolean;
}): Promise<ResilienceSnapshotDoc | null> {
  if (!opts?.force && cachedSnapshot) return cachedSnapshot;
  if (hydrating) return hydrating;
  hydrating = fetchResilienceSnapshot(opts)
    .then((doc) => {
      cachedSnapshot = doc;
      cachedIndex = indexEntries(doc);
      try {
        window.dispatchEvent(new CustomEvent(RESILIENCE_SNAPSHOT_UPDATED_EVENT));
      } catch {
        /* SSR / test environment — no window. */
      }
      return doc;
    })
    .catch((err) => {
      // Never throw upstream: consumers must degrade gracefully when the
      // snapshot is missing or the API is unreachable.
      console.warn("[resilience] snapshot fetch failed:", err);
      return null;
    })
    .finally(() => {
      hydrating = null;
    });
  return hydrating;
}

/** Synchronous lookup — returns null if snapshot not yet hydrated. */
export function lookupResilienceForTicker(ticker: string): ResilienceEntryDoc | null {
  if (!cachedIndex) return null;
  return cachedIndex.get(ticker.toUpperCase()) ?? null;
}

/** Snapshot metadata (generated_at, counts) — null if not hydrated. */
export function getResilienceSnapshotMeta(): {
  generatedAt: string | null;
  tickerCount: number;
  skippedCount: number;
} | null {
  if (!cachedSnapshot) return null;
  return {
    generatedAt: cachedSnapshot.generated_at,
    tickerCount: cachedSnapshot.ticker_count,
    skippedCount: cachedSnapshot.skipped_count,
  };
}

/** Utility: is this a "measurable" entry (i.e. at least one block ok)? */
export function isResilienceMeasurable(entry: ResilienceEntryDoc | null): boolean {
  if (!entry) return false;
  return entry.status === "ok";
}

/** Color tone for the score (green ≥ 60, amber 40-59, red < 40). */
export function resilienceScoreTone(score: number): "up" | "flat" | "down" {
  if (score >= 60) return "up";
  if (score >= 40) return "flat";
  return "down";
}

/** Explicit reset (tests, hot-reload flows). */
export function _resetResilienceCache(): void {
  cachedSnapshot = null;
  cachedIndex = null;
  hydrating = null;
}
