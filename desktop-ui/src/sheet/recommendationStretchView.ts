/**
 * Recommendation stretch — learning outcome (trading success of advice).
 *
 * Separate from Model Stretch (price-curve cal_factor). Here we measure whether
 * BUY / SELL / HOLD recommendations aligned with the subsequent price move:
 *
 *   BUY  → success if price rises  (≥ +0.5%)
 *   SELL → success if price falls (≤ −0.5%)
 *   HOLD / REVIEW → failure if price falls (≤ −0.5%) — should have been SELL;
 *                   success if flat or up (holding was justified)
 */

import type { AdviceCalibrationPoint } from "./investDecisionSimAdviceCalibration";
import {
  ADVICE_CALIB_BUY_MIN_UP_PCT,
  ADVICE_CALIB_SELL_MIN_DOWN_PCT,
} from "./investDecisionSimAdviceCalibration";
import type { AdviceFeedback } from "./adviceFeedback";
import type { AdviceLearningSnapshot } from "./adviceLearningHistory";

export type RecStretchAction = "buy" | "sell" | "hold";

export type RecStretchActionStats = {
  action: RecStretchAction;
  scored: number;
  good: number;
  bad: number;
  successRatePct: number | null;
  avgMovePct: number | null;
};

export type RecStretchDayPoint = {
  day: string;
  label: string;
  buyPct: number | null;
  sellPct: number | null;
  holdPct: number | null;
  overallPct: number | null;
  buyN: number;
  sellN: number;
  holdN: number;
  overallN: number;
};

export type RecStretchVerdict = "improved" | "worse" | "neutral" | "unknown";

export type RecommendationStretchView = {
  buy: RecStretchActionStats;
  sell: RecStretchActionStats;
  hold: RecStretchActionStats;
  overall: RecStretchActionStats;
  /** Mean adviceFeedback bucket multiplier (1 = no stretch). */
  stretchFactor: number | null;
  stretchPctFromNeutral: number | null;
  bucketCorrectionsActive: number;
  actionDemotionsActive: number;
  daySeries: RecStretchDayPoint[];
  /** Learning-timeline overall % for context (may be null). */
  timelineOverall: { day: string; pct: number | null; buyPct: number | null }[];
  verdict: RecStretchVerdict;
  recentOverallPct: number | null;
  priorOverallPct: number | null;
  scoredTotal: number;
};

