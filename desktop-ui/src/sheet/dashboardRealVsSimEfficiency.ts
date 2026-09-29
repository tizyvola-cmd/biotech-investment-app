/**
 * Dashboard hero KPI: real portfolio efficiency vs sim loop — side-by-side with
 * unified Success efficiency so the gap (e.g. 95% sim vs 50% real) is visible.
 */
import type { AdviceCalibrationSummary } from "./investDecisionSimAdviceCalibration";
import type { ClosedSuccessMetrics } from "./portfolioSuccessBridge";

import type { SimLoopActivityMetrics } from "./dashboardSimLoopActivity";
import {
  formatSimLoopActivityFragment,
  simLoopSchedulerHint,
} from "./dashboardSimLoopActivity";

export type DashboardRealVsSimEfficiency = {
  realClosedWinPct: number | null;
  realClosedWins: number;
  realClosedLosses: number;
  realClosedN: number;
  simAdvicePct: number | null;
  simGood: number;
  simBad: number;
  liveAdvicePct: number | null;
  liveScored: number;
  gapRealVsSimPp: number | null;
  activity: SimLoopActivityMetrics | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function buildDashboardRealVsSimEfficiency(args: {
  closed: ClosedSuccessMetrics | null | undefined;
  simAdvicePct: number | null | undefined;
  simGood: number;
  simBad: number;
  liveAdvice: AdviceCalibrationSummary;
  activity?: SimLoopActivityMetrics | null;
}): DashboardRealVsSimEfficiency {
  const realClosedN = args.closed?.sampleSize ?? 0;
  const realClosedWinPct = args.closed?.winRatePct ?? null;
  const realClosedWins = args.closed?.winCount ?? 0;
  const realClosedLosses = args.closed?.lossCount ?? 0;
  const simScored = args.simGood + args.simBad;
  const simAdvicePct =
    args.simAdvicePct != null && Number.isFinite(args.simAdvicePct)
      ? args.simAdvicePct
      : simScored > 0
        ? round1((args.simGood / simScored) * 100)
        : null;
  const gapRealVsSimPp =
    realClosedWinPct != null && simAdvicePct != null
      ? round1(realClosedWinPct - simAdvicePct)
      : null;

  return {
    realClosedWinPct,
    realClosedWins,
    realClosedLosses,
    realClosedN,
    simAdvicePct,
    simGood: args.simGood,
    simBad: args.simBad,
    liveAdvicePct: args.liveAdvice.overallSuccessRatePct,
    liveScored: args.liveAdvice.scoredCount,
    gapRealVsSimPp,
    activity: args.activity ?? null,
  };
}

export function dashboardRealVsSimSub(
  kpi: DashboardRealVsSimEfficiency,
  lang: "it" | "en",
): string {
  const parts: string[] = [];
  const activityFrag =
    kpi.activity != null ? formatSimLoopActivityFragment(kpi.activity, lang) : null;
  if (activityFrag) parts.push(activityFrag);
  if (kpi.simAdvicePct != null) {
    parts.push(`sim ${kpi.simAdvicePct}%`);
  }
  if (kpi.liveAdvicePct != null && kpi.liveScored > 0) {
    parts.push(
      lang === "it"
        ? `live ${kpi.liveAdvicePct}% (${kpi.liveScored} val.)`
        : `live ${kpi.liveAdvicePct}% (${kpi.liveScored} scored)`,
    );
  }
  if (kpi.gapRealVsSimPp != null && Math.abs(kpi.gapRealVsSimPp) >= 5) {
    const sign = kpi.gapRealVsSimPp >= 0 ? "+" : "";
    parts.push(lang === "it" ? `Δ reale−sim ${sign}${kpi.gapRealVsSimPp}pp` : `Δ real−sim ${sign}${kpi.gapRealVsSimPp}pp`);
  }
  if (!parts.length) {
    return lang === "it" ? "Nessun esito chiuso ancora" : "No closed outcomes yet";
  }
  return parts.join(" · ");
}

export function dashboardRealVsSimTooltip(
  kpi: DashboardRealVsSimEfficiency,
  lang: "it" | "en",
): string {
  if (lang === "it") {
    return [
      "Efficienza reale vs sim loop.",
      kpi.realClosedN > 0
        ? `Portafoglio chiuso: ${kpi.realClosedWinPct}% (${kpi.realClosedWins}✓ / ${kpi.realClosedLosses}✗, n=${kpi.realClosedN} round-trip).`
        : "Portafoglio chiuso: nessun round-trip ancora.",
      kpi.simAdvicePct != null
        ? `Sim loop (paper): ${kpi.simAdvicePct}% precisione consigli (${kpi.simGood}✓ / ${kpi.simBad}✗ su ${kpi.simGood + kpi.simBad} giudicati).`
        : null,
      kpi.activity != null
        ? lang === "it"
          ? `Attività: ${kpi.activity.tickCount} tick orari, ${kpi.activity.movementCount} movimenti BUY/SELL, ${kpi.activity.missedBuyCount} buy persi.`
          : `Activity: ${kpi.activity.tickCount} hourly ticks, ${kpi.activity.movementCount} BUY/SELL moves, ${kpi.activity.missedBuyCount} missed buys.`
        : null,
      kpi.activity != null ? simLoopSchedulerHint(kpi.activity, lang) : null,
      kpi.liveScored > 0 && kpi.liveAdvicePct != null
        ? `Live 24h: ${kpi.liveAdvicePct}% su ${kpi.liveScored} consigli valutati.`
        : null,
      "Confronta con «Efficienza successo» (KPI unificato congelato a chiusura NYSE).",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    "Real efficiency vs sim loop.",
    kpi.realClosedN > 0
      ? `Closed portfolio: ${kpi.realClosedWinPct}% (${kpi.realClosedWins}✓ / ${kpi.realClosedLosses}✗, n=${kpi.realClosedN} round-trips).`
      : "Closed portfolio: no round-trips yet.",
    kpi.simAdvicePct != null
      ? `Sim loop (paper): ${kpi.simAdvicePct}% advice precision (${kpi.simGood}✓ / ${kpi.simBad}✗ of ${kpi.simGood + kpi.simBad} scored).`
      : null,
    kpi.activity != null
      ? `Activity: ${kpi.activity.tickCount} hourly ticks, ${kpi.activity.movementCount} BUY/SELL moves, ${kpi.activity.missedBuyCount} missed buys.`
      : null,
    kpi.activity != null ? simLoopSchedulerHint(kpi.activity, lang) : null,
    kpi.liveScored > 0 && kpi.liveAdvicePct != null
      ? `Live 24h: ${kpi.liveAdvicePct}% on ${kpi.liveScored} scored advice points.`
      : null,
    "Compare with «Success efficiency» (unified KPI frozen at NYSE close).",
  ]
    .filter(Boolean)
    .join(" ");
}
