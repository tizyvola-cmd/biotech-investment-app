import { api } from "../api/supernova";
import type { SheetTable } from "../types";
import { fetchProjectJson } from "./projectData";

const USEFUL_AFFID = 50;
const USEFUL_PRED5 = 2;
const STRONG_PRED5 = 3;

const CALIB_FILE = "signal_calibration.json";

export type SignalCohortStats = {
  n?: number;
  hits?: number;
  hit_pct?: number | null;
  avg_pred5?: number | null;
  avg_actual_5d?: number | null;
};

export type SignalWeeklyRow = {
  week_key: string;
  n?: number;
  hit_pct?: number | null;
  avg_pred5?: number | null;
  avg_actual_5d?: number | null;
};

export type CurveImpactChartPoint = {
  n?: number;
  day?: string | null;
  ticker?: string;
  sample_kind?: "historic" | "eis";
  enriched_at?: string | null;
  eis_shift_pp?: number | null;
  cum_mae_base?: number;
  cum_mae_daily?: number;
  cum_mae_k8?: number;
  cum_mae_eis?: number;
  cum_mae_pre_eis?: number;
  cum_mae_raw?: number;
  cum_mae_k8_historic?: number;
  cum_mae_raw_eis?: number;
  cum_mae_realized?: number;
  /** Legacy alias for daily close recalib */
  cum_mae_recalib?: number;
  cum_hit_base_pct?: number;
  cum_hit_daily_pct?: number;
  cum_hit_k8_pct?: number;
  cum_hit_eis_pct?: number;
  cum_hit_pre_eis_pct?: number;
  cum_hit_raw_pct?: number;
  cum_hit_k8_historic_pct?: number;
  cum_hit_raw_eis_pct?: number;
  cum_hit_realized_pct?: number;
  /** Legacy alias */
  cum_hit_recalib_pct?: number;
};

export type CurveImpactSummary = {
  mae_base_pp?: number | null;
  mae_daily_pp?: number | null;
  mae_k8_pp?: number | null;
  mae_eis_pp?: number | null;
  /** Legacy alias */
  mae_recalib_pp?: number | null;
  hit_base_pct?: number | null;
  hit_daily_pct?: number | null;
  hit_k8_pct?: number | null;
  hit_eis_pct?: number | null;
  /** Legacy alias */
  hit_recalib_pct?: number | null;
  mae_realized_pp?: number | null;
  hit_realized_pct?: number | null;
  delta_mae_daily_vs_base_pp?: number | null;
  delta_mae_k8_vs_daily_pp?: number | null;
  delta_mae_eis_vs_k8_pp?: number | null;
  /** Legacy aliases */
  delta_mae_recalib_vs_base_pp?: number | null;
  delta_mae_eis_vs_recalib_pp?: number | null;
};

export type EisRegressionStats = {
  n?: number;
  slope?: number | null;
  intercept?: number | null;
  r?: number | null;
  line?: { x: number; y: number }[];
};

export type EisScatterPoint = {
  x: number;
  y: number;
  window?: string;
  ticker?: string;
};

export type EisScatterBundle = {
  points?: EisScatterPoint[];
  regression?: EisRegressionStats;
  n_total?: number;
};

export type EisTemporalRegressionRow = {
  window?: string;
  days_min?: number;
  days_max?: number | null;
  n_events?: number;
  regression_1d?: EisRegressionStats;
  regression_7d?: EisRegressionStats;
  n_with_price_1d?: number;
  n_with_price_7d?: number;
};

export type EisPriceCohortStats = {
  n?: number;
  n_with_price?: number;
  avg_move_pp?: number | null;
  median_move_pp?: number | null;
  pct_positive?: number | null;
};

export type EisTemporalWindowRow = {
  window?: string;
  days_min?: number;
  days_max?: number | null;
  n_events?: number;
  n_with_price?: number;
  split_threshold?: number | null;
  low_eis?: EisPriceCohortStats;
  high_eis?: EisPriceCohortStats;
  high_minus_low_avg_pp?: number | null;
  pearson_eis_vs_d3?: number | null;
  spearman_eis_vs_d3?: number | null;
};

