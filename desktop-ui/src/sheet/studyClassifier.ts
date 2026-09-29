/**
 * Classifica descrizioni studio/regolatorio in drug vs device vs uncertain.
 * Basato su keyword/regole — non sostituisce review umana su casi borderline.
 */

export type StudyClass = "drug" | "device" | "uncertain";
export type StudyConfidence = "high" | "medium" | "low";

export type StudyClassification = {
  klass: StudyClass;
  confidence: StudyConfidence;
  drugScore: number;
  deviceScore: number;
  matchedDrug: string[];
  matchedDevice: string[];
};

type WeightedRule = { re: RegExp; weight: number; label: string };

const DEVICE_RULES: WeightedRule[] = [
  { re: /\b510\s*\(\s*k\s*\)|\b510k\b/i, weight: 8, label: "510(k)" },
  { re: /\bpredicate\s+device\b/i, weight: 7, label: "predicate device" },
  { re: /\bmethod\s+comparison\b/i, weight: 4, label: "method comparison" },
  { re: /\bpma\b|\bpremarket\s+approval\b/i, weight: 7, label: "PMA" },
  { re: /\bde\s+novo\b/i, weight: 6, label: "de novo" },
  { re: /\bmedical\s+device\b/i, weight: 6, label: "medical device" },
  { re: /\bin\s+vitro\s+diagnostic\b|\bivd\b/i, weight: 5, label: "IVD" },
  { re: /\bdiagnostic\s+system\b/i, weight: 4, label: "diagnostic system" },
  { re: /\bdrug\s+screening\s+system\b/i, weight: 5, label: "drug screening system" },
  { re: /\bfingerprint(?:ing)?\b/i, weight: 3, label: "fingerprinting" },
  { re: /\blc-ms\s*\/?\s*ms\b/i, weight: 3, label: "LC-MS/MS" },
  { re: /\bwearable\b|\bimplantable\s+device\b/i, weight: 4, label: "wearable/implant" },
  { re: /\bsoftware\s+as\s+a\s+medical\s+device\b|\bsamd\b/i, weight: 5, label: "SaMD" },
  { re: /\btympanic\s+membrane\b|\bmembrane\s+device\b/i, weight: 6, label: "tympanic membrane device" },
  { re: /\b(?:mr-?)?hifu\b|\btulsa\b|\bablation\s+system\b/i, weight: 5, label: "HIFU/ablation system" },
  { re: /\bearly\s+detection\b|\bmulti-?cancer\b|\bmc\s*ed\b|\bgalleri\b/i, weight: 5, label: "early-detection IVD" },
  { re: /\bcytopheretic\b|\bselective\s+cytopheretic\b|\bquelimmune\b/i, weight: 6, label: "cytopheretic device" },
];

const DRUG_RULES: WeightedRule[] = [
  { re: /\bphase\s*(?:1\s*\/\s*2|2\s*\/\s*3|[1234])\b/i, weight: 7, label: "clinical phase" },
  { re: /\bphase\s+[1234]\b/i, weight: 7, label: "clinical phase" },
  { re: /\b(?:bla|nda|ind)\b/i, weight: 6, label: "BLA/NDA/IND" },
  { re: /\bpivotal\b|\bregistration(?:al)?\s+trial\b/i, weight: 5, label: "pivotal/registration" },
  { re: /\bdose\s+escalation\b/i, weight: 4, label: "dose escalation" },
  { re: /\b(?:monoclonal|mab|antibody|biologic|small\s+molecule)\b/i, weight: 4, label: "biologic/drug modality" },
  { re: /\b(?:engager|inhibitor|agonist|antagonist|vaccine|gene\s+therapy|cell\s+therapy)\b/i, weight: 4, label: "drug modality" },
  { re: /\b(?:oncology|chemotherapy|immunotherapy)\b/i, weight: 3, label: "therapy area" },
  { re: /\breadout\b|\btrial\s+of\s+[a-z0-9-]{3,}\b/i, weight: 3, label: "trial/readout" },
  { re: /\bplacebo(?:-|\s)?controlled\b/i, weight: 4, label: "placebo-controlled" },
  { re: /\b(?:sonelokimab|tovecimig|diranersen|resmetirom)\b/i, weight: 5, label: "named drug" },
];

