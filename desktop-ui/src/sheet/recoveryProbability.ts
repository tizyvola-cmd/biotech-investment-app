/**
 * Probabilità di recupero (in portafoglio) e di realizzazione piano (opportunità).
 * Modula exit/hold/review oltre alle regole hard su pendenza ↓.
 */
import type { StabilityVerdict } from "./slopeStability";
import {
  applyPlanProbIsotonicShrink,
  detectPlanProbMisalignments,
  misalignmentDampFactor,
  type PlanProbMisalignInput,
  type PlanProbMisalignmentId,
} from "./planProbCalibration";
import {
  inWatchEntryWindow,
  isWatchZoneEnterEnabled,
  resolveWatchEntryThresholds,
  WATCH_DAILY_MOMENTUM_MIN,
  WATCH_DAILY_STRONG_MIN,
  WATCH_FWD_PROVISIONAL_MIN,
  WATCH_GAINER_DAILY_MIN,
  WATCH_MATCH_MIN,
  WATCH_MATCH_STRONG_MIN,
  WATCH_P_ENTRY_MIN,
} from "./watchZoneEntryPolicy";

export type ProbabilisticDecision = "exit" | "hold" | "review";

export type RecoveryProbabilityContext = {
  matchPct?: number | null;
  sdsScore?: number | null;
  sdsVeto?: boolean;
  miiAngleDeg?: number | null;
  eisSuperScore?: number | null;
  windowCorr?: number | null;
  curveGapPct?: number | null;
  /** Model-curve % move over the active CD arc window (e.g. T−30→T−10). */
  segmentRoiPct?: number | null;
  dailyPct24h?: number | null;
  /** Watch-zone provisional target from Phase 2 curve extrapolation. */
  targetProvisional?: boolean;
  supernovaPeakPct?: number | null;
  planTargetProvisional?: boolean;
  harmonyAligned?: boolean | null;
  harmonyMaxGapPp?: number | null;
  precatKind?: string | null;
  investVerdict?: string | null;
  slope5d?: number | null;
  pred5Pp?: number | null;
  misalignmentIds?: PlanProbMisalignmentId[];
};

export type RecoveryDriverId =
  | "curve_gap"
  | "slope"
  | "match"
  | "sds"
  | "mii"
  | "window"
  | "eis"
  | "forward"
  | "daily_momentum";

export type RecoveryDriver = {
  id: RecoveryDriverId;
  factor: number;
  labelIt: string;
  labelEn: string;
};

export type RecoveryProbabilityInput = {
  lang: "it" | "en";
  inLoss: boolean;
  pnlPct: number | null;
  /** Rendimento forward da oggi (picco curva o target piano). */
  forwardPct: number | null;
  curveGapPct: number | null;
  matchPct: number | null;
  sdsScore: number | null;
  sdsVeto?: boolean;
  miiAngleDeg: number | null;
  stabilityVerdict: StabilityVerdict;
  curveRisingHold: boolean;
  daysToCd: number | null;
  /** Pearson ρ match→stock per finestra CD (Learning Lab), opzionale. */
  windowCorr?: number | null;
  eisSuperScore?: number | null;
  /** Model-curve % move over the active CD arc window (e.g. T−30→T−10). */
  segmentRoiPct?: number | null;
  /** Var. Giorn. % — momentum vs arco modello (missed-opportunity learning). */
  dailyPct24h?: number | null;
  /** Watch-zone provisional target from Phase 2 curve extrapolation. */
  targetProvisional?: boolean;
  supernovaPeakPct?: number | null;
  planTargetProvisional?: boolean;
  harmonyAligned?: boolean | null;
  harmonyMaxGapPp?: number | null;
  precatKind?: string | null;
  investVerdict?: string | null;
  slope5d?: number | null;
  pred5Pp?: number | null;
  misalignmentIds?: PlanProbMisalignmentId[];
};

export type RecoveryOutlook = {
  probabilityPct: number;
  expectedValuePct: number | null;
  coversLoss: boolean;
  lossPct: number | null;
  forwardPct: number | null;
  marginPct: number | null;
  pTrack: number;
  pSetup: number;
  pWindow: number;
  pEis: number;
  suggestedDecision: ProbabilisticDecision;
  drivers: RecoveryDriver[];
  summaryIt: string;
  summaryEn: string;
};

export type EntryProbabilityInput = Omit<
  RecoveryProbabilityInput,
  "inLoss" | "pnlPct"
> & {
  sdsVeto?: boolean;
};

export type EntryOutlook = {
  probabilityPct: number;
  expectedValuePct: number | null;
  forwardPct: number | null;
  suggestedDecision: ProbabilisticDecision;
  drivers: RecoveryDriver[];
  summaryIt: string;
  summaryEn: string;
};

