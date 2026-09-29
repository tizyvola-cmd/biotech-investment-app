/**
 * Infer Manual EIS attribution + outcome hints from free-form Claude research
 * (JSPR-style reports) when CAUSE_CLASS / EXPLAINS_MOVE tags are missing.
 */

import type {
  ManualCauseClass,
  ManualEventSubtype,
  ManualExplainsMove,
  ManualMoveAttribution,
} from "./manualMoveAttribution";
import { mergeManualMoveAttribution } from "./manualMoveAttribution";

const PRICE_UNVERIFIED_RE =
  /\b(not\s*supplied|price\s+reaction\s+unverified|data\s+conflict|do\s+not\s+import|resolve\s+before\s+scoring|var_?24h\s*[:=]\s*not|unverified\s+(?:price|move|reaction))\b/i;

const TICKER_SPECIFIC_YES_RE =
  /\b(?:ticker[- ]specific|company[- ]specific)\s*[:=]?\s*yes\b|\bexclusive\s+to\s+[A-Z]{2,6}\b|\bmaterial,\s*company[- ]specific\b/i;

const REVERSE_MERGER_RE =
  /\b(reverse\s+merger|de\s+facto\s+reverse\s+merger|all[- ]stock\s+acquisition|acquisition\s+of\b.+\bwith\s+(?:a\s+)?concurrent.+(?:pipe|private\s+placement)|pipe\s+investors?\s*:?\s*\d)/i;

const HEAVY_DILUTION_RE =
  /\b(dilution\s+to\s+legacy(?:\s+common)?\s*[:=]?\s*~?\s*(?:9\d|[5-8]\d)\s*%|legacy\s+(?:common\s+)?(?:holders?|equity).{0,40}(?:6\.|5\.|4\.|3\.|2\.|1\.)\d+\s*%|pre[- ]deal\s+\w+\s+holders?\s*[:=]?\s*~?\s*(?:[1-9]|1\d)\.\d+\s*%)/i;

const FINANCING_RE =
  /\b(private\s+placement|registered\s+direct|atm\s+offering|dilutive\s+financing|preferred\s+stock\s+(?:financing|placement)|capital\s+raise|public\s+offering|(?:warrant|warrants)\s+(?:offering|financing|exercise))\b/i;

/** Warrant-heavy / partial upfront raise — dilution contingent or explicitly mild vs straight PIPE. */
export function isMildStructuredFinancingResearch(text: string): boolean {
  if (
    !/\b(capital\s+raise|public\s+offering|registered\s+direct|private\s+placement|warrants?\s+(?:offering|exercise|financing))\b/i.test(
      text,
    )
  ) {
    return false;
  }
  if (HEAVY_DILUTION_RE.test(text) || LEANS_NEGATIVE_RE.test(text)) return false;

  const mildLanguage =
    /\b(milder?\s+dilution|less\s+dilutive|mild\s+dilution|lower\s+dilution|dilution.{0,70}(?:not\s+stated|unknown|unquantified|percentage\s+is\s+not|cannot\s+be\s+calculated))\b/i.test(
      text,
    );
  const warrantCushion =
    /\bwarrants?\b/i.test(text) &&
    (/\b(?:strike|exercise\s+price).{0,50}(?:above|premium|\d+\s*%\s+above)\b/i.test(text) ||
      /\bcontingent\s+on.{0,60}warrant/i.test(text));
  const partialUpfront =
    /\b(?:only|guaranteed|upfront).{0,50}(?:\$|\d+\s+million).{0,90}contingent\b/i.test(text) ||
    /\bcontingent\s+on.{0,50}(?:investors?|warrant)/i.test(text);

  return mildLanguage || warrantCushion || partialUpfront;
}

const MNA_RE =
  /\b(acquisition|merger|buyout|take[- ]private|all[- ]stock\s+deal|combined\s+company)\b/i;

