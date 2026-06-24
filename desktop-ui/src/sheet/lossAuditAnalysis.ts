/**
 * Loss Audit — statistical analysis of closed trades that ended in loss.
 *
 * Goal: separate losses that happened "as predicted" (model warned us:
 * P(plan) < 50% or pred direction down) from losses that happened
 * "despite the predictions" (model said P(plan) ≥ 50% → false positive of
 * the model). The latter are the real failure modes worth diversifying away.
 *
 * Output feeds:
 *   - Loss Audit UI (Capital & diversification tab)
 *   - Step 2: diversification engine penalizing categories with high
 *     surprise-loss rate.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import {
  clinicalPhaseFromSimRow,
  clinicalIndicationFromSimRow,
} from "./simRowClinicalMeta";
import { buildSimRowByKeyMap, normalizedRowKey } from "./investSimKeys";

/** A trade is a "loss" if pnl_pct < this threshold (% units, e.g. -2). */
export const LOSS_THRESHOLD_PCT = -2;
/** A trade was "optimistic" (model expected win) if P(plan) ≥ this %. */
export const OPTIMISTIC_PPLAN_PCT = 50;

export type CategoryBreakdown = {
  key: string;
  label: string;
  n: number;
  wins: number;
  losses: number;
  lossRatePct: number;
  surpriseLosses: number;
  surpriseRatePct: number;
  avgPnlPct: number;
  avgLossPct: number;
  realizedPnlEur: number;
  capitalEur: number;
};

export type CalibrationBin = {
  binLabel: string;
  pPlanLo: number;
  pPlanHi: number;
  n: number;
  meanPPlanPct: number;
  actualWinRatePct: number;
  deltaPct: number;
};

export type TimingBucket = {
  binLabel: string;
  loDays: number;
  hiDays: number;
  n: number;
  avgLossPct: number;
  realizedLossEur: number;
};

export type ConfusionMatrix = {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  totalTrades: number;
  pPlanThreshold: number;
};

export type LossAuditSummary = {
  totalClosed: number;
  totalWins: number;
  totalLosses: number;
  totalFlat: number;
  lossRatePct: number;
  winRatePct: number;
  surpriseLosses: number;
  expectedLosses: number;
  surpriseRatePct: number;
  totalCapitalEur: number;
  realizedLossEur: number;
  avgLossPct: number;
  avgLossEur: number;
  avgWinPct: number;
  avgWinEur: number;
  /** E[trade] = winRate*avgWin + lossRate*avgLoss (signed). */
  expectancyEurPerTrade: number | null;
};

export type LossAuditResult = {
  summary: LossAuditSummary;
  confusion: ConfusionMatrix;
  byPhase: CategoryBreakdown[];
  byIndication: CategoryBreakdown[];
  bySds: CategoryBreakdown[];
  byPplan: CategoryBreakdown[];
  calibration: CalibrationBin[];
  timing: TimingBucket[];
};

/** Phase canonical buckets — extract first digit from string like "Phase 2/3". */
export function bucketClinicalPhase(raw: string): string {
  if (!raw) return "Unknown";
  const lo = raw.toLowerCase();
  if (lo.includes("approv") || lo.includes("marketed") || lo.includes("comm")) {
    return "Approved";
  }
  if (/phase\s*4|fase\s*4/.test(lo) || /\bp4\b/.test(lo)) return "Phase 4";
  if (/phase\s*3|fase\s*3/.test(lo) || /\bp3\b/.test(lo)) return "Phase 3";
  if (/phase\s*2|fase\s*2/.test(lo) || /\bp2\b/.test(lo)) return "Phase 2";
  if (/phase\s*1|fase\s*1/.test(lo) || /\bp1\b/.test(lo)) return "Phase 1";
  if (/preclin|pre-clin/.test(lo)) return "Preclinical";
  return "Other";
}

const PHASE_SORT_ORDER: Record<string, number> = {
  Preclinical: 0,
  "Phase 1": 1,
  "Phase 2": 2,
  "Phase 3": 3,
  "Phase 4": 4,
  Approved: 5,
  Other: 6,
  Unknown: 7,
};

/** Indication coarse grouping by keyword (oncology, neurology, etc.). */
export function bucketIndication(raw: string): string {
  if (!raw) return "Unknown";
  const lo = raw.toLowerCase();
  if (/onco|tumor|cancer|carcin|leuk|lymph|myelo|sarcoma|melanoma|glioma/.test(lo)) {
    return "Oncology";
  }
  if (/neuro|alzheimer|parkinson|als|huntington|epilep|migrain|sclero/.test(lo)) {
    return "Neurology";
  }
  if (/cardio|heart|stroke|hypertens|atrial|coronar/.test(lo)) return "Cardio";
  if (/immun|inflam|arthr|psoriasis|lupus|crohn|ulcerat|ibd|colit/.test(lo)) {
    return "Immunology";
  }
  if (/infect|virus|covid|hiv|hepatit|bacter|antibiotic|pneumoni/.test(lo)) {
    return "Infectious";
  }
  if (/diab|obesit|metabol|nash|liver/.test(lo)) return "Metab/Liver";
  if (/rare|orphan|gene|hered/.test(lo)) return "Rare/Genetic";
  if (/oph|eye|retin|macular/.test(lo)) return "Ophthalmology";
  if (/respir|lung|asthma|copd|cystic/.test(lo)) return "Respiratory";
  return "Other";
}

