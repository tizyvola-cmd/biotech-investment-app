/**
 * Calendar tier horizons — see ``calendarTiers.ts``.
 * Display / membership only — does not change Soft BUY/SELL gates.
 */
import type { GuidanceCalendarEvent } from "../api/supernova";
import { daysUntilIso } from "./nextCatalystEvent";

/**
 * Calendar tab forward horizon (~6 months).
 * Farther future events stay in the hidden internal store only.
 */
export const CALENDAR_FORWARD_HORIZON_DAYS = 180;

/**
 * Catalyst Days membership — events migrate here when within 20 days
 * (plus red-★ priority names). Shorter window keeps the desk lighter.
 */
export const CALENDAR_CATALYST_HORIZON_DAYS = 20;

/** Alias used by migrate helpers — same as Catalyst horizon. */
export const CALENDAR_MIGRATE_HORIZON_DAYS = CALENDAR_CATALYST_HORIZON_DAYS;

/**
 * Calendar tab — pin band for events completing soon (~1 calendar month).
 * Independent of Catalyst 20d membership (do not reuse that constant).
 */
export const CALENDAR_NEAR_COMPLETE_DAYS = 30;

export type IdentificationSource = "Discovery" | "ClinicalTrials.gov" | "FDA";

const DESIGNATION_NEEDLES: Array<{ needle: RegExp; label: string }> = [
  { needle: /breakthrough\s+therapy/i, label: "Breakthrough Therapy" },
  { needle: /fast\s+track/i, label: "Fast Track" },
  { needle: /orphan\s+drug/i, label: "Orphan Drug" },
  { needle: /\brmat\b|regenerative\s+medicine\s+advanced/i, label: "RMAT" },
  { needle: /accelerated\s+approval/i, label: "Accelerated Approval" },
  { needle: /priority\s+review/i, label: "Priority Review" },
  { needle: /rare\s+pediatric/i, label: "Rare Pediatric Disease" },
];

