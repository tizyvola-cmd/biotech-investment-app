/**
 * Efficienza intrinseca raccomandazioni — indipendente da esecuzione paper/portfolio.
 * (1) Monitor live: suggestedAction vs Var.24h / P&L (classifyAdviceOutcome).
 * (2) Replay chiusi: outlook entry/recovery vs P&L realizzato (planProb audit).
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import { confidenceFromN } from "../calibration/calibrationTypes";
import type {
  AdviceCalibrationPoint,
  LiveAdviceCalibRow,
} from "./investDecisionSimAdviceCalibration";
import {
  buildAdviceCalibrationFromLiveRows,
} from "./investDecisionSimAdviceCalibration";
import type { DecisionPrecisionSummary, NumericalForecastSummary, AccuracyMetricCard } from "./accuracySummary";
import { summarizeDecisionPrecision, computeNumericalForecastAccuracy, summarizeAllActionAdvicePrecision, countPendingAdvicePoints } from "./accuracySummary";
import { buildPlanProbLearningSummary } from "./planProbOutcomeAudit";
import type { AdviceOutcomeBinnedSummary } from "./accuracyPeakCdOffset";

export type IntrinsicSourceSummary = {
  decision: DecisionPrecisionSummary;
  numerical: NumericalForecastSummary | null;
  scoredCount: number;
  /** BUY+SELL+HOLD+review — what live monitor actually scores today. */
  allActions: AccuracyMetricCard;
  pendingCount: number;
};

export type IntrinsicRecommendationSummary = {
  monitor: IntrinsicSourceSummary;
  closedReplay: IntrinsicSourceSummary;
  /** BUY/SELL pooled monitor + replay (directional only). */
  combinedDecision: DecisionPrecisionSummary;
  /** Tutti i consigli valutati: monitor (incl. HOLD) + replay (tutti evaluable). */
  combinedAllActions: AccuracyMetricCard;
  /** Alias di combinedAllActions.valuePct — media header. */
  combinedPrecisionPct: number | null;
  /** Solo BUY/SELL pooled — deve coincidere con media pesata di combinedDecision. */
  combinedDirectionalPct: number | null;
  /** Min/max success rate by T-offset bin (monitor + closed replay). */
  combinedRangeLabel?: string | null;
  combinedAdviceBins?: AdviceOutcomeBinnedSummary;
  /** @deprecated Use combinedRangeLabel */
  combinedPeakCdLabel?: string | null;
};

function dedupeCalibrationByKey(points: AdviceCalibrationPoint[]): AdviceCalibrationPoint[] {
  const byId = new Map<string, AdviceCalibrationPoint>();
  for (const p of points) {
    if (!byId.has(p.id)) byId.set(p.id, p);
  }
  return [...byId.values()];
}

/** Live monitor — stesso scoring del pannello calibrazione (Var.24h / P&L). */
export function summarizeIntrinsicFromMonitor(
  rows: LiveAdviceCalibRow[],
  lang: "it" | "en",
): IntrinsicSourceSummary {
  const raw = buildAdviceCalibrationFromLiveRows(rows, lang);
  const points = dedupeCalibrationByKey(raw);
  const scored = points.filter((p) => p.outcome === "good" || p.outcome === "bad");
  const decision = summarizeDecisionPrecision(points, 0);
  const numerical = scored.length > 0 ? computeNumericalForecastAccuracy(points) : null;
  return {
    decision,
    numerical,
    scoredCount: scored.length,
    allActions: summarizeAllActionAdvicePrecision(points),
    pendingCount: countPendingAdvicePoints(points),
  };
}

function precisionFromAuditDecision(
  byDecision: Record<string, { n: number; correct: number; accuracyPct: number | null }>,
  buyLabels: string[],
  sellLabels: string[],
): DecisionPrecisionSummary {
  let buyGood = 0;
  let buyBad = 0;
  for (const label of buyLabels) {
    const b = byDecision[label];
    if (!b) continue;
    buyGood += b.correct;
    buyBad += b.n - b.correct;
  }
  let sellGood = 0;
  let sellBad = 0;
  for (const label of sellLabels) {
    const b = byDecision[label];
    if (!b) continue;
    sellGood += b.correct;
    sellBad += b.n - b.correct;
  }
  const buyN = buyGood + buyBad;
  const sellN = sellGood + sellBad;
  return {
    buy: {
      labelKey: "buy",
      valuePct: buyN > 0 ? Math.round((buyGood / buyN) * 1000) / 10 : null,
      maePct: null,
      n: buyN,
      good: buyGood,
      bad: buyBad,
      confidence: confidenceFromN(buyN),
    },
    sell: {
      labelKey: "sell",
      valuePct: sellN > 0 ? Math.round((sellGood / sellN) * 1000) / 10 : null,
      maePct: null,
      n: sellN,
      good: sellGood,
      bad: sellBad,
      confidence: confidenceFromN(sellN),
    },
    unverifiedSellEvitaCount: 0,
  };
}

