/** Fase / indicazione / NCT da riga Simulation (colonne Excel). */

import { nctClinicalTrialsUrl, sheetCellAsLink } from "./cellLinks";
import { normNctId } from "./clinicalSimulationFilter";

function colMatch(row: Record<string, unknown>, re: RegExp): string | null {
  for (const k of Object.keys(row)) {
    if (re.test(k.replace(/\n/g, " "))) return k;
  }
  return null;
}

function simCellText(v: unknown): string {
  if (v == null || v === "" || v === "—") return "";
  if (typeof v === "object" && v !== null && "text" in v) {
    return String((v as { text?: string }).text ?? "").trim();
  }
  return String(v).trim();
}

/**
 * Standalone regulatory/path labels that must not replace a trial name or drug.
 * "PDUFA", "NDA", "BLA" are catalyst types, not the study that completes the CD.
 */
export function isRegulatoryMilestoneLabel(raw: string | null | undefined): boolean {
  const s = String(raw ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return false;
  return /^(pdufa(?:\s+date)?|nda|bla|snda|sbla|crl|adcom|ad com|advisory committee|ind|filing|submission|readout|approval|510\s*\(\s*k\s*\)|pma)$/i.test(
    s,
  );
}

/** Bare clinical-phase tokens — never a product / asset name (e.g. Studio Phase → chip). */
export function looksLikePhaseOnlyLabel(raw: string | null | undefined): boolean {
  const s = String(raw ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return false;
  if (/^phase\s*3$/i.test(s) || /^fase\s*3$/i.test(s) || /^phase3$/i.test(s)) return true;
  if (/^(phase|fase)\s*[ivx0-9]+(?:\s*[a-c])?$/i.test(s)) return true;
  if (/^(phase|fase)\s*[ivx0-9]+\s*\/\s*(phase|fase)\s*[ivx0-9]+$/i.test(s)) return true;
  if (/^pivotal$/i.test(s)) return true;
  return false;
}

/** Law-firm solicitation / class-action headline tokens mistaken for drugs. */
const PRODUCT_NAME_NOISE_RE =
  /^(SHAREHOLDER|ALERT|INVESTORS?|INVESTIGATION|LAWSUIT|DEADLINE|COURT|SECURITIES|ANNO|CLASS|ACTION|NASDAQ|NYSE)$/i;

/**
 * CT.gov-style brief titles must never fill the Product column.
 * E.g. "A Study of the Safety and Efficacy of …"
 */
export function looksLikeStudyTitle(raw: string | null | undefined): boolean {
  const s = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return false;
  if (/daily\s+news\s+eis/i.test(s)) return true;
  if (/^(an?\s+)?study\s+of\b/i.test(s)) return true;
  if (
    /^(an?\s+)?(phase\s+[ivx0-9/]+\s+)?(randomized\s+)?(open[- ]label\s+)?(double[- ]blind\s+)?(study|trial)\b/i.test(
      s,
    )
  ) {
    return true;
  }
  if (
    /\b(study|trial)\s+(of|to\s+(evaluate|assess|investigate|determine|compare))\b/i.test(s) &&
    s.length >= 28
  ) {
    return true;
  }
  if (
    s.length >= 48 &&
    /\b(clinical\s+)?(study|trial)\b/i.test(s) &&
    /\b(safety|efficacy|tolerability|pharmacokinetics|participants|subjects|patients)\b/i.test(s)
  ) {
    return true;
  }
  return false;
}

/** NCT ids and "Study NCTxxxxxxxx" are study keys — never product / patent query names. */
export function looksLikeNctOrStudyLabel(raw: string | null | undefined): boolean {
  const s = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return false;
  if (/^nct\d{8}$/i.test(s)) return true;
  if (/^study\s+nct\d{8}\b/i.test(s)) return true;
  if (/^(cd study|studio cd)$/i.test(s)) return true;
  return false;
}

/** Product / asset for desk columns — rejects regulatory labels, study titles, NCT ids. */
export function usableProductName(raw: string | null | undefined): string {
  const s = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || s === "—" || s === "-" || s === "–" || s === "—") return "";
  if (/^[—\-\u2013\u2014.·•]+$/.test(s)) return "";
  if (PRODUCT_NAME_NOISE_RE.test(s)) return "";
  if (looksLikePhaseOnlyLabel(s)) return "";
  if (isRegulatoryMilestoneLabel(s) || looksLikeStudyTitle(s) || looksLikeNctOrStudyLabel(s)) {
    return "";
  }
  return s;
}

export function formatRegulatoryMilestoneLabel(raw: string | null | undefined): string | null {
  if (!isRegulatoryMilestoneLabel(raw)) return null;
  const s = String(raw ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^pdufa/i.test(s)) return "PDUFA";
  if (/^readout$/i.test(s)) return "Readout";
  if (/^submission$/i.test(s)) return "Submission";
  if (/^ad\s*com/i.test(s) || /advisory committee/i.test(s)) return "AdCom";
  return s.toUpperCase();
}

export function clinicalPhaseFromSimRow(row: Record<string, unknown> | undefined): string {
  if (!row) return "";
  const fromGuidance = simCellText(row.guidance_trial_phase ?? row.guidance_phase);
  if (fromGuidance && !isRegulatoryMilestoneLabel(fromGuidance)) {
    return /^phase\b/i.test(fromGuidance) ? fromGuidance : `Phase ${fromGuidance}`;
  }
  const col = colMatch(row, /fase|phase/i);
  if (!col) return "";
  const v = simCellText(row[col]);
  return v && v !== "—" ? v : "";
}

function clinicalPhaseAdvanceRank(phase: string): number {
  const p = phase.toLowerCase();
  if (/approv|market|commercial|launched|registrat/.test(p)) return 5;
  if (/phase\s*iii|phase\s*3|fase\s*iii|fase\s*3|pivotal/.test(p)) return 4;
  if (/phase\s*ii|phase\s*2|fase\s*ii|fase\s*2/.test(p)) return 3;
  if (/phase\s*i\b|phase\s*1|fase\s*i\b|fase\s*1/.test(p)) return 2;
  if (/preclinical|pre-clinical|preclinic/.test(p)) return 1;
  return 0;
}

/** Best (most advanced) clinical phase per ticker from Simulation sheet rows. */
export function buildTickerPhaseMap(
  rows: Record<string, unknown>[] | null | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows ?? []) {
    const tk = String(row.Ticker ?? row.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!tk || tk.includes("TOTALE") || tk === "TICKER") continue;
    const phase = clinicalPhaseFromSimRow(row);
    if (!phase) continue;
    const prev = map.get(tk);
    if (!prev || clinicalPhaseAdvanceRank(phase) > clinicalPhaseAdvanceRank(prev)) {
      map.set(tk, phase);
    }
  }
  return map;
}

