/**
 * High-impact EIS news for open-book toast alerts.
 * Only **today's** daily event EIS when |score| > 5 (not historical feed rows).
 */
import type { ClinicalPreCdRecord } from "../api/supernova";
import { buildTickerEisDetail, type TickerEisEventDetail } from "./tickerEisSummary";

export const HIGH_IMPACT_EIS_ABS = 5;

const ACK_KEY = "sn_high_impact_eis_ack_v2_today";
const NY_TZ = "America/New_York";

export type HighImpactEisAlert = {
  id: string;
  ticker: string;
  event: TickerEisEventDetail;
};

/** Calendar day YYYY-MM-DD in America/New_York (session day for NASDAQ news). */
export function highImpactEisDayKey(isoOrDate: string | Date = new Date()): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (!Number.isFinite(d.getTime())) {
    return typeof isoOrDate === "string" ? isoOrDate.slice(0, 10) : "";
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function highImpactEisAlertId(ticker: string, ev: TickerEisEventDetail): string {
  const tk = ticker.trim().toUpperCase();
  const date = (ev.eventDate ?? "").slice(0, 10);
  const score = Number.isFinite(ev.breakdown.score) ? ev.breakdown.score.toFixed(1) : "x";
  const title = (ev.title ?? "").trim().slice(0, 80);
  return `${tk}|${date}|${score}|${title}`;
}

export function loadHighImpactEisAcks(): Set<string> {
  try {
    const raw = localStorage.getItem(ACK_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function ackHighImpactEisAlert(id: string): void {
  try {
    const next = loadHighImpactEisAcks();
    next.add(id);
    // Cap growth — keep newest ~200 ids.
    const list = [...next];
    const trimmed = list.length > 200 ? list.slice(list.length - 200) : list;
    localStorage.setItem(ACK_KEY, JSON.stringify(trimmed));
  } catch {
    /* ignore */
  }
}

function eventDayKey(ev: TickerEisEventDetail): string | null {
  const raw = (ev.eventDate ?? "").trim();
  if (!raw) return null;
  // Already a calendar date
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.slice(0, 10)) && raw.length <= 10) {
    return raw.slice(0, 10);
  }
  return highImpactEisDayKey(raw);
}

/**
 * Events dated **today** (NY session) with |EIS| > 5 for open tickers.
 * Strongest first; skips already-acked ids.
 */
export function collectHighImpactEisAlerts(
  tickers: Iterable<string>,
  records: ClinicalPreCdRecord[] | null | undefined,
  lang: "it" | "en",
  acked: Set<string> = loadHighImpactEisAcks(),
  now: Date = new Date(),
): HighImpactEisAlert[] {
  const today = highImpactEisDayKey(now);
  const seen = new Set<string>();
  const out: HighImpactEisAlert[] = [];
  for (const raw of tickers) {
    const tk = raw.trim().toUpperCase();
    if (!tk || seen.has(tk)) continue;
    seen.add(tk);
    const detail = buildTickerEisDetail(tk, lang, null, records ?? undefined);
    for (const ev of detail.events) {
      if (ev.chartOnly) continue;
      const day = eventDayKey(ev);
      if (!day || day !== today) continue;
      const score = ev.breakdown.score;
      if (!Number.isFinite(score) || Math.abs(score) <= HIGH_IMPACT_EIS_ABS) continue;
      const id = highImpactEisAlertId(tk, ev);
      if (acked.has(id)) continue;
      out.push({ id, ticker: tk, event: ev });
    }
  }
  out.sort(
    (a, b) =>
      Math.abs(b.event.breakdown.score) - Math.abs(a.event.breakdown.score),
  );
  return out;
}
