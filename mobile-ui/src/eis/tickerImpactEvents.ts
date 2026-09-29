import type { TickerEisDetail, TickerEisEventDetail } from "./tickerEisSummary";

export type ImpactEventKind = "clinical" | "regulatory";

const REGULATORY_TITLE_RE =
  /\b(pdufa|complete response letter|crl|fda|nda|bla|snda|regulatory approval|sec filing|advisory committee|adcom|breakthrough therapy|fast track|orphan drug|priority review)\b/i;

export function classifyTickerEisEvent(ev: TickerEisEventDetail): ImpactEventKind {
  const st = String(ev.sourceType ?? "").toLowerCase();
  if (st === "manual") return "clinical";
  if (st.includes("sec") || st.includes("8-k") || st.includes("regulatory") || st === "cd_milestone") {
    return "regulatory";
  }
  if (ev.indicators.some((i) => String(i.kpi_type ?? "").toLowerCase() === "regulatory")) {
    return "regulatory";
  }
  const text = `${ev.title} ${ev.summary ?? ""}`;
  if (REGULATORY_TITLE_RE.test(text)) return "regulatory";
  return "clinical";
}

export function partitionTickerEisEvents(events: TickerEisEventDetail[]): {
  clinical: TickerEisEventDetail[];
  regulatory: TickerEisEventDetail[];
} {
  const clinical: TickerEisEventDetail[] = [];
  const regulatory: TickerEisEventDetail[] = [];
  for (const ev of events) {
    if (classifyTickerEisEvent(ev) === "regulatory") regulatory.push(ev);
    else clinical.push(ev);
  }
  return { clinical, regulatory };
}

export function sortEventsByImpact(events: TickerEisEventDetail[]): TickerEisEventDetail[] {
  return [...events].sort((a, b) => {
    const absDiff = Math.abs(b.breakdown.score) - Math.abs(a.breakdown.score);
    if (absDiff !== 0) return absDiff;
    const da = a.eventDate ? Date.parse(a.eventDate) : 0;
    const db = b.eventDate ? Date.parse(b.eventDate) : 0;
    return db - da;
  });
}

const MS_DAY = 24 * 60 * 60 * 1000;

export function sortEventsByRecency(events: TickerEisEventDetail[]): TickerEisEventDetail[] {
  return [...events].sort((a, b) => {
    const da = a.eventDate ? Date.parse(`${a.eventDate}T12:00:00`) : 0;
    const db = b.eventDate ? Date.parse(`${b.eventDate}T12:00:00`) : 0;
    return db - da;
  });
}

/** Events whose event_date falls within the last N calendar days (relative to nowMs). */
export function filterEventsLastDays(
  events: TickerEisEventDetail[],
  days: number,
  nowMs = Date.now(),
): TickerEisEventDetail[] {
  const cutoff = nowMs - days * MS_DAY;
  return sortEventsByRecency(
    events.filter((ev) => {
      if (!ev.eventDate) return false;
      const ms = Date.parse(`${ev.eventDate}T12:00:00`);
      return Number.isFinite(ms) && ms >= cutoff;
    }),
  );
}

/** Events whose event_date falls within the last 24 hours (1 calendar day window). */
export function filterEventsLast24h(events: TickerEisEventDetail[], nowMs = Date.now()): TickerEisEventDetail[] {
  return filterEventsLastDays(events, 1, nowMs);
}

export const EIS_RECENT_NEWS_DAYS = 7;

export function topImpactEventsByKind(
  detail: TickerEisDetail,
  maxPerKind = 2,
): { clinical: TickerEisEventDetail[]; regulatory: TickerEisEventDetail[] } {
  const { clinical, regulatory } = partitionTickerEisEvents(detail.events);
  return {
    clinical: sortEventsByImpact(clinical).slice(0, maxPerKind),
    regulatory: sortEventsByImpact(regulatory).slice(0, maxPerKind),
  };
}

export function impactKindBadge(
  kind: ImpactEventKind,
  it: boolean,
): { label: string; className: string } {
  if (kind === "regulatory") {
    return { label: it ? "Reg" : "Reg", className: "mob-impact-badge-reg" };
  }
  return { label: "EIS", className: "mob-impact-badge-eis" };
}
