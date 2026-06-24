import { fetchProjectJson } from "./projectData";

const SIGN_CURVE_DAILY_FILE = "model_sign_curve_daily.json";

export type SignCurveOffsetPoint = {
  offset?: number;
  label?: string;
  zone?: "pre_cd" | "post_cd";
  sign_hit_pct?: number | null;
  price_accuracy_pct?: number | null;
  /** @deprecated legacy error metric — use price_accuracy_pct */
  price_err_pct?: number | null;
  n?: number;
  n_price?: number;
};

export type SignCurveCohort = {
  label_it?: string;
  label_en?: string;
  n_events?: number;
  n_events_skipped?: number;
  by_offset?: SignCurveOffsetPoint[];
  overall_sign_hit_pct?: number | null;
  overall_sign_hit_pre_cd_pct?: number | null;
  overall_price_accuracy_pct?: number | null;
  overall_price_err_pct?: number | null;
  n_sessions?: number;
};

/** Legacy v2 point (backward compat). */
export type SignCurveDailyPoint = SignCurveOffsetPoint & {
  days_to_cd?: number;
  cal_offset_lo?: number;
  cal_offset_hi?: number;
  hit_pct?: number | null;
  mag_err_when_hit_pp?: number | null;
};

export type SignCurveDailyDoc = {
  schema_version?: number;
  generated_at?: string;
  window_calendar_days_pre_cd?: number;
  window_calendar_days_post_cd?: number;
  x_offsets?: number[];
  metric?: string;
  metric_sign?: string;
  metric_price?: string;
  definition_it?: string;
  definition_en?: string;
  n_events?: number;
  cohorts?: {
    retro?: SignCurveCohort;
    simulation?: SignCurveCohort;
  };
  overall?: {
    hit_pct?: number | null;
    hit_pct_pre_cd?: number | null;
    n_pairs?: number;
    mag_err_when_hit_pp?: number | null;
  };
  by_days_to_cd?: SignCurveDailyPoint[];
  by_week_bin?: SignCurveDailyPoint[];
  by_time_bin?: SignCurveDailyPoint[];
};

export async function loadSignCurveDailyDoc(): Promise<{
  doc: SignCurveDailyDoc | null;
  error?: string;
}> {
  const { data } = await fetchProjectJson<SignCurveDailyDoc>(SIGN_CURVE_DAILY_FILE);
  const retro = data?.cohorts?.retro?.by_offset?.length ?? 0;
  const legacy = data?.by_time_bin?.length ?? data?.by_week_bin?.length ?? 0;
  if (retro > 0 || legacy > 0 || data?.overall?.hit_pct != null) {
    return { doc: data };
  }
  return {
    doc: null,
    error: `File assente (${SIGN_CURVE_DAILY_FILE}). Esegui refresh orchestrator.`,
  };
}
