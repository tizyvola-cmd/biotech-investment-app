import { completionDateToNowOffset } from "./chartNowOffset";
import { spearmanRho } from "./rascoreSignalImpactView";
import { formatCorrelationWithStars } from "./statSignificance";
import {
  SDS_PREDICTION_OFFSETS,
  type SdsPredictionSignal,
} from "./sdsRoiTemporalConvergence";
import { supernovaOffsetLabel } from "./sdsHistoryCurve";

export const SDS_SCORE_BANDS = [
  { label: "0–25", min: 0, max: 25 },
  { label: "25–50", min: 25, max: 50 },
  { label: "50–75", min: 50, max: 75 },
  { label: "75–100", min: 75, max: 100 },
] as const;

export const NODE_LABELS = SDS_PREDICTION_OFFSETS.map((o) => supernovaOffsetLabel(o));

/** Paired pred+actual count required to rank a T-node as «most accurate». */
export const MIN_NODE_PAIRS_FOR_RANK = 3;

/** Practical Spearman ρ target for useful rank alignment (moderate → good). */
export const SDS_RHO_PRACTICAL_TARGET = 0.5;

/** Confidence panel targets (④ SDS learning confidence). */
export const SDS_CONFIDENCE_COVERAGE_TARGET_PCT = 60;
export const SDS_CONFIDENCE_MAE_TARGET_PP = 5;
export const SDS_CONFIDENCE_TEMPORAL_WEEKS = 3;
export const SDS_CONFIDENCE_LOOP_SNAPSHOTS = 5;

export type SdsNodeAggregate = {
  label: string;
  offset: number;
  predictedMean: number | null;
  actualMean: number | null;
  actualMin: number | null;
  actualMax: number | null;
  /** Paired historical + SDS observations at this T-node. */
  n: number;
  nPred: number;
  mae: number | null;
  status: "no_data" | "insufficient" | "measured";
};

export type SdsNodeAccuracyStat = SdsNodeAggregate;

export type SdsNodeAccuracyPoint = { label: string; mae: number; n: number };

export type SdsNodeAccuracySummary = {
  nodes: SdsNodeAccuracyStat[];
  /** Lowest mean |pred−actual| among nodes with ≥1 pair (closest curves). */
  bestAccurate: SdsNodeAccuracyPoint | null;
  /** Same metric but only nodes with ≥3 pairs (statistically ranked). */
  bestAccurateRanked: SdsNodeAccuracyPoint | null;
  densest: { label: string; n: number } | null;
  nodesWithoutData: string[];
  nodesInsufficient: string[];
};

export type SdsAccuracyKpis = {
  totalSignals: number;
  coveragePct: number;
  mae: number | null;
  maeFmt: string;
  bestNode: string | null;
  latestRho: string;
  latestRhoNum: number | null;
};

/** % actual ROI > 0 at a T-node required to treat an SDS band as «significant». */
export const SDS_GROW_SIGNIFICANT_MIN_PCT = 55;
export const SDS_SCORE_BAND_MIN_N = 2;

export type SdsScoreBandStat = {
  label: string;
  min: number;
  max: number;
  n: number;
  /** % observations with historical ROI > 0 at the chosen T-node. */
  growActualPct: number | null;
  meanActualPp: number | null;
};

export type SdsSignalImpactInsights = {
  /** Lowest SDS band floor where ≥55% of stocks had actual ROI > 0 at the best window. */
  minSignificantSdsScore: number | null;
  minSignificantBandLabel: string | null;
  minSignificantGrowPct: number | null;
  minSignificantN: number;
  /** Spearman ρ between SDS score and actual ROI at the best ranked/measured window. */
  scoreActualRhoAtBestWindow: number | null;
  scoreActualRhoN: number;
  bestWindow: SdsNodeAccuracyPoint | null;
  bestWindowRanked: boolean;
  confidencePct: number;
  confidenceTier: "high" | "mid" | "low";
  scoreBandStats: SdsScoreBandStat[];
};

