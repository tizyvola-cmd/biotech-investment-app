/**
 * Experiment cash-flow snapshot.
 *
 * The three experiments (Portfolio, Sim loop equal, Sim loop synth) are
 * modelled as "slot-based" universes: every BUY nominally consumes
 * `capitalPerTrade` of fresh capital and every SELL records a P&L but does
 * NOT return the nominal capital to a shared pool. As a consequence the KPI
 * block previously only showed P&L totals, giving no answer to the very
 * natural question "how much of the money currently invested is actually
 * profits recycled from earlier closed deals?".
 *
 * This module derives a *cash-flow view* on top of the existing state
 * without changing the sizing logic:
 *
 *   - `capitalReturnedFromClosedEur` — total nominal capital released by
 *     every SELL so far (the "principal" that a real trader would receive
 *     back in cash on execution).
 *   - `capitalInOpenEur` — nominal capital currently locked in open
 *     positions.
 *   - `capitalReinvestedEur` — heuristic upper bound: the portion of the
 *     currently-open capital that could have been financed by the pool of
 *     capital returned from prior SELLs (i.e. `min(capitalReturned,
 *     capitalInOpen)`). We do NOT walk the tick timeline to test whether
 *     each individual BUY happened *after* a given SELL: this metric is
 *     descriptive ("of every $ currently in the book, up to $X could have
 *     come from closed deals") rather than causal.
 *   - `freshCapitalDeployedEur` — the complement:
 *     `max(0, capitalInOpen − capitalReturnedFromClosed)` — capital that
 *     definitely comes from new deposits (or fresh slots) because closed
 *     deals didn't return enough to cover the current book.
 *
 * All amounts are in the same currency as the source figures (EUR/USD
 * depending on the experiment; the app treats them interchangeably as $).
 */

import type {
  DecisionSimTick,
  PaperPosition,
} from "./investDecisionSimLoop";
import {
  buildCausalSimLoopShareWalk,
  causalOptsFromSizing,
  causalShareForSell,
  shareToSynthCap,
} from "./simLoopCausalSynth";
import type { SimLoopPulseSizing } from "./simLoopPulseView";
import type { PortfolioDailyPnlLedger } from "./simulationPosition";
import type { TranslationKey } from "../shared/i18n";

export type ExperimentCashFlow = {
  /** Nominal capital released by every SELL executed so far. */
  capitalReturnedFromClosedEur: number;
  /** Nominal capital currently locked in open positions. */
  capitalInOpenEur: number;
  /**
   * Portion of open-position capital that could have been financed by
   * capital returned from prior SELLs: `min(closed, open)`. Descriptive
   * (upper bound), not a causal cash-flow trace.
   */
  capitalReinvestedEur: number;
  /**
   * Sum of positive realized P&L on closed deals only (winnings, not
   * returned principal).
   */
  realizedGainsFromClosedEur: number;
  /**
   * Open capital attributed to gains under budget-first funding:
   * with `startingCapitalEur` → `max(0, open − starting)`;
   * legacy (no starting) → `min(realizedGainsFromClosed, open)`.
   */
  gainsRecycledInOpenEur: number;
  /** Open capital from the investment budget (not from gains). */
  capitalNotFromGainsEur: number;
  /**
   * Portion of open capital not covered by returned principal from closed
   * deals: `max(0, open − capitalReturnedFromClosed)`.
   */
  freshCapitalDeployedEur: number;
  /**
   * How many SELLs contributed to `capitalReturnedFromClosedEur`.
   * Same as the KPI block's "closed deals" counter.
   */
  closedDealCount: number;
};

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

export function emptyCashFlow(): ExperimentCashFlow {
  return {
    capitalReturnedFromClosedEur: 0,
    capitalInOpenEur: 0,
    capitalReinvestedEur: 0,
    realizedGainsFromClosedEur: 0,
    gainsRecycledInOpenEur: 0,
    capitalNotFromGainsEur: 0,
    freshCapitalDeployedEur: 0,
    closedDealCount: 0,
  };
}

/**
 * Given the raw components (capital returned from SELLs + capital in the
 * open book), build the derived cash-flow snapshot.
 */
