/**
 * MCS-aware exit hold / sell overrides — complements portfolioExitRecoveryGuardsActive.
 */
import type { StabilityVerdict } from "./slopeStability";
import {
  MCS_HOLD_EXTERNAL_MIN,
  MCS_SELL_INTERNAL_MAX,
  type MarketContextDecisionCtx,
} from "./marketContextScore";
import { RECOVERY_HOLD_PROB_MIN } from "./recoveryProbability";

export type McsExitGuardInput = {
  pnlPct?: number | null;
  recoveryProbabilityPct?: number | null;
  regulatoryRiskScore?: number | null;
  externalAlignmentScore?: number | null;
  volumeAnomalyScore?: number | null;
  stabilityVerdict?: StabilityVerdict;
};

/** HOLD_DESPITE_LOSS: external market likely explains drawdown. */
export function shouldHoldDespiteExternalMarketContext(
  input: McsExitGuardInput,
  marketCtx: MarketContextDecisionCtx | null | undefined,
): boolean {
  if (!marketCtx?.mcsAvailable || marketCtx.mcs == null) return false;
  if (marketCtx.mcsStaleDays >= 2) return false;
  const pnl = input.pnlPct;
  if (pnl == null || !Number.isFinite(pnl) || pnl >= -2) return false;
  if (marketCtx.mcs < MCS_HOLD_EXTERNAL_MIN) return false;
  if (input.regulatoryRiskScore != null && input.regulatoryRiskScore > 0) return false;
  const prob = input.recoveryProbabilityPct;
  if (prob != null && prob < RECOVERY_HOLD_PROB_MIN) return false;
  return true;
}

/** Strong internal-cause signal → do not block exit on recovery guards. */
export function shouldSellDespiteRecoveryForInternalContext(
  input: McsExitGuardInput,
  marketCtx: MarketContextDecisionCtx | null | undefined,
): boolean {
  if (!marketCtx?.mcsAvailable || marketCtx.mcs == null) return false;
  if (marketCtx.mcsStaleDays >= 2) return false;
  const prob = input.recoveryProbabilityPct;
  if (prob != null && prob >= 35) return false;
  if (marketCtx.mcs >= MCS_SELL_INTERNAL_MAX) return false;
  const vol = input.volumeAnomalyScore;
  if (vol == null || vol < 60) return false;
  return true;
}
