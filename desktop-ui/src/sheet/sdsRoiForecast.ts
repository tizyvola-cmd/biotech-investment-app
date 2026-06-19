import { fetchProjectJson } from "../data/projectData";

export type SdsRoiHorizonKey = "pre_10" | "pre_5" | "post_4";

export type SdsRoiHorizonSummary = {
  n?: number;
  mae_pp?: number | null;
  median_abs_err_pp?: number | null;
  mean_signed_err_pp?: number | null;
  correlation_r?: number | null;
};

export type SdsRoiZoneHorizonSummary = {
  n?: number;
  mae_pp?: number | null;
  mean_signed_err_pp?: number | null;
};

export type SdsRoiBacktestScoresDoc = {
  generated_at?: string;
  methodology?: string;
  n_calibration_rows?: number;
  n_scored?: number;
  summary_by_horizon?: Partial<Record<SdsRoiHorizonKey, SdsRoiHorizonSummary>>;
  summary_by_sds_zone?: Partial<
    Record<"distant" | "watch" | "candidate" | "supernova", Partial<Record<SdsRoiHorizonKey, SdsRoiZoneHorizonSummary>>>
  >;
  sample_rows?: SdsRoiBacktestSampleRow[];
};

export type SdsRoiBacktestSampleRow = {
  key?: string;
  ticker?: string;
  completion_date?: string;
  profile?: string;
  sds?: number;
  predicted?: Partial<Record<SdsRoiHorizonKey, number | null>>;
  actual?: Partial<Record<SdsRoiHorizonKey, number | null>>;
  error_pp?: Partial<Record<SdsRoiHorizonKey, number | null>>;
};

export type SdsRoiForecastEvent = {
  key?: string;
  ticker?: string;
  completion_date?: string;
  snapshots?: Array<{
    captured_at?: string;
    sds?: number | null;
    predicted?: Partial<Record<SdsRoiHorizonKey, number | null>>;
    predicted_blend?: Partial<Record<SdsRoiHorizonKey, number | null>>;
    predicted_pred?: Partial<Record<SdsRoiHorizonKey, number | null>>;
    fit_pct?: number | null;
    best_profile?: string | null;
  }>;
  actual?: Partial<Record<SdsRoiHorizonKey, number | null>>;
  error_pp?: Partial<Record<SdsRoiHorizonKey, number | null>>;
  error_pp_blend?: Partial<Record<SdsRoiHorizonKey, number | null>>;
  error_pp_pred?: Partial<Record<SdsRoiHorizonKey, number | null>>;
  hit_blend?: Partial<Record<SdsRoiHorizonKey, boolean | null>>;
  hit_pred?: Partial<Record<SdsRoiHorizonKey, boolean | null>>;
  scored_at?: string | null;
};

export type SdsRoiBlendVsPredHorizonSummary = {
  n?: number;
  n_comparable?: number;
  mae_pred_pp?: number | null;
  mae_blend_pp?: number | null;
  blend_better_n?: number;
  blend_better_pct?: number | null;
  hit_rate_pred?: number | null;
  hit_rate_blend?: number | null;
  hit_n_pred?: number;
  hit_n_blend?: number;
};

export type SdsRoiForecastLogDoc = {
  updated_at?: string;
  forward_summary?: {
    n_tracked?: number;
    n_matured_scored?: number;
    n_pending?: number;
    by_horizon?: Partial<Record<SdsRoiHorizonKey, { n?: number; mae_pp?: number | null; median_abs_err_pp?: number | null }>>;
    blend_vs_pred?: {
      methodology?: string;
      by_horizon?: Partial<Record<SdsRoiHorizonKey, SdsRoiBlendVsPredHorizonSummary>>;
    };
  };
  events?: Record<string, SdsRoiForecastEvent>;
};

export type SdsSnapshotRow = {
  ticker?: string;
  completion_date?: string;
  sds?: number | null;
  sds_zone?: string;
  zone?: string;
  curve_roi?: {
    fit_pct?: number | null;
    best_profile?: string | null;
    horizons?: Partial<Record<SdsRoiHorizonKey, { pct_vs_m60?: number | null }>>;
    horizons_curve?: Partial<Record<SdsRoiHorizonKey, { pct_vs_m60?: number | null }>>;
    horizons_pred?: Partial<Record<SdsRoiHorizonKey, { pct_vs_m60?: number | null }>>;
  };
};

export type SdsSnapshotDoc = {
  generated_at?: string;
  n?: number;
  rows?: SdsSnapshotRow[];
  top_candidates?: SdsSnapshotRow[];
};

const BACKTEST_FILE = "sds_roi_backtest_scores.json";
const FORECAST_FILE = "sds_roi_forecast_log.json";
const SDS_SNAP_FILE = "sds_snapshot.json";

export async function loadSdsRoiBacktestScores(): Promise<SdsRoiBacktestScoresDoc | null> {
  const { data } = await fetchProjectJson<SdsRoiBacktestScoresDoc>(BACKTEST_FILE);
  return data;
}

export async function loadSdsRoiForecastLog(): Promise<SdsRoiForecastLogDoc | null> {
  const { data } = await fetchProjectJson<SdsRoiForecastLogDoc>(FORECAST_FILE);
  return data;
}

export async function loadSdsSnapshotDoc(): Promise<SdsSnapshotDoc | null> {
  const { data } = await fetchProjectJson<SdsSnapshotDoc>(SDS_SNAP_FILE);
  return data;
}

export function fmtPp(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)} pp`;
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function horizonLabel(hk: SdsRoiHorizonKey, it: boolean): string {
  if (hk === "pre_10") return it ? "T−10" : "T−10";
  if (hk === "pre_5") return it ? "T−5" : "T−5";
  return it ? "T+4" : "T+4";
}

export function errorTone(err: number | null | undefined): "green" | "amber" | "red" | "muted" {
  if (err == null || !Number.isFinite(err)) return "muted";
  const a = Math.abs(err);
  if (a <= 8) return "green";
  if (a <= 20) return "amber";
  return "red";
}

export function maeTone(mae: number | null | undefined): "green" | "amber" | "red" | "muted" {
  if (mae == null || !Number.isFinite(mae)) return "muted";
  if (mae <= 10) return "green";
  if (mae <= 20) return "amber";
  return "red";
}

export function errorRowBgClass(err: number | null | undefined): string {
  const tone = errorTone(err);
  if (tone === "green") return "bg-emerald-50/95";
  if (tone === "amber") return "bg-amber-50/95";
  if (tone === "red") return "bg-rose-50/95";
  return "bg-white/95";
}

export function roiPctColorClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "text-ink-muted";
  if (v >= 5) return "text-emerald-700 font-semibold";
  if (v <= -5) return "text-red-700 font-semibold";
  return "text-amber-800 font-medium";
}

export type QcStatusIcon = "good" | "warn" | "bad" | "wait";

export function qcStatusIcon(kind: QcStatusIcon): string {
  if (kind === "good") return "✓";
  if (kind === "warn") return "⚠";
  if (kind === "bad") return "✗";
  return "⏳";
}

export function qcStatusIconFromMae(mae: number | null | undefined): QcStatusIcon {
  const tone = maeTone(mae);
  if (tone === "green") return "good";
  if (tone === "amber") return "warn";
  if (tone === "red") return "bad";
  return "wait";
}

const MAE_BAR_FILL: Record<"green" | "amber" | "red" | "muted", string> = {
  green: "#059669",
  amber: "#d97706",
  red: "#dc2626",
  muted: "#94a3b8",
};

export function maeBarFill(mae: number | null | undefined): string {
  return MAE_BAR_FILL[maeTone(mae)];
}