export function designationsFromText(...parts: Array<string | null | undefined>): string[] {
  const blob = parts.filter(Boolean).join(" | ");
  if (!blob) return [];
  const out: string[] = [];
  for (const { needle, label } of DESIGNATION_NEEDLES) {
    if (needle.test(blob) && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Normalize AI / CamelCase FDA designation labels (BreakthroughTherapy → Breakthrough Therapy). */
export function normalizeFdaDesignationLabel(raw: string | null | undefined): string | null {
  const s = String(raw ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || /^(n\/d|nd|none|null|unknown|—|-)$/i.test(s)) return null;
  // Taxonomy / EIS notes must never become "designations" under Product.
  if (
    /market[-\s]?access|unclassified|da rivedere|no\s+\w+\s+event\s+classified|taxonomy|score\s*[:=]/i.test(
      s,
    )
  ) {
    return null;
  }
  const fromText = designationsFromText(s);
  if (fromText.length) return fromText[0]!;
  for (const { label } of DESIGNATION_NEEDLES) {
    if (s.toLowerCase() === label.toLowerCase()) return label;
  }
  // Do not accept arbitrary prose (≤48 chars used to leak "No market access…").
  return null;
}

export function formatSourceList(sources: string[] | null | undefined): string {
  return (sources ?? []).filter(Boolean).join(", ");
}

/**
 * Future-only + within Calendar-tab horizon (~6 months) from today.
 * - Exact day: start in [0, horizon].
 * - Open window: still open (end ≥ today) AND not beyond horizon; drop if fully past.
 */
export function isWithinCalendarForwardHorizon(
  ev: Pick<GuidanceCalendarEvent, "window_start" | "window_end">,
  today = new Date(),
  horizonDays = CALENDAR_FORWARD_HORIZON_DAYS,
): boolean {
  const start = (ev.window_start || "").slice(0, 10);
  const end = (ev.window_end || "").slice(0, 10);
  if (!start && !end) return false;
  const dStart = daysUntilIso(start || end, today);
  const dEnd = daysUntilIso(end || start, today);
  // Fully past (end before today) → never show / never keep
  if (dEnd == null || dEnd < 0) return false;
  if (start && end && start !== end) {
    // Open window still alive: start must not be beyond horizon
    return dStart == null || dStart <= horizonDays;
  }
  // Exact day — must be today or future within horizon
  return dStart != null && dStart >= 0 && dStart <= horizonDays;
}

/** True when the event date (exact) or window end is strictly before today. */
export function isPastCalendarEvent(
  ev: Pick<GuidanceCalendarEvent, "window_start" | "window_end">,
  today = new Date(),
): boolean {
  const end = (ev.window_end || ev.window_start || "").slice(0, 10);
  const d = daysUntilIso(end, today);
  return d == null || d < 0;
}

/**
 * Date used for ≤{@link CALENDAR_CATALYST_HORIZON_DAYS}d Catalyst migration — conservative: window_start (or exact).
 * Never cache the resulting day-count; recompute on each read.
 */
export function migrationAnchorIso(
  ev: Pick<GuidanceCalendarEvent, "window_start" | "window_end">,
): string | null {
  const start = (ev.window_start || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return start;
  const end = (ev.window_end || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null;
}

export function daysUntilMigrationAnchor(
  ev: Pick<GuidanceCalendarEvent, "window_start" | "window_end">,
  today = new Date(),
): number | null {
  return daysUntilIso(migrationAnchorIso(ev), today);
}

export function isWithinMigrateHorizon(
  ev: Pick<GuidanceCalendarEvent, "window_start" | "window_end">,
  today = new Date(),
  horizonDays = CALENDAR_MIGRATE_HORIZON_DAYS,
): boolean {
  const d = daysUntilMigrationAnchor(ev, today);
  return d != null && d >= 0 && d <= horizonDays;
}

/** Same as migrate horizon — events that belong on the Catalyst Days table. */
export function isWithinCatalystHorizon(
  ev: Pick<GuidanceCalendarEvent, "window_start" | "window_end">,
  today = new Date(),
  horizonDays = CALENDAR_CATALYST_HORIZON_DAYS,
): boolean {
  return isWithinMigrateHorizon(ev, today, horizonDays);
}

/** Span in calendar days between start and end (0 for exact day). */
export function calendarWindowSpanDays(
  ev: Pick<GuidanceCalendarEvent, "window_start" | "window_end">,
): number | null {
  const start = (ev.window_start || "").slice(0, 10);
  const end = (ev.window_end || ev.window_start || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  if (!start || start === end) return 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const a = new Date(`${start}T12:00:00`);
  const b = new Date(`${end}T12:00:00`);
  if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * Calendar tab pin band (~1 month).
 * Exact / short windows that complete soon stay on top.
 * Long Q/H windows already underway are NOT pinned (avoids a wall of identical "11d" rows).
 */
export function isCalendarNearCompletePin(
  ev: Pick<GuidanceCalendarEvent, "window_start" | "window_end">,
  today = new Date(),
  nearDays = CALENDAR_NEAR_COMPLETE_DAYS,
): boolean {
  const dEnd = daysUntilIso(ev.window_end || ev.window_start || "", today);
  if (dEnd == null || dEnd < 0 || dEnd > nearDays) return false;
  const span = calendarWindowSpanDays(ev);
  if (span == null) return true;
  if (span <= 45) return true;
  const dStart = daysUntilIso(ev.window_start || "", today);
  return dStart != null && dStart >= 0;
}

/** Sort/display anchor: future start, else end (in-progress open windows). */
export function calendarSortAnchorIso(
  ev: Pick<GuidanceCalendarEvent, "window_start" | "window_end">,
  today = new Date(),
): string {
  const start = (ev.window_start || "").slice(0, 10);
  const end = (ev.window_end || start).slice(0, 10);
  const ds = daysUntilIso(start, today);
  if (ds != null && ds >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(start)) return start;
  return end || start || "9999";
}

/**
 * Long Q/H window already underway (start in the past, span > 45d).
 * These flood Calendar if sorted by window_start — keep them off the main 6-month timeline.
 */
export function isCalendarOpenWindowUnderway(
  ev: Pick<GuidanceCalendarEvent, "window_start" | "window_end">,
  today = new Date(),
): boolean {
  const start = (ev.window_start || "").slice(0, 10);
  const end = (ev.window_end || start).slice(0, 10);
  if (!start || !end || start === end) return false;
  const span = calendarWindowSpanDays(ev);
  if (span == null || span <= 45) return false;
  const dStart = daysUntilIso(start, today);
  const dEnd = daysUntilIso(end, today);
  return dStart != null && dStart < 0 && dEnd != null && dEnd >= 0;
}

export type CalendarIdentityRow = {
  ticker?: string;
  identification_sources?: string[];
  regulatory_designations?: string[];
  in_biotech_reference?: boolean;
};

export type CalendarIdentityIndex = {
  updated_at?: string | null;
  by_ticker?: Record<string, CalendarIdentityRow>;
};

export function identityForTicker(
  index: CalendarIdentityIndex | null | undefined,
  ticker: string,
): CalendarIdentityRow | null {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;
  return index?.by_ticker?.[tk] ?? null;
}
