import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { realizedPnlEurFromOutcome, realizedPnlPctFromOutcome } from "./outcomePnlDisplay";

const PNL_EPS_EUR = 0.5;
const MS_PER_DAY = 86400000;

function holdDaysForRow(row: SimOutcomeRow): number | null {
  if (row.holding_days != null && Number.isFinite(row.holding_days) && row.holding_days > 0) {
    return row.holding_days;
  }
  const entry = Date.parse(row.entry_ts ?? "");
  const exit = Date.parse(row.exit_ts ?? "");
  if (Number.isFinite(entry) && Number.isFinite(exit) && exit > entry) {
    return Math.max(1, Math.round((exit - entry) / MS_PER_DAY));
  }
  return null;
}

function observationWindowDays(rows: SimOutcomeRow[]): number | null {
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const row of rows) {
    for (const iso of [row.entry_ts, row.exit_ts]) {
      const ts = Date.parse(iso ?? "");
      if (!Number.isFinite(ts)) continue;
      minTs = Math.min(minTs, ts);
      maxTs = Math.max(maxTs, ts);
    }
  }
  if (!Number.isFinite(minTs) || !Number.isFinite(maxTs) || maxTs <= minTs) return null;
  return Math.max(1, Math.round((maxTs - minTs) / MS_PER_DAY));
}

export function extractHoldTimingFromClosed(rows: SimOutcomeRow[]): {
  avgHoldDays: number | null;
  observationDays: number | null;
  totalRealizedPnlEur: number;
  realizedDailyPnlEur: number | null;
} {
  const holdDays: number[] = [];
  let totalPnl = 0;
  for (const row of rows) {
    const hd = holdDaysForRow(row);
    if (hd != null) holdDays.push(hd);
    const eur = realizedPnlEurFromOutcome(row);
    if (eur != null && Number.isFinite(eur)) totalPnl += eur;
  }
  const observationDays = observationWindowDays(rows);
  const avgHoldDays = holdDays.length
    ? round2(holdDays.reduce((s, v) => s + v, 0) / holdDays.length)
    : null;
  const realizedDailyPnlEur =
    observationDays != null && observationDays > 0
      ? round2(totalPnl / observationDays)
      : null;
  return { avgHoldDays, observationDays, totalRealizedPnlEur: round2(totalPnl), realizedDailyPnlEur };
}

/** Guadagno atteso/giorno con N slot pieni: N × (expectancy per trade) / giorni medi in posizione. */
export function expectedDailyPnlForPositions(
  n: number,
  stats: TradeOutcomeStats,
  capitalPerPositionEur: number,
): number | null {
  if (n <= 0 || stats.avgHoldDays == null || stats.avgHoldDays <= 0) return null;
  const perTrade = scaledExpectancyEurPerTrade(stats, capitalPerPositionEur);
  return round2((n * perTrade) / stats.avgHoldDays);
}

export type TradeOutcomeStats = {
  sampleSize: number;
  winCount: number;
  lossCount: number;
  flatCount: number;
  /** 0–1 on decisive trades only. */
  winRate: number;
  avgWinEur: number;
  avgLossEur: number;
  avgWinPct: number;
  avgLossPct: number;
  avgCapitalEur: number;
  expectancyEurPerTrade: number;
  /** Win rate needed for E[trade] ≥ 0 with current avg win/loss sizes. */
  breakevenWinRate: number | null;
  /** Media giorni in posizione (round-trip). */
  avgHoldDays: number | null;
  /** Finestra calendario del campione chiuso. */
  observationDays: number | null;
  /** P&L realizzato / giorno osservazione (storico). */
  realizedDailyPnlEur: number | null;
};

export type ProfitProbabilityPoint = {
  n: number;
  probPositivePct: number;
  expectedPnlEur: number;
  /** P&L atteso al giorno con N slot sempre pieni (expectancy / holding). */
  expectedDailyPnlEur: number;
  minWinsNeeded: number;
  capitalDeployedEur: number;
};

