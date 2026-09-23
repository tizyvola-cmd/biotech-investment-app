/**
 * Structured move-attribution fields for Manual EIS research templates.
 * Collected from labeled lines / body tags and reintroduced into EIS + residual.
 */

import type { EisBreakdown } from "./eventImpactScore";

/** Mirrors ManualInvestigationOutcome — kept local to avoid circular imports. */
type InvestigationOutcomeHint =
  | "no_catalyst"
  | "negative_catalyst"
  | "positive_catalyst"
  | "neutral";

export type ManualCauseClass =
  | "company_catalyst"
  | "sector_peer"
  | "market_noise"
  | "macro_geopolitical"
  | "liquidity_technical"
  | "mixed_unclear";

export type ManualExplainsMove = "full" | "partial" | "none";
export type ManualConfidence = "high" | "medium" | "low";

export type ManualEventSubtype =
  | "clinical"
  | "regulatory"
  | "financing"
  | "mna"
  | "analyst"
  | "lawsuit"
  | "macro_geo"
  | "sector_rotation"
  | "none";

export type ManualMoveContext = "loss" | "gain";
export type ManualHolderLens = "legacy_common" | "combined_entity" | "new_money";
export type ManualVolumeNote = "normal" | "elevated" | "thin" | "unknown";

export type ManualMoveAttribution = {
  causeClass?: ManualCauseClass | null;
  confidence?: ManualConfidence | null;
  explainsMove?: ManualExplainsMove | null;
  eventSubtype?: ManualEventSubtype | null;
  peerXbiSameDayPct?: number | null;
  learningTag?: string | null;
  geopoliticalOrMacro?: string | null;
  drugOrAsset?: string | null;
  nctOrFiling?: string | null;
  /** Legacy common dilution 0–100 (PIPE / reverse merger). */
  dilutionPct?: number | null;
  volumeNote?: ManualVolumeNote | null;
  moveContext?: ManualMoveContext | null;
  holderLens?: ManualHolderLens | null;
  /** false when DATA CONFLICT / VAR_24H not supplied. */
  priceVerified?: boolean | null;
};

const CAUSE_ALIASES: Record<string, ManualCauseClass> = {
  company_catalyst: "company_catalyst",
  catalyst: "company_catalyst",
  company: "company_catalyst",
  sector_peer: "sector_peer",
  peer: "sector_peer",
  sector: "sector_peer",
  market_noise: "market_noise",
  noise: "market_noise",
  oscillation: "market_noise",
  rumore: "market_noise",
  macro_geopolitical: "macro_geopolitical",
  macro: "macro_geopolitical",
  geopolitical: "macro_geopolitical",
  geo: "macro_geopolitical",
  liquidity_technical: "liquidity_technical",
  liquidity: "liquidity_technical",
  technical: "liquidity_technical",
  mixed_unclear: "mixed_unclear",
  mixed: "mixed_unclear",
  unclear: "mixed_unclear",
};

const EXPLAINS_ALIASES: Record<string, ManualExplainsMove> = {
  full: "full",
  complete: "full",
  yes: "full",
  partial: "partial",
  part: "partial",
  none: "none",
  no: "none",
};

const CONFIDENCE_ALIASES: Record<string, ManualConfidence> = {
  high: "high",
  alta: "high",
  medium: "medium",
  med: "medium",
  media: "medium",
  low: "low",
  bassa: "low",
};

const SUBTYPE_ALIASES: Record<string, ManualEventSubtype> = {
  clinical: "clinical",
  regulatory: "regulatory",
  financing: "financing",
  mna: "mna",
  "m&a": "mna",
  analyst: "analyst",
  lawsuit: "lawsuit",
  macro_geo: "macro_geo",
  macro: "macro_geo",
  geopolitical: "macro_geo",
  sector_rotation: "sector_rotation",
  none: "none",
  n_a: "none",
  na: "none",
};

function normKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s/-]+/g, "_");
}

export function normalizeManualCauseClass(raw: string): ManualCauseClass | null {
  return CAUSE_ALIASES[normKey(raw)] ?? null;
}

export function normalizeManualExplainsMove(raw: string): ManualExplainsMove | null {
  return EXPLAINS_ALIASES[normKey(raw)] ?? null;
}

