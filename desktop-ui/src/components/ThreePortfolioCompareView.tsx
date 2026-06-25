/**
 * Three-portfolio comparison view (top of Capital & Diversification tab).
 *
 * Sits directly under the interactive breakeven widget. Shares the same
 * "Capital pot" input (passed from the parent) so the user changes capital
 * once and sees both views update.
 *
 * Renders:
 *   1. Header + brief explainer
 *   2. Table: rows = unique tickers across mine ∪ sim loop. Per row, three
 *      column groups (Mine equal · Sim loop equal · Sim loop weighted), each
 *      showing capital € + EV € contribution. Totals row at the bottom.
 *   3. Comparison chart: 3 bars (total EV per portfolio scenario).
 *
 * READ-ONLY: no writes to the real portfolio.
 */
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { CalibrationSnapshot } from "../calibration/calibrationTypes";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import { computeCalibrationSnapshot } from "../calibration/shrinkageEngine";
import { evaluateWeightedSizingGate } from "../calibration/weightedSizingGate";
import { computePortfolioSizingSuccessComparison } from "../sheet/portfolioWeightedSizing";
import { computeSdsGainBreakdown } from "../sheet/sdsGainBreakdown";
import { buildSynthCurveAllocation } from "../sheet/buildSynthCurveAllocation";
import {
  allocateFromShares,
  buildThreePortfolioComparison,
  computeSynthGainImpact,
  type ComparisonDeal,
  type PortfolioAllocation,
  type ThreePortfolioComparison,
} from "../sheet/threePortfolioCompare";
import {
  harmonizeAllocationRealized,
  summarizeThreeScenarioGainTotals,
} from "../sheet/portfolioScenarioGain";
import { loadDecisionSimState } from "../sheet/investDecisionSimStorage";
import { DEFAULT_PLAN_CAPITAL_EUR } from "../sheet/expectedRoiDisplay";
import { SIM_TABLE_SYNTH_MAX_SHARE } from "../sheet/approvedWeightPortfolioShares";
import { SynthGainImpactPanel, type PortfolioBalancingSuccessRow } from "./SynthGainImpactPanel";
import { computeRealizedSuccessForDeals } from "../sheet/portfolioSuccessBridge";
import {
  extractAllRowFeatures,
  runUnivariateScreening,
} from "../riskPattern/lossRiskScreening";
import { matchPattern } from "../riskPattern/lossRiskPattern";
import { loadApprovedPattern } from "../riskPattern/patternProposalStore";
import type { PhaseAResult, RiskPattern } from "../riskPattern/riskPatternTypes";
import { useLang } from "../shared/i18n";
import { hydrateUiPrefsFromDisk, loadUiPrefsLocal, saveUiPrefs } from "../sheet/uiPrefs";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import { simulationRowPredAtOffset } from "../data/simulationCharts";
import { STANDARD_CAL_OFFSETS } from "../sheet/chartNodes";
import { WeightedSizingGateBanner } from "./WeightedSizingGateBanner";
import {
  LossRiskBreakdownModal,
  type LossRiskEntry,
} from "./LossRiskPoopCell";
import {
  RiskBenefitScaleCell,
  deriveBenefitFillPct,
} from "./RiskBenefitScaleIcon";

/** Adapter: ComparisonDeal → generic LossRiskEntry used by the shared cell. */
function dealToLossRiskEntry(deal: ComparisonDeal): LossRiskEntry {
  return {
    ticker: deal.ticker,
    phaseLabel: deal.cells.clinicalPhase ?? "",
    riskScore: deal.riskScore,
    lossRisk: deal.lossRisk,
    cells: deal.cells,
  };
}

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${Math.round(v).toLocaleString("it-IT")} €`;
}

function fmtEurNoSign(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString("it-IT")} €`;
}

