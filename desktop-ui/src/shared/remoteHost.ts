/**
 * Connessione a server remoto (VPS) â€” stesso meccanismo della mobile app (`sn_api_base`).
 * Quando impostato, API + snapshot JSON leggono dal server invece che da `data/` locale.
 *
 * In Electron (collegamento Desktop) API e JSON locali hanno sempre prioritÃ : un vecchio
 * sn_api_base verso il VPS non deve bloccare project-data:// nÃ© 127.0.0.1:8765.
 */

const LS_API_BASE = "sn_api_base";
export const REMOTE_HOST_CHANGED_EVENT = "supernova:remote-host-changed";

type SupernovaWindow = Window & {
  supernova?: {
    apiBase?: string;
    projectDataBase?: string;
  };
};

function electronShell(): { apiBase: string; projectDataBase: string } | null {
  if (typeof window === "undefined") return null;
  const sn = (window as SupernovaWindow).supernova;
  const projectDataBase = sn?.projectDataBase?.trim();
  if (!projectDataBase) return null;
  const apiBase = sn?.apiBase?.trim().replace(/\/$/, "") || "";
  return { apiBase, projectDataBase };
}

/** True for localhost / 127.0.0.1 API bases (only reachable on the same machine). */
export function isLoopbackApiBase(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return /^(https?:\/\/)?(localhost|127\.0\.0\.1)([:/]|$)/i.test(url.trim());
  }
}

