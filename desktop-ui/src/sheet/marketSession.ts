/** US equity session helpers (NASDAQ/NYSE) — America/New_York, Mon–Fri only. */

const NY_TZ = "America/New_York";

export type PortfolioPnlSessionContext = {
  /** True on Mon–Fri (NYSE calendar day in US/Eastern). */
  marketOpen: boolean;
  /** YYYY-MM-DD of the most recent US equity session day (≤ today in NY). */
  lastSessionDayKey: string;
  /** Calendar today in US/Eastern. */
  nyTodayKey: string;
};

export function calendarDayKeyInTimeZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** 0 = Sun … 6 = Sat in US/Eastern. */
export function nyWeekday(d: Date): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    weekday: "short",
  }).format(d);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? 0;
}

export function isUsEquitySessionDay(ref: Date = new Date()): boolean {
  const wd = nyWeekday(ref);
  return wd >= 1 && wd <= 5;
}

export function lastUsEquitySessionDayKey(ref: Date = new Date()): string {
  const probe = new Date(ref.getTime());
  for (let i = 0; i < 12; i++) {
    if (isUsEquitySessionDay(probe)) {
      return calendarDayKeyInTimeZone(probe, NY_TZ);
    }
    probe.setDate(probe.getDate() - 1);
  }
  return calendarDayKeyInTimeZone(ref, NY_TZ);
}

export function portfolioDailyPnlSessionContext(ref: Date = new Date()): PortfolioPnlSessionContext {
  return {
    marketOpen: isUsEquitySessionDay(ref),
    lastSessionDayKey: lastUsEquitySessionDayKey(ref),
    nyTodayKey: calendarDayKeyInTimeZone(ref, NY_TZ),
  };
}

/**
 * Returns the ISO timestamp of 00:00:00 America/New_York on the last
 * US equity session day. Use this as a chart x-axis cut-off to zoom to
 * "last trading day" regardless of whether it is currently a weekend.
 */
export function lastTradingSessionCutoffIso(ref: Date = new Date()): string {
  const dayKey = lastUsEquitySessionDayKey(ref); // YYYY-MM-DD
  // Build midnight NY for that day by using a noon UTC anchor then converting.
  const [y, mo, d] = dayKey.split("-").map(Number) as [number, number, number];
  // Walk from noon UTC backwards until we land on the same NY calendar day
  // at exactly 00:00 — i.e. find the UTC ms that equals midnight NY.
  const probe = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  for (let offsetH = -18; offsetH <= 6; offsetH++) {
    const candidate = new Date(probe.getTime() + offsetH * 3_600_000);
    const candidateDayKey = calendarDayKeyInTimeZone(candidate, NY_TZ);
    if (candidateDayKey !== dayKey) continue;
    // Check the hour in NY — want 00
    const nyHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: NY_TZ,
        hour: "numeric",
        hour12: false,
      }).format(candidate),
    );
    if (nyHour === 0) return candidate.toISOString();
  }
  // Fallback: return midnight UTC of that calendar day
  return new Date(Date.UTC(y, mo - 1, d, 0, 0, 0)).toISOString();
}

/** Short label for KPI headers — e.g. «ven 13/06» / «Fri 06/13». */
export function formatSessionDayKey(dayKey: string, lang: "it" | "en"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0);
  if (Number.isNaN(date.getTime())) return dayKey;
  if (lang === "it") {
    const wd = new Intl.DateTimeFormat("it-IT", { weekday: "short" }).format(date);
    return `${wd} ${d}/${mo}`;
  }
  const wd = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  return `${wd} ${mo}/${d}`;
}
