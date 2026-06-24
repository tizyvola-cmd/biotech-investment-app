/**
 * Lettura file in ``data/`` — stabile in Electron (``project-data://``)
 * e in dev Vite (``/project-data/``). Con server remoto: ``https://host/project-data/``.
 */

import {
  isLocalDesktopShell,
  isRemoteDataMode,
  resolveApiBase,
  resolveProjectDataBase,
} from "../shared/remoteHost";

export function isDesktopShell(): boolean {
  return isLocalDesktopShell();
}

export { isLocalDesktopShell };

export function projectDataUrl(relativePath: string): string {
  const rel = relativePath.replace(/^\/+/, "");
  const base = resolveProjectDataBase();
  return `${base}${rel}`;
}

type ProjectJsonResult<T> = { data: T | null; status?: number; detail?: string };

const inflightJson = new Map<string, Promise<ProjectJsonResult<unknown>>>();
const jsonMemoryCache = new Map<string, { payload: unknown; ts: number }>();
const JSON_CACHE_TTL_MS = 120_000;

/** Invalida cache sessione (es. dopo Refresh manuale). */
export function invalidateProjectJsonCache(relativePath?: string): void {
  if (!relativePath) {
    jsonMemoryCache.clear();
    return;
  }
  const rel = relativePath.replace(/^\/+/, "").split("?")[0];
  jsonMemoryCache.delete(rel);
}

export async function fetchProjectJson<T>(
  relativePath: string
): Promise<ProjectJsonResult<T>> {
  const rel = relativePath.replace(/^\/+/, "").split("?")[0];
  const url = projectDataUrl(rel);

  const cached = jsonMemoryCache.get(rel);
  if (cached && Date.now() - cached.ts < JSON_CACHE_TTL_MS) {
    return { data: cached.payload as T };
  }

  const existing = inflightJson.get(rel);
  if (existing) {
    return (await existing) as ProjectJsonResult<T>;
  }

  const promise = (async (): Promise<ProjectJsonResult<unknown>> => {
    let fetchFail: { status: number; detail: string } = {
      status: 0,
      detail: `${url}: fetch fallito`,
    };

    try {
      const bustUrl = `${url}${url.includes("?") ? "&" : "?"}_=${encodeURIComponent(Date.now())}`;
      const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutId =
        ac != null
          ? setTimeout(() => ac.abort(), rel.endsWith(".json") ? 90_000 : 30_000)
          : undefined;
      const res = await fetch(bustUrl, { cache: "no-store", signal: ac?.signal }).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
      if (res.ok) {
        const data = (await res.json()) as unknown;
        jsonMemoryCache.set(rel, { payload: data, ts: Date.now() });
        return { data };
      }
      fetchFail = { status: res.status, detail: `${url} → HTTP ${res.status}` };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      fetchFail = { status: 0, detail: `${url}: ${msg}` };
    }

    // Fallback IPC (solo file piccoli; predizioni ~30MB — skip in remote mode)
    if (
      !isRemoteDataMode() &&
      typeof window !== "undefined" &&
      window.supernova?.readProjectDataFile
    ) {
      try {
        const ipc = await window.supernova.readProjectDataFile(rel);
        if (ipc.ok && ipc.data !== undefined) {
          jsonMemoryCache.set(rel, { payload: ipc.data, ts: Date.now() });
          return { data: ipc.data };
        }
      } catch {
        /* usa errore fetch */
      }
    }

    return { data: null, status: fetchFail.status, detail: fetchFail.detail };
  })().finally(() => {
    inflightJson.delete(rel);
  });

  inflightJson.set(rel, promise);
  return (await promise) as ProjectJsonResult<T>;
}

export function desktopDataDirHint(): string {
  if (typeof window !== "undefined" && window.supernova?.dataDir) {
    return window.supernova.dataDir;
  }
  return "data/";
}

export type DesktopDataManifest = {
  updated_at?: string;
  workbook_mtime?: string;
  /** ISO — ultimo refresh programmato tab RA Prediction Calibration. */
  ra_calibration_updated_at?: string;
  /** ISO — ultimo refresh programmato tab SDS Accuracy. */
  sds_accuracy_updated_at?: string;
  /** ISO — ultimo refresh programmato tab EIS Signal Impact / magnitude. */
  eis_magnitude_updated_at?: string;
  model_lab_accuracy_report_id?: string;
  sheets?: Record<string, { row_count?: number; path?: string }>;
};

export async function fetchDesktopManifest(): Promise<DesktopDataManifest | null> {
  const { data } = await fetchProjectJson<DesktopDataManifest>("desktop_data_manifest.json");
  if (data) return data;
  try {
    const base = resolveApiBase();
    const path = "/api/desktop/manifest";
    const url = base ? `${base}${path}` : path;
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const body = (await res.json()) as DesktopDataManifest & { error?: string };
      if (body && !body.error) return body;
    }
  } catch {
    /* optional */
  }
  return null;
}

/** Firma manifest per foglio Accuracy (`updated_at` + `row_count` in `sheets.accuracy`). */
export function accuracyManifestSignature(m: DesktopDataManifest | null): string {
  if (!m) return "";
  const rc = m.sheets?.accuracy?.row_count;
  return `${m.updated_at ?? ""}|${rc ?? ""}`;
}
