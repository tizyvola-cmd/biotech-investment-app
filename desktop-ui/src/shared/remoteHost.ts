/**
 * Connessione a server remoto (VPS) — stesso meccanismo della mobile app (`sn_api_base`).
 * Quando impostato, API + snapshot JSON leggono dal server invece che da `data/` locale.
 *
 * In Electron (collegamento Desktop) API e JSON locali hanno sempre priorità: un vecchio
 * sn_api_base verso il VPS non deve bloccare project-data:// né 127.0.0.1:8765.
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

export function getRemoteApiBase(): string {
  if (typeof window === "undefined") return "";
  const raw = localStorage.getItem(LS_API_BASE)?.trim();
  return raw ? raw.replace(/\/$/, "") : "";
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

/** True se i dati (snapshot JSON) arrivano dal VPS, non da disco locale / project-data:// */
export function isRemoteDataMode(): boolean {
  if (electronShell()) return false;
  return Boolean(getRemoteApiBase());
}

export function resolveApiBase(): string {
  const shell = electronShell();
  if (shell?.apiBase) return shell.apiBase;
  const fromBuild = import.meta.env.VITE_API_BASE?.trim().replace(/\/$/, "") || "";
  if (fromBuild && import.meta.env.VITE_ELECTRON === "1") return fromBuild;
  const remote = getRemoteApiBase();
  if (remote) return remote;
  return fromBuild;
}

export function resolveProjectDataBase(): string {
  const shell = electronShell();
  if (shell?.projectDataBase) return shell.projectDataBase;
  const remote = getRemoteApiBase();
  if (remote) return `${remote}/project-data/`;
  return "/project-data/";
}

/** Electron con file locali (non VPS). */
export function isLocalDesktopShell(): boolean {
  return electronShell() != null;
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
