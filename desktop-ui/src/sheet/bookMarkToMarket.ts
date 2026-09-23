/** P&L from the book the user typed: shares = capital ÷ buy, MTM = shares × live. */
export function bookMarkToMarket(
  book: { capital?: number; buyPrice?: number } | null | undefined,
  livePriceUsd: number | null | undefined,
): { pnlEur: number; pnlPct: number; valueNow: number; shares: number } | null {
  const capital = book?.capital ?? 0;
  const buyPrice = book?.buyPrice ?? 0;
  const curr = livePriceUsd ?? 0;
  if (!(capital > 0) || !(buyPrice > 0) || !(curr > 0)) return null;
  const shares = capital / buyPrice;
  const valueNow = Math.round(shares * curr * 100) / 100;
  const pnlEur = Math.round((valueNow - capital) * 100) / 100;
  const pnlPct = Math.round(((curr - buyPrice) / buyPrice) * 10000) / 100;
  return { pnlEur, pnlPct, valueNow, shares };
}
