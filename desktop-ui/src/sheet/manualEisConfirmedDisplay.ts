/**
 * Manual EIS column — latest saved manual feed row per ticker.
 * Positive: green + ★ · negative: red, no icon · na when no manual news / neutral EIS.
 */
import {
  loadManualFeedEvents,
  resolveManualEventEis,
  type ManualFeedEventDraft,
} from "./manualFeedEvents";
import {
  gainStarStillAnchored,
  getTickerGainStars,
  refreshGainStarLedger,
  resolveManualInvestigationContext,
} from "./gainStarLedger";

export type ManualEisConfirmedDisplay = {
  score: number;
  /** Gold ★ on positive manual EIS (gain or recovery thesis). */
  showStar: boolean;
  polarity: "positive" | "negative";
  context: "loss" | "gain";
};

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function normalizeEventDate(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

/** Most recent manual feed event for ticker (by event date, then createdAt). */
function latestManualFeedDraftForTicker(ticker: string): ManualFeedEventDraft | null {
  const tk = normalizeTicker(ticker);
  if (!tk) return null;
  let best: ManualFeedEventDraft | null = null;
  let bestDate = "";
  let bestCreated = "";

  for (const draft of loadManualFeedEvents()) {
    if (normalizeTicker(draft.ticker) !== tk) continue;
    const rawDate = normalizeEventDate(draft.eventDate);
    if (!rawDate) continue;
    if (
      !best ||
      rawDate > bestDate ||
      (rawDate === bestDate && draft.createdAt > bestCreated)
    ) {
      best = draft;
      bestDate = rawDate;
      bestCreated = draft.createdAt;
    }
  }
  return best;
}

/** Latest manual EIS for ticker, or null when no saved manual news / neutral score. */
export function resolveManualEisConfirmedDisplay(
  ticker: string,
  currentMovePct24h?: number | null,
): ManualEisConfirmedDisplay | null {
  refreshGainStarLedger();
  const draft = latestManualFeedDraftForTicker(ticker);
  if (!draft) return null;

  const score = resolveManualEventEis(draft).score;
  if (!Number.isFinite(score) || score === 0) return null;

  const resolvedContext = resolveManualInvestigationContext(draft);
  const context: "loss" | "gain" =
    resolvedContext ?? (score > 0 ? "gain" : "loss");

  const stars = getTickerGainStars(ticker, currentMovePct24h);
  const showStar =
    score > 0 &&
    (stars.length === 0 ||
      gainStarStillAnchored(stars[0]!, currentMovePct24h));

  return {
    score,
    showStar,
    polarity: score > 0 ? "positive" : "negative",
    context,
  };
}

export function formatManualEisConfirmedScore(score: number): string {
  return `${score >= 0 ? "+" : ""}${Math.round(score)}`;
}
