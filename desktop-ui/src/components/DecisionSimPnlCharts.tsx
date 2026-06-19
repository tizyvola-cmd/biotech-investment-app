import { useMemo, useState } from "react";
import type { SheetTable } from "../types";
import type { ExperimentPiggyBank } from "../sheet/investDecisionSimExperiment";
import { buildDecisionSimTradePortfolio } from "../sheet/decisionSimTradePortfolio";
import type { DecisionSimTick, PaperPosition, TickerSimEvaluation } from "../sheet/investDecisionSimLoop";
import { useLang, useT } from "../shared/i18n";
import {
  alignSimLoopPnlToPortfolioDates,
  type SimLoopSynthMaturationPoint,
} from "../sheet/simLoopSynthMaturation";
import { TradePortfolioChart } from "./TradePortfolioChart";
import { DECISION_SIM_PAIR_CHART_HEIGHT } from "./decisionSimChartLayout";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";

export function DecisionSimPnlCharts({
  ticks,
  livePiggy,
  liveEvaluations,
  paperPortfolio,
  simTable,
  capitalPerTrade,
  maxOpenPositions,
  compact = false,
  className,
  compareTicks,
  compareLivePiggy,
  comparePaperPortfolio,
  raWhatIfActive = false,
  pairPreChartHeight = null,
  simLoopSynthMaturation = null,
  simLoopWeightedMaturation: _simLoopWeightedMaturation = null,
  simLoopSizedTotalCapitalEur: _simLoopSizedTotalCapitalEur,
}: {
  ticks: DecisionSimTick[];
  livePiggy: ExperimentPiggyBank;
  liveEvaluations: TickerSimEvaluation[];
  paperPortfolio: PaperPosition[];
  simTable: SheetTable | null | undefined;
  capitalPerTrade: number;
  maxOpenPositions?: number;
  lang: "it" | "en";
  compact?: boolean;
  className?: string;
  /** Baseline ticks for dashed overlay when RA what-if is active. */
  compareTicks?: DecisionSimTick[];
  compareLivePiggy?: ExperimentPiggyBank;
  comparePaperPortfolio?: PaperPosition[];
  raWhatIfActive?: boolean;
  /** Measured left pre-chart height — stretches KPI strip for chart alignment. */
  pairPreChartHeight?: number | null;
  simLoopSynthMaturation?: SimLoopSynthMaturationPoint[] | null;
  simLoopWeightedMaturation?: SimLoopSynthMaturationPoint[] | null;
  /** Pot totale sim loop (capPerTrade × maxOpen) per curve weight/synth. */
  simLoopSizedTotalCapitalEur?: number;
}) {
  const t = useT();
  useLang();
  const [curveVariant, setCurveVariant] = useState<"equal" | "synth">("equal");

  const tradePortfolio = useMemo(
    () =>
      buildDecisionSimTradePortfolio({
        ticks,
        simTable,
        paperPortfolio,
        livePiggy,
        liveEvaluations,
        capitalPerTrade,
        maxOpenPositions,
      }),
    [
      ticks,
      simTable,
      paperPortfolio,
      livePiggy,
      liveEvaluations,
      capitalPerTrade,
      maxOpenPositions,
    ],
  );

  const synthPnlCurve = useMemo(() => {
    if (!simLoopSynthMaturation?.length) return null;
    const aligned = alignSimLoopPnlToPortfolioDates(
      simLoopSynthMaturation,
      tradePortfolio.portfolioCurve,
    );
    return aligned.length > 0 ? aligned : null;
  }, [simLoopSynthMaturation, tradePortfolio.portfolioCurve]);

  const activeCurve =
    curveVariant === "synth" && synthPnlCurve ? synthPnlCurve : tradePortfolio.portfolioCurve;

  const comparePortfolio = useMemo(() => {
    if (!raWhatIfActive || !compareTicks?.length) return null;
    return buildDecisionSimTradePortfolio({
      ticks: compareTicks,
      simTable,
      paperPortfolio: comparePaperPortfolio ?? [],
      livePiggy: compareLivePiggy ?? livePiggy,
      liveEvaluations,
      capitalPerTrade,
      maxOpenPositions,
    });
  }, [
    raWhatIfActive,
    compareTicks,
    simTable,
    comparePaperPortfolio,
    compareLivePiggy,
    livePiggy,
    liveEvaluations,
    capitalPerTrade,
    maxOpenPositions,
  ]);

  const hasTradeData =
    tradePortfolio.trades.length > 0 || tradePortfolio.portfolioCurve.length > 0;

  const canToggleSynth = Boolean(synthPnlCurve?.length);

  if (!hasTradeData) {
    return (
      <div
        className={`tester-monitor-panel rounded-xl flex items-center justify-center ${compact ? "p-2 min-h-[260px]" : "p-3"} ${className ?? ""}`}
      >
        <p className="tester-monitor-muted text-[10px] text-center leading-relaxed px-2">
          {t("testerMonitor.decisionSim.chart.pnlEmpty")}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`tester-monitor-panel rounded-xl flex flex-col h-full min-h-0 ${compact ? "p-2" : "p-3 shrink-0"} ${className ?? ""}`}
    >
      <TradePortfolioChart
        trades={tradePortfolio.trades}
        portfolioCurve={activeCurve}
        deployedCapitalEur={tradePortfolio.deployedCapitalEur}
        comparePortfolioCurve={comparePortfolio?.portfolioCurve}
        valueMode="pnl"
        curveVariant={curveVariant}
        showOverlayCurves={false}
        compact
        pairLayout={compact}
        pairPreChartHeight={pairPreChartHeight}
        chartHeight={compact ? DECISION_SIM_PAIR_CHART_HEIGHT : 280}
        headerSlot={
          <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
            <p
              className={`tester-monitor-text font-semibold min-w-0 truncate ${
                compact ? "text-[10px]" : "text-[11px]"
              }`}
              title={
                curveVariant === "synth"
                  ? t("testerMonitor.decisionSim.chart.tradesPnlSynth")
                  : raWhatIfActive
                    ? t("testerMonitor.decisionSim.chart.tradesPnlRa")
                    : t("testerMonitor.decisionSim.chart.tradesPnl")
              }
            >
              {curveVariant === "synth"
                ? t("testerMonitor.decisionSim.chart.tradesPnlSynth")
                : raWhatIfActive
                  ? t("testerMonitor.decisionSim.chart.tradesPnlRa")
                  : t("testerMonitor.decisionSim.chart.tradesPnl")}
            </p>
            {canToggleSynth ? (
              <button
                type="button"
                onClick={() =>
                  setCurveVariant((v) => (v === "equal" ? "synth" : "equal"))
                }
                className={`shrink-0 font-semibold tabular-nums rounded-full border transition-colors ${
                  curveVariant === "synth"
                    ? "border-pink-300/70 bg-pink-50/90 text-pink-800 dark:border-pink-700/50 dark:bg-pink-950/30 dark:text-pink-200"
                    : "border-[rgb(var(--panel-feed-border))]/60 bg-white/90 text-[rgb(var(--panel-feed-accent-strong))] hover:bg-[rgb(var(--panel-feed-row-hover))]/45"
                } ${compact ? "text-[9px] px-2 py-0.5" : "text-[10px] px-2.5 py-1"}`}
                title={
                  curveVariant === "equal"
                    ? t("testerMonitor.decisionSim.chart.showSynthCurveTip")
                    : t("testerMonitor.decisionSim.chart.showEqualCurveTip")
                }
              >
                {curveVariant === "equal"
                  ? t("testerMonitor.decisionSim.chart.showSynthCurve")
                  : t("testerMonitor.decisionSim.chart.showEqualCurve")}
              </button>
            ) : null}
          </div>
        }
      />

      {/* Open positions still maturing in the sim loop */}
      <OpenSimLoopPositionsTable
        paperPortfolio={paperPortfolio}
        liveEvaluations={liveEvaluations}
        simTable={simTable}
      />
    </div>
  );
}

