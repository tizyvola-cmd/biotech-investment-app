// Portfolio Builder Lab — simulation engine
// Forward-looking 30-day simulation with active rebalancing.
//
// Inputs: real opportunities (RA/SDS/planProb/planReturn/daysToCd), strategy config.
// Output: day-by-day P&L curve + events log + summary metrics.
//
// Approach: deterministic seeded random walk per ticker + binomial CD outcome.
// The simulation respects max-weight, stop-loss, take-profit and rebalance triggers.

import type {
  PortfolioBuilderConfig,
  PortfolioBuilderDeal,
  PortfolioSimulationResult,
  SimulationDaySnapshot,
  SimulationEvent,
} from "./portfolioBuilderTypes";

const SIM_DAYS = 30;
const ANNUAL_VOL = 0.55; // typical biotech vol ~55%/yr
const DAILY_VOL = ANNUAL_VOL / Math.sqrt(252);

// Simple seeded RNG (mulberry32) so two runs with same inputs give same output.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  // Box-Muller
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type LivePosition = {
  ticker: string;
  capitalEur: number;
  initialCapitalEur: number;
  currentPriceMul: number; // multiplier vs entry (1.0 = breakeven)
  daysHeld: number;
  daysToCd: number;
  planProbPct: number;
  planReturnPct: number;
  phaseGroup: "early" | "mid" | "late";
  cdResolved: boolean;
  closed: boolean;
  exitReason: string | null;
};

function phaseGroup(phase: string | undefined): "early" | "mid" | "late" {
  const p = (phase ?? "").toLowerCase();
  if (p.includes("3") || p.includes("late") || p.includes("registr")) return "late";
  if (p.includes("1") && !p.includes("/2")) return "early";
  if (p.includes("preclin") || p.includes("early")) return "early";
  return "mid";
}

