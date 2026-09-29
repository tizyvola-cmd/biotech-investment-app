/** Decision sim auto-tick window — Europe/Rome, Mon–Fri 15:00–22:59 (legacy reload band). */
export const DECISION_SIM_MARKET_TZ = "Europe/Rome";
export const DECISION_SIM_MARKET_START_H = 15;
export const DECISION_SIM_MARKET_END_H = 22;
export const DECISION_SIM_MARKET_INTERVAL_H = 1;

/** Daily solid-BUY evaluation + synth capital rebalance — once at 18:00 Rome. */
export const DECISION_SIM_DAILY_EVAL_H = 18;

const ROME_WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 0,
};

export type RomeClockParts = {
  weekday: number;
  hour: number;
  minute: number;
  ymd: string;
};

export function getRomeClockParts(at: Date = new Date()): RomeClockParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: DECISION_SIM_MARKET_TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const weekdayLabel = pick("weekday");
  const hourRaw = Number(pick("hour"));
  return {
    weekday: ROME_WEEKDAY[weekdayLabel] ?? 0,
    hour: Number.isFinite(hourRaw) ? hourRaw : 0,
    minute: Number(pick("minute")) || 0,
    ymd: `${pick("year")}-${pick("month")}-${pick("day")}`,
  };
}

/** Mon–Fri, hour 15 through 22 inclusive (Rome). */
export function isDecisionSimMarketWindow(at: Date = new Date()): boolean {
  const { weekday, hour } = getRomeClockParts(at);
  return weekday >= 1 && weekday <= 5 && hour >= DECISION_SIM_MARKET_START_H && hour <= DECISION_SIM_MARKET_END_H;
}

/** One reload/tick slot per Rome calendar hour inside the market window. */
export function decisionSimMarketHourKey(at: Date = new Date()): string | null {
  if (!isDecisionSimMarketWindow(at)) return null;
  const { ymd, hour } = getRomeClockParts(at);
  return `${ymd}T${String(hour).padStart(2, "0")}`;
}

/** Mon–Fri, hour 18 Rome — daily evaluation window for sim-loop paper. */
export function isDecisionSimDailyEvaluationWindow(at: Date = new Date()): boolean {
  const { weekday, hour } = getRomeClockParts(at);
  return weekday >= 1 && weekday <= 5 && hour === DECISION_SIM_DAILY_EVAL_H;
}

/** One evaluation slot per Rome calendar day (18:00 band). */
export function decisionSimDailyEvaluationKey(at: Date = new Date()): string | null {
  if (!isDecisionSimDailyEvaluationWindow(at)) return null;
  return getRomeClockParts(at).ymd;
}

/** Next hourly experiment slot at or after `from` (Rome 15–22, Mon–Fri). */
export function nextExperimentMarketSlot(
  from: Date = new Date(),
  excludeHourKey?: string | null,
): { ymd: string; hour: number; hourKey: string } | null {
  const startMs = from.getTime();
  const maxSteps = 8 * 24 * 4;
  for (let step = 0; step < maxSteps; step += 1) {
    const probe = new Date(startMs + step * 15 * 60_000);
    const hourKey = decisionSimMarketHourKey(probe);
    if (!hourKey) continue;
    if (excludeHourKey && hourKey === excludeHourKey) continue;
    const hour = Number(hourKey.slice(-2));
    if (!Number.isFinite(hour)) continue;
    return { ymd: hourKey.slice(0, 10), hour, hourKey };
  }
  return null;
}

/** Next weekday 18:00 Rome evaluation slot at or after `from`. */
export function nextDailyEvaluationSlot(
  from: Date = new Date(),
  excludeDayKey?: string | null,
): { ymd: string; hour: number } | null {
  const startMs = from.getTime();
  for (let step = 0; step < 14 * 24 * 4; step += 1) {
    const probe = new Date(startMs + step * 15 * 60_000);
    const parts = getRomeClockParts(probe);
    if (parts.weekday < 1 || parts.weekday > 5) continue;
    if (excludeDayKey && parts.ymd === excludeDayKey) continue;
    if (parts.hour > DECISION_SIM_DAILY_EVAL_H) continue;
    return { ymd: parts.ymd, hour: DECISION_SIM_DAILY_EVAL_H };
  }
  return null;
}

const ROME_WEEKDAY_SHORT: Record<number, { it: string; en: string }> = {
  1: { it: "lun", en: "Mon" },
  2: { it: "mar", en: "Tue" },
  3: { it: "mer", en: "Wed" },
  4: { it: "gio", en: "Thu" },
  5: { it: "ven", en: "Fri" },
};

/** Human slot label — "oggi 18:00", "Mon 15:00", … */
export function formatRomeScheduleSlot(
  ymd: string,
  hour: number,
  ref: Date,
  lang: "it" | "en",
): string {
  const refParts = getRomeClockParts(ref);
  const hh = `${String(hour).padStart(2, "0")}:00`;
  if (ymd === refParts.ymd) {
    return lang === "it" ? `oggi ${hh}` : `today ${hh}`;
  }
  const probe = new Date(`${ymd}T12:00:00Z`);
  const weekday = getRomeClockParts(probe).weekday;
  const wd = ROME_WEEKDAY_SHORT[weekday];
  if (wd) {
    return `${wd[lang]} ${hh}`;
  }
  const [, m, d] = ymd.split("-");
  return lang === "it" ? `${d}/${m} ${hh}` : `${m}/${d} ${hh}`;
}

export function formatRomeIsoShort(iso: string | null | undefined, lang: "it" | "en"): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const locale = lang === "it" ? "it-IT" : "en-GB";
  return d.toLocaleString(locale, {
    timeZone: DECISION_SIM_MARKET_TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function effectiveDecisionSimIntervalHours(
  intervalHours: number,
  experimentMode: boolean,
): number {
  if (experimentMode) return DECISION_SIM_MARKET_INTERVAL_H;
  return intervalHours > 0 ? intervalHours : DECISION_SIM_MARKET_INTERVAL_H;
}
