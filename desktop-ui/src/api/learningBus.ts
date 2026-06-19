/**
 * Learning Bus v2 — typed wrappers around the unified
 * `/api/learning/*` endpoints.
 *
 * Provides the taxonomy + live status for every learning loop in the
 * system (33+ entries today, ~25 backend + ~8 frontend-only adapters).
 * The new Learning Lab UI consumes these endpoints exclusively; legacy
 * `/api/models/learning-lab/*` endpoints stay live for the v1 view and
 * for the per-loop preview/apply flows.
 *
 * Phase 1 surfaces metadata + read-only status. Phase 4 adds preview/apply/reset
 * via POST /api/learning/loops/{id}/preview|apply|reset.
 */
import { api } from "./supernova";

export type LearningFamily =
  | "A_magnitude"
  | "B_pre_cd"
  | "C_portfolio"
  | "D_monitoring";

export type LearningVerdict =
  | "collecting_data"
  | "improving"
  | "stable"
  | "neutral"
  | "not_helping"
  | "stalled"
  | "unknown";

export type LearningSchedule =
  | "weekly_sunday"
  | "post_refresh_daily"
  | "every_refresh"
  | "every_30_days"
  | "every_pred_live"
  | "on_demand_user"
  | "on_demand"
  | "frontend_localstorage";

export type LoopMetadata = {
  id: string;
  family: LearningFamily;
  name_en: string;
  name_it: string;
  description_en: string;
  description_it: string;
  primary_file: string;
  schedule: LearningSchedule;
  has_preview: boolean;
  has_apply: boolean;
  has_reset: boolean;
  downstream: string[];
  state_files: string[];
  api_endpoint: string | null;
  inactive_reason: string | null;
  planned: boolean;
};

export type LoopMetric = {
  name: string;
  value: number;
  unit: string;
  trend: "up" | "down" | "flat";
};

export type LoopStatus = {
  id: string;
  last_run_at: string | null;
  verdict: LearningVerdict;
  primary_metric: LoopMetric | null;
  n_samples: number | null;
  message: string | null;
  raw_excerpt: Record<string, unknown> | null;
};

export type LoopWithStatus = LoopMetadata & { status: LoopStatus };

export type FamilyHealthCounts = {
  family: LearningFamily;
  total: number;
  active: number;
  collecting: number;
  stalled: number;
  planned: number;
  frontend_only: number;
};

export type LearningHealthOverview = {
  computed_at: string;
  newest_run_at: string | null;
  total_loops: number;
  by_family: FamilyHealthCounts[];
};

export function fetchLearningHealth() {
  return api<LearningHealthOverview>("/api/learning/health", undefined, {
    timeoutMs: 20_000,
  });
}

export function fetchLearningLoops() {
  return api<{ loops: LoopWithStatus[] }>("/api/learning/loops", undefined, {
    timeoutMs: 30_000,
  });
}

export function fetchLearningLoopDetail(loopId: string) {
  return api<LoopWithStatus>(
    `/api/learning/loops/${encodeURIComponent(loopId)}`,
    undefined,
    { timeoutMs: 20_000 },
  );
}

export type PipelineStep = {
  id: string;
  order: number;
  name_en: string;
  name_it: string;
  status: string;
  meta?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  note_en?: string;
  note_it?: string;
};

export type LearningPipelineOverview = {
  generated_at: string;
  steps: PipelineStep[];
  display_chain_en: string;
  display_chain_it: string;
};

export function fetchLearningPipelineOverview() {
  return api<LearningPipelineOverview>("/api/learning/pipeline-overview", undefined, {
    timeoutMs: 20_000,
  });
}

export type PortfolioAdviceSnapshot = {
  schema_version: number;
  updated_at: string | null;
  source: string;
  calibration_proposals: unknown[];
  frozen_weights: unknown | null;
  advice_feedback: unknown | null;
  risk_pattern: {
    proposals: unknown[];
    approved: unknown | null;
    validation: Record<string, unknown>;
    flagged: Record<string, unknown>;
  };
};

export function fetchPortfolioAdviceSnapshot() {
  return api<PortfolioAdviceSnapshot>("/api/learning/portfolio-advice/snapshot", undefined, {
    timeoutMs: 15_000,
  });
}

export type CalibrationServerState = {
  schema_version: number;
  updated_at: string;
  frozen_weights: unknown;
  calibration_proposals: unknown[];
  advice_feedback: unknown;
  feature_snapshots: Record<string, unknown>;
  shrinkage_history: unknown[];
};