/** Keyword labels matched in study text (drug / biologic). */
export const STUDY_DRUG_KEYWORD_LABELS: readonly string[] = DRUG_RULES.map((r) => r.label);

/** Keyword labels matched in study text (device / IVD / 510k). */
export const STUDY_DEVICE_KEYWORD_LABELS: readonly string[] = DEVICE_RULES.map((r) => r.label);

function normalizeStudyText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function scoreRules(text: string, rules: WeightedRule[]): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];
  for (const rule of rules) {
    if (rule.re.test(text)) {
      score += rule.weight;
      matched.push(rule.label);
    }
  }
  return { score, matched };
}

function resolveConfidence(
  klass: StudyClass,
  drugScore: number,
  deviceScore: number,
): StudyConfidence {
  if (klass === "uncertain") {
    const top = Math.max(drugScore, deviceScore);
    if (top <= 2) return "low";
    return "medium";
  }
  const winner = klass === "drug" ? drugScore : deviceScore;
  const loser = klass === "drug" ? deviceScore : drugScore;
  const margin = winner - loser;
  if (winner >= 7 && margin >= 4) return "high";
  if (winner >= 5 && margin >= 2) return "medium";
  return "low";
}

/** Classify free-text clinical / regulatory study description. */
export function classifyStudy(rawText: string | null | undefined): StudyClassification {
  const text = normalizeStudyText(String(rawText ?? ""));
  if (!text) {
    return {
      klass: "uncertain",
      confidence: "low",
      drugScore: 0,
      deviceScore: 0,
      matchedDrug: [],
      matchedDevice: [],
    };
  }

  const drug = scoreRules(text, DRUG_RULES);
  const device = scoreRules(text, DEVICE_RULES);

  let klass: StudyClass;
  if (drug.score === 0 && device.score === 0) {
    klass = "uncertain";
  } else if (drug.score === device.score) {
    klass = "uncertain";
  } else if (drug.score > device.score) {
    klass = "drug";
  } else {
    klass = "device";
  }

  const confidence = resolveConfidence(klass, drug.score, device.score);

  return {
    klass,
    confidence,
    drugScore: drug.score,
    deviceScore: device.score,
    matchedDrug: drug.matched,
    matchedDevice: device.matched,
  };
}

function cellText(v: unknown): string {
  if (v == null || v === "" || v === "—") return "";
  if (typeof v === "object" && v !== null && "text" in v) {
    return String((v as { text?: string }).text ?? "").trim();
  }
  return String(v).trim();
}

/** Map Simulation `Studio Phase` tokens to classifier-friendly phrases. */
export function normalizeStudioPhase(raw: string): string {
  return raw
    .replace(/EARLY_PHASE1/gi, "Phase 1 dose escalation")
    .replace(/PHASE\s*(\d)/gi, "Phase $1 trial")
    .replace(/\s*\|\s*/g, " / ");
}

export type ClinicalStudyTextMeta = {
  brief_title?: string | null;
  phase?: string | null;
  interventions?: string | null;
  conditions?: string | null;
  lead_sponsor?: string | null;
};

