import type { Trade } from "../types/trades";
import { useLang } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";

const ACTION_STYLE: Record<string, string> = {
  BUY: "bg-emerald-500/12 text-emerald-800 border-emerald-500/30",
  SELL: "bg-rose-500/12 text-rose-800 border-rose-500/30",
  HOLD: "bg-sky-500/12 text-sky-800 border-sky-500/30",
  REVIEW: "bg-amber-500/12 text-amber-800 border-amber-500/30",
};

function fmtEur(n: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function TradeTable({ trades }: { trades: Trade[] }) {
  const { lang } = useLang();
  const it = lang === "it";

  if (trades.length === 0) {
    return (
      <p className="tester-monitor-muted text-[10px] py-4 text-center">
        {it ? "Nessuna operazione paper ancora." : "No paper operations yet."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[rgb(var(--border))]/40">
      <table className={`${SHEET_GRID_TABLE_CLASS} text-[11px] min-w-[640px]`}>
        <thead className="bg-[rgb(var(--surface-elevated))]">
          <tr className="text-[10px] uppercase tracking-wide text-ink-muted/70">
            <th className={gridTh("left", "py-2")}>{it ? "Data" : "Date"}</th>
            <th className={gridTh("left", "py-2")}>Ticker</th>
            <th className={gridTh("center", "py-2")}>{it ? "Azione" : "Action"}</th>
            <th className={gridTh("right", "py-2")}>{it ? "Prezzo $" : "Price $"}</th>
            <th className={gridTh("right", "py-2")}>{it ? "Qtà" : "Qty"}</th>
            <th className={gridTh("right", "py-2")}>{it ? "Valore €" : "Value €"}</th>
            <th className={gridTh("right", "py-2")}>P&L €</th>
            <th className={gridTh("right", "py-2")}>P&L %</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((tr) => (
            <tr key={tr.id} className="border-t border-[rgb(var(--border))]/25 hover:bg-surface/50">
              <td className={`${gridTd("left")} py-1.5 tabular-nums text-ink-muted whitespace-nowrap`}>
                {tr.date}
              </td>
              <td className={`${gridTd("left")} py-1.5 font-semibold`}>{tr.ticker}</td>
              <td className={`${gridTd("center")} py-1.5`}>
                <span
                  className={`inline-flex text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${ACTION_STYLE[tr.action] ?? ""}`}
                >
                  {tr.action}
                </span>
              </td>
              <td className={`${gridTd("right")} py-1.5 tabular-nums`}>
                {tr.price != null ? `$${tr.price.toFixed(2)}` : "—"}
              </td>
              <td className={`${gridTd("right")} py-1.5 tabular-nums`}>
                {tr.qty != null ? tr.qty.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}
              </td>
              <td className={`${gridTd("right")} py-1.5 tabular-nums font-medium`}>
                {fmtEur(tr.value)}
              </td>
              <td className={`${gridTd("right")} py-1.5 tabular-nums font-semibold`}>
                {tr.pnl == null ? (
                  <span className="text-ink-muted/50">—</span>
                ) : (
                  <span className={tr.pnl >= 0 ? "text-emerald-700" : "text-rose-700"}>
                    {tr.pnl >= 0 ? "+" : ""}
                    {fmtEur(tr.pnl)}
                  </span>
                )}
              </td>
              <td className={`${gridTd("right")} py-1.5 tabular-nums`}>
                {tr.pnlPct != null && tr.action === "SELL" ? (
                  <span className={tr.pnlPct >= 0 ? "text-emerald-700" : "text-rose-700"}>
                    {tr.pnlPct >= 0 ? "+" : ""}
                    {tr.pnlPct.toFixed(1)}%
                  </span>
                ) : tr.pnlPct != null && tr.action === "BUY" ? (
                  <span className="text-ink-muted">
                    {tr.pnlPct >= 0 ? "+" : ""}
                    {tr.pnlPct.toFixed(1)}% MTM
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
