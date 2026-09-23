/**
 * Home header: Portfolio P&L summary tiles + allocated capital.
 * Display only — does not change Soft BUY/SELL.
 */
import { resolveCapCycleKpiDisplay } from "../sheet/experimentCashFlow";
import { portfolioPnlAccentClass } from "../sheet/portfolioGainLossStyle";
import type { DashboardPulseData } from "../sheet/dashboardPulseView";
import { useLang, useT } from "../shared/i18n";
import { fmtPulseEur, fmtPulsePct } from "./PortfolioGainPlanAggregateChart";

function SummaryTile({
  label,
  value,
  sub,
  accentClass,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  accentClass?: string;
  title?: string;
}) {
  return (
    <div
      className="rounded-xl border border-[rgb(var(--panel-mint-border))]/55 bg-white/90 px-3 py-2 min-w-[7.5rem] flex-1"
      title={title}
    >
      <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted/85">
        {label}
      </p>
      <p className={`text-base font-bold tabular-nums mt-0.5 leading-snug ${accentClass ?? "text-ink"}`}>
        {value}
      </p>
      {sub ? (
        <p className="text-[11px] text-ink-muted mt-0.5 tabular-nums leading-snug">{sub}</p>
      ) : null}
    </div>
  );
}

export function PortfolioPnlSummaryBlock({
  data,
}: {
  data: DashboardPulseData;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";
  const totals = data.portfolioTotals;
  const capCycle = resolveCapCycleKpiDisplay(
    {
      capitalInOpenEur: totals.capitalInOpenEur ?? totals.capital ?? 0,
      gainsRecycledInOpenEur: totals.gainsRecycledInOpenEur ?? 0,
      capitalNotFromGainsEur: totals.capitalNotFromGainsEur ?? 0,
      closedDealCount: totals.closedCount ?? 0,
    },
    t,
    fmtPulseEur,
  );

  return (
    <div className="shrink-0 min-w-0 flex flex-col gap-2">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--panel-feed-accent-strong))] mb-1.5">
          {t("dashboard.pulse.kpiTitle")}
        </p>
        <div className="flex flex-wrap gap-2">
          <SummaryTile
            label={it ? "Gain open (MTM)" : "Gain open (MTM)"}
            value={fmtPulseEur(totals.pnlEur)}
            sub={fmtPulsePct(totals.pnlPct)}
            accentClass={portfolioPnlAccentClass(totals.pnlEur)}
            title={
              it
                ? "P&L mark-to-market sulle posizioni aperte"
                : "Mark-to-market P&L on open positions"
            }
          />
          <SummaryTile
            label={it ? "Gain 24h" : "Gain 24h"}
            value={totals.todayCovered > 0 ? fmtPulseEur(totals.pnlEurToday) : "—"}
            sub={totals.todayCovered === 0 ? (it ? "mercato chiuso" : "market closed") : undefined}
            accentClass={
              totals.todayCovered > 0 ? portfolioPnlAccentClass(totals.pnlEurToday) : undefined
            }
            title={t("dashboard.pulse.pnl24hTip")}
          />
          <SummaryTile
            label={it ? "Δ visita" : "Δ visit"}
            value={
              data.deltaPortfolioPnlSinceVisit != null
                ? fmtPulseEur(data.deltaPortfolioPnlSinceVisit)
                : "—"
            }
            sub={
              data.deltaPortfolioPnlSinceVisit == null
                ? it
                  ? "prima visita"
                  : "first visit"
                : undefined
            }
            accentClass={
              data.deltaPortfolioPnlSinceVisit != null
                ? portfolioPnlAccentClass(data.deltaPortfolioPnlSinceVisit)
                : undefined
            }
            title={
              it ? "Variazione P&L dall'ultima visita" : "P&L change since last visit"
            }
          />
          <SummaryTile
            label={it ? "Gain closed" : "Gain closed"}
            value={fmtPulseEur(totals.closedPnlEur)}
            sub={
              totals.closedPiggyHasBaseline && totals.closedPnlEurSinceReset != null
                ? it
                  ? `storico · dal reset ${fmtPulseEur(totals.closedPnlEurSinceReset)}`
                  : `all-time · since reset ${fmtPulseEur(totals.closedPnlEurSinceReset)}`
                : it
                  ? `${totals.closedCount} pos. chiuse`
                  : `${totals.closedCount} closed pos.`
            }
            accentClass={portfolioPnlAccentClass(totals.closedPnlEur)}
            title={
              it
                ? "P&L realizzato totale sulle posizioni già vendute (all-time)"
                : "All-time realized P&L on sold positions"
            }
          />
        </div>
      </div>

      <div
        className="rounded-xl border border-teal-300/70 bg-teal-50/50 px-3.5 py-2.5"
        title={t("pulse.capCycle.tip")}
      >
        <p className="text-[11px] uppercase tracking-wide font-semibold text-teal-800/80">
          {t("pulse.capCycle.label")}
        </p>
        <p className="text-lg font-bold tabular-nums text-ink mt-0.5 leading-tight">
          {capCycle.value}
        </p>
        {capCycle.sub ? (
          <p className="text-[11px] text-ink-muted mt-0.5 tabular-nums leading-snug">
            {capCycle.sub}
          </p>
        ) : null}
      </div>
    </div>
  );
}
