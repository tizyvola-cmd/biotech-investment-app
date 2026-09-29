/**
 * ContrarianLogPanel — displays and downloads the JSON log of contrarian events.
 *
 * A contrarian event = slope5d and pred5 point in opposite directions.
 * Tracks whether the model or the curve was right → useful for calibrating
 * the weight of the slopeAlign factor in the score.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildExportContrarianLog,
  clearContrarianLog,
  downloadContrarianLog,
  loadContrarianLog,
  type ContrarianEventRecord,
} from "../sheet/contrarianLog";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function fmtPp(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

type FilterStatus = "all" | "pending" | "model_won" | "curve_won";

// ── component ─────────────────────────────────────────────────────────────────

export function ContrarianLogPanel() {
  const [events, setEvents]       = useState<ContrarianEventRecord[]>([]);
  const [filter, setFilter]       = useState<FilterStatus>("all");
  const [showRaw, setShowRaw]     = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const reload = useCallback(() => {
    setEvents(loadContrarianLog().events);
  }, []);

  useEffect(() => {
    reload();
    const id = setInterval(reload, 30_000);
    return () => clearInterval(id);
  }, [reload]);

  // ── statistics ─────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const pending   = events.filter((e) => e.confirmed === null).length;
    const resolved  = events.filter((e) => e.confirmed !== null);
    const modelWon  = resolved.filter((e) => e.confirmed === true).length;
    const curveWon  = resolved.filter((e) => e.confirmed === false).length;
    const modelAcc  = resolved.length > 0 ? Math.round((modelWon / resolved.length) * 100) : null;

    const byType = {
      modelUp:   events.filter((e) => e.divergence_type === "model_up").length,
      modelDown: events.filter((e) => e.divergence_type === "model_down").length,
    };

    return { total: events.length, pending, modelWon, curveWon, modelAcc, byType };
  }, [events]);

  // ── filter ─────────────────────────────────────────────────────────────────

  const visible = useMemo(() => {
    if (filter === "pending")   return events.filter((e) => e.confirmed === null);
    if (filter === "model_won") return events.filter((e) => e.confirmed === true);
    if (filter === "curve_won") return events.filter((e) => e.confirmed === false);
    return events;
  }, [events, filter]);

  // ── export raw JSON ────────────────────────────────────────────────────────

  const rawJson = useMemo(
    () => showRaw ? JSON.stringify(buildExportContrarianLog(), null, 2) : "",
    [showRaw, events], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3 text-xs">

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold">
            🔀 Slope ↔ pred divergence log (contrarian setup)
          </p>
          <p className="text-[10px] text-ink-muted/70 leading-snug mt-0.5">
            Records every time slope5d and pred5 point in opposite directions.
            Tracks who was right (model vs curve) to calibrate the weight of the
            <code className="mx-1 px-1 rounded bg-[rgb(var(--surface-elevated))]/60">slopeAlign</code>
            factor in the score.
          </p>
        </div>
        <button
          type="button"
          onClick={downloadContrarianLog}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgb(var(--accent))]/15 text-[rgb(var(--accent))] text-[11px] font-semibold hover:bg-[rgb(var(--accent))]/25 transition"
        >
          ⬇ Download JSON
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: "Total",    value: stats.total,    cls: "text-ink" },
          { label: "Pending",  value: stats.pending,  cls: "text-[rgb(var(--warn))]" },
          { label: "Model ✓",  value: stats.modelWon, cls: "text-[rgb(var(--signal-up))]" },
          { label: "Curve ✓",  value: stats.curveWon, cls: "text-[rgb(var(--signal-down))]" },
        ].map(({ label, value, cls }) => (
          <div key={label} className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/40 px-3 py-2">
            <p className={`text-xl font-bold tabular-nums ${cls}`}>{value}</p>
            <p className="text-[9px] text-ink-muted leading-tight mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Type breakdown */}
      {events.length > 0 && (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-lg border border-[rgb(var(--border))]/30 bg-surface/30 px-3 py-1.5 flex items-center gap-2">
            <span className="text-base">🟦</span>
            <div>
              <p className="font-semibold text-[rgb(var(--signal-up))]">{stats.byType.modelUp}</p>
              <p className="text-ink-muted leading-tight">pred ↑ but slope ↓ (optimistic model)</p>
            </div>
          </div>
          <div className="rounded-lg border border-[rgb(var(--border))]/30 bg-surface/30 px-3 py-1.5 flex items-center gap-2">
            <span className="text-base">🟥</span>
            <div>
              <p className="font-semibold text-[rgb(var(--signal-down))]">{stats.byType.modelDown}</p>
              <p className="text-ink-muted leading-tight">pred ↓ but slope ↑ (pessimistic model)</p>
            </div>
          </div>
        </div>
      )}

      {/* Model vs curve accuracy */}
      {stats.modelAcc !== null && (
        <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${
          stats.modelAcc >= 55
            ? "border-[rgb(var(--signal-up))]/35 bg-[rgb(var(--signal-up))]/5"
            : stats.modelAcc >= 45
            ? "border-[rgb(var(--warn))]/35 bg-[rgb(var(--warn))]/5"
            : "border-[rgb(var(--signal-down))]/35 bg-[rgb(var(--signal-down))]/5"
        }`}>
          <span className="text-lg shrink-0">
            {stats.modelAcc >= 55 ? "🤖" : stats.modelAcc >= 45 ? "⚖️" : "📉"}
          </span>
          <div>
            <p className="font-semibold text-[11px]">
              Model beats curve in {stats.modelAcc}% of contrarian setups
            </p>
            <p className="text-[10px] text-ink-muted">
              over {stats.modelWon + stats.curveWon} resolved events ·{" "}
              {stats.modelAcc >= 55
                ? "the model is reliable despite the contrary curve → slopeAlign penalty can be reduced"
                : stats.modelAcc >= 45
                ? "model and curve are equivalent → current penalty is correctly calibrated"
                : "the curve beats the model → increase the slopeAlign penalty in the score"}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      {events.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(["all", "pending", "model_won", "curve_won"] as FilterStatus[]).map((f) => {
            const labels: Record<FilterStatus, string> = {
              all:       `All (${stats.total})`,
              pending:   `Pending (${stats.pending})`,
              model_won: `🤖 Model ✓ (${stats.modelWon})`,
              curve_won: `📈 Curve ✓ (${stats.curveWon})`,
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
          <p className="text-2xl">🔀</p>
          <p className="text-[11px] font-medium text-ink-muted">No contrarian events recorded</p>
          <p className="text-[10px] text-ink-muted/60 leading-snug">
            Events are added automatically when slope5d and pred5 point
            in opposite directions (|pred5| ≥ 1 pp) on a ticker with CD in the next 60 days.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-[10px] text-ink-muted py-4 text-center">
          No events with filter "{filter}".
        </p>
      ) : (
        <div className="overflow-auto rounded-lg border border-[rgb(var(--border))]/50 max-h-72">
          <table className={`${SHEET_GRID_TABLE_CLASS} text-[10px] border-collapse min-w-[600px]`}>
            <SheetGridColgroup columnCount={9} />
            <thead className="sticky top-0 bg-[rgb(var(--surface-elevated))] z-10">
              <tr className="text-[9px] uppercase tracking-wide text-ink-muted">
                <th className={gridTh("left")}>Ticker</th>
                <th className={gridTh("left")}>Type</th>
                <th className={gridTh("center")}>slope5d</th>
                <th className={gridTh("center")}>pred5</th>
                <th className={gridTh("left")}>Regime</th>
                <th className={gridTh("center")}>T to CD</th>
                <th className={gridTh("left")}>Detected</th>
                <th className={gridTh("center")}>Outcome</th>
                <th className={gridTh("center")}>Actual P&L</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const isModelUp = e.divergence_type === "model_up";
                const statusIcon =
                  e.confirmed === null  ? <span className="text-[rgb(var(--warn))]">⏳ pending</span>   :
                  e.confirmed === true  ? <span className="text-[rgb(var(--signal-up))]">🤖 model</span> :
                                          <span className="text-[rgb(var(--signal-down))]">📈 curve</span>;
                const pnlCls =
                  e.actual_pnl_pct == null ? "text-ink-muted" :
                  e.actual_pnl_pct > 0    ? "text-[rgb(var(--signal-up))]" :
                                             "text-[rgb(var(--signal-down))]";
                return (
                  <tr
                    key={e.id}
                    className="border-t border-[rgb(var(--border))]/25 hover:bg-[rgb(var(--surface-3))]/15 transition-colors"
                  >
                    <td className={`${gridTd("left")} font-bold`}>{e.ticker}</td>
                    <td className={gridTd("left")}>
                      <span className={`font-medium ${isModelUp ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--signal-down))]"}`}>
                        {isModelUp ? "🟦 pred↑ slope↓" : "🟥 pred↓ slope↑"}
                      </span>
                    </td>
                    <td className={`${gridTd("center")} ${e.slope5d >= 0 ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--signal-down))]"}`}>
                      {fmtPp(e.slope5d)}
                    </td>
                    <td className={`${gridTd("center")} font-semibold ${e.pred5 >= 0 ? "text-[rgb(var(--signal-up))]" : "text-[rgb(var(--signal-down))]"}`}>
                      {e.pred5 >= 0 ? "▲ " : "▼ "}{Math.abs(e.pred5).toFixed(1)}%
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
                      {e.actual_pnl_pct != null
                        ? `${e.actual_pnl_pct > 0 ? "+" : ""}${e.actual_pnl_pct.toFixed(1)}%`
                        : "—"}
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

      {/* Reset log */}
      {events.length > 0 && (
        <div className="flex items-center justify-end gap-2">
          {confirmClear ? (
            <>
              <span className="text-[10px] text-[rgb(var(--signal-down))]">
                All {events.length} events will be deleted. Confirm?
              </span>
              <button
                type="button"
                onClick={() => { clearContrarianLog(); reload(); setConfirmClear(false); }}
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
