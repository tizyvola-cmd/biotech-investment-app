export type EisSuperScoreTimelineRow = {
  window: string;
  days_min: number;
  days_max: number | null;
  days_mid: number;
  n_events: number;
  n_price_1d?: number;
  n_price_7d?: number;
  corr_raw_1d?: number | null;
  corr_super_1d?: number | null;
  corr_raw_7d?: number | null;
  corr_super_7d?: number | null;
  lift_1d?: number | null;
  lift_7d?: number | null;
  cal_factor?: number | null;
};

export type EisSuperScoreOverview = {
  generated_at?: string;
  global_score_blend?: number;
  learned_blend?: number;
  windows?: Record<string, { cal_factor?: number; n_samples?: number }>;
  correlation_timeline?: EisSuperScoreTimelineRow[];
  effectiveness?: {
    mean_corr_raw_7d?: number | null;
    mean_corr_super_7d?: number | null;
    mean_lift_7d?: number | null;
    bins_with_data_7d?: number;
  };
  learning_history?: Array<{
    week?: string;
    date?: string;
    mean_corr_raw_7d?: number | null;
    mean_corr_super_7d?: number | null;
    mean_lift_7d?: number | null;
  }>;
  n_events_scored?: number;
};

export type EisSuperScoreChartRow = {
  window: string;
  daysMid: number;
  daysLabel: string;
  corrRaw1d: number | null;
  corrSuper1d: number | null;
  corrRaw7d: number | null;
  corrSuper7d: number | null;
  lift7d: number | null;
  nEvents: number;
  nPrice7d: number;
  calFactor: number | null;
};

export function buildEisSuperScoreChartRows(
  overview: EisSuperScoreOverview | null | undefined,
): EisSuperScoreChartRow[] {
  const timeline = overview?.correlation_timeline ?? [];
  return timeline
    .map((r) => ({
      window: r.window,
      daysMid: r.days_mid,
      daysLabel: r.days_max != null ? `${r.days_min}–${r.days_max}d` : `${r.days_min}d+`,
      corrRaw1d: r.corr_raw_1d ?? null,
      corrSuper1d: r.corr_super_1d ?? null,
      corrRaw7d: r.corr_raw_7d ?? null,
      corrSuper7d: r.corr_super_7d ?? null,
      lift7d: r.lift_7d ?? null,
      nEvents: r.n_events ?? 0,
      nPrice7d: r.n_price_7d ?? 0,
      calFactor: r.cal_factor ?? null,
    }))
    .sort((a, b) => b.daysMid - a.daysMid);
}

export function buildEisSuperScoreLearningTrend(
  overview: EisSuperScoreOverview | null | undefined,
): Array<{ week: string; raw7d: number | null; super7d: number | null; lift: number | null }> {
  return (overview?.learning_history ?? []).map((h) => ({
    week: String(h.week ?? h.date ?? "").slice(5, 10) || String(h.date ?? ""),
    raw7d: h.mean_corr_raw_7d ?? null,
    super7d: h.mean_corr_super_7d ?? null,
    lift: h.mean_lift_7d ?? null,
  }));
}
