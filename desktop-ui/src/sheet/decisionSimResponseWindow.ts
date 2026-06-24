/**
 * Sim loop response window — market event first, then delayed BUY/SELL execution.
 *
 * Flow:
 * 1. Price / signal pass → re-mark open MTM, stage proposed trades, popup immediately.
 * 2. After DECISION_SIM_RESPONSE_DELAY_MS → execute staged trades (auto tick only).
 */
import type { PaperPosition, PaperTradeEvent, TickerSimEvaluation } from "./investDecisionSimLoop";
import { simulatePaperTrades } from "./investDecisionSimLoop";

export const DECISION_SIM_RESPONSE_DELAY_MS = 10 * 60 * 1000;
const PENDING_STORAGE_KEY = "dashboard.simLoop.pendingTrades.v1";

export type PendingSimTradeBatch = {
  detectedAt: string;
  executeAfter: string;
  tradeSig: string;
  trades: PaperTradeEvent[];
};

export function tradesSignature(trades: PaperTradeEvent[]): string {
  return [...trades]
    .filter((t) => t.side === "buy" || t.side === "sell")
    .map((t) => `${t.side}:${t.key}`)
    .sort()
    .join("|");
}

export function loadPendingSimTradeBatch(): PendingSimTradeBatch | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSimTradeBatch;
    if (!parsed?.detectedAt || !parsed?.executeAfter || !Array.isArray(parsed.trades)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function savePendingSimTradeBatch(batch: PendingSimTradeBatch | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!batch) {
      window.localStorage.removeItem(PENDING_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(batch));
  } catch {
    /* quota / privacy */
  }
}

export function clearPendingSimTradeBatch(): void {
  savePendingSimTradeBatch(null);
}

export function isPendingSimTradeDue(
  batch: PendingSimTradeBatch | null,
  at: Date = new Date(),
): boolean {
  if (!batch?.executeAfter) return false;
  const dueMs = Date.parse(batch.executeAfter);
  return Number.isFinite(dueMs) && at.getTime() >= dueMs;
}

export function stagePendingSimTrades(
  trades: PaperTradeEvent[],
  detectedAt: string = new Date().toISOString(),
): PendingSimTradeBatch | null {
  const actionable = trades.filter((t) => t.side === "buy" || t.side === "sell");
  if (!actionable.length) {
    clearPendingSimTradeBatch();
    return null;
  }
  const sig = tradesSignature(actionable);
  const existing = loadPendingSimTradeBatch();
  if (existing?.tradeSig === sig && !isPendingSimTradeDue(existing)) {
    return existing;
  }
  const batch: PendingSimTradeBatch = {
    detectedAt,
    executeAfter: new Date(Date.parse(detectedAt) + DECISION_SIM_RESPONSE_DELAY_MS).toISOString(),
    tradeSig: sig,
    trades: actionable,
  };
  savePendingSimTradeBatch(batch);
  return batch;
}

/** Build preview trades without mutating portfolio (same rules as simulatePaperTrades). */
export function previewDecisionSimTrades(
  evaluations: TickerSimEvaluation[],
  portfolio: PaperPosition[],
  at: string,
  capitalPerTrade: number,
  maxOpenPositions: number,
  opts?: { resolveBuyCapital?: (ev: TickerSimEvaluation) => number },
): PaperTradeEvent[] {
  return simulatePaperTrades(
    evaluations,
    portfolio,
    at,
    capitalPerTrade,
    maxOpenPositions,
    opts,
  ).trades;
}