export function buildCashFlowSnapshot(opts: {
  capitalReturnedFromClosedEur: number;
  capitalInOpenEur: number;
  closedDealCount: number;
  realizedGainsFromClosedEur?: number;
  /**
   * Investment budget for this book. When set, open capital is attributed
   * budget-first (gains-in-open only after starting capital is exhausted).
   */
  startingCapitalEur?: number | null;
}): ExperimentCashFlow {
  const returned = Math.max(0, roundEur(opts.capitalReturnedFromClosedEur));
  const open = Math.max(0, roundEur(opts.capitalInOpenEur));
  const reinvested = roundEur(Math.min(returned, open));
  const fresh = roundEur(Math.max(0, open - returned));
  const gains = Math.max(0, roundEur(opts.realizedGainsFromClosedEur ?? 0));
  const startRaw = opts.startingCapitalEur;
  const start =
    startRaw != null && Number.isFinite(startRaw) && startRaw > 0
      ? roundEur(startRaw)
      : null;
  // Budget-first: open consumes starting capital before any gains.
  const gainsRecycled =
    start != null
      ? roundEur(Math.max(0, open - start))
      : roundEur(Math.min(gains, open));
  const notFromGains =
    start != null
      ? roundEur(Math.min(open, start))
      : roundEur(Math.max(0, open - gainsRecycled));
  return {
    capitalReturnedFromClosedEur: returned,
    capitalInOpenEur: open,
    capitalReinvestedEur: reinvested,
    realizedGainsFromClosedEur: gains,
    gainsRecycledInOpenEur: gainsRecycled,
    capitalNotFromGainsEur: notFromGains,
    freshCapitalDeployedEur: fresh,
    closedDealCount: Math.max(0, opts.closedDealCount | 0),
  };
}

/** Strip sign from pulse $ formatter — i18n templates must not prefix another `$`. */
export function formatCapCycleAmount(
  v: number,
  fmtPulseEur: (n: number) => string,
): string {
  return fmtPulseEur(v).replace(/^[+−]/, "");
}

export type CapCycleKpiVariant =
  | { kind: "no_open" }
  | { kind: "open_fresh_only"; openEur: number }
  | {
      kind: "open_with_gains_recycled";
      openEur: number;
      gainsRecycledEur: number;
      otherEur: number;
      gainsPct: number;
    };

/** KPI copy inputs for the Capital cycle tile (budget-first open book). */
export function capCycleKpiVariant(
  flow: Pick<
    ExperimentCashFlow,
    "capitalInOpenEur" | "gainsRecycledInOpenEur" | "closedDealCount"
  > & { capitalNotFromGainsEur?: number },
): CapCycleKpiVariant {
  const openEur = Math.max(0, flow.capitalInOpenEur);
  if (openEur <= 0) return { kind: "no_open" };
  const gainsRecycledEur = Math.max(0, flow.gainsRecycledInOpenEur);
  if (gainsRecycledEur <= 0.5) {
    return { kind: "open_fresh_only", openEur };
  }
  const otherEur = roundEur(
    flow.capitalNotFromGainsEur != null && flow.capitalNotFromGainsEur > 0
      ? flow.capitalNotFromGainsEur
      : Math.max(0, openEur - gainsRecycledEur),
  );
  return {
    kind: "open_with_gains_recycled",
    openEur,
    gainsRecycledEur,
    otherEur,
    gainsPct: Math.round((gainsRecycledEur / openEur) * 100),
  };
}

export function resolveCapCycleKpiDisplay(
  flow: Pick<
    ExperimentCashFlow,
    "capitalInOpenEur" | "gainsRecycledInOpenEur" | "closedDealCount"
  > & { capitalNotFromGainsEur?: number },
  t: (key: TranslationKey, params?: Record<string, string>) => string,
  fmtPulseEur: (n: number) => string,
): { value: string; sub?: string } {
  const variant = capCycleKpiVariant(flow);
  const fmt = (n: number) => formatCapCycleAmount(n, fmtPulseEur);
  switch (variant.kind) {
    case "no_open":
      return { value: t("pulse.capCycle.noOpen") };
    case "open_fresh_only":
      return {
        value: t("pulse.capCycle.openMain", { amount: fmt(variant.openEur) }),
        sub: t("pulse.capCycle.freshOnlySub"),
      };
    case "open_with_gains_recycled":
      return {
        value: t("pulse.capCycle.openMain", { amount: fmt(variant.openEur) }),
        sub: t("pulse.capCycle.gainsRecycledSub", {
          gains: fmt(variant.gainsRecycledEur),
          gainsPct: String(variant.gainsPct),
          other: fmt(variant.otherEur),
        }),
      };
  }
}

