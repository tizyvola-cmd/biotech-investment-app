/**
 * Data builders for synthesizer / risk-pattern validation charts.
 *
 * Closed-trade strip: retrospective — does the pattern flag historical losses?
 * Lead-time scatter: forward-looking — after approval, how early did we match
 * before the position closed?
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { normalizedRowKey } from "../sheet/investSimKeys";
import { LOSS_THRESHOLD_PCT } from "../sheet/lossAuditAnalysis";
import { matchPattern } from "./lossRiskPattern";
import type { RowFeatures } from "./lossRiskScreening";
import type { RiskPattern } from "./riskPatternTypes";
import type { TradePatternLeadTime } from "./patternMatchTracker";

export type ClosedValidationPoint = {
  ticker: string;
  cd: string;
  pnlPct: number;
  isLoss: boolean;
  matchPattern: boolean;
  capitalEur: number;
  /** 0 = no match, 1 = match — jitter applied in the chart layer */
  xSlot: 0 | 1;
};

export type LeadTimeValidationPoint = {
  ticker: string;
  leadTimeDays: number;
  leadTimeHours: number;
  pnlPct: number;
  isLoss: boolean;
  capitalEur: number;
};

export type PatternValidationGrade = "insufficient" | "weak" | "ok" | "strong";

export type PatternValidationSummary = {
  closedTotal: number;
  matchedN: number;
  matchedLossN: number;
  totalLossN: number;
  /** P(loss | pattern fires) on closed trades */
  precision: number | null;
  /** P(pattern fires | loss) — recall on losses */
  recall: number | null;
  baseLossRate: number;
  lift: number | null;
  falsePositiveRate: number | null;
  grade: PatternValidationGrade;
  gradeReason: string;
};

function isResolved(r: SimOutcomeRow): boolean {
  return r.pnl_pct != null && Number.isFinite(r.pnl_pct);
}

function isLossRow(r: SimOutcomeRow): boolean {
  return (r.pnl_pct ?? 0) < LOSS_THRESHOLD_PCT;
}

/** Stable jitter in [-0.18, 0.18] from ticker+cd so dots don't overlap exactly. */
export function validationPointJitter(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return ((h & 0xffff) / 0xffff - 0.5) * 0.36;
}

export function buildClosedValidationPoints(
  pattern: RiskPattern,
  closedRows: SimOutcomeRow[],
  featuresByRowKey: Map<string, RowFeatures>,
): ClosedValidationPoint[] {
  const out: ClosedValidationPoint[] = [];
  for (const r of closedRows) {
    if (!isResolved(r)) continue;
    const pnl = r.pnl_pct!;
    const feat = featuresByRowKey.get(normalizedRowKey(r.ticker, r.completion_date));
    if (!feat) continue;
    const fires = matchPattern(pattern, feat);
    out.push({
      ticker: r.ticker,
      cd: r.completion_date,
      pnlPct: pnl,
      isLoss: isLossRow(r),
      matchPattern: fires,
      capitalEur: r.capital_eur ?? 0,
      xSlot: fires ? 1 : 0,
    });
  }
  return out;
}

export function buildLeadTimeValidationPoints(
  leadTimes: TradePatternLeadTime[],
  patternId?: string | null,
): LeadTimeValidationPoint[] {
  const filtered = patternId
    ? leadTimes.filter((r) => r.patternId === patternId)
    : leadTimes;
  return filtered
    .filter((r) => r.pnlPctSimulated != null && Number.isFinite(r.pnlPctSimulated))
    .map((r) => ({
      ticker: r.ticker,
      leadTimeDays: Math.round((r.leadTimeMs / 86_400_000) * 10) / 10,
      leadTimeHours: r.leadTimeHours,
      pnlPct: r.pnlPctSimulated!,
      isLoss: r.pnlPctSimulated! < LOSS_THRESHOLD_PCT,
      capitalEur: r.capital,
    }));
}

export function summarizeClosedValidation(
  points: ClosedValidationPoint[],
  minN = 5,
): PatternValidationSummary {
  const closedTotal = points.length;
  const matched = points.filter((p) => p.matchPattern);
  const matchedN = matched.length;
  const matchedLossN = matched.filter((p) => p.isLoss).length;
  const totalLossN = points.filter((p) => p.isLoss).length;

  const precision = matchedN > 0 ? matchedLossN / matchedN : null;
  const recall = totalLossN > 0 ? matchedLossN / totalLossN : null;
  const baseLossRate = closedTotal > 0 ? totalLossN / closedTotal : 0;
  const lift =
    precision != null && baseLossRate > 0
      ? precision / baseLossRate
      : matchedN > 0
        ? null
        : null;
  const winsMatched = matched.filter((p) => !p.isLoss).length;
  const winsTotal = points.filter((p) => !p.isLoss).length;
  const falsePositiveRate =
    winsTotal > 0 ? winsMatched / winsTotal : null;

  const { grade, gradeReason } = gradeValidation({
    matchedN,
    precision,
    recall,
    lift,
    baseLossRate,
    minN,
  });

  return {
    closedTotal,
    matchedN,
    matchedLossN,
    totalLossN,
    precision,
    recall,
    baseLossRate,
    lift: lift != null && Number.isFinite(lift) ? lift : null,
    falsePositiveRate,
    grade,
    gradeReason,
  };
}

function gradeValidation(opts: {
  matchedN: number;
  precision: number | null;
  recall: number | null;
  lift: number | null;
  baseLossRate: number;
  minN: number;
}): { grade: PatternValidationGrade; gradeReason: string } {
  if (opts.matchedN < opts.minN) {
    return {
      grade: "insufficient",
      gradeReason: `n=${opts.matchedN} matched closed trades — need ≥${opts.minN} for reliable validation`,
    };
  }
  const lift = opts.lift ?? 0;
  const prec = opts.precision ?? 0;
  if (lift >= 1.5 && prec >= opts.baseLossRate && (opts.recall ?? 0) >= 0.35) {
    return {
      grade: "strong",
      gradeReason: "Lift ≥1.5, precision above base loss rate, recall ≥35%",
    };
  }
  if (lift >= 1.0 && prec >= opts.baseLossRate * 0.9) {
    return {
      grade: "ok",
      gradeReason: "Pattern beats or matches baseline loss rate on closed trades",
    };
  }
  if (prec < opts.baseLossRate * 0.5 && opts.matchedN >= opts.minN) {
    return {
      grade: "weak",
      gradeReason: "Matched trades lose less often than baseline — pattern may not predict failures",
    };
  }
  return {
    grade: "weak",
    gradeReason: "Lift below 1 — pattern does not concentrate losses on closed history",
  };
}

export function medianLeadTimeDays(points: LeadTimeValidationPoint[]): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].map((p) => p.leadTimeDays).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
