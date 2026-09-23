/**
 * Explains how Learning Lab **approved (frozen) weights** become allocation %.
 * Used in Capital & Diversification and Learning Lab portfolio tab.
 */
import { Fragment, useMemo, useState } from "react";
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import type { PaperPosition } from "../sheet/investDecisionSimLoop";
import { loadInvestSimInputs } from "../sheet/investSimStorage";
import { buildSuggestionMonitorRows } from "../sheet/suggestionMonitor";
import { buildApprovedWeightsCapitalRows } from "../sheet/approvedWeightsCapitalKpi";
import type {
  CalibrationSnapshot,
  ConfidenceLevel,
  FrozenWeights,
} from "../calibration/calibrationTypes";
import { loadFrozenWeights } from "../calibration/proposalStore";
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import { computeFrozenWeightMultiplier } from "../calibration/sizingRules";
import {
  evaluateWeightedSizingGate,
  weightedSizingGateMessage,
  WEIGHTED_SIZING_MIN_TRADES,
} from "../calibration/weightedSizingGate";
import { computeApprovedWeightShares } from "../sheet/approvedWeightPortfolioShares";
import type { ComparisonDeal } from "../sheet/threePortfolioCompare";
import {
  ALLOCATION_DIMENSIONS,
  compositeApprovedWinRate,
  DIM_LABEL_EN,
  DIM_LABEL_IT,
} from "../sheet/approvedWeightsDisplay";
import { useLang } from "../shared/i18n";

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtShare(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function confidenceTone(c: ConfidenceLevel): string {
  if (c === "high") return "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10";
  if (c === "medium") return "text-amber-800 dark:text-amber-200 bg-amber-500/10";
  return "text-rose-700 dark:text-rose-300 bg-rose-500/10";
}

export function ApprovedWeightsAllocationPanel({
  deals,
  outcomes,
  simTable,
  sdsRows,
  universeLabelIt,
  universeLabelEn,
  defaultOpen = true,
  sharedCalibrationSnapshot,
  sharedFrozenWeights,
  totalCapitalEur = 0,
  investInputs,
  pointsBySeriesKey,
  paperPortfolio,
}: {
  deals: ComparisonDeal[];
  outcomes: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  universeLabelIt: string;
  universeLabelEn: string;
  defaultOpen?: boolean;
  /** PERF: when the parent already computed these, pass them in to avoid
   *  recomputing here (see PortfolioDiversificationLabPanel orchestrator). */
  sharedCalibrationSnapshot?: CalibrationSnapshot | null;
  sharedFrozenWeights?: FrozenWeights;
  /** Capital pot used to translate approved % into recommended $. */
  totalCapitalEur?: number;
  investInputs?: InvestSimInputs;
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
  paperPortfolio?: PaperPosition[];
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const frozen = useMemo(
    () => sharedFrozenWeights ?? loadFrozenWeights(),
    // Only read localStorage when no shared value is provided. Fires on
    // outcomes/deals length as a coarse invalidation for standalone usage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sharedFrozenWeights, outcomes.length, deals.length],
  );

  const snapshot = useMemo(() => {
    if (sharedCalibrationSnapshot !== undefined) return sharedCalibrationSnapshot;
    try {
      return computeCalibrationSnapshot(outcomes, {
        simTable: simTable ?? null,
        sdsRows: sdsRows ?? null,
      });
    } catch {
      return null;
    }
  }, [sharedCalibrationSnapshot, outcomes, simTable, sdsRows]);

  const gate = useMemo(() => evaluateWeightedSizingGate(snapshot), [snapshot]);

  const weightedShares = useMemo(() => {
    if (deals.length === 0) return [];
    return computeApprovedWeightShares(deals, frozen, () => false);
  }, [deals, frozen]);

  const equalShare = deals.length > 0 ? 1 / deals.length : 0;

  const inputs = useMemo(
    () => investInputs ?? loadInvestSimInputs(),
    [investInputs],
  );

  const monitorByKey = useMemo(() => {
    if (!simTable?.rows?.length) return new Map();
    try {
      const rows = buildSuggestionMonitorRows({
        simTable,
        inputs,
        pointsBySeriesKey: pointsBySeriesKey ?? new Map(),
        lang,
        paperPortfolio: paperPortfolio ?? [],
      });
      return new Map(rows.map((r) => [r.key, r]));
    } catch {
      return new Map();
    }
  }, [simTable, inputs, pointsBySeriesKey, lang, paperPortfolio]);

  const capitalRows = useMemo(
    () =>
      buildApprovedWeightsCapitalRows({
        deals,
        weightedShares,
        totalCapitalEur,
        simTable,
        inputs,
        monitorByKey,
      }),
    [deals, weightedShares, totalCapitalEur, simTable, inputs, monitorByKey],
  );

  const frozenCellCount = useMemo(() => {
    let n = 0;
    for (const dim of ALLOCATION_DIMENSIONS) {
      n += Object.keys(frozen.weights[dim] ?? {}).length;
    }
    return n;
  }, [frozen]);

  const globalWin =
    snapshot && snapshot.totalTrades > 0 ? snapshot.globalPrior : null;

  return (
    <details
      open={defaultOpen}
      className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 overflow-hidden"
    >
      <summary className="cursor-pointer select-none list-none px-4 py-3 hover:bg-indigo-500/10 transition-colors [&::-webkit-details-marker]:hidden">
        <p className="text-[10px] uppercase font-semibold text-indigo-700 dark:text-indigo-300 tracking-wider">
          {it ? "Pesi approvati Learning Lab" : "Learning Lab approved weights"}
        </p>
        <h3 className="text-sm font-bold text-ink mt-0.5">
          {it
            ? "Allocazione da probabilità di successo (sistema attuale)"
            : "Allocation from success probability (current system)"}
        </h3>
        <p className="text-[10px] text-ink-muted mt-1 group-open:hidden">
          {it ? universeLabelIt : universeLabelEn} · {deals.length}{" "}
          {it ? "deal" : "deals"} · {frozenCellCount}{" "}
          {it ? "celle approvate" : "approved cells"}
        </p>
      </summary>

      <div className="px-4 pb-4 pt-1 space-y-3 border-t border-indigo-500/20">
        <p className="text-[11px] text-ink-muted leading-relaxed max-w-3xl">
          {it
            ? `Questa sezione analizza solo i pesi bayesiani approvati e congelati (ultimo sistema). Non usa la calibrazione live né il vecchio weighted snapshot. Universo: ${universeLabelIt}.`
            : `This section analyzes only approved frozen Bayesian weights (latest system). It does not use live calibration or the legacy weighted snapshot. Universe: ${universeLabelEn}.`}
        </p>

        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono text-ink-muted bg-[rgb(var(--surface))]/60 rounded-lg px-3 py-2 border border-[rgb(var(--border))]/30">
          <span className="text-ink font-semibold">{it ? "Base" : "Baseline"}</span>
          <span>1 ÷ N</span>
          <span>×</span>
          <span>P(plan)</span>
          <span>×</span>
          <span>SDS</span>
          <span>×</span>
          <span>{it ? "Fase" : "Phase"}</span>
          <span>×</span>
          <span>{it ? "Indic." : "Indic."}</span>
          <span>→</span>
          <span className="text-indigo-700 dark:text-indigo-300 font-semibold">% alloc</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
          <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
            <p className="text-ink-muted">{it ? "Win rate globale" : "Global win rate"}</p>
            <p className="font-semibold tabular-nums">{fmtPct(globalWin)}</p>
          </div>
          <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
            <p className="text-ink-muted">{it ? "Trade calibrazione" : "Calibration trades"}</p>
            <p className="font-semibold tabular-nums">
              {snapshot?.totalTrades ?? 0}
              <span className="text-ink-muted font-normal"> / {WEIGHTED_SIZING_MIN_TRADES}</span>
            </p>
          </div>
          <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
            <p className="text-ink-muted">{it ? "Pesi congelati" : "Frozen weights"}</p>
            <p className="font-semibold tabular-nums">
              {frozen.updatedAt ? frozen.updatedAt.slice(0, 10) : "—"}
            </p>
          </div>
          <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
            <p className="text-ink-muted">{it ? "Sizing pesato" : "Weighted sizing"}</p>
            <p
              className={`font-semibold ${gate.ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}
            >
              {gate.ok ? (it ? "Attivo" : "Active") : it ? "In attesa" : "Waiting"}
            </p>
          </div>
        </div>

        {!gate.ok ? (
          <p className="text-[10px] text-amber-800 dark:text-amber-200 bg-amber-500/10 rounded px-2 py-1.5">
            {weightedSizingGateMessage(gate, lang)}
          </p>
        ) : null}

        {deals.length === 0 ? (
          <p className="text-[11px] text-ink-muted">
            {it ? "Nessun deal nell'universo selezionato." : "No deals in the selected universe."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[rgb(var(--border))]/50">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-ink-muted border-b border-[rgb(var(--border))]/30 bg-[rgb(var(--surface))]/40">
                  <th className="text-left py-1.5 px-2">{it ? "Ticker" : "Ticker"}</th>
                  <th className="text-right py-1.5 px-2">P(win)</th>
                  <th className="text-right py-1.5 px-2">×</th>
                  <th className="text-right py-1.5 px-2">{it ? "Equal" : "Equal"}</th>
                  <th className="text-right py-1.5 px-2">{it ? "Approvato" : "Approved"}</th>
                  <th className="text-right py-1.5 px-2">{it ? "Raccom. $" : "Rec. $"}</th>
                  <th className="text-right py-1.5 px-2">{it ? "Invest. $" : "Inv. $"}</th>
                  <th className="text-right py-1.5 px-2">{it ? "Invest. %" : "Inv. %"}</th>
                  <th className="text-right py-1.5 px-2">{it ? "Azione" : "Action"}</th>
                  <th className="text-left py-1.5 px-2 hidden lg:table-cell">
                    {it ? "Celle" : "Cells"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal, i) => {
                  const mult = computeFrozenWeightMultiplier(deal.cells, frozen);
                  const wShare = weightedShares[i] ?? equalShare;
                  const pWin = compositeApprovedWinRate(deal.cells, frozen) ?? deal.winRate;
                  const cap = capitalRows[i];
                  const expanded = expandedKey === deal.rowKey;
                  const actionTitle =
                    cap?.action && cap.rescueScore != null
                      ? it
                        ? `Rescue score ${cap.rescueScore}/100 · ${cap.action.reason}`
                        : `Rescue score ${cap.rescueScore}/100 · ${cap.action.reason}`
                      : undefined;
                  return (
                    <Fragment key={deal.rowKey}>
                      <tr
                        className="border-b border-[rgb(var(--border))]/20 hover:bg-[rgb(var(--surface))]/30 cursor-pointer"
                        onClick={() => setExpandedKey(expanded ? null : deal.rowKey)}
                      >
                        <td className="py-1.5 px-2 font-medium">{deal.ticker}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{fmtPct(pWin)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-indigo-700 dark:text-indigo-300">
                          ×{mult.toFixed(2)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-ink-muted">
                          {fmtShare(equalShare)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-semibold">
                          {fmtShare(wShare)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-indigo-800 dark:text-indigo-200">
                          {fmtEur(cap?.recommendedUsd)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {(cap?.investedUsd ?? 0) > 0 ? fmtEur(cap?.investedUsd) : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-ink-muted">
                          {(cap?.investedUsd ?? 0) > 0 ? fmtShare(cap?.investedPct) : "—"}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums" title={actionTitle}>
                          {cap?.action ? (
                            <span
                              className={
                                cap.action.side === "buy"
                                  ? "font-semibold text-emerald-700 dark:text-emerald-300"
                                  : "font-semibold text-rose-700 dark:text-rose-300"
                              }
                            >
                              {cap.action.side === "buy" ? "+" : "−"}
                              {fmtEur(cap.action.usd)}
                              <span className="text-[10px] font-normal ml-0.5">
                                ({fmtShare(cap.action.pct)})
                              </span>
                            </span>
                          ) : (
                            <span className="text-ink-muted/60">—</span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 hidden lg:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {ALLOCATION_DIMENSIONS.map((dim) => {
                              const cell = deal.cells[dim];
                              const fw = frozen.weights[dim]?.[cell];
                              const short = (it ? DIM_LABEL_IT : DIM_LABEL_EN)[dim].split(" ")[0];
                              return (
                                <span
                                  key={dim}
                                  className="text-[9px] px-1 rounded bg-[rgb(var(--border))]/20"
                                  title={cell}
                                >
                                  {short} {fw ? fmtPct(fw.weight, 0) : "50%"}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="bg-indigo-500/5">
                          <td colSpan={10} className="px-3 py-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                              {ALLOCATION_DIMENSIONS.map((dim) => {
                                const cell = deal.cells[dim];
                                const fw = frozen.weights[dim]?.[cell];
                                return (
                                  <div
                                    key={dim}
                                    className="text-[10px] rounded border border-[rgb(var(--border))]/30 px-2 py-1"
                                  >
                                    <span className="font-medium">
                                      {(it ? DIM_LABEL_IT : DIM_LABEL_EN)[dim]}
                                    </span>
                                    <span className="text-ink-muted"> · {cell}</span>
                                    {fw ? (
                                      <div className="flex gap-2 mt-0.5 tabular-nums">
                                        <span>{fmtPct(fw.weight)}</span>
                                        <span className={confidenceTone(fw.confidence)}>
                                          {fw.confidence.toUpperCase()} n={fw.n}
                                        </span>
                                      </div>
                                    ) : (
                                      <span className="text-ink-muted"> → neutro 50%</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[9px] text-ink-muted">
          {it
            ? "P(win) = media geometrica dei win rate approvati sulle 4 dimensioni. Raccom. $/% derivano dal capitale pot × peso approvato; Invest. dal portafoglio reale. Azione (verde=compra, rosso=vendi) stima il delta con rescue score e raccomandazioni BUY/trim."
            : "P(win) = geometric mean of approved win rates across 4 dimensions. Rec. $/% = capital pot × approved weight; Inv. = real portfolio. Action (green=buy, red=sell) estimates delta via rescue score and BUY/trim advice."}
        </p>
      </div>
    </details>
  );
}
