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
import { PulseOpenPositionsMovementLog, movementLogRowFromGainPlan } from "./PulseOpenPositionsMovementLog";
import { hydrateUiPrefsFromDisk, loadUiPrefsLocal, saveUiPrefs } from "../sheet/uiPrefs";
import {
  planGapAccentClass,
  planGapMisleadingBeat,
  planGapPctForDisplay,
  shouldUseDailyBenefitFallback,
} from "../sheet/pulsePlanGapDisplay";

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
      <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted/85">{label}</p>
      <p className={`text-xs font-bold tabular-nums mt-0.5 leading-tight ${accentClass ?? "text-ink"}`}>
        {value}
      </p>
      {sub ? <p className="text-[11px] text-ink-muted mt-0.5 tabular-nums">{sub}</p> : null}
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
  priceAgeNote,
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
  /** Price-age note from livePositionSnapshot — shown in the subtitle when prices are stale. */
  priceAgeNote?: string | null;
}) {
  const { lang } = useLang();
  const t = useT();
  const it = lang === "it";

  // DEBUG: trace why Gain 24h shows "—" (todayCovered=0)
  if (import.meta.env.DEV) {
    const tot = data.portfolioTotals;
    console.log("[DashboardPulse] portfolioTotals:", {
      todayCovered: tot.todayCovered,
      todayTotal: tot.todayTotal,
      pnlEurToday: tot.pnlEurToday,
      pnlEur: tot.pnlEur,
      capital: tot.capital,
    });
    console.log("[DashboardPulse] portfolioRows sample (first 3):", data.portfolioRows.slice(0, 3).map(r => ({
      ticker: r.ticker,
      pnlEur24h: r.pnlEur24h,
      pnlPct24h: r.pnlPct24h,
    })));
  }

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

  return (
    <section
      className={`dashboard-pulse-table shrink-0 rounded-2xl border border-[rgb(var(--panel-feed-border))]/55 overflow-x-hidden shadow-[0_2px_16px_rgb(99_102_241_/_0.08)] ${shellCls}`}
    >
      <div className="dashboard-pulse-head flex flex-col gap-2 px-4 py-3 border-b border-[rgb(var(--panel-lab-border))]/45 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-semibold text-ink inline-flex items-center gap-1.5">
              <PortfolioBriefcaseMark
                title={t("sim.lossAnalysis.summaryTable.portfolioMark")}
                className="text-xs"
              />
              {t("dashboard.pulse.title")}
            </h2>
            <p className="ui-subtitle-clamp mt-1">
              {data.hasPriorVisit
                ? t("dashboard.pulse.sinceVisit", {
                    when: formatVisitAgo(data.priorVisitAt, lang),
                  })
                : t("dashboard.pulse.firstVisit")}
              {priceAgeNote ? (
                <span className="ml-1 text-amber-600 dark:text-amber-400 font-medium">
                  · {priceAgeNote}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {data.winRate.decisive > 0 ? (
              <span
                className={`text-xs font-semibold tabular-nums px-2 py-1 rounded-full border border-[rgb(var(--panel-feed-border))]/45 bg-white/80 ${
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
        <p className="text-xs text-ink-muted text-center py-8 px-4">{t("dashboard.pulse.noPortfolio")}</p>
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
                  label={it ? "Gain open (MTM)" : "Gain open (MTM)"}
                  value={fmtPulseEur(data.portfolioTotals.pnlEur)}
                  sub={[
                    fmtPulsePct(data.portfolioTotals.pnlPct),
                    priceAgeNote ?? null,
                  ].filter(Boolean).join(" · ") || undefined}
                  accentClass={portfolioPnlAccentClass(data.portfolioTotals.pnlEur)}
                  title={it ? "P&L mark-to-market sulle posizioni aperte" : "Mark-to-market P&L on open positions"}
                />
                <KpiTile
                  label={it ? "Gain 24h" : "Gain 24h"}
                  value={data.portfolioTotals.todayCovered > 0 ? fmtPulseEur(data.portfolioTotals.pnlEurToday) : "—"}
                  sub={data.portfolioTotals.todayCovered === 0 ? (it ? "mercato chiuso" : "market closed") : undefined}
                  accentClass={data.portfolioTotals.todayCovered > 0 ? portfolioPnlAccentClass(data.portfolioTotals.pnlEurToday) : undefined}
                  title={t("dashboard.pulse.pnl24hTip")}
                />
                <KpiTile
                  label={it ? "Δ visita" : "Δ visit"}
                  value={data.deltaPortfolioPnlSinceVisit != null ? fmtPulseEur(data.deltaPortfolioPnlSinceVisit) : "—"}
                  sub={data.deltaPortfolioPnlSinceVisit == null ? (it ? "prima visita" : "first visit") : undefined}
                  accentClass={data.deltaPortfolioPnlSinceVisit != null ? portfolioPnlAccentClass(data.deltaPortfolioPnlSinceVisit) : undefined}
                  title={it ? "Variazione P&L dall'ultima visita" : "P&L change since last visit"}
                />
                {data.portfolioTotals.closedCount > 0 && (
                  <KpiTile
                    label={it ? "Gain closed" : "Gain closed"}
                    value={fmtPulseEur(data.portfolioTotals.closedPnlEur)}
                    sub={it ? `${data.portfolioTotals.closedCount} pos. chiuse` : `${data.portfolioTotals.closedCount} closed pos.`}
                    accentClass={portfolioPnlAccentClass(data.portfolioTotals.closedPnlEur)}
                    title={it ? "P&L realizzato sulle posizioni già vendute" : "Realized P&L on sold positions"}
                  />
                )}
              </div>
              {data.portfolioRows.length > 0 ? (
                <PulseOpenPositionsMovementLog
                  it={it}
                  rows={data.portfolioRows.map((row) =>
                    movementLogRowFromGainPlan({
                      key: row.key,
                      ticker: row.ticker,
                      pnlEur: row.pnlEur,
                      pnlPct: row.pnlPct,
                      deltaPnlEurSinceVisit: row.deltaPnlEurSinceVisit,
                      investedAt: row.gainPlanRow.investedAt,
                      simRow: row.gainPlanRow.simRow as Record<string, unknown> | undefined,
                    }),
                  )}
                />
              ) : null}
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
              <span className="ml-2 text-[11px] text-ink-muted font-normal normal-case tracking-normal">
                {positionsOpen ? (it ? "nascondi" : "hide") : it ? "mostra" : "show"}
              </span>
            </summary>
            <div className="overflow-x-auto">
            <table className={`${SHEET_GRID_TABLE_CLASS} text-xs border-collapse min-w-[42rem]`}>
              <SheetGridColgroup columnCount={8} />
              <thead>
                <tr className="bg-[rgb(var(--panel-feed-header-bg))]/80 text-[11px] uppercase tracking-wide text-ink-muted font-semibold">
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
                    <td className={`${gridTd("center")} text-xs leading-none font-bold ${directionClass(row.direction)}`}>
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
                      <span className="text-[11px] font-normal opacity-80 ml-0.5">
                        {fmtPulsePct(row.pnlPct)}
                      </span>
                    </td>
                    <td
                      className={`${gridTd("center")} tabular-nums whitespace-nowrap text-xs${planGapAccentClass(row.pnlPct, row.planGap.gapEur)}`}
                      title={
                        planGapMisleadingBeat(row.pnlPct, row.planGap.gapEur)
                          ? it
                            ? `Scostamento vs piano oggi (non ROI atteso). Posizione in perdita ${row.pnlPct.toFixed(0)}% — il piano era ancora più basso. Target modello: ${row.gainPlanRow.expectedGainPct != null ? `${row.gainPlanRow.expectedGainPct.toFixed(0)}%` : "—"}`
                            : `Gap vs plan today (not expected ROI). Position ${row.pnlPct.toFixed(0)}% MTM loss — plan was lower still. Model target: ${row.gainPlanRow.expectedGainPct != null ? `${row.gainPlanRow.expectedGainPct.toFixed(0)}%` : "—"}`
                          : `${t("dashboard.pulse.planGapTip")}${row.gainPlanRow.expectedGainPct != null ? (it ? ` · ROI target modello ${row.gainPlanRow.expectedGainPct.toFixed(0)}%` : ` · Model ROI target ${row.gainPlanRow.expectedGainPct.toFixed(0)}%`) : ""}`
                      }
                    >
                      {row.planGap.gapEur != null ? (
                        <>
                          {fmtPulseEur(row.planGap.gapEur)}
                          {(() => {
                            const gapPct = planGapPctForDisplay(
                              row.planGap.gapPct,
                              row.gainPlanRow.capital,
                            );
                            return gapPct != null ? (
                              <span className="block text-[11px] opacity-85">{fmtPulsePct(gapPct)}</span>
                            ) : row.gainPlanRow.capital < 500 ? (
                              <span className="block text-[9px] opacity-60 font-normal">
                                {it ? "micro" : "micro"}
                              </span>
                            ) : null;
                          })()}
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
                          capitalEur: row.gainPlanRow.capital,
                          pnlPct: row.pnlPct,
                        });
                        const perDayPct =
                          expectedReturnPct != null &&
                          Number.isFinite(expectedReturnPct) &&
                          daysToTarget != null &&
                          daysToTarget > 0
                            ? expectedReturnPct / daysToTarget
                            : shouldUseDailyBenefitFallback({
                                capitalEur: row.gainPlanRow.capital,
                                pnlPct: row.pnlPct,
                              })
                              ? row.pnlPct24h ?? null
                              : null;
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
                <tr className="text-[11px] uppercase tracking-wide text-ink-muted font-semibold">
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

      <p className="px-4 pb-3 pt-1 text-[11px] text-ink-muted/75 leading-snug border-t border-[rgb(var(--panel-feed-border))]/25 bg-[rgb(var(--panel-feed-header-bg))]/45">
        {t("dashboard.pulse.footnote")}
        {ptfTone === "gain" ? ` · ${t("dashboard.pulse.inGain")}` : ptfTone === "loss" ? ` · ${t("dashboard.pulse.inLoss")}` : ""}
      </p>
    </section>
  );
}
