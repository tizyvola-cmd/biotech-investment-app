/**
 * Pattern match state tracker for open paper positions.
 *
 * Phase 1 — updatePatternMatchState:
 *   Each tick, records whether an open position currently matches the approved
 *   risk pattern and when the current uninterrupted match run started.
 *   Option B: matchStartAt resets whenever the match breaks (position stops
 *   matching, or the approved pattern is replaced with a different one).
 *
 * Phase 2 — recordTradeLeadTimes:
 *   At SELL time, reads the match state (before it clears the sold position)
 *   and appends a lead-time record to invest_trade_lead_times_v1.
 */
import type { SheetTable } from "../types";
import type { PaperPosition, PaperTradeEvent } from "../sheet/investDecisionSimLoop";
import { buildSimRowByKeyMap } from "../sheet/investSimKeys";
import { extractFeaturesForOpenDeals } from "./lossRiskScreening";
import { matchPattern } from "./lossRiskPattern";
import { loadApprovedPattern } from "./patternProposalStore";

// ── Phase 1 ───────────────────────────────────────────────────────────────────

const MATCH_STATE_KEY = "invest_pattern_match_state_v1";

export type PositionPatternMatch = {
  patternId: string;
  /** ISO timestamp — start of the current uninterrupted match run. */
  matchStartAt: string;
};

/** Keyed by position rowKey. Only contains positions that currently match. */
export type PatternMatchStateMap = Record<string, PositionPatternMatch>;

export function loadPatternMatchState(): PatternMatchStateMap {
  try {
    const raw =
      typeof window !== "undefined"
        ? window.localStorage.getItem(MATCH_STATE_KEY)
        : null;
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as PatternMatchStateMap) : {};
  } catch {
    return {};
  }
}

function savePatternMatchState(state: PatternMatchStateMap): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MATCH_STATE_KEY, JSON.stringify(state));
    }
  } catch {
    /* localStorage full or unavailable */
  }
}

/**
 * Called at each decision-sim tick after portfolioAfter is known.
 * MUST be called AFTER recordTradeLeadTimes so sold positions are still in
 * the state when Phase 2 reads it.
 */
export function updatePatternMatchState(
  portfolioAfter: PaperPosition[],
  tickAt: string,
  simTable: SheetTable | null,
): PatternMatchStateMap {
  const { current: pattern } = loadApprovedPattern();
  const prev = loadPatternMatchState();
  const next: PatternMatchStateMap = {};

  if (pattern && portfolioAfter.length > 0) {
    const simRowByKey = buildSimRowByKeyMap(simTable?.rows ?? []);
    const deals = portfolioAfter.map((pos) => ({
      rowKey: pos.key,
      ticker: pos.ticker,
      cells: (simRowByKey.get(pos.key) ?? {}) as Record<string, string>,
    }));
    const featuresMap = extractFeaturesForOpenDeals(deals, { simTable });

    for (const pos of portfolioAfter) {
      const features = featuresMap.get(pos.key);
      if (!features || !matchPattern(pattern, features)) continue;

      const existing = prev[pos.key];
      next[pos.key] = {
        patternId: pattern.id,
        matchStartAt:
          existing?.patternId === pattern.id ? existing.matchStartAt : tickAt,
      };
    }
  }

  savePatternMatchState(next);
  return next;
}

// ── Phase 2 ───────────────────────────────────────────────────────────────────

const LEAD_TIME_KEY = "invest_trade_lead_times_v1";

export type TradePatternLeadTime = {
  /** Dedup key — composite of closedAt + rowKey. */
  tradeId: string;
  rowKey: string;
  ticker: string;
  patternId: string;
  matchStartAt: string;
  closedAt: string;
  leadTimeMs: number;
  leadTimeHours: number;
  capital: number;
  pnlEurSimulated: number | null;
  pnlPctSimulated: number | null;
};

export function loadTradeLeadTimes(): TradePatternLeadTime[] {
  try {
    const raw =
      typeof window !== "undefined"
        ? window.localStorage.getItem(LEAD_TIME_KEY)
        : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TradePatternLeadTime[]) : [];
  } catch {
    return [];
  }
}

function saveTradeLeadTimes(records: TradePatternLeadTime[]): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LEAD_TIME_KEY, JSON.stringify(records));
    }
  } catch {
    /* localStorage full or unavailable */
  }
}

/**
 * Called after simulatePaperTrades, BEFORE updatePatternMatchState.
 *
 * For each SELL trade whose rowKey is currently in the match state, computes
 * the lead-time (how long before closure the position had been continuously
 * matching the approved pattern) and appends a record to LEAD_TIME_KEY.
 *
 * Returns only the newly appended records (empty array when no matched sells).
 */
export function recordTradeLeadTimes(
  trades: PaperTradeEvent[],
  tickAt: string,
): TradePatternLeadTime[] {
  const sells = trades.filter((t) => t.side === "sell");
  if (sells.length === 0) return [];

  const matchState = loadPatternMatchState();
  const newRecords: TradePatternLeadTime[] = [];

  for (const trade of sells) {
    const match = matchState[trade.key];
    if (!match) continue;

    const closedAt = trade.at || tickAt;
    const leadTimeMs =
      new Date(closedAt).getTime() - new Date(match.matchStartAt).getTime();
    if (!Number.isFinite(leadTimeMs) || leadTimeMs < 0) continue;

    newRecords.push({
      tradeId: `${closedAt}|${trade.key}`,
      rowKey: trade.key,
      ticker: trade.ticker,
      patternId: match.patternId,
      matchStartAt: match.matchStartAt,
      closedAt,
      leadTimeMs,
      leadTimeHours: Math.round((leadTimeMs / 3_600_000) * 10) / 10,
      capital: trade.capital,
      pnlEurSimulated: trade.pnlEurSimulated,
      pnlPctSimulated: trade.pnlPctSimulated,
    });
  }

  if (newRecords.length > 0) {
    const existing = loadTradeLeadTimes();
    const seen = new Set(existing.map((r) => r.tradeId));
    const toAppend = newRecords.filter((r) => !seen.has(r.tradeId));
    if (toAppend.length > 0) {
      saveTradeLeadTimes([...existing, ...toAppend]);
    }
  }

  return newRecords;
}
