/**
 * User-entered clinical news (Feed tab) — persisted locally and merged into
 * the clinical pre-CD snapshot for EIS scoring + 24h / decision chart propagation.
 */
import type {
  ClinicalPreCdRecord,
  ClinicalPublicationEvent,
  ClinicalStudyIndicator,
} from "../api/supernova";
import { computeEis, resolveEventEis, resolvePrimaryEisScore, type EisBreakdown } from "./eventImpactScore";
import { isClinicalPreCdRecordTrusted } from "./referenceVerification";
import {
  buildManualAttributionMemory,
  memoryEisMultiplier,
} from "./manualAttributionMemory";
import {
  applyManualAttributionToEis,
  formatAttributionImpactNote,
  hasManualMoveAttribution,
  investigationOutcomeFromCauseClass,
  mergeManualMoveAttribution,
  parseManualMoveAttribution,
  type ManualMoveAttribution,
} from "./manualMoveAttribution";
import {
  enrichManualAttributionFromResearch,
  extractResearchEventDate,
  extractResearchEventTitle,
  isMildStructuredFinancingResearch,
  refineOutcomeFromResearchProse,
  researchPriceUnverified,
} from "./manualResearchEnrichment";
import {
  classifyManualNewsEisKind,
  scoreManualNewsIntrinsic,
  type ManualNewsEisKind,
} from "./manualNewsEis";

export type { ManualNewsEisKind };

export const MANUAL_FEED_EVENTS_STORAGE_KEY = "biotech.manual_feed_events.v1";
export const MANUAL_FEED_EVENTS_CHANGED_EVENT = "supernova:manual-feed-events-changed";
/** Ids hidden from the 24h loss-analysis temporary list only (feed/EIS unchanged). */
export const MANUAL_FEED_LOSS_PANEL_DISMISSED_KEY = "biotech.manual_feed_loss_panel_dismissed.v1";
export const MANUAL_FEED_LOSS_PANEL_DISMISSED_EVENT = "supernova:manual-feed-loss-panel-dismissed-changed";

/** How manual research explains a price drop (loss investigation). */
export type ManualInvestigationOutcome =
  | "no_catalyst"
  | "negative_catalyst"
  | "positive_catalyst"
  | "neutral";

export type ManualFeedEventDraft = {
  id: string;
  createdAt: string;
  ticker: string;
  eventDate: string;
  source: string;
  title: string;
  body: string;
  /** Optional user override −2…+2 */
  sentiment?: number | null;
  /** Optional market reaction % day after news */
  deltaP1d?: number | null;
  deltaP3d?: number | null;
  link?: string | null;
  /** Price drop % at investigation time (Var.24h or position P&L). */
  priceDropPct?: number | null;
  investigationOutcome?: ManualInvestigationOutcome | null;
  /** Set when saved from 24h loss/gain investigation (not Feed tab). */
  investigationContext?: "loss" | "gain" | null;
  /** Structured research tags (CAUSE_CLASS, EXPLAINS_MOVE, …) for score reintroduction. */
  attribution?: ManualMoveAttribution | null;
};

export type ParsedManualFeedInput = {
  ticker: string;
  eventDate: string;
  source: string;
  title: string;
  body: string;
  sentiment: number | null;
  deltaP1d: number | null;
  deltaP3d: number | null;
  link: string | null;
  priceDropPct: number | null;
  investigationOutcome: ManualInvestigationOutcome | null;
  attribution: ManualMoveAttribution | null;
  parseWarnings: string[];
};

const NO_CATALYST_RE =
  /\b(no catalyst|no news|no material|nothing found|market noise|sector selloff|broad market|rotation|non trovat|nessun[a]?\s+(causa|motivo|news)|oscillaz|rumore di mercato|movimento di mercato|probabilmente recupera|market volatility|short-term uncertainty|headquarters relocation|profit taking|rebalancing|technical pullback|beta drag|index (?:down|selloff))\b/i;

/** Research says drop is NOT fundamental bad news — treat as oscillation / no catalyst. */
const NO_NEGATIVE_NEWS_RE =
  /\b(not caused by|not due to|no|without|non[- ]?)\s*(?:by\s+)?negative|no negative news|neutral or positive|not\s+negative\s+news|non\s+causat[oa]\s+da\s+(?:news\s+)?negativ|non\s+legat[oa]\s+a\s+news\s+negativ/i;

/** Macro / market-wide explanation — not a company-specific negative catalyst. */
const MARKET_NOISE_RE =
  /\b(market[- ]driven(?:\s+reasons)?|market driven|sector (?:wide|selloff|rotation|weakness)|macro (?:headwind|noise|weakness)|no fundamental|no company[- ]specific|typical (?:market )?volatility|general market|biotech sector (?:selloff|weakness)|risk[- ]off|risk off|index (?:down|weakness)|profit taking)\b/i;

/** Structural / fundamental negative — overrides neutral phrasing in titles. */
const STRUCTURAL_NEGATIVE_RE =
  /\b(going concern|bankruptcy|chapter 11|delisting|fda (?:complete response|crL|reject)|trial (?:failed|missed|halt|discontinu)|missed (?:primary|endpoint)|clinical hold|complete response letter|offering (?:at|below|priced)|registered direct|dilution|downgrade to (?:sell|underperform|hold)|layoff|workforce reduction|sec investigation|subpoena|fraud|accounting irregularit|warning letter|safety concern|patient death|mortality signal|failed to meet|topline miss|data disappoint|data[- ]integrity|data anomal|class[- ]action|securities\s+(?:class[- ]action|investigation)|strategic\s+alternatives?|wind[- ]?down|shell[- ]level\s+valuation|no longer looks viable|critical juncture|plaintiffs?'?\s+firms?)\b/i;

const TITLE_DROP_QUESTION_RE =
  /\b(?:why|what happened to|so why did).+(?:drop|dropped|fall|fell|decline|declined)\b/i;

const TITLE_RALLY_QUESTION_RE =
  /\b(?:why|what happened to|so why did).+(?:rally|rallied|surge|surged|gain|gained|rise|rose|jump|jumped|spike|spiked|soar|soared)\b/i;

/** Material positive catalyst — gain investigation (incl. M&A / asset sale). */
const STRUCTURAL_POSITIVE_RE =
  /\b(fda approv|approval granted|breakthrough therapy|topline met|met primary|beat estimate|raised guidance|upgrade to (?:buy|outperform)|partnership|licensing deal|acquisition|buyout|sale to|sold to|closing of (?:the )?sale|asset sale|deal closed|orphan drug|fast track|priority review|positive data|statistically significant|pivotal success|commercial launch|milestone payment|positive catalyst|(?:mean )?weight loss (?:of )?(?:about |approximately |~)?\d|published in nature medicine|nature medicine|no drug[- ]induced liver|phase\s+[12][ab]?\b.{0,96}\b(?:readout|results|data|topline)|encouraging\s+(?:signs?\s+of\s+)?(?:activity|efficacy|benefit)|every\s+(?:one|patient|evaluable\s+patient)s?\s+(?:has\s+)?benefit|(?:median|mean)\s+\d+(?:\.\d+)?\s*%\s+reduction)\b/i;

const POS_WORDS =
  /\b(positive|success|beat|approval|approved|breakthrough|topline|met primary|significant|strong|upgraded|buy|outperform|record|growth|favorable|favourable|encouraging|benefit(?:ed|s|ing)?|efficacy|readout|activity|manageable|successo|positiv[oa]|approvato|superato|forte|crescita|favorevole|primari[aio]|neutral or positive)\b/i;
const NEG_WORDS =
  /\b(negative|fail|failed|miss|rejected|denied|delay|delayed|halt|downgrade(?:d)?|sell|underperform|warning|adverse|drop|decline|fall|perdita|negativ[oa]|fallito|ritardo|sospeso|peggior|ribasso|calo|avverso|critico|critical|going concern|bankruptcy|dilution|overhang|distressed|wind[- ]?down|class[- ]action|data[- ]integrity|anomal(?:y|ies)|plaintiff|investigation|shell[- ]level|not\s+viable)\b/i;

function splitTitleBody(newsText: string): { title: string; body: string } {
  const lines = newsText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) {
    const only = lines[0]?.trim() ?? newsText.trim();
    return { title: only, body: only };
  }
  return { title: lines[0]!.trim(), body: lines.slice(1).join("\n").trim() };
}

