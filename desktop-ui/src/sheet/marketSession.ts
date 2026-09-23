/** US equity session helpers (NASDAQ/NYSE) — America/New_York, Mon–Fri + NYSE holidays. */

const NY_TZ = "America/New_York";

/** NYSE full-day closures (YYYY-MM-DD). Extend annually. */
const NYSE_HOLIDAY_KEYS = new Set<string>([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
]);

export function isNyseHolidayKey(dayKey: string): boolean {
  return NYSE_HOLIDAY_KEYS.has(dayKey);
}

export function isUsEquityTradingDayKey(dayKey: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return false;
  const [, y, mo, d] = m;
  const probe = new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0);
  if (!isUsEquitySessionDay(probe)) return false;
  return !isNyseHolidayKey(dayKey);
}

export function isUsEquityTradingDay(ref: Date = new Date()): boolean {
  return isUsEquityTradingDayKey(calendarDayKeyInTimeZone(ref, NY_TZ));
}

/** Most recent NYSE/NASDAQ session (excludes weekends and NYSE holidays). */
export function lastUsEquityTradingDayKey(ref: Date = new Date()): string {
  const probe = new Date(ref.getTime());
  for (let i = 0; i < 14; i++) {
    const key = calendarDayKeyInTimeZone(probe, NY_TZ);
    if (isUsEquityTradingDayKey(key)) return key;
    probe.setDate(probe.getDate() - 1);
  }
  return calendarDayKeyInTimeZone(ref, NY_TZ);
}

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

/** Wall clock in America/New_York. */
export function nyWallClock(ref: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(ref);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { hour, minute };
}

/** True on NYSE trading days during regular hours 09:30–15:59 ET. */
export function isDuringUsEquityRegularHours(ref: Date = new Date()): boolean {
  if (!isUsEquityTradingDay(ref)) return false;
  const { hour, minute } = nyWallClock(ref);
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/**
 * Giveback bell / Soft SELL giveback — suppress until the market has had a
 * chance to move the position in regular hours.
 *
 * - Buy during RTH → eligible immediately (peak still required elsewhere).
 * - Buy after close / premarket / weekend → wait until a regular close
 *   strictly after the buy timestamp (no overnight phantom −25% bells).
 */
export function givebackAlertEligibleSinceInvestedAt(
  investedAtIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!investedAtIso?.trim()) return false;
  const invMs = Date.parse(investedAtIso);
  if (!Number.isFinite(invMs)) return false;
  const inv = new Date(invMs);
  if (isDuringUsEquityRegularHours(inv)) return true;
  const closeKey = lastUsEquityCloseSessionKey(now);
  const closeMs = Date.parse(nySessionCloseIso(closeKey));
  if (!Number.isFinite(closeMs)) return false;
  return closeMs > invMs;
}

/** True on NYSE trading days at or after the regular 16:00 ET close. */
export function isAfterUsEquityRegularClose(ref: Date = new Date()): boolean {
  if (!isUsEquityTradingDay(ref)) return false;
  const { hour, minute } = nyWallClock(ref);
  return hour > 16 || (hour === 16 && minute >= 0);
}

/**
 * YYYY-MM-DD of the last completed US equity close used to freeze dashboard KPIs.
 * Intraday and pre-close → previous session; weekend/holiday → last trading day.
 */
export function lastUsEquityCloseSessionKey(ref: Date = new Date()): string {
  const nyToday = calendarDayKeyInTimeZone(ref, NY_TZ);
  if (isUsEquityTradingDay(ref) && isAfterUsEquityRegularClose(ref)) {
    return nyToday;
  }
  const probe = new Date(ref.getTime());
  if (isUsEquityTradingDay(ref)) {
    probe.setDate(probe.getDate() - 1);
  }
  return lastUsEquityTradingDayKey(probe);
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

/**
 * ISO timestamp of 16:00 America/New_York on ``dayKey`` (YYYY-MM-DD).
 * Used to pin off-session portfolio marks to the last regular close.
 */
export function nySessionCloseIso(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return new Date().toISOString();
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // ~16:00 ET is 20:00 UTC in EDT / 21:00 UTC in EST — probe and match.
  const probe = new Date(Date.UTC(y, mo - 1, d, 20, 0, 0));
  for (let offsetMin = -8 * 60; offsetMin <= 8 * 60; offsetMin += 15) {
    const candidate = new Date(probe.getTime() + offsetMin * 60_000);
    if (calendarDayKeyInTimeZone(candidate, NY_TZ) !== dayKey) continue;
    const { hour, minute } = nyWallClock(candidate);
    if (hour === 16 && minute === 0) return candidate.toISOString();
  }
  return new Date(Date.UTC(y, mo - 1, d, 20, 0, 0)).toISOString();
}

/**
 * Timestamp for open-book history / Home curve marks.
 * During the regular US session (pre-close) → wall-clock now (live tape).
 * After close / weekend / holiday → last completed regular close (e.g. Fri 16:00 ET),
 * so the chart X-axis shows market time, not “when you opened the app”.
 */
export function portfolioHistoryMarkIso(ref: Date = new Date()): string {
  if (isUsEquityTradingDay(ref) && !isAfterUsEquityRegularClose(ref)) {
    return ref.toISOString();
  }
  return nySessionCloseIso(lastUsEquityCloseSessionKey(ref));
}

function addCalendarDayKey(dayKey: string, delta: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return dayKey;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta));
  return dt.toISOString().slice(0, 10);
}

/**
 * NYSE sessions after the buy calendar day (buy day = 0).
 * Weekend / holiday do not count. Missing or invalid stamp → null.
 */
export function nyseSessionsElapsedSince(
  investedAtIso: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!investedAtIso?.trim()) return null;
  const invMs = Date.parse(investedAtIso);
  if (!Number.isFinite(invMs)) return null;
  const startKey = calendarDayKeyInTimeZone(new Date(invMs), NY_TZ);
  const endKey = calendarDayKeyInTimeZone(now, NY_TZ);
  if (endKey < startKey) return 0;
  let elapsed = 0;
  let key = addCalendarDayKey(startKey, 1);
  let guard = 0;
  while (key <= endKey && guard++ < 60) {
    if (isUsEquityTradingDayKey(key)) elapsed += 1;
    key = addCalendarDayKey(key, 1);
  }
  return elapsed;
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
