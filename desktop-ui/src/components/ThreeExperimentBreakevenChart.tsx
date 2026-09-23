import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import type {
  CalibrationSnapshot,
  FrozenWeights,
} from "../calibration/calibrationTypes";
import type { SdsGainBreakdown } from "../sheet/sdsGainBreakdown";
import { loadFrozenWeights } from "../calibration/proposalStore";
import { computeSdsGainBreakdown } from "../sheet/sdsGainBreakdown";
import { computeApprovedWeightShares } from "../sheet/approvedWeightPortfolioShares";
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import {
  allocateFromShares,
  buildThreePortfolioComparison,
  type ThreePortfolioComparison,
} from "../sheet/threePortfolioCompare";
import {
  buildThreeExperimentBreakevenCurves,
  type ExperimentBreakevenSummary,
  type ThreeExperimentKey,
  type PplanBucketRow,
} from "../sheet/threeExperimentBreakeven";
import { loadInvestSimInputs } from "../sheet/investSimStorage";
import { useLang } from "../shared/i18n";

const SERIES: Array<{
  key: ThreeExperimentKey;
  dataKey: "mineEur" | "simEqualEur" | "simWeightedEur";
  color: string;
  labelIt: string;
  labelEn: string;
}> = [
  {
    key: "mine",
    dataKey: "mineEur",
    color: "#2563eb",
    labelIt: "Portfolio reale",
    labelEn: "Real portfolio",
  },
  {
    key: "simEqual",
    dataKey: "simEqualEur",
    color: "#9333ea",
    labelIt: "Sim loop · uniforme",
    labelEn: "Sim loop · uniform",
  },
  {
    key: "simWeighted",
    dataKey: "simWeightedEur",
    color: "#db2777",
    labelIt: "Sim loop · pesato approvato",
    labelEn: "Sim loop · approved weighted",
  },
];

function fmtEur(v: number): string {
  const sign = v > 0 ? "+" : "";
  return `${sign}${Math.round(v).toLocaleString()} €`;
}

