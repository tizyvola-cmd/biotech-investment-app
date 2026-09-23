/**
 * Decision-desk calendar: one row per known catalyst event.
 * Sources: Simulation CD, guidance calendar, congress calendar + pending hypotheses.
 * Display only — does not change deriveSuggestedAction / Soft BUY-SELL.
 */
import type {
  ClinicalPreCdRecord,
  ClinicalPublicationEvent,
  GuidanceCalendarEvent,
  PendingHypothesisItem,
} from "../api/supernova";
import {
  congressBlob,
  congressRefUrl,
  congressSlotOnDate,
  congressTypeLabel,
  FDA_DAF_URL,
  nextCongressSlot,
  type CongressSlot,
} from "./conferenceCalendar";
import { isWarrantTicker } from "./simulationPosition";
import { usableProductName } from "./simRowClinicalMeta";
import {
  completionDateToIso,
  daysUntilIso,
  precatEventTypeLabel,
  type PrecatDateType,
  type PrecatEventType,
} from "./nextCatalystEvent";
import { CALENDAR_CATALYST_HORIZON_DAYS } from "./calendarPhase1";

/** Catalyst Desk: ≤20d events (+ red-★). Same as Calendar → Catalyst migrate tier. */
export const DESK_CALENDAR_HORIZON_DAYS = CALENDAR_CATALYST_HORIZON_DAYS;
/** Keep completed Catalyst Days on the desk this many days after the event. */
export const DESK_POST_CD_RETENTION_DAYS = 7;
/** Near-term Catalyst tab: today through day 7. Later tab = day 8 … horizon. */
export const DESK_NEAR_HORIZON_DAYS = 7;
export const DESK_TREND_ATTENTION_Z = 1.5;

const TYPE_FROM_GUIDANCE: Record<string, PrecatEventType> = {
  cd: "cd",
  pdufa: "pdufa",
  readout: "readout",
  submission: "submission",
  approval: "approval",
  conference_abstract: "conference_abstract",
  partnership: "partnership",
};

export type DeskCalendarTicker = {
  ticker: string;
  cd?: string;
  daysToCd?: number | null;
  hasPosition?: boolean;
  drug?: string;
  indication?: string;
  study?: string;
  /** Clinical development phase from Simulation (Phase 1/2/3…). */
  phase?: string;
  rowKey?: string;
  studyHref?: string | null;
};

export type DeskCalendarSource =
  | "sim_cd"
  | "guidance"
  | "congress"
  | "hypothesis"
  | "clinical"
  | "soft_buy"
  | "g_trends"
  | "interest";

/** Include names whose G-Trends Δ% vs prior print is above this (e.g. +81%). */
export const DESK_G_TRENDS_SPIKE_PCT = 80;

export type DeskCalendarEvent = {
  key: string;
  ticker: string;
  rowKey: string;
  eventDate: string;
  daysUntil: number;
  eventType: PrecatEventType;
  typeLabel: string;
  dateType: PrecatDateType;
  source: DeskCalendarSource;
  eventName: string;
  eventTitle?: string;
  /** Untruncated quote / summary from guidance or the clinical feed. */
  sourceQuote?: string | null;
  referenceHref?: string | null;
  referenceLabel?: string | null;
  inBook: boolean;
  congressName?: string;
  /** Raw guidance/FDA type (fda_vote, fda_safety, …) for labels. */
  sourceKind?: string | null;
  /** Product / asset for the Catalyst Event modal. */
  product?: string | null;
  /** Associated clinical study title / NCT. */
  studyTitle?: string | null;
  /** Development phase (Phase 1/2/3, post-market, …). */
  studyPhase?: string | null;
  /** Prefer CT.gov / study page when distinct from the catalyst-day detail link. */
  studyHref?: string | null;
};

