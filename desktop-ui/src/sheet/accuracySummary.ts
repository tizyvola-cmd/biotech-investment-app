/**
 * Three-family accuracy summary — presentation layer only.
 * Reuses advice calibration, directional hit, and synth gain impact logic.
 */
import { confidenceFromN, type ConfidenceLevel } from "../calibration/calibrationTypes";
import type {
  AdviceCalibrationPoint,
  LiveAdviceCalibRow,
} from "./investDecisionSimAdviceCalibration";
import {
  normalizeAdviceAction,
  resolveAdvicePriceChangePct,
} from "./investDecisionSimAdviceCalibration";
import { directionHit } from "./accuracyMetrics";
import type { SynthGainImpact } from "./threePortfolioCompare";

export type AccuracyMetricCard = {
  labelKey: "buy" | "sell" | "signHit" | "mae" | "advice";
  valuePct: number | null;
  /** MAE in pp when labelKey === "mae". */
  maePct: number | null;
  n: number;
  good?: number;
  bad?: number;
  confidence: ConfidenceLevel;
  /** e.g. "88.9% max a T-5 dal CD" — peak bin rate vs completion date. */
  peakCdLabel?: string | null;
};

export type DecisionPrecisionSummary = {
  buy: AccuracyMetricCard;
  sell: AccuracyMetricCard;
  /** SELL/EVITA never opened — not in precision denominator. */
  unverifiedSellEvitaCount: number;
};

export type NumericalForecastSummary = {
  signHit: AccuracyMetricCard;
  mae: AccuracyMetricCard;
};

export type WeightedGrowthSummary = {
  multiplier: number | null;
  equalGainEur: number;
  weightedGainEur: number;
  equalClosedEur: number;
  equalOpenEur: number;
  synthClosedEur: number;
  synthOpenEur: number;
  equalCostEur: number;
  weightedCostEur: number;
  deltaGainPp: number | null;
  scenario: "simLoop" | "mine";
  dealSampleN: number;
};

/** Paper sim only — excludes live snapshot rows that inflate precision with Var.24h. */
export function filterPaperExecutedCalibrationPoints(
  points: AdviceCalibrationPoint[],
): AdviceCalibrationPoint[] {
  return points.filter((p) => p.source === "experiment" || p.kind === "paper_sell");
}

/** Tick-level paper events minus deal-level points (repeat marks / duplicate sells). */
export function countInflatedTickCalibrationEvents(
  tickLevelPoints: AdviceCalibrationPoint[],
  dealLevelPoints: AdviceCalibrationPoint[],
): number {
  return Math.max(0, tickLevelPoints.length - dealLevelPoints.length);
}

function precisionCard(
  good: number,
  bad: number,
  labelKey: AccuracyMetricCard["labelKey"],
): AccuracyMetricCard {
  const n = good + bad;
  return {
    labelKey,
    valuePct: n > 0 ? Math.round((good / n) * 1000) / 10 : null,
    maePct: null,
    n,
    good,
    bad,
    confidence: confidenceFromN(n),
  };
}

function resolveLiveSellAction(row: LiveAdviceCalibRow): "sell" | null {
  const action = normalizeAdviceAction(row.suggestedAction);
  if (action === "sell") return "sell";
  if (
    action === "review" &&
    row.exitDecision === "exit" &&
    (row.inPaperPortfolio || row.hasPosition)
  ) {
    return "sell";
  }
  return null;
}

/** SELL/EVITA on deals never opened — excluded from precision denominator. */
export function countUnverifiedSellEvitaFromMonitor(rows: LiveAdviceCalibRow[]): number {
  let count = 0;
  for (const row of rows) {
    if (resolveLiveSellAction(row) !== "sell") continue;
    const scorable =
      row.inPaperPortfolio ||
      row.hasPosition ||
      resolveAdvicePriceChangePct({ ...row, suggestedAction: "sell" }) != null;
    if (!scorable) count += 1;
  }
  return count;
}

/** (i) BUY / SELL precision from scored advice calibration points. */
export function summarizeDecisionPrecision(
  points: AdviceCalibrationPoint[],
  unverifiedSellEvitaCount = 0,
): DecisionPrecisionSummary {
  const buys = points.filter((p) => p.suggestedAction === "buy");
  const sells = points.filter((p) => p.suggestedAction === "sell");

  const buyGood = buys.filter((p) => p.outcome === "good").length;
  const buyBad = buys.filter((p) => p.outcome === "bad").length;
  const sellGood = sells.filter((p) => p.outcome === "good").length;
  const sellBad = sells.filter((p) => p.outcome === "bad").length;
  const sellPending = sells.filter((p) => p.outcome === "pending").length;

  return {
    buy: precisionCard(buyGood, buyBad, "buy"),
    sell: precisionCard(sellGood, sellBad, "sell"),
    unverifiedSellEvitaCount: unverifiedSellEvitaCount + sellPending,
  };
}

/** All live advice actions (buy/sell/hold/review) — for intrinsic monitor where paper is mostly hold/review. */
export function summarizeAllActionAdvicePrecision(
  points: AdviceCalibrationPoint[],
): AccuracyMetricCard {
  const good = points.filter((p) => p.outcome === "good").length;
  const bad = points.filter((p) => p.outcome === "bad").length;
  return precisionCard(good, bad, "advice");
}

