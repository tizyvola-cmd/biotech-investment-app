/**
 * Esperimento long-run: portfolio che segue i suggerimenti, piggy bank, score consigli.
 */
import type { PaperPosition, PaperTradeEvent, TickerSimEvaluation } from "./investDecisionSimLoop";

export type AdviceOutcomeKind =
  | "good_buy"
  | "bad_buy"
  | "good_sell"
  | "bad_sell"
  | "missed_buy";

export type ExperimentAdviceEvent = {
  at: string;
  tickId: string;
  ticker: string;
  key: string;
  kind: AdviceOutcomeKind;
  capitalEur: number;
  pnlEur: number | null;
  pnlPct: number | null;
  /** P(plan) al momento del consiglio — per calibrazione reliability. */
  probPctAtAdvice?: number | null;
  note: string;
};

export type ExperimentScorecard = {
  missedBuyCount: number;
  missedBuyEurEst: number;
  badBuyCount: number;
  badSellCount: number;
  goodBuyCount: number;
  goodSellCount: number;
  /** Buoni consigli / (buoni + cattivi) su trade chiusi. */
  advicePrecisionPct: number | null;
  /** Buy eseguiti / (buy eseguiti + buy persi). */
  adviceFollowPct: number | null;
};

export type ExperimentPiggyBank = {
  openCapitalEur: number;
  openMtmPnlEur: number;
  closedPnlEur: number;
  totalPnlEur: number;
  openPositionCount: number;
  closedTradeCount: number;
};

export type ExperimentTickMetrics = {
  piggyBank: ExperimentPiggyBank;
  adviceEvents: ExperimentAdviceEvent[];
  scorecardDelta: Partial<ExperimentScorecard>;
};

/**
 * Default cap on the number of simultaneously-open paper-sim positions.
 *
 * `Number.POSITIVE_INFINITY` means "no cap": the sim loop buys on every reliable
 * BUY signal and sells on every reliable SELL signal, without artificial slot
 * limits. The same value is used by the fair-recs baseline so that the
 * "capture vs recs" comparison stays apples-to-apples.
 *
 * Storage note: `JSON.stringify(Infinity) === "null"`. The storage normalizer
 * (`investDecisionSimStorage.normalizeConfig`) coerces non-finite / null
 * values back to `Number.POSITIVE_INFINITY` on read.
 */
export const DEFAULT_MAX_OPEN_POSITIONS = Number.POSITIVE_INFINITY;
const BAD_BUY_PNL_PCT = -3;
const GOOD_OPEN_PNL_PCT = 2;

export function defaultExperimentScorecard(): ExperimentScorecard {
  return {
    missedBuyCount: 0,
    missedBuyEurEst: 0,
    badBuyCount: 0,
    badSellCount: 0,
    goodBuyCount: 0,
    goodSellCount: 0,
    advicePrecisionPct: null,
    adviceFollowPct: null,
  };
}

export function defaultExperimentPiggyBank(): ExperimentPiggyBank {
  return {
    openCapitalEur: 0,
    openMtmPnlEur: 0,
    closedPnlEur: 0,
    totalPnlEur: 0,
    openPositionCount: 0,
    closedTradeCount: 0,
  };
}

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

export function recomputeScorecardRates(score: ExperimentScorecard): ExperimentScorecard {
  const good = score.goodBuyCount + score.goodSellCount;
  const bad = score.badBuyCount + score.badSellCount;
  const closed = good + bad;
  const executedBuys = score.goodBuyCount + score.badBuyCount;
  const buyDenom = executedBuys + score.missedBuyCount;
  return {
    ...score,
    advicePrecisionPct:
      closed > 0 ? Math.round((good / closed) * 1000) / 10 : score.advicePrecisionPct,
    adviceFollowPct:
      buyDenom > 0 ? Math.round((executedBuys / buyDenom) * 1000) / 10 : score.adviceFollowPct,
  };
}

export function mergeScorecardDelta(
  base: ExperimentScorecard,
  delta: Partial<ExperimentScorecard>,
): ExperimentScorecard {
  const next: ExperimentScorecard = {
    missedBuyCount: base.missedBuyCount + (delta.missedBuyCount ?? 0),
    missedBuyEurEst: roundEur(base.missedBuyEurEst + (delta.missedBuyEurEst ?? 0)),
    badBuyCount: base.badBuyCount + (delta.badBuyCount ?? 0),
    badSellCount: base.badSellCount + (delta.badSellCount ?? 0),
    goodBuyCount: base.goodBuyCount + (delta.goodBuyCount ?? 0),
    goodSellCount: base.goodSellCount + (delta.goodSellCount ?? 0),
    advicePrecisionPct: base.advicePrecisionPct,
    adviceFollowPct: base.adviceFollowPct,
  };
  return recomputeScorecardRates(next);
}