/**
 * Paper sim loop — walk `state.ticks` summing the nominal capital of every
 * SELL. When `sizing` is provided (synth variant), scale each SELL's
 * capital by the same causal share used by `resolveSimLoopClosedPnlEur`
 * so the two figures stay in lockstep.
 */
export function computeSimLoopCashFlow(
  ticks: DecisionSimTick[],
  paperPortfolio: PaperPosition[],
  sizing?: SimLoopPulseSizing | null,
  /** Effective (possibly synth-scaled) capital per open position — same
   *  values used by `pulseTotals.capital`. Keys must match `pos.key`. */
  effectiveOpenCapByKey?: Map<string, number>,
  /** Sim-loop pot — budget-first open attribution when set. */
  startingCapitalEur?: number | null,
): ExperimentCashFlow {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  const walk = sizing
    ? buildCausalSimLoopShareWalk(sorted, causalOptsFromSizing(sizing))
    : null;

  let capitalReturned = 0;
  let closedDealCount = 0;
  let realizedGains = 0;
  for (const tick of sorted) {
    for (const tr of tick.trades) {
      if (tr.side !== "sell") continue;
      closedDealCount += 1;
      const pnl = tr.pnlEurSimulated;
      if (pnl != null && Number.isFinite(pnl) && pnl > 0) {
        realizedGains += pnl;
      }
      const equalCap =
        tr.capital ??
        tick.portfolioBefore?.find((p) => p.key === tr.key)?.capital ??
        sizing?.capitalPerTrade ??
        0;
      if (equalCap <= 0) continue;
      if (sizing && walk) {
        const share = causalShareForSell(walk, tick, tr);
        const synthCap = shareToSynthCap(share, sizing.totalCapitalEur, equalCap);
        capitalReturned += synthCap > 0 ? synthCap : equalCap;
      } else {
        capitalReturned += equalCap;
      }
    }
  }

  let capitalInOpen = 0;
  for (const pos of paperPortfolio) {
    const effective = effectiveOpenCapByKey?.get(pos.key);
    capitalInOpen +=
      effective != null && Number.isFinite(effective) && effective > 0
        ? effective
        : pos.capital;
  }

  const start =
    startingCapitalEur != null && startingCapitalEur > 0
      ? startingCapitalEur
      : sizing != null && sizing.totalCapitalEur > 0
        ? sizing.totalCapitalEur
        : null;
  return buildCashFlowSnapshot({
    capitalReturnedFromClosedEur: capitalReturned,
    capitalInOpenEur: capitalInOpen,
    closedDealCount,
    realizedGainsFromClosedEur: realizedGains,
    startingCapitalEur: start,
  });
}

/**
 * Real portfolio — the ledger already segments rows into `archived` (SELL)
 * vs open. Sum `capital` on archived rows for the returned-capital pool;
 * use the caller-supplied `capitalInOpenEur` (usually `portfolioTotals.capital`
 * from `aggregateOpenPortfolioPnl`).
 */
export function computePortfolioCashFlow(
  ledger: PortfolioDailyPnlLedger | null | undefined,
  capitalInOpenEur: number,
  startingCapitalEur?: number | null,
): ExperimentCashFlow {
  let capitalReturned = 0;
  let closedDealCount = 0;
  let realizedGains = 0;
  if (ledger?.rows?.length) {
    for (const row of ledger.rows) {
      if (!row.archived) continue;
      if (Number.isFinite(row.capital) && row.capital > 0) {
        capitalReturned += row.capital;
      }
      if (Number.isFinite(row.totalEur) && row.totalEur > 0) {
        realizedGains += row.totalEur;
      }
      closedDealCount += 1;
    }
  }
  return buildCashFlowSnapshot({
    capitalReturnedFromClosedEur: capitalReturned,
    capitalInOpenEur,
    closedDealCount,
    realizedGainsFromClosedEur: realizedGains,
    startingCapitalEur,
  });
}