/** BUY/SELL pooled across live monitor + closed replay (directional subset). */
export function buildCombinedIntrinsicDecision(
  monitor: IntrinsicSourceSummary,
  closedReplay: IntrinsicSourceSummary,
): DecisionPrecisionSummary {
  const buyGood = (monitor.decision.buy.good ?? 0) + (closedReplay.decision.buy.good ?? 0);
  const buyBad = (monitor.decision.buy.bad ?? 0) + (closedReplay.decision.buy.bad ?? 0);
  const sellGood = (monitor.decision.sell.good ?? 0) + (closedReplay.decision.sell.good ?? 0);
  const sellBad = (monitor.decision.sell.bad ?? 0) + (closedReplay.decision.sell.bad ?? 0);
  const buyN = buyGood + buyBad;
  const sellN = sellGood + sellBad;
  return {
    buy: {
      labelKey: "buy",
      valuePct: buyN > 0 ? Math.round((buyGood / buyN) * 1000) / 10 : null,
      maePct: null,
      n: buyN,
      good: buyGood,
      bad: buyBad,
      confidence: confidenceFromN(buyN),
    },
    sell: {
      labelKey: "sell",
      valuePct: sellN > 0 ? Math.round((sellGood / sellN) * 1000) / 10 : null,
      maePct: null,
      n: sellN,
      good: sellGood,
      bad: sellBad,
      confidence: confidenceFromN(sellN),
    },
    unverifiedSellEvitaCount:
      monitor.decision.unverifiedSellEvitaCount + closedReplay.decision.unverifiedSellEvitaCount,
  };
}

function buildCombinedAllActions(
  monitor: IntrinsicSourceSummary,
  closedReplay: IntrinsicSourceSummary,
): AccuracyMetricCard {
  const good = (monitor.allActions.good ?? 0) + (closedReplay.allActions.good ?? 0);
  const bad = (monitor.allActions.bad ?? 0) + (closedReplay.allActions.bad ?? 0);
  const n = good + bad;
  return {
    labelKey: "advice",
    valuePct: n > 0 ? Math.round((good / n) * 1000) / 10 : null,
    maePct: null,
    n,
    good,
    bad,
    confidence: confidenceFromN(n),
  };
}

/** Weighted BUY+SELL % — must equal combinedDecision buy/sell pool mean. */
export function precisionPctFromDecision(decision: DecisionPrecisionSummary): number | null {
  const good = (decision.buy.good ?? 0) + (decision.sell.good ?? 0);
  const bad = (decision.buy.bad ?? 0) + (decision.sell.bad ?? 0);
  const n = good + bad;
  return n > 0 ? Math.round((good / n) * 1000) / 10 : null;
}

/** Replay raccomandazione entry/recovery vs esito su round-trip chiusi. */
export function summarizeIntrinsicFromClosedReplay(
  closedRows: SimOutcomeRow[],
  simRowByKey: Map<string, Record<string, unknown>>,
  lang: "it" | "en",
): IntrinsicSourceSummary {
  const audit = buildPlanProbLearningSummary(closedRows, simRowByKey, lang);
  const decision = precisionFromAuditDecision(
    audit.byDecision,
    ["enter", "hold"],
    ["skip", "exit"],
  );
  const scored = audit.evaluable;
  const numerical: NumericalForecastSummary | null =
    audit.accuracyPct != null
      ? {
          signHit: {
            labelKey: "signHit",
            valuePct: audit.accuracyPct,
            maePct: null,
            n: scored,
            confidence: confidenceFromN(scored),
          },
          mae: {
            labelKey: "mae",
            valuePct: null,
            maePct: audit.meanBrier != null ? Math.round(audit.meanBrier * 1000) / 10 : null,
            n: scored,
            confidence: confidenceFromN(scored),
          },
        }
      : null;
  return {
    decision,
    numerical,
    scoredCount: scored,
    allActions: {
      labelKey: "advice",
      valuePct:
        scored > 0 ? Math.round((audit.correct / scored) * 1000) / 10 : null,
      maePct: null,
      n: scored,
      good: audit.correct,
      bad: audit.incorrect,
      confidence: confidenceFromN(scored),
    },
    pendingCount: audit.pending,
  };
}

export function buildIntrinsicRecommendationSummary(args: {
  monitorRows: LiveAdviceCalibRow[];
  closedRows: SimOutcomeRow[];
  simRowByKey: Map<string, Record<string, unknown>>;
  lang: "it" | "en";
}): IntrinsicRecommendationSummary {
  const monitor = summarizeIntrinsicFromMonitor(args.monitorRows, args.lang);
  const closedReplay = summarizeIntrinsicFromClosedReplay(
    args.closedRows,
    args.simRowByKey,
    args.lang,
  );

  const combinedDecision = buildCombinedIntrinsicDecision(monitor, closedReplay);
  const combinedAllActions = buildCombinedAllActions(monitor, closedReplay);
  const combinedDirectionalPct = precisionPctFromDecision(combinedDecision);

  return {
    monitor,
    closedReplay,
    combinedDecision,
    combinedAllActions,
    combinedPrecisionPct: combinedAllActions.valuePct,
    combinedDirectionalPct,
  };
}
