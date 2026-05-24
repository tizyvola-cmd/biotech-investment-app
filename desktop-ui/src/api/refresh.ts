import { api } from "./supernova";

export type RefreshProfile = {
  id: string;
  title: string;
  detail: string;
  eta: string;
};

export type WorkbookStatus = {
  workbook: string;
  workbook_path: string;
  workbook_locked: boolean;
  staged_path: string | null;
  staged_name: string | null;
  refresh_fast_status?: Record<string, string>;
};

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

export function exportDesktopSnapshots() {
  return api<Record<string, unknown>>("/api/desktop/export-snapshots", { method: "POST" });
}