/** Reject corrupted move % (e.g. ratio × 100 stored as pnlPct). */
export function sanitizePaperMovePct(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (Math.abs(pct) > 500) return null;
  return pct;
}

function resolveOpenMovePct(
  pos: PaperPosition,
  ev: TickerSimEvaluation | undefined,
): number {
  return (
    sanitizePaperMovePct(ev?.pnlPct) ??
    sanitizePaperMovePct(pos.lastMarkPct) ??
    sanitizePaperMovePct(ev?.pnlPct24h) ??
    0
  );
}

/** Open-book MTM from paper positions (eval mark, else stamped lastMarkPct). */
export function openPaperMtmFromPortfolio(
  portfolio: PaperPosition[],
  evaluations: TickerSimEvaluation[] = [],
): number {
  const byKey = new Map(evaluations.map((e) => [e.key, e]));
  let openMtmPnlEur = 0;
  for (const pos of portfolio) {
    const cap = pos.capital ?? 0;
    if (!Number.isFinite(cap) || cap <= 0) continue;
    const pct = resolveOpenMovePct(pos, byKey.get(pos.key));
    openMtmPnlEur += (cap * pct) / 100;
  }
  return roundEur(openMtmPnlEur);
}

/** Mark-to-market P&L for open paper positions using current tick evaluations. */
export function computeOpenMtmPnl(
  portfolio: PaperPosition[],
  evaluations: TickerSimEvaluation[],
): { openCapitalEur: number; openMtmPnlEur: number } {
  const byKey = new Map(evaluations.map((e) => [e.key, e]));
  let openCapitalEur = 0;
  let openMtmPnlEur = 0;
  for (const pos of portfolio) {
    const cap = pos.capital ?? 0;
    if (!Number.isFinite(cap) || cap <= 0) continue;
    openCapitalEur += cap;
    const pct = resolveOpenMovePct(pos, byKey.get(pos.key));
    openMtmPnlEur += (cap * pct) / 100;
  }
  return {
    openCapitalEur: roundEur(openCapitalEur),
    openMtmPnlEur: roundEur(openMtmPnlEur),
  };
}

export function buildExperimentPiggyBank(
  portfolio: PaperPosition[],
  evaluations: TickerSimEvaluation[],
  closedPnlCumulativeEur: number,
  closedTradeCount: number,
): ExperimentPiggyBank {
  const { openCapitalEur, openMtmPnlEur } = computeOpenMtmPnl(portfolio, evaluations);
  const closedRaw = closedPnlCumulativeEur ?? 0;
  const closedPnlEur = roundEur(Number.isFinite(closedRaw) ? closedRaw : 0);
  const openMtm = Number.isFinite(openMtmPnlEur) ? openMtmPnlEur : 0;
  const openCap = Number.isFinite(openCapitalEur) ? openCapitalEur : 0;
  return {
    openCapitalEur: openCap,
    openMtmPnlEur: openMtm,
    closedPnlEur,
    totalPnlEur: roundEur(openMtm + closedPnlEur),
    openPositionCount: portfolio.length,
    closedTradeCount: closedTradeCount ?? 0,
  };
}

type TickExperimentOpts = {
  tickId: string;
  at: string;
  evaluations: TickerSimEvaluation[];
  trades: PaperTradeEvent[];
  portfolioBefore: PaperPosition[];
  portfolioAfter: PaperPosition[];
  maxOpenPositions: number;
  capitalPerTrade: number;
  closedPnlBeforeEur: number;
  closedTradeCountBefore: number;
  /** Keys already scored as bad_buy while open — avoid double count. */
  badBuyScoredKeys: Set<string>;
};

