import { useCallback, useEffect, useState } from "react";
import { useLang } from "../shared/i18n";
import {
  PAGE_ZOOM_DEFAULT,
  PAGE_ZOOM_MAX,
  PAGE_ZOOM_MIN,
  applyPageZoom,
  readStoredPageZoom,
  setPageZoom,
  stepPageZoom,
} from "../sheet/pageZoom";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

export function PageZoomControls() {
  const { lang } = useLang();
  const it = lang === "it";
  const [zoom, setZoom] = useState(readStoredPageZoom);

  useEffect(() => {
    setZoom(applyPageZoom(zoom));
  }, []);

  const commit = useCallback((next: number) => {
    setZoom(setPageZoom(next));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        commit(stepPageZoom(readStoredPageZoom(), 1));
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        commit(stepPageZoom(readStoredPageZoom(), -1));
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        commit(PAGE_ZOOM_DEFAULT);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit]);

  const zoomInTip = it
    ? `Ingrandisci pagina (${Math.round(PAGE_ZOOM_MAX * 100)}% max) · Ctrl +`
    : `Zoom in (${Math.round(PAGE_ZOOM_MAX * 100)}% max) · Ctrl +`;
  const zoomOutTip = it
    ? `Riduci pagina (${Math.round(PAGE_ZOOM_MIN * 100)}% min) · Ctrl −`
    : `Zoom out (${Math.round(PAGE_ZOOM_MIN * 100)}% min) · Ctrl −`;
  const resetTip = it ? "Ripristina 100% · Ctrl 0" : "Reset 100% · Ctrl 0";

  const btn =
    "inline-flex items-center justify-center w-7 h-7 text-[14px] font-semibold leading-none text-ink hover:bg-[rgb(var(--accent))]/12 disabled:opacity-35 disabled:hover:bg-transparent";

  return (
    <div
      className="flex items-center rounded-lg border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-2))]/80 overflow-hidden"
      role="group"
      aria-label={it ? "Zoom pagina" : "Page zoom"}
    >
      <button
        type="button"
        className={btn}
        onClick={() => commit(stepPageZoom(zoom, -1))}
        disabled={zoom <= PAGE_ZOOM_MIN}
        title={zoomOutTip}
        aria-label={it ? "Riduci zoom" : "Zoom out"}
      >
        −
      </button>
      <button
        type="button"
        className="px-1.5 h-7 min-w-[2.4rem] text-[10px] font-semibold tabular-nums text-ink-muted hover:text-ink hover:bg-[rgb(var(--accent))]/12"
        onClick={() => commit(PAGE_ZOOM_DEFAULT)}
        title={resetTip}
        aria-label={resetTip}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className={btn}
        onClick={() => commit(stepPageZoom(zoom, 1))}
        disabled={zoom >= PAGE_ZOOM_MAX}
        title={zoomInTip}
        aria-label={it ? "Aumenta zoom" : "Zoom in"}
      >
        +
      </button>
    </div>
  );
}
