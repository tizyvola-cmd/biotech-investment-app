import type { DecisionSimState } from "./investDecisionSimLoop";
import { shouldRunDecisionSimTick } from "./investDecisionSimStorage";
import {
  DECISION_SIM_DAILY_EVAL_H,
  DECISION_SIM_MARKET_END_H,
  DECISION_SIM_MARKET_START_H,
  DECISION_SIM_MARKET_TZ,
  decisionSimDailyEvaluationKey,
  decisionSimMarketHourKey,
  formatRomeIsoShort,
  formatRomeScheduleSlot,
  isDecisionSimMarketWindow,
  nextDailyEvaluationSlot,
  nextExperimentMarketSlot,
} from "./investDecisionSimSchedule";

export type DecisionSimTickScheduleStatus =
  | "disabled"
  | "due_now"
  | "waiting"
  | "outside_window";

export type DecisionSimTickScheduleView = {
  enabled: boolean;
  experimentMode: boolean;
  status: DecisionSimTickScheduleStatus;
  inMarketWindow: boolean;
  lastTickAt: string | null;
  lastTickLabel: string | null;
  nextSlotLabel: string | null;
  scheduleCaption: string;
};

function experimentExcludeHourKey(state: DecisionSimState, at: Date): string | null {
  if (!state.lastTickAt) return null;
  const lastHourKey = decisionSimMarketHourKey(new Date(state.lastTickAt));
  const currentHourKey = decisionSimMarketHourKey(at);
  if (lastHourKey && currentHourKey && lastHourKey === currentHourKey) {
    return currentHourKey;
  }
  return null;
}

function weekExcludeDayKey(state: DecisionSimState, at: Date): string | null {
  const todayKey = decisionSimDailyEvaluationKey(at) ?? getRomeYmd(at);
  if (state.lastDailyEvaluationDayKey && state.lastDailyEvaluationDayKey === todayKey) {
    return todayKey;
  }
  return null;
}

function getRomeYmd(at: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: DECISION_SIM_MARKET_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(at);
}

export function describeDecisionSimTickSchedule(
  state: DecisionSimState,
  at: Date = new Date(),
  lang: "it" | "en" = "it",
): DecisionSimTickScheduleView {
  const enabled = state.config.enabled;
  const experimentMode = state.config.experimentMode;
  const lastTickLabel = formatRomeIsoShort(state.lastTickAt, lang);

  if (!enabled) {
    return {
      enabled: false,
      experimentMode,
      status: "disabled",
      inMarketWindow: isDecisionSimMarketWindow(at),
      lastTickAt: state.lastTickAt,
      lastTickLabel,
      nextSlotLabel: null,
      scheduleCaption: experimentMode
        ? lang === "it"
          ? `lun–ven ${DECISION_SIM_MARKET_START_H}:00–${DECISION_SIM_MARKET_END_H}:00 Roma · ogni ora`
          : `Mon–Fri ${DECISION_SIM_MARKET_START_H}:00–${DECISION_SIM_MARKET_END_H}:00 Rome · hourly`
        : lang === "it"
          ? `lun–ven ${DECISION_SIM_DAILY_EVAL_H}:00 Roma`
          : `Mon–Fri ${DECISION_SIM_DAILY_EVAL_H}:00 Rome`,
    };
  }

  const dueNow = shouldRunDecisionSimTick(state, at);
  const inMarketWindow = experimentMode ? isDecisionSimMarketWindow(at) : true;

  if (dueNow) {
    const currentHourKey = experimentMode ? decisionSimMarketHourKey(at) : null;
    const currentSlot =
      experimentMode && currentHourKey
        ? {
            ymd: currentHourKey.slice(0, 10),
            hour: Number(currentHourKey.slice(-2)),
          }
        : nextDailyEvaluationSlot(at, weekExcludeDayKey(state, at));
    return {
      enabled: true,
      experimentMode,
      status: "due_now",
      inMarketWindow,
      lastTickAt: state.lastTickAt,
      lastTickLabel,
      nextSlotLabel: currentSlot
        ? formatRomeScheduleSlot(currentSlot.ymd, currentSlot.hour, at, lang)
        : null,
      scheduleCaption: experimentMode
        ? lang === "it"
          ? `lun–ven ${DECISION_SIM_MARKET_START_H}:00–${DECISION_SIM_MARKET_END_H}:00 Roma · ogni ora`
          : `Mon–Fri ${DECISION_SIM_MARKET_START_H}:00–${DECISION_SIM_MARKET_END_H}:00 Rome · hourly`
        : lang === "it"
          ? `lun–ven ${DECISION_SIM_DAILY_EVAL_H}:00 Roma`
          : `Mon–Fri ${DECISION_SIM_DAILY_EVAL_H}:00 Rome`,
    };
  }

  const nextSlot = experimentMode
    ? nextExperimentMarketSlot(at, experimentExcludeHourKey(state, at))
    : nextDailyEvaluationSlot(at, weekExcludeDayKey(state, at));

  const outsideWindow = experimentMode && !isDecisionSimMarketWindow(at);

  return {
    enabled: true,
    experimentMode,
    status: outsideWindow ? "outside_window" : "waiting",
    inMarketWindow: !outsideWindow,
    lastTickAt: state.lastTickAt,
    lastTickLabel,
    nextSlotLabel: nextSlot
      ? formatRomeScheduleSlot(
          nextSlot.ymd,
          nextSlot.hour,
          at,
          lang,
        )
      : null,
    scheduleCaption: experimentMode
      ? lang === "it"
        ? `lun–ven ${DECISION_SIM_MARKET_START_H}:00–${DECISION_SIM_MARKET_END_H}:00 Roma · ogni ora`
        : `Mon–Fri ${DECISION_SIM_MARKET_START_H}:00–${DECISION_SIM_MARKET_END_H}:00 Rome · hourly`
      : lang === "it"
        ? `lun–ven ${DECISION_SIM_DAILY_EVAL_H}:00 Roma`
        : `Mon–Fri ${DECISION_SIM_DAILY_EVAL_H}:00 Rome`,
  };
}