export type EisTemporalSignSplitRow = {
  window?: string;
  days_min?: number;
  days_max?: number | null;
  n_events?: number;
  negative_eis_1d?: EisPriceCohortStats;
  positive_eis_1d?: EisPriceCohortStats;
  negative_eis_7d?: EisPriceCohortStats;
  positive_eis_7d?: EisPriceCohortStats;
  pos_minus_neg_avg_1d?: number | null;
  pos_minus_neg_avg_7d?: number | null;
};

export type EisExpectedMoveAnchor = {
  eis: number;
  expected_pp: number;
  label?: string;
};

export type EisExpectedMoveHorizonCurve = {
  horizon_key?: string;
  horizon_label?: string;
  slope_pp_per_eis?: number | null;
  intercept_pp?: number | null;
  pearson_r?: number | null;
  n?: number;
  eis_observed_min?: number;
  eis_observed_max?: number;
  eis_median?: number;
  formula?: string;
  line?: { eis: number; expected_pp: number }[];
  anchors?: EisExpectedMoveAnchor[];
};

export type EisExpectedMoveCalibrationDoc = {
  built_from?: string;
  horizons?: {
    t1?: EisExpectedMoveHorizonCurve;
    t7?: EisExpectedMoveHorizonCurve;
  };
};

export type EisMagnitudeAnalysisDoc = {
  schema_version?: number;
  built_at?: string;
  scope?: string;
  n_events_scored?: number;
  n_with_price_1d?: number;
  n_with_price_3d?: number;
  n_with_price_7d?: number;
  split?: {
    method?: string;
    threshold?: number | null;
    low_eis?: EisPriceCohortStats;
    high_eis?: EisPriceCohortStats;
    high_minus_low_avg_d3_pp?: number | null;
    high_minus_low_positive_rate_pp?: number | null;
  };
  sign_split?: {
    negative_eis?: EisPriceCohortStats;
    positive_eis?: EisPriceCohortStats;
  };
  correlation?: {
    price_horizon?: string;
    price_horizon_short?: string;
    price_horizon_week?: string;
    pearson_eis_vs_delta_p_3d?: number | null;
    spearman_eis_vs_delta_p_3d?: number | null;
    pearson_eis_vs_delta_p_1d?: number | null;
    pearson_eis_vs_delta_p_7d?: number | null;
    regression_1d?: EisRegressionStats;
    regression_7d?: EisRegressionStats;
    n_3d?: number;
    n_1d?: number;
    n_7d?: number;
  };
  temporal_radius?: EisTemporalWindowRow[];
  temporal_regression?: EisTemporalRegressionRow[];
  temporal_sign_split?: EisTemporalSignSplitRow[];
  scatter?: {
    delta_p_1d?: EisScatterBundle;
    delta_p_7d?: EisScatterBundle;
  };
  expected_move_calibration?: EisExpectedMoveCalibrationDoc;
  peak_window?: (EisTemporalWindowRow & {
    horizon?: string;
    pearson_r?: number | null;
    slope_pp_per_eis?: number | null;
    days_min?: number;
    days_max?: number | null;
  }) | null;
  error?: string;
};