function explicitOutcomeFromBlob(blob: string): ManualInvestigationOutcome | null {
  const m = /^(?:OUTCOME|RISULTATO)\s*[:=]\s*(.+)$/im.exec(blob);
  return m ? normalizeInvestigationOutcome(m[1]!) : null;
}

function explicitSentimentFromBlob(blob: string): number | null {
  const m = /^(?:SENTIMENT|SENTIMENTO)\s*[:=]\s*(.+)$/im.exec(blob);
  return m ? parseSentimentField(m[1]!) : null;
}

function stripNegatedNegativePhrases(text: string): string {
  return text
    .replace(
      /\b(not|no|without|non)\s+(?:caused\s+by\s+|due\s+to\s+|by\s+|legat[oa]\s+a\s+)?[\w\s]{0,32}?\bnegative\b/gi,
      " ",
    )
    .replace(
      /\bno\s+(?:treatment[- ]related\s+)?(?:serious\s+)?adverse\s+(?:events?|reactions?)\b/gi,
      " ",
    )
    .replace(/\bwithout\s+(?:serious\s+)?adverse\s+(?:events?|reactions?)\b/gi, " ");
}

/** Drop ironic / negated bullish phrases so they do not inflate POS_WORDS. */
function stripNegatedPositivePhrases(text: string): string {
  return text
    .replace(/\b(?:rarely|not|never|no longer)\s+read\s+as\s+a\s+growth\s+signal\b/gi, " ")
    .replace(/\b(?:not|never|no)\s+(?:a\s+)?(?:growth|positive)\s+signal\b/gi, " ")
    .replace(/\brarely\s+read\s+as\s+a\s+growth\b/gi, " ");
}

function stripDropBoilerplateForSentiment(text: string): string {
  let t = text;
  t = t.replace(TITLE_DROP_QUESTION_RE, " ");
  t = t.replace(/\b(stock|shares)\s+(?:drop|dropped|fall|fell|decline|declined)\b/gi, " ");
  return t;
}

function stripMildFinancingPhrases(text: string): string {
  return text
    .replace(/\b(?:milder?|less|lower)\s+dilut(?:ion|ive)(?:\s+event)?\b/gi, " ")
    .replace(
      /\bdilution.{0,80}(?:not\s+stated|unknown|unquantified|percentage\s+is\s+not)\b/gi,
      " ",
    );
}

function prepareSentimentText(newsText: string, outcomeHint?: ManualInvestigationOutcome): string {
  let t = stripMildFinancingPhrases(
    stripNegatedPositivePhrases(stripNegatedNegativePhrases(newsText.toLowerCase())),
  );
  if (
    outcomeHint === "no_catalyst" ||
    NO_NEGATIVE_NEWS_RE.test(newsText) ||
    NO_CATALYST_RE.test(newsText) ||
    MARKET_NOISE_RE.test(newsText)
  ) {
    t = stripDropBoilerplateForSentiment(t);
  }
  return t;
}

export function normalizeInvestigationOutcome(raw: string): ManualInvestigationOutcome | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (!s) return null;
  if (
    s === "no_catalyst" ||
    s === "no-catalyst" ||
    s === "no_cause" ||
    s === "oscillation" ||
    s === "market_noise" ||
    s === "noise" ||
    s === "nessuna_causa" ||
    s === "oscillazione"
  ) {
    return "no_catalyst";
  }
  if (s === "negative_catalyst" || s === "negative" || s === "bad" || s === "negativo") {
    return "negative_catalyst";
  }
  if (s === "positive_catalyst" || s === "positive" || s === "good" || s === "positivo") {
    return "positive_catalyst";
  }
  if (s === "neutral" || s === "neutro") return "neutral";
  return null;
}

export function inferManualInvestigationOutcome(
  newsText: string,
  sentiment: number,
): ManualInvestigationOutcome {
  const t = capClassifierText(newsText);
  if (!t || t.length < 10) return "no_catalyst";

  const { title, body } = splitTitleBody(t);
  const full = body && body !== title ? `${title}\n${body}` : title;

  if (STRUCTURAL_NEGATIVE_RE.test(full)) {
    if (!isMildStructuredFinancingResearch(full)) return "negative_catalyst";
  }
  if (STRUCTURAL_POSITIVE_RE.test(full)) return "positive_catalyst";
  if (NO_NEGATIVE_NEWS_RE.test(full) || NO_CATALYST_RE.test(full) || MARKET_NOISE_RE.test(full)) {
    return "no_catalyst";
  }
  if (TITLE_RALLY_QUESTION_RE.test(title) && STRUCTURAL_POSITIVE_RE.test(body)) {
    return "positive_catalyst";
  }
  if (TITLE_RALLY_QUESTION_RE.test(title) && !STRUCTURAL_NEGATIVE_RE.test(body)) {
    if (MARKET_NOISE_RE.test(body) || body.length < 200) return "no_catalyst";
  }
  if (/\((market[- ]driven[^)]*)\)/i.test(title)) return "no_catalyst";

  if (TITLE_DROP_QUESTION_RE.test(title) && !STRUCTURAL_NEGATIVE_RE.test(body)) {
    if (
      MARKET_NOISE_RE.test(body) ||
      NO_NEGATIVE_NEWS_RE.test(body) ||
      NO_CATALYST_RE.test(body) ||
      body.length < 200
    ) {
      return "no_catalyst";
    }
  }

  if (sentiment <= -0.35) return "negative_catalyst";
  if (sentiment >= 0.35) return "positive_catalyst";
  return "neutral";
}

