import {
  type PortfolioGainChartRow,
} from "../components/PortfolioGainPlanChart";
import type { ChartPoint, SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { buildSimRowByKeyMap } from "./investSimKeys";
import {
  alignAggregateGainPlanSeriesToLiveGap,
  buildPortfolioGainPlanAggregateSeries,
  PULSE_GAIN_CHART_HOLD_DAYS,
  planGapForRow,
  summarizePlanGap,
  type AggregateGainPlanPoint,
  type PlanGapSummary,
} from "./dashboardPulseAggregate";
import type { PulseDirection } from "./dashboardPulseView";
import { resolvePulseTableTrendDirection } from "./dashboardPulseView";
import { portfolioPnlDeltaLooksLikeStaleBaseline } from "./piggyBankTrend";
import {
  holdingDaysFromInvestedAt,
  type InvestSimHistoryPoint,
  type InvestSimInputs,
} from "./investSimStorage";
import type {
  DecisionSimState,
  DecisionSimTick,
  PaperPosition,
  TickerSimEvaluation,
} from "./investDecisionSimLoop";
import { resolveExpectedGainPlan } from "./simulationPlanGain";
import { summarizePortfolioWinRate } from "./portfolioGainLossStyle";
import {
  dailyChangePctFromRow,
  pnlEurFromDailyPct,
  positionCapitalPnlPct,
  positionPnlForOpenRow,
} from "./simulationPosition";
import { sanitizePaperMovePct } from "./investDecisionSimExperiment";
import { resolveTickClosedPnlEur } from "./decisionSimPnlResolve";
import { looksLikeOpenMtmCatchUpCliff } from "./decisionSimPnlResolve";
import {
  buildCausalSimLoopShareWalk,
  causalOptsFromSizing,
  causalShareForSell,
  rebalanceCausalSimLoopShares,
  shareToSynthCap,
} from "./simLoopCausalSynth";

export type SimLoopPulsePortfolioRow = {
  key: string;
  ticker: string;
  completionDate: string;
  direction: PulseDirection;
  pnlEur: number;
  pnlPct: number | null;
  pnlEur24h: number | null;
  pnlPct24h: number | null;
  deltaPnlEurSinceVisit: number | null;
  gainPlanRow: PortfolioGainChartRow;
  planGap: PlanGapSummary;
};

export type SimLoopPulseTotals = {
  /** Total P&L (closed + open) — chart / visit snapshot. */
  pnlEur: number;
  pnlPct: number | null;
  pnlEurToday: number | null;
  todayCovered: number;
  capital: number;
  /** Open positions MTM only — same basis as Portfolio pulse · Gain open. */
  openPnlEur: number;
  openPnlPct: number | null;
  /** Realized P&L from paper SELL trades (same basis as Loss Rescue · Sim Loop BUY). */
  closedPnlEur: number;
  closedDealCount: number;
};

export type SimLoopPulseData = {
  hasPriorVisit: boolean;
  priorVisitAt: string | null;
  totals: SimLoopPulseTotals;
  /** Equal-weight paper reference when synth sizing is active (same trades, €5k slots). */
  equalReferenceTotals?: SimLoopPulseTotals | null;
  deltaPnlSinceVisit: number | null;
  winRate: ReturnType<typeof summarizePortfolioWinRate>;
  rows: SimLoopPulsePortfolioRow[];
  aggregateGainPlanSeries: AggregateGainPlanPoint[];
  planGap: PlanGapSummary;
  history: InvestSimHistoryPoint[];
};

export type SimLoopPulseVariant = "equal" | "synth";

export type SimLoopPulseSizing = {
  shareByRowKey: Record<string, number>;
  totalCapitalEur: number;
  capitalPerTrade: number;
  targetGainEur?: number;
  /** causal_rebalance = after marks; static_approved = frozen weights at entry. */
  sizingMode?: "causal_rebalance" | "static_approved";
};

const SIM_LOOP_VISIT_KEYS: Record<SimLoopPulseVariant, string> = {
  equal: "dashboard.simLoopPulse.lastVisit.v1",
  synth: "dashboard.simLoopSynthPulse.lastVisit.v1",
};

const SIM_LOOP_ENTRY_SHARE_KEY = "dashboard.simLoopSynth.entryShare.v1";

export function loadSimLoopEntryShares(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SIM_LOOP_ENTRY_SHARE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveSimLoopEntryShares(shares: Record<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIM_LOOP_ENTRY_SHARE_KEY, JSON.stringify(shares));
  } catch {
    /* swallow quota / privacy-mode errors */
  }
}

/** Snapshot Weight Sim Exp share when a row first appears in the paper book (for closed-trade scaling). */
export function syncSimLoopEntryShares(
  openKeys: string[],
  shareByRowKey: Record<string, number>,
): Record<string, number> {
  const stored = loadSimLoopEntryShares();
  let changed = false;
  const next = { ...stored };
  for (const key of openKeys) {
    const share = shareByRowKey[key];
    if (
      next[key] == null &&
      typeof share === "number" &&
      Number.isFinite(share) &&
      share >= 0
    ) {
      next[key] = share;
      changed = true;
    }
  }
  if (changed) saveSimLoopEntryShares(next);
  return next;
}

function finitePnl(v: number | null | undefined, fallback = 0): number {
  return v != null && Number.isFinite(v) ? v : fallback;
}

function pnlEurFromMovePct(capital: number, movePct: number | null | undefined): number {
  if (capital <= 0 || movePct == null || !Number.isFinite(movePct)) return 0;
  return Math.round(((capital * movePct) / 100) * 100) / 100;
}