export const RECOVERY_HOLD_PROB_MIN = 55;
const P_HOLD_MIN = RECOVERY_HOLD_PROB_MIN;
const P_EXIT_MAX = 35;
export const P_ENTRY_MIN = 60;
const P_ENTRY_WAIT_MIN = 40;
/** Minimum forward target (% vs today) to recommend Enter — not just > 0. */
export const FWD_ENTRY_MIN = 2;
/**
 * Multi-tier forward ROI minimums based on score quality.
 * 
 * Tier 1 (Perfect scores): SDS ≥ 70, Match ≥ 75, EIS ≥ 65 → forward ≥ 0.5%
 * Tier 2 (Good scores): SDS ≥ 60, Match ≥ 65, EIS ≥ 55 → forward ≥ 1.0%
 * Tier 3 (Moderate scores): SDS ≥ 50, Match ≥ 60, EIS ≥ 45 → forward ≥ 1.5%
 * 
 * Prevents filtering opportunities with strong technical setups but temporarily negative slope.
 */
export const FWD_ENTRY_MIN_PERFECT_SCORES = 0.5;  // Tier 1
export const FWD_ENTRY_MIN_GOOD_SCORES = 1.0;      // Tier 2
export const FWD_ENTRY_MIN_MODERATE_SCORES = 1.5;  // Tier 3
const FWD_ENTRY_MOMENTUM_MIN = 1;
const DAILY_MOMENTUM_STRONG_PCT = 2;

/** Operational CD window aligned with missed-opportunity audit. */
const OP_WINDOW_MIN_D = 14;
const OP_WINDOW_MAX_D = 60;
export const MOMENTUM_POLYGON_MATCH_STRONG = 70;
export const MOMENTUM_POLYGON_MATCH_MODERATE = 50;
export const MOMENTUM_POLYGON_DAILY_STRONG = 1;
export const MOMENTUM_POLYGON_DAILY_MODERATE = 1.8;
/** Allow Enter when model forward is flat but price is moving (PBYI-like). */
export const MOMENTUM_POLYGON_FWD_MIN = 0.35;
export const MOMENTUM_POLYGON_ENTRY_STRONG = 58;
export const MOMENTUM_POLYGON_ENTRY_MODERATE = 59;
export const OPERATIONAL_GAINER_ENTRY_MIN = 53.5;
export const OPERATIONAL_GAINER_FWD_MIN = 4;
export const OPERATIONAL_GAINER_DAILY_MIN = 1.5;

export type MomentumPolygonTier = "strong" | "moderate";

export function resolveWatchMomentumPolygonTier(
  ctx: Pick<
    RecoveryProbabilityInput,
    "matchPct" | "dailyPct24h" | "forwardPct" | "daysToCd" | "inLoss"
  >,
): MomentumPolygonTier | null {
  if (ctx.inLoss || !isWatchZoneEnterEnabled()) return null;
  const days = ctx.daysToCd;
  if (!inWatchEntryWindow(days)) return null;
  const fwd = ctx.forwardPct;
  if (fwd == null || fwd < MOMENTUM_POLYGON_FWD_MIN || fwd >= 4) return null;
  const daily = ctx.dailyPct24h;
  const match = ctx.matchPct;
  if (match == null || daily == null) return null;
  if (match >= WATCH_MATCH_STRONG_MIN && daily >= WATCH_DAILY_STRONG_MIN) return "strong";
  if (match >= MOMENTUM_POLYGON_MATCH_MODERATE && daily >= MOMENTUM_POLYGON_DAILY_MODERATE) {
    return "moderate";
  }
  return null;
}

function watchGainerRelief(
  input: Pick<
    RecoveryProbabilityInput,
    "forwardPct" | "dailyPct24h" | "daysToCd" | "inLoss" | "matchPct" | "targetProvisional"
  >,
): boolean {
  if (input.inLoss || !isWatchZoneEnterEnabled() || !inWatchEntryWindow(input.daysToCd)) {
    return false;
  }
  const fwd = input.forwardPct;
  const daily = input.dailyPct24h;
  const match = input.matchPct;
  return (
    fwd != null &&
    fwd >= WATCH_FWD_PROVISIONAL_MIN &&
    daily != null &&
    match != null &&
    match >= WATCH_MATCH_MIN &&
    ((daily >= WATCH_DAILY_MOMENTUM_MIN && match >= WATCH_MATCH_STRONG_MIN) ||
      (daily >= WATCH_GAINER_DAILY_MIN &&
        input.targetProvisional === true &&
        match >= WATCH_MATCH_STRONG_MIN) ||
      (daily >= WATCH_DAILY_STRONG_MIN && input.targetProvisional === true))
  );
}

function watchProvisionalMatchRelief(
  input: Pick<
    RecoveryProbabilityInput,
    "forwardPct" | "daysToCd" | "inLoss" | "matchPct" | "targetProvisional"
  >,
): boolean {
  if (input.inLoss || !isWatchZoneEnterEnabled() || !inWatchEntryWindow(input.daysToCd)) {
    return false;
  }
  return (
    input.targetProvisional === true &&
    input.matchPct != null &&
    input.matchPct >= WATCH_MATCH_STRONG_MIN &&
    input.forwardPct != null &&
    input.forwardPct >= WATCH_FWD_PROVISIONAL_MIN
  );
}

