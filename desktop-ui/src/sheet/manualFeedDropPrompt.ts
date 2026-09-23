import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";
import { loadManualFeedEvents } from "./manualFeedEvents";

const PROMPT_DISMISS_KEY = "biotech.manual_news_prompt_dismissed.v1";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Min |Var. giorn. %| to appear in Manual news — EIS checklist (loss & gain).
 *  Uses the daily close-vs-prior-close reading (`pnlPct24h`). Tickers moving
 *  by more than this threshold in either direction are surfaced for manual
 *  EIS scoring in the Decision Chart tab. */
export const MANUAL_NEWS_DAILY_MOVE_THRESHOLD_PCT = 4;

const DAILY_MOVE_THRESHOLD_PCT = MANUAL_NEWS_DAILY_MOVE_THRESHOLD_PCT;

/** Daily close below prior close (Var. giorn. %) — manual loss research. */
export function stockNeedsManualNewsInvestigation(item: PortfolioLossAnalysisItem): boolean {
  return (
    item.pnlPct24h != null &&
    Number.isFinite(item.pnlPct24h) &&
    item.pnlPct24h < -DAILY_MOVE_THRESHOLD_PCT
  );
}

/** Daily close above prior close (Var. giorn. %) — manual gain / catalyst research. */
export function stockNeedsManualGainInvestigation(item: PortfolioLossAnalysisItem): boolean {
  return (
    item.pnlPct24h != null &&
    Number.isFinite(item.pnlPct24h) &&
    item.pnlPct24h > DAILY_MOVE_THRESHOLD_PCT
  );
}

/** Any saved manual news for this ticker (Feed tab or 24h card). */
export function tickerHasManualNews(ticker: string): boolean {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return false;
  return loadManualFeedEvents().some((ev) => ev.ticker.trim().toUpperCase() === tk);
}

export function tickerHasRecentManualNews(
  ticker: string,
  withinDays = 14,
  now = Date.now(),
): boolean {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return false;
  const cutoff = now - withinDays * 86_400_000;
  for (const ev of loadManualFeedEvents()) {
    if (ev.ticker.trim().toUpperCase() !== tk) continue;
    const ts = new Date(`${ev.eventDate}T12:00:00`).getTime();
    if (Number.isFinite(ts) && ts >= cutoff) return true;
    const created = new Date(ev.createdAt).getTime();
    if (Number.isFinite(created) && created >= cutoff) return true;
  }
  return false;
}

export function isManualNewsPromptDismissed(ticker: string, day = todayKey()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(PROMPT_DISMISS_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed[`${ticker.trim().toUpperCase()}|${day}`] === true;
  } catch {
    return false;
  }
}

export function dismissManualNewsPrompt(ticker: string, day = todayKey()): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(PROMPT_DISMISS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    parsed[`${ticker.trim().toUpperCase()}|${day}`] = true;
    localStorage.setItem(PROMPT_DISMISS_KEY, JSON.stringify(parsed));
  } catch {
    /* quota */
  }
}

export function showManualNewsInvestigationLink(item: PortfolioLossAnalysisItem): boolean {
  if (!stockNeedsManualNewsInvestigation(item)) return false;
  return !tickerHasManualNews(item.ticker);
}

export function showManualGainNewsInvestigationLink(item: PortfolioLossAnalysisItem): boolean {
  if (!stockNeedsManualGainInvestigation(item)) return false;
  return !tickerHasManualNews(item.ticker);
}

function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

/** Manual news no longer needed — stock recovered or left the loss watch list. */
export function tickerManualNewsObsolete(
  ticker: string,
  items: PortfolioLossAnalysisItem[],
): boolean {
  const tk = normalizeTicker(ticker);
  if (!tk) return true;
  const item = items.find((i) => normalizeTicker(i.ticker) === tk);
  if (!item) return true;
  return !stockNeedsManualNewsInvestigation(item);
}