function isoDay(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function guidanceDateType(method: string | null | undefined): PrecatDateType {
  const m = String(method ?? "").toLowerCase();
  if (m.includes("explicit") || m.includes("external")) return "actual";
  return "estimated";
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function trimName(text: string, max = 56): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function firstTitlePart(text: string): string {
  return text.split(" · ")[0]?.trim() || text;
}

function eventNameFromParts(...parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = String(p ?? "").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.join(" · ");
}

function inHorizon(days: number, horizon: number): boolean {
  // Forward horizon + post-CD outcome week (negative days until retention).
  return days >= -DESK_POST_CD_RETENTION_DAYS && days <= horizon;
}

/** Round days; keep post-CD negatives through the 7-day retention window. */
export function clampDeskDaysUntil(days: number | null | undefined): number {
  if (days == null || !Number.isFinite(days)) return 0;
  return Math.round(days);
}

function cdFamily(type: PrecatEventType): boolean {
  return (
    type === "trial_primary_completion" ||
    type === "trial_study_completion" ||
    type === "cd"
  );
}

/**
 * Same-study catalyst-day aliases (CD / readout / abstract).
 * PDUFA, AdCom, filing, partnership stay separate even on the same date.
 */
function studyDataDayFamily(type: PrecatEventType): boolean {
  return (
    cdFamily(type) ||
    type === "readout" ||
    type === "conference_abstract"
  );
}

/** Prefer Simulation CD over guidance readout / abstract when collapsing. */
function studyDayRank(type: PrecatEventType): number {
  switch (type) {
    case "trial_primary_completion":
      return 50;
    case "cd":
      return 40;
    case "trial_study_completion":
      return 30;
    case "readout":
      return 20;
    case "conference_abstract":
      return 10;
    default:
      return 0;
  }
}

function extractNctId(...parts: Array<string | null | undefined>): string | null {
  for (const p of parts) {
    const m = String(p ?? "").match(/NCT\d{8}/i);
    if (m) return m[0].toUpperCase();
  }
  return null;
}

function studyIdentityKey(ev: DeskCalendarEvent): string {
  const nct = extractNctId(
    ev.studyTitle,
    ev.eventName,
    ev.eventTitle,
    ev.studyHref,
    ev.referenceHref,
    ev.sourceQuote,
  );
  if (nct) return `nct:${nct}`;
  const prod = slug(String(ev.product ?? "").trim());
  if (prod.length >= 3) return `prod:${prod}`;
  const rawName = slug(firstTitlePart(ev.eventName) || "");
  const cleaned = rawName
    .replace(/^(readout|cd|abstract|pdufa|primary-completion)-?/, "")
    .replace(/-?(readout|cd|abstract|pdufa|primary-completion)$/, "");
  if (cleaned.length >= 3) return `name:${cleaned}`;
  if (rawName.length >= 3) return `name:${rawName}`;
  return `bare:${ev.ticker}`;
}

function studyBlob(ev: DeskCalendarEvent): string {
  return slug(
    `${ev.product ?? ""} ${ev.eventName} ${ev.eventTitle ?? ""} ${ev.studyTitle ?? ""}`,
  );
}

/** True when two same-date study-day rows refer to the same trial/product. */
function sameStudyIdentity(a: DeskCalendarEvent, b: DeskCalendarEvent): boolean {
  const ka = studyIdentityKey(a);
  const kb = studyIdentityKey(b);
  if (ka === kb) return true;

  const prodA = slug(String(a.product ?? "").trim());
  const prodB = slug(String(b.product ?? "").trim());
  if (prodA.length >= 3 && prodB.length >= 3) {
    return prodA === prodB || prodA.includes(prodB) || prodB.includes(prodA);
  }
  if (prodA.length >= 3) return studyBlob(b).includes(prodA);
  if (prodB.length >= 3) return studyBlob(a).includes(prodB);
  // Both lack product/NCT — same ticker + date study-day aliases are one catalyst.
  return true;
}

function sameStudySameDay(a: DeskCalendarEvent, b: DeskCalendarEvent): boolean {
  if (a.ticker !== b.ticker || a.eventDate !== b.eventDate) return false;
  if (!studyDataDayFamily(a.eventType) || !studyDataDayFamily(b.eventType)) {
    return false;
  }
  return sameStudyIdentity(a, b);
}

function pushUnique(out: DeskCalendarEvent[], ev: DeskCalendarEvent): void {
  const near = out.find(
    (e) =>
      e.ticker === ev.ticker &&
      e.eventType === ev.eventType &&
      Math.abs(e.daysUntil - ev.daysUntil) <= 3 &&
      slug(e.eventName) === slug(ev.eventName),
  );
  if (near) return;
  const sameDayType = out.find((e) => {
    if (e.ticker !== ev.ticker || e.eventDate !== ev.eventDate) return false;
    if (e.eventType === ev.eventType) return true;
    return cdFamily(e.eventType) && cdFamily(ev.eventType);
  });
  if (sameDayType) return;
  // CD + readout (+ abstract) on the same date for the same study → one row.
  const sameStudyIdx = out.findIndex((e) => sameStudySameDay(e, ev));
  if (sameStudyIdx >= 0) {
    const existing = out[sameStudyIdx]!;
    if (studyDayRank(ev.eventType) > studyDayRank(existing.eventType)) {
      out[sameStudyIdx] = ev;
    }
    return;
  }
  out.push(ev);
}

function fromSimCd(
  t: DeskCalendarTicker,
  today: Date,
  horizon: number,
): DeskCalendarEvent | null {
  const iso = completionDateToIso(t.cd, t.daysToCd, today);
  if (!iso) return null;
  const days =
    t.daysToCd != null && Number.isFinite(t.daysToCd)
      ? Math.round(t.daysToCd)
      : daysUntilIso(iso, today);
  if (days == null || !inHorizon(days, horizon)) return null;
  return {
    // Stable identity: do NOT embed derived ISO (daysToCd + today can jitter and remount rows).
    key: `${t.ticker}|sim_cd|${t.rowKey || t.cd || "cd"}`,
    ticker: t.ticker,
    rowKey: t.rowKey ?? `${t.ticker}|${t.cd ?? iso}`,
    eventDate: iso,
    daysUntil: days,
    eventType: "trial_primary_completion",
    typeLabel: "",
    dateType: "estimated",
    source: "sim_cd",
    eventName: eventNameFromParts(t.drug, t.study, t.indication),
    inBook: Boolean(t.hasPosition),
    product: usableProductName(t.drug) || null,
    studyTitle: String(t.study || "").trim() || null,
  };
}

function congressFromText(
  ticker: string,
  rowKey: string,
  inBook: boolean,
  blob: string,
  fallbackName: string,
  today: Date,
  todayIso: string,
  horizon: number,
  source: DeskCalendarSource,
  product?: string | null,
): DeskCalendarEvent | null {
  const slot = nextCongressSlot(blob, todayIso);
  if (!slot) return null;
  return fromCongressSlot(
    ticker,
    rowKey,
    inBook,
    slot,
    fallbackName,
    today,
    horizon,
    source,
    product,
  );
}

function fromCongressSlot(
  ticker: string,
  rowKey: string,
  inBook: boolean,
  slot: CongressSlot,
  fallbackName: string,
  today: Date,
  horizon: number,
  source: DeskCalendarSource,
  product?: string | null,
): DeskCalendarEvent | null {
  const days = daysUntilIso(slot.date, today);
  if (days == null || !inHorizon(days, horizon)) return null;
  return {
    key: `${ticker}|congress|${slot.id}|${rowKey}`,
    ticker,
    rowKey,
    eventDate: slot.date,
    daysUntil: days,
    eventType: "conference_abstract",
    typeLabel: congressTypeLabel(slot),
    dateType: slot.kind === "meeting" ? "actual" : "estimated",
    source,
    eventName: eventNameFromParts(fallbackName, slot.name),
    inBook,
    congressName: slot.name,
    product: usableProductName(product) || usableProductName(fallbackName) || null,
  };
}

function fromGuidance(
  ev: GuidanceCalendarEvent,
  tickerMeta: DeskCalendarTicker | undefined,
  today: Date,
  todayIso: string,
  horizon: number,
): DeskCalendarEvent | null {
  const ticker = String(ev.ticker ?? "").trim().toUpperCase();
  if (!ticker || isWarrantTicker(ticker)) return null;
  const rowKey = tickerMeta?.rowKey ?? `${ticker}|${tickerMeta?.cd ?? ""}`;
  const inBook = Boolean(tickerMeta?.hasPosition);
  const blob = congressBlob(
    ev.event_type,
    ev.asset_name,
    ev.timing_quote,
    ev.indication,
    ev.source_type,
  );
  const rawType = String(ev.event_type ?? "other").toLowerCase();
  // Typed catalysts (CD / PDUFA / readout…) keep their dated window — never re-route
  // through congress slot matching on the timing quote blob.
  const typedCatalyst = Boolean(TYPE_FROM_GUIDANCE[rawType]);
  const looksCongress =
    rawType === "conference_abstract" ||
    (!typedCatalyst && Boolean(nextCongressSlot(blob, todayIso)));
  const iso = isoDay(ev.window_start) || isoDay(ev.window_end);
  const productHint =
    usableProductName(ev.asset_name) || usableProductName(tickerMeta?.drug) || null;
  if (looksCongress && !iso) {
    return congressFromText(
      ticker,
      rowKey,
      inBook,
      blob,
      eventNameFromParts(ev.asset_name, ev.indication, tickerMeta?.drug),
      today,
      todayIso,
      horizon,
      "guidance",
      productHint,
    );
  }
  if (looksCongress && iso) {
    const days = daysUntilIso(iso, today);
    if (days == null || !inHorizon(days, horizon)) return null;
    const slot = nextCongressSlot(blob, todayIso) ?? congressSlotOnDate(blob, iso);
    return {
      key: `${ticker}|guidance|congress|${iso}|${slug(ev.asset_name ?? ev.timing_quote ?? "")}`,
      ticker,
      rowKey,
      eventDate: iso,
      daysUntil: days,
      eventType: "conference_abstract",
      typeLabel: slot ? congressTypeLabel(slot) : "",
      dateType: guidanceDateType(ev.estimation_method),
      source: "guidance",
      eventName: eventNameFromParts(
        ev.asset_name,
        slot?.name,
        ev.indication,
        tickerMeta?.drug,
      ),
      inBook,
      congressName: slot?.name,
      product: productHint,
    };
  }
  if (!iso) return null;
  const days = daysUntilIso(iso, today);
  if (days == null || !inHorizon(days, horizon)) return null;
  const eventType = TYPE_FROM_GUIDANCE[rawType] ?? "other";
  return {
    key: `${ticker}|guidance|${eventType}|${iso}|${slug(ev.asset_name ?? ev.event_type ?? "")}`,
    ticker,
    rowKey,
    eventDate: iso,
    daysUntil: days,
    eventType,
    typeLabel: "",
    dateType: guidanceDateType(ev.estimation_method),
    source: "guidance",
    sourceKind: rawType,
    eventName: eventNameFromParts(
      ev.asset_name,
      ev.event_type,
      ev.indication,
      tickerMeta?.drug,
      tickerMeta?.study,
    ),
    eventTitle: trimName(
      eventNameFromParts(ev.asset_name, ev.event_type, ev.indication),
      48,
    ),
    sourceQuote: ev.timing_quote || ev.company || null,
    referenceHref: ev.link || undefined,
    inBook,
    product: ev.asset_name || tickerMeta?.drug || null,
    studyPhase: ev.trial_phase || tickerMeta?.phase || null,
    studyTitle: tickerMeta?.study || null,
    studyHref: tickerMeta?.studyHref || null,
  };
}

function fromHypothesis(
  h: PendingHypothesisItem,
  tickerMeta: DeskCalendarTicker | undefined,
  today: Date,
  todayIso: string,
  horizon: number,
): DeskCalendarEvent | null {
  const status = String(h.status ?? "pending").toLowerCase();
  if (status === "expired" || status === "dismissed") return null;
  const ticker = String(h.ticker ?? "").trim().toUpperCase();
  if (!ticker || isWarrantTicker(ticker) || !tickerMeta) return null;
  const blob = congressBlob(h.title, h.venue, h.source_type, h.drug);
  const isCongress =
    String(h.source_type ?? "").toLowerCase() === "congress" ||
    Boolean(nextCongressSlot(blob, todayIso));
  if (!isCongress) return null;
  const windowIso = isoDay(h.expected_window_start) || isoDay(h.hypothesis_date);
  const slot = nextCongressSlot(blob, todayIso);
  const iso =
    windowIso && slot && windowIso <= (slot.dateEnd ?? slot.date) && windowIso >= todayIso
      ? windowIso < slot.date
        ? slot.date
        : windowIso
      : slot?.date ?? windowIso;
  if (!iso) return null;
  const days = daysUntilIso(iso, today);
  if (days == null || !inHorizon(days, horizon)) return null;
  const usedSlot = slot && iso === slot.date ? slot : null;
  return {
    key: `${ticker}|hyp|${h.id ?? iso}|${slug(h.title ?? "")}`,
    ticker,
    rowKey: tickerMeta.rowKey ?? `${ticker}|${tickerMeta.cd ?? ""}`,
    eventDate: iso,
    daysUntil: days,
    eventType: "conference_abstract",
    typeLabel: usedSlot
      ? congressTypeLabel(usedSlot)
      : slot
        ? congressTypeLabel(slot)
        : "",
    dateType: usedSlot?.kind === "meeting" ? "actual" : "estimated",
    source: "hypothesis",
    eventName: eventNameFromParts(h.drug, tickerMeta.drug, h.title, usedSlot?.name),
    eventTitle: trimName(h.title || h.drug || tickerMeta.drug || "", 48) || undefined,
    sourceQuote: h.title || null,
    referenceHref: h.link || undefined,
    inBook: Boolean(tickerMeta.hasPosition),
    congressName: usedSlot?.name ?? slot?.name,
    product: usableProductName(h.drug) || usableProductName(tickerMeta.drug) || null,
  };
}

function finalizeDeskEvent(
  ev: DeskCalendarEvent,
  meta: DeskCalendarTicker | undefined,
  it: boolean,
): DeskCalendarEvent {
  let typeLabel = ev.typeLabel;
  if (!typeLabel && ev.sourceKind === "fda_vote") {
    typeLabel = it ? "Voto FDA" : "FDA vote";
  } else if (!typeLabel && ev.sourceKind === "fda_safety") {
    typeLabel = it ? "FDA safety" : "FDA safety";
  }
  if (!typeLabel) {
    if (ev.eventType === "conference_abstract") {
      const slot =
        congressSlotOnDate(
          congressBlob(ev.congressName, ev.eventName),
          ev.eventDate,
        ) ?? nextCongressSlot(congressBlob(ev.congressName, ev.eventName), ev.eventDate);
      typeLabel = slot
        ? congressTypeLabel(slot, it)
        : precatEventTypeLabel("conference_abstract", it);
    } else {
      typeLabel = precatEventTypeLabel(ev.eventType, it);
    }
  }
  const eventTitle = trimName(
    ev.eventTitle || firstTitlePart(ev.eventName) || typeLabel || (it ? "Evento" : "Event"),
    48,
  );
  const congressHref = congressRefUrl(ev.congressName);
  const pdufaHref = ev.eventType === "pdufa" ? FDA_DAF_URL : null;
  const referenceHref =
    ev.referenceHref || meta?.studyHref || congressHref || pdufaHref || null;
  let referenceLabel = ev.referenceLabel || null;
  if (!referenceLabel && referenceHref) {
    if (meta?.studyHref && referenceHref === meta.studyHref) {
      referenceLabel = "CT.gov";
    } else if (congressHref && referenceHref === congressHref) {
      referenceLabel = ev.congressName ?? "Congress";
    } else if (pdufaHref && referenceHref === pdufaHref) {
      referenceLabel = "FDA";
    } else {
      referenceLabel = it ? "Fonte" : "Source";
    }
  }
  const product =
    usableProductName(ev.product) ||
    usableProductName(meta?.drug) ||
    null;
  const studyTitle =
    String(ev.studyTitle || "").trim() ||
    String(meta?.study || "").trim() ||
    null;
  const studyPhase =
    String(ev.studyPhase || "").trim() ||
    String(meta?.phase || "").trim() ||
    null;
  const studyHref =
    String(ev.studyHref || "").trim() ||
    (meta?.studyHref && meta.studyHref !== referenceHref ? meta.studyHref : null) ||
    null;
  return {
    ...ev,
    typeLabel,
    eventTitle,
    referenceHref,
    referenceLabel,
    product: product || null,
    studyTitle: studyTitle || null,
    studyPhase: studyPhase || null,
    studyHref: studyHref || null,
  };
}

export function fillCalendarTypeLabels(
  events: DeskCalendarEvent[],
  it: boolean,
  metaByTicker?: Map<string, DeskCalendarTicker>,
): DeskCalendarEvent[] {
  return events.map((ev) => finalizeDeskEvent(ev, metaByTicker?.get(ev.ticker), it));
}

/** Collapse CD / readout / abstract aliases after product/study fields are filled. */
function dedupeSameStudySameDay(events: DeskCalendarEvent[]): DeskCalendarEvent[] {
  const out: DeskCalendarEvent[] = [];
  for (const ev of events) {
    const idx = out.findIndex((e) => sameStudySameDay(e, ev));
    if (idx < 0) {
      out.push(ev);
      continue;
    }
    if (studyDayRank(ev.eventType) > studyDayRank(out[idx]!.eventType)) {
      out[idx] = ev;
    }
  }
  return out;
}

function fromClinicalEvent(
  rec: ClinicalPreCdRecord,
  ev: ClinicalPublicationEvent,
  tickerMeta: DeskCalendarTicker | undefined,
  today: Date,
  todayIso: string,
  horizon: number,
): DeskCalendarEvent | null {
  const ticker = String(rec.ticker ?? "").trim().toUpperCase();
  if (!ticker || isWarrantTicker(ticker) || !tickerMeta) return null;
  const blob = congressBlob(
    ev.event_title,
    ev.source_type,
    ev.event_type,
    ev.link_label,
    ev.drug,
    ev.asset,
    ev.summary,
  );
  const isCongress =
    String(ev.source_type ?? "").toLowerCase() === "congress" ||
    String(ev.event_type ?? "").toLowerCase() === "congress" ||
    Boolean(nextCongressSlot(blob, todayIso));
  if (!isCongress) return null;
  const windowIso =
    isoDay(ev.expected_window_start) || isoDay(ev.event_date);
  const slot = nextCongressSlot(blob, todayIso);
  const iso = windowIso ?? slot?.date;
  if (!iso) return null;
  const days = daysUntilIso(iso, today);
  if (days == null || !inHorizon(days, horizon)) return null;
  const usedSlot = congressSlotOnDate(blob, iso) ?? (iso === slot?.date ? slot : null);
  return {
    key: `${ticker}|clinical|${iso}|${slug(ev.event_title ?? ev.link_label ?? "")}`,
    ticker,
    rowKey: tickerMeta.rowKey ?? `${ticker}|${tickerMeta.cd ?? ""}`,
    eventDate: iso,
    daysUntil: days,
    eventType: "conference_abstract",
    typeLabel: usedSlot ? congressTypeLabel(usedSlot) : "",
    dateType: usedSlot?.kind === "meeting" ? "actual" : "estimated",
    source: "clinical",
    eventName: eventNameFromParts(
      ev.drug,
      ev.asset,
      tickerMeta.drug,
      ev.event_title,
      usedSlot?.name ?? slot?.name,
    ),
    eventTitle: trimName(ev.event_title || ev.drug || tickerMeta.drug || "", 48) || undefined,
    sourceQuote: ev.summary || ev.event_title || null,
    referenceHref: ev.link || undefined,
    referenceLabel: ev.link_label || undefined,
    inBook: Boolean(tickerMeta.hasPosition),
    congressName: usedSlot?.name ?? slot?.name,
  };
}

export function buildDeskCalendarEvents(opts: {
  tickers: DeskCalendarTicker[];
  guidanceEvents?: GuidanceCalendarEvent[];
  hypotheses?: PendingHypothesisItem[];
  clinicalRecords?: ClinicalPreCdRecord[];
  today?: Date;
  horizonDays?: number;
  it?: boolean;
}): DeskCalendarEvent[] {
  const today = opts.today ?? new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const horizon = opts.horizonDays ?? DESK_CALENDAR_HORIZON_DAYS;
  const it = opts.it ?? false;
  const metaByTicker = new Map<string, DeskCalendarTicker>();
  const universe = new Set<string>();
  const out: DeskCalendarEvent[] = [];

  for (const t of opts.tickers) {
    const ticker = t.ticker.trim().toUpperCase();
    if (!ticker || isWarrantTicker(ticker)) continue;
    universe.add(ticker);
    if (!metaByTicker.has(ticker)) {
      metaByTicker.set(ticker, { ...t, ticker });
    }
    const cd = fromSimCd({ ...t, ticker }, today, horizon);
    if (cd) pushUnique(out, cd);
  }

  for (const ev of opts.guidanceEvents ?? []) {
    const tk = String(ev.ticker ?? "").trim().toUpperCase();
    if (!tk || isWarrantTicker(tk)) continue;
    const built = fromGuidance(ev, metaByTicker.get(tk), today, todayIso, horizon);
    if (built) pushUnique(out, built);
  }

  for (const h of opts.hypotheses ?? []) {
    const tk = String(h.ticker ?? "").trim().toUpperCase();
    if (!universe.has(tk)) continue;
    const built = fromHypothesis(h, metaByTicker.get(tk), today, todayIso, horizon);
    if (built) pushUnique(out, built);
  }

  for (const rec of opts.clinicalRecords ?? []) {
    const tk = String(rec.ticker ?? "").trim().toUpperCase();
    if (!universe.has(tk)) continue;
    const events = [...(rec.clinical_events ?? []), ...(rec.timeline_events ?? [])];
    for (const ev of events) {
      const built = fromClinicalEvent(
        rec,
        ev,
        metaByTicker.get(tk),
        today,
        todayIso,
        horizon,
      );
      if (built) pushUnique(out, built);
    }
  }

  const labeled = dedupeSameStudySameDay(
    fillCalendarTypeLabels(out, it, metaByTicker),
  );
  labeled.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    return a.ticker.localeCompare(b.ticker) || a.eventName.localeCompare(b.eventName);
  });
  return labeled;
}

