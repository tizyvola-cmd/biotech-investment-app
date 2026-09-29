import { timelineKind } from "./clinicalTimeline";
import { blobMentionsProduct } from "./studyProductLink";
import {
  isScoredEisChartEvent,
  type TickerEisDetail,
  type TickerEisEventDetail,
} from "./tickerEisSummary";

export type ImpactEventKind = "clinical" | "regulatory";

const REGULATORY_TITLE_RE =
  /\b(pdufa|complete response letter|crl|fda|nda|bla|snda|regulatory approval|sec filing|advisory committee|adcom|breakthrough therapy|fast track|orphan drug|priority review)\b/i;

export function classifyTickerEisEvent(ev: TickerEisEventDetail): ImpactEventKind {
  const kind = timelineKind({ source_type: ev.sourceType } as { source_type?: string });
  // Manual 24h research always lives in the EIS / clinical lane — never regulatory.
  if (kind === "manual") return "clinical";

  if (kind === "sec_8k" || kind === "cd_milestone") return "regulatory";

  const st = ev.sourceType.toLowerCase();
  if (st.includes("sec") || st.includes("8-k") || st.includes("regulatory")) return "regulatory";

  if (
    ev.indicators.some((i) => String(i.kpi_type ?? "").toLowerCase() === "regulatory")
  ) {
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

export function isSec8kSourceType(sourceType: string | null | undefined): boolean {
  const st = String(sourceType ?? "").trim().toLowerCase();
  if (!st) return false;
  if (st === "sec_8k") return true;
  if (st.includes("8-k") || st.includes("8k")) return true;
  return timelineKind({ source_type: sourceType } as { source_type?: string }) === "sec_8k";
}

/** Clinical-news tab: trials / press / CT.gov / CD — never SEC 8-K filings. */
export function isFdaBriefingEvent(ev: TickerEisEventDetail): boolean {
  const st = String(ev.sourceType || "")
    .trim()
    .toLowerCase();
  return (
    st === "fda_briefing" ||
    st.includes("fda_briefing") ||
    st.includes("fda_adcom") ||
    st.includes("fda briefing")
  );
}

export function isClinicalNewsEvent(ev: TickerEisEventDetail): boolean {
  if (isFdaBriefingEvent(ev)) return false;
  if (isSec8kSourceType(ev.sourceType)) return false;
  const kind = timelineKind({ source_type: ev.sourceType } as { source_type?: string });
  if (kind === "sec_8k") return false;
  if (kind === "fda_briefing") return false;
  if (
    kind === "clinical" ||
    kind === "press_release" ||
    kind === "ctgov" ||
    kind === "cd_milestone" ||
    kind === "manual"
  ) {
    return true;
  }
  return classifyTickerEisEvent(ev) === "clinical";
}

export function clinicalNewsEventsOnly(
  events: TickerEisEventDetail[],
): TickerEisEventDetail[] {
  return events.filter(isClinicalNewsEvent);
}

export function fdaBriefingEventsOnly(
  events: TickerEisEventDetail[],
): TickerEisEventDetail[] {
  return events.filter(isFdaBriefingEvent);
}

function eventProductBlob(ev: TickerEisEventDetail): string {
  return [ev.title, ev.summary, ev.asset, ev.studyTitle, ev.nctId, ev.impactNote]
    .filter(Boolean)
    .join(" ");
}

/**
 * CD-chart popup: keep news that name this product (or share its NCT).
 * Ticker-wide clinical list stays on the Clinical news tab.
 */
export function clinicalEventsLinkedToProduct(
  events: TickerEisEventDetail[],
  opts: {
    productName?: string | null;
    aliases?: Array<string | null | undefined>;
    nctId?: string | null;
  } = {},
): TickerEisEventDetail[] {
  const nct = (opts.nctId || "").trim().toUpperCase();
  const product = (opts.productName || "").trim();
  if (!nct && product.length < 4) return [];
  return clinicalNewsEventsOnly(events).filter((ev) => {
    if (nct && (ev.nctId || "").trim().toUpperCase() === nct) return true;
    if (product.length >= 4 && blobMentionsProduct(eventProductBlob(ev), product, opts.aliases)) {
      return true;
    }
    return false;
  });
}

/** FDA AdCom briefings linked to this product (dedicated FDA Briefings session). */
export function fdaBriefingEventsLinkedToProduct(
  events: TickerEisEventDetail[],
  opts: {
    productName?: string | null;
    aliases?: Array<string | null | undefined>;
    nctId?: string | null;
  } = {},
): TickerEisEventDetail[] {
  const nct = (opts.nctId || "").trim().toUpperCase();
  const product = (opts.productName || "").trim();
  const pool = fdaBriefingEventsOnly(events);
  if (!nct && product.length < 4) return pool;
  return pool.filter((ev) => {
    if (nct && (ev.nctId || "").trim().toUpperCase() === nct) return true;
    if (
      product.length >= 4 &&
      blobMentionsProduct(eventProductBlob(ev), product, opts.aliases)
    ) {
      return true;
    }
    return false;
  });
}

export function sortEventsByRecency(events: TickerEisEventDetail[]): TickerEisEventDetail[] {
  return [...events].sort((a, b) => {
    const da = a.eventDate ? Date.parse(`${a.eventDate}T12:00:00`) : 0;
    const db = b.eventDate ? Date.parse(`${b.eventDate}T12:00:00`) : 0;
    return db - da;
  });
}

const MS_DAY = 24 * 60 * 60 * 1000;

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

/** Events whose event_date falls within the last 24 hours (relative to nowMs). */
export function filterEventsLast24h(
  events: TickerEisEventDetail[],
  nowMs = Date.now(),
): TickerEisEventDetail[] {
  return filterEventsLastDays(events, 1, nowMs);
}

/** Recent news window for EIS split panel (24h intraday + up to 7 calendar days). */
export const EIS_RECENT_NEWS_DAYS = 7;

export function sortEventsByImpact(events: TickerEisEventDetail[]): TickerEisEventDetail[] {
  return [...events].sort((a, b) => {
    const absDiff = Math.abs(b.breakdown.score) - Math.abs(a.breakdown.score);
    if (absDiff !== 0) return absDiff;
    const da = a.eventDate ? Date.parse(a.eventDate) : 0;
    const db = b.eventDate ? Date.parse(b.eventDate) : 0;
    return db - da;
  });
}

export function topImpactTickerEvents(
  detail: TickerEisDetail,
  maxCount = 4,
): TickerEisEventDetail[] {
  return sortEventsByImpact(detail.events).slice(0, maxCount);
}

/** Top clinical + regulatory contributors (default 2 per lane). */
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

function isManualSource(ev: TickerEisEventDetail): boolean {
  return ev.sourceType.toLowerCase() === "manual";
}

/**
 * EIS SCORE lane list: auto clinical events only.
 * A regulatory-classified event belongs to the regulatory lane — never mirror it
 * here, or the two lanes show the same rows twice.
 */
export function pickEisLaneEvents(
  events: TickerEisEventDetail[],
  maxCount = 2,
): TickerEisEventDetail[] {
  const { clinical } = partitionTickerEisEvents(events);
  const autoClinical = clinical.filter((ev) => !isManualSource(ev));
  return sortEventsByImpact(autoClinical).slice(0, maxCount);
}

/**
 * Latest-news strip: prefer 7d window (manual + auto), else most recent feed
 * events so the footer still shows the newest headlines.
 */
export function pickLatestEisNewsEvents(
  events: TickerEisEventDetail[],
  maxCount = 8,
  nowMs = Date.now(),
): TickerEisEventDetail[] {
  if (!events.length) return [];
  const recent = filterEventsLastDays(events, EIS_RECENT_NEWS_DAYS, nowMs);
  const pool = recent.length > 0 ? recent : sortEventsByRecency(events);
  return pool.slice(0, maxCount);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Sum of market-reaction EIS (`breakdown.score`). Empty list → null. */
export function sumEisMarketScores(events: TickerEisEventDetail[]): number | null {
  const scored = events.filter(isScoredEisChartEvent);
  if (!scored.length) return null;
  const total = scored.reduce((s, ev) => s + (Number.isFinite(ev.breakdown.score) ? ev.breakdown.score : 0), 0);
  return round1(total);
}

/** Sum of intrinsic KPI×10 (`eis_intrinsic`). Null when no event has a KPI score. */
export function sumEisIntrinsicScores(events: TickerEisEventDetail[]): number | null {
  let any = false;
  let total = 0;
  for (const ev of events) {
    if (!isScoredEisChartEvent(ev)) continue;
    const v = ev.breakdown.eis_intrinsic;
    if (v == null || !Number.isFinite(v)) continue;
    any = true;
    total += v;
  }
  return any ? round1(total) : null;
}

/**
 * Banner Market / Clinical totals.
 * Market = Σ price/volume scores across **all** feed events (clinical + regulatory +
 * manual). Falls back to the headline / sheet score when the feed has no events.
 * Clinical = Σ KPI×10 intrinsic (not added into market).
 */
export function resolveEisBannerDualScores(
  events: TickerEisEventDetail[],
  headlineScore: number | null | undefined,
): { market: number | null; clinical: number | null } {
  const marketFromEvents = sumEisMarketScores(events);
  const headline =
    headlineScore != null && Number.isFinite(headlineScore) ? round1(headlineScore) : null;
  return {
    market: marketFromEvents ?? headline,
    clinical: sumEisIntrinsicScores(events),
  };
}

export function impactKindBadge(
  kind: ImpactEventKind,
  it: boolean,
): { label: string; className: string } {
  if (kind === "regulatory") {
    return {
      label: it ? "Regolatorio" : "Regulatory",
      className: "feed-panel-chip-pending",
    };
  }
  return {
    label: "EIS",
    className: "feed-panel-chip-clin",
  };
}
