/**
 * SlopeEventLogPanel — displays and downloads the JSON log of slope change events.
 *
 * Reads directly from localStorage (no external prop needed).
 * Auto-refreshes every 30 seconds and when the panel is opened.
 *
 * The downloaded JSON file is used to recalibrate the slope prediction model.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildExportLog,
  clearSlopeLog,
  downloadSlopeLog,
  loadSlopeLog,
  type SlopeEventRecord,
} from "../sheet/slopeEventLog";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtSlope(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

type FilterStatus = "all" | "pending" | "correct" | "wrong";

const KIND_LABEL: Record<string, { icon: string; label: string; cls: string }> = {
  slope_rev: { icon: "🔴", label: "Reversal",     cls: "text-[rgb(var(--signal-down))]" },
  slope_dec: { icon: "🟠", label: "Deceleration", cls: "text-[rgb(var(--warn))]"        },
  slope_acc: { icon: "🟢", label: "Acceleration", cls: "text-[rgb(var(--signal-up))]"   },
};

function openTag(had_open: boolean | undefined): { label: string; cls: string; title: string } {
  if (had_open === true) {
    return {
      label: "Live",
      cls: "text-[rgb(var(--signal-up))] border-[rgb(var(--signal-up))]/40 bg-[rgb(var(--signal-up))]/8",
      title: "Detected while you had an open position on this ticker — real P&L on confirmation",
    };
  }
  return {
    label: "Passive",
    cls: "text-ink-muted border-[rgb(var(--border))]/40 bg-surface/30",
    title: "Detected without an open position — used only for calibration (proxy P&L on confirmation)",
  };
}

// ── component ─────────────────────────────────────────────────────────────────

export function SlopeEventLogPanel() {
  const [events, setEvents] = useState<SlopeEventRecord[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [showRaw, setShowRaw] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const reload = useCallback(() => {
    setEvents(loadSlopeLog().events);
  }, []);

  // Load on panel open + every 30s
  useEffect(() => {
    reload();
    const id = setInterval(reload, 30_000);
    return () => clearInterval(id);
  }, [reload]);

  // ── statistics ─────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const pending   = events.filter((e) => e.confirmed === null).length;
    const resolved  = events.filter((e) => e.confirmed !== null);
    const correct   = resolved.filter((e) => e.confirmed === true).length;
    const wrong     = resolved.filter((e) => e.confirmed === false).length;
    const accuracy  = resolved.length > 0 ? Math.round((correct / resolved.length) * 100) : null;
    return { total: events.length, pending, correct, wrong, accuracy };
  }, [events]);

  // ── filter ─────────────────────────────────────────────────────────────────

  const visible = useMemo(() => {
    if (filter === "pending") return events.filter((e) => e.confirmed === null);
    if (filter === "correct") return events.filter((e) => e.confirmed === true);
    if (filter === "wrong")   return events.filter((e) => e.confirmed === false);
    return events;
  }, [events, filter]);

  // ── export raw JSON ────────────────────────────────────────────────────────

  const rawJson = useMemo(
    () => showRaw ? JSON.stringify(buildExportLog(), null, 2) : "",
    [showRaw, events], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3 text-xs">

      {/* Header + KPI strip */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold">
            📋 Slope change event log
          </p>
          <p className="text-[10px] text-ink-muted/70 leading-snug mt-0.5">
            Every reversal / deceleration detection is recorded here.
            Download the JSON to recalibrate the slope prediction model.
          </p>
        </div>

        {/* Download button */}
        <button
          type="button"
          onClick={downloadSlopeLog}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgb(var(--accent))]/15 text-[rgb(var(--accent))] text-[11px] font-semibold hover:bg-[rgb(var(--accent))]/25 transition"
        >
          ⬇ Download JSON
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Total",   value: stats.total,    cls: "text-ink" },
          { label: "Pending", value: stats.pending,  cls: "text-[rgb(var(--warn))]" },
          { label: "Correct", value: stats.correct,  cls: "text-[rgb(var(--signal-up))]" },
          { label: "Wrong",   value: stats.wrong,    cls: "text-[rgb(var(--signal-down))]" },
        ].map(({ label, value, cls }) => (
          <div key={label} className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/40 px-3 py-2">
            <p className={`text-xl font-bold tabular-nums ${cls}`}>{value}</p>
            <p className="text-[9px] text-ink-muted leading-tight mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Model accuracy */}
      {stats.accuracy !== null && (
        <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${
          stats.accuracy >= 60
            ? "border-[rgb(var(--signal-up))]/35 bg-[rgb(var(--signal-up))]/5"
            : stats.accuracy >= 40
            ? "border-[rgb(var(--warn))]/35 bg-[rgb(var(--warn))]/5"
            : "border-[rgb(var(--signal-down))]/35 bg-[rgb(var(--signal-down))]/5"
        }`}>
          <span className="text-lg">
            {stats.accuracy >= 60 ? "✅" : stats.accuracy >= 40 ? "⚠️" : "❌"}
          </span>
          <div>
            <p className="font-semibold text-[11px]">
              Prediction accuracy: {stats.accuracy}%
            </p>
            <p className="text-[10px] text-ink-muted">
              over {stats.correct + stats.wrong} resolved events · recalibration recommendation threshold: &lt; 55%
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      {events.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(["all", "pending", "correct", "wrong"] as FilterStatus[]).map((f) => {
            const labels: Record<FilterStatus, string> = {
              all: `All (${stats.total})`,
              pending: `Pending (${stats.pending})`,
              correct: `✓ Correct (${stats.correct})`,
              wrong:   `✗ Wrong (${stats.wrong})`,
            };
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`text-[10px] px-2 py-0.5 rounded border transition ${
                  filter === f
                    ? "bg-accent/15 text-accent border-accent/30"
                    : "text-ink-muted border-[rgb(var(--border))]/40 hover:text-ink"
                }`}
              >
                {labels[f]}
              </button>
            );
          })}
          <button
            type="button"
            onClick={reload}
            className="text-[10px] px-2 py-0.5 rounded border border-[rgb(var(--border))]/40 text-ink-muted/60 hover:text-ink-muted transition ml-auto"
          >
            ↻ Refresh
          </button>
        </div>
      )}

      {/* Events table */}
      {events.length === 0 ? (
        <div className="rounded-lg border border-[rgb(var(--border))]/40 px-4 py-8 text-center space-y-1">
          <p className="text-2xl">📉</p>
          <p className="text-[11px] font-medium text-ink-muted">No events recorded yet</p>
          <p className="text-[10px] text-ink-muted/60 leading-snug">
            Events are recorded automatically for every ticker with a valid CD when
            the system detects a slope change (reversal, deceleration or acceleration;
            |Δ| ≥ 0.8 pp/d for accel/decel, same rules as Slope errors tab). The log is populated lazily — give the app a few
            minutes after a refresh or open the Catalyst Hub / Decision Lab tab to
            warm it up.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-[10px] text-ink-muted py-4 text-center">
          No events with filter "{filter}".
        </p>
      ) : (
        <div className="overflow-auto rounded-lg border border-[rgb(var(--border))]/50 max-h-72">
          <table className={`${SHEET_GRID_TABLE_CLASS} text-[10px] border-collapse min-w-[640px]`}>
            <SheetGridColgroup columnCount={11} />
            <thead className="sticky top-0 bg-[rgb(var(--surface-elevated))] z-10">
              <tr className="text-[9px] uppercase tracking-wide text-ink-muted">
                <th className={gridTh("left")}>Ticker</th>
                <th className={gridTh("left")}>Type</th>
                <th className={gridTh("center")}>Pos.</th>
                <th className={gridTh("center")}>slope5d</th>
                <th className={gridTh("center")}>slope20d</th>
                <th className={gridTh("center")}>Δ pp/d</th>
                <th className={gridTh("left")}>Regime</th>
                <th className={gridTh("center")}>T to CD</th>
                <th className={gridTh("left")}>Detected</th>
                <th className={gridTh("center")}>Outcome</th>
                <th className={gridTh("center")}>Actual P&L</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const cfg = KIND_LABEL[e.kind] ?? { icon: "❓", label: e.kind, cls: "text-ink-muted" };
                const statusIcon =
                  e.confirmed === null  ? <span className="text-[rgb(var(--warn))]">⏳ pending</span> :
                  e.confirmed === true  ? <span className="text-[rgb(var(--signal-up))]">✓ correct</span> :
                                          <span className="text-[rgb(var(--signal-down))]">✗ wrong</span>;
                const pnlCls =
                  e.actual_pnl_pct == null ? "text-ink-muted" :
                  e.actual_pnl_pct > 0     ? "text-[rgb(var(--signal-up))]" :
                                              "text-[rgb(var(--signal-down))]";
                return (
                  <tr
                    key={e.id}
                    className="border-t border-[rgb(var(--border))]/25 hover:bg-[rgb(var(--surface-3))]/15 transition-colors"
                  >
                    <td className={`${gridTd("left")} font-bold`}>{e.ticker}</td>
                    <td className={`${gridTd("left")} ${cfg.cls} font-medium`}>
                      {cfg.icon} {cfg.label}
                    </td>
                    <td className={gridTd("center")}>
                      {(() => {
                        const tag = openTag(e.had_open_position);
                        return (
                          <span
                            className={`text-[8px] px-1 py-0.5 rounded border font-medium uppercase tracking-wide ${tag.cls}`}
                            title={tag.title}
                          >
                            {tag.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className={`${gridTd("center")} text-[rgb(var(--signal-down))]`}>
                      {fmtSlope(e.slope5d)}
                    </td>
                    <td className={gridTd("center")}>
                      {fmtSlope(e.slope20d)}
                    </td>
                    <td className={`${gridTd("center")} text-[rgb(var(--warn))]`}>
                      {fmtSlope(e.delta_pp_per_day)}
                    </td>
                    <td className={`${gridTd("left")} text-ink-muted capitalize`}>{e.regime}</td>
                    <td className={`${gridTd("center")} text-ink-muted`}>
                      T−{Math.max(0, e.days_to_cd_at_detection)}
                    </td>
                    <td className={`${gridTd("left")} text-ink-muted whitespace-nowrap`}>
                      {fmtTs(e.detected_at)}
                    </td>
                    <td className={`${gridTd("center")} whitespace-nowrap text-[9px]`}>
                      {statusIcon}
                    </td>
                    <td className={`${gridTd("center")} ${pnlCls}`}>
                      {e.actual_pnl_pct != null ? (
                        <>
                          {e.actual_pnl_pct > 0 ? "+" : ""}{e.actual_pnl_pct.toFixed(1)}%
                          {e.actual_pnl_source === "proxy" && (
                            <span
                              className="ml-1 text-[8px] text-ink-muted/70"
                              title="Proxy P&L: stock price change since detection (no open position at the time)"
                            >
                              ~
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Raw JSON preview */}
      {events.length > 0 && (
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="text-[10px] text-ink-muted/60 hover:text-ink-muted transition flex items-center gap-1"
          >
            <span>{showRaw ? "▾" : "▸"}</span>
            <span>{showRaw ? "Hide" : "Show"} JSON preview</span>
          </button>
          {showRaw && (
            <pre className="text-[9px] leading-snug rounded-lg bg-[rgb(var(--surface-elevated))]/60 border border-[rgb(var(--border))]/40 p-3 overflow-auto max-h-56 text-ink-muted whitespace-pre-wrap">
              {rawJson.slice(0, 4000)}{rawJson.length > 4000 ? "\n…" : ""}
            </pre>
          )}
        </div>
      )}

      {/* Reset log (with confirmation) */}
      {events.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          {confirmClear ? (
            <>
              <span className="text-[10px] text-[rgb(var(--signal-down))]">
                All {events.length} events will be deleted. Confirm?
              </span>
              <button
                type="button"
                onClick={() => { clearSlopeLog(); reload(); setConfirmClear(false); }}
                className="text-[10px] px-2 py-0.5 rounded border border-[rgb(var(--signal-down))]/40 text-[rgb(var(--signal-down))] hover:bg-[rgb(var(--signal-down))]/8 transition"
              >
                Yes, delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="text-[10px] px-2 py-0.5 rounded border border-[rgb(var(--border))]/40 text-ink-muted hover:text-ink transition"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="text-[10px] text-ink-muted/40 hover:text-[rgb(var(--signal-down))] transition"
            >
              Clear log
            </button>
          )}
        </div>
      )}
    </div>
  );
}