/** Merge Simulation row + optional clinical pre-CD meta into one study string. */
export function buildStudyTextFromSources(
  simRow?: Record<string, unknown> | null,
  clinicalMeta?: ClinicalStudyTextMeta | null,
): string {
  const parts: string[] = [];

  if (simRow) {
    for (const k of [
      "Clinical Study",
      "Studio clinico",
      "Study",
      "clinicalStudy",
      "Lead sponsor",
      "Sponsor (da NCT)",
      "Società (full name)",
      "Societa (full name)",
      "Società",
      "Societa",
      "Indication",
      "Indicazione",
      "Drug",
      "Molecola",
      "Molecule",
    ]) {
      const t = cellText(simRow[k]);
      if (t) parts.push(t);
    }
    const phase = cellText(
      simRow["Studio Phase"] ??
        simRow.Fase ??
        simRow.Phase ??
        simRow["Clinical Phase"] ??
        simRow.guidance_trial_phase ??
        simRow.guidance_phase,
    );
    if (phase) parts.push(normalizeStudioPhase(phase));
  }

  if (clinicalMeta) {
    if (clinicalMeta.brief_title) parts.push(clinicalMeta.brief_title);
    if (clinicalMeta.phase) parts.push(normalizeStudioPhase(clinicalMeta.phase));
    if (clinicalMeta.interventions) parts.push(clinicalMeta.interventions);
    if (clinicalMeta.conditions) parts.push(clinicalMeta.conditions);
    if (clinicalMeta.lead_sponsor) parts.push(clinicalMeta.lead_sponsor);
  }

  return [...new Set(parts.filter(Boolean))].join("; ");
}

/** Build study text from a Simulation sheet row (SuperNova schema). */
export function studyTextFromSimRow(row: Record<string, unknown> | null | undefined): string {
  return buildStudyTextFromSources(row, null);
}

export function classifyStudyFromSimRow(
  row: Record<string, unknown> | null | undefined,
  clinicalMeta?: ClinicalStudyTextMeta | null,
): StudyClassification {
  return classifyStudy(buildStudyTextFromSources(row, clinicalMeta));
}

export function formatStudyTypeTooltip(
  classification: StudyClassification,
  lang: "it" | "en" = "it",
): string {
  const it = lang === "it";
  const { klass, confidence, matchedDrug, matchedDevice } = classification;
  if (klass === "drug") {
    const keys = matchedDrug.length ? matchedDrug.join(", ") : "—";
    return it
      ? `Farmaco/biologico (${confidence}) · match: ${keys}`
      : `Drug/biologic (${confidence}) · matched: ${keys}`;
  }
  if (klass === "device") {
    const keys = matchedDevice.length ? matchedDevice.join(", ") : "—";
    return it
      ? `Medical device (${confidence}) · match: ${keys}`
      : `Medical device (${confidence}) · matched: ${keys}`;
  }
  const hints = [...matchedDrug, ...matchedDevice];
  return it
    ? `Tipo studio incerto (${confidence})${hints.length ? ` · segnali: ${hints.join(", ")}` : ""}`
    : `Uncertain study type (${confidence})${hints.length ? ` · hints: ${hints.join(", ")}` : ""}`;
}

export function clinicalMetaFromRecord(
  meta: ClinicalStudyTextMeta | null | undefined,
): ClinicalStudyTextMeta | null {
  if (!meta) return null;
  return meta;
}

export function findClinicalMetaForTicker(
  records: { ticker?: string; meta?: ClinicalStudyTextMeta | null }[] | null | undefined,
  ticker: string,
): ClinicalStudyTextMeta | null {
  if (!records?.length) return null;
  const tk = ticker.trim().toUpperCase();
  const hits = records.filter((r) => String(r.ticker ?? "").trim().toUpperCase() === tk);
  if (!hits.length) return null;

  const titles: string[] = [];
  const phases: string[] = [];
  const interventions: string[] = [];
  const conditions: string[] = [];
  const sponsors: string[] = [];

  for (const hit of hits) {
    const m = hit.meta;
    if (!m) continue;
    if (m.brief_title) titles.push(m.brief_title);
    if (m.phase) phases.push(m.phase);
    if (m.interventions) interventions.push(m.interventions);
    if (m.conditions) conditions.push(m.conditions);
    if (m.lead_sponsor) sponsors.push(m.lead_sponsor);
  }

  if (!titles.length && !phases.length && !interventions.length && !conditions.length && !sponsors.length) {
    return null;
  }

  return {
    brief_title: titles.join("; ") || null,
    phase: phases.join("; ") || null,
    interventions: interventions.join("; ") || null,
    conditions: conditions.join("; ") || null,
    lead_sponsor: sponsors.join("; ") || null,
  };
}
