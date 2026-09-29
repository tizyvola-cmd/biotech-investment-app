/**
 * Calendar tab week cache (Rome Monday → Sunday).
 * Snapshots reload once per week; Trends are once/day (romeDay) inside the same blob.
 * Soft BUY/SELL unchanged.
 */
import type {
  CalendarIdentityIndex,
  CatalystCalendarSnapshot,
  CatalystCalendarStatus,
  FdaAdcomCalendarSnapshot,
  GuidanceCalendarEvent,
  GuidanceCalendarSnapshot,
  GuidanceCalendarStatus,
  SearchInterestRow,
} from "../api/supernova";
import { romeDateKey } from "./catalystDeskNewLedger";

const STORAGE_KEY = "supernova.calendarTabWeeklyCache.v1";
const ROME_TZ = "Europe/Rome";

export type CalendarTabWeeklyPayload = {
  weekKey: string;
  savedAt: number;
  snap: GuidanceCalendarSnapshot | null;
  status: GuidanceCalendarStatus | null;
  fda: FdaAdcomCalendarSnapshot | null;
  sec: CatalystCalendarSnapshot | null;
  secStatus: CatalystCalendarStatus | null;
  identity: CalendarIdentityIndex | null;
  simCd: GuidanceCalendarEvent[];
  /** G-Trends once/day (Rome). Independent of week event snapshot. */
  trendsRomeDay?: string | null;
  trends?: Record<string, SearchInterestRow> | null;
};

function store(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Rome calendar date parts. */
export function romeYmd(ms = Date.now()): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ROME_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const y = Number(parts.find((p) => p.type === "year")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "month")?.value ?? 0);
  const d = Number(parts.find((p) => p.type === "day")?.value ?? 0);
  return { y, m, d };
}

/**
 * ISO week key for Europe/Rome (Monday-based), e.g. ``2026-W37``.
 * Uses the Thursday of the Rome local week (ISO 8601 rule).
 */
export function romeIsoWeekKey(ms = Date.now()): string {
  const { y, m, d } = romeYmd(ms);
  // Noon UTC on that Rome civil date → stable weekday math
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const dow = new Date(utcNoon).getUTCDay(); // 0=Sun … 6=Sat
  const isoDow = dow === 0 ? 7 : dow; // 1=Mon … 7=Sun
  const thursday = new Date(utcNoon + (4 - isoDow) * 86_400_000);
  const thrY = thursday.getUTCFullYear();
  const thrM = thursday.getUTCMonth();
  const thrD = thursday.getUTCDate();
  const jan4 = Date.UTC(thrY, 0, 4, 12, 0, 0);
  const jan4Dow = new Date(jan4).getUTCDay() || 7;
  const week1Mon = jan4 - (jan4Dow - 1) * 86_400_000;
  const week = Math.floor((Date.UTC(thrY, thrM, thrD, 12, 0, 0) - week1Mon) / (7 * 86_400_000)) + 1;
  return `${thrY}-W${String(week).padStart(2, "0")}`;
}

