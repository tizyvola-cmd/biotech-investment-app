import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileDashboardSnapshot } from "../dashboardTypes";
import { ManualEisBadge, manualEisForTicker } from "../gainStarDisplay";
import { isMedtechTicker } from "../medtechSymbols";
import type { SimTableRow } from "../mobileSimTableRows";
import { StudyTypeIcon } from "./StudyTypeIcon";

function reliabTone(r: string): string {
  const u = r.toUpperCase();
  if (u === "HIGH") return "high";
  if (u === "GOOD") return "good";
  if (u === "MED") return "med";
  if (u === "LOW") return "low";
  return "neutral";
}

export function MobileSimTable({
  rows,
  dashSnapshot,
  onRowClick,
}: {
  rows: SimTableRow[];
  dashSnapshot?: MobileDashboardSnapshot | null;
  onRowClick: (key: string) => void;
}) {
  const { t } = useMobileLang();

  if (!rows.length) {
    return <p className="hint">{t("opportunities.emptyBand")}</p>;
  }

  return (
    <div className="sim-table-wrap">
      <table className="sim-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>RA</th>
            <th>CD</th>
            <th>Var</th>
            <th>ROI</th>
            <th>Reliab</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} onClick={() => onRowClick(r.key)}>
              <td>
                <span className="sim-ticker-cell">
                  {r.ticker}
                  <StudyTypeIcon ticker={r.ticker} size={12} />
                  {isMedtechTicker(r.ticker) ? (
                    <span className="sim-medtech-tag" title="MedTech">
                      MT
                    </span>
                  ) : null}
                  <ManualEisBadge row={manualEisForTicker(dashSnapshot?.manualEisByTicker, r.ticker)} />
                </span>
              </td>
              <td>{r.ra != null ? r.ra.toFixed(0) : "—"}</td>
              <td className="sim-cd-cell">{r.cd}</td>
              <td className={r.varPct != null && r.varPct >= 0 ? "tone-up" : "tone-down"}>
                {r.varPct != null ? `${r.varPct >= 0 ? "+" : ""}${r.varPct.toFixed(1)}%` : "—"}
              </td>
              <td>{r.roiPct != null ? `${r.roiPct.toFixed(0)}%` : "—"}</td>
              <td>
                <span className={`reliab-pill reliab-${reliabTone(r.reliab)}`}>{r.reliab}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
