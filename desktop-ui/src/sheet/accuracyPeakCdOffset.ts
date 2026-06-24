/**
 * Peak success / sign-hit by days-to-CD bin (same bins as sign_curve_daily).
 * Used to annotate Accuracy dashboard metrics, e.g. "54.2% (88.9% max a T-5 dal CD)".
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { directionHit } from "./accuracyMetrics";
import type {
  DecisionPrecisionSummary,
  NumericalForecastSummary,
} from "./accuracySummary";
import type { AdviceCalibrationPoint } from "./investDecisionSimAdviceCalibration";
import {
  normalizeAdviceAction,
} from "./investDecisionSimAdviceCalibration";
import { realizedPnlPctFromOutcome } from "./outcomePnlDisplay";
import { buildPlanProbLearningSummary } from "./planProbOutcomeAudit";
import type { IntrinsicSourceSummary } from "./intrinsicRecommendationEfficiency";
import {
  formatSignPeakOffset,
  peakSignHitFromPoints,
  type SignAccuracyCurveView,
} from "./signAccuracyCurve";

/** Mirrors prediction/sign_curve_daily.py SIGN_CURVE_X_OFFSETS. */
export const SIGN_CURVE_BIN_OFFSETS = [
  -60, -50, -40, -30, -20, -10, -7, -5, -3, -1, 1, 3, 5, 7,
] as const;

const DECADE_OFFSETS = new Set([-60, -50, -40, -30, -20]);
const NUMERICAL_FLAT_BAND_PP = 0.5;
const DEFAULT_MIN_BIN_N = 2;

function binRange(off: number): [number, number] {
  if (DECADE_OFFSETS.has(off)) return [off, Math.min(-1, off + 9)];
  return [off, off];
}

/** Map positive days-to-CD → calendar offset (T-45 → -45). */
export function calOffsetFromDaysToCd(daysToCd: number): number {
  return daysToCd > 0 ? -Math.round(daysToCd) : Math.round(daysToCd);
}

export function binCalOffsetFromDaysToCd(daysToCd: number | null | undefined): number | null {
  if (daysToCd == null || !Number.isFinite(daysToCd)) return null;
  const calOff = calOffsetFromDaysToCd(daysToCd);
  for (const x of SIGN_CURVE_BIN_OFFSETS) {
    const [lo, hi] = binRange(x);
    if (lo <= calOff && calOff <= hi) return x;
  }
  return null;
}