/** Tickers with saved manual news that are no longer in loss / rising again. */
export function listRecoveredManualNewsTickers(
  items: PortfolioLossAnalysisItem[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ev of loadManualFeedEvents()) {
    const tk = normalizeTicker(ev.ticker);
    if (!tk || seen.has(tk)) continue;
    if (tickerManualNewsObsolete(tk, items)) {
      seen.add(tk);
      out.push(tk);
    }
  }
  return out;
}

/**
 * Previously auto-deleted manual feed when a stock left the loss watch list.
 * User-entered manual EIS must persist — no automatic purge.
 */
export function purgeRecoveredManualFeedEvents(
  _items: PortfolioLossAnalysisItem[],
): string[] {
  return [];
}

export function shouldPromptManualNewsForDrop(item: PortfolioLossAnalysisItem): boolean {
  if (!stockNeedsManualNewsInvestigation(item)) return false;
  const tk = item.ticker.trim().toUpperCase();
  if (!tk) return false;
  if (isManualNewsPromptDismissed(tk)) return false;
  if (tickerHasManualNews(tk)) return false;
  return true;
}

export function buildManualNewsTemplate(ticker: string, lang: "it" | "en"): string {
  const tk = ticker.trim().toUpperCase();
  const today = todayKey();
  if (lang === "it") {
    return `TICKER: ${tk}\nDATA: ${today}\nFONTE: \nNEWS: `;
  }
  return `TICKER: ${tk}\nDATE: ${today}\nSOURCE: \nNEWS: `;
}

/** Pre-filled block when external research finds no catalyst for the drop. */
export function buildNoCatalystManualNewsTemplate(
  ticker: string,
  priceDropPct: number | null,
  lang: "it" | "en",
): string {
  const tk = ticker.trim().toUpperCase();
  const today = todayKey();
  const drop =
    priceDropPct != null && Number.isFinite(priceDropPct)
      ? `${priceDropPct >= 0 ? "+" : ""}${priceDropPct.toFixed(1)}`
      : "";
  if (lang === "it") {
    return `TICKER: ${tk}
DATA: ${today}
RISULTATO: no_catalyst
VAR_24H: ${drop}%
FONTE: Ricerca manuale
NEWS: Nessuna news materiale trovata — probabile oscillazione di mercato / settore.`;
  }
  return `TICKER: ${tk}
DATE: ${today}
OUTCOME: no_catalyst
VAR_24H: ${drop}%
SOURCE: Manual research
NEWS: No material news found — likely broad market / sector oscillation.`;
}

/** Pre-filled block when external research confirms a material positive catalyst. */
export function buildPositiveCatalystManualNewsTemplate(
  ticker: string,
  priceGainPct: number | null,
  lang: "it" | "en",
): string {
  const tk = ticker.trim().toUpperCase();
  const today = todayKey();
  const gain =
    priceGainPct != null && Number.isFinite(priceGainPct)
      ? `${priceGainPct >= 0 ? "+" : ""}${priceGainPct.toFixed(1)}`
      : "";
  if (lang === "it") {
    return `TICKER: ${tk}
DATA: ${today}
RISULTATO: positive_catalyst
VAR_24H: ${gain}%
FONTE: 
NEWS: `;
  }
  return `TICKER: ${tk}
DATE: ${today}
OUTCOME: positive_catalyst
VAR_24H: ${gain}%
SOURCE: 
NEWS: `;
}

export function buildNegativeCatalystManualNewsTemplate(
  ticker: string,
  priceDropPct: number | null,
  lang: "it" | "en",
): string {
  const tk = ticker.trim().toUpperCase();
  const today = todayKey();
  const drop =
    priceDropPct != null && Number.isFinite(priceDropPct)
      ? `${priceDropPct >= 0 ? "+" : ""}${priceDropPct.toFixed(1)}`
      : "";
  if (lang === "it") {
    return `TICKER: ${tk}
DATA: ${today}
RISULTATO: negative_catalyst
VAR_24H: ${drop}%
FONTE: 
NEWS: `;
  }
  return `TICKER: ${tk}
DATE: ${today}
OUTCOME: negative_catalyst
VAR_24H: ${drop}%
SOURCE: 
NEWS: `;
}

