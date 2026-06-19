export type CdPatternPolygonTimelineRow = {
  window: string;
  window_id?: string;
  days_min: number;
  days_max: number;
  days_mid: number;
  n_samples: number;
  corr_match_stock?: number | null;
};

export type CdPatternPolygonOverview = {
  generated_at?: string;
  correlation_timeline?: CdPatternPolygonTimelineRow[];
  n_samples?: number;
  n_events?: number;
  effectiveness?: {
    mean_corr_match_stock?: number | null;
    bins_with_data?: number;
  };
  learning_history?: Array<{
    week?: string;
    date?: string;
    mean_corr_match_stock?: number | null;
    bins_with_data?: number;
    n_samples?: number;
    n_events?: number;
    by_window?: Record<string, number | null>;
  }>;
};

export type CdPatternPolygonTrendRow = {
  week: string;
  meanCorr: number | null;
  nSamples: number;
  nEvents: number;
};

export type CdPatternPolygonChartRow = {
  window: string;
  daysMid: number;
  daysLabel: string;
  corr: number | null;
  nSamples: number;
};

/** Minimum historic samples before ρ is used in P(recovery). */
export const CD_PATTERN_WINDOW_CORR_MIN_SAMPLES = 3;

export function parseCdPatternPolygonOverview(raw: unknown): CdPatternPolygonOverview | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as CdPatternPolygonOverview;
}

/**
 * Pearson ρ(match %, stock %) for the CD arc window — from Learning Lab
 * `cd_pattern_polygon.correlation_timeline`.
 */
export function resolveCdPatternWindowCorr(
  overview: CdPatternPolygonOverview | null | undefined,
  args: {
    daysToCd?: number | null;
    windowId?: string | null;
  },
): number | null {
  const timeline = overview?.correlation_timeline ?? [];
  if (!timeline.length) return null;

  let row: CdPatternPolygonTimelineRow | undefined;

  if (args.windowId) {
    row = timeline.find((r) => r.window_id === args.windowId);
  }

  if (!row && args.daysToCd != null && Number.isFinite(args.daysToCd)) {
    const d = Math.max(0, Math.round(args.daysToCd));
    row = timeline.find((r) => d >= r.days_min && d <= r.days_max);
  }

  if (!row) return null;
  if ((row.n_samples ?? 0) < CD_PATTERN_WINDOW_CORR_MIN_SAMPLES) return null;
  const corr = row.corr_match_stock;
  if (corr == null || !Number.isFinite(corr)) return null;
  return Math.max(-1, Math.min(1, corr));
}

export function buildCdPatternPolygonChartRows(
  overview: CdPatternPolygonOverview | null | undefined,
): CdPatternPolygonChartRow[] {
  const timeline = overview?.correlation_timeline ?? [];
  return timeline
    .map((r) => ({
      window: r.window,
      daysMid: r.days_mid,
      daysLabel: `${r.days_min}–${r.days_max}d`,
      corr: r.corr_match_stock ?? null,
      nSamples: r.n_samples ?? 0,
    }))
    .sort((a, b) => b.daysMid - a.daysMid);
}

export function buildCdPatternPolygonLearningTrend(
  overview: CdPatternPolygonOverview | null | undefined,
): CdPatternPolygonTrendRow[] {
  return (overview?.learning_history ?? []).map((h) => ({
    week: String(h.week ?? h.date ?? "").slice(5) || String(h.date ?? ""),
    meanCorr: h.mean_corr_match_stock ?? null,
    nSamples: h.n_samples ?? 0,
    nEvents: h.n_events ?? 0,
  }));
}