function rate(good: number, bad: number): number | null {
  const n = good + bad;
  if (n < 1) return null;
  return Math.round((good / n) * 1000) / 10;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

/**
 * Trading-success score for a recommendation vs subsequent price move.
 * HOLD/REVIEW: a fall is a miss (should have sold).
 */
export function scoreRecTradingOutcome(
  action: string,
  priceChangePct: number | null | undefined,
): "good" | "bad" | "pending" | null {
  if (priceChangePct == null || !Number.isFinite(priceChangePct)) return null;
  const a = action.trim().toLowerCase();
  if (a === "buy") {
    if (priceChangePct >= ADVICE_CALIB_BUY_MIN_UP_PCT) return "good";
    if (priceChangePct <= ADVICE_CALIB_SELL_MIN_DOWN_PCT) return "bad";
    return "pending";
  }
  if (a === "sell") {
    if (priceChangePct <= ADVICE_CALIB_SELL_MIN_DOWN_PCT) return "good";
    if (priceChangePct >= ADVICE_CALIB_BUY_MIN_UP_PCT) return "bad";
    return "pending";
  }
  if (a === "hold" || a === "review") {
    // Fall after HOLD = unsuccessful (missed SELL). Flat or up = hold ok.
    if (priceChangePct <= ADVICE_CALIB_SELL_MIN_DOWN_PCT) return "bad";
    return "good";
  }
  return null;
}

function mapAction(action: string): RecStretchAction | null {
  const a = action.trim().toLowerCase();
  if (a === "buy") return "buy";
  if (a === "sell") return "sell";
  if (a === "hold" || a === "review") return "hold";
  return null;
}

function statsFor(
  action: RecStretchAction,
  points: AdviceCalibrationPoint[],
): RecStretchActionStats {
  const rows = points.filter((p) => mapAction(p.suggestedAction) === action);
  let good = 0;
  let bad = 0;
  const moves: number[] = [];
  for (const p of rows) {
    const o = scoreRecTradingOutcome(p.suggestedAction, p.priceChangePct);
    if (o === "good") good += 1;
    else if (o === "bad") bad += 1;
    else continue;
    if (p.priceChangePct != null && Number.isFinite(p.priceChangePct)) {
      moves.push(p.priceChangePct);
    }
  }
  return {
    action,
    scored: good + bad,
    good,
    bad,
    successRatePct: rate(good, bad),
    avgMovePct: avg(moves),
  };
}

function dayKey(iso: string): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function dayLabel(day: string): string {
  if (!day || day.length < 10) return day;
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]}`;
}

function buildDaySeries(points: AdviceCalibrationPoint[]): RecStretchDayPoint[] {
  const byDay = new Map<string, AdviceCalibrationPoint[]>();
  for (const p of points) {
    const day = dayKey(p.at);
    if (!day) continue;
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }
  const days = [...byDay.keys()].sort();
  return days.map((day) => {
    const rows = byDay.get(day) ?? [];
    const buy = statsFor("buy", rows);
    const sell = statsFor("sell", rows);
    const hold = statsFor("hold", rows);
    const all = [buy, sell, hold];
    const good = all.reduce((s, a) => s + a.good, 0);
    const bad = all.reduce((s, a) => s + a.bad, 0);
    return {
      day,
      label: dayLabel(day),
      buyPct: buy.successRatePct,
      sellPct: sell.successRatePct,
      holdPct: hold.successRatePct,
      overallPct: rate(good, bad),
      buyN: buy.scored,
      sellN: sell.scored,
      holdN: hold.scored,
      overallN: good + bad,
    };
  });
}

function stretchFromFeedback(feedback: AdviceFeedback | null): {
  stretchFactor: number | null;
  stretchPctFromNeutral: number | null;
  bucketCorrectionsActive: number;
  actionDemotionsActive: number;
} {
  if (!feedback) {
    return {
      stretchFactor: null,
      stretchPctFromNeutral: null,
      bucketCorrectionsActive: 0,
      actionDemotionsActive: 0,
    };
  }
  const mults = [...feedback.bucketCorrections.values()].map((c) => c.multiplier);
  const stretchFactor =
    mults.length > 0
      ? Math.round((mults.reduce((a, b) => a + b, 0) / mults.length) * 10000) / 10000
      : 1;
  return {
    stretchFactor,
    stretchPctFromNeutral: Math.round((stretchFactor - 1) * 1000) / 10,
    bucketCorrectionsActive: feedback.bucketCorrections.size,
    actionDemotionsActive: feedback.actionDemotions.size,
  };
}

function verdictFromSeries(daySeries: RecStretchDayPoint[]): {
  verdict: RecStretchVerdict;
  recentOverallPct: number | null;
  priorOverallPct: number | null;
} {
  const withOverall = daySeries.filter((d) => d.overallPct != null && d.overallN >= 2);
  if (withOverall.length < 4) {
    return { verdict: "unknown", recentOverallPct: null, priorOverallPct: null };
  }
  const mid = Math.floor(withOverall.length / 2);
  const prior = withOverall.slice(0, mid);
  const recent = withOverall.slice(mid);
  const avgPct = (rows: RecStretchDayPoint[]) => {
    const vals = rows.map((r) => r.overallPct!).filter((v) => Number.isFinite(v));
    if (!vals.length) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  };
  const priorOverallPct = avgPct(prior);
  const recentOverallPct = avgPct(recent);
  if (priorOverallPct == null || recentOverallPct == null) {
    return { verdict: "unknown", recentOverallPct, priorOverallPct };
  }
  const delta = recentOverallPct - priorOverallPct;
  if (delta >= 3) return { verdict: "improved", recentOverallPct, priorOverallPct };
  if (delta <= -3) return { verdict: "worse", recentOverallPct, priorOverallPct };
  return { verdict: "neutral", recentOverallPct, priorOverallPct };
}

export function buildRecommendationStretchView(input: {
  points: AdviceCalibrationPoint[];
  feedback?: AdviceFeedback | null;
  learningHistory?: AdviceLearningSnapshot[];
}): RecommendationStretchView {
  const points = input.points;
  const buy = statsFor("buy", points);
  const sell = statsFor("sell", points);
  const hold = statsFor("hold", points);
  const good = buy.good + sell.good + hold.good;
  const bad = buy.bad + sell.bad + hold.bad;
  const moves: number[] = [];
  for (const p of points) {
    const o = scoreRecTradingOutcome(p.suggestedAction, p.priceChangePct);
    if ((o === "good" || o === "bad") && p.priceChangePct != null) moves.push(p.priceChangePct);
  }
  const overall: RecStretchActionStats = {
    action: "buy", // unused for overall label in UI
    scored: good + bad,
    good,
    bad,
    successRatePct: rate(good, bad),
    avgMovePct: avg(moves),
  };
  // Fix overall.action cosmetic — use a dedicated field in UI; keep shape.
  const stretch = stretchFromFeedback(input.feedback ?? null);
  const daySeries = buildDaySeries(points);
  const { verdict, recentOverallPct, priorOverallPct } = verdictFromSeries(daySeries);
  const timelineOverall = (input.learningHistory ?? []).map((s) => ({
    day: s.day,
    pct: s.overallSuccessRatePct,
    buyPct: s.buySuccessRatePct,
  }));

  return {
    buy,
    sell,
    hold,
    overall,
    ...stretch,
    daySeries,
    timelineOverall,
    verdict,
    recentOverallPct,
    priorOverallPct,
    scoredTotal: good + bad,
  };
}

export function recStretchVerdictTone(v: RecStretchVerdict): string {
  if (v === "improved") return "text-emerald-700 dark:text-emerald-300";
  if (v === "worse") return "text-rose-700 dark:text-rose-300";
  if (v === "neutral") return "text-amber-800 dark:text-amber-200";
  return "text-ink-muted";
}