/** Resolve structured attribution — stored fields win, then tags + research prose. */
export function resolveManualEventAttribution(
  draft: ManualFeedEventDraft,
): ManualMoveAttribution | null {
  const blob = `${draft.title}\n${draft.body}`;
  const fromText = parseManualMoveAttribution(blob);
  const merged = mergeManualMoveAttribution(draft.attribution, fromText);
  return enrichManualAttributionFromResearch(blob, merged);
}

/**
 * Stored sentiment on drafts: treat bare 0 as "unset" (form default), not an explicit
 * neutral override. Labeled `SENTIMENT: 0` still wins via explicitSentimentFromBlob.
 */
function storedSentimentOverride(draft: ManualFeedEventDraft): number | null {
  const s = draft.sentiment;
  if (s == null || !Number.isFinite(s) || s === 0) return null;
  return s;
}

/** Resolve sentiment + outcome for display/EIS — structured tags beat regex; stale stored outcome does not. */
export function resolveManualEventClassification(draft: ManualFeedEventDraft): {
  sentiment: number;
  investigationOutcome: ManualInvestigationOutcome;
  attribution: ManualMoveAttribution | null;
} {
  const blob = `${draft.title}\n${draft.body}`.trim();
  return classifyManualNewsBlob(blob, {
    sentiment: explicitSentimentFromBlob(blob) ?? storedSentimentOverride(draft),
    // Prefer explicit OUTCOME: label; else keep the outcome stored at save time
    // (avoids re-promoting IR/finance paste to positive_catalyst on every render).
    investigationOutcome:
      explicitOutcomeFromBlob(blob) ?? draft.investigationOutcome ?? null,
    attribution: mergeManualMoveAttribution(
      draft.attribution,
      parseManualMoveAttribution(blob),
    ),
    priceDropPct: resolveManualEventPriceMovePct(draft),
  });
}

/** Cap classifier input — long pasted articles need not scan every char on each keystroke. */
const MANUAL_FEED_CLASSIFIER_MAX_CHARS = 12_000;

function capClassifierText(text: string): string {
  const t = text.trim();
  if (t.length <= MANUAL_FEED_CLASSIFIER_MAX_CHARS) return t;
  return t.slice(0, MANUAL_FEED_CLASSIFIER_MAX_CHARS);
}

function hasLabeledManualFeedLines(lines: string[]): boolean {
  return lines.some((line) =>
    /^(TICKER|EVENT_DATE|FIRST_TRADABLE|DATA|DATE|FONTE|SOURCE|NEWS|TITOLO|TITLE|OUTCOME|RISULTATO|SENTIMENT|SENTIMENTO|PRICE_DROP|DROP_24H|VAR_24H|LINK|URL|CAUSE_CLASS|EXPLAINS_MOVE|CONFIDENCE|EVENT_SUBTYPE|LEARNING_TAG|XBI\s+SAME\s+DAY)\s*[:=]/i.test(
      line,
    ),
  );
}

/** Heuristic sentiment when user does not specify one (−2…+2). */
export function estimateManualNewsSentiment(
  text: string,
  outcomeHint?: ManualInvestigationOutcome | null,
): number {
  const t = prepareSentimentText(capClassifierText(text), outcomeHint ?? undefined);
  let score = 0;
  const pos = (t.match(new RegExp(POS_WORDS.source, "gi")) ?? []).length;
  const neg = (t.match(new RegExp(NEG_WORDS.source, "gi")) ?? []).length;
  if (pos > neg) score = Math.min(1.5, 0.35 + (pos - neg) * 0.25);
  else if (neg > pos) score = Math.max(-1.5, -0.35 - (neg - pos) * 0.25);
  return Math.round(score * 100) / 100;
}

/** Boost sentiment when prose describes clinical efficacy (not stock price). */
function boostClinicalPublicationSentiment(text: string, base: number): number {
  let score = base;
  // Do not lift distress / integrity research via efficacy-style positive boosters.
  if (STRUCTURAL_POSITIVE_RE.test(text) && !STRUCTURAL_NEGATIVE_RE.test(text)) {
    score = Math.max(score, 0.55);
  }

  let maxWeightLossPct = 0;
  for (const m of text.matchAll(/(?:mean )?weight loss (?:of )?(?:about |approximately |~)?(\d+(?:\.\d+)?)\s*%/gi)) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && v > maxWeightLossPct) maxWeightLossPct = v;
  }
  if (maxWeightLossPct >= 15) score = Math.max(score, 0.95);
  else if (maxWeightLossPct >= 10) score = Math.max(score, 0.75);
  else if (maxWeightLossPct >= 5) score = Math.max(score, 0.55);

  let maxReductionPct = 0;
  for (const m of text.matchAll(/(?:median|mean)\s+(\d+(?:\.\d+)?)\s*%\s+reduction/gi)) {
    const v = Number(m[1]);
    if (Number.isFinite(v) && v > maxReductionPct) maxReductionPct = v;
  }
  if (maxReductionPct >= 50) score = Math.max(score, 0.9);
  else if (maxReductionPct >= 25) score = Math.max(score, 0.7);
  else if (maxReductionPct >= 10) score = Math.max(score, 0.55);

  if (/\bnature medicine\b/i.test(text)) score = Math.max(score, 0.65);
  return Math.round(score * 100) / 100;
}

/** Shared sentiment + outcome for parse preview and saved drafts. */
export function classifyManualNewsBlob(
  blob: string,
  partial?: {
    sentiment?: number | null;
    investigationOutcome?: ManualInvestigationOutcome | null;
    attribution?: ManualMoveAttribution | null;
    priceDropPct?: number | null;
  },
): {
  sentiment: number;
  investigationOutcome: ManualInvestigationOutcome;
  attribution: ManualMoveAttribution | null;
} {
  const text = blob.trim();
  const attribution = enrichManualAttributionFromResearch(
    text,
    mergeManualMoveAttribution(partial?.attribution ?? null, parseManualMoveAttribution(text)),
  );
  const priceMove = partial?.priceDropPct ?? null;
  const explicitSentiment = explicitSentimentFromBlob(text);
  const sentimentPass1 =
    partial?.sentiment ??
    explicitSentiment ??
    estimateManualNewsSentiment(text);
  let investigationOutcome =
    partial?.investigationOutcome ??
    refineOutcomeFromResearchProse(text, explicitOutcomeFromBlob(text), sentimentPass1) ??
    investigationOutcomeFromCauseClass(attribution?.causeClass, priceMove, sentimentPass1) ??
    inferManualInvestigationOutcome(text, sentimentPass1);
  if (
    STRUCTURAL_NEGATIVE_RE.test(text) &&
    investigationOutcome === "positive_catalyst" &&
    !isMildStructuredFinancingResearch(text)
  ) {
    investigationOutcome = "negative_catalyst";
  }
  if (
    investigationOutcome === "negative_catalyst" &&
    isMildStructuredFinancingResearch(text)
  ) {
    investigationOutcome = "neutral";
  }
  let sentiment = boostClinicalPublicationSentiment(
    text,
    explicitSentiment ?? estimateManualNewsSentiment(text, investigationOutcome),
  );
  if (isMildStructuredFinancingResearch(text)) {
    sentiment = Math.max(sentiment, -0.15);
  }
  return { sentiment, investigationOutcome, attribution };
}

