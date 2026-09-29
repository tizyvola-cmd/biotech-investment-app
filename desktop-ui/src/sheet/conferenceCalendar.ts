/**
 * Dated medical-congress calendar (abstract + meeting).
 * Attach only when a ticker already has a congress mention — do not spray
 * ASCO/ESMO onto every oncology name.
 */

export type CongressKind = "abstract" | "meeting";

export type CongressSlot = {
  id: string;
  name: string;
  year: number;
  kind: CongressKind;
  date: string;
  dateEnd?: string;
  match: RegExp;
};

/** Remaining 2026 + 2027 slots as of Sep 2026. Confirm with organizers. */
export const CONGRESS_CALENDAR: CongressSlot[] = [
  {
    id: "esmo-2026-abs",
    name: "ESMO",
    year: 2026,
    kind: "abstract",
    date: "2026-10-12",
    match: /\besmo\b/i,
  },
  {
    id: "esmo-2026",
    name: "ESMO",
    year: 2026,
    kind: "meeting",
    date: "2026-10-23",
    dateEnd: "2026-10-27",
    match: /\besmo\b/i,
  },
  {
    id: "sabcs-2026-abs",
    name: "SABCS",
    year: 2026,
    kind: "abstract",
    date: "2026-11-17",
    match: /\bsabcs\b|san antonio breast/i,
  },
  {
    id: "sabcs-2026",
    name: "SABCS",
    year: 2026,
    kind: "meeting",
    date: "2026-12-08",
    dateEnd: "2026-12-11",
    match: /\bsabcs\b|san antonio breast/i,
  },
  {
    id: "ash-2026-abs",
    name: "ASH",
    year: 2026,
    kind: "abstract",
    date: "2026-11-04",
    match: /\bash\b|american society of hematology/i,
  },
  {
    id: "ash-2026",
    name: "ASH",
    year: 2026,
    kind: "meeting",
    date: "2026-12-12",
    dateEnd: "2026-12-15",
    match: /\bash\b|american society of hematology/i,
  },
  {
    id: "asco-gi-2027-abs",
    name: "ASCO GI",
    year: 2027,
    kind: "abstract",
    date: "2027-01-07",
    match: /\basco[\s-]*gi\b|gi asco/i,
  },
  {
    id: "asco-gi-2027",
    name: "ASCO GI",
    year: 2027,
    kind: "meeting",
    date: "2027-01-21",
    dateEnd: "2027-01-23",
    match: /\basco[\s-]*gi\b|gi asco/i,
  },
  {
    id: "aacr-2027-abs",
    name: "AACR",
    year: 2027,
    kind: "abstract",
    date: "2027-03-12",
    match: /\baacr\b/i,
  },
  {
    id: "aacr-2027",
    name: "AACR",
    year: 2027,
    kind: "meeting",
    date: "2027-04-02",
    dateEnd: "2027-04-07",
    match: /\baacr\b/i,
  },
  {
    id: "asco-2027-abs",
    name: "ASCO",
    year: 2027,
    kind: "abstract",
    date: "2027-05-21",
    match: /\basco\b(?![\s-]*gi)/i,
  },
  {
    id: "asco-2027",
    name: "ASCO",
    year: 2027,
    kind: "meeting",
    date: "2027-06-04",
    dateEnd: "2027-06-08",
    match: /\basco\b(?![\s-]*gi)/i,
  },
];

export function congressBlob(
  ...parts: Array<string | null | undefined>
): string {
  return parts.filter(Boolean).join(" · ");
}

export function matchingCongressSlots(text: string): CongressSlot[] {
  const blob = String(text ?? "").trim();
  if (!blob) return [];
  return CONGRESS_CALENDAR.filter((slot) => slot.match.test(blob));
}

/** Next useful slot: abstract if still ahead, else the meeting. One per congress family. */
export function nextCongressSlot(
  text: string,
  todayIso: string,
): CongressSlot | null {
  const slots = matchingCongressSlots(text).filter((s) => s.date >= todayIso);
  if (!slots.length) return null;
  const byName = new Map<string, CongressSlot[]>();
  for (const s of slots) {
    const list = byName.get(s.name) ?? [];
    list.push(s);
    byName.set(s.name, list);
  }
  let best: CongressSlot | null = null;
  for (const list of byName.values()) {
    const abs = list.find((s) => s.kind === "abstract");
    const meet = list.find((s) => s.kind === "meeting");
    const pick = abs ?? meet ?? list[0]!;
    if (!best || pick.date < best.date) best = pick;
  }
  return best;
}

export function congressTypeLabel(slot: CongressSlot, _it = false): string {
  if (slot.kind === "abstract") return `${slot.name} abstract`;
  return slot.name;
}

export function congressSlotOnDate(
  text: string,
  iso: string,
): CongressSlot | null {
  const slots = matchingCongressSlots(text);
  return (
    slots.find((s) => s.date === iso || (s.dateEnd != null && iso >= s.date && iso <= s.dateEnd)) ??
    slots.find((s) => s.name && text.toUpperCase().includes(s.name)) ??
    null
  );
}

const CONGRESS_REF_URL: Record<string, string> = {
  ESMO: "https://www.esmo.org/meeting-calendar/esmo-congress-2026",
  ASH: "https://www.hematology.org/meetings/annual-meeting",
  SABCS: "https://www.sabcs.org/",
  AACR: "https://www.aacr.org/meeting/aacr-annual-meeting-2027/",
  ASCO: "https://www.asco.org/annual-meeting",
  "ASCO GI": "https://www.asco.org/meetings",
};

export function congressRefUrl(name: string | null | undefined): string | null {
  const key = String(name ?? "").trim();
  if (!key) return null;
  return CONGRESS_REF_URL[key] ?? null;
}

export const FDA_DAF_URL =
  "https://www.accessdata.fda.gov/scripts/cder/daf/";
