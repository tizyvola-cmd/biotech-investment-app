/**
 * Soft Logic Gen 0–4 action rules for Flash Test (auto paper).
 * Gen 4 = live Home Soft Soft (`deriveSuggestedAction`) — same Soft BUY/SELL lists.
 * Gen 0–3 stay era-scoped forks for the A/B experiment.
 */
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";
import {
  deriveSuggestedAction,
  softBuyRisingStreakAllows,
  softBuyDayNotRed,
  softBuyTapeNotCatastrophic,
  softBuyTop2Allows,
  qualifiesStrictOpportunityBuy,
  type SuggestedActionEnhanceCtx,
  type TickerSimEvaluation,
} from "./investDecisionSimLoop";
import {
  evaluateSoftSellGiveback,
  evaluateSoftSellGrade1,
  softSellG1IsDeepFloor,
  SOFT_BUY_G1_PPLAN_MIN,
} from "./softSignalGrades";
import {
  shouldContinuationExhaustedSell,
  softBuyContinuationAllows,
} from "./continuationScore";
import { buildRecommendationSignalCtx } from "./recommendationSignalGates";
import { isWarrantTicker } from "./simulationPosition";
import type { SoftLogicGenId } from "./flashTestTypes";

export type FlashSuggestedAction = TickerSimEvaluation["suggestedAction"];

function sessionDayIsGreen(item: PortfolioLossAnalysisItem): boolean {
  return (
    item.pnlPct24h != null && Number.isFinite(item.pnlPct24h) && item.pnlPct24h > 0
  );
}

function softBuySdsOk(gen: SoftLogicGenId, sds: number | null | undefined): boolean {
  if (sds == null || !Number.isFinite(sds)) return false;
  const min = gen <= 1 ? 25 : 20;
  return sds >= min;
}

function softBuyPplanOk(gen: SoftLogicGenId, p: number | null | undefined): boolean {
  if (p == null || !Number.isFinite(p)) return false;
  if (gen === 0) return p >= 60;
  return p >= SOFT_BUY_G1_PPLAN_MIN;
}

/**
 * Era-scoped Soft Soft action for one Flash Test arm.
 * Pass `inPaper` for the arm's paper book (same contract as `deriveSuggestedAction`).
 */
export function deriveFlashTestAction(
  gen: SoftLogicGenId,
  item: PortfolioLossAnalysisItem,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
  inPaper = false,
): FlashSuggestedAction {
  const held = inPaper || Boolean(item.hasPosition);
  // Gen 4 must match Home Soft Soft 1:1 (incl. wind-run Soft BUY + ↑2d Yahoo priors).
  if (gen >= 4) {
    return deriveSuggestedAction(item, held, null, null, enhanceCtx);
  }
  if (held) {
    return deriveFlashSell(gen, { ...item, hasPosition: true }, enhanceCtx);
  }
  return deriveFlashBuy(gen, item, enhanceCtx);
}

function deriveFlashSell(
  gen: SoftLogicGenId,
  item: PortfolioLossAnalysisItem,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): FlashSuggestedAction {
  const dayGreen = sessionDayIsGreen(item);
  const mtmUp =
    item.pnlPct != null && Number.isFinite(item.pnlPct) && item.pnlPct > 0;

  if (gen >= 4) {
    if (
      !mtmUp &&
      evaluateSoftSellGiveback({
        hasPosition: true,
        peakPnlEur: enhanceCtx?.peakPnlEur,
        pnlEur: item.pnlEur,
        capitalEur: item.capital,
        investedAt: item.investedAt,
      }).hit
    ) {
      return "sell";
    }
  }

  if (gen >= 3) {
    if (
      !mtmUp &&
      shouldContinuationExhaustedSell({
        hasPosition: true,
        pnlPct: item.pnlPct,
        simRow: enhanceCtx?.simRow,
      })
    ) {
      return "sell";
    }
  }

  if (!mtmUp) {
    if (gen >= 2 && enhanceCtx?.urgentSellG2Keys?.has(item.key)) {
      return "sell";
    }
    const softSell = evaluateSoftSellGrade1({
      hasPosition: true,
      pnlPct: item.pnlPct,
      pplan: item.recoveryProbabilityPct,
      riskV2: enhanceCtx?.riskV2,
      regRisk: enhanceCtx?.regRisk ?? enhanceCtx?.regulatoryRiskScore,
      simRow: gen >= 1 ? enhanceCtx?.simRow : null,
      investedAt: item.investedAt,
    });
    if (gen >= 1) {
      if (softSellG1IsDeepFloor(softSell)) return "sell";
      if (!dayGreen && softSell.hit) return "sell";
    } else {
      // Gen 0: exit on deep floor or model exit + weak plan
      if (softSellG1IsDeepFloor(softSell)) return "sell";
      if (
        item.exitDecision === "exit" &&
        !dayGreen &&
        (item.recoveryProbabilityPct == null ||
          item.recoveryProbabilityPct < SOFT_BUY_G1_PPLAN_MIN)
      ) {
        return "sell";
      }
    }
  }

  if (dayGreen) return "hold";
  if (item.exitDecision === "exit" && !mtmUp) return "sell";
  if (item.exitDecision === "hold") return "hold";
  if (
    item.recoveryProbabilityPct != null &&
    Number.isFinite(item.recoveryProbabilityPct) &&
    item.recoveryProbabilityPct >= SOFT_BUY_G1_PPLAN_MIN
  ) {
    return "hold";
  }
  return "review";
}