function roundPnlEur(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Scale € P&L between capital sizes; % stays on invested capital (unchanged). */
function scaleOpenPnlToCap(
  pnlEur: number | null,
  pnlPct: number | null,
  pnlEur24h: number | null,
  pnlPct24h: number | null,
  fromCap: number,
  toCap: number,
): {
  pnlEur: number;
  pnlPct: number | null;
  pnlEur24h: number | null;
  pnlPct24h: number | null;
} {
  if (toCap <= 0) {
    return { pnlEur: 0, pnlPct, pnlEur24h: null, pnlPct24h };
  }
  if (fromCap <= 0) {
    const pct = pnlPct ?? 0;
    return {
      pnlEur: pnlEurFromMovePct(toCap, pct),
      pnlPct,
      pnlEur24h: pnlPct24h != null ? pnlEurFromMovePct(toCap, pnlPct24h) : null,
      pnlPct24h,
    };
  }
  const ratio = toCap / fromCap;
  return {
    pnlEur: roundPnlEur((pnlEur ?? 0) * ratio),
    pnlPct,
    pnlEur24h: pnlEur24h != null ? roundPnlEur(pnlEur24h * ratio) : null,
    pnlPct24h,
  };
}

/**
 * Sim loop open P&L — same audit-aligned engine as Portfolio pulse,
 * scaled to equal-weight or synth effective capital.
 */
export function resolveSimLoopAlignedOpenPnl(
  simRow: Record<string, unknown>,
  key: string,
  inputs: InvestSimInputs | undefined,
  portfolioHistory: InvestSimHistoryPoint[] | null | undefined,
  effectiveCap: number,
  entryAt: string | null | undefined,
  paperFallbackPct: number | null | undefined,
): {
  pnlEur: number;
  pnlPct: number | null;
  pnlEur24h: number | null;
  pnlPct24h: number | null;
} {
  const inp = inputs?.[key];
  const portfolioCap = inp?.capital && inp.capital > 0 ? inp.capital : 0;

  if (inputs && portfolioCap > 0 && !inp?.ignoreSheet) {
    const m = positionPnlForOpenRow(simRow, inputs, portfolioHistory);
    if (m.pnlEur != null && m.pos && m.pos.capital > 0) {
      return scaleOpenPnlToCap(
        m.pnlEur,
        m.pnlPct,
        m.pnlEur24h,
        m.pnlPct24h,
        m.pos.capital,
        effectiveCap,
      );
    }
  }

  if (inputs && effectiveCap > 0) {
    const synthInputs: InvestSimInputs = {
      ...inputs,
      [key]: {
        buyPrice: inp?.buyPrice ?? 0,
        capital: effectiveCap,
        ignoreSheet: false,
        investedAt: entryAt ?? inp?.investedAt,
        purchaseDate: inp?.purchaseDate,
      },
    };
    const m = positionPnlForOpenRow(simRow, synthInputs, portfolioHistory);
    if (m.pnlEur != null) {
      return {
        pnlEur: m.pnlEur,
        pnlPct: m.pnlPct,
        pnlEur24h: m.pnlEur24h,
        pnlPct24h: m.pnlPct24h,
      };
    }
  }

  const sanitized = sanitizePaperMovePct(paperFallbackPct);
  const pnlEur = sanitized != null ? pnlEurFromMovePct(effectiveCap, sanitized) : 0;
  return {
    pnlEur,
    pnlPct: positionCapitalPnlPct(pnlEur, effectiveCap) ?? sanitized,
    pnlEur24h: null,
    pnlPct24h: null,
  };
}

function alignRowPlanGap(
  row: PortfolioGainChartRow,
  history: InvestSimHistoryPoint[],
): PlanGapSummary {
  const gap = planGapForRow(row, history);
  if (gap.gapEur == null || row.capital <= 0) return gap;
  return {
    ...gap,
    gapPct: Math.round((gap.gapEur / row.capital) * 10000) / 100,
  };
}

function synthCapForClosedTrade(
  equalCap: number,
  sizing: SimLoopPulseSizing,
  share: number | null,
): number {
  return shareToSynthCap(share, sizing.totalCapitalEur, equalCap);
}

function synthCapForOpenPosition(
  rowKey: string,
  equalCap: number,
  sizing: SimLoopPulseSizing,
  activeShares: Record<string, number>,
): number {
  return shareToSynthCap(activeShares[rowKey], sizing.totalCapitalEur, equalCap);
}

function resolveEffectiveCap(
  rowKey: string,
  equalCap: number,
  sizing: SimLoopPulseSizing | null | undefined,
  activeShares: Record<string, number> = {},
): number {
  if (!sizing || equalCap <= 0) return equalCap;
  return synthCapForOpenPosition(rowKey, equalCap, sizing, activeShares);
}

export type SimLoopVisitSnapshot = {
  savedAt: string;
  totalPnlEur: number;
  tickers: Record<string, { pnlEur: number }>;
};

export function loadSimLoopVisitSnapshot(
  variant: SimLoopPulseVariant = "equal",
): SimLoopVisitSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SIM_LOOP_VISIT_KEYS[variant]);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SimLoopVisitSnapshot;
    if (!parsed?.savedAt || typeof parsed.totalPnlEur !== "number" || !parsed.tickers) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSimLoopVisitSnapshot(
  snapshot: SimLoopVisitSnapshot,
  variant: SimLoopPulseVariant = "equal",
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIM_LOOP_VISIT_KEYS[variant], JSON.stringify(snapshot));
  } catch {
    /* swallow quota / privacy-mode errors */
  }
}

export function clearSimLoopVisitSnapshot(variant: SimLoopPulseVariant = "equal"): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SIM_LOOP_VISIT_KEYS[variant]);
  } catch {
    /* non-fatal */
  }
}

export function resolveEffectiveSimLoopVisitSnapshot(
  priorSnapshot: SimLoopVisitSnapshot | null | undefined,
  totals: SimLoopPulseTotals,
): SimLoopVisitSnapshot | null {
  if (!priorSnapshot) return null;
  if (
    portfolioPnlDeltaLooksLikeStaleBaseline(
      priorSnapshot.totalPnlEur,
      totals.pnlEur,
      totals.pnlEurToday ?? 0,
      totals.todayCovered,
    )
  ) {
    return null;
  }
  return priorSnapshot;
}

export function buildSimLoopVisitSnapshotFromData(
  data: Pick<SimLoopPulseData, "totals" | "rows">,
): SimLoopVisitSnapshot {
  return {
    savedAt: new Date().toISOString(),
    totalPnlEur: data.totals.pnlEur,
    tickers: Object.fromEntries(data.rows.map((r) => [r.key, { pnlEur: r.pnlEur }])),
  };
}

function resolveDirection(
  pnlEur24h: number | null,
  pnlPct24h: number | null,
  deltaPnlEur: number | null,
  hasPriorVisit: boolean,
): PulseDirection {
  return resolvePulseTableTrendDirection(
    pnlEur24h,
    pnlPct24h,
    deltaPnlEur,
    hasPriorVisit,
  );
}

function directionSortKey(d: PulseDirection): number {
  if (d === "up") return 0;
  if (d === "flat") return 1;
  return 2;
}

function fmtShortDateTime(iso: string, lang: "it" | "en"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "it" ? "it-IT" : "en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function resolveSimLoopClosedPnlEur(
  ticks: DecisionSimTick[],
  sizing?: SimLoopPulseSizing | null,
): number {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  const walk = sizing
    ? buildCausalSimLoopShareWalk(sorted, causalOptsFromSizing(sizing))
    : null;
  let cumRealized = 0;
  for (const tick of sorted) {
    for (const tr of tick.trades) {
      if (tr.side !== "sell" || tr.pnlEurSimulated == null) continue;
      let pnl = tr.pnlEurSimulated;
      if (sizing && walk) {
        const entryPos = tick.portfolioBefore?.find((p) => p.key === tr.key);
        const equalCap = tr.capital ?? entryPos?.capital ?? sizing.capitalPerTrade;
        if (equalCap > 0) {
          const share = causalShareForSell(walk, tick, tr);
          const synthCap = synthCapForClosedTrade(equalCap, sizing, share);
          pnl = Math.round(pnl * (synthCap / equalCap) * 100) / 100;
        }
      }
      cumRealized += pnl;
    }
  }
  return Math.round(cumRealized * 100) / 100;
}

function sanitizeSimLoopPulseHistoricalActual(
  actual: number | null,
  liveActual: number,
): number | null {
  if (actual == null || !Number.isFinite(actual)) return null;
  const absTol = Math.max(100, Math.abs(liveActual) * 0.35 + 60);
  if (liveActual >= 0 && actual < -absTol * 2) return null;
  if (liveActual <= 0 && actual > absTol * 2) return null;
  if (liveActual > 40 && actual < -500) return null;
  if (liveActual < -40 && actual > 500) return null;
  return actual;
}