/** Distress board review — “sale / reverse merger / wind-down” is not a closed M&A catalyst. */
const DISTRESS_STRATEGIC_RE =
  /\b(strategic\s+alternatives?|wind[- ]?down|exploring\s+a\s+sale|no longer looks viable|formal\s+review\s+of\s+strategic|shell[- ]level\s+valuation|data[- ]integrity\s+question|class[- ]action)\b/i;

const CLOSED_MNA_RE =
  /\b(announced\s+completion|completion\s+of\s+the|completed\s+the|closed\s+the|definitive\s+agreement|all[- ]stock\s+acquisition\s+of)\b/i;

const LEANS_NEGATIVE_RE =
  /\b(leans?\s+negative_catalyst|prior\s+leans?\s+negative|weighted\s+negative\s+for\s+(?:the\s+)?(?:existing\s+)?(?:common\s+)?holder|near[- ]total\s+dilution)\b/i;

const LEANS_POSITIVE_RE =
  /\b(leans?\s+positive_catalyst|prior\s+leans?\s+positive|material\s+positive\s+for\s+(?:legacy|existing)\s+holders?)\b/i;

const MACRO_NO_RE =
  /\b(?:macro(?:\/geo)?|geopolitical(?:_or_macro)?)\s*[:=]?\s*(?:no\b|none\b|not\s+assessed|no\s+channel)\b/i;

/** Extract dilution % to legacy if present (0–100). */
export function parseLegacyDilutionPct(text: string): number | null {
  const patterns = [
    /dilution\s+to\s+legacy(?:\s+common)?\s*[:=]?\s*~?\s*(\d+(?:\.\d+)?)\s*%/i,
    /legacy\s+(?:common\s+)?(?:holders?|equity).{0,60}?(\d+(?:\.\d+)?)\s*%/i,
    /pre[- ]deal\s+\w+\s+holders?\s*[:=]?\s*~?\s*(\d+(?:\.\d+)?)\s*%/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const v = Number(m[1]);
    if (!Number.isFinite(v)) continue;
    // Prefer "dilution to legacy" (high %) over "pre-deal holders" (low %).
    if (/dilution/i.test(m[0]) && v >= 20 && v <= 100) return Math.round(v * 10) / 10;
    if (/pre[- ]deal/i.test(m[0]) && v > 0 && v <= 40) {
      const dilution = Math.round((100 - v) * 10) / 10;
      return dilution;
    }
  }
  return null;
}

export function researchPriceUnverified(text: string): boolean {
  return PRICE_UNVERIFIED_RE.test(text);
}

