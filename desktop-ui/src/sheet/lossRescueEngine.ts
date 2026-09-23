/**
 * Loss Rescue Engine — identifies open positions in loss and computes
 * a reallocation budget from closed-trade gains.
 *
 * Rules:
 *  - A position is "in rescue scope" when lastMarkPct < LOSS_ENTRY_THRESHOLD_PCT.
 *  - Budget available = max(0, closedPnlEur) * RESCUE_BUDGET_FRACTION.
 *  - Suggested allocation per position is proportional to entryProbPct (P(plan))
 *    as a proxy for recovery probability; capped at capital per position.
 */
import type { PaperPosition } from "./investDecisionSimLoop";
import type { ExperimentPiggyBank } from "./investDecisionSimExperiment";
import { buildTickerEisDetail } from "./tickerEisSummary";
import type { InvestSimHistoryPoint } from "./investSimStorage";
import type { ClinicalPreCdRecord } from "../api/supernova";
import { mergeManualEventsIntoRecords } from "./manualFeedEvents";
import { hydrateClinicalPreCdRecords } from "./clinicalPreCdSnapshotCache";
import { lookupResilienceForTicker } from "./resilienceScoreData";

/** Positions below this PnL% are considered "in loss and rescue-eligible". */
export const LOSS_ENTRY_THRESHOLD_PCT = 0;

/** Operational rescue UI / export — score shown only below this P&L% (rescue space). */
export const RESCUE_OPERATIONAL_THRESHOLD_PCT = -2;

/** Fraction of closed gains allocated to rescue budget. */
export const RESCUE_BUDGET_FRACTION = 0.5;

/** Max single-position allocation as fraction of per-position capital. */
export const RESCUE_MAX_SINGLE_FRACTION = 1.0;

export type LossPosition = {
  key: string;
  ticker: string;
  entryAt: string;
  capital: number;
  lastMarkPct: number;
  pnlEur: number;
  entryProbPct: number | null;
  daysSinceEntry: number;
  /** Cumulative raw EIS in the loss window [entryAt-7d…today] (same scale as EisBreakdown.score, ~-50…+50). null = no events. */
  eisWindowScore: number | null;
};

export type RescueAllocation = {
  position: LossPosition;
  /** Suggested additional capital to deploy (EUR). */
  suggestedEur: number;
  /** Rescue score 0–100 based on entry prob, loss depth, EIS, and cause attribution. */
  rescoreScore: number;
  /** Score breakdown for UI display. */
  scoreBreakdown: RescueScoreBreakdown;
};

export type LossRescueResult = {
  lossPositions: LossPosition[];
  closedPnlEur: number;
  rescueBudgetEur: number;
  allocations: RescueAllocation[];
};

