import { api } from "../api/supernova";

export type NodeMetric = {
  node: string;
  offset: number;
  mae: number | null;
  rmse: number | null;
  direction_accuracy: number | null;
  bias: number | null;
  coverage: number | null;
  n_samples: number;
  insufficient_data?: boolean;
  mock?: boolean;
  best_cases?: { ticker: string; cd_date: string; pred_pct: number; actual_pct: number; error: number }[];
  worst_cases?: { ticker: string; cd_date: string; pred_pct: number; actual_pct: number; error: number }[];
};

export type EvaluationResults = {
  generated_at?: string;
  saved_as_baseline_at?: string;
  baseline_label?: string;
  source?: string;
  lookback_cds?: number;
  node_accuracy?: {
    total_tickers?: number;
    decision_offset_cal?: number;
    methodology_note?: string;
    mock_fallback?: boolean;
    mock_reason?: string;
    nodes: NodeMetric[];
  };
  layer_deltas?: {
    nodes: Record<
      string,
      {
        layer: string;
        node: string;
        mae: number | null;
        direction_accuracy: number | null;
        n_samples: number;
        delta_mae_vs_base: number | null;
        delta_dir_acc_vs_base: number | null;
      }[]
    >;
  };
  slope_signals?: {
    signals: {
      signal: string;
      horizon_trading_days: number;
      direction_accuracy: number | null;
      mae_pct: number | null;
      false_positive_rate: number | null;
      false_negative_rate: number | null;
      n_samples: number;
    }[];
    rotation_veto: Record<string, unknown>;
  };
  up_filter?: {
    before: { up_signals: number; direction_accuracy: number | null };
    after_filter: {
      up_signals: number;
      suppressed: number;
      suppression_rate: number | null;
      direction_accuracy: number | null;
    };
    gate_conditions?: string[];
    subset_note?: string;
  };
  worst_cases?: { ticker: string; cd_date: string; mean_abs_error: number; nodes_evaluated: number }[];
  expected_u_shape?: string;
};

export type EvalLookbackOption = 10 | 50 | 0;

export const EVAL_LOOKBACK_OPTIONS: { value: EvalLookbackOption; label: string; hint: string }[] = [
  { value: 10, label: "10 CD", hint: "Ultimi 10 CD per ticker — veloce" },
  { value: 50, label: "50 CD", hint: "Coorte media" },
  { value: 0, label: "Tutti", hint: "Tutti i past catalyst (più lento)" },
];

export type EvalComparison = {
  baseline_at?: string;
  baseline_label?: string;
  current_at?: string;
  lookback_baseline?: number;
  lookback_current?: number;
  warning?: string | null;
  interpretation?: string;
  summary?: {
    mae_t5_delta?: number | null;
    dir_t5_delta_pp?: number | null;
    slope5_dir_delta_pp?: number | null;
    seq_delta_mae_vs_base_change?: number | null;
  };
  nodes?: {
    node: string;
    mae_current?: number | null;
    mae_baseline?: number | null;
    mae_delta?: number | null;
    dir_acc_delta_pp?: number | null;
  }[];
  layers_t5?: {
    layer: string;
    delta_mae_vs_base_change?: number | null;
    delta_dir_change_pp?: number | null;
  }[];
  slopes?: {
    signal: string;
    dir_acc_delta_pp?: number | null;
  }[];
};

const LOOKBACK_STORAGE_KEY = "supernova_eval_lookback";

export function loadEvalLookbackPreference(): EvalLookbackOption {
  if (typeof window === "undefined") return 10;
  try {
    const raw = localStorage.getItem(LOOKBACK_STORAGE_KEY);
    if (raw === "0" || raw === "50") return Number(raw) as EvalLookbackOption;
  } catch {
    /* ignore */
  }
  return 10;
}

export function saveEvalLookbackPreference(v: EvalLookbackOption): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOOKBACK_STORAGE_KEY, String(v));
}

export async function loadEvaluationResults(): Promise<EvaluationResults> {
  return api<EvaluationResults>("/api/evaluation/results");
}

export async function runEvaluation(
  lookbackCds: EvalLookbackOption = 10,
  useMock = false,
): Promise<EvaluationResults> {
  const q = new URLSearchParams({
    lookback_cds: String(lookbackCds),
    use_mock: useMock ? "true" : "false",
  });
  return api<EvaluationResults>(`/api/evaluation/run?${q}`, { method: "POST" });
}

export async function loadEvaluationBaseline(): Promise<EvaluationResults | null> {
  try {
    return await api<EvaluationResults>("/api/evaluation/baseline");
  } catch {
    return null;
  }
}

export async function saveEvaluationBaseline(label?: string): Promise<EvaluationResults> {
  const q = label?.trim() ? `?label=${encodeURIComponent(label.trim())}` : "";
  return api<EvaluationResults>(`/api/evaluation/baseline${q}`, { method: "POST" });
}

export async function loadEvaluationCompare(): Promise<{
  current: EvaluationResults;
  baseline: EvaluationResults;
  comparison: EvalComparison;
} | null> {
  try {
    return await api("/api/evaluation/compare");
  } catch {
    return null;
  }
}

export function maeTone(mae: number | null | undefined): "green" | "amber" | "red" | "muted" {
  if (mae == null || !Number.isFinite(mae)) return "muted";
  if (mae < 2) return "green";
  if (mae <= 4) return "amber";
  return "red";
}

export function dirAccTone(acc: number | null | undefined): "green" | "amber" | "red" | "muted" {
  if (acc == null || !Number.isFinite(acc)) return "muted";
  if (acc > 0.6) return "green";
  if (acc >= 0.5) return "amber";
  return "red";
}

/** Delta MAE: negative = improvement. */
export function deltaMaeTone(delta: number | null | undefined): "green" | "amber" | "red" | "muted" {
  if (delta == null || !Number.isFinite(delta)) return "muted";
  if (delta < -0.2) return "green";
  if (delta <= 0.2) return "amber";
  return "red";
}

/** Delta dir acc (pp): positive = improvement. */
export function deltaDirTone(deltaPp: number | null | undefined): "green" | "amber" | "red" | "muted" {
  if (deltaPp == null || !Number.isFinite(deltaPp)) return "muted";
  if (deltaPp > 2) return "green";
  if (deltaPp >= -2) return "amber";
  return "red";
}

export function toneClass(tone: "green" | "amber" | "red" | "muted"): string {
  switch (tone) {
    case "green":
      return "text-emerald-600 dark:text-emerald-400";
    case "amber":
      return "text-amber-600 dark:text-amber-400";
    case "red":
      return "text-red-600 dark:text-red-400";
    default:
      return "text-ink-muted";
  }
}

export function formatDeltaMae(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export function formatDeltaPp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)} pp`;
}
