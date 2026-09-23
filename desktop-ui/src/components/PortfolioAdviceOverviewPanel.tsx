/**
 * Portfolio & advice — simplified overview.
 *
 * Shows how approved Bayesian win rates (frozen weights) combine into
 * per-dimension sizing multipliers and normalized portfolio allocation %.
 */
import { Fragment, useMemo, useState } from "react";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type {
  CalibrationDimension,
  CalibrationSnapshot,
  ConfidenceLevel,
  FrozenWeights,
} from "../calibration/calibrationTypes";
import { loadFrozenWeights } from "../calibration/proposalStore";
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import {
  computeFrozenWeightMultiplier,
  computeSizingDecision,
} from "../calibration/sizingRules";
import {
  evaluateWeightedSizingGate,
  weightedSizingGateMessage,
  WEIGHTED_SIZING_MIN_TRADES,
} from "../calibration/weightedSizingGate";
import { computeApprovedWeightShares } from "../sheet/approvedWeightPortfolioShares";
import { loadInvestSimInputs } from "../sheet/investSimStorage";
import { buildThreePortfolioComparison } from "../sheet/threePortfolioCompare";
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

function confidenceTone(c: ConfidenceLevel): string {
  if (c === "high") return "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10";
  if (c === "medium") return "text-amber-800 dark:text-amber-200 bg-amber-500/10";
  return "text-rose-700 dark:text-rose-300 bg-rose-500/10";
}

function WinRateBar({ rate, neutral = 0.5 }: { rate: number; neutral?: number }) {
  const pct = Math.max(0, Math.min(1, rate)) * 100;
  const neu = neutral * 100;
  return (
    <div className="relative h-1.5 rounded-full bg-[rgb(var(--border))]/30 overflow-hidden">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-indigo-500/70"
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute top-0 bottom-0 w-px bg-ink-muted/60"
        style={{ left: `${neu}%` }}
        title="50% neutral"
      />
    </div>
  );
}

