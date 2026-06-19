/**
 * Side-by-side comparison: "Mio portafoglio" vs "Sim loop portfolio".
 *
 * Renders above the classic Probability-vs-N chart in the Diversification Lab.
 * Two parts:
 *   1. KPI cards + totals row vs break-even target
 *   2. Per-dimension breakdown table (clinical phase / SDS / P(plan))
 */
import { useMemo } from "react";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimInputs } from "../sheet/investSimStorage";
import {
  buildPortfolioComparison,
  type DimensionBreakdownRow,
  type PortfolioComparisonResult,
} from "../sheet/portfolioBreakevenComparison";
import { type TradeOutcomeStats } from "../sheet/portfolioDiversificationLab";
import type { CalibrationDimension, ConfidenceLevel } from "../calibration/calibrationTypes";
import { useLang } from "../shared/i18n";

function fmtEur(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${Math.round(v).toLocaleString("it-IT")} €`;
}

function fmtEurNoSign(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v).toLocaleString("it-IT")} €`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

const DIM_LABEL_IT: Record<CalibrationDimension, string> = {
  clinicalPhase: "Fase clinica",
  clinicalIndication: "Indicazione",
  sdsBucket: "SDS bucket",
  pplanBucket: "P(plan) bucket",
};
const DIM_LABEL_EN: Record<CalibrationDimension, string> = {
  clinicalPhase: "Clinical phase",
  clinicalIndication: "Indication",
  sdsBucket: "SDS bucket",
  pplanBucket: "P(plan) bucket",
};

function ConfBadge({ level }: { level: ConfidenceLevel | null }) {
  if (!level) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-500 border border-slate-300">
        N/A
      </span>
    );
  }
  const conf = {
    low: { bg: "#dc26261a", border: "#dc262655", color: "#b91c1c", label: "LOW" },
    medium: { bg: "#f59e0b1a", border: "#f59e0b55", color: "#b45309", label: "MED" },
    high: { bg: "#0596691a", border: "#05966955", color: "#047857", label: "HIGH" },
  }[level];
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold"
      style={{
        backgroundColor: conf.bg,
        border: `1px solid ${conf.border}`,
        color: conf.color,
      }}
    >
      {conf.label}
    </span>
  );
}

