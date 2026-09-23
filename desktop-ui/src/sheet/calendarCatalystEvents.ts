/**
 * Merge Guidance calendar + FDA AdCom + SEC forward into GuidanceCalendarEvent[]
 * so Simulation deep-dive (table, drug-development lane, price chart)
 * sees the same list as the Calendar tab.
 */
import type {
  CatalystCalendarEntry,
  FdaAdcomCalendarSnapshot,
  GuidanceCalendarEvent,
} from "../api/supernova";
import { isPastCalendarEvent, calendarSortAnchorIso } from "./calendarPhase1";
import {
  FDA_ADCOM_CALENDAR,
  rowsInFdaAdcomHorizon,
  sortFdaAdcomRows,
  type FdaAdcomRow,
} from "./fdaAdcomCalendar";
import { completionDateToIso } from "./nextCatalystEvent";

export type FdaCalendarLike = {
  id?: string;
  date: string;
  ticker: string;
  company: string;
  product: string;
  eventEn?: string;
  eventIt?: string;
  kind?: string;
  href?: string;
};

export function fdaAdcomToGuidanceEvent(
  row: FdaCalendarLike,
  it = false,
): GuidanceCalendarEvent {
  const safety = row.kind === "safety_review" || row.kind === "fda_safety";
  const quote = it
    ? row.eventIt || row.eventEn || ""
    : row.eventEn || row.eventIt || "";
  return {
    ticker: row.ticker.trim().toUpperCase(),
    company: row.company,
    event_type: safety ? "fda_safety" : "fda_vote",
    asset_name: row.product,
    trial_phase: null,
    timing_quote: quote,
    window_start: row.date,
    window_end: row.date,
    source_type: "fda_adcom",
    source_date: row.date,
    confidence: 0.95,
    estimation_method: "fda_calendar",
    link: row.href || null,
    main_inflection: !safety,
    inflection_importance: safety ? -40 : 50,
    inflection_label: safety ? "FDA safety review" : "Advisory Committee",
  };
}

/** Map SEC 8-K forward calendar rows into the main Calendar event shape. */
export function secForwardToGuidanceEvent(e: CatalystCalendarEntry): GuidanceCalendarEvent | null {
  const ticker = String(e.ticker || "").trim().toUpperCase();
  if (!ticker) return null;
  const et = String(e.event_type || "").toLowerCase();
  let eventType: GuidanceCalendarEvent["event_type"] = "other";
  if (et === "pdufa") eventType = "pdufa";
  else if (et === "adcom") eventType = "fda_vote";
  else if (et === "readout") eventType = "readout";
  else if (et === "partnership") eventType = "partnership";
  else if (et === "conference") eventType = "other";

  const confMap: Record<string, number> = { high: 0.9, medium: 0.65, low: 0.4 };
  const conf = confMap[String(e.confidence || "").toLowerCase()] ?? 0.55;

  let windowStart: string | null = null;
  let windowEnd: string | null = null;
  if (e.date_precision === "exact_date" && e.date_value) {
    windowStart = e.date_value.slice(0, 10);
    windowEnd = windowStart;
  } else if (e.window_label) {
    const range = windowLabelToIsoRange(e.window_label);
    windowStart = range.start;
    windowEnd = range.end;
  }

  const quote =
    e.raw_snippet ||
    (e.window_label ? `SEC ${e.event_type}: ${e.window_label}` : `SEC ${e.event_type || "event"}`);

  return {
    ticker,
    company: ticker,
    event_type: eventType,
    asset_name:
      et === "conference"
        ? "Conference"
        : et === "adcom"
          ? "AdCom"
          : et === "partnership"
            ? e.partner || "Partnership"
            : null,
    trial_phase: null,
    timing_quote: quote,
    window_start: windowStart,
    window_end: windowEnd,
    source_type: "sec_forward",
    source_date: (e.filing_date || e.extracted_at || "").slice(0, 10) || null,
    confidence: conf,
    estimation_method: "sec_8k_extract",
    link: e.source_filing_url || null,
    main_inflection: e.main_inflection === true,
    inflection_importance:
      typeof e.inflection_importance === "number" ? e.inflection_importance : null,
    inflection_label: e.inflection_label || null,
  };
}

/** Rough ISO bounds for readout windows like ``2H 2026`` / ``Q4 2026``. */
export function windowLabelToIsoRange(label: string): { start: string | null; end: string | null } {
  const s = label.trim();
  let m = /^Q([1-4])\s*(20\d{2})$/i.exec(s);
  if (m) {
    const q = Number(m[1]);
    const y = m[2]!;
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const endDay = endMonth === 2 ? 28 : [4, 6, 9, 11].includes(endMonth) ? 30 : 31;
    return {
      start: `${y}-${String(startMonth).padStart(2, "0")}-01`,
      end: `${y}-${String(endMonth).padStart(2, "0")}-${endDay}`,
    };
  }
  m = /^(?:2H|H2)\s*(20\d{2})$/i.exec(s);
  if (m) return { start: `${m[1]}-07-01`, end: `${m[1]}-12-31` };
  m = /^(?:1H|H1)\s*(20\d{2})$/i.exec(s);
  if (m) return { start: `${m[1]}-01-01`, end: `${m[1]}-06-30` };
  m = /^mid[- ]?(20\d{2})$/i.exec(s);
  if (m) return { start: `${m[1]}-06-01`, end: `${m[1]}-07-31` };
  return { start: null, end: null };
}

export function calendarEventDedupeKey(ev: GuidanceCalendarEvent): string {
  return [
    (ev.ticker || "").trim().toUpperCase(),
    (ev.window_start || ev.window_end || "").slice(0, 10),
    ev.event_type || "",
    (ev.asset_name || "").trim().toLowerCase(),
    (ev.source_type || "").trim().toLowerCase(),
  ].join("|");
}