/** Build / enrich attribution from free-form research when tags are sparse. */
export function enrichManualAttributionFromResearch(
  text: string,
  base: ManualMoveAttribution | null | undefined,
): ManualMoveAttribution | null {
  const t = text.trim();
  if (!t) return base ?? null;

  let causeClass: ManualCauseClass | null = base?.causeClass ?? null;
  let eventSubtype: ManualEventSubtype | null = base?.eventSubtype ?? null;
  let explainsMove: ManualExplainsMove | null = base?.explainsMove ?? null;
  let learningTag: string | null = base?.learningTag ?? null;
  let geopoliticalOrMacro: string | null = base?.geopoliticalOrMacro ?? null;

  const distressStrategic = DISTRESS_STRATEGIC_RE.test(t);
  const closedMna = CLOSED_MNA_RE.test(t);

  if (!causeClass && TICKER_SPECIFIC_YES_RE.test(t)) {
    causeClass = "company_catalyst";
  }
  if (
    !causeClass &&
    (REVERSE_MERGER_RE.test(t) ||
      HEAVY_DILUTION_RE.test(t) ||
      MNA_RE.test(t) ||
      distressStrategic)
  ) {
    causeClass = "company_catalyst";
  }

  if (!eventSubtype) {
    if (distressStrategic && !closedMna && !HEAVY_DILUTION_RE.test(t)) {
      // Speculative sale / RM / wind-down language — not a closed M&A subtype.
    } else if (REVERSE_MERGER_RE.test(t) || (MNA_RE.test(t) && FINANCING_RE.test(t))) {
      eventSubtype = "mna";
    } else if (FINANCING_RE.test(t) && HEAVY_DILUTION_RE.test(t)) {
      eventSubtype = "financing";
    } else if (MNA_RE.test(t)) {
      eventSubtype = "mna";
    } else if (FINANCING_RE.test(t)) {
      eventSubtype = "financing";
    }
  } else if (
    eventSubtype === "mna" &&
    distressStrategic &&
    !closedMna &&
    !HEAVY_DILUTION_RE.test(t)
  ) {
    // Clear stale stored mna tags from distress notes that mention reverse merger as a risk.
    eventSubtype = null;
  }

  if (!explainsMove && researchPriceUnverified(t)) {
    // Event documented but price reaction not verified → do not claim full explain.
    explainsMove = "partial";
  }

  if (!geopoliticalOrMacro && MACRO_NO_RE.test(t)) {
    geopoliticalOrMacro = "none";
  }

  if (!learningTag) {
    if (REVERSE_MERGER_RE.test(t) && HEAVY_DILUTION_RE.test(t)) {
      learningTag = "reverse_merger_heavy_dilution";
    } else if (HEAVY_DILUTION_RE.test(t)) {
      learningTag = "legacy_dilution_event";
    } else if (distressStrategic) {
      learningTag = "strategic_review_distress";
    } else if (REVERSE_MERGER_RE.test(t)) {
      learningTag = "reverse_merger";
    }
  } else if (
    (learningTag === "reverse_merger" || learningTag.startsWith("reverse_merger_")) &&
    distressStrategic &&
    !HEAVY_DILUTION_RE.test(t) &&
    !closedMna
  ) {
    learningTag = "strategic_review_distress";
  }

  const dilutionPct = base?.dilutionPct ?? parseLegacyDilutionPct(t);
  let holderLens = base?.holderLens ?? null;
  if (!holderLens && (HEAVY_DILUTION_RE.test(t) || /legacy\s+(?:common\s+)?holder/i.test(t))) {
    holderLens = "legacy_common";
  }
  const priceVerified =
    base?.priceVerified ?? (researchPriceUnverified(t) ? false : null);

  const inferred: ManualMoveAttribution = {
    causeClass,
    eventSubtype,
    explainsMove,
    learningTag,
    geopoliticalOrMacro,
    confidence: base?.confidence ?? null,
    peerXbiSameDayPct: base?.peerXbiSameDayPct ?? null,
    drugOrAsset: base?.drugOrAsset ?? null,
    nctOrFiling: base?.nctOrFiling ?? (/\b8[- ]?K\b/i.test(t) ? "8-K" : null),
    dilutionPct,
    holderLens,
    priceVerified,
    volumeNote: base?.volumeNote ?? null,
    moveContext: base?.moveContext ?? null,
  };

  // Stash dilution in learning tag suffix when extreme (for memory buckets).
  if (dilutionPct != null && dilutionPct >= 70 && inferred.learningTag) {
    inferred.learningTag = `${inferred.learningTag}_${Math.round(dilutionPct)}pct`;
  }

  const merged = mergeManualMoveAttribution(base, inferred);
  // Avoid returning an empty shell that later flips EXPLAINS_MOVE and bypasses bare-template reject.
  if (!merged) return null;

  // merge() cannot clear fields with null — force-clear stale bullish M&A tags on distress notes.
  if (distressStrategic && !closedMna && !HEAVY_DILUTION_RE.test(t)) {
    if (merged.eventSubtype === "mna") merged.eventSubtype = null;
    if (
      merged.learningTag === "reverse_merger" ||
      (merged.learningTag?.startsWith("reverse_merger_") ?? false)
    ) {
      merged.learningTag = "strategic_review_distress";
    } else if (!merged.learningTag) {
      merged.learningTag = "strategic_review_distress";
    }
  }

  const meaningful = Boolean(
    merged.causeClass ||
      merged.eventSubtype ||
      merged.explainsMove ||
      merged.learningTag ||
      merged.confidence ||
      merged.peerXbiSameDayPct != null ||
      merged.drugOrAsset ||
      merged.nctOrFiling ||
      merged.dilutionPct != null ||
      merged.holderLens ||
      merged.priceVerified === false ||
      (merged.geopoliticalOrMacro && merged.geopoliticalOrMacro !== "none"),
  );
  return meaningful ? merged : base ?? null;
}

