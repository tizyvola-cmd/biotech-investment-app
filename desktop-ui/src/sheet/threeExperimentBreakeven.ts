/**
 * Breakeven curves for the three Capital & Diversification experiments:
 * sweep assumed portfolio win rate p and compute expected € P&L.
 */
import type { FrozenWeights } from "../calibration/calibrationTypes";
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import {
  compositeApprovedWinRate,
  compositeApprovedWinRateWithOverride,
} from "./approvedWeightsDisplay";
import type { ComparisonDeal, PortfolioAllocation } from "./threePortfolioCompare";
import {
  closedRowsInDealUniverse,
  computeRealizedSuccessForDeals,
} from "./portfolioSuccessBridge";

export type ThreeExperimentKey = "mine" | "simEqual" | "simWeighted";

export type BreakevenCurvePoint = {
  winRatePct: number;
  mineEur: number;
  simEqualEur: number;
  simWeightedEur: number;
};

export type ExperimentBreakevenSummary = {
  key: ThreeExperimentKey;
  /** Bisection breakeven % (where EV curve crosses €0). */
  breakevenWinRatePct: number | null;
  /** Capital-weighted mean payoffWinPct across open deals. */
  avgGainPct: number | null;
  /** Capital-weighted mean |payoffLossPct| across open deals. */
  avgLossPct: number | null;
  /** Probabilistic breakeven w* = avgLoss/(avgGain+avgLoss), expressed as %. */
  breakevenWstarPct: number | null;
  /** Number of open deals with cap > 0. */
  nDeals: number;
  /** Realised win rate on closed trades in this experiment's universe (P&L % > 0). */
  observedWinRatePct: number | null;
  observedWinWins: number;
  observedWinN: number;
  /** Capital-weighted realised win rate when allocation caps are available. */
  observedWeightedWinRatePct: number | null;
  /** Capital-weighted mean of pickBestCell shrinkage win rate on open book. */
  meanCalibratedWinRatePct: number | null;
  /** Capital-weighted mean of compositeApprovedWinRate (frozen 4-dim geometric). */
  meanApprovedCompositeWinRatePct: number | null;
  evAtMeanWinRateEur: number | null;
  evAtApprovedCompositeEur: number | null;
  /** Sum of realised € P&L on closed round-trips in this experiment's universe. */
  closedPnlEur: number;
  closedDealCount: number;
  /** Mark-to-market € P&L on open positions (cap × Var.% totale). */
  openPnlEur: number;
  /** Open deals with a non-null MTM return contributing to `openPnlEur`. */
  openPositionsHeld: number;
};

export type HistoricalClosedWinRate = {
  pct: number | null;
  n: number;
  wins: number;
};

/** Win rate from closed corpus with P&L strictly > 0% (zero = loss, no −2% band). */
export type ObservedWinRateGrezzo = {
  pct: number | null;
  n: number;
  wins: number;
};

export type PplanBucketRow = {
  bucket: string;
  nDeals: number;
  calWinRatePct: number | null;
  approvedWinRatePct: number | null;
  /** APPROVED − CAL in percentage points. */
  divergencePp: number | null;
  /** Frozen Learning Lab weight for this bucket, expressed as %. */
  frozenWeightPct: number | null;
};

export type PplanBucketDiagnosis = {
  rows: PplanBucketRow[];
  anomalyBucket: string | null;
  correctedWeightPct: number | null;
  evAtCorrectedApprEur: number | null;
};

const CLOSED_WIN_THRESHOLD_PCT = -2;

/** Realised win % on closed calibration corpus (pnl_pct > −2%). */
export function historicalClosedWinRate(
  closedRows: SimOutcomeRow[],
): HistoricalClosedWinRate {
  const resolved = closedRows.filter(
    (r) => r.pnl_pct != null && Number.isFinite(r.pnl_pct),
  );
  if (!resolved.length) return { pct: null, n: 0, wins: 0 };
  const wins = resolved.filter((r) => (r.pnl_pct ?? 0) > CLOSED_WIN_THRESHOLD_PCT).length;
  return {
    pct: Math.round((wins / resolved.length) * 1000) / 10,
    n: resolved.length,
    wins,
  };
}

/** Closed round-trips in deal universe — € P&L sum and win count (P&L % > 0). */
export function closedPnlStatsForUniverse(
  closedRows: SimOutcomeRow[],
  deals: ComparisonDeal[],
): { pnlEur: number; n: number; wins: number } {
  const universe = closedRowsInDealUniverse(closedRows, deals);
  let pnlEur = 0;
  let wins = 0;
  for (const r of universe) {
    if (r.pnl_eur != null && Number.isFinite(r.pnl_eur)) pnlEur += r.pnl_eur;
    if ((r.pnl_pct ?? 0) > 0) wins += 1;
  }
  return { pnlEur: Math.round(pnlEur), n: universe.length, wins };
}

