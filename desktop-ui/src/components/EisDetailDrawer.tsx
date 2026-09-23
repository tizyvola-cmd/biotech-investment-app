import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchClinicalPreCdSnapshot,
  fetchClinicalPreCdStatus,
  runClinicalPreCdRefresh,
  type ClinicalPreCdRecord,
} from "../api/supernova";
import { writeClinicalPreCdSnapshotCache } from "../sheet/clinicalPreCdSnapshotCache";
import { EisDetailPanel } from "./EisDetailPanel";

/**
 * EIS deep-dive modal — scrollbar lives **inside the window**, not on the
 * fullscreen overlay / page tab.
 *
 * Jump-to-top bugs previously came from:
 * - resetting scrollTop whenever `onClose` identity changed
 * - syncing `clinicalRecords` on every parent re-render (new array ref)
 * - scrolling the overlay instead of the panel body
 */
export function EisDetailDrawer({
  open,
  onClose,
  ticker,
  clinicalKpi,
  clinicalRecords,
  onReloadClinicalFeed,
  simRow,
  autoRegSnap,
  sdsMechanismClass,
  it = false,
}: {
  open: boolean;
  onClose: () => void;
  ticker: string | null;
  clinicalKpi?: number | null;
  clinicalRecords?: ClinicalPreCdRecord[];
  onReloadClinicalFeed?: () => void;
  simRow?: Record<string, unknown> | null;
  autoRegSnap?: import("../api/supernova").RegulatoryRiskSnapshot | null;
  sdsMechanismClass?: string | null;
  it?: boolean;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [localRecords, setLocalRecords] = useState<ClinicalPreCdRecord[] | undefined>(
    clinicalRecords,
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const openTickerRef = useRef<string | null>(null);
  const recordsSigRef = useRef<string>("");
  const onCloseRef = useRef(onClose);
  const reloadRef = useRef(onReloadClinicalFeed);
  onCloseRef.current = onClose;
  reloadRef.current = onReloadClinicalFeed;

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const reloadSnapshotIntoDrawer = useCallback(async () => {
    const el = bodyScrollRef.current;
    const keepTop = el?.scrollTop ?? 0;
    try {
      const snap = await fetchClinicalPreCdSnapshot({ preferApi: true });
      const rows = Array.isArray(snap.records) ? snap.records : [];
      setLocalRecords(rows);
      writeClinicalPreCdSnapshotCache(snap);
    } catch {
      /* parent reload may still help */
    }
    reloadRef.current?.();
    // Restore position after React paints the refreshed tree.
    requestAnimationFrame(() => {
      if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = keepTop;
    });
  }, []);

  // Sync records only when opening / changing ticker — not on every parent render.
  useEffect(() => {
    if (!open || !ticker) {
      wasOpenRef.current = false;
      openTickerRef.current = null;
      return;
    }
    const tk = ticker.trim().toUpperCase();
    const justOpened = !wasOpenRef.current;
    const tickerChanged = openTickerRef.current !== tk;
    wasOpenRef.current = true;
    openTickerRef.current = tk;
    if (justOpened || tickerChanged) {
      recordsSigRef.current = "";
      setLocalRecords(clinicalRecords);
      setRefreshMsg(null);
      requestAnimationFrame(() => {
        if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = 0;
      });
      reloadRef.current?.();
    }
    // clinicalRecords intentionally omitted: parent often passes a new array each
    // render; syncing it here re-mounted content and yanked scroll to the top.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/ticker only
  }, [open, ticker]);

  // Quiet adopt of parent snapshot after open (preserve scroll; skip identical payloads).
  useEffect(() => {
    if (!open || refreshing) return;
    const sig = !clinicalRecords?.length
      ? ""
      : `${clinicalRecords.length}:${clinicalRecords.map((r) => `${r.ticker}|${r.nct_id}|${r.clinical_events?.length ?? 0}|${r.clinical_indicators?.length ?? 0}|${r.last_ctgov_update ?? ""}`).join(";")}`;
    if (sig === recordsSigRef.current) return;
    recordsSigRef.current = sig;
    if (!sig) return;
    const el = bodyScrollRef.current;
    const keepTop = el?.scrollTop ?? 0;
    setLocalRecords(clinicalRecords);
    requestAnimationFrame(() => {
      if (bodyScrollRef.current) bodyScrollRef.current.scrollTop = keepTop;
    });
  }, [clinicalRecords, open, refreshing]);

  // Body lock + Escape (stable — does not reset scroll).
  useEffect(() => {
    if (!open) {
      clearPoll();
      setRefreshing(false);
      return;
    }
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarGap = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.body.style.overflow = "hidden";
    if (scrollbarGap > 0) {
      document.body.style.paddingRight = `${scrollbarGap}px`;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      window.removeEventListener("keydown", onKey);
      clearPoll();
    };
  }, [open, clearPoll]);

  const handleTickerClinicalRefresh = useCallback(async () => {
    const tk = ticker?.trim().toUpperCase();
    if (!tk || refreshing) return;
    setRefreshing(true);
    setRefreshMsg(
      it ? `Clinical refresh solo ${tk}…` : `Clinical refresh for ${tk} only…`,
    );
    try {
      const started = await runClinicalPreCdRefresh(false, {
        force: true,
        deep: true,
        tickers: [tk],
      });
      if (started?.started === false) {
        setRefreshMsg(
          started.message ||
            (it ? "Refresh già in corso" : "Refresh already running"),
        );
        setRefreshing(false);
        return;
      }
      clearPoll();
      pollRef.current = setInterval(() => {
        void (async () => {
          try {
            const st = await fetchClinicalPreCdStatus();
            if (st?.message) setRefreshMsg(st.message);
            if (st?.running) return;
            clearPoll();
            setRefreshing(false);
            await reloadSnapshotIntoDrawer();
            setRefreshMsg(
              st?.error
                ? st.error
                : it
                  ? `Aggiornato ${tk}`
                  : `Updated ${tk}`,
            );
            window.setTimeout(() => setRefreshMsg(null), 4000);
          } catch (e) {
            clearPoll();
            setRefreshing(false);
            setRefreshMsg(e instanceof Error ? e.message : String(e));
          }
        })();
      }, 2000);
    } catch (e) {
      setRefreshing(false);
      setRefreshMsg(e instanceof Error ? e.message : String(e));
    }
  }, [ticker, refreshing, it, clearPoll, reloadSnapshotIntoDrawer]);

  if (!open || !ticker || typeof document === "undefined") return null;

  const tk = ticker.toUpperCase();

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center overflow-hidden bg-black/50 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={it ? "Dettaglio EIS" : "EIS detail"}
      onClick={onClose}
    >
      <div
        className="eis-detail-window relative flex h-[min(92vh,56rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface))] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--accent))]/8 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">
              {it ? "Dettaglio EIS" : "EIS detail"} · {tk}
            </p>
            <p className="text-[11px] text-ink-muted">
              {it
                ? "Eventi EIS, indice rischio regolatorio (K-8) e reazione mercato alle news SEC."
                : "EIS events, regulatory risk index (K-8) and market reaction to SEC news."}
            </p>
            {refreshMsg ? (
              <p
                className={`mt-1 text-[10px] leading-snug truncate ${
                  refreshing ? "text-[rgb(var(--accent))]" : "text-ink-muted"
                }`}
                title={refreshMsg}
              >
                {refreshing ? "⏳ " : ""}
                {refreshMsg}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void handleTickerClinicalRefresh()}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[rgb(var(--border))]/70 bg-[rgb(var(--surface))] px-3 py-1.5 text-[11px] font-semibold text-ink shadow-sm transition hover:bg-[rgb(var(--accent))]/10 disabled:opacity-50"
            title={
              it
                ? `Clinical feed refresh solo per ${tk} (Deep + force) — non tocca gli altri titoli`
                : `Clinical feed refresh for ${tk} only (Deep + force) — other tickers untouched`
            }
          >
            <span aria-hidden>{refreshing ? "⏳" : "🔬"}</span>
            {refreshing
              ? it
                ? `Refreshing ${tk}…`
                : `Refreshing ${tk}…`
              : it
                ? `Clinical refresh · ${tk}`
                : `Clinical refresh · ${tk}`}
          </button>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-[rgb(var(--surface-3))] hover:text-ink"
            onClick={onClose}
            aria-label={it ? "Chiudi" : "Close"}
          >
            ✕
          </button>
        </div>

        <div
          ref={bodyScrollRef}
          className="eis-detail-scrollport min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-5"
        >
          <EisDetailPanel
            ticker={ticker}
            clinicalKpi={clinicalKpi}
            clinicalRecords={localRecords}
            simRow={simRow}
            autoRegSnap={autoRegSnap}
            sdsMechanismClass={sdsMechanismClass}
            it={it}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
