import type { ChartPoint, SheetTable } from "../types";
import { cikFromRow, secEdgarBrowse8kUrl, sheetCellAsLink } from "./cellLinks";

export type K8ChartMarker = {
  id: string;
  ticker: string;
  offset: number;
  y: number;
  label: string;
  filingDate: string;
  k8Session: number;
  edgarHref: string | null;
  browseHref: string | null;
  color: string;
};

/** Clinical publication recalibration marker (AI feed T…T+3). */
export type AiFeedChartMarker = {
  id: string;
  ticker: string;
  offset: number;
  y: number;
  label: string;
  eventDate: string;
  session: number;
  eventTitle: string;
  sourceType: string;
  link: string | null;
  /** Fixed violet — distinct from K-8 amber and ticker curve color. */
  color: string;
  verified: boolean;
  referenceMatch: string | null;
};

export type SecK8LinkEntry = {
  ticker: string;
  filingDate: string;
  edgarHref: string | null;
  browseHref: string | null;
};

/** Estrae URL da cella snapshot (oggetto {href} o repr Python legacy). */
export function parseEdgarHrefFromCell(raw: unknown): string | null {
  const link = sheetCellAsLink(raw);
  if (link?.href) return link.href;
  const s = String(raw ?? "");
  const m = s.match(/'href':\s*'([^']+)'/);
  return m ? m[1] : null;
}

function findCol(columns: string[], keyword: string): string {
  return columns.find((c) => c.includes(keyword)) ?? "";
}

/** Normalizza date filing in ``YYYY-MM-DD`` per lookup. */
export function normalizeFilingDateKey(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (!s) return "";
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (it) {
    const [, d, m, y] = it;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) {
    const dt = new Date(ms);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }
  return s.slice(0, 10);
}

export function secK8LookupKey(ticker: string, filingDate: unknown): string {
  return `${String(ticker).trim().toUpperCase()}|${normalizeFilingDateKey(filingDate)}`;
}

/** Indice ``TICKER|YYYY-MM-DD`` → link EDGAR / browse 8-K. */
export function buildSecK8LinkIndex(table: SheetTable | null): Map<string, SecK8LinkEntry> {
  const out = new Map<string, SecK8LinkEntry>();
  if (!table?.rows?.length) return out;
  const cols = table.columns ?? [];
  const colDate = findCol(cols, "filing 8-K") || findCol(cols, "Date filing");
  const colEdgar = findCol(cols, "EDGAR") || findCol(cols, "Elenco 8");

  for (const row of table.rows) {
    const ticker = String(row.Ticker ?? row.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!ticker) continue;
    const fd = colDate ? row[colDate] : null;
    const key = secK8LookupKey(ticker, fd);
    if (!key.endsWith("|")) {
      const edgarHref = colEdgar ? parseEdgarHrefFromCell(row[colEdgar]) : null;
      const cik = cikFromRow(row);
      const browseHref = cik ? secEdgarBrowse8kUrl(cik) : null;
      out.set(key, { ticker, filingDate: normalizeFilingDateKey(fd), edgarHref, browseHref });
    }
    if (!out.has(ticker)) {
      const cik = cikFromRow(row);
      if (cik) {
        out.set(ticker, {
          ticker,
          filingDate: "",
          edgarHref: null,
          browseHref: secEdgarBrowse8kUrl(cik),
        });
      }
    }
  }
  return out;
}

export function lookupSecK8Links(
  index: Map<string, SecK8LinkEntry>,
  ticker: string,
  filingDate: unknown
): SecK8LinkEntry | null {
  const tk = ticker.trim().toUpperCase();
  const byDate = index.get(secK8LookupKey(tk, filingDate));
  if (byDate) return byDate;
  return index.get(tk) ?? null;
}

/** Variazioni % storiche post filing K-8 (sedute +1/+2/+3). */
export function extractPostK8Markers(
  points: ChartPoint[],
  ticker: string,
  color: string,
  linkIndex: Map<string, SecK8LinkEntry>
): K8ChartMarker[] {
  const tk = ticker.trim().toUpperCase();
  const out: K8ChartMarker[] = [];
  for (const p of points) {
    if (p.nodo !== "K-8" && p.nodo !== "8-K") continue;
    const sess = Number((p as ChartPoint & { k8_session?: number }).k8_session ?? 0);
    if (sess < 1) continue;
    const raw = p.pct_reale ?? p.pct_curva;
    if (raw == null || raw !== raw || !Number.isFinite(Number(raw))) continue;
    const filingRaw =
      (p as ChartPoint & { k8_filing_date?: unknown }).k8_filing_date ??
      (p as ChartPoint & { data_cal?: unknown }).data_cal;
    const fd = normalizeFilingDateKey(filingRaw);
    const links = lookupSecK8Links(linkIndex, tk, fd);
    out.push({
      id: `${tk}_k8_${p.offset}_${sess}`,
      ticker: tk,
      offset: p.offset,
      y: Number(raw),
      label: p.label ?? `8-K +${sess}`,
      filingDate: fd,
      k8Session: sess,
      edgarHref: links?.edgarHref ?? null,
      browseHref: links?.browseHref ?? null,
      color,
    });
  }
  return out.sort((a, b) => a.offset - b.offset || a.k8Session - b.k8Session);
}

/** AI feed publication sessions used as seq-curve recalibration knots. */
export const AI_FEED_MARKER_COLOR = "#7c3aed";

export function extractAiFeedMarkers(
  points: ChartPoint[],
  ticker: string,
): AiFeedChartMarker[] {
  const tk = ticker.trim().toUpperCase();
  const out: AiFeedChartMarker[] = [];
  for (const p of points) {
    if (p.nodo !== "AI feed") continue;
    if (p.reference_verified === false) continue;
    const raw = p.pct_reale ?? p.pct_curva;
    if (raw == null || raw !== raw || !Number.isFinite(Number(raw))) continue;
    const sess = Number(p.ai_feed_session ?? 0);
    if (sess < 1) continue;
    const evDate = normalizeFilingDateKey(p.ai_feed_event_date ?? p.data_cal);
    out.push({
      id: `${tk}_aifeed_${p.offset}_${sess}`,
      ticker: tk,
      offset: p.offset,
      y: Number(raw),
      label: p.label ?? `Pub ${sess}`,
      eventDate: evDate,
      session: sess,
      eventTitle: String(p.event_title ?? p.label ?? "Clinical publication"),
      sourceType: String(p.source_type ?? "publication"),
      link: p.link ? String(p.link) : null,
      color: AI_FEED_MARKER_COLOR,
      verified: p.reference_verified ?? true,
      referenceMatch: p.reference_match ? String(p.reference_match) : null,
    });
  }
  return out.sort((a, b) => a.offset - b.offset || a.session - b.session);
}

export function openExternalUrl(href: string, e?: { preventDefault?: () => void; stopPropagation?: () => void }) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  const open = window.supernova?.shell?.openExternal;
  if (open) void open(href);
  else window.open(href, "_blank", "noopener,noreferrer");
}
