/**
 * Causal sim-loop synth sizing — rebalance capital only after marks are observed,
 * never with global weights computed from future closed outcomes.
 */
import { sanitizePaperMovePct } from "./investDecisionSimExperiment";
import type {
  DecisionSimTick,
  PaperPosition,
  PaperTradeEvent,
  TickerSimEvaluation,
} from "./investDecisionSimLoop";
import { effectiveSynthMovePct } from "./synthLossAwareCap";
import { optimizeWeightSimExp, type WeightSimExpDealInput } from "./weightSimExpOptimizer";

export type SimLoopCausalSynthOpts = {
  totalCapitalEur: number;
  capitalPerTrade: number;
  targetGainEur?: number;
  /** Weight Sim Exp reactive rebalance vs frozen approved weights at entry. */
  sizingMode?: "causal_rebalance" | "static_approved";
  /** Static approved shares — snapshotted when a row first enters the book. */
  staticSharesByKey?: Record<string, number>;
};

export type CausalSimLoopShareWalk = {
  /** Share (0–1) applied to each sell, in tick order. */
  sellShareByEventKey: Map<string, number>;
  /** Open-book shares after each tick (end-of-tick rebalance). */
  openSharesPerTick: Record<string, number>[];
  /** Frozen entry shares for static_approved mode. */
  frozenEntryShares: Record<string, number>;
};

function sellEventKey(at: string, rowKey: string): string {
  return `${at}\0${rowKey}`;
}

function equalSlotShare(opts: SimLoopCausalSynthOpts, openCount: number): number {
  if (opts.totalCapitalEur <= 0) return 0;
  if (openCount > 0) {
    const perSlot = opts.capitalPerTrade / opts.totalCapitalEur;
    if (Number.isFinite(perSlot) && perSlot > 0) return perSlot;
  }
  return 1;
}

export function movePctForPaperPosition(
  pos: PaperPosition,
  evByKey: Map<string, TickerSimEvaluation>,
  tradeHint?: PaperTradeEvent | null,
): number {
  const ev = evByKey.get(pos.key);
  const fromEv =
    sanitizePaperMovePct(ev?.pnlPct) ??
    sanitizePaperMovePct(ev?.pnlPct24h) ??
    null;
  const fromPos = sanitizePaperMovePct(pos.lastMarkPct);
  const fromTrade =
    tradeHint?.key === pos.key ? sanitizePaperMovePct(tradeHint.pnlPctSimulated) : null;
  const pct = fromEv ?? fromPos ?? fromTrade ?? 0;
  return effectiveSynthMovePct({
    movePct24h: pct,
    totalPnlPct: fromEv ?? fromPos ?? fromTrade,
    isOpenPortfolio: true,
  });
}

/** Recompute synth shares across the open paper book after marks are known. */
export function rebalanceCausalSimLoopShares(
  portfolio: PaperPosition[],
  evaluations: TickerSimEvaluation[],
  opts: SimLoopCausalSynthOpts,
  tradeHints: PaperTradeEvent[] = [],
): Record<string, number> {
  if (portfolio.length === 0 || opts.totalCapitalEur <= 0) return {};

  const evByKey = new Map(evaluations.map((e) => [e.key, e]));
  const hintByKey = new Map(tradeHints.map((t) => [t.key, t]));
  const baseline = equalSlotShare(opts, portfolio.length);

  const deals: WeightSimExpDealInput[] = portfolio.map((pos) => ({
    rowKey: pos.key,
    ticker: pos.ticker,
    movePct24h: movePctForPaperPosition(pos, evByKey, hintByKey.get(pos.key)),
    baselineShare: baseline,
  }));

  const target =
    opts.targetGainEur ?? Math.max(50, Math.round(opts.totalCapitalEur * 0.005));
  const result = optimizeWeightSimExp(deals, opts.totalCapitalEur, target);
  if (!result) {
    return Object.fromEntries(portfolio.map((p) => [p.key, baseline]));
  }

  const out: Record<string, number> = {};
  for (let i = 0; i < portfolio.length; i += 1) {
    out[portfolio[i]!.key] = result.shares[i] ?? baseline;
  }
  return out;
}

export function shareToSynthCap(
  share: number | null | undefined,
  totalCapitalEur: number,
  equalCapFallback: number,
): number {
  if (
    typeof share === "number" &&
    Number.isFinite(share) &&
    share >= 0 &&
    totalCapitalEur > 0
  ) {
    return Math.round(share * totalCapitalEur * 100) / 100;
  }
  return equalCapFallback;
}