export function computeSdsScoreBandStats(
  signals: SdsPredictionSignal[],
  offset: number,
): SdsScoreBandStat[] {
  const buckets = SDS_SCORE_BANDS.map((b) => ({
    label: b.label,
    min: b.min,
    max: b.max,
    actuals: [] as number[],
  }));

  for (const sig of signals) {
    const node = sig.nodes.find((n) => n.offset === offset);
    if (!node || node.actual == null) continue;
    const band = sdsBandForScore(sig.sdsScore);
    const bucket = buckets.find((b) => b.label === band.label);
    if (bucket) bucket.actuals.push(node.actual);
  }

  return buckets.map((b) => {
    const n = b.actuals.length;
    if (!n) {
      return {
        label: b.label,
        min: b.min,
        max: b.max,
        n: 0,
        growActualPct: null,
        meanActualPp: null,
      };
    }
    const pos = b.actuals.filter((v) => v > 0).length;
    const mean = b.actuals.reduce((s, v) => s + v, 0) / n;
    return {
      label: b.label,
      min: b.min,
      max: b.max,
      n,
      growActualPct: Math.round((100 * pos) / n * 10) / 10,
      meanActualPp: Math.round(mean * 10) / 10,
    };
  });
}

export function computeMinimalSignificantSdsScore(
  bandStats: SdsScoreBandStat[],
  minGrowPct = SDS_GROW_SIGNIFICANT_MIN_PCT,
  minN = SDS_SCORE_BAND_MIN_N,
): { score: number | null; bandLabel: string | null; growPct: number | null; n: number } {
  for (const b of bandStats) {
    if (b.n >= minN && (b.growActualPct ?? 0) >= minGrowPct) {
      return {
        score: b.min,
        bandLabel: b.label,
        growPct: b.growActualPct,
        n: b.n,
      };
    }
  }
  return { score: null, bandLabel: null, growPct: null, n: 0 };
}

export function computeScoreActualRhoAtOffset(
  signals: SdsPredictionSignal[],
  offset: number,
): { rho: number | null; n: number } {
  const scores: number[] = [];
  const actuals: number[] = [];
  for (const sig of signals) {
    const node = sig.nodes.find((n) => n.offset === offset);
    if (!node || node.actual == null) continue;
    scores.push(sig.sdsScore);
    actuals.push(node.actual);
  }
  return { rho: spearmanRho(scores, actuals), n: scores.length };
}

export function computeSdsConfidenceScore(opts: {
  coveragePct: number;
  mae: number | null;
  latestRhoNum: number | null;
  weeksWithMae: number;
  weeklySnapshotCount: number;
}): { pct: number; tier: "high" | "mid" | "low" } {
  const maeBarVal =
    opts.mae == null
      ? 0
      : opts.mae < SDS_CONFIDENCE_MAE_TARGET_PP
        ? 100
        : opts.mae <= 15
          ? ((15 - opts.mae) / 10) * 100
          : 0;
  const rhoBarVal = (() => {
    const rho = opts.latestRhoNum;
    if (rho == null) return 0;
    if (rho >= SDS_RHO_PRACTICAL_TARGET) return 100;
    if (rho > 0) return Math.max(0, Math.min(98, (rho / SDS_RHO_PRACTICAL_TARGET) * 100));
    return 0;
  })();
  const temporalVal = Math.min(
    100,
    (opts.weeksWithMae / SDS_CONFIDENCE_TEMPORAL_WEEKS) * 100,
  );
  const loopVal = Math.min(
    100,
    (opts.weeklySnapshotCount / SDS_CONFIDENCE_LOOP_SNAPSHOTS) * 100,
  );
  const coverageBarVal = Math.min(
    100,
    (opts.coveragePct / SDS_CONFIDENCE_COVERAGE_TARGET_PCT) * 100,
  );
  const pct = Math.round((coverageBarVal + maeBarVal + rhoBarVal + temporalVal + loopVal) / 5);
  const tier: "high" | "mid" | "low" =
    pct >= 70 ? "high" : pct >= 40 ? "mid" : "low";
  return { pct, tier };
}

