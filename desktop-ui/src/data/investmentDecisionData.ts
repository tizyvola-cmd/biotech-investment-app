import { api } from "../api/supernova";
import { desktopDataDirHint, fetchProjectJson } from "./projectData";

const COHORT_FILE = "investment_decision_cohort.json";

export type DecisionHorizonKey = "pre5" | "pre4" | "wide";

export type DecisionHorizonSpec = {
  key: DecisionHorizonKey | string;
  label: string;
  decision_offset_days?: number;
  horizon_days?: number;
  close_pair?: [string, string];
  model_pair?: [string, string];
  flat_band_pp?: number;
};

export type DecisionProtocol = {
  schema_version?: number;
  title?: string;
  decision_point?: string;
  outcome_window?: string;
  prediction_signal?: string;
  inclusion?: string[];
  metrics?: string[];
  limitations?: string[];
  // schema v2+: orizzonti rolling pre-CD
  default_horizon?: string;
  horizons?: DecisionHorizonSpec[];
};

export type DecisionHorizonRowMetrics = {
  pred_pp: number | null;
  realized_pp: number | null;
  direction_hit: boolean | null;
};

export type DecisionHorizonSummary = {
  n_events?: number;
  n_ic_pairs?: number;
  ic_spearman: number | null;
  hit_rate_pct: number | null;
  mean_r_hold_pp: number | null;
};

export type DecisionQuintile = {
  quintile: number;
  label: string;
  n: number;
  aff_min: number;
  aff_max: number;
  mean_r_hold_pp: number | null;
  hit_rate_pct: number | null;
};

export type DecisionSegment = {
  label: string;
  n_events: number;
  n_ic_pairs: number;
  ic_spearman: number | null;
  hit_rate_pct: number | null;
  mean_r_hold_pp: number | null;
  mean_pred_bias_pp: number | null;
};

export type DecisionSegmentGroup = {
  id: string;
  title: string;
  segments: DecisionSegment[];
};

export type DecisionCohortRow = {
  row_key: string;
  ticker: string;
  completion_date: string;
  sponsor_match?: string;
  phase?: string;
  affidabilita_pct: number | null;
  // Legacy (orizzonte WIDE T-7 → T+7)
  pred_forward_pp: number | null;
  realized_forward_pp: number | null;
  direction_hit: boolean | null;
  // schema v3+: metriche per ciascun orizzonte rolling pre-CD
  horizons?: Partial<Record<DecisionHorizonKey | string, DecisionHorizonRowMetrics>>;
  model_inferenza_affidabile?: boolean;
  run_up_30d?: number | null;
  dir_v4?: string;
  d5_pct_actual?: number | null;
  score_v4?: number | null;
};

export type DecisionEnvDiff = {
  key: string;
  before: unknown;
  after: unknown;
};

export type DecisionSummaryDelta = {
  ic_spearman?: number | null;
  hit_rate_pct?: number | null;
  mean_r_hold_pp?: number | null;
  n_events?: number | null;
};

export type DecisionSegmentDelta = {
  group_id: string;
  group_title?: string;
  label: string;
  n_ic_pairs?: number;
  ic_before?: number | null;
  ic_after?: number | null;
  delta_ic?: number | null;
  hit_before_pct?: number | null;
  hit_after_pct?: number | null;
  delta_hit_pct?: number | null;
};

export type DecisionCohortComparison = {
  previous_at?: string;
  current_at?: string;
  env_changed?: boolean;
  env_fingerprint_before?: string;
  env_fingerprint_after?: string;
  env_diff?: DecisionEnvDiff[];
  summary_before?: DecisionCohortDoc["summary"];
  summary_after?: DecisionCohortDoc["summary"];
  summary_delta?: DecisionSummaryDelta;
  segment_delta?: DecisionSegmentDelta[];
};

export type DecisionHistorySnapshot = {
  generated_at?: string;
  env_fingerprint?: string;
  summary?: DecisionCohortDoc["summary"];
};

export type DecisionCohortDoc = {
  schema_version?: number;
  generated_at?: string;
  source?: string;
  source_mtime?: string;
  env_snapshot?: Record<string, unknown>;
  env_fingerprint?: string;
  protocol?: DecisionProtocol;
  default_horizon?: string;
  summary?: {
    n_events?: number;
    n_ic_pairs?: number;
    ic_spearman?: number | null;
    hit_rate_pct?: number | null;
    mean_r_hold_pp?: number | null;
  };
  // schema v3+: KPI per ciascun orizzonte rolling
  summary_by_horizon?: Partial<Record<DecisionHorizonKey | string, DecisionHorizonSummary>>;
  comparison?: DecisionCohortComparison;
  history_tail?: DecisionHistorySnapshot[];
  quintiles?: DecisionQuintile[]; // legacy (WIDE)
  quintiles_by_horizon?: Partial<
    Record<DecisionHorizonKey | string, DecisionQuintile[]>
  >; // schema v3+
  segment_groups?: DecisionSegmentGroup[];
  rows?: DecisionCohortRow[];
  error?: string;
};

export async function loadInvestmentDecisionCohort(): Promise<{
  doc: DecisionCohortDoc | null;
  source: string;
  error?: string;
}> {
  const { data, detail } = await fetchProjectJson<DecisionCohortDoc>(COHORT_FILE);
  if (data && Array.isArray(data.rows)) {
    return { doc: data, source: `locale (${COHORT_FILE})` };
  }

  try {
    const res = await api<DecisionCohortDoc & { error?: string }>("/api/investment/decision-cohort");
    if (Array.isArray(res.rows)) {
      return { doc: res, source: "API /api/investment/decision-cohort" };
    }
    if (res.error) {
      return { doc: null, source: "", error: res.error };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      doc: null,
      source: "",
      error: `${msg} — genera il cohort con scripts/investment_decision_cohort.py. Cartella: ${desktopDataDirHint()}`,
    };
  }

  return {
    doc: null,
    source: "",
    error:
      detail ||
      `File assente (${COHORT_FILE}). Esegui: python scripts/investment_decision_cohort.py`,
  };
}
