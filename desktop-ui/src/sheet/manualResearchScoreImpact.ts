/**
 * Multi-index impact map for Manual EIS research.
 * Turns a parsed research block into an explicit list of which product scores
 * are enriched (and how) — used in preview + as a contract for Claude output.
 */

import type { EisBreakdown } from "./eventImpactScore";
import type { ManualInvestigationOutcome, ParsedManualFeedInput } from "./manualFeedEvents";
import {
  hasManualMoveAttribution,
  manualAttributionMarketBoostShare,
  type ManualMoveAttribution,
} from "./manualMoveAttribution";
import { parseLegacyDilutionPct } from "./manualResearchEnrichment";

export type ManualScoreIndexId =
  | "eis"
  | "ticker_eis"
  | "nearest_eis_pplan"
  | "decision_chart"
  | "residual"
  | "fragility"
  | "gain_star"
  | "gap_investigation"
  | "attribution_memory"
  | "mobile_eis"
  | "rescue_context"
  | "sds_overlay";

export type ManualScoreImpactRow = {
  id: ManualScoreIndexId;
  /** Short label IT/EN resolved by caller via lang. */
  labelEn: string;
  labelIt: string;
  /** How strongly this research hits the index. */
  strength: "direct" | "indirect" | "context" | "none";
  direction: "up" | "down" | "mixed" | "neutral" | "n/a";
  /** One-line mechanism. */
  noteEn: string;
  noteIt: string;
};

export type ManualResearchScoreImpact = {
  ticker: string;
  outcome: ManualInvestigationOutcome | null;
  eisScore: number | null;
  attribution: ManualMoveAttribution | null;
  dilutionPct: number | null;
  priceUnverified: boolean;
  rows: ManualScoreImpactRow[];
  /** Compact chips for UI. */
  chips: string[];
};

function dirFromEis(
  outcome: ManualInvestigationOutcome | null,
  eis: number | null,
): ManualScoreImpactRow["direction"] {
  if (eis != null && eis > 0.4) return "up";
  if (eis != null && eis < -0.4) return "down";
  if (outcome === "positive_catalyst") return "up";
  if (outcome === "negative_catalyst") return "down";
  if (outcome === "no_catalyst") return "mixed";
  return "neutral";
}

/**
 * Build the multi-index impact report for a parsed Manual EIS research block.
 * Pure — does not mutate scores; documents + drives UI / future wiring.
 */
