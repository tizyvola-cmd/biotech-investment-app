import { useMemo } from "react";
import { VariationHorizonSparkline } from "../components/VariationHorizonSparkline";
import { RefreshButton } from "../components/RefreshButton";
import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileDashboardSnapshot } from "../dashboardTypes";
import { buildPortfolioCheckRows, type PortfolioCheckRow } from "../mobilePortfolioTable";
import { TickerGainAndManualMarks } from "../gainStarDisplay";
import { fmtEur, fmtPct } from "../simLogic";
import type { InvestSimInputs, SheetTable } from "../types";

type Props = {
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  dashSnapshot: MobileDashboardSnapshot | null;
  refreshLoading: boolean;
  lastUpdate: Date | null;
  onRefresh: () => void;
  onOpenOpportunity: (key: string) => void;
  onOpenDetail: (key: string) => void;
};

function verdictClass(v: PortfolioCheckRow["verdict"]): string {
  const map: Record<PortfolioCheckRow["verdict"], string> = {
    RISE: "verdict-rise",
    DROP: "verdict-drop",
    WATCH: "verdict-watch",
    FLAT: "verdict-flat",
    REVIEW: "verdict-review",
  };
  return map[v];
}

function AssessmentBlock({
  row,
  dashSnapshot,
  onOpenOpportunity,
  onOpenDetail,
}: {
  row: PortfolioCheckRow;
  dashSnapshot: MobileDashboardSnapshot | null;
  onOpenOpportunity: () => void;
  onOpenDetail: () => void;
}) {
  const { t } = useMobileLang();
  const rec = dashSnapshot?.recommendations?.find((r) => r.key === row.key);
  return (
    <article className="card assessment-block">
      <button type="button" className="assessment-block-tap" onClick={onOpenOpportunity}>
        <div className="assessment-block-head">
          <div>
            <strong>{row.ticker}</strong>
            <TickerGainAndManualMarks
              ticker={row.ticker}
              dashSnapshot={dashSnapshot}
              className="assessment-gain-stars"
            />
            <span className={`verdict-pill ${verdictClass(row.verdict)}`}>{row.verdict}</span>
          </div>
          <span className="assessment-ppi">
            PPI {row.ppi != null ? Math.round(row.ppi) : "—"}
            {row.verdictProbPct != null ? ` · ${row.verdictProbPct}%` : ""}
          </span>
        </div>
        <div className="assessment-metrics">
          <div>
            <span className="metric-label">1d</span>
            <span>{fmtPct(row.mv1d)}</span>
          </div>
          <div>
            <span className="metric-label">1w</span>
            <span>{fmtPct(row.mv1w)}</span>
          </div>
          <div>
            <span className="metric-label">P&L</span>
            <span className={row.pos.pnlEur >= 0 ? "tone-up" : "tone-down"}>
              {fmtEur(row.pos.pnlEur)} ({fmtPct(row.pos.pnlPct)})
            </span>
          </div>
          <div>
            <span className="metric-label">ROI→CD</span>
            <span>
              {row.roiTarget != null ? fmtPct(row.roiTarget) : "—"}
              {row.roiTargetDays != null ? ` · ${row.roiTargetDays}d` : ""}
            </span>
          </div>
        </div>
        <VariationHorizonSparkline d1={row.mv1d} d7={row.mv1w} m1={row.mv1m} />
        {rec?.reason ? <p className="hint assessment-reason">{rec.reason}</p> : null}
      </button>
      <div className="btn-row assessment-actions">
        <button type="button" className="btn btn-primary" onClick={onOpenOpportunity}>
          {t("assessment24h.openCard")}
        </button>
        <button type="button" className="btn btn-outline" onClick={onOpenDetail}>
          {t("assessment24h.editSim")}
        </button>
      </div>
    </article>
  );
}

export function Assessment24hView({
  sheet,
  inputs,
  dashSnapshot,
  refreshLoading,
  lastUpdate,
  onRefresh,
  onOpenOpportunity,
  onOpenDetail,
}: Props) {
  const { t } = useMobileLang();
  const enrich = useMemo(
    () => ({
      portfolioCheck: dashSnapshot?.portfolioCheck,
      recommendations: dashSnapshot?.recommendations,
    }),
    [dashSnapshot],
  );
  const checkRows = useMemo(
    () => buildPortfolioCheckRows(sheet, inputs, enrich),
    [sheet, inputs, enrich],
  );

  return (
    <>
      <div className="view-toolbar">
        <RefreshButton loading={refreshLoading} lastUpdate={lastUpdate} onClick={onRefresh} />
      </div>
      <p className="hint assessment-intro">{t("assessment24h.intro")}</p>
      {checkRows.length === 0 ? (
        <p className="hint">{t("assessment24h.empty")}</p>
      ) : (
        checkRows.map((row) => (
          <AssessmentBlock
            key={row.key}
            row={row}
            dashSnapshot={dashSnapshot}
            onOpenOpportunity={() => onOpenOpportunity(row.key)}
            onOpenDetail={() => onOpenDetail(row.key)}
          />
        ))
      )}
    </>
  );
}
