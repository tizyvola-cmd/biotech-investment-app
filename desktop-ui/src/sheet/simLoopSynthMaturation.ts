/**
 * Sim loop · synth counterfactual curves for Decision Sim dashboard charts.
 *
 * Causal Weight Sim Exp: rebalance after each tick's marks, never with global
 * lookahead weights from future closed outcomes.
 */
import { sanitizePaperMovePct, type ExperimentPiggyBank } from "./investDecisionSimExperiment";
import type { DecisionSimTick, PaperPosition, TickerSimEvaluation } from "./investDecisionSimLoop";
import { formatDecisionSimChartTime } from "./investDecisionSimCharts";
import { sanitizeDecisionSimTimeSeries } from "./decisionSimPnlResolve";
import type { PortfolioPoint } from "../types/trades";
import {
  buildCausalSimLoopShareWalk,
  causalShareForSell,
  rebalanceCausalSimLoopShares,
  shareToSynthCap,
  type SimLoopCausalSynthOpts,
} from "./simLoopCausalSynth";

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

function scalePnl(pnlEur: number, equalCap: number, synthCap: number): number {
  if (!Number.isFinite(pnlEur) || equalCap <= 0) return pnlEur;
  return roundEur(pnlEur * (synthCap / equalCap));
}

function synthCapForOpenPosition(
  rowKey: string,
  equalCap: number,
  totalCapitalEur: number,
  activeShares: Record<string, number>,
): number {
  return shareToSynthCap(activeShares[rowKey], totalCapitalEur, equalCap);
}

function openSynthMtmForTick(
  portfolio: PaperPosition[],
  evaluations: TickerSimEvaluation[],
  totalCapitalEur: number,
  capitalPerTrade: number,
  activeShares: Record<string, number>,
): number {
  const evByKey = new Map(evaluations.map((e) => [e.key, e]));
  let openSynth = 0;

  for (const pos of portfolio) {
    const equalCap = pos.capital ?? capitalPerTrade;
    const synthCap = synthCapForOpenPosition(pos.key, equalCap, totalCapitalEur, activeShares);
    const ev = evByKey.get(pos.key);
    const pct =
      sanitizePaperMovePct(ev?.pnlPct) ??
      sanitizePaperMovePct(pos.lastMarkPct) ??
      sanitizePaperMovePct(ev?.pnlPct24h) ??
      null;
    if (pct != null) {
      openSynth += (synthCap * pct) / 100;
    }
  }

  return roundEur(openSynth);
}

function openSynthFromPiggy(
  piggy: ExperimentPiggyBank,
  portfolio: PaperPosition[],
  totalCapitalEur: number,
  capitalPerTrade: number,
  activeShares: Record<string, number>,
): number | null {
  if (!Number.isFinite(piggy.openMtmPnlEur) || portfolio.length === 0) return null;
  let equalOpenCap = 0;
  let synthOpenCap = 0;
  for (const pos of portfolio) {
    const equalCap = pos.capital ?? capitalPerTrade;
    if (equalCap <= 0) continue;
    equalOpenCap += equalCap;
    synthOpenCap += synthCapForOpenPosition(pos.key, equalCap, totalCapitalEur, activeShares);
  }
  if (equalOpenCap <= 0 || synthOpenCap <= 0) return null;
  return roundEur((piggy.openMtmPnlEur ?? 0) * (synthOpenCap / equalOpenCap));
}

function resolveOpenSynthForTick(
  tk: DecisionSimTick,
  totalCapitalEur: number,
  capitalPerTrade: number,
  activeShares: Record<string, number>,
): number {
  const fromEvals = openSynthMtmForTick(
    tk.portfolioAfter,
    tk.evaluations,
    totalCapitalEur,
    capitalPerTrade,
    activeShares,
  );
  const piggy = tk.summary.piggyBank;
  if (tk.evaluations.length === 0 && piggy && tk.portfolioAfter.length > 0) {
    const fromPiggy = openSynthFromPiggy(
      piggy,
      tk.portfolioAfter,
      totalCapitalEur,
      capitalPerTrade,
      activeShares,
    );
    if (fromPiggy != null) return fromPiggy;
  }
  return fromEvals;
}

export type SimLoopSynthMaturationPoint = {
  at: string;
  /** Realized P&L from paper SELL trades scaled by synth cap / equal cap. */
  simLoopSynthClosedPnlEur: number;
  /** Open positions MTM with synth sizing. */
  simLoopSynthOpenMtmEur: number;
  /** Cumulative closed + open MTM with synth sizing on sim loop book. */
  simLoopSynthTotalPnlEur: number;
};