export function buildManualResearchScoreImpact(args: {
  parsed: ParsedManualFeedInput;
  eis: EisBreakdown | null;
}): ManualResearchScoreImpact {
  const { parsed, eis } = args;
  const attr = parsed.attribution;
  const outcome = parsed.investigationOutcome;
  const eisScore = eis?.score ?? null;
  const dir = dirFromEis(outcome, eisScore);
  const blob = `${parsed.title}\n${parsed.body}`;
  const dilutionPct =
    (attr?.dilutionPct != null && Number.isFinite(attr.dilutionPct)
      ? attr.dilutionPct
      : null) ??
    parseLegacyDilutionPct(blob) ??
    (attr?.learningTag?.match(/_(\d{2,3})pct\b/)
      ? Number(attr.learningTag.match(/_(\d{2,3})pct\b/)![1])
      : null);
  const priceUnverified =
    parsed.parseWarnings.includes("price_unverified") || parsed.priceDropPct == null;
  const noiseLike =
    attr?.causeClass === "market_noise" ||
    attr?.causeClass === "macro_geopolitical" ||
    attr?.causeClass === "sector_peer" ||
    attr?.causeClass === "liquidity_technical";
  const companyLike = attr?.causeClass === "company_catalyst" || outcome === "negative_catalyst" || outcome === "positive_catalyst";
  const marketBoost = manualAttributionMarketBoostShare(attr);
  const hasAttr = hasManualMoveAttribution(attr);

  const rows: ManualScoreImpactRow[] = [
    {
      id: "eis",
      labelEn: "Manual EIS (event score)",
      labelIt: "EIS manuale (score evento)",
      strength: "direct",
      direction: dir,
      noteEn: priceUnverified
        ? "Sentiment + outcome only (VAR_24H unverified — soft magnitude)."
        : "Outcome × VAR_24H × sentiment × attribution multipliers.",
      noteIt: priceUnverified
        ? "Solo sentiment + outcome (VAR_24H non verificata — magnitudine soft)."
        : "Outcome × VAR_24H × sentiment × moltiplicatori attribution.",
    },
    {
      id: "ticker_eis",
      labelEn: "Ticker EIS aggregate",
      labelIt: "EIS aggregato ticker",
      strength: "direct",
      direction: dir,
      noteEn: "Merges into clinical feed; can become the ticker's strongest |EIS|.",
      noteIt: "Entra nel feed clinico; può diventare l'|EIS| dominante del ticker.",
    },
    {
      id: "nearest_eis_pplan",
      labelEn: "Nearest EIS → P(plan)",
      labelIt: "EIS più vicino → P(plan)",
      strength: "indirect",
      direction: dir,
      noteEn: "Recovery / entry P(plan) uses nearest EIS factor (buckets ±).",
      noteIt: "P(plan) recovery/entry usa il fattore nearest EIS (bucket ±).",
    },
    {
      id: "decision_chart",
      labelEn: "Decision chart (Buy/Hold/Sell)",
      labelIt: "Decision chart (Buy/Hold/Sell)",
      strength: "indirect",
      direction: dir,
      noteEn: "eis / eisRaw axes; ★ only if material catalyst + qualifying score.",
      noteIt: "Assi eis / eisRaw; ★ solo se catalyst materiale + score idoneo.",
    },
    {
      id: "residual",
      labelEn: "Residual move attribution",
      labelIt: "Attribuzione residuale del move",
      strength: noiseLike || companyLike ? "direct" : "context",
      direction: noiseLike ? "up" : companyLike ? "down" : "neutral",
      noteEn: noiseLike
        ? `Market channel boost ~${Math.round(marketBoost * 100)}% (noise/geo explains move).`
        : companyLike
          ? dilutionPct != null && dilutionPct >= 50
            ? `Company channel — legacy dilution ~${dilutionPct}% (not market noise).`
            : "Company catalyst — more residual explained by EIS, less by XBI."
          : "Counts as manual note; limited residual effect without cause class.",
      noteIt: noiseLike
        ? `Boost canale mercato ~${Math.round(marketBoost * 100)}% (rumore/geo spiega il move).`
        : companyLike
          ? dilutionPct != null && dilutionPct >= 50
            ? `Canale company — diluzione legacy ~${dilutionPct}% (non rumore di mercato).`
            : "Catalyst company — più residual spiegato da EIS, meno da XBI."
          : "Conta come nota manuale; effetto residual limitato senza cause class.",
    },
    {
      id: "fragility",
      labelEn: "Feed fragility / EIS window",
      labelIt: "Fragilità feed / finestra EIS",
      strength: "indirect",
      direction: eisScore != null && eisScore < 0 ? "down" : eisScore != null && eisScore > 0 ? "up" : "neutral",
      noteEn: "Window sum of EIS events (incl. manual) feeds fragility helpers.",
      noteIt: "Somma EIS in finestra (incluso manuale) alimenta i helper di fragilità.",
    },
    {
      id: "gain_star",
      labelEn: "Gain ★ / Manual EIS confirmed",
      labelIt: "Gain ★ / EIS manuale confermato",
      strength:
        outcome === "positive_catalyst" || outcome === "negative_catalyst" ? "direct" : "none",
      direction: outcome === "positive_catalyst" ? "up" : outcome === "negative_catalyst" ? "down" : "n/a",
      noteEn:
        outcome === "no_catalyst" || outcome === "neutral"
          ? "No ★ — oscillation / neutral does not qualify."
          : "★ when catalyst is material and score qualifies for the day.",
      noteIt:
        outcome === "no_catalyst" || outcome === "neutral"
          ? "Niente ★ — oscillazione / neutral non qualificano."
          : "★ se il catalyst è materiale e lo score del giorno qualifica.",
    },
    {
      id: "gap_investigation",
      labelEn: "Gap investigation context",
      labelIt: "Contesto gap investigation",
      strength: "context",
      direction: "neutral",
      noteEn: hasAttr
        ? `newsType from outcome/subtype (${attr?.eventSubtype ?? outcome ?? "—"}).`
        : "Marks hasSpecificNews from outcome text.",
      noteIt: hasAttr
        ? `newsType da outcome/subtype (${attr?.eventSubtype ?? outcome ?? "—"}).`
        : "Segna hasSpecificNews dall'outcome.",
    },
    {
      id: "attribution_memory",
      labelEn: "Attribution memory (priors)",
      labelIt: "Memoria attribution (prior)",
      strength: hasAttr ? "direct" : "none",
      direction: "neutral",
      noteEn: hasAttr
        ? `Buckets by ${attr?.causeClass ?? "cause"} / ${attr?.learningTag ?? "tag"} for future EIS priors.`
        : "No structured tags — memory not updated.",
      noteIt: hasAttr
        ? `Bucket su ${attr?.causeClass ?? "causa"} / ${attr?.learningTag ?? "tag"} per prior EIS futuri.`
        : "Niente tag strutturati — memoria non aggiornata.",
    },
    {
      id: "mobile_eis",
      labelEn: "Mobile snapshot EIS",
      labelIt: "EIS snapshot mobile",
      strength: "indirect",
      direction: dir,
      noteEn: "Published via dashboard snapshot after desktop save.",
      noteIt: "Pubblicato nello snapshot dashboard dopo il salvataggio desktop.",
    },
    {
      id: "rescue_context",
      labelEn: "Rescue / Resilience (context)",
      labelIt: "Rescue / Resilience (contesto)",
      strength: "context",
      direction: "n/a",
      noteEn:
        "Resilience score stays price/XBI-only; manual research is cause context for the panel, not the 0–100 score.",
      noteIt:
        "Resilience resta solo prezzo/XBI; la ricerca manuale è contesto di causa nel panel, non lo score 0–100.",
    },
    {
      id: "sds_overlay",
      labelEn: "SDS cause overlay (soft)",
      labelIt: "Overlay causa SDS (soft)",
      strength: companyLike || noiseLike ? "context" : "none",
      direction: noiseLike ? "up" : companyLike ? "down" : "n/a",
      noteEn: noiseLike
        ? "Suggests external/market alignment (not a backend SDS rewrite)."
        : companyLike
          ? dilutionPct != null && dilutionPct >= 70
            ? "Suggests internal/structural cause (heavy dilution / reverse merger)."
            : "Suggests company-specific news cause."
          : "No SDS overlay without cause class.",
      noteIt: noiseLike
        ? "Suggerisce allineamento esterno/mercato (non riscrive SDS backend)."
        : companyLike
          ? dilutionPct != null && dilutionPct >= 70
            ? "Suggerisce causa interna/strutturale (diluzione / reverse merger)."
            : "Suggerisce causa news company-specific."
          : "Nessun overlay SDS senza cause class.",
    },
  ];

  const chips: string[] = [];
  if (eisScore != null) chips.push(`EIS ${eisScore >= 0 ? "+" : ""}${eisScore.toFixed(1)}`);
  if (outcome) chips.push(outcome);
  if (attr?.causeClass) chips.push(attr.causeClass);
  if (attr?.eventSubtype && attr.eventSubtype !== "none") chips.push(attr.eventSubtype);
  if (attr?.explainsMove) chips.push(`explains:${attr.explainsMove}`);
  if (dilutionPct != null) chips.push(`dilution ${dilutionPct}%`);
  if (priceUnverified) chips.push("price‽");
  if (noiseLike) chips.push("→ residual market");
  if (companyLike) chips.push("→ P(plan)/decision");

  return {
    ticker: parsed.ticker,
    outcome,
    eisScore,
    attribution: attr,
    dilutionPct: dilutionPct != null && Number.isFinite(dilutionPct) ? dilutionPct : null,
    priceUnverified,
    rows,
    chips,
  };
}

