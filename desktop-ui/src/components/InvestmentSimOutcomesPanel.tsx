import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import {
  loadInvestmentSimOutcomes,
  type SimOutcomesDoc,
  type SimOutcomeRow,
} from "../data/investmentSimOutcomesData";
import { PortfolioTickerMark } from "./PortfolioScopeToggle";
import { PortfolioTrendLegend } from "./PortfolioPnlTrendIcon";
import { DailyLedgerIcon } from "./PortfolioDailyPnlDrawer";
import { useInvestSimInputs } from "../hooks/useInvestSimInputs";
import { useInvestSimPortfolioHistory } from "../hooks/useInvestSimPortfolioHistory";
import type { InvestSimHistoryPoint, InvestSimInputs } from "../sheet/investSimStorage";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { useT } from "../shared/i18n";
import { buildSimRowByKeyMap, normalizedRowKey } from "../sheet/investSimKeys";
import {
  aggregateOpenPortfolioPnl,
  buildActivePortfolioPositions,
  positionPnlForOpenRow,
  currentPriceFromRow,
  portfolioDailyPnlFromRow,
  rowHasActivePortfolio,
  SIM_PNL_NA_TOOLTIP,
  type SimulationPosition,
} from "../sheet/simulationPosition";
import {
  realizedPnlEurFromOutcome,
  realizedPnlPctFromOutcome,
} from "../sheet/outcomePnlDisplay";
import {
  fmtPortfolioPnlPct,
  fmtPortfolioPnlUsd,
  portfolioTableRowClass,
  portfolioTotalDisplayValues,
  positionPnlToneClass,
  resolvePnlTabCardTone,
} from "../sheet/portfolioGainLossStyle";
import { detectPortfolioLossAlerts } from "../sheet/portfolioLossUrgent";
import { summarizeRealPortfolioSignalAccuracy } from "../sheet/realPortfolioAccuracy";
import { resolveExpectedGainPlan } from "../sheet/simulationPlanGain";
import {
  buildSlopeAwareTargetStop,
} from "../sheet/dynamicTargetStop";
import {
  classifyRegime,
  extractCurveInputs,
} from "../sheet/precatCurve";
import {
  computeSlopeStability,
  stabilityVerdict,
} from "../sheet/slopeStability";
import { SIM_MONITOR_HORIZON_DAYS } from "../sheet/cdHorizons";
import { saveInvestSimInputsPersisted } from "../api/investSim";
import { reconcileInvestSimInputs } from "../sheet/investSimKeys";
import {
  hydrateInvestSimInputs,
  INVEST_SIM_INPUTS_CHANGED_EVENT,
  investSimInputsUpdatedAtIso,
} from "../sheet/investSimStorage";
import { SHEET_GRID_TABLE_CLASS, gridTd, gridTh } from "../sheet/sheetGridTable";
import { SheetGridColgroup } from "../sheet/SheetGridColgroup";
import { PlanProbLearningPanel } from "./PlanProbLearningPanel";
import { SelectionChip } from "./SelectionChip";

type PortfolioSubTab = "tracking" | "planProb";