function summaryFor(
  summaries: ExperimentBreakevenSummary[],
  key: ThreeExperimentKey,
): ExperimentBreakevenSummary | undefined {
  return summaries.find((s) => s.key === key);
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function PWinMetricCell({
  title,
  value,
  sub,
  accent,
}: {
  title: string;
  value: string;
  sub: string;
  accent?: string;
}) {
  return (
    <div
      className="rounded-md border border-[rgb(var(--border))]/35 bg-[rgb(var(--surface))]/50 px-2 py-1.5 min-w-0"
      style={accent ? { borderTopWidth: 2, borderTopColor: accent } : undefined}
    >
      <p className="text-[8px] uppercase font-semibold text-ink-muted tracking-wide leading-tight">
        {title}
      </p>
      <p className="text-sm font-bold text-ink tabular-nums mt-0.5">{value}</p>
      <p className="text-[8px] text-ink-muted leading-snug mt-0.5">{sub}</p>
    </div>
  );
}

export function ThreeExperimentBreakevenChart({
  closedRows,
  simTable,
  sdsRows,
  investInputs,
  pointsBySeriesKey,
  totalCapitalEur,
  frozenWeightsTick = 0,
  sharedComparison,
  sharedCalibrationSnapshot,
  sharedSdsBreakdown,
  sharedFrozenWeights,
}: {
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  investInputs?: InvestSimInputs;
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
  totalCapitalEur: number;
  frozenWeightsTick?: number;
  /** PERF: shared-context props from the CapDiv tab orchestrator. When
   *  provided, the three heavy sub-computations (calibration snapshot,
   *  SDS breakdown, three-portfolio comparison) are skipped and the shared
   *  values are used directly. See PortfolioDiversificationLabPanel. */
  sharedComparison?: ThreePortfolioComparison | null;
  sharedCalibrationSnapshot?: CalibrationSnapshot | null;
  sharedSdsBreakdown?: SdsGainBreakdown;
  sharedFrozenWeights?: FrozenWeights;
}) {
  const { lang } = useLang();
  const it = lang === "it";
  const [showDetail, setShowDetail] = useState(false);
  const [showDiagnosis, setShowDiagnosis] = useState(false);

  const model = useMemo(() => {
    try {
      const snapshot =
        sharedCalibrationSnapshot !== undefined
          ? sharedCalibrationSnapshot
          : computeCalibrationSnapshot(closedRows, {
              simTable: simTable ?? null,
              sdsRows: sdsRows ?? null,
            });
      const sdsBreakdown =
        sharedSdsBreakdown ??
        computeSdsGainBreakdown(closedRows, {
          simTable,
          sdsRows,
        });
      const comparison =
        sharedComparison ??
        buildThreePortfolioComparison({
          closedRows,
          simTable: simTable ?? null,
          sdsRows: sdsRows ?? null,
          inputs: investInputs ?? loadInvestSimInputs(),
          pointsBySeriesKey: pointsBySeriesKey ?? new Map(),
          lang,
          calibrationSnapshot: snapshot,
          sdsBreakdown,
          totalCapitalEur,
        });
      const frozen = sharedFrozenWeights ?? loadFrozenWeights();
      const simShares = computeApprovedWeightShares(
        comparison.simLoopDeals,
        frozen,
        () => false,
      );
      const shareByKey: Record<string, number> = {};
      comparison.simLoopDeals.forEach((d, i) => {
        shareByKey[d.rowKey] = simShares[i] ?? 0;
      });
      const simWeightedAlloc = allocateFromShares(
        comparison.simLoopDeals,
        totalCapitalEur,
        shareByKey,
      );
      return buildThreeExperimentBreakevenCurves({
        mineDeals: comparison.mineDeals,
        simLoopDeals: comparison.simLoopDeals,
        mineAlloc: comparison.mine,
        simEqualAlloc: comparison.simLoopEqual,
        simWeightedAlloc,
        frozen,
        closedRows,
      });
    } catch {
      return null;
    }
  }, [
    sharedComparison,
    sharedCalibrationSnapshot,
    sharedSdsBreakdown,
    sharedFrozenWeights,
    closedRows,
    simTable,
    sdsRows,
    investInputs,
    pointsBySeriesKey,
    lang,
    totalCapitalEur,
    frozenWeightsTick,
  ]);

  const yDomain = useMemo(() => {
    if (!model?.points.length) return [-500, 1500] as [number, number];
    const vals: number[] = [];
    for (const p of model.points) {
      vals.push(p.mineEur, p.simEqualEur, p.simWeightedEur);
    }
    const min = Math.min(...vals, 0);
    const max = Math.max(...vals, 0);
    const pad = Math.max(200, (max - min) * 0.12);
    return [Math.floor(min - pad), Math.ceil(max + pad)] as [number, number];
  }, [model]);

  if (!model || model.points.length === 0) {
    return (
      <div className="rounded-2xl border border-teal-200/50 dark:border-teal-800/40 bg-white/60 dark:bg-surface/60 p-4">
        <p className="text-sm font-semibold text-ink">
          {it ? "Breakeven vs % di successo" : "Breakeven vs success rate"}
        </p>
        <p className="text-[11px] text-ink-muted mt-2">
          {it
            ? "Servono posizioni aperte nel sim loop o nel portfolio reale."
            : "Need open positions in sim loop or real portfolio."}
        </p>
      </div>
    );
  }

  const diagnosis = model.pplanDiagnosis;
  const simWeightedSummary = summaryFor(model.summaries, "simWeighted");

  return (
    <div className="rounded-2xl border border-teal-200/50 dark:border-teal-800/40 bg-white/60 dark:bg-surface/60 p-4 space-y-3">
      {/* Header */}
      <div>
        <p className="text-[10px] uppercase font-semibold text-teal-700 dark:text-teal-300 tracking-wider">
          {it ? "I 3 esperimenti" : "The 3 experiments"}
        </p>
        <h3 className="text-sm font-bold text-ink mt-0.5">
          {it
            ? "Breakeven probabilistico per esperimento"
            : "Probabilistic breakeven per experiment"}
        </h3>
      </div>

      {/* Per-experiment recap — win % + closed/open P&L (no pooled global average) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {SERIES.map((s) => {
          const sum = summaryFor(model.summaries, s.key);
          const wr = sum?.observedWinRatePct;
          const closedN = sum?.closedDealCount ?? 0;
          const closedWins = sum?.observedWinWins ?? 0;
          const openHeld = sum?.openPositionsHeld ?? 0;
          const openTotal = sum?.nDeals ?? 0;
          return (
            <div
              key={s.key}
              className="rounded-lg border border-[rgb(var(--border))]/40 px-2.5 py-2 min-w-0"
              style={{ borderTopWidth: 2, borderTopColor: s.color }}
            >
              <p className="text-[9px] font-semibold text-ink truncate">
                {it ? s.labelIt : s.labelEn}
              </p>
              <div className="mt-1.5 space-y-1 text-[10px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-ink-muted">
                    {it ? "Win % chiusi" : "Closed win %"}
                  </span>
                  <span
                    className="font-bold tabular-nums text-ink"
                    title={
                      closedN > 0
                        ? it
                          ? `${closedWins}/${closedN} round-trip · P&L % > 0`
                          : `${closedWins}/${closedN} round-trips · P&L % > 0`
                        : undefined
                    }
                  >
                    {wr != null ? `${wr.toFixed(1)}%` : "—"}
                    {closedN > 0 ? (
                      <span className="text-[8px] font-normal text-ink-muted ml-1">
                        ({closedWins}/{closedN})
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-ink-muted">
                    {it ? "P&L chiusi" : "Closed P&L"}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      (sum?.closedPnlEur ?? 0) >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-500 dark:text-red-400"
                    }`}
                  >
                    {closedN > 0 ? fmtEur(sum?.closedPnlEur ?? 0) : "—"}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-ink-muted">
                    {it ? "P&L aperti" : "Open P&L"}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      (sum?.openPnlEur ?? 0) >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-500 dark:text-red-400"
                    }`}
                    title={
                      it
                        ? `MTM su ${openHeld}/${openTotal} deal aperti nell'universo`
                        : `MTM on ${openHeld}/${openTotal} open deals in universe`
                    }
                  >
                    {openHeld > 0 ? fmtEur(sum?.openPnlEur ?? 0) : "—"}
                    {openHeld > 0 ? (
                      <span className="text-[8px] font-normal text-ink-muted ml-1">
                        ({openHeld}/{openTotal})
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[8px] text-ink-muted leading-snug -mt-1">
        {it
          ? "Win % chiusi = round-trip nell'universo dell'esperimento con P&L % > 0. P&L aperti = mark-to-market sul capitale allocato oggi (non è la media dei tre esperimenti)."
          : "Closed win % = round-trips in experiment universe with P&L % > 0. Open P&L = mark-to-market on capital allocated today (not an average across experiments)."}
      </p>

      {/* Breakeven comparison table */}
      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full text-[10px] min-w-[480px]">
          <thead>
            <tr className="border-b border-[rgb(var(--border))]/30">
              <th className="text-left py-1.5 pr-3 text-ink-muted font-medium">
                {it ? "Esperimento" : "Experiment"}
              </th>
              <th className="text-right py-1.5 px-2 text-ink-muted font-medium">
                {it ? "Win rate" : "Win rate"}
              </th>
              <th className="text-right py-1.5 px-2 text-ink-muted font-medium">
                {it ? "Deal" : "Deals"}
              </th>
              <th className="text-right py-1.5 px-2 text-ink-muted font-medium">
                {it ? "P&L chiusi" : "Closed P&L"}
              </th>
              <th className="text-right py-1.5 px-2 text-ink-muted font-medium">
                {it ? "P&L aperti" : "Open P&L"}
              </th>
              <th className="text-right py-1.5 px-2 text-ink-muted font-medium">Avg gain</th>
              <th className="text-right py-1.5 px-2 text-ink-muted font-medium">Avg loss</th>
              <th className="text-right py-1.5 px-2 text-ink-muted font-medium">Breakeven w*</th>
              <th className="text-right py-1.5 px-2 text-ink-muted font-medium">
                {it ? "Margine" : "Margin"}
              </th>
              <th className="py-1.5 pl-2"></th>
            </tr>
          </thead>
          <tbody>
            {SERIES.map((s) => {
              const sum = summaryFor(model.summaries, s.key);
              const wstar = sum?.breakevenWstarPct ?? null;
              const expWr = sum?.observedWinRatePct ?? null;
              const margin =
                wstar != null && expWr != null
                  ? Math.round((expWr - wstar) * 10) / 10
                  : null;
              const above = margin != null ? margin > 0 : null;
              return (
                <tr key={s.key} className="border-b border-[rgb(var(--border))]/15">
                  <td className="py-1.5 pr-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="font-medium text-ink">
                        {it ? s.labelIt : s.labelEn}
                      </span>
                    </span>
                  </td>
                  <td
                    className="text-right py-1.5 px-2 tabular-nums text-ink font-medium"
                    title={
                      sum?.observedWinN
                        ? it
                          ? `${sum.observedWinWins}/${sum.observedWinN} chiusure nell'universo · P&L % > 0`
                          : `${sum.observedWinWins}/${sum.observedWinN} closes in universe · P&L % > 0`
                        : undefined
                    }
                  >
                    {expWr != null ? `${expWr.toFixed(1)}%` : "—"}
                    {sum?.observedWeightedWinRatePct != null &&
                    sum.observedWeightedWinRatePct !== expWr ? (
                      <span className="block text-[8px] text-ink-muted font-normal">
                        {it ? "pesata" : "wtd"} {sum.observedWeightedWinRatePct.toFixed(1)}%
                      </span>
                    ) : null}
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums text-ink">
                    {sum?.nDeals ?? "—"}
                  </td>
                  <td
                    className={`text-right py-1.5 px-2 tabular-nums font-medium ${
                      (sum?.closedPnlEur ?? 0) >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-500 dark:text-red-400"
                    }`}
                    title={
                      sum?.closedDealCount
                        ? it
                          ? `${sum.closedDealCount} chiusure nell'universo`
                          : `${sum.closedDealCount} closes in universe`
                        : undefined
                    }
                  >
                    {(sum?.closedDealCount ?? 0) > 0 ? fmtEur(sum?.closedPnlEur ?? 0) : "—"}
                  </td>
                  <td
                    className={`text-right py-1.5 px-2 tabular-nums font-medium ${
                      (sum?.openPnlEur ?? 0) >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-500 dark:text-red-400"
                    }`}
                    title={
                      sum?.openPositionsHeld
                        ? it
                          ? `MTM · ${sum.openPositionsHeld} posizioni con Var.%`
                          : `MTM · ${sum.openPositionsHeld} positions with return %`
                        : undefined
                    }
                  >
                    {(sum?.openPositionsHeld ?? 0) > 0 ? fmtEur(sum?.openPnlEur ?? 0) : "—"}
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">
                    {sum?.avgGainPct != null ? `+${sum.avgGainPct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums text-red-500 dark:text-red-400 font-medium">
                    {sum?.avgLossPct != null ? `−${sum.avgLossPct.toFixed(1)}%` : "—"}
                  </td>
                  <td className="text-right py-1.5 px-2 tabular-nums text-ink font-semibold">
                    {wstar != null ? `${wstar.toFixed(1)}%` : "—"}
                  </td>
                  <td
                    className={`text-right py-1.5 px-2 tabular-nums font-semibold ${
                      above == null
                        ? "text-ink-muted"
                        : above
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-500 dark:text-red-400"
                    }`}
                  >
                    {margin != null
                      ? `${margin > 0 ? "+" : ""}${margin.toFixed(1)} pp`
                      : "—"}
                  </td>
                  <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                    {above === true && (
                      <span className="text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                        ▲ {it ? "sopra" : "above"}
                      </span>
                    )}
                    {above === false && (
                      <span className="text-[9px] font-semibold text-red-500 dark:text-red-400">
                        ▼ {it ? "sotto" : "below"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[8px] text-ink-muted mt-1 leading-snug">
          {it
            ? "w* = avg_loss / (avg_gain + avg_loss). Win rate = chiusure nell'universo (P&L % > 0). P&L chiusi = somma € round-trip. P&L aperti = MTM oggi. Margine = win rate − w*."
            : "w* = avg_loss / (avg_gain + avg_loss). Win rate = closes in universe (P&L % > 0). Closed P&L = sum € round-trips. Open P&L = MTM today. Margin = win rate − w*."}
        </p>
      </div>

      {/* Line chart */}
      <div className="h-[280px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={model.points} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
            <XAxis
              dataKey="winRatePct"
              type="number"
              domain={[0, 100]}
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => `${v}%`}
              label={{
                value: it ? "% successo assunta" : "Assumed success %",
                position: "bottom",
                offset: -4,
                fontSize: 10,
              }}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={52}
              domain={yDomain}
              tickFormatter={(v) => `${Math.round(Number(v))}`}
              label={{
                value: it ? "P&L atteso (€)" : "Expected P&L (€)",
                angle: -90,
                position: "insideLeft",
                offset: 4,
                fontSize: 10,
              }}
            />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(value, name) => [fmtEur(Number(value)), String(name)]}
              labelFormatter={(l) => (it ? `Successo ${l}%` : `Success ${l}%`)}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine y={0} stroke="#059669" strokeDasharray="4 4" strokeWidth={1.5} />
            {SERIES.map((s) => {
              const sum = summaryFor(model.summaries, s.key);
              return sum?.breakevenWinRatePct != null ? (
                <ReferenceLine
                  key={`be-${s.key}`}
                  x={sum.breakevenWinRatePct}
                  stroke={s.color}
                  strokeDasharray="2 3"
                  strokeOpacity={0.45}
                />
              ) : null;
            })}
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.dataKey}
                name={it ? s.labelIt : s.labelEn}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Collapsible: technical detail (P(win) cal / approved / historical) */}
      <div>
        <button
          className="text-[9px] text-ink-muted flex items-center gap-1 hover:text-ink transition-colors"
          onClick={() => setShowDetail((v) => !v)}
        >
          <span>{showDetail ? "▾" : "▸"}</span>
          <span>
            {it
              ? "Dettaglio tecnico — P(win) cal · approved · storico"
              : "Technical detail — P(win) cal · approved · historical"}
          </span>
        </button>
        {showDetail && (
          <div className="mt-2 space-y-2">
            <p className="text-[8px] text-ink-muted leading-snug">
              {it
                ? "Cal e composite guardano il book aperto con metodologie diverse; lo storico guarda le chiusure mature (P&L > −2%). Corpus grezzo (tutte le chiusure, non per-esperimento):"
                : "Cal and composite look at the open book via different methods; historical looks at matured closes (P&L > −2%). Raw corpus (all closes, not per-experiment):"}
              {" "}
              <span className="tabular-nums font-semibold text-ink">
                {model.observedWinRateGrezzo.pct != null
                  ? `${model.observedWinRateGrezzo.pct.toFixed(1)}%`
                  : "—"}
              </span>
              {model.observedWinRateGrezzo.n > 0 ? (
                <span>
                  {" "}
                  (n={model.observedWinRateGrezzo.wins}/{model.observedWinRateGrezzo.n} · P&L % &gt; 0)
                </span>
              ) : null}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <PWinMetricCell
                title={it ? "P(win) cal." : "P(win) cal."}
                value={fmtPct(simWeightedSummary?.meanCalibratedWinRatePct)}
                sub={
                  it
                    ? "Shrinkage bayesiano · best cell per deal · book sim pesato"
                    : "Bayesian shrinkage · best cell per deal · weighted sim book"
                }
                accent="#db2777"
              />
              <PWinMetricCell
                title={it ? "P(win) approved" : "P(win) approved"}
                value={fmtPct(simWeightedSummary?.meanApprovedCompositeWinRatePct)}
                sub={
                  it
                    ? "Composite 4 dim · pesi congelati Learning Lab · stesso book"
                    : "4-dim composite · frozen Learning Lab weights · same book"
                }
                accent="#db2777"
              />
              <PWinMetricCell
                title={it ? "Win-rate storico (−2%)" : "Historical win-rate (−2%)"}
                value={fmtPct(model.historicalWinRate.pct)}
                sub={
                  it
                    ? `n=${model.historicalWinRate.n} chiusure · P&L > −2% · corpus calibrazione`
                    : `n=${model.historicalWinRate.n} closed · P&L > −2% · calibration corpus`
                }
                accent="#059669"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px]">
              {SERIES.map((s) => {
                const sum = summaryFor(model.summaries, s.key);
                return (
                  <div
                    key={s.key}
                    className="rounded-lg border border-[rgb(var(--border))]/40 px-2 py-1.5"
                    style={{ borderLeftWidth: 3, borderLeftColor: s.color }}
                  >
                    <p className="font-semibold text-ink">{it ? s.labelIt : s.labelEn}</p>
                    <p className="text-ink-muted mt-0.5">
                      Breakeven:{" "}
                      <span className="font-semibold text-ink tabular-nums">
                        {sum?.breakevenWinRatePct != null
                          ? `${sum.breakevenWinRatePct.toFixed(1)}%`
                          : "—"}
                      </span>
                    </p>
                    <div className="grid grid-cols-2 gap-x-2 mt-1 pt-1 border-t border-[rgb(var(--border))]/25">
                      <p className="text-ink-muted">
                        {it ? "P(win) cal." : "P(win) cal."}{" "}
                        <span className="tabular-nums text-ink font-semibold">
                          {fmtPct(sum?.meanCalibratedWinRatePct)}
                        </span>
                      </p>
                      <p className="text-ink-muted">
                        {it ? "P(win) appr." : "P(win) appr."}{" "}
                        <span className="tabular-nums text-ink font-semibold">
                          {fmtPct(sum?.meanApprovedCompositeWinRatePct)}
                        </span>
                      </p>
                    </div>
                    <p className="text-ink-muted mt-0.5">
                      EV @ cal:{" "}
                      <span className="tabular-nums text-ink">
                        {sum?.evAtMeanWinRateEur != null
                          ? fmtEur(sum.evAtMeanWinRateEur)
                          : "—"}
                      </span>
                      {" · "}
                      EV @ appr:{" "}
                      <span className="tabular-nums text-ink">
                        {sum?.evAtApprovedCompositeEur != null
                          ? fmtEur(sum.evAtApprovedCompositeEur)
                          : "—"}
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Collapsible: P(plan) bucket diagnosis */}
      {diagnosis.rows.length > 0 && (
        <div>
          <button
            className="text-[9px] text-ink-muted flex items-center gap-1 hover:text-ink transition-colors"
            onClick={() => setShowDiagnosis((v) => !v)}
          >
            <span>{showDiagnosis ? "▾" : "▸"}</span>
            <span>
              {it
                ? "Diagnosi P(plan): divergenza CAL vs Approved per bucket"
                : "P(plan) diagnosis: CAL vs Approved divergence by bucket"}
            </span>
          </button>
          {showDiagnosis && (
            <div className="mt-2 space-y-2">
              <div className="overflow-x-auto">
                <table className="w-full text-[9px] min-w-[400px]">
                  <thead>
                    <tr className="border-b border-[rgb(var(--border))]/30">
                      <th className="text-left py-1 pr-2 text-ink-muted font-medium">
                        Bucket P(plan)
                      </th>
                      <th className="text-right py-1 px-2 text-ink-muted font-medium">
                        {it ? "Deal" : "Deals"}
                      </th>
                      <th className="text-right py-1 px-2 text-ink-muted font-medium">CAL</th>
                      <th className="text-right py-1 px-2 text-ink-muted font-medium">
                        Approved
                      </th>
                      <th className="text-right py-1 px-2 text-ink-muted font-medium">
                        {it ? "Diverg." : "Diverg."}
                      </th>
                      <th className="text-right py-1 pl-2 text-ink-muted font-medium">
                        {it ? "Peso congel." : "Frozen wt."}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {diagnosis.rows.map((row: PplanBucketRow) => {
                      const isAnomaly = row.bucket === diagnosis.anomalyBucket;
                      return (
                        <tr
                          key={row.bucket}
                          className={`border-b border-[rgb(var(--border))]/15 ${
                            isAnomaly
                              ? "bg-amber-50/40 dark:bg-amber-900/10"
                              : ""
                          }`}
                        >
                          <td className="py-1 pr-2 font-medium text-ink">
                            {row.bucket}
                            {isAnomaly && (
                              <span className="ml-1 text-amber-600 dark:text-amber-400 text-[8px]">
                                ⚠
                              </span>
                            )}
                          </td>
                          <td className="text-right py-1 px-2 tabular-nums text-ink">
                            {row.nDeals}
                          </td>
                          <td className="text-right py-1 px-2 tabular-nums text-ink">
                            {row.calWinRatePct != null
                              ? `${row.calWinRatePct.toFixed(1)}%`
                              : "—"}
                          </td>
                          <td className="text-right py-1 px-2 tabular-nums text-ink">
                            {row.approvedWinRatePct != null
                              ? `${row.approvedWinRatePct.toFixed(1)}%`
                              : "—"}
                          </td>
                          <td
                            className={`text-right py-1 px-2 tabular-nums font-semibold ${
                              row.divergencePp == null
                                ? "text-ink-muted"
                                : row.divergencePp > 0
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-sky-600 dark:text-sky-400"
                            }`}
                          >
                            {row.divergencePp != null
                              ? `${row.divergencePp > 0 ? "+" : ""}${row.divergencePp.toFixed(1)} pp`
                              : "—"}
                          </td>
                          <td className="text-right py-1 pl-2 tabular-nums text-ink-muted">
                            {row.frozenWeightPct != null
                              ? `${row.frozenWeightPct.toFixed(1)}%`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {diagnosis.anomalyBucket && (
                <div className="rounded-md border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/40 dark:bg-amber-900/10 px-2 py-1.5 text-[9px] space-y-0.5">
                  <p className="font-semibold text-amber-700 dark:text-amber-300">
                    ⚠ {it ? "Anomalia rilevata" : "Anomaly detected"}:{" "}
                    {diagnosis.anomalyBucket}
                  </p>
                  {diagnosis.correctedWeightPct != null && (
                    <p className="text-ink-muted">
                      {it
                        ? `Peso congelato diverge da CAL. Correzione per interpolazione (media 30-50% e ≥70%): ${diagnosis.correctedWeightPct.toFixed(1)}%.`
                        : `Frozen weight diverges from CAL. Interpolated correction (avg 30-50% and ≥70%): ${diagnosis.correctedWeightPct.toFixed(1)}%.`}
                    </p>
                  )}
                  {simWeightedSummary?.evAtApprovedCompositeEur != null &&
                    diagnosis.evAtCorrectedApprEur != null && (
                      <p className="text-ink-muted">
                        {it ? "EV @ approved originale" : "EV @ original approved"}:{" "}
                        <span className="tabular-nums font-semibold text-ink">
                          {fmtEur(simWeightedSummary.evAtApprovedCompositeEur)}
                        </span>
                        {" · "}
                        {it ? "EV @ peso corretto" : "EV @ corrected weight"}:{" "}
                        <span className="tabular-nums font-semibold text-ink">
                          {fmtEur(diagnosis.evAtCorrectedApprEur)}
                        </span>
                      </p>
                    )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-[9px] text-ink-muted">
        {it
          ? "Linee verticali = breakeven (bisection EV=0). Payoff win/loss da SDS. Win-rate storico = corpus calibrazione P&L > −2%."
          : "Vertical lines = breakeven (bisection EV=0). Win/loss payoffs from SDS. Historical win rate = calibration corpus P&L > −2%."}
      </p>
    </div>
  );
}