/** Parse SCORE_TARGETS: block from Claude research body. */
export function parseScoreTargetsBlock(
  text: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const m =
    /\bSCORE_TARGETS\s*:?\s*\n([\s\S]*?)(?=\n\s*DATA CONFLICT|\n\s*TO RESOLVE|\n\s*SOURCES_CHECKED|\n\s*LEARNING_TAG\b|$)/i.exec(
      text,
    );
  const block = m?.[1] ?? "";
  for (const line of block.split(/\r?\n/)) {
    const lm = /^\s*([A-Z][A-Z0-9_/]+)\s*:\s*(.+?)\s*$/.exec(line.trim());
    if (!lm) continue;
    const key = lm[1]!.toUpperCase();
    if (key === "NOTE") continue;
    out[key] = lm[2]!.trim();
  }
  return out;
}

export type ManualCatalystPreviewCard = {
  headline: string;
  eventDate: string;
  outcome: string;
  subtype: string | null;
  holderLens: string | null;
  dilutionPct: number | null;
  filing: string | null;
  drugs: string | null;
  priceVerified: boolean;
  var24h: string | null;
  eisLabel: string | null;
  /** Compact catalyst facts (max ~5). */
  facts: string[];
  /** Correlated score effects (catalyst → indices). */
  effects: Array<{ label: string; value: string; tone: "up" | "down" | "mixed" | "neutral" }>;
};