export function readDaysToCdFromSimRow(row: Record<string, unknown> | undefined): number | null {
  if (!row) return null;
  const raw = row["Days to CD"] ?? row["Days"] ?? row["days_to_cd"];
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export type PeakCdBin = { offset: number; pct: number; n?: number };

export function formatPeakCdLabel(offset: number, lang: "it" | "en"): string {
  const tail = formatSignPeakOffset(offset);
  if (lang === "it") return `max a T${tail} dal CD`;
  return `max at T${tail} from CD`;
}

export function formatPeakCdAnnotation(
  peak: PeakCdBin | null | undefined,
  lang: "it" | "en",
): string | null {
  if (!peak) return null;
  const tail = formatSignPeakOffset(peak.offset);
  const pctStr = `${peak.pct.toFixed(1)}%`;
  if (lang === "it") return `${pctStr} max a T${tail} dal CD`;
  return `${pctStr} max at T${tail} from CD`;
}

export function formatPeakCdLabelFromSignCurve(
  view: SignAccuracyCurveView | null | undefined,
  lang: "it" | "en",
): string | null {
  const peak = peakSignHitFromPoints(view?.points ?? []);
  if (!peak) return null;
  return formatPeakCdAnnotation({ offset: peak.offset, pct: peak.pct }, lang);
}

type BinAgg = { hits: number; n: number };

function pickPeakBin(
  byBin: Map<number, BinAgg>,
  minBinN: number,
): { offset: number; pct: number; n: number } | null {
  let best: { offset: number; pct: number; n: number } | null = null;
  for (const [offset, { hits, n }] of byBin) {
    if (n < minBinN) continue;
    const pct = Math.round((hits / n) * 1000) / 10;
    if (!best || pct > best.pct || (pct === best.pct && n > best.n)) {
      best = { offset, pct, n };
    }
  }
  return best;
}

function isSignHit(expected: number, actual: number): boolean {
  return (
    directionHit(expected, actual, NUMERICAL_FLAT_BAND_PP) ||
    (Math.abs(expected) < NUMERICAL_FLAT_BAND_PP && Math.abs(actual) < NUMERICAL_FLAT_BAND_PP)
  );
}

function addOutcomeToBin(
  byBin: Map<number, BinAgg>,
  daysToCd: number | null | undefined,
  good: boolean,
): void {
  const bin = binCalOffsetFromDaysToCd(daysToCd);
  if (bin == null) return;
  const bucket = byBin.get(bin) ?? { hits: 0, n: 0 };
  bucket.n += 1;
  if (good) bucket.hits += 1;
  byBin.set(bin, bucket);
}

export function peakCdFromAdvicePoints(
  points: AdviceCalibrationPoint[],
  opts: {
    action?: "buy" | "sell" | "all";
    mode: "outcome" | "signHit";
    minBinN?: number;
  },
): { offset: number; pct: number; n: number } | null {
  const minN = opts.minBinN ?? DEFAULT_MIN_BIN_N;
  const byBin = new Map<number, BinAgg>();

  for (const p of points) {
    if (opts.action === "buy" && p.suggestedAction !== "buy") continue;
    if (opts.action === "sell" && p.suggestedAction !== "sell") continue;

    if (opts.mode === "outcome") {
      if (p.outcome !== "good" && p.outcome !== "bad") continue;
      addOutcomeToBin(byBin, p.daysToCdAtAdvice, p.outcome === "good");
      continue;
    }

    const action = normalizeAdviceAction(p.suggestedAction);
    if (action !== "buy" && action !== "sell") continue;
    if (p.expectedReturnPct == null || !Number.isFinite(p.expectedReturnPct)) continue;
    if (p.priceChangePct == null || !Number.isFinite(p.priceChangePct)) continue;
    const bin = binCalOffsetFromDaysToCd(p.daysToCdAtAdvice);
    if (bin == null) continue;
    const bucket = byBin.get(bin) ?? { hits: 0, n: 0 };
    bucket.n += 1;
    if (isSignHit(p.expectedReturnPct, p.priceChangePct)) bucket.hits += 1;
    byBin.set(bin, bucket);
  }

  return pickPeakBin(byBin, minN);
}

function signalGood(result: unknown): boolean | null {
  if (result === "success") return true;
  if (result === "failure") return false;
  return null;
}

export function peakCdFromSimOutcomeSignals(
  rows: SimOutcomeRow[],
  field: "buy_signal_result" | "sell_signal_result",
  minBinN = DEFAULT_MIN_BIN_N,
): { offset: number; pct: number; n: number } | null {
  const byBin = new Map<number, BinAgg>();
  for (const r of rows) {
    const good = signalGood(r[field]);
    if (good == null) continue;
    addOutcomeToBin(byBin, r.days_to_cd, good);
  }
  return pickPeakBin(byBin, minBinN);
}

export function peakCdFromSimOutcomeSign(
  closedRows: SimOutcomeRow[],
  minBinN = DEFAULT_MIN_BIN_N,
): { offset: number; pct: number; n: number } | null {
  const byBin = new Map<number, BinAgg>();
  for (const r of closedRows) {
    const actual = realizedPnlPctFromOutcome(r);
    const expected = r.entry_pred7_pp ?? r.pred7_pp ?? null;
    if (actual == null || !Number.isFinite(actual)) continue;

    let hit: boolean | null = null;
    if (expected != null && Number.isFinite(expected)) {
      hit = isSignHit(expected, actual);
    } else if (typeof r.pred_direction_hit === "boolean") {
      hit = r.pred_direction_hit;
    }
    if (hit == null) continue;

    const bin = binCalOffsetFromDaysToCd(r.days_to_cd);
    if (bin == null) continue;
    const bucket = byBin.get(bin) ?? { hits: 0, n: 0 };
    bucket.n += 1;
    if (hit) bucket.hits += 1;
    byBin.set(bin, bucket);
  }
  return pickPeakBin(byBin, minBinN);
}

export function peakCdFromSimOutcomeWinRate(
  closedRows: SimOutcomeRow[],
  minBinN = DEFAULT_MIN_BIN_N,
): { offset: number; pct: number; n: number } | null {
  const byBin = new Map<number, BinAgg>();
  for (const r of closedRows) {
    const pnl = realizedPnlPctFromOutcome(r);
    if (pnl == null || !Number.isFinite(pnl)) continue;
    addOutcomeToBin(byBin, r.days_to_cd, pnl > 0);
  }
  return pickPeakBin(byBin, minBinN);
}

export function peakCdFromAuditOutcomes(
  items: Array<{ daysToCd: number | null | undefined; correct: boolean | null }>,
  minBinN = DEFAULT_MIN_BIN_N,
): { offset: number; pct: number; n: number } | null {
  const byBin = new Map<number, BinAgg>();
  for (const item of items) {
    if (item.correct == null) continue;
    addOutcomeToBin(byBin, item.daysToCd, item.correct);
  }
  return pickPeakBin(byBin, minBinN);
}

export type AdviceOutcomeBinRate = { pct: number; n: number; offset: number };

export type AdviceOutcomeBinnedSummary = {
  overallPct: number | null;
  minPct: number | null;
  minOffset: number | null;
  maxPct: number | null;
  maxOffset: number | null;
  n: number;
  byBin: Map<number, AdviceOutcomeBinRate>;
};

function buildByBinFromOutcomeItems(
  items: Array<{ daysToCd: number | null | undefined; correct: boolean | null }>,
): Map<number, BinAgg> {
  const byBin = new Map<number, BinAgg>();
  for (const item of items) {
    if (item.correct == null) continue;
    addOutcomeToBin(byBin, item.daysToCd, item.correct);
  }
  return byBin;
}

export function summarizeAdviceOutcomeBins(
  byBin: Map<number, BinAgg>,
  minBinN = DEFAULT_MIN_BIN_N,
): AdviceOutcomeBinnedSummary {
  const byBinRates = new Map<number, AdviceOutcomeBinRate>();
  let sumWeighted = 0;
  let totalN = 0;
  let minBin: AdviceOutcomeBinRate | null = null;
  let maxBin: AdviceOutcomeBinRate | null = null;

  for (const [offset, { hits, n }] of byBin) {
    if (n <= 0) continue;
    const pct = Math.round((hits / n) * 1000) / 10;
    const rate: AdviceOutcomeBinRate = { pct, n, offset };
    byBinRates.set(offset, rate);
    sumWeighted += pct * n;
    totalN += n;
    if (n < minBinN) continue;
    if (!minBin || pct < minBin.pct || (pct === minBin.pct && offset < minBin.offset)) {
      minBin = rate;
    }
    if (!maxBin || pct > maxBin.pct || (pct === maxBin.pct && n > maxBin.n)) {
      maxBin = rate;
    }
  }

  return {
    overallPct: totalN > 0 ? Math.round((sumWeighted / totalN) * 10) / 10 : null,
    minPct: minBin?.pct ?? null,
    minOffset: minBin?.offset ?? null,
    maxPct: maxBin?.pct ?? null,
    maxOffset: maxBin?.offset ?? null,
    n: totalN,
    byBin: byBinRates,
  };
}

export function buildAdviceOutcomeBinnedSummary(
  items: Array<{ daysToCd: number | null | undefined; correct: boolean | null }>,
): AdviceOutcomeBinnedSummary {
  return summarizeAdviceOutcomeBins(buildByBinFromOutcomeItems(items));
}

/** Min/max T-offset range — same format as model intrinsic metrics. */
export function formatAdviceOutcomeRangeLabel(
  summary: AdviceOutcomeBinnedSummary,
  lang: "it" | "en",
): string | null {
  if (
    summary.minPct == null ||
    summary.maxPct == null ||
    summary.minOffset == null ||
    summary.maxOffset == null
  ) {
    return null;
  }
  const minT = formatSignPeakOffset(summary.minOffset);
  const maxT = formatSignPeakOffset(summary.maxOffset);
  if (lang === "it") {
    return `spread bin T-CD: min ${summary.minPct.toFixed(1)}% T${minT} · max ${summary.maxPct.toFixed(1)}% T${maxT}`;
  }
  return `T-CD bin spread: min ${summary.minPct.toFixed(1)}% T${minT} · max ${summary.maxPct.toFixed(1)}% T${maxT}`;
}

/** Expected advice success % at the recommendation's days-to-CD bin. */
export function expectedAdviceOutcomeAtDaysToCd(
  daysToCd: number | null | undefined,
  summary: AdviceOutcomeBinnedSummary | null | undefined,
): AdviceOutcomeBinRate | null {
  if (!summary?.byBin.size) return null;

  const calOff =
    daysToCd != null && Number.isFinite(daysToCd) && daysToCd > 0
      ? calOffsetFromDaysToCd(daysToCd)
      : null;
  let calBin = binCalOffsetFromDaysToCd(daysToCd);
  if (calBin == null && calOff != null) {
    let nearestOff: number | null = null;
    let bestDist = Infinity;
    for (const x of SIGN_CURVE_BIN_OFFSETS) {
      const dist = Math.abs(x - calOff);
      if (dist < bestDist || (dist === bestDist && nearestOff != null && x > nearestOff)) {
        bestDist = dist;
        nearestOff = x;
      }
    }
    calBin = nearestOff;
  }

  if (calBin != null) {
    const exact = summary.byBin.get(calBin);
    if (exact) return exact;
    let nearest: AdviceOutcomeBinRate | null = null;
    let bestDist = Infinity;
    for (const rate of summary.byBin.values()) {
      const dist = Math.abs(rate.offset - calBin);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = rate;
      }
    }
    if (nearest) {
      return { pct: nearest.pct, n: nearest.n, offset: calBin };
    }
  }
  if (summary.overallPct != null) {
    return {
      pct: summary.overallPct,
      n: summary.n,
      offset: calBin ?? calOff ?? 0,
    };
  }
  return null;
}

