/**
 * Shared OHLCV (Yahoo daily) fetch for price + volume charts.
 * Coalesces in-flight requests and caches briefly — same pattern as
 * fetchVolumeVsPrevSession / fetchHealth (no React Query).
 */
import { useEffect, useState } from "react";
import {
  fetchVolumeHistory,
  type VolumeHistoryBar,
  type VolumeHistoryPayload,
} from "../api/supernova";
import {
  rangeToFetchDays,
  type PriceVarChartRange,
} from "./priceVariationSeries";

/** Volume chart needs ≥60 sessions for RVOL character even on short ranges. */
export const OHLCV_VOLUME_CHARACTER_MIN_DAYS = 60;

const CACHE_TTL_MS = 60_000;

type CacheEntry = { at: number; value: VolumeHistoryPayload };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<VolumeHistoryPayload>>();

function cacheKey(ticker: string, days: number): string {
  return `${ticker}|${days}`;
}

/** Days to fetch once for the price+volume pair (covers both chart needs). */
export function pairOhlcvFetchDays(range: PriceVarChartRange): number {
  const chartDays = range === "24h" ? 3 : rangeToFetchDays(range);
  return Math.max(chartDays, OHLCV_VOLUME_CHARACTER_MIN_DAYS);
}

/**
 * Coalesced volume-history: one network call per ticker|days while in flight;
 * 60s response cache for warm revisits.
 */
export function fetchOhlcvHistory(
  ticker: string,
  days: number,
): Promise<VolumeHistoryPayload> {
  const tk = ticker.trim().toUpperCase();
  const d = Math.max(1, Math.min(400, Math.round(days)));
  if (!tk) {
    return Promise.resolve({
      ticker: "",
      bars: [],
      updated_at: null,
      error: "missing_ticker",
    });
  }
  const key = cacheKey(tk, d);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return Promise.resolve(hit.value);
  }
  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchVolumeHistory(tk, d)
      .then((value) => {
        cache.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, pending);
  }
  return pending;
}

/** Drop cache (tests / force refresh). */
export function clearOhlcvHistoryCache(): void {
  cache.clear();
  inflight.clear();
}

export type OhlcvHistoryState = {
  bars: VolumeHistoryBar[];
  loading: boolean;
  error: string | null;
  payload: VolumeHistoryPayload | null;
};

/**
 * Hook for a single ticker OHLCV series. Prefer calling once in the parent
 * of price+volume charts and passing `bars`/`loading` down.
 */
export function useOhlcvHistory(
  ticker: string | null | undefined,
  days: number,
): OhlcvHistoryState {
  const tk = String(ticker ?? "")
    .trim()
    .toUpperCase();
  const d = Math.max(1, Math.min(400, Math.round(days)));
  const [bars, setBars] = useState<VolumeHistoryBar[]>([]);
  const [loading, setLoading] = useState(Boolean(tk));
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<VolumeHistoryPayload | null>(null);

  useEffect(() => {
    if (!tk) {
      setBars([]);
      setLoading(false);
      setError(null);
      setPayload(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchOhlcvHistory(tk, d)
      .then((doc) => {
        if (cancelled) return;
        setPayload(doc);
        setBars(doc.bars ?? []);
        setError(doc.error && !doc.bars?.length ? String(doc.error) : null);
      })
      .catch(() => {
        if (cancelled) return;
        setPayload(null);
        setBars([]);
        setError("fetch_failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tk, d]);

  return { bars, loading, error, payload };
}
