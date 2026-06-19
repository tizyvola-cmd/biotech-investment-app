import { useCallback, useEffect, useState } from "react";
import type { InvestSimHistoryPoint } from "../sheet/investSimStorage";
import type { DashboardPulseData, PulseDirection } from "../sheet/dashboardPulseView";
import { portfolioPnlAccentClass, portfolioPnlTabShellClass, portfolioPnlTone } from "../sheet/portfolioGainLossStyle";
import { useLang, useT } from "../shared/i18n";
import { GainPlanMicroSparkline } from "./GainPlanMicroSparkline";
import {
  fmtPulseEur,
  fmtPulsePct,
  PortfolioGainPlanAggregateChart,
} from "./PortfolioGainPlanAggregateChart";
import { SdsScoreCompactCell } from "./SdsScoreCompactCell";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import type { ChartBundle, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { useLossRiskCatalog, lookupLossRisk } from "../hooks/useLossRiskCatalog";
import {
  LossRiskBreakdownModal,
  type LossRiskEntry,
} from "./LossRiskPoopCell";
import {
  RiskBenefitScaleCell,
  deriveBenefitFillPct,
} from "./RiskBenefitScaleIcon";
import { PortfolioBriefcaseMark, PortfolioTickerMark } from "./PortfolioScopeToggle";
import type { PulseScope } from "./PulseScopeSwitcher";
import { PulseScopeSwitcher } from "./PulseScopeSwitcher";
import { hydrateUiPrefsFromDisk, loadUiPrefsLocal, saveUiPrefs } from "../sheet/uiPrefs";

function directionGlyph(d: PulseDirection): string {
  if (d === "up") return "↑";
  if (d === "down") return "↓";
  return "→";
}

function directionClass(d: PulseDirection): string {
  if (d === "up") return "text-[rgb(var(--signal-up))]";
  if (d === "down") return "text-[rgb(var(--signal-down))]";
  return "text-ink-muted";
}

function formatVisitAgo(iso: string | null, lang: "it" | "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffH = Math.round((Date.now() - d.getTime()) / 3600000);
  if (diffH < 1) return lang === "it" ? "<1h fa" : "<1h ago";
  if (diffH < 48) return lang === "it" ? `${diffH}h fa` : `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return lang === "it" ? `${diffD}g fa` : `${diffD}d ago`;
}

function KpiTile({
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
      <p className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted/85">{label}</p>
      <p className={`text-base font-bold tabular-nums mt-0.5 leading-tight ${accentClass ?? "text-ink"}`}>
        {value}
      </p>
      {sub ? <p className="text-[10px] text-ink-muted mt-0.5 tabular-nums">{sub}</p> : null}
    </div>
  );
}

export function DashboardPulseTable({
  data,
  history,
  simTable,
  sdsRows,
  chartBundle,
  reloadToken,
  onOpenSimulationRow,
  onOpen24hAssessment,
  onOpenSupernovaTab,
  pulseScope,
  onPulseScopeChange,
}: {
  data: DashboardPulseData;
  history: InvestSimHistoryPoint[];
  /** Live sim sheet — feeds the loss-risk catalog (Risk & Benefit column). */
  simTable: SheetTable | null;
  sdsRows: SdsRow[] | null | undefined;
  chartBundle: ChartBundle | null;
  /** Bumps invalidate the loss-risk catalog after a refresh. */
  reloadToken?: number;
  onOpenSimulationRow?: (focus: { ticker: string; cd?: string }) => void;
  /** Simulation tab — 24h assessment, scrolled to the company row. */
  onOpen24hAssessment?: (focus: { ticker: string; cd?: string }) => void;
  onOpenSupernovaTab?: (ticker: string) => void;
  pulseScope: PulseScope;
  onPulseScopeChange: (scope: PulseScope) => void;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";

  // Same calibrated risk pipeline used by Pick stocks and the Capital &
  // Diversification view — so the skull/heart shown here is numerically
  // identical to the one on every other surface.
  const { catalog: lossRiskCatalog } = useLossRiskCatalog({
    simTable,
    sdsRows,
    chartBundle,
    reloadToken: reloadToken ?? 0,
  });
  const [riskModalEntry, setRiskModalEntry] = useState<LossRiskEntry | null>(null);
  const [positionsOpen, setPositionsOpen] = useState(() => {
    const v = loadUiPrefsLocal().pulsePositionsOpen;
    return v == null ? true : Boolean(v);
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const disk = await hydrateUiPrefsFromDisk();
      if (cancelled || disk == null || typeof disk.pulsePositionsOpen !== "boolean") return;
      setPositionsOpen(disk.pulsePositionsOpen);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onPositionsToggle = useCallback((e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const next = (e.currentTarget as HTMLDetailsElement).open;
    setPositionsOpen(next);
    saveUiPrefs({ pulsePositionsOpen: next });
  }, []);

  const openPortfolioRow = useCallback(
    (row: { ticker: string; completionDate?: string }) => {
      const focus = { ticker: row.ticker, cd: row.completionDate };
      if (onOpen24hAssessment) {
        onOpen24hAssessment(focus);
      } else {
        onOpenSimulationRow?.(focus);
      }
    },
    [onOpen24hAssessment, onOpenSimulationRow],
  );

  const ptfTone = portfolioPnlTone(data.portfolioTotals.pnlEur, data.portfolioTotals.pnlPct);
  const shellCls = portfolioPnlTabShellClass(data.winRate.winPct);
  const gap = data.portfolioPlanGap;

  return (
    <section
      className={`dashboard-pulse-table shrink-0 rounded-2xl border border-[rgb(var(--panel-feed-border))]/55 overflow-x-hidden shadow-[0_2px_16px_rgb(99_102_241_/_0.08)] ${shellCls}`}
    >
      <div className="dashboard-pulse-head flex flex-col gap-2 px-4 py-3 border-b border-[rgb(var(--panel-lab-border))]/45 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink inline-flex items-center gap-1.5">
              <PortfolioBriefcaseMark
                title={t("sim.lossAnalysis.summaryTable.portfolioMark")}
                className="text-sm"
              />
              {t("dashboard.pulse.title")}
            </h2>
            <p className="ui-subtitle-clamp mt-1">
              {data.hasPriorVisit
                ? t("dashboard.pulse.sinceVisit", {
                    when: formatVisitAgo(data.priorVisitAt, lang),
                  })
                : t("dashboard.pulse.firstVisit")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {data.winRate.decisive > 0 ? (
              <span
                className={`text-[11px] font-semibold tabular-nums px-2 py-1 rounded-full border border-[rgb(var(--panel-feed-border))]/45 bg-white/80 ${
                  data.winRate.winPct != null && data.winRate.winPct >= 50
                    ? "text-[rgb(var(--signal-up))]"
                    : "text-[rgb(var(--signal-down))]"
                }`}
              >
                {it
                  ? `${data.winRate.gainCount}↑ · ${data.winRate.lossCount}↓`
                  : `${data.winRate.gainCount} up · ${data.winRate.lossCount} down`}
              </span>
            ) : null}
            <PulseScopeSwitcher active={pulseScope} onSelect={onPulseScopeChange} />
          </div>
        </div>
      </div>

      {data.portfolioRows.length === 0 ? (
        <p className="text-sm text-ink-muted text-center py-8 px-4">{t("dashboard.pulse.noPortfolio")}</p>
      ) : (
        <>
          <div className="dashboard-pulse-hero grid gap-3 p-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <PortfolioGainPlanAggregateChart series={data.aggregateGainPlanSeries} height={172} />
            <div className="flex flex-col gap-2 min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--panel-feed-accent-strong))]">
                {t("dashboard.pulse.kpiTitle")}
              </p>
              <div className="flex flex-wrap gap-2">
                <KpiTile
                  label={t("dashboard.pulse.portfolioPnl")}
                  value={fmtPulseEur(data.portfolioTotals.pnlEur)}
                  sub={fmtPulsePct(data.portfolioTotals.pnlPct)}
                  accentClass={portfolioPnlAccentClass(data.portfolioTotals.pnlEur)}
                  title={t("dashboard.pulse.portfolioPnlTip")}
                />
                {data.deltaPortfolioPnlSinceVisit != null ? (
                  <KpiTile
                    label={t("dashboard.pulse.colDelta")}
                    value={fmtPulseEur(data.deltaPortfolioPnlSinceVisit)}
                    accentClass={portfolioPnlAccentClass(data.deltaPortfolioPnlSinceVisit)}
                    title={t("dashboard.pulse.deltaTip")}
                  />
                ) : (
                  <KpiTile
                    label={t("dashboard.pulse.colDelta")}
                    value="—"
                    sub={t("dashboard.pulse.firstVisitShort")}
                  />
                )}
                {data.portfolioTotals.todayCovered > 0 ? (
                  <KpiTile
                    label="24h"
                    value={fmtPulseEur(data.portfolioTotals.pnlEurToday)}
                    accentClass={portfolioPnlAccentClass(data.portfolioTotals.pnlEurToday)}
                    title={t("dashboard.pulse.pnl24hTip")}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <KpiTile
                  label={t("dashboard.pulse.planActual")}
                  value={fmtPulseEur(gap.actualNowEur)}
                  sub={
                    gap.plannedNowEur != null
                      ? `${t("dashboard.pulse.planLabel")} ${fmtPulseEur(gap.plannedNowEur)}`
                      : undefined
                  }
                  accentClass={portfolioPnlAccentClass(gap.actualNowEur ?? 0)}
                  title={t("dashboard.pulse.planActualTip")}
                />
                <KpiTile
                  label={t("dashboard.pulse.planGap")}
                  value={gap.gapEur != null ? fmtPulseEur(gap.gapEur) : "—"}
                  sub={gap.gapPct != null ? fmtPulsePct(gap.gapPct) : undefined}
                  accentClass={portfolioPnlAccentClass(gap.gapEur ?? 0)}
                  title={t("dashboard.pulse.planGapTip")}
                />
              </div>
            </div>
          </div>

          <details
            open={positionsOpen}
            onToggle={onPositionsToggle}
            className="border-t border-[rgb(var(--panel-feed-border))]/35 shrink-0"
          >
            <summary className="cursor-pointer select-none list-none px-4 py-2 bg-[rgb(var(--panel-feed-header-bg))]/50 hover:bg-[rgb(var(--panel-feed-row-hover))]/35 transition-colors [&::-webkit-details-marker]:hidden">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--panel-feed-accent-strong))]">
                {t("dashboard.pulse.positionsSummary", { n: data.portfolioRows.length })}
              </span>
              <span className="ml-2 text-[10px] text-ink-muted font-normal normal-case tracking-normal">
                {positionsOpen ? (it ? "nascondi" : "hide") : it ? "mostra" : "show"}
              </span>
            </summary>
            <div className="overflow-x-auto">
            <table className={`${SHEET_GRID_TABLE_CLASS} text-xs border-collapse min-w-[42rem]`}>
              <SheetGridColgroup columnCount={8} />
              <thead>
                <tr className="bg-[rgb(var(--panel-feed-header-bg))]/80 text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className={gridTh("left", "py-2 font-semibold")}>{t("dashboard.pulse.colTicker")}</th>
                  <th className={gridTh("center", "py-2 font-semibold")} title={t("dashboard.pulse.colTrendTip")}>
                    {t("dashboard.pulse.colTrend")}
                  </th>
                  <th className={gridTh("center", "py-2 font-semibold")}>{t("dashboard.pulse.colDelta")}</th>
                  <th className={gridTh("center", "py-2 font-semibold")}>24h</th>
                  <th className={gridTh("center", "py-2 font-semibold")}>{t("dashboard.pulse.colPnl")}</th>
                  <th className={gridTh("center", "py-2 font-semibold")} title={t("dashboard.pulse.planGapTip")}>
                    {t("dashboard.pulse.colPlanGap")}
                  </th>
                  <th className={gridTh("center", "py-2 font-semibold")} title={t("sim.gainPlan.title")}>
                    {t("dashboard.pulse.colGainPlan")}
                  </th>
                  <th
                    className={gridTh("center", "py-2 font-semibold")}
                    title={
                      it
                        ? "Bilancia rischio vs beneficio. Teschio (sx): rischio investimento 0-100. Cuore (dx): % crescita prezzo per giorno verso il target. Click per il dettaglio Phase A/B."
                        : "Risk vs benefit balance. Skull (left): investment-risk 0-100. Heart (right): expected % growth per day toward target. Click for the Phase A/B breakdown."
                    }
                  >
                    Risk &amp; Benefit
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.portfolioRows.map((row) => (
                  <tr
                    key={row.key}
                    className="border-t border-[rgb(var(--panel-feed-border))]/25 hover:bg-[rgb(var(--panel-feed-row-hover))]/45 cursor-pointer bg-white/70"
                    onClick={() => openPortfolioRow(row)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openPortfolioRow(row);
                      }
                    }}
                  >
                    <td className={`${gridTd("left")} whitespace-nowrap`}>
                      <PortfolioTickerMark
                        ticker={row.ticker}
                        inPortfolio
                        pnlPct={row.pnlPct}
                        pnlEur={row.pnlEur}
                        className="text-xs"
                        portfolioMarkTitle={t("sim.lossAnalysis.summaryTable.portfolioMark")}
                      />
                    </td>
                    <td className={`${gridTd("center")} text-lg leading-none font-bold ${directionClass(row.direction)}`}>
                      {directionGlyph(row.direction)}
                    </td>
                    <td
                      className={`${gridTd("center")} tabular-nums whitespace-nowrap${portfolioPnlAccentClass(row.deltaPnlEurSinceVisit ?? 0)}`}
                    >
                      {row.deltaPnlEurSinceVisit != null ? fmtPulseEur(row.deltaPnlEurSinceVisit) : "—"}
                    </td>
                    <td
                      className={`${gridTd("center")} tabular-nums whitespace-nowrap${portfolioPnlAccentClass(row.pnlEur24h ?? 0)}`}
                    >
                      {row.pnlEur24h != null ? fmtPulseEur(row.pnlEur24h) : "—"}
                    </td>
                    <td
                      className={`${gridTd("center")} tabular-nums whitespace-nowrap font-semibold${portfolioPnlAccentClass(row.pnlEur)}`}
                    >
                      {fmtPulseEur(row.pnlEur)}
                      <span className="text-[9px] font-normal opacity-80 ml-0.5">
                        {fmtPulsePct(row.pnlPct)}
                      </span>
                    </td>
                    <td
                      className={`${gridTd("center")} tabular-nums whitespace-nowrap text-[10px]${portfolioPnlAccentClass(row.planGap.gapEur ?? 0)}`}
                      title={t("dashboard.pulse.planGapTip")}
                    >
                      {row.planGap.gapEur != null ? (
                        <>
                          {fmtPulseEur(row.planGap.gapEur)}
                          {row.planGap.gapPct != null ? (
                            <span className="block text-[9px] opacity-85">{fmtPulsePct(row.planGap.gapPct)}</span>
                          ) : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${gridTd("center")} py-1`}>
                      <GainPlanMicroSparkline row={row.gainPlanRow} history={history} width={88} height={28} />
                    </td>
                    <td
                      className={`${gridTd("center")} py-1`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {(() => {
                        const entry =
                          lookupLossRisk(lossRiskCatalog, row.ticker) ?? ({
                            ticker: row.ticker,
                            phaseLabel: "",
                            riskScore: null,
                            lossRisk: null,
                          } satisfies LossRiskEntry);
                        const expectedReturnPct = row.gainPlanRow.expectedGainPct ?? null;
                        const daysToTarget = row.gainPlanRow.daysToTarget ?? null;
                        const benefitFillPct = deriveBenefitFillPct({
                          expectedReturnPct,
                          daysToTarget,
                          dailyChangePct: row.pnlPct24h,
                        });
                        const perDayPct =
                          expectedReturnPct != null &&
                          Number.isFinite(expectedReturnPct) &&
                          daysToTarget != null &&
                          daysToTarget > 0
                            ? expectedReturnPct / daysToTarget
                            : row.pnlPct24h ?? null;
                        return (
                          <RiskBenefitScaleCell
                            entry={entry}
                            benefitFillPct={benefitFillPct}
                            perDayPct={perDayPct}
                            onClick={() => setRiskModalEntry(entry)}
                            it={it}
                          />
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </details>
        </>
      )}

      <LossRiskBreakdownModal
        entry={riskModalEntry}
        onClose={() => setRiskModalEntry(null)}
        it={it}
      />

      {data.opportunityRows.length > 0 ? (
        <div className="border-t border-[rgb(var(--panel-feed-border))]/40 bg-[rgb(var(--panel-feed-bg))]/35">
          <p className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide font-semibold text-[rgb(var(--panel-feed-accent-strong))]">
            {t("dashboard.pulse.oppsTitle")}
          </p>
          <div className="overflow-x-auto px-2 pb-3">
            <table className={`${SHEET_GRID_TABLE_CLASS} text-xs border-collapse min-w-[28rem]`}>
              <SheetGridColgroup columnCount={5} />
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-ink-muted">
                  <th className={gridTh("left", "py-1.5 font-semibold")}>{t("dashboard.pulse.colTicker")}</th>
                  <th className={gridTh("center", "py-1.5 font-semibold")}>MII °</th>
                  <th className={gridTh("center", "py-1.5 font-semibold")} title={t("dashboard.pulse.miiDeltaTip")}>
                    Δ MII
                  </th>
                  <th className={gridTh("center", "py-1.5 font-semibold")}>RA</th>
                  <th className={gridTh("center", "py-1.5 font-semibold")}>SDS</th>
                </tr>
              </thead>
              <tbody>
                {data.opportunityRows.map((row) => (
                  <tr
                    key={row.key}
                    className="border-t border-[rgb(var(--panel-feed-border))]/20 hover:bg-[rgb(var(--panel-feed-row-hover))]/40 cursor-pointer bg-white/75"
                    onClick={() =>
                      onOpenSimulationRow?.({ ticker: row.ticker, cd: row.completionDate })
                    }
                  >
                    <td className={`${gridTd("left")} font-semibold text-ink`}>{row.ticker}</td>
                    <td className={`${gridTd("center")} tabular-nums text-[rgb(var(--signal-up))] font-semibold`}>
                      +{row.miiAngle.toFixed(1)}°
                    </td>
                    <td className={`${gridTd("center")} tabular-nums`}>
                      {row.deltaMiiSinceVisit != null
                        ? `${row.deltaMiiSinceVisit >= 0 ? "+" : ""}${row.deltaMiiSinceVisit.toFixed(1)}°`
                        : "—"}
                    </td>
                    <td className={`${gridTd("center")} tabular-nums font-semibold`}>
                      {row.raScore ?? "—"}
                    </td>
                    <td className={`${gridTd("center")} py-0.5`}>
                      <SdsScoreCompactCell
                        info={row.sds}
                        size={26}
                        onOpenSupernova={
                          onOpenSupernovaTab ? () => onOpenSupernovaTab(row.ticker) : undefined
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="px-4 pb-3 pt-1 text-[10px] text-ink-muted/75 leading-snug border-t border-[rgb(var(--panel-feed-border))]/25 bg-[rgb(var(--panel-feed-header-bg))]/45">
        {t("dashboard.pulse.footnote")}
        {ptfTone === "gain" ? ` · ${t("dashboard.pulse.inGain")}` : ptfTone === "loss" ? ` · ${t("dashboard.pulse.inLoss")}` : ""}
      </p>
    </section>
  );
}