export type CurveImpactCumulative = {
  metric?: string;
  horizon_label?: string;
  pipeline_order?: string;
  n_events?: number;
  n_enriched_events?: number;
  n_with_eis_data?: number;
  n_new_sim_events_since_last?: number;
  n_new_eis_events_since_last?: number;
  data_source?: string;
  accumulation_mode?: string;
  n_simulation_events?: number;
  n_events_total?: number;
  n_with_seq_curve?: number;
  n_with_chart_bundle?: number;
  n_with_row_cal_factor?: number;
  n_with_eis_shift?: number;
  n_with_k8_delta?: number;
  n_with_path_curve?: number;
  /** @deprecated use n_with_k8_delta */
  n_with_k8_knots?: number;
  recalib_mode?: string;
  recalib_schedule?: number[];
  path_offsets?: number[];
  ai_feed_records?: number;
  clinical_feed_records?: number;
  cal_factor_default?: number;
  chart_series?: CurveImpactChartPoint[];
  enrichment_chart_series?: CurveImpactChartPoint[];
  summary?: CurveImpactSummary;
  enrichment_summary?: {
    n_events?: number;
    mae_raw_pp?: number | null;
    mae_k8_historic_pp?: number | null;
    mae_raw_eis_pp?: number | null;
    hit_raw_pct?: number | null;
    hit_k8_historic_pct?: number | null;
    hit_raw_eis_pct?: number | null;
    delta_mae_k8_vs_raw_pp?: number | null;
    delta_mae_raw_eis_vs_raw_pp?: number | null;
    /** Legacy aliases */
    mae_pre_eis_pp?: number | null;
    mae_eis_pp?: number | null;
    hit_pre_eis_pct?: number | null;
    hit_eis_pct?: number | null;
    delta_mae_eis_vs_pre_eis_pp?: number | null;
    mae_base_pp?: number | null;
    delta_mae_eis_vs_base_pp?: number | null;
  };
  chart_series_kind?: string;
  enrichment_chart_series_kind?: string;
  eis_magnitude_analysis?: EisMagnitudeAnalysisDoc;
  eis_cohort_comparison?: {
    with_eis?: {
      n?: number;
      n_sign_eval?: number;
      price_accuracy_pct?: number | null;
      sign_hit_pct?: number | null;
      avg_path_rmse_pp?: number | null;
    };
    without_eis?: {
      n?: number;
      n_sign_eval?: number;
      price_accuracy_pct?: number | null;
      sign_hit_pct?: number | null;
      avg_path_rmse_pp?: number | null;
    };
    delta_with_minus_without?: {
      price_accuracy_pp?: number | null;
      sign_hit_pp?: number | null;
    };
    with_eis_after_adjustment?: {
      n?: number;
      n_sign_eval?: number;
      price_accuracy_pct?: number | null;
      sign_hit_pct?: number | null;
    };
    eis_adjustment_lift?: {
      price_accuracy_pp?: number | null;
      sign_hit_pp?: number | null;
    };
  };
  error?: string;
};

export type SignalScatterPoint = {
  ticker?: string;
  pred5_pp?: number | null;
  actual_5d_pct?: number | null;
  hit?: boolean | null;
  affid?: number | null;
  log_date?: string | null;
};

export type SignalLiveRow = {
  ticker?: string;
  cd_date?: string | null;
  days_to_cd?: number | null;
  direction?: string;
  pred5_pp?: number | null;
  affid?: number | null;
  price_t0?: number | null;
  signal_emitted?: boolean;
  signal_tier?: string;
  actual_5d_pct?: number | null;
  hit?: boolean | null;
  log_date?: string | null;
};

export type SignalCalibrationDoc = {
  generated_at?: string;
  schema_version?: number;
  log_rows?: number;
  closed_rows?: number;
  pending_outcomes?: number;
  filters?: {
    useful?: { affid_min?: number; pred5_abs_min?: number };
    strong?: { affid_min?: number; pred5_abs_min?: number };
  };
  cohorts?: {
    raw?: SignalCohortStats;
    useful?: SignalCohortStats;
    strong?: SignalCohortStats;
  };
  weekly_actionable?: SignalWeeklyRow[];
  scatter_pred5_vs_actual?: SignalScatterPoint[];
  live_latest?: SignalLiveRow[];
  curve_impact_cumulative?: CurveImpactCumulative;
};

function colMatch(columns: string[], ...keywords: string[]): string | undefined {
  for (const kw of keywords) {
    const lo = kw.toLowerCase();
    const hit = columns.find((c) => c.toLowerCase().includes(lo));
    if (hit) return hit;
  }
  return undefined;
}

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".").replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