export function evaluateExperimentTick(opts: TickExperimentOpts): ExperimentTickMetrics {
  const {
    tickId,
    at,
    evaluations,
    trades,
    portfolioBefore,
    portfolioAfter,
    maxOpenPositions,
    capitalPerTrade,
    closedPnlBeforeEur,
    closedTradeCountBefore,
    badBuyScoredKeys,
  } = opts;

  const adviceEvents: ExperimentAdviceEvent[] = [];
  const scorecardDelta: Partial<ExperimentScorecard> = {};
  const boughtKeys = new Set(trades.filter((t) => t.side === "buy").map((t) => t.key));
  const slotsBefore = maxOpenPositions - portfolioBefore.length;

  let missedN = 0;
  let missedEurEst = 0;

  const evalByKey = new Map(evaluations.map((e) => [e.key, e]));

  const probForKey = (key: string, pos?: PaperPosition | null): number | null => {
    const fromPos = pos?.entryProbPct;
    if (fromPos != null && Number.isFinite(fromPos)) return fromPos;
    const fromEv = evalByKey.get(key)?.probPct ?? null;
    return fromEv != null && Number.isFinite(fromEv) ? fromEv : null;
  };

  for (const ev of evaluations) {
    if (ev.suggestedAction !== "buy" || ev.inPaperPortfolio) continue;
    if (boughtKeys.has(ev.key)) continue;
    missedN += 1;
    const estPct = ev.planReturnPct ?? ev.readings.planTargetPct ?? 0;
    const estEur = (capitalPerTrade * Math.max(0, estPct)) / 100;
    missedEurEst += estEur;
    adviceEvents.push({
      at,
      tickId,
      ticker: ev.ticker,
      key: ev.key,
      kind: "missed_buy",
      capitalEur: capitalPerTrade,
      pnlEur: roundEur(estEur),
      pnlPct: estPct,
      probPctAtAdvice: ev.probPct,
      note:
        slotsBefore <= 0
          ? "max positions"
          : ev.investVerdict === "yes"
            ? "buy signal not executed"
            : "review/hold skipped",
    });
  }

  if (missedN > 0) {
    scorecardDelta.missedBuyCount = missedN;
    scorecardDelta.missedBuyEurEst = roundEur(missedEurEst);
  }

  let goodBuy = 0;
  let badBuy = 0;
  let goodSell = 0;
  let badSell = 0;
  let closedTrades = closedTradeCountBefore;

  for (const tr of trades) {
    if (tr.side === "sell") {
      closedTrades += 1;
      const pct = tr.pnlPctSimulated ?? 0;
      const eur = tr.pnlEurSimulated ?? 0;
      const entryPos = portfolioBefore.find((p) => p.key === tr.key);
      const entryProb = probForKey(tr.key, entryPos);
      if (pct >= 0) {
        goodSell += 1;
        goodBuy += 1;
        adviceEvents.push({
          at,
          tickId,
          ticker: tr.ticker,
          key: tr.key,
          kind: "good_sell",
          capitalEur: tr.capital,
          pnlEur: eur,
          pnlPct: pct,
          probPctAtAdvice: entryProb,
          note: "closed at profit or flat",
        });
      } else {
        badSell += 1;
        badBuy += 1;
        adviceEvents.push({
          at,
          tickId,
          ticker: tr.ticker,
          key: tr.key,
          kind: "bad_sell",
          capitalEur: tr.capital,
          pnlEur: eur,
          pnlPct: pct,
          probPctAtAdvice: entryProb,
          note: "closed at loss — buy advice failed",
        });
      }
      badBuyScoredKeys.delete(tr.key);
    }
  }

  for (const pos of portfolioAfter) {
    if (badBuyScoredKeys.has(pos.key)) continue;
    const ev = evalByKey.get(pos.key);
    const pct = ev?.pnlPct ?? ev?.pnlPct24h ?? null;
    if (pct == null) continue;
    if (pct <= BAD_BUY_PNL_PCT) {
      badBuy += 1;
      badBuyScoredKeys.add(pos.key);
      adviceEvents.push({
        at,
        tickId,
        ticker: pos.ticker,
        key: pos.key,
        kind: "bad_buy",
        capitalEur: pos.capital,
        pnlEur: roundEur((pos.capital * pct) / 100),
        pnlPct: pct,
        probPctAtAdvice: probForKey(pos.key, pos),
        note: "open position underwater",
      });
    } else if (pct >= GOOD_OPEN_PNL_PCT) {
      goodBuy += 1;
      adviceEvents.push({
        at,
        tickId,
        ticker: pos.ticker,
        key: pos.key,
        kind: "good_buy",
        capitalEur: pos.capital,
        pnlEur: roundEur((pos.capital * pct) / 100),
        pnlPct: pct,
        probPctAtAdvice: probForKey(pos.key, pos),
        note: "open position in gain",
      });
    }
  }

  if (goodBuy) scorecardDelta.goodBuyCount = goodBuy;
  if (badBuy) scorecardDelta.badBuyCount = badBuy;
  if (goodSell) scorecardDelta.goodSellCount = goodSell;
  if (badSell) scorecardDelta.badSellCount = badSell;

  const closedPnlAfter =
    closedPnlBeforeEur +
    trades.reduce((s, t) => s + (t.side === "sell" ? (t.pnlEurSimulated ?? 0) : 0), 0);

  const piggyBank = buildExperimentPiggyBank(
    portfolioAfter,
    evaluations,
    closedPnlAfter,
    closedTrades,
  );

  return { piggyBank, adviceEvents, scorecardDelta };
}

/** Annotate open positions with latest mark % for next tick. */
export function stampPortfolioMarks(
  portfolio: PaperPosition[],
  evaluations: TickerSimEvaluation[],
): PaperPosition[] {
  const byKey = new Map(evaluations.map((e) => [e.key, e]));
  return portfolio.map((p) => {
    const ev = byKey.get(p.key);
    const mark =
      sanitizePaperMovePct(ev?.pnlPct) ??
      sanitizePaperMovePct(ev?.pnlPct24h) ??
      sanitizePaperMovePct(p.lastMarkPct) ??
      null;
    return mark != null ? { ...p, lastMarkPct: mark } : p;
  });
}