export type FlashBuyMissFail =
  | "warrant"
  | "cooldown"
  | "sds"
  | "pplan"
  | "precat_sell"
  | "rising"
  | "tape"
  | "top2_no"
  | "pcont"
  | "strict"
  | "other";

/**
 * Soft BUY for Flash Test Gen 0–3 — era-authentic (see SOFT_LOGIC_ERAS).
 *
 * Gen 0: classic Top2 yes + ENTER only (no Soft BUY volume).
 * Gen 1: Soft SDS≥25 · P≥50 · Top2≠NO · ↑≥2d
 * Gen 2: Soft SDS≥20 · P≥50 · Top2≠NO · ↑≥2d
 * Gen 3: Gen 2 + P(cont)/edge gate
 * Gen 4: live Home (`deriveSuggestedAction`) — Top2 NO / P(cont) ranking-only
 *
 * Making Gen 0–3 Top2-ranking-only collapsed all Soft BUY lists into Gen-4-wide
 * clones; Flash Test then cannot answer “which era logic wins”.
 */
function deriveFlashBuy(
  gen: SoftLogicGenId,
  item: PortfolioLossAnalysisItem,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): FlashSuggestedAction {
  if (isWarrantTicker(item.ticker)) return "review";

  const dayPctFromSim = buildRecommendationSignalCtx(
    enhanceCtx?.simRow,
    enhanceCtx?.chartPts,
  ).d1;
  const tapeOk = softBuyTapeNotCatastrophic(item, dayPctFromSim);
  const dayOk = softBuyDayNotRed(item, dayPctFromSim);
  const risingOk = softBuyRisingStreakAllows(item, dayPctFromSim, enhanceCtx);
  const precatHard = item.precatKind === "sell";
  const sdsOk = softBuySdsOk(gen, item.sdsScore);
  const pplanOk = softBuyPplanOk(gen, item.recoveryProbabilityPct);
  const top2Ok = softBuyTop2Allows(item);

  if (enhanceCtx?.recentlySoldBlocked) {
    if (pplanOk) return "hold";
    return "review";
  }

  // Gen 0 = pre–Soft Soft: Top2 yes + ENTER + study (no volume Soft BUY).
  if (gen === 0) {
    if (dayOk && qualifiesStrictOpportunityBuy(item) && sdsOk && pplanOk) {
      return "buy";
    }
    if (pplanOk) return "hold";
    return "review";
  }

  // Gen 1–3 Soft volume — Top2≠NO hard-blocks (era authentic); Gen 4 is wider.
  const volumeSoft =
    sdsOk &&
    pplanOk &&
    top2Ok &&
    !precatHard &&
    dayOk &&
    risingOk &&
    tapeOk &&
    (gen !== 3 || softBuyContinuationAllows(enhanceCtx?.simRow ?? null));

  if (volumeSoft) return "buy";

  // Gen 1–3 still allow classic Top2-yes when Soft volume misses.
  if (qualifiesStrictOpportunityBuy(item)) return "buy";
  if (pplanOk) return "hold";
  return "review";
}

/** Why this name is not Soft BUY for an era Gen (null = would BUY). */
export function explainFlashBuyMiss(
  gen: SoftLogicGenId,
  item: PortfolioLossAnalysisItem,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
  inPaper = false,
): FlashBuyMissFail | null {
  if (inPaper || item.hasPosition) return null;
  if (deriveFlashTestAction(gen, item, enhanceCtx, inPaper) === "buy") return null;
  if (isWarrantTicker(item.ticker)) return "warrant";

  const dayPctFromSim = buildRecommendationSignalCtx(
    enhanceCtx?.simRow,
    enhanceCtx?.chartPts,
  ).d1;
  const tapeOk = softBuyTapeNotCatastrophic(item, dayPctFromSim);
  const dayOk = softBuyDayNotRed(item, dayPctFromSim);
  const risingOk = softBuyRisingStreakAllows(item, dayPctFromSim, enhanceCtx);
  const precatHard = item.precatKind === "sell";
  const sdsOk = softBuySdsOk(gen, item.sdsScore);
  const pplanOk = softBuyPplanOk(gen, item.recoveryProbabilityPct);

  if (enhanceCtx?.recentlySoldBlocked) return "cooldown";
  if (gen === 0) return "strict";
  if (!sdsOk) return "sds";
  if (!pplanOk) return "pplan";
  if (!softBuyTop2Allows(item)) return "top2_no";
  if (precatHard) return "precat_sell";
  if (!dayOk) return "tape";
  if (!risingOk) return "rising";
  if (!tapeOk) return "tape";
  if (gen === 3 && !softBuyContinuationAllows(enhanceCtx?.simRow ?? null)) {
    return "pcont";
  }
  return "other";
}