export function formatExpectedAdviceAccuracyHint(
  expected: AdviceOutcomeBinRate | null | undefined,
  lang: "it" | "en",
): string | null {
  if (expected == null || !Number.isFinite(expected.pct)) return null;
  const t = formatSignPeakOffset(expected.offset);
  if (lang === "it") return `~${expected.pct.toFixed(0)}% attesa a T${t}`;
  return `~${expected.pct.toFixed(0)}% expected at T${t}`;
}

function outcomeItemsFromAdvicePoints(
  points: AdviceCalibrationPoint[],
  action?: "buy" | "sell" | "all",
): Array<{ daysToCd: number | null | undefined; correct: boolean | null }> {
  return points
    .filter((p) => {
      if (p.outcome !== "good" && p.outcome !== "bad") return false;
      if (action === "buy" && p.suggestedAction !== "buy") return false;
      if (action === "sell" && p.suggestedAction !== "sell") return false;
      return true;
    })
    .map((p) => ({
      daysToCd: p.daysToCdAtAdvice,
      correct: p.outcome === "good",
    }));
}

export function buildCombinedAdviceOutcomeSummary(
  monitorPoints: AdviceCalibrationPoint[],
  auditItems: AuditPeakItem[],
): AdviceOutcomeBinnedSummary {
  const combinedItems: Array<{ daysToCd: number | null | undefined; correct: boolean | null }> = [
    ...outcomeItemsFromAdvicePoints(monitorPoints, "all"),
    ...auditItems
      .filter((a) => a.correct != null)
      .map((a) => ({ daysToCd: a.daysToCd, correct: a.correct })),
  ];
  return buildAdviceOutcomeBinnedSummary(combinedItems);
}

