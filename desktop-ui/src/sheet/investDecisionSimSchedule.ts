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

export function effectiveDecisionSimIntervalHours(
  intervalHours: number,
  experimentMode: boolean,
): number {
  if (experimentMode) return DECISION_SIM_MARKET_INTERVAL_H;
  return intervalHours > 0 ? intervalHours : DECISION_SIM_MARKET_INTERVAL_H;
}