function fmtPct01(v: number | null | undefined, d = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(d)}%`;
}

type GroupSummary = {
  mineN: number;
  mineEmployedEur: number;
  simLoopN: number;
  simLoopEmployedEur: number;
  synthEmployedEur: number;
  perTradeEur: number;
  capPct: number;
};

/** "3 experiments at a glance" — explains what each group does, when it accepts
 *  a recommendation (threshold) and how it deploys capital, plus the real
 *  capital employed (vs the apples-to-apples shared pot used by the charts). */
function ThreeGroupExplainer({
  summary,
  it,
  fmtEur,
}: {
  summary: GroupSummary;
  it: boolean;
  fmtEur: (v: number | null | undefined) => string;
}) {
  const groups = [
    {
      key: "mine",
      name: it ? "Portfolio reale" : "Real portfolio",
      dot: "#2563eb",
      what: it
        ? "Le tue posizioni reali: decidi tu quali raccomandazioni seguire."
        : "Your real positions: you decide which recommendations to follow.",
      threshold: it ? "a tua discrezione" : "your discretion",
      capitalRule: it ? "il tuo capitale reale" : "your real capital",
      employed: summary.mineEmployedEur > 0 ? fmtEur(summary.mineEmployedEur) : "—",
      n: summary.mineN,
    },
    {
      key: "simLoop",
      name: it ? "Sim loop (uniforme)" : "Sim loop (uniform)",
      dot: "#9333ea",
      what: it
        ? "Entra su ogni raccomandazione sopra la soglia, importo fisso uguale per tutte."
        : "Enters every recommendation above the threshold, equal fixed amount each.",
      threshold: it ? "verdetto SÌ + gain atteso > 0 (o P ≥ 40–45%)" : "YES verdict + expected gain > 0 (or P ≥ 40–45%)",
      capitalRule: it
        ? `${fmtEur(summary.perTradeEur)} fissi a company`
        : `${fmtEur(summary.perTradeEur)} flat per company`,
      employed: fmtEur(summary.simLoopEmployedEur),
      n: summary.simLoopN,
    },
    {
      key: "synth",
      name: it ? "Sim synth loop (pesato)" : "Sim synth loop (weighted)",
      dot: "#db2777",
      what: it
        ? "Stessa soglia e stesso universo del sim loop, ma capitale pesato sul pattern approvato."
        : "Same threshold and universe as the sim loop, but capital weighted by the approved pattern.",
      threshold: it ? "verdetto SÌ + gain atteso > 0 (o P ≥ 40–45%)" : "YES verdict + expected gain > 0 (or P ≥ 40–45%)",
      capitalRule: it
        ? `pesato sui pesi approvati (max ${summary.capPct}%/deal)`
        : `weighted by approved weights (max ${summary.capPct}%/deal)`,
      employed: fmtEur(summary.synthEmployedEur),
      n: summary.simLoopN,
    },
  ];
  return (
    <div className="rounded-xl border border-indigo-200/50 dark:border-indigo-800/40 bg-indigo-50/30 dark:bg-indigo-950/15 px-3 py-2.5">
      <p className="text-[11px] font-semibold text-indigo-900 dark:text-indigo-100 mb-1.5">
        {it ? "I 3 esperimenti a confronto" : "The 3 experiments at a glance"}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] tabular-nums">
          <thead>
            <tr className="text-ink-muted border-b border-indigo-200/40 dark:border-indigo-800/30">
              <th className="text-left font-semibold py-1 pr-2">{it ? "Gruppo" : "Group"}</th>
              <th className="text-left font-semibold py-1 px-2">{it ? "Cosa fa" : "What it does"}</th>
              <th className="text-left font-semibold py-1 px-2">
                {it ? "Soglia ingresso" : "Entry threshold"}
              </th>
              <th className="text-left font-semibold py-1 px-2">
                {it ? "Regola capitale" : "Capital rule"}
              </th>
              <th className="text-right font-semibold py-1 pl-2 whitespace-nowrap">
                {it ? "Capitale reale impiegato" : "Real capital employed"}
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-b border-indigo-200/20 dark:border-indigo-800/15 align-top">
                <td className="py-1 pr-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1 font-semibold text-ink">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: g.dot }} />
                    {g.name}
                  </span>
                </td>
                <td className="py-1 px-2 text-ink-muted max-w-[220px]">{g.what}</td>
                <td className="py-1 px-2 text-ink-muted whitespace-nowrap">{g.threshold}</td>
                <td className="py-1 px-2 text-ink-muted">{g.capitalRule}</td>
                <td className="py-1 pl-2 text-right font-semibold text-ink whitespace-nowrap">
                  {g.employed}
                  <span className="font-normal text-ink-muted"> · n={g.n}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[9px] text-ink-muted/80 mt-1.5 leading-relaxed">
        {it
          ? "I grafici e la tabella qui sotto sono a parità di capitale (stesso pot per tutti e 3) per confrontare solo il metodo di sizing — non i capitali reali sopra."
          : "The charts and table below use the same capital pot for all 3 to compare only the sizing method — not the real capital employed above."}
      </p>
    </div>
  );
}

/** Pearson correlation; null when fewer than 3 finite pairs or zero variance. */
function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  if (den <= 0) return null;
  return num / den;
}

function confTone(c: "low" | "medium" | "high"): string {
  if (c === "high") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (c === "medium") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  return "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200";
}

function evTone(v: number): string {
  if (v > 0) return "text-emerald-700 dark:text-emerald-300 font-semibold";
  if (v < 0) return "text-rose-700 dark:text-rose-300 font-semibold";
  return "text-ink-muted";
}

/** One point of the cumulative dual-chart series.
 *
 *  - `mine` / `simEq` / `simW` = **portfolio value** = cumulative cost basis +
 *    cumulative P&L for the corresponding scenario. So the curve starts at
 *    €0 (no deal yet) and at each step grows by the new deal's capital plus
 *    that deal's gain/loss applied to that capital.
 *  - `breakevenMine` / `breakevenSimEq` / `breakevenSimW` = **cumulative
 *    cost basis** for that scenario. This is the "what I've spent so far"
 *    line — a step function that increases every time a new deal is funded
 *    and matches the portfolio value when there is no P&L.
 *  - `breakevenShared` = average of the three cost-basis trajectories above,
 *    used as the single green dashed "breakeven" reference line on the
 *    chart. All three scenarios share the same total capital pot (they just
 *    allocate it differently), so the average is a faithful aggregate
 *    visualisation of "what has been spent so far".
 *  - `pnlMine` / `pnlSimEq` / `pnlSimW` = cumulative P&L only (kept for the
 *    tooltip and the under-chart summary).
 */
export type CumulativeScenarioKey =
  | "mine"
  | "mineW"
  | "mineSynth"
  | "simEq"
  | "simW"
  | "simLoopSynth";

export type PortfolioCumulativeRow = {
  idx: number;
  label: string;
  mine: number;
  mineW: number;
  mineSynth: number;
  simEq: number;
  simW: number;
  simLoopSynth: number;
  breakevenMine: number;
  breakevenMineW: number;
  breakevenMineSynth: number;
  breakevenSimEq: number;
  breakevenSimW: number;
  breakevenSimLoopSynth: number;
  breakevenShared: number;
  pnlMine: number;
  pnlMineW: number;
  pnlMineSynth: number;
  pnlSimEq: number;
  pnlSimW: number;
  pnlSimLoopSynth: number;
};

const SCENARIO_ROW_FIELDS: Record<
  CumulativeScenarioKey,
  {
    value:
      | "mine"
      | "mineW"
      | "mineSynth"
      | "simEq"
      | "simW"
      | "simLoopSynth";
    breakeven:
      | "breakevenMine"
      | "breakevenMineW"
      | "breakevenMineSynth"
      | "breakevenSimEq"
      | "breakevenSimW"
      | "breakevenSimLoopSynth";
    pnl:
      | "pnlMine"
      | "pnlMineW"
      | "pnlMineSynth"
      | "pnlSimEq"
      | "pnlSimW"
      | "pnlSimLoopSynth";
  }
> = {
  mine: { value: "mine", breakeven: "breakevenMine", pnl: "pnlMine" },
  mineW: { value: "mineW", breakeven: "breakevenMineW", pnl: "pnlMineW" },
  mineSynth: { value: "mineSynth", breakeven: "breakevenMineSynth", pnl: "pnlMineSynth" },
  simEq: { value: "simEq", breakeven: "breakevenSimEq", pnl: "pnlSimEq" },
  simW: { value: "simW", breakeven: "breakevenSimW", pnl: "pnlSimW" },
  simLoopSynth: {
    value: "simLoopSynth",
    breakeven: "breakevenSimLoopSynth",
    pnl: "pnlSimLoopSynth",
  },
};

/**
 * Side-by-side dual line chart (Total cumulative P&L · 24h cumulative P&L).
 * Pure presentational — receives pre-built rows + Y domains so the parent
 * can keep all data wiring (universe selection, allocations, walk order).
 *
 * For each scenario the pane renders TWO lines:
 *   - a solid monotone-cubic curve = portfolio value (cost basis + P&L)
 *   - a dashed step line = breakeven = cumulative cost basis (what the user
 *     has spent so far). The vertical gap between them at any X = current
 *     cumulative P&L — solid above dashed → in profit, solid below → in loss.
 *
 * Both curves start at €0 (row 0) and accumulate one deal at a time. The
 * breakeven line rises step-by-step as each new deal adds capital, and the
 * portfolio value rises alongside it plus the deal's gain.
 */
function PortfolioCumulativeDualChart({
  totalRows,
  dailyRows,
  totalYDomain,
  dailyGainYDomain,
  scenarios,
  visibleScenarios,
  onToggleScenario,
  walkSortMode,
  onSetWalkSortMode,
  todayIdx,
  it,
  fmtEur: fmtEurFn,
}: {
  totalRows: PortfolioCumulativeRow[];
  dailyRows: PortfolioCumulativeRow[];
  totalYDomain: [number, number];
  /** Gain-only Y domain for the right pane — anchored at €0, scoped to
   *  the 24h P&L series only (no invested-capital baseline). */
  dailyGainYDomain: [number, number];
  scenarios: Array<{
    key: CumulativeScenarioKey;
    name: string;
    positions: number;
    held: number;
    color: string;
  }>;
  /** Per-scenario visibility flags — controlled by the chip toolbar. */
  visibleScenarios: Record<CumulativeScenarioKey, boolean>;
  onToggleScenario: (key: CumulativeScenarioKey) => void;
  /** Sort mode for the deal walk-order along the X axis. */
  walkSortMode: "chrono" | "abs";
  onSetWalkSortMode: (mode: "chrono" | "abs") => void;
  /** X-axis index marking "today" on the deal walk. `null` hides the marker
   *  (e.g. when sorting by |%| desc rather than chronologically). */
  todayIdx: number | null;
  it: boolean;
  fmtEur: (v: number | null | undefined) => string;
}) {
  /** Filter the scenarios actually rendered as <Line>. We keep the full
   *  `scenarios` array around for the chip bar (so disabled chips still
   *  show with their colour swatch) but only draw the lines the user has
   *  checked on. At least one chip stays on conceptually — if the user
   *  hides all three the chart simply renders an empty plot with the
   *  breakeven line. */
  const renderedScenarios = scenarios.filter((s) => visibleScenarios[s.key]);

  /** Toolbar above the dual chart — three scenario chips (toggle each on/off)
   *  + a small sort-mode switch on the right. Kept compact so it doesn't
   *  steal vertical space from the charts. */
  const toolbar = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1.5">
      <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">
        {it ? "Mostra" : "Show"}
      </span>
      {scenarios.map((s) => {
        const on = visibleScenarios[s.key];
        const locked = false;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => {
              if (locked) return;
              onToggleScenario(s.key);
            }}
            disabled={locked}
            aria-pressed={on}
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium border transition ${
              locked
                ? "border-amber-200/80 dark:border-amber-800/50 bg-amber-50/60 dark:bg-amber-950/20 text-amber-900/70 dark:text-amber-100/70 cursor-not-allowed opacity-80"
                : on
                  ? "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-ink"
                  : "border-slate-200/60 dark:border-slate-700/60 bg-slate-50/70 dark:bg-slate-900/50 text-ink-muted/70 line-through"
            }`}
            title={
              locked
                ? it
                  ? "Sizing pesato disabilitato"
                  : "Weighted sizing disabled"
                : on
                  ? it
                    ? `Nascondi ${s.name}`
                    : `Hide ${s.name}`
                  : it
                    ? `Mostra ${s.name}`
                    : `Show ${s.name}`
            }
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: on ? s.color : "transparent", borderColor: s.color, borderWidth: 1.5, borderStyle: "solid" }}
              aria-hidden
            />
            {s.name}
          </button>
        );
      })}

      <span className="grow" />

      <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">
        {it ? "Ordine" : "Order"}
      </span>
      <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-600 overflow-hidden">
        <button
          type="button"
          onClick={() => onSetWalkSortMode("chrono")}
          aria-pressed={walkSortMode === "chrono"}
          className={`px-2 py-0.5 text-[10px] font-medium ${
            walkSortMode === "chrono"
              ? "bg-indigo-600 text-white"
              : "bg-white dark:bg-slate-800 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-700"
          }`}
          title={
            it
              ? "Aggiungi i deal nell'ordine in cui sono stati comprati (data acquisto o catalyst date)."
              : "Add deals in the order they were bought (purchase date or catalyst date)."
          }
        >
          {it ? "Cronologico" : "Chronological"}
        </button>
        <button
          type="button"
          onClick={() => onSetWalkSortMode("abs")}
          aria-pressed={walkSortMode === "abs"}
          className={`px-2 py-0.5 text-[10px] font-medium border-l border-slate-300 dark:border-slate-600 ${
            walkSortMode === "abs"
              ? "bg-indigo-600 text-white"
              : "bg-white dark:bg-slate-800 text-ink-muted hover:bg-slate-50 dark:hover:bg-slate-700"
          }`}
          title={
            it
              ? "Ordina i deal per |contributo %| decrescente — i più impattanti per primi."
              : "Order deals by |contribution %| descending — biggest movers first."
          }
        >
          |%| desc
        </button>
      </div>
    </div>
  );
  const breakevenKey = (key: CumulativeScenarioKey) => SCENARIO_ROW_FIELDS[key].breakeven;

  const pnlKey = (key: CumulativeScenarioKey) => SCENARIO_ROW_FIELDS[key].pnl;

  const valueKey = (key: CumulativeScenarioKey) => SCENARIO_ROW_FIELDS[key].value;

  const renderPane = (
    rows: PortfolioCumulativeRow[],
    yDomain: [number, number],
    title: string,
    subtitle: string,
    _gradientId: string,
    /** Display mode:
     *  - "value" (default): plot `mine` / `simEq` / `simW` (portfolio
     *    VALUE = invested + P&L) + the stepped invested-capital line +
     *    the horizontal "total breakeven" reference.
     *  - "gain24h": plot ONLY the per-scenario cumulative gain (`pnlMine`
     *    / `pnlSimEq` / `pnlSimW`) and anchor the breakeven at €0 with a
     *    single green dashed reference line. Matches the Step 3 chart
     *    convention so the two surfaces are directly comparable.
     */
    mode: "value" | "gain24h" = "value",
  ) => {
    const lastRow = rows[rows.length - 1] ?? null;
    const isGain = mode === "gain24h";
    // In gain-only mode the scenario lines reference the cumulative
    // P&L fields (pnl*), so we resolve a dataKey through `pnlKey`.
    const scenarioDataKey = (k: CumulativeScenarioKey) =>
      isGain ? pnlKey(k) : valueKey(k);
    return (
      <div className="flex-1 min-w-0">
        <header className="mb-1">
          <p className="text-[11px] font-semibold text-indigo-900 dark:text-indigo-100">{title}</p>
          <p className="text-[10px] text-ink-muted leading-snug">{subtitle}</p>
        </header>
        <div className="w-full h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 22, right: 28, left: 0, bottom: 18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" vertical={false} />
              <XAxis
                dataKey="idx"
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                tickFormatter={(v) => (Number(v) === 0 ? (it ? "Start" : "Start") : `#${v}`)}
                label={{
                  value:
                    walkSortMode === "chrono"
                      ? it
                        ? "Deal aggiunti in ordine cronologico (data acquisto / catalyst)"
                        : "Deals added in chronological order (purchase / catalyst date)"
                      : it
                        ? "Deal aggiunto (ordine: contributo |%| desc)"
                        : "Deal added (order: |%| desc)",
                  position: "insideBottom",
                  offset: -6,
                  style: { fontSize: 9, fill: "rgba(100,116,139,0.85)" },
                }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickFormatter={(v) =>
                  `${Math.round(Number(v)) === 0 ? 0 : Number(v).toLocaleString("it-IT")} €`
                }
                width={64}
                domain={yDomain}
                allowDataOverflow={false}
              />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                cursor={{ stroke: "rgba(148,163,184,0.35)", strokeWidth: 1 }}
                labelFormatter={(_xValue, payload) => {
                  const row = payload?.[0]?.payload as
                    | PortfolioCumulativeRow
                    | undefined;
                  if (!row || row.idx === 0)
                    return it ? "Punto di partenza (€0 investiti)" : "Starting point (€0 invested)";
                  return `${it ? "Deal" : "Deal"} #${row.idx} — ${row.label}`;
                }}
                formatter={(value, dataKey, item) => {
                  const key = String(dataKey);
                  const row = item?.payload as PortfolioCumulativeRow | undefined;
                  if (key === "breakevenShared") {
                    return [
                      fmtEurFn(Number(value)),
                      it ? "Breakeven (capitale investito)" : "Breakeven (invested capital)",
                    ];
                  }
                  // Resolve which scenario owns this dataKey (works in both
                  // modes: in "value" mode key === scenario.key, in
                  // "gain24h" mode key === `pnl${Mine|SimEq|SimW}`).
                  const scenario = scenarios.find(
                    (s) => key === s.key || key === pnlKey(s.key),
                  );
                  const baseLabel = scenario?.name ?? key;
                  if (row && scenario) {
                    const pnl = row[pnlKey(scenario.key)] ?? 0;
                    const cost = row[breakevenKey(scenario.key)] ?? 0;
                    const tag = pnl >= 0
                      ? it ? "guadagno" : "gain"
                      : it ? "perdita" : "loss";
                    if (isGain) {
                      return [
                        `${fmtEurFn(Number(value))} — ${it ? "P&L 24h cumulato" : "cumulative 24h P&L"} (${it ? "investito" : "invested"} ${fmtEurFn(cost)})`,
                        `${baseLabel} · ${tag}`,
                      ];
                    }
                    return [
                      `${fmtEurFn(Number(value))} — ${it ? "investito" : "invested"} ${fmtEurFn(cost)} · ${tag} ${fmtEurFn(pnl)}`,
                      baseLabel,
                    ];
                  }
                  return [fmtEurFn(Number(value)), baseLabel];
                }}
              />
              {/* Shared "breakeven" reference.
                  - VALUE mode: stepped invested-capital line (canonical
                    breakeven the user has to recover before turning a
                    profit). Solid scenario curves above = in profit.
                  - GAIN24H mode: a single horizontal green dashed line at
                    €0. The chart no longer carries the invested-capital
                    baseline so €0 IS the breakeven; scenarios above 0 =
                    net 24h gain, below = net 24h loss. */}
              {isGain ? null : (
                <Line
                  key="breakeven-shared"
                  type="stepAfter"
                  dataKey="breakevenShared"
                  name={it ? "Breakeven (capitale investito)" : "Breakeven (invested capital)"}
                  stroke="#16a34a"
                  strokeWidth={1.6}
                  strokeOpacity={0.85}
                  strokeDasharray="6 4"
                  isAnimationActive={false}
                  dot={false}
                  activeDot={false}
                  legendType="none"
                />
              )}
              {renderedScenarios.map((scenario) => (
                <Line
                  key={scenario.key}
                  type="monotone"
                  dataKey={scenarioDataKey(scenario.key)}
                  name={scenario.name}
                  stroke={scenario.color}
                  strokeWidth={2.2}
                  strokeOpacity={0.95}
                  isAnimationActive={false}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
              {/* Horizontal breakeven reference line.
                  - VALUE mode: drawn at the level of the total invested
                    capital once every deal has been funded (= the plateau
                    of the stepped dashed line at the right edge). Lets
                    the user read "am I above the invested capital line?"
                    without tracing the stair-step.
                  - GAIN24H mode: drawn at €0 — the canonical breakeven
                    when the invested-capital baseline is removed from the
                    chart. Same green dashed style as the Step 3 chart
                    below for visual continuity. */}
              {isGain ? (
                <ReferenceLine
                  y={0}
                  stroke="#16a34a"
                  strokeWidth={1.6}
                  strokeDasharray="6 4"
                  strokeOpacity={0.9}
                  ifOverflow="extendDomain"
                  label={{
                    value: it ? "Breakeven (€0)" : "Breakeven (€0)",
                    position: "insideRight",
                    fill: "#15803d",
                    fontSize: 9,
                    fontWeight: 600,
                  }}
                />
              ) : lastRow && lastRow.breakevenShared > 0 ? (
                <ReferenceLine
                  y={lastRow.breakevenShared}
                  stroke="#15803d"
                  strokeWidth={1.4}
                  strokeDasharray="2 3"
                  strokeOpacity={0.9}
                  ifOverflow="extendDomain"
                  label={{
                    value: it
                      ? `Breakeven totale: ${fmtEurFn(lastRow.breakevenShared)}`
                      : `Total breakeven: ${fmtEurFn(lastRow.breakevenShared)}`,
                    position: "insideTopRight",
                    fill: "#15803d",
                    fontSize: 9,
                    fontWeight: 600,
                  }}
                />
              ) : null}

              {/* "Today" vertical marker — drawn at the X index that splits
                  past deals (entry date ≤ today) from upcoming ones. Hidden
                  when the X axis is no longer chronological. */}
              {todayIdx != null && todayIdx > 0 && todayIdx < rows.length ? (
                <ReferenceLine
                  x={todayIdx}
                  stroke="#dc2626"
                  strokeWidth={1.4}
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: it ? "OGGI" : "TODAY",
                    position: "top",
                    fill: "#dc2626",
                    fontSize: 9,
                    fontWeight: 600,
                  }}
                />
              ) : null}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {lastRow ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
            {renderedScenarios.map((s) => {
              const cost = lastRow[breakevenKey(s.key)];
              const pnl = lastRow[pnlKey(s.key)];
              // In gain mode the headline number is the cumulative gain
              // itself (€, signed), with invested capital as context.
              // In value mode we headline the portfolio value (cost + P&L)
              // and parenthesize the invested capital — same as before.
              if (isGain) {
                return (
                  <span key={s.key} className="inline-flex items-center gap-1 tabular-nums">
                    <span
                      className="inline-block w-2.5 h-0.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                      aria-hidden
                    />
                    <span className="text-ink-muted">{s.name}:</span>
                    <span
                      className="font-semibold"
                      style={{ color: pnl >= 0 ? s.color : "rgb(190 18 60)" }}
                      title={
                        it
                          ? `Gain 24h cumulato ${pnl >= 0 ? "+" : ""}${fmtEurFn(pnl)} su ${fmtEurFn(cost)} investiti.`
                          : `Cumulative 24h gain ${pnl >= 0 ? "+" : ""}${fmtEurFn(pnl)} on ${fmtEurFn(cost)} invested.`
                      }
                    >
                      {pnl >= 0 ? "+" : ""}{fmtEurFn(pnl)}
                    </span>
                    <span
                      className="text-ink-muted"
                      title={it ? "Capitale totale investito" : "Total capital invested"}
                    >
                      ({it ? "su" : "on"} {fmtEurFn(cost)})
                    </span>
                  </span>
                );
              }
              const value = lastRow[valueKey(s.key)] ?? 0;
              return (
                <span key={s.key} className="inline-flex items-center gap-1 tabular-nums">
                  <span
                    className="inline-block w-2.5 h-0.5 rounded-full"
                    style={{ backgroundColor: s.color }}
                    aria-hidden
                  />
                  <span className="text-ink-muted">{s.name}:</span>
                  <span
                    className="font-semibold"
                    style={{ color: pnl >= 0 ? s.color : "rgb(190 18 60)" }}
                    title={
                      it
                        ? `Valore portafoglio ${fmtEurFn(value)} = investito ${fmtEurFn(cost)} ${pnl >= 0 ? "+" : ""}${fmtEurFn(pnl)}`
                        : `Portfolio value ${fmtEurFn(value)} = invested ${fmtEurFn(cost)} ${pnl >= 0 ? "+" : ""}${fmtEurFn(pnl)}`
                    }
                  >
                    {fmtEurFn(value)}
                  </span>
                  <span
                    className="text-ink-muted"
                    title={it ? "Capitale totale investito" : "Total capital invested"}
                  >
                    ({it ? "inv." : "inv."} {fmtEurFn(cost)})
                  </span>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {toolbar}
      <div className="flex flex-col lg:flex-row gap-4">
        {renderPane(
          totalRows,
          totalYDomain,
          it
            ? "Valore portafoglio cumulato (investito + P&L totale)"
            : "Cumulative portfolio value (invested + total P&L)",
          it
            ? "Linea tratteggiata = capitale investito (breakeven, sale a gradini ogni volta che entra un nuovo deal). Linea piena = valore corrente del portafoglio (investito + P&L mark-to-market). Gap fra le due = guadagno/perdita."
            : "Dashed line = invested capital (breakeven, steps up every time a new deal is funded). Solid line = current portfolio value (invested + mark-to-market P&L). Gap between the two = gain/loss.",
          "cap-div-total-loss-zone",
        )}
        {renderPane(
          dailyRows,
          dailyGainYDomain,
          it
            ? "Gain 24h cumulato (€) — breakeven a €0"
            : "Cumulative 24h gain (€) — breakeven at €0",
          it
            ? "Stessi deal in ordine cronologico, ma sull'asse Y c'è SOLO il P&L 24h (senza il capitale investito). La linea verde tratteggiata a €0 è il breakeven: sopra = guadagno netto delle ultime 24h, sotto = perdita. Stessa convenzione del grafico Step 3 sotto — i numeri devono corrispondere."
            : "Same chronological deals, but the Y axis shows ONLY the 24h P&L (without the invested capital). The green dashed line at €0 is the breakeven: above = net 24h gain, below = loss. Same convention as the Step 3 chart below — the numbers must line up.",
          "cap-div-daily-loss-zone",
          "gain24h",
        )}
      </div>
    </div>
  );
}

export function ThreePortfolioCompareView({
  closedRows,
  simTable,
  sdsRows,
  investInputs,
  pointsBySeriesKey,
  totalCapitalEur,
  patternStoreVersion,
  frozenWeightsTick = 0,
}: {
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  investInputs?: InvestSimInputs;
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
  totalCapitalEur: number;
  patternStoreVersion: number;
  /** Bumped when Learning Lab approves frozen weights. */
  frozenWeightsTick?: number;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const [panelOpen, setPanelOpen] = useState(() => {
    const v = loadUiPrefsLocal().threePortfolioCompareOpen;
    return v == null ? true : Boolean(v);
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const disk = await hydrateUiPrefsFromDisk();
      if (cancelled || disk == null || typeof disk.threePortfolioCompareOpen !== "boolean") {
        return;
      }
      setPanelOpen(disk.threePortfolioCompareOpen);
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const onPanelToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const next = e.currentTarget.open;
    setPanelOpen(next);
    saveUiPrefs({ threePortfolioCompareOpen: next });
  };

  // Modal state — when the user clicks the poop icon on a row, we open a
  // popup with the full Phase A + Phase B loss-risk breakdown for that deal.
  const [riskModalDeal, setRiskModalDeal] = useState<ComparisonDeal | null>(null);

  const calibrationSnapshot = useMemo<CalibrationSnapshot | null>(() => {
    try {
      return computeCalibrationSnapshot(closedRows, { simTable, sdsRows });
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedRows, simTable, sdsRows, patternStoreVersion]);

  const weightedGate = useMemo(
    () => evaluateWeightedSizingGate(calibrationSnapshot),
    [calibrationSnapshot],
  );

  const sdsBreakdown = useMemo(
    () => computeSdsGainBreakdown(closedRows, { simTable, sdsRows }),
    [closedRows, simTable, sdsRows],
  );

  // Phase A screening (univariate loss-risk per bucket) — feeds riskScore.
  const phaseA = useMemo<PhaseAResult | null>(() => {
    try {
      return runUnivariateScreening(closedRows, { simTable, sdsRows });
    } catch {
      return null;
    }
  }, [closedRows, simTable, sdsRows]);

  // Approved Phase B pattern — re-read when parent bumps patternStoreVersion.
  const approvedPattern = useMemo<RiskPattern | null>(() => {
    try {
      return loadApprovedPattern().current ?? null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternStoreVersion]);

  /**
   * Pre-resolve the Step 2 risk-pattern match for every row in the universe so
   * the weighted allocation can apply the patternPenalty without rebuilding the
   * feature snapshot. Same shape used by Step 3's breakeven chart — keeps the
   * two surfaces in lockstep (a deal that matches the risk pattern shrinks in
   * both the Three-Portfolio "weighted" column and the Step 3 curve).
   *
   * When no pattern is approved we keep the map empty → every deal gets the
   * neutral patternPenalty=1.0 and the allocation reduces to EV × confidence.
   */
  const patternMatchByRowKey = useMemo(() => {
    const map = new Map<string, boolean>();
    if (!approvedPattern) return map;
    try {
      const features = extractAllRowFeatures(closedRows, { simTable, sdsRows });
      for (const [fk, fc] of features) {
        // feature keys are `${TICKER}|...` — store the result keyed by the
        // upper-case ticker so the per-deal lookup is O(1) without scanning.
        const ticker = fk.split("|")[0]?.toUpperCase();
        if (!ticker) continue;
        if (matchPattern(approvedPattern, fc)) {
          // Tag every row whose ticker we resolved as a pattern match. The
          // matcher below looks up by ticker first (more robust across the
          // two universes which can use slightly different rowKey shapes).
          map.set(ticker, true);
        }
      }
    } catch {
      /* swallow — empty map keeps every deal at patternPenalty=1.0 */
    }
    return map;
  }, [approvedPattern, closedRows, simTable, sdsRows]);

  const matchesStep2Pattern = useMemo(
    () => (deal: ComparisonDeal) =>
      patternMatchByRowKey.get(deal.ticker.toUpperCase()) === true,
    [patternMatchByRowKey],
  );

  const comparison = useMemo<ThreePortfolioComparison>(
    () => {
      const paperPortfolio = loadDecisionSimState().paperPortfolio;
      return buildThreePortfolioComparison({
        closedRows,
        simTable,
        sdsRows,
        inputs: investInputs,
        pointsBySeriesKey,
        lang,
        calibrationSnapshot,
        sdsBreakdown,
        totalCapitalEur,
        phaseA,
        approvedPattern,
        matchesStep2Pattern,
        paperPortfolio,
      });
    },
    [
      closedRows,
      simTable,
      sdsRows,
      investInputs,
      pointsBySeriesKey,
      lang,
      calibrationSnapshot,
      sdsBreakdown,
      totalCapitalEur,
      phaseA,
      approvedPattern,
      matchesStep2Pattern,
    ],
  );

  /** 24h gain target — same default as Step 3 (0.5% of pot, min €50). */
  const synthTargetGainEur = Math.max(50, Math.round(totalCapitalEur * 0.005));

  /**
   * Approved weights (Learning Lab) → Weight Sim Exp (Step 3 target) → synth curves.
   * Single builder shared with CapDiv Step 3 synthesizer session.
   */
  const synthCurveAllocation = useMemo(
    () =>
      buildSynthCurveAllocation({
        closedRows,
        simTable,
        sdsRows,
        investInputs,
        pointsBySeriesKey,
        lang,
        calibrationSnapshot,
        sdsBreakdown,
        totalCapitalEur,
        targetGainEur: synthTargetGainEur,
        phaseA,
        approvedPattern,
        matchesStep2Pattern,
      }),
    [
      closedRows,
      simTable,
      sdsRows,
      investInputs,
      pointsBySeriesKey,
      lang,
      calibrationSnapshot,
      sdsBreakdown,
      totalCapitalEur,
      synthTargetGainEur,
      phaseA,
      approvedPattern,
      matchesStep2Pattern,
      frozenWeightsTick,
    ],
  );

  const mineSynthAllocation = useMemo<PortfolioAllocation>(() => {
    const deals = comparison.mineDeals;
    if (deals.length === 0 || totalCapitalEur <= 0 || !synthCurveAllocation) {
      return comparison.mine;
    }
    return allocateFromShares(
      deals,
      totalCapitalEur,
      synthCurveAllocation.portfolioSharesByRowKey,
    );
  }, [comparison.mineDeals, comparison.mine, totalCapitalEur, synthCurveAllocation]);

  /** Approved-weight baseline for real portfolio (no 24h target optimization). */
  const mineApprovedAllocation = useMemo<PortfolioAllocation>(() => {
    const deals = comparison.mineDeals;
    if (deals.length === 0 || totalCapitalEur <= 0 || !synthCurveAllocation) {
      return comparison.mine;
    }
    return allocateFromShares(
      deals,
      totalCapitalEur,
      synthCurveAllocation.portfolioApprovedSharesByRowKey,
    );
  }, [comparison.mineDeals, comparison.mine, totalCapitalEur, synthCurveAllocation]);

  const simLoopSynthAllocation = useMemo<PortfolioAllocation>(() => {
    const deals = comparison.simLoopDeals;
    if (deals.length === 0 || totalCapitalEur <= 0 || !synthCurveAllocation) {
      return comparison.simLoopEqual;
    }
    return harmonizeAllocationRealized(
      allocateFromShares(
        deals,
        totalCapitalEur,
        synthCurveAllocation.simLoopSharesByRowKey,
      ),
      deals,
    );
  }, [
    comparison.simLoopDeals,
    comparison.simLoopEqual,
    totalCapitalEur,
    synthCurveAllocation,
  ]);

  const harmonizedScenarioTotals = useMemo(
    () =>
      summarizeThreeScenarioGainTotals({
        portfolio: comparison.mine,
        simLoopEqual: comparison.simLoopEqual,
        simLoopSynth: simLoopSynthAllocation,
      }),
    [comparison.mine, comparison.simLoopEqual, simLoopSynthAllocation],
  );

  /** Approved-weight baseline for sim loop (no 24h target optimization). */
  const simLoopApprovedAllocation = useMemo<PortfolioAllocation>(() => {
    const deals = comparison.simLoopDeals;
    if (deals.length === 0 || totalCapitalEur <= 0 || !synthCurveAllocation) {
      return comparison.simLoopEqual;
    }
    return allocateFromShares(
      deals,
      totalCapitalEur,
      synthCurveAllocation.simLoopApprovedSharesByRowKey,
    );
  }, [
    comparison.simLoopDeals,
    comparison.simLoopEqual,
    totalCapitalEur,
    synthCurveAllocation,
  ]);

  // Build the table rows: union of mine + sim loop, sorted by max cap allocated.
  const tableRows = useMemo(() => {
    const simLoopDealKeys = new Set(comparison.simLoopDeals.map((d) => d.rowKey));
    const rows = comparison.allDeals.map((d) => {
      const mineCap = comparison.mine.capByTicker[d.ticker] ?? 0;
      const simEqCap = comparison.simLoopEqual.capByTicker[d.ticker] ?? 0;
      const simSynthCap = simLoopDealKeys.has(d.rowKey)
        ? (simLoopSynthAllocation.capByTicker[d.ticker] ?? 0)
        : 0;
      const mineRealized = comparison.mine.realizedEurByTicker[d.ticker] ?? 0;
      const simEqRealized = comparison.simLoopEqual.realizedEurByTicker[d.ticker] ?? 0;
      const simSynthRealized = simLoopDealKeys.has(d.rowKey)
        ? (simLoopSynthAllocation.realizedEurByTicker[d.ticker] ?? 0)
        : 0;
      const simSynthSharePct =
        simSynthCap > 0 && simLoopSynthAllocation.totalCapitalEur > 0
          ? (simSynthCap / simLoopSynthAllocation.totalCapitalEur) * 100
          : null;
      return {
        deal: d,
        mineCap,
        simEqCap,
        simSynthCap,
        mineRealized,
        simEqRealized,
        simSynthRealized,
        simSynthSharePct,
        maxCap: Math.max(mineCap, simEqCap, simSynthCap),
      };
    });
    rows.sort((a, b) => b.maxCap - a.maxCap);
    return rows;
  }, [comparison, simLoopSynthAllocation]);

  // Scenario metadata — five portfolio strategies on the cumulative charts.
  // Each scenario draws ONE curve per chart (Total P&L + 24h P&L); the curve
  // starts at €0 and accumulates each deal's contribution under that
  // scenario's capital split.
  const scenarioMeta = useMemo(
    () => [
      {
        key: "mine" as const,
        name: it ? "Mio (€ equi)" : "Mine (equal €)",
        positions: comparison.mine.positionsCount,
        held: comparison.mine.realizedPositionsCount,
        color: "#2563eb",
        allocation: comparison.mine,
      },
      {
        key: "mineW" as const,
        name: it ? "Mio · pesati" : "Mine · weighted",
        positions: mineApprovedAllocation.positionsCount,
        held: mineApprovedAllocation.realizedPositionsCount,
        color: "#10b981",
        allocation: mineApprovedAllocation,
      },
      {
        key: "mineSynth" as const,
        name: it ? "Mio (synth)" : "Mine (synth)",
        positions: mineSynthAllocation.positionsCount,
        held: mineSynthAllocation.realizedPositionsCount,
        color: "#0d9488",
        allocation: mineSynthAllocation,
      },
      {
        key: "simEq" as const,
        name: it ? "Sim loop · equi" : "Sim loop · equal",
        positions: comparison.simLoopEqual.positionsCount,
        held: comparison.simLoopEqual.realizedPositionsCount,
        color: "#9333ea",
        allocation: comparison.simLoopEqual,
      },
      {
        key: "simW" as const,
        name: it ? "Sim loop · pesati" : "Sim loop · weighted",
        positions: simLoopApprovedAllocation.positionsCount,
        held: simLoopApprovedAllocation.realizedPositionsCount,
        color: "#059669",
        allocation: simLoopApprovedAllocation,
      },
      {
        key: "simLoopSynth" as const,
        name: it ? "Sim loop (synth)" : "Sim loop (synth)",
        positions: simLoopSynthAllocation.positionsCount,
        held: simLoopSynthAllocation.realizedPositionsCount,
        color: "#db2777",
        allocation: simLoopSynthAllocation,
      },
    ],
    [comparison, mineApprovedAllocation, mineSynthAllocation, simLoopSynthAllocation, simLoopApprovedAllocation, it],
  );

  /** "Real capital employed" per experiment group — how each one actually
   *  deploys money (independent of the apples-to-apples shared pot used by the
   *  charts below). */
  const groupSummary = useMemo(() => {
    const mineN = comparison.mine.positionsCount;
    const mineEmployedEur = comparison.mineDeals.reduce((sum, d) => {
      const cap = investInputs?.[d.rowKey]?.capital ?? 0;
      return sum + (Number.isFinite(cap) && cap > 0 ? cap : 0);
    }, 0);
    const simLoopN = comparison.simLoopEqual.positionsCount;
    const simLoopEmployedEur = DEFAULT_PLAN_CAPITAL_EUR * simLoopN;
    return {
      mineN,
      mineEmployedEur,
      simLoopN,
      simLoopEmployedEur,
      // The synth loop deploys the same total as the uniform loop; it only
      // redistributes the per-company share by approved-pattern weight.
      synthEmployedEur: simLoopEmployedEur,
      perTradeEur: DEFAULT_PLAN_CAPITAL_EUR,
      capPct: Math.round(SIM_TABLE_SYNTH_MAX_SHARE * 100),
    };
  }, [comparison, investInputs]);

  /** X-axis sort mode for the cumulative chart.
   *  - "chrono": each deal added on the day it was actually bought (real
   *    portfolio) or, falling back, on its completion date (sim-loop-only
   *    deals). This is the default — it makes the curve grow as new
   *    positions enter the book in real life.
   *  - "abs": legacy order, biggest |realized %| first. Useful to spot
   *    which single deal carries each scenario. */
  const [walkSortMode, setWalkSortMode] = useState<"chrono" | "abs">("chrono");

  /** Which scenarios are visible on the chart. Multi-select so the user can
   *  compare all curves or zoom in on one at a time. */
  const [visibleScenarios, setVisibleScenarios] = useState<
    Record<CumulativeScenarioKey, boolean>
  >({ mine: true, mineW: true, mineSynth: true, simEq: true, simW: true, simLoopSynth: true });

  useEffect(() => {
    const hasApprovedSimLoop =
      comparison.simLoopDeals.length > 0 && simLoopApprovedAllocation.totalCapitalEur > 0;
    const hasApprovedMine =
      comparison.mineDeals.length > 0 && mineApprovedAllocation.totalCapitalEur > 0;
    setVisibleScenarios((prev) => ({
      ...prev,
      mineW: hasApprovedMine,
      simW: hasApprovedSimLoop,
    }));
  }, [
    comparison.simLoopDeals.length,
    comparison.mineDeals.length,
    simLoopApprovedAllocation.totalCapitalEur,
    mineApprovedAllocation.totalCapitalEur,
  ]);

  /** Best-available "entry day" for one deal. We prefer the user's
   *  purchaseDate (their declared buy date), then investedAt (timestamp
   *  recorded when capital first appeared), then the deal's completion
   *  date (catalyst proxy for sim-loop-only deals). */
  const entryDateForDeal = (deal: ComparisonDeal): string => {
    const entry = investInputs?.[deal.rowKey];
    if (entry?.purchaseDate) return entry.purchaseDate;
    if (entry?.investedAt) return entry.investedAt.slice(0, 10);
    const cd = deal.rowKey.split("|")[1];
    if (cd && cd !== "—") return cd;
    return "9999-12-31";
  };

  const walkOrder = useMemo(() => {
    const sorted = [...comparison.allDeals];
    if (walkSortMode === "chrono") {
      sorted.sort((a, b) => {
        const cmp = entryDateForDeal(a).localeCompare(entryDateForDeal(b));
        if (cmp !== 0) return cmp;
        return a.ticker.localeCompare(b.ticker);
      });
    } else {
      sorted.sort((a, b) => {
        const ra = a.realizedReturnPct == null ? 0 : Math.abs(a.realizedReturnPct);
        const rb = b.realizedReturnPct == null ? 0 : Math.abs(b.realizedReturnPct);
        if (ra !== rb) return rb - ra;
        return a.ticker.localeCompare(b.ticker);
      });
    }
    return sorted;
    // entryDateForDeal closes over `investInputs` — listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparison.allDeals, walkSortMode, investInputs]);

  /**
   * Builds the cumulative time-series for one allocation snapshot.
   *
   * Returns one row per deal index 0..N where index 0 is the "Start" point
   * (nothing invested yet) and indices 1..N add one deal at a time:
   *   - breakevenMine / breakevenSimEq / breakevenSimW = cumulative capital
   *     deployed by each scenario up to that step. This is the financial
   *     "breakeven" — what the user has spent and needs to recover before
   *     turning a profit.
   *   - pnlMine / pnlSimEq / pnlSimW = cumulative P&L for that scenario,
   *     computed as `cap × pickPct(deal)/100` running sum.
   *   - mine / simEq / simW = portfolio VALUE = cost basis + P&L. Solid
   *     curves plotted against dashed breakeven step lines make the
   *     gain/loss visually unmistakable as the gap between the two lines.
   */
  const buildCumulativeSeries = (
    deals: ComparisonDeal[],
    pickPctForScope: (deal: ComparisonDeal, scope: "mine" | "sim") => number | null,
  ): PortfolioCumulativeRow[] => {
    const rows: PortfolioCumulativeRow[] = [
      {
        idx: 0,
        label: "",
        mine: 0,
        mineW: 0,
        mineSynth: 0,
        simEq: 0,
        simW: 0,
        simLoopSynth: 0,
        breakevenMine: 0,
        breakevenMineW: 0,
        breakevenMineSynth: 0,
        breakevenSimEq: 0,
        breakevenSimW: 0,
        breakevenSimLoopSynth: 0,
        breakevenShared: 0,
        pnlMine: 0,
        pnlMineW: 0,
        pnlMineSynth: 0,
        pnlSimEq: 0,
        pnlSimW: 0,
        pnlSimLoopSynth: 0,
      },
    ];
    let minePnl = 0;
    let mineWPnl = 0;
    let mineSynthPnl = 0;
    let simEqPnl = 0;
    let simWPnl = 0;
    let simLoopSynthPnl = 0;
    let mineCost = 0;
    let mineWCost = 0;
    let mineSynthCost = 0;
    let simEqCost = 0;
    let simWCost = 0;
    let simLoopSynthCost = 0;
    const mineRowKeys = new Set(comparison.mineDeals.map((deal) => deal.rowKey));
    const simLoopRowKeys = new Set(comparison.simLoopDeals.map((deal) => deal.rowKey));
    const capIfInUniverse = (
      rowKey: string,
      universe: Set<string>,
      capByTicker: Record<string, number>,
      ticker: string,
    ): number => (universe.has(rowKey) ? (capByTicker[ticker] ?? 0) : 0);
    deals.forEach((d, i) => {
      const minePctNum =
        (() => {
          const pct = pickPctForScope(d, "mine");
          return pct != null && Number.isFinite(pct) ? pct : 0;
        })();
      const simPctNum =
        (() => {
          const pct = pickPctForScope(d, "sim");
          return pct != null && Number.isFinite(pct) ? pct : 0;
        })();
      const mineCap = capIfInUniverse(
        d.rowKey,
        mineRowKeys,
        comparison.mine.capByTicker,
        d.ticker,
      );
      const mineWCap = capIfInUniverse(
        d.rowKey,
        mineRowKeys,
        mineApprovedAllocation.capByTicker,
        d.ticker,
      );
      const mineSynthCap = capIfInUniverse(
        d.rowKey,
        mineRowKeys,
        mineSynthAllocation.capByTicker,
        d.ticker,
      );
      const simEqCap = capIfInUniverse(
        d.rowKey,
        simLoopRowKeys,
        comparison.simLoopEqual.capByTicker,
        d.ticker,
      );
      const simWCap = capIfInUniverse(
        d.rowKey,
        simLoopRowKeys,
        simLoopApprovedAllocation.capByTicker,
        d.ticker,
      );
      const simLoopSynthCap = capIfInUniverse(
        d.rowKey,
        simLoopRowKeys,
        simLoopSynthAllocation.capByTicker,
        d.ticker,
      );
      mineCost += mineCap;
      mineWCost += mineWCap;
      mineSynthCost += mineSynthCap;
      simEqCost += simEqCap;
      simWCost += simWCap;
      simLoopSynthCost += simLoopSynthCap;
      minePnl += (mineCap * minePctNum) / 100;
      mineWPnl += (mineWCap * minePctNum) / 100;
      mineSynthPnl += (mineSynthCap * minePctNum) / 100;
      simEqPnl += (simEqCap * simPctNum) / 100;
      simWPnl += (simWCap * simPctNum) / 100;
      simLoopSynthPnl += (simLoopSynthCap * simPctNum) / 100;
      rows.push({
        idx: i + 1,
        label: d.ticker,
        breakevenMine: Math.round(mineCost),
        breakevenMineW: Math.round(mineWCost),
        breakevenMineSynth: Math.round(mineSynthCost),
        breakevenSimEq: Math.round(simEqCost),
        breakevenSimW: Math.round(simWCost),
        breakevenSimLoopSynth: Math.round(simLoopSynthCost),
        breakevenShared: Math.round(
          (mineCost + mineWCost + mineSynthCost + simEqCost + simWCost + simLoopSynthCost) /
            6,
        ),
        pnlMine: Math.round(minePnl),
        pnlMineW: Math.round(mineWPnl),
        pnlMineSynth: Math.round(mineSynthPnl),
        pnlSimEq: Math.round(simEqPnl),
        pnlSimW: Math.round(simWPnl),
        pnlSimLoopSynth: Math.round(simLoopSynthPnl),
        mine: Math.round(mineCost + minePnl),
        mineW: Math.round(mineWCost + mineWPnl),
        mineSynth: Math.round(mineSynthCost + mineSynthPnl),
        simEq: Math.round(simEqCost + simEqPnl),
        simW: Math.round(simWCost + simWPnl),
        simLoopSynth: Math.round(simLoopSynthCost + simLoopSynthPnl),
      });
    });
    return rows;
  };

  const mineDealByKey = useMemo(
    () => new Map(comparison.mineDeals.map((d) => [d.rowKey, d])),
    [comparison.mineDeals],
  );
  const simLoopDealByKey = useMemo(
    () => new Map(comparison.simLoopDeals.map((d) => [d.rowKey, d])),
    [comparison.simLoopDeals],
  );

  const totalCumulativeData = useMemo(
    () =>
      buildCumulativeSeries(walkOrder, (d, scope) => {
        const src = scope === "mine" ? mineDealByKey.get(d.rowKey) : simLoopDealByKey.get(d.rowKey);
        return src?.realizedReturnPct ?? null;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      walkOrder,
      comparison,
      mineDealByKey,
      simLoopDealByKey,
      mineApprovedAllocation,
      mineSynthAllocation,
      simLoopSynthAllocation,
      simLoopApprovedAllocation,
    ],
  );
  const dailyCumulativeData = useMemo(
    () =>
      buildCumulativeSeries(walkOrder, (d, scope) => {
        const src = scope === "mine" ? mineDealByKey.get(d.rowKey) : simLoopDealByKey.get(d.rowKey);
        return src?.realizedReturnPct24h ?? null;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      walkOrder,
      comparison,
      mineDealByKey,
      simLoopDealByKey,
      mineApprovedAllocation,
      mineSynthAllocation,
      simLoopSynthAllocation,
      simLoopApprovedAllocation,
    ],
  );

  /** Returns a [min, max] domain that always includes 0 and the cost basis
   *  trajectory, padded by 10% on the visible value range so both portfolio
   *  value (solid) and cost basis (dashed) lines fit comfortably. */
  const computeYDomain = (
    rows: PortfolioCumulativeRow[],
  ): [number, number] => {
    const values: number[] = [];
    for (const r of rows) {
      values.push(
        r.mine,
        r.mineW,
        r.mineSynth,
        r.simEq,
        r.simW,
        r.simLoopSynth,
        r.breakevenMine,
        r.breakevenMineW,
        r.breakevenMineSynth,
        r.breakevenSimEq,
        r.breakevenSimW,
        r.breakevenSimLoopSynth,
        r.breakevenShared,
      );
    }
    const dataMin = Math.min(0, ...values);
    const dataMax = Math.max(0, ...values);
    const range = Math.max(1, dataMax - dataMin);
    const pad = Math.max(20, range * 0.1);
    return [dataMin - pad, dataMax + pad];
  };

  /**
   * Gain-only Y domain — used by the right ("24h gain") pane to avoid the
   * dashed invested-capital step line dominating the chart. It anchors at
   * €0 (the breakeven baseline) and only reads the cumulative P&L series
   * for each scenario, so even small 24h moves are clearly readable
   * against the €0 line instead of being squashed near the top of a
   * "0 → total invested capital" axis. Matches the Step 3 chart's Y
   * convention.
   */
  const computeGainOnlyYDomain = (
    rows: PortfolioCumulativeRow[],
  ): [number, number] => {
    const values: number[] = [0];
    for (const r of rows) {
      values.push(
        r.pnlMine,
        r.pnlMineW,
        r.pnlMineSynth,
        r.pnlSimEq,
        r.pnlSimW,
        r.pnlSimLoopSynth,
      );
    }
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    const range = Math.max(1, dataMax - dataMin);
    const pad = Math.max(20, range * 0.12);
    return [dataMin - pad, dataMax + pad];
  };

  const totalYDomain = useMemo(() => computeYDomain(totalCumulativeData), [totalCumulativeData]);
  const dailyGainYDomain = useMemo(
    () => computeGainOnlyYDomain(dailyCumulativeData),
    [dailyCumulativeData],
  );

  const synthGainImpact = useMemo(() => {
    const totalLast = totalCumulativeData[totalCumulativeData.length - 1];
    const dailyLast = dailyCumulativeData[dailyCumulativeData.length - 1];
    if (!totalLast || !dailyLast) {
      return null;
    }
    return {
      mine24h: computeSynthGainImpact(
        dailyLast.pnlMine,
        dailyLast.breakevenMine,
        dailyLast.pnlMineSynth,
        dailyLast.breakevenMineSynth,
      ),
      mine24hWeight: computeSynthGainImpact(
        dailyLast.pnlMine,
        dailyLast.breakevenMine,
        dailyLast.pnlMineW,
        dailyLast.breakevenMineW,
      ),
      sim24h: computeSynthGainImpact(
        dailyLast.pnlSimEq,
        dailyLast.breakevenSimEq,
        dailyLast.pnlSimLoopSynth,
        dailyLast.breakevenSimLoopSynth,
      ),
      sim24hWeight: computeSynthGainImpact(
        dailyLast.pnlSimEq,
        dailyLast.breakevenSimEq,
        dailyLast.pnlSimW,
        dailyLast.breakevenSimW,
      ),
      mineTotal: computeSynthGainImpact(
        totalLast.pnlMine,
        totalLast.breakevenMine,
        totalLast.pnlMineSynth,
        totalLast.breakevenMineSynth,
      ),
      simTotal: computeSynthGainImpact(
        totalLast.pnlSimEq,
        totalLast.breakevenSimEq,
        totalLast.pnlSimLoopSynth,
        totalLast.breakevenSimLoopSynth,
      ),
    };
  }, [totalCumulativeData, dailyCumulativeData]);

  const portfolioBalancingSuccess = useMemo((): {
    mine: PortfolioBalancingSuccessRow | null;
    sim: PortfolioBalancingSuccessRow | null;
  } | null => {
    if (!synthCurveAllocation || totalCapitalEur <= 0 || !synthGainImpact) return null;
    const mineDeals = comparison.mineDeals;
    const simDeals = comparison.simLoopDeals;
    if (mineDeals.length === 0 && simDeals.length === 0) return null;

    const weightedCaps = {
      mine: mineApprovedAllocation.capByTicker,
      sim: simLoopApprovedAllocation.capByTicker,
    };

    const mineSuccess =
      mineDeals.length > 0
        ? computePortfolioSizingSuccessComparison({
            deals: mineDeals,
            totalCapitalEur,
            equalCapByTicker: comparison.mine.capByTicker,
            weightedCapByTicker: weightedCaps.mine,
            synthCapByTicker: mineSynthAllocation.capByTicker,
            targetGainEur: synthTargetGainEur,
            winRateMode: "raw",
          })
        : null;
    const simSuccess =
      simDeals.length > 0
        ? computePortfolioSizingSuccessComparison({
            deals: simDeals,
            totalCapitalEur,
            equalCapByTicker: comparison.simLoopEqual.capByTicker,
            weightedCapByTicker: weightedCaps.sim,
            synthCapByTicker: simLoopSynthAllocation.capByTicker,
            targetGainEur: synthTargetGainEur,
            winRateMode: "raw",
          })
        : null;

    return {
      mine:
        mineSuccess != null
          ? {
              success: mineSuccess,
              realized: computeRealizedSuccessForDeals(closedRows, mineDeals),
              gainWeight24h: synthGainImpact.mine24hWeight,
              gainSynth24h: synthGainImpact.mine24h,
            }
          : null,
      sim:
        simSuccess != null
          ? {
              success: simSuccess,
              realized: computeRealizedSuccessForDeals(closedRows, simDeals),
              gainWeight24h: synthGainImpact.sim24hWeight,
              gainSynth24h: synthGainImpact.sim24h,
            }
          : null,
    };
  }, [
    synthCurveAllocation,
    synthGainImpact,
    totalCapitalEur,
    closedRows,
    comparison.mineDeals,
    comparison.mine.capByTicker,
    comparison.simLoopDeals,
    comparison.simLoopEqual.capByTicker,
    mineApprovedAllocation.capByTicker,
    simLoopApprovedAllocation.capByTicker,
    mineSynthAllocation.capByTicker,
    simLoopSynthAllocation.capByTicker,
    synthTargetGainEur,
  ]);

  /**
   * X-axis index for "today" on the cumulative chart.
   *
   * Counts how many deals in the walk order have an entry date on or before
   * today. The marker is then placed at that idx — i.e. between the last
   * past deal and the first future deal. Only meaningful in chronological
   * sort mode; in `abs` mode the X axis is no longer time, so we hide the
   * marker entirely.
   */
  const todayIdx = useMemo(() => {
    if (walkSortMode !== "chrono") return null;
    const today = new Date().toISOString().slice(0, 10);
    let count = 0;
    for (const d of walkOrder) {
      if (entryDateForDeal(d) <= today) count++;
      else break;
    }
    return count;
    // entryDateForDeal closes over investInputs — already in walkOrder deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkOrder, walkSortMode]);

  // ── Sizing evaluation: equal vs predictive (approved × EMS tilt) vs optimal ──
  const evalSimRowByKey = useMemo(
    () => buildSimRowByKeyMap((simTable?.rows ?? []) as Record<string, unknown>[]),
    [simTable],
  );

  /** EMS magnitude tilt per deal: mean |predicted move| across calendar nodes,
   *  scaled relative to the book median into a bounded [0.5, 2] multiplier.
   *  Neutral (1) when the row has no usable predicted-move columns. */
  const emsTiltByRowKey = useMemo(() => {
    const deals = comparison.simLoopDeals;
    const emsByKey = new Map<string, number>();
    for (const d of deals) {
      const row = evalSimRowByKey.get(d.rowKey);
      if (!row) continue;
      let sum = 0;
      let n = 0;
      for (const off of STANDARD_CAL_OFFSETS) {
        const p = simulationRowPredAtOffset(row, off);
        if (p != null && Number.isFinite(p)) {
          sum += Math.abs(p);
          n += 1;
        }
      }
      if (n > 0) emsByKey.set(d.rowKey, sum / n);
    }
    const vals = [...emsByKey.values()].sort((a, b) => a - b);
    const median = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    const tilt: Record<string, number> = {};
    for (const d of deals) {
      const ems = emsByKey.get(d.rowKey);
      tilt[d.rowKey] =
        ems == null || median <= 0 ? 1 : Math.max(0.5, Math.min(2, ems / median));
    }
    return tilt;
  }, [comparison.simLoopDeals, evalSimRowByKey]);

  /** Predictive sizing = approved Learning-Lab weights × EMS magnitude tilt.
   *  Causal: every input is known at entry (no realised outcome). */
  const simLoopPredictiveAllocation = useMemo<PortfolioAllocation>(() => {
    const deals = comparison.simLoopDeals;
    if (deals.length === 0 || totalCapitalEur <= 0 || !synthCurveAllocation) {
      return comparison.simLoopEqual;
    }
    const tilted: Record<string, number> = {};
    for (const d of deals) {
      const base =
        synthCurveAllocation.simLoopApprovedSharesByRowKey[d.rowKey] ?? 0;
      tilted[d.rowKey] = base * (emsTiltByRowKey[d.rowKey] ?? 1);
    }
    return harmonizeAllocationRealized(
      allocateFromShares(deals, totalCapitalEur, tilted),
      deals,
    );
  }, [
    comparison.simLoopDeals,
    comparison.simLoopEqual,
    totalCapitalEur,
    synthCurveAllocation,
    emsTiltByRowKey,
  ]);

  /** Cumulative realised P&L over the deal walk-order for the three sizings. */
  const sizingEvalCumulative = useMemo(() => {
    const simLoopRowKeys = new Set(
      comparison.simLoopDeals.map((d) => d.rowKey),
    );
    const rows: {
      idx: number;
      label: string;
      equal: number;
      predictive: number;
      optimal: number;
    }[] = [{ idx: 0, label: "", equal: 0, predictive: 0, optimal: 0 }];
    let eq = 0;
    let pr = 0;
    let op = 0;
    let i = 0;
    for (const d of walkOrder) {
      if (!simLoopRowKeys.has(d.rowKey)) continue;
      const pct =
        d.realizedReturnPct != null && Number.isFinite(d.realizedReturnPct)
          ? d.realizedReturnPct
          : 0;
      eq += ((comparison.simLoopEqual.capByTicker[d.ticker] ?? 0) * pct) / 100;
      pr +=
        ((simLoopPredictiveAllocation.capByTicker[d.ticker] ?? 0) * pct) / 100;
      op += ((simLoopSynthAllocation.capByTicker[d.ticker] ?? 0) * pct) / 100;
      i += 1;
      rows.push({
        idx: i,
        label: d.ticker,
        equal: Math.round(eq),
        predictive: Math.round(pr),
        optimal: Math.round(op),
      });
    }
    return rows;
  }, [
    walkOrder,
    comparison.simLoopDeals,
    comparison.simLoopEqual,
    simLoopPredictiveAllocation,
    simLoopSynthAllocation,
  ]);

  /** Last-24h monitoring table + effectiveness metrics (IC, hit-rate). */
  const sizingEvalView = useMemo(() => {
    const deals = comparison.simLoopDeals;
    const rows = deals
      .map((d) => {
        const eqCap = comparison.simLoopEqual.capByTicker[d.ticker] ?? 0;
        const prCap = simLoopPredictiveAllocation.capByTicker[d.ticker] ?? 0;
        const opCap = simLoopSynthAllocation.capByTicker[d.ticker] ?? 0;
        const move24h =
          d.realizedReturnPct24h != null &&
          Number.isFinite(d.realizedReturnPct24h)
            ? d.realizedReturnPct24h
            : null;
        const m = move24h ?? 0;
        return {
          ticker: d.ticker,
          rowKey: d.rowKey,
          move24h,
          eqEur24h: (eqCap * m) / 100,
          prEur24h: (prCap * m) / 100,
          opEur24h: (opCap * m) / 100,
          prWeightPct: totalCapitalEur > 0 ? prCap / totalCapitalEur : 0,
          eqWeightPct: totalCapitalEur > 0 ? eqCap / totalCapitalEur : 0,
          emsTilt: emsTiltByRowKey[d.rowKey] ?? 1,
          riskFlag: matchesStep2Pattern(d),
        };
      })
      .sort((a, b) => Math.abs(b.prEur24h) - Math.abs(a.prEur24h));

    const tot24h = rows.reduce(
      (acc, r) => ({
        eq: acc.eq + r.eqEur24h,
        pr: acc.pr + r.prEur24h,
        op: acc.op + r.opEur24h,
      }),
      { eq: 0, pr: 0, op: 0 },
    );

    const xs: number[] = [];
    const ys: number[] = [];
    let capWin = 0;
    let capTot = 0;
    for (const d of deals) {
      const w = simLoopPredictiveAllocation.capByTicker[d.ticker] ?? 0;
      capTot += w;
      if (d.realizedReturnPct != null && d.realizedReturnPct > 0) capWin += w;
      if (d.realizedReturnPct != null && Number.isFinite(d.realizedReturnPct)) {
        xs.push(w);
        ys.push(d.realizedReturnPct);
      }
    }
    const ic = pearson(xs, ys);
    const hitRate = capTot > 0 ? capWin / capTot : null;

    const last =
      sizingEvalCumulative[sizingEvalCumulative.length - 1] ?? {
        equal: 0,
        predictive: 0,
        optimal: 0,
      };
    return {
      rows,
      tot24h,
      ic,
      hitRate,
      finalEqual: last.equal,
      finalPredictive: last.predictive,
      finalOptimal: last.optimal,
    };
  }, [
    comparison.simLoopDeals,
    comparison.simLoopEqual,
    simLoopPredictiveAllocation,
    simLoopSynthAllocation,
    totalCapitalEur,
    emsTiltByRowKey,
    matchesStep2Pattern,
    sizingEvalCumulative,
  ]);

  if (comparison.allDeals.length === 0) {
    return (
      <details
        open={panelOpen}
        onToggle={onPanelToggle}
        className="rounded-2xl border border-indigo-200/50 dark:border-indigo-800/40 bg-white/60 dark:bg-surface/60 shrink-0"
      >
        <summary className="cursor-pointer select-none list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="text-[12px] font-semibold text-indigo-900 dark:text-indigo-100">
            {it ? "▸ Confronto tre portafogli — Mine · Sim loop" : "▸ Three-portfolio comparison — Mine · Sim loop"}
          </span>
        </summary>
        <div className="px-4 pb-3 border-t border-indigo-200/30 dark:border-indigo-800/30">
          <p className="text-xs text-ink-muted pt-2">
            {it
              ? "Nessuna opportunità (né nel mio portafoglio né nel sim loop). Apri qualche posizione o lancia un refresh delle previsioni."
              : "No opportunities (neither in my portfolio nor in the sim loop). Open a position or run a forecast refresh."}
          </p>
        </div>
      </details>
    );
  }

  const collapsedHint = `${fmtEur(harmonizedScenarioTotals.portfolio.gainEur)} · ${fmtEur(harmonizedScenarioTotals.simLoopEqual.gainEur)} · ${fmtEur(harmonizedScenarioTotals.simLoopSynth.gainEur)}`;

  return (
    <details
      open={panelOpen}
      onToggle={onPanelToggle}
      className="rounded-2xl border border-indigo-200/50 dark:border-indigo-800/40 bg-white/60 dark:bg-surface/60 shrink-0 group"
    >
      <summary className="cursor-pointer select-none list-none px-4 py-3 space-y-0.5 [&::-webkit-details-marker]:hidden hover:bg-indigo-50/30 dark:hover:bg-indigo-950/15 transition-colors">
        <p className="text-[10px] uppercase font-semibold text-indigo-700 dark:text-indigo-300 tracking-wider">
          {it ? "Confronto a parità di capitale" : "Apples-to-apples capital comparison"}
        </p>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-100">
            {it
              ? `Tre portafogli ipotetici — P&L realizzato (${fmtEurNoSign(totalCapitalEur)})`
              : `Three hypothetical portfolios — realized P&L (${fmtEurNoSign(totalCapitalEur)})`}
          </h3>
          {!panelOpen ? (
            <span className="text-[11px] tabular-nums text-ink-muted">
              {it ? "Mine / Sim equi:" : "Mine / Sim equal:"} {collapsedHint}
            </span>
          ) : null}
        </div>
        <p className="text-[10px] text-ink-muted group-open:hidden">
          {it ? "Clicca per espandere grafici e tabella per deal" : "Click to expand charts and per-deal table"}
        </p>
      </summary>

      <div className="px-4 pb-4 pt-1 space-y-3 border-t border-indigo-200/30 dark:border-indigo-800/30">
      <p className="text-[11px] text-ink-muted leading-relaxed max-w-3xl">
        {it
          ? "P&L mark-to-market per scenario. Mine / Sim loop (synth) = mix ottimizzata sul target 24h. Mine · pesati / Sim · pesati = pesi approvati Learning Lab (senza target). Mine equi e Sim equi = pari €."
          : "Mark-to-market P&L per scenario. Mine / Sim loop (synth) = mix optimized to 24h target. Mine · weighted / Sim · weighted = Learning Lab approved weights (no target). Mine equal and Sim equal = equal €."}
        {synthCurveAllocation?.approvedWeightsAt ? (
          <span className="block mt-1 text-[10px] text-indigo-800/90 dark:text-indigo-200/90">
            {it ? "Pesi approvati aggiornati" : "Approved weights updated"}:{" "}
            {new Date(synthCurveAllocation.approvedWeightsAt).toLocaleString(it ? "it-IT" : "en-US")}
            {" · "}
            {it ? "Target 24h" : "24h target"}: {fmtEurNoSign(synthTargetGainEur)}
          </span>
        ) : null}
      </p>

      <ThreeGroupExplainer summary={groupSummary} it={it} fmtEur={fmtEurNoSign} />

      <WeightedSizingGateBanner gate={weightedGate} lang={lang} compact />

      {/* Dual chart — both panes plot the SAME three scenarios as cumulative
          curves over the deal walk-order. Curves start at €0 and grow (or
          shrink) one deal at a time as each contributor's P&L is added.
          Left pane = all-time MTM, right pane = last-24h delta. */}
      <PortfolioCumulativeDualChart
        totalRows={totalCumulativeData}
        dailyRows={dailyCumulativeData}
        totalYDomain={totalYDomain}
        dailyGainYDomain={dailyGainYDomain}
        scenarios={scenarioMeta.map(({ allocation: _ignore, ...rest }) => rest)}
        visibleScenarios={visibleScenarios}
        onToggleScenario={(key) => {
          setVisibleScenarios((prev) => ({ ...prev, [key]: !prev[key] }));
        }}
        walkSortMode={walkSortMode}
        onSetWalkSortMode={setWalkSortMode}
        todayIdx={todayIdx}
        it={it}
        fmtEur={fmtEur}
      />

      {synthGainImpact ? (
        <SynthGainImpactPanel
          mine24h={synthGainImpact.mine24h}
          sim24h={synthGainImpact.sim24h}
          mineTotal={synthGainImpact.mineTotal}
          simTotal={synthGainImpact.simTotal}
          mineSuccess={portfolioBalancingSuccess?.mine ?? null}
          simSuccess={portfolioBalancingSuccess?.sim ?? null}
          synthAvailable={Boolean(synthCurveAllocation)}
          it={it}
        />
      ) : null}

      {/* Per-ticker table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] table-fixed">
          <colgroup>
            <col style={{ width: "13%" }} />
            {/* SDS score */}
            <col style={{ width: "5%" }} />
            {/* Risk & Benefit scale */}
            <col style={{ width: "10%" }} />
            {/* Mine */}
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            {/* Sim equal */}
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            {/* Sim weighted */}
            <col style={{ width: "8%" }} />
            <col style={{ width: "9%" }} />
            {/* Sim weighted · Score (sizing rationale: EV × confMult × patPenalty) */}
            <col style={{ width: "8%" }} />
            {/* Win rate column */}
            <col style={{ width: "13%" }} />
          </colgroup>
          <thead>
            <tr className="text-ink-muted">
              <th className="text-left font-semibold pb-1 pr-2" rowSpan={2}>
                {it ? "Deal · fase" : "Deal · phase"}
              </th>
              <th
                className="text-center font-semibold pb-1 px-1"
                rowSpan={2}
                title={it ? "Score SDS (Supernova Distance Score) — numerico, dal feed sds_index." : "SDS score (Supernova Distance Score) — numeric, from the sds_index feed."}
              >
                SDS
              </th>
              <th
                className="text-center font-semibold pb-1 px-1"
                rowSpan={2}
                title={
                  it
                    ? "Bilancia rischio vs beneficio. Teschio (sx): rischio investimento 0-100 (Phase A lifts confidence-weighted + Phase B pattern). Cuore (dx): movimento 24h del prezzo (% per giorno) — proxy del beneficio in tempo reale. Click per il dettaglio per-bucket."
                    : "Risk vs benefit balance. Skull (left): investment-risk 0-100 (Phase A confidence-weighted lifts + Phase B pattern). Heart (right): last-24h price move %/day as a real-time benefit proxy. Click for the per-bucket breakdown."
                }
              >
                Risk &amp; Benefit
              </th>
              <th
                className="text-center font-semibold pb-0 pt-1 px-1"
                colSpan={2}
                style={{ color: "#2563eb" }}
              >
                {it ? "Mio (€ equi)" : "Mine (equal €)"}
              </th>
              <th
                className="text-center font-semibold pb-0 pt-1 px-1"
                colSpan={2}
                style={{ color: "#9333ea" }}
              >
                {it ? "Sim loop · equi" : "Sim loop · equal"}
              </th>
              <th
                className="text-center font-semibold pb-0 pt-1 px-1"
                colSpan={3}
                style={{ color: "#db2777" }}
                title={
                  it
                    ? "Mix Weight Sim Exp sul pot sim loop (max 25%/deal) — stessa logica pulse Synth"
                    : "Weight Sim Exp mix on sim loop pot (max 25%/deal) — same as Synth pulse"
                }
              >
                {it ? "Sim loop · synth" : "Sim loop · synth"}
              </th>
              <th
                className="text-center font-semibold pb-1 px-1"
                rowSpan={2}
                title={it ? "Win rate calibrato dalla cella best-N (priorità phase>SDS>P(plan)>indication)" : "Calibrated win rate from best-N cell (priority phase>SDS>P(plan)>indication)"}
              >
                {it ? "Win rate · conf" : "Win rate · conf"}
              </th>
            </tr>
            <tr className="text-ink-muted border-b border-[rgb(var(--border))]/60">
              <th
                className="text-right font-semibold pb-1 px-1"
                title={it ? "Capitale ipotetico assegnato a questo deal nello scenario" : "Hypothetical capital assigned to this deal in the scenario"}
              >
                {it ? "Cap" : "Cap"}
              </th>
              <th
                className="text-right font-semibold pb-1 px-1"
                title={it ? "P&L realizzato (mark-to-market) = cap × rendimento corrente del deal" : "Realized P&L (mark-to-market) = cap × deal's current return"}
              >
                P&L
              </th>
              <th
                className="text-right font-semibold pb-1 px-1"
                title={it ? "Capitale ipotetico assegnato a questo deal nello scenario" : "Hypothetical capital assigned to this deal in the scenario"}
              >
                {it ? "Cap" : "Cap"}
              </th>
              <th
                className="text-right font-semibold pb-1 px-1"
                title={it ? "P&L realizzato (mark-to-market) = cap × rendimento corrente del deal" : "Realized P&L (mark-to-market) = cap × deal's current return"}
              >
                P&L
              </th>
              <th
                className="text-right font-semibold pb-1 px-1"
                title={it ? "Capitale ipotetico assegnato a questo deal nello scenario" : "Hypothetical capital assigned to this deal in the scenario"}
              >
                {it ? "Cap" : "Cap"}
              </th>
              <th
                className="text-right font-semibold pb-1 px-1"
                title={it ? "P&L realizzato (mark-to-market) = cap × rendimento corrente del deal" : "Realized P&L (mark-to-market) = cap × deal's current return"}
              >
                P&L
              </th>
              <th
                className="text-right font-semibold pb-1 px-1"
                title={
                  it
                    ? "Quota capitale nel mix Weight Sim Exp (max 25%/deal)"
                    : "Capital share in Weight Sim Exp mix (max 25%/deal)"
                }
              >
                {it ? "Quota" : "Share"}
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(({ deal, mineCap, simEqCap, simSynthCap, mineRealized, simEqRealized, simSynthRealized, simSynthSharePct }) => (
              <TableRow
                key={deal.rowKey}
                deal={deal}
                mineCap={mineCap}
                simEqCap={simEqCap}
                simSynthCap={simSynthCap}
                mineRealized={mineRealized}
                simEqRealized={simEqRealized}
                simSynthRealized={simSynthRealized}
                simSynthSharePct={simSynthSharePct}
                onOpenRisk={() => setRiskModalDeal(deal)}
                it={it}
              />
            ))}
            {/* Totals row */}
            <TotalsRow
              it={it}
              mine={comparison.mine}
              simEq={comparison.simLoopEqual}
              simSynth={simLoopSynthAllocation}
            />
          </tbody>
        </table>
      </div>

      {/* ── Sizing evaluation: equal vs predictive vs optimal ──────────────── */}
      {comparison.simLoopDeals.length > 0 ? (
        <div className="rounded-xl border border-sky-200/50 dark:border-sky-800/40 bg-sky-50/30 dark:bg-sky-950/10 p-3 space-y-2">
          <div className="space-y-0.5">
            <p className="text-[10px] uppercase font-semibold text-sky-700 dark:text-sky-300 tracking-wider">
              {it ? "Valutazione sizing predittivo" : "Predictive sizing evaluation"}
            </p>
            <h4 className="text-xs font-semibold text-ink">
              {it
                ? "Equal vs Predittivo (pesi approvati × EMS) vs Ottimale (senno di poi)"
                : "Equal vs Predictive (approved × EMS) vs Optimal (hindsight)"}
            </h4>
            <p className="text-[10px] text-ink-muted leading-snug max-w-3xl">
              {it
                ? "P&L cumulato sulle stesse posizioni del sim loop. Il predittivo usa solo segnali noti all'ingresso (win-rate calibrato × prob. piano − penalità pattern-rischio, scalati per la magnitudine attesa EMS). L'ottimale ripesa col senno di poi: è solo il tetto di riferimento, non replicabile."
                : "Cumulative P&L on the same sim-loop positions. Predictive uses only entry-time signals (calibrated win-rate × plan prob − risk-pattern penalty, scaled by EMS expected magnitude). Optimal reweights in hindsight: a reference ceiling, not reproducible."}
            </p>
          </div>

          <div className="flex flex-col lg:flex-row gap-3">
            <div className="lg:w-1/2">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={sizingEvalCumulative}
                    margin={{ top: 6, right: 10, bottom: 4, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(148,163,184,0.25)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 9 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 9 }}
                      width={44}
                      tickFormatter={(v) => `${Math.round(Number(v))}`}
                    />
                    <ReferenceLine y={0} stroke="rgba(148,163,184,0.5)" />
                    <Tooltip
                      contentStyle={{ fontSize: 11 }}
                      formatter={(value, name) => [fmtEur(Number(value)), String(name)]}
                    />
                    <Line
                      type="monotone"
                      dataKey="equal"
                      name={it ? "Equal" : "Equal"}
                      stroke="#9333ea"
                      strokeWidth={1.6}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="predictive"
                      name={it ? "Predittivo" : "Predictive"}
                      stroke="#0284c7"
                      strokeWidth={2.2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="optimal"
                      name={it ? "Ottimale" : "Optimal"}
                      stroke="#db2777"
                      strokeWidth={1.4}
                      strokeDasharray="4 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-3 text-[10px] mt-1">
                <LegendDot
                  color="#9333ea"
                  label={`Equal ${fmtEur(sizingEvalView.finalEqual)}`}
                />
                <LegendDot
                  color="#0284c7"
                  label={`${it ? "Predittivo" : "Predictive"} ${fmtEur(sizingEvalView.finalPredictive)}`}
                />
                <LegendDot
                  color="#db2777"
                  label={`${it ? "Ottimale" : "Optimal"} ${fmtEur(sizingEvalView.finalOptimal)}`}
                />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2 text-[10px]">
                <Metric
                  label={it ? "Δ Predittivo − Equal" : "Δ Predictive − Equal"}
                  value={fmtEur(
                    sizingEvalView.finalPredictive - sizingEvalView.finalEqual,
                  )}
                  tone={sizingEvalView.finalPredictive - sizingEvalView.finalEqual}
                />
                <Metric
                  label={it ? "IC (peso vs reso)" : "IC (weight vs return)"}
                  value={
                    sizingEvalView.ic == null
                      ? "—"
                      : sizingEvalView.ic.toFixed(2)
                  }
                  tone={sizingEvalView.ic ?? 0}
                />
                <Metric
                  label={it ? "Capitale su vincenti" : "Capital on winners"}
                  value={
                    sizingEvalView.hitRate == null
                      ? "—"
                      : `${(sizingEvalView.hitRate * 100).toFixed(0)}%`
                  }
                  tone={(sizingEvalView.hitRate ?? 0.5) - 0.5}
                />
              </div>
            </div>

            <div className="lg:w-1/2 overflow-x-auto">
              <p className="text-[10px] font-semibold text-ink mb-1">
                {it
                  ? "Movimenti ultime 24h — Equal vs Predittivo"
                  : "Last-24h moves — Equal vs Predictive"}
              </p>
              <table className="w-full text-[10px] tabular-nums">
                <thead>
                  <tr className="text-ink-muted border-b border-[rgb(var(--border))]/60">
                    <th className="text-left font-semibold pb-1 pr-2">
                      {it ? "Titolo" : "Ticker"}
                    </th>
                    <th
                      className="text-right font-semibold pb-1 px-1"
                      title={it ? "Variazione di mercato nelle ultime 24h" : "Market move over the last 24h"}
                    >
                      24h %
                    </th>
                    <th className="text-right font-semibold pb-1 px-1">Eq €24h</th>
                    <th
                      className="text-right font-semibold pb-1 px-1"
                      title={it ? "P&L 24h con il sizing predittivo" : "24h P&L under predictive sizing"}
                    >
                      Pred €24h
                    </th>
                    <th
                      className="text-right font-semibold pb-1 px-1"
                      title={it ? "Tilt magnitudine EMS applicato al peso" : "EMS magnitude tilt applied to the weight"}
                    >
                      EMS×
                    </th>
                    <th
                      className="text-center font-semibold pb-1 px-1"
                      title={it ? "Match pattern di rischio (Step 2)" : "Risk-pattern match (Step 2)"}
                    >
                      {it ? "Rischio" : "Risk"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sizingEvalView.rows.map((r) => (
                    <tr
                      key={r.rowKey}
                      className="border-b border-[rgb(var(--border))]/20"
                    >
                      <td className="py-0.5 pr-2 text-ink">{r.ticker}</td>
                      <td
                        className={`py-0.5 px-1 text-right ${
                          r.move24h == null
                            ? "text-ink-muted"
                            : r.move24h > 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : r.move24h < 0
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-ink-muted"
                        }`}
                      >
                        {r.move24h == null
                          ? "—"
                          : `${r.move24h > 0 ? "+" : ""}${r.move24h.toFixed(1)}%`}
                      </td>
                      <td className={`py-0.5 px-1 text-right ${evTone(r.eqEur24h)}`}>
                        {fmtEur(r.eqEur24h)}
                      </td>
                      <td className={`py-0.5 px-1 text-right ${evTone(r.prEur24h)}`}>
                        {fmtEur(r.prEur24h)}
                      </td>
                      <td className="py-0.5 px-1 text-right text-ink-muted">
                        {r.emsTilt.toFixed(2)}
                      </td>
                      <td className="py-0.5 px-1 text-center">
                        {r.riskFlag ? (
                          <span className="text-rose-600 dark:text-rose-400">●</span>
                        ) : (
                          <span className="text-ink-muted/40">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-[rgb(var(--border))]/60 font-semibold">
                    <td className="py-1 pr-2 text-ink">
                      {it ? "Totale 24h" : "24h total"}
                    </td>
                    <td className="py-1 px-1" />
                    <td className={`py-1 px-1 text-right ${evTone(sizingEvalView.tot24h.eq)}`}>
                      {fmtEur(sizingEvalView.tot24h.eq)}
                    </td>
                    <td className={`py-1 px-1 text-right ${evTone(sizingEvalView.tot24h.pr)}`}>
                      {fmtEur(sizingEvalView.tot24h.pr)}
                    </td>
                    <td className="py-1 px-1" />
                    <td className="py-1 px-1" />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {/* Loss-risk breakdown modal — opened by clicking the poop icon on a row */}
      <LossRiskBreakdownModal
        entry={riskModalDeal ? dealToLossRiskEntry(riskModalDeal) : null}
        onClose={() => setRiskModalDeal(null)}
        it={it}
      />
      </div>
    </details>
  );
}

function TableRow({
  deal,
  mineCap,
  simEqCap,
  simSynthCap,
  mineRealized,
  simEqRealized,
  simSynthRealized,
  simSynthSharePct,
  onOpenRisk,
  it,
}: {
  deal: ComparisonDeal;
  mineCap: number;
  simEqCap: number;
  simSynthCap: number;
  mineRealized: number;
  simEqRealized: number;
  simSynthRealized: number;
  simSynthSharePct: number | null;
  onOpenRisk: () => void;
  it: boolean;
}) {
  const notEntered = deal.realizedReturnPct == null;
  const realizedCellClass = (cap: number, realized: number) => {
    if (cap <= 0) return "text-ink-muted";
    if (notEntered) return "text-ink-muted/70 italic";
    return evTone(realized);
  };
  const realizedCellContent = (cap: number, realized: number) => {
    if (cap <= 0) return "—";
    if (notEntered) return "n/a";
    return fmtEur(realized);
  };
  const realizedCellTitle = notEntered
    ? "Deal not held in any portfolio (real or paper sim) — no mark-to-market P&L yet."
    : undefined;
  return (
    <tr className="border-b border-[rgb(var(--border))]/30 align-middle">
      <td className="py-1.5 pr-2 truncate" title={`${deal.ticker} · ${deal.cells.clinicalPhase} · ${deal.cells.sdsBucket}`}>
        <span className="font-medium text-ink">{deal.ticker}</span>{" "}
        <span className="text-ink-muted text-[10px]">· {deal.cells.clinicalPhase}</span>
      </td>
      {/* SDS score (numeric). Bucket label shown as sub-label. */}
      <td
        className="py-1.5 px-1 text-center tabular-nums"
        title={deal.cells.sdsBucket}
      >
        <div className={`text-[11px] font-semibold ${sdsTone(deal.sdsValue)}`}>
          {deal.sdsValue != null && Number.isFinite(deal.sdsValue)
            ? deal.sdsValue.toFixed(0)
            : "—"}
        </div>
        <div className="text-[8px] text-ink-muted leading-tight">
          {shortSdsBucket(deal.cells.sdsBucket)}
        </div>
      </td>
      {/* Risk & Benefit (skull + heart balance). Skull = combined investment-
          risk score (0-100). Heart = last-24h price move % as a proxy for
          "price growth per unit time" (this view doesn't carry a forward
          gain-plan horizon, so we use the realised 24h move that's already on
          the ComparisonDeal). Click opens the per-bucket breakdown modal. */}
      <td className="py-1.5 px-1 text-center">
        {(() => {
          const entry = dealToLossRiskEntry(deal);
          const benefitFillPct = deriveBenefitFillPct({
            expectedReturnPct: null,
            daysToTarget: null,
            dailyChangePct: deal.realizedReturnPct24h,
          });
          return (
            <RiskBenefitScaleCell
              entry={entry}
              benefitFillPct={benefitFillPct}
              perDayPct={deal.realizedReturnPct24h ?? null}
              onClick={onOpenRisk}
              it={it}
            />
          );
        })()}
      </td>
      <td className="py-1.5 px-1 text-right tabular-nums text-ink">
        {mineCap > 0 ? fmtEurNoSign(mineCap) : "—"}
      </td>
      <td
        className={`py-1.5 px-1 text-right tabular-nums ${realizedCellClass(mineCap, mineRealized)}`}
        title={realizedCellTitle}
      >
        {realizedCellContent(mineCap, mineRealized)}
      </td>
      <td className="py-1.5 px-1 text-right tabular-nums text-ink">
        {simEqCap > 0 ? fmtEurNoSign(simEqCap) : "—"}
      </td>
      <td
        className={`py-1.5 px-1 text-right tabular-nums ${realizedCellClass(simEqCap, simEqRealized)}`}
        title={realizedCellTitle}
      >
        {realizedCellContent(simEqCap, simEqRealized)}
      </td>
      <td className="py-1.5 px-1 text-right tabular-nums text-ink">
        {simSynthCap > 0 ? fmtEurNoSign(simSynthCap) : "—"}
      </td>
      <td
        className={`py-1.5 px-1 text-right tabular-nums ${realizedCellClass(simSynthCap, simSynthRealized)}`}
        title={realizedCellTitle}
      >
        {realizedCellContent(simSynthCap, simSynthRealized)}
      </td>
      <td className="py-1.5 px-1 text-right tabular-nums">
        <ApprovedShareCell sharePct={simSynthSharePct} it={it} />
      </td>
      <td className="py-1.5 px-1 text-center">
        <div
          className="inline-flex items-center gap-1"
          title={
            deal.winRateDimension
              ? `From ${deal.winRateDimension} = "${deal.cells[deal.winRateDimension]}" (n=${deal.winRateN})`
              : "Neutral default (no calibration data for any deal feature)"
          }
        >
          <span className="tabular-nums text-ink font-medium">{fmtPct01(deal.winRate, 0)}</span>
          <span className={`text-[8px] px-1 rounded ${confTone(deal.confidence)}`}>
            {deal.confidence.toUpperCase()}
          </span>
        </div>
        {deal.winRateDimension ? (
          <div className="text-[8.5px] text-ink-muted leading-tight mt-0.5">
            {dimensionShort(deal.winRateDimension)}={shortCell(deal.cells[deal.winRateDimension])} · n={deal.winRateN}
          </div>
        ) : null}
      </td>
    </tr>
  );
}

/** Short label for the calibration dimension shown in dense tooltips. */
function dimensionShort(
  d: "clinicalPhase" | "clinicalIndication" | "sdsBucket" | "pplanBucket",
): string {
  switch (d) {
    case "clinicalPhase":
      return "phase";
    case "clinicalIndication":
      return "ind";
    case "sdsBucket":
      return "sds";
    case "pplanBucket":
      return "P(plan)";
  }
}

/** Color the SDS score: green ≥55 (high), amber 40-55 (mid), rose <40 (low). */
function sdsTone(sds: number | null): string {
  if (sds == null || !Number.isFinite(sds)) return "text-ink-muted";
  if (sds >= 55) return "text-emerald-700 dark:text-emerald-300";
  if (sds >= 40) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}

/** Trim verbose SDS bucket labels for the dense sub-label under the score. */
function shortSdsBucket(bucket: string | undefined): string {
  if (!bucket) return "—";
  return bucket
    .replace("SDS ", "")
    .replace(" (Low)", " L")
    .replace(" (Mid)", " M")
    .replace(" (High)", " H");
}

function shortCell(cell: string | undefined): string {
  if (!cell) return "—";
  return cell
    .replace("SDS ", "")
    .replace(" (Low)", "L")
    .replace(" (Mid)", "M")
    .replace(" (High)", "H")
    .replace("P(plan) ", "")
    .replace("Phase ", "P");
}

/**
 * Capital share in the Learning Lab approved-weight mix for one sim-loop deal.
 */
function ApprovedShareCell({
  sharePct,
  it,
}: {
  sharePct: number | null;
  it: boolean;
}) {
  if (sharePct == null || !Number.isFinite(sharePct) || sharePct <= 0) {
    return <span className="text-ink-muted">—</span>;
  }
  return (
    <span
      className="tabular-nums text-emerald-700 dark:text-emerald-300 font-medium"
      title={
        it
          ? `Quota nel mix Learning Lab: ${sharePct.toFixed(1)}% del pot sim loop`
          : `Learning Lab mix share: ${sharePct.toFixed(1)}% of the sim loop pot`
      }
    >
      {sharePct.toFixed(1)}%
    </span>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink-muted">
      <span
        className="inline-block h-2 w-2 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: number;
}) {
  const toneCls =
    tone > 0
      ? "text-emerald-700 dark:text-emerald-300"
      : tone < 0
        ? "text-rose-700 dark:text-rose-300"
        : "text-ink";
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/40 px-2 py-1">
      <div className="text-ink-muted leading-tight">{label}</div>
      <div className={`font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

function TotalsRow({
  it,
  mine,
  simEq,
  simSynth,
}: {
  it: boolean;
  mine: PortfolioAllocation;
  simEq: PortfolioAllocation;
  simSynth: PortfolioAllocation;
}) {
  const heldSummary = (alloc: PortfolioAllocation) => {
    if (alloc.positionsCount === 0) return "0";
    if (alloc.realizedPositionsCount === alloc.positionsCount) {
      return `${alloc.positionsCount}`;
    }
    return `${alloc.realizedPositionsCount}/${alloc.positionsCount}`;
  };
  return (
    <tr className="border-t-2 border-[rgb(var(--border))]/60 bg-surface/30 font-semibold">
      <td className="py-2 pr-2 text-ink">
        {it ? "Totali" : "Totals"}
        <span
          className="text-[10px] text-ink-muted font-normal ml-2"
          title={
            it
              ? "Deal investiti / totale assegnato in ogni scenario (gain = cap × rendimento MTM)"
              : "Deals invested / total assigned per scenario (gain = cap × MTM return)"
          }
        >
          · {heldSummary(mine)} / {heldSummary(simEq)} / {heldSummary(simSynth)}{" "}
          {it ? "investiti" : "invested"}
        </span>
      </td>
      {/* SDS + Risk total cells (empty — totals don't aggregate scores). */}
      <td className="py-2 px-1 text-center text-[10px] text-ink-muted">—</td>
      <td className="py-2 px-1 text-center text-[10px] text-ink-muted">—</td>
      <td className="py-2 px-1 text-right tabular-nums text-ink">
        {fmtEurNoSign(mine.totalCapitalEur)}
      </td>
      <td className={`py-2 px-1 text-right tabular-nums ${evTone(mine.totalRealizedEur)}`}>
        {fmtEur(mine.totalRealizedEur)}
      </td>
      <td className="py-2 px-1 text-right tabular-nums text-ink">
        {fmtEurNoSign(simEq.totalCapitalEur)}
      </td>
      <td className={`py-2 px-1 text-right tabular-nums ${evTone(simEq.totalRealizedEur)}`}>
        {fmtEur(simEq.totalRealizedEur)}
      </td>
      <td className="py-2 px-1 text-right tabular-nums text-ink">
        {fmtEurNoSign(simSynth.totalCapitalEur)}
      </td>
      <td className={`py-2 px-1 text-right tabular-nums ${evTone(simSynth.totalRealizedEur)}`}>
        {fmtEur(simSynth.totalRealizedEur)}
      </td>
      <td className="py-2 px-1 text-right tabular-nums text-ink-muted">100%</td>
      <td className="py-2 px-1 text-center text-[10px] text-ink-muted">—</td>
    </tr>
  );
}
