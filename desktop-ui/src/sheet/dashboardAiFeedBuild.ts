import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "../api/supernova";
import { resolveEventEis } from "./eventImpactScore";
import { isClinicalPreCdRecordTrusted, isEventReferenceVerified, trustedRecordEvents } from "./referenceVerification";
import { timelineKind } from "./clinicalTimeline";
import { daysFromToday } from "./simulationPlanGain";

export type DashboardAiFeedTickerMeta = {
  inPortfolio: boolean;
  daysToCd: number | null;
};

export type DashboardAiFeedItem = {
  id: string;
  ticker: string;
  company: string;
  eventDate: string;
  eventDateMs: number;
  title: string;
  drug: string;
  delta1d: number | null;
  eis: number | null;
  impactAbs: number;
  sourceType: string;
  link: string | null;
  linkLabel: string;
  verified: boolean;
  inPortfolio: boolean;
  daysToCd: number | null;
};

function isSecK8Event(ev: ClinicalPublicationEvent): boolean {
  return String(ev.source_type ?? "").toLowerCase() === "sec_8k";
}

function eventDateMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function eventDrug(ev: ClinicalPublicationEvent): string {
  const raw = ev.drug ?? ev.asset ?? "—";
  return String(raw ?? "—").trim() || "—";
}

/** Skip synthetic future CD milestones with no price/KPI signal — they are not feed news. */
function includeInDashboardFeed(item: DashboardAiFeedItem, now: number): boolean {
  if (item.sourceType !== "cd_milestone") return true;
  if (item.eventDateMs <= now) return true;
  return item.impactAbs >= 0.5 || item.delta1d != null;
}

function feedRank(item: DashboardAiFeedItem, now: number, past30: number): number {
  const isPast = item.eventDateMs <= now;
  const isRecentPast = isPast && item.eventDateMs >= past30;
  let rank = 0;
  if (isRecentPast) rank += 10_000;
  else if (isPast) rank += 5_000;
  rank += item.impactAbs * 100;
  if (item.delta1d != null) rank += Math.abs(item.delta1d) * 10;
  rank += isPast ? item.eventDateMs / 1e10 : -item.eventDateMs / 1e10;
  return rank;
}

export function flattenAiFeed(
  records: ClinicalPreCdRecord[],
  scopeTickers: Set<string>,
  tickerMeta?: Map<string, DashboardAiFeedTickerMeta>,
): DashboardAiFeedItem[] {
  const out: DashboardAiFeedItem[] = [];
  for (const rec of records) {
    const ticker = String(rec.ticker ?? "")
      .trim()
      .toUpperCase();
    if (!ticker || !scopeTickers.has(ticker)) continue;
    if (!isClinicalPreCdRecordTrusted(rec)) continue;

    for (const ev of trustedRecordEvents(rec)) {
      if (isSecK8Event(ev)) continue;
      const ms = eventDateMs(ev.event_date);
      if (!ms) continue;
      const indicators = ev.indicators?.length ? ev.indicators : rec.clinical_indicators;
      const resolved = resolveEventEis(ev, indicators);
      const delta1dRaw = ev.price?.delta_p_1d ?? resolved?.delta_p_1d ?? null;
      const delta1d =
        delta1dRaw != null && Number.isFinite(delta1dRaw) ? delta1dRaw : null;
      const eis =
        resolved?.score != null && Number.isFinite(resolved.score)
          ? resolved.score
          : null;
      const impactAbs = Math.abs(eis ?? 0);
      const meta = tickerMeta?.get(ticker);
      const cdFromRec = rec.cd_date ? daysFromToday(String(rec.cd_date)) : null;
      out.push({
        id: `${ticker}_${ev.event_date}_${ev.event_title ?? ""}`,
        ticker,
        company: String(rec.company ?? ticker),
        eventDate: String(ev.event_date ?? ""),
        eventDateMs: ms,
        title: String(ev.event_title ?? "—"),
        drug: eventDrug(ev),
        delta1d,
        eis,
        impactAbs,
        sourceType: timelineKind(ev),
        link: ev.link ? String(ev.link) : null,
        linkLabel: String(ev.link_label ?? "Link"),
        verified: isEventReferenceVerified(ev, rec),
        inPortfolio: meta?.inPortfolio ?? false,
        daysToCd: meta?.daysToCd ?? cdFromRec,
      });
    }
  }
  return out;
}

export function rankAndSliceFeed(items: DashboardAiFeedItem[], limit: number): DashboardAiFeedItem[] {
  const now = Date.now();
  const past30 = now - 30 * 86400000;
  const eligible = items.filter((item) => includeInDashboardFeed(item, now));
  return [...eligible]
    .sort((a, b) => feedRank(b, now, past30) - feedRank(a, now, past30))
    .slice(0, limit);
}

export function countRecentPastEvents(items: DashboardAiFeedItem[]): number {
  const now = Date.now();
  const cutoff = now - 30 * 86400000;
  return items.filter(
    (r) => r.eventDateMs >= cutoff && r.eventDateMs <= now && includeInDashboardFeed(r, now),
  ).length;
}