/**
 * Contextual EIS for loss investigation: drop without news → mild positive
 * (market oscillation, recovery likely); drop with negative catalyst → amplified negative.
 */
export function scoreManualLossInvestigationEis(args: {
  priceChangePct: number | null;
  sentiment: number;
  investigationOutcome: ManualInvestigationOutcome;
  attribution?: ManualMoveAttribution | null;
  /** Historical prior multiplier from attribution memory (default 1). */
  memoryMultiplier?: number;
}): EisBreakdown {
  const drop =
    args.priceChangePct != null &&
    Number.isFinite(args.priceChangePct) &&
    args.priceChangePct < -0.5;
  const outcome = args.investigationOutcome;

  let base: EisBreakdown;
  if (drop && outcome === "no_catalyst") {
    const depth = Math.min(12, Math.abs(args.priceChangePct!));
    const sent = Math.min(1.4, 0.4 + depth * 0.06);
    base = computeEis(null, null, 1, sent);
  } else if (drop && outcome === "negative_catalyst") {
    const sent = Math.min(args.sentiment, -0.55);
    const delta = args.priceChangePct ?? null;
    base = computeEis(delta, delta != null ? delta * 0.6 : null, 1.15, sent);
  } else if (drop && outcome === "positive_catalyst") {
    const sent = Math.max(args.sentiment, 0.45);
    base = computeEis(args.priceChangePct, null, 1, sent);
  } else if (drop && outcome === "neutral" && args.sentiment >= -0.2) {
    const depth = Math.min(12, Math.abs(args.priceChangePct!));
    const sent = Math.min(0.85, 0.2 + depth * 0.04);
    base = computeEis(null, null, 1, sent);
  } else {
    const rise =
      args.priceChangePct != null &&
      Number.isFinite(args.priceChangePct) &&
      args.priceChangePct > 0.5;

    if (rise && outcome === "positive_catalyst") {
      const depth = Math.min(12, args.priceChangePct!);
      const sent = Math.max(args.sentiment, Math.min(1.5, 0.55 + depth * 0.05));
      const delta = args.priceChangePct ?? null;
      base = computeEis(delta, delta != null ? delta * 0.6 : null, 1.15, sent);
    } else if (rise && outcome === "no_catalyst") {
      const depth = Math.min(12, args.priceChangePct!);
      const sent = Math.min(0.75, 0.25 + depth * 0.03);
      base = computeEis(null, null, 1, sent);
    } else if (rise && outcome === "negative_catalyst") {
      const sent = Math.min(args.sentiment, -0.35);
      base = computeEis(args.priceChangePct, null, 1, sent);
    } else {
      const flatPrice =
        args.priceChangePct == null ||
        !Number.isFinite(args.priceChangePct) ||
        Math.abs(args.priceChangePct) <= 0.5;

      /** Publication-only manual news (no linked stock move) — market EIS stays flat;
       *  news quality lives in eis_intrinsic (see resolveManualEventEis). */
      if (flatPrice) {
        base = computeEis(null, null, 1, 0);
      } else {
        base = scoreManualPublicationEvent(args.sentiment, args.priceChangePct, null);
      }
    }
  }

  return applyManualAttributionToEis(
    base,
    args.attribution,
    args.memoryMultiplier ?? 1,
  );
}

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeTicker(raw: string): string {
  const s = raw.trim();
  // "JSPR (Jasper Therapeutics, Inc.)" / "JSPR — Jasper…"
  const leading = /^([A-Za-z]{1,6}(?:\.[A-Za-z]{1,3})?)\b/.exec(s);
  const base = leading?.[1] ?? s;
  return base.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function toLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  // English month names: May 13, 2026 · May 13 2026
  if (/^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/.test(s)) {
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return toLocalIsoDate(parsed);
  }
  // Day-first English: 28 August 2026
  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/.test(s)) {
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return toLocalIsoDate(parsed);
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return toLocalIsoDate(parsed);
  return null;
}

