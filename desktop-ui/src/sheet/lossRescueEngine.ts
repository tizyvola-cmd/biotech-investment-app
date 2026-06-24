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

/** Positions below this PnL% are considered "in loss and rescue-eligible". */
export const LOSS_ENTRY_THRESHOLD_PCT = -2;

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
  /** Rescue score 0–100 based on entry prob, loss depth and EIS window activity. */
  rescoreScore: number;
  /** Score breakdown for UI display. */
  scoreBreakdown: { probPt: number; lossPt: number; eisPt: number };
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
 */
export function computeEisFeedWindowScore(
  ticker: string,
  lang: "it" | "en",
  windowStartIso?: string | null,
  history?: InvestSimHistoryPoint[] | null,
): number | null {
  try {
    const detail = buildTickerEisDetail(ticker, lang);
    if (!detail.events.length && detail.score == null) return null;

    const crashIso = history?.length ? resolveCrashDateFromHistory(ticker, history) : null;
    const startIso = windowStartIso ?? crashIso ?? feedFragilityWindowStartIso();
    const windowStartMs = Date.parse(`${startIso.slice(0, 10)}T00:00:00`);
    const now = Date.now();

    const windowEvents = detail.events.filter((ev) => {
      if (!ev.eventDate) return false;
      const ms = Date.parse(`${ev.eventDate}T12:00:00`);
      return Number.isFinite(ms) && ms >= windowStartMs && ms <= now;
    });

    const relevant = windowEvents.length > 0 ? windowEvents : detail.events.slice(0, 8);
    if (relevant.length > 0) {
      const total = relevant.reduce((s, ev) => s + (ev.breakdown.score ?? 0), 0);
      return Math.round(total * 100) / 100;
    }
    if (detail.score != null && Number.isFinite(detail.score)) return detail.score;
    return null;
  } catch {
    return null;
  }
}

/** Rescue score components (portfolio loss) — shared with entry fragility sizing. */
export function computeRescueScoreBreakdown(args: {
  entryProbPct: number | null;
  lastMarkPct?: number | null;
  eisWindowScore: number | null;
}): { probPt: number; lossPt: number; eisPt: number; rescoreScore: number } {
  const probPt = clamp((args.entryProbPct ?? 50) - 30, 0, 55);
  const lossPt =
    args.lastMarkPct != null
      ? clamp(Math.abs(args.lastMarkPct) * 0.88, 0, 25)
      : 0;
  const eisPt =
    args.eisWindowScore != null
      ? clamp((args.eisWindowScore / 25) * 20, 0, 20)
      : 0;
  const rescoreScore = Math.round(clamp(probPt + lossPt + eisPt, 0, 100));
  return {
    probPt: Math.round(probPt),
    lossPt: Math.round(lossPt),
    eisPt: Math.round(eisPt),
    rescoreScore,
  };
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

  // Weights = entryProbPct (fallback 50 if unknown)
  const weights = lossPositions.map((p) =>
    clamp(p.entryProbPct ?? 50, 10, 95),
  );
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  const allocations: RescueAllocation[] = lossPositions.map((pos, i) => {
    const share = totalWeight > 0 ? weights[i]! / totalWeight : 1 / lossPositions.length;
    const raw = rescueBudgetEur * share;
    const suggestedEur =
      Math.round(Math.min(raw, pos.capital * RESCUE_MAX_SINGLE_FRACTION) * 100) / 100;

    // Rescue score: prob (0-55) + loss depth (0-25) + EIS window activity (0-20)
    const { probPt, lossPt, eisPt, rescoreScore } = computeRescueScoreBreakdown({
      entryProbPct: pos.entryProbPct,
      lastMarkPct: pos.lastMarkPct,
      eisWindowScore: pos.eisWindowScore,
    });
    const scoreBreakdown = { probPt, lossPt, eisPt };

    return { position: pos, suggestedEur, rescoreScore, scoreBreakdown };
  });

  return { lossPositions, closedPnlEur, rescueBudgetEur, allocations };
}