/**
 * Ensure every Soft BUY ticker appears in the Decision table so market tells
 * (Trends / Vol / Sentiment…) can be scanned quickly. Tickers already present
 * via a 20-day catalyst keep their catalyst row; missing Soft BUY names get a
 * CD row (Completion Date + days left) pinned to the top.
 */
export function mergeSoftBuyDeskEvents(
  events: DeskCalendarEvent[],
  buys: Array<{ key: string; ticker: string }>,
  tickers: DeskCalendarTicker[],
  opts?: { today?: Date },
): DeskCalendarEvent[] {
  const today = opts?.today ?? new Date();
  const present = new Set(
    events.map((e) => e.ticker.trim().toUpperCase()).filter(Boolean),
  );
  const metaByTicker = new Map<string, DeskCalendarTicker>();
  for (const t of tickers) {
    const tk = t.ticker.trim().toUpperCase();
    if (tk && !metaByTicker.has(tk)) metaByTicker.set(tk, { ...t, ticker: tk });
  }

  const extras: DeskCalendarEvent[] = [];
  for (const b of buys) {
    const tk = String(b.ticker ?? "").trim().toUpperCase();
    if (!tk || isWarrantTicker(tk) || present.has(tk)) continue;
    present.add(tk);
    const meta = metaByTicker.get(tk);
    const fromKey = String(b.key ?? "").includes("|")
      ? String(b.key).split("|").slice(1).join("|").trim()
      : "";
    const cdIso =
      isoDay(meta?.cd) ||
      isoDay(fromKey) ||
      completionDateToIso(meta?.cd || fromKey, meta?.daysToCd, today);
    let eventDate = cdIso || today.toISOString().slice(0, 10);
    let daysUntil = 0;
    if (cdIso) {
      const d = daysUntilIso(cdIso, today);
      if (d != null && Number.isFinite(d)) {
        daysUntil = clampDeskDaysUntil(d);
      } else if (meta?.daysToCd != null && Number.isFinite(meta.daysToCd)) {
        daysUntil = clampDeskDaysUntil(meta.daysToCd);
      }
    } else if (meta?.daysToCd != null && Number.isFinite(meta.daysToCd)) {
      daysUntil = clampDeskDaysUntil(meta.daysToCd);
    }
    extras.push({
      key: `softbuy|${meta?.rowKey || b.key || tk}`,
      ticker: tk,
      rowKey: meta?.rowKey || b.key || `${tk}|${cdIso || ""}`,
      eventDate,
      daysUntil,
      eventType: "trial_primary_completion",
      typeLabel: "CD",
      dateType: "estimated",
      source: "soft_buy",
      sourceKind: "soft_buy",
      eventName: eventNameFromParts("Completion Day", meta?.drug, meta?.indication, cdIso),
      eventTitle: meta?.drug ? trimName(meta.drug, 40) : "Completion Day",
      product: meta?.drug || null,
      studyTitle: meta?.study || null,
      studyPhase: meta?.phase || null,
      studyHref: meta?.studyHref || null,
      referenceHref: meta?.studyHref || undefined,
      referenceLabel: meta?.studyHref ? "CT.gov" : undefined,
      inBook: Boolean(meta?.hasPosition),
    });
  }

  extras.sort((a, b) => a.ticker.localeCompare(b.ticker));
  const buySet = new Set(
    buys.map((b) => b.ticker.trim().toUpperCase()).filter(Boolean),
  );
  const rest = [...events].sort((a, b) => {
    const aBuy = buySet.has(a.ticker.trim().toUpperCase()) ? 0 : 1;
    const bBuy = buySet.has(b.ticker.trim().toUpperCase()) ? 0 : 1;
    if (aBuy !== bBuy) return aBuy - bBuy;
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    return a.ticker.localeCompare(b.ticker) || a.eventName.localeCompare(b.eventName);
  });
  return [...extras, ...rest];
}