export function peekCalendarTabWeeklyCache(
  weekKey = romeIsoWeekKey(),
): CalendarTabWeeklyPayload | null {
  try {
    const raw = store()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CalendarTabWeeklyPayload;
    if (!parsed || parsed.weekKey !== weekKey) return null;
    const hasSnap = Boolean(parsed.snap);
    const hasTrends = Boolean(parsed.trends && Object.keys(parsed.trends).length);
    if (!hasSnap && !hasTrends) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function rememberCalendarTabWeeklyCache(
  payload: Omit<CalendarTabWeeklyPayload, "weekKey" | "savedAt"> & {
    weekKey?: string;
  },
): void {
  try {
    const weekKey = payload.weekKey ?? romeIsoWeekKey();
    const prev = peekCalendarTabWeeklyCache(weekKey);
    const file: CalendarTabWeeklyPayload = {
      weekKey,
      savedAt: Date.now(),
      snap: payload.snap,
      status: payload.status,
      fda: payload.fda,
      sec: payload.sec,
      secStatus: payload.secStatus,
      identity: payload.identity,
      simCd: payload.simCd ?? [],
      trendsRomeDay:
        payload.trendsRomeDay !== undefined
          ? payload.trendsRomeDay
          : (prev?.trendsRomeDay ?? null),
      trends: payload.trends !== undefined ? payload.trends : (prev?.trends ?? null),
    };
    store()?.setItem(STORAGE_KEY, JSON.stringify(file));
  } catch {
    /* quota / private */
  }
}

/** Rome-day Trends slice inside the Calendar tab cache. */
export function peekCalendarTrendsDailyCache(
  romeDay = romeDateKey(),
  weekKey = romeIsoWeekKey(),
): Record<string, SearchInterestRow> | null {
  const weekly = peekCalendarTabWeeklyCache(weekKey);
  if (!weekly?.trends || weekly.trendsRomeDay !== romeDay) return null;
  return weekly.trends;
}

export function rememberCalendarTrendsDailyCache(
  trends: Record<string, SearchInterestRow>,
  romeDay = romeDateKey(),
  weekKey = romeIsoWeekKey(),
): void {
  const weekly = peekCalendarTabWeeklyCache(weekKey);
  if (!weekly?.snap) {
    // No week snapshot yet — still persist a thin trends-only shell for today.
    rememberCalendarTabWeeklyCache({
      weekKey,
      snap: null,
      status: null,
      fda: null,
      sec: null,
      secStatus: null,
      identity: null,
      simCd: [],
      trendsRomeDay: romeDay,
      trends,
    });
    return;
  }
  const prev =
    weekly.trendsRomeDay === romeDay && weekly.trends ? { ...weekly.trends } : {};
  rememberCalendarTabWeeklyCache({
    ...weekly,
    trendsRomeDay: romeDay,
    trends: { ...prev, ...trends },
  });
}

export function clearCalendarTabWeeklyCache(): void {
  try {
    store()?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Tracks which ISO week already did the Monday morning Calendar reattach. */
const MONDAY_PULL_KEY = "supernova.calendarTab.mondayPullWeek.v1";
let _mondayPullWeekMem: string | null = null;

/** Rome local hour/minute (and ISO weekday Mon=1 … Sun=7). */
export function romeClockParts(ms = Date.now()): {
  hour: number;
  minute: number;
  isoDow: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: ROME_TZ,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const wd = (parts.find((p) => p.type === "weekday")?.value ?? "").toLowerCase();
  const map: Record<string, number> = {
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6,
    sun: 7,
  };
  const isoDow = map[wd.slice(0, 3)] ?? 0;
  return { hour, minute, isoDow };
}

/**
 * True once per Rome ISO week after Monday 10:30 —
 * Calendar reattaches so companies newly inside the 6-month horizon enter the tab.
 * Catch-up: also fires Tue–Sun if this week's pull was never marked (browser closed Mon).
 */
export function shouldReattachCalendarMondayMorning(
  ms = Date.now(),
  atHour = 10,
  atMinute = 30,
): boolean {
  const { hour, minute, isoDow } = romeClockParts(ms);
  if (isoDow < 1 || isoDow > 7) return false;
  // Monday before window → wait; Tue–Sun always eligible for catch-up.
  if (isoDow === 1 && hour * 60 + minute < atHour * 60 + atMinute) return false;
  const week = romeIsoWeekKey(ms);
  if (_mondayPullWeekMem === week) return false;
  try {
    const stored = store()?.getItem(MONDAY_PULL_KEY);
    if (stored) _mondayPullWeekMem = stored;
    if (stored === week) return false;
  } catch {
    /* ignore */
  }
  return true;
}

export function markCalendarMondayPullDone(ms = Date.now()): void {
  const week = romeIsoWeekKey(ms);
  _mondayPullWeekMem = week;
  try {
    store()?.setItem(MONDAY_PULL_KEY, week);
  } catch {
    /* ignore */
  }
}

/** Test helper. */
export function _resetCalendarMondayPullMarker(): void {
  _mondayPullWeekMem = null;
  try {
    store()?.removeItem(MONDAY_PULL_KEY);
  } catch {
    /* ignore */
  }
}

