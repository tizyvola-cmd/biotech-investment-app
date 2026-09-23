/**
 * Single config for BETA / LIQUIDITY FY / multi-horizon momentum
 * in the operational recommendation path.
 * No magic numbers outside this file for those signals.
 */

export const RECOMMENDATION_SIGNAL_CONFIG = {
  /** When false, deriveSuggestedAction ignores BETA/LIQ/momentum demotion. */
  enableDirectionalGates: true,

  /**
   * Off-portfolio BUY demoted to REVIEW when beta exceeds this.
   * Biotech volume trial: was 2.0 — allow stronger market-linked names; G2 day-budget caps book risk.
   */
  betaBuyBlockAbove: 3.0,
  /** Off-portfolio BUY demoted to REVIEW when FY liquidity score is below this (0–1). */
  liquidityFyBuyBlockBelow: 0.25,

  /**
   * Weighted price horizons for BUY quality (sum = 100).
   * Recent-heavy profile (CRDL lesson). Missing horizons → renormalize.
   */
  momentumWeight24h: 35,
  momentumWeight7d: 30,
  momentumWeight3m: 20,
  momentumWeight6m: 15,

  /** Demote BUY → REVIEW when weighted momentum score is strictly below this. */
  momentumBuyMinScore: -4,
} as const;

export type RecommendationSignalConfig = typeof RECOMMENDATION_SIGNAL_CONFIG;