function sanitizeSimLoopPulseActual(
  actual: number | null,
  liveActual: number,
): number | null {
  if (actual == null || !Number.isFinite(actual)) return null;
  const absTol = Math.max(100, Math.abs(liveActual) * 0.35 + 60);
  if (Math.abs(actual - liveActual) > absTol) return null;
  // Stale tick above live → chart looks like a crash when numbers actually rose.
  if (liveActual >= 0 && actual > liveActual + absTol * 0.55) return null;
  if (liveActual <= 0 && actual < liveActual - absTol * 0.55) return null;
  if (liveActual > 40 && actual < -40) return null;
  if (liveActual < -40 && actual > 40) return null;
  return actual;
}

function pruneLeadingSimLoopOutliers(
  points: AggregateGainPlanPoint[],
  liveTotalPnlEur: number,
): AggregateGainPlanPoint[] {
  const withActual = points.filter(
    (p) => p.actual != null && Number.isFinite(p.actual),
  ) as Array<AggregateGainPlanPoint & { actual: number }>;
  if (withActual.length < 2) return points;

  const absTol = Math.max(100, Math.abs(liveTotalPnlEur) * 0.35 + 60);
  let trimmed = [...points];
  while (trimmed.length >= 2) {
    const firstActual = trimmed.find(
      (p) => p.actual != null && Number.isFinite(p.actual),
    )?.actual;
    if (firstActual == null) break;
    const looksLikeFakeCrash =
      (firstActual > liveTotalPnlEur + absTol * 0.55 &&
        firstActual > liveTotalPnlEur * 1.35) ||
      (liveTotalPnlEur >= 0 &&
        firstActual < liveTotalPnlEur - absTol * 0.55 &&
        firstActual < -absTol) ||
      (liveTotalPnlEur <= 0 &&
        firstActual > liveTotalPnlEur + absTol * 0.55 &&
        firstActual > absTol);
    if (!looksLikeFakeCrash) break;
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

/** Flat plan reference — matches KPI `plannedNowEur`, not per-tick curve walk. */
function plannedReferenceEur(planGap: PlanGapSummary): number | null {
  return Number.isFinite(planGap.plannedNowEur) ? planGap.plannedNowEur : null;
}

/** Spread open-MTM catch-up across tick history instead of a vertical cliff at "now". */
function rampSimLoopHistoryToLive(
  history: InvestSimHistoryPoint[],
  liveTotalPnlEur: number,
  liveClosedPnlEur: number,
): InvestSimHistoryPoint[] {
  if (history.length < 2) return history;

  const prev = history[history.length - 2];
  const prevEnd = prev?.pnl ?? 0;
  const prevClosed =
    prev?.closedPnlEur != null && Number.isFinite(prev.closedPnlEur)
      ? prev.closedPnlEur
      : liveClosedPnlEur;
  if (
    !looksLikeOpenMtmCatchUpCliff(
      prevEnd,
      liveTotalPnlEur,
      prevClosed,
      liveClosedPnlEur,
    )
  ) {
    return history;
  }

  const openMtmLive = Math.round((liveTotalPnlEur - liveClosedPnlEur) * 100) / 100;
  const span = history.length - 1;

  return history.map((h, i) => {
    const cap = h.capital ?? 0;
    if (i === history.length - 1) {
      const pnl = Math.round(liveTotalPnlEur * 100) / 100;
      return {
        ...h,
        pnl,
        value: cap + pnl,
        pnlPct: cap > 0 ? Math.round((pnl / cap) * 10000) / 100 : h.pnlPct,
      };
    }
    const frac = span > 0 ? i / span : 1;
    const cumR =
      h.closedPnlEur != null && Number.isFinite(h.closedPnlEur)
        ? h.closedPnlEur
        : (h.pnl ?? 0);
    const openEst = Math.round(openMtmLive * frac * 100) / 100;
    const pnl = Math.round((cumR + openEst) * 100) / 100;
    return {
      ...h,
      pnl,
      value: cap + pnl,
      pnlPct: cap > 0 ? Math.round((pnl / cap) * 10000) / 100 : h.pnlPct,
    };
  });
}

/** Pulse chart window — hourly marks over ~8 hold-days (d0–d7), aligned with portfolio pulse. */
export const SIM_LOOP_PULSE_CHART_HOURS = PULSE_GAIN_CHART_HOLD_DAYS * 24;

function pulseHistoryHourKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}`;
}

function paperPortfolioOpenAt(
  portfolio: PaperPosition[],
  tsMs: number,
): PaperPosition[] {
  return portfolio.filter((p) => {
    const entry = Date.parse(p.entryAt);
    return Number.isFinite(entry) && entry <= tsMs;
  });
}

/** Hourly sim-loop P&L from invest-sim price snapshots (marks on paper book keys). */
export function buildSimLoopPulseHourlyHistory(
  portfolioHistory: InvestSimHistoryPoint[],
  ticks: DecisionSimTick[],
  paperPortfolio: PaperPosition[],
  sizing?: SimLoopPulseSizing | null,
  windowHours = SIM_LOOP_PULSE_CHART_HOURS,
): InvestSimHistoryPoint[] {
  if (!portfolioHistory.length || !paperPortfolio.length) return [];

  const nowMs = Date.now();
  const cutoff = nowMs - windowHours * 3600000;
  const sortedTicks = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  const walk = sizing
    ? buildCausalSimLoopShareWalk(sortedTicks, causalOptsFromSizing(sizing))
    : null;
  const hourly = portfolioHistory
    .filter((h) => {
      const ts = Date.parse(h.ts);
      return Number.isFinite(ts) && ts >= cutoff && ts <= nowMs + 60_000;
    })
    .sort((a, b) => a.ts.localeCompare(b.ts));

  if (!hourly.length) return [];

  const lastPctByKey = new Map<string, number>();
  const out: InvestSimHistoryPoint[] = [];

  for (const h of hourly) {
    const tsMs = Date.parse(h.ts);
    if (!Number.isFinite(tsMs)) continue;

    const ticksBefore = sortedTicks.filter((t) => Date.parse(t.at) <= tsMs);
    const closedPnlEur = resolveSimLoopClosedPnlEur(ticksBefore, sizing);
    const openPositions = paperPortfolioOpenAt(paperPortfolio, tsMs);
    const lastTickIdx = ticksBefore.length - 1;
    const openShares =
      walk && lastTickIdx >= 0 ? (walk.openSharesPerTick[lastTickIdx] ?? {}) : {};

    let openMtmTotal = 0;
    let totalCap = 0;
    const byTicker: InvestSimHistoryPoint["byTicker"] = {};

    for (const pos of openPositions) {
      const cap = resolveEffectiveCap(pos.key, pos.capital, sizing, openShares);
      if (cap <= 0) continue;
      const snap = h.byTicker?.[pos.key];
      let pnlEur: number | null = null;
      let movePct: number | null = null;
      if (snap != null && Number.isFinite(snap.pnl)) {
        const entryCap = snap.value - snap.pnl;
        pnlEur =
          entryCap > 0
            ? roundPnlEur(snap.pnl * (cap / entryCap))
            : roundPnlEur(snap.pnl);
        movePct = cap > 0 ? roundPnlEur((pnlEur / cap) * 10000) / 100 : null;
      }
      if (movePct == null) {
        movePct = snap != null ? sanitizePaperMovePct(snap.pnlPct) : null;
        if (movePct != null) {
          lastPctByKey.set(pos.key, movePct);
        } else {
          movePct =
            lastPctByKey.get(pos.key) ??
            sanitizePaperMovePct(pos.lastMarkPct) ??
            null;
        }
        if (movePct == null) continue;
        pnlEur = pnlEurFromMovePct(cap, movePct);
      } else if (movePct != null) {
        lastPctByKey.set(pos.key, movePct);
      }
      if (pnlEur == null || movePct == null) continue;
      byTicker[pos.key] = { value: cap + pnlEur, pnl: pnlEur, pnlPct: movePct };
      openMtmTotal += pnlEur;
      totalCap += cap;
    }

    const totalPnl = Math.round((closedPnlEur + openMtmTotal) * 100) / 100;
    out.push({
      ts: h.ts,
      capital: totalCap,
      value: totalCap + totalPnl,
      pnl: totalPnl,
      pnlPct: totalCap > 0 ? Math.round((totalPnl / totalCap) * 10000) / 100 : 0,
      closedPnlEur,
      byTicker,
    });
  }

  return out;
}

/** Prefer hourly marks in the pulse window; fall back to sim-loop ticks. */
export function mergeSimLoopPulseChartHistory(
  tickHistory: InvestSimHistoryPoint[],
  hourlyHistory: InvestSimHistoryPoint[],
  windowHours = SIM_LOOP_PULSE_CHART_HOURS,
): InvestSimHistoryPoint[] {
  const nowMs = Date.now();
  const cutoff = nowMs - windowHours * 3600000;
  const inWindow = (h: InvestSimHistoryPoint) => {
    const ts = Date.parse(h.ts);
    return Number.isFinite(ts) && ts >= cutoff && ts <= nowMs + 60_000;
  };

  const hourlyWin = hourlyHistory.filter(inWindow);
  if (hourlyWin.length >= 2) return hourlyWin;

  const byHour = new Map<string, InvestSimHistoryPoint>();
  const add = (h: InvestSimHistoryPoint) => {
    if (!inWindow(h)) return;
    const key = pulseHistoryHourKey(h.ts);
    const prev = byHour.get(key);
    if (!prev || h.ts > prev.ts) byHour.set(key, h);
  };
  for (const h of tickHistory) add(h);
  for (const h of hourlyHistory) add(h);
  const merged = [...byHour.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  if (merged.length >= 2) return merged;

  return tickHistory.filter(inWindow);
}

/** Sim loop pulse chart — plot tick `h.pnl` (realized + open MTM), not open-only byTicker sums. */
export function buildSimLoopPulseAggregateSeries(
  rows: PortfolioGainChartRow[],
  history: InvestSimHistoryPoint[],
  liveTotalPnlEur: number,
  planGap: PlanGapSummary,
  priorVisitAt: string | null,
  lang: "it" | "en" = "it",
): AggregateGainPlanPoint[] {
  if (!rows.length) return [];

  const liveGap: PlanGapSummary = {
    ...planGap,
    actualNowEur: Number.isFinite(liveTotalPnlEur) ? liveTotalPnlEur : planGap.actualNowEur,
  };

  const nowMs = Date.now();
  const cutoffMs = nowMs - SIM_LOOP_PULSE_CHART_HOURS * 3600000;
  let histFiltered = history.filter((h) => {
    const ts = Date.parse(h.ts);
    if (!Number.isFinite(ts) || ts > nowMs + 60_000) return false;
    return ts >= cutoffMs;
  });
  if (histFiltered.length < 2) {
    histFiltered = history.filter((h) => {
      const ts = Date.parse(h.ts);
      return Number.isFinite(ts) && ts <= nowMs + 60_000;
    });
  }
  if (histFiltered.length < 2 && history.length >= 2) {
    histFiltered = history.slice(-Math.min(history.length, 24));
  }

  const rawPoints: AggregateGainPlanPoint[] = histFiltered.map((h, idx) => {
    const actualRaw =
      Number.isFinite(h.pnl) && Math.abs(h.pnl) <= 500_000
        ? Math.round(h.pnl * 100) / 100
        : null;
    const plannedRef = plannedReferenceEur(liveGap);
    const isTerminal = idx === histFiltered.length - 1;
    const actual =
      actualRaw == null
        ? null
        : isTerminal
          ? sanitizeSimLoopPulseActual(actualRaw, liveTotalPnlEur)
          : sanitizeSimLoopPulseHistoricalActual(actualRaw, liveTotalPnlEur);
    return {
      ts: h.ts,
      label: fmtShortDateTime(h.ts, lang),
      planned: plannedRef,
      actual,
    };
  });

  let points = rawPoints.filter((p) => p.actual != null || p.planned != null);
  points = pruneLeadingSimLoopOutliers(points, liveTotalPnlEur);
  const validActualCount = points.filter((p) => p.actual != null).length;

  if (validActualCount < 2 && histFiltered.length < 2) {
    const visitMsForBaseline = priorVisitAt ? Date.parse(priorVisitAt) : NaN;
    const visitActualRaw =
      priorVisitAt && Number.isFinite(visitMsForBaseline)
        ? [...rawPoints]
            .filter((p) => Date.parse(p.ts) <= visitMsForBaseline)
            .reverse()
            .find((p) => p.actual != null && Number.isFinite(p.actual))?.actual
        : null;
    const visitTol = Math.max(100, Math.abs(liveTotalPnlEur) * 0.35 + 60);
    const visitActual =
      visitActualRaw != null &&
      Math.abs(visitActualRaw - liveTotalPnlEur) <= visitTol
        ? visitActualRaw
        : null;
    const baseline =
      visitActual != null && Number.isFinite(visitActual)
        ? visitActual
        : points.find((p) => p.actual != null)?.actual ?? liveTotalPnlEur;
    points = [
      {
        ts: priorVisitAt ?? histFiltered[0]?.ts ?? new Date().toISOString(),
        label: priorVisitAt
          ? fmtShortDateTime(priorVisitAt, lang)
          : lang === "it"
            ? "inizio"
            : "start",
        planned: liveGap.plannedNowEur,
        actual: baseline,
      },
      {
        ts: histFiltered[histFiltered.length - 1]?.ts ?? new Date().toISOString(),
        label: lang === "it" ? "ora" : "now",
        planned: liveGap.plannedNowEur,
        actual: liveTotalPnlEur,
      },
    ];
  }

  return alignAggregateGainPlanSeriesToLiveGap(points, liveGap, lang);
}

/** 24h — evaluation tick first, then Simulation row Var. Giorn. % (same as portfolio pulse). */
function resolveSimLoopDailyPnl(
  pos: PaperPosition,
  simRow: Record<string, unknown>,
  ev: TickerSimEvaluation | undefined,
  pnlEur: number,
): { pnlPct24h: number | null; pnlEur24h: number | null } {
  const fromEval = ev?.pnlPct24h;
  if (fromEval != null && Number.isFinite(fromEval)) {
    return {
      pnlPct24h: fromEval,
      pnlEur24h: Math.round(((pos.capital * fromEval) / 100) * 100) / 100,
    };
  }

  const dailyPct = dailyChangePctFromRow(simRow);
  if (dailyPct == null || !Number.isFinite(dailyPct) || pos.capital <= 0) {
    return { pnlPct24h: null, pnlEur24h: null };
  }

  const pnlPct24h = Math.round(dailyPct * 100) / 100;
  const valueNow = pos.capital + (Number.isFinite(pnlEur) ? pnlEur : 0);
  const pnlEur24h =
    valueNow > 0
      ? pnlEurFromDailyPct(valueNow, dailyPct)
      : Math.round(((pos.capital * pnlPct24h) / 100) * 100) / 100;
  return { pnlPct24h, pnlEur24h };
}

/** P&L € at or before visit time from sim-loop tick history (fallback when snapshot row missing). */
function priorTickerPnlAtVisit(
  history: InvestSimHistoryPoint[],
  key: string,
  visitAtIso: string | null | undefined,
): number | null {
  if (!history.length || !key || !visitAtIso?.trim()) return null;
  const visitMs = new Date(visitAtIso).getTime();
  if (!Number.isFinite(visitMs)) return null;

  let priorPnl: number | null = null;
  for (const h of history) {
    const t = new Date(h.ts).getTime();
    if (!Number.isFinite(t) || t > visitMs) continue;
    const snap = h.byTicker?.[key];
    if (!snap || !Number.isFinite(snap.pnl)) continue;
    priorPnl = snap.pnl;
  }
  return priorPnl;
}

function resolveSimLoopDeltaSinceVisit(
  key: string,
  pnlEur: number,
  priorSnapshot: {
    savedAt: string;
    tickers: Record<string, { pnlEur: number }>;
  } | null | undefined,
  history: InvestSimHistoryPoint[],
): number | null {
  if (!priorSnapshot) return null;
  const snap = priorSnapshot.tickers[key];
  const priorPnlEur =
    snap != null
      ? snap.pnlEur
      : priorTickerPnlAtVisit(history, key, priorSnapshot.savedAt);
  if (priorPnlEur == null || !Number.isFinite(priorPnlEur)) return null;
  return Math.round((pnlEur - priorPnlEur) * 100) / 100;
}

function buildSimLoopGainPlanRowFromPaper(
  pos: PaperPosition,
  simRow: Record<string, unknown>,
  ev: TickerSimEvaluation | undefined,
  chartPoints: ChartPoint[] | null,
  capitalEur?: number,
): PortfolioGainChartRow | null {
  const capital = capitalEur ?? pos.capital;
  if (capital <= 0) return null;
  const pnlPct = ev?.pnlPct ?? pos.lastMarkPct ?? null;
  const sanitizedPct = sanitizePaperMovePct(pnlPct);
  const pnlEur = sanitizedPct != null ? pnlEurFromMovePct(capital, sanitizedPct) : null;
  const investedAt = pos.entryAt?.trim() || null;
  const holdDaysElapsed = investedAt ? holdingDaysFromInvestedAt(investedAt) : null;
  const gainPlan = resolveExpectedGainPlan(simRow, capital, {
    chartPoints: chartPoints ?? null,
  });
  const ticker = pos.ticker.trim().toUpperCase();
  const cd = String(simRow["Completion Date"] ?? "—");
  const priceRaw = simRow["Current Price"] ?? simRow.Price;
  const currentPriceUsd =
    priceRaw != null && Number.isFinite(Number(priceRaw)) ? Number(priceRaw) : null;
  return {
    key: pos.key,
    name: cd !== "—" ? `${ticker} · ${cd}` : ticker,
    ticker,
    pnlEur,
    pnlUnavailable: pnlPct == null,
    investedAt,
    expectedHoldDays: gainPlan.daysToCd,
    daysToTarget: gainPlan.daysToTarget ?? null,
    expectedGainEur: gainPlan.expectedGainEur,
    expectedGainPct: gainPlan.expectedReturnPct,
    targetGainPct: gainPlan.targetReturnPct,
    holdDaysElapsed,
    capital,
    currentPriceUsd,
    buyPriceUsd: null,
    simRow,
    chartPoints: chartPoints ?? null,
  };
}

/** Reconstruct portfolio-level history from sim-loop ticks for the aggregate chart. */
export function buildSimLoopHistoryFromTicks(
  ticks: DecisionSimTick[],
  sizing?: SimLoopPulseSizing | null,
): InvestSimHistoryPoint[] {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  const walk = sizing
    ? buildCausalSimLoopShareWalk(sorted, causalOptsFromSizing(sizing))
    : null;
  let cumRealized = 0;
  const out: InvestSimHistoryPoint[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const tick = sorted[i]!;
    for (const tr of tick.trades) {
      if (tr.side !== "sell" || tr.pnlEurSimulated == null) continue;
      let pnl = tr.pnlEurSimulated;
      if (sizing && walk) {
        const entryPos = tick.portfolioBefore?.find((p) => p.key === tr.key);
        const equalCap = tr.capital ?? entryPos?.capital ?? sizing.capitalPerTrade;
        if (equalCap > 0) {
          const share = causalShareForSell(walk, tick, tr);
          const synthCap = synthCapForClosedTrade(equalCap, sizing, share);
          pnl = Math.round(pnl * (synthCap / equalCap) * 100) / 100;
        }
      }
      cumRealized += pnl;
    }
    cumRealized = Math.round(cumRealized * 100) / 100;

    const positions = tick.portfolioAfter ?? [];
    const piggy = tick.summary.piggyBank;
    const evalByKey = new Map(tick.evaluations.map((e) => [e.key, e]));
    const openShares = walk?.openSharesPerTick[i] ?? {};
    const byTicker: InvestSimHistoryPoint["byTicker"] = {};
    let totalCap = 0;
    let openMtmTotal = 0;
    for (const pos of positions) {
      const equalCap = Number.isFinite(pos.capital) ? pos.capital : 0;
      const cap =
        sizing && equalCap > 0
          ? synthCapForOpenPosition(pos.key, equalCap, sizing, openShares)
          : equalCap;
      const ev = evalByKey.get(pos.key);
      const movePct =
        sanitizePaperMovePct(ev?.pnlPct) ??
        sanitizePaperMovePct(pos.lastMarkPct) ??
        0;
      const pnlEur = pnlEurFromMovePct(cap, movePct);
      byTicker[pos.key] = { value: cap + pnlEur, pnl: pnlEur, pnlPct: movePct };
      totalCap += cap;
      openMtmTotal += pnlEur;
    }

    const preferPiggyOpenMtm =
      positions.length > 0 &&
      piggy != null &&
      Number.isFinite(piggy.openMtmPnlEur) &&
      Math.abs(piggy.openMtmPnlEur ?? 0) > 0 &&
      (tick.evaluations.length === 0 ||
        Math.abs(openMtmTotal) < 0.01);
    if (preferPiggyOpenMtm) {
      const equalOpenCap = positions.reduce((s, p) => s + (p.capital > 0 ? p.capital : 0), 0);
      const scale =
        sizing && equalOpenCap > 0 && totalCap > 0 ? totalCap / equalOpenCap : 1;
      openMtmTotal = Math.round((piggy.openMtmPnlEur ?? 0) * scale * 100) / 100;
      for (const pos of positions) {
        const equalCap = Number.isFinite(pos.capital) ? pos.capital : 0;
        const cap =
          sizing && equalCap > 0
            ? synthCapForOpenPosition(pos.key, equalCap, sizing, openShares)
            : equalCap;
        if (cap <= 0 || totalCap <= 0) continue;
        const share = cap / totalCap;
        const pnlEur = Math.round(openMtmTotal * share * 100) / 100;
        const movePct = cap > 0 ? Math.round((pnlEur / cap) * 10000) / 100 : 0;
        byTicker[pos.key] = { value: cap + pnlEur, pnl: pnlEur, pnlPct: movePct };
      }
    }

    const closedAtTick = resolveTickClosedPnlEur(cumRealized, piggy);
    const totalPnl = Math.round((closedAtTick + openMtmTotal) * 100) / 100;

    if (!positions.length && cumRealized === 0 && out.length === 0) continue;

    out.push({
      ts: tick.at,
      capital: totalCap,
      value: totalCap + totalPnl,
      pnl: totalPnl,
      pnlPct: totalCap > 0 ? Math.round((totalPnl / totalCap) * 10000) / 100 : 0,
      closedPnlEur: closedAtTick,
      byTicker,
    });
  }
  return out;
}

function appendLiveSimLoopHistoryPoint(
  history: InvestSimHistoryPoint[],
  paperPortfolio: PaperPosition[],
  totals: SimLoopPulseTotals,
  pnlByKey: Map<string, number>,
  sizing?: SimLoopPulseSizing | null,
  activeShares: Record<string, number> = {},
): InvestSimHistoryPoint[] {
  if (!paperPortfolio.length) return history;

  const byTicker: InvestSimHistoryPoint["byTicker"] = {};
  for (const pos of paperPortfolio) {
    const cap = resolveEffectiveCap(pos.key, pos.capital, sizing, activeShares);
    const pnl = finitePnl(pnlByKey.get(pos.key), 0);
    const pct = cap > 0 ? Math.round((pnl / cap) * 10000) / 100 : 0;
    byTicker[pos.key] = { value: cap + pnl, pnl, pnlPct: pct };
  }

  const live: InvestSimHistoryPoint = {
    ts: new Date().toISOString(),
    capital: totals.capital,
    value: totals.capital + totals.pnlEur,
    pnl: totals.pnlEur,
    pnlPct: totals.pnlPct ?? 0,
    byTicker,
  };

  const last = history[history.length - 1];
  if (last && Math.abs((last.pnl ?? 0) - live.pnl) < 0.02) {
    return history.length ? [...history.slice(0, -1), live] : [live];
  }
  return [...history, live];
}

export function buildSimLoopPulseData(opts: {
  state: DecisionSimState;
  simTable: SheetTable | null;
  chartPointsByKey: Map<string, ChartPoint[]>;
  priorSnapshot?: SimLoopVisitSnapshot | null;
  lang?: "it" | "en";
  /** Weight Sim Exp sizing — scales P&L and deployed cap vs equal-weight paper sim. */
  sizing?: SimLoopPulseSizing | null;
  /** Hourly invest-sim snapshots — enables 24h pulse chart like portfolio view. */
  portfolioHistory?: InvestSimHistoryPoint[] | null;
  /** Pick stocks inputs — audit-aligned P&L (same as Portfolio pulse). */
  inputs?: InvestSimInputs;
}): SimLoopPulseData {
  const {
    state,
    simTable,
    chartPointsByKey,
    priorSnapshot: rawPriorSnapshot = null,
    lang = "it",
    sizing = null,
    portfolioHistory = null,
    inputs,
  } = opts;

  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const latestTick = state.ticks[state.ticks.length - 1];
  const evalByKey = new Map(
    (latestTick?.evaluations ?? []).map((e) => [e.key, e]),
  );
  const liveOpenShares =
    sizing && state.paperPortfolio.length
      ? rebalanceCausalSimLoopShares(
          state.paperPortfolio,
          latestTick?.evaluations ?? [],
          causalOptsFromSizing(sizing),
        )
      : {};
  const history = buildSimLoopHistoryFromTicks(state.ticks, sizing);
  const hourlyHistory =
    portfolioHistory?.length && state.paperPortfolio.length
      ? buildSimLoopPulseHourlyHistory(
          portfolioHistory,
          state.ticks,
          state.paperPortfolio,
          sizing,
        )
      : [];
  const pulseChartHistory = mergeSimLoopPulseChartHistory(history, hourlyHistory);

  type RowDraft = Omit<SimLoopPulsePortfolioRow, "direction" | "deltaPnlEurSinceVisit">;
  const drafts: RowDraft[] = [];
  for (const pos of state.paperPortfolio) {
    const simRow = rowByKey.get(pos.key);
    if (!simRow) continue;
    const ev = evalByKey.get(pos.key);
    const sk = simulationRowSeriesKey(simRow);
    const chartPts = sk ? chartPointsByKey.get(sk) : null;
    const equalCap = pos.capital;
    const effectiveCap = resolveEffectiveCap(pos.key, equalCap, sizing, liveOpenShares);
    const gainPlanRow = buildSimLoopGainPlanRowFromPaper(
      pos,
      simRow,
      ev,
      chartPts ?? null,
      effectiveCap,
    );
    if (!gainPlanRow) continue;

    const markPct = ev?.pnlPct ?? pos.lastMarkPct ?? null;
    const aligned = resolveSimLoopAlignedOpenPnl(
      simRow,
      pos.key,
      inputs,
      portfolioHistory,
      effectiveCap,
      pos.entryAt,
      markPct,
    );
    const pnlEur = aligned.pnlEur;
    const pnlPct = aligned.pnlPct;
    let pnlEur24h = aligned.pnlEur24h;
    let pnlPct24h = aligned.pnlPct24h;
    if (pnlEur24h == null && pnlPct24h == null) {
      const daily = resolveSimLoopDailyPnl(
        { ...pos, capital: effectiveCap },
        simRow,
        ev,
        pnlEur,
      );
      pnlEur24h = daily.pnlEur24h;
      pnlPct24h = daily.pnlPct24h;
    }
    const gainPlanRowLive = {
      ...gainPlanRow,
      pnlEur,
      pnlUnavailable: pnlPct == null,
    };

    drafts.push({
      key: pos.key,
      ticker: pos.ticker,
      completionDate: String(simRow["Completion Date"] ?? "—"),
      pnlEur,
      pnlPct,
      pnlEur24h,
      pnlPct24h,
      gainPlanRow: gainPlanRowLive,
      planGap: { plannedNowEur: null, actualNowEur: null, gapEur: null, gapPct: null },
    });
  }

  const capital = drafts.reduce((s, r) => s + r.gainPlanRow.capital, 0);
  const openPnlEur = drafts.reduce((s, r) => s + finitePnl(r.pnlEur, 0), 0);
  const closedPnlEur = resolveSimLoopClosedPnlEur(state.ticks, sizing);
  const closedDealCount = state.ticks.reduce(
    (n, tk) => n + tk.trades.filter((tr) => tr.side === "sell").length,
    0,
  );
  const pnlEur = Math.round((closedPnlEur + openPnlEur) * 100) / 100;

  let equalReferenceTotals: SimLoopPulseTotals | null = null;
  if (sizing) {
    let equalOpenPnl = 0;
    let equalCapTotal = 0;
    for (const pos of state.paperPortfolio) {
      const simRow = rowByKey.get(pos.key);
      if (!simRow) continue;
      const ev = evalByKey.get(pos.key);
      const markPct = ev?.pnlPct ?? pos.lastMarkPct ?? null;
      const aligned = resolveSimLoopAlignedOpenPnl(
        simRow,
        pos.key,
        inputs,
        portfolioHistory,
        pos.capital,
        pos.entryAt,
        markPct,
      );
      equalOpenPnl += aligned.pnlEur;
      equalCapTotal += pos.capital;
    }
    const equalClosed = resolveSimLoopClosedPnlEur(state.ticks, null);
    const equalPnl = Math.round((equalClosed + equalOpenPnl) * 100) / 100;
    equalReferenceTotals = {
      pnlEur: equalPnl,
      pnlPct:
        equalCapTotal > 0 ? positionCapitalPnlPct(equalPnl, equalCapTotal) : null,
      pnlEurToday: null,
      todayCovered: 0,
      capital: equalCapTotal,
      openPnlEur: Math.round(equalOpenPnl * 100) / 100,
      openPnlPct:
        equalCapTotal > 0 ? positionCapitalPnlPct(equalOpenPnl, equalCapTotal) : null,
      closedPnlEur: equalClosed,
      closedDealCount,
    };
  }
  let pnlEurToday = 0;
  let todayCovered = 0;
  for (const r of drafts) {
    if (r.pnlEur24h != null && Number.isFinite(r.pnlEur24h)) {
      pnlEurToday += r.pnlEur24h;
      todayCovered++;
    }
  }

  const totals: SimLoopPulseTotals = {
    pnlEur: Math.round(pnlEur * 100) / 100,
    pnlPct:
      capital > 0 ? positionCapitalPnlPct(pnlEur, capital) : null,
    pnlEurToday: todayCovered > 0 ? Math.round(pnlEurToday * 100) / 100 : null,
    todayCovered,
    capital,
    openPnlEur: Math.round(openPnlEur * 100) / 100,
    openPnlPct: capital > 0 ? positionCapitalPnlPct(openPnlEur, capital) : null,
    closedPnlEur,
    closedDealCount,
  };

  const priorSnapshot = resolveEffectiveSimLoopVisitSnapshot(rawPriorSnapshot, totals);

  const historyWithLive = appendLiveSimLoopHistoryPoint(
    history,
    state.paperPortfolio,
    totals,
    new Map(drafts.map((d) => [d.key, d.pnlEur])),
    sizing,
    liveOpenShares,
  );
  const pulseHistoryWithLive = appendLiveSimLoopHistoryPoint(
    pulseChartHistory,
    state.paperPortfolio,
    totals,
    new Map(drafts.map((d) => [d.key, d.pnlEur])),
    sizing,
    liveOpenShares,
  );
  const chartHistory = rampSimLoopHistoryToLive(
    pulseHistoryWithLive,
    totals.pnlEur,
    closedPnlEur,
  );

  const rows: SimLoopPulsePortfolioRow[] = drafts.map((draft) => {
    const deltaPnlEurSinceVisit = resolveSimLoopDeltaSinceVisit(
      draft.key,
      draft.pnlEur,
      priorSnapshot,
      historyWithLive,
    );
    return {
      ...draft,
      planGap: alignRowPlanGap(draft.gainPlanRow, historyWithLive),
      direction: resolveDirection(
        draft.pnlEur24h,
        draft.pnlPct24h,
        deltaPnlEurSinceVisit,
        priorSnapshot != null,
      ),
      deltaPnlEurSinceVisit,
    };
  });

  rows.sort((a, b) => {
    const da = directionSortKey(a.direction);
    const db = directionSortKey(b.direction);
    if (da !== db) return da - db;
    const a24 = a.pnlEur24h ?? 0;
    const b24 = b.pnlEur24h ?? 0;
    if (a.direction === "down") return a24 - b24;
    return b24 - a24;
  });

  const deltaPnlSinceVisit =
    priorSnapshot != null
      ? Math.round((totals.pnlEur - priorSnapshot.totalPnlEur) * 100) / 100
      : null;

  const winRate = summarizePortfolioWinRate(
    rows.map((r) => ({
      pnlEur: r.pnlEur,
      pnlPct: r.pnlPct ?? 0,
      pnlEur24h: r.pnlEur24h,
      pnlPct24h: r.pnlPct24h,
    })),
  );

  const gainPlanRows = rows.map((r) => r.gainPlanRow);
  const planGapRaw = summarizePlanGap(gainPlanRows, historyWithLive);
  const planGap: PlanGapSummary = {
    ...planGapRaw,
    actualNowEur: totals.pnlEur,
    gapEur:
      planGapRaw.plannedNowEur != null
        ? Math.round((totals.pnlEur - planGapRaw.plannedNowEur) * 100) / 100
        : planGapRaw.gapEur,
    gapPct:
      planGapRaw.plannedNowEur != null && totals.capital > 0
        ? Math.round(
            ((totals.pnlEur - planGapRaw.plannedNowEur) / totals.capital) * 10000,
          ) / 100
        : planGapRaw.gapPct,
  };
  const aggregateGainPlanSeries = alignAggregateGainPlanSeriesToLiveGap(
    buildPortfolioGainPlanAggregateSeries(
      gainPlanRows,
      chartHistory,
      priorSnapshot?.savedAt ?? null,
      lang,
      { preferHoldDayAxis: true, liveGap: planGap },
    ),
    planGap,
    lang,
  );

  return {
    hasPriorVisit: priorSnapshot != null,
    priorVisitAt: priorSnapshot?.savedAt ?? null,
    totals,
    equalReferenceTotals,
    deltaPnlSinceVisit,
    winRate,
    rows,
    aggregateGainPlanSeries,
    planGap,
    history: historyWithLive,
  };
}

export type SimLoopEqualSynthReconcileRow = {
  key: string;
  ticker: string;
  status: "open" | "closed";
  equalCapEur: number;
  synthCapEur: number;
  liveSharePct: number | null;
  entrySharePct: number | null;
  equalPnlClosedEur: number;
  synthPnlClosedEur: number;
  equalPnlOpenEur: number;
  synthPnlOpenEur: number;
  equalPnlTotalEur: number;
  synthPnlTotalEur: number;
  pnlDeltaEur: number;
};

export type SimLoopEqualSynthReconcile = {
  rows: SimLoopEqualSynthReconcileRow[];
  totals: {
    equalOpenCapEur: number;
    synthOpenCapEur: number;
    equalOpenPnlEur: number;
    synthOpenPnlEur: number;
    equalClosedPnlEur: number;
    synthClosedPnlEur: number;
    equalTotalPnlEur: number;
    synthTotalPnlEur: number;
    pnlDeltaEur: number;
  };
  signMismatch: boolean;
  /** Closed row keys where causal share was unavailable (equal-cap fallback). */
  closedKeysWithoutEntryShare: string[];
};

function sharePct(share: number | null | undefined): number | null {
  if (share == null || !Number.isFinite(share)) return null;
  return Math.round(share * 10000) / 100;
}

function lastCausalSellShare(
  walk: ReturnType<typeof buildCausalSimLoopShareWalk>,
  ticks: DecisionSimTick[],
  rowKey: string,
): number | null {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const tick = sorted[i]!;
    for (const tr of tick.trades) {
      if (tr.side !== "sell" || tr.key !== rowKey) continue;
      return causalShareForSell(walk, tick, tr);
    }
  }
  return null;
}

function resolveSimLoopClosedPnlByKey(
  ticks: DecisionSimTick[],
  sizing: SimLoopPulseSizing,
): Map<string, { equal: number; synth: number }> {
  const out = new Map<string, { equal: number; synth: number }>();
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  const walk = buildCausalSimLoopShareWalk(sorted, causalOptsFromSizing(sizing));
  for (const tick of sorted) {
    for (const tr of tick.trades) {
      if (tr.side !== "sell" || tr.pnlEurSimulated == null) continue;
      const entryPos = tick.portfolioBefore?.find((p) => p.key === tr.key);
      const equalCap = tr.capital ?? entryPos?.capital ?? sizing.capitalPerTrade;
      const equalPnl = tr.pnlEurSimulated;
      const share = causalShareForSell(walk, tick, tr);
      const synthCap = synthCapForClosedTrade(equalCap, sizing, share);
      const synthPnl =
        equalCap > 0
          ? Math.round(equalPnl * (synthCap / equalCap) * 100) / 100
          : equalPnl;
      const prev = out.get(tr.key) ?? { equal: 0, synth: 0 };
      out.set(tr.key, {
        equal: Math.round((prev.equal + equalPnl) * 100) / 100,
        synth: Math.round((prev.synth + synthPnl) * 100) / 100,
      });
    }
  }
  return out;
}

/** Per-ticker equal vs synth breakdown (open MTM + closed realized). */
export function buildSimLoopEqualSynthReconcile(opts: {
  state: DecisionSimState;
  simTable: SheetTable | null;
  sizing: SimLoopPulseSizing;
}): SimLoopEqualSynthReconcile {
  const { state, simTable, sizing } = opts;
  const rowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
  const latestTick = state.ticks[state.ticks.length - 1];
  const evalByKey = new Map(
    (latestTick?.evaluations ?? []).map((e) => [e.key, e]),
  );
  const walk = buildCausalSimLoopShareWalk(state.ticks, causalOptsFromSizing(sizing));
  const liveOpenShares = rebalanceCausalSimLoopShares(
    state.paperPortfolio,
    latestTick?.evaluations ?? [],
    causalOptsFromSizing(sizing),
  );
  const closedByKey = resolveSimLoopClosedPnlByKey(state.ticks, sizing);
  const openKeys = new Set(state.paperPortfolio.map((p) => p.key));
  const allKeys = new Set([...openKeys, ...closedByKey.keys()]);

  const closedKeysWithoutEntryShare: string[] = [];
  const rows: SimLoopEqualSynthReconcileRow[] = [];

  for (const key of allKeys) {
    const isOpen = openKeys.has(key);
    const pos = state.paperPortfolio.find((p) => p.key === key);
    const simRow = rowByKey.get(key);
    const ticker =
      pos?.ticker ??
      simRow?.Ticker?.toString().trim().toUpperCase() ??
      key.split("|")[0]?.trim().toUpperCase() ??
      key;

    const equalCap = isOpen && pos ? pos.capital : sizing.capitalPerTrade;
    const activeShare = isOpen
      ? liveOpenShares[key]
      : lastCausalSellShare(walk, state.ticks, key);
    const synthCap = isOpen
      ? synthCapForOpenPosition(key, equalCap, sizing, liveOpenShares)
      : shareToSynthCap(activeShare, sizing.totalCapitalEur, equalCap);

    const closed = closedByKey.get(key) ?? { equal: 0, synth: 0 };
    let equalPnlOpen = 0;
    let synthPnlOpen = 0;

    if (isOpen && pos) {
      const ev = evalByKey.get(key);
      const markPct = sanitizePaperMovePct(ev?.pnlPct ?? pos.lastMarkPct);
      if (markPct != null) {
        equalPnlOpen = pnlEurFromMovePct(pos.capital, markPct);
        synthPnlOpen = pnlEurFromMovePct(synthCap, markPct);
      }
    }

    if (!isOpen && activeShare == null) {
      closedKeysWithoutEntryShare.push(key);
    }

    const equalTotal = Math.round((closed.equal + equalPnlOpen) * 100) / 100;
    const synthTotal = Math.round((closed.synth + synthPnlOpen) * 100) / 100;

    rows.push({
      key,
      ticker,
      status: isOpen ? "open" : "closed",
      equalCapEur: isOpen ? equalCap : 0,
      synthCapEur: isOpen ? synthCap : 0,
      liveSharePct: sharePct(liveOpenShares[key] ?? sizing.shareByRowKey[key]),
      entrySharePct: sharePct(activeShare),
      equalPnlClosedEur: closed.equal,
      synthPnlClosedEur: closed.synth,
      equalPnlOpenEur: equalPnlOpen,
      synthPnlOpenEur: synthPnlOpen,
      equalPnlTotalEur: equalTotal,
      synthPnlTotalEur: synthTotal,
      pnlDeltaEur: Math.round((synthTotal - equalTotal) * 100) / 100,
    });
  }

  rows.sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    return Math.abs(b.pnlDeltaEur) - Math.abs(a.pnlDeltaEur);
  });

  const openRows = rows.filter((r) => r.status === "open");
  const closedRows = rows.filter((r) => r.status === "closed");
  const equalOpenCapEur = openRows.reduce((s, r) => s + r.equalCapEur, 0);
  const synthOpenCapEur = openRows.reduce((s, r) => s + r.synthCapEur, 0);
  const equalOpenPnlEur = Math.round(openRows.reduce((s, r) => s + r.equalPnlOpenEur, 0) * 100) / 100;
  const synthOpenPnlEur = Math.round(openRows.reduce((s, r) => s + r.synthPnlOpenEur, 0) * 100) / 100;
  const equalClosedPnlEur = Math.round(closedRows.reduce((s, r) => s + r.equalPnlClosedEur, 0) * 100) / 100;
  const synthClosedPnlEur = Math.round(closedRows.reduce((s, r) => s + r.synthPnlClosedEur, 0) * 100) / 100;
  const equalTotalPnlEur = Math.round((equalOpenPnlEur + equalClosedPnlEur) * 100) / 100;
  const synthTotalPnlEur = Math.round((synthOpenPnlEur + synthClosedPnlEur) * 100) / 100;
  const pnlDeltaEur = Math.round((synthTotalPnlEur - equalTotalPnlEur) * 100) / 100;

  return {
    rows,
    totals: {
      equalOpenCapEur,
      synthOpenCapEur,
      equalOpenPnlEur,
      synthOpenPnlEur,
      equalClosedPnlEur,
      synthClosedPnlEur,
      equalTotalPnlEur,
      synthTotalPnlEur,
      pnlDeltaEur,
    },
    signMismatch:
      equalTotalPnlEur !== 0 &&
      synthTotalPnlEur !== 0 &&
      Math.sign(equalTotalPnlEur) !== Math.sign(synthTotalPnlEur),
    closedKeysWithoutEntryShare,
  };
}