export function clinicalIndicationFromSimRow(
  row: Record<string, unknown> | undefined,
  maxLen = 72,
): string {
  if (!row) return "";
  const fromGuidance = simCellText(row.guidance_indication);
  if (fromGuidance) {
    return fromGuidance.length > maxLen ? `${fromGuidance.slice(0, maxLen - 1)}…` : fromGuidance;
  }
  const col = colMatch(row, /indicaz|indication|terapeutic|conditions|condition/i);
  if (!col) return "";
  const v = simCellText(row[col]);
  if (!v || v === "—") return "";
  return v.length > maxLen ? `${v.slice(0, maxLen - 1)}…` : v;
}

export function clinicalNctFromSimRow(row: Record<string, unknown> | undefined): string | null {
  if (!row) return null;
  const nctCell = row.NCT ?? row.nct;
  const linkCell = row["Link studio"];
  const href =
    sheetCellAsLink(linkCell)?.href ?? sheetCellAsLink(nctCell)?.href ?? null;
  return (
    normNctId(nctCell) ??
    normNctId(linkCell) ??
    (href ? normNctId(href) : null)
  );
}

export function clinicalStudyHrefFromSimRow(
  row: Record<string, unknown> | undefined,
): string | null {
  if (!row) return null;
  const fromLink =
    sheetCellAsLink(row["Link studio"])?.href?.trim() ||
    sheetCellAsLink(row.NCT ?? row.nct)?.href?.trim() ||
    null;
  if (fromLink) return fromLink;
  const nct = clinicalNctFromSimRow(row);
  return nct ? nctClinicalTrialsUrl(nct) : null;
}

