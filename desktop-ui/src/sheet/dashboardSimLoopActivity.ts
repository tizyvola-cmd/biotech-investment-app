import type { DecisionSimState } from "./investDecisionSimStorage";
import {
  isDecisionSimMarketWindow,
  isDecisionSimDailyEvaluationWindow,
} from "./investDecisionSimSchedule";

export type SimLoopActivityMetrics = {
  tickCount: number;
  movementCount: number;
  goodCount: number;
  badCount: number;
  missedBuyCount: number;
  scoredCount: number;
  errorRatePct: number | null;
  runEnabled: boolean;
  experimentMode: boolean;
  lastTickAt: string | null;
  /** True when auto-tick can fire now (market window + run on). */
  autoTickDueNow: boolean;
};

export function countSimLoopTradeMovements(state: DecisionSimState): number {
  return state.ticks.reduce((sum, tick) => sum + tick.trades.length, 0);
}

export function buildSimLoopActivityMetrics(
  state: DecisionSimState,
  at: Date = new Date(),
): SimLoopActivityMetrics {
  const sc = state.scorecard;
  const goodCount = sc.goodBuyCount + sc.goodSellCount;
  const badCount = sc.badBuyCount + sc.badSellCount;
  const scoredCount = goodCount + badCount;
  const errorRatePct =
    scoredCount > 0 ? Math.round((badCount / scoredCount) * 1000) / 10 : null;

  const inWindow = state.config.experimentMode
    ? isDecisionSimMarketWindow(at)
    : isDecisionSimDailyEvaluationWindow(at);

  return {
    tickCount: state.ticks.length,
    movementCount: countSimLoopTradeMovements(state),
    goodCount,
    badCount,
    missedBuyCount: sc.missedBuyCount,
    scoredCount,
    errorRatePct,
    runEnabled: state.config.enabled,
    experimentMode: state.config.experimentMode,
    lastTickAt: state.lastTickAt,
    autoTickDueNow: state.config.enabled && inWindow,
  };
}

export function formatSimLoopActivityFragment(
  activity: SimLoopActivityMetrics,
  lang: "it" | "en",
): string | null {
  if (activity.tickCount <= 0 && activity.movementCount <= 0 && activity.scoredCount <= 0) {
    return null;
  }
  const tick =
    lang === "it"
      ? `${activity.tickCount} tick`
      : `${activity.tickCount} tick${activity.tickCount === 1 ? "" : "s"}`;
  const mov =
    lang === "it"
      ? `${activity.movementCount} mov`
      : `${activity.movementCount} move${activity.movementCount === 1 ? "" : "s"}`;
  if (activity.scoredCount <= 0) {
    return `${tick} · ${mov}`;
  }
  const err =
    lang === "it"
      ? `${activity.badCount} err${activity.errorRatePct != null ? ` (${activity.errorRatePct}%)` : ""}`
      : `${activity.badCount} err${activity.errorRatePct != null ? ` (${activity.errorRatePct}%)` : ""}`;
  return `${tick} · ${mov} · ${err}`;
}

export function simLoopSchedulerHint(
  activity: SimLoopActivityMetrics,
  lang: "it" | "en",
): string | null {
  if (!activity.runEnabled) {
    return lang === "it"
      ? "Sim loop fermo — avvia Esperimento o Settimana nel pannello Decision Sim."
      : "Sim loop stopped — start Experiment or Week in the Decision Sim panel.";
  }
  if (activity.autoTickDueNow) {
    return activity.experimentMode
      ? lang === "it"
        ? "Run attivo — tick automatico ogni ora (lun–ven 15:00–22:59 Roma)."
        : "Run active — hourly auto-tick (Mon–Fri 15:00–22:59 Rome)."
      : lang === "it"
        ? "Run attivo — valutazione giornaliera alle 18:00 Roma."
        : "Run active — daily evaluation at 18:00 Rome.";
  }
  return activity.experimentMode
    ? lang === "it"
      ? "Run attivo — in pausa fuori fascia 15:00–22:59 Roma (lun–ven)."
      : "Run active — paused outside 15:00–22:59 Rome (Mon–Fri)."
    : lang === "it"
      ? "Run attivo — prossimo tick automatico oggi alle 18:00 Roma (lun–ven)."
      : "Run active — next auto-tick today at 18:00 Rome (Mon–Fri).";
}
