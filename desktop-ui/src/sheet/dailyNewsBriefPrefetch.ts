/**
 * Client-side Daily News brief warm cache.
 * Server also prefetches as soon as headlines land; this covers rows already
 * on the desk and shares in-flight POSTs so open-modal does not start a
 * second fetch.
 */
import {
  briefDailyNewsItem,
  type DailyNewsBrief,
  type DailyNewsHighlight,
} from "../api/supernova";

type BriefItem = Pick<
  DailyNewsHighlight,
  "id" | "title" | "summary" | "ticker" | "link" | "resolved_link" | "gnews_link"
> & {
  /** Server already warmed this brief — seed client cache without a round-trip. */
  cached_brief?: DailyNewsBrief | null;
};

const cache = new Map<string, DailyNewsBrief>();
const inflight = new Map<string, Promise<DailyNewsBrief | null>>();

function firstHttpUrl(...blobs: Array<string | null | undefined>): string {
  for (const b of blobs) {
    const s = String(b || "").trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return "";
}

export function dailyNewsBriefPrefetchKey(item: BriefItem): string {
  const id = String(item.id || "").trim();
  if (id) return `id:${id}`;
  const url = firstHttpUrl(item.resolved_link, item.link, item.gnews_link);
  const title = String(item.title || "").trim().toLowerCase();
  const tk = String(item.ticker || "").trim().toUpperCase();
  return `fp:${tk}|${title.slice(0, 120)}|${url.slice(0, 160)}`;
}

export function peekPrefetchedDailyNewsBrief(item: BriefItem): DailyNewsBrief | null {
  return cache.get(dailyNewsBriefPrefetchKey(item)) ?? null;
}

export function rememberPrefetchedDailyNewsBrief(
  item: BriefItem,
  brief: DailyNewsBrief,
): void {
  cache.set(dailyNewsBriefPrefetchKey(item), brief);
}

/** Seed from desk payload when the API already attached a warmed brief. */
export function seedPrefetchedDailyNewsBriefsFromDesk(items: BriefItem[]): number {
  let n = 0;
  for (const item of items) {
    const brief = item.cached_brief;
    if (!brief || typeof brief !== "object") continue;
    if (!String(item.title || "").trim() && !String(item.id || "").trim()) continue;
    rememberPrefetchedDailyNewsBrief(item, brief);
    n += 1;
  }
  return n;
}

export function prefetchDailyNewsBrief(item: BriefItem): Promise<DailyNewsBrief | null> {
  const key = dailyNewsBriefPrefetchKey(item);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  if (item.cached_brief && typeof item.cached_brief === "object") {
    cache.set(key, item.cached_brief);
    return Promise.resolve(item.cached_brief);
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const url =
    firstHttpUrl(item.resolved_link, item.link) ||
    item.gnews_link ||
    item.link ||
    undefined;
  const p = briefDailyNewsItem({
    title: item.title,
    url,
    summary: item.summary,
    ticker: item.ticker,
    id: item.id,
  })
    .then((res) => {
      if (res.ok && res.brief) {
        cache.set(key, res.brief);
        return res.brief;
      }
      return null;
    })
    .catch((err) => {
      // Don't swallow aborts — callers show a timeout message instead of
      // the generic "Could not build the brief."
      if (
        err instanceof DOMException &&
        (err.name === "AbortError" || err.name === "TimeoutError")
      ) {
        throw err;
      }
      if (err instanceof Error && /abort|timed out|timeout/i.test(err.message)) {
        throw err;
      }
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/**
 * Warm briefs as soon as desk rows appear (not on first modal open).
 * Starts immediately with limited parallelism — same pattern as Competition /
 * Product Revenue mount prefetch.
 */
export function prefetchDailyNewsBriefsIdle(
  items: BriefItem[],
  maxItems = 10,
  concurrency = 2,
): () => void {
  let cancelled = false;
  const list = items
    .filter((it) => Boolean(String(it.title || "").trim()))
    .slice(0, maxItems);

  seedPrefetchedDailyNewsBriefsFromDesk(list);

  const run = async () => {
    let idx = 0;
    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (!cancelled) {
        const i = idx++;
        if (i >= list.length) return;
        const item = list[i];
        if (peekPrefetchedDailyNewsBrief(item)) continue;
        try {
          await prefetchDailyNewsBrief(item);
        } catch {
          // Leave miss for modal open / next pass.
        }
      }
    });
    await Promise.all(workers);
  };

  // Start on next microtask so the desk paint is not blocked by the first POST.
  const timeoutId = window.setTimeout(() => {
    void run();
  }, 0);

  return () => {
    cancelled = true;
    window.clearTimeout(timeoutId);
  };
}
