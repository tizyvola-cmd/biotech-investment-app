import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "../api";
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
]);

function sponsorTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4),
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

function eventHasUsableReferenceText(ev: ClinicalPublicationEvent): boolean {
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

function verifyEventReference(
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
  const drHit = drugSearchTerms(drugTokens, ev.drug ?? ev.asset).some((t) =>
    textMentionsTerm(text, t),
  );
  const coTerms = companySearchTerms(company, ticker);
  const multiCo = coTerms.filter((t) => t.includes(" ") && textMentionsTerm(text, t));
  const singleCo = coTerms.filter((t) => !t.includes(" ") && textMentionsTerm(text, t));
  const tk = ticker.trim().toUpperCase();
  const coHit =
    multiCo.length > 0 ||
    (singleCo.length > 0 && (tk.length > SHORT_TICKER_MAX || drHit));

  if (coHit && drHit) return { verified: true, match: "company+drug" };
  if (coHit) return { verified: true, match: "company" };
  if (drHit) return { verified: true, match: "drug" };
  return { verified: false, match: null };
}

function isSponsorMatchTrusted(sponsorMatch: string | null | undefined): boolean {
  const sm = String(sponsorMatch ?? "").trim().toLowerCase();
  return sm === "exact" || sm === "partial" || sm === "direct match";
}

function resolveRecordSponsorMatch(
  rec: ClinicalPreCdRecord,
): "exact" | "partial" | "no match" | "n/d" {
  const stored = String(rec.sponsor_match ?? "").trim().toLowerCase();
  if (stored === "exact" || stored === "partial" || stored === "direct match") {
    return stored === "direct match" ? "exact" : stored;
  }
  const company = String(rec.company ?? rec.ticker ?? "").trim();
  const lead = String(rec.meta?.lead_sponsor ?? "").trim();
  if (!company || !lead) return "n/d";
  const rel = inferNctRelationForCompany(
    company,
    lead,
    String(rec.meta?.collaborators ?? ""),
  );
  if (rel === "direct sponsor") return "exact";
  if (rel === "collaborator") {
    return meaningfulSponsorOverlap(company, lead) ? "partial" : "no match";
  }
  return "no match";
}

export function isClinicalPreCdRecordTrusted(rec: ClinicalPreCdRecord): boolean {
  const sm = String(rec.sponsor_match ?? "").trim().toLowerCase();
  if (sm === "no match") return false;
  if (sm === "exact" || sm === "direct match") return true;
  if (sm === "partial") {
    const company = String(rec.company ?? rec.ticker ?? "").trim();
    const lead = String(rec.meta?.lead_sponsor ?? "").trim();
    return meaningfulSponsorOverlap(company, lead);
  }
  const resolved = resolveRecordSponsorMatch(rec);
  return resolved === "exact" || resolved === "partial";
}

function isFeedEventTrusted(
  ev: ClinicalPublicationEvent,
  rec: ClinicalPreCdRecord,
): boolean {
  const st = (ev.source_type ?? "").toLowerCase();
  if (st === "sec_8k" || st === "cd_milestone") return true;
  if (String(rec.sponsor_match ?? "").trim().toLowerCase() === "no match") return false;
  if (ev.reference_verified === true) return true;
  if (ev.reference_verified === false) return false;
  return verifyEventReference(ev, rec).verified;
}

export function trustedRecordEvents(rec: ClinicalPreCdRecord): ClinicalPublicationEvent[] {
  return (rec.clinical_events ?? rec.timeline_events ?? []).filter((ev) =>
    isFeedEventTrusted(ev, rec),
  );
}
