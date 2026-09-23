/** Page magnification for this window (Electron pop-out or main). */

export const PAGE_ZOOM_MIN = 0.8;
export const PAGE_ZOOM_MAX = 1.6;
export const PAGE_ZOOM_STEP = 0.1;
export const PAGE_ZOOM_DEFAULT = 1;

export const PAGE_ZOOM_STORAGE_KEY = "supernova.pageZoom";

export function clampPageZoom(raw: number): number {
  if (!Number.isFinite(raw)) return PAGE_ZOOM_DEFAULT;
  const clamped = Math.min(PAGE_ZOOM_MAX, Math.max(PAGE_ZOOM_MIN, raw));
  return Math.round(clamped * 100) / 100;
}

export function parsePageZoom(raw: string | null | undefined): number {
  if (raw == null || raw === "") return PAGE_ZOOM_DEFAULT;
  return clampPageZoom(Number(raw));
}

export function stepPageZoom(current: number, direction: 1 | -1): number {
  return clampPageZoom(current + direction * PAGE_ZOOM_STEP);
}

export function readStoredPageZoom(): number {
  if (typeof window === "undefined") return PAGE_ZOOM_DEFAULT;
  try {
    const session = window.sessionStorage.getItem(PAGE_ZOOM_STORAGE_KEY);
    if (session != null && session !== "") return parsePageZoom(session);
    return parsePageZoom(window.localStorage.getItem(PAGE_ZOOM_STORAGE_KEY));
  } catch {
    return PAGE_ZOOM_DEFAULT;
  }
}

export function persistPageZoom(zoom: number): void {
  const next = clampPageZoom(zoom);
  try {
    window.sessionStorage.setItem(PAGE_ZOOM_STORAGE_KEY, String(next));
    window.localStorage.setItem(PAGE_ZOOM_STORAGE_KEY, String(next));
  } catch {
    /* private mode / quota */
  }
}

/** CSS zoom on <html> breaks hit-testing for position:fixed (modal X / Close miss). */
function clearDocumentCssZoom(): void {
  document.documentElement.style.zoom = "";
  document.body.style.zoom = "";
}

function applyCssZoomToRoot(zoom: number): void {
  clearDocumentCssZoom();
  const root = document.getElementById("root");
  if (!root) return;
  root.style.zoom = zoom === PAGE_ZOOM_DEFAULT ? "" : String(zoom);
}

export function applyPageZoom(zoom: number): number {
  const next = clampPageZoom(zoom);
  if (typeof document === "undefined") return next;
  const native = window.supernova?.setPageZoomFactor;
  if (typeof native === "function") {
    clearDocumentCssZoom();
    const root = document.getElementById("root");
    if (root) root.style.zoom = "";
    native(next);
    return next;
  }
  applyCssZoomToRoot(next);
  return next;
}

export function setPageZoom(zoom: number): number {
  const next = applyPageZoom(zoom);
  persistPageZoom(next);
  return next;
}
