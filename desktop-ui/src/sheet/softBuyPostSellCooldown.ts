/**
 * Soft BUY must not flip to BUY on a name just sold from the real book.
 * Avoids immediate re-buy churn (e.g. sell NRIX → Suggested BUY NRIX same session).
 */
import type { InvestSimInputs } from "./investSimStorage";
import { latestBookSoldAtIso } from "./simulationPosition";

export { latestBookSoldAtIso };

/** Wall-clock cooldown after ignoreSheet+soldAt before Soft BUY can re-propose. */
export const SOFT_BUY_POST_SELL_COOLDOWN_DAYS = 5;

export function isSoftBuyBlockedByRecentSell(
  soldAtIso: string | null | undefined,
  now: Date = new Date(),
  cooldownDays: number = SOFT_BUY_POST_SELL_COOLDOWN_DAYS,
): boolean {
  if (!soldAtIso?.trim() || cooldownDays <= 0) return false;
  const soldMs = Date.parse(soldAtIso);
  if (!Number.isFinite(soldMs)) return false;
  const elapsedMs = now.getTime() - soldMs;
  if (elapsedMs < 0) return true;
  return elapsedMs < cooldownDays * 24 * 60 * 60 * 1000;
}

export function softBuyBlockedByBookSell(
  inputs: InvestSimInputs | null | undefined,
  opts: { key: string; ticker: string },
  now: Date = new Date(),
): boolean {
  return isSoftBuyBlockedByRecentSell(
    latestBookSoldAtIso(inputs, opts),
    now,
  );
}
