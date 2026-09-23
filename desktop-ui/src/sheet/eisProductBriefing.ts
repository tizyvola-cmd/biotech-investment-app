/**
 * EIS drawer — initial briefing: product / technology / mechanism of action.
 * Context only — not Soft BUY/SELL.
 */
import type {
  ClinicalAiSummary,
  ClinicalPreCdRecord,
  StudyClinicalProfile,
} from "../api/supernova";
import { usableProductName } from "./simRowClinicalMeta";

export type EisProductBriefing = {
  productName: string | null;
  productTechnology: string | null;
  /** Normalized modality label (small molecule, antibody, gene therapy…). */
  modality: string | null;
  mechanismOfAction: string | null;
  /** Molecular target and/or therapeutic indication when known. */
  therapeuticTarget: string | null;
  /** CT.gov interventions / modality string when AI fields are sparse. */
  interventions: string | null;
  indication: string | null;
  usaPrevalence: string | null;
  standardOfCare: string | null;
  /** Other products in Phase III or IV for the same indication. */
  phase3And4Products: string | null;
  source: "ai_profile" | "meta" | "mixed" | "none" | "ai_lookup";
};

/** API / Gemini lookup patch (snake_case from backend). */
export type ProductBriefingAiPatch = {
  modality?: string | null;
  mechanism_of_action?: string | null;
  therapeutic_target?: string | null;
  product_technology?: string | null;
  indication?: string | null;
  usa_prevalence?: string | null;
  standard_of_care?: string | null;
  phase_3_and_4_products?: string | null;
};

function clean(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/^(n\/d|nd|none|null|unknown|—|-)$/i.test(s)) return null;
  return s;
}

/** Skip placebo / control arms when picking the lead product from CT.gov interventions. */
function isNonProductIntervention(token: string): boolean {
  return /^(placebo|vehicle|sham|control|saline|standard\s+of\s+care|soc|best\s+supportive\s+care|bsc|no\s+intervention|observation|usual\s+care)$/i.test(
    token,
  );
}

function firstInterventionToken(interventions: string | null): string | null {
  if (!interventions) return null;
  for (const part of interventions.split(/[,;|]/)) {
    const tok = clean(part);
    if (tok && !isNonProductIntervention(tok)) return tok;
  }
  return null;
}

function firstEventDrug(rec: ClinicalPreCdRecord): string | null {
  for (const ev of rec.clinical_events ?? []) {
    const tok = clean(ev.drug) || clean(ev.asset);
    if (tok && !isNonProductIntervention(tok)) return tok;
  }
  return null;
}

function profileFromRecord(rec: ClinicalPreCdRecord): StudyClinicalProfile | null {
  const ai = rec.ai as ClinicalAiSummary | undefined;
  const p = ai?.study_clinical_profile;
  return p && typeof p === "object" ? p : null;
}

/**
 * Map free-text technology / interventions into a modality bucket for the Product modal.
 */
export function normalizeProductModality(
  technology: string | null | undefined,
  interventions?: string | null,
): string | null {
  const blob = `${technology ?? ""} ${interventions ?? ""}`.toLowerCase();
  if (!blob.trim()) return null;
  if (/\bgene\s*therap|\baav\b|lentiviral|crispr|gene\s*edit/.test(blob)) {
    return "Gene therapy";
  }
  if (/\bcell\s*therap|\bcar[- ]?t\b|\btil\b|nk\s*cell|stem\s*cell/.test(blob)) {
    return "Cell therapy";
  }
  if (/\badc\b|antibody[- ]drug\s*conjugat/.test(blob)) {
    return "ADC (antibody–drug conjugate)";
  }
  if (
    /\bmab\b|monoclonal|antibody|biologic|bispecific|engager|nanobody|fab\b/.test(
      blob,
    )
  ) {
    return "Biologic / antibody";
  }
  if (/\boligonucleotide|\baso\b|\bsirna\b|\bmrna\b|aptamer|antisense/.test(blob)) {
    return "Oligonucleotide";
  }
  if (/\bpeptide\b|peptibody|cyclic\s+peptide/.test(blob)) {
    return "Peptide";
  }
  if (
    /\bsmall\s*molecule|kinase\s*inhibitor|oral\s*tablet|oral\s*capsule|tyrosine\s*kinase/.test(
      blob,
    )
  ) {
    return "Small molecule";
  }
  if (/\bvaccine|immunother|prophylactic/.test(blob)) {
    return "Vaccine / immunotherapy";
  }
  if (/\bdevice\b|implant|catheter|wearable/.test(blob)) {
    return "Device";
  }
  return clean(technology);
}

/**
 * Prefer an explicit molecular / pathway target from MoA text.
 * Never fall back to disease/indication — that belongs in Indications.
 */
