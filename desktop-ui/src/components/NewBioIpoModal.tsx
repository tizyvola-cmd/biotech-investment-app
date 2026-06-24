/**
 * NewBioIpoModal — entry point + summary popup for the "New Bio IPO" refresh.
 *
 * Flow:
 *   1. The user clicks the button in the Financial tab (or it's auto-triggered
 *      on the first of the month by the server).
 *   2. We POST `/api/refresh/new-bio-ipo` (returns immediately, runs in a
 *      background thread on the server).
 *   3. We poll `/api/refresh/new-bio-ipo/status` every 2 s. While `running`
 *      we show an hourglass with the elapsed timer.
 *   4. When `running === false` and a `summary` is available we render the
 *      popup with the list of new biotech companies added, plus the skip
 *      counters (existing, non-biotech, no-symbol).
 *   5. A "Reload Financial" callback notifies the parent so the table can
 *      refresh with the newly merged rows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import {
  fetchNewBioIpoStatus,
  runNewBioIpoRefresh,
  type NewBioIpoSummary,
} from "../api/supernova";

type LifecycleState = "idle" | "starting" | "running" | "ok" | "error";

function fmtElapsed(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function fmtDateOnly(iso: string | undefined | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

function fmtNum(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return String(v);
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)} B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return String(n);
}

export function NewBioIpoModal({
  open,
  onClose,
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  /** Called when refresh ends ok so the parent can reload Financial. */
  onCompleted?: (summary: NewBioIpoSummary) => void;
}) {
  const [state, setState] = useState<LifecycleState>("idle");
  const [message, setMessage] = useState<string>("");
  const [summary, setSummary] = useState<NewBioIpoSummary | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const startedAtRef = useRef<Date | null>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    completedRef.current = false;
    // Hydrate with the last persisted summary so the modal can also be used
    // as a "show me the previous IPO scan" panel.
    void (async () => {
      try {
        const st = await fetchNewBioIpoStatus();
        if (st.summary) {
          setSummary(st.summary);
        }
        if (st.running) {
          setState("running");
          startedAtRef.current = new Date();
        } else if (st.error) {
          setState("error");
          setMessage(st.error);
        }
      } catch {
        /* ignore — user can still click start */
      }
    })();
  }, [open]);

  // Polling status while in flight.
  useEffect(() => {
    if (state !== "starting" && state !== "running") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await fetchNewBioIpoStatus();
        if (cancelled) return;
        if (st.summary) setSummary(st.summary);
        if (st.error) {
          setState("error");
          setMessage(st.error);
          return;
        }
        if (st.running) {
          setState("running");
        } else if (st.summary) {
          setState("ok");
          setMessage("");
          if (!completedRef.current) {
            completedRef.current = true;
            onCompleted?.(st.summary);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setMessage(
            `Status unavailable: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    };
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [state, onCompleted]);

  // Elapsed timer.
  useEffect(() => {
    if (state !== "starting" && state !== "running") return;
    if (!startedAtRef.current) startedAtRef.current = new Date();
    const id = window.setInterval(() => {
      if (!startedAtRef.current) return;
      setElapsedSec(
        Math.max(
          0,
          Math.round((Date.now() - startedAtRef.current.getTime()) / 1000),
        ),
      );
    }, 1000);
    return () => window.clearInterval(id);
  }, [state]);

  const handleStart = useCallback(async () => {
    setState("starting");
    setMessage("Starting…");
    startedAtRef.current = new Date();
    setElapsedSec(0);
    completedRef.current = false;
    try {
      const res = await runNewBioIpoRefresh();
      if (res.error) {
        setState("error");
        setMessage(res.error);
        return;
      }
      if (res.running === "true" && res.started !== "true") {
        // Another invocation was already running — just keep polling.
        setMessage(res.message || "Refresh already in progress");
      }
    } catch (e) {
      setState("error");
      setMessage(
        `Startup failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, []);

  if (!open) return null;

  const inFlight = state === "starting" || state === "running";
  const showResults = state === "ok" || (state === "idle" && summary);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => {
        if (!inFlight) onClose();
      }}
    >
      <div
        className="card w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-[rgb(var(--border))]/60 px-4 py-3">
          <div className="flex-1">
            <h3 className="text-base font-semibold flex items-center gap-2">
              <span aria-hidden>🧬</span> New Bio IPO refresh
            </h3>
            <p className="text-xs text-ink-muted mt-0.5">
              Scans Finnhub's IPO calendar from the first day of the previous
              month and adds new biotech tickers to the local universe (then
              refreshes yfinance for the new entries only).
              <br />
              Automatic run on the first of every month; click the button below
              to run it manually.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost text-xs disabled:opacity-50"
            onClick={onClose}
            disabled={inFlight}
            title={inFlight ? "Refresh in progress — wait" : "Close"}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {inFlight && (
            <div className="rounded-lg border border-accent/40 bg-accent/5 p-3 text-xs">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="flex items-center gap-2 font-semibold text-accent">
                  <span className="inline-block text-base animate-spin" aria-hidden>
                    ⏳
                  </span>
                  Scanning Finnhub IPO calendar…
                </span>
                <span className="text-ink-muted tabular-nums">
                  ⏳ elapsed {fmtElapsed(elapsedSec)} · ETA ~1–3 min
                </span>
              </div>
              {message && (
                <p className="text-[11px] text-ink-muted mt-1">{message}</p>
              )}
            </div>
          )}

          {state === "error" && (
            <div className="rounded-lg border border-negative/40 bg-negative/5 p-3 text-xs">
              <p className="font-semibold text-negative">✗ Error</p>
              <p className="text-[11px] text-ink-muted mt-1">{message}</p>
            </div>
          )}

          {showResults && summary && (
            <>
              <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-surface/30 p-3 text-xs space-y-1">
                <p className="font-semibold text-ink">Summary</p>
                <p>
                  <span className="text-ink-muted">Window:</span>{" "}
                  <code>{fmtDateOnly(summary.window_from)}</code> →{" "}
                  <code>{fmtDateOnly(summary.window_to)}</code>
                </p>
                <p>
                  <span className="text-ink-muted">Finnhub returned:</span>{" "}
                  {summary.finnhub_total ?? 0} IPO total
                </p>
                <p>
                  <span className="text-ink-muted">New biotech added:</span>{" "}
                  <span className="font-semibold text-positive">
                    {summary.added_count ?? 0}
                  </span>{" "}
                  · <span className="text-ink-muted">already in universe:</span>{" "}
                  {summary.skipped_existing_count ?? 0} ·{" "}
                  <span className="text-ink-muted">non-biotech filtered:</span>{" "}
                  {summary.skipped_non_biotech_count ?? 0}
                </p>
                {summary.yfinance_update?.ran && (
                  <p className="text-[11px] text-ink-muted">
                    yfinance refreshed for{" "}
                    <span className="font-semibold text-ink">
                      {summary.yfinance_update.fetched ?? 0}
                    </span>{" "}
                    ticker(s)
                    {typeof summary.yfinance_update.new_from_this_run === "number" &&
                    typeof summary.yfinance_update.backfilled_from_previous_runs === "number"
                      ? ` (${summary.yfinance_update.new_from_this_run} new IPO + ` +
                        `${summary.yfinance_update.backfilled_from_previous_runs} backfilled from previous runs)`
                      : ""}
                    .{" "}
                    {summary.yfinance_update.skipped_reason ?? (
                      <em className="text-ink-muted/80">
                        Now visible in the Financial table.
                      </em>
                    )}
                  </p>
                )}
                {summary.yfinance_update?.error && (
                  <p className="text-[11px] text-warn">
                    yfinance refresh error: {summary.yfinance_update.error}
                  </p>
                )}
                <p className="text-[10px] text-ink-muted/70 pt-1 border-t border-[rgb(var(--border))]/30">
                  Completed in {fmtElapsed(summary.elapsed_sec ?? 0)} ·{" "}
                  {summary.finished_at}
                </p>
              </div>

              {summary.added && summary.added.length > 0 ? (
                <div className="rounded-lg border border-[rgb(var(--border))]/60 overflow-hidden">
                  <table className={`${SHEET_GRID_TABLE_CLASS} text-xs border-collapse table-zebra`}>
                    <SheetGridColgroup columnCount={8} />
                    <thead className="bg-[rgb(var(--surface-elevated))]">
                      <tr className="text-[10px] uppercase tracking-wide text-ink-muted/70">
                        <th className={gridTh("left", "py-2 font-medium")}>Ticker</th>
                        <th className={gridTh("left", "py-2 font-medium")}>Company</th>
                        <th className={gridTh("left", "py-2 font-medium")}>IPO date</th>
                        <th className={gridTh("left", "py-2 font-medium")}>Exchange</th>
                        <th className={gridTh("left", "py-2 font-medium")}>Sector · Industry</th>
                        <th className={gridTh("left", "py-2 font-medium")}>Country</th>
                        <th className={gridTh("center", "py-2 font-medium")}>Market cap</th>
                        <th className={gridTh("center", "py-2 font-medium")}>Price $</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.added.map((a) => (
                        <tr
                          key={a.symbol}
                          className="border-t border-[rgb(var(--border))]/30"
                        >
                          <td className={`${gridTd("left")} font-mono font-semibold`}>
                            {a.symbol}
                          </td>
                          <td className={`${gridTd("left")} max-w-[18rem] truncate`}>
                            {a.website ? (
                              <a
                                href={a.website}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:underline text-accent"
                                title={`${a.name ?? a.symbol} — open website`}
                              >
                                {a.name ?? "—"}
                              </a>
                            ) : (
                              <span title={a.name ?? a.symbol}>{a.name ?? "—"}</span>
                            )}
                          </td>
                          <td className={gridTd("left")}>
                            {fmtDateOnly(a.ipo_date)}
                          </td>
                          <td className={gridTd("left")}>{a.exchange ?? "—"}</td>
                          <td className={`${gridTd("left")} text-ink-muted`}>
                            <span className="text-ink">{a.sector ?? "—"}</span>
                            {a.industry ? (
                              <>
                                {" · "}
                                <span>{a.industry}</span>
                              </>
                            ) : null}
                          </td>
                          <td className={`${gridTd("left")} text-ink-muted`}>
                            {a.country ?? "—"}
                          </td>
                          <td className={gridTd("center")}>
                            {fmtNum(a.market_cap)}
                          </td>
                          <td className={gridTd("center")}>
                            {fmtNum(a.current_price ?? a.price)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-ink-muted px-3 py-2 border border-dashed border-[rgb(var(--border))]/50 rounded">
                  No new biotech companies in this window. The universe is up to
                  date.
                </p>
              )}
            </>
          )}

          {state === "idle" && !summary && (
            <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 text-xs">
              <p className="text-ink-muted">
                Click <span className="text-ink">Start refresh</span> to scan
                the IPO calendar from{" "}
                <span className="text-ink">
                  the first day of the previous month
                </span>{" "}
                up to today. Typical ETA: 1–3 minutes (depends on how many new
                IPO Finnhub returned + yfinance throttling).
              </p>
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            {!inFlight && (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={onClose}
              >
                Close
              </button>
            )}
            {!inFlight && (
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => void handleStart()}
              >
                {summary ? "Run again" : "Start refresh"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
