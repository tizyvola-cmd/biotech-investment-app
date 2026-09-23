/**
 * Shared client cache for Competition Gemini lookups so the search can start
 * when the product card mounts (not only when the accordion opens), and
 * remounts / Strict Mode do not duplicate in-flight calls.
 */
import {
  lookupDeskCompetitionLandscape,
  type CompetitionLandscapeResult,
} from "../api/supernova";

type Body = {
  ticker: string;
  product_name?: string | null;
  company?: string | null;
  indication?: string | null;
  nct_id?: string | null;
  force?: boolean;
};

const inflight = new Map<string, Promise<CompetitionLandscapeResult>>();
const memory = new Map<string, CompetitionLandscapeResult>();

export function competitionLandscapeCacheKey(body: Body): string {
  const tk = String(body.ticker || "").trim().toUpperCase();
  const pr = String(body.product_name || "").trim().toLowerCase();
  const ind = String(body.indication || "").trim().toLowerCase().slice(0, 80);
  const nct = String(body.nct_id || "").trim().toUpperCase();
  return `${tk}|${pr}|${ind}|${nct}`;
}

export function peekCompetitionLandscapeCache(
  body: Body,
): CompetitionLandscapeResult | null {
  return memory.get(competitionLandscapeCacheKey(body)) ?? null;
}

export function prefetchCompetitionLandscape(
  body: Body,
): Promise<CompetitionLandscapeResult> {
  const key = competitionLandscapeCacheKey(body);
  if (!body.force) {
    const hit = memory.get(key);
    if (hit) return Promise.resolve(hit);
    const pending = inflight.get(key);
    if (pending) return pending;
  }
  const p = lookupDeskCompetitionLandscape(body)
    .then((res) => {
      if (res?.ok && res.landscape) memory.set(key, res);
      return res;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}