export function extractTherapeuticTarget(
  moa: string | null | undefined,
  _diseaseOrIndication?: string | null,
): string | null {
  const text = clean(moa);
  if (!text) return null;
  const patterns: RegExp[] = [
    /\b(?:anti[- ]?)([A-Za-z0-9][A-Za-z0-9αβγ/-]{1,24})\b/i,
    /\b([A-Za-z0-9][A-Za-z0-9αβγ/-]{1,24}(?:\s*[/-]\s*[A-Za-z0-9αβγ/-]{1,16})?)\s+(?:inhibitor|antagonist|agonist|blocker|binder|ligand|receptor)\b/i,
    /\b(?:inhibits?|blocks?|targets?|antagoni[sz]es?|agoni[sz]es?|binds?\s+to)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9αβγ\s/-]{1,40}?)(?:\s+(?:pathway|receptor|kinase|protein|axis|signaling|signalling))?(?=[,.;]|$)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    const hit = clean(m?.[1]);
    if (hit && hit.length >= 2 && hit.length <= 48) {
      if (
        /^(the|a|an|its|their|this|that|and|or|of|to|in|on|for|with)$/i.test(hit)
      ) {
        continue;
      }
      if (looksLikeDiseaseNotMolecularTarget(hit)) continue;
      return hit;
    }
  }
  return null;
}

/** Disease / indication phrasing — not a protein, gene, or signalling pathway. */
export function looksLikeDiseaseNotMolecularTarget(
  raw: string | null | undefined,
  indication?: string | null,
): boolean {
  const t = clean(raw)?.toLowerCase() ?? "";
  if (!t) return true;
  const ind = clean(indication)?.toLowerCase() ?? "";
  if (ind && (t === ind || ind.includes(t) || t.includes(ind))) return true;
  if (
    /\b(disease|syndrome|disorder|cancer|carcinoma|leukemia|lymphoma|melanoma|myeloma|hemophilia|haemophilia|psoriasis|diabetes|arthritis|fibrosis|bullosa|anemia|anaemia|dystrophy|deficiency|infection|obesity|migraine|epilepsy|asthma|copd|nash|nash\b|cah|aml|all|cll|cml)\b/i.test(
      t,
    )
  ) {
    // Keep if clearly molecular despite a disease word nearby
    if (
      /\b(receptor|kinase|protein|pathway|signaling|signalling|enzyme|gene|factor\s*[ivx0-9]+|glp-?\d|pd-?1|pd-?l1|vegf|egfr|her2|cd\d+|menin|kmt2a|nmda|antibody|agonist|antagonist|inhibitor)\b/i.test(
        t,
      )
    ) {
      return false;
    }
    return true;
  }
  return false;
}

function socLabelFromProfile(profile: StudyClinicalProfile | null): string | null {
  const soc = profile?.disease_soc;
  if (!soc) return null;
  if (soc.soc_is_none || String(soc.soc_name || "").trim().toLowerCase() === "none") {
    return "None (no approved disease-specific drug)";
  }
  const name = clean(soc.soc_name);
  const bench = clean(soc.soc_efficacy_benchmark);
  if (name && bench) return `${name} (${bench})`;
  return name;
}

/**
 * Prefer AI study_clinical_profile product/MoA fields; fall back to meta.interventions
 * and optional SDS mechanism_class.
 */
