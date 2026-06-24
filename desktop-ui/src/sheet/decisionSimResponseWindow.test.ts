import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  DECISION_SIM_RESPONSE_DELAY_MS,
  isPendingSimTradeDue,
  stagePendingSimTrades,
  tradesSignature,
  clearPendingSimTradeBatch,
} from "./decisionSimResponseWindow";
import type { PaperTradeEvent } from "./investDecisionSimLoop";

const buyTrade = (key: string): PaperTradeEvent => ({
  at: "2026-06-19T13:00:00.000Z",
  ticker: key.split("|")[0] ?? key,
  key,
  side: "buy",
  reason: "test",
  capital: 5000,
  pnlPctSimulated: null,
  pnlEurSimulated: null,
});

describe("decisionSimResponseWindow", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map();
    const localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
    (globalThis as { window?: { localStorage: typeof localStorage } }).window = { localStorage };
    clearPendingSimTradeBatch();
  });

  afterEach(() => {
    clearPendingSimTradeBatch();
  });
  it("stages trades with 10-minute execution delay", () => {
    const detectedAt = new Date(Date.now() + 60_000).toISOString();
    const batch = stagePendingSimTrades([buyTrade("AAA|2026-09-01")], detectedAt);
    expect(batch).not.toBeNull();
    expect(batch!.executeAfter).toBe(
      new Date(Date.parse(detectedAt) + DECISION_SIM_RESPONSE_DELAY_MS).toISOString(),
    );
    expect(isPendingSimTradeDue(batch!, new Date(Date.parse(detectedAt) + 9 * 60_000))).toBe(false);
    expect(isPendingSimTradeDue(batch!, new Date(Date.parse(detectedAt) + 11 * 60_000))).toBe(true);
  });

  it("dedupes identical trade signatures while pending", () => {
    const detectedAt = new Date(Date.now() + 60_000).toISOString();
    const trades = [buyTrade("AAA|2026-09-01")];
    const sig = tradesSignature(trades);
    const first = stagePendingSimTrades(trades, detectedAt);
    const second = stagePendingSimTrades(trades, new Date(Date.parse(detectedAt) + 5 * 60_000).toISOString());
    expect(first?.tradeSig).toBe(sig);
    expect(second?.tradeSig).toBe(sig);
    expect(second?.executeAfter).toBe(first?.executeAfter);
  });
});
