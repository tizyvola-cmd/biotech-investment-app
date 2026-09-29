import {
  classifyAdviceOutcome,
  normalizeAdviceAction,
  type AdviceCalibrationPoint,
  type AdviceOutcomeClass,
} from "./investDecisionSimAdviceCalibration";

/** Quantize 24h move — 0.25pp steps so ±0.5% gates do not flicker on micro ticks. */
export function stabilizeAdviceMovePct(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  return Math.round(pct * 4) / 4;
}

const scoredOutcomeByPointId = new Map<string, AdviceOutcomeClass>();

/** Extra band beyond ±0.5% before flipping a scored outcome back to pending. */
const OUTCOME_HYSTERESIS_PP = 0.3;

function keepScoredOutcome(
  prev: "good" | "bad",
  action: ReturnType<typeof normalizeAdviceAction>,
  move: number,
): boolean {
  if (!action) return false;
  const buyGoodFloor = 0.5 - OUTCOME_HYSTERESIS_PP;
  const buyBadCeil = -0.5 + OUTCOME_HYSTERESIS_PP;
  const sellGoodCeil = -0.5 + OUTCOME_HYSTERESIS_PP;
  const sellBadFloor = 0.5 - OUTCOME_HYSTERESIS_PP;

  if (action === "buy") {
    if (prev === "good") return move >= buyGoodFloor;
    if (prev === "bad") return move <= buyBadCeil;
  }
  if (action === "sell") {
    if (prev === "good") return move <= sellGoodCeil;
    if (prev === "bad") return move >= sellBadFloor;
  }
  if (action === "hold" || action === "review") {
    if (prev === "good") return Math.abs(move) <= 6;
    if (prev === "bad") return move > -2.5;
  }
  return false;
}

/** Sticky good/bad labels — avoids KPI text jumping when 24h move hovers near ±0.5%. */
export function applyAdviceOutcomeHysteresis(
  points: AdviceCalibrationPoint[],
): AdviceCalibrationPoint[] {
  const liveIds = new Set(points.map((p) => p.id));
  for (const id of scoredOutcomeByPointId.keys()) {
    if (!liveIds.has(id)) scoredOutcomeByPointId.delete(id);
  }

  return points.map((p) => {
    const move = stabilizeAdviceMovePct(p.priceChangePct);
    const action = normalizeAdviceAction(p.suggestedAction);
    const fresh = classifyAdviceOutcome(p.suggestedAction, move);
    const prev = scoredOutcomeByPointId.get(p.id);

    let outcome = fresh ?? p.outcome;
    if (
      prev &&
      (prev === "good" || prev === "bad") &&
      fresh === "pending" &&
      move != null &&
      action &&
      keepScoredOutcome(prev, action, move)
    ) {
      outcome = prev;
    } else if (fresh === "good" || fresh === "bad") {
      outcome = fresh;
      scoredOutcomeByPointId.set(p.id, fresh);
    } else if (outcome !== "good" && outcome !== "bad") {
      scoredOutcomeByPointId.delete(p.id);
    }

    if (outcome === p.outcome && move === stabilizeAdviceMovePct(p.priceChangePct)) {
      return p;
    }
    return { ...p, outcome: outcome ?? p.outcome, priceChangePct: move };
  });
}

export function calibrationPointsSignature(points: AdviceCalibrationPoint[]): string {
  return JSON.stringify(
    points.map((p) => [
      p.id,
      p.outcome,
      p.suggestedAction,
      p.probPct != null && Number.isFinite(p.probPct) ? Math.round(p.probPct) : null,
      stabilizeAdviceMovePct(p.priceChangePct),
    ]),
  );
}

const Y_DOMAIN_MIN_PAD = 4;
const Y_DOMAIN_STEP = 2;
/** Hysteresis pad (pp) before rescaling BUY/SELL error chart Y axis. */
const Y_DOMAIN_HYSTERESIS_PP = 2;

let adviceErrorYDomainState: [number, number] = [-12, 12];

/** Sticky symmetric Y domain for advice error scatter — avoids dot jump on micro moves. */
export function stabilizeAdviceErrorYDomain(dots: { y: number }[]): [number, number] {
  if (!dots.length) return adviceErrorYDomainState;
  const maxAbs = Math.max(...dots.map((d) => Math.abs(d.y)), 3);
  const rawPad = Math.ceil(maxAbs * 1.2);
  const nextPad = Math.max(Y_DOMAIN_MIN_PAD, Math.ceil(rawPad / Y_DOMAIN_STEP) * Y_DOMAIN_STEP);
  const currentPad = adviceErrorYDomainState[1];
  if (Math.abs(nextPad - currentPad) >= Y_DOMAIN_HYSTERESIS_PP) {
    adviceErrorYDomainState = [-nextPad, nextPad];
  }
  return adviceErrorYDomainState;
}

export function resetAdviceErrorYDomainForTests(): void {
  adviceErrorYDomainState = [-12, 12];
  scoredOutcomeByPointId.clear();
}

export function recommendationOverviewSignature(overview: import("./recommendationEngineOverview").RecommendationEngineOverview): string {
  return JSON.stringify({
    totalDeals: overview.totalDeals,
    totalPending: overview.totalPending,
    simDeals: overview.simDeals,
    portfolioDeals: overview.portfolioDeals,
    weightedAccuracyPct:
      overview.weightedAccuracyPct != null
        ? Math.round(overview.weightedAccuracyPct * 10) / 10
        : null,
    best: overview.bestZone
      ? [overview.bestZone.action, overview.bestZone.successRatePct, overview.bestZone.good, overview.bestZone.bad]
      : null,
    review: overview.reviewZone
      ? [
          overview.reviewZone.action,
          overview.reviewZone.successRatePct,
          overview.reviewZone.good,
          overview.reviewZone.bad,
        ]
      : null,
    zones: overview.zoneCards.map((z) => [
      z.action,
      z.scored,
      z.pending,
      z.successRatePct,
      [...z.tickers].sort().join(","),
      z.smallSample,
    ]),
    dist: overview.distribution.map((d) => [d.action, d.count, d.pending]),
    buckets: overview.pplanBuckets.map((b) => [
      b.bucketId,
      b.successRatePct,
      b.goodCount,
      b.badCount,
      b.count,
    ]),
    anomaly: overview.bucketAnomaly?.bucketId ?? null,
  });
}