export function resolveMomentumPolygonTier(
  ctx: Pick<
    RecoveryProbabilityInput,
    "matchPct" | "dailyPct24h" | "forwardPct" | "daysToCd" | "inLoss"
  >,
): MomentumPolygonTier | null {
  if (ctx.inLoss) return null;
  const days = ctx.daysToCd;
  if (days == null || days < OP_WINDOW_MIN_D || days > OP_WINDOW_MAX_D) return null;
  const fwd = ctx.forwardPct;
  if (fwd == null || fwd < MOMENTUM_POLYGON_FWD_MIN || fwd >= FWD_ENTRY_MIN) return null;
  const daily = ctx.dailyPct24h;
  const match = ctx.matchPct;
  if (match == null || daily == null) return null;
  if (match >= MOMENTUM_POLYGON_MATCH_STRONG && daily >= MOMENTUM_POLYGON_DAILY_STRONG) {
    return "strong";
  }
  if (match >= MOMENTUM_POLYGON_MATCH_MODERATE && daily >= MOMENTUM_POLYGON_DAILY_MODERATE) {
    return "moderate";
  }
  return null;
}

function operationalGainerRelief(
  input: Pick<
    RecoveryProbabilityInput,
    "forwardPct" | "dailyPct24h" | "daysToCd" | "inLoss" | "matchPct"
  >,
): boolean {
  if (input.inLoss) return false;
  const days = input.daysToCd;
  if (days == null || days < OP_WINDOW_MIN_D || days > OP_WINDOW_MAX_D) return false;
  const fwd = input.forwardPct;
  const daily = input.dailyPct24h;
  return (
    fwd != null &&
    fwd >= OPERATIONAL_GAINER_FWD_MIN &&
    daily != null &&
    daily >= OPERATIONAL_GAINER_DAILY_MIN
  );
}

/** Strong target or decent match + 24h gain in the operational CD window. */
export function isOperationalGainerProfile(
  input: Pick<
    RecoveryProbabilityInput,
    "forwardPct" | "dailyPct24h" | "daysToCd" | "inLoss" | "matchPct"
  >,
): boolean {
  return operationalGainerRelief(input);
}

export function qualifiesOperationalGainerEntry(
  input: Pick<
    RecoveryProbabilityInput,
    "forwardPct" | "dailyPct24h" | "daysToCd" | "inLoss" | "matchPct"
  >,
): boolean {
  return operationalGainerRelief(input);
}

/** True when standard Enter forward min (2%) blocks but no momentum/operational exception applies. */
export function isForwardBelowEntryThreshold(
  forwardPct: number | null,
  ctx: Pick<
    RecoveryProbabilityInput,
    "matchPct" | "dailyPct24h" | "daysToCd" | "inLoss" | "targetProvisional" | "sdsScore" | "eisSuperScore"
  >,
): boolean {
  if (forwardPct == null || !Number.isFinite(forwardPct)) return true;
  const full = { ...ctx, forwardPct };
  if (resolveMomentumPolygonTier(full)) return false;
  if (resolveWatchMomentumPolygonTier(full)) return false;
  if (qualifiesOperationalGainerEntry(full) && forwardPct >= FWD_ENTRY_MIN) return false;
  if (
    isWatchZoneEnterEnabled() &&
    inWatchEntryWindow(ctx.daysToCd) &&
    (ctx.targetProvisional || (ctx.matchPct ?? 0) >= WATCH_MATCH_STRONG_MIN) &&
    forwardPct >= WATCH_FWD_PROVISIONAL_MIN
  ) {
    return false;
  }

  // Multi-tier score exception: soften forward ROI gate based on technical setup quality
  const sds = ctx.sdsScore ?? 0;
  const match = ctx.matchPct ?? 0;
  const eis = ctx.eisSuperScore ?? 0;

  // Tier 1: Perfect scores (SDS≥70, Match≥75, EIS≥65) → forward≥0.5%
  const hasPerfectScores = sds >= 70 && match >= 75 && eis >= 65;
  if (hasPerfectScores && forwardPct >= FWD_ENTRY_MIN_PERFECT_SCORES) {
    return false;
  }

  // Tier 2: Good scores (SDS≥60, Match≥65, EIS≥55) → forward≥1.0%
  // Captures BCAB (Match 66%), ENGNW (Match 67%, SDS likely good)
  const hasGoodScores = sds >= 60 && match >= 65 && eis >= 55;
  if (hasGoodScores && forwardPct >= FWD_ENTRY_MIN_GOOD_SCORES) {
    return false;
  }

  // Tier 3: Moderate scores (SDS≥50, Match≥60, EIS≥45) → forward≥1.5%
  // Safety net for borderline cases with decent fundamentals
  const hasModerateScores = sds >= 50 && match >= 60 && eis >= 45;
  if (hasModerateScores && forwardPct >= FWD_ENTRY_MIN_MODERATE_SCORES) {
    return false;
  }

  return forwardPct < FWD_ENTRY_MIN;
}