function TotalCard({
  title,
  positions,
  capital,
  expectedPnl,
  winRate,
  breakEvenCap,
  unreachableReason,
  it,
  tone,
}: {
  title: string;
  positions: number;
  capital: number;
  expectedPnl: number;
  winRate: number;
  breakEvenCap: number | null;
  unreachableReason: string | null;
  it: boolean;
  tone: "mine" | "sim";
}) {
  const accent = tone === "mine" ? "#2563eb" : "#9333ea";
  const delta = breakEvenCap != null ? capital - breakEvenCap : null;
  const deltaTone =
    delta == null ? "neutral" : delta >= 0 ? "good" : "bad";
  return (
    <div
      className="rounded-xl border p-3 flex flex-col gap-1.5"
      style={{
        borderColor: `${accent}55`,
        background: `linear-gradient(168deg, #ffffff 0%, ${accent}08 100%)`,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: accent }}>
          {title}
        </span>
        <span className="text-[10px] text-ink-muted">
          {positions} {it ? "posizioni" : "positions"}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold tabular-nums text-ink">
          {fmtEurNoSign(capital)}
        </span>
        <span className="text-[10px] text-ink-muted">
          · win {fmtPct(winRate, 0)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-ink-muted">{it ? "E[P&L]:" : "E[P&L]:"}</span>
        <span
          className={`font-bold tabular-nums ${
            expectedPnl > 0
              ? "text-emerald-700"
              : expectedPnl < 0
                ? "text-rose-700"
                : "text-ink"
          }`}
        >
          {fmtEur(expectedPnl)}
        </span>
      </div>
      {breakEvenCap != null ? (
        <div className="flex items-center gap-1 text-[10px] mt-0.5">
          <span className="text-ink-muted">{it ? "Δ vs break-even" : "Δ vs break-even"}:</span>
          <span
            className={`font-bold tabular-nums ${
              deltaTone === "good"
                ? "text-emerald-700"
                : deltaTone === "bad"
                  ? "text-rose-700"
                  : "text-ink"
            }`}
          >
            {fmtEur(delta)}
          </span>
          <span className="text-ink-muted">
            ({it ? "target" : "target"} {fmtEurNoSign(breakEvenCap)})
          </span>
        </div>
      ) : (
        <div className="text-[10px] text-amber-700 italic mt-0.5">
          {it ? "BE non raggiungibile" : "BE unreachable"}
          {unreachableReason ? ` · ${unreachableReason}` : ""}
        </div>
      )}
    </div>
  );
}

function BreakdownTable({
  rows,
  it,
}: {
  rows: DimensionBreakdownRow[];
  it: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[11px] text-ink-muted italic py-4 text-center">
        {it
          ? "Nessuna posizione in nessuno dei due portafogli."
          : "No positions in either portfolio."}
      </p>
    );
  }
  // Group by dimension for visual section headers
  const byDim = new Map<CalibrationDimension, DimensionBreakdownRow[]>();
  for (const r of rows) {
    let arr = byDim.get(r.dimension);
    if (!arr) {
      arr = [];
      byDim.set(r.dimension, arr);
    }
    arr.push(r);
  }
  const dimLabel = it ? DIM_LABEL_IT : DIM_LABEL_EN;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] table-fixed">
        <colgroup>
          <col style={{ width: "26%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          {/* Mine group */}
          <col style={{ width: "8%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
          {/* Sim loop group */}
          <col style={{ width: "8%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "11%" }} />
        </colgroup>
        <thead>
          <tr className="text-ink-muted">
            <th className="text-left font-semibold pb-1.5 pr-2" rowSpan={2}>
              {it ? "Dimensione · cella" : "Dimension · cell"}
            </th>
            <th className="text-right font-semibold pb-1.5 px-2" rowSpan={2}>
              {it ? "Peso frozen" : "Frozen weight"}
            </th>
            <th className="text-center font-semibold pb-1.5 px-2" rowSpan={2}>
              Conf
            </th>
            <th
              className="text-center font-semibold pb-0 px-2 pt-1"
              colSpan={3}
              style={{ color: "#2563eb" }}
            >
              {it ? "Mio portafoglio" : "My portfolio"}
            </th>
            <th
              className="text-center font-semibold pb-0 px-2 pt-1"
              colSpan={3}
              style={{ color: "#9333ea" }}
            >
              {it ? "Sim loop portfolio" : "Sim loop portfolio"}
            </th>
          </tr>
          <tr className="text-ink-muted border-b border-[rgb(var(--border))]/60">
            <th className="text-right font-semibold pb-1.5 px-1">#</th>
            <th className="text-right font-semibold pb-1.5 px-1">{it ? "Capitale" : "Capital"}</th>
            <th className="text-right font-semibold pb-1.5 px-1">E[P&L]</th>
            <th className="text-right font-semibold pb-1.5 px-1">#</th>
            <th className="text-right font-semibold pb-1.5 px-1">{it ? "Capitale" : "Capital"}</th>
            <th className="text-right font-semibold pb-1.5 px-1">E[P&L]</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(byDim.entries()).map(([dim, dimRows]) => (
            <DimensionGroup
              key={dim}
              label={dimLabel[dim]}
              rows={dimRows}
              it={it}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DimensionGroup({
  label,
  rows,
  it,
}: {
  label: string;
  rows: DimensionBreakdownRow[];
  it: boolean;
}) {
  void it;
  return (
    <>
      <tr>
        <td
          colSpan={9}
          className="pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-ink-muted"
        >
          {label}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={`${r.dimension}::${r.cell}`} className="border-b border-[rgb(var(--border))]/30">
          <td className="py-1.5 pr-2 text-ink truncate" title={r.cell}>
            {r.cell}
          </td>
          <td className="py-1.5 px-2 text-right tabular-nums text-ink">
            {r.frozenWeight != null ? fmtPct(r.frozenWeight) : "—"}
            {r.frozenN > 0 ? (
              <span className="text-[9px] text-ink-muted ml-1">n={r.frozenN}</span>
            ) : null}
          </td>
          <td className="py-1.5 px-2 text-center">
            <ConfBadge level={r.frozenConfidence} />
          </td>
          {/* Mine */}
          <td className="py-1.5 px-1 text-right tabular-nums text-ink-muted">
            {r.mine.positions || "—"}
          </td>
          <td className="py-1.5 px-1 text-right tabular-nums text-ink">
            {r.mine.capitalEur > 0 ? fmtEurNoSign(r.mine.capitalEur) : "—"}
          </td>
          <td
            className={`py-1.5 px-1 text-right tabular-nums font-semibold ${
              r.mine.expectedPnlEur > 0
                ? "text-emerald-700"
                : r.mine.expectedPnlEur < 0
                  ? "text-rose-700"
                  : "text-ink-muted"
            }`}
          >
            {r.mine.expectedPnlEur !== 0 ? fmtEur(r.mine.expectedPnlEur) : "—"}
          </td>
          {/* Sim loop */}
          <td className="py-1.5 px-1 text-right tabular-nums text-ink-muted">
            {r.simLoop.positions || "—"}
          </td>
          <td className="py-1.5 px-1 text-right tabular-nums text-ink">
            {r.simLoop.capitalEur > 0 ? fmtEurNoSign(r.simLoop.capitalEur) : "—"}
          </td>
          <td
            className={`py-1.5 px-1 text-right tabular-nums font-semibold ${
              r.simLoop.expectedPnlEur > 0
                ? "text-emerald-700"
                : r.simLoop.expectedPnlEur < 0
                  ? "text-rose-700"
                  : "text-ink-muted"
            }`}
          >
            {r.simLoop.expectedPnlEur !== 0 ? fmtEur(r.simLoop.expectedPnlEur) : "—"}
          </td>
        </tr>
      ))}
    </>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────

export function PortfolioBreakevenComparisonView({
  allRows,
  simTable,
  sdsRows,
  inputs,
  stats,
  targetProbPct = 50,
  simLoopMaxPositions,
}: {
  allRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  inputs?: InvestSimInputs | null;
  stats: TradeOutcomeStats;
  targetProbPct?: number;
  simLoopMaxPositions?: number;
}) {
  const { lang } = useLang();
  const it = lang === "it";

  const comparison: PortfolioComparisonResult = useMemo(
    () =>
      buildPortfolioComparison({
        allRows,
        simTable: simTable ?? null,
        sdsRows: sdsRows ?? null,
        inputs: inputs ?? null,
        stats,
        targetProbPct,
        simLoopMaxPositions,
      }),
    [allRows, simTable, sdsRows, inputs, stats, targetProbPct, simLoopMaxPositions],
  );

  const beTotal = comparison.breakEven.totalEur;

  return (
    <div className="flex flex-col gap-4">
      {/* Intro banner */}
      <div className="invest-trend-chart-panel rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="text-2xl shrink-0">⚖️</div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-ink">
              {it
                ? "Confronto portafogli: mio vs sim loop · scalati al break-even"
                : "Portfolio comparison: mine vs sim loop · scaled to break-even"}
            </h3>
            <p className="text-[11px] text-ink-muted leading-relaxed mt-1">
              {it
                ? `Confronto a parità di logica di sizing (pesi calibrati dalla Calibration Center) tra le posizioni reali aperte nella tab Simulation e quelle che la sim loop avrebbe scelto seguendo i suoi suggerimenti BUY/ENTRY. Capitale di break-even = capitale totale tale che P(portafoglio chiuso > 0) ≥ ${targetProbPct}%.`
                : `Same sizing logic on both sides (calibrated weights from the Calibration Center): your real open positions in the Simulation tab vs what the sim loop would hold today executing all its BUY/ENTRY suggestions. Break-even capital = total capital such that P(portfolio close > 0) ≥ ${targetProbPct}%.`}
            </p>
            {comparison.weightsNeutral ? (
              <p className="text-[11px] text-amber-700 font-semibold mt-2">
                {it
                  ? "⚠️ Nessun peso approvato nel Calibration Center: il sizing usa win rate neutro 50% per ogni cella. Approva almeno una proposta per attivare il sizing calibrato."
                  : "⚠️ No approved weights in the Calibration Center: sizing uses a neutral 50% win rate for every cell. Approve at least one proposal to activate calibrated sizing."}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Total cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TotalCard
          title={it ? "Mio portafoglio" : "My portfolio"}
          positions={comparison.mineTotals.positions}
          capital={comparison.mineTotals.capitalEur}
          expectedPnl={comparison.mineTotals.expectedPnlEur}
          winRate={comparison.mineTotals.avgWinRate}
          breakEvenCap={beTotal}
          unreachableReason={comparison.breakEven.unreachableReason}
          it={it}
          tone="mine"
        />
        <TotalCard
          title={it ? "Sim loop portfolio" : "Sim loop portfolio"}
          positions={comparison.simLoopTotals.positions}
          capital={comparison.simLoopTotals.capitalEur}
          expectedPnl={comparison.simLoopTotals.expectedPnlEur}
          winRate={comparison.simLoopTotals.avgWinRate}
          breakEvenCap={beTotal}
          unreachableReason={comparison.breakEven.unreachableReason}
          it={it}
          tone="sim"
        />
      </div>

      {/* Per-dimension breakdown */}
      <div className="invest-trend-chart-panel rounded-xl border p-4">
        <h4 className="text-sm font-bold text-ink mb-1">
          {it
            ? "Allocazione per dimensione calibrata"
            : "Allocation by calibrated dimension"}
        </h4>
        <p className="text-[11px] text-ink-muted leading-snug mb-3">
          {it
            ? "Per ogni cella di dimensione (fase / SDS / P(plan)) mostriamo capitale e E[P&L] dei due portafogli + il peso frozen del Calibration Center. Capitale e E[P&L] per riga sono divisi per il numero di dimensioni (4) per evitare doppio conteggio sui totali."
            : "For each dimension cell (phase / SDS / P(plan)) we show capital and E[P&L] for both portfolios + the frozen weight from the Calibration Center. Per-row capital and E[P&L] are divided by the number of dimensions (4) to avoid double-counting in totals."}
        </p>
        <BreakdownTable rows={comparison.rows} it={it} />
      </div>
    </div>
  );
}
