import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "../api/supernova";
import { inferNctRelationForCompany } from "./ctgovStudyMeta";

const GENERIC_SPONSOR_TOKENS = new Set([
  "biosciences",
  "biopharma",
  "biotherapeutics",
  "pharmaceuticals",
  "pharmaceutical",
  "pharma",
  "therapeutics",
  "medicines",
  "sciences",
  "health",
  "laboratories",
  "labs",
  "inc",
  "ltd",
  "llc",
  "corp",
  "corporation",
  "company",
  "co",
  "plc",
  "sa",
  "nv",
  "ag",
  "gmbh",
  "group",
  "holdings",
  "holding",
]);

function sponsorTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3),
  );
}

function meaningfulSponsorOverlap(company: string, lead: string): boolean {
  const a = sponsorTokens(company);
  const b = sponsorTokens(lead);
  const common = [...a].filter((w) => b.has(w));
  if (!common.length) return false;
  return common.some((w) => !GENERIC_SPONSOR_TOKENS.has(w));
}

const COMPANY_SUFFIX = new Set([
  "inc", "inc.", "llc", "ltd", "limited", "corp", "corporation", "company",
  "co", "co.", "plc", "sa", "nv", "ag", "gmbh", "the", "and", "of",
]);
const GENERIC_DRUG = new Set(["corporate", "—", "-", "n/a", "na", "none"]);
const MIN_REFERENCE_CHARS = 12;
const MIN_DRUG_ONLY_TERM_LEN = 5;
const SHORT_TICKER_MAX = 4;

/** Shared SOC / IO — never enough alone for drug-only PubMed attach. */
const SHARED_SOC_DRUG_TERMS = new Set([
  "pembrolizumab",
  "keytruda",
  "nivolumab",
  "opdivo",
  "atezolizumab",
  "tecentriq",
  "durvalumab",
  "imfinzi",
  "ipilimumab",
  "yervoy",
  "cemiplimab",
  "libtayo",
  "carboplatin",
  "paclitaxel",
  "cisplatin",
  "docetaxel",
  "gemcitabine",
  "rituximab",
  "trastuzumab",
  "bevacizumab",
  "lenalidomide",
  "dexamethasone",
  "prednisone",
  "methotrexate",
  "chemotherapy",
  "placebo",
  "saline",
]);

function isSharedSocDrugTerm(term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  if (SHARED_SOC_DRUG_TERMS.has(t)) return true;
  return SHARED_SOC_DRUG_TERMS.has(t.replace(/[\s\-_]+/g, ""));
}

function companySearchTerms(company: string, ticker: string): string[] {
  const terms: string[] = [];
  const tk = ticker.trim().toUpperCase();
  if (tk.length >= 2) terms.push(tk.toLowerCase());
  const raw = company.trim();
  if (raw) {
    const words = raw
      .replace(/[,().]+/g, " ")
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w && !COMPANY_SUFFIX.has(w));
    if (words.length >= 2) terms.push(words.slice(0, 4).join(" "));
    for (const w of words) {
      if (w.length >= 4) terms.push(w);
    }
  }
  return [...new Set(terms)];
}

function drugSearchTerms(drugTokens: string[], eventDrug: string | null | undefined): string[] {
  const terms: string[] = [];
  for (const raw of drugTokens) {
    const t = raw.trim();
    if (t.length < 3 || GENERIC_DRUG.has(t.toLowerCase())) continue;
    terms.push(t.toLowerCase());
    const compact = t.toLowerCase().replace(/[\s\-_]+/g, "");
    if (compact.length >= 3) terms.push(compact);
  }
  const d = (eventDrug ?? "").trim();
  if (d && !GENERIC_DRUG.has(d.toLowerCase()) && d.length >= 3) {
    terms.push(d.toLowerCase());
    const compact = d.toLowerCase().replace(/[\s\-_]+/g, "");
    if (compact.length >= 3) terms.push(compact);
  }
  return [...new Set(terms)].filter((t) => t.length >= MIN_DRUG_ONLY_TERM_LEN);
}

