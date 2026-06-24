/**
 * Solidità ingresso — stesso Score Reliability del Decision Lab (0–100).
 * Non usa soglia Conf % separata: composito score + fasce trade-calib.
 */
import type { Top2PickSignal } from "./top2PortfolioPick";
import type { StrictTopOppOpts } from "./topOppsStrictPick";
import { isHotZone, isWatchZone } from "./cdHorizons";
import { extractCurveInputs } from "./precatCurve";
import { tradeCalibThreshold } from "./investmentTradeCalib";
import {
  computeScoreBreakdown,
  computeSignalScore,
  scoreReliabilityTier,
  signalMetricsFromSimRow,
  type ScoreBreakdown,
  type SignalMetricsFromRowOptions,
  type SimSignalMetrics,
} from "./investSignalScore";

export type ReliabilitySolidityFailure = {
  code: "low_score_reliability";
  detail?: string;
};

export function reliabilityScoreMinForDays(days: number | null | undefined): number {
  if (isHotZone(days)) return tradeCalibThreshold("score_forte_min");
  if (isWatchZone(days)) return tradeCalibThreshold("score_watch_min");
  return tradeCalibThreshold("score_monitor_min");
}

function columnsForPick(s: Top2PickSignal, opts?: StrictTopOppOpts): string[] {
  if (opts?.simColumns?.length) return opts.simColumns;
  const row = s.simRow;
  return row ? Object.keys(row) : [];
}

function mergedReliabilityMetricsOptions(
  s: Top2PickSignal,
  opts?: StrictTopOppOpts,
): SignalMetricsFromRowOptions {
  const fromOpts = opts?.reliabilityMetricsOptions;
  return {
    chartPoints: fromOpts?.chartPoints ?? s.chartPoints ?? null,
    signCurveView: fromOpts?.signCurveView,
    expectedHitPct: fromOpts?.expectedHitPct,
  };
}

export function pickReliabilityMetrics(
  s: Top2PickSignal,
  opts?: StrictTopOppOpts,
): SimSignalMetrics | null {
  const row = s.simRow;
  const scoreOpts = mergedReliabilityMetricsOptions(s, opts);
  if (row && Object.keys(row).length > 0) {
    return signalMetricsFromSimRow(row, columnsForPick(s, opts), scoreOpts);
  }
  const { slope5d, slope20d } = row
    ? extractCurveInputs(row)
    : { slope5d: null as number | null, slope20d: null as number | null };
  const score = computeSignalScore(
    s.affid ?? null,
    s.r2 ?? null,
    s.pred5 ?? null,
    s.days ?? null,
    slope5d,
    null,
    slope20d,
    scoreOpts,
  );
  if (score == null && s.affid == null && s.r2 == null) return null;
  return {
    score,
    affidPct: s.affid != null ? Math.round(s.affid * 1000) / 10 : null,
    r2: s.r2 ?? null,
    pred5Pp: s.pred5 ?? null,
    daysToCd: s.days ?? null,
    gapPct: null,
  };
}

export function passesReliabilityForSolidity(
  s: Top2PickSignal,
  minScoreOverride?: number | null,
  opts?: StrictTopOppOpts,
): boolean {
  const m = pickReliabilityMetrics(s, opts);
  if (m?.score == null || !Number.isFinite(m.score)) return false;
  const min =
    minScoreOverride != null && Number.isFinite(minScoreOverride)
      ? minScoreOverride
      : reliabilityScoreMinForDays(s.days);
  return m.score >= min;
}

export function appendReliabilitySolidityFailures(
  out: { code: string; detail?: string }[],
  s: Top2PickSignal,
  minScoreOverride?: number | null,
  opts?: StrictTopOppOpts,
): void {
  const m = pickReliabilityMetrics(s, opts);
  const min =
    minScoreOverride != null && Number.isFinite(minScoreOverride)
      ? minScoreOverride
      : reliabilityScoreMinForDays(s.days);

  if (m?.score == null || !Number.isFinite(m.score)) {
    out.push({ code: "low_score_reliability", detail: `— < ${min}` });
    return;
  }
  if (m.score < min) {
    out.push({
      code: "low_score_reliability",
      detail: `${Math.round(m.score)} < ${min}`,
    });
  }
}

export function pickScoreBreakdown(
  s: Top2PickSignal,
  opts?: StrictTopOppOpts,
): ScoreBreakdown | null {
  const m = pickReliabilityMetrics(s, opts);
  if (!m) return null;
  const row = s.simRow;
  const { slope5d, slope20d } = row
    ? extractCurveInputs(row)
    : { slope5d: null as number | null, slope20d: null as number | null };
  const scoreOpts = mergedReliabilityMetricsOptions(s, opts);
  return computeScoreBreakdown(
    m.affidPct != null ? m.affidPct / 100 : null,
    m.r2,
    m.pred5Pp,
    m.daysToCd,
    slope5d,
    m.gapPct,
    slope20d,
    scoreOpts,
  );
}

export function reliabilitySoliditySummary(
  s: Top2PickSignal,
  lang: "it" | "en" = "it",
  opts?: StrictTopOppOpts,
): { score: number | null; min: number; tierLabel: string | null; line: string | null } {
  const m = pickReliabilityMetrics(s, opts);
  const min = reliabilityScoreMinForDays(s.days);
  const score = m?.score ?? null;
  const tier = score != null ? scoreReliabilityTier(score) : null;
  const tierLabel = tier ? (lang === "it" ? tier.labelIt : tier.labelEn) : null;
  if (score == null) {
    return { score: null, min, tierLabel: null, line: null };
  }
  const line =
    lang === "it"
      ? `Score Reliability ${Math.round(score)}/100 (${tierLabel ?? "—"}) · min ${min}`
      : `Score Reliability ${Math.round(score)}/100 (${tierLabel ?? "—"}) · min ${min}`;
  return { score, min, tierLabel, line };
}

/** Mapping legacy slider Conf % → pavimento score (override esplicito). */
export function legacyMinAffidPctToScoreFloor(affidPct: number): number {
  if (affidPct >= 65) return tradeCalibThreshold("score_forte_min");
  if (affidPct >= 50) return tradeCalibThreshold("score_watch_min");
  return tradeCalibThreshold("score_monitor_min");
}