function deskCdRowFromMeta(
  tk: string,
  meta: DeskCalendarTicker | undefined,
  opts: {
    keyPrefix: string;
    source: DeskCalendarSource;
    sourceKind: string;
    today: Date;
    rowKeyHint?: string;
  },
): DeskCalendarEvent {
  const { keyPrefix, source, sourceKind, today, rowKeyHint } = opts;
  const fromKey = String(rowKeyHint ?? meta?.rowKey ?? "").includes("|")
    ? String(rowKeyHint ?? meta?.rowKey).split("|").slice(1).join("|").trim()
    : "";
  const cdIso =
    isoDay(meta?.cd) ||
    isoDay(fromKey) ||
    completionDateToIso(meta?.cd || fromKey, meta?.daysToCd, today);
  let eventDate = cdIso || today.toISOString().slice(0, 10);
  let daysUntil = 0;
  if (cdIso) {
    const d = daysUntilIso(cdIso, today);
    if (d != null && Number.isFinite(d)) {
      daysUntil = clampDeskDaysUntil(d);
    } else if (meta?.daysToCd != null && Number.isFinite(meta.daysToCd)) {
      daysUntil = clampDeskDaysUntil(meta.daysToCd);
    }
  } else if (meta?.daysToCd != null && Number.isFinite(meta.daysToCd)) {
    daysUntil = clampDeskDaysUntil(meta.daysToCd);
  }
  return {
    // Stable across soft-buy / g-trends rebuilds: ticker + canonical sim row key.
    key: `${keyPrefix}|${meta?.rowKey || rowKeyHint || tk}`,
    ticker: tk,
    rowKey: meta?.rowKey || rowKeyHint || `${tk}|${cdIso || ""}`,
    eventDate,
    daysUntil,
    eventType: "trial_primary_completion",
    typeLabel: "Completion Day",
    dateType: "estimated",
    source,
    sourceKind,
    eventName: eventNameFromParts(
      "Completion Day",
      meta?.drug,
      meta?.indication,
      cdIso,
    ),
    eventTitle: meta?.drug ? trimName(meta.drug, 40) : "Completion Day",
    product: meta?.drug || null,
    studyTitle: meta?.study || null,
    studyPhase: meta?.phase || null,
    studyHref: meta?.studyHref || null,
    referenceHref: meta?.studyHref || undefined,
    referenceLabel: meta?.studyHref ? "CT.gov" : undefined,
    inBook: Boolean(meta?.hasPosition),
  };
}