export function clinicalDrugFromSimRow(row: Record<string, unknown> | undefined): string {
  if (!row) return "";
  const tk = simCellText(row.Ticker ?? row.ticker).trim().toUpperCase();
  const fromGuidance = simCellText(row.guidance_asset_name).split(/[|,;/]/)[0]?.trim() ?? "";
  if (fromGuidance && usableProductName(fromGuidance) && fromGuidance.toUpperCase() !== tk) {
    return usableProductName(fromGuidance);
  }
  // Catalyst Days / desk Product column (when mirrored onto the sim row).
  const fromProductCol =
    usableProductName(simCellText(row.product ?? row.Product ?? row.Asset ?? row.asset)) || "";
  if (fromProductCol && fromProductCol.toUpperCase() !== tk) return fromProductCol;
  const col = colMatch(row, /farmaco|\bdrug\b|\basset\b|prodotto|intervento|intervention/i);
  if (!col) return "";
  const v = simCellText(row[col]).split(/[|,;/]/)[0]?.trim() ?? "";
  const usable = usableProductName(v);
  if (usable && usable.toUpperCase() !== tk) return usable;
  return "";
}

/** PDUFA / NDA / readout from a guidance-calendar sidecar row. */
export function catalystKindFromSimRow(row: Record<string, unknown> | undefined): string | null {
  if (!row) return null;
  return (
    formatRegulatoryMilestoneLabel(simCellText(row.guidance_event_type)) ||
    formatRegulatoryMilestoneLabel(clinicalPhaseFromSimRow(row)) ||
    formatRegulatoryMilestoneLabel(clinicalStudyTitleFromSimRow(row))
  );
}

export function catalystQuoteFromSimRow(row: Record<string, unknown> | undefined): string {
  if (!row) return "";
  return simCellText(row.guidance_source_quote);
}

const STUDY_TITLE_KEYS = [
  "Clinical Study",
  "Studio clinico",
  "Studio Clinico",
  "Study",
  "clinicalStudy",
  "brief_title",
  "Brief title",
  "Brief Title",
  "Official title",
  "Official Title",
  "Titolo studio",
  "Titolo Studio",
  "Study Title",
  "Trial name",
  "Trial Name",
];

/** Trial name from Simulation — skips PDUFA/NDA-style catalyst tokens. */
export function clinicalStudyTitleFromSimRow(
  row: Record<string, unknown> | undefined,
): string {
  if (!row) return "";
  for (const k of STUDY_TITLE_KEYS) {
    const v = simCellText(row[k]);
    if (!v || isRegulatoryMilestoneLabel(v)) continue;
    return v;
  }
  // Fuzzy column match (Excel headers vary).
  const col = colMatch(row, /studio\s*clinic|clinical\s*study|brief\s*title|official\s*title|titolo\s*studio|study\s*title|trial\s*name/i);
  if (col) {
    const v = simCellText(row[col]);
    if (v && !isRegulatoryMilestoneLabel(v)) return v;
  }
  return "";
}

/**
 * Prefer the Simulation row that matches desk ``rowKey`` / event CD;
 * fall back to the first row for the ticker.
 */
export function resolveSimRowForDeskEvent(
  rows: Record<string, unknown>[] | null | undefined,
  opts: {
    ticker: string;
    rowKey?: string | null;
    eventDate?: string | null;
  },
): Record<string, unknown> | undefined {
  const tk = String(opts.ticker ?? "")
    .trim()
    .toUpperCase();
  if (!tk || !rows?.length) return undefined;
  const wantKey = String(opts.rowKey ?? "").trim().toUpperCase();
  if (wantKey.includes("|")) {
    for (const row of rows) {
      const rTk = String(row.Ticker ?? row.ticker ?? "")
        .trim()
        .toUpperCase();
      if (rTk !== tk) continue;
      const key = `${rTk}|${normalizeCompletionDateLoose(row["Completion Date"])}`;
      if (key === wantKey) return row;
    }
  }
  const wantCd = String(opts.eventDate ?? "")
    .trim()
    .slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(wantCd)) {
    for (const row of rows) {
      const rTk = String(row.Ticker ?? row.ticker ?? "")
        .trim()
        .toUpperCase();
      if (rTk !== tk) continue;
      if (normalizeCompletionDateLoose(row["Completion Date"]) === wantCd) return row;
    }
  }
  for (const row of rows) {
    const rTk = String(row.Ticker ?? row.ticker ?? "")
      .trim()
      .toUpperCase();
    if (rTk === tk) return row;
  }
  return undefined;
}

function normalizeCompletionDateLoose(cd: unknown): string {
  if (cd == null || cd === "" || cd === "—" || cd === "-") return "—";
  const s = String(cd).trim();
  const isoHead = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (isoHead) return isoHead[1]!;
  const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (it) {
    const [, d, m, y] = it;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  return s;
}
