/**
 * Risk & Benefit — benefit (heart) side scoring.
 *
 * Risk (skull) stays on Phase A loss lifts + Phase B pattern (`lossRiskInvestmentScore`).
 * Benefit v2 (validation + live blend): P(plan)-led with SDS + slope; P(win) capped.
 */
import { deriveBenefitFillPct } from "../components/RiskBenefitScaleIcon";
import { shouldUseDailyBenefitFallback } from "./pulsePlanGapDisplay";

/** Benefit blend v2 — sums to 1.0; missing components renormalize among present parts. */
export const BENEFIT_BLEND_V2_WEIGHTS = {
  pplan: 0.6,
  sds: 0.25,
  slope: 0.15,
  win: 0.1,
} as const;

type BenefitBlendPart = { v: number; w: number };

function blendBenefitV2Parts(parts: BenefitBlendPart[]): number {
  const active = parts.filter((p) => p.v > 0 && p.w > 0);
  if (active.length === 0) return 0;
  const wSum = active.reduce((s, p) => s + p.w, 0);
  return active.reduce((s, p) => s + p.v * (p.w / wSum), 0);
}

export type BenefitFillSource =
  | "plan_forward"
  | "approved_blend"
  | "daily_24h"
  | "neutral";

/** Map approved Bayesian win rate (0–1) → benefit fill 0–100. */
export function approvedWinRateToBenefitPct(winRate: number): number {
  if (!Number.isFinite(winRate)) return 0;
  const scaled = ((winRate - 0.35) / 0.65) * 100;
  return Math.max(0, Math.min(100, scaled));
}

/** Inverse of approved P(win) — fallback risk when Phase A has no eligible bucket. */
export function approvedWinRateToRiskPct(winRate: number): number {
  return 100 - approvedWinRateToBenefitPct(winRate);
}

/** Map EMS magnitude tilt [0.5, 2] → benefit fill 0–100. */
export function emsTiltToBenefitPct(tilt: number): number {
  if (!Number.isFinite(tilt)) return 0;
  const scaled = ((tilt - 0.5) / 1.5) * 100;
  return Math.max(0, Math.min(100, scaled));
}

/** Entry P(plan) / affidabilità (0–100) → benefit component. */
export function entryAffidabilitaToBenefitPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

/** Entry slope 20d (pp/day) → benefit; +0.5 pp/day ≈ high momentum. */
export function entrySlope20dToBenefitPct(slope: number): number {
  if (!Number.isFinite(slope)) return 0;
  const scaled = 50 + (slope / 0.5) * 50;
  return Math.max(0, Math.min(100, scaled));
}

/** Entry SDS score (0–100) → benefit component — same axis as SuperNova SDS column. */
export function entrySdsToBenefitPct(sds: number): number {
  if (!Number.isFinite(sds)) return 0;
  return Math.max(0, Math.min(100, sds));
}

export type BenefitFillResult = {
  fillPct: number;
  perDayPct: number | null;
  source: BenefitFillSource;
  /** Short IT/EN tooltip fragment describing the dominant input. */
  sourceNoteIt: string;
  sourceNoteEn: string;
};