export type ResearchOutcomeHint =
  | "no_catalyst"
  | "negative_catalyst"
  | "positive_catalyst"
  | "neutral";

/**
 * When Claude says OUTCOME:neutral but prose leans hard (dilution / reverse merger),
 * upgrade for scoring. Price-unverified keeps magnitude soft via EXPLAINS_MOVE.
 */
export function refineOutcomeFromResearchProse(
  text: string,
  explicitOutcome: ResearchOutcomeHint | null,
  sentiment: number | null,
): ResearchOutcomeHint | null {
  const t = text.trim();
  if (!t) return explicitOutcome;

  if (
    LEANS_NEGATIVE_RE.test(t) ||
    (HEAVY_DILUTION_RE.test(t) && REVERSE_MERGER_RE.test(t)) ||
    DISTRESS_STRATEGIC_RE.test(t)
  ) {
    if (explicitOutcome == null || explicitOutcome === "neutral") {
      return "negative_catalyst";
    }
  }
  if (LEANS_POSITIVE_RE.test(t) && (explicitOutcome == null || explicitOutcome === "neutral")) {
    return "positive_catalyst";
  }

  // Neutral + clearly negative sentiment + company dilution → negative_catalyst
  if (
    (explicitOutcome === "neutral" || explicitOutcome == null) &&
    sentiment != null &&
    sentiment <= -0.75 &&
    (HEAVY_DILUTION_RE.test(t) || REVERSE_MERGER_RE.test(t) || DISTRESS_STRATEGIC_RE.test(t))
  ) {
    return "negative_catalyst";
  }

  return explicitOutcome;
}

/** Prefer EVENT section first sentence as title for free-form research. */
export function extractResearchEventTitle(text: string, ticker?: string): string | null {
  const eventBlock =
    /\bEVENT\b\s*\n([\s\S]{20,400}?)(?:\n\s*\n|\nSTRUCTURE\b|\nSENTIMENT\b|\nTICKER\b|\nOUTCOME\b|\nDATA\s+CONFLICT\b)/i.exec(
      text,
    ) ?? /\bEVENT\b\s*\n([^\n]+(?:\n(?![A-Z][A-Z_ ]{2,}:)[^\n]+){0,3})/i.exec(text);
  if (!eventBlock) return null;
  const prose = eventBlock[1]!.replace(/\s+/g, " ").trim();
  if (prose.length < 20) return null;
  const sentence = prose.split(/(?<=[.!?])\s+/)[0] ?? prose;
  const cut = sentence.slice(0, 160).trim();
  if (ticker && !cut.toUpperCase().includes(ticker.toUpperCase())) {
    return `${ticker}: ${cut}`.slice(0, 160);
  }
  return cut;
}

/** FIRST_TRADABLE / EVENT_DATE → prefer first tradable session for eventDate when AMC. */
export function extractResearchEventDate(text: string): string | null {
  const firstTradable = /\bFIRST_TRADABLE\s*[:=]\s*(20\d{2}-\d{2}-\d{2})/i.exec(text);
  if (firstTradable) return firstTradable[1]!;
  const eventDate = /\bEVENT_DATE\s*[:=]\s*(20\d{2}-\d{2}-\d{2})/i.exec(text);
  if (eventDate) return eventDate[1]!;
  return null;
}
