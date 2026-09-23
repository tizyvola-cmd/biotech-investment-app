import { useEffect, useState } from "react";
import type { DailyNewsBrief } from "../api/supernova";
import {
  peekPrefetchedDailyNewsBrief,
  prefetchDailyNewsBrief,
  rememberPrefetchedDailyNewsBrief,
} from "../sheet/dailyNewsBriefPrefetch";

export type InvestorArticleBriefInput = {
  title?: string | null;
  url?: string | null;
  summary?: string | null;
  ticker?: string | null;
  id?: string | null;
  /** Skip fetch when false (e.g. modal closed). */
  enabled?: boolean;
};

/**
 * Same Daily News investor digest (`brief_daily_news_item` / `_build_investor_digest`)
 * for EIS Deep Dive and feed “read full” — fetches page when URL is present.
 * Shares the Daily News modal prefetch cache when the same article was warmed.
 */
export function useInvestorArticleBrief(input: InvestorArticleBriefInput): {
  brief: DailyNewsBrief | null;
  busy: boolean;
  error: string | null;
} {
  const enabled = input.enabled !== false;
  const title = (input.title || "").trim();
  const url = (input.url || "").trim();
  const summary = (input.summary || "").trim();
  const ticker = (input.ticker || "").trim().toUpperCase();
  const id = (input.id || "").trim();

  const item = {
    id: id || undefined,
    title: title || undefined,
    summary: summary || undefined,
    ticker: ticker || undefined,
    link: url || undefined,
    resolved_link: url || undefined,
  };

  const [brief, setBrief] = useState<DailyNewsBrief | null>(() =>
    enabled ? peekPrefetchedDailyNewsBrief(item) : null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!title && !url && !summary) return;

    let cancelled = false;
    const warm = peekPrefetchedDailyNewsBrief(item);
    if (warm) {
      setBrief(warm);
      setBusy(false);
      setError(null);
    } else {
      setBusy(true);
      setError(null);
    }
    void prefetchDailyNewsBrief(item)
      .then((next) => {
        if (cancelled) return;
        if (next) {
          rememberPrefetchedDailyNewsBrief(item, next);
          setBrief(next);
          return;
        }
        if (!warm) setError("Could not build the brief.");
      })
      .catch((e) => {
        if (cancelled) return;
        if (!warm) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key fields listed
  }, [enabled, title, url, summary, ticker, id]);

  return { brief, busy, error };
}
