/**
 * Red bell — % of G/L won given back from peak (default 10%).
 * Desktop Pick-stocks / Pulse parity. Portfolio auto-sell stays G2 (20%).
 */

export const GL_WIN_ALERT_PCT_DEFAULT = 10;
export const POSITION_SHARE_LOSS_ALERT_FRAC = GL_WIN_ALERT_PCT_DEFAULT / 100;
/** @deprecated alias — campanella is % of G/L won, not capital. */
export const PULSE_LOSS_OF_WINS_BELL_FRAC = POSITION_SHARE_LOSS_ALERT_FRAC;
export const PULSE_GIVEBACK_BELL_MIN_PEAK_EUR = 100;

const NY_TZ = "America/New_York";

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
]);

function calendarDayKeyNy(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function nyWeekday(d: Date): number {
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

function nyWallClock(ref: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(ref);
  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? 0),
    minute: Number(parts.find((p) => p.type === "minute")?.value ?? 0),
  };
}

function isUsEquityTradingDay(ref: Date): boolean {
  if (nyWeekday(ref) < 1 || nyWeekday(ref) > 5) return false;
  return !NYSE_HOLIDAY_KEYS.has(calendarDayKeyNy(ref));
}

function isDuringUsEquityRegularHours(ref: Date): boolean {
  if (!isUsEquityTradingDay(ref)) return false;
  const { hour, minute } = nyWallClock(ref);
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function isAfterUsEquityRegularClose(ref: Date): boolean {
  if (!isUsEquityTradingDay(ref)) return false;
  const { hour, minute } = nyWallClock(ref);
  return hour > 16 || (hour === 16 && minute >= 0);
}

function lastUsEquityTradingDayKey(ref: Date): string {
  const probe = new Date(ref.getTime());
  for (let i = 0; i < 14; i++) {
    const key = calendarDayKeyNy(probe);
    if (isUsEquityTradingDay(probe)) return key;
    probe.setDate(probe.getDate() - 1);
  }
  return calendarDayKeyNy(ref);
}

function lastUsEquityCloseSessionKey(ref: Date): string {
  const nyToday = calendarDayKeyNy(ref);
  if (isUsEquityTradingDay(ref) && isAfterUsEquityRegularClose(ref)) return nyToday;
  const probe = new Date(ref.getTime());
  if (isUsEquityTradingDay(ref)) probe.setDate(probe.getDate() - 1);
  return lastUsEquityTradingDayKey(probe);
}

function nySessionCloseIso(dayKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return new Date().toISOString();
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d, 20, 0, 0));
  for (let offsetMin = -8 * 60; offsetMin <= 8 * 60; offsetMin += 15) {
    const candidate = new Date(probe.getTime() + offsetMin * 60_000);
    if (calendarDayKeyNy(candidate) !== dayKey) continue;
    const { hour, minute } = nyWallClock(candidate);
    if (hour === 16 && minute === 0) return candidate.toISOString();
  }
  return new Date(Date.UTC(y, mo - 1, d, 20, 0, 0)).toISOString();
}

/** Off-session Soft BUY: no campanella until a regular close after entry. */
export function givebackAlertEligibleSinceInvestedAt(
  investedAtIso: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!investedAtIso?.trim()) return false;
  const invMs = Date.parse(investedAtIso);
  if (!Number.isFinite(invMs)) return false;
  const inv = new Date(invMs);
  if (isDuringUsEquityRegularHours(inv)) return true;
  const closeMs = Date.parse(nySessionCloseIso(lastUsEquityCloseSessionKey(now)));
  if (!Number.isFinite(closeMs)) return false;
  return closeMs > invMs;
}

/** Sum of positive open MTM € (legacy helpers / Soft SELL chips). */
export function sumOpenWinsEur(rows: { pnlEur: number | null | undefined }[]): number {
  let s = 0;
  for (const r of rows) {
    if (r.pnlEur != null && Number.isFinite(r.pnlEur) && r.pnlEur > 0) s += r.pnlEur;
  }
  return s;
}

export type PulseGivebackBell = {
  hit: boolean;
  peakEff: number | null;
  givebackEur: number | null;
  givebackPctOfPeak: number | null;
  purchasedPlusGainsEur?: number | null;
};

export type PulseGivebackBellOpts = {
  investedAt?: string | null;
  now?: Date;
  requireUnderwater?: boolean;
  capitalEur?: number | null;
};

/** Giveback from peak wins ≥ frac × peak (default 10%). */
export function pulseTickerGivebackBell(
  pnlEur: number | null | undefined,
  peakPnlEur: number | null | undefined,
  frac = POSITION_SHARE_LOSS_ALERT_FRAC,
  _minPeakEur = PULSE_GIVEBACK_BELL_MIN_PEAK_EUR,
  opts?: PulseGivebackBellOpts,
): PulseGivebackBell {
  if (pnlEur == null || !Number.isFinite(pnlEur) || !(frac > 0)) {
    return { hit: false, peakEff: null, givebackEur: null, givebackPctOfPeak: null };
  }
  if (!givebackAlertEligibleSinceInvestedAt(opts?.investedAt, opts?.now ?? new Date())) {
    return { hit: false, peakEff: null, givebackEur: null, givebackPctOfPeak: null };
  }
  const peakHist =
    peakPnlEur != null && Number.isFinite(peakPnlEur) && peakPnlEur > 0
      ? peakPnlEur
      : null;
  const peakEff =
    peakHist != null
      ? Math.max(peakHist, pnlEur > 0 ? pnlEur : peakHist)
      : pnlEur > 0
        ? pnlEur
        : null;
  if (peakEff == null || !(peakEff > 0)) {
    return { hit: false, peakEff: null, givebackEur: null, givebackPctOfPeak: null };
  }
  const giveback = peakEff - pnlEur;
  const hit = giveback + 1e-9 >= peakEff * frac && giveback > 0.5;
  if (!hit) {
    return {
      hit: false,
      peakEff: Math.round(peakEff * 100) / 100,
      givebackEur: null,
      givebackPctOfPeak: null,
      purchasedPlusGainsEur: Math.round(peakEff * 100) / 100,
    };
  }
  return {
    hit: true,
    peakEff: Math.round(peakEff * 100) / 100,
    givebackEur: Math.round(giveback * 100) / 100,
    givebackPctOfPeak: Math.round((giveback / peakEff) * 1000) / 10,
    purchasedPlusGainsEur: Math.round(peakEff * 100) / 100,
  };
}

/**
 * @deprecated Prefer `pulseTickerGivebackBell`.
 */
export function pulseLossExceedsWinShare(
  pnlEur: number | null | undefined,
  totalOpenWinsEur: number,
  frac = POSITION_SHARE_LOSS_ALERT_FRAC,
): boolean {
  if (pnlEur == null || !Number.isFinite(pnlEur)) return false;
  if (!(totalOpenWinsEur > 0) || !(pnlEur < 0) || !(frac > 0)) return false;
  return Math.abs(pnlEur) > totalOpenWinsEur * frac;
}
