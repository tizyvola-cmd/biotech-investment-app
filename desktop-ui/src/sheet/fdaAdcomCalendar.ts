/**
 * FDA Advisory Committee calendar — NASDAQ names only.
 * Display only. Does not change Soft BUY/SELL.
 *
 * Source: https://www.fda.gov/advisory-committees/advisory-committee-calendar
 * FDA publishes meetings when announced (weeks ahead), not a 12-month book.
 */
import { daysUntilIso } from "./nextCatalystEvent";

export type FdaAdcomKind = "vote" | "safety_review";

export type FdaAdcomBriefing = {
  status: "ready" | "pending" | "none" | string;
  score?: number | null;
  stance?: "positive" | "mixed" | "negative" | string | null;
  title?: string;
  summaryEn?: string;
  summaryIt?: string;
  resultsEn?: string[];
  resultsIt?: string[];
  statisticsEn?: string[];
  statisticsIt?: string[];
  conclusionsEn?: string[];
  conclusionsIt?: string[];
  bulletsEn?: string[];
  bulletsIt?: string[];
  materialsUrl?: string;
  pdfUrl?: string;
  /** Backend verified PDF/title against scheduled company/product. */
  matchOk?: boolean;
  matchHint?: string;
  source?: string;
  updated_at?: string;
};

export type FdaAdcomRow = {
  id: string;
  date: string;
  ticker: string;
  company: string;
  product: string;
  eventEn: string;
  eventIt: string;
  committee: string;
  kind: FdaAdcomKind;
  href: string;
  /** Known FDA /media/ URL once published (scraper fallback). */
  briefingPdfHint?: string;
  briefing?: FdaAdcomBriefing | null;
};

export const FDA_ADCOM_MATERIALS_URL =
  "https://www.fda.gov/advisory-committees/recently-updated-advisory-committee-materials";

export function formatFdaScore(score: number | null | undefined): string {
  if (score == null || !Number.isFinite(score)) return "—";
  const n = Math.round(score * 10) / 10;
  return n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}

/** True when the briefing card has a real published file for this meeting. */
export function fdaBriefingFileAvailable(
  brief: FdaAdcomBriefing | null | undefined,
): boolean {
  if (!brief) return false;
  const pdf = String(brief.pdfUrl || "").trim();
  if (pdf) return true;
  const materials = String(brief.materialsUrl || "").trim();
  if (
    brief.status === "ready" &&
    materials &&
    materials !== FDA_ADCOM_MATERIALS_URL
  ) {
    return true;
  }
  return false;
}

