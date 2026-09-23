/**
 * Semantic anomaly flags for automatic clinical / SEC feed events.
 * Complements numeric EIS drift checks — catches keyword misreads like manual KZIA financing.
 */

import { isMildStructuredFinancingResearch } from "./manualResearchEnrichment";

const AUTO_POSITIVE_RE =
  /\b(fda approv|approval granted|breakthrough therapy|topline met|met primary|beat estimate|raised guidance|upgrade to (?:buy|outperform)|orphan drug|fast track|priority review|positive data|statistically significant|pivotal success|commercial launch|milestone payment|encouraging (?:signs? of )?(?:activity|efficacy|benefit)|no treatment[- ]related serious adverse|endpoint met|complete response|partial response|nature medicine)\b/i;

const AUTO_NEGATIVE_RE =
  /\b(going concern|bankruptcy|chapter 11|delisting|fda (?:complete response|crL|reject)|trial (?:failed|missed|halt|discontinu)|missed (?:primary|endpoint)|clinical hold|complete response letter|downgrade to (?:sell|underperform)|layoff|workforce reduction|sec investigation|subpoena|fraud|accounting irregularit|warning letter|safety concern|patient death|mortality signal|failed to meet|topline miss|data disappoint|class[- ]action|strategic alternatives|wind[- ]?down|dilution|registered direct|private placement|atm offering|reverse merger)\b/i;

const NEGATED_ADVERSE_RE =
  /\bno (?:treatment[- ]related )?(?:serious )?adverse (?:events?|reactions?)\b/i;

export type AutoFeedSemanticFlag =
  | "text_positive_eis_negative"
  | "text_negative_eis_positive"
  | "financing_mild_strong_negative"
  | "kpi_positive_eis_negative"
  | "kpi_negative_eis_positive"
  | "price_up_eis_negative"
  | "price_down_eis_positive";

export function autoFeedEventText(
  title: string | null | undefined,
  summary: string | null | undefined,
  impactNote?: string | null,
): string {
  return [title, summary, impactNote].filter(Boolean).join("\n").trim();
}

function stripNegatedPhrases(text: string): string {
  return text
    .replace(NEGATED_ADVERSE_RE, " ")
    .replace(/\b(?:milder?|less|lower)\s+dilut(?:ion|ive)(?:\s+event)?\b/gi, " ");
}

export function detectAutoFeedSemanticFlags(args: {
  text: string;
  eisScore: number | null;
  kpiScore: number | null;
  deltaP1d: number | null;
}): AutoFeedSemanticFlag[] {
  const flags: AutoFeedSemanticFlag[] = [];
  const eis = args.eisScore;
  if (eis == null || !Number.isFinite(eis)) return flags;

  const raw = args.text.trim();
  if (!raw) return flags;
  const t = stripNegatedPhrases(raw);
  const d1 = args.deltaP1d;

  const posText = AUTO_POSITIVE_RE.test(t);
  const negText = AUTO_NEGATIVE_RE.test(t);
  const mildFin = isMildStructuredFinancingResearch(raw);

  if (posText && !negText && eis < -1) {
    const priceExplains = d1 != null && d1 <= -1.5;
    if (!priceExplains) flags.push("text_positive_eis_negative");
  }
  if (negText && !mildFin && eis > 1) {
    const priceExplains = d1 != null && d1 >= 1.5;
    if (!priceExplains) flags.push("text_negative_eis_positive");
  }
  if (mildFin && eis < -1) flags.push("financing_mild_strong_negative");

  const kpi = args.kpiScore;
  if (kpi != null && Number.isFinite(kpi)) {
    const priceExplainsNeg = d1 != null && d1 <= -2;
    const priceExplainsPos = d1 != null && d1 >= 2;
    if (kpi >= 0.6 && eis <= -1 && !priceExplainsNeg) flags.push("kpi_positive_eis_negative");
    if (kpi <= -0.6 && eis >= 1 && !priceExplainsPos) flags.push("kpi_negative_eis_positive");
  }

  if (d1 != null && Number.isFinite(d1) && Math.abs(d1) >= 2) {
    if (d1 > 0 && eis < -1) flags.push("price_up_eis_negative");
    if (d1 < 0 && eis > 1) flags.push("price_down_eis_positive");
  }

  return flags;
}
