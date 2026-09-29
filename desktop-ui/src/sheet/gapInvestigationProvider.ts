import type {
  ClinicalPublicationEvent,
  ClinicalPreCdRecord,
} from "../api/supernova";
import { hydrateClinicalPreCdRecords } from "./clinicalPreCdSnapshotCache";
import {
  loadManualFeedEvents,
  mergeManualEventsIntoRecords,
  type ManualFeedEventDraft,
} from "./manualFeedEvents";
import type {
  GapContextFinding,
  GapContextProvider,
  GapEvent,
  GapNewsType,
} from "./gapInvestigationTypes";

const ANALYST_RE =
  /\b(upgrade|downgrade|initiat|price target|pt\s*[:$]|outperform|underperform|analyst|jp morgan|goldman|bofa|barclays|jefferies|cantor|piper|leerink|morgan stanley)\b/i;

const SECTOR_RE =
  /\b(sector|xbi|ibb|biotech index|macro|risk.?off|rotation|broad market|market.?wide|selloff)\b/i;

function daysBetween(isoA: string, isoB: string): number {
  const a = Date.parse(`${isoA.slice(0, 10)}T12:00:00`);
  const b = Date.parse(`${isoB.slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.abs(Math.round((b - a) / 86400000));
}

function mapSourceToNewsType(sourceType: string, title: string, body: string): GapNewsType {
  const st = sourceType.toLowerCase();
  const blob = `${title} ${body}`.toLowerCase();
  if (st === "sec_8k" || /\b(8-k|fda|pdufa|crl|sec filing)\b/i.test(blob)) {
    return "regulatory_8k";
  }
  if (ANALYST_RE.test(blob)) return "analyst_action";
  if (SECTOR_RE.test(blob)) return "sector_wide";
  if (
    st === "clinical" ||
    st === "publication" ||
    st === "ctgov" ||
    st === "press_release" ||
    st === "congress" ||
    st === "cd_milestone"
  ) {
    return "clinical_data";
  }
  return "unknown";
}

function pickManualEvent(
  events: ManualFeedEventDraft[],
  gapDate: string,
): ManualFeedEventDraft | null {
  const inWindow = events
    .filter((e) => daysBetween(e.eventDate, gapDate) <= 7)
    .sort((a, b) => daysBetween(a.eventDate, gapDate) - daysBetween(b.eventDate, gapDate));
  return inWindow[0] ?? null;
}

function pickFeedEvent(
  events: ClinicalPublicationEvent[],
  gapDate: string,
): ClinicalPublicationEvent | null {
  const inWindow = events
    .filter((e) => e.event_date && daysBetween(e.event_date, gapDate) <= 7)
    .sort((a, b) => daysBetween(a.event_date!, gapDate) - daysBetween(b.event_date!, gapDate));
  return inWindow[0] ?? null;
}

function findingFromManual(manual: ManualFeedEventDraft): GapContextFinding {
  const hasSpecific =
    manual.investigationOutcome !== "no_catalyst" &&
    Boolean(manual.title?.trim() || manual.body?.trim());
  const newsType = mapSourceToNewsType(
    manual.source || "manual",
    manual.title,
    manual.body,
  );
  const summary =
    manual.title?.trim() ||
    manual.body?.trim().slice(0, 160) ||
    (manual.investigationOutcome === "no_catalyst"
      ? "No company-specific catalyst (manual research)"
      : null);
  return {
    ticker: manual.ticker,
    hasSpecificNews: hasSpecific,
    newsType: manual.investigationOutcome === "no_catalyst" ? "sector_wide" : newsType,
    summary,
    sourceUrl: manual.link ?? null,
    confidence: manual.investigationOutcome === "no_catalyst" ? "low" : "high",
  };
}

function findingFromFeedEvent(
  ticker: string,
  ev: ClinicalPublicationEvent,
): GapContextFinding {
  const title = String(ev.event_title ?? "").trim();
  const summary = String(ev.summary ?? ev.impact_note ?? title).trim();
  const sourceType = String(ev.source_type ?? ev.event_type ?? "clinical");
  const newsType = mapSourceToNewsType(sourceType, title, summary);
  return {
    ticker,
    hasSpecificNews: newsType !== "sector_wide" && newsType !== "unknown",
    newsType,
    summary: summary || title || null,
    sourceUrl: ev.link ?? null,
    confidence: sourceType === "manual" ? "high" : "low",
  };
}

/**
 * Investigates gap context from merged clinical feed + manual research store.
 * Replaces the Phase-2b stub — no external API required for v1.
 */
export class FeedGapContextProvider implements GapContextProvider {
  constructor(
    private readonly loadRecords: () => ClinicalPreCdRecord[] = hydrateClinicalPreCdRecords,
    private readonly loadManual: () => ManualFeedEventDraft[] = loadManualFeedEvents,
  ) {}

  async investigate(event: GapEvent): Promise<GapContextFinding> {
    const ticker = event.ticker.trim().toUpperCase();
    const gapDate = event.tickTimestamp.slice(0, 10);

    const manual = pickManualEvent(
      this.loadManual().filter((e) => e.ticker.trim().toUpperCase() === ticker),
      gapDate,
    );
    if (manual) return findingFromManual(manual);

    const merged = mergeManualEventsIntoRecords(this.loadRecords());
    const rec = merged.find((r) => String(r.ticker ?? "").trim().toUpperCase() === ticker);
    const feedEv = pickFeedEvent(rec?.clinical_events ?? [], gapDate);
    if (feedEv) return findingFromFeedEvent(ticker, feedEv);

    return {
      ticker,
      hasSpecificNews: false,
      newsType: "unknown",
      summary: null,
      sourceUrl: null,
      confidence: "low",
    };
  }
}

/** Placeholder — kept for tests; production uses FeedGapContextProvider. */
export class StubGapContextProvider implements GapContextProvider {
  async investigate(event: GapEvent): Promise<GapContextFinding> {
    return {
      ticker: event.ticker,
      hasSpecificNews: false,
      newsType: "unknown",
      summary: null,
      sourceUrl: null,
      confidence: "low",
    };
  }
}

let defaultProvider: GapContextProvider = new FeedGapContextProvider();

export function getGapContextProvider(): GapContextProvider {
  return defaultProvider;
}

export function setGapContextProvider(provider: GapContextProvider): void {
  defaultProvider = provider;
}
