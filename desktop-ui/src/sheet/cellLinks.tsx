import type { ReactNode } from "react";

export type SheetCellLink = { text: string; href: string };

export type SheetCellMultiLink = {
  text?: string;
  links: SheetCellLink[];
};

const LINK_ANCHOR_CLASS =
  "!text-accent underline decoration-accent/60 underline-offset-2 hover:!text-accent/90 hover:decoration-accent";

const SEC_EDGAR_ELenco_COL_RE = /elenco.*8.?k|sec.*edgar/i;
const SEC_CIK_COL_RE = /^cik(\s*\(sec\))?$/i;

function openExternalHref(href: string, event: React.MouseEvent<HTMLAnchorElement>) {
  const open = window.supernova?.shell?.openExternal;
  if (!open) return;
  event.preventDefault();
  void open(href);
}

export function isSecEdgarElencoColumn(column: string): boolean {
  const norm = column.replace(/[\s_\n-]+/g, " ").trim();
  return SEC_EDGAR_ELenco_COL_RE.test(norm);
}

export function isSecCikColumn(column: string): boolean {
  const norm = column.replace(/[\s_\n-]+/g, " ").trim();
  return SEC_CIK_COL_RE.test(norm) || norm.toLowerCase().startsWith("cik");
}

export function cikDigitsFromCell(raw: unknown): string | null {
  const text = sheetCellPlainText(raw).replace(/\D/g, "");
  if (!text) return null;
  const n = parseInt(text, 10);
  return Number.isFinite(n) && n > 0 ? String(n) : null;
}

export function cikFromRow(row?: Record<string, unknown>): string | null {
  if (!row) return null;
  for (const key of Object.keys(row)) {
    if (!isSecCikColumn(key)) continue;
    const cik = cikDigitsFromCell(row[key]);
    if (cik) return cik;
  }
  return null;
}

export function secEdgarBrowse8kUrl(cik: string): string {
  return (
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany" +
    `&CIK=${cik}&type=8-K&owner=exclude&count=100`
  );
}

export function secSubmissionsJsonUrl(cik: string): string {
  const padded = cik.padStart(10, "0");
  return `https://data.sec.gov/submissions/CIK${padded}.json`;
}

/** Hyperlink da snapshot Excel oppure URL EDGAR da CIK (colonne SEC K-8). */
export function sheetCellAsLinkOrSec(
  raw: unknown,
  column?: string,
  row?: Record<string, unknown>
): SheetCellLink | null {
  const fromObj = sheetCellAsLink(raw);
  if (fromObj) return fromObj;
  if (!column) return null;
  const text = sheetCellPlainText(raw).trim();
  if (!text || text === "—") return null;
  const cik = cikFromRow(row) ?? cikDigitsFromCell(raw);
  if (isSecEdgarElencoColumn(column) && cik) {
    return { text: text || "Elenco 8-K (SEC)", href: secEdgarBrowse8kUrl(cik) };
  }
  if (isSecCikColumn(column) && cik) {
    return { text: text || cik.padStart(10, "0"), href: secSubmissionsJsonUrl(cik) };
  }
  return null;
}

const NCT_VALUE_RE = /^NCT\d{8,}$/i;
const NCT_COLUMN_RE = /^(nct[_\s-]?id|nctid|nct_number|study_id|nct)$/i;

export function isNctIdColumn(column: string): boolean {
  const key = column.trim().replace(/[\s_-]+/g, "_").toLowerCase();
  return NCT_COLUMN_RE.test(key) || key.startsWith("nct");
}

export function nctClinicalTrialsUrl(text: string): string | null {
  const s = text.trim().toUpperCase();
  return NCT_VALUE_RE.test(s) ? `https://clinicaltrials.gov/study/${s}` : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function sheetCellAsLink(raw: unknown): SheetCellLink | null {
  if (!isRecord(raw)) return null;
  const href = raw.href;
  if (typeof href !== "string" || !href.trim()) return null;
  const text = typeof raw.text === "string" && raw.text.trim() ? raw.text.trim() : href.trim();
  return { text, href: href.trim() };
}

/** Hyperlink da snapshot Excel oppure URL CT.gov da testo ``NCT…`` (colonne NCT). */
export function sheetCellAsLinkOrNct(raw: unknown, column?: string): SheetCellLink | null {
  const fromObj = sheetCellAsLink(raw);
  if (fromObj) return fromObj;
  if (column && !isNctIdColumn(column)) return null;
  const text = sheetCellPlainText(raw).trim();
  if (!text) return null;
  const href = nctClinicalTrialsUrl(text);
  return href ? { text, href } : null;
}

export function sheetCellAsMultiLink(raw: unknown): SheetCellMultiLink | null {
  if (!isRecord(raw) || !Array.isArray(raw.links) || raw.links.length === 0) return null;
  const links: SheetCellLink[] = [];
  for (const item of raw.links) {
    const link = sheetCellAsLink(item);
    if (link) links.push(link);
  }
  if (!links.length) return null;
  const text =
    typeof raw.text === "string" && raw.text.trim() ? raw.text.trim() : links.map((l) => l.text).join(" · ");
  return { text, links };
}

/** Testo piano per filtri tabella e tooltip. */
export function sheetCellPlainText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const multi = sheetCellAsMultiLink(raw);
  if (multi) return multi.text ?? multi.links.map((l) => l.text).join(" ");
  const single = sheetCellAsLink(raw);
  if (single) return single.text;
  if (typeof raw === "number") {
    return Number.isInteger(raw) ? String(raw) : raw.toFixed(2);
  }
  return String(raw);
}

export function renderSheetCellLinks(raw: unknown): ReactNode | null {
  const multi = sheetCellAsMultiLink(raw);
  if (multi) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {multi.links.map((link, i) => (
          <span key={`${link.href}-${i}`} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-ink-muted" aria-hidden>·</span>}
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK_ANCHOR_CLASS}
              onClick={(e) => openExternalHref(link.href, e)}
            >
              {link.text}
            </a>
          </span>
        ))}
      </span>
    );
  }
  const single = sheetCellAsLink(raw);
  if (!single) return null;
  return (
    <a
      href={single.href}
      target="_blank"
      rel="noopener noreferrer"
      className={LINK_ANCHOR_CLASS}
      onClick={(e) => openExternalHref(single.href, e)}
    >
      {single.text}
    </a>
  );
}