function parsePctField(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  // Claude research: "NOT SUPPLIED — see DATA CONFLICT" must not scrape a fake %.
  if (
    /not\s*supplied|n\/?a\b|unknown|unverified|see\s+data\s+conflict|do\s+not\s+import|resolve\s+before/i.test(
      s,
    )
  ) {
    return null;
  }
  const m = /([+-]?\d+(?:\.\d+)?)\s*%/.exec(s) ?? /^([+-]?\d+(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? roundPct(v) : null;
}

/** Nearby language that marks a cited +% as day-noise, not the event reaction. */
const CITED_MOVE_NOISE_RE =
  /\b(pre[- ]?market|day[- ]to[- ]day|tick|noise|bid\s*\/\s*ask|order\s+book|52[- ]week|market\s+cap|illustrat|for\s+example|e\.g\.|thin,\s*wide[- ]spread)\b/i;

/**
 * Largest explicit +% move cited in manual text (e.g. «+8.95% price move»).
 * Used when user documents the rally in prose but omits PRICE_DROP / VAR_24H fields.
 * Skips pre-market ticks / day-to-day noise examples that are not VAR_24H.
 */
export function parseManualCitedPriceMovePct(text: string): number | null {
  const matches = [...text.matchAll(/\+\s*(\d+(?:\.\d+)?)\s*%/gi)];
  if (!matches.length) return null;
  let best: number | null = null;
  for (const m of matches) {
    const v = Number(m[1]);
    if (!Number.isFinite(v) || v <= 0 || v > 80) continue;
    const idx = m.index ?? 0;
    const window = text.slice(
      Math.max(0, idx - 90),
      Math.min(text.length, idx + m[0].length + 90),
    );
    if (CITED_MOVE_NOISE_RE.test(window)) continue;
    if (best == null || v > best) best = v;
  }
  return best != null ? roundPct(best) : null;
}

/** Effective price move % for manual EIS — fields first, then cited +% in text. */
export function resolveManualEventPriceMovePct(draft: ManualFeedEventDraft): number | null {
  const fromField = draft.priceDropPct ?? draft.deltaP1d ?? null;
  if (fromField != null && Number.isFinite(fromField)) return fromField;
  return parseManualCitedPriceMovePct(`${draft.title}\n${draft.body}`);
}

function parseSentimentField(raw: string): number | null {
  const v = Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(v)) return null;
  return Math.max(-2, Math.min(2, v));
}

/**
 * Parse free-text box. Accepts labeled lines (IT/EN) or a loose block.
 *
 * Example:
 *   TICKER: PMVP
 *   DATE: 2026-03-01
 *   SOURCE: BioSpace
 *   NEWS: Phase 2 topline met primary endpoint...
 */
export function parseManualFeedFreeText(raw: string): ParsedManualFeedInput | null {
  const text = raw.trim();
  if (!text) return null;

  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);
  const fields: Record<string, string> = {};
  const bodyLines: string[] = [];
  let inBody = false;

  const fieldRe =
    /^(TICKER|EVENT_DATE|FIRST_TRADABLE|DATA|DATE|FONTE|SOURCE|NEWS|TITOLO|TITLE|LINK|URL|SENTIMENT|SENTIMENTO|DELTA_1D|DELTA_3D|Δ1D|Δ3D|OUTCOME|RISULTATO|PRICE_DROP|DROP_24H|VAR_24H|CAUSE_CLASS|EXPLAINS_MOVE|CONFIDENCE|EVENT_SUBTYPE|PEER_XBI_SAME_DAY|XBI\s+SAME\s+DAY|LEARNING_TAG|GEOPOLITICAL_OR_MACRO|DRUG_OR_ASSET|NCT_OR_FILING|DILUTION_PCT|VOLUME_NOTE|MOVE_CONTEXT|HOLDER_LENS|PRICE_VERIFIED|EVENT_NATURE|DATE_SOURCE)\s*[:=]\s*(.*)$/i;

  for (const line of lines) {
    if (line.trim() === "---") {
      inBody = true;
      continue;
    }
    const m = fieldRe.exec(line.trim());
    if (m && !inBody) {
      const key = m[1]!.toUpperCase().replace(/\s/g, "_");
      fields[key] = (m[2] ?? "").trim();
      continue;
    }
    // Keep structured tags in body too (Claude research template after ---).
    bodyLines.push(line);
  }

  let ticker = normalizeTicker(fields.TICKER ?? "");
  // Prefer first tradable session after AMC release, then EVENT_DATE, then DATE.
  let eventDate =
    normalizeDate(fields.FIRST_TRADABLE ?? "") ??
    normalizeDate(fields.EVENT_DATE ?? "") ??
    normalizeDate(fields.DATE ?? fields.DATA ?? "") ??
    "";
  let source = (fields.SOURCE ?? fields.FONTE ?? "").trim();
  let link = (fields.LINK ?? fields.URL ?? "").trim() || null;
  let title = (fields.TITLE ?? fields.TITOLO ?? fields.NEWS ?? "").trim();
  let body = bodyLines.join("\n").trim();

  if (!ticker) {
    const headerTk = /\bMANUAL\s+EIS\s*[—–-]\s*([A-Z]{2,6})\b/i.exec(text);
    const pipeTicker = /^([A-Z]{2,6})\s*\|/m.exec(text);
    const lineStartTicker = /^([A-Z]{2,6})\s*[|\-–—:,]/m.exec(text);
    const inlineTicker =
      headerTk ?? pipeTicker ?? lineStartTicker ?? /\b([A-Z]{2,6})\b/.exec(text);
    if (inlineTicker) ticker = inlineTicker[1]!;
    else warnings.push("missing_ticker");
  }

  if (!eventDate) {
    eventDate = extractResearchEventDate(text) ?? "";
  }
  if (!eventDate) {
    const header = lines.slice(0, 4).join("\n");
    const dayMonthYearHeader = /\b(\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})\b/.exec(header);
    const monthNameHeader = /\b([A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2})\b/.exec(header);
    eventDate =
      normalizeDate(dayMonthYearHeader?.[1] ?? monthNameHeader?.[1] ?? "") ?? "";
  }
  if (!eventDate) {
    const iso = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text);
    const dmy = /\b(\d{1,2}[/.-]\d{1,2}[/.-]20\d{2})\b/.exec(text);
    const dayMonthYear = /\b(\d{1,2}\s+[A-Za-z]{3,9}\s+20\d{2})\b/.exec(text);
    const monthName = /\b([A-Za-z]{3,9}\s+\d{1,2},?\s+20\d{2})\b/.exec(text);
    eventDate =
      normalizeDate(
        iso?.[1] ?? dmy?.[1] ?? dayMonthYear?.[1] ?? monthName?.[1] ?? "",
      ) ?? "";
    if (!eventDate) warnings.push("missing_date");
  }

  if (!source) {
    // Do not let `\s*` after ':' swallow the next label (SOURCE:\nNEWS: → "NEWS:").
    const srcLine = /(?:fonte|source)\s*[:=][ \t]*([^\n\r]+)/i.exec(text);
    source = srcLine?.[1]?.trim() ?? "";
    if (!source || /^(NEWS|TITLE|TITOLO|TICKER|DATE|DATA)\s*:?\s*$/i.test(source)) {
      source = "Manual entry";
      warnings.push("default_source");
    }
  }

  if (!title) {
    title = extractResearchEventTitle(text, ticker) ?? "";
  }
  if (!title && body) {
    const firstMeaningful = body
      .split(/\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 24 && !/^(EVENT|STRUCTURE|SENTIMENT|TICKER|DATA|OUTCOME)\b/i.test(l));
    title = (firstMeaningful ?? body.split(/\n/)[0] ?? "").slice(0, 160);
  }
  if (!body && title) body = title;

  const explicitOutcome = normalizeInvestigationOutcome(
    fields.OUTCOME ?? fields.RISULTATO ?? "",
  );
  const priceDropPct =
    parsePctField(fields.PRICE_DROP ?? fields.DROP_24H ?? fields.VAR_24H ?? "") ??
    null;

  const xbiField = fields.PEER_XBI_SAME_DAY ?? fields.XBI_SAME_DAY ?? "";
  const headerAttr = parseManualMoveAttribution(
    [
      fields.CAUSE_CLASS ? `CAUSE_CLASS: ${fields.CAUSE_CLASS}` : "",
      fields.EXPLAINS_MOVE ? `EXPLAINS_MOVE: ${fields.EXPLAINS_MOVE}` : "",
      fields.CONFIDENCE ? `CONFIDENCE: ${fields.CONFIDENCE}` : "",
      fields.EVENT_SUBTYPE ? `EVENT_SUBTYPE: ${fields.EVENT_SUBTYPE}` : "",
      xbiField ? `PEER_XBI_SAME_DAY: ${xbiField}` : "",
      fields.LEARNING_TAG ? `LEARNING_TAG: ${fields.LEARNING_TAG}` : "",
      fields.GEOPOLITICAL_OR_MACRO
        ? `GEOPOLITICAL_OR_MACRO: ${fields.GEOPOLITICAL_OR_MACRO}`
        : "",
      fields.DRUG_OR_ASSET ? `DRUG_OR_ASSET: ${fields.DRUG_OR_ASSET}` : "",
      fields.NCT_OR_FILING ? `NCT_OR_FILING: ${fields.NCT_OR_FILING}` : "",
      fields.DILUTION_PCT ? `DILUTION_PCT: ${fields.DILUTION_PCT}` : "",
      fields.VOLUME_NOTE ? `VOLUME_NOTE: ${fields.VOLUME_NOTE}` : "",
      fields.MOVE_CONTEXT ? `MOVE_CONTEXT: ${fields.MOVE_CONTEXT}` : "",
      fields.HOLDER_LENS ? `HOLDER_LENS: ${fields.HOLDER_LENS}` : "",
      fields.PRICE_VERIFIED ? `PRICE_VERIFIED: ${fields.PRICE_VERIFIED}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const bodyAttr = parseManualMoveAttribution(`${body}\n${text}`);
  let attribution = mergeManualMoveAttribution(headerAttr, bodyAttr);
  attribution = enrichManualAttributionFromResearch(text, attribution);

  // Soften EXPLAINS_MOVE only when research flags price conflict / unverified reaction.
  if (researchPriceUnverified(text)) {
    if (!attribution) {
      attribution = { explainsMove: "partial" };
    } else if (!attribution.explainsMove || attribution.explainsMove === "full") {
      attribution = { ...attribution, explainsMove: "partial" };
    }
  }

  const newsBlob = `${title}\n${body}`.trim();
  const bareShell =
    !explicitOutcome &&
    !hasManualMoveAttribution(attribution) &&
    (!newsBlob ||
      newsBlob.length < 40 ||
      /^(TICKER|DATE|DATA|SOURCE|FONTE|NEWS)\s*:?\s*$/im.test(newsBlob.trim()) ||
      (/^(TICKER|DATE|DATA|SOURCE|FONTE|NEWS)\s*:/im.test(newsBlob) &&
        newsBlob.length < 80 &&
        !/(phase|fda|trial|study|endpoint|approval|fail|delay|data readout|topline|acquisition|dilution|merger|catalyst|oscillaz)/i.test(
          newsBlob,
        )));

  if (bareShell) {
    return null;
  }

  if (!title && !body && !explicitOutcome && !hasManualMoveAttribution(attribution)) {
    return null;
  }

  if (!title && explicitOutcome === "no_catalyst") {
    title = "No probable cause — market oscillation";
    body = title;
  }
  if (!title && !body) {
    title = newsBlob.slice(0, 160) || ticker;
    body = newsBlob || title;
  }

  const sentimentField = parseSentimentField(fields.SENTIMENT ?? fields.SENTIMENTO ?? "");
  const classified = classifyManualNewsBlob(`${title}\n${body}`, {
    sentiment: sentimentField,
    investigationOutcome: explicitOutcome,
    attribution,
    priceDropPct,
  });
  const sentiment = classified.sentiment;
  const investigationOutcome = classified.investigationOutcome;
  attribution = classified.attribution ?? attribution;

  if (researchPriceUnverified(text)) {
    warnings.push("price_unverified");
  }
  if (!source || source === "Manual entry") {
    if (/\b8[- ]?K\b/i.test(text) || /\bpress\s+release\b/i.test(text)) {
      source = "Company PR / 8-K";
      warnings.push("source_from_research");
    }
  }

  const deltaP1d = parsePctField(fields.DELTA_1D ?? fields["Δ1D"] ?? "");
  const deltaP3d = parsePctField(fields.DELTA_3D ?? fields["Δ3D"] ?? "");

  if (!ticker || !eventDate) return null;

  return {
    ticker,
    eventDate,
    source,
    title,
    body,
    sentiment,
    deltaP1d,
    deltaP3d,
    link,
    priceDropPct,
    investigationOutcome,
    attribution,
    parseWarnings: warnings,
  };
}

/** One pipe-delimited row: TICKER | DATE | TITLE | SOURCE? | BODY? */
function tryParsePipeLine(line: string): ParsedManualFeedInput | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const parts = trimmed.split("|").map((p) => p.trim());
  if (parts.length < 3) return null;

  const ticker = normalizeTicker(parts[0] ?? "");
  const eventDate = normalizeDate(parts[1] ?? "");
  if (!ticker || !eventDate) return null;

  const title = (parts[2] ?? "").trim();
  const source = (parts[3] ?? "").trim() || "Manual entry";
  const body = parts.slice(4).join(" · ").trim() || title;
  const sentiment = estimateManualNewsSentiment(`${title}\n${body}`);
  const investigationOutcome = inferManualInvestigationOutcome(`${title}\n${body}`, sentiment);

  return {
    ticker,
    eventDate,
    source,
    title,
    body,
    sentiment,
    deltaP1d: null,
    deltaP3d: null,
    link: null,
    priceDropPct: null,
    investigationOutcome,
    attribution: parseManualMoveAttribution(`${title}\n${body}`),
    parseWarnings: source === "Manual entry" ? ["default_source"] : [],
  };
}

/**
 * Parse one or many news blocks. Supports:
 * - labeled block (TICKER/DATA/NEWS…)
 * - pipe rows: INBS | May 13, 2026 | Headline | GlobeNewswire | summary
 */
export const MANUAL_FEED_BATCH_MAX_ROWS = 80;

export function parseManualFeedBatch(raw: string): ParsedManualFeedInput[] {
  const text = raw.trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Labeled block (TICKER/DATE/NEWS…) — one article even if body lines contain "|".
  if (hasLabeledManualFeedLines(lines)) {
    const single = parseManualFeedFreeText(text);
    return single ? [single] : [];
  }

  const pipeRows = lines
    .map((line) => tryParsePipeLine(line))
    .filter((row): row is ParsedManualFeedInput => row != null);

  // Pipe batch only when every non-empty line is a valid pipe row (not mixed prose).
  if (pipeRows.length > 0 && pipeRows.length === lines.length) {
    return pipeRows.slice(0, MANUAL_FEED_BATCH_MAX_ROWS);
  }

  const single = parseManualFeedFreeText(text);
  return single ? [single] : [];
}

export function scoreManualPublicationEvent(
  sentiment: number,
  deltaP1d: number | null,
  deltaP3d: number | null,
): EisBreakdown {
  return computeEis(deltaP1d, deltaP3d, 1, sentiment);
}

let _attrMemoryCacheKey = "";
let _attrMemoryCache: ReturnType<typeof buildManualAttributionMemory> | null = null;

/** Live attribution memory rebuilt from local manual drafts (incl. current). */
export function loadManualAttributionMemory() {
  const drafts = loadManualFeedEvents();
  const cacheKey = `${drafts.length}|${drafts[drafts.length - 1]?.id ?? ""}|${drafts[drafts.length - 1]?.createdAt ?? ""}`;
  if (_attrMemoryCache && _attrMemoryCacheKey === cacheKey) return _attrMemoryCache;
  _attrMemoryCache = buildManualAttributionMemory(
    drafts.map((d) => ({
      ticker: d.ticker,
      priceDropPct: resolveManualEventPriceMovePct(d),
      // Prefer stored/parsed tags only — avoid full classifier (cheaper + no score recursion).
      attribution: resolveManualEventAttribution(d),
      eisScore: null,
    })),
  );
  _attrMemoryCacheKey = cacheKey;
  return _attrMemoryCache;
}

export function resolveManualEventEis(draft: ManualFeedEventDraft): EisBreakdown {
  const { sentiment, investigationOutcome, attribution } =
    resolveManualEventClassification(draft);
  const priceChangePct = resolveManualEventPriceMovePct(draft);
  const base = scoreManualLossInvestigationEis({
    priceChangePct,
    sentiment,
    investigationOutcome,
    attribution,
    memoryMultiplier: 1,
  });
  const memory = loadManualAttributionMemory();
  const memMul = memoryEisMultiplier(memory, attribution, base.score);
  const market =
    Math.abs(memMul - 1) < 0.01
      ? base
      : scoreManualLossInvestigationEis({
          priceChangePct,
          sentiment,
          investigationOutcome,
          attribution,
          memoryMultiplier: memMul,
        });

  const kind = classifyManualNewsEisKind(
    `${draft.title}\n${draft.body}`,
    attribution,
    investigationOutcome,
  );
  const news = scoreManualNewsIntrinsic({
    sentiment,
    investigationOutcome,
    kind,
  });

  return {
    ...market,
    sentiment,
    kpi_score: news.kpi_score,
    eis_intrinsic: news.eis_intrinsic,
  };
}

/** Prefer market EIS when the stock moved; otherwise the news intrinsic score. */
export function resolveManualEventPrimaryEisScore(breakdown: EisBreakdown): number {
  return resolvePrimaryEisScore(breakdown);
}

export function resolveManualEventNewsKind(
  draft: ManualFeedEventDraft,
): ManualNewsEisKind {
  const { investigationOutcome, attribution } = resolveManualEventClassification(draft);
  return classifyManualNewsEisKind(
    `${draft.title}\n${draft.body}`,
    attribution,
    investigationOutcome,
  );
}

/**
 * EIS for a merged feed row. Manual events always use the manual scorer so parent-study
 * KPIs cannot zero out or override checklist scores.
 */
export function resolveMergedFeedEventEis(
  ev: ClinicalPublicationEvent,
  parentIndicators?: ClinicalStudyIndicator[],
): EisBreakdown | null {
  const isManual = String(ev.source_type ?? ev.event_type ?? "").toLowerCase() === "manual";
  if (isManual) {
    const draftId = parseManualFeedEventId(ev);
    if (draftId) {
      const draft = loadManualFeedEvents().find((d) => d.id === draftId);
      if (draft) return resolveManualEventEis(draft);
    }
    return resolveEventEis(ev, []);
  }
  const indicators = ev.indicators?.length ? ev.indicators : parentIndicators;
  return resolveEventEis(ev, indicators);
}

export function manualDraftToPublicationEvent(draft: ManualFeedEventDraft): ClinicalPublicationEvent {
  const { sentiment, investigationOutcome, attribution } =
    resolveManualEventClassification(draft);
  const priceRef = resolveManualEventPriceMovePct(draft);
  const breakdown = resolveManualEventEis(draft);
  const outcomeNote =
    investigationOutcome === "no_catalyst"
      ? " · oscillazione mercato"
      : investigationOutcome === "negative_catalyst"
        ? " · catalyst negativo"
        : investigationOutcome === "positive_catalyst"
          ? " · catalyst positivo"
          : "";
  const attrNote = formatAttributionImpactNote(attribution);
  return {
    event_date: draft.eventDate,
    event_title: draft.title,
    summary: draft.body,
    drug: attribution?.drugOrAsset ?? null,
    source_type: "manual",
    event_type: "manual",
    link: draft.link ?? null,
    link_label: draft.source || "Manual",
    sentiment,
    reference_verified: true,
    reference_match: "stored",
    price:
      priceRef != null || draft.deltaP3d != null
        ? {
            delta_p_1d: priceRef ?? draft.deltaP1d ?? null,
            delta_p_3d: draft.deltaP3d ?? null,
          }
        : undefined,
    eis: {
      score: breakdown.score,
      delta_p_1d: breakdown.delta_p_1d,
      delta_p_3d: breakdown.delta_p_3d,
      vol_ratio: breakdown.vol_ratio,
      vol_term: breakdown.vol_term,
      sentiment: breakdown.sentiment,
      kpi_score: breakdown.kpi_score ?? null,
      eis_intrinsic: breakdown.eis_intrinsic ?? null,
      sent_term: breakdown.sent_term,
      weights: breakdown.weights,
    },
    impact_note: `Manual feed · id:${draft.id} · ${draft.source}${outcomeNote}${attrNote}`,
  };
}

/** Extract stored manual event id from a merged feed row (impact_note). */
export function parseManualFeedEventId(ev: {
  source_type?: string | null;
  event_type?: string | null;
  impact_note?: string | null;
}): string | null {
  const st = String(ev.source_type ?? ev.event_type ?? "").toLowerCase();
  if (st !== "manual") return null;
  const m = /\bid:(manual_[^\s·]+)\b/.exec(ev.impact_note ?? "");
  return m?.[1] ?? null;
}

export function loadManualFeedEvents(): ManualFeedEventDraft[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(MANUAL_FEED_EVENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ManualFeedEventDraft[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveManualFeedEvents(events: ManualFeedEventDraft[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MANUAL_FEED_EVENTS_STORAGE_KEY, JSON.stringify(events));
  window.dispatchEvent(new CustomEvent(MANUAL_FEED_EVENTS_CHANGED_EVENT));
  void import("./manualFeedPersistence").then((m) => m.scheduleManualFeedStoreDiskFlush());
}

export function addManualFeedEvent(draft: Omit<ManualFeedEventDraft, "id" | "createdAt">): ManualFeedEventDraft {
  const entry: ManualFeedEventDraft = {
    ...draft,
    id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  const next = [...loadManualFeedEvents(), entry];
  saveManualFeedEvents(next);
  return entry;
}

export function addManualFeedEvents(
  drafts: Omit<ManualFeedEventDraft, "id" | "createdAt">[],
): ManualFeedEventDraft[] {
  if (!drafts.length) return [];
  const entries = drafts.map((draft, i) => ({
    ...draft,
    id: `manual_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  }));
  const next = [...loadManualFeedEvents(), ...entries];
  saveManualFeedEvents(next);
  return entries;
}

