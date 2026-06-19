import { Fragment, useEffect, useMemo, useState } from "react";
import type { ChartBundle, SheetTable } from "../types";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useLang, useT } from "../shared/i18n";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import { buildMigSolidityByKey } from "../sheet/entrySolidityMig";
import type { SdsRow } from "../api/supernova";
import { loadSdsCohort } from "../api/supernova";
import { loadEisSuperScoreState } from "../api/eisSuperScore";
import { useCdPatternPolygonOverview } from "../sheet/useCdPatternPolygonOverview";
import type { LossAnalysisProbOptions } from "../sheet/portfolioLossAnalysis";
import {
  buildSuggestionMonitorRows,
  isRecommendedAction,
  suggestedActionLabel,
  suggestedActionToneClass,
  type SuggestionMonitorRow,
  type SuggestionPipelineStep,
} from "../sheet/suggestionMonitor";
import { formatTop2VerdictDisplay } from "../sheet/top2DecisionHelpers";
import type { PaperPosition } from "../sheet/investDecisionSimLoop";
import { PortfolioTickerMark } from "./PortfolioScopeToggle";
import { CompositeScoreCell } from "./CompositeScoreCell";
import {
  loadInvestmentSimOutcomes,
  type SimOutcomeRow,
  type SimOutcomesDoc,
} from "../data/investmentSimOutcomesData";

type FilterId =
  | "all"
  | "recommended"
  | "buy"
  | "sell"
  | "hold"
  | "review"
  | "portfolio"
  | "opportunity"
  | "misaligned";

function recentOutcomeRows(doc: SimOutcomesDoc | null, hoursBack = 48): SimOutcomeRow[] {
  if (!doc?.rows?.length) return [];
  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
  return doc.rows.filter((r) => {
    if (r.row_key.includes("#cycle")) return false;
    if (!r.entry_ts) return false;
    return new Date(r.entry_ts).getTime() >= cutoff;
  });
}

function actionClass(action: SuggestionMonitorRow["suggestedAction"], hasPosition: boolean): string {
  return suggestedActionToneClass(action, hasPosition);
}

function stepToneClass(tone: SuggestionPipelineStep["tone"]): string {
  switch (tone) {
    case "good":
      return "border-emerald-500/30 bg-emerald-500/8";
    case "bad":
      return "border-rose-500/30 bg-rose-500/8";
    case "warn":
      return "border-amber-500/30 bg-amber-500/8";
    default:
      return "border-[rgb(var(--border))]/40 bg-surface/40";
  }
}