/** SDS bins (4 buckets). */
export function bucketSds(sds: number | null | undefined): string {
  if (sds == null || !Number.isFinite(sds)) return "No SDS";
  if (sds < 40) return "SDS <40 (Low)";
  if (sds < 55) return "SDS 40-55 (Mid)";
  if (sds < 70) return "SDS 55-70 (High)";
  return "SDS ≥70 (Premium)";
}

const SDS_SORT_ORDER: Record<string, number> = {
  "SDS <40 (Low)": 0,
  "SDS 40-55 (Mid)": 1,
  "SDS 55-70 (High)": 2,
  "SDS ≥70 (Premium)": 3,
  "No SDS": 4,
};

/** P(plan) bins (4 buckets). */
export function bucketPplan(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "P(plan) n/a";
  if (p < 30) return "P(plan) <30%";
  if (p < 50) return "P(plan) 30-50%";
  if (p < 70) return "P(plan) 50-70%";
  return "P(plan) ≥70%";
}

const PPLAN_SORT_ORDER: Record<string, number> = {
  "P(plan) <30%": 0,
  "P(plan) 30-50%": 1,
  "P(plan) 50-70%": 2,
  "P(plan) ≥70%": 3,
  "P(plan) n/a": 4,
};

function isClosedRow(r: SimOutcomeRow): boolean {
  // pnl_pct must be a finite number → trade actually realized
  return r.pnl_pct != null && Number.isFinite(r.pnl_pct);
}

function isLoss(r: SimOutcomeRow): boolean {
  return (r.pnl_pct ?? 0) < LOSS_THRESHOLD_PCT;
}

function isWin(r: SimOutcomeRow): boolean {
  // Symmetric: win > +LOSS_THRESHOLD (so flat band ±2% is excluded from both)
  return (r.pnl_pct ?? 0) > -LOSS_THRESHOLD_PCT;
}

function wasOptimistic(r: SimOutcomeRow): boolean {
  const p = r.affidabilita_pct;
  return p != null && Number.isFinite(p) && p >= OPTIMISTIC_PPLAN_PCT;
}

/** Aggregate trades into a category breakdown row. */
function buildCategory(
  key: string,
  label: string,
  rows: SimOutcomeRow[],
): CategoryBreakdown {
  const n = rows.length;
  let wins = 0;
  let losses = 0;
  let surpriseLosses = 0;
  let sumPnlPct = 0;
  let sumLossPct = 0;
  let realizedPnlEur = 0;
  let capitalEur = 0;
  for (const r of rows) {
    sumPnlPct += r.pnl_pct ?? 0;
    realizedPnlEur += r.pnl_eur ?? 0;
    capitalEur += r.capital_eur ?? 0;
    if (isWin(r)) wins++;
    if (isLoss(r)) {
      losses++;
      sumLossPct += r.pnl_pct ?? 0;
      if (wasOptimistic(r)) surpriseLosses++;
    }
  }
  return {
    key,
    label,
    n,
    wins,
    losses,
    lossRatePct: n > 0 ? (losses / n) * 100 : 0,
    surpriseLosses,
    surpriseRatePct: losses > 0 ? (surpriseLosses / losses) * 100 : 0,
    avgPnlPct: n > 0 ? sumPnlPct / n : 0,
    avgLossPct: losses > 0 ? sumLossPct / losses : 0,
    realizedPnlEur,
    capitalEur,
  };
}

function sortByCategoryRisk(rows: CategoryBreakdown[]): CategoryBreakdown[] {
  // Surprise rate desc, then n desc — most informative on top
  return rows.slice().sort((a, b) => {
    if (a.n === 0 && b.n === 0) return 0;
    if (a.n === 0) return 1;
    if (b.n === 0) return -1;
    if (b.surpriseRatePct !== a.surpriseRatePct) {
      return b.surpriseRatePct - a.surpriseRatePct;
    }
    return b.losses - a.losses;
  });
}

