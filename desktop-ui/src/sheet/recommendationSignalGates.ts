/**
 * Operational recommendation quality gates:
 * BETA / LIQ FY / weighted multi-horizon momentum.
 * Direction only on BUY — never invent SELL.
 */
import type { ChartPoint, ChartSeries } from "../types";
import {
  RECOMMENDATION_SIGNAL_CONFIG,
  type RecommendationSignalConfig,
} from "./recommendationSignalConfig";
import {
  resolveRecPriceHorizons,
  type RecPriceHorizons,
} from "./priceVariationHorizons";
import {
  resolveSimRowBeta,
  resolveSimRowLiquidityScore,
} from "./simRowBetaLiquidity";

export type SuggestedAction = "buy" | "sell" | "hold" | "review" | "none";

export type RecommendationSignalCtx = {
  beta: number | null;
  liquidityFy: number | null;
  d1: number | null;
  d7: number | null;
  m3: number | null;
  m6: number | null;
  /** Weighted momentum %; null if no horizons present. */
  momentumScore: number | null;
};

export type RecommendationSignalBreakdown = {
  actionBefore: SuggestedAction;
  actionAfter: SuggestedAction;
  demoted: boolean;
  demoteReasons: string[];
  beta: number | null;
  liquidityFy: number | null;
  momentumScore: number | null;
  d1: number | null;
  d7: number | null;
  m3: number | null;
  m6: number | null;
};

/**
 * Weighted average of available horizons; renormalizes when some are missing.
 * Returns null when every horizon is absent (neutral — does not block).
 */
export function computeWeightedMomentumScore(
  horizons: RecPriceHorizons,
  cfg: RecommendationSignalConfig = RECOMMENDATION_SIGNAL_CONFIG,
): number | null {
  const parts: { pct: number; w: number }[] = [];
  if (horizons.d1 != null && Number.isFinite(horizons.d1)) {
    parts.push({ pct: horizons.d1, w: cfg.momentumWeight24h });
  }
  if (horizons.d7 != null && Number.isFinite(horizons.d7)) {
    parts.push({ pct: horizons.d7, w: cfg.momentumWeight7d });
  }
  if (horizons.m3 != null && Number.isFinite(horizons.m3)) {
    parts.push({ pct: horizons.m3, w: cfg.momentumWeight3m });
  }
  if (horizons.m6 != null && Number.isFinite(horizons.m6)) {
    parts.push({ pct: horizons.m6, w: cfg.momentumWeight6m });
  }
  if (!parts.length) return null;
  const wSum = parts.reduce((a, p) => a + p.w, 0);
  if (wSum <= 0) return null;
  const score = parts.reduce((a, p) => a + p.pct * (p.w / wSum), 0);
  return Math.round(score * 100) / 100;
}

export function buildRecommendationSignalCtx(
  simRow: Record<string, unknown> | null | undefined,
  chartPts?: ChartPoint[] | null,
  seriesMeta?: Pick<ChartSeries, "var_horizons"> | null,
  cfg: RecommendationSignalConfig = RECOMMENDATION_SIGNAL_CONFIG,
): RecommendationSignalCtx {
  const horizons = resolveRecPriceHorizons(simRow, chartPts, seriesMeta);
  return {
    beta: simRow ? resolveSimRowBeta(simRow) : null,
    liquidityFy: simRow ? resolveSimRowLiquidityScore(simRow) : null,
    d1: horizons.d1,
    d7: horizons.d7,
    m3: horizons.m3,
    m6: horizons.m6,
    momentumScore: computeWeightedMomentumScore(horizons, cfg),
  };
}

/** Demote BUY only — never invent SELL, never change Hold/Sell direction. */
export function applyDirectionalSignalDemotion(
  action: SuggestedAction,
  ctx: RecommendationSignalCtx | null | undefined,
  cfg: RecommendationSignalConfig = RECOMMENDATION_SIGNAL_CONFIG,
): { action: SuggestedAction; demoted: boolean; reasons: string[] } {
  if (!cfg.enableDirectionalGates || !ctx || action !== "buy") {
    return { action, demoted: false, reasons: [] };
  }
  const reasons: string[] = [];
  if (ctx.beta != null && Number.isFinite(ctx.beta) && ctx.beta > cfg.betaBuyBlockAbove) {
    reasons.push(`beta>${cfg.betaBuyBlockAbove}`);
  }
  if (
    ctx.liquidityFy != null &&
    Number.isFinite(ctx.liquidityFy) &&
    ctx.liquidityFy < cfg.liquidityFyBuyBlockBelow
  ) {
    reasons.push(`liquidityFy<${cfg.liquidityFyBuyBlockBelow}`);
  }
  if (
    ctx.momentumScore != null &&
    Number.isFinite(ctx.momentumScore) &&
    ctx.momentumScore < cfg.momentumBuyMinScore
  ) {
    reasons.push(`momentum<${cfg.momentumBuyMinScore}`);
  }
  if (!reasons.length) return { action, demoted: false, reasons: [] };
  return { action: "review", demoted: true, reasons };
}

export function buildRecommendationSignalBreakdown(
  actionBefore: SuggestedAction,
  ctx: RecommendationSignalCtx | null | undefined,
  cfg: RecommendationSignalConfig = RECOMMENDATION_SIGNAL_CONFIG,
): RecommendationSignalBreakdown {
  const demote = applyDirectionalSignalDemotion(actionBefore, ctx, cfg);
  return {
    actionBefore,
    actionAfter: demote.action,
    demoted: demote.demoted,
    demoteReasons: demote.reasons,
    beta: ctx?.beta ?? null,
    liquidityFy: ctx?.liquidityFy ?? null,
    momentumScore: ctx?.momentumScore ?? null,
    d1: ctx?.d1 ?? null,
    d7: ctx?.d7 ?? null,
    m3: ctx?.m3 ?? null,
    m6: ctx?.m6 ?? null,
  };
}