/** Win rate from closed corpus: P&L strictly > 0% (zero counts as loss, no −2% band). */
export function observedClosedWinRateGrezzo(
  closedRows: SimOutcomeRow[],
): ObservedWinRateGrezzo {
  const resolved = closedRows.filter(
    (r) => r.pnl_pct != null && Number.isFinite(r.pnl_pct),
  );
  if (!resolved.length) return { pct: null, n: 0, wins: 0 };
  const wins = resolved.filter((r) => (r.pnl_pct ?? 0) > 0).length;
  return {
    pct: Math.round((wins / resolved.length) * 1000) / 10,
    n: resolved.length,
    wins,
  };
}

/** Expected € P&L for one deal at assumed win rate p ∈ [0, 1]. */
export function expectedPnlEurAtWinRate(
  deal: ComparisonDeal,
  capEur: number,
  winRate: number,
): number {
  const p = Math.max(0, Math.min(1, winRate));
  const winPct = Number.isFinite(deal.payoffWinPct) ? deal.payoffWinPct : 0;
  const lossPct = Number.isFinite(deal.payoffLossPct) ? deal.payoffLossPct : 0;
  const evPct = p * winPct + (1 - p) * lossPct;
  return (capEur * evPct) / 100;
}

export function portfolioEvAtWinRate(
  deals: ComparisonDeal[],
  allocation: PortfolioAllocation,
  winRate: number,
): number {
  let sum = 0;
  for (const d of deals) {
    const cap = allocation.capByTicker[d.ticker] ?? 0;
    if (cap <= 0) continue;
    sum += expectedPnlEurAtWinRate(d, cap, winRate);
  }
  return sum;
}

function capitalWeightedMeanWinRate(
  deals: ComparisonDeal[],
  allocation: PortfolioAllocation,
  pickWinRate: (deal: ComparisonDeal) => number | null,
): number | null {
  let wSum = 0;
  let wrSum = 0;
  for (const d of deals) {
    const cap = allocation.capByTicker[d.ticker] ?? 0;
    if (cap <= 0) continue;
    const wr = pickWinRate(d);
    if (wr == null || !Number.isFinite(wr)) continue;
    wSum += cap;
    wrSum += cap * wr;
  }
  if (wSum <= 0) return null;
  return wrSum / wSum;
}

function capitalWeightedMeanCalibratedWinRate(
  deals: ComparisonDeal[],
  allocation: PortfolioAllocation,
): number | null {
  return capitalWeightedMeanWinRate(deals, allocation, (d) =>
    Number.isFinite(d.winRate) ? d.winRate : null,
  );
}

function capitalWeightedMeanApprovedComposite(
  deals: ComparisonDeal[],
  allocation: PortfolioAllocation,
  frozen: FrozenWeights | null | undefined,
): number | null {
  if (!frozen) return null;
  return capitalWeightedMeanWinRate(deals, allocation, (d) =>
    compositeApprovedWinRate(d.cells, frozen),
  );
}

function capitalWeightedPayoffs(
  deals: ComparisonDeal[],
  allocation: PortfolioAllocation,
): { avgGainPct: number | null; avgLossPct: number | null; nDeals: number } {
  let wGain = 0;
  let wLoss = 0;
  let totalCap = 0;
  let nDeals = 0;
  for (const d of deals) {
    const cap = allocation.capByTicker[d.ticker] ?? 0;
    if (cap <= 0) continue;
    nDeals += 1;
    totalCap += cap;
    if (Number.isFinite(d.payoffWinPct)) wGain += cap * d.payoffWinPct;
    if (Number.isFinite(d.payoffLossPct)) wLoss += cap * Math.abs(d.payoffLossPct);
  }
  if (totalCap <= 0) return { avgGainPct: null, avgLossPct: null, nDeals: 0 };
  return {
    avgGainPct: Math.round((wGain / totalCap) * 10) / 10,
    avgLossPct: Math.round((wLoss / totalCap) * 10) / 10,
    nDeals,
  };
}

