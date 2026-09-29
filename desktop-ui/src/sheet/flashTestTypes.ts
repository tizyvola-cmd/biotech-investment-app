/**
 * Flash Test — parallel auto-books for Soft Logic Gen 0…4.
 * Independent of the live Soft Soft REC (Home / Pulse).
 */
import type { PaperPosition, PaperTradeEvent } from "./investDecisionSimLoop";

export type SoftLogicGenId = 0 | 1 | 2 | 3 | 4;

export const FLASH_TEST_GENS: SoftLogicGenId[] = [0, 1, 2, 3, 4];

export type FlashTestTrade = PaperTradeEvent & {
  gen: SoftLogicGenId;
};

export type FlashTestEquityPoint = {
  ts: string;
  /** Realized closed P&L €. */
  closedPnlEur: number;
  /** Open MTM €. */
  openMtmEur: number;
  /** closed + open. */
  totalPnlEur: number;
  /** Sum of open position capitals. */
  openCapitalEur: number;
  /** totalPnl / bankroll × 100. */
  pnlPctOnBankroll: number;
};

/** Soft BUY/SELL candidates from the last tick (before capital / slot filters). */
export type FlashTestSignalRow = {
  key: string;
  ticker: string;
  side: "buy" | "sell";
  priority: number;
  reason: string;
};

/** Soft BUY near-miss counts from the last tick (why lists stayed empty). */
export type FlashTestMissCounts = Record<string, number>;

export type FlashTestArmState = {
  gen: SoftLogicGenId;
  portfolio: PaperPosition[];
  trades: FlashTestTrade[];
  equity: FlashTestEquityPoint[];
  cumulativeClosedPnlEur: number;
  closedTradeCount: number;
  /** Peak open MTM € per key (Gen 4 giveback). */
  peakPnlByKey: Record<string, number>;
  /** Last tick Soft BUY/SELL lists for this Gen (transparency). */
  lastTickSignals: FlashTestSignalRow[];
  /** Last tick Soft BUY miss reasons (SDS/P/Top2/↑…). */
  lastTickMissCounts: FlashTestMissCounts;
};

export type FlashTestState = {
  version: 1;
  enabled: boolean;
  startedAt: string | null;
  endsAt: string | null;
  capitalPerTrade: number;
  /** Denominator for % curves (same for all arms). */
  bankrollEur: number;
  maxOpenPositions: number;
  arms: Record<SoftLogicGenId, FlashTestArmState>;
  lastTickAt: string | null;
};

export const FLASH_TEST_DEFAULT_CAPITAL = 5000;
export const FLASH_TEST_DEFAULT_BANKROLL = 50_000;
export const FLASH_TEST_RUN_DAYS = 7;
export const FLASH_TEST_TRADES_MAX = 800;
export const FLASH_TEST_EQUITY_MAX = 400;
/** Auto-loop while the experiment is Running (app open). */
export const FLASH_TEST_AUTO_TICK_MS = 3 * 60 * 1000;
/** Mark-only equity refresh (no new trades) — keeps Breakeven curves alive. */
export const FLASH_TEST_MARK_MS = 60 * 1000;
export const FLASH_TEST_SIGNALS_MAX = 40;