function peakLabelFromAdvice(
  points: AdviceCalibrationPoint[],
  action: "buy" | "sell" | "all",
  mode: "outcome" | "signHit",
  lang: "it" | "en",
  signCurveFallback: string | null,
): string | null {
  const peak = peakCdFromAdvicePoints(points, { action, mode, minBinN: DEFAULT_MIN_BIN_N });
  if (peak) return formatPeakCdAnnotation(peak, lang);
  if (mode === "signHit" && signCurveFallback) return signCurveFallback;
  return null;
}

function peakLabelFromPeak(
  peak: PeakCdBin | null,
  lang: "it" | "en",
  signCurveFallback: string | null,
  allowFallback: boolean,
): string | null {
  if (peak) return formatPeakCdAnnotation(peak, lang);
  if (allowFallback && signCurveFallback) return signCurveFallback;
  return null;
}

function withPeakCard<T extends { peakCdLabel?: string | null }>(
  card: T,
  label: string | null,
): T {
  return { ...card, peakCdLabel: label };
}

export function enrichDecisionPrecisionWithPeakCdFromPoints(
  summary: DecisionPrecisionSummary,
  points: AdviceCalibrationPoint[],
  lang: "it" | "en",
): DecisionPrecisionSummary {
  return {
    ...summary,
    buy: withPeakCard(
      summary.buy,
      peakLabelFromAdvice(points, "buy", "outcome", lang, null),
    ),
    sell: withPeakCard(
      summary.sell,
      peakLabelFromAdvice(points, "sell", "outcome", lang, null),
    ),
  };
}