/** Main entry point — compute the full audit. */
export function computeLossAudit(
  closedRows: SimOutcomeRow[] | null | undefined,
  opts?: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
  },
): LossAuditResult | null {
  if (!closedRows?.length) return null;
  const rows = closedRows.filter(isClosedRow);
  if (!rows.length) return null;

  const simRowByKey = opts?.simTable?.rows
    ? buildSimRowByKeyMap(opts.simTable.rows as Record<string, unknown>[])
    : new Map<string, Record<string, unknown>>();
  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of opts?.sdsRows ?? []) {
    if (s.ticker) sdsByTicker.set(s.ticker.toUpperCase(), s);
  }

  // ── Summary ────────────────────────────────────────────────────────────
  let wins = 0;
  let losses = 0;
  let surprise = 0;
  let expected = 0;
  let realizedLossEur = 0;
  let realizedWinEur = 0;
  let totalCapitalEur = 0;
  let sumLossPct = 0;
  let sumWinPct = 0;
  for (const r of rows) {
    totalCapitalEur += r.capital_eur ?? 0;
    if (isWin(r)) {
      wins++;
      sumWinPct += r.pnl_pct ?? 0;
      realizedWinEur += r.pnl_eur ?? 0;
    } else if (isLoss(r)) {
      losses++;
      sumLossPct += r.pnl_pct ?? 0;
      realizedLossEur += r.pnl_eur ?? 0;
      if (wasOptimistic(r)) surprise++;
      else expected++;
    }
  }
  const totalClosed = rows.length;
  const totalFlat = totalClosed - wins - losses;
  const decisive = wins + losses;
  const winRate = decisive > 0 ? wins / decisive : null;
  const avgWinEur = wins > 0 ? realizedWinEur / wins : 0;
  const avgLossEur = losses > 0 ? realizedLossEur / losses : 0;
  const expectancyEurPerTrade =
    winRate != null
      ? winRate * avgWinEur + (1 - winRate) * avgLossEur
      : null;
  const summary: LossAuditSummary = {
    totalClosed,
    totalWins: wins,
    totalLosses: losses,
    totalFlat,
    lossRatePct: totalClosed > 0 ? (losses / totalClosed) * 100 : 0,
    winRatePct: totalClosed > 0 ? (wins / totalClosed) * 100 : 0,
    surpriseLosses: surprise,
    expectedLosses: expected,
    surpriseRatePct: losses > 0 ? (surprise / losses) * 100 : 0,
    totalCapitalEur,
    realizedLossEur,
    avgLossPct: losses > 0 ? sumLossPct / losses : 0,
    avgLossEur,
    avgWinPct: wins > 0 ? sumWinPct / wins : 0,
    avgWinEur,
    expectancyEurPerTrade,
  };

  // ── Confusion matrix (P(plan) ≥ 50% optimism vs realized direction) ────
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let confusionTotal = 0;
  for (const r of rows) {
    if (r.affidabilita_pct == null || !Number.isFinite(r.affidabilita_pct)) continue;
    const optimist = wasOptimistic(r);
    if (isWin(r)) {
      confusionTotal++;
      if (optimist) tp++;
      else fn++;
    } else if (isLoss(r)) {
      confusionTotal++;
      if (optimist) fp++;
      else tn++;
    }
  }
  const confusion: ConfusionMatrix = {
    tp,
    fp,
    fn,
    tn,
    totalTrades: confusionTotal,
    pPlanThreshold: OPTIMISTIC_PPLAN_PCT,
  };

  // ── Helpers to enrich rows with phase / indication / SDS ──────────────
  const rowMeta = (r: SimOutcomeRow) => {
    const key = normalizedRowKey(r.ticker, r.completion_date);
    const simRow = simRowByKey.get(key);
    const phaseRaw = simRow ? clinicalPhaseFromSimRow(simRow) : "";
    const indicationRaw = simRow ? clinicalIndicationFromSimRow(simRow, 200) : "";
    const sds = sdsByTicker.get(r.ticker.toUpperCase());
    return {
      phase: bucketClinicalPhase(phaseRaw),
      indication: bucketIndication(indicationRaw),
      sdsBucket: bucketSds(sds?.sds ?? null),
      pPlanBucket: bucketPplan(r.affidabilita_pct ?? null),
    };
  };
  const enriched = rows.map((r) => ({ row: r, meta: rowMeta(r) }));

  // ── Breakdown per phase / indication / SDS / P(plan) ──────────────────
  const phaseGroups = new Map<string, SimOutcomeRow[]>();
  for (const e of enriched) {
    const k = e.meta.phase;
    let arr = phaseGroups.get(k);
    if (!arr) {
      arr = [];
      phaseGroups.set(k, arr);
    }
    arr.push(e.row);
  }
  const byPhase: CategoryBreakdown[] = [];
  for (const [phase, rs] of phaseGroups) {
    byPhase.push(buildCategory(phase, phase, rs));
  }
  byPhase.sort(
    (a, b) =>
      (PHASE_SORT_ORDER[a.key] ?? 99) - (PHASE_SORT_ORDER[b.key] ?? 99),
  );

  const indicationGroups = new Map<string, SimOutcomeRow[]>();
  for (const e of enriched) {
    const k = e.meta.indication;
    let arr = indicationGroups.get(k);
    if (!arr) {
      arr = [];
      indicationGroups.set(k, arr);
    }
    arr.push(e.row);
  }
  const byIndication: CategoryBreakdown[] = [];
  for (const [ind, rs] of indicationGroups) {
    byIndication.push(buildCategory(ind, ind, rs));
  }
  byIndication.sort((a, b) => b.n - a.n);

  const sdsGroups = new Map<string, SimOutcomeRow[]>();
  for (const e of enriched) {
    const k = e.meta.sdsBucket;
    let arr = sdsGroups.get(k);
    if (!arr) {
      arr = [];
      sdsGroups.set(k, arr);
    }
    arr.push(e.row);
  }
  const bySds: CategoryBreakdown[] = [];
  for (const [k, rs] of sdsGroups) {
    bySds.push(buildCategory(k, k, rs));
  }
  bySds.sort(
    (a, b) =>
      (SDS_SORT_ORDER[a.key] ?? 99) - (SDS_SORT_ORDER[b.key] ?? 99),
  );

  const pplanGroups = new Map<string, SimOutcomeRow[]>();
  for (const e of enriched) {
    const k = e.meta.pPlanBucket;
    let arr = pplanGroups.get(k);
    if (!arr) {
      arr = [];
      pplanGroups.set(k, arr);
    }
    arr.push(e.row);
  }
  const byPplan: CategoryBreakdown[] = [];
  for (const [k, rs] of pplanGroups) {
    byPplan.push(buildCategory(k, k, rs));
  }
  byPplan.sort(
    (a, b) =>
      (PPLAN_SORT_ORDER[a.key] ?? 99) - (PPLAN_SORT_ORDER[b.key] ?? 99),
  );

  // ── Calibration P(plan) bin → actual win rate ─────────────────────────
  const calibBins: Array<{ lo: number; hi: number; label: string }> = [
    { lo: 0, hi: 30, label: "0-30%" },
    { lo: 30, hi: 50, label: "30-50%" },
    { lo: 50, hi: 70, label: "50-70%" },
    { lo: 70, hi: 101, label: "70-100%" },
  ];
  const calibration: CalibrationBin[] = calibBins.map(({ lo, hi, label }) => {
    const bucket = rows.filter(
      (r) =>
        r.affidabilita_pct != null &&
        Number.isFinite(r.affidabilita_pct) &&
        r.affidabilita_pct >= lo &&
        r.affidabilita_pct < hi,
    );
    const n = bucket.length;
    let winsInBin = 0;
    let sumP = 0;
    for (const r of bucket) {
      sumP += r.affidabilita_pct ?? 0;
      if (isWin(r)) winsInBin++;
    }
    const meanP = n > 0 ? sumP / n : (lo + hi) / 2;
    const actual = n > 0 ? (winsInBin / n) * 100 : 0;
    return {
      binLabel: label,
      pPlanLo: lo,
      pPlanHi: hi,
      n,
      meanPPlanPct: meanP,
      actualWinRatePct: actual,
      deltaPct: actual - meanP,
    };
  });

  // ── Timing of losses (holding_days buckets) ───────────────────────────
  const timingBins: Array<{ lo: number; hi: number; label: string }> = [
    { lo: 0, hi: 7, label: "0-7d (crash)" },
    { lo: 7, hi: 30, label: "8-30d (early)" },
    { lo: 30, hi: 90, label: "31-90d (mid)" },
    { lo: 90, hi: Infinity, label: ">90d (slow)" },
  ];
  const lossRows = rows.filter(isLoss);
  const timing: TimingBucket[] = timingBins.map(({ lo, hi, label }) => {
    const bucket = lossRows.filter((r) => {
      const d = r.holding_days;
      if (d == null || !Number.isFinite(d)) return lo === 0;
      return d >= lo && d < hi;
    });
    let sumPct = 0;
    let sumEur = 0;
    for (const r of bucket) {
      sumPct += r.pnl_pct ?? 0;
      sumEur += r.pnl_eur ?? 0;
    }
    return {
      binLabel: label,
      loDays: lo,
      hiDays: Number.isFinite(hi) ? hi : 999,
      n: bucket.length,
      avgLossPct: bucket.length > 0 ? sumPct / bucket.length : 0,
      realizedLossEur: sumEur,
    };
  });

  return {
    summary,
    confusion,
    byPhase,
    byIndication,
    bySds,
    byPplan,
    calibration,
    timing,
  };
}

export const __test_helpers = {
  bucketClinicalPhase,
  bucketIndication,
  bucketSds,
  bucketPplan,
  sortByCategoryRisk,
};