function toneFromText(s: string): "up" | "down" | "mixed" | "neutral" {
  const t = s.toLowerCase();
  if (/\b(down|negative|void|sell|bear|↓|-)\b/.test(t)) return "down";
  if (/\b(up|positive|buy|bull|↑|\+)\b/.test(t)) return "up";
  if (/\b(mixed|partial|neutral|re-anchor|unknown)\b/.test(t)) return "mixed";
  return "neutral";
}

/**
 * Compact "specchietto" for Manual Feed preview — catalyst + correlated effects only.
 * Hides long research prose (WHAT_HAPPENED / COUNTER_EVIDENCE / SOURCES).
 */
export function buildManualCatalystPreviewCard(args: {
  parsed: ParsedManualFeedInput;
  eis: EisBreakdown | null;
  lang: "it" | "en";
}): ManualCatalystPreviewCard {
  const impact = buildManualResearchScoreImpact({
    parsed: args.parsed,
    eis: args.eis,
  });
  const it = args.lang === "it";
  const attr = args.parsed.attribution;
  const blob = `${args.parsed.title}\n${args.parsed.body}`;
  const targets = parseScoreTargetsBlock(blob);
  const dilution = impact.dilutionPct ?? attr?.dilutionPct ?? null;

  const outcomeRaw = args.parsed.investigationOutcome;
  const outcome =
    outcomeRaw === "negative_catalyst"
      ? it
        ? "Catalyst negativo"
        : "Negative catalyst"
      : outcomeRaw === "positive_catalyst"
        ? it
          ? "Catalyst positivo"
          : "Positive catalyst"
        : outcomeRaw === "no_catalyst"
          ? it
            ? "Nessun catalyst (rumore/macro)"
            : "No catalyst (noise/macro)"
          : it
            ? "Neutro"
            : "Neutral";

  const facts: string[] = [];
  if (attr?.causeClass) {
    facts.push(
      it ? `Causa: ${attr.causeClass}` : `Cause: ${attr.causeClass}`,
    );
  }
  if (attr?.explainsMove) {
    facts.push(
      it
        ? `Spiega il move: ${attr.explainsMove}`
        : `Explains move: ${attr.explainsMove}`,
    );
  }
  if (attr?.holderLens) {
    facts.push(
      it ? `Lente holder: ${attr.holderLens}` : `Holder lens: ${attr.holderLens}`,
    );
  }
  if (dilution != null) {
    facts.push(
      it
        ? `Diluzione legacy: ${dilution}%`
        : `Legacy dilution: ${dilution}%`,
    );
  }
  if (impact.priceUnverified || attr?.priceVerified === false) {
    facts.push(
      it
        ? "Prezzo non verificato — EIS soft"
        : "Price unverified — soft EIS",
    );
  }
  if (attr?.learningTag) {
    facts.push(`Tag: ${attr.learningTag}`);
  }

  const effects: ManualCatalystPreviewCard["effects"] = [];
  const eisScore = impact.eisScore;
  effects.push({
    label: "EIS",
    value:
      eisScore != null
        ? `${eisScore >= 0 ? "+" : ""}${eisScore.toFixed(1)}${
            targets.EIS ? ` · ${targets.EIS}` : ""
          }`
        : targets.EIS ?? (it ? "n/d" : "n/a"),
    tone:
      eisScore != null && eisScore < 0
        ? "down"
        : eisScore != null && eisScore > 0
          ? "up"
          : toneFromText(targets.EIS ?? ""),
  });

  const residualVal =
    targets.RESIDUAL ??
    (attr?.causeClass === "company_catalyst"
      ? "company"
      : attr?.causeClass === "market_noise" || attr?.causeClass === "macro_geopolitical"
        ? "market"
        : "mixed");
  effects.push({
    label: it ? "Residual" : "Residual",
    value: residualVal,
    tone:
      residualVal === "company"
        ? "down"
        : residualVal === "market"
          ? "up"
          : "mixed",
  });

  const pplan = targets.P_PLAN_VIA_EIS ?? (eisScore != null && eisScore < 0 ? "down" : eisScore != null && eisScore > 0 ? "up" : "neutral");
  effects.push({
    label: "P(plan)",
    value: pplan,
    tone: toneFromText(pplan),
  });

  if (targets.DECISION_CHART) {
    effects.push({
      label: it ? "Decision" : "Decision",
      value: targets.DECISION_CHART.slice(0, 100),
      tone: toneFromText(targets.DECISION_CHART),
    });
  } else {
    effects.push({
      label: it ? "Decision" : "Decision",
      value: it ? "via eisRaw" : "via eisRaw",
      tone: eisScore != null && eisScore < 0 ? "down" : eisScore != null && eisScore > 0 ? "up" : "neutral",
    });
  }

  const gainStar =
    targets.GAIN_STAR ??
    (outcomeRaw === "positive_catalyst" || outcomeRaw === "negative_catalyst"
      ? outcomeRaw === "positive_catalyst"
        ? "yes"
        : "no"
      : "no");
  effects.push({
    label: "Gain ★",
    value: gainStar,
    tone: /^yes/i.test(gainStar) ? "up" : "neutral",
  });

  // Memory / mobile as short correlated effects
  if (attr?.causeClass || attr?.learningTag) {
    effects.push({
      label: it ? "Memoria" : "Memory",
      value: attr.learningTag ?? attr.causeClass ?? "—",
      tone: "neutral",
    });
  }

  return {
    headline: (args.parsed.title || args.parsed.ticker).trim(),
    eventDate: args.parsed.eventDate,
    outcome,
    subtype: attr?.eventSubtype && attr.eventSubtype !== "none" ? attr.eventSubtype : null,
    holderLens: attr?.holderLens ?? null,
    dilutionPct: dilution,
    filing: attr?.nctOrFiling ?? null,
    drugs: attr?.drugOrAsset ?? null,
    priceVerified: !(impact.priceUnverified || attr?.priceVerified === false),
    var24h:
      args.parsed.priceDropPct != null
        ? `${args.parsed.priceDropPct >= 0 ? "+" : ""}${args.parsed.priceDropPct.toFixed(1)}%`
        : null,
    eisLabel:
      eisScore != null
        ? `${eisScore >= 0 ? "+" : ""}${eisScore.toFixed(1)}`
        : null,
    facts: facts.slice(0, 6),
    effects,
  };
}

