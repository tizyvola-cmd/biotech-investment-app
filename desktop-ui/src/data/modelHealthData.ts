import { api } from "../api/supernova";
import { fetchProjectJson } from "./projectData";
import type { MarketContextDoc } from "../sheet/marketContextGate";

export type FeedbackCalChange = {
  ticker: string;
  old_cal: number;
  new_cal: number;
  reason: string;
};

export type FeedbackSummary = {
  version?: number;
  updated_at?: string;
  portfolio_avg_mae?: number | null;
  portfolio_direction_acc?: number | null;
  underperformers?: string[];
  strong_performers?: string[];
  bias_flags?: string[];
  direction_suspended?: string[];
  cal_factor_changes?: FeedbackCalChange[];
  n_tickers?: number;
};

export type TickerPerformanceRow = {
  persistent_mae?: number | null;
  direction_acc?: number | null;
  bias?: number | null;
  cal_factor?: number;
  flag?: string;
  last_updated?: string;
  bias_correction_pp?: number;
  direction_live_suppressed?: boolean;
};

export type FeedbackPreviewResult = {
  ok?: boolean;
  dry_run?: boolean;
  run_at?: string;
  ticker_performance?: Record<string, TickerPerformanceRow>;
  summary?: FeedbackSummary;
  cal_factor_changes?: FeedbackCalChange[];
};

export async function loadMarketContext(): Promise<{
  doc: MarketContextDoc | null;
  error?: string;
}> {
  try {
    const res = await api<MarketContextDoc>("/api/market/context");
    return { doc: res };
  } catch {
    const local = await fetchProjectJson<MarketContextDoc>("market_context.json");
    return { doc: local.data, error: local.detail };
  }
}

export async function runMarketContextGate(): Promise<MarketContextDoc | null> {
  try {
    return await api<MarketContextDoc>("/api/market/context/run", { method: "POST" });
  } catch {
    return null;
  }
}

export async function loadFeedbackSummary(): Promise<{
  summary: FeedbackSummary | null;
  history: Array<{ run_at?: string; summary?: FeedbackSummary }>;
  error?: string;
}> {
  try {
    const res = await api<{
      summary?: FeedbackSummary | null;
      history?: Array<{ run_at?: string; summary?: FeedbackSummary }>;
    }>("/api/models/feedback-loop/summary");
    return {
      summary: res.summary ?? null,
      history: res.history ?? [],
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const [sumRes, histRes] = await Promise.all([
      fetchProjectJson<{ tickers?: Record<string, TickerPerformanceRow> }>("feedback_summary.json"),
      fetchProjectJson<{ weeks?: Array<{ run_at?: string; summary?: FeedbackSummary }> }>(
        "feedback_history.json",
      ),
    ]);
    return {
      summary: (sumRes.data as FeedbackSummary | null) ?? null,
      history: histRes.data?.weeks ?? [],
      error: msg,
    };
  }
}

export async function loadTickerPerformance(): Promise<Record<string, TickerPerformanceRow>> {
  try {
    const res = await api<{ tickers?: Record<string, TickerPerformanceRow> }>(
      "/api/models/feedback-loop/ticker-performance",
    );
    if (res.tickers) return res.tickers;
    return res as unknown as Record<string, TickerPerformanceRow>;
  } catch {
    const local = await fetchProjectJson<{ tickers?: Record<string, TickerPerformanceRow> }>(
      "ticker_performance.json",
    );
    return local.data?.tickers ?? {};
  }
}

function isMethodNotAllowed(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("405") || /method not allowed/i.test(msg);
}

export async function previewFeedbackLoop(): Promise<FeedbackPreviewResult> {
  try {
    return await api<FeedbackPreviewResult>("/api/models/feedback-loop/preview", {
      method: "POST",
    });
  } catch (e) {
    if (!isMethodNotAllowed(e)) throw e;
    return api<FeedbackPreviewResult>("/api/models/feedback-loop/preview");
  }
}

export async function applyFeedbackLoop(): Promise<FeedbackPreviewResult> {
  return api<FeedbackPreviewResult>("/api/models/feedback-loop/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: true }),
  });
}