export function enrichDecisionPrecisionWithPeakCdFromOutcomes(
  summary: DecisionPrecisionSummary,
  rows: SimOutcomeRow[],
  lang: "it" | "en",
): DecisionPrecisionSummary {
  return {
    ...summary,
    buy: withPeakCard(
      summary.buy,
      peakLabelFromPeak(peakCdFromSimOutcomeSignals(rows, "buy_signal_result"), lang, null, false),
    ),
    sell: withPeakCard(
      summary.sell,
      peakLabelFromPeak(peakCdFromSimOutcomeSignals(rows, "sell_signal_result"), lang, null, false),
    ),
  };
}

export function enrichNumericalWithPeakCdFromPoints(
  summary: NumericalForecastSummary,
  points: AdviceCalibrationPoint[],
  lang: "it" | "en",
  signCurveView?: SignAccuracyCurveView | null,
): NumericalForecastSummary {
  const curveFallback = formatPeakCdLabelFromSignCurve(signCurveView, lang);
  const signPeak = peakLabelFromAdvice(points, "all", "signHit", lang, curveFallback);
  return {
    ...summary,
    signHit: withPeakCard(summary.signHit, signPeak),
    mae: withPeakCard(summary.mae, signPeak),
  };
}

export function enrichNumericalWithPeakCdFromClosedOutcomes(
  summary: NumericalForecastSummary,
  closedRows: SimOutcomeRow[],
  lang: "it" | "en",
  signCurveView?: SignAccuracyCurveView | null,
): NumericalForecastSummary {
  const curveFallback = formatPeakCdLabelFromSignCurve(signCurveView, lang);
  const signPeak = peakLabelFromPeak(
    peakCdFromSimOutcomeSign(closedRows),
    lang,
    curveFallback,
    true,
  );
  return {
    ...summary,
    signHit: withPeakCard(summary.signHit, signPeak),
    mae: withPeakCard(summary.mae, signPeak),
  };
}

export function peakCdLabelForClosedWinRate(
  closedRows: SimOutcomeRow[],
  lang: "it" | "en",
): string | null {
  return formatPeakCdAnnotation(peakCdFromSimOutcomeWinRate(closedRows), lang);
}