export function removeManualFeedEvent(id: string): void {
  saveManualFeedEvents(loadManualFeedEvents().filter((e) => e.id !== id));
}

/** Remove all manual events for the given tickers (e.g. stock recovered from loss). */
export function removeManualFeedEventsForTickers(tickers: string[]): number {
  const drop = new Set(
    tickers.map((t) => normalizeTicker(t)).filter(Boolean),
  );
  if (!drop.size) return 0;
  const before = loadManualFeedEvents();
  const next = before.filter((e) => !drop.has(normalizeTicker(e.ticker)));
  if (next.length === before.length) return 0;
  saveManualFeedEvents(next);
  clearLossPanelDismissalsForTickers(tickers);
  return before.length - next.length;
}

function loadLossPanelDismissedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(MANUAL_FEED_LOSS_PANEL_DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveLossPanelDismissedIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MANUAL_FEED_LOSS_PANEL_DISMISSED_KEY, JSON.stringify([...ids]));
  window.dispatchEvent(new CustomEvent(MANUAL_FEED_LOSS_PANEL_DISMISSED_EVENT));
}

/** Hide from 24h loss temporary list — does not remove EIS/Feed entries. */
export function dismissManualFeedFromLossPanel(eventId: string): void {
  const id = eventId.trim();
  if (!id) return;
  const ids = loadLossPanelDismissedIds();
  if (ids.has(id)) return;
  ids.add(id);
  saveLossPanelDismissedIds(ids);
}

