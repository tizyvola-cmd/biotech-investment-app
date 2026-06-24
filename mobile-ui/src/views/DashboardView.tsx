import { useMemo } from "react";
import { FeedPanel, HeroKpi, LinkAction, MobileRowCard } from "../components/MobileUi";
import { MobileActionsTable } from "../components/MobileActionsTable";
import { MobilePiggyBank } from "../components/MobilePiggyBank";
import { RefreshButton } from "../components/RefreshButton";
import { ThemeToggle } from "../components/ThemeToggle";
import { useMobileLang } from "../hooks/useMobileLang";
import type { MobileDashboardSnapshot } from "../dashboardTypes";
import type { MobileTheme } from "../hooks/useTheme";
import { enrichRecommendationRows } from "../mobileActionsTable";
import { buildChartPointsByKey } from "../mobileCurveChartsBuild";
import { recommendationsForMode, snapshotAgeLabel, upcomingForMode } from "../mobileDashboard";
import { portfolioSummary } from "../mobilePortfolioTable";
import { buildMobileOpportunities } from "../opportunityLogic";
import { fmtUsd, buildPositions } from "../simLogic";
import type { ChartBundle, InvestSimInputs, SheetTable } from "../types";

type Props = {
  sheet: SheetTable | null;
  inputs: InvestSimInputs;
  dashSnapshot: MobileDashboardSnapshot | null;
  chartBundle?: ChartBundle | null;
  refreshLoading: boolean;
  lastUpdate: Date | null;
  theme: MobileTheme;
  onToggleTheme: () => void;
  onRefresh: () => void;
  onOpenDetail: (key: string) => void;
  onGoPortfolio: () => void;
  onGoOpportunities: () => void;
  simTableVersion?: string;
  priceReadingRevision?: number;
};

export function DashboardView({
  sheet,
  inputs,
  dashSnapshot,
  chartBundle = null,
  refreshLoading,
  lastUpdate,
  theme,
  onToggleTheme,
  onRefresh,
  onOpenDetail,
  onGoPortfolio,
  onGoOpportunities,
  simTableVersion = "",
  priceReadingRevision = 0,
}: Props) {
  const { lang, t } = useMobileLang();
  const opportunities = buildMobileOpportunities(sheet, inputs);
  const summary = portfolioSummary(sheet, inputs);
  const positions = buildPositions(sheet, inputs).filter((p) => p.capital > 0);
  const dashHero = dashSnapshot?.hero;
  const chartPointsByKey = useMemo(
    () => buildChartPointsByKey(sheet, chartBundle),
    [sheet, chartBundle],
  );
  const dashRecs = useMemo(
    () =>
      enrichRecommendationRows(recommendationsForMode(dashSnapshot, "all"), sheet, inputs, {
        simTableVersion,
        chartPointsByKey,
        lang,
      }),
    [dashSnapshot, sheet, inputs, simTableVersion, priceReadingRevision, chartPointsByKey, lang],
  );
  const dashUpcoming = upcomingForMode(dashSnapshot, sheet, inputs, "portfolio").slice(0, 3);
  const syncLabel = snapshotAgeLabel(dashSnapshot?.updated_at, lang);
  const nextCdDays = dashHero?.nextCdDaysPortfolio ?? null;

  return (
    <>
      <div className="view-toolbar">
        <RefreshButton loading={refreshLoading} lastUpdate={lastUpdate} onClick={onRefresh} />
        {syncLabel ? <span className="snapshot-age">{syncLabel}</span> : null}
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <div className="hero-kpi-grid">
        <HeroKpi
          label={t("dashboard.kpi.portfolioOpp")}
          value={`${dashHero?.portfolioCount ?? summary.count} / ${dashHero?.opportunityCount ?? opportunities.hot.length}`}
          accent="accent"
        />
        <HeroKpi
          label={t("dashboard.kpi.totalCapital")}
          value={fmtUsd(dashHero?.totalCapital ?? summary.capital, 0).replace("$", "€")}
          accent="accent"
        />
        <HeroKpi
          label={t("dashboard.kpi.nextCatalyst")}
          value={nextCdDays != null ? `${nextCdDays} d` : "—"}
          accent={nextCdDays != null && nextCdDays <= 7 ? "warn" : undefined}
          sub={nextCdDays != null && nextCdDays <= 7 ? t("dashboard.kpi.imminent") : undefined}
        />
        <HeroKpi
          label={t("dashboard.kpi.topAiFeed")}
          value={String(dashHero?.aiFeedRecentCount ?? 0)}
          sub={t("dashboard.kpi.aiFeedSub")}
          accent="accent"
        />
      </div>

      <MobilePiggyBank
        positions={positions}
        inputs={inputs}
        totalPnl={summary.pnl}
        totalPnlPct={summary.pnlPct}
        pnl24h={summary.pnl24h}
        pnl24hPct={summary.pnl24hPct}
        capital={summary.capital}
      />

      <MobileActionsTable rows={dashRecs} sheet={sheet} inputs={inputs} onOpenDetail={onOpenDetail} />

      {!dashSnapshot?.updated_at && dashRecs.length === 0 ? (
        <p className="hint actions-sync-hint">{t("dashboard.actions.syncHint")}</p>
      ) : null}

      <FeedPanel title={t("dashboard.upcoming.title")} subtitle={t("dashboard.upcoming.sub")}>
        {dashUpcoming.length === 0 ? (
          <p className="hint">{t("dashboard.upcoming.empty")}</p>
        ) : (
          dashUpcoming.map((row) => (
            <MobileRowCard
              key={row.ticker + row.cd}
              ticker={row.ticker}
              title={row.companyName ?? undefined}
              badge={row.days != null ? `${row.days}d` : "—"}
              badgeTone={row.days != null && row.days <= 7 ? "hot" : "neutral"}
              metaLeft={row.cd}
              externalLink={
                row.studyHref
                  ? {
                      href: row.studyHref,
                      label: row.nct
                        ? t("dashboard.upcoming.nctLink", { nct: row.nct })
                        : t("dashboard.upcoming.studyLink"),
                    }
                  : undefined
              }
            />
          ))
        )}
      </FeedPanel>

      <div className="dash-footer-links">
        <LinkAction label={t("dashboard.footer.portfolio")} onClick={onGoPortfolio} />
        <LinkAction label={t("dashboard.footer.opportunities")} onClick={onGoOpportunities} />
      </div>
    </>
  );
}