export function computeSdsSignalImpactInsights(
  signals: SdsPredictionSignal[],
  nodeSummary: SdsNodeAccuracySummary,
  weeklyCalibration: Array<{ mae?: number | null; rho?: number | null }>,
  kpis: SdsAccuracyKpis,
): SdsSignalImpactInsights {
  const bestWindow =
    nodeSummary.bestAccurateRanked ?? nodeSummary.bestAccurate;
  const bestWindowRanked = Boolean(nodeSummary.bestAccurateRanked);
  const bestOffset =
    bestWindow != null
      ? nodeSummary.nodes.find((n) => n.label === bestWindow.label)?.offset ?? null
      : null;

  const scoreBandStats =
    bestOffset != null ? computeSdsScoreBandStats(signals, bestOffset) : [];
  const minSig = computeMinimalSignificantSdsScore(scoreBandStats);
  const scoreRho =
    bestOffset != null
      ? computeScoreActualRhoAtOffset(signals, bestOffset)
      : { rho: null, n: 0 };

  const weeksWithMae = weeklyCalibration.filter((w) => w.mae != null).length;
  const confidence = computeSdsConfidenceScore({
    coveragePct: kpis.coveragePct,
    mae: kpis.mae,
    latestRhoNum: kpis.latestRhoNum,
    weeksWithMae,
    weeklySnapshotCount: weeklyCalibration.length,
  });

  return {
    minSignificantSdsScore: minSig.score,
    minSignificantBandLabel: minSig.bandLabel,
    minSignificantGrowPct: minSig.growPct,
    minSignificantN: minSig.n,
    scoreActualRhoAtBestWindow: scoreRho.rho,
    scoreActualRhoN: scoreRho.n,
    bestWindow: bestWindow ?? null,
    bestWindowRanked,
    confidencePct: confidence.pct,
    confidenceTier: confidence.tier,
    scoreBandStats,
  };
}

export function sdsBandForScore(score: number): (typeof SDS_SCORE_BANDS)[number] {
  const s = Math.max(0, Math.min(100, score));
  return SDS_SCORE_BANDS.find((b) => s >= b.min && s < b.max) ?? SDS_SCORE_BANDS[3]!;
}

function nodeAccuracyStat(
  offset: number,
  signals: SdsPredictionSignal[],
): SdsNodeAccuracyStat {
  const label = supernovaOffsetLabel(offset);
  const preds: number[] = [];
  const actuals: number[] = [];
  const errs: number[] = [];
  let nPred = 0;

  for (const sig of signals) {
    const node = sig.nodes.find((n) => n.offset === offset);
    if (!node) continue;
    if (node.predicted != null) {
      nPred++;
      preds.push(node.predicted);
    }
    if (node.actual != null) actuals.push(node.actual);
    if (node.predicted != null && node.actual != null) {
      errs.push(Math.abs(node.predicted - node.actual));
    }
  }

  const mean = (vals: number[]) =>
    vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null;

  const nPairs = errs.length;
  const mae =
    nPairs > 0
      ? Math.round((errs.reduce((s, v) => s + v, 0) / errs.length) * 10) / 10
      : null;
  const status: SdsNodeAccuracyStat["status"] =
    nPairs === 0 ? "no_data" : nPairs < MIN_NODE_PAIRS_FOR_RANK ? "insufficient" : "measured";

  return {
    label,
    offset,
    predictedMean: mean(preds),
    actualMean: mean(actuals),
    actualMin: actuals.length >= 2 ? Math.min(...actuals) : null,
    actualMax: actuals.length >= 2 ? Math.max(...actuals) : null,
    n: nPairs,
    nPred,
    mae,
    status,
  };
}

export function computeNodeAggregates(signals: SdsPredictionSignal[]): SdsNodeAggregate[] {
  return SDS_PREDICTION_OFFSETS.map((offset) => nodeAccuracyStat(offset, signals));
}

function pickLowestMae(
  candidates: SdsNodeAccuracyStat[],
): SdsNodeAccuracyPoint | null {
  const withMae = candidates.filter((n) => n.n > 0 && n.mae != null);
  if (!withMae.length) return null;
  const best = withMae.reduce((a, b) => (a.mae! <= b.mae! ? a : b));
  return { label: best.label, mae: best.mae!, n: best.n };
}

export function computeNodeAccuracySummary(signals: SdsPredictionSignal[]): SdsNodeAccuracySummary {
  const nodes = computeNodeAggregates(signals);
  const bestAccurate = pickLowestMae(nodes);
  const bestAccurateRanked = pickLowestMae(
    nodes.filter((n) => n.status === "measured"),
  );

  const withPairs = nodes.filter((n) => n.n > 0);
  const densest = withPairs.length
    ? (() => {
        const d = withPairs.reduce((a, b) => (a.n >= b.n ? a : b));
        return { label: d.label, n: d.n };
      })()
    : null;

  return {
    nodes,
    bestAccurate,
    bestAccurateRanked,
    densest,
    nodesWithoutData: nodes.filter((n) => n.status === "no_data").map((n) => n.label),
    nodesInsufficient: nodes.filter((n) => n.status === "insufficient").map((n) => n.label),
  };
}