export function normalizeManualConfidence(raw: string): ManualConfidence | null {
  // Accept "medium — event fully documented…" / "high, verified"
  const first = raw.trim().split(/[\s—–—,;|/]+/)[0] ?? "";
  return CONFIDENCE_ALIASES[normKey(first)] ?? CONFIDENCE_ALIASES[normKey(raw)] ?? null;
}

export function normalizeManualEventSubtype(raw: string): ManualEventSubtype | null {
  return SUBTYPE_ALIASES[normKey(raw)] ?? null;
}

function parsePctLoose(raw: string): number | null {
  const m = /(-?\d+(?:\.\d+)?)\s*%?/.exec(raw.trim());
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

const ATTR_LINE_RE =
  /^(CAUSE_CLASS|EXPLAINS_MOVE|CONFIDENCE|EVENT_SUBTYPE|PEER_XBI_SAME_DAY|XBI\s*SAME\s*DAY|LEARNING_TAG|GEOPOLITICAL_OR_MACRO|DRUG_OR_ASSET|NCT_OR_FILING|DILUTION_PCT|VOLUME_NOTE|MOVE_CONTEXT|HOLDER_LENS|PRICE_VERIFIED)\s*[:=]\s*(.+)$/im;

/** Parse structured attribution tags from free text (header fields or body after ---). */
export function parseManualMoveAttribution(text: string): ManualMoveAttribution | null {
  const t = text.trim();
  if (!t) return null;
  const out: ManualMoveAttribution = {};
  let hit = false;
  for (const line of t.split(/\r?\n/)) {
    const m = ATTR_LINE_RE.exec(line.trim());
    if (!m) continue;
    const key = m[1]!.toUpperCase();
    const val = (m[2] ?? "").trim();
    if (!val || /^n\/?a$/i.test(val) || val === "-" || val === "—") continue;
    hit = true;
    switch (key) {
      case "CAUSE_CLASS":
        out.causeClass = normalizeManualCauseClass(val);
        break;
      case "EXPLAINS_MOVE":
        out.explainsMove = normalizeManualExplainsMove(val);
        break;
      case "CONFIDENCE":
        out.confidence = normalizeManualConfidence(val);
        break;
      case "EVENT_SUBTYPE":
        out.eventSubtype = normalizeManualEventSubtype(val);
        break;
      case "PEER_XBI_SAME_DAY":
      case "XBI SAME DAY":
        if (!/not\s*supplied|n\/?a|unknown/i.test(val)) {
          out.peerXbiSameDayPct = parsePctLoose(val);
        }
        break;
      case "LEARNING_TAG":
        out.learningTag = val.slice(0, 80);
        break;
      case "GEOPOLITICAL_OR_MACRO":
        out.geopoliticalOrMacro = /^none$/i.test(val) ? "none" : val.slice(0, 240);
        break;
      case "DRUG_OR_ASSET":
        out.drugOrAsset = val.slice(0, 120);
        break;
      case "NCT_OR_FILING":
        out.nctOrFiling = val.slice(0, 120);
        break;
      case "DILUTION_PCT": {
        const d = parsePctLoose(val);
        if (d != null && d >= 0 && d <= 100) out.dilutionPct = d;
        break;
      }
      case "VOLUME_NOTE": {
        const k = normKey(val.split(/[\s—–,;|/]/)[0] ?? "");
        if (k === "normal" || k === "elevated" || k === "thin" || k === "unknown") {
          out.volumeNote = k;
        }
        break;
      }
      case "MOVE_CONTEXT": {
        const k = normKey(val.split(/[\s—–,;|/]/)[0] ?? "");
        if (k === "loss" || k === "gain") out.moveContext = k;
        break;
      }
      case "HOLDER_LENS": {
        const k = normKey(val);
        if (k === "legacy_common" || k === "legacy" || k === "common") out.holderLens = "legacy_common";
        else if (k === "combined_entity" || k === "combined" || k === "newco") out.holderLens = "combined_entity";
        else if (k === "new_money" || k === "pipe" || k === "new") out.holderLens = "new_money";
        break;
      }
      case "PRICE_VERIFIED": {
        const k = normKey(val.split(/[\s—–,;|/]/)[0] ?? "");
        if (k === "yes" || k === "true" || k === "verified") out.priceVerified = true;
        else if (k === "no" || k === "false" || k === "unverified") out.priceVerified = false;
        break;
      }
      default:
        break;
    }
  }
  return hit ? out : null;
}

export function mergeManualMoveAttribution(
  a: ManualMoveAttribution | null | undefined,
  b: ManualMoveAttribution | null | undefined,
): ManualMoveAttribution | null {
  if (!a && !b) return null;
  return {
    causeClass: b?.causeClass ?? a?.causeClass ?? null,
    confidence: b?.confidence ?? a?.confidence ?? null,
    explainsMove: b?.explainsMove ?? a?.explainsMove ?? null,
    eventSubtype: b?.eventSubtype ?? a?.eventSubtype ?? null,
    peerXbiSameDayPct: b?.peerXbiSameDayPct ?? a?.peerXbiSameDayPct ?? null,
    learningTag: b?.learningTag ?? a?.learningTag ?? null,
    geopoliticalOrMacro: b?.geopoliticalOrMacro ?? a?.geopoliticalOrMacro ?? null,
    drugOrAsset: b?.drugOrAsset ?? a?.drugOrAsset ?? null,
    nctOrFiling: b?.nctOrFiling ?? a?.nctOrFiling ?? null,
    dilutionPct: b?.dilutionPct ?? a?.dilutionPct ?? null,
    volumeNote: b?.volumeNote ?? a?.volumeNote ?? null,
    moveContext: b?.moveContext ?? a?.moveContext ?? null,
    holderLens: b?.holderLens ?? a?.holderLens ?? null,
    priceVerified: b?.priceVerified ?? a?.priceVerified ?? null,
  };
}

/** Map cause class → investigation outcome when OUTCOME is missing. */
export function investigationOutcomeFromCauseClass(
  cause: ManualCauseClass | null | undefined,
  priceChangePct: number | null | undefined,
  sentiment: number | null | undefined,
): InvestigationOutcomeHint | null {
  if (!cause) return null;
  if (
    cause === "market_noise" ||
    cause === "macro_geopolitical" ||
    cause === "liquidity_technical" ||
    cause === "sector_peer"
  ) {
    return "no_catalyst";
  }
  if (cause === "mixed_unclear") return "neutral";
  if (cause === "company_catalyst") {
    const move = priceChangePct != null && Number.isFinite(priceChangePct) ? priceChangePct : null;
    const sent = sentiment != null && Number.isFinite(sentiment) ? sentiment : 0;
    // Tone first: a scraped micro-tick must not flip distress research to positive_catalyst.
    if (sent <= -0.35) return "negative_catalyst";
    if (sent >= 0.35) return "positive_catalyst";
    if (move != null && move < -0.5) return "negative_catalyst";
    if (move != null && move > 0.5) return "positive_catalyst";
    return "neutral";
  }
  return null;
}

/**
 * Magnitude multiplier for EIS score from structured attribution.
 * Explains-move gates how much of the computed EIS should stick.
 */
export function manualAttributionScoreMultiplier(
  attr: ManualMoveAttribution | null | undefined,
): number {
  if (!attr) return 1;
  const conf =
    attr.confidence === "high" ? 1.08 : attr.confidence === "low" ? 0.88 : 1;
  let explains = 1;
  if (attr.explainsMove === "partial") explains = 0.72;
  else if (attr.explainsMove === "none") explains = 0.28;
  else if (attr.explainsMove === "full") explains = 1;

  let causeBoost = 1;
  if (attr.causeClass === "company_catalyst" && attr.explainsMove === "full") {
    causeBoost = 1.1;
  } else if (
    attr.causeClass === "market_noise" ||
    attr.causeClass === "macro_geopolitical" ||
    attr.causeClass === "liquidity_technical"
  ) {
    // Keep mild recovery-leaning EIS; do not amplify noise into fake catalysts.
    causeBoost = attr.explainsMove === "full" ? 1.05 : 0.95;
  } else if (attr.causeClass === "mixed_unclear") {
    causeBoost = 0.85;
  }

  return Math.max(0.15, Math.min(1.35, explains * conf * causeBoost));
}

export function applyManualAttributionToEis(
  breakdown: EisBreakdown,
  attr: ManualMoveAttribution | null | undefined,
  memoryMultiplier = 1,
): EisBreakdown {
  const m = manualAttributionScoreMultiplier(attr) * memoryMultiplier;
  if (Math.abs(m - 1) < 0.01) return breakdown;
  const score = Math.round(breakdown.score * m * 100) / 100;
  return { ...breakdown, score };
}

/**
 * Extra share of |observed| attributed to market when research says noise/geo.
 * Returns 0…0.55 additive share (before clamp against residual).
 */
export function manualAttributionMarketBoostShare(
  attr: ManualMoveAttribution | null | undefined,
): number {
  if (!attr?.causeClass) return 0;
  const noiseLike =
    attr.causeClass === "market_noise" ||
    attr.causeClass === "macro_geopolitical" ||
    attr.causeClass === "liquidity_technical" ||
    attr.causeClass === "sector_peer";
  if (!noiseLike) return 0;

  const explains =
    attr.explainsMove === "full" ? 1 : attr.explainsMove === "partial" ? 0.55 : 0.2;
  const conf = attr.confidence === "high" ? 1 : attr.confidence === "low" ? 0.55 : 0.8;

  let xbiAlign = 0.15;
  if (attr.peerXbiSameDayPct != null && Number.isFinite(attr.peerXbiSameDayPct)) {
    const abs = Math.abs(attr.peerXbiSameDayPct);
    if (abs >= 1.5) xbiAlign = 0.35;
    else if (abs >= 0.8) xbiAlign = 0.25;
  }

  return Math.min(0.55, (0.22 + xbiAlign) * explains * conf);
}

export function hasManualMoveAttribution(
  attr: ManualMoveAttribution | null | undefined,
): boolean {
  if (!attr) return false;
  return Boolean(
    attr.causeClass ||
      attr.explainsMove ||
      attr.confidence ||
      attr.eventSubtype ||
      attr.learningTag ||
      (attr.geopoliticalOrMacro && attr.geopoliticalOrMacro !== "none") ||
      attr.drugOrAsset ||
      attr.nctOrFiling ||
      attr.peerXbiSameDayPct != null ||
      attr.dilutionPct != null ||
      attr.volumeNote ||
      attr.moveContext ||
      attr.holderLens ||
      attr.priceVerified === false,
  );
}

/**
 * Extra share of |observed| attributed to company/EIS channel (dilution / M&A).
 * Complementary to marketBoost — used by residual breakdown.
 */
export function manualAttributionCompanyBoostShare(
  attr: ManualMoveAttribution | null | undefined,
): number {
  if (!attr?.causeClass || attr.causeClass !== "company_catalyst") return 0;
  const explains =
    attr.explainsMove === "full" ? 1 : attr.explainsMove === "partial" ? 0.55 : 0.25;
  const conf = attr.confidence === "high" ? 1 : attr.confidence === "low" ? 0.55 : 0.8;
  let dil = 0.12;
  if (attr.dilutionPct != null && Number.isFinite(attr.dilutionPct)) {
    if (attr.dilutionPct >= 70) dil = 0.4;
    else if (attr.dilutionPct >= 40) dil = 0.28;
    else if (attr.dilutionPct >= 20) dil = 0.18;
  } else if (attr.eventSubtype === "mna" || attr.eventSubtype === "financing") {
    dil = 0.22;
  }
  const lens =
    attr.holderLens === "legacy_common" ? 1.1 : attr.holderLens === "combined_entity" ? 0.7 : 1;
  return Math.min(0.5, (0.1 + dil) * explains * conf * lens);
}

export function formatAttributionImpactNote(attr: ManualMoveAttribution | null | undefined): string {
  if (!hasManualMoveAttribution(attr)) return "";
  const bits: string[] = [];
  if (attr?.causeClass) bits.push(attr.causeClass);
  if (attr?.explainsMove) bits.push(`explains:${attr.explainsMove}`);
  if (attr?.confidence) bits.push(`conf:${attr.confidence}`);
  if (attr?.learningTag) bits.push(attr.learningTag);
  return bits.length ? ` · attr:${bits.join("/")}` : "";
}
