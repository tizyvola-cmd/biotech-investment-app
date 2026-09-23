import type {
  AdviceActionKind,
  AdviceActionPrecisionRow,
  AdviceCalibrationBucketRow,
  AdviceCalibrationPoint,
} from "./investDecisionSimAdviceCalibration";

export const RECO_ACTION_COLORS: Record<AdviceActionKind, string> = {
  buy: "#10b981",
  sell: "#f43f5e",
  hold: "#0ea5e9",
  review: "#f59e0b",
};

export const RECO_ACTION_ORDER: AdviceActionKind[] = ["buy", "hold", "review", "sell"];

export const RECO_SMALL_SAMPLE_N = 8;

export type RecommendationZoneCard = {
  action: AdviceActionKind;
  scored: number;
  pending: number;
  successRatePct: number | null;
  tickers: string[];
  smallSample: boolean;
};

export type RecommendationBucketAnomaly = {
  bucketId: string;
  bucketLabel: string;
  successRatePct: number;
  prevBucketLabel: string;
  prevSuccessRatePct: number;
};

export type RecommendationEngineOverview = {
  totalDeals: number;
  totalPending: number;
  simDeals: number;
  portfolioDeals: number;
  weightedAccuracyPct: number | null;
  bestZone: AdviceActionPrecisionRow | null;
  reviewZone: AdviceActionPrecisionRow | null;
  zoneCards: RecommendationZoneCard[];
  distribution: Array<{ action: AdviceActionKind; count: number; pending: number; color: string }>;
  pplanBuckets: AdviceCalibrationBucketRow[];
  bucketAnomaly: RecommendationBucketAnomaly | null;
};

function uniqueTickersForAction(
  points: AdviceCalibrationPoint[],
  action: AdviceActionKind,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of points) {
    if (p.suggestedAction !== action) continue;
    if (p.outcome !== "good" && p.outcome !== "bad") continue;
    const tk = p.ticker.trim().toUpperCase();
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    out.push(tk);
  }
  return out.sort();
}

function pickBestZone(rows: AdviceActionPrecisionRow[]): AdviceActionPrecisionRow | null {
  const scored = rows.filter((r) => r.good + r.bad > 0 && r.successRatePct != null);
  if (!scored.length) return null;
  return scored.reduce((best, row) => {
    if (!best || (row.successRatePct ?? 0) > (best.successRatePct ?? 0)) return row;
    if ((row.successRatePct ?? 0) === (best.successRatePct ?? 0)) {
      return row.good + row.bad > best.good + best.bad ? row : best;
    }
    return best;
  });
}

function pickReviewZone(rows: AdviceActionPrecisionRow[]): AdviceActionPrecisionRow | null {
  const scored = rows.filter((r) => r.good + r.bad > 0 && r.successRatePct != null);
  if (!scored.length) return null;
  return scored.reduce((worst, row) => {
    if (!worst || (row.successRatePct ?? 100) < (worst.successRatePct ?? 100)) return row;
    if ((row.successRatePct ?? 100) === (worst.successRatePct ?? 100)) {
      return row.good + row.bad > worst.good + worst.bad ? row : worst;
    }
    return worst;
  });
}

export function detectPplanBucketAnomaly(
  buckets: AdviceCalibrationBucketRow[],
): RecommendationBucketAnomaly | null {
  let prev: AdviceCalibrationBucketRow | null = null;
  for (const bucket of buckets) {
    const scored = bucket.goodCount + bucket.badCount;
    if (scored === 0 || bucket.successRatePct == null) {
      if (scored > 0) prev = bucket;
      continue;
    }
    if (
      prev &&
      prev.successRatePct != null &&
      prev.goodCount + prev.badCount > 0 &&
      bucket.successRatePct < prev.successRatePct
    ) {
      return {
        bucketId: bucket.bucketId,
        bucketLabel: bucket.bucketLabel,
        successRatePct: bucket.successRatePct,
        prevBucketLabel: prev.bucketLabel,
        prevSuccessRatePct: prev.successRatePct,
      };
    }
    prev = bucket;
  }
  return null;
}

export function buildRecommendationEngineOverview(
  points: AdviceCalibrationPoint[],
  byAction: AdviceActionPrecisionRow[],
  pplanBuckets: AdviceCalibrationBucketRow[],
): RecommendationEngineOverview {
  const scored = points.filter((p) => p.outcome === "good" || p.outcome === "bad");
  const pending = points.filter((p) => p.outcome === "pending");
  const simDeals = scored.filter((p) => p.source === "experiment").length;
  const portfolioDeals = scored.filter((p) => p.source === "live").length;
  const good = scored.filter((p) => p.outcome === "good").length;
  const weightedAccuracyPct =
    scored.length > 0 ? Math.round((good / scored.length) * 1000) / 10 : null;

  const zoneCards: RecommendationZoneCard[] = RECO_ACTION_ORDER.map((action) => {
    const row = byAction.find((r) => r.action === action);
    const scoredN = row ? row.good + row.bad : 0;
    return {
      action,
      scored: scoredN,
      pending: row?.pending ?? 0,
      successRatePct: row?.successRatePct ?? null,
      tickers: uniqueTickersForAction(points, action),
      smallSample: scoredN > 0 && scoredN < RECO_SMALL_SAMPLE_N,
    };
  });

  const distribution = RECO_ACTION_ORDER.map((action) => {
    const card = zoneCards.find((z) => z.action === action)!;
    return {
      action,
      count: card.scored,
      pending: card.pending,
      color: RECO_ACTION_COLORS[action],
    };
  }).filter((d) => d.count > 0 || d.pending > 0);

  return {
    totalDeals: scored.length,
    totalPending: pending.length,
    simDeals,
    portfolioDeals,
    weightedAccuracyPct,
    bestZone: pickBestZone(byAction),
    reviewZone: pickReviewZone(byAction),
    zoneCards,
    distribution,
    pplanBuckets,
    bucketAnomaly: detectPplanBucketAnomaly(pplanBuckets),
  };
}