export function computeSdsAccuracyKpis(
  signals: SdsPredictionSignal[],
  weeklyRho: Array<{ rho: number | null; rhoN?: number | null }>,
): SdsAccuracyKpis {
  const totalSignals = signals.length;
  const totalNodes = totalSignals * NODE_LABELS.length;
  const pairs: { pred: number; actual: number; node: string }[] = [];

  for (const sig of signals) {
    for (const node of sig.nodes) {
      if (node.predicted != null && node.actual != null) {
        pairs.push({ pred: node.predicted, actual: node.actual, node: node.label });
      }
    }
  }

  const coveragePct =
    totalNodes > 0 ? Math.round((pairs.length / totalNodes) * 1000) / 10 : 0;

  const mae =
    pairs.length > 0
      ? Math.round(
          (pairs.reduce((s, p) => s + Math.abs(p.pred - p.actual), 0) / pairs.length) * 10,
        ) / 10
      : null;

  const nodeSummary = computeNodeAccuracySummary(signals);
  const bestNode = nodeSummary.bestAccurate?.label ?? null;

  const rhoWeeks = weeklyRho.filter((w) => w.rho != null);
  const lastRhoWeek = rhoWeeks.length ? rhoWeeks[rhoWeeks.length - 1]! : null;
  const lastRho = lastRhoWeek?.rho ?? null;
  const rhoN =
    lastRhoWeek?.rhoN != null && lastRhoWeek.rhoN >= 3
      ? lastRhoWeek.rhoN
      : countSdsRhoPairs(signals);

  return {
    totalSignals,
    coveragePct,
    mae,
    maeFmt: mae != null ? `±${mae} pp` : "n/d",
    bestNode,
    latestRho:
      lastRho != null ? formatCorrelationWithStars(lastRho, rhoN) : "n/d",
    latestRhoNum: lastRho,
  };
}

export function countSdsRhoPairs(signals: SdsPredictionSignal[]): number {
  let n = 0;
  for (const sig of signals) {
    for (const node of sig.nodes) {
      if (node.predicted != null && node.actual != null) n += 1;
    }
  }
  return n;
}

export function computeGlobalRho(signals: SdsPredictionSignal[]): number | null {
  const preds: number[] = [];
  const actuals: number[] = [];
  for (const sig of signals) {
    for (const node of sig.nodes) {
      if (node.predicted != null && node.actual != null) {
        preds.push(node.predicted);
        actuals.push(node.actual);
      }
    }
  }
  return spearmanRho(preds, actuals);
}

/** Mean signed gap (ROI storico − ROI SDS) and |gap| per T-node. */
export type SdsRoiGapPoint = {
  label: string;
  offset: number;
  /** ROI storico/reale − ROI predetto SDS (pp). >0 = SDS sottostima il rialzo. */
  signedGap: number | null;
  absGap: number | null;
  n: number;
};

export function computeNodeRoiGapCurve(signals: SdsPredictionSignal[]): SdsRoiGapPoint[] {
  return SDS_PREDICTION_OFFSETS.map((offset) => {
    const label = supernovaOffsetLabel(offset);
    const gaps: number[] = [];
    for (const sig of signals) {
      const node = sig.nodes.find((n) => n.offset === offset);
      if (!node || node.predicted == null || node.actual == null) continue;
      gaps.push(node.actual - node.predicted);
    }
    if (!gaps.length) {
      return { label, offset, signedGap: null, absGap: null, n: 0 };
    }
    const signedGap =
      Math.round((gaps.reduce((s, v) => s + v, 0) / gaps.length) * 10) / 10;
    const absGap =
      Math.round(
        (gaps.reduce((s, v) => s + Math.abs(v), 0) / gaps.length) * 10,
      ) / 10;
    return { label, offset, signedGap, absGap, n: gaps.length };
  });
}

export function nearestTodayNodeIndex(signals: SdsPredictionSignal[]): number | null {
  if (!signals.length) return null;
  const offsets = signals
    .map((s) => completionDateToNowOffset(s.cdDate))
    .filter((o): o is number => o != null);
  if (!offsets.length) return null;
  const median = offsets.sort((a, b) => a - b)[Math.floor(offsets.length / 2)]!;
  let bestIdx = 0;
  let bestDist = Infinity;
  SDS_PREDICTION_OFFSETS.forEach((off, i) => {
    const d = Math.abs(off - median);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  });
  return bestIdx;
}