export function deriveBenefitFillPctEnhanced(args: {
  expectedReturnPct?: number | null;
  daysToTarget?: number | null;
  dailyChangePct?: number | null;
  capitalEur?: number | null;
  pnlPct?: number | null;
  /** Composite or single-cell approved win rate in [0, 1]. */
  approvedWinRate?: number | null;
  /** EMS magnitude tilt in [0.5, 2], 1 = neutral. */
  emsTilt?: number | null;
  /** Entry P(plan) / affidabilità % (0–100). */
  entryAffidabilitaPct?: number | null;
  /** Entry slope 20d from decision log (pp/day) — not daily % change. */
  entrySlope20d?: number | null;
  /** Entry SDS score (0–100). Preferred over EMS tilt in v2 blend. */
  entrySdsPct?: number | null;
}): BenefitFillResult {
  const {
    expectedReturnPct,
    daysToTarget,
    dailyChangePct,
    capitalEur,
    pnlPct,
    approvedWinRate,
    emsTilt,
    entryAffidabilitaPct,
    entrySlope20d,
    entrySdsPct,
  } = args;

  const planPerDay =
    expectedReturnPct != null &&
    Number.isFinite(expectedReturnPct) &&
    daysToTarget != null &&
    Number.isFinite(daysToTarget) &&
    daysToTarget > 0
      ? expectedReturnPct / daysToTarget
      : null;

  const planFill = deriveBenefitFillPct({
    expectedReturnPct,
    daysToTarget,
    dailyChangePct: null,
    capitalEur,
    pnlPct,
  });

  if (planPerDay != null && planPerDay > 0 && planFill > 0) {
    const winBlend =
      approvedWinRate != null && Number.isFinite(approvedWinRate)
        ? approvedWinRateToBenefitPct(approvedWinRate) * 0.2
        : 0;
    return {
      fillPct: Math.min(100, planFill * 0.8 + winBlend),
      perDayPct: planPerDay,
      source: "plan_forward",
      sourceNoteIt: "Piano gain / giorni al CD (+20% P(win) approvato)",
      sourceNoteEn: "Gain plan / days to CD (+20% approved P(win))",
    };
  }

  const winB =
    approvedWinRate != null && Number.isFinite(approvedWinRate)
      ? approvedWinRateToBenefitPct(approvedWinRate)
      : 0;
  const sdsB =
    entrySdsPct != null && Number.isFinite(entrySdsPct)
      ? entrySdsToBenefitPct(entrySdsPct)
      : emsTilt != null && Number.isFinite(emsTilt)
        ? emsTiltToBenefitPct(emsTilt)
        : 0;
  const pplanB =
    entryAffidabilitaPct != null && Number.isFinite(entryAffidabilitaPct)
      ? entryAffidabilitaToBenefitPct(entryAffidabilitaPct)
      : 0;
  const slopeB =
    entrySlope20d != null && Number.isFinite(entrySlope20d)
      ? entrySlope20dToBenefitPct(entrySlope20d)
      : 0;
  const dailyOk = shouldUseDailyBenefitFallback({ capitalEur, pnlPct });
  const dailyB = dailyOk
    ? deriveBenefitFillPct({
        expectedReturnPct: null,
        daysToTarget: null,
        dailyChangePct,
        capitalEur,
        pnlPct,
      })
    : 0;

  const sdsLabelIt =
    entrySdsPct != null && Number.isFinite(entrySdsPct) ? "SDS" : "EMS";
  const sdsLabelEn = sdsLabelIt;

  const blendParts = [
    { v: pplanB, w: BENEFIT_BLEND_V2_WEIGHTS.pplan, labelIt: "P(plan)", labelEn: "P(plan)" },
    { v: sdsB, w: BENEFIT_BLEND_V2_WEIGHTS.sds, labelIt: sdsLabelIt, labelEn: sdsLabelEn },
    { v: slopeB, w: BENEFIT_BLEND_V2_WEIGHTS.slope, labelIt: "slope 20d", labelEn: "slope 20d" },
    { v: winB, w: BENEFIT_BLEND_V2_WEIGHTS.win, labelIt: "P(win)", labelEn: "P(win)" },
  ].filter((p) => p.v > 0);

  if (blendParts.length > 0 || dailyB > 0) {
    const wSum = blendParts.reduce((s, p) => s + p.w, 0);
    let fill =
      wSum > 0
        ? blendParts.reduce((s, p) => s + p.v * (p.w / wSum), 0)
        : 0;
    if (dailyB > 0 && blendParts.length === 0) {
      fill = dailyB;
    } else if (dailyB > 0) {
      fill = fill * 0.85 + dailyB * 0.15;
    }
    const labelsIt = blendParts.map((p) => p.labelIt).join(" · ");
    const labelsEn = blendParts.map((p) => p.labelEn).join(" · ");
    const perDay =
      dailyOk && dailyChangePct != null && Number.isFinite(dailyChangePct)
        ? dailyChangePct
        : null;
    return {
      fillPct: Math.max(0, Math.min(100, fill)),
      perDayPct: perDay,
      source: "approved_blend",
      sourceNoteIt: labelsIt
        ? `${labelsIt}${dailyB > 0 ? " · 24h 15%" : ""}`
        : "Movimento 24h realizzato",
      sourceNoteEn: labelsEn
        ? `${labelsEn}${dailyB > 0 ? " · 24h 15%" : ""}`
        : "Realised 24h move",
    };
  }

  const legacy = deriveBenefitFillPct({
    expectedReturnPct,
    daysToTarget,
    dailyChangePct,
    capitalEur,
    pnlPct,
  });
  if (legacy > 0) {
    return {
      fillPct: legacy,
      perDayPct:
        dailyChangePct != null && Number.isFinite(dailyChangePct)
          ? dailyChangePct
          : planPerDay,
      source: "daily_24h",
      sourceNoteIt: "Movimento 24h realizzato",
      sourceNoteEn: "Realised 24h move",
    };
  }

  return {
    fillPct: 0,
    perDayPct: null,
    source: "neutral",
    sourceNoteIt: "Nessun segnale beneficio",
    sourceNoteEn: "No benefit signal",
  };
}