export function simulatePortfolio(
  deals: PortfolioBuilderDeal[],
  config: PortfolioBuilderConfig,
  opts: { seed?: number; days?: number; enableRebalancing?: boolean } = {},
): PortfolioSimulationResult {
  const days = opts.days ?? SIM_DAYS;
  const enableRebalancing = opts.enableRebalancing ?? true;
  const seed = opts.seed ?? 42;

  // Initialize live positions from selected deals.
  const positions: LivePosition[] = deals
    .filter((d) => d.selected && d.selectedCapital > 0)
    .map((d) => ({
      ticker: d.ticker,
      capitalEur: d.selectedCapital,
      initialCapitalEur: d.selectedCapital,
      currentPriceMul: 1.0,
      daysHeld: 0,
      daysToCd: Math.max(1, d.daysToCD || 30),
      planProbPct: Math.max(5, Math.min(95, d.planProbPct || 50)),
      planReturnPct: d.planReturnPct ?? 25,
      phaseGroup: phaseGroup(d.phase),
      cdResolved: false,
      closed: false,
      exitReason: null,
    }));

  if (positions.length === 0) {
    return {
      days: [],
      finalPnlEur: 0,
      maxDrawdownEur: 0,
      winRate: 0,
      avgHoldDays: 0,
      sharpeRatio: 0,
      profitFromRebalancing: 0,
      lossSaved: 0,
    };
  }

  const initialCapital = positions.reduce((s, p) => s + p.initialCapitalEur, 0);
  const dailySnapshots: SimulationDaySnapshot[] = [];
  let prevTotalPnl = 0;
  let maxDrawdown = 0;
  let peakValue = initialCapital;
  let wins = 0;
  let totalClosed = 0;
  let sumHoldDays = 0;
  let profitFromRebalancing = 0;
  let lossSaved = 0;
  const dailyReturns: number[] = [];

  // Seed one RNG per ticker so behavior is deterministic and independent.
  const rngByTicker = new Map<string, () => number>();
  positions.forEach((p) => {
    rngByTicker.set(p.ticker, mulberry32(seed ^ hashSeed(p.ticker)));
  });

  // Day 0 snapshot.
  dailySnapshots.push({
    day: 0,
    nPositions: positions.length,
    totalPnlEur: 0,
    dailyPnlEur: 0,
    events: positions.map<SimulationEvent>((p) => ({
      day: 0,
      type: "buy",
      ticker: p.ticker,
      priceBefore: 0,
      priceAfter: p.capitalEur,
      pnlEur: 0,
      reason: `Entry ${p.capitalEur.toFixed(0)}€`,
    })),
    portfolioValue: initialCapital,
  });

  for (let day = 1; day <= days; day++) {
    const events: SimulationEvent[] = [];

    // 1) Daily price walk for each open position.
    for (const pos of positions) {
      if (pos.closed) continue;
      const rng = rngByTicker.get(pos.ticker)!;

      // Drift: positions with higher planProb have positive drift, otherwise mild negative.
      const driftDaily = (pos.planProbPct - 50) / 100 / 30; // monthly bias / 30
      const shock = gaussian(rng) * DAILY_VOL;
      pos.currentPriceMul *= 1 + driftDaily + shock;
      pos.daysHeld += 1;

      // 2) CD resolution (binomial).
      if (!pos.cdResolved && pos.daysHeld >= pos.daysToCd) {
        pos.cdResolved = true;
        const success = rng() < pos.planProbPct / 100;
        if (success) {
          // Add planReturnPct on top of current price walk, capped to multiplier.
          const targetMul = 1 + pos.planReturnPct / 100;
          // Smooth toward target rather than overwriting.
          pos.currentPriceMul = Math.max(pos.currentPriceMul, targetMul * (0.85 + rng() * 0.3));
        } else {
          // Negative outcome — typical -25% to -45%.
          const lossMul = 1 - (0.25 + rng() * 0.2);
          pos.currentPriceMul = Math.min(pos.currentPriceMul, lossMul);
        }
        events.push({
          day,
          type: success ? "take-profit" : "stop-loss",
          ticker: pos.ticker,
          priceBefore: pos.initialCapitalEur,
          priceAfter: pos.initialCapitalEur * pos.currentPriceMul,
          pnlEur: pos.initialCapitalEur * (pos.currentPriceMul - 1),
          reason: success
            ? `CD success → +${pos.planReturnPct.toFixed(0)}%`
            : `CD fail → -${((1 - pos.currentPriceMul) * 100).toFixed(0)}%`,
        });
      }

      pos.capitalEur = pos.initialCapitalEur * pos.currentPriceMul;
    }

    // 3) Active management: stop-loss / take-profit / max-weight rebalancing.
    if (enableRebalancing) {
      const totalValue = positions.reduce(
        (s, p) => s + (p.closed ? 0 : p.capitalEur),
        0,
      );

      for (const pos of positions) {
        if (pos.closed) continue;
        const pnlPct = (pos.currentPriceMul - 1) * 100;

        // Stop-loss.
        if (pnlPct <= -config.stopLossPct) {
          const exitValue = pos.capitalEur;
          const realizedLoss = exitValue - pos.initialCapitalEur;
          // What it would have lost if held — assume worst case ~-35%.
          const projectedFurtherLoss = pos.initialCapitalEur * -0.1; // conservative estimate
          lossSaved += Math.max(0, -projectedFurtherLoss);

          pos.closed = true;
          pos.exitReason = "stop-loss";
          totalClosed += 1;
          sumHoldDays += pos.daysHeld;
          if (realizedLoss > 0) wins += 1;

          events.push({
            day,
            type: "stop-loss",
            ticker: pos.ticker,
            priceBefore: pos.initialCapitalEur,
            priceAfter: exitValue,
            pnlEur: realizedLoss,
            reason: `Stop-loss triggered at ${pnlPct.toFixed(1)}%`,
          });
          continue;
        }

        // Take-profit.
        if (pnlPct >= config.takeProfitPct) {
          const exitValue = pos.capitalEur;
          const realizedGain = exitValue - pos.initialCapitalEur;
          profitFromRebalancing += Math.max(0, realizedGain * 0.2); // attribution: ~20% locked-in by TP

          pos.closed = true;
          pos.exitReason = "take-profit";
          totalClosed += 1;
          sumHoldDays += pos.daysHeld;
          wins += 1;

          events.push({
            day,
            type: "take-profit",
            ticker: pos.ticker,
            priceBefore: pos.initialCapitalEur,
            priceAfter: exitValue,
            pnlEur: realizedGain,
            reason: `Take-profit at +${pnlPct.toFixed(1)}%`,
          });
          continue;
        }

        // Max weight per deal — trim if oversized after gain.
        const weight = totalValue > 0 ? (pos.capitalEur / totalValue) * 100 : 0;
        if (weight > config.maxWeightPerDeal && pnlPct > 5) {
          const targetWeight = config.maxWeightPerDeal;
          const trimEur = pos.capitalEur - (totalValue * targetWeight) / 100;
          if (trimEur > 0 && trimEur < pos.capitalEur * 0.5) {
            pos.capitalEur -= trimEur;
            pos.initialCapitalEur -= trimEur / pos.currentPriceMul;
            profitFromRebalancing += trimEur * 0.05;
            events.push({
              day,
              type: "rebalance",
              ticker: pos.ticker,
              priceBefore: weight,
              priceAfter: targetWeight,
              pnlEur: trimEur * 0.05,
              reason: `Trim to max-weight ${targetWeight}%`,
            });
          }
        }
      }
    }

    // 4) Compute snapshot.
    const portfolioValue = positions.reduce(
      (s, p) => s + (p.closed && p.exitReason ? p.capitalEur : p.capitalEur),
      0,
    );
    const totalPnl = portfolioValue - initialCapital;
    const dailyPnl = totalPnl - prevTotalPnl;
    prevTotalPnl = totalPnl;

    if (portfolioValue > peakValue) peakValue = portfolioValue;
    const drawdown = portfolioValue - peakValue;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;

    if (initialCapital > 0) {
      dailyReturns.push(dailyPnl / initialCapital);
    }

    dailySnapshots.push({
      day,
      nPositions: positions.filter((p) => !p.closed).length,
      totalPnlEur: totalPnl,
      dailyPnlEur: dailyPnl,
      events,
      portfolioValue,
    });
  }

  // Close any remaining positions at end of horizon.
  for (const pos of positions) {
    if (pos.closed) continue;
    pos.closed = true;
    pos.exitReason = "horizon-end";
    totalClosed += 1;
    sumHoldDays += pos.daysHeld;
    if (pos.capitalEur > pos.initialCapitalEur) wins += 1;
  }

  const finalPnl = dailySnapshots[dailySnapshots.length - 1]?.totalPnlEur ?? 0;
  const winRate = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;
  const avgHoldDays = totalClosed > 0 ? sumHoldDays / totalClosed : 0;

  // Sharpe (annualized) — mean / std * sqrt(252).
  const meanRet =
    dailyReturns.reduce((s, r) => s + r, 0) / Math.max(1, dailyReturns.length);
  const variance =
    dailyReturns.reduce((s, r) => s + (r - meanRet) ** 2, 0) /
    Math.max(1, dailyReturns.length - 1);
  const std = Math.sqrt(Math.max(0, variance));
  const sharpe = std > 0 ? (meanRet * 252) / (std * Math.sqrt(252)) : 0;

  return {
    days: dailySnapshots,
    finalPnlEur: finalPnl,
    maxDrawdownEur: maxDrawdown,
    winRate,
    avgHoldDays,
    sharpeRatio: sharpe,
    profitFromRebalancing,
    lossSaved,
  };
}

/**
 * Sim Loop baseline: same deals, NO active rebalancing — buy & hold to CD or horizon.
 * Used as a reference curve to compare against the active portfolio.
 */
export function simulateSimLoopBaseline(
  deals: PortfolioBuilderDeal[],
  opts: { seed?: number; days?: number } = {},
): PortfolioSimulationResult {
  const passiveConfig: PortfolioBuilderConfig = {
    strategy: "balanced",
    maxWeightPerDeal: 100,
    maxWeightPerSector: 100,
    rebalanceTrigger: 999,
    stopLossPct: 999,
    takeProfitPct: 999,
    diversificationTarget: { earlyStage: 0, midStage: 100, lateStage: 0 },
  };
  return simulatePortfolio(deals, passiveConfig, {
    ...opts,
    enableRebalancing: false,
  });
}