export function mergeGuidanceAndFdaEvents(
  guidance: GuidanceCalendarEvent[] | undefined,
  fdaRows: FdaCalendarLike[],
  it = false,
): GuidanceCalendarEvent[] {
  return mergeCalendarSources(guidance, fdaRows, undefined, it);
}

/** Simulation / CT.gov Completion Date → Calendar `cd` row. */
export function simRowToCdEvent(
  row: Record<string, unknown>,
  today = new Date(),
): GuidanceCalendarEvent | null {
  const ticker = String(row.Ticker ?? row.ticker ?? "")
    .trim()
    .toUpperCase();
  if (!ticker || ticker === "TOTALE PORTAFOGLIO") return null;
  const rawCd = row["Completion Date"] ?? row.CD ?? row.completion_date;
  const iso = completionDateToIso(
    rawCd != null ? String(rawCd) : null,
    null,
    today,
  );
  if (!iso) return null;
  const company = String(
    row["Società"] ?? row["Società (full name)"] ?? row.Company ?? row.company ?? ticker,
  ).trim();
  const nct = String(row.NCT ?? row.nct_id ?? "")
    .trim()
    .toUpperCase();
  const drug = String(row.Drug ?? row.drug ?? "").trim();
  const indication = String(row.Indication ?? row.indication ?? "").trim();
  const phase = String(row["Studio Phase"] ?? row.Phase ?? "").trim();
  return {
    ticker,
    company,
    event_type: "cd",
    asset_name: drug || null,
    trial_phase: phase || null,
    indication: indication || null,
    timing_quote: nct ? `Primary completion ${iso} (${nct})` : `Primary completion ${iso}`,
    window_start: iso,
    window_end: iso,
    source_type: "clinicaltrials.gov",
    source_date: iso,
    confidence: 0.92,
    estimation_method: "simulation_completion_date",
    sim_cd_date: iso,
    link: nct.startsWith("NCT") ? `https://clinicaltrials.gov/study/${nct}` : null,
  };
}

export function simRowsToCdEvents(
  rows: Array<Record<string, unknown>> | undefined,
  today = new Date(),
): GuidanceCalendarEvent[] {
  const out: GuidanceCalendarEvent[] = [];
  const seen = new Set<string>();
  for (const row of rows ?? []) {
    const ev = simRowToCdEvent(row, today);
    if (!ev || isPastCalendarEvent(ev, today)) continue;
    const k = `${ev.ticker}|${ev.window_start}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(ev);
  }
  return out;
}

export function mergeCalendarSources(
  guidance: GuidanceCalendarEvent[] | undefined,
  fdaRows: FdaCalendarLike[] | undefined,
  secEntries: CatalystCalendarEntry[] | undefined,
  it = false,
  cdEvents?: GuidanceCalendarEvent[] | undefined,
): GuidanceCalendarEvent[] {
  const out: GuidanceCalendarEvent[] = [];
  const seen = new Set<string>();
  const push = (ev: GuidanceCalendarEvent) => {
    // Never keep fully past events in the merged Calendar list.
    if (isPastCalendarEvent(ev)) return;
    const k = calendarEventDedupeKey(ev);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(ev);
  };
  for (const ev of guidance ?? []) push(ev);
  for (const ev of cdEvents ?? []) push(ev);
  for (const row of fdaRows ?? []) {
    if (!row.ticker || !row.date) continue;
    push(fdaAdcomToGuidanceEvent(row, it));
  }
  for (const row of secEntries ?? []) {
    const ev = secForwardToGuidanceEvent(row);
    if (ev) push(ev);
  }
  out.sort((a, b) =>
    calendarSortAnchorIso(a).localeCompare(calendarSortAnchorIso(b)),
  );
  return out;
}

export function fdaRowsFromSnapshot(
  snap: FdaAdcomCalendarSnapshot | null | undefined,
  today = new Date(),
): FdaAdcomRow[] {
  const raw = snap?.rows ?? [];
  const mapped: FdaAdcomRow[] = raw
    .filter((r) => r.ticker && r.date)
    .map((r) => ({
      id: r.id,
      date: r.date,
      ticker: r.ticker.trim().toUpperCase(),
      company: r.company,
      product: r.product,
      eventEn: r.eventEn,
      eventIt: r.eventIt,
      committee: r.committee,
      kind: r.kind === "safety_review" ? "safety_review" : "vote",
      href: r.href,
      briefing: r.briefing
        ? {
            status: r.briefing.status || "none",
            score: r.briefing.score ?? null,
            stance: r.briefing.stance ?? null,
            title: r.briefing.title || "",
            summaryEn: r.briefing.summaryEn || "",
            summaryIt: r.briefing.summaryIt || "",
            bulletsEn: r.briefing.bulletsEn ?? [],
            bulletsIt: r.briefing.bulletsIt ?? [],
            materialsUrl: r.briefing.materialsUrl || "",
            pdfUrl: r.briefing.pdfUrl || "",
            matchOk: r.briefing.matchOk,
            matchHint: r.briefing.matchHint,
            source: r.briefing.source,
            updated_at: r.briefing.updated_at,
          }
        : null,
    }));
  const byId = new Map<string, FdaAdcomRow>();
  for (const row of [...FDA_ADCOM_CALENDAR, ...mapped]) {
    const key = row.id || `${row.ticker}|${row.date}`;
    byId.set(key, row);
  }
  return sortFdaAdcomRows(rowsInFdaAdcomHorizon([...byId.values()], today));
}