function classifySignal(
  direction: string,
  affid: number,
  pred5: number,
): { emitted: boolean; tier: string } {
  const d = direction.toLowerCase();
  if (d !== "up" && d !== "down") return { emitted: false, tier: "neutral" };
  if (affid < USEFUL_AFFID || Math.abs(pred5) < USEFUL_PRED5) return { emitted: false, tier: "weak" };
  if (Math.abs(pred5) >= STRONG_PRED5) return { emitted: true, tier: "strong" };
  return { emitted: true, tier: "useful" };
}

/** Anteprima da Simulation quando l'audit log non è ancora popolato. */
export function liveSignalRowsFromSimulation(simTable: SheetTable | null): SignalLiveRow[] {
  if (!simTable?.rows?.length) return [];
  const cols = simTable.columns ?? [];
  const tickerCol = colMatch(cols, "Ticker") ?? "Ticker";
  const affCol = colMatch(cols, "Affidabilit");
  const predCol = colMatch(cols, "Pred empirica", "pred5_live");
  const dirCol = colMatch(cols, "direction_live");
  const daysCol = colMatch(cols, "days_to_cd", "Giorni");
  const cdCol = colMatch(cols, "Completion Date", "completion");

  const out: SignalLiveRow[] = [];
  for (const row of simTable.rows) {
    const ticker = String(row[tickerCol] ?? "").trim().toUpperCase();
    if (!ticker || ticker.startsWith("TOTALE")) continue;

    let affid = toNum(affCol ? row[affCol] : null);
    if (affid != null && affid > 0 && affid <= 1) affid = Math.round(affid * 100);

    let pred5 = toNum(predCol ? row[predCol] : null);
    if (pred5 != null && Math.abs(pred5) <= 1.5) pred5 = pred5 * 100;

    let direction = dirCol ? String(row[dirCol] ?? "").toLowerCase() : "";
    if (!direction && pred5 != null) {
      direction = pred5 > 0.1 ? "up" : pred5 < -0.1 ? "down" : "neutral";
    }

    const days = daysCol ? toNum(row[daysCol]) : null;
    const { emitted, tier } = classifySignal(direction, affid ?? 0, pred5 ?? 0);

    out.push({
      ticker,
      cd_date: cdCol ? String(row[cdCol] ?? "") : null,
      days_to_cd: days != null ? Math.round(days) : null,
      direction,
      pred5_pp: pred5,
      affid: affid != null ? Math.round(affid) : null,
      signal_emitted: emitted,
      signal_tier: tier,
    });
  }
  return out.sort((a, b) => (a.days_to_cd ?? 999) - (b.days_to_cd ?? 999));
}

export async function loadSignalCalibration(): Promise<{
  doc: SignalCalibrationDoc | null;
  error?: string;
}> {
  const { data, detail } = await fetchProjectJson<SignalCalibrationDoc>(CALIB_FILE);
  if (data && (data.log_rows != null || data.cohorts || data.live_latest?.length)) {
    return { doc: data };
  }
  try {
    const res = await api<SignalCalibrationDoc>("/api/models/signal-calibration");
    if (res && (res.log_rows != null || res.cohorts || res.live_latest)) {
      return { doc: res };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { doc: null, error: msg };
  }
  return {
    doc: { schema_version: 1, log_rows: 0, cohorts: {}, weekly_actionable: [], scatter_pred5_vs_actual: [] },
    error: detail ?? undefined,
  };
}

export type LiveSignalsRefreshStatus = {
  running?: boolean;
  state?: string;
  ok?: boolean;
  message?: string;
};

export async function fetchLiveSignalsStatus(): Promise<LiveSignalsRefreshStatus> {
  try {
    return await api<LiveSignalsRefreshStatus>("/api/refresh/live-signals/status");
  } catch {
    return {};
  }
}

export async function rebuildSignalCalibration(): Promise<{
  ok: boolean;
  closed?: number;
  error?: string;
}> {
  try {
    const res = await api<{ ok?: boolean; closed?: number; error?: string }>(
      "/api/models/signal-calibration/rebuild",
      { method: "POST" },
    );
    return { ok: Boolean(res.ok), closed: res.closed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