/** Claude-facing contract: which score keys a rich research block should target. */
export const MANUAL_RESEARCH_SCORE_CONTRACT = `
SCORE_TARGETS (fill what you can — app maps these into indices):
  EIS:                 required — OUTCOME + SENTIMENT + VAR_24H when known
  TICKER_EIS:          auto from EIS merge
  P_PLAN:              via nearest EIS (sign matters)
  DECISION_CHART:      via eisRaw; ★ only for ±catalyst
  RESIDUAL_MARKET:     set CAUSE_CLASS=market_noise|macro_geopolitical + EXPLAINS_MOVE + PEER_XBI_SAME_DAY
  RESIDUAL_COMPANY:    set CAUSE_CLASS=company_catalyst + EVENT_SUBTYPE + DILUTION_PCT if financing/M&A
  FRAGILITY_WINDOW:    auto from EIS window sum
  GAIN_STAR:           only positive_catalyst / negative_catalyst with material move
  GAP_CONTEXT:         OUTCOME + EVENT_SUBTYPE
  ATTRIBUTION_MEMORY:  LEARNING_TAG + CAUSE_CLASS (trains future priors)
  RESCUE_RESILIENCE:   NOT overwritten (price/XBI only) — provide cause context only
  SDS_BACKEND:         NOT overwritten — soft overlay via cause class only

EXTRA FIELDS (enrich more indices):
  DILUTION_PCT:        0–100 legacy common dilution (M&A / PIPE)
  VOLUME_NOTE:         normal|elevated|thin|unknown
  MOVE_CONTEXT:        loss|gain
  PRICE_VERIFIED:      yes|no
  HOLDER_LENS:         legacy_common|combined_entity|new_money
`.trim();
