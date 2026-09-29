/**
 * Shared client cache for US product-revenue Gemini lookups so Deep Dive can
 * start the search when the card opens (not only when Financial is selected).
 */
import {
  lookupDeskUsProductRevenue,
  type UsProductRevenueLookupResult,
} from "../api/supernova";

type Body = {
  ticker: string;
  company?: string | null;
  force?: boolean;
};

const inflight = new Map<string, Promise<UsProductRevenueLookupResult>>();
const memory = new Map<string, UsProductRevenueLookupResult>();

export function usProductRevenueCacheKey(body: Body): string {
  return String(body.ticker || "").trim().toUpperCase();
}

export function peekUsProductRevenueCache(
  body: Body,
): UsProductRevenueLookupResult | null {
  const key = usProductRevenueCacheKey(body);
  return key ? memory.get(key) ?? null : null;
}

export function prefetchUsProductRevenue(
  body: Body,
): Promise<UsProductRevenueLookupResult> {
  const key = usProductRevenueCacheKey(body);
  if (!key) {
    return Promise.resolve({ ok: false, error: "ticker required", products: [] });
  }
  if (!body.force) {
    const hit = memory.get(key);
    // Prefer a completed table; still allow re-poll while "building".
    if (hit && (hit.ok || (Array.isArray(hit.products) && hit.products.length))) {
      return Promise.resolve(hit);
    }
    if (hit && hit.error && hit.error !== "building") {
      return Promise.resolve(hit);
    }
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const p = lookupDeskUsProductRevenue(body)
    .then((res) => {
      memory.set(key, res);
      return res;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** Clear a ticker so the next Financial open can pick up a finished background build. */
export function invalidateUsProductRevenueCache(ticker: string): void {
  const key = String(ticker || "").trim().toUpperCase();
  if (!key) return;
  memory.delete(key);
  inflight.delete(key);
}
