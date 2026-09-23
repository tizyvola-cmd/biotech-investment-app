import { api, getStoredToken } from "./supernova";
import { resolveWeeklyFullApiBase } from "../shared/remoteHost";

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
  message?: string;
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

export type WeeklyFullLastRun = {
  ok?: boolean;
  message?: string;
  duration_sec?: number;
  finished_at?: string;
};

export type WeeklyFullServerStatus = {
  enabled?: boolean;
  running?: boolean;
  last_run?: WeeklyFullLastRun | null;
  summary?: OrchestratorRunSummary | null;
  error?: string;
};

/** Always hits the WeeklyFull host (VPS in Electron), not local :8765. */
export async function fetchWeeklyFullStatus(): Promise<WeeklyFullServerStatus> {
  const base = resolveWeeklyFullApiBase().replace(/\/$/, "");
  if (!base) {
    return api<WeeklyFullServerStatus>("/api/refresh/weekly-full-status");
  }
  const headers = new Headers();
  const token = getStoredToken();
  if (token) headers.set("X-SuperNova-Token", token);
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(`${base}/api/refresh/weekly-full-status`, {
      headers,
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text.slice(0, 240)}`);
    }
    return (await res.json()) as WeeklyFullServerStatus;
  } finally {
    clearTimeout(timeoutId);
  }
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