// ── Open positions table (collapsible) ────────────────────────────────────

function fmtEurNoSign(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString("it-IT")} €`;
}

function fmtPct(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;
}

function fmtDate(iso: string): string {
  try {
    const dt = new Date(iso);
    if (!Number.isFinite(dt.getTime())) return iso;
    return dt.toLocaleDateString(undefined, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return iso;
  }
}

function actionBadge(action: TickerSimEvaluation["suggestedAction"]): {
  label: string;
  cls: string;
} {
  switch (action) {
    case "buy":
      return {
        label: "BUY",
        cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
      };
    case "sell":
      return {
        label: "SELL",
        cls: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
      };
    case "hold":
      return {
        label: "HOLD",
        cls: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200",
      };
    case "review":
      return {
        label: "REVIEW",
        cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
      };
    default:
      return { label: "—", cls: "bg-slate-100 text-slate-500" };
  }
}

function OpenSimLoopPositionsTable({
  paperPortfolio,
  liveEvaluations,
  simTable,
}: {
  paperPortfolio: PaperPosition[];
  liveEvaluations: TickerSimEvaluation[];
  simTable: SheetTable | null | undefined;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const rows = useMemo(() => {
    if (paperPortfolio.length === 0) return [];
    const evByKey = new Map<string, TickerSimEvaluation>();
    for (const e of liveEvaluations) evByKey.set(e.key, e);
    const simRowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
    type Row = {
      key: string;
      ticker: string;
      entryAt: string;
      capital: number;
      entryProbPct: number | null;
      entryPlanReturnPct: number | null;
      pnlPct: number | null;
      probNowPct: number | null;
      daysToCd: number | null;
      suggestedAction: TickerSimEvaluation["suggestedAction"];
      exitReason: string | null;
    };
    const out: Row[] = [];
    for (const pos of paperPortfolio) {
      const ev = evByKey.get(pos.key);
      const simRow = simRowByKey.get(pos.key);
      const dtcRaw =
        ev?.daysToCd ??
        (simRow
          ? Number(simRow["Days to CD"] ?? simRow["Days"] ?? simRow["days_to_cd"])
          : null);
      const dtc = Number.isFinite(dtcRaw) ? Number(dtcRaw) : null;
      out.push({
        key: pos.key,
        ticker: pos.ticker,
        entryAt: pos.entryAt,
        capital: pos.capital,
        entryProbPct: pos.entryProbPct ?? null,
        entryPlanReturnPct: pos.entryPlanReturnPct,
        pnlPct: ev?.pnlPct ?? pos.lastMarkPct ?? null,
        probNowPct: ev?.probPct ?? null,
        daysToCd: dtc,
        suggestedAction: ev?.suggestedAction ?? "none",
        exitReason: ev?.exitReason || null,
      });
    }
    out.sort((a, b) => {
      const aHold = a.suggestedAction === "hold" ? 0 : 1;
      const bHold = b.suggestedAction === "hold" ? 0 : 1;
      if (aHold !== bHold) return aHold - bHold;
      const ad = a.daysToCd ?? 9999;
      const bd = b.daysToCd ?? 9999;
      if (ad !== bd) return ad - bd;
      return a.ticker.localeCompare(b.ticker);
    });
    return out;
  }, [paperPortfolio, liveEvaluations, simTable]);

  const sumCap = rows.reduce((s, r) => s + r.capital, 0);
  const sumPnlPct = rows.length
    ? rows.reduce((s, r) => s + (r.pnlPct ?? 0), 0) / rows.length
    : null;
  const buyEvalCount = useMemo(
    () => liveEvaluations.filter((e) => e.suggestedAction === "buy").length,
    [liveEvaluations],
  );
  const pendingBuys = Math.max(
    0,
    buyEvalCount -
      rows.filter((r) => r.suggestedAction === "buy" || r.suggestedAction === "hold").length,
  );

  return (
    <details className="mt-auto rounded-md border border-[rgb(var(--border))]/40 bg-white/50 dark:bg-surface/50">
      <summary className="px-3 py-1.5 cursor-pointer text-[11px] font-semibold text-ink hover:bg-surface/40 transition flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <span className="truncate">
            {it
              ? `▸ Opportunità sim loop ancora in maturazione (${rows.length})`
              : `▸ Sim loop open positions still maturing (${rows.length})`}
          </span>
          {pendingBuys > 0 ? (
            <span
              className="text-[9px] font-normal px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 shrink-0"
              title={
                it
                  ? "BUY suggeriti non ancora entrati nel paper portfolio — verranno aggiunti al prossimo tick"
                  : "BUY suggestions not yet in paper portfolio — will enter on next tick"
              }
            >
              ⏳ {pendingBuys} {it ? "in coda" : "pending"}
            </span>
          ) : (
            <span className="text-[9px] font-normal px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 shrink-0">
              ✓ {it ? "tutti i BUY in portafoglio" : "all BUYs in portfolio"}
            </span>
          )}
        </span>
        {rows.length > 0 ? (
          <span className="text-[10px] font-normal text-ink-muted tabular-nums shrink-0">
            {it ? "Cap" : "Cap"} {fmtEurNoSign(sumCap)}
            {sumPnlPct != null ? ` · ${it ? "P&L medio" : "Avg P&L"} ${fmtPct(sumPnlPct)}` : ""}
          </span>
        ) : null}
      </summary>
      <div className="px-2 pb-2 pt-1">
        {rows.length === 0 ? (
          <p className="text-[11px] text-ink-muted italic px-2 py-3 text-center">
            {it
              ? "Nessuna posizione aperta nel sim loop al momento."
              : "No open positions in the sim loop right now."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[10.5px] table-fixed">
              <colgroup>
                <col style={{ width: "12%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "10%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead className="text-[9.5px] uppercase text-ink-muted">
                <tr className="border-b border-[rgb(var(--border))]/40">
                  <th className="text-left px-2 py-1">Ticker</th>
                  <th className="text-left px-1 py-1">{it ? "Entrata" : "Entry"}</th>
                  <th className="text-right px-1 py-1">{it ? "g. al CD" : "d. to CD"}</th>
                  <th className="text-right px-1 py-1">{it ? "Cap" : "Cap"}</th>
                  <th className="text-right px-1 py-1">{it ? "P(plan) entry" : "P(plan) entry"}</th>
                  <th className="text-right px-1 py-1">{it ? "P(plan) ora" : "P(plan) now"}</th>
                  <th className="text-right px-1 py-1">{it ? "ROI atteso" : "Plan ROI"}</th>
                  <th className="text-right px-1 py-1">P&L</th>
                  <th className="text-center px-1 py-1">{it ? "Azione" : "Action"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const b = actionBadge(r.suggestedAction);
                  const pnlTone =
                    r.pnlPct == null
                      ? "text-ink-muted"
                      : r.pnlPct > 0
                        ? "text-emerald-700 dark:text-emerald-300 font-semibold"
                        : r.pnlPct < 0
                          ? "text-rose-700 dark:text-rose-300 font-semibold"
                          : "text-ink";
                  return (
                    <tr
                      key={r.key}
                      className="border-b border-[rgb(var(--border))]/20 align-middle"
                      title={r.exitReason ?? undefined}
                    >
                      <td className="text-left px-2 py-1 font-semibold text-ink truncate">
                        {r.ticker}
                      </td>
                      <td className="text-left px-1 py-1 tabular-nums text-ink-muted">
                        {fmtDate(r.entryAt)}
                      </td>
                      <td className="text-right px-1 py-1 tabular-nums">
                        {r.daysToCd != null ? r.daysToCd : "—"}
                      </td>
                      <td className="text-right px-1 py-1 tabular-nums">
                        {fmtEurNoSign(r.capital)}
                      </td>
                      <td className="text-right px-1 py-1 tabular-nums text-ink-muted">
                        {r.entryProbPct != null ? `${r.entryProbPct.toFixed(0)}%` : "—"}
                      </td>
                      <td className="text-right px-1 py-1 tabular-nums">
                        {r.probNowPct != null ? `${r.probNowPct.toFixed(0)}%` : "—"}
                      </td>
                      <td className="text-right px-1 py-1 tabular-nums">
                        {fmtPct(r.entryPlanReturnPct)}
                      </td>
                      <td className={`text-right px-1 py-1 tabular-nums ${pnlTone}`}>
                        {fmtPct(r.pnlPct)}
                      </td>
                      <td className="text-center px-1 py-1">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${b.cls}`}>
                          {b.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
