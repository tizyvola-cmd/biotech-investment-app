/**
 * Company SEC 8-K filings for the Deep Dive Financial tab.
 * Display only — not Soft BUY/SELL.
 */
import type { ClinicalPreCdRecord } from "../api/supernova";
import { isSecK8Event, recordEvents } from "./clinicalTimeline";

export type Ticker8kFiling = {
  id: string;
  eventDate: string | null;
  title: string;
  summary: string | null;
  itemsRaw: string | null;
  link: string | null;
  financialScore: number | null;
  eisScore: number | null;
  impactNote: string | null;
};

function clean(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  return s ? s : null;
}

function num(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

function filingKey(ev: {
  link?: string | null;
  event_date?: string | null;
  event_title?: string;
  summary?: string;
}): string {
  const link = clean(ev.link)?.toLowerCase();
  if (link) return `url:${link}`;
  const date = clean(ev.event_date) ?? "";
  const title = clean(ev.event_title) || clean(ev.summary) || "";
  return `row:${date}|${title.toLowerCase()}`;
}

function richness(f: Ticker8kFiling): number {
  return (
    (f.summary?.length ?? 0) +
    (f.financialScore != null ? 40 : 0) +
    (f.itemsRaw ? 8 : 0) +
    (f.link ? 8 : 0)
  );
}

export function collectTicker8kFilings(
  records: ClinicalPreCdRecord[] | null | undefined,
  ticker: string,
): Ticker8kFiling[] {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return [];
  const byKey = new Map<string, Ticker8kFiling>();
  for (const rec of records ?? []) {
    if (String(rec.ticker ?? "").trim().toUpperCase() !== tk) continue;
    for (const ev of recordEvents(rec)) {
      if (!isSecK8Event(ev)) continue;
      const title =
        clean(ev.event_title) ||
        clean(ev.summary) ||
        "SEC 8-K";
      const filing: Ticker8kFiling = {
        id: filingKey(ev),
        eventDate: clean(ev.event_date),
        title,
        summary: clean(ev.summary) && clean(ev.summary) !== title ? clean(ev.summary) : null,
        itemsRaw: clean(ev.items_raw),
        link: clean(ev.link),
        financialScore: num(ev.financial_score) ?? num(ev.eis_score) ?? num(ev.eis?.score),
        eisScore: num(ev.eis?.score) ?? num(ev.eis_score),
        impactNote: clean(ev.impact_note),
      };
      const prev = byKey.get(filing.id);
      if (!prev || richness(filing) >= richness(prev)) byKey.set(filing.id, filing);
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const da = a.eventDate ? Date.parse(`${a.eventDate}T12:00:00`) : 0;
    const db = b.eventDate ? Date.parse(`${b.eventDate}T12:00:00`) : 0;
    return db - da;
  });
}
