import {
  getTickerGainStars,
  isNewMaterialPriceMove,
  loadGainStarLedger,
  manualEventQualifiesForGainStarDay,
  tickerHasGainStar,
} from "./gainStarLedger";
import {
  filterManualEventsForLossPanel,
  resolveManualEventEis,
  resolveManualEventPriceMovePct,
  type ManualFeedEventDraft,
} from "./manualFeedEvents";

/** Positive manual EIS with a confirmed material catalyst. */
export function manualEventQualifiesForGainStar(draft: ManualFeedEventDraft): boolean {
  if (!manualEventQualifiesForGainStarDay(draft)) return false;
  return resolveManualEventEis(draft).score > 0;
}

/** @deprecated Use loadGainStarLedger keys */
export function loadManualGainStarTickers(): ReadonlySet<string> {
  return new Set(Object.keys(loadGainStarLedger()));
}

/** @deprecated Use tickerHasGainStar */
export function tickerHasManualGainStar(ticker: string): boolean {
  return tickerHasGainStar(ticker);
}

/** Saved 24h checklist row stays until a new material Var.24h move (same rule as ★ ledger). */
export function manualFeedEventStillAnchoredInLossPanel(
  event: ManualFeedEventDraft,
  currentMovePct24h: number | null | undefined,
): boolean {
  const anchor = resolveManualEventPriceMovePct(event);
  if (anchor == null || !Number.isFinite(anchor)) return true;
  if (currentMovePct24h == null || !Number.isFinite(currentMovePct24h)) return true;
  return !isNewMaterialPriceMove(anchor, currentMovePct24h);
}

function eventSortDate(ev: ManualFeedEventDraft): string {
  const d = String(ev.eventDate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return String(ev.createdAt ?? "").slice(0, 10);
}

/**
 * Var.24h anchor for a ticker — taken from the latest manual event that recorded a move.
 * All checklist rows for that ticker share this anchor.
 */
export function resolveTickerLossPanelAnchorPct(
  ticker: string,
  events: ManualFeedEventDraft[],
): number | null {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;
  let bestDate = "";
  let bestAnchor: number | null = null;
  for (const ev of events) {
    if (ev.ticker.trim().toUpperCase() !== tk) continue;
    const anchor = resolveManualEventPriceMovePct(ev);
    if (anchor == null || !Number.isFinite(anchor)) continue;
    const date = eventSortDate(ev);
    if (!date) continue;
    if (!bestDate || date >= bestDate) {
      bestDate = date;
      bestAnchor = anchor;
    }
  }
  return bestAnchor;
}

/** True while the ticker's latest anchored Var.24h still matches the sheet (one move clears all rows). */
export function isTickerStillAnchoredInLossPanel(
  ticker: string,
  events: ManualFeedEventDraft[],
  currentMovePct24h: number | null | undefined,
): boolean {
  const anchor = resolveTickerLossPanelAnchorPct(ticker, events);
  if (anchor == null) return true;
  if (currentMovePct24h == null || !Number.isFinite(currentMovePct24h)) return true;
  return !isNewMaterialPriceMove(anchor, currentMovePct24h);
}

/** Loss-panel checklist: not dismissed locally; ticker-level anchor — all rows drop on new move. */
export function filterManualFeedEventsForAnchoredLossPanel(
  events: ManualFeedEventDraft[],
  currentMovePctByTicker?: ReadonlyMap<string, number | null>,
): ManualFeedEventDraft[] {
  const visible = filterManualEventsForLossPanel(events);
  return visible.filter((ev) => {
    const tk = ev.ticker.trim().toUpperCase();
    if (!tk) return false;
    const current = currentMovePctByTicker?.get(tk) ?? null;
    const tickerAnchor = resolveTickerLossPanelAnchorPct(tk, visible);
    if (tickerAnchor != null) {
      return isTickerStillAnchoredInLossPanel(tk, visible, current);
    }
    return manualFeedEventStillAnchoredInLossPanel(ev, current);
  });
}

export { getTickerGainStars, tickerHasGainStar };
