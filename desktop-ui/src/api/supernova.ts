import { loadLocalSheet } from "../data/localSheets";

const TOKEN_KEY = "supernova_api_token";

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base =
    (typeof window !== "undefined" && window.supernova?.apiBase) ||
    import.meta.env.VITE_API_BASE?.trim() ||
    "";
  if (base) return `${base.replace(/\/$/, "")}${path}`;
  return path;
}

export function getStoredToken(): string {
  return (
    import.meta.env.VITE_SUPERNOVA_API_TOKEN?.trim() ||
    localStorage.getItem(TOKEN_KEY)?.trim() ||
    ""
  );
}

export function setStoredToken(token: string): void {
  if (token.trim()) localStorage.setItem(TOKEN_KEY, token.trim());
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = (init?.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const token = getStoredToken();
    if (token) headers.set("X-SuperNova-Token", token);
  }
  let signal = init?.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (!signal && typeof AbortController !== "undefined") {
    const ac = new AbortController();
    signal = ac.signal;
    timeoutId = setTimeout(() => ac.abort(), 120_000);
  }
  const res = await fetch(apiUrl(path), { ...init, headers, signal }).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `${res.status}: ${text.slice(0, 240)}`;
    try {
      const body = JSON.parse(text) as { detail?: unknown };
      const d = body.detail;
      if (typeof d === "object" && d !== null && "message_it" in d) {
        const it = (d as { message_it?: string; path?: string }).message_it;
        const p = (d as { path?: string }).path;
        msg = p ? `${it} (${p})` : String(it);
      } else if (typeof d === "string") {
        msg = d;
      }
    } catch {
      /* keep default msg */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function fetchHealth() {
  return api<{ status: string; root: string }>("/api/health");
}

export function fetchStatus() {
  return api<import("../types").ApiStatus>("/api/status");
}

export function fetchOrchestratorLog(tail = 3000) {
  return api<{ log: string }>(`/api/orchestrator/log?tail=${tail}`);
}

export function runOrchestrator(profile: "quick" | "skip_fetch" | "full" = "quick") {
  return api<Record<string, string>>(`/api/orchestrator/run?profile=${profile}`, {
    method: "POST",
  });
}

/** Refresh — profilo ``daily`` | ``simulation`` | ``accuracy`` | ``sec_k8`` | ``sunday`` | ``dry_run``. */
export function runDailyRefresh(
  profile: "daily" | "simulation" | "accuracy" | "sec_k8" | "sunday" | "dry_run" | "accuracy_only" | "dry_run" = "daily"
) {
  return api<Record<string, string>>(`/api/refresh/run?profile=${profile}`, {
    method: "POST",
  });
}

export function fetchRefreshStatus() {
  return api<{
    running?: boolean;
    state?: string;
    ok?: string;
    message?: string;
    updated_at?: string;
  }>("/api/refresh/status");
}

export function fetchRefreshLog(tail = 4000) {
  return api<{ log: string }>(`/api/refresh/log?tail=${tail}`);
}

type SheetKind = "simulation" | "clinical" | "secK8" | "accuracy" | "financial";

const SHEET_API: Record<SheetKind, string> = {
  simulation: "/api/sheets/simulation",
  clinical: "/api/sheets/clinical-simulation",
  secK8: "/api/sheets/sec-k8-simulation",
  accuracy: "/api/sheets/accuracy",
  financial: "/api/sheets/financial",
};

async function loadSheetWithFallback(kind: SheetKind) {
  try {
    return await loadLocalSheet(kind);
  } catch (localErr) {
    try {
      const t = await api<import("../types").SheetTable>(SHEET_API[kind]);
      if (Array.isArray(t.rows) && t.rows.length > 0) return t;
      if (t.error) throw new Error(t.error);
    } catch {
      /* API fallita — usa messaggio locale */
    }
    throw localErr;
  }
}

/** Fogli: prima snapshot JSON in ``data/``, poi API Excel se mancanti. */
export function fetchSimulationSheet() {
  return loadSheetWithFallback("simulation");
}

export function fetchClinicalSimulationSheet() {
  return loadSheetWithFallback("clinical");
}

export function fetchSecK8SimulationSheet() {
  return loadSheetWithFallback("secK8");
}

export function fetchAccuracySheet() {
  return loadSheetWithFallback("accuracy");
}

export function fetchFinancialSheet() {
  return loadSheetWithFallback("financial");
}

export function fetchChartsSimulation() {
  return api<import("../types").ChartBundle>("/api/charts/simulation");
}

export function fetchChartsRistretta() {
  return api<import("../types").ChartBundle>("/api/charts/ristretta");
}