function momentumPolygonBoost(
  tier: MomentumPolygonTier,
  dailyPct24h: number,
  matchPct: number,
): number {
  if (tier === "strong") return Math.min(14, dailyPct24h * 2.5 + matchPct / 30);
  return Math.min(10, dailyPct24h * 2 + matchPct / 40);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clampPct(n: number): number {
  return Math.round(clamp01(n / 100) * 1000) / 10;
}

function lossMag(pnlPct: number | null): number | null {
  if (pnlPct == null || !Number.isFinite(pnlPct) || pnlPct >= -0.01) return null;
  return Math.abs(pnlPct);
}

function factorCurveGap(gapPct: number | null): { factor: number; driver?: RecoveryDriver } {
  if (gapPct == null || !Number.isFinite(gapPct)) {
    return { factor: 0.72 };
  }
  if (gapPct > 8) {
    return {
      factor: 0.42,
      driver: {
        id: "curve_gap",
        factor: 0.42,
        labelIt: `Spot >> modello (+${gapPct.toFixed(1)}%)`,
        labelEn: `Spot >> model (+${gapPct.toFixed(1)}%)`,
      },
    };
  }
  if (gapPct > 4) {
    return {
      factor: 0.55,
      driver: {
        id: "curve_gap",
        factor: 0.55,
        labelIt: `Spot sopra modello (+${gapPct.toFixed(1)}%)`,
        labelEn: `Spot above model (+${gapPct.toFixed(1)}%)`,
      },
    };
  }
  if (gapPct >= -0.5) return { factor: 0.92 };
  const factor = clamp01(1 + gapPct / 12);
  return {
    factor,
    driver: {
      id: "curve_gap",
      factor,
      labelIt: `Δ vs curva ${gapPct.toFixed(1)}%`,
      labelEn: `Δ vs curve ${gapPct.toFixed(1)}%`,
    },
  };
}

function factorSlope(
  verdict: StabilityVerdict,
  curveRisingHold: boolean,
): { factor: number; driver?: RecoveryDriver } {
  switch (verdict) {
    case "exit":
    case "avoid":
      return {
        factor: 0.18,
        driver: {
          id: "slope",
          factor: 0.18,
          labelIt: "Pendenza EXIT/AVOID",
          labelEn: "Slope EXIT/AVOID",
        },
      };
    case "watch":
      if (curveRisingHold) {
        return {
          factor: 0.74,
          driver: {
            id: "slope",
            factor: 0.74,
            labelIt: "Curva ↑ · WATCH",
            labelEn: "Curve ↑ · WATCH",
          },
        };
      }
      return {
        factor: 0.52,
        driver: {
          id: "slope",
          factor: 0.52,
          labelIt: "Pendenza WATCH",
          labelEn: "Slope WATCH",
        },
      };
    case "none":
      return {
        factor: curveRisingHold ? 0.78 : 0.48,
        driver: {
          id: "slope",
          factor: curveRisingHold ? 0.78 : 0.48,
          labelIt: curveRisingHold ? "Curva ↑ · slope piatta" : "Slope piatta",
          labelEn: curveRisingHold ? "Curve ↑ · flat slope" : "Flat slope",
        },
      };
    default:
      return { factor: 0.88 };
  }
}

function factorMatch(matchPct: number | null): { factor: number; driver?: RecoveryDriver } {
  if (matchPct == null || !Number.isFinite(matchPct)) return { factor: 0.58 };
  const factor = clamp01(matchPct / 100);
  if (factor >= 0.65) return { factor };
  return {
    factor,
    driver: {
      id: "match",
      factor,
      labelIt: `Match poligono ${Math.round(matchPct)}%`,
      labelEn: `Polygon match ${Math.round(matchPct)}%`,
    },
  };
}

function factorSds(
  score: number | null,
  veto?: boolean,
): { factor: number; driver?: RecoveryDriver } {
  if (veto) {
    return {
      factor: 0.12,
      driver: {
        id: "sds",
        factor: 0.12,
        labelIt: "SDS veto",
        labelEn: "SDS veto",
      },
    };
  }
  if (score == null || !Number.isFinite(score)) return { factor: 0.62 };
  let factor: number;
  if (score < 25) factor = 0.32;
  else if (score < 40) factor = 0.48;
  else if (score < 55) factor = 0.62;
  else factor = clamp01(score / 70);
  if (factor >= 0.65) return { factor };
  return {
    factor,
    driver: {
      id: "sds",
      factor,
      labelIt: `SDS ${Math.round(score)}`,
      labelEn: `SDS ${Math.round(score)}`,
    },
  };
}

function factorMii(angle: number | null): { factor: number; driver?: RecoveryDriver } {
  if (angle == null || !Number.isFinite(angle)) return { factor: 0.68 };
  if (angle >= 3) return { factor: 0.9 };
  if (angle >= 0) return { factor: 0.72 };
  const factor = clamp01(0.72 + angle / 25);
  return {
    factor,
    driver: {
      id: "mii",
      factor,
      labelIt: `MII ${angle.toFixed(1)}°`,
      labelEn: `MII ${angle.toFixed(1)}°`,
    },
  };
}

function factorWindow(
  daysToCd: number | null,
  windowCorr: number | null | undefined,
): { factor: number; driver?: RecoveryDriver } {
  let base: number;
  if (daysToCd == null || !Number.isFinite(daysToCd)) base = 0.62;
  else if (daysToCd <= 7) base = 0.72;
  else if (daysToCd <= 20) base = 0.82;
  else if (daysToCd <= 45) base = 0.76;
  else if (daysToCd <= 90) base = 0.64;
  else base = 0.52;

  if (windowCorr != null && Number.isFinite(windowCorr)) {
    base = clamp01(base * 0.55 + (0.45 + windowCorr * 0.35));
  }
  return { factor: base };
}

function factorEis(superScore: number | null | undefined): { factor: number; driver?: RecoveryDriver } {
  if (superScore == null || !Number.isFinite(superScore)) return { factor: 0.68 };
  if (superScore >= 8) return { factor: 0.88 };
  if (superScore >= 2) return { factor: 0.78 };
  if (superScore <= -8) return { factor: 0.48, driver: { id: "eis", factor: 0.48, labelIt: "EIS molto negativo", labelEn: "EIS very negative" } };
  if (superScore < 0) return { factor: 0.58 };
  return { factor: 0.72 };
}

function factorForward(forwardPct: number | null): { factor: number; driver?: RecoveryDriver } {
  if (forwardPct == null || !Number.isFinite(forwardPct)) {
    return { factor: 0.42, driver: { id: "forward", factor: 0.42, labelIt: "Target forward assente", labelEn: "Missing forward target" } };
  }
  if (forwardPct <= 0) {
    return {
      factor: 0.08,
      driver: { id: "forward", factor: 0.08, labelIt: "Target forward ≤ 0", labelEn: "Forward target ≤ 0" },
    };
  }
  let factor: number;
  if (forwardPct < 1) factor = 0.28;
  else if (forwardPct < FWD_ENTRY_MIN) factor = 0.42;
  else if (forwardPct < 4) factor = 0.58;
  else if (forwardPct < 8) factor = 0.72;
  else factor = clamp01(forwardPct / 12);
  if (factor >= 0.65) return { factor };
  return {
    factor,
    driver: {
      id: "forward",
      factor,
      labelIt: `Target forward +${forwardPct.toFixed(1)}%`,
      labelEn: `Forward target +${forwardPct.toFixed(1)}%`,
    },
  };
}

function factorArcMomentum(
  segmentRoiPct: number | null | undefined,
  dailyPct24h?: number | null,
): { factor: number; driver?: RecoveryDriver } {
  if (segmentRoiPct == null || !Number.isFinite(segmentRoiPct)) return { factor: 0.68 };
  let factor: number;
  if (segmentRoiPct <= -3) factor = 0.36;
  else if (segmentRoiPct < 0) factor = 0.5;
  else if (segmentRoiPct < 2) factor = 0.62;
  else factor = clamp01(0.62 + segmentRoiPct / 25);

  // Market leading model: strong 24h gain despite negative arc on historical segment.
  if (
    segmentRoiPct < 0 &&
    dailyPct24h != null &&
    dailyPct24h >= DAILY_MOMENTUM_STRONG_PCT
  ) {
    const boost = clamp01(0.45 + dailyPct24h / 12);
    factor = Math.max(factor, boost);
    return {
      factor,
      driver: {
        id: "daily_momentum",
        factor,
        labelIt: `24h +${dailyPct24h.toFixed(1)}% vs arco ${segmentRoiPct.toFixed(1)}%`,
        labelEn: `24h +${dailyPct24h.toFixed(1)}% vs arc ${segmentRoiPct.toFixed(1)}%`,
      },
    };
  }

  if (factor >= 0.65) return { factor };
  if (segmentRoiPct <= -3 || segmentRoiPct < 0) {
    return {
      factor,
      driver: {
        id: "forward",
        factor,
        labelIt: `ROI arco ${segmentRoiPct.toFixed(1)}%`,
        labelEn: `Arc ROI ${segmentRoiPct.toFixed(1)}%`,
      },
    };
  }
  return { factor };
}

function factorDailyMomentum(dailyPct24h: number | null | undefined): {
  factor: number;
  driver?: RecoveryDriver;
} {
  if (dailyPct24h == null || !Number.isFinite(dailyPct24h) || dailyPct24h < 0.5) {
    return { factor: 0.68 };
  }
  const factor = clamp01(0.62 + dailyPct24h / 18);
  if (factor >= 0.72) return { factor };
  return {
    factor,
    driver: {
      id: "daily_momentum",
      factor,
      labelIt: `Var. Giorn. +${dailyPct24h.toFixed(1)}%`,
      labelEn: `Daily move +${dailyPct24h.toFixed(1)}%`,
    },
  };
}

function pickDrivers(parts: Array<{ factor: number; driver?: RecoveryDriver }>, max = 3): RecoveryDriver[] {
  return parts
    .filter((p) => p.driver != null)
    .sort((a, b) => a.factor - b.factor)
    .slice(0, max)
    .map((p) => p.driver!);
}

function planProbMisalignInputFromRecovery(input: RecoveryProbabilityInput): PlanProbMisalignInput {
  return {
    curveGapPct: input.curveGapPct,
    planReturnPct: input.forwardPct,
    planTargetProvisional: input.planTargetProvisional ?? input.targetProvisional ?? false,
    supernovaPeakPct: input.supernovaPeakPct ?? null,
    harmonyAligned: input.harmonyAligned ?? null,
    harmonyMaxGapPp: input.harmonyMaxGapPp ?? null,
    precatKind: input.precatKind ?? null,
    investVerdict: input.investVerdict ?? null,
    slope5d: input.slope5d ?? null,
    pred5Pp: input.pred5Pp ?? null,
    misalignmentIds: input.misalignmentIds,
  };
}

function shouldApplyIsotonicShrink(input: RecoveryProbabilityInput, dampenedPct: number): boolean {
  if (input.inLoss || dampenedPct < 70) return false;
  const ctx = { ...input, inLoss: false as const };
  if (resolveMomentumPolygonTier(ctx)) return false;
  if (resolveWatchMomentumPolygonTier(ctx)) return false;
  if (qualifiesOperationalGainerEntry(ctx)) return false;
  if (watchGainerRelief(ctx)) return false;
  return true;
}

function applyPlanProbCalibrationLayer(
  rawPct: number,
  input: RecoveryProbabilityInput,
  drivers: RecoveryDriver[],
): number {
  const misalignInput = planProbMisalignInputFromRecovery(input);
  const misalignmentIds = detectPlanProbMisalignments(misalignInput);
  const dampFactor = misalignmentDampFactor(misalignmentIds);

  let probabilityPct = shouldApplyIsotonicShrink(input, rawPct)
    ? applyPlanProbIsotonicShrink(rawPct)
    : rawPct;
  probabilityPct = clampPct(probabilityPct * dampFactor);

  if (misalignmentIds.length > 0 && probabilityPct < rawPct - 0.5) {
    drivers.push({
      id: "curve_gap",
      factor: dampFactor,
      labelIt: `Disallineamento curve (${misalignmentIds.length}) · shrink P(plan)`,
      labelEn: `Curve misalignment (${misalignmentIds.length}) · P(plan) shrink`,
    });
  } else if (
    shouldApplyIsotonicShrink(input, rawPct) &&
    rawPct >= 70 &&
    probabilityPct < rawPct - 0.5
  ) {
    drivers.push({
      id: "match",
      factor: probabilityPct / 100,
      labelIt: `Calibrazione isotonica 70–79% (${rawPct.toFixed(0)}→${probabilityPct.toFixed(0)})`,
      labelEn: `Isotonic 70–79% calibration (${rawPct.toFixed(0)}→${probabilityPct.toFixed(0)})`,
    });
  }
  return probabilityPct;
}

function combineProbability(parts: number[]): number {
  if (!parts.length) return 50;
  const geo = parts.reduce((acc, p) => acc * clamp01(p), 1);
  const n = parts.length;
  return clampPct(Math.pow(geo, 1 / n) * 100);
}

/** Penalizza profili con più segnali deboli concorrenti (es. TELA: Δ, SDS, MII, match). */
function weakSetupDampener(
  pSetup: number,
  pTrack: number,
  input: RecoveryProbabilityInput,
): number {
  const weakSds = input.sdsScore != null && input.sdsScore < 35;
  const weakMii = input.miiAngleDeg != null && input.miiAngleDeg < -5;
  const deepGap = input.curveGapPct != null && input.curveGapPct < -4;
  const momTier = !input.inLoss ? resolveMomentumPolygonTier(input) : null;
  const opRelief = !input.inLoss && operationalGainerRelief(input);
  const weakForward =
    !momTier && input.forwardPct != null && input.forwardPct < FWD_ENTRY_MIN;
  const weakMatch =
    opRelief || (inWatchEntryWindow(input.daysToCd) && watchGainerRelief(input))
      ? false
      : input.matchPct != null &&
        input.matchPct < (inWatchEntryWindow(input.daysToCd) ? WATCH_MATCH_MIN : 62);
  const weakCount = [weakSds, weakMii, weakMatch, deepGap, weakForward].filter(Boolean).length;
  let damp = 1;
  if (weakCount >= 3) damp *= 0.82;
  else if (weakCount >= 2) damp *= 0.9;
  if (pSetup < 0.52 && pTrack < 0.55) damp *= 0.9;
  return damp;
}

function recoveryDecision(
  coversLoss: boolean,
  probPct: number,
  evPct: number | null,
): ProbabilisticDecision {
  if (!coversLoss) {
    if (probPct < P_EXIT_MAX) return "exit";
    if (probPct < P_HOLD_MIN) return "review";
    return "review";
  }
  if (evPct != null && evPct < -0.5) return "exit";
  if (probPct >= P_HOLD_MIN) return "hold";
  if (probPct < P_EXIT_MAX) return "exit";
  return "review";
}

function entryDecision(
  probPct: number,
  forwardPct: number | null,
  veto?: boolean,
  dailyPct24h?: number | null,
  matchPct?: number | null,
  daysToCd?: number | null,
  targetProvisional?: boolean,
  sdsScore?: number | null,
  eisSuperScore?: number | null,
): ProbabilisticDecision {
  const ctxBase = {
    inLoss: false as const,
    matchPct: matchPct ?? null,
    dailyPct24h: dailyPct24h ?? null,
    forwardPct,
    daysToCd: daysToCd ?? null,
    targetProvisional,
  };
  const tier =
    resolveMomentumPolygonTier(ctxBase) ?? resolveWatchMomentumPolygonTier(ctxBase);
  const opGainer = qualifiesOperationalGainerEntry(ctxBase);
  const watchGainer = watchGainerRelief(ctxBase);
  const strongDaily =
    dailyPct24h != null && dailyPct24h >= DAILY_MOMENTUM_STRONG_PCT;
  let fwdMin = FWD_ENTRY_MIN;
  let entryMin = P_ENTRY_MIN;
  const waitMin = P_ENTRY_WAIT_MIN;

  const watchTh = resolveWatchEntryThresholds(daysToCd, {
    targetProvisional,
    dailyPct24h,
    matchPct,
  });
  if (watchTh && isWatchZoneEnterEnabled()) {
    fwdMin = watchTh.fwdMin;
    entryMin = watchTh.pEntryMin;
  }

  if (tier) {
    fwdMin = MOMENTUM_POLYGON_FWD_MIN;
    entryMin =
      tier === "strong" ? MOMENTUM_POLYGON_ENTRY_STRONG : MOMENTUM_POLYGON_ENTRY_MODERATE;
  } else if (opGainer) {
    entryMin = OPERATIONAL_GAINER_ENTRY_MIN;
  } else if (watchGainer) {
    entryMin = WATCH_P_ENTRY_MIN - 1;
    fwdMin = WATCH_FWD_PROVISIONAL_MIN;
  } else if (strongDaily && probPct >= P_ENTRY_WAIT_MIN + 15) {
    fwdMin = FWD_ENTRY_MOMENTUM_MIN;
  }

  // Multi-tier score exception: apply relaxed forward ROI thresholds based on score quality
  const sds = sdsScore ?? 0;
  const match = matchPct ?? 0;
  const eis = eisSuperScore ?? 0;

  // Tier 1: Perfect scores → forward ≥ 0.5%
  if (sds >= 70 && match >= 75 && eis >= 65) {
    fwdMin = Math.min(fwdMin, FWD_ENTRY_MIN_PERFECT_SCORES);
  }
  // Tier 2: Good scores → forward ≥ 1.0%
  else if (sds >= 60 && match >= 65 && eis >= 55) {
    fwdMin = Math.min(fwdMin, FWD_ENTRY_MIN_GOOD_SCORES);
  }
  // Tier 3: Moderate scores → forward ≥ 1.5%
  else if (sds >= 50 && match >= 60 && eis >= 45) {
    fwdMin = Math.min(fwdMin, FWD_ENTRY_MIN_MODERATE_SCORES);
  }

  if (veto || forwardPct == null || forwardPct < fwdMin) return "exit";
  if (probPct >= entryMin) return "hold";
  if (probPct >= (watchTh?.pEntryWaitMin ?? waitMin)) return "review";
  return "exit";
}

export function computeRecoveryOutlook(input: RecoveryProbabilityInput): RecoveryOutlook {
  const loss = lossMag(input.pnlPct);
  const forward = input.forwardPct;
  const coversLoss =
    loss != null && forward != null && Number.isFinite(forward) && forward >= loss - 0.05;
  const margin =
    loss != null && forward != null && Number.isFinite(forward) ? forward - loss : null;

  const gapPart = factorCurveGap(input.curveGapPct);
  const slopePart = factorSlope(input.stabilityVerdict, input.curveRisingHold);
  const matchPart = factorMatch(input.matchPct);
  const sdsPart = factorSds(input.sdsScore, input.sdsVeto);
  const miiPart = factorMii(input.miiAngleDeg);
  const windowPart = factorWindow(input.daysToCd, input.windowCorr);
  const eisPart = factorEis(input.eisSuperScore);
  const forwardPart = factorForward(forward);
  const arcPart = factorArcMomentum(input.segmentRoiPct, input.dailyPct24h);
  const dailyPart = factorDailyMomentum(input.dailyPct24h);

  const pTrack = clamp01(gapPart.factor * 0.55 + slopePart.factor * 0.45);
  const pSetup = clamp01(matchPart.factor * 0.45 + sdsPart.factor * 0.35 + miiPart.factor * 0.2);
  const pWindow = windowPart.factor;
  const pEis = eisPart.factor;

  let probabilityPct = combineProbability([
    pTrack,
    pSetup,
    pWindow,
    pEis,
    forwardPart.factor,
    arcPart.factor,
    dailyPart.factor,
  ]);
  probabilityPct = clampPct(probabilityPct * weakSetupDampener(pSetup, pTrack, input));
  const momTier = !input.inLoss ? resolveMomentumPolygonTier(input) : null;
  if (momTier) {
    probabilityPct = clampPct(
      Math.min(
        100,
        probabilityPct +
          momentumPolygonBoost(momTier, input.dailyPct24h ?? 0, input.matchPct ?? 0),
      ),
    );
  } else if (!input.inLoss && operationalGainerRelief(input)) {
    probabilityPct = clampPct(Math.min(100, probabilityPct + 7));
  } else if (!input.inLoss && watchGainerRelief(input)) {
    probabilityPct = clampPct(Math.min(100, probabilityPct + 5));
  } else if (!input.inLoss && watchProvisionalMatchRelief(input)) {
    probabilityPct = clampPct(Math.min(100, probabilityPct + 4));
  }

  const drivers = pickDrivers([
    gapPart,
    slopePart,
    matchPart,
    sdsPart,
    miiPart,
    eisPart,
    forwardPart,
    arcPart,
    dailyPart,
  ]);
  probabilityPct = applyPlanProbCalibrationLayer(probabilityPct, input, drivers);

  let expectedValuePct: number | null = null;
  if (loss != null && forward != null && Number.isFinite(forward)) {
    const p = probabilityPct / 100;
    const upside = coversLoss ? forward - loss : forward;
    const downside = loss;
    expectedValuePct = Math.round((p * upside - (1 - p) * downside) * 10) / 10;
  }

  const fwdMinForHold =
    input.dailyPct24h != null && input.dailyPct24h >= DAILY_MOMENTUM_STRONG_PCT
      ? FWD_ENTRY_MOMENTUM_MIN
      : FWD_ENTRY_MIN;
  const suggestedDecision = input.inLoss
    ? recoveryDecision(coversLoss, probabilityPct, expectedValuePct)
    : forward != null && forward >= fwdMinForHold && probabilityPct >= P_HOLD_MIN
      ? "hold"
      : "review";

  const driverText =
    drivers.length > 0
      ? drivers.map((d) => (input.lang === "it" ? d.labelIt : d.labelEn)).join(" · ")
      : input.lang === "it"
        ? "Profilo neutro"
        : "Neutral profile";

  const summaryIt = input.inLoss
    ? coversLoss
      ? `P(recupero) ${probabilityPct.toFixed(0)}% · curva +${forward?.toFixed(1)}% copre −${loss?.toFixed(1)}% · ${driverText}`
      : `P(recupero) ${probabilityPct.toFixed(0)}% · curva non copre la perdita −${loss?.toFixed(1)}% · ${driverText}`
    : `P(realizzazione) ${probabilityPct.toFixed(0)}% · ${driverText}`;

  const summaryEn = input.inLoss
    ? coversLoss
      ? `P(recovery) ${probabilityPct.toFixed(0)}% · curve +${forward?.toFixed(1)}% covers −${loss?.toFixed(1)}% · ${driverText}`
      : `P(recovery) ${probabilityPct.toFixed(0)}% · curve does not cover −${loss?.toFixed(1)}% loss · ${driverText}`
    : `P(realization) ${probabilityPct.toFixed(0)}% · ${driverText}`;

  return {
    probabilityPct,
    expectedValuePct,
    coversLoss,
    lossPct: loss,
    forwardPct: forward,
    marginPct: margin,
    pTrack,
    pSetup,
    pWindow,
    pEis,
    suggestedDecision,
    drivers,
    summaryIt,
    summaryEn,
  };
}

export function computeEntryOutlook(input: EntryProbabilityInput): EntryOutlook {
  const recovery = computeRecoveryOutlook({
    ...input,
    inLoss: false,
    pnlPct: null,
  });
  const suggestedDecision = entryDecision(
    recovery.probabilityPct,
    input.forwardPct,
    input.sdsVeto,
    input.dailyPct24h,
    input.matchPct,
    input.daysToCd,
    input.targetProvisional,
    input.sdsScore,
    input.eisSuperScore,
  );
  const ev =
    input.forwardPct != null && Number.isFinite(input.forwardPct)
      ? Math.round((recovery.probabilityPct / 100) * input.forwardPct * 10) / 10
      : null;

  const summaryIt = `P(piano) ${recovery.probabilityPct.toFixed(0)}% · target +${input.forwardPct?.toFixed(1) ?? "—"}% · ${recovery.summaryIt.split("·").slice(-1)[0]?.trim() ?? ""}`;
  const summaryEn = `P(plan) ${recovery.probabilityPct.toFixed(0)}% · target +${input.forwardPct?.toFixed(1) ?? "—"}% · ${recovery.summaryEn.split("·").slice(-1)[0]?.trim() ?? ""}`;

  return {
    probabilityPct: recovery.probabilityPct,
    expectedValuePct: ev,
    forwardPct: input.forwardPct,
    suggestedDecision,
    drivers: recovery.drivers,
    summaryIt,
    summaryEn,
  };
}

export function recoveryReasonAppend(
  baseReason: string,
  outlook: RecoveryOutlook | EntryOutlook | null,
  lang: "it" | "en",
): string {
  if (!outlook) return baseReason;
  const summary = lang === "it" ? outlook.summaryIt : outlook.summaryEn;
  if (!baseReason.trim()) return summary;
  if (baseReason.includes(String(outlook.probabilityPct.toFixed(0)))) return baseReason;
  return `${baseReason} · ${summary}`;
}

/** Remove P(plan|recovery) prefix from reason line — shown separately as hero readout. */
export function stripProbabilityFromReason(text: string): string {
  return text
    .replace(/\s*·\s*P\((plan|piano|recovery|recupero|realization|realizzazione)\)\s*[\d.]+%/gi, "")
    .trim();
}
