import type { GuidanceCalendarEvent } from "../api/supernova";
import type { TickerEisEventDetail } from "./tickerEisSummary";

export type FdaCatalystOutcome =
  | "approved"
  | "tentative_approval"
  | "crl"
  | "pending"
  | "unknown";

export type ResolvedFdaOutcome = {
  kind: FdaCatalystOutcome;
  labelIt: string;
  labelEn: string;
};

const OUTCOME_LABEL: Record<FdaCatalystOutcome, { it: string; en: string }> = {
  approved: { it: "Approvato FDA", en: "FDA approved" },
  tentative_approval: { it: "Approvazione tentata (TA)", en: "Tentative approval (TA)" },
  crl: { it: "CRL — complete response", en: "CRL — complete response" },
  pending: { it: "In attesa di decisione", en: "Awaiting decision" },
  unknown: { it: "Esito non in calendario", en: "Outcome not on calendar" },
};

function blobOf(ev: Pick<GuidanceCalendarEvent, "timing_quote" | "event_type"> & {
  fda_outcome?: string | null;
  description?: string | null;
}): string {
  return [ev.timing_quote, ev.description, ev.event_type, ev.fda_outcome]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function parseFdaOutcomeKind(
  ev: Pick<GuidanceCalendarEvent, "timing_quote" | "event_type" | "window_start"> & {
    fda_outcome?: string | null;
    description?: string | null;
  },
  opts?: { now?: Date },
): FdaCatalystOutcome {
  const structured = String(ev.fda_outcome ?? "").trim().toLowerCase();
  if (
    structured === "approved" ||
    structured === "tentative_approval" ||
    structured === "crl" ||
    structured === "pending"
  ) {
    return structured;
  }

  const blob = blobOf(ev);
  if (/\bcomplete\s+response(\s+letter)?\b|\b\bcrl\b/.test(blob)) return "crl";
  if (/\btentative\s+approval\b|\bfda\s+ta\b/.test(blob)) return "tentative_approval";
  if (/\bfda\s+approval\b|\bnda\/bla\s+approved\b|\bapproved:\b/.test(blob)) {
    return "approved";
  }
  if (ev.event_type === "approval") return "approved";

  const days = daysUntilIso(ev.window_start, opts?.now);
  if (days != null && days > 0) return "pending";
  if (days != null && days === 0) return "pending";
  return "unknown";
}

export function resolveRegulatoryCatalystOutcome(
  ev: Pick<GuidanceCalendarEvent, "timing_quote" | "event_type" | "window_start"> & {
    fda_outcome?: string | null;
    description?: string | null;
  },
  opts?: { now?: Date },
): ResolvedFdaOutcome {
  const kind = parseFdaOutcomeKind(ev, opts);
  const labels = OUTCOME_LABEL[kind];
  return { kind, labelIt: labels.it, labelEn: labels.en };
}

export function daysUntilIso(
  iso: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!iso) return null;
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const ref = new Date(now);
  ref.setHours(12, 0, 0, 0);
  return Math.round((d.getTime() - ref.getTime()) / 86_400_000);
}

export function isPastCatalystWindow(
  iso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const days = daysUntilIso(iso, now);
  return days != null && days < 0;
}

const NEAR_EIS_DAYS = 7;

export function eisEventsNearCatalystDate(
  events: TickerEisEventDetail[],
  windowIso: string | null | undefined,
  extraNeedles: string[] = [],
): TickerEisEventDetail[] {
  const needles = extraNeedles
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 3);
  const daysAnchor = daysUntilIso(windowIso);
  const out: TickerEisEventDetail[] = [];
  for (const ev of events) {
    const title = `${ev.title} ${ev.summary ?? ""} ${ev.asset ?? ""}`.toLowerCase();
    const byText =
      /\b(pdufa|fda\s+approv|complete\s+response|\bcrl\b|bla\b|nda\b)\b/.test(title) ||
      needles.some((n) => title.includes(n));
    let byDate = false;
    if (ev.eventDate && windowIso) {
      const delta = daysUntilIso(ev.eventDate);
      if (daysAnchor != null && delta != null && Math.abs(delta - daysAnchor) <= NEAR_EIS_DAYS) {
        byDate = true;
      }
    }
    if (byText || byDate) out.push(ev);
  }
  return out;
}
