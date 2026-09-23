import { useMobileLang } from "../hooks/useMobileLang";
import type { MobilePickStockRow } from "../mobilePickStocks";
import { fmtPct } from "../simLogic";

type Props = {
  rows: MobilePickStockRow[];
  onOpenRow?: (key: string) => void;
};

export function MobilePickStocksPanel({ rows, onOpenRow }: Props) {
  const { t } = useMobileLang();
  if (!rows.length) {
    return (
      <section className="card pick-stocks-panel">
        <h2>{t("pickStocks.title")}</h2>
        <p className="hint">{t("pickStocks.empty")}</p>
      </section>
    );
  }
  return (
    <section className="card pick-stocks-panel">
      <h2>{t("pickStocks.title")}</h2>
      <p className="hint pick-stocks-sub">{t("pickStocks.sub")}</p>
      <div className="pick-stocks-table-wrap">
        <table className="pick-stocks-table">
          <thead>
            <tr>
              <th>{t("pickStocks.col.ticker")}</th>
              <th>T−CD</th>
              <th>Pred+5</th>
              <th>Plan</th>
              <th>ROI/d</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.key}
                className={onOpenRow ? "pick-row-clickable" : undefined}
                onClick={onOpenRow ? () => onOpenRow(r.key) : undefined}
              >
                <td>
                  <strong>{r.ticker}</strong>
                  <span className={`zone-pill zone-${r.zone}`}>{r.zone}</span>
                </td>
                <td>{r.daysToCd != null ? `${r.daysToCd}d` : "—"}</td>
                <td>{r.pred5 != null ? fmtPct(r.pred5) : "—"}</td>
                <td>{r.planReturnPct != null ? fmtPct(r.planReturnPct) : "—"}</td>
                <td>{r.roiPerDay != null ? r.roiPerDay.toFixed(2) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
