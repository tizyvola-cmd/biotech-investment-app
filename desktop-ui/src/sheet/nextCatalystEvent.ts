import type { GuidanceCalendarEvent } from "../api/supernova";

/** Unified next-event for the ticker panel. conference_abstract reserved. */
export type PrecatEventType =
  | "trial_primary_completion"
  | "trial_study_completion"
  | "pdufa"
  | "readout"
  | "submission"
  | "approval"
  | "conference_abstract"
  | "cd"
  | "partnership"
  | "other";

export type PrecatDateType = "estimated" | "actual";

export type NextCatalystEvent = {
  ticker: string;
  eventType: PrecatEventType;
  eventDate: string;
  dateType: PrecatDateType;
  daysUntil: number;
  source: "sim_cd" | "guidance";
  sourceId?: string;
};

const TYPE_FROM_GUIDANCE: Record<string, PrecatEventType> = {
  cd: "cd",
  pdufa: "pdufa",
  readout: "readout",
  submission: "submission",
  approval: "approval",
  conference_abstract: "conference_abstract",
  partnership: "partnership",
};

export function daysUntilIso(iso: string | null | undefined, today = new Date()): number | null {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return null;
  const ref = new Date(today);
  ref.setHours(12, 0, 0, 0);
  return Math.round((d.getTime() - ref.getTime()) / 86_400_000);
}

function guidanceDateType(method: string | null | undefined): PrecatDateType {
  const m = String(method ?? "").toLowerCase();
  if (m.includes("explicit") || m.includes("external")) return "actual";
  return "estimated";
}

/** Simulation CD is often `DD/MM/YYYY`; guidance uses ISO. */
export function completionDateToIso(
  raw: string | null | undefined,
  daysToCd?: number | null,
  today: Date = new Date(),
): string | null {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (dmy) {
    const dd = dmy[1]!.padStart(2, "0");
    const mm = dmy[2]!.padStart(2, "0");
    return `${dmy[3]}-${mm}-${dd}`;
  }
  if (daysToCd != null && Number.isFinite(daysToCd)) {
    const t = new Date(today);
    t.setHours(12, 0, 0, 0);
    t.setDate(t.getDate() + Math.round(daysToCd));
    const y = t.getFullYear();
    const m = String(t.getMonth() + 1).padStart(2, "0");
    const d = String(t.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

function candidateFromCd(
  ticker: string,
  completionDate: string | null | undefined,
  daysToCd: number | null | undefined,
  today: Date,
): NextCatalystEvent | null {
  const iso = completionDateToIso(completionDate, daysToCd, today);
  if (!iso) return null;
  const days =
    daysToCd != null && Number.isFinite(daysToCd)
      ? Math.round(daysToCd)
      : daysUntilIso(iso, today);
  if (days == null) return null;
  return {
    ticker,
    eventType: "trial_primary_completion",
    eventDate: iso,
    dateType: "estimated",
    daysUntil: days,
    source: "sim_cd",
  };
}

function candidateFromGuidance(
  ticker: string,
  ev: GuidanceCalendarEvent | null | undefined,
  today: Date,
): NextCatalystEvent | null {
  if (!ev) return null;
  const iso = String(ev.window_start || ev.window_end || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const days = daysUntilIso(iso, today);
  if (days == null) return null;
  const raw = String(ev.event_type ?? "other").toLowerCase();
  return {
    ticker,
    eventType: TYPE_FROM_GUIDANCE[raw] ?? "other",
    eventDate: iso,
    dateType: guidanceDateType(ev.estimation_method),
    daysUntil: days,
    source: "guidance",
    sourceId: ev.asset_name ?? undefined,
  };
}

/** Soonest future (or today) event; if all past, the least-negative CD. */
export function resolveNextCatalystEvent(args: {
  ticker: string;
  completionDate?: string | null;
  daysToCd?: number | null;
  guidanceEvent?: GuidanceCalendarEvent | null;
  today?: Date;
}): NextCatalystEvent | null {
  const tk = args.ticker.trim().toUpperCase();
  if (!tk) return null;
  const today = args.today ?? new Date();
  const pool = [
    candidateFromCd(tk, args.completionDate, args.daysToCd, today),
    candidateFromGuidance(tk, args.guidanceEvent, today),
  ].filter((e): e is NextCatalystEvent => e != null);
  if (!pool.length) return null;
  const future = pool.filter((e) => e.daysUntil >= 0).sort((a, b) => a.daysUntil - b.daysUntil);
  if (future.length) return future[0]!;
  return [...pool].sort((a, b) => b.daysUntil - a.daysUntil)[0] ?? null;
}

export function precatEventTypeLabel(type: PrecatEventType, it: boolean): string {
  const map: Record<PrecatEventType, { en: string; it: string }> = {
    trial_primary_completion: { en: "Primary CD", it: "CD primaria" },
    trial_study_completion: { en: "Study end", it: "Fine studio" },
    pdufa: { en: "PDUFA", it: "PDUFA" },
    readout: { en: "Readout", it: "Readout" },
    submission: { en: "Submission", it: "Submission" },
    approval: { en: "Approval", it: "Approvazione" },
    conference_abstract: { en: "Abstract", it: "Abstract" },
    cd: { en: "CD", it: "CD" },
    partnership: { en: "Partnership", it: "Partnership" },
    other: { en: "Event", it: "Evento" },
  };
  return map[type][it ? "it" : "en"];
}

export function formatNextCatalystChip(ev: NextCatalystEvent, it: boolean): string {
  const kind = precatEventTypeLabel(ev.eventType, it);
  if (ev.daysUntil > 0) {
    return it ? `${kind} tra ${ev.daysUntil}g` : `${kind} in ${ev.daysUntil}d`;
  }
  if (ev.daysUntil === 0) {
    return it ? `${kind} oggi` : `${kind} today`;
  }
  return it
    ? `${kind} passato (${Math.abs(ev.daysUntil)}g)`
    : `${kind} passed (${Math.abs(ev.daysUntil)}d)`;
}