function daysSince(isoDate: string): number {
  const ms = Date.now() - new Date(isoDate).getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** ISO date N calendar days before today (feed lookback for off-book fragility). */
export function feedFragilityWindowStartIso(daysBack = 14): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function resolveCrashDateFromHistory(
  ticker: string,
  history: InvestSimHistoryPoint[],
  thresholdPct = -5,
): string | null {
  for (const point of history) {
    const snap = point.byTicker?.[ticker];
    if (snap && snap.pnlPct != null && snap.pnlPct < thresholdPct) {
      return point.ts;
    }
  }
  return null;
}

/**
 * Cumulative EIS in a window — feed-driven, works for portfolio and off-book names.
 * Returns raw score (~−50…+50). null = no events.
 *
 * The window is [`windowStartIso`, `windowEndIso`]. If `windowEndIso` is omitted
 * (default), the window ends "now" — appropriate for LIVE open-position scoring.
 * For historical / closed-deal correlations pass the actual CD (or exit) date
 * as `windowEndIso` so the score reflects only events that were observable at
 * that time — otherwise a rolling "last 14 days" default silently contaminates
 * the correlation with events that happened long after the trade ended (this
 * was the source of the near-zero EIS correlation on the closed-sim cohort).
 */
export function computeEisFeedWindowScore(
  ticker: string,
  lang: "it" | "en",
  windowStartIso?: string | null,
  history?: InvestSimHistoryPoint[] | null,
  records?: ClinicalPreCdRecord[] | null,
  windowEndIso?: string | null,
): number | null {
  try {
    const baseRecords = records ?? hydrateClinicalPreCdRecords();
    const mergedRecords = mergeManualEventsIntoRecords(baseRecords);
    const detail = buildTickerEisDetail(ticker, lang, undefined, mergedRecords);
    if (!detail.events.length && detail.score == null) return null;

    const crashIso = history?.length ? resolveCrashDateFromHistory(ticker, history) : null;
    const startIso = windowStartIso ?? crashIso ?? feedFragilityWindowStartIso();
    const windowStartMs = Date.parse(`${startIso.slice(0, 10)}T00:00:00`);
    const windowEndMs =
      windowEndIso && /^\d{4}-\d{2}-\d{2}/.test(windowEndIso)
        ? Date.parse(`${windowEndIso.slice(0, 10)}T23:59:59`)
        : Date.now();

    const windowEvents = detail.events.filter((ev) => {
      if (!ev.eventDate) return false;
      const ms = Date.parse(`${ev.eventDate}T12:00:00`);
      return Number.isFinite(ms) && ms >= windowStartMs && ms <= windowEndMs;
    });

    // Fallback to "first 8 events overall" ONLY when no explicit end-date was
    // supplied. When the caller asks for a specific historical window (closed
    // deal cohort) we must NOT silently include out-of-window events — return
    // null instead so downstream correlations correctly count these as absent.
    if (windowEvents.length === 0 && !windowEndIso) {
      const fallback = detail.events.slice(0, 8);
      if (fallback.length > 0) {
        const total = fallback.reduce((s, ev) => s + (ev.breakdown.score ?? 0), 0);
        return Math.round(total * 100) / 100;
      }
      if (detail.score != null && Number.isFinite(detail.score)) return detail.score;
      return null;
    }

    if (windowEvents.length > 0) {
      const total = windowEvents.reduce((s, ev) => s + (ev.breakdown.score ?? 0), 0);
      return Math.round(total * 100) / 100;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Derive RescueCauseInput from an SDS row — prefers cause_attribution if present,
 * otherwise falls back to cluster_c (volume, xbi) and cluster_d (cash runway).
 * Shared by PortfolioLossAnalysisView, LossRescuePanel, and DashboardPulseTable.
 */
export function deriveCauseInputFromSdsRow(sdsRow: {
  cause_attribution?: {
    volume_anomaly?: { score?: number | null } | null;
    external_alignment?: { score?: number | null } | null;
    cash_runway_risk?: { score?: number | null } | null;
  } | null;
  cluster_c?: {
    volume_ratio?: { ratio_5d_vs_20d?: number | null } | null;
    xbi_relative_strength?: { ticker_return_90d?: number | null; xbi_return_90d?: number | null } | null;
  } | null;
  cluster_d?: {
    cash_runway?: { runway_months?: number | null } | null;
  } | null;
} | null | undefined): RescueCauseInput | null {
  if (!sdsRow) return null;
  const ca = sdsRow.cause_attribution;

  let volumeAnomalyScore: number | null = ca?.volume_anomaly?.score ?? null;
  let externalAlignmentScore: number | null = ca?.external_alignment?.score ?? null;
  let cashRunwayRiskScore: number | null = ca?.cash_runway_risk?.score ?? null;

  if (volumeAnomalyScore == null) {
    const ratio = sdsRow.cluster_c?.volume_ratio?.ratio_5d_vs_20d;
    if (ratio != null && ratio > 1) {
      const pseudoZ = (ratio - 1) * 2;
      volumeAnomalyScore = Math.max(0, Math.min(100, pseudoZ * 20));
    }
  }

  if (externalAlignmentScore == null) {
    const tRet = sdsRow.cluster_c?.xbi_relative_strength?.ticker_return_90d;
    const xRet = sdsRow.cluster_c?.xbi_relative_strength?.xbi_return_90d;
    if (tRet != null && xRet != null) {
      const gap = Math.abs(tRet - xRet);
      // Backend uses gap×4 for 5d window; 90d gaps are ~5× larger → use ×0.8
      externalAlignmentScore = Math.max(0, Math.min(100, 100 - gap * 0.8));
    }
  }

  if (cashRunwayRiskScore == null) {
    const months = sdsRow.cluster_d?.cash_runway?.runway_months;
    if (months != null) {
      if (months < 6) cashRunwayRiskScore = 100;
      else if (months < 12) cashRunwayRiskScore = 70;
      else if (months < 18) cashRunwayRiskScore = 40;
      else if (months < 24) cashRunwayRiskScore = 20;
      else cashRunwayRiskScore = 0;
    }
  }

  return { volumeAnomalyScore, externalAlignmentScore, cashRunwayRiskScore };
}

/** Cause attribution input for rescue score integration. */
export type RescueCauseInput = {
  volumeAnomalyScore?: number | null;
  externalAlignmentScore?: number | null;
  cashRunwayRiskScore?: number | null;
};

/**
 * Breakdown of a rescue-slot score. As of the 2026-07-14 refactor the
 * primary source is the **Resilience Score** snapshot (see
 * `prediction/resilience_score.py`). Field naming is preserved for
 * backward compatibility with the LossRescuePanel UI, but the numbers
 * now mean:
 *   probPt         → Historical drawdown-recovery (block A), max 45
 *   lossPt         → Asymmetric beta vs XBI     (block B), max 30
 *   eisPt          → Upside capacity            (block C), max 25
 *   volPenalty, extBonus, cashPenalty → always 0 (retired legacy fields)
 *   rescoreScore   → total Resilience Score, 0-100
 *
 * When the snapshot has no entry for the ticker (early boot, insufficient
 * price history, or `ticker` was not passed), the breakdown reports
 * `status = "unmeasured"` and all points are 0. Callers should treat
 * unmeasured entries as low-confidence when making allocation decisions.
 */
export type RescueScoreBreakdown = {
  probPt: number;
  lossPt: number;
  eisPt: number;
  /** Retained for wire compatibility with previous UI code — always 0. */
  volPenalty: number;
  extBonus: number;
  cashPenalty: number;
  rescoreScore: number;
  /** "ok" when populated from resilience snapshot; "unmeasured" otherwise. */
  status?: "ok" | "unmeasured";
};

/**
 * Compute a rescue-slot score for the given ticker.
 *
 * Historically this function combined P(plan), loss depth and EIS with
 * SDS-derived cause-attribution penalties. That composition **duplicated
 * signals already exposed by SDS and Regulatory scores** and, per the
 * 2026-07-14 review, was replaced by the ticker-intrinsic Resilience
 * Score which uses only 5y price history + XBI. The `causeAttribution`
 * argument is now ignored (retained for signature compatibility).
 *
 * @param args.ticker  Uppercased ticker — required to look up the
 *                     resilience snapshot. Omit to fall back to the
 *                     "unmeasured" breakdown (score 0).
 */
export function computeRescueScoreBreakdown(args: {
  ticker?: string;
  entryProbPct?: number | null;
  lastMarkPct?: number | null;
  eisWindowScore?: number | null;
  causeAttribution?: RescueCauseInput | null;
}): RescueScoreBreakdown {
  const entry = args.ticker ? lookupResilienceForTicker(args.ticker) : null;
  if (!entry || entry.status !== "ok") {
    return {
      probPt: 0,
      lossPt: 0,
      eisPt: 0,
      volPenalty: 0,
      extBonus: 0,
      cashPenalty: 0,
      rescoreScore: 0,
      status: "unmeasured",
    };
  }
  const rec = entry.components.historical_recovery;
  const beta = entry.components.asymmetric_beta;
  const upside = entry.components.upside_capacity;
  return {
    probPt: Math.round(clamp(Number(rec?.score ?? 0), 0, 45)),
    lossPt: Math.round(clamp(Number(beta?.score ?? 0), 0, 30)),
    eisPt: Math.round(clamp(Number(upside?.score ?? 0), 0, 25)),
    volPenalty: 0,
    extBonus: 0,
    cashPenalty: 0,
    rescoreScore: Math.round(clamp(Number(entry.resilience_score ?? 0), 0, 100)),
    status: "ok",
  };
}

/**
 * Diagnostic breakdown — historically differed from the operational one
 * only in the loss-depth term. Since the loss-depth term has been retired
 * (see refactor note above), this now returns the same payload as
 * `computeRescueScoreBreakdown`. Preserved for API stability.
 */
export function computeRescueScoreExtendedBreakdown(args: {
  ticker?: string;
  entryProbPct?: number | null;
  lastMarkPct?: number | null;
  eisWindowScore?: number | null;
  causeAttribution?: RescueCauseInput | null;
}): RescueScoreBreakdown {
  return computeRescueScoreBreakdown(args);
}

export type RescueExtendedGroupStats = {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
};

/** Gruppo A = rescue space (pnl < threshold); Gruppo B = non in perdita profonda. */
export function summarizeRescueExtendedGroups(
  rows: { pnlPct: number; rescueExtended: number }[],
  lossThresholdPct = RESCUE_OPERATIONAL_THRESHOLD_PCT,
): { groupA: RescueExtendedGroupStats; groupB: RescueExtendedGroupStats } {
  const summarize = (vals: number[]): RescueExtendedGroupStats => {
    if (!vals.length) {
      return { count: 0, mean: 0, median: 0, min: 0, max: 0 };
    }
    const sorted = [...vals].sort((a, b) => a - b);
    const sum = vals.reduce((a, b) => a + b, 0);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1]! + sorted[mid]!) / 2
        : sorted[mid]!;
    return {
      count: vals.length,
      mean: Math.round((sum / vals.length) * 100) / 100,
      median: Math.round(median * 100) / 100,
      min: sorted[0]!,
      max: sorted[sorted.length - 1]!,
    };
  };

  const groupA = rows.filter((r) => r.pnlPct < lossThresholdPct).map((r) => r.rescueExtended);
  const groupB = rows.filter((r) => r.pnlPct >= lossThresholdPct).map((r) => r.rescueExtended);
  return { groupA: summarize(groupA), groupB: summarize(groupB) };
}

/**
 * Off-book fragility analogue — low P(plan) + negative EIS feed ≈ rescue stress
 * without an open loss position.
 */
export function computeFeedFragilityAnalogPt(args: {
  pplanPct: number | null;
  eisWindowScore: number | null;
  eisSuperScore: number | null;
}): number {
  const probStress = args.pplanPct != null ? clamp(58 - args.pplanPct, 0, 22) : 10;
  let eisStress = 0;
  if (args.eisWindowScore != null) {
    if (args.eisWindowScore < 0) {
      eisStress += clamp(Math.abs(args.eisWindowScore) * 0.4, 0, 16);
    } else {
      eisStress -= clamp((args.eisWindowScore / 25) * 10, 0, 10);
    }
  }
  if (args.eisSuperScore != null) {
    if (args.eisSuperScore < 0) {
      eisStress += clamp(Math.abs(args.eisSuperScore) * 0.45, 0, 10);
    } else {
      eisStress -= clamp(args.eisSuperScore * 0.08, 0, 6);
    }
  }
  return clamp(Math.round(probStress + Math.max(0, eisStress)), 0, 28);
}

export function computeEisFragilityPt(args: {
  eisWindowScore: number | null;
  eisSuperScore: number | null;
}): number {
  let pt = 0;
  if (args.eisWindowScore != null) {
    if (args.eisWindowScore < 0) pt += clamp(Math.abs(args.eisWindowScore) * 0.5, 0, 18);
    else pt -= clamp(args.eisWindowScore * 0.14, 0, 10);
  }
  if (args.eisSuperScore != null) {
    if (args.eisSuperScore < 0) pt += clamp(Math.abs(args.eisSuperScore) * 0.6, 0, 12);
    else pt -= clamp(args.eisSuperScore * 0.12, 0, 8);
  }
  return clamp(Math.round(pt), 0, 25);
}

export function computeLossRescue(
  portfolio: PaperPosition[],
  piggyBank: ExperimentPiggyBank,
  causeByTicker?: Map<string, RescueCauseInput> | null,
): LossRescueResult {
  const closedPnlEur = piggyBank.closedPnlEur;
  const rescueBudgetEur = Math.max(0, closedPnlEur) * RESCUE_BUDGET_FRACTION;

  const lossPositions: LossPosition[] = portfolio
    .filter((p) => (p.lastMarkPct ?? 0) < LOSS_ENTRY_THRESHOLD_PCT)
    .map((p) => ({
      key: p.key,
      ticker: p.ticker,
      entryAt: p.entryAt,
      capital: p.capital,
      lastMarkPct: p.lastMarkPct ?? 0,
      pnlEur: Math.round((p.capital * (p.lastMarkPct ?? 0)) / 100 * 100) / 100,
      entryProbPct: p.entryProbPct ?? null,
      daysSinceEntry: daysSince(p.entryAt),
      // Read eisWindowScore injected by the panel (PaperPosition is extended with it)
      eisWindowScore: (p as PaperPosition & { eisWindowScore?: number | null }).eisWindowScore ?? null,
    }))
    .sort((a, b) => a.lastMarkPct - b.lastMarkPct);

  if (!lossPositions.length || rescueBudgetEur <= 0) {
    return { lossPositions, closedPnlEur, rescueBudgetEur, allocations: [] };
  }

  // Pre-compute rescue-slot scores. Post-2026-07-14 the underlying source
  // is the Resilience Score snapshot (looked up per ticker). Cause
  // attribution is preserved on the call for backward-compat but no
  // longer participates in the score — see `computeRescueScoreBreakdown`.
  const breakdowns = lossPositions.map((pos) => {
    const ca = causeByTicker?.get(pos.ticker.toUpperCase()) ?? null;
    return computeRescueScoreBreakdown({
      ticker: pos.ticker,
      entryProbPct: pos.entryProbPct,
      lastMarkPct: pos.lastMarkPct,
      eisWindowScore: pos.eisWindowScore,
      causeAttribution: ca,
    });
  });

  // Weights = rescue score (positions with score < 30 get 0 — disinvestment signal)
  const DISINVEST_THRESHOLD = 30;
  const weights = breakdowns.map((bd) =>
    bd.rescoreScore >= DISINVEST_THRESHOLD ? bd.rescoreScore : 0,
  );
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  const allocations: RescueAllocation[] = lossPositions.map((pos, i) => {
    const scoreBreakdown = breakdowns[i]!;
    const share = totalWeight > 0 ? weights[i]! / totalWeight : 0;
    const raw = rescueBudgetEur * share;
    const suggestedEur =
      Math.round(Math.min(raw, pos.capital * RESCUE_MAX_SINGLE_FRACTION) * 100) / 100;

    return { position: pos, suggestedEur, rescoreScore: scoreBreakdown.rescoreScore, scoreBreakdown };
  });

  return { lossPositions, closedPnlEur, rescueBudgetEur, allocations };
}

/** Green = high recovery outlook (positive impact), red = low (negative impact). */
export function rescueScoreColorClass(score: number): string {
  if (score >= 45) return "text-[rgb(var(--signal-up))] font-semibold";
  return "text-[rgb(var(--signal-down))] font-semibold";
}