/** Client-side check: briefing title/URL looks like this scheduled company. */
export function verifyFdaBriefingMatchesCompany(row: FdaAdcomRow): {
  ok: boolean;
  reason: string;
} {
  const brief = row.briefing;
  if (!brief) return { ok: false, reason: "no_briefing" };
  if (brief.matchOk === true) return { ok: true, reason: brief.matchHint || "verified" };
  if (brief.matchOk === false && brief.status === "ready") {
    return { ok: false, reason: "mismatch" };
  }
  const blob = `${brief.title || ""} ${brief.pdfUrl || ""} ${brief.materialsUrl || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ");
  const ticker = row.ticker.trim().toLowerCase();
  if (ticker && new RegExp(`\\b${ticker}\\b`, "i").test(blob)) {
    return { ok: true, reason: "ticker" };
  }
  const companyFirst = row.company.split(/[,.(]/)[0]?.trim().toLowerCase() || "";
  if (companyFirst.length >= 4 && blob.includes(companyFirst)) {
    return { ok: true, reason: "company" };
  }
  const product = row.product.split(";")[0]?.replace(/\([^)]*\)/g, " ").trim().toLowerCase() || "";
  if (product.length >= 4 && blob.includes(product)) {
    return { ok: true, reason: "product" };
  }
  const committee = row.committee.trim().toLowerCase();
  if (committee.length >= 12 && blob.includes(committee.slice(0, 24))) {
    return { ok: true, reason: "committee" };
  }
  // Ready with a meeting-specific materials page (not the generic dump) counts as ok.
  const materials = String(brief.materialsUrl || "").trim();
  if (
    brief.status === "ready" &&
    materials &&
    materials !== FDA_ADCOM_MATERIALS_URL &&
    (materials === row.href || materials.includes("advisory-committee-calendar"))
  ) {
    return { ok: true, reason: "meeting_page" };
  }
  return { ok: false, reason: "unverified" };
}

export const FDA_ADCOM_SOURCE_URL =
  "https://www.fda.gov/advisory-committees/advisory-committee-calendar";

export const FDA_ADCOM_HORIZON_MONTHS = 3;

export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function fdaAdcomHorizon(today = new Date()): { start: string; end: string } {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const start = `${y}-${m}-${d}`;
  return { start, end: addMonthsIso(start, FDA_ADCOM_HORIZON_MONTHS) };
}

export function rowsInFdaAdcomHorizon(
  rows: FdaAdcomRow[],
  today = new Date(),
): FdaAdcomRow[] {
  const { start, end } = fdaAdcomHorizon(today);
  return rows.filter((r) => r.date >= start && r.date <= end);
}

export const FDA_ADCOM_CALENDAR: FdaAdcomRow[] = [
  {
    id: "2026-04-30-AZN",
    date: "2026-04-30",
    ticker: "AZN",
    company: "AstraZeneca PLC",
    product: "camizestrant; Truqap (capivasertib)",
    eventEn: "ODAC vote: NDA camizestrant (HR+/HER2− mBC) and sNDA Truqap (PTEN-deficient mHSPC)",
    eventIt: "Voto ODAC: NDA camizestrant (HR+/HER2− mBC) e sNDA Truqap (mHSPC PTEN-deficient)",
    committee: "Oncologic Drugs Advisory Committee",
    kind: "vote",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/april-30-2026-meeting-oncologic-drugs-advisory-committee-meeting-announcement-04302026",
  },
  {
    id: "2026-06-18-MRNA",
    date: "2026-06-18",
    ticker: "MRNA",
    company: "Moderna, Inc.",
    product: "mFlusiva (mRNA-1010)",
    eventEn: "VRBPAC: BLA mFlusiva influenza vaccine, adults ≥50",
    eventIt: "VRBPAC: BLA mFlusiva vaccino influenza, adulti ≥50",
    committee: "Vaccines and Related Biological Products Advisory Committee",
    kind: "vote",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/vaccines-and-related-biological-products-advisory-committee-june-18-2026-meeting-announcement",
  },
  {
    id: "2026-07-29-CAPR",
    date: "2026-07-29",
    ticker: "CAPR",
    company: "Capricor Therapeutics, Inc.",
    product: "deramiocel",
    eventEn: "CTGTAC: BLA 125842 deramiocel for DMD cardiomyopathy",
    eventIt: "CTGTAC: BLA 125842 deramiocel per cardiomiopatia DMD",
    committee: "Cellular, Tissue, and Gene Therapies Advisory Committee",
    kind: "vote",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/cellular-tissue-and-gene-therapies-advisory-committee-july-29-2026-meeting-announcement-updated",
  },
  {
    id: "2026-07-30-REPL",
    date: "2026-07-30",
    ticker: "REPL",
    company: "Replimune Group, Inc.",
    product: "vusolimogene oderparepvec",
    eventEn: "CTGTAC: BLA 125827 RP1 + nivolumab in advanced melanoma post PD-1",
    eventIt: "CTGTAC: BLA 125827 RP1 + nivolumab in melanoma avanzato post PD-1",
    committee: "Cellular, Tissue, and Gene Therapies Advisory Committee",
    kind: "vote",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/cellular-tissue-and-gene-therapies-advisory-committee-july-30-2026-meeting-announcement-updated",
  },
  {
    id: "2026-09-16-GILD",
    date: "2026-09-16",
    ticker: "GILD",
    company: "Gilead Sciences, Inc.",
    product: "Veklury; Vemlidy",
    eventEn: "PAC pediatric post-marketing safety review (Veklury, Vemlidy)",
    eventIt: "PAC review sicurezza pediatrica post-marketing (Veklury, Vemlidy)",
    committee: "Pediatric Advisory Committee",
    kind: "safety_review",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
  },
  {
    id: "2026-09-16-AMGN",
    date: "2026-09-16",
    ticker: "AMGN",
    company: "Amgen Inc.",
    product: "Aranesp (darbepoetin alfa)",
    eventEn: "PAC pediatric post-marketing safety review (Aranesp)",
    eventIt: "PAC review sicurezza pediatrica post-marketing (Aranesp)",
    committee: "Pediatric Advisory Committee",
    kind: "safety_review",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
  },
  {
    id: "2026-09-16-VCEL",
    date: "2026-09-16",
    ticker: "VCEL",
    company: "Vericel Corporation",
    product: "Epicel",
    eventEn: "PAC pediatric HDE safety review (Epicel)",
    eventIt: "PAC review sicurezza pediatrica HDE (Epicel)",
    committee: "Pediatric Advisory Committee",
    kind: "safety_review",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
  },
  {
    id: "2026-09-16-ICU",
    date: "2026-09-16",
    ticker: "ICU",
    company: "SeaStar Medical Holding Corporation",
    product: "Quelimmune",
    eventEn: "PAC pediatric HDE safety review (Quelimmune)",
    eventIt: "PAC review sicurezza pediatrica HDE (Quelimmune)",
    committee: "Pediatric Advisory Committee",
    kind: "safety_review",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
  },
  {
    id: "2026-09-16-PROF",
    date: "2026-09-16",
    ticker: "PROF",
    company: "Profound Medical Corp.",
    product: "Sonalleve MR-HIFU",
    eventEn: "PAC pediatric HDE safety review (Sonalleve)",
    eventIt: "PAC review sicurezza pediatrica HDE (Sonalleve)",
    committee: "Pediatric Advisory Committee",
    kind: "safety_review",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
  },
  {
    id: "2026-09-16-KIDS",
    date: "2026-09-16",
    ticker: "KIDS",
    company: "OrthoPediatrics Corp.",
    product: "MID-C / ApiFix",
    eventEn: "PAC pediatric HDE safety review (MID-C System)",
    eventIt: "PAC review sicurezza pediatrica HDE (MID-C System)",
    committee: "Pediatric Advisory Committee",
    kind: "safety_review",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
  },
  {
    id: "2026-09-16-INVA",
    date: "2026-09-16",
    ticker: "INVA",
    company: "Innoviva, Inc.",
    product: "Zevtera (ceftobiprole)",
    eventEn: "PAC pediatric post-marketing safety review (Zevtera)",
    eventIt: "PAC review sicurezza pediatrica post-marketing (Zevtera)",
    committee: "Pediatric Advisory Committee",
    kind: "safety_review",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
  },
  {
    id: "2026-09-16-LGND",
    date: "2026-09-16",
    ticker: "LGND",
    company: "Ligand Pharmaceuticals Incorporated",
    product: "Zelsuvmi (berdazimer)",
    eventEn: "PAC pediatric post-marketing safety review (Zelsuvmi; royalty — commercial is PTHS)",
    eventIt: "PAC review sicurezza pediatrica post-marketing (Zelsuvmi; royalty — commerciale PTHS)",
    committee: "Pediatric Advisory Committee",
    kind: "safety_review",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/pediatric-advisory-committee-meeting-announcement-09162026",
  },
  {
    id: "2026-09-23-GRAL",
    date: "2026-09-23",
    ticker: "GRAL",
    company: "GRAIL, Inc.",
    product: "Galleri",
    eventEn: "CDRH panel vote: PMA Galleri multi-cancer early detection (adults ≥50)",
    eventIt: "Voto panel CDRH: PMA Galleri screening multi-cancro (adulti ≥50)",
    committee: "Molecular and Clinical Genetics Panel",
    kind: "vote",
    href: "https://www.fda.gov/advisory-committees/advisory-committee-calendar/september-23-2026-molecular-and-clinical-genetics-panel-medical-devices-advisory-committee-meeting",
    briefingPdfHint: "https://www.fda.gov/media/194910/download",
  },
];

export function fdaAdcomTickers(rows: FdaAdcomRow[] = FDA_ADCOM_CALENDAR): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const tk = row.ticker.trim().toUpperCase();
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    out.push(tk);
  }
  return out;
}

/** Upcoming first (soonest), then past (most recent first). Same-day: vote before safety. */
export function sortFdaAdcomRows(
  rows: FdaAdcomRow[],
  today = new Date(),
): FdaAdcomRow[] {
  return [...rows].sort((a, b) => {
    const da = daysUntilIso(a.date, today) ?? 0;
    const db = daysUntilIso(b.date, today) ?? 0;
    const aUp = da >= 0;
    const bUp = db >= 0;
    if (aUp !== bUp) return aUp ? -1 : 1;
    if (aUp && da !== db) return da - db;
    if (!aUp && da !== db) return db - da;
    if (a.kind !== b.kind) return a.kind === "vote" ? -1 : 1;
    return a.ticker.localeCompare(b.ticker);
  });
}

export function formatFdaAdcomDays(days: number | null, it: boolean): string {
  if (days == null || !Number.isFinite(days)) return "—";
  if (days < 0) return it ? "passato" : "past";
  if (days === 0) return it ? "oggi" : "today";
  return it ? `${days}g` : `${days}d`;
}

export function fdaAdcomKindLabel(kind: FdaAdcomKind, it: boolean): string {
  if (kind === "vote") return it ? "Voto" : "Vote";
  return it ? "Review sicurezza" : "Safety review";
}
