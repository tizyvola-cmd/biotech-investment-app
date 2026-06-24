/**
 * Top 2 portfolio picks — BUY by ROI/days, SELL solo con pendenza ↓ sostenuta (non in salita).
 */

import type { ChartPoint } from "../types";
import { dealGainPctForBuy, dealGainPctForSell, type DealRankSignal } from "./dealRankIcon";
import {
  declineInputFromSignalLike,
  isCurveRisingForHold,
  isSustainedDeclineSignal,
} from "./portfolioDeclineSell";
import { resolvePrimaryDays, resolvePrimaryReturnPct } from "./canonicalRoi";
import { portfolioPnlTone } from "./portfolioGainLossStyle";
import { roiPerDayFromPlan } from "./topOppQuality";
import type { StabilityVerdict } from "./slopeStability";
import type { GatedPrecatKind, MarketGatePayload, MarketRegime } from "./marketContextGate";

export type Top2PickSignal = DealRankSignal & {
  ticker: string;
  cd: string;
  hasPosition: boolean;
  planDays?: number | null;
  /** ROI→CD informativo (non per ranking). */
  planCdReturnPct?: number | null;
  days?: number | null;
  slope20d?: number | null;
  affid?: number | null;
  r2?: number | null;
  stabilityVerdict?: StabilityVerdict;
  slopeRotationFlag?: 0 | 1;
  precatKind?: GatedPrecatKind | string;
  precatOriginalKind?: string;
  precatLabel?: string;
  marketRegime?: MarketRegime;
  marketGate?: MarketGatePayload | null;
  pnlPct?: number | null;
  pnlEur?: number | null;
  pnlPct24h?: number | null;
  pnlEur24h?: number | null;
  buyPriceUsd?: number | null;
  currentPriceUsd?: number | null;
  simRow?: Record<string, unknown>;
  chartPoints?: ChartPoint[] | null;
};

/** Ticker già in portafoglio (qualsiasi riga CD). */
export function isTickerInPortfolio(
  s: Top2PickSignal,
  portfolioTickers?: Set<string>,
): boolean {
  if (s.hasPosition) return true;
  const tk = s.ticker.trim().toUpperCase();
  return portfolioTickers != null && portfolioTickers.has(tk);
}

/** ROI target % per giorno (ranking BUY). */
export function roiPerDayPct(s: Top2PickSignal): number {
  const ret =
    resolvePrimaryReturnPct(s) ??
    s.precatExpectedReturn ??
    (s.pred5 != null && s.pred5 > 0 ? s.pred5 : null);
  return roiPerDayFromPlan(ret, resolvePrimaryDays(s) ?? s.planDays ?? s.days);
}

/** Movimento atteso al target (SELL: più basso = peggiore). */
export function projectedMovePct(s: Top2PickSignal): number {
  const primary = resolvePrimaryReturnPct(s);
  if (primary != null && Number.isFinite(primary)) return primary;
  if (s.planCdReturnPct != null && Number.isFinite(s.planCdReturnPct)) {
    return s.planCdReturnPct;
  }
  if (s.precatExpectedReturn != null && Number.isFinite(s.precatExpectedReturn)) {
    return s.precatExpectedReturn;
  }
  if (s.pred5 != null && Number.isFinite(s.pred5)) return s.pred5;
  return dealGainPctForSell(s);
}

/** Top 2 opportunities to add — not already in portfolio, best ROI/day. */
export function pickTop2BuyCandidates<T extends Top2PickSignal>(
  topSignals: T[],
  portfolioTickers?: Set<string>,
): T[] {
  const pool = topSignals.filter((s) => {
    if (isTickerInPortfolio(s, portfolioTickers)) return false;
    const ret = projectedMovePct(s);
    return ret > 0;
  });
  return [...pool]
    .sort((a, b) => {
      const rd = roiPerDayPct(b) - roiPerDayPct(a);
      if (Math.abs(rd) > 0.001) return rd;
      return dealGainPctForBuy(b) - dealGainPctForBuy(a);
    })
    .slice(0, 2);
}

/** Perdita P&L totale (stesso criterio del tab Simulation → P&L). */
export function isPortfolioPnlLoss(s: Top2PickSignal): boolean {
  return s.hasPosition && portfolioPnlTone(s.pnlEur, s.pnlPct) === "loss";
}