/** Bisection on [0,1] for EV(p)=0. */
export function breakevenWinRateForPortfolio(
  deals: ComparisonDeal[],
  allocation: PortfolioAllocation,
): number | null {
  if (deals.length === 0 || allocation.totalCapitalEur <= 0) return null;
  const at0 = portfolioEvAtWinRate(deals, allocation, 0);
  const at1 = portfolioEvAtWinRate(deals, allocation, 1);
  if (at0 >= -1e-6) return 0;
  if (at1 < -1e-6) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    const ev = portfolioEvAtWinRate(deals, allocation, mid);
    if (ev >= 0) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Fase 4: group simWeighted deals by pplanBucket, compare CAL vs APPROVED. */
export function buildPplanBucketDiagnosis(
  simLoopDeals: ComparisonDeal[],
  simWeightedAlloc: PortfolioAllocation,
  frozen: FrozenWeights | null | undefined,
): PplanBucketDiagnosis {
  const EMPTY: PplanBucketDiagnosis = {
    rows: [],
    anomalyBucket: null,
    correctedWeightPct: null,
    evAtCorrectedApprEur: null,
  };
  if (!frozen) return EMPTY;

  type BktEntry = {
    capSum: number;
    calWrSum: number;
    apprWrSum: number;
    nWithCal: number;
    nWithAppr: number;
    nTotal: number;
  };
  const bucketMap = new Map<string, BktEntry>();

  for (const d of simLoopDeals) {
    const cap = simWeightedAlloc.capByTicker[d.ticker] ?? 0;
    if (cap <= 0) continue;
    const bkt = d.cells.pplanBucket ?? "P(plan) n/a";
    let e = bucketMap.get(bkt);
    if (!e) {
      e = { capSum: 0, calWrSum: 0, apprWrSum: 0, nWithCal: 0, nWithAppr: 0, nTotal: 0 };
      bucketMap.set(bkt, e);
    }
    e.capSum += cap;
    e.nTotal += 1;
    if (Number.isFinite(d.winRate)) {
      e.calWrSum += cap * d.winRate;
      e.nWithCal += 1;
    }
    const apprWr = compositeApprovedWinRate(d.cells, frozen);
    if (apprWr != null) {
      e.apprWrSum += cap * apprWr;
      e.nWithAppr += 1;
    }
  }

  const rows: PplanBucketRow[] = [];
  for (const [bucket, e] of bucketMap) {
    const calWinRatePct =
      e.capSum > 0 && e.nWithCal > 0
        ? Math.round((e.calWrSum / e.capSum) * 1000) / 10
        : null;
    const approvedWinRatePct =
      e.capSum > 0 && e.nWithAppr > 0
        ? Math.round((e.apprWrSum / e.capSum) * 1000) / 10
        : null;
    const divergencePp =
      calWinRatePct != null && approvedWinRatePct != null
        ? Math.round((approvedWinRatePct - calWinRatePct) * 10) / 10
        : null;
    const frozenEntry = frozen.weights.pplanBucket?.[bucket];
    rows.push({
      bucket,
      nDeals: e.nTotal,
      calWinRatePct,
      approvedWinRatePct,
      divergencePp,
      frozenWeightPct: frozenEntry ? Math.round(frozenEntry.weight * 1000) / 10 : null,
    });
  }
  rows.sort((a, b) => Math.abs(b.divergencePp ?? 0) - Math.abs(a.divergencePp ?? 0));

  if (rows.length === 0) return EMPTY;

  const topRow = rows[0];
  const anomalyBucket =
    topRow.divergencePp != null && Math.abs(topRow.divergencePp) > 2
      ? topRow.bucket
      : null;

  if (!anomalyBucket) {
    return { rows, anomalyBucket: null, correctedWeightPct: null, evAtCorrectedApprEur: null };
  }

  const w3050 = frozen.weights.pplanBucket?.["P(plan) 30-50%"]?.weight;
  const wGe70 = frozen.weights.pplanBucket?.["P(plan) ≥70%"]?.weight;
  if (w3050 == null || wGe70 == null) {
    return { rows, anomalyBucket, correctedWeightPct: null, evAtCorrectedApprEur: null };
  }

  const corrected = (w3050 + wGe70) / 2;
  const correctedWeightPct = Math.round(corrected * 1000) / 10;

  const meanApprCorrected = capitalWeightedMeanWinRate(
    simLoopDeals,
    simWeightedAlloc,
    (d) => {
      if (d.cells.pplanBucket === anomalyBucket) {
        return compositeApprovedWinRateWithOverride(d.cells, frozen, {
          pplanBucket: corrected,
        });
      }
      return compositeApprovedWinRate(d.cells, frozen);
    },
  );
  const evAtCorrectedApprEur =
    meanApprCorrected != null
      ? Math.round(
          portfolioEvAtWinRate(simLoopDeals, simWeightedAlloc, meanApprCorrected),
        )
      : null;

  return { rows, anomalyBucket, correctedWeightPct, evAtCorrectedApprEur };
}

export function buildThreeExperimentBreakevenCurves(args: {
  mineDeals: ComparisonDeal[];
  simLoopDeals: ComparisonDeal[];
  mineAlloc: PortfolioAllocation;
  simEqualAlloc: PortfolioAllocation;
  simWeightedAlloc: PortfolioAllocation;
  frozen?: FrozenWeights | null;
  closedRows?: SimOutcomeRow[];
  stepPct?: number;
}): {
  points: BreakevenCurvePoint[];
  summaries: ExperimentBreakevenSummary[];
  historicalWinRate: HistoricalClosedWinRate;
  observedWinRateGrezzo: ObservedWinRateGrezzo;
  pplanDiagnosis: PplanBucketDiagnosis;
} {
  const step = args.stepPct ?? 5;
  const points: BreakevenCurvePoint[] = [];
  for (let pct = 0; pct <= 100; pct += step) {
    const p = pct / 100;
    points.push({
      winRatePct: pct,
      mineEur: Math.round(portfolioEvAtWinRate(args.mineDeals, args.mineAlloc, p)),
      simEqualEur: Math.round(
        portfolioEvAtWinRate(args.simLoopDeals, args.simEqualAlloc, p),
      ),
      simWeightedEur: Math.round(
        portfolioEvAtWinRate(args.simLoopDeals, args.simWeightedAlloc, p),
      ),
    });
  }

  const configs: Array<{
    key: ThreeExperimentKey;
    deals: ComparisonDeal[];
    alloc: PortfolioAllocation;
  }> = [
    { key: "mine", deals: args.mineDeals, alloc: args.mineAlloc },
    { key: "simEqual", deals: args.simLoopDeals, alloc: args.simEqualAlloc },
    { key: "simWeighted", deals: args.simLoopDeals, alloc: args.simWeightedAlloc },
  ];

  const summaries: ExperimentBreakevenSummary[] = configs.map(({ key, deals, alloc }) => {
    const be = breakevenWinRateForPortfolio(deals, alloc);
    const meanWr = capitalWeightedMeanCalibratedWinRate(deals, alloc);
    const meanApproved = capitalWeightedMeanApprovedComposite(deals, alloc, args.frozen);
    const { avgGainPct, avgLossPct, nDeals } = capitalWeightedPayoffs(deals, alloc);
    const breakevenWstarPct =
      avgGainPct != null &&
      avgLossPct != null &&
      avgGainPct + avgLossPct > 0
        ? Math.round((avgLossPct / (avgGainPct + avgLossPct)) * 1000) / 10
        : null;
    const universeClosed = closedRowsInDealUniverse(args.closedRows ?? [], deals);
    const observedGrezzo = observedClosedWinRateGrezzo(universeClosed);
    const realized = computeRealizedSuccessForDeals(
      args.closedRows ?? [],
      deals,
      alloc.capByTicker,
    );
    const closedStats = closedPnlStatsForUniverse(args.closedRows ?? [], deals);
    return {
      key,
      breakevenWinRatePct: be != null ? Math.round(be * 1000) / 10 : null,
      avgGainPct,
      avgLossPct,
      breakevenWstarPct,
      nDeals,
      observedWinRatePct: observedGrezzo.pct,
      observedWinWins: observedGrezzo.wins,
      observedWinN: observedGrezzo.n,
      observedWeightedWinRatePct: realized.weightedWinRatePct,
      meanCalibratedWinRatePct:
        meanWr != null ? Math.round(meanWr * 1000) / 10 : null,
      meanApprovedCompositeWinRatePct:
        meanApproved != null ? Math.round(meanApproved * 1000) / 10 : null,
      evAtMeanWinRateEur:
        meanWr != null
          ? Math.round(portfolioEvAtWinRate(deals, alloc, meanWr))
          : null,
      evAtApprovedCompositeEur:
        meanApproved != null
          ? Math.round(portfolioEvAtWinRate(deals, alloc, meanApproved))
          : null,
      closedPnlEur: closedStats.pnlEur,
      closedDealCount: closedStats.n,
      openPnlEur: Math.round(alloc.totalRealizedEur),
      openPositionsHeld: alloc.realizedPositionsCount,
    };
  });

  return {
    points,
    summaries,
    historicalWinRate: historicalClosedWinRate(args.closedRows ?? []),
    observedWinRateGrezzo: observedClosedWinRateGrezzo(args.closedRows ?? []),
    pplanDiagnosis: buildPplanBucketDiagnosis(
      args.simLoopDeals,
      args.simWeightedAlloc,
      args.frozen,
    ),
  };
}
