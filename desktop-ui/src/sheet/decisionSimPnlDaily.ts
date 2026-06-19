import type { DecisionSimTick } from "./investDecisionSimLoop";
import type { MissedOppPnlDailyPoint, MissedOppPnlTrendPoint } from "./missedOpportunityAudit";
import {
  buildEndOfDayMapsFromTicks,
  reconcileEndOfDayTotalsToLive,
  roundSimPnlEur,
} from "./decisionSimPnlResolve";

const LIVE_PNL_SANITY_MAX_EUR = 500_000;

export type DecisionSimPnlDailyPoint = {
  date: string;
  daySimLoop: number;
  cumSimLoop: number;
};

/** P&L giornaliero sim loop paper — Δ totalPiggy a fine giornata (tick salvati). */
export function buildDecisionSimPnlDailySeries(
  ticks: DecisionSimTick[],
  liveTotalPnlEur?: number | null,
): DecisionSimPnlDailyPoint[] {
  let { endOfDayTotal, cumRealizedByDay } = buildEndOfDayMapsFromTicks(ticks);

  if (
    liveTotalPnlEur != null &&
    Number.isFinite(liveTotalPnlEur) &&
    Math.abs(liveTotalPnlEur) <= LIVE_PNL_SANITY_MAX_EUR
  ) {
    const today = new Date().toISOString().slice(0, 10);
    if (!endOfDayTotal.has(today)) {
      const priorDays = [...endOfDayTotal.keys()].sort();
      const lastDay = priorDays[priorDays.length - 1];
      endOfDayTotal.set(today, lastDay ? (endOfDayTotal.get(lastDay) ?? 0) : 0);
      if (lastDay && cumRealizedByDay.has(lastDay)) {
        cumRealizedByDay.set(today, cumRealizedByDay.get(lastDay)!);
      }
    }
    endOfDayTotal = reconcileEndOfDayTotalsToLive(
      endOfDayTotal,
      cumRealizedByDay,
      liveTotalPnlEur,
    );
  }

  const days = [...endOfDayTotal.keys()].sort();
  let prevEnd = 0;
  let cum = 0;
  const out: DecisionSimPnlDailyPoint[] = [];
  for (const date of days) {
    const endTotal = endOfDayTotal.get(date)!;
    const daySimLoop = roundSimPnlEur(endTotal - prevEnd);
    prevEnd = endTotal;
    cum = roundSimPnlEur(cum + daySimLoop);
    out.push({ date, daySimLoop, cumSimLoop: cum });
  }
  return out;
}

export type MissedOppPnlDailyWithSim = MissedOppPnlDailyPoint & {
  daySimLoop: number;
  cumSimLoop: number;
};

export type MissedOppPnlTrendWithSim = MissedOppPnlTrendPoint & {
  cumSimLoop: number;
};

function shortDate(iso: string): string {
  return iso.length >= 10 ? iso.slice(5) : iso;
}

export function mergeMissedOppDailyWithSimLoop(
  daily: MissedOppPnlDailyPoint[],
  simSeries: DecisionSimPnlDailyPoint[],
): MissedOppPnlDailyWithSim[] {
  const simByShort = new Map(simSeries.map((s) => [shortDate(s.date), s]));
  const seen = new Set<string>();
  const merged: MissedOppPnlDailyWithSim[] = daily.map((d) => {
    seen.add(d.date);
    const sim = simByShort.get(d.date);
    return {
      ...d,
      daySimLoop: sim?.daySimLoop ?? 0,
      cumSimLoop: sim?.cumSimLoop ?? 0,
    };
  });

  for (const s of simSeries) {
    const label = shortDate(s.date);
    if (seen.has(label)) continue;
    merged.push({
      date: label,
      dayAllGainers: 0,
      dayRecommendations: 0,
      dayFairRecommendations: 0,
      dayActual: 0,
      deltaActual: null,
      capturePct: null,
      gapVsRecEur: 0,
      daySimLoop: s.daySimLoop,
      cumSimLoop: s.cumSimLoop,
    });
  }

  return merged.sort((a, b) => a.date.localeCompare(b.date));
}

export function mergeMissedOppTrendWithSimLoop(
  trend: MissedOppPnlTrendPoint[],
  simSeries: DecisionSimPnlDailyPoint[],
): MissedOppPnlTrendWithSim[] {
  const simByShort = new Map(simSeries.map((s) => [shortDate(s.date), s]));
  const seen = new Set<string>();
  const merged: MissedOppPnlTrendWithSim[] = trend.map((t) => {
    seen.add(t.date);
    return {
      ...t,
      cumSimLoop: simByShort.get(t.date)?.cumSimLoop ?? 0,
    };
  });

  for (const s of simSeries) {
    const label = shortDate(s.date);
    if (seen.has(label)) continue;
    merged.push({
      date: label,
      cumAllGainers: 0,
      cumRecommendations: 0,
      cumFairRecommendations: 0,
      cumActual: 0,
      cumSimLoop: s.cumSimLoop,
    });
  }

  return merged.sort((a, b) => a.date.localeCompare(b.date));
}

export function resolveLiveSimLoopTotalPnl(
  ticks: DecisionSimTick[],
  piggyTotalPnlEur?: number | null,
): number | null {
  if (
    piggyTotalPnlEur != null &&
    Number.isFinite(piggyTotalPnlEur) &&
    Math.abs(piggyTotalPnlEur) <= LIVE_PNL_SANITY_MAX_EUR
  ) {
    return piggyTotalPnlEur;
  }
  const series = buildDecisionSimPnlDailySeries(ticks);
  const last = series[series.length - 1];
  return last != null ? last.cumSimLoop : null;
}
