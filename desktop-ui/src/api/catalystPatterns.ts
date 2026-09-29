/** Catalyst pattern library — cycle alerts (watch / buy zone / exit). */

import { api } from "./supernova";
import { cyclePhaseLabelsForApi } from "../sheet/cyclePhaseDisplay";

export type CatalystCyclePhase =
  | "pre_volume_watch"
  | "dump_entry"
  | "exhaustion_exit";

export type CatalystPatternConfidence = "high" | "medium" | "low" | "research";

export type CatalystPatternMatch = {
  pattern_id: string;
  phase: CatalystCyclePhase;
  pattern_status: "confirmed" | "emerging" | "hypothesis" | "deprecated";
  name_en: string;
  name_it: string;
  confidence: CatalystPatternConfidence;
  historical_lift: number | null;
  historical_n: number | null;
  median_outcome_pct: number | null;
};

export type CatalystCyclePrimary = {
  phase: CatalystCyclePhase;
  confidence: CatalystPatternConfidence;
  primary_pattern_id: string | null;
  label_en: string;
  label_it: string;
  reason_en: string;
  reason_it: string;
};

export type CatalystTickerCycleAlert = {
  ticker: string;
  row_key: string | null;
  completion_date: string | null;
  primary: CatalystCyclePrimary | null;
  matches: CatalystPatternMatch[];
  live_features: Record<string, unknown>;
  library_updated_at?: string | null;
};

export type CatalystPatternLibraryDoc = {
  version: number;
  updated_at: string | null;
  cohort_summary: Record<string, unknown> | null;
  patterns: Array<Record<string, unknown>>;
};

export type CatalystCycleAlertsResponse = {
  updated_at: string | null;
  cohort_summary: Record<string, unknown> | null;
  alerts: Record<string, CatalystTickerCycleAlert>;
};

const CYCLE_ALERTS_CACHE_TTL_MS = 5 * 60 * 1000;

let cycleAlertsCache: { key: string; at: number; data: CatalystCycleAlertsResponse } | null = null;
const cycleAlertsInflight = new Map<string, Promise<CatalystCycleAlertsResponse>>();

/** Stable cache key for ticker lists — avoids duplicate fetches on parent re-renders. */
export function normalizeCycleTickerKey(tickers: string[]): string {
  return [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].sort().join(",");
}

export function cycleTickersFromKey(key: string): string[] {
  return key ? key.split(",").filter(Boolean) : [];
}

export function fetchCatalystPatternLibrary(): Promise<CatalystPatternLibraryDoc> {
  return api<CatalystPatternLibraryDoc>("/api/catalyst-patterns");
}

export function fetchCatalystCycleAlerts(
  tickers?: string[],
): Promise<CatalystCycleAlertsResponse> {
  const key = normalizeCycleTickerKey(tickers ?? []);
  const now = Date.now();
  if (
    cycleAlertsCache &&
    cycleAlertsCache.key === key &&
    now - cycleAlertsCache.at < CYCLE_ALERTS_CACHE_TTL_MS
  ) {
    return Promise.resolve(cycleAlertsCache.data);
  }
  const inflight = cycleAlertsInflight.get(key);
  if (inflight) return inflight;

  const q = cycleTickersFromKey(key);
  const path =
    q.length > 0
      ? `/api/catalyst-patterns/alerts?tickers=${encodeURIComponent(q.join(","))}`
      : "/api/catalyst-patterns/alerts";
  const req = api<CatalystCycleAlertsResponse>(path, undefined, { timeoutMs: 120_000 })
    .then((data) => {
      cycleAlertsCache = { key, at: Date.now(), data };
      cycleAlertsInflight.delete(key);
      return data;
    })
    .catch((err) => {
      cycleAlertsInflight.delete(key);
      throw err;
    });
  cycleAlertsInflight.set(key, req);
  return req;
}

/** Instant read — use to hydrate UI before async fetch (e.g. dashboard → Evaluation tab). */
export function peekCatalystCycleAlertsCache(
  tickers?: string[],
): CatalystCycleAlertsResponse | null {
  const key = normalizeCycleTickerKey(tickers ?? []);
  if (
    cycleAlertsCache &&
    cycleAlertsCache.key === key &&
    Date.now() - cycleAlertsCache.at < CYCLE_ALERTS_CACHE_TTL_MS
  ) {
    return cycleAlertsCache.data;
  }
  return null;
}

export function cycleAlertForKey(
  alerts: Record<string, CatalystTickerCycleAlert> | null | undefined,
  rowKey: string,
  ticker: string,
): CatalystTickerCycleAlert | null {
  if (!alerts) return null;
  const direct = alerts[rowKey];
  if (direct) return direct;
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;
  const byTicker = alerts[tk];
  if (byTicker) return byTicker;
  const prefix = `${tk}|`;
  let fallback: CatalystTickerCycleAlert | null = null;
  for (const [key, alert] of Object.entries(alerts)) {
    if (key.startsWith(prefix) || alert.ticker?.trim().toUpperCase() === tk) {
      if (!fallback || (alert.primary && !fallback.primary)) {
        fallback = alert;
      }
    }
  }
  return fallback;
}

const CONFIDENCE_RANK: Record<CatalystPatternConfidence, number> = {
  high: 4,
  medium: 3,
  low: 2,
  research: 1,
};

export function resolveCycleDisplayPrimary(
  alert: CatalystTickerCycleAlert | null | undefined,
): CatalystCyclePrimary | null {
  if (!alert) return null;
  if (alert.primary) return alert.primary;
  const matches = alert.matches ?? [];
  if (!matches.length) return null;
  const best = [...matches].sort(
    (a, b) =>
      (CONFIDENCE_RANK[b.confidence] ?? 0) - (CONFIDENCE_RANK[a.confidence] ?? 0) ||
      (b.historical_lift ?? 0) - (a.historical_lift ?? 0),
  )[0]!;
  const labels = cyclePhaseLabelsForApi(best.phase);
  return {
    phase: best.phase,
    confidence: best.confidence,
    primary_pattern_id: best.pattern_id,
    label_en: labels.label_en,
    label_it: labels.label_it,
    reason_en: best.name_en,
    reason_it: best.name_it,
  };
}