/**
 * Add Simulation names with a hot G-Trends spike (Δ% > threshold) that are not
 * already on the desk. Same CD / days-left columns as Soft BUY extras.
 * Soft BUY stays first; new G-Trends rows next; other hot names rise among catalysts.
 */
export function mergeHighTrendDeskEvents(
  events: DeskCalendarEvent[],
  hotTickers: string[],
  tickers: DeskCalendarTicker[],
  opts?: { today?: Date },
): DeskCalendarEvent[] {
  const today = opts?.today ?? new Date();
  const present = new Set(
    events.map((e) => e.ticker.trim().toUpperCase()).filter(Boolean),
  );
  const metaByTicker = new Map<string, DeskCalendarTicker>();
  for (const t of tickers) {
    const tk = t.ticker.trim().toUpperCase();
    if (tk && !metaByTicker.has(tk)) metaByTicker.set(tk, { ...t, ticker: tk });
  }

  const extras: DeskCalendarEvent[] = [];
  for (const raw of hotTickers) {
    const tk = String(raw ?? "").trim().toUpperCase();
    if (!tk || isWarrantTicker(tk) || present.has(tk)) continue;
    // Only Simulation universe — no orphan leaders outside the book/sim list.
    const meta = metaByTicker.get(tk);
    if (!meta) continue;
    present.add(tk);
    extras.push(
      deskCdRowFromMeta(tk, meta, {
        keyPrefix: "gtrends",
        source: "g_trends",
        sourceKind: "g_trends",
        today,
        rowKeyHint: meta.rowKey,
      }),
    );
  }

  const hotSet = new Set(
    hotTickers.map((t) => t.trim().toUpperCase()).filter(Boolean),
  );
  const combined = [...extras, ...events];
  combined.sort((a, b) => {
    const rank = (e: DeskCalendarEvent) => {
      if (e.source === "soft_buy") return 0;
      if (e.source === "g_trends") return 1;
      if (hotSet.has(e.ticker.trim().toUpperCase())) return 2;
      return 3;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    return a.ticker.localeCompare(b.ticker) || a.eventName.localeCompare(b.eventName);
  });
  return combined;
}

/**
 * Catalyst Days row pin: red ★ then yellow ★ at the top of the table.
 * Momentum↑ follows starred rows; unstarred / non-up rows stay below.
 */
export function deskRowStarPinRank(opts: {
  enrolled?: boolean;
  starred?: boolean;
  momentumUp?: boolean;
}): number {
  if (opts.enrolled) return 0;
  if (opts.starred) return 1;
  if (opts.momentumUp) return 2;
  return 3;
}

/**
 * Pin Companies-of-interest tickers onto the Catalyst table even without a
 * dated event in the 30-day horizon. Red ★ (manual / Calendar promote).
 */
export function mergePinnedDeskEvents(
  events: DeskCalendarEvent[],
  pinnedTickers: string[],
  tickers: DeskCalendarTicker[],
  opts?: { today?: Date; it?: boolean },
): DeskCalendarEvent[] {
  const today = opts?.today ?? new Date();
  const it = opts?.it ?? false;
  const present = new Set(
    events.map((e) => e.ticker.trim().toUpperCase()).filter(Boolean),
  );
  const metaByTicker = new Map<string, DeskCalendarTicker>();
  for (const t of tickers) {
    const tk = t.ticker.trim().toUpperCase();
    if (tk && !metaByTicker.has(tk)) metaByTicker.set(tk, { ...t, ticker: tk });
  }

  const extras: DeskCalendarEvent[] = [];
  for (const raw of pinnedTickers) {
    const tk = String(raw ?? "").trim().toUpperCase();
    if (!tk || present.has(tk)) continue;
    present.add(tk);
    const meta = metaByTicker.get(tk);
    const hasCd = Boolean(
      isoDay(meta?.cd) ||
        (meta?.daysToCd != null && Number.isFinite(meta.daysToCd) && meta.daysToCd >= 0),
    );
    if (hasCd) {
      extras.push(
        deskCdRowFromMeta(tk, meta, {
          keyPrefix: "interest",
          source: "interest",
          sourceKind: "interest",
          today,
          rowKeyHint: meta?.rowKey,
        }),
      );
      continue;
    }
    extras.push({
      key: `interest|${meta?.rowKey || tk}`,
      ticker: tk,
      rowKey: meta?.rowKey || `${tk}|`,
      eventDate: "",
      daysUntil: -1,
      eventType: "other",
      typeLabel: it ? "Watch" : "Watch",
      dateType: "estimated",
      source: "interest",
      sourceKind: "interest",
      eventName: eventNameFromParts(meta?.drug, meta?.indication, tk),
      eventTitle: meta?.drug ? trimName(meta.drug, 40) : tk,
      product: meta?.drug || null,
      studyTitle: meta?.study || null,
      studyPhase: meta?.phase || null,
      studyHref: meta?.studyHref || null,
      inBook: Boolean(meta?.hasPosition),
    });
  }
  if (!extras.length) return events;
  return [...extras, ...events];
}

export function formatDeskEventDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}`;
}

/**
 * Short, clear event-type chip for the desk table.
 * Biotechspeak kept where it is already the clearest label (PDUFA, AdCom, CD).
 */
export function deskEventTypeShort(
  ev: Pick<
    DeskCalendarEvent,
    "eventType" | "typeLabel" | "sourceKind" | "congressName" | "eventName" | "eventTitle"
  >,
  it: boolean,
): string {
  const kind = String(ev.sourceKind ?? "").toLowerCase();
  const blob = `${ev.typeLabel} ${ev.eventTitle} ${ev.eventName} ${ev.congressName}`.toLowerCase();

  if (kind === "interest") {
    if (
      ev.eventType === "trial_primary_completion" ||
      ev.eventType === "cd" ||
      ev.eventType === "trial_study_completion"
    ) {
      return "CD";
    }
    return "Watch";
  }
  if (kind === "soft_buy" || kind === "g_trends") {
    return "CD";
  }
  if (kind === "fda_vote" || /\badcom\b|advisory\s*committee|voto\s*fda/.test(blob)) {
    return "AdCom";
  }
  // FDA safety source only — do not infer Safety from study titles containing "safety".
  if (kind === "fda_safety") {
    return "Safety";
  }
  if (
    ev.eventType === "partnership" ||
    kind === "partnership" ||
    /\bpartnership\b|licen[sc]ing\s+(?:deal|agreement)|collaboration\s+agreement/.test(blob)
  ) {
    return "Partnership";
  }
  if (
    ev.eventType === "trial_primary_completion" ||
    ev.eventType === "cd" ||
    /\bprimary\s*completion|\bcd\b/.test(blob)
  ) {
    return "CD";
  }
  if (/\bcrl\b|complete\s*response|(?:^|\s)safety(?:\s|$)/.test(`${ev.typeLabel}`.toLowerCase())) {
    return "Safety";
  }
  if (ev.eventType === "pdufa" || /\bpdufa\b/.test(blob)) return "PDUFA";
  if (ev.eventType === "readout" || /\bread[\s-]?out\b|top[\s-]?line|dati\s*fase/.test(blob)) {
    return "Readout";
  }
  if (ev.eventType === "submission" || /\bnda\b|\bbla\b|\bmaa\b|filing|submission/.test(blob)) {
    return "Filing";
  }
  if (ev.eventType === "approval" || /\bapprov/.test(blob)) {
    return it ? "Approvaz." : "Approval";
  }
  if (ev.eventType === "conference_abstract") {
    const fromCongress = String(ev.congressName || "")
      .replace(/\s+abstract$/i, "")
      .trim();
    if (fromCongress) return fromCongress.slice(0, 12);
    const fromType = String(ev.typeLabel || "")
      .replace(/\s+abstract$/i, "")
      .trim();
    if (fromType && !/^abstract$/i.test(fromType)) return fromType.slice(0, 12);
    return "Abstract";
  }
  if (ev.eventType === "trial_study_completion") {
    return it ? "Fine studio" : "Study end";
  }
  const raw = String(ev.typeLabel || "").trim();
  if (raw) {
    if (/voto\s*fda|fda\s*vote/i.test(raw)) return "AdCom";
    if (/abstract/i.test(raw)) {
      const m = raw.replace(/\s+abstract$/i, "").trim();
      return (m || "Abstract").slice(0, 12);
    }
    return raw.length > 14 ? `${raw.slice(0, 13)}…` : raw;
  }
  return it ? "Evento" : "Event";
}

/** Object of the approaching event (drug / study) — secondary line under the short type. */
export function deskEventObjectLabel(
  ev: Pick<DeskCalendarEvent, "eventTitle" | "eventName" | "typeLabel">,
  typeShort: string,
): string {
  const title = String(ev.eventTitle || firstTitlePart(ev.eventName) || "").trim();
  if (!title) return "";
  if (title.toLowerCase() === typeShort.toLowerCase()) {
    const rest = String(ev.eventName || "")
      .split(" · ")
      .map((p) => p.trim())
      .filter((p) => p && p.toLowerCase() !== typeShort.toLowerCase());
    return trimName(rest[0] || "", 36);
  }
  return trimName(title, 36);
}

export function formatDeskEventDays(days: number | null | undefined, _it?: boolean): string {
  if (days == null || !Number.isFinite(days)) return "—";
  const n = Math.round(days);
  if (n < 0) return `${n}d`; // post-CD retention week (−1d … −7d)
  return `${n}d`;
}

/** Stable key aligned with backend ``catalyst_outcome_feed.catalyst_event_key``. */
export function deskCatalystOutcomeKey(row: {
  ticker: string;
  eventDate: string;
  eventType?: string;
  product?: string | null;
}): string {
  const tk = (row.ticker || "").trim().toUpperCase();
  const iso = String(row.eventDate || "").slice(0, 10);
  const et = String(row.eventType || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .slice(0, 40);
  const prod = String(row.product || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .slice(0, 40);
  return `${tk}|${iso}|${et}|${prod}`.replace(/\|+$/g, "");
}

export function isTrendAttention(
  z: number | null | undefined,
  spike?: boolean,
): boolean {
  if (spike) return true;
  return z != null && Number.isFinite(z) && z >= DESK_TREND_ATTENTION_Z;
}

export async function mapTickerChunks<T>(
  tickers: string[],
  chunkSize: number,
  fn: (chunk: string[]) => Promise<T>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tickers.length; i += chunkSize) {
    out.push(await fn(tickers.slice(i, i + chunkSize)));
  }
  return out;
}