export type DiversificationRecommendation = {
  confidencePct: number;
  minPositions: number | null;
  capitalPerPositionEur: number;
  minCapitalTotalEur: number | null;
  expectedDailyPnlEur: number | null;
};

export function extractTradeStatsFromClosedOutcomes(rows: SimOutcomeRow[]): TradeOutcomeStats | null {
  const winsEur: number[] = [];
  const lossesEur: number[] = [];
  const winsPct: number[] = [];
  const lossesPct: number[] = [];
  let flatCount = 0;
  let capitalSum = 0;
  let capitalN = 0;

  for (const row of rows) {
    const eur = realizedPnlEurFromOutcome(row);
    const pct = realizedPnlPctFromOutcome(row);
    if (row.capital_eur > 0) {
      capitalSum += row.capital_eur;
      capitalN += 1;
    }
    if (eur == null || !Number.isFinite(eur)) {
      flatCount += 1;
      continue;
    }
    if (Math.abs(eur) <= PNL_EPS_EUR) {
      flatCount += 1;
      continue;
    }
    if (eur > 0) {
      winsEur.push(eur);
      if (pct != null && Number.isFinite(pct)) winsPct.push(Math.abs(pct));
    } else {
      lossesEur.push(Math.abs(eur));
      if (pct != null && Number.isFinite(pct)) lossesPct.push(Math.abs(pct));
    }
  }

  const winCount = winsEur.length;
  const lossCount = lossesEur.length;
  const decisive = winCount + lossCount;
  if (decisive === 0) return null;

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;

  const avgWinEur = avg(winsEur);
  const avgLossEur = avg(lossesEur);
  const avgWinPct = avg(winsPct);
  const avgLossPct = avg(lossesPct);
  const winRate = winCount / decisive;
  const avgCapitalEur = capitalN > 0 ? capitalSum / capitalN : 5000;
  const expectancyEurPerTrade = winRate * avgWinEur - (1 - winRate) * avgLossEur;
  const breakevenWinRate =
    avgWinEur + avgLossEur > 0 ? avgLossEur / (avgWinEur + avgLossEur) : null;

  const timing = extractHoldTimingFromClosed(rows);

  return {
    sampleSize: decisive,
    winCount,
    lossCount,
    flatCount,
    winRate,
    avgWinEur: round2(avgWinEur),
    avgLossEur: round2(avgLossEur),
    avgWinPct: round2(avgWinPct),
    avgLossPct: round2(avgLossPct),
    avgCapitalEur: round2(avgCapitalEur),
    expectancyEurPerTrade: round2(expectancyEurPerTrade),
    breakevenWinRate,
    avgHoldDays: timing.avgHoldDays,
    observationDays: timing.observationDays,
    realizedDailyPnlEur: timing.realizedDailyPnlEur,
  };
}

/** Minimum wins so that k·W − (n−k)·L > 0 (equal size W/L from averages). */
export function minWinsForPositivePortfolio(
  n: number,
  avgWinEur: number,
  avgLossEur: number,
): number {
  if (n <= 0) return 0;
  if (avgWinEur <= 0 && avgLossEur <= 0) return 0;
  if (avgLossEur <= 0) return 0;
  if (avgWinEur <= 0) return n + 1;
  const threshold = (n * avgLossEur) / (avgWinEur + avgLossEur);
  return Math.min(n + 1, Math.floor(threshold) + 1);
}

