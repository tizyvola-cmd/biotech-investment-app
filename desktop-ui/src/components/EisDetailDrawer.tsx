import { useEffect } from "react";
import { EisDetailPanel } from "./EisDetailPanel";

export function EisDetailDrawer({
  open,
  onClose,
  ticker,
  clinicalKpi,
  it = false,
}: {
  open: boolean;
  onClose: () => void;
  ticker: string | null;
  clinicalKpi?: number | null;
  it?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !ticker) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={it ? "Dettaglio EIS" : "EIS detail"}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] shadow-2xl">
        <div className="flex shrink-0 items-center gap-3 border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--accent))]/8 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              {it ? "Dettaglio EIS" : "EIS detail"} · {ticker.toUpperCase()}
            </p>
            <p className="text-[11px] text-ink-muted">
              {it
                ? "Impact score da feed clinico: reazione prezzo, volume, KPI endpoint."
                : "Clinical feed impact score: price reaction, volume, endpoint KPIs."}
            </p>
          </div>
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-[rgb(var(--surface-3))] hover:text-ink"
            onClick={onClose}
            aria-label={it ? "Chiudi" : "Close"}
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <EisDetailPanel ticker={ticker} clinicalKpi={clinicalKpi} it={it} />
        </div>
      </div>
    </div>
  );
}