function eventReferenceText(ev: ClinicalPublicationEvent): string {
  return [ev.event_title, ev.summary, ev.impact_note]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function eventHasUsableReferenceText(ev: ClinicalPublicationEvent): boolean {
  const st = (ev.source_type ?? "").toLowerCase();
  if (st === "sec_8k" || st === "cd_milestone") return true;
  return eventReferenceText(ev).length >= MIN_REFERENCE_CHARS;
}

function textMentionsTerm(text: string, term: string): boolean {
  if (!text || !term) return false;
  const tl = term.toLowerCase();
  if (tl.length <= 5) {
    return new RegExp(`\\b${tl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
  }
  if (text.includes(tl)) return true;
  return new RegExp(`\\b${tl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
}

/** Verifica relazione diretta articolo ↔ società e/o farmaco (allineato al backend Python). */
export function verifyEventReference(
  ev: ClinicalPublicationEvent,
  rec: ClinicalPreCdRecord,
  opts?: { strict?: boolean },
): { verified: boolean; match: string | null } {
  const strict = opts?.strict === true;

  if (!strict) {
    if (ev.reference_verified === true) {
      return { verified: true, match: ev.reference_match ?? "stored" };
    }
    if (ev.reference_verified === false) {
      return { verified: false, match: ev.reference_match ?? null };
    }
  }

  if (!eventHasUsableReferenceText(ev)) {
    return { verified: false, match: null };
  }

  const st = (ev.source_type ?? "").toLowerCase();
  if (st === "sec_8k") {
    const fromKpi = Boolean((ev as { _from_kpi_timeline?: boolean })._from_kpi_timeline);
    const filingOk = Boolean((ev as { sec_filing_verified?: boolean }).sec_filing_verified);
    if (!fromKpi || filingOk) return { verified: true, match: "sec_8k" };
  }
  if (st === "cd_milestone") {
    return { verified: true, match: "ctgov" };
  }
  if (st.includes("ctgov") || ev.link?.includes("clinicaltrials.gov")) {
    const nct = String(rec.nct_id ?? "").trim().toUpperCase();
    if (nct) {
      const blob = `${eventReferenceText(ev)} ${ev.link ?? ""}`.toUpperCase();
      if (blob.includes(nct)) return { verified: true, match: "ctgov" };
      return { verified: false, match: null };
    }
    return { verified: true, match: "ctgov" };
  }

  const text = eventReferenceText(ev);
  const company = rec.company ?? "";
  const ticker = rec.ticker ?? "";
  const drugTokens = rec.publication_context?.drug_tokens_searched ?? [];
  const drTerms = drugSearchTerms(drugTokens, ev.drug ?? ev.asset);
  const specificHits = drTerms.filter((t) => textMentionsTerm(text, t) && !isSharedSocDrugTerm(t));
  const backboneHits = drTerms.filter((t) => textMentionsTerm(text, t) && isSharedSocDrugTerm(t));
  const drHit = specificHits.length > 0 || backboneHits.length > 0;
  const coTerms = companySearchTerms(company, ticker);
  const multiCo = coTerms.filter((t) => t.includes(" ") && textMentionsTerm(text, t));
  const singleCo = coTerms.filter((t) => !t.includes(" ") && textMentionsTerm(text, t));
  const tk = ticker.trim().toUpperCase();
  const coHit =
    multiCo.length > 0 ||
    (singleCo.length > 0 && (tk.length > SHORT_TICKER_MAX || drHit));

  if (coHit && drHit) return { verified: true, match: "company+drug" };
  if (coHit) return { verified: true, match: "company" };
  if (specificHits.length > 0) return { verified: true, match: "drug" };
  if (backboneHits.length > 0) {
    const nct = String(rec.nct_id ?? "").trim().toUpperCase();
    if (nct && `${text} ${ev.link ?? ""}`.toUpperCase().includes(nct)) {
      return { verified: true, match: "drug" };
    }
    return { verified: false, match: null };
  }
  return { verified: false, match: null };
}

export function isSponsorMatchTrusted(sponsorMatch: string | null | undefined): boolean {
  const sm = String(sponsorMatch ?? "").trim().toLowerCase();
  return sm === "exact" || sm === "partial" || sm === "direct match";
}

/** Resolve sponsor trust from CT.gov lead_sponsor (never trust stale stored Exact). */
export function resolveRecordSponsorMatch(
  rec: ClinicalPreCdRecord,
): "exact" | "partial" | "no match" | "n/d" {
  const company = String(rec.company ?? rec.ticker ?? "").trim();
  const lead = String(rec.meta?.lead_sponsor ?? "").trim();
  if (!company || !lead) {
    const stored = String(rec.sponsor_match ?? "").trim().toLowerCase();
    if (stored === "exact" || stored === "partial" || stored === "direct match") {
      return stored === "direct match" ? "exact" : (stored as "exact" | "partial");
    }
    return "n/d";
  }
  const rel = inferNctRelationForCompany(
    company,
    lead,
    String(rec.meta?.collaborators ?? ""),
  );
  if (rel === "direct sponsor") {
    return meaningfulSponsorOverlap(company, lead) ? "exact" : "no match";
  }
  if (rel === "collaborator") {
    return meaningfulSponsorOverlap(company, lead) ? "partial" : "no match";
  }
  // Substring / fuzzy “correlated” without distinctive token → reject
  if (meaningfulSponsorOverlap(company, lead)) return "partial";
  return "no match";
}

/** Study row visible in feed — Exact/Partial only with non-generic name overlap. */
export function isClinicalPreCdRecordTrusted(rec: ClinicalPreCdRecord): boolean {
  const company = String(rec.company ?? rec.ticker ?? "").trim();
  const lead = String(rec.meta?.lead_sponsor ?? "").trim();
  if (String(rec.sponsor_match ?? "").trim().toLowerCase() === "no match") return false;
  const resolved = resolveRecordSponsorMatch(rec);
  if (resolved !== "exact" && resolved !== "partial") return false;
  if (!lead) return false;
  return meaningfulSponsorOverlap(company, lead);
}

/** Strict sponsor gate — stored field only (legacy). */
export function isClinicalPreCdRecordStrictTrusted(rec: ClinicalPreCdRecord): boolean {
  const sm = String(rec.sponsor_match ?? "").trim().toLowerCase();
  if (!sm || sm === "n/d" || sm === "nd" || sm === "—") return false;
  if (sm === "no match") return false;
  return isSponsorMatchTrusted(sm);
}

export function isFeedEventTrusted(
  ev: ClinicalPublicationEvent,
  rec: ClinicalPreCdRecord,
): boolean {
  const st = (ev.source_type ?? "").toLowerCase();
  if (st === "manual") return true;
  if (st === "sec_8k" || st === "cd_milestone") return true;
  // Daily News desk → clinical cache / Migrate → EIS (operator-staged on ticker).
  const fromDaily =
    Boolean((ev as { _from_daily_news?: boolean })._from_daily_news) ||
    String(ev.reference_match ?? "").toLowerCase() === "daily_news" ||
    String(ev.link_label ?? "").toLowerCase().includes("daily news");
  if (fromDaily) {
    return ev.reference_verified !== false;
  }
  if (!isClinicalPreCdRecordTrusted(rec)) return false;
  // Always re-check publications (stored reference_verified can be stale drug-only).
  return verifyEventReference(ev, rec, { strict: true }).verified;
}

export function trustedRecordEvents(rec: ClinicalPreCdRecord): ClinicalPublicationEvent[] {
  return (rec.clinical_events ?? rec.timeline_events ?? []).filter((ev) =>
    isFeedEventTrusted(ev, rec),
  );
}

export function isEventReferenceVerified(
  ev: ClinicalPublicationEvent,
  rec: ClinicalPreCdRecord,
): boolean {
  return verifyEventReference(ev, rec).verified;
}

export function referenceMatchLabel(match: string | null | undefined, it: boolean): string {
  if (!match) return it ? "non verificata" : "unverified";
  const map: Record<string, [string, string]> = {
    sec_8k: ["SEC 8-K", "SEC 8-K"],
    ctgov: ["CT.gov", "CT.gov"],
    company: ["Società", "Company"],
    drug: ["Farmaco", "Drug"],
    "company+drug": ["Società + farmaco", "Company + drug"],
    stored: ["Verificata", "Verified"],
  };
  const pair = map[match];
  return pair ? (it ? pair[0] : pair[1]) : match;
}