export function countPendingAdvicePoints(points: AdviceCalibrationPoint[]): number {
  return points.filter((p) => p.outcome === "pending").length;
}

const NUMERICAL_FLAT_BAND_PP = 0.5;

/** Segno/MAE only when advice implies a directional forecast (not wait-and-see HOLD). */
function isNumericalForecastScorable(p: AdviceCalibrationPoint): boolean {
  const action = normalizeAdviceAction(p.suggestedAction);
  return action === "buy" || action === "sell";
}

/** (ii) Sign hit rate + MAE on resolved forecast pairs (% points). */
export function computeNumericalForecastAccuracy(
  points: AdviceCalibrationPoint[],
): NumericalForecastSummary {
  const resolved = points.filter(
    (p) =>
      isNumericalForecastScorable(p) &&
      p.expectedReturnPct != null &&
      Number.isFinite(p.expectedReturnPct) &&
      p.priceChangePct != null &&
      Number.isFinite(p.priceChangePct),
  );

  let signHits = 0;
  const absErrors: number[] = [];

  for (const p of resolved) {
    const expected = p.expectedReturnPct!;
    const actual = p.priceChangePct!;
    if (
      directionHit(expected, actual, NUMERICAL_FLAT_BAND_PP) ||
      (Math.abs(expected) < NUMERICAL_FLAT_BAND_PP && Math.abs(actual) < NUMERICAL_FLAT_BAND_PP)
    ) {
      signHits += 1;
    }
    const err =
      p.forecastErrorPct != null && Number.isFinite(p.forecastErrorPct)
        ? Math.abs(p.forecastErrorPct)
        : Math.abs(actual - expected);
    absErrors.push(err);
  }

  const n = resolved.length;
  const signHitPct = n > 0 ? Math.round((signHits / n) * 1000) / 10 : null;
  const maePct =
    absErrors.length > 0
      ? Math.round((absErrors.reduce((a, b) => a + b, 0) / absErrors.length) * 10) / 10
      : null;

  return {
    signHit: {
      labelKey: "signHit",
      valuePct: signHitPct,
      maePct: null,
      n,
      confidence: confidenceFromN(n),
    },
    mae: {
      labelKey: "mae",
      valuePct: null,
      maePct,
      n,
      confidence: confidenceFromN(n),
    },
  };
}

/** (iii) Growth multiplier weighted/synth vs equal on same deals & capital. */
export function summarizeWeightedGrowthFromImpact(
  impact: SynthGainImpact,
  scenario: "simLoop" | "mine" = "simLoop",
  dealSampleN = 0,
  openClosed?: {
    equalClosedEur: number;
    equalOpenEur: number;
    synthClosedEur: number;
    synthOpenEur: number;
  },
): WeightedGrowthSummary {
  let multiplier: number | null = null;
  if (Math.abs(impact.baselinePnlEur) > 0.01) {
    multiplier = Math.round((impact.synthPnlEur / impact.baselinePnlEur) * 100) / 100;
  } else if (Math.abs(impact.synthPnlEur) > 0.01) {
    multiplier = null;
  } else {
    multiplier = 1;
  }

  return {
    multiplier,
    equalGainEur: impact.baselinePnlEur,
    weightedGainEur: impact.synthPnlEur,
    equalClosedEur: openClosed?.equalClosedEur ?? impact.baselinePnlEur,
    equalOpenEur: openClosed?.equalOpenEur ?? 0,
    synthClosedEur: openClosed?.synthClosedEur ?? impact.synthPnlEur,
    synthOpenEur: openClosed?.synthOpenEur ?? 0,
    equalCostEur: impact.baselineCostEur,
    weightedCostEur: impact.synthCostEur,
    deltaGainPp: impact.deltaGainPp,
    scenario,
    dealSampleN,
  };
}

export function formatGrowthMultiplier(multiplier: number | null): string {
  if (multiplier == null || !Number.isFinite(multiplier)) return "—";
  return `${multiplier.toFixed(2)}×`;
}

/** Why operative SELL n may be lower than total closed exits (paper or Simulation). */
export type OperativeSellCoverageBreakdown = {
  executedCount: number;
  scoredCount: number;
  missingPplanCount: number;
  missingPostMoveCount: number;
  pendingFlatCount: number;
};

export function formatOperativeSellBreakdownLabel(
  breakdown: OperativeSellCoverageBreakdown | null | undefined,
  it: boolean,
  variant: "portfolio" | "simLoop",
): string | null {
  if (!breakdown || breakdown.executedCount <= 0) return null;
  const parts: string[] = [
    `${breakdown.scoredCount}/${breakdown.executedCount} ${it ? "valutati" : "scored"}`,
  ];
  if (breakdown.missingPplanCount > 0) {
    parts.push(`${breakdown.missingPplanCount} ${it ? "senza P(plan)" : "no P(plan)"}`);
  }
  if (breakdown.missingPostMoveCount > 0) {
    const moveLabel =
      variant === "simLoop"
        ? it
          ? "senza Var. post-vendita"
          : "no post-sell move"
        : it
          ? "senza Var. post-uscita"
          : "no post-exit move";
    parts.push(`${breakdown.missingPostMoveCount} ${moveLabel}`);
  }
  if (breakdown.pendingFlatCount > 0) {
    parts.push(`${breakdown.pendingFlatCount} ${it ? "flat/in attesa" : "flat/pending"}`);
  }
  return parts.join(" · ");
}
