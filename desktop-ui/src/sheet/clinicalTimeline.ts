import type { ClinicalPreCdRecord, ClinicalPublicationEvent } from "../api/supernova";
import {
  isClinicalPreCdRecordTrusted,
  trustedRecordEvents,
} from "./referenceVerification";

export type TimelineKind =
  | "sec_8k"
  | "clinical"
  | "press_release"
  | "ctgov"
  | "cd_milestone";

export type EventSourceFilter =
  | "all"
  | "clinical"
  | "k8"
  | "press"
  | "cd";

export type UnifiedTimelineRow = {
  event: ClinicalPublicationEvent;
  ticker: string;
  company: string;
  nctId: string | null;
  studyTitle: string;
};

export function recordEvents(rec: ClinicalPreCdRecord): ClinicalPublicationEvent[] {
  return rec.clinical_events ?? rec.timeline_events ?? [];
}

/** Events safe for EIS / timeline: sponsor-OK study + verified reference (or SEC 8-K). */
export { trustedRecordEvents } from "./referenceVerification";

export function eventDateMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

export function timelineKind(ev: ClinicalPublicationEvent): TimelineKind {
  const st = String(ev.source_type ?? "").toLowerCase();
  const et = String((ev as { event_type?: string }).event_type ?? "").toLowerCase();
  if (st === "sec_8k" || et === "sec_8k") return "sec_8k";
  if (st === "cd_milestone" || et === "cd_milestone") return "cd_milestone";
  if (st === "ctgov" || et === "ctgov") return "ctgov";
  if (st === "press_release" || et === "press_release" || st.includes("press")) {
    return "press_release";
  }
  if (st === "congress" || st === "publication") {
    return "clinical";
  }
  return "clinical";
}

export function timelineBadge(
  kind: TimelineKind,
  lang: "it" | "en",
): { label: string; className: string } {
  const it = lang === "it";
  switch (kind) {
    case "sec_8k":
      return { label: "◆ 8-K SEC", className: "feed-panel-chip-pending" };
    case "press_release":
      return { label: it ? "📰 Press" : "📰 Press", className: "feed-panel-chip-press" };
    case "cd_milestone":
      return { label: it ? "📅 CD" : "📅 CD", className: "feed-panel-chip-cd" };
    case "ctgov":
      return { label: "CT.gov", className: "feed-panel-chip-clin" };
    default:
      return { label: it ? "🧬 Clinico" : "🧬 Clinical", className: "feed-panel-chip-clin" };
  }
}

export function isSecK8Event(ev: ClinicalPublicationEvent): boolean {
  return timelineKind(ev) === "sec_8k";
}

export function filterEventsBySource(
  events: ClinicalPublicationEvent[],
  sourceFilter: EventSourceFilter,
): ClinicalPublicationEvent[] {
  if (sourceFilter === "all") return events;
  if (sourceFilter === "k8") return events.filter((ev) => timelineKind(ev) === "sec_8k");
  if (sourceFilter === "press") {
    return events.filter((ev) => timelineKind(ev) === "press_release");
  }
  if (sourceFilter === "cd") {
    return events.filter((ev) => {
      const k = timelineKind(ev);
      return k === "cd_milestone" || k === "ctgov";
    });
  }
  return events.filter((ev) => timelineKind(ev) === "clinical");
}

/** Synthetic milestones: expected CD + CT.gov updates in window. */
export function buildSyntheticTimelineEvents(
  rec: ClinicalPreCdRecord,
  lang: "it" | "en",
): ClinicalPublicationEvent[] {
  const it = lang === "it";
  const out: ClinicalPublicationEvent[] = [];
  const title = rec.meta?.brief_title ?? rec.nct_id ?? rec.ticker ?? "Study";
  const drug =
    String(rec.meta?.interventions ?? "")
      .split("|")[0]
      ?.trim()
      ?.slice(0, 80) || "—";

  if (rec.cd_date) {
    out.push({
      event_date: rec.cd_date,
      event_title: it
        ? `CD prevista — ${title}`
        : `Expected CD — ${title}`,
      summary: it
        ? `Primary completion / readout · NCT ${rec.nct_id ?? "—"} · fase ${rec.meta?.phase ?? "—"}`
        : `Primary completion / readout · NCT ${rec.nct_id ?? "—"} · phase ${rec.meta?.phase ?? "—"}`,
      drug,
      source_type: "cd_milestone",
      event_type: "cd_milestone",
      link_label: "CD",
      sentiment: 0,
      impact_note: it ? "Milestone simulazione" : "Simulation milestone",
    } as ClinicalPublicationEvent);
  }

  const ctUp = (rec as { last_ctgov_update?: string }).last_ctgov_update;
  if (ctUp && (rec as { update_in_pre_cd_window?: boolean }).update_in_pre_cd_window) {
    out.push({
      event_date: ctUp,
      event_title: it ? "Aggiornamento CT.gov" : "CT.gov registry update",
      summary: it
        ? `Registro aggiornato · status ${rec.meta?.overall_status ?? "—"}`
        : `Registry updated · status ${rec.meta?.overall_status ?? "—"}`,
      drug,
      source_type: "ctgov",
      event_type: "ctgov",
      link: rec.nct_id
        ? `https://clinicaltrials.gov/study/${rec.nct_id}`
        : undefined,
      link_label: "CT.gov",
      sentiment: 0,
      impact_note: it ? "Dati registry" : "Registry data",
    } as ClinicalPublicationEvent);
  }
  return out;
}

export function buildCompanyUnifiedTimeline(
  records: ClinicalPreCdRecord[],
  ticker: string,
  lang: "it" | "en",
): UnifiedTimelineRow[] {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return [];

  const merged: UnifiedTimelineRow[] = [];
  for (const rec of records) {
    if (String(rec.ticker ?? "").toUpperCase() !== tk) continue;
    if (!isClinicalPreCdRecordTrusted(rec)) continue;
    const studyTitle = rec.meta?.brief_title ?? rec.nct_id ?? "—";
    const nct = rec.nct_id ?? null;
    for (const ev of trustedRecordEvents(rec)) {
      merged.push({
        event: ev,
        ticker: tk,
        company: rec.company ?? tk,
        nctId: nct,
        studyTitle,
      });
    }
    for (const ev of buildSyntheticTimelineEvents(rec, lang)) {
      merged.push({
        event: ev,
        ticker: tk,
        company: rec.company ?? tk,
        nctId: nct,
        studyTitle,
      });
    }
  }

  const seen = new Set<string>();
  const deduped: UnifiedTimelineRow[] = [];
  for (const row of merged.sort(
    (a, b) => eventDateMs(b.event.event_date) - eventDateMs(a.event.event_date),
  )) {
    const key = `${row.event.event_date}|${String(row.event.event_title ?? "").slice(0, 48)}|${row.nctId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

export function groupRecordsByTicker(
  records: ClinicalPreCdRecord[],
): Map<string, ClinicalPreCdRecord[]> {
  const m = new Map<string, ClinicalPreCdRecord[]>();
  for (const rec of records) {
    const tk = String(rec.ticker ?? "").trim().toUpperCase();
    if (!tk) continue;
    const list = m.get(tk) ?? [];
    list.push(rec);
    m.set(tk, list);
  }
  return m;
}