/** Spread open-MTM catch-up across synth maturation history (same as equal paper curve). */
export function sanitizeSimLoopSynthMaturationSeries(
  points: SimLoopSynthMaturationPoint[],
): SimLoopSynthMaturationPoint[] {
  if (points.length < 2) return points;

  const mapped = points.map((p, i) => ({
    at: p.at,
    simLoopSynthClosedPnlEur: p.simLoopSynthClosedPnlEur,
    simLoopSynthOpenMtmEur: p.simLoopSynthOpenMtmEur,
    simLoopSynthTotalPnlEur: p.simLoopSynthTotalPnlEur,
    totalPnlEur: p.simLoopSynthTotalPnlEur,
    closedPnlEur: p.simLoopSynthClosedPnlEur,
    openMtmEur: p.simLoopSynthOpenMtmEur,
    cumulativeRealizedEur: p.simLoopSynthClosedPnlEur,
    isLive: i === points.length - 1,
  }));

  const sanitized = sanitizeDecisionSimTimeSeries(mapped);
  const PNL_SANITY = 500_000;
  return sanitized.map((p, i) => {
    const closed = roundEur(p.closedPnlEur ?? p.cumulativeRealizedEur ?? 0);
    let open = roundEur(p.openMtmEur ?? 0);
    if (Math.abs(open) > PNL_SANITY) open = 0;
    let total = roundEur(p.totalPnlEur);
    if (Math.abs(total) > PNL_SANITY) total = roundEur(closed + open);
    return {
      at: points[i]?.at ?? p.at,
      simLoopSynthClosedPnlEur: closed,
      simLoopSynthOpenMtmEur: open,
      simLoopSynthTotalPnlEur: total,
    };
  });
}

export type BuildSimLoopSynthMaturationOpts = {
  totalCapitalEur: number;
  capitalPerTrade: number;
  targetGainEur?: number;
  /** @deprecated Global share map — only used for static_approved mode. */
  shareByRowKey?: Record<string, number>;
  /** @deprecated Replaced by causal walk; kept for static_approved compatibility. */
  entryShareByRowKey?: Record<string, number>;
  sizingMode?: "causal_rebalance" | "static_approved";
  live?: {
    paperPortfolio: PaperPosition[];
    evaluations: TickerSimEvaluation[];
    piggyBank: ExperimentPiggyBank;
  } | null;
};

function causalOptsFromBuildOpts(opts: BuildSimLoopSynthMaturationOpts): SimLoopCausalSynthOpts {
  return {
    totalCapitalEur: opts.totalCapitalEur,
    capitalPerTrade: opts.capitalPerTrade,
    targetGainEur: opts.targetGainEur,
    sizingMode: opts.sizingMode ?? "causal_rebalance",
    staticSharesByKey: opts.shareByRowKey,
  };
}

/** One point per decision-sim tick (+ optional live tail). */
export function buildSimLoopSynthMaturationSeries(
  ticks: DecisionSimTick[],
  opts: BuildSimLoopSynthMaturationOpts,
): SimLoopSynthMaturationPoint[] {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  const causalOpts = causalOptsFromBuildOpts(opts);
  const walk = buildCausalSimLoopShareWalk(sorted, causalOpts);
  let cumClosedSynth = 0;
  const points: SimLoopSynthMaturationPoint[] = [];

  for (let i = 0; i < sorted.length; i += 1) {
    const tk = sorted[i]!;
    for (const tr of tk.trades) {
      if (tr.side !== "sell") continue;
      const entryPos = tk.portfolioBefore.find((p) => p.key === tr.key);
      const equalCap = tr.capital ?? entryPos?.capital ?? opts.capitalPerTrade;
      const share = causalShareForSell(walk, tk, tr);
      const synthCap = shareToSynthCap(share, opts.totalCapitalEur, equalCap);
      cumClosedSynth = roundEur(
        cumClosedSynth + scalePnl(tr.pnlEurSimulated ?? 0, equalCap, synthCap),
      );
    }

    const openShares = walk.openSharesPerTick[i] ?? {};
    const openSynth = resolveOpenSynthForTick(
      tk,
      opts.totalCapitalEur,
      opts.capitalPerTrade,
      openShares,
    );

    const closedPnl = roundEur(cumClosedSynth);
    const openMtm = roundEur(openSynth);
    points.push({
      at: tk.at,
      simLoopSynthClosedPnlEur: closedPnl,
      simLoopSynthOpenMtmEur: openMtm,
      simLoopSynthTotalPnlEur: roundEur(closedPnl + openMtm),
    });
  }

  if (opts.live?.piggyBank) {
    let liveClosed = 0;
    for (const tk of sorted) {
      for (const tr of tk.trades) {
        if (tr.side !== "sell") continue;
        const entryPos = tk.portfolioBefore.find((p) => p.key === tr.key);
        const equalCap = tr.capital ?? entryPos?.capital ?? opts.capitalPerTrade;
        const share = causalShareForSell(walk, tk, tr);
        const synthCap = shareToSynthCap(share, opts.totalCapitalEur, equalCap);
        liveClosed = roundEur(
          liveClosed + scalePnl(tr.pnlEurSimulated ?? 0, equalCap, synthCap),
        );
      }
    }
    const liveOpenShares =
      causalOpts.sizingMode === "static_approved"
        ? (() => {
            const out: Record<string, number> = {};
            for (const pos of opts.live!.paperPortfolio) {
              const frozen = walk.frozenEntryShares[pos.key];
              const staticShare = opts.shareByRowKey?.[pos.key];
              out[pos.key] =
                typeof frozen === "number" && Number.isFinite(frozen)
                  ? frozen
                  : typeof staticShare === "number" && Number.isFinite(staticShare)
                    ? staticShare
                    : opts.capitalPerTrade / opts.totalCapitalEur;
            }
            return out;
          })()
        : rebalanceCausalSimLoopShares(
            opts.live.paperPortfolio,
            opts.live.evaluations,
            causalOpts,
          );
    const liveOpen = openSynthMtmForTick(
      opts.live.paperPortfolio,
      opts.live.evaluations,
      opts.totalCapitalEur,
      opts.capitalPerTrade,
      liveOpenShares,
    );
    const closedPnl = roundEur(liveClosed);
    const openMtm = roundEur(liveOpen);
    points.push({
      at: new Date().toISOString(),
      simLoopSynthClosedPnlEur: closedPnl,
      simLoopSynthOpenMtmEur: openMtm,
      simLoopSynthTotalPnlEur: roundEur(closedPnl + openMtm),
    });
  }

  return sanitizeSimLoopSynthMaturationSeries(points);
}