function pageIsLoopbackHost(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const h = String(window.location?.hostname || "").toLowerCase();
    return !h || h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

/** Browser tab already on the public API host (VPS web) â€” use relative `/api`. */
export function pageIsHostedApiWeb(): boolean {
  if (typeof window === "undefined") return false;
  if (electronShell()) return false;
  return !pageIsLoopbackHost();
}

/**
 * Remote API from Settings. On a non-local browser page (e.g. VPS web), ignore a
 * leftover loopback `sn_api_base` â€” it only works on the PC running the local API.
 */
export function getRemoteApiBase(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem(LS_API_BASE)?.trim();
  if (!raw) return "";
  const cleaned = raw.replace(/\/$/, "");
  // VPS web is already the API host â€” leftover Settings URLs (LAN / https / old IP)
  // make Request Access and Sign-in fail with "Failed to fetch".
  if (pageIsHostedApiWeb()) return "";
  if (isLoopbackApiBase(cleaned) && !pageIsLoopbackHost() && !electronShell()) {
    return "";
  }
  return cleaned;
}

export function setRemoteApiBase(url: string): void {
  if (typeof window === "undefined") return;
  const v = url.trim().replace(/\/$/, "");
  if (v) localStorage.setItem(LS_API_BASE, v);
  else localStorage.removeItem(LS_API_BASE);
  try {
    window.dispatchEvent(new CustomEvent(REMOTE_HOST_CHANGED_EVENT, { detail: { url: v } }));
  } catch {
    /* ignore */
  }
}

function emitRemoteHostCleared(): void {
  try {
    window.dispatchEvent(new CustomEvent(REMOTE_HOST_CHANGED_EVENT, { detail: { url: "" } }));
  } catch {
    /* ignore */
  }
}

/** Drop a stuck loopback Settings URL (common cause of login "Failed to fetch" on VPS web). */
export function clearLoopbackRemoteApiBase(): boolean {
  if (typeof window === "undefined") return false;
  const raw = localStorage.getItem(LS_API_BASE)?.trim() || "";
  if (!raw || !isLoopbackApiBase(raw)) return false;
  localStorage.removeItem(LS_API_BASE);
  emitRemoteHostCleared();
  return true;
}

/**
 * On VPS web, any leftover Settings URL (LAN IP, https, old host) makes login
 * CORS/mixed-content fail with "Failed to fetch". Same-origin `/api` is correct.
 */
export function clearHostedPageRemoteApiBase(): boolean {
  if (typeof window === "undefined" || !pageIsHostedApiWeb()) return false;
  const raw = localStorage.getItem(LS_API_BASE)?.trim() || "";
  if (!raw) return false;
  localStorage.removeItem(LS_API_BASE);
  emitRemoteHostCleared();
  return true;
}

/** Electron: drop a Settings URL that is not the known VPS so login can fall back. */
export function clearStaleNonDefaultRemoteApiBase(): boolean {
  if (typeof window === "undefined") return false;
  const raw = getRemoteApiBase();
  if (!raw) return false;
  const hint = defaultRemoteHostHint();
  if (raw === hint) return false;
  localStorage.removeItem(LS_API_BASE);
  emitRemoteHostCleared();
  return true;
}

/** True se i dati (snapshot JSON) arrivano dal VPS, non da disco locale / project-data:// */
export function isRemoteDataMode(): boolean {
  if (electronShell()) return false;
  return Boolean(getRemoteApiBase());
}

export function resolveApiBase(): string {
  const shell = electronShell();
  if (shell?.apiBase) return shell.apiBase;
  const fromBuild = import.meta.env.VITE_API_BASE?.trim().replace(/\/$/, "") || "";
  // Electron build may bake VITE_API_BASE=127.0.0.1 â€” never use that on VPS web.
  if (typeof window !== "undefined" && !pageIsLoopbackHost() && !shell) {
    const remote = getRemoteApiBase();
    if (remote && !isLoopbackApiBase(remote)) return remote;
    return "";
  }
  if (fromBuild && import.meta.env.VITE_ELECTRON === "1") return fromBuild;
  const remote = getRemoteApiBase();
  if (remote) return remote;
  return fromBuild;
}

export function resolveProjectDataBase(): string {
  const shell = electronShell();
  if (shell?.projectDataBase) return shell.projectDataBase;
  // Optional CDN / R2 public prefix for shared snapshots (Cloudflare in front).
  const cdn = String(import.meta.env.VITE_CDN_PROJECT_DATA || "").trim();
  if (cdn && !shell) {
    return cdn.replace(/\/?$/, "/");
  }
  const remote = getRemoteApiBase();
  if (remote) return `${remote}/project-data/`;
  return "/project-data/";
}

/** Electron con file locali (non VPS). */
export function isLocalDesktopShell(): boolean {
  return electronShell() != null;
}

/**
 * Tester accounts live on the VPS store â€” never on a dead local :8765.
 * Electron always uses VPS (or a non-loopback Settings override).
 * Browser on VPS uses same-origin when possible.
 */
export function resolveTesterFeedbackApiBase(): string {
  // Desktop Electron: tester books are on the VPS, not local data/.
  if (isLocalDesktopShell()) {
    const remote = getRemoteApiBase();
    if (remote && !isLoopbackApiBase(remote)) return remote;
    return defaultRemoteHostHint();
  }
  // Served from the API host (VPS web) â†’ always relative /api.
  // A leftover Settings URL (LAN IP / https) is the usual "Failed to fetch" on login.
  if (pageIsHostedApiWeb()) {
    return "";
  }
  const remote = getRemoteApiBase();
  if (remote && !isLoopbackApiBase(remote)) return remote;
  const base = resolveApiBase();
  if (base && !isLoopbackApiBase(base)) return base;
  return defaultRemoteHostHint();
}

/** VPS di default (placeholder Settings); override con VITE_DEFAULT_REMOTE_HOST in build. */
const DEFAULT_VPS_HINT = "http://91.99.15.48:8765";

export function defaultRemoteHostHint(): string {
  return (
    import.meta.env.VITE_DEFAULT_REMOTE_HOST?.trim().replace(/\/$/, "") ||
    DEFAULT_VPS_HINT
  );
}

export function initialRemoteUrl(): string {
  return getRemoteApiBase() || defaultRemoteHostHint();
}

/** Mobile dashboard snapshot GET/PUT â€” VPS when desktop runs locally in Electron. */
export function resolveMobileSyncApiBase(): string {
  if (isLocalDesktopShell()) {
    const remote = getRemoteApiBase();
    if (remote && !isLoopbackApiBase(remote)) return remote;
    return defaultRemoteHostHint();
  }
  return resolveApiBase();
}

/**
 * Saturday WeeklyFull runs on the VPS cron â€” never on the local Electron :8765.
 * Desktop must poll this host even when local API is offline / apiOk=false.
 */
export function resolveWeeklyFullApiBase(): string {
  return resolveMobileSyncApiBase();
}
