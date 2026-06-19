import { api } from "./supernova";
import type {
  TesterFeedbackConfig,
  TesterFeedbackEvent,
  TesterFeedbackKind,
  TesterFeedbackModule,
  TesterFeedbackSummary,
  TesterMeta,
} from "../types/testerFeedback";

export function fetchTesterFeedbackConfig() {
  return api<TesterFeedbackConfig>("/api/tester-feedback/config");
}

export function fetchTesterFeedbackSummary() {
  return api<TesterFeedbackSummary>("/api/tester-feedback/summary");
}

export function fetchTesterFeedbackEvents(opts?: {
  limit?: number;
  tester_id?: string;
  module?: TesterFeedbackModule;
  kind?: TesterFeedbackKind;
}) {
  const q = new URLSearchParams();
  if (opts?.limit) q.set("limit", String(opts.limit));
  if (opts?.tester_id) q.set("tester_id", opts.tester_id);
  if (opts?.module) q.set("module", opts.module);
  if (opts?.kind) q.set("kind", opts.kind);
  const qs = q.toString();
  return api<{ events: TesterFeedbackEvent[]; count: number }>(
    `/api/tester-feedback/events${qs ? `?${qs}` : ""}`,
  );
}

export function registerTester(body: {
  tester_id?: string;
  display_name?: string;
  invite_code?: string;
  email?: string;
  source?: "mobile" | "desktop" | "api";
}) {
  return api<{ ok: boolean; tester: TesterMeta }>("/api/tester-feedback/testers/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function setTesterStatus(
  testerId: string,
  status: "pending" | "approved" | "revoked",
  note?: string,
) {
  return api<{ ok: boolean; tester: TesterMeta }>(
    `/api/tester-feedback/testers/${encodeURIComponent(testerId)}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note }),
    },
  );
}

export function resendTesterApprovalEmail(testerId: string) {
  return api<{ ok: boolean; tester: TesterMeta }>(
    `/api/tester-feedback/testers/${encodeURIComponent(testerId)}/resend-approval-email`,
    { method: "POST" },
  );
}

export function deleteTester(testerId: string) {
  return api<{
    ok: boolean;
    tester_id: string;
    removed: boolean;
    events_removed?: number;
    sim_inputs_removed?: boolean;
  }>(`/api/tester-feedback/testers/${encodeURIComponent(testerId)}`, {
    method: "DELETE",
  });
}

export type TesterCalibrationDoc = {
  schema_version: number;
  exported_at: string;
  source_store: string;
  store_updated_at: string | null;
  summary: {
    tester_count: number;
    events_total: number;
    prediction_outcome_rows: number;
    hits: number;
    misses: number;
    hit_rate_pct: number | null;
    outcome_counts: Record<string, number>;
    by_tester_outcome: Record<string, Record<string, number>>;
    by_module: Record<string, number>;
    by_kind: Record<string, number>;
  };
  calibration_rows: Array<Record<string, unknown>>;
  testers: import("../types/testerFeedback").TesterMeta[];
};

export function fetchTesterFeedbackExport() {
  return api<TesterCalibrationDoc>("/api/tester-feedback/export");
}

export function saveTesterFeedbackCalibSnapshot() {
  return api<{ ok: boolean; path: string; exported_at: string }>(
    "/api/tester-feedback/export/snapshot",
    { method: "POST" },
  );
}

export function postTesterFeedbackEvent(body: {
  tester_id: string;
  module: TesterFeedbackModule;
  kind: TesterFeedbackKind;
  ticker?: string;
  source?: "mobile" | "desktop" | "api";
  display_name?: string;
  payload?: Record<string, unknown>;
}) {
  return api<{ ok: boolean; event: TesterFeedbackEvent }>("/api/tester-feedback/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
