/**
 * Cap & Div cumulative walk — session calendar rules for 24h and future deals.
 *
 * - Off NYSE session: 24h walk uses 0% (flat), not live Var. Giorn. % from sheet.
 * - Entry date after calendar today (NY): no P&L contribution until that date.
 */
import {
  calendarDayKeyInTimeZone,
  formatSessionDayKey,
  isUsEquityTradingDay,
  lastUsEquityCloseSessionKey,
} from "./marketSession";

const NY_TZ = "America/New_York";

export type CapDivWalkSessionContext = {
  /** Calendar today in America/New_York (YYYY-MM-DD). */
  nyTodayKey: string;
  /** Last completed NYSE close session used for 24h labelling. */
  lastCloseSessionKey: string;
  /** When true, cumulative 24h walk stays flat (0% per deal). */
  freezeDailyWalk: boolean;
};

export function capDivWalkSessionContext(ref: Date = new Date()): CapDivWalkSessionContext {
  const nyTodayKey = calendarDayKeyInTimeZone(ref, NY_TZ);
  const lastCloseSessionKey = lastUsEquityCloseSessionKey(ref);
  return {
    nyTodayKey,
    lastCloseSessionKey,
    freezeDailyWalk: !isUsEquityTradingDay(ref),
  };
}

export function isCapDivDealEntryInFuture(
  entryDateKey: string,
  nyTodayKey: string,
): boolean {
  return entryDateKey > nyTodayKey;
}

/** 24h % for one deal in the cumulative walk (right pane). */
export function resolveCapDivWalkDailyPct(
  rawPct24h: number | null | undefined,
  entryDateKey: string,
  ctx: CapDivWalkSessionContext,
): number {
  if (isCapDivDealEntryInFuture(entryDateKey, ctx.nyTodayKey)) return 0;
  if (ctx.freezeDailyWalk) return 0;
  if (rawPct24h == null || !Number.isFinite(rawPct24h)) return 0;
  return rawPct24h;
}

/** Total MTM % for one deal in the cumulative walk (left pane). */
export function resolveCapDivWalkTotalPct(
  rawPct: number | null | undefined,
  entryDateKey: string,
  nyTodayKey: string,
): number {
  if (isCapDivDealEntryInFuture(entryDateKey, nyTodayKey)) return 0;
  if (rawPct == null || !Number.isFinite(rawPct)) return 0;
  return rawPct;
}

export function capDivDailyChartFootnote(
  lang: "it" | "en",
  sessionKey: string,
  frozen: boolean,
): string {
  const label = formatSessionDayKey(sessionKey, lang);
  if (lang === "it") {
    const sessionLine = frozen
      ? `Var. 24h = ultima sessione NYSE (${label}), non movimento odierno — fuori sessione il cumulato resta flat.`
      : `Var. 24h = ultima sessione NYSE (${label}), non movimento odierno.`;
    return `${sessionLine} I deal con ingresso oltre OGGI non contribuiscono P&L fino alla data di entry.`;
  }
  const sessionLine = frozen
    ? `Var. 24h = last NYSE session (${label}), not today's move — off-session cumulative stays flat.`
    : `Var. 24h = last NYSE session (${label}), not today's move.`;
  return `${sessionLine} Deals entering after TODAY contribute no P&L until their entry date.`;
}