/** Attach days-to-CD from sim row map when missing on calibration points. */
export function attachDaysToCdOnAdvicePoints(
  points: AdviceCalibrationPoint[],
  resolveDaysToCd: (key: string) => number | null,
): AdviceCalibrationPoint[] {
  return points.map((p) => {
    if (p.daysToCdAtAdvice != null && Number.isFinite(p.daysToCdAtAdvice)) return p;
    const key = keyFromAdvicePointId(p.id);
    if (!key) return p;
    const days = resolveDaysToCd(key);
    return days != null ? { ...p, daysToCdAtAdvice: days } : p;
  });
}

export function keyFromAdvicePointId(id: string): string | null {
  const parts = id.split("|");
  if (parts[0] === "live" && parts[1]) return parts[1];
  if (parts[0] === "deal") {
    const openIdx = parts.indexOf("open");
    if (openIdx >= 0 && parts[openIdx + 1]) return parts[openIdx + 1]!;
    if (parts[2] && parts[2] !== "open") return parts[2]!;
  }
  if (parts[0] === "paper" && parts[1]) return parts[1];
  if (parts[0] === "log" && parts[2]) return parts[2]!;
  return null;
}

export type AuditPeakItem = {
  daysToCd: number | null | undefined;
  correct: boolean | null;
  decision: string;
};

export function enrichIntrinsicWithPeakCd(
  intrinsic: {
    monitor: IntrinsicSourceSummary;
    closedReplay: IntrinsicSourceSummary;
    combinedPrecisionPct: number | null;
  },
  monitorPoints: AdviceCalibrationPoint[],
  auditItems: AuditPeakItem[],
  lang: "it" | "en",
  signCurveView?: SignAccuracyCurveView | null,
): {
  combinedRangeLabel: string | null;
  combinedAdviceBins: AdviceOutcomeBinnedSummary;
  monitor: IntrinsicSourceSummary;
  closedReplay: IntrinsicSourceSummary;
} {
  const curveFallback = formatPeakCdLabelFromSignCurve(signCurveView, lang);

  const monitorDecision: DecisionPrecisionSummary = intrinsic.monitor.decision;
  const monitorNumerical = intrinsic.monitor.numerical
    ? enrichNumericalWithPeakCdFromPoints(
        intrinsic.monitor.numerical,
        monitorPoints,
        lang,
        signCurveView,
      )
    : null;

  const closedDecision: DecisionPrecisionSummary = intrinsic.closedReplay.decision;

  const closedNumerical = intrinsic.closedReplay.numerical
    ? {
        ...intrinsic.closedReplay.numerical,
        signHit: withPeakCard(
          intrinsic.closedReplay.numerical.signHit,
          peakLabelFromPeak(peakCdFromAuditOutcomes(auditItems), lang, curveFallback, true),
        ),
        mae: withPeakCard(
          intrinsic.closedReplay.numerical.mae,
          peakLabelFromPeak(peakCdFromAuditOutcomes(auditItems), lang, curveFallback, true),
        ),
      }
    : null;

  const combinedAdviceBins = buildCombinedAdviceOutcomeSummary(monitorPoints, auditItems);
  const combinedRangeLabel = formatAdviceOutcomeRangeLabel(combinedAdviceBins, lang);

  return {
    combinedRangeLabel,
    combinedAdviceBins,
    monitor: {
      ...intrinsic.monitor,
      decision: monitorDecision,
      numerical: monitorNumerical,
      allActions: intrinsic.monitor.allActions,
    },
    closedReplay: {
      ...intrinsic.closedReplay,
      decision: closedDecision,
      numerical: closedNumerical,
    },
  };
}

export function buildAuditPeakItemsFromClosedRows(
  rows: SimOutcomeRow[],
  simRowByKey: Map<string, Record<string, unknown>>,
  lang: "it" | "en",
): AuditPeakItem[] {
  const audit = buildPlanProbLearningSummary(rows, simRowByKey, lang);
  const daysByKey = new Map(rows.map((r) => [r.row_key, r.days_to_cd]));
  return audit.auditRows
    .filter((r) => r.evaluable && r.correct != null)
    .map((r) => ({
      daysToCd: daysByKey.get(r.rowKey) ?? null,
      correct: r.correct,
      decision: r.decision,
    }));
}
