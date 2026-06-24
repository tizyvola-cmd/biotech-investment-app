export type PulseMovementLogRow = {
  key: string;
  ticker: string;
  pnlEur: number;
  pnlPct: number | null;
  deltaPnlEurSinceVisit: number | null;
  investedAt: string | null;
  reason?: string | null;
};

function formatEntryDate(iso: string | null, it: boolean): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString(it ? "it-IT" : "en-GB", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      });
}

/** Compact movement log — same layout as Portfolio pulse KPI column. */
export function PulseOpenPositionsMovementLog({
  rows,
  it,
  summaryLabel,
}: {
  rows: PulseMovementLogRow[];
  it: boolean;
  /** e.g. "Open positions (16)" — defaults to count-only label. */
  summaryLabel?: string;
}) {
  if (!rows.length) return null;

  const label =
    summaryLabel ??
    (it ? `Posizioni aperte (${rows.length})` : `Open positions (${rows.length})`);

  return (
    <details className="rounded-lg border border-[rgb(var(--panel-feed-border))]/35 bg-white/60 min-w-0">
      <summary className="cursor-pointer select-none list-none px-3 py-1.5 flex items-center gap-2 hover:bg-[rgb(var(--panel-feed-row-hover))]/20 transition-colors [&::-webkit-details-marker]:hidden">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--panel-feed-accent-strong))]/70 flex-1">
          {label}
        </span>
        <span className="text-[11px] text-ink-muted">▼</span>
      </summary>
      <table className="w-full text-xs border-collapse">
        <tbody>
          {rows.map((row) => {
            const pnlClass =
              row.pnlEur >= 0
                ? "text-[rgb(var(--signal-up))]"
                : "text-[rgb(var(--signal-down))]";
            const deltaClass =
              row.deltaPnlEurSinceVisit == null
                ? "text-ink-muted"
                : row.deltaPnlEurSinceVisit >= 0
                  ? "text-[rgb(var(--signal-up))]"
                  : "text-[rgb(var(--signal-down))]";
            const reason = row.reason?.trim() ?? "";
            return (
              <tr
                key={row.key}
                className="border-t border-[rgb(var(--panel-feed-border))]/15 hover:bg-[rgb(var(--panel-feed-row-hover))]/20"
              >
                <td className="px-2 py-1 text-ink-muted tabular-nums whitespace-nowrap">
                  {formatEntryDate(row.investedAt, it)}
                </td>
                <td className="px-2 py-1 font-semibold text-ink">{row.ticker}</td>
                <td className={`px-2 py-1 text-right tabular-nums font-semibold ${pnlClass}`}>
                  {row.pnlEur >= 0 ? "+" : ""}€
                  {Math.round(row.pnlEur).toLocaleString(it ? "it-IT" : "en-GB")}
                  {row.pnlPct != null ? (
                    <span className="ml-1 text-[11px] font-normal opacity-70">
                      {row.pnlPct >= 0 ? "+" : ""}
                      {row.pnlPct.toFixed(1)}%
                    </span>
                  ) : null}
                </td>
                <td className={`px-2 py-1 text-right tabular-nums ${deltaClass}`}>
                  {row.deltaPnlEurSinceVisit != null
                    ? `${row.deltaPnlEurSinceVisit >= 0 ? "+" : ""}€${Math.round(row.deltaPnlEurSinceVisit).toLocaleString(it ? "it-IT" : "en-GB")}`
                    : "—"}
                </td>
                {reason ? (
                  <td className="px-2 py-1 text-ink-muted truncate max-w-[8rem]" title={reason}>
                    {reason}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

export function movementLogRowFromGainPlan(args: {
  key: string;
  ticker: string;
  pnlEur: number;
  pnlPct: number | null;
  deltaPnlEurSinceVisit: number | null;
  investedAt: string | null;
  simRow?: Record<string, unknown> | null;
}): PulseMovementLogRow {
  const reason = String(
    args.simRow?.["Motivo"] ?? args.simRow?.["reason"] ?? "",
  ).trim();
  return {
    key: args.key,
    ticker: args.ticker,
    pnlEur: args.pnlEur,
    pnlPct: args.pnlPct,
    deltaPnlEurSinceVisit: args.deltaPnlEurSinceVisit,
    investedAt: args.investedAt,
    reason: reason || null,
  };
}
