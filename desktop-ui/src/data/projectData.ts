/**
 * Lettura file in ``data/`` — stabile in Electron (``project-data://``)
 * e in dev Vite (``/project-data/``).
 */

export function isDesktopShell(): boolean {
  return typeof window !== "undefined" && Boolean(window.supernova?.projectDataBase);
}

export function projectDataUrl(relativePath: string): string {
  const rel = relativePath.replace(/^\/+/, "");
  const base =
    typeof window !== "undefined" && window.supernova?.projectDataBase
      ? window.supernova.projectDataBase
      : "/project-data/";
  return `${base}${rel}`;
}

export async function fetchProjectJson<T>(
  relativePath: string
): Promise<{ data: T | null; status?: number; detail?: string }> {
  const rel = relativePath.replace(/^\/+/, "");
  const url = projectDataUrl(relativePath);
  let fetchFail: { status: number; detail: string } = {
    status: 0,
    detail: `${url}: fetch fallito`,
  };

  try {
    const bustUrl = `${url}${url.includes("?") ? "&" : "?"}_=${encodeURIComponent(Date.now())}`;
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId =
      ac != null
        ? setTimeout(() => ac.abort(), relativePath.endsWith(".json") ? 90_000 : 30_000)
        : undefined;
    const res = await fetch(bustUrl, { cache: "no-store", signal: ac?.signal }).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
    if (res.ok) {
      return { data: (await res.json()) as T };
    }
    fetchFail = { status: res.status, detail: `${url} → HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fetchFail = { status: 0, detail: `${url}: ${msg}` };
  }

  // Fallback IPC (solo file piccoli; predizioni ~30MB via project-data://)
  if (typeof window !== "undefined" && window.supernova?.readProjectDataFile) {
    try {
      const ipc = await window.supernova.readProjectDataFile(rel);
      if (ipc.ok && ipc.data !== undefined) {
        return { data: ipc.data as T };
      }
    } catch {
      /* usa errore fetch */
    }
  }

  return { data: null, status: fetchFail.status, detail: fetchFail.detail };
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
  sheets?: Record<string, { row_count?: number; path?: string }>;
};

export async function fetchDesktopManifest(): Promise<DesktopDataManifest | null> {
  const { data } = await fetchProjectJson<DesktopDataManifest>("desktop_data_manifest.json");
  if (data) return data;
  try {
    const base =
      (typeof window !== "undefined" && window.supernova?.apiBase) ||
      import.meta.env.VITE_API_BASE?.trim() ||
      "";
    const path = "/api/desktop/manifest";
    const url = base ? `${base.replace(/\/$/, "")}${path}` : path;
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