function fmtTs(iso: string | undefined, locale: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function AppSuggestionsMonitorModal({
  open,
  onClose,
  simTable,
  chartsBundle,
  paperPortfolio = [],
  evaluatedAt,
}: {
  open: boolean;
  onClose: () => void;
  simTable: SheetTable | null;
  chartsBundle: ChartBundle | null;
  paperPortfolio?: PaperPosition[];
  evaluatedAt?: string | null;
}) {
  const t = useT();
  const { lang } = useLang();
  const it = lang === "it";
  const locale = it ? "it-IT" : "en-US";

  const [filter, setFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const investInputs = useInvestSimInputs(simTable);
  const pointsBySeriesKey = useMemo(() => chartPointsMapFromBundle(chartsBundle), [chartsBundle]);

  const [sdsRows, setSdsRows] = useState<SdsRow[] | null>(null);
  const [eisState, setEisState] = useState<Awaited<ReturnType<typeof loadEisSuperScoreState>> | null>(
    null,
  );
  const [outcomesDoc, setOutcomesDoc] = useState<SimOutcomesDoc | null>(null);
  const polygonOverview = useCdPatternPolygonOverview();

  useEffect(() => {
    if (!open) return;
    void loadSdsCohort(false).then((p) => setSdsRows(p.rows ?? null));
    void loadEisSuperScoreState().then(setEisState);
    void loadInvestmentSimOutcomes().then(({ doc }) => setOutcomesDoc(doc));
  }, [open]);

  const probOptions = useMemo((): LossAnalysisProbOptions | null => {
    if (!simTable) return null;
    const migByKey = buildMigSolidityByKey(simTable, chartsBundle, sdsRows);
    return {
      sdsRows,
      migSolidityByKey: migByKey,
      eisSuperScoreState: eisState,
      polygonOverview,
      lightweightPolygon: true,
      mergedInputs: investInputs,
    };
  }, [simTable, chartsBundle, sdsRows, eisState, polygonOverview, investInputs]);

  const rows = useMemo(() => {
    if (!open || !simTable?.rows?.length) return [];
    return buildSuggestionMonitorRows({
      simTable,
      inputs: investInputs,
      pointsBySeriesKey,
      lang: it ? "it" : "en",
      probOptions,
      paperPortfolio,
    });
  }, [open, simTable, investInputs, pointsBySeriesKey, it, probOptions, paperPortfolio]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    return rows.filter((r) => {
      if (q && !String(r.ticker ?? "").toUpperCase().includes(q) && !String(r.company ?? "").toUpperCase().includes(q)) {
        return false;
      }
      if (filter === "recommended") return isRecommendedAction(r.suggestedAction);
      if (filter === "buy") return r.suggestedAction === "buy";
      if (filter === "sell") return r.suggestedAction === "sell";
      if (filter === "hold") return r.suggestedAction === "hold";
      if (filter === "review") return !isRecommendedAction(r.suggestedAction) && r.suggestedAction !== "hold";
      if (filter === "portfolio") return r.profile === "portfolio";
      if (filter === "opportunity") return r.profile === "opportunity";
      if (filter === "misaligned") return r.misalignments.length > 0;
      return true;
    });
  }, [rows, filter, search]);

  const counts = useMemo(
    () => ({
      recommended: rows.filter((r) => isRecommendedAction(r.suggestedAction)).length,
      buy: rows.filter((r) => r.suggestedAction === "buy").length,
      sell: rows.filter((r) => r.suggestedAction === "sell").length,
      notRecommended: rows.filter(
        (r) => !isRecommendedAction(r.suggestedAction) && r.suggestedAction !== "hold",
      ).length,
      misaligned: rows.filter((r) => r.misalignments.length > 0).length,
    }),
    [rows],
  );

  const recentOutcomes = useMemo(() => recentOutcomeRows(outcomesDoc), [outcomesDoc]);

  if (!open) return null;

  const filters: { id: FilterId; label: string }[] = [
    { id: "all", label: it ? `Tutti (${rows.length})` : `All (${rows.length})` },
    {
      id: "recommended",
      label: `${t("testerMonitor.suggestionsMonitor.filterRecommended")} (${counts.recommended})`,
    },
    { id: "buy", label: `Buy (${counts.buy})` },
    { id: "sell", label: `Sell (${counts.sell})` },
    {
      id: "review",
      label: `${t("testerMonitor.suggestionsMonitor.filterNotRecommended")} (${counts.notRecommended})`,
    },
    { id: "portfolio", label: it ? "Portafoglio" : "Portfolio" },
    { id: "opportunity", label: it ? "Opportunità" : "Opportunities" },
    { id: "misaligned", label: it ? `Disallineati (${counts.misaligned})` : `Misaligned (${counts.misaligned})` },
  ];

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-2 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-[min(1200px,96vw)] max-h-[92vh] flex flex-col overflow-hidden rounded-xl shadow-2xl bg-[rgb(var(--surface))] border border-[rgb(var(--border))]/60"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="suggestions-monitor-title"
      >
        <div className="flex flex-wrap items-start gap-3 px-4 py-3 border-b border-[rgb(var(--border))]/50 shrink-0">
          <div className="flex-1 min-w-[200px]">
            <h2 id="suggestions-monitor-title" className="text-base font-bold">
              {t("testerMonitor.suggestionsMonitor.title")}
            </h2>
            <p className="text-[11px] text-ink-muted mt-0.5 max-w-[720px] leading-relaxed">
              {t("testerMonitor.suggestionsMonitor.subtitle")}
            </p>
            <p className="text-[10px] text-ink-muted/90 mt-1 max-w-[720px] leading-relaxed">
              {t("testerMonitor.suggestionsMonitor.buyGateHint")}
            </p>
            {evaluatedAt ? (
              <p className="text-[10px] text-ink-muted/80 mt-1 tabular-nums">
                {t("testerMonitor.suggestionsMonitor.evaluatedAt")}: {fmtTs(evaluatedAt, locale)}
              </p>
            ) : (
              <p className="text-[10px] text-ink-muted/80 mt-1">
                {t("testerMonitor.suggestionsMonitor.live")}
              </p>
            )}
          </div>
          <button type="button" className="btn-ghost text-sm px-2 py-1 shrink-0" onClick={onClose}>
            ✕
          </button>
        </div>

        {recentOutcomes.length > 0 ? (
          <div className="px-4 py-2 border-b border-[rgb(var(--border))]/30 shrink-0 bg-amber-500/5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-1.5">
              <p className="text-[11px] font-semibold">{t("testerMonitor.suggestionsMonitor.recentOutcomesTitle")}</p>
              {outcomesDoc?.generated_at ? (
                <p className="text-[10px] text-ink-muted tabular-nums">
                  {t("testerMonitor.suggestionsMonitor.recentOutcomesGenerated")}:{" "}
                  {fmtTs(outcomesDoc.generated_at, locale)}
                  {outcomesDoc.summary?.total_pnl_eur != null ? (
                    <>
                      {" · "}
                      P&L {outcomesDoc.summary.total_pnl_eur >= 0 ? "+" : ""}
                      {Math.round(outcomesDoc.summary.total_pnl_eur)}€
                      {outcomesDoc.summary.win_rate_pct != null
                        ? ` · win ${Math.round(outcomesDoc.summary.win_rate_pct)}%`
                        : ""}
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {recentOutcomes.map((o) => {
                const pnl = o.pnl_eur ?? 0;
                const pnlTone =
                  pnl > 25 ? "text-emerald-700 dark:text-emerald-300" : pnl < -25 ? "text-rose-700 dark:text-rose-300" : "text-ink-muted";
                const signal =
                  o.buy_signal_suggested === true
                    ? o.buy_signal_result === "failure"
                      ? it
                        ? "buy suggerito · fallito"
                        : "buy suggested · failed"
                      : o.buy_signal_result === "success"
                        ? it
                          ? "buy suggerito · ok"
                          : "buy suggested · ok"
                        : it
                          ? "buy suggerito"
                          : "buy suggested"
                    : it
                      ? "acquisto manuale"
                      : "manual buy";
                return (
                  <div
                    key={o.row_key}
                    className="rounded-md border border-[rgb(var(--border))]/40 px-2 py-1 text-[10px] bg-surface/60"
                  >
                    <span className="font-bold">{o.ticker}</span>
                    <span className={`ml-1.5 tabular-nums font-semibold ${pnlTone}`}>
                      {pnl >= 0 ? "+" : ""}
                      {Math.round(pnl)}€ ({o.pnl_pct != null ? `${o.pnl_pct >= 0 ? "+" : ""}${o.pnl_pct.toFixed(1)}%` : "—"})
                    </span>
                    <span className="ml-1.5 text-ink-muted">{o.outcome_label}</span>
                    <span className="ml-1.5 text-[9px] text-ink-muted/90">· {signal}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : open && outcomesDoc ? (
          <p className="px-4 py-1.5 text-[10px] text-ink-muted border-b border-[rgb(var(--border))]/20 shrink-0">
            {t("testerMonitor.suggestionsMonitor.recentOutcomesEmpty")}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[rgb(var(--border))]/30 shrink-0 bg-surface/50">
          <input
            type="search"
            className="input text-xs py-1 min-w-[140px] max-w-[200px]"
            placeholder={it ? "Cerca ticker…" : "Search ticker…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap gap-1">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`rounded-md px-2 py-0.5 text-[10px] font-semibold border transition ${
                  filter === f.id
                    ? "border-[rgb(var(--accent))]/50 bg-[rgb(var(--accent))]/12 text-[rgb(var(--accent))]"
                    : "border-[rgb(var(--border))]/40 text-ink-muted hover:bg-surface/80"
                }`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {!simTable?.rows?.length ? (
            <p className="text-sm text-ink-muted text-center py-12 px-4">
              {t("testerMonitor.suggestionsMonitor.noData")}
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-12 px-4">
              {t("testerMonitor.suggestionsMonitor.noMatch")}
            </p>
          ) : (
            <table className={`${SHEET_GRID_TABLE_CLASS} text-[11px] min-w-[1160px]`}>
              <SheetGridColgroup columnCount={15} />
              <thead className="sticky top-0 z-[2] bg-[rgb(var(--surface))]">
                <tr className="text-left uppercase tracking-wide text-[9px]">
                  <th className={gridTh("left", "py-2")} />
                  <th className={gridTh("left", "py-2")}>Ticker</th>
                  <th className={gridTh("center", "py-2")} title={t("testerMonitor.decisionSim.compositeHint")}>
                    {t("testerMonitor.decisionSim.col.composite")}
                  </th>
                  <th className={gridTh("center", "py-2")}>{it ? "Profilo" : "Profile"}</th>
                  <th className={gridTh("center", "py-2")}>T−CD</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Raccom." : "Rec."}</th>
                  <th className={gridTh("center", "py-2")}>{it ? "Top2 in/uscita" : "Top2 in/out"}</th>
                  <th className={gridTh("center", "py-2")}>Exit</th>
                  <th className={gridTh("center", "py-2")}>P(plan)</th>
                  <th className={gridTh("center", "py-2")}>RA</th>
                  <th className={gridTh("center", "py-2")}>Aff</th>
                  <th className={gridTh("center", "py-2")}>Match</th>
                  <th className={gridTh("center", "py-2")}>Target</th>
                  <th className={gridTh("center", "py-2")}>Precat</th>
                  <th className={gridTh("left", "py-2")}>{t("testerMonitor.suggestionsMonitor.buyBlock")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const expanded = expandedKey === row.key;
                  return (
                    <Fragment key={row.key}>
                      <tr
                        className={`cursor-pointer ${expanded ? "bg-[rgb(var(--accent))]/5" : "hover:bg-surface/60"}`}
                        onClick={() => setExpandedKey(expanded ? null : row.key)}
                      >
                        <td className={`${gridTd("center", "py-2")} text-[10px] text-ink-muted`}>
                          {expanded ? "▼" : "▶"}
                        </td>
                        <td className={`${gridTd("left", "py-2")}`}>
                          <PortfolioTickerMark
                            ticker={row.ticker}
                            inPortfolio={row.hasPosition}
                            pnlPct={row.pnlPct ?? row.pnlPct24h}
                            className="text-[11px]"
                          />
                          {row.inPaperPortfolio ? (
                            <span className="block text-[9px] font-normal text-[rgb(var(--accent))] mt-0.5">
                              paper
                            </span>
                          ) : null}
                        </td>
                        <td className={gridTd("center", "py-2")}>
                          <CompositeScoreCell
                            score={row.compositeScore}
                            zone={row.scoringZone}
                            breakdown={row.scoreBreakdown}
                            dampened={row.compositeDampened}
                            zoneLabel={
                              row.scoringZone
                                ? t(`recommendationAlert.scoringZone.${row.scoringZone}`)
                                : undefined
                            }
                            dampenedHint={t("recommendationAlert.compositeDampened").trim()}
                          />
                        </td>
                        <td className={`${gridTd("center", "py-2")} text-[10px]`}>
                          {row.profile === "portfolio" ? (it ? "Portaf." : "Port.") : "Opp."}
                        </td>
                        <td className={`${gridTd("center", "py-2")} tabular-nums`}>
                          {row.daysToCd != null ? `T−${row.daysToCd}` : "—"}
                        </td>
                        <td
                          className={`${gridTd("center", "py-2")} font-semibold uppercase ${actionClass(row.suggestedAction, row.hasPosition)}`}
                          title={
                            row.adviceCorrection?.demotion
                              ? `${it ? "Declassato da" : "Demoted from"} ${row.suggestedActionRaw.toUpperCase()} → ${row.suggestedAction.toUpperCase()} · ${it ? "bucket" : "bucket"} ${row.adviceCorrection.demotion.bucketLabel} · ${it ? "bad rate" : "bad rate"} ${(row.adviceCorrection.demotion.badRate * 100).toFixed(0)}% (n=${row.adviceCorrection.demotion.samples})`
                              : undefined
                          }
                        >
                          {suggestedActionLabel(row.suggestedAction, it ? "it" : "en", row.hasPosition)}
                          {row.adviceCorrection?.demotion ? (
                            <span className="ml-1 text-[8px] text-violet-700 dark:text-violet-300" aria-hidden>
                              ⤴
                            </span>
                          ) : null}
                        </td>
                        <td className={`${gridTd("center", "py-2")} text-[10px]`}>
                          {formatTop2VerdictDisplay(row.profile, row.investVerdict, it ? "it" : "en")}
                        </td>
                        <td className={`${gridTd("center", "py-2")} text-[10px]`}>{row.exitDecision}</td>
                        <td
                          className={`${gridTd("center", "py-2")} tabular-nums`}
                          title={
                            row.adviceCorrection?.probPctApplied && row.probPctRaw != null
                              ? `${it ? "P(plan) raw" : "Raw P(plan)"}: ${Math.round(row.probPctRaw)}% · ${it ? "moltiplicatore feedback" : "feedback multiplier"}: ×${row.adviceCorrection.multiplier.toFixed(2)}`
                              : undefined
                          }
                        >
                          {row.probPct != null ? `${Math.round(row.probPct)}%` : "—"}
                          {row.adviceCorrection?.probPctApplied && row.probPctRaw != null ? (
                            <span className="ml-1 text-[8px] text-ink-muted line-through" aria-hidden>
                              {Math.round(row.probPctRaw)}%
                            </span>
                          ) : null}
                        </td>
                        <td className={`${gridTd("center", "py-2")} tabular-nums font-semibold`}>
                          {row.raScore ?? "—"}
                        </td>
                        <td className={`${gridTd("center", "py-2")} tabular-nums`}>
                          {row.affidPct != null ? `${Math.round(row.affidPct)}%` : "—"}
                        </td>
                        <td className={`${gridTd("center", "py-2")} tabular-nums`}>
                          {row.matchPct != null ? `${Math.round(row.matchPct)}%` : "—"}
                        </td>
                        <td className={`${gridTd("center", "py-2")} tabular-nums`}>
                          {row.planReturnPct != null ? `+${row.planReturnPct.toFixed(1)}%` : "—"}
                        </td>
                        <td className={`${gridTd("center", "py-2")} text-[9px]`}>{row.readings.precatKind}</td>
                        <td className={`${gridTd("left", "py-2")} text-[9px] text-ink-muted max-w-[180px]`}>
                          {row.buyBlockReason ?? (row.suggestedAction === "buy" ? "✓" : "—")}
                        </td>
                      </tr>
                      {expanded ? (
                        <tr>
                          <td colSpan={15} className="p-0 border-b border-[rgb(var(--border))]/30">
                            <div className="px-4 py-3 bg-surface/30">
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-2">
                                {t("testerMonitor.suggestionsMonitor.pipeline")}
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {row.pipelineSteps.map((step) => (
                                  <div
                                    key={step.id}
                                    className={`rounded-lg border px-2.5 py-2 ${stepToneClass(step.tone)}`}
                                  >
                                    <p className="text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
                                      {it ? step.labelIt : step.labelEn}
                                    </p>
                                    <p className="text-[11px] mt-0.5 leading-snug">{step.value}</p>
                                  </div>
                                ))}
                              </div>
                              {row.exitReason ? (
                                <p className="text-[10px] text-ink-muted mt-2 italic">{row.exitReason}</p>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