function sortWorstPnlPct<T extends Top2PickSignal>(a: T, b: T): number {
  const pnlA = a.pnlPct ?? 0;
  const pnlB = b.pnlPct ?? 0;
  if (Math.abs(pnlA - pnlB) > 0.01) return pnlA - pnlB;
  return (a.pnlEur ?? 0) - (b.pnlEur ?? 0);
}

/**
 * Top 2 portfolio exits — prima pendenza ↓ sostenuta (sell), poi in perdita P&L in attesa (hold).
 * Colore chip Piggy Bank allineato: 🐔 rosso = sell · ⏳ giallo = hold.
 */
export function pickTop2SellCandidates<T extends Top2PickSignal>(
  signals: T[],
  buyTickers: Set<string>,
): T[] {
  const eligible = (s: T) => s.hasPosition && !buyTickers.has(s.ticker);

  const declinePool = signals.filter((s) => eligible(s) && isSustainedDeclineSignal(s));
  const lossPool = signals.filter(
    (s) => eligible(s) && !isSustainedDeclineSignal(s) && isPortfolioPnlLoss(s),
  );

  const ordered = [
    ...[...declinePool].sort((a, b) => projectedMovePct(a) - projectedMovePct(b)),
    ...[...lossPool].sort(sortWorstPnlPct),
  ];

  const seen = new Set<string>();
  const out: T[] = [];
  for (const s of ordered) {
    const tk = s.ticker.trim().toUpperCase();
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    out.push(s);
    if (out.length >= 2) break;
  }
  return out;
}

export type WorstPortfolioReason =
  | "decline"
  | "negative_plan"
  | "negative_pnl"
  | "exit_verdict"
  | "precat_sell";

/** Posizione in portafoglio con outlook debole — candidata analisi exit (non in salita verso target). */
export function isPortfolioUnderperforming(s: Top2PickSignal): boolean {
  if (!s.hasPosition) return false;

  if (isPortfolioPnlLoss(s)) return true;

  const ctx = declineInputFromSignalLike(s);
  if (isCurveRisingForHold(ctx)) return false;

  if (isSustainedDeclineSignal(s)) return true;

  const move = projectedMovePct(s);
  if (move <= 0) return true;

  if (s.pnlPct != null && Number.isFinite(s.pnlPct) && s.pnlPct < -0.5) return true;

  if (s.stabilityVerdict === "exit" || s.stabilityVerdict === "avoid") return true;

  if (s.precatKind === "sell" || s.precatKind === "avoid") return true;

  return false;
}

export function worstPortfolioReasons(s: Top2PickSignal): WorstPortfolioReason[] {
  const out: WorstPortfolioReason[] = [];
  if (isPortfolioPnlLoss(s)) out.push("negative_pnl");
  if (isSustainedDeclineSignal(s)) out.push("decline");
  const move = projectedMovePct(s);
  if (move <= 0) out.push("negative_plan");
  if (s.stabilityVerdict === "exit" || s.stabilityVerdict === "avoid") {
    out.push("exit_verdict");
  }
  if (s.precatKind === "sell" || s.precatKind === "avoid") out.push("precat_sell");
  return out;
}

/** Tutte le posizioni portfolio in difficoltà — ordinate dal peggior outlook (exit analysis). */
export function pickWorstPortfolioCandidates<T extends Top2PickSignal>(
  signals: T[],
  buyTickers?: Set<string>,
): T[] {
  return signals
    .filter(
      (s) =>
        s.hasPosition &&
        !(buyTickers?.has(s.ticker) ?? false) &&
        isPortfolioUnderperforming(s),
    )
    .sort((a, b) => {
      const moveDiff = projectedMovePct(a) - projectedMovePct(b);
      if (Math.abs(moveDiff) > 0.01) return moveDiff;
      const pnlA = a.pnlPct ?? 0;
      const pnlB = b.pnlPct ?? 0;
      if (Math.abs(pnlA - pnlB) > 0.01) return pnlA - pnlB;
      return roiPerDayPct(a) - roiPerDayPct(b);
    });
}