// ── "Your portfolio" tab — REDESIGN ─────────────────────────────────────────
//
// Objective (user request):
//   "track how much the system helps me make investment decisions, invested
//    and divested capital, loss/gain. Slope of the curve recorded during
//    investment and divestment, correlation curve between this, prediction
//    reliability and gain/loss, to understand whether the curve slope is an
//    important index for suggesting investment and when the negative
//    variation becomes an index for divesting."
//
// Approach (Phase 1):
//   - Reduced essential KPIs (4 instead of 6).
//   - "Open positions → when to exit" section: for each open we combine
//     current slope (latest_slope_20d from histlib via Python) + P&L
//     mark-to-market → HOLD / WATCH / EXIT SUGGESTED verdict.
//   - "Current slope vs P&L %" scatter: visual correlation. On OPEN positions
//     it's the most recent slope of the ticker; on CLOSED we prefer
//     pre_cd_slope_20d (CD offset T-1) if available.
//   - "Reliability at entry vs P&L %" scatter: historical correlation.
//   - Compact decision table at the bottom.
//
// Slope source: prediction/investment_sim_outcomes.py reads the file
// model_historical_input_library.json and populates latest_*/pre_cd_* for
// each position. Without this backend the exit/verdict section shows "N/A".

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtSlope(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)} pp/d`;
}

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "up" | "down" | "warn";
}) {
  const color =
    accent === "up"
      ? "text-[rgb(var(--signal-up))]"
      : accent === "down"
        ? "text-[rgb(var(--signal-down))]"
        : accent === "warn"
          ? "text-[rgb(var(--warn))]"
          : "";
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 bg-surface/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function fmtGeneratedAt(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso.slice(0, 16);
  }
}

function fmtUsDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = parseYmdOrDmy(raw);
  if (!d) return "—";
  return d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

function parseYmdOrDmy(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) {
    const d = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function daysFromEntryToNow(r: SimOutcomeRow): number | null {
  const entry = parseYmdOrDmy(r.entry_ts ?? null);
  if (!entry) return null;
  const now = new Date();
  const days = Math.round((now.getTime() - entry.getTime()) / 86400000);
  return Math.max(0, days);
}

/** One row per position key — keep latest exit when the log has duplicate closes. */
function dedupeClosedOutcomeRows(rows: SimOutcomeRow[]): SimOutcomeRow[] {
  const closed = rows.filter((r) => !isOpenPosition(r));
  const byKey = new Map<string, SimOutcomeRow>();
  for (const r of closed) {
    const prev = byKey.get(r.row_key);
    if (!prev) {
      byKey.set(r.row_key, r);
      continue;
    }
    const aTs = Date.parse(r.exit_ts ?? "");
    const bTs = Date.parse(prev.exit_ts ?? "");
    const pick =
      Number.isFinite(aTs) && Number.isFinite(bTs)
        ? aTs > bTs
        : (r.pnl_pct ?? -1e9) > (prev.pnl_pct ?? -1e9);
    if (pick) byKey.set(r.row_key, r);
  }
  return [...byKey.values()];
}

function isOpenPosition(r: SimOutcomeRow): boolean {
  // Prefer explicit state from decision log when available.
  if (typeof r.decision_current_open === "boolean") return r.decision_current_open;
  // Fallback: if no exit is recorded yet, treat as open.
  if (!r.exit_ts) return true;
  return false;
}

// ── "When to exit" verdict ──────────────────────────────────────────────────
//
// Combines slope_20d + P&L + pre-CD gain plan (same engine as Decision Lab cards).
// EXIT on negative slope only when there is no active pre-CD upside thesis.

// Combines current slope (slope_20d) + P&L + tesi pre-CD (gain atteso verso CD):
//   EXIT  → slope ≤ −0.3 pp/d AND P&L < +10%, salvo tesi pre-CD attiva
//   WATCH → flat / incerta slope
//   HOLD  → slope positiva, profitto ≥ +10%, o pre-CD con upside material

type ExitVerdict = "hold" | "watch" | "exit" | "n/d";

type ExitVerdictContext = {
  daysToCd?: number | null;
  daysToTarget?: number | null;
  targetReturnPct?: number | null;
  /** ROI→CD — solo informativo se target assente. */
  expectedReturnPct?: number | null;
  sellTriggerPct?: number | null;
  /** BTR + CD ≤15g → non forzare hold pre-CD */
  btrLateRisk?: boolean;
  rotationFlag?: 0 | 1;
};

const PRECD_MIN_EXPECTED_PCT = 8;
const PRECD_MAX_DRAWDOWN_PCT = -10;
const PRECD_MIN_DAYS_TO_CD = 6;

function buildExitVerdictContext(
  simRow: Record<string, unknown> | undefined,
  capital: number,
): ExitVerdictContext {
  if (!simRow || capital <= 0) return {};
  const gainPlan = resolveExpectedGainPlan(simRow, capital);
  const { slope5d, slope20d, slope45d, runUp30d } = extractCurveInputs(simRow);
  const stab = computeSlopeStability(slope5d, slope20d, slope45d);
  const effSlope =
    slope20d != null && Number.isFinite(slope20d) ? slope20d : slope5d ?? null;
  const dynamic = buildSlopeAwareTargetStop({
    slope5d,
    slope20d,
    slope45d,
    runUp30d,
    days: gainPlan.daysToCd,
    isLong: true,
    stabilityVerdict: stabilityVerdict(stab, effSlope),
    rotationFlag: stab.rotationFlag,
  });
  const regime = classifyRegime(runUp30d);
  const days = gainPlan.daysToCd;
  return {
    daysToCd: days,
    daysToTarget: gainPlan.daysToTarget,
    targetReturnPct: gainPlan.targetReturnPct,
    expectedReturnPct: gainPlan.expectedReturnPct,
    sellTriggerPct: dynamic?.sellTriggerPct ?? null,
    btrLateRisk: regime === "btr" && days != null && days <= 15,
    rotationFlag: stab.rotationFlag,
  };
}

function preCdHoldThesis(ctx: ExitVerdictContext, pnlPct: number | null): boolean {
  const days = ctx.daysToTarget ?? ctx.daysToCd;
  const exp = ctx.targetReturnPct ?? ctx.expectedReturnPct;
  if (days == null || days < PRECD_MIN_DAYS_TO_CD || days > SIM_MONITOR_HORIZON_DAYS) {
    return false;
  }
  if (exp == null || exp < PRECD_MIN_EXPECTED_PCT) return false;
  if (ctx.btrLateRisk) return false;
  if (ctx.rotationFlag === 1) return false;
  if (pnlPct != null && pnlPct <= PRECD_MAX_DRAWDOWN_PCT) return false;
  if (
    ctx.sellTriggerPct != null &&
    pnlPct != null &&
    pnlPct < ctx.sellTriggerPct
  ) {
    return false;
  }
  return true;
}

function exitVerdict(
  slope20d: number | null,
  pnlPct: number | null,
  ctx: ExitVerdictContext = {},
): { verdict: ExitVerdict; reason: string } {
  if (slope20d == null) {
    if (pnlPct == null) return { verdict: "n/d", reason: "Slope data unavailable" };
    return { verdict: "n/d", reason: "Curve slope unavailable (register T-60..T-1)" };
  }
  // Dynamic stop / deep loss — always exit
  if (
    ctx.sellTriggerPct != null &&
    pnlPct != null &&
    pnlPct < ctx.sellTriggerPct
  ) {
    return {
      verdict: "exit",
      reason: `P&L ${fmtPct(pnlPct)} below dynamic stop (${ctx.sellTriggerPct.toFixed(1)}%)`,
    };
  }
  if (pnlPct != null && pnlPct <= PRECD_MAX_DRAWDOWN_PCT) {
    return {
      verdict: "exit",
      reason: `P&L ${fmtPct(pnlPct)} beyond max drawdown (${PRECD_MAX_DRAWDOWN_PCT}%)`,
    };
  }
  
  // Target reached (within 1% tolerance) — EXIT to capture gain
  const targetReached = 
    ctx.targetReturnPct != null && 
    pnlPct != null && 
    pnlPct >= (ctx.targetReturnPct - 1);
  
  if (targetReached) {
    return {
      verdict: "exit",
      reason: `Target ${fmtPct(ctx.targetReturnPct!)} reached (P&L ${fmtPct(pnlPct!)}) — capture gain`,
    };
  }
  
  // Strong curve reversal with rotation flag — EXIT even with profit
  if (ctx.rotationFlag && slope20d <= -0.2 && pnlPct != null && pnlPct < 8) {
    return {
      verdict: "exit",
      reason: `Curve rotation + negative slope ${fmtSlope(slope20d)} — exit before erosion`,
    };
  }
  
  // Consolidated profit: let it run only if slope still favorable
  if (pnlPct != null && pnlPct >= 10) {
    if (slope20d <= -0.4) {
      return {
        verdict: "exit",
        reason: `P&L +${pnlPct.toFixed(1)}% but strong reversal ${fmtSlope(slope20d)} — secure profit`,
      };
    }
    return {
      verdict: "hold",
      reason: `P&L +${pnlPct.toFixed(1)}% consolidated — let it run, manage with trailing stop`,
    };
  }
  
  // Target thesis: upside verso fine tratto in salita — non uscire solo per pendenza
  if (preCdHoldThesis(ctx, pnlPct)) {
    const exp = (ctx.targetReturnPct ?? ctx.expectedReturnPct)!;
    const days = (ctx.daysToTarget ?? ctx.daysToCd)!;
    
    // Se la curva si è invertita FORTE anche con pre-CD thesis → EXIT
    if (slope20d <= -0.5 || (ctx.rotationFlag && slope20d <= -0.3)) {
      return {
        verdict: "exit",
        reason: `Strong curve reversal ${fmtSlope(slope20d)} — exit despite pre-CD thesis`,
      };
    }
    
    if (slope20d <= -0.3) {
      return {
        verdict: "watch",
        reason: `Pre-CD thesis (+${exp.toFixed(0)}% expected in ${days}d): temporary drawdown (slope ${fmtSlope(slope20d)}) — monitor closely`,
      };
    }
    if (slope20d < 0.1) {
      return {
        verdict: "hold",
        reason: `Pre-CD thesis (+${exp.toFixed(0)}% in ${days}d) — hold toward CD, monitor slope`,
      };
    }
    return {
      verdict: "hold",
      reason: `Pre-CD +${exp.toFixed(0)}% in ${days}d — favorable hold toward CD`,
    };
  }
  
  // Clearly negative slope = exit suggested (no pre-CD thesis)
  if (slope20d <= -0.3) {
    return {
      verdict: "exit",
      reason: `Slope 20d ${fmtSlope(slope20d)} (negative) — divestment signal`,
    };
  }
  // Flat or slightly negative slope = watch
  if (slope20d < 0.1) {
    return {
      verdict: "watch",
      reason: `Slope 20d ${fmtSlope(slope20d)} (flat/uncertain) — await direction confirmation`,
    };
  }
  // Positive slope = hold
  return {
    verdict: "hold",
    reason: `Slope 20d ${fmtSlope(slope20d)} (positive) — favorable momentum, hold`,
  };
}

function verdictTone(v: ExitVerdict): { label: string; color: string; bg: string } {
  switch (v) {
    case "hold":
      return { label: "HOLD", color: "text-[rgb(var(--signal-up))]", bg: "bg-[rgb(var(--signal-up))]/15" };
    case "watch":
      return { label: "WATCH", color: "text-[rgb(var(--warn))]", bg: "bg-[rgb(var(--warn))]/15" };
    case "exit":
      return { label: "EXIT", color: "text-[rgb(var(--signal-down))]", bg: "bg-[rgb(var(--signal-down))]/15" };
    case "n/d":
    default:
      return { label: "N/A", color: "text-ink-muted", bg: "bg-surface/40" };
  }
}

// ── Helper: slope per row (priority entry > pre_cd > latest) ────────────────
//
// For each position we prefer the slope in this order:
//   1. entry_slope_20d → REAL snapshot recorded at the moment the position
//      was opened (persistent decision log). It's the most genuine data:
//      it's what you saw when you decided to invest.
//   2. pre_cd_slope_20d → snapshot at T-1 offset of THIS position's CD
//      (from histlib). Retrospective proxy, used for already closed
//      positions that did not have a decision log at the time of opening.
//   3. latest_slope_20d → most recent ticker snapshot (any CD).
//      Fallback for positions with future CD without decision log.
function getEffectiveSlope20d(r: SimOutcomeRow): number | null {
  if (r.entry_slope_20d != null && Number.isFinite(r.entry_slope_20d)) return r.entry_slope_20d;
  if (r.pre_cd_slope_20d != null && Number.isFinite(r.pre_cd_slope_20d)) return r.pre_cd_slope_20d;
  if (r.latest_slope_20d != null && Number.isFinite(r.latest_slope_20d)) return r.latest_slope_20d;
  return null;
}

function slope20dForOpenPosition(
  outcome: SimOutcomeRow | undefined,
  simRow: Record<string, unknown> | undefined,
): number | null {
  if (outcome) {
    const s = getEffectiveSlope20d(outcome);
    if (s != null) return s;
  }
  if (simRow) {
    const { slope20d } = extractCurveInputs(simRow);
    if (slope20d != null && Number.isFinite(slope20d)) return slope20d;
  }
  return null;
}

function slopeSourceForOpen(
  outcome: SimOutcomeRow | undefined,
  simRow: Record<string, unknown> | undefined,
): string {
  if (outcome) return getSlopeSourceLabel(outcome);
  if (simRow) return "Simulation row · slope 20d";
  return "n/a";
}

function getSlopeSourceLabel(r: SimOutcomeRow): string {
  if (r.entry_slope_20d != null) {
    if (r.entry_was_existing) {
      return r.entry_ts ? `entry log · retroactive ${r.entry_ts.slice(0, 10)}` : "entry log · retroactive";
    }
    return r.entry_ts ? `entry log · ${r.entry_ts.slice(0, 10)}` : "entry log";
  }
  if (r.pre_cd_slope_20d != null) {
    return r.pre_cd_slope_offset ? `histlib · pre-CD (${r.pre_cd_slope_offset})` : "histlib · pre-CD";
  }
  if (r.latest_slope_20d != null) {
    return r.latest_slope_asof ? `histlib · at ${r.latest_slope_asof}` : "histlib · latest";
  }
  return "n/a";
}

// ── Correlazione semplice (sign concordance + Pearson r) ────────────────────
function pearsonR(pts: { x: number; y: number }[]): number | null {
  if (pts.length < 3) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const p of pts) {
    const ex = p.x - mx;
    const ey = p.y - my;
    num += ex * ey;
    dx2 += ex * ex;
    dy2 += ey * ey;
  }
  if (dx2 < 1e-12 || dy2 < 1e-12) return null;
  return num / Math.sqrt(dx2 * dy2);
}

function signConcordancePct(pts: { x: number; y: number }[]): number | null {
  if (pts.length < 2) return null;
  let n = 0, hit = 0;
  for (const p of pts) {
    if (Math.abs(p.x) < 1e-6 || Math.abs(p.y) < 1e-6) continue;
    n++;
    if (Math.sign(p.x) === Math.sign(p.y)) hit++;
  }
  if (n === 0) return null;
  return (100 * hit) / n;
}

// ── Scatter tooltip ─────────────────────────────────────────────────────────
function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    payload?: {
      ticker: string;
      x: number;
      y: number;
      xLabel: string;
      yLabel: string;
      xUnit: string;
      outcome?: string;
      pnlEur?: number | null;
    };
  }>;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/60 bg-[rgb(var(--surface-elevated))] px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold">{p.ticker}</p>
      {p.outcome ? <p className="text-[10px] text-ink-muted/90">{p.outcome}</p> : null}
      <p className="text-ink-muted tabular-nums">
        {p.xLabel}: <strong className="text-ink">{p.x >= 0 ? "+" : ""}{p.x.toFixed(2)}{p.xUnit}</strong>
      </p>
      <p className="text-ink-muted tabular-nums">
        {p.yLabel}: <strong className="text-ink">{p.y >= 0 ? "+" : ""}{p.y.toFixed(2)}%</strong>
      </p>
      {p.pnlEur != null && Number.isFinite(p.pnlEur) ? (
        <p className="text-ink-muted tabular-nums">
          P&L €: <strong className="text-ink">{fmtUsd(p.pnlEur)}</strong>
        </p>
      ) : null}
    </div>
  );
}

// ── Correlation scatter panel ───────────────────────────────────────────────
function scatterYDomain(pts: { y: number }[]): [number, number] {
  const ys = pts.map((p) => p.y).filter((y) => Number.isFinite(y) && Math.abs(y) <= 150);
  if (!ys.length) return [-15, 15];
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const pad = Math.max(4, (max - min) * 0.2 || 4);
  return [Math.min(min - pad, -2), Math.max(max + pad, 2)];
}

function CorrelationPanel({
  title,
  subtitle,
  pts,
  xLabel,
  xUnit,
  xKeyHint,
}: {
  title: string;
  subtitle: string;
  pts: { ticker: string; x: number; y: number; outcome?: string; pnlEur?: number | null }[];
  xLabel: string;
  xUnit: string;
  xKeyHint: string;
}) {
  const t = useT();
  const data = pts.map((p) => ({
    ticker: p.ticker,
    x: p.x,
    y: p.y,
    xLabel,
    yLabel: "P&L %",
    xUnit,
    outcome: p.outcome,
    pnlEur: p.pnlEur,
  }));
  const r = pearsonR(data);
  const sc = signConcordancePct(data);
  const yDomain = scatterYDomain(data);

  return (
    <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 space-y-2">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h4 className="text-sm font-semibold">{title}</h4>
          <p className="text-[10px] text-ink-muted leading-tight">{subtitle}</p>
        </div>
        <div className="flex gap-2 text-[10px] text-ink-muted">
          {r != null && (
            <span title="Pearson r — −1=anti-correlation, 0=none, +1=perfect correlation">
              r = <strong className={`tabular-nums ${
                r >= 0.3 ? "text-[rgb(var(--signal-up))]" :
                r <= -0.3 ? "text-[rgb(var(--signal-down))]" :
                "text-[rgb(var(--warn))]"
              }`}>{r.toFixed(2)}</strong>
            </span>
          )}
          {sc != null && (
            <span title="% of positions where the X-axis sign matches the P&L sign">
              concord. = <strong className="text-ink tabular-nums">{sc.toFixed(0)}%</strong>
            </span>
          )}
          <span>n = <strong className="text-ink tabular-nums">{data.length}</strong></span>
        </div>
      </div>
      {data.length < 2 ? (
        <p className="text-[11px] text-ink-muted py-6 text-center">
          Need ≥2 positions with {xKeyHint} data. You have {data.length} valid {data.length === 1 ? "position" : "positions"}.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 8, right: 16, bottom: 28, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" className="opacity-25" />
            <XAxis
              type="number"
              dataKey="x"
              tick={{ fontSize: 10 }}
              label={{ value: `${xLabel} (${xUnit})`, position: "bottom", offset: 12, fontSize: 10 }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={yDomain}
              tick={{ fontSize: 10 }}
              tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
              label={{ value: "P&L %", angle: -90, position: "insideLeft", offset: 8, fontSize: 10 }}
            />
            <ZAxis range={[60, 60]} />
            <ReferenceLine x={0} stroke="rgba(120,120,120,0.4)" strokeDasharray="2 2" />
            <ReferenceLine y={0} stroke="rgba(120,120,120,0.4)" strokeDasharray="2 2" />
            <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3" }} />
            <Scatter
              data={data}
              fill="rgb(var(--accent))"
              shape={(props: { cx?: number; cy?: number; payload?: { y: number } }) => {
                const cx = props.cx ?? 0;
                const cy = props.cy ?? 0;
                const y = props.payload?.y ?? 0;
                const color =
                  y > 0 ? "rgb(var(--signal-up))" :
                  y < 0 ? "rgb(var(--signal-down))" :
                  "rgb(var(--warn))";
                return <circle cx={cx} cy={cy} r={6} fill={color} fillOpacity={0.75} stroke={color} strokeWidth={1.5} />;
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      )}
      {r != null && (
        <p className="text-[10px] text-ink-muted/85 leading-snug">
          {r >= 0.3
            ? t("simOutcomes.chart.corrPos", { label: xLabel })
            : r <= -0.3
              ? t("simOutcomes.chart.corrNeg", { label: xLabel })
              : t("simOutcomes.chart.corrWeak", { n: data.length })}
        </p>
      )}
    </div>
  );
}

// ── Open/closed panels ──────────────────────────────────────────────────────

function simulationPriceSignature(
  simTable: import("../types").SheetTable | null,
  inputs: import("../sheet/investSimStorage").InvestSimInputs,
): string {
  const parts: string[] = [];
  for (const row of simTable?.rows ?? []) {
    if (!rowHasActivePortfolio(row, inputs)) continue;
    const tk = String(row.Ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk || tk.includes("TOTALE")) continue;
    const key = normalizedRowKey(tk, row["Completion Date"]);
    const price = currentPriceFromRow(row);
    parts.push(`${key}:${price ?? "n"}`);
  }
  parts.sort();
  return parts.join("|");
}

function OpenPositionsExitPanel({
  activePositions,
  outcomeByKey,
  simRowByKey,
  inputs,
  portfolioHistory,
  onOpenPredictionCharts,
}: {
  activePositions: SimulationPosition[];
  outcomeByKey: Map<string, SimOutcomeRow>;
  simRowByKey: Map<string, Record<string, unknown>>;
  inputs: InvestSimInputs;
  portfolioHistory: InvestSimHistoryPoint[];
  onOpenPredictionCharts?: (focus: { seriesKey: string | null; ticker: string }) => void;
}) {
  const t = useT();
  if (!activePositions.length) {
    return (
      <p className="text-xs text-ink-muted py-4 text-center">
        {t("simOutcomes.open.empty")}
      </p>
    );
  }
  // P&L allineato al tab Simulation → P&L (positionPnlForOpenRow + resolvePnlTabCardTone).
  const enriched = activePositions.map((pos) => {
    const outcome = outcomeByKey.get(pos.key);
    const simRow = simRowByKey.get(pos.key);
    const slope20d = slope20dForOpenPosition(outcome, simRow);
    const capital = pos.capital;
    const metrics =
      simRow && !pos.pnlUnavailable
        ? positionPnlForOpenRow(simRow, inputs, portfolioHistory)
        : null;
    const pnlEur =
      metrics?.pnlEur ?? (pos.pnlUnavailable ? null : pos.pnlEur);
    const pnlPct =
      metrics?.pnlPct ?? (pos.pnlUnavailable ? null : pos.pnlPct);
    const ctx = buildExitVerdictContext(simRow, capital);
    const v = exitVerdict(slope20d, pnlPct, ctx);
    const cardTone = resolvePnlTabCardTone(pnlEur, pnlPct);
    return {
      pos,
      outcome,
      simRow,
      slope20d,
      slopeSource: slopeSourceForOpen(outcome, simRow),
      pnlPct,
      pnlEur,
      metrics,
      cardTone,
      ...v,
    };
  });
  const order: Record<ExitVerdict, number> = { exit: 0, watch: 1, "n/d": 2, hold: 3 };
  const toneOrder = (t: ReturnType<typeof resolvePnlTabCardTone>) =>
    t === "loss" ? 0 : t === "flat" ? 1 : 2;
  enriched.sort(
    (a, b) =>
      toneOrder(a.cardTone) - toneOrder(b.cardTone) ||
      order[a.verdict] - order[b.verdict] ||
      (a.pnlPct ?? 0) - (b.pnlPct ?? 0),
  );

  return (
    <div className="overflow-auto">
      <table className={`${SHEET_GRID_TABLE_CLASS} text-xs border-collapse`}>
        <SheetGridColgroup columnCount={7} />
        <thead className="sticky top-0 bg-surface-elevated">
          <tr className="text-[10px] uppercase text-ink-muted">
            <th className={gridTh("left")}>Ticker</th>
            <th className={gridTh("left")} title="Data di acquisto / ingresso (decision log o prima allocazione capitale)">Buy date</th>
            <th className={gridTh("center")}>Capital</th>
            <th className={gridTh("center")} title="P&L corrente (mark-to-market) o realizzato se già venduto">P&L</th>
            <th className={gridTh("center")} title="Days the investment has been held">Hold days</th>
            <th className={gridTh("center")}>Slope 20d</th>
            <th className={gridTh("center")}>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {enriched.map((e) => {
            const tone = verdictTone(e.verdict);
            const simRow = e.simRow;
            const pos = e.pos;
            const metrics = e.metrics;
            const daily =
              metrics?.pnlEur24h != null || metrics?.pnlPct24h != null
                ? {
                    pnlEur24h: metrics.pnlEur24h,
                    pnlPct24h: metrics.pnlPct24h,
                  }
                : !pos.pnlUnavailable
                  ? portfolioDailyPnlFromRow(pos, simRow)
                  : { pnlEur24h: null as number | null, pnlPct24h: null as number | null };
            const totalDisp = portfolioTotalDisplayValues(e.pnlEur, e.pnlPct);
            const pnlColor =
              e.pnlEur != null || e.pnlPct != null
                ? positionPnlToneClass(e.cardTone)
                : "text-ink-muted";
            const portRowCls = portfolioTableRowClass(e.cardTone);
            const slopeColor =
              e.slope20d == null ? "text-ink-muted" :
              e.slope20d > 0 ? "text-[rgb(var(--signal-up))]" :
              e.slope20d < -0.1 ? "text-[rgb(var(--signal-down))]" : "text-[rgb(var(--warn))]";
            const holdDays =
              e.outcome?.holding_days ??
              (e.outcome?.entry_ts ? daysFromEntryToNow(e.outcome) : null);
            return (
              <tr
                key={e.pos.key}
                className={`border-t border-[rgb(var(--border))]/30 ${portRowCls}`}
              >
                <td className={`${gridTd("left")} ${portRowCls}`}>
                  <PortfolioTickerMark
                    ticker={pos.ticker}
                    inPortfolio
                    pnlPct={e.pnlPct}
                    pnlEur={e.pnlEur}
                    pnlEur24h={daily.pnlEur24h}
                    pnlPct24h={daily.pnlPct24h}
                    onTickerClick={
                      onOpenPredictionCharts
                        ? () =>
                            onOpenPredictionCharts({
                              ticker: pos.ticker,
                              seriesKey: simRow
                                ? simulationRowSeriesKey(simRow) ?? null
                                : null,
                            })
                        : undefined
                    }
                    tickerTitle={t("signals.priority.openChartsTitle")}
                  />
                </td>
                <td className={`${gridTd("left")} text-ink-muted`}>
                  {e.outcome?.entry_ts ? fmtUsDate(e.outcome.entry_ts) : "—"}
                </td>
                <td className={gridTd("center")}>{fmtUsd(pos.capital)}</td>
                <td className={`${gridTd("center")} font-medium ${pnlColor} ${portRowCls}`}>
                  {totalDisp.eur != null || totalDisp.pct != null ? (
                    <>
                      {fmtPortfolioPnlUsd(totalDisp.eur)}
                      {totalDisp.pct != null ? (
                        <span className="block text-[10px] opacity-80">
                          ({fmtPortfolioPnlPct(totalDisp.pct)})
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span title={SIM_PNL_NA_TOOLTIP}>—</span>
                  )}
                </td>
                <td className={`${gridTd("center")} text-ink-muted`}>
                  {holdDays != null ? `${holdDays}d` : "—"}
                </td>
                <td className={`${gridTd("center")} ${slopeColor}`} title={e.slopeSource}>
                  {fmtSlope(e.slope20d)}
                  <span className="block text-[9px] opacity-70">{e.slopeSource}</span>
                </td>
                <td className={gridTd("center")}>
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${tone.color} ${tone.bg}`}
                    title={e.reason}
                  >
                    {tone.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main panel ──────────────────────────────────────────────────────────────
export function InvestmentSimOutcomesPanel({
  reloadToken = 0,
  simTable = null,
  onOpenPredictionCharts,
  onOpenSimulationPnl,
  onOpenDailyPnlLedger,
}: {
  reloadToken?: number;
  // simTable serve solo per ricostruire invest_sim_inputs reconcile; la slope
  // arriva da SimOutcomeRow.latest_slope_* / pre_cd_slope_* (popolati da Python).
  simTable?: import("../types").SheetTable | null;
  onOpenPredictionCharts?: (focus: { seriesKey: string | null; ticker: string }) => void;
  /** Apre Simulation → tab P&L (stesso motore colori righe). */
  onOpenSimulationPnl?: () => void;
  /** Apre Simulation → P&L → Daily detail (ledger). */
  onOpenDailyPnlLedger?: () => void;
}) {
  const t = useT();
  const inputs = useInvestSimInputs(simTable, reloadToken);
  const [historyTick, setHistoryTick] = useState(0);
  const [portfolioSubTab, setPortfolioSubTab] = useState<PortfolioSubTab>("tracking");
  const [doc, setDoc] = useState<SimOutcomesDoc | null>(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reloadInFlightRef = useRef(false);
  const inputsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(
    async (opts?: { rebuild?: boolean }) => {
      if (reloadInFlightRef.current) return;
      reloadInFlightRef.current = true;
      const rebuild = opts?.rebuild ?? false;
      setLoading(true);
      setError(null);
      try {
        let syncInputs: import("../sheet/investSimStorage").InvestSimInputs | undefined;
        if (rebuild) {
          const raw = await hydrateInvestSimInputs(simTable?.rows ?? undefined);
          syncInputs = simTable?.rows?.length
            ? reconcileInvestSimInputs(raw, simTable.rows)
            : raw;
          // Persist to disk only — do NOT call saveInvestSimInputs (dispatches
          // INVEST_SIM_INPUTS_CHANGED and caused an infinite reload loop here).
          await saveInvestSimInputsPersisted(syncInputs);
        }
        const res = await loadInvestmentSimOutcomes({ rebuild, syncInputs });
        setDoc(res.doc);
        setSource(res.source);
        setError(res.error ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        reloadInFlightRef.current = false;
      }
    },
    [simTable]
  );

  // Fast path: show cached outcomes JSON without blocking on Python rebuild.
  useEffect(() => {
    void reload({ rebuild: false });
  }, [reload]);

  // Full rebuild when user hits Reload in Decision Lab.
  useEffect(() => {
    if (reloadToken <= 0) return;
    void reload({ rebuild: true });
  }, [reloadToken, reload]);

  // After buy/sell: debounced rebuild (avoid event storm).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onInputsChanged = () => {
      setHistoryTick((n) => n + 1);
      if (inputsDebounceRef.current) clearTimeout(inputsDebounceRef.current);
      inputsDebounceRef.current = setTimeout(() => {
        void reload({ rebuild: true });
      }, 900);
    };
    window.addEventListener(INVEST_SIM_INPUTS_CHANGED_EVENT, onInputsChanged);
    return () => {
      window.removeEventListener(INVEST_SIM_INPUTS_CHANGED_EVENT, onInputsChanged);
      if (inputsDebounceRef.current) clearTimeout(inputsDebounceRef.current);
    };
  }, [reload]);

  const simRowByKey = useMemo(
    () => buildSimRowByKeyMap(simTable?.rows ?? []),
    [simTable?.rows],
  );
  const priceSignature = useMemo(
    () => simulationPriceSignature(simTable, inputs),
    [simTable, inputs],
  );
  const portfolioHistory = useInvestSimPortfolioHistory(reloadToken ?? historyTick).history;

  /** Stessi totali del tab Simulation → P&L e del drawer Daily detail. */
  const openPnlTotals = useMemo(
    () => aggregateOpenPortfolioPnl(simTable, inputs, portfolioHistory),
    [simTable, inputs, portfolioHistory],
  );

  const ledgerTodayPnl =
    openPnlTotals.todayCovered > 0 ? openPnlTotals.pnlEurToday : null;

  const rows = doc?.rows ?? [];
  const closedRows = useMemo(() => dedupeClosedOutcomeRows(rows), [rows]);

  const outcomeByKey = useMemo(() => {
    const m = new Map<string, SimOutcomeRow>();
    for (const r of rows) m.set(r.row_key, r);
    return m;
  }, [rows]);

  const activePortfolio = useMemo(
    () =>
      buildActivePortfolioPositions(simTable?.rows, inputs, {
        history: portfolioHistory,
      }),
    [simTable?.rows, inputs, portfolioHistory, priceSignature],
  );

  const portfolioLossCount = useMemo(
    () => detectPortfolioLossAlerts(simTable ?? null, inputs, portfolioHistory).length,
    [simTable, inputs, portfolioHistory],
  );

  // KPI: open = live Simulation P&L; closed = normalized realized outcomes
  const kpis = useMemo(() => {
    let capitalOpen = 0;
    let pnlClosed = 0;
    const nOpen = activePortfolio.length;
    let nClosed = 0;
    for (const pos of activePortfolio) {
      capitalOpen += pos.capital;
    }
    for (const r of closedRows) {
      const eur = realizedPnlEurFromOutcome(r);
      if (eur != null) pnlClosed += eur;
      nClosed++;
    }
    const signalAcc = summarizeRealPortfolioSignalAccuracy(rows);
    const buyEvalN = signalAcc.buy.n;
    const buySuccessN = signalAcc.buy.good ?? 0;
    const sellEvalN = signalAcc.sell.n;
    const sellSuccessN = signalAcc.sell.good ?? 0;
    return {
      capitalOpen,
      pnlClosed,
      nOpen,
      nClosed,
      nTotal: rows.length,
      buyEvalN,
      buySuccessN,
      buyAccuracyPct: signalAcc.buy.valuePct,
      sellEvalN,
      sellSuccessN,
      sellAccuracyPct: signalAcc.sell.valuePct,
      sellFlatCount: signalAcc.unverifiedSellEvitaCount,
      overallEvalN: buyEvalN + sellEvalN,
      overallSuccessN: buySuccessN + sellSuccessN,
      overallAccuracyPct:
        buyEvalN + sellEvalN > 0
          ? Math.round((100 * (buySuccessN + sellSuccessN)) / (buyEvalN + sellEvalN) * 10) / 10
          : null,
    };
  }, [rows, closedRows, activePortfolio]);

  const openMtmEur = openPnlTotals.pnlEur;
  const combinedPnlEur = openMtmEur + kpis.pnlClosed;

  // Scatter: slope (pre_cd > latest) vs P&L%.
  //   - CD passed → we prefer pre_cd_slope_20d (offset T-1): "choice vs outcome"
  //   - Future CD → fallback to latest_slope_20d (most recent snapshot)
  const slopeVsPnlPoints = useMemo(() => {
    const out: {
      ticker: string;
      x: number;
      y: number;
      outcome?: string;
      pnlEur?: number | null;
    }[] = [];
    for (const r of closedRows) {
      const s20 = getEffectiveSlope20d(r);
      if (s20 == null) continue;
      const pnlPct = realizedPnlPctFromOutcome(r);
      if (pnlPct == null) continue;
      out.push({
        ticker: r.ticker,
        x: s20,
        y: pnlPct,
        outcome: r.outcome_label,
        pnlEur: realizedPnlEurFromOutcome(r),
      });
    }
    return out;
  }, [closedRows]);

  // Scatter: reliability at entry vs P&L% (closed positions only).
  const affVsPnlPoints = useMemo(() => {
    const out: {
      ticker: string;
      x: number;
      y: number;
      outcome?: string;
      pnlEur?: number | null;
    }[] = [];
    for (const r of closedRows) {
      const affRaw = r.entry_affidabilita_pct ?? r.affidabilita_pct;
      const aff =
        affRaw != null && Number.isFinite(affRaw)
          ? affRaw <= 1.5
            ? affRaw * 100
            : affRaw
          : null;
      const pnlPct = realizedPnlPctFromOutcome(r);
      if (aff == null || pnlPct == null) continue;
      out.push({
        ticker: r.ticker,
        x: aff,
        y: pnlPct,
        outcome: r.outcome_label,
        pnlEur: r.exit_pnl_eur_at_event ?? r.pnl_eur,
      });
    }
    return out;
  }, [closedRows]);

  if (loading) {
    return <p className="text-sm text-ink-muted">Loading simulations…</p>;
  }

  const inputsUpdatedAt = investSimInputsUpdatedAtIso();

  const chunkLoadError = /dynamically imported module|failed to fetch.*investSim/i.test(
    error ?? "",
  );
  const friendlyChunkMsg =
    "Build UI non allineata (modulo JavaScript mancante). Chiudi SuperNova, poi rilancia scripts\\Avvia_Biotech_Desktop.bat per ricompilare desktop-ui/dist.";

  if (error && !rows.length) {
    const friendly = chunkLoadError ? friendlyChunkMsg : error;
    return (
      <div className="space-y-2">
        <p className="text-sm text-negative">{friendly}</p>
        <p className="text-xs text-ink-muted">
          Set <strong>Capital</strong> and <strong>Purchase €</strong> in Investment → Prediction sheet;
          the data syncs from <code className="text-[10px]">invest_sim_inputs.json</code>.
          Use <strong>Reload</strong> at the top to regenerate the analysis.
        </p>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="space-y-2 text-sm text-ink-muted">
        <p>No simulated positions found in the Simulation snapshot.</p>
        <p className="text-xs">
          Rows with capital &gt; 0 appear here. Check the Excel sheet and regenerate the snapshot.
        </p>
      </div>
    );
  }

  const totalPnlAccent: "up" | "down" | undefined =
    combinedPnlEur > 0 ? "up" : combinedPnlEur < 0 ? "down" : undefined;
  const ledgerTodayAccent: "up" | "down" | undefined =
    ledgerTodayPnl != null && ledgerTodayPnl > 0
      ? "up"
      : ledgerTodayPnl != null && ledgerTodayPnl < 0
        ? "down"
        : undefined;
  const pnlOpenAccent: "up" | "down" | undefined =
    openMtmEur > 0 ? "up" : openMtmEur < 0 ? "down" : undefined;
  const pnlClosedAccent: "up" | "down" | undefined =
    kpis.pnlClosed > 0 ? "up" : kpis.pnlClosed < 0 ? "down" : undefined;

  return (
    <div className="space-y-4">
      {error && rows.length > 0 ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
          {chunkLoadError ? friendlyChunkMsg : error}
          {chunkLoadError ? (
            <span className="block mt-1 text-amber-800/90">
              I KPI sotto sono dall&apos;ultimo snapshot salvato — non sono stati aggiornati.
            </span>
          ) : null}
        </p>
      ) : null}
      {doc?.trade_calibration?.calibration_reliable ? (
        <p className="text-[10px] text-emerald-400/90 border border-emerald-500/25 rounded-lg px-2.5 py-1.5 bg-emerald-500/[0.06]">
          {t("simOutcomes.tradeCalib", {
            buy: doc.trade_calibration.thresholds?.buy_slope20d_min_pp_per_day?.value ?? 0.1,
            sell: doc.trade_calibration.thresholds?.sell_slope20d_max_pp_per_day?.value ?? -0.3,
          })}
          {doc.trade_calibration.n_positions != null
            ? t("simOutcomes.tradeCalibPositions", { n: doc.trade_calibration.n_positions })
            : ""}
          {t("simOutcomes.tradeCalibHint")}
        </p>
      ) : null}
      <p className="text-[10px] text-[rgb(var(--accent))]/75 leading-snug border-l-2 border-[rgb(var(--accent))]/30 pl-2">
        {t("simOutcomes.slopeHarmonyNote")}
      </p>
      <p className="text-[10px] text-ink-muted/85 border border-dashed border-[rgb(var(--border))]/50 rounded-md px-2.5 py-1.5">
        {t("simOutcomes.syncNote")}
      </p>
      <p className="text-xs text-ink-muted">
        <strong>Your</strong> investment decisions — tracking of committed/divested capital,
        gain/loss, and correlation with curve slope and prediction reliability.
        {source ? ` · ${source}` : ""}
        {doc?.generated_at ? (
          <span className="block mt-0.5">
            Analysis rebuilt: <strong>{fmtGeneratedAt(doc.generated_at)}</strong>
            {inputsUpdatedAt ? (
              <>
                {" · portfolio inputs: "}
                <strong>{fmtGeneratedAt(inputsUpdatedAt)}</strong>
              </>
            ) : null}
            {" · "}
            <code className="text-[10px]">invest_sim_inputs.json</code>
            {" ← Investment tab (localStorage)"}
          </span>
        ) : null}
      </p>
      <PortfolioTrendLegend />

      <div className="flex flex-wrap gap-1.5">
        <SelectionChip
          active={portfolioSubTab === "tracking"}
          onClick={() => setPortfolioSubTab("tracking")}
        >
          {t("simOutcomes.subTab.tracking")}
        </SelectionChip>
        <SelectionChip
          active={portfolioSubTab === "planProb"}
          onClick={() => setPortfolioSubTab("planProb")}
        >
          {t("simOutcomes.subTab.planProb")}
        </SelectionChip>
      </div>

      {portfolioSubTab === "planProb" ? (
        <PlanProbLearningPanel rows={rows} simRowByKey={simRowByKey} />
      ) : (
        <>
      {/* ── Essential KPIs ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <KpiCard
          label={t("simOutcomes.kpi.totalDecisions")}
          value={String(kpis.nTotal)}
          sub={`${kpis.nOpen} open · ${kpis.nClosed} closed`}
        />
        <KpiCard
          label={t("simOutcomes.kpi.committed")}
          value={fmtUsd(kpis.capitalOpen)}
          sub={t("simOutcomes.kpi.committedSub")}
        />
        <KpiCard
          label={t("simOutcomes.kpi.mtm")}
          value={fmtUsd(openMtmEur)}
          accent={pnlOpenAccent}
          sub={t("simOutcomes.kpi.mtmSub")}
        />
        <KpiCard
          label={t("simOutcomes.kpi.realized")}
          value={fmtUsd(kpis.pnlClosed)}
          accent={pnlClosedAccent}
          sub={t("simOutcomes.kpi.realizedSub")}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <KpiCard
          label={t("simOutcomes.kpi.todayLedger")}
          value={ledgerTodayPnl != null ? fmtUsd(ledgerTodayPnl) : "—"}
          accent={ledgerTodayAccent}
          sub={t("simOutcomes.kpi.todayLedgerSub")}
        />
        <KpiCard
          label={t("simOutcomes.kpi.combinedPnl")}
          value={fmtUsd(combinedPnlEur)}
          accent={totalPnlAccent}
          sub={t("simOutcomes.kpi.combinedPnlSub")}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <KpiCard
          label={t("simOutcomes.kpi.buyAccuracy")}
          value={kpis.buyAccuracyPct == null ? "n/a" : `${kpis.buyAccuracyPct.toFixed(1)}%`}
          accent={
            kpis.buyAccuracyPct == null ? undefined :
            kpis.buyAccuracyPct >= 60 ? "up" :
            kpis.buyAccuracyPct < 45 ? "down" : "warn"
          }
          sub={
            kpis.buyEvalN
              ? t("simOutcomes.kpi.successSub", {
                  success: kpis.buySuccessN,
                  total: kpis.buyEvalN,
                })
              : t("simOutcomes.kpi.noEval")
          }
        />
        <KpiCard
          label={t("simOutcomes.kpi.sellAccuracy")}
          value={kpis.sellAccuracyPct == null ? "n/a" : `${kpis.sellAccuracyPct.toFixed(1)}%`}
          accent={
            kpis.sellAccuracyPct == null ? undefined :
            kpis.sellAccuracyPct >= 60 ? "up" :
            kpis.sellAccuracyPct < 45 ? "down" : "warn"
          }
          sub={
            kpis.sellEvalN
              ? t("simOutcomes.kpi.successSub", {
                  success: kpis.sellSuccessN,
                  total: kpis.sellEvalN,
                })
              : t("simOutcomes.kpi.noEval")
          }
        />
      </div>
      <div className="grid grid-cols-1 gap-2">
        <KpiCard
          label={t("simOutcomes.kpi.signalQa")}
          value={kpis.overallAccuracyPct == null ? "n/a" : `${kpis.overallAccuracyPct.toFixed(1)}%`}
          accent={
            kpis.overallAccuracyPct == null ? undefined :
            kpis.overallAccuracyPct >= 60 ? "up" :
            kpis.overallAccuracyPct < 45 ? "down" : "warn"
          }
          sub={
            kpis.overallEvalN
              ? t("simOutcomes.kpi.successSub", {
                  success: kpis.overallSuccessN,
                  total: kpis.overallEvalN,
                })
              : t("simOutcomes.kpi.noEval")
          }
        />
      </div>
      {combinedPnlEur !== 0 && (
        <div className="rounded-md border border-[rgb(var(--border))]/40 bg-surface/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-ink-muted">
            {t("simOutcomes.kpi.overallTotal")}
          </p>
          <p className={`text-2xl font-bold tabular-nums ${
            totalPnlAccent === "up" ? "text-[rgb(var(--signal-up))]" :
            totalPnlAccent === "down" ? "text-[rgb(var(--signal-down))]" : ""
          }`}>
            {fmtUsd(combinedPnlEur)}
          </p>
          <p className="text-[10px] text-ink-muted">
            {t("simOutcomes.kpi.overallSub", { n: kpis.nTotal })}
          </p>
        </div>
      )}

      {/* ── P&L alignment (dettaglio giornaliero solo in Simulation → P&L) ─── */}
      <div className="rounded-lg border border-[rgb(var(--border))]/50 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <DailyLedgerIcon className="h-4 w-4 opacity-80 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[11px] text-ink-muted leading-snug">
              {t("simOutcomes.pnlAlign.hint")}
            </p>
            <p className="text-xs tabular-nums mt-1">
              <span className="text-ink-muted">{t("simOutcomes.kpi.mtm")}: </span>
              <span className={pnlOpenAccent === "up" ? "text-[rgb(var(--signal-up))]" : pnlOpenAccent === "down" ? "text-[rgb(var(--signal-down))]" : ""}>
                {fmtUsd(openMtmEur)}
              </span>
              <span className="text-ink-muted mx-2">·</span>
              <span className="text-ink-muted">{t("simOutcomes.kpi.todayLedger")}: </span>
              <span className={ledgerTodayAccent === "up" ? "text-[rgb(var(--signal-up))]" : ledgerTodayAccent === "down" ? "text-[rgb(var(--signal-down))]" : ""}>
                {ledgerTodayPnl != null ? fmtUsd(ledgerTodayPnl) : "—"}
              </span>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onOpenSimulationPnl ? (
            <button
              type="button"
              onClick={onOpenSimulationPnl}
              className="text-[11px] font-medium text-accent hover:underline"
            >
              {t("simOutcomes.pnlAlign.openPnlTab")}
            </button>
          ) : null}
          {onOpenDailyPnlLedger ? (
            <button
              type="button"
              onClick={onOpenDailyPnlLedger}
              className="rounded-md border border-[rgb(var(--border))]/60 px-2.5 py-1 text-[11px] font-medium hover:bg-surface/60 transition"
            >
              {t("simOutcomes.pnlAlign.openDailyDetail")}
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Open positions — when to exit ──────────────────────────────────── */}
      <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 space-y-2">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold">{t("simOutcomes.open.title")}</h3>
            <p className="text-[10px] text-ink-muted leading-tight">
              {t("simOutcomes.open.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {portfolioLossCount > 0 ? (
              <span className="text-[10px] font-semibold text-[rgb(var(--signal-down))] tabular-nums">
                {t("simOutcomes.open.lossCount", { n: portfolioLossCount })}
              </span>
            ) : null}
            <span className="text-[10px] text-ink-muted tabular-nums">
              {kpis.nOpen === 1
                ? t("simOutcomes.open.count", { n: kpis.nOpen })
                : t("simOutcomes.open.countPlural", { n: kpis.nOpen })}
            </span>
            {onOpenSimulationPnl ? (
              <button
                type="button"
                onClick={onOpenSimulationPnl}
                className="text-[10px] font-semibold text-accent hover:text-accent/80 underline underline-offset-2 transition"
              >
                {t("simOutcomes.open.openPnlTab")}
              </button>
            ) : null}
          </div>
        </div>
        <OpenPositionsExitPanel
          activePositions={activePortfolio}
          outcomeByKey={outcomeByKey}
          simRowByKey={simRowByKey}
          inputs={inputs}
          portfolioHistory={portfolioHistory}
          onOpenPredictionCharts={onOpenPredictionCharts}
        />
      </div>

      {/* ── Closed positions: scatter (no duplicate table) ─────────────────── */}
      <div className="rounded-lg border border-[rgb(var(--border))]/50 p-3 space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-sm font-semibold">{t("simOutcomes.closed.title")}</h3>
            <p className="text-[10px] text-ink-muted leading-tight">
              {t("simOutcomes.closed.subtitle")}
              {closedRows.length < kpis.nClosed
                ? t("simOutcomes.closed.deduped", {
                    unique: closedRows.length,
                    total: kpis.nClosed,
                  })
                : ""}
            </p>
          </div>
          <span className="text-[10px] text-ink-muted">
            {closedRows.length}{" "}
            {closedRows.length === 1 ? "position" : "positions"}
          </span>
        </div>
        {closedRows.length === 0 ? (
          <p className="text-xs text-ink-muted py-4 text-center">
            {t("simOutcomes.closed.empty")}
          </p>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            <CorrelationPanel
              title={t("simOutcomes.chart.slopeTitle")}
              subtitle={t("simOutcomes.chart.slopeSub")}
              pts={slopeVsPnlPoints}
              xLabel="Slope 20d"
              xUnit="pp/d"
              xKeyHint="slope available (histlib)"
            />
            <CorrelationPanel
              title={t("simOutcomes.chart.affTitle")}
              subtitle={t("simOutcomes.chart.affSub")}
              pts={affVsPnlPoints}
              xLabel="Reliability"
              xUnit="%"
              xKeyHint="reliability available"
            />
          </div>
        )}
      </div>

      {/* ── Slope sources explanation ──────────────────────────────────────── */}
      <details className="rounded-lg border border-[rgb(var(--border))]/40 bg-surface/20">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-ink-muted/80 hover:text-ink">
          ℹ How the slope is calculated (data sources, in order of priority)
        </summary>
        <div className="px-3 pb-3 pt-1 text-[11px] text-ink-muted/85 leading-snug space-y-1.5">
          <p>
            The slope is determined with priority in 3 levels (the <em>Slope</em> column in the
            "When to exit" table shows the source below the value):
          </p>
          <ol className="list-decimal pl-4 space-y-0.5">
            <li>
              <strong>entry log</strong> (preferred): REAL snapshot recorded at the exact moment you opened
              the position, from{" "}
              <code className="text-[10px]">data/investment_decision_log.json</code>. It is the most
              genuine data — it is what you saw on the curve when you decided to invest. Persists between refreshes.
              If the <em>retroactive</em> tag appears, it means the position was already open at the first run after
              log activation: the slope is the best available proxy but is not the true entry.
            </li>
            <li>
              <strong>pre-CD</strong> (historical fallback): slope at T-1 offset (or T-3, T-5…) of{" "}
              <strong>THIS position&apos;s CD</strong> from{" "}
              <code className="text-[10px]">model_historical_input_library.json</code>. Used for closed
              positions that do not have a decision log.
            </li>
            <li>
              <strong>latest</strong> (last resort): most recent ticker snapshot, any CD/offset. Used
              when neither entry log nor pre-CD are available.
            </li>
          </ol>
          <p className="pt-1">
            The decision log records <strong>automatically</strong> entry+exit at every refresh:
            you don&apos;t need to do anything. Every time you open/close a position (capital 0 → &gt; 0 or vice versa
            in the Simulation sheet), the next refresh records a persistent
            snapshot with timestamp, slope, pred, reliability and R² of the moment.
          </p>
        </div>
      </details>
        </>
      )}
    </div>
  );
}
