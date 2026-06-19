import { api } from "./supernova";

export type RefreshProfile = {
  id: string;
  title: string;
  detail: string;
  eta: string;
};

export type OrchestratorCatalystEntry = {
  key: string;
  ticker: string;
  completion_date: string;
  sponsor_match: string;
  nct_relation_type: string;
  partial_type?: string;
  company: string;
  sponsor: string;
  nct_id?: string;
};

export type OrchestratorRunSummary = {
  profile?: string;
  ok?: boolean;
  exit_code?: number;
  started_at?: string;
  started_at_display?: string;
  finished_at?: string;
  finished_at_display?: string;
  elapsed_sec?: number;
  new_tickers_discovery?: string[];
  new_tickers_extra?: string[];
  new_tickers_ipo?: string[];
  new_catalyst_rows?: OrchestratorCatalystEntry[];
  cohort_entries_count?: number;
  staged_workbook?: string;
};

export type WorkbookStatus = {
  workbook: string;
  workbook_path: string;
  workbook_locked: boolean;
  staged_path: string | null;
  staged_name: string | null;
  refresh_fast_status?: Record<string, string>;
  orchestrator_summary?: OrchestratorRunSummary | null;
};

export function fetchOrchestratorSummary() {
  return api<OrchestratorRunSummary>("/api/refresh/orchestrator-summary");
}

export function fetchRefreshProfiles() {
  return api<{ profiles: RefreshProfile[] }>("/api/refresh/profiles");
}

export function fetchWorkbookStatus() {
  return api<WorkbookStatus>("/api/desktop/workbook-status");
}

export function runRefreshProfile(profile: string) {
  return api<Record<string, string>>(`/api/refresh/run?profile=${encodeURIComponent(profile)}`, {
    method: "POST",
  });
}

export function exportDesktopSnapshots(opts?: { essential?: boolean }) {
  const q = opts?.essential ? "?essential=1" : "";
  return api<Record<string, unknown>>(`/api/desktop/export-snapshots${q}`, { method: "POST" });
}
