/**
 * Manual news EIS (clinical / financial / corporate) — sibling of market score,
 * mirrors automatic `eis_intrinsic` (KPI×10, not added into market).
 */
import { eisIntrinsicFromKpi } from "./eventImpactScore";
import type { ManualInvestigationOutcome } from "./manualFeedEvents";
import type { ManualMoveAttribution } from "./manualMoveAttribution";

export type ManualNewsEisKind = "clinical" | "financial" | "corporate";

const CLINICAL_RE =
  /\b(phase\s*[1234]|clinical|trial|nct\d+|endpoint|orr|pfs|os\b|dcr|cr\b|pr\b|patient|cohort|efficacy|biomarker|ash\b|asco|esmo|abstract|iopofosine|waldenstr|pdufa|bla\b|nda\b|ind\b)\b/i;

const FINANCIAL_RE =
  /\b(cash|equivalents|runway|earnings|revenue|eps\b|q[1-4]\s*20\d{2}|financial results|atm\b|offering|dilution|financing|burn|balance sheet|guidance|10-[qk]|net loss|operating expenses)\b/i;

const CORPORATE_RE =
  /\b(officer|director|appoint|resign|ceo\b|cfo\b|merger|acquisition|m&a|collaboration|license|partnership|nasdaq|corporate update|pipeline update|press release)\b/i;

export function classifyManualNewsEisKind(
  text: string,
  attribution?: ManualMoveAttribution | null,
  outcome?: ManualInvestigationOutcome | null,
): ManualNewsEisKind {
  const subtype = attribution?.eventSubtype ?? null;
  if (subtype === "clinical" || subtype === "regulatory") return "clinical";
  if (subtype === "financing") return "financial";
  if (subtype === "mna" || subtype === "lawsuit" || subtype === "analyst") return "corporate";

  const t = text.trim();
  const clin = CLINICAL_RE.test(t);
  const fin = FINANCIAL_RE.test(t);
  const corp = CORPORATE_RE.test(t);

  // Clinical language wins over company boilerplate ("Nasdaq | Company: …").
  if (clin && !fin) return "clinical";
  if (clin && fin) {
    // Earnings + clinical mention → financial if earnings dominate the lead.
    if (/^\s*(?:[A-Z]{1,6}\s*\(Nasdaq\)|company:|financial|cash|q[1-4])/i.test(t)) {
      return "financial";
    }
    return "clinical";
  }
  if (fin) return "financial";
  if (corp) return "corporate";
  if (outcome === "positive_catalyst" || outcome === "negative_catalyst") return "clinical";
  return "corporate";
}

/**
 * News quality in [-2, +2] — same scale as automatic kpi_score.
 * Outcome + sentiment drive polarity; kind slightly dampens non-clinical noise.
 */
export function scoreManualNewsKpi(args: {
  sentiment: number;
  investigationOutcome: ManualInvestigationOutcome;
  kind: ManualNewsEisKind;
}): number {
  let s = Math.max(-2, Math.min(2, args.sentiment));
  const outcome = args.investigationOutcome;

  if (outcome === "positive_catalyst") s = Math.max(s, 0.55);
  else if (outcome === "negative_catalyst") s = Math.min(s, -0.55);
  else if (outcome === "neutral") s *= 0.45;
  else if (outcome === "no_catalyst") s *= 0.2;

  if (args.kind === "financial") s *= 0.85;
  else if (args.kind === "corporate") s *= 0.75;

  return Math.round(Math.max(-2, Math.min(2, s)) * 1000) / 1000;
}

export function scoreManualNewsIntrinsic(args: {
  sentiment: number;
  investigationOutcome: ManualInvestigationOutcome;
  kind: ManualNewsEisKind;
}): { kpi_score: number; eis_intrinsic: number; kind: ManualNewsEisKind } {
  const kpi_score = scoreManualNewsKpi(args);
  return {
    kpi_score,
    eis_intrinsic: eisIntrinsicFromKpi(kpi_score) ?? 0,
    kind: args.kind,
  };
}

export function formatManualNewsEisShort(
  value: number | null | undefined,
  kind: ManualNewsEisKind,
): string | null {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.05) return null;
  const prefix = kind === "clinical" ? "clin" : kind === "financial" ? "fin" : "corp";
  return `${prefix} ${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

export function manualNewsEisKindLabel(kind: ManualNewsEisKind, it: boolean): string {
  if (kind === "clinical") return it ? "Clinico" : "Clinical";
  if (kind === "financial") return it ? "Finanziario" : "Financial";
  return it ? "Corporate" : "Corporate";
}
