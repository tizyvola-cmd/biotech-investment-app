/**
 * SELL error analysis (UI-side) — Fase A of the "Sells" tab in Model Quality.
 *
 * Two read-only, controfactual measures built on the early-weakness SELL signal
 * (`analyzeSellTiming`) and the open-position daily history:
 *
 *  - MANCATE VENDITE (missed sells): a position still OPEN where the early signal
 *    fired and the price then FELL within the horizon. We held instead of selling
 *    → gain-open eroded. Impact € ≈ capital × |forward move %|.
 *    This is a CONTROFACTUAL ESTIMATE (what holding cost us), not a closed fact.
 *
 *  - VENDITE PRECOCI SE SEGUITE (premature-if-followed): the signal fired but the
 *    price then ROSE → had we sold we would have left gain on the table. This is
 *    the false-positive cost of the signal, also a controfactual estimate.
 *
 * Honest data note (Phase 0): the portfolio history drops a ticker once it is
 * sold (byTicker value → 0), so the "vendita precoce REALE" on already-closed
 * exits (exit price → subsequent price) is NOT computable in-UI — it needs a
 * post-exit price series from the backend. This module measures only the
 * controfactual signal impact on still-open positions.
 */
import {
  analyzeSellTiming,
  type SellTimingAnalysis,
  type SellTimingParams,
} from "./recommendationSellTiming";
import type { InvestSimHistoryPoint, InvestSimInputEntry } from "./investSimStorage";

export type SellErrorKind = "missed" | "premature";

export type SellErrorRow = {
  key: string;
  ticker: string;
  kind: SellErrorKind;
  signalTs: string;
  /** Forward move (pp) after the signal day. Negative for missed, positive for premature. */
  forwardMovePct: number;
  capitalEur: number;
  /** € impact: gain-open eroded (missed) or gain that would be lost if followed (premature). */
  impactEur: number;
  leadDays: number | null;
};

export type SellErrorAnalysis = {
  available: boolean;
  /** Gain-open € eroded by NOT selling on a confirmed down signal (controfactual estimate). */
  missedSellErosionEur: number;
  missedSellCount: number;
  /** Gain € that would be lost if we had sold where price then rose (false-positive estimate). */
  prematureCostEur: number;
  prematureCount: number;
  rows: SellErrorRow[];
  /** Underlying early-weakness signal analysis (walk-forward P(down), lead time, params). */
  timing: SellTimingAnalysis;
};

function impactEur(capital: number, movePct: number): number {
  return Math.round(((capital * Math.abs(movePct)) / 100) * 100) / 100;
}

export function analyzeSellErrors(args: {
  history: InvestSimHistoryPoint[];
  inputs: Record<string, InvestSimInputEntry>;
  eisScoreForKey?: (ticker: string) => number | null;
  params?: Partial<SellTimingParams>;
}): SellErrorAnalysis {
  const timing = analyzeSellTiming(args);

  const rows: SellErrorRow[] = [];
  for (const sig of timing.signals) {
    const capital = args.inputs[sig.key]?.capital ?? 0;
    // Only still-open positions with real deployed capital (closed rows have capital 0).
    if (!(capital > 0)) continue;
    if (sig.forwardMovePct == null) continue;

    if (sig.result === "down") {
      rows.push({
        key: sig.key,
        ticker: sig.ticker,
        kind: "missed",
        signalTs: sig.signalTs,
        forwardMovePct: sig.forwardMovePct,
        capitalEur: capital,
        impactEur: impactEur(capital, sig.forwardMovePct),
        leadDays: sig.leadDays,
      });
    } else if (sig.result === "up") {
      rows.push({
        key: sig.key,
        ticker: sig.ticker,
        kind: "premature",
        signalTs: sig.signalTs,
        forwardMovePct: sig.forwardMovePct,
        capitalEur: capital,
        impactEur: impactEur(capital, sig.forwardMovePct),
        leadDays: sig.leadDays,
      });
    }
  }

  const missed = rows.filter((r) => r.kind === "missed");
  const premature = rows.filter((r) => r.kind === "premature");
  const missedSellErosionEur =
    Math.round(missed.reduce((s, r) => s + r.impactEur, 0) * 100) / 100;
  const prematureCostEur =
    Math.round(premature.reduce((s, r) => s + r.impactEur, 0) * 100) / 100;

  rows.sort((a, b) => b.impactEur - a.impactEur);

  return {
    available: rows.length > 0,
    missedSellErosionEur,
    missedSellCount: missed.length,
    prematureCostEur,
    prematureCount: premature.length,
    rows,
    timing,
  };
}

// ── Section B — acceptance of a SELL/BUY recommendation (current snapshot) ──────

export type AcceptanceCandidate = {
  ticker: string;
  suggestedAction: string | null;
  sds: number | null;
  pplanPct: number | null;
};

export type AcceptanceReason =
  | "accepted"
  | "notBuy"
  | "belowPplan"
  | "belowSds"
  | "unknown";

export type AcceptanceBreakdown = {
  total: number;
  accepted: number;
  rejected: number;
  byReason: Record<AcceptanceReason, number>;
  /** Thresholds in effect (for the UI legend). */
  minPplanPct: number;
  minSds: number;
};

/**
 * Classify each candidate row against the sim-loop acceptance thresholds.
 * Pure: the caller extracts {suggestedAction, sds, pplan} from the sheet rows.
 * Same gate applies to the synth sim loop (it differs only in capital sizing).
 */
export function buildAcceptanceBreakdown(
  candidates: AcceptanceCandidate[],
  opts: { minPplanPct: number; minSds: number },
): AcceptanceBreakdown {
  const byReason: Record<AcceptanceReason, number> = {
    accepted: 0,
    notBuy: 0,
    belowPplan: 0,
    belowSds: 0,
    unknown: 0,
  };

  for (const c of candidates) {
    if ((c.suggestedAction ?? "").toLowerCase() !== "buy") {
      byReason.notBuy += 1;
      continue;
    }
    if (opts.minSds > 0 && c.sds == null) {
      byReason.unknown += 1;
      continue;
    }
    if (opts.minSds > 0 && c.sds != null && c.sds < opts.minSds) {
      byReason.belowSds += 1;
      continue;
    }
    if (opts.minPplanPct > 0 && c.pplanPct == null) {
      byReason.unknown += 1;
      continue;
    }
    if (opts.minPplanPct > 0 && c.pplanPct != null && c.pplanPct < opts.minPplanPct) {
      byReason.belowPplan += 1;
      continue;
    }
    byReason.accepted += 1;
  }

  const total = candidates.length;
  const accepted = byReason.accepted;
  return {
    total,
    accepted,
    rejected: total - accepted,
    byReason,
    minPplanPct: opts.minPplanPct,
    minSds: opts.minSds,
  };
}
