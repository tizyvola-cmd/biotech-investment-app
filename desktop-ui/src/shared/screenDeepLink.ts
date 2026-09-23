/**
 * Deep-link a tab into its own window (`#screen=catalystDesk&popout=1`).
 * Electron opens a real secondary BrowserWindow; the browser falls back to window.open.
 */
import type { AppScreen } from "../types";

const VALID_SCREENS = new Set<string>([
  "main",
  "catalyst",
  "simulation",
  "clinical",
  "secK8",
  "financial",
  "models",
  "decisionLab",
  "catalystDesk",
  "wind",
  "piggyBank",
  "catalystFeed",
  "eisDeepDive",
  "calendar",
  "discovery",
  "testerMonitor",
  "system",
]);

export function isAppScreen(value: string | null | undefined): value is AppScreen {
  return Boolean(value && VALID_SCREENS.has(value));
}

function parseHashParams(hash: string): URLSearchParams {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return new URLSearchParams();
  if (raw.includes("=")) {
    return new URLSearchParams(raw.replace(/^\//, ""));
  }
  if (raw.startsWith("/")) {
    const id = raw.slice(1).split(/[/?#]/)[0] ?? "";
    return id ? new URLSearchParams(`screen=${id}`) : new URLSearchParams();
  }
  if (VALID_SCREENS.has(raw)) {
    return new URLSearchParams(`screen=${raw}`);
  }
  return new URLSearchParams();
}

export type ScreenDeepLink = {
  screen: AppScreen | null;
  popout: boolean;
};

/** Read the initial tab from `?screen=` / `#screen=` (and optional `popout=1`). */
export function parseScreenDeepLink(
  search = typeof window !== "undefined" ? window.location.search : "",
  hash = typeof window !== "undefined" ? window.location.hash : "",
): ScreenDeepLink {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const hashParams = parseHashParams(hash);
  const screenRaw = query.get("screen") || hashParams.get("screen");
  const popoutFlag =
    query.get("popout") ?? hashParams.get("popout") ?? "";
  const popout = popoutFlag === "1" || /^true$/i.test(popoutFlag);
  return {
    screen: isAppScreen(screenRaw) ? screenRaw : null,
    popout,
  };
}

export function canOpenScreenInNewWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.supernova?.openScreenWindow === "function") return true;
  // Browser / VPS web — not the Electron shell (window.open is blocked or useless there).
  return window.supernova == null;
}

/** Open a tab in a detached window. Returns false when the host cannot do it. */
export function openScreenInNewWindow(screen: AppScreen): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.supernova?.openScreenWindow === "function") {
    void window.supernova.openScreenWindow(screen).catch(() => {
      /* best-effort */
    });
    return true;
  }
  if (window.supernova != null) return false;
  try {
    const url = new URL(window.location.href);
    url.hash = `screen=${encodeURIComponent(screen)}&popout=1`;
    const w = window.open(url.toString(), `supernova-${screen}`, "noopener,noreferrer");
    return w != null;
  } catch {
    return false;
  }
}