/** Walk paper ticks and derive causal shares for sells and open MTM. */
export function buildCausalSimLoopShareWalk(
  ticks: DecisionSimTick[],
  opts: SimLoopCausalSynthOpts,
): CausalSimLoopShareWalk {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  const mode = opts.sizingMode ?? "causal_rebalance";
  const sellShareByEventKey = new Map<string, number>();
  const openSharesPerTick: Record<string, number>[] = [];
  const frozenEntryShares: Record<string, number> = { ...(opts.staticSharesByKey ?? {}) };
  let lastOpenShares: Record<string, number> = {};

  for (const tk of sorted) {
    const bookBefore =
      tk.portfolioBefore?.length > 0 ? tk.portfolioBefore : tk.portfolioAfter ?? [];

    let activeShares: Record<string, number>;
    if (mode === "causal_rebalance") {
      activeShares =
        bookBefore.length > 0
          ? rebalanceCausalSimLoopShares(bookBefore, tk.evaluations, opts, tk.trades)
          : { ...lastOpenShares };
    } else {
      activeShares = {};
      for (const pos of bookBefore) {
        if (frozenEntryShares[pos.key] == null) {
          const staticShare = opts.staticSharesByKey?.[pos.key];
          frozenEntryShares[pos.key] =
            typeof staticShare === "number" && Number.isFinite(staticShare) && staticShare >= 0
              ? staticShare
              : equalSlotShare(opts, bookBefore.length);
        }
        activeShares[pos.key] = frozenEntryShares[pos.key]!;
      }
    }

    for (const tr of tk.trades) {
      if (tr.side === "buy" && mode === "static_approved") {
        if (frozenEntryShares[tr.key] == null) {
          const staticShare = opts.staticSharesByKey?.[tr.key];
          frozenEntryShares[tr.key] =
            typeof staticShare === "number" && Number.isFinite(staticShare) && staticShare >= 0
              ? staticShare
              : equalSlotShare(opts, tk.portfolioAfter.length || 1);
        }
      }
      if (tr.side !== "sell") continue;
      const share =
        activeShares[tr.key] ??
        frozenEntryShares[tr.key] ??
        (mode === "causal_rebalance" ? equalSlotShare(opts, bookBefore.length || 1) : null);
      if (share != null && Number.isFinite(share)) {
        sellShareByEventKey.set(sellEventKey(tk.at, tr.key), share);
      }
      delete activeShares[tr.key];
      delete lastOpenShares[tr.key];
    }

    let openShares: Record<string, number>;
    if (mode === "causal_rebalance") {
      openShares =
        tk.portfolioAfter.length > 0
          ? rebalanceCausalSimLoopShares(tk.portfolioAfter, tk.evaluations, opts)
          : {};
    } else {
      openShares = {};
      for (const pos of tk.portfolioAfter) {
        if (frozenEntryShares[pos.key] == null) {
          const staticShare = opts.staticSharesByKey?.[pos.key];
          frozenEntryShares[pos.key] =
            typeof staticShare === "number" && Number.isFinite(staticShare) && staticShare >= 0
              ? staticShare
              : equalSlotShare(opts, tk.portfolioAfter.length || 1);
        }
        openShares[pos.key] = frozenEntryShares[pos.key]!;
      }
    }
    lastOpenShares = { ...openShares };
    openSharesPerTick.push(openShares);
  }

  return { sellShareByEventKey, openSharesPerTick, frozenEntryShares };
}

export function causalShareForSell(
  walk: CausalSimLoopShareWalk,
  tick: DecisionSimTick,
  trade: PaperTradeEvent,
): number | null {
  return walk.sellShareByEventKey.get(sellEventKey(tick.at, trade.key)) ?? null;
}

export function causalOptsFromSizing(sizing: {
  totalCapitalEur: number;
  capitalPerTrade: number;
  targetGainEur?: number;
  shareByRowKey?: Record<string, number>;
  sizingMode?: "causal_rebalance" | "static_approved";
}): SimLoopCausalSynthOpts {
  return {
    totalCapitalEur: sizing.totalCapitalEur,
    capitalPerTrade: sizing.capitalPerTrade,
    targetGainEur: sizing.targetGainEur,
    sizingMode: sizing.sizingMode ?? "causal_rebalance",
    staticSharesByKey: sizing.shareByRowKey,
  };
}