export function collectEisProductBriefing(
  records: ClinicalPreCdRecord[] | null | undefined,
  opts?: {
    ticker?: string | null;
    nctId?: string | null;
    studyDrug?: string | null;
    /** SDS mechanism_class for this ticker when available. */
    sdsMechanismClass?: string | null;
    /** Optional product label already shown in the desk (forces title). */
    productHint?: string | null;
  },
): EisProductBriefing {
  const ticker = clean(opts?.ticker)?.toUpperCase() ?? "";
  const nctId = clean(opts?.nctId)?.toUpperCase() ?? "";
  let pool = records ?? [];
  if (ticker) {
    pool = pool.filter((r) => clean(r.ticker)?.toUpperCase() === ticker);
  }
  if (nctId) {
    const hit = pool.filter((r) => clean(r.nct_id)?.toUpperCase() === nctId);
    if (hit.length) pool = hit;
  }

  let productName: string | null = null;
  let productTechnology: string | null = null;
  let mechanismOfAction: string | null = null;
  let interventions: string | null = null;
  let eventDrug: string | null = null;
  let disease: string | null = null;
  let usaPrevalence: string | null = null;
  let standardOfCare: string | null = null;
  let fromAi = false;

  for (const rec of pool) {
    const profile = profileFromRecord(rec);
    interventions = interventions || clean(rec.meta?.interventions);
    eventDrug = eventDrug || firstEventDrug(rec);
    disease = disease || clean(rec.meta?.conditions);
    if (!profile) continue;
    productName = productName || clean(profile.product_name);
    productTechnology = productTechnology || clean(profile.product_technology);
    mechanismOfAction = mechanismOfAction || clean(profile.mechanism_of_action);
    disease = disease || clean(profile.disease_soc?.disease);
    usaPrevalence = usaPrevalence || clean(profile.disease_soc?.usa_prevalence);
    standardOfCare = standardOfCare || socLabelFromProfile(profile);
    if (productName || productTechnology || mechanismOfAction) fromAi = true;
  }

  // Lead product: hint → AI profile → CT.gov interventions → event drug → study hint.
  productName =
    usableProductName(opts?.productHint) ||
    usableProductName(productName) ||
    usableProductName(firstInterventionToken(interventions)) ||
    usableProductName(eventDrug) ||
    usableProductName(opts?.studyDrug) ||
    null;
  mechanismOfAction = mechanismOfAction || clean(opts?.sdsMechanismClass);
  const modality =
    normalizeProductModality(productTechnology, interventions) ||
    normalizeProductModality(mechanismOfAction, null);
  const therapeuticTarget = extractTherapeuticTarget(
    mechanismOfAction,
    disease,
  );

  const source: EisProductBriefing["source"] =
    fromAi && (interventions || opts?.sdsMechanismClass)
      ? "mixed"
      : fromAi
        ? "ai_profile"
        : productName || productTechnology || mechanismOfAction || interventions
          ? "meta"
          : "none";

  return {
    productName,
    productTechnology,
    modality,
    mechanismOfAction,
    therapeuticTarget,
    interventions,
    indication: disease,
    usaPrevalence,
    standardOfCare,
    phase3And4Products: null,
    source,
  };
}

export function productBriefingNeedsAiEnrichment(b: EisProductBriefing): boolean {
  return !(
    (b.modality || b.productTechnology) &&
    b.mechanismOfAction &&
    b.therapeuticTarget &&
    b.indication &&
    b.usaPrevalence &&
    b.standardOfCare &&
    b.phase3And4Products
  );
}

export function mergeProductBriefingWithAiLookup(
  base: EisProductBriefing,
  patch: ProductBriefingAiPatch,
): EisProductBriefing {
  const modality =
    base.modality ||
    clean(patch.modality) ||
    normalizeProductModality(patch.product_technology, base.interventions);
  const productTechnology = base.productTechnology || clean(patch.product_technology);
  const mechanismOfAction =
    base.mechanismOfAction || clean(patch.mechanism_of_action);
  const patchTarget = clean(patch.therapeutic_target);
  const indication = base.indication || clean(patch.indication);
  const therapeuticTarget =
    base.therapeuticTarget ||
    (patchTarget &&
    !looksLikeDiseaseNotMolecularTarget(patchTarget, indication)
      ? patchTarget
      : null) ||
    extractTherapeuticTarget(mechanismOfAction, null);

  const usaPrevalence = base.usaPrevalence || clean(patch.usa_prevalence);
  const standardOfCare = base.standardOfCare || clean(patch.standard_of_care);
  const phase3And4Products =
    base.phase3And4Products || clean(patch.phase_3_and_4_products);

  const filled = Boolean(
    (modality && !base.modality) ||
      (productTechnology && !base.productTechnology) ||
      (mechanismOfAction && !base.mechanismOfAction) ||
      (therapeuticTarget && !base.therapeuticTarget) ||
      (indication && !base.indication) ||
      (usaPrevalence && !base.usaPrevalence) ||
      (standardOfCare && !base.standardOfCare) ||
      (phase3And4Products && !base.phase3And4Products),
  );

  return {
    ...base,
    modality,
    productTechnology,
    mechanismOfAction,
    therapeuticTarget,
    indication,
    usaPrevalence,
    standardOfCare,
    phase3And4Products,
    source: filled
      ? base.source === "none"
        ? "ai_lookup"
        : "mixed"
      : base.source,
  };
}

export function eisProductBriefingHasBody(b: EisProductBriefing): boolean {
  return Boolean(
    b.productName ||
      b.productTechnology ||
      b.modality ||
      b.mechanismOfAction ||
      b.therapeuticTarget ||
      b.interventions ||
      b.indication ||
      b.usaPrevalence ||
      b.standardOfCare ||
      b.phase3And4Products,
  );
}

/**
 * Product / drug name for Top KPI Asset — from the associated ClinicalTrials.gov study
 * (AI product_name or interventions), not Soft BUY/SELL.
 */
export function clinicalAssetProductName(
  records: ClinicalPreCdRecord[] | null | undefined,
  opts: {
    ticker: string;
    nctId?: string | null;
  },
): string {
  return (
    collectEisProductBriefing(records, {
      ticker: opts.ticker,
      nctId: opts.nctId,
    }).productName ?? ""
  );
}
