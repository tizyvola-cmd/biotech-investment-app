/**
 * Portfolio share vector from Learning Lab **approved weights** (FrozenWeights).
 *
 * Pipeline:
 *   1. Calibration Center approve → frozen cell win rates
 *   2. Each open deal gets a multiplier from its bucket cells (sizingRules logic)
 *   3. Step 2 risk pattern halves weight on matching deals
 *   4. Normalised shares feed the synthesizer baseline + Weight Sim Exp
 *   5. Three-Portfolio synth curves consume Weight Sim Exp output
 */
import type { FrozenWeights } from "../calibration/calibrationTypes";
import { computeFrozenWeightMultiplier } from "../calibration/sizingRules";
import type { ComparisonDeal } from "./threePortfolioCompare";
import { DEFAULT_SIZING_RULES_CONFIG } from "../calibration/sizingRules";
import { blendAndCapSharesForDisplay } from "./weightSimExpOptimizer";

export const SIM_TABLE_SYNTH_MAX_SHARE = DEFAULT_SIZING_RULES_CONFIG.capPctSingle;

/** Every share in a Simulation-table display map must be ≤ capPctSingle. */
export function assertSimulationSynthDisplayShares(
  sharesByKey: Record<string, number>,
  maxShare = SIM_TABLE_SYNTH_MAX_SHARE,
): void {
  for (const [key, share] of Object.entries(sharesByKey)) {
    if (share > maxShare + 1e-9) {
      throw new Error(`Synth display share for ${key} is ${share}, max ${maxShare}`);
    }
  }
}

export type SynthCurveAllocationPayload = {
  /** 24h gain target from Step 3 chart (defines reference range). */
  targetGainEur: number;
  /** ISO timestamp of approved weights used (null = empty store). */
  approvedWeightsAt: string | null;
  /** Baseline mix from Learning Lab approved weights (+ Step 2 pattern penalty). */
  portfolioApprovedSharesByRowKey: Record<string, number>;
  simLoopApprovedSharesByRowKey: Record<string, number>;
  /** Weight Sim Exp mix — consumed by Mine (synth) / Sim loop (synth) curves. */
  portfolioSharesByRowKey: Record<string, number>;
  simLoopSharesByRowKey: Record<string, number>;
  /** Capped mix for Simulation table (max 25% per deal). */
  portfolioDisplaySharesByRowKey: Record<string, number>;
  simLoopDisplaySharesByRowKey: Record<string, number>;
};

export function computeApprovedWeightShares(
  deals: ComparisonDeal[],
  frozen: FrozenWeights,
  matchesStep2Pattern: (deal: ComparisonDeal) => boolean,
  patternPenalty = 0.5,
): number[] {
  if (deals.length === 0) return [];

  const scores = deals.map((d) => {
    let score = computeFrozenWeightMultiplier(d.cells, frozen);
    if (matchesStep2Pattern(d)) score *= patternPenalty;
    return Math.max(0, score);
  });

  const sum = scores.reduce((s, v) => s + v, 0);
  if (sum <= 0) return deals.map(() => 1 / deals.length);
  return scores.map((s) => s / sum);
}

export function sharesByRowKeyFromDeals(
  deals: ComparisonDeal[],
  shares: number[],
): Record<string, number> {
  const out: Record<string, number> = {};
  deals.forEach((d, i) => {
    out[d.rowKey] = shares[i] ?? 0;
  });
  return out;
}

/** Weight Sim Exp shares capped for Simulation table (max 25% / name). */
export function displaySynthSharesByRowKey(
  deals: ComparisonDeal[],
  synthShares: number[],
  maxShare = DEFAULT_SIZING_RULES_CONFIG.capPctSingle,
): Record<string, number> {
  if (deals.length === 0) return {};
  const capped = blendAndCapSharesForDisplay(synthShares, maxShare);
  const out = sharesByRowKeyFromDeals(deals, capped);
  assertSimulationSynthDisplayShares(out, maxShare);
  return out;
}

export function buildSynthCurveAllocationPayload(args: {
  targetGainEur: number;
  frozen: FrozenWeights;
  mineDeals: ComparisonDeal[];
  simLoopDeals: ComparisonDeal[];
  portfolioApprovedShares: number[];
  simLoopApprovedShares: number[];
  portfolioSynthShares: number[];
  simLoopSynthShares: number[];
}): SynthCurveAllocationPayload {
  return {
    targetGainEur: args.targetGainEur,
    approvedWeightsAt: args.frozen.updatedAt ?? null,
    portfolioApprovedSharesByRowKey: sharesByRowKeyFromDeals(
      args.mineDeals,
      args.portfolioApprovedShares,
    ),
    simLoopApprovedSharesByRowKey: sharesByRowKeyFromDeals(
      args.simLoopDeals,
      args.simLoopApprovedShares,
    ),
    portfolioSharesByRowKey: sharesByRowKeyFromDeals(
      args.mineDeals,
      args.portfolioSynthShares,
    ),
    simLoopSharesByRowKey: sharesByRowKeyFromDeals(
      args.simLoopDeals,
      args.simLoopSynthShares,
    ),
    portfolioDisplaySharesByRowKey: displaySynthSharesByRowKey(
      args.mineDeals,
      args.portfolioSynthShares,
    ),
    simLoopDisplaySharesByRowKey: displaySynthSharesByRowKey(
      args.simLoopDeals,
      args.simLoopSynthShares,
    ),
  };
}