function DimensionWeightCard({
  dimension,
  frozen,
  snapshot,
  lang,
}: {
  dimension: CalibrationDimension;
  frozen: FrozenWeights;
  snapshot: CalibrationSnapshot | null;
  lang: "it" | "en";
}) {
  const it = lang === "it";
  const label = it ? DIM_LABEL_IT[dimension] : DIM_LABEL_EN[dimension];
  const frozenCells = Object.entries(frozen.weights[dimension] ?? {}).sort(
    (a, b) => b[1].weight - a[1].weight,
  );
  const liveCells = snapshot?.dimensions[dimension]?.cells ?? [];

  if (frozenCells.length === 0) {
    return (
      <div className="rounded-lg border border-[rgb(var(--border))]/50 p-2.5 space-y-1">
        <p className="text-[11px] font-semibold text-ink">{label}</p>
        <p className="text-[10px] text-ink-muted">
          {it ? "Nessun peso approvato." : "No approved weights."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 p-2.5 space-y-2 min-w-0">
      <p className="text-[11px] font-semibold text-ink">{label}</p>
      <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-0.5">
        {frozenCells.map(([cell, fw]) => {
          const live = liveCells.find((c) => c.cell === cell);
          const mult =
            fw.weight > 0.5
              ? 1 + (fw.weight - 0.5) * 2
              : 1 - (0.5 - fw.weight) * 2;
          const multClamped = Math.max(0.2, Math.min(1.8, mult));
          return (
            <div key={cell} className="text-[10px] space-y-0.5">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-ink" title={cell}>
                  {cell}
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-indigo-700 dark:text-indigo-300">
                  {fmtPct(fw.weight)}
                </span>
              </div>
              <WinRateBar rate={fw.weight} />
              <div className="flex flex-wrap items-center gap-1 text-ink-muted">
                <span className={`px-1 rounded text-[9px] font-bold ${confidenceTone(fw.confidence)}`}>
                  {fw.confidence.toUpperCase()} n={fw.n}
                </span>
                <span className="tabular-nums">
                  ×{multClamped.toFixed(2)}
                </span>
                {live && Math.abs(live.shrinkageApplied - fw.weight) > 0.02 ? (
                  <span className="text-amber-700 dark:text-amber-300" title={it ? "Engine live (non ancora approvato)" : "Live engine (not approved yet)"}>
                    → {fmtPct(live.shrinkageApplied)} live
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function compositeWinProxy(
  cells: Record<CalibrationDimension, string>,
  frozen: FrozenWeights,
): number | null {
  return compositeApprovedWinRate(cells, frozen);
}

export function PortfolioAdviceOverviewPanel({
  outcomes,
  simTable,
  sdsRows,
}: {
  outcomes: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const frozen = useMemo(() => loadFrozenWeights(), [outcomes.length]);

  const snapshot = useMemo(() => {
    try {
      return computeCalibrationSnapshot(outcomes, {
        simTable: simTable ?? null,
        sdsRows: sdsRows ?? null,
      });
    } catch {
      return null;
    }
  }, [outcomes, simTable, sdsRows]);

  const gate = useMemo(() => evaluateWeightedSizingGate(snapshot), [snapshot]);

  const comparison = useMemo(() => {
    const inputs = loadInvestSimInputs();
    const totalCapitalEur = 10_000;
    try {
      return buildThreePortfolioComparison({
        closedRows: outcomes,
        simTable: simTable ?? null,
        inputs,
        sdsRows: sdsRows ?? undefined,
        calibrationSnapshot: snapshot,
        sdsBreakdown: null,
        totalCapitalEur,
        lang,
      });
    } catch {
      return null;
    }
  }, [outcomes, simTable, sdsRows, snapshot, lang]);

  const mineDeals = comparison?.mineDeals ?? [];
  const weightedShares = useMemo(() => {
    if (mineDeals.length === 0) return [];
    return computeApprovedWeightShares(mineDeals, frozen, () => false);
  }, [mineDeals, frozen]);

  const equalShare = mineDeals.length > 0 ? 1 / mineDeals.length : 0;
  const nominalCapital = 10_000;

  const globalWin =
    snapshot && snapshot.totalTrades > 0
      ? snapshot.globalPrior
      : null;

  const frozenCellCount = useMemo(() => {
    let n = 0;
    for (const dim of ALLOCATION_DIMENSIONS) {
      n += Object.keys(frozen.weights[dim] ?? {}).length;
    }
    return n;
  }, [frozen]);

  return (
    <div className="space-y-4">
      {/* Hero — how allocation works */}
      <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-4 space-y-3">
        <div>
          <h3 className="text-base font-bold text-ink">
            {it ? "Probabilità di successo & allocazione" : "Success probability & allocation"}
          </h3>
          <p className="text-[11px] text-ink-muted leading-relaxed mt-1 max-w-3xl">
            {it
              ? "Ogni opportunità attraversa 4 indicatori (P(plan), SDS, fase clinica, indicazione). Per ciascuno usiamo il win rate bayesiano approvato: sopra il 50% aumenta la size, sotto il 50% la riduce. La confidence attenua l’effetto quando n è basso. Le quote finali normalizzano i moltiplicatori sul portafoglio aperto."
              : "Each opportunity passes through 4 indicators (P(plan), SDS, clinical phase, indication). We use the approved Bayesian win rate per bucket: above 50% boosts size, below 50% cuts it. Confidence attenuates the effect when n is low. Final shares normalize multipliers across open positions."}
          </p>
        </div>

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
          <span>{it ? "Indicazione" : "Indication"}</span>
          <span>→</span>
          <span className="text-indigo-700 dark:text-indigo-300 font-semibold">% alloc</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
          <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
            <p className="text-ink-muted">{it ? "Win rate globale" : "Global win rate"}</p>
            <p className="font-semibold tabular-nums">{fmtPct(globalWin)}</p>
          </div>
          <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
            <p className="text-ink-muted">{it ? "Trade in calibrazione" : "Calibration trades"}</p>
            <p className="font-semibold tabular-nums">
              {snapshot?.totalTrades ?? 0}
              <span className="text-ink-muted font-normal"> / {WEIGHTED_SIZING_MIN_TRADES}</span>
            </p>
          </div>
          <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
            <p className="text-ink-muted">{it ? "Pesi approvati" : "Approved cells"}</p>
            <p className="font-semibold tabular-nums">{frozenCellCount}</p>
          </div>
          <div className="rounded border border-[rgb(var(--border))]/40 px-2 py-1.5">
            <p className="text-ink-muted">{it ? "Sizing pesato" : "Weighted sizing"}</p>
            <p
              className={`font-semibold ${gate.ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}
            >
              {gate.ok ? (it ? "Attivo" : "Active") : it ? "In attesa dati" : "Waiting for data"}
            </p>
          </div>
        </div>

        {!gate.ok ? (
          <p className="text-[10px] text-amber-800 dark:text-amber-200 bg-amber-500/10 rounded px-2 py-1.5">
            {weightedSizingGateMessage(gate, lang)}
          </p>
        ) : null}

        {frozen.updatedAt ? (
          <p className="text-[10px] text-ink-muted">
            {it ? "Pesi congelati aggiornati" : "Frozen weights updated"}:{" "}
            {frozen.updatedAt.slice(0, 16).replace("T", " ")}
          </p>
        ) : null}
      </div>

      {/* Dimension weights */}
      <div>
        <h4 className="text-sm font-semibold text-ink mb-2">
          {it ? "Pesi per indicatore (approvati)" : "Weights per indicator (approved)"}
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
          {ALLOCATION_DIMENSIONS.map((dim) => (
            <DimensionWeightCard
              key={dim}
              dimension={dim}
              frozen={frozen}
              snapshot={snapshot}
              lang={lang}
            />
          ))}
        </div>
      </div>

      {/* Open positions allocation */}
      <div className="rounded-lg border border-[rgb(var(--border))]/60 overflow-hidden">
        <div className="px-3 py-2 border-b border-[rgb(var(--border))]/40 bg-[rgb(var(--surface))]/40">
          <h4 className="text-sm font-semibold text-ink">
            {it ? "Allocazione posizioni aperte" : "Open position allocation"}
          </h4>
          <p className="text-[10px] text-ink-muted mt-0.5">
            {it
              ? "Confronto quota uniforme (1÷N) vs quota da pesi approvati sul portafoglio simulazione."
              : "Uniform share (1÷N) vs approved-weight share on the simulation portfolio."}
          </p>
        </div>

        {mineDeals.length === 0 ? (
          <p className="text-[11px] text-ink-muted p-3">
            {it
              ? "Nessuna posizione aperta nel simulatore — attiva almeno un titolo in portafoglio."
              : "No open positions in the simulator — mark at least one ticker as in portfolio."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-ink-muted border-b border-[rgb(var(--border))]/30">
                  <th className="text-left py-1.5 px-2">{it ? "Titolo" : "Ticker"}</th>
                  <th className="text-right py-1.5 px-2">P(win)*</th>
                  <th className="text-right py-1.5 px-2">{it ? "Moltiplicatore" : "Multiplier"}</th>
                  <th className="text-right py-1.5 px-2">{it ? "Uniforme" : "Equal"}</th>
                  <th className="text-right py-1.5 px-2">{it ? "Pesato" : "Weighted"}</th>
                  <th className="text-left py-1.5 px-2 hidden lg:table-cell">
                    {it ? "Indicatori" : "Indicators"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {mineDeals.map((deal, i) => {
                  const mult = computeFrozenWeightMultiplier(deal.cells, frozen);
                  const wShare = weightedShares[i] ?? equalShare;
                  const pWin = compositeWinProxy(deal.cells, frozen) ?? deal.winRate;
                  const expanded = expandedKey === deal.rowKey;
                  const decision = expanded
                    ? computeSizingDecision(
                        {
                          ticker: deal.ticker,
                          cells: deal.cells,
                          totalCapitalEur: nominalCapital,
                          targetPositions: mineDeals.length,
                        },
                        frozen,
                      )
                    : null;

                  return (
                    <Fragment key={deal.rowKey}>
                      <tr
                        className="border-b border-[rgb(var(--border))]/20 hover:bg-[rgb(var(--surface))]/30 cursor-pointer"
                        onClick={() =>
                          setExpandedKey(expanded ? null : deal.rowKey)
                        }
                      >
                        <td className="py-1.5 px-2 font-medium">{deal.ticker}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {fmtPct(pWin)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-indigo-700 dark:text-indigo-300">
                          ×{mult.toFixed(2)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-ink-muted">
                          {fmtShare(equalShare)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-semibold">
                          {fmtShare(wShare)}
                          {wShare > equalShare + 0.005 ? (
                            <span className="text-emerald-600 dark:text-emerald-400 text-[9px] ml-0.5">↑</span>
                          ) : wShare < equalShare - 0.005 ? (
                            <span className="text-rose-600 dark:text-rose-400 text-[9px] ml-0.5">↓</span>
                          ) : null}
                        </td>
                        <td className="py-1.5 px-2 hidden lg:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {ALLOCATION_DIMENSIONS.map((dim) => {
                              const cell = deal.cells[dim];
                              const fw = frozen.weights[dim]?.[cell];
                              const short = it ? DIM_LABEL_IT[dim].split(" ")[0] : DIM_LABEL_EN[dim].split(" ")[0];
                              return (
                                <span
                                  key={dim}
                                  className="text-[9px] px-1 rounded bg-[rgb(var(--border))]/20 text-ink-muted"
                                  title={`${cell} · ${fw ? fmtPct(fw.weight) : "neutral"}`}
                                >
                                  {short}: {fw ? fmtPct(fw.weight, 0) : "50%"}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                      {expanded && decision ? (
                        <tr className="bg-indigo-500/5">
                          <td colSpan={6} className="px-3 py-2">
                            <p className="text-[10px] font-semibold text-ink mb-1.5">
                              {it ? "Contributo per indicatore" : "Per-indicator contribution"}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {decision.contributions.map((c) => (
                                <div
                                  key={c.dimension}
                                  className="text-[10px] rounded border border-[rgb(var(--border))]/30 px-2 py-1"
                                >
                                  <span className="font-medium text-ink">
                                    {it ? DIM_LABEL_IT[c.dimension] : DIM_LABEL_EN[c.dimension]}
                                  </span>
                                  <span className="text-ink-muted"> · {c.cell}</span>
                                  <div className="flex flex-wrap gap-2 mt-0.5 tabular-nums">
                                    <span>P(win) {fmtPct(c.weight)}</span>
                                    <span>×{c.appliedMultiplier.toFixed(2)}</span>
                                    <span className={confidenceTone(c.confidence)}>
                                      {c.confidence.toUpperCase()} n={c.n}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <p className="text-[10px] text-ink-muted mt-1.5">
                              {it ? "Size suggerita" : "Suggested size"}:{" "}
                              <span className="font-semibold text-ink tabular-nums">
                                {decision.sizeEur.toFixed(0)} €
                              </span>{" "}
                              ({fmtShare(decision.sizeFraction)} {it ? "del capitale" : "of capital"})
                            </p>
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
        <p className="text-[9px] text-ink-muted px-3 py-1.5 border-t border-[rgb(var(--border))]/20">
          {it
            ? "* P(win) = media geometrica dei win rate approvati sulle 4 celle del titolo (proxy composita)."
            : "* P(win) = geometric mean of approved win rates across the ticker's 4 cells (composite proxy)."}
        </p>
      </div>
    </div>
  );
}