export function isManualFeedDismissedFromLossPanel(eventId: string): boolean {
  return loadLossPanelDismissedIds().has(eventId.trim());
}

export function filterManualEventsForLossPanel(
  events: ManualFeedEventDraft[] = loadManualFeedEvents(),
): ManualFeedEventDraft[] {
  const dismissed = loadLossPanelDismissedIds();
  return events.filter((e) => !dismissed.has(e.id));
}

export function clearLossPanelDismissalsForTickers(tickers: string[]): void {
  const drop = new Set(tickers.map((t) => normalizeTicker(t)).filter(Boolean));
  if (!drop.size) return;
  const dismissed = loadLossPanelDismissedIds();
  if (!dismissed.size) return;
  const removedIds = new Set(
    loadManualFeedEvents()
      .filter((e) => drop.has(normalizeTicker(e.ticker)))
      .map((e) => e.id),
  );
  if (!removedIds.size) return;
  let changed = false;
  for (const id of removedIds) {
    if (dismissed.delete(id)) changed = true;
  }
  if (changed) saveLossPanelDismissedIds(dismissed);
}

export function resolveManualFeedEventLink(draft: ManualFeedEventDraft): string | null {
  const stored = draft.link?.trim();
  if (stored && /^https?:\/\//i.test(stored)) return stored;
  const blob = `${draft.title}\n${draft.body}\n${draft.source ?? ""}`;
  const m = /https?:\/\/[^\s<>"')]+/i.exec(blob);
  if (m) return m[0]!.replace(/[.,;]+$/g, "");
  return null;
}

/** Recent manual notes for one ticker (local browser storage — not synced to VPS). */
export function listManualFeedEventsForTicker(
  ticker: string,
  opts?: { maxAgeDays?: number; limit?: number },
): ManualFeedEventDraft[] {
  const tk = String(ticker ?? "").trim().toUpperCase();
  if (!tk) return [];
  const maxAge = opts?.maxAgeDays ?? 45;
  const limit = opts?.limit ?? 4;
  const cutoff = Date.now() - maxAge * 86400000;
  return loadManualFeedEvents()
    .filter((d) => String(d.ticker ?? "").trim().toUpperCase() === tk)
    .filter((d) => {
      const ms = Date.parse(`${d.eventDate ?? d.createdAt}T12:00:00`);
      return Number.isFinite(ms) ? ms >= cutoff : true;
    })
    .sort((a, b) => {
      const ta = Date.parse(`${a.eventDate ?? a.createdAt}T12:00:00`);
      const tb = Date.parse(`${b.eventDate ?? b.createdAt}T12:00:00`);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    })
    .slice(0, limit);
}

export function manualTickersWithEvents(
  drafts: ManualFeedEventDraft[] = loadManualFeedEvents(),
): Set<string> {
  const out = new Set<string>();
  for (const d of drafts) {
    const tk = normalizeTicker(d.ticker);
    if (tk) out.add(tk);
  }
  return out;
}

export function recordHasManualEvents(rec: ClinicalPreCdRecord): boolean {
  const events = rec.clinical_events ?? rec.timeline_events ?? [];
  return events.some((ev) => String(ev.source_type ?? "").toLowerCase() === "manual");
}

function cloneRecord(rec: ClinicalPreCdRecord): ClinicalPreCdRecord {
  return {
    ...rec,
    clinical_events: [...(rec.clinical_events ?? rec.timeline_events ?? [])],
    timeline_events: undefined,
  };
}

function syntheticRecordForManual(
  ticker: string,
  event: ClinicalPublicationEvent,
): ClinicalPreCdRecord {
  return {
    ticker,
    company: ticker,
    nct_id: `MANUAL-${ticker}`,
    sponsor_match: "Exact",
    clinical_events: [event],
    meta: {
      brief_title: `Manual news feed · ${ticker}`,
      phase: "—",
      overall_status: "Manual",
    },
  };
}

/** Merge user manual events into snapshot records (by ticker). */
export function mergeManualEventsIntoRecords(
  baseRecords: ClinicalPreCdRecord[],
  manualDrafts: ManualFeedEventDraft[] = loadManualFeedEvents(),
): ClinicalPreCdRecord[] {
  if (!manualDrafts.length) return baseRecords;

  const result = baseRecords.map(cloneRecord);
  const indexByTicker = new Map<string, number>();
  for (let i = 0; i < result.length; i += 1) {
    const tk = String(result[i]?.ticker ?? "").trim().toUpperCase();
    if (tk && !indexByTicker.has(tk)) indexByTicker.set(tk, i);
  }

  for (const draft of manualDrafts) {
    const tk = normalizeTicker(draft.ticker);
    if (!tk) continue;
    const pub = manualDraftToPublicationEvent(draft);
    const idx = indexByTicker.get(tk);
    if (idx != null) {
      const rec = result[idx]!;
      const events = rec.clinical_events ?? [];
      if (!events.some((e) => sameManualEvent(e, pub, draft.id))) {
        rec.clinical_events = [...events, pub];
      }
    } else {
      result.push(syntheticRecordForManual(tk, pub));
      indexByTicker.set(tk, result.length - 1);
    }
  }

  return result;
}

function sameManualEvent(
  ev: ClinicalPublicationEvent,
  pub: ClinicalPublicationEvent,
  draftId: string,
): boolean {
  if (String(ev.source_type ?? "").toLowerCase() !== "manual") return false;
  const note = String(ev.impact_note ?? "");
  return note.includes(draftId) || (
    ev.event_date === pub.event_date &&
    ev.event_title === pub.event_title
  );
}

/** Records visible in feed including manual-only tickers. */
export function mergeManualEventsForFeed(
  baseRecords: ClinicalPreCdRecord[],
): ClinicalPreCdRecord[] {
  const merged = mergeManualEventsIntoRecords(baseRecords);
  return merged.filter(
    (r) => isClinicalPreCdRecordTrusted(r) || String(r.nct_id ?? "").startsWith("MANUAL-"),
  );
}