export function binomialPmf(n: number, k: number, p: number): number {
  if (k < 0 || k > n || p <= 0) return 0;
  if (p >= 1) return k === n ? 1 : 0;
  if (k === 0) return Math.pow(1 - p, n);

  let coeff = 1;
  for (let i = 0; i < k; i++) {
    coeff *= (n - i) / (i + 1);
  }
  return coeff * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

/** P(net portfolio EUR > 0) with i.i.d. trades, fixed avg win/loss scaled to capitalPerPosition. */
export function probPortfolioPositive(
  n: number,
  winRate: number,
  avgWinEur: number,
  avgLossEur: number,
  capitalPerPosition: number,
  referenceCapitalEur = capitalPerPosition,
): number {
  if (n <= 0) return 0;
  const ratio =
    referenceCapitalEur > 0 ? capitalPerPosition / referenceCapitalEur : 1;
  const w = avgWinEur * ratio;
  const l = avgLossEur * ratio;
  if (w <= 0 && l <= 0) return 0;
  if (l <= 0) return 1;
  if (w <= 0) return 0;

  const kMin = minWinsForPositivePortfolio(n, w, l);
  if (kMin > n) return 0;

  let sum = 0;
  for (let k = kMin; k <= n; k++) {
    sum += binomialPmf(n, k, winRate);
  }
  return Math.min(1, Math.max(0, sum));
}

export function scaledExpectancyEurPerTrade(
  stats: TradeOutcomeStats,
  capitalPerPositionEur: number,
): number {
  const ratio =
    stats.avgCapitalEur > 0 ? capitalPerPositionEur / stats.avgCapitalEur : 1;
  return stats.expectancyEurPerTrade * ratio;
}

export function buildProfitProbabilityCurve(
  stats: TradeOutcomeStats,
  opts?: {
    maxPositions?: number;
    capitalPerPositionEur?: number;
    /** Probabilità dal Simulation Lab (es. media planProbPct delle raccomandazioni attive). Se fornita, viene usata insieme a quella storica. */
    simLabWinRate?: number;
  },
): ProfitProbabilityPoint[] {
  const maxN = opts?.maxPositions ?? 24;
  const cap = opts?.capitalPerPositionEur ?? stats.avgCapitalEur;
  const points: ProfitProbabilityPoint[] = [];

  // Usa la probabilità dal simulation lab se disponibile, altrimenti quella storica
  // Se entrambe disponibili, usa la media ponderata (60% sim lab, 40% storico)
  let effectiveWinRate = stats.winRate;
  if (opts?.simLabWinRate != null && opts.simLabWinRate > 0) {
    effectiveWinRate = stats.winRate * 0.4 + opts.simLabWinRate * 0.6;
  }

  for (let n = 1; n <= maxN; n++) {
    const minWins = minWinsForPositivePortfolio(n, stats.avgWinEur, stats.avgLossEur);
    const prob = probPortfolioPositive(
      n,
      effectiveWinRate,
      stats.avgWinEur,
      stats.avgLossEur,
      cap,
      stats.avgCapitalEur,
    );
    points.push({
      n,
      probPositivePct: Math.round(prob * 1000) / 10,
      expectedPnlEur: round0(n * scaledExpectancyEurPerTrade(stats, cap)),
      expectedDailyPnlEur:
        expectedDailyPnlForPositions(n, stats, cap) ?? 0,
      minWinsNeeded: Math.min(minWins, n),
      capitalDeployedEur: round0(n * cap),
    });
  }
  return points;
}

export function minPositionsForConfidence(
  stats: TradeOutcomeStats,
  targetConfidencePct: number,
  opts?: { maxSearch?: number; capitalPerPositionEur?: number; simLabWinRate?: number },
): number | null {
  const maxSearch = opts?.maxSearch ?? 40;
  const cap = opts?.capitalPerPositionEur ?? stats.avgCapitalEur;
  const target = targetConfidencePct / 100;

  // Usa la probabilità dal simulation lab se disponibile
  let effectiveWinRate = stats.winRate;
  if (opts?.simLabWinRate != null && opts.simLabWinRate > 0) {
    effectiveWinRate = stats.winRate * 0.4 + opts.simLabWinRate * 0.6;
  }

  for (let n = 1; n <= maxSearch; n++) {
    const prob = probPortfolioPositive(
      n,
      effectiveWinRate,
      stats.avgWinEur,
      stats.avgLossEur,
      cap,
      stats.avgCapitalEur,
    );
    if (prob >= target) return n;
  }
  return null;
}

export function buildDiversificationRecommendations(
  stats: TradeOutcomeStats,
  capitalPerPositionEur: number,
  confidenceLevels: number[] = [90, 95],
  simLabWinRate?: number,
): DiversificationRecommendation[] {
  return confidenceLevels.map((confidencePct) => {
    const minPositions = minPositionsForConfidence(stats, confidencePct, {
      capitalPerPositionEur,
      simLabWinRate,
    });
    return {
      confidencePct,
      minPositions,
      capitalPerPositionEur,
      minCapitalTotalEur:
        minPositions != null ? round0(minPositions * capitalPerPositionEur) : null,
      expectedDailyPnlEur:
        minPositions != null
          ? expectedDailyPnlForPositions(minPositions, stats, capitalPerPositionEur)
          : null,
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round0(n: number): number {
  return Math.round(n);
}

// ── Break-even capital ───────────────────────────────────────────────────

export type BreakEvenCapital = {
  /** Capital total (EUR) needed to reach the target probability of positive close. */
  totalEur: number | null;
  /** Minimum number of equal-weight positions used to reach the target. */
  positions: number | null;
  /** Capital per position assumed in the calculation. */
  capitalPerPositionEur: number;
  /** Target probability of positive close (0–1). */
  targetProb: number;
  /** Reason if BE is not achievable (e.g. negative expectancy). */
  unreachableReason: string | null;
};

/**
 * Compute the total capital required so that the probability of closing
 * the portfolio in positive territory exceeds `targetProbPct` (default 50%).
 *
 * "Break-even" here means: with enough independent positions sharing the
 * historical win rate / avg win / avg loss, the binomial distribution of
 * (wins × avgWin − losses × avgLoss) is positive at least `targetProb` of
 * the time.
 *
 * Returns `unreachableReason` populated when:
 *  - expectancy per trade is ≤ 0 (the more you bet, the more you lose on
 *    average; no amount of capital can drag P(positive) above 50% with
 *    standard binomial assumptions)
 *  - the search budget (maxPositions) is exhausted before hitting target
 */
export function computeBreakEvenCapital(
  stats: TradeOutcomeStats,
  opts?: {
    targetProbPct?: number;
    capitalPerPositionEur?: number;
    maxPositions?: number;
    simLabWinRate?: number;
  },
): BreakEvenCapital {
  const targetProb = (opts?.targetProbPct ?? 50) / 100;
  const cap = opts?.capitalPerPositionEur ?? stats.avgCapitalEur;
  const maxPos = opts?.maxPositions ?? 80;

  // Negative expectancy: target unreachable in the standard sense.
  if (stats.expectancyEurPerTrade <= 0) {
    return {
      totalEur: null,
      positions: null,
      capitalPerPositionEur: cap,
      targetProb,
      unreachableReason:
        "Expectancy per trade ≤ 0 — il portafoglio è in expectation negativo, nessun capitale lo porta a P(positive) ≥ target.",
    };
  }

  const n = minPositionsForConfidence(stats, targetProb * 100, {
    capitalPerPositionEur: cap,
    simLabWinRate: opts?.simLabWinRate,
    maxSearch: maxPos,
  });
  if (n == null) {
    return {
      totalEur: null,
      positions: null,
      capitalPerPositionEur: cap,
      targetProb,
      unreachableReason: `Target P(positive) ≥ ${(targetProb * 100).toFixed(0)}% non raggiunto entro ${maxPos} posizioni.`,
    };
  }
  return {
    totalEur: round0(n * cap),
    positions: n,
    capitalPerPositionEur: cap,
    targetProb,
    unreachableReason: null,
  };
}