/** Book value curve for TradePortfolioChart (deployed synth caps + P&L). */
export function buildSimLoopSynthPortfolioCurve(
  maturation: SimLoopSynthMaturationPoint[],
  totalCapitalEur: number,
): PortfolioPoint[] {
  return maturation.map((p) => ({
    date: p.at.includes("T") ? formatDecisionSimChartTime(p.at) : "· now",
    value: Math.round(totalCapitalEur + p.simLoopSynthTotalPnlEur),
    totalPnlEur: p.simLoopSynthTotalPnlEur,
  }));
}

function buildPnlByDateMap(
  maturation: SimLoopSynthMaturationPoint[],
  portfolioCurve: PortfolioPoint[],
): Map<string, number> {
  const pnlByDate = new Map<string, number>();
  for (let i = 0; i < maturation.length; i += 1) {
    const pt = maturation[i]!;
    const paper = portfolioCurve[i];
    if (paper) pnlByDate.set(paper.date, pt.simLoopSynthTotalPnlEur);
    const formatted = pt.at.includes("T") ? formatDecisionSimChartTime(pt.at) : "· now";
    pnlByDate.set(formatted, pt.simLoopSynthTotalPnlEur);
  }

  const lastMat = maturation[maturation.length - 1];
  const lastPaper = portfolioCurve[portfolioCurve.length - 1];
  if (lastMat && lastPaper?.date === "· now") {
    pnlByDate.set("· now", lastMat.simLoopSynthTotalPnlEur);
  }
  return pnlByDate;
}

/** Synth / weight P&L aligned to the equal sim-loop chart dates (Y = cumulative P&L €). */
export function alignSimLoopPnlToPortfolioDates(
  maturation: SimLoopSynthMaturationPoint[],
  portfolioCurve: PortfolioPoint[],
): PortfolioPoint[] {
  if (!maturation.length || !portfolioCurve.length) return [];

  const pnlByDate = buildPnlByDateMap(maturation, portfolioCurve);
  let lastPnl = 0;
  return portfolioCurve.map((paper) => {
    const direct = pnlByDate.get(paper.date);
    const pnl = direct != null && Number.isFinite(direct) ? direct : lastPnl;
    if (direct != null && Number.isFinite(direct)) lastPnl = direct;
    return {
      date: paper.date,
      value: pnl,
      totalPnlEur: pnl,
    };
  });
}

/** Align synth/weight maturation to the paper portfolio curve dates (tick + live tail). */
export function alignSimLoopCurveToPortfolioDates(
  maturation: SimLoopSynthMaturationPoint[],
  portfolioCurve: PortfolioPoint[],
  totalCapitalEur: number,
): PortfolioPoint[] {
  if (!maturation.length || !portfolioCurve.length || totalCapitalEur <= 0) return [];

  const pnlByDate = buildPnlByDateMap(maturation, portfolioCurve);
  let lastPnl = 0;
  return portfolioCurve.map((paper) => {
    const direct = pnlByDate.get(paper.date);
    const pnl = direct != null && Number.isFinite(direct) ? direct : lastPnl;
    if (direct != null && Number.isFinite(direct)) lastPnl = direct;
    return {
      date: paper.date,
      value: Math.round(totalCapitalEur + pnl),
      totalPnlEur: pnl,
    };
  });
}