export function fetchCalibrationState() {
  return api<CalibrationServerState>("/api/learning/calibration/state", undefined, {
    timeoutMs: 15_000,
  });
}

export function putPortfolioAdviceSnapshot(body: PortfolioAdviceSnapshot) {
  return api<{ ok: boolean; updated_at: string }>("/api/learning/portfolio-advice/snapshot", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type LearningAuditEntry = {
  id: string;
  source: string;
  ts: string;
  kind: string;
  message: string;
  meta?: Record<string, unknown>;
};

export type LearningWeeklyMetric = {
  week?: string;
  week_label?: string;
  n_outcomes?: number;
  mae_baseline?: number | null;
  mae_with_all?: number | null;
  mae_before_cluster?: number | null;
  mae_after_cluster?: number | null;
  mae_before_regime?: number | null;
  mae_after_regime?: number | null;
  dir_with_all?: number | null;
  dir_after_cluster?: number | null;
  dir_after_regime?: number | null;
  global_cal_factor?: number | null;
  live_snapshot?: boolean;
};

export type LearningAuditLog = {
  generated_at: string;
  schema_version: number;
  entries: LearningAuditEntry[];
  weekly_metrics: LearningWeeklyMetric[];
  counts: {
    log_entries: number;
    weekly_points: number;
    audit_entries: number;
  };
};

export function fetchLearningAuditLog(limit = 200) {
  return api<LearningAuditLog>(
    `/api/learning/audit-log?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    { timeoutMs: 20_000 },
  );
}

export type PortfolioErrorLoopStatus = {
  doc: Record<string, unknown>;
  latest: Record<string, unknown>;
  params: {
    confidence_multipliers: { low: number; medium: number; high: number };
    pattern_penalty: number;
  };
  pending_proposal: {
    reason?: string;
    param_deltas?: Record<string, number>;
    proposed_params?: PortfolioErrorLoopStatus["params"];
  } | null;
  n_closed: number;
  verdict: LearningVerdict;
  weighted_vs_equal_delta_eur: number | null;
  updated_at: string | null;
};

export type PortfolioErrorPreview = {
  dry_run: boolean;
  snapshot: Record<string, unknown>;
  pending_proposal: PortfolioErrorLoopStatus["pending_proposal"];
  params: PortfolioErrorLoopStatus["params"];
};

export function fetchPortfolioErrorLoopStatus() {
  return api<PortfolioErrorLoopStatus>("/api/learning/portfolio-error-loop", undefined, {
    timeoutMs: 15_000,
  });
}

export function previewPortfolioErrorLoop() {
  return api<PortfolioErrorPreview>("/api/learning/portfolio-error-loop/preview", {
    method: "POST",
  }, { timeoutMs: 20_000 });
}

export function applyPortfolioErrorLoop() {
  return api<{ ok: boolean; applied?: boolean; snapshot?: Record<string, unknown> }>(
    "/api/learning/portfolio-error-loop/apply",
    { method: "POST", body: JSON.stringify({ confirm: true }) },
    { timeoutMs: 20_000 },
  );
}

export function resetPortfolioErrorLoop() {
  return api<{ ok: boolean }>(
    "/api/learning/portfolio-error-loop/reset",
    { method: "POST", body: JSON.stringify({ confirm: true }) },
    { timeoutMs: 15_000 },
  );
}

export type LoopActionKind = "preview" | "apply" | "reset";

export type LoopActionResult = {
  ok: boolean;
  loop_id?: string;
  action?: LoopActionKind;
  dry_run?: boolean;
  error?: string;
  hint_en?: string;
  hint_it?: string;
  note_en?: string;
  note_it?: string;
  changes?: unknown[];
  result?: Record<string, unknown>;
  applied?: boolean;
  snapshot?: Record<string, unknown>;
};

export function previewLearningLoop(loopId: string) {
  return api<LoopActionResult>(
    `/api/learning/loops/${encodeURIComponent(loopId)}/preview`,
    { method: "POST" },
    { timeoutMs: 60_000 },
  );
}

export function applyLearningLoop(loopId: string) {
  return api<LoopActionResult>(
    `/api/learning/loops/${encodeURIComponent(loopId)}/apply`,
    { method: "POST", body: JSON.stringify({ confirm: true }) },
    { timeoutMs: 60_000 },
  );
}

export function resetLearningLoop(loopId: string) {
  return api<LoopActionResult>(
    `/api/learning/loops/${encodeURIComponent(loopId)}/reset`,
    { method: "POST", body: JSON.stringify({ confirm: true }) },
    { timeoutMs: 30_000 },
  );
}