/**
 * Rich Claude-research template — structured tags feed EIS + residual attribution memory.
 * Fill after investigating catalyst vs noise vs geo; paste back into Manual EIS.
 */
export function buildResearchManualNewsTemplate(
  ticker: string,
  priceMovePct: number | null,
  lang: "it" | "en",
): string {
  const tk = ticker.trim().toUpperCase();
  const today = todayKey();
  const move =
    priceMovePct != null && Number.isFinite(priceMovePct)
      ? `${priceMovePct >= 0 ? "+" : ""}${priceMovePct.toFixed(1)}`
      : "";
  const ctx = priceMovePct != null && priceMovePct < 0 ? "loss" : "gain";
  if (lang === "it") {
    return `TICKER: ${tk}
DATA: ${today}
RISULTATO: 
VAR_24H: ${move}%
SENTIMENTO: 
FONTE: Ricerca manuale
LINK: 
NEWS: 
---
MOVE_CONTEXT: ${ctx}
PEER_XBI_SAME_DAY: 
VOLUME_NOTE: 

CAUSE_CLASS: 
CONFIDENCE: 
EXPLAINS_MOVE: 
HOLDER_LENS: legacy_common
DILUTION_PCT: 
PRICE_VERIFIED: no
VOLUME_NOTE: 

EVENT_SUBTYPE: 
DRUG_OR_ASSET: 
NCT_OR_FILING: 
EVENT_TIME_VS_MOVE: 

WHAT_HAPPENED: 

WHY_PRICE_MOVED: 

COUNTER_EVIDENCE: 

GEOPOLITICAL_OR_MACRO: none

SOURCES_CHECKED:
- 

LEARNING_TAG: 

SCORE_TARGETS:
  EIS: 
  RESIDUAL: market|company|mixed
  P_PLAN_VIA_EIS: 
  DECISION_CHART: 
  GAIN_STAR: 
  NOTE: Resilience/SDS non sovrascritti — solo contesto causa
`;
  }
  return `TICKER: ${tk}
DATE: ${today}
OUTCOME: 
VAR_24H: ${move}%
SENTIMENT: 
SOURCE: Manual research
LINK: 
NEWS: 
---
MOVE_CONTEXT: ${ctx}
PEER_XBI_SAME_DAY: 
VOLUME_NOTE: 

CAUSE_CLASS: company_catalyst|sector_peer|market_noise|macro_geopolitical|liquidity_technical|mixed_unclear
CONFIDENCE: high|medium|low
EXPLAINS_MOVE: full|partial|none
HOLDER_LENS: legacy_common|combined_entity|new_money
DILUTION_PCT: 
PRICE_VERIFIED: yes|no
VOLUME_NOTE: normal|elevated|thin|unknown

EVENT_SUBTYPE: clinical|regulatory|financing|mna|analyst|lawsuit|macro_geo|sector_rotation|none
DRUG_OR_ASSET: 
NCT_OR_FILING: 
EVENT_TIME_VS_MOVE: same_day|prior_day|within_3d|stale|unknown

WHAT_HAPPENED: 

WHY_PRICE_MOVED: 

COUNTER_EVIDENCE: 

GEOPOLITICAL_OR_MACRO: none

SOURCES_CHECKED:
- 

LEARNING_TAG: 

SCORE_TARGETS:
  EIS: 
  RESIDUAL: market|company|mixed
  P_PLAN_VIA_EIS: up|down|neutral
  DECISION_CHART: 
  GAIN_STAR: yes|no
  NOTE: Resilience/SDS scores are NOT overwritten — cause context only
`;
}
