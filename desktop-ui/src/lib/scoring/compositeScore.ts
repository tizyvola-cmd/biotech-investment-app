import type { Top2InvestVerdict } from "../../sheet/top2DecisionHelpers";
import type { StabilityVerdict } from "../../sheet/slopeStability";
import { timingWeightForDays } from "../../sheet/investSignalScore";
import {
  COMPOSITE_LOSS_PNL_PCT,
  getScoringZone,
  ZONE_WEIGHTS,
  type IndexId,
  type ScoringZone,
  type ZoneWeights,
} from "./zoneWeights";

export type CompositeScoreInput = {
  daysToCd: number | null;
  hasPosition: boolean;
  currentPnlPct?: number | null;
  probPlan?: number | null;
  investVerdict?: Top2InvestVerdict | null;
  entryVerdict?: Top2InvestVerdict | null;
  exitVerdict?: Top2InvestVerdict | null;
  precatKind?: string | null;
  stabilityVerdict?: StabilityVerdict | string | null;
  curveRisingHold?: boolean;
  slope20d?: number | null;
  signalScore?: number | null;
  sdsScore?: number | null;
  eisSuperScore?: number | null;
  matchPct?: number | null;
  miiAngleDeg?: number | null;
  forwardRoi?: number | null;
  spotVsModelGapPct?: number | null;
};

export type CompositeScoreResult = {
  score: number;
  zone: ScoringZone;
  breakdown: Record<IndexId, number>;
  normalizedWeights: Record<IndexId, number>;
  dampened: boolean;
};

const PRECAT_NORM: Record<string, number> = {
  enter: 1.0,
  accumulate: 0.75,
  too_early: 0.3,
  late: 0.4,
  avoid: 0.1,
  sell: 0.0,
};

export function stabilityFactorFromVerdict(
  verdict: StabilityVerdict | string | null | undefined,
  curveRisingHold = false,
): number {
  switch (verdict) {
    case "exit":
    case "avoid":
      return 0.18;
    case "watch":
      return curveRisingHold ? 0.74 : 0.52;
    case "none":
      return curveRisingHold ? 0.78 : 0.48;
    case "persistent":
      return 0.88;
    default:
      return 0.62;
  }
}

function top2Norm(verdict: Top2InvestVerdict | null | undefined): number {
  if (verdict === "yes") return 1;
  if (verdict === "wait") return 0.5;
  if (verdict === "no") return 0;
  return 0;
}

function normalizeIndex(
  id: IndexId,
  raw: number | string | null | undefined,
): number {
  if (raw === undefined || raw === null) return 0;

  switch (id) {
    case "pplan":
      return Math.min(Number(raw), 100) / 100;
    case "top2": {
      if (typeof raw === "string") return top2Norm(raw as Top2InvestVerdict);
      return Math.min(Number(raw), 100) / 100;
    }
    case "precat":
      if (typeof raw === "string") return PRECAT_NORM[raw] ?? 0;
      return Math.min(Number(raw), 100) / 100;
    case "slope":
      if (typeof raw === "number" && raw >= -1 && raw <= 1) return (raw + 1) / 2;
      return Math.min(Math.max(Number(raw), 0), 1);
    case "timing":
      return Math.min(Number(raw), 1);
    case "conf":
    case "sds":
    case "eis":
      return Math.min(Number(raw), 100) / 100;
    default:
      return Math.min(Math.max(Number(raw), 0), 100) / 100;
  }
}

function applyDampener(
  score: number,
  input: CompositeScoreInput,
): { score: number; dampened: boolean } {
  const weakSignals = [
    (input.sdsScore ?? 100) < 35,
    (input.miiAngleDeg ?? 0) < -5,
    (input.matchPct ?? 100) < 40,
    (input.forwardRoi ?? 99) < 2,
    Math.abs(input.spotVsModelGapPct ?? 0) > 8,
  ].filter(Boolean).length;

  if (weakSignals >= 2) {
    const factor = weakSignals >= 3 ? 0.82 : 0.9;
    return { score: Math.round(score * factor), dampened: true };
  }
  return { score, dampened: false };
}

function resolveTop2ForInput(input: CompositeScoreInput): Top2InvestVerdict | null {
  if (input.hasPosition) return input.exitVerdict ?? input.investVerdict ?? null;
  return input.entryVerdict ?? input.investVerdict ?? null;
}

function rawValuesForInput(input: CompositeScoreInput): Record<IndexId, number | string | undefined> {
  const slopeFactor = stabilityFactorFromVerdict(
    input.stabilityVerdict,
    input.curveRisingHold ?? false,
  );
  return {
    pplan: input.probPlan ?? undefined,
    top2: resolveTop2ForInput(input) ?? undefined,
    precat: input.precatKind ?? undefined,
    slope: slopeFactor,
    timing: timingWeightForDays(input.daysToCd),
    conf: input.signalScore ?? undefined,
    sds: input.sdsScore ?? undefined,
    eis: input.eisSuperScore ?? undefined,
  };
}

function normalizeWeights(weights: ZoneWeights): Record<IndexId, number> {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total <= 0) {
    const n = Object.keys(weights).length;
    return Object.fromEntries(
      Object.keys(weights).map((k) => [k, 1 / n]),
    ) as Record<IndexId, number>;
  }
  return Object.fromEntries(
    Object.entries(weights).map(([id, w]) => [id, w / total]),
  ) as Record<IndexId, number>;
}

export function computeCompositeScore(
  input: CompositeScoreInput,
  overrideZone?: ScoringZone,
): CompositeScoreResult {
  const isInLoss =
    input.hasPosition &&
    input.currentPnlPct != null &&
    Number.isFinite(input.currentPnlPct) &&
    input.currentPnlPct < COMPOSITE_LOSS_PNL_PCT;
  const zone = overrideZone ?? getScoringZone(input.daysToCd, input.hasPosition, isInLoss);
  const weights = ZONE_WEIGHTS[zone];
  const normalizedWeights = normalizeWeights(weights);
  const rawValues = rawValuesForInput(input);

  let rawScore = 0;
  const breakdown = {} as Record<IndexId, number>;

  (Object.keys(normalizedWeights) as IndexId[]).forEach((id) => {
    const nw = normalizedWeights[id]!;
    const normalized = normalizeIndex(id, rawValues[id]);
    const contrib = nw * normalized * 100;
    breakdown[id] = Math.round(contrib * 10) / 10;
    rawScore += contrib;
  });

  const roundedScore = Math.round(rawScore);
  const { score, dampened } = applyDampener(roundedScore, input);

  return { score, zone, breakdown, normalizedWeights, dampened };
}

export function topCompositeDrivers(
  breakdown: Record<string, number>,
  limit = 3,
): string {
  return Object.entries(breakdown)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([id, v]) => `${id} +${v.toFixed(0)}`)
    .join(" · ");
}

export const COMPOSITE_REVIEW_MIN = 55;
export const COMPOSITE_LOSS_REVIEW_MIN = 40;
