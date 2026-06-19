import { useMemo, useState } from "react";
import { FeedPanel, MobileRowCard, SegToggle } from "../components/MobileUi";
import { MobileSimTable } from "../components/MobileSimTable";
import { RefreshButton } from "../components/RefreshButton";
import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileDashboardSnapshot } from "../dashboardTypes";
import { fmtFeedDate } from "../mobileDashboard";
import { buildSimTableRows, countOpportunities, type OppHorizon } from "../mobileSimTableRows";
import type { InvestSimInputs, SheetTable } from "../types";

type Props = {
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  dashSnapshot: MobileDashboardSnapshot | null;
  inputsUpdatedAt: string | null;
  refreshLoading: boolean;
  lastUpdate: Date | null;
  onRefresh: () => void;
  onOpenDetail: (key: string) => void;
};

export function OpportunitiesView({
  sheet,
  inputs,
  dashSnapshot,
  inputsUpdatedAt,
  refreshLoading,
  lastUpdate,
  onRefresh,
  onOpenDetail,
}: Props) {
  const { lang, locale, t } = useMobileLang();
  const [horizon, setHorizon] = useState<OppHorizon>("primary");
  const rows = useMemo(() => buildSimTableRows(sheet, inputs, horizon), [sheet, inputs, horizon]);
  const totalOpps = countOpportunities(sheet, inputs);
  const aiFeed = (dashSnapshot?.aiFeed ?? []).slice(0, 3);

  const priceHint = inputsUpdatedAt
    ? new Date(inputsUpdatedAt).toLocaleString(locale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <>
      <div className="view-toolbar opp-toolbar">
        <SegToggle
          value={horizon}
          onChange={setHorizon}
          options={[
            { id: "primary", label: t("opportunities.primary") },
            { id: "early", label: t("opportunities.early") },
          ]}
        />
        <RefreshButton loading={refreshLoading} lastUpdate={lastUpdate} onClick={onRefresh} />
      </div>
      <p className="hint opp-meta-line">{t("opportunities.meta", { n: rows.length, when: priceHint })}</p>

      <FeedPanel title={t("opportunities.aiFeed.title")} subtitle={t("opportunities.aiFeed.sub")}>
        {aiFeed.length === 0 ? (
          <p className="hint">{t("opportunities.aiFeed.empty")}</p>
        ) : (
          aiFeed.map((row) => (
            <MobileRowCard
              key={row.id}
              ticker={row.ticker}
              title={row.title}
              badge={row.eis != null ? `EIS ${row.eis >= 0 ? "+" : ""}${row.eis.toFixed(1)}` : undefined}
              badgeTone={row.eis != null && row.eis >= 0 ? "up" : row.eis != null ? "down" : "neutral"}
              metaLeft={fmtFeedDate(row.eventDate, lang)}
              metaRight={
                row.delta1d != null
                  ? `T+1 ${row.delta1d >= 0 ? "▲" : "▼"} ${row.delta1d >= 0 ? "+" : ""}${row.delta1d.toFixed(1)}%`
                  : undefined
              }
            />
          ))
        )}
      </FeedPanel>

      <section className="opp-table-section">
        <h2 className="opp-table-title">{t("opportunities.tableTitle", { n: totalOpps })}</h2>
        <MobileSimTable rows={rows} onRowClick={onOpenDetail} />
      </section>
    </>
  );
}