export type ClosedDealBenefitComponents = {
  benefitScore: number;
  /** Scaled P(win) approved component (0–100) — max 10% weight in v2 blend. */
  winComponentPct: number;
  /** Scaled P(plan) entry component (0–100) — 60% weight in v2 blend when present. */
  pplanComponentPct: number;
  /** Scaled SDS entry component (0–100) — 25% weight in v2 blend when present. */
  sdsComponentPct: number;
  /** Scaled slope 20d component (0–100) — 15% weight in v2 blend when present. */
  slopeComponentPct: number;
  /** Raw entry P(plan) / affidabilità % (0–100) — same axis as Model Quality P(plan). */
  entryPplanPct: number | null;
  /** Raw entry SDS (0–100). */
  entrySdsPct: number | null;
};

/**
 * Benefit index for **closed-deal validation** only — entry snapshots, no live sim
 * marks, no SDS payoffWin / days_to_cd plan shortcut (that path inflates benefit
 * on lottery names and inverts correlation vs realised P&L).
 */
export function deriveClosedDealEntryBenefitComponents(args: {
  approvedWinRate?: number | null;
  entryAffidabilitaPct?: number | null;
  entrySlope20d?: number | null;
  entrySdsPct?: number | null;
}): ClosedDealBenefitComponents {
  const winB =
    args.approvedWinRate != null && Number.isFinite(args.approvedWinRate)
      ? approvedWinRateToBenefitPct(args.approvedWinRate)
      : 0;
  const pplanB =
    args.entryAffidabilitaPct != null && Number.isFinite(args.entryAffidabilitaPct)
      ? entryAffidabilitaToBenefitPct(args.entryAffidabilitaPct)
      : 0;
  const sdsB =
    args.entrySdsPct != null && Number.isFinite(args.entrySdsPct)
      ? entrySdsToBenefitPct(args.entrySdsPct)
      : 0;
  const slopeB =
    args.entrySlope20d != null && Number.isFinite(args.entrySlope20d)
      ? entrySlope20dToBenefitPct(args.entrySlope20d)
      : 0;

  const fill = blendBenefitV2Parts([
    { v: pplanB, w: BENEFIT_BLEND_V2_WEIGHTS.pplan },
    { v: sdsB, w: BENEFIT_BLEND_V2_WEIGHTS.sds },
    { v: slopeB, w: BENEFIT_BLEND_V2_WEIGHTS.slope },
    { v: winB, w: BENEFIT_BLEND_V2_WEIGHTS.win },
  ]);
  if (fill <= 0) {
    return {
      benefitScore: 0,
      winComponentPct: 0,
      pplanComponentPct: 0,
      sdsComponentPct: 0,
      slopeComponentPct: 0,
      entryPplanPct:
        args.entryAffidabilitaPct != null && Number.isFinite(args.entryAffidabilitaPct)
          ? args.entryAffidabilitaPct
          : null,
      entrySdsPct:
        args.entrySdsPct != null && Number.isFinite(args.entrySdsPct) ? args.entrySdsPct : null,
    };
  }
  return {
    benefitScore: Math.max(0, Math.min(100, fill)),
    winComponentPct: winB,
    pplanComponentPct: pplanB,
    sdsComponentPct: sdsB,
    slopeComponentPct: slopeB,
    entryPplanPct:
      args.entryAffidabilitaPct != null && Number.isFinite(args.entryAffidabilitaPct)
        ? args.entryAffidabilitaPct
        : null,
    entrySdsPct:
      args.entrySdsPct != null && Number.isFinite(args.entrySdsPct) ? args.entrySdsPct : null,
  };
}

export function deriveClosedDealEntryBenefitScore(args: {
  approvedWinRate?: number | null;
  entryAffidabilitaPct?: number | null;
  entrySlope20d?: number | null;
  entrySdsPct?: number | null;
}): number {
  return deriveClosedDealEntryBenefitComponents(args).benefitScore;
}
