/**
 * Recommendation channel — PREDICTIVE SELL timing (UI-side).
 *
 * The backend "SELL → P(down)" grades the move AFTER each actual exit, so it is
 * reactive: stop-loss fires once the drop already happened, SDS<40 lags, pre-CD
 * is calendar-based. That is why it sits near a coin-flip (~43%).
 *
 * This module asks the opposite question the user wants: can we flag the RIGHT
 * moment to sell — BEFORE the price falls — by combining three early-weakness
 * signals into a weighted sell-score, then validate it walk-forward?
 *
 *   sell_score = w_mom · (momentum↓)  +  w_eis · (EIS ≤ 0 near the drop)
 *                                     +  w_rescue · (low rescue score)
 *
 * For each position we walk its daily PnL path; the first day the sell-score
 * crosses the threshold is the "recommended sell day". We then look forward over
 * a fixed horizon and check whether the price actually fell (signal correct) or
 * rose (premature sell). P(down) of this signal is the walk-forward quality, to
 * be compared against the reactive ~43% baseline.
 *
 * Honest data note: the true Market Interest Index (MII) needs price × VOLUME,
 * and the daily history only stores PnL% (no volume). So the "momentum↓"
 * component is the PRICE-slope proxy of MII (its directional part). The EIS and
 * rescue components are the real ones already used elsewhere in the sheet
 * (`computeEisFeedWindowScore`, `computeRescueScoreBreakdown`).
 */
import { computeRescueScoreBreakdown } from "./lossRescueEngine";
import type { InvestSimHistoryPoint, InvestSimInputEntry } from "./investSimStorage";

export type SellTimingParams = {
  /** Weight of the momentum↓ (MII price-proxy) component. */
  wMomentum: number;
  /** Weight of the EIS≤0 (near the drop) component. */
  wEis: number;
  /** Weight of the low-rescue-score component. */
  wRescue: number;
  /** sell-score (0–1) at/above which the SELL signal fires. */
  threshold: number;
  /** Trailing window (calendar days) for the momentum slope. */
  momentumLookbackDays: number;
  /** Slope (pp/day, negative) that saturates the momentum component at 1. */
  momentumSaturationPpPerDay: number;
  /** Negative EIS that saturates the EIS component at 1. */
  eisSaturation: number;
  /** Rescue score (0–100) at/below which the rescue component is at 1. */
  rescueFloor: number;
  /** Forward window (calendar days) over which the post-signal move is judged. */
  forwardHorizonDays: number;
  /** |forward move| under this (pp) is flat → excluded from the hit-rate. */
  flatBandPct: number;
};

export const SELL_TIMING_DEFAULTS: SellTimingParams = {
  wMomentum: 0.4,
  wEis: 0.3,
  wRescue: 0.3,
  threshold: 0.55,
  momentumLookbackDays: 10,
  momentumSaturationPpPerDay: 0.6,
  eisSaturation: 25,
  rescueFloor: 35,
  forwardHorizonDays: 30,
  flatBandPct: 1.0,
};

export type SellTimingSignal = {
  key: string;
  ticker: string;
  signalTs: string;
  signalPnlPct: number;
  sellScore: number;
  components: { momentumPt: number; eisPt: number; rescuePt: number };
  /** Forward move (pp) from the signal day to the last point within the horizon. */
  forwardMovePct: number | null;
  /** True = price fell after the signal (correct sell), false = rose, null = flat/pending. */
  result: "down" | "up" | "flat" | "pending";
  /** Calendar days from the signal to the end of the position's path (lead time). */
  leadDays: number | null;
};

export type SellTimingAnalysis = {
  available: boolean;
  /** Walk-forward P(price fell | early-weakness SELL signal). */
  pDownPct: number | null;
  /** Signals graded down/up (excludes flat + pending). */
  gradedN: number;
  /** Signals fired in total. */
  signalN: number;
  pendingN: number;
  flatN: number;
  /** Median lead time (days) of graded signals vs the end of the path. */
  medianLeadDays: number | null;
  params: SellTimingParams;
  signals: SellTimingSignal[];
  note: string | null;
};

type SeriesPoint = { ts: string; pnlPct: number };

function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function round1(v: number | null): number | null {
  return v == null ? null : Math.round(v * 10) / 10;
}

/** Ordered (ts asc) PnL% series for one row key from the portfolio history. */
function seriesForKey(key: string, history: InvestSimHistoryPoint[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const h of history) {
    const snap = h.byTicker?.[key];
    if (snap && snap.pnlPct != null && Number.isFinite(snap.pnlPct)) {
      out.push({ ts: h.ts, pnlPct: snap.pnlPct });
    }
  }
  return out.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

/** Trailing PnL slope (pp/day) over the lookback window ending at index i. */
function trailingSlopePpPerDay(
  series: SeriesPoint[],
  i: number,
  lookbackDays: number,
): number | null {
  const end = series[i]!;
  let start: SeriesPoint | null = null;
  for (let j = i - 1; j >= 0; j -= 1) {
    if (dayDiff(series[j]!.ts, end.ts) <= lookbackDays) {
      start = series[j]!;
    } else {
      break;
    }
  }
  if (!start) return null;
  const days = dayDiff(start.ts, end.ts);
  if (days <= 0) return null;
  return (end.pnlPct - start.pnlPct) / days;
}

/**
 * Score each position's daily path and grade the first early-weakness SELL
 * signal against the forward move.
 *
 * @param eisScoreForKey resolver for the EIS window score near the drop date
 *   (same one the rescue analysis uses → "EIS a ridosso del calo").
 */
export function analyzeSellTiming(args: {
  history: InvestSimHistoryPoint[];
  inputs: Record<string, InvestSimInputEntry>;
  eisScoreForKey?: (ticker: string) => number | null;
  params?: Partial<SellTimingParams>;
}): SellTimingAnalysis {
  const params: SellTimingParams = { ...SELL_TIMING_DEFAULTS, ...(args.params ?? {}) };
  const wSum = params.wMomentum + params.wEis + params.wRescue || 1;
  const wMom = params.wMomentum / wSum;
  const wEis = params.wEis / wSum;
  const wRescue = params.wRescue / wSum;

  const signals: SellTimingSignal[] = [];

  for (const [key, entry] of Object.entries(args.inputs)) {
    const series = seriesForKey(key, args.history);
    if (series.length < 3) continue;

    const ticker = key.split("|")[0] ?? key;
    const eis = args.eisScoreForKey ? args.eisScoreForKey(ticker) : null;
    const eisPt = eis != null && eis < 0 ? clamp(-eis / params.eisSaturation, 0, 1) : 0;

    // First day the weighted sell-score crosses the threshold (leave the last
    // point out — a signal on the final day has no forward window to judge).
    let fired: { idx: number; score: number; momentumPt: number; rescuePt: number } | null = null;
    for (let i = 1; i < series.length - 1; i += 1) {
      const slope = trailingSlopePpPerDay(series, i, params.momentumLookbackDays);
      const momentumPt =
        slope != null && slope < 0
          ? clamp(-slope / params.momentumSaturationPpPerDay, 0, 1)
          : 0;

      const { rescoreScore } = computeRescueScoreBreakdown({
        entryProbPct: entry.entryProbPct ?? null,
        lastMarkPct: series[i]!.pnlPct,
        eisWindowScore: eis,
      });
      const rescuePt = clamp((params.rescueFloor - rescoreScore) / params.rescueFloor, 0, 1);

      const sellScore = wMom * momentumPt + wEis * eisPt + wRescue * rescuePt;
      if (sellScore >= params.threshold) {
        fired = { idx: i, score: sellScore, momentumPt, rescuePt };
        break;
      }
    }
    if (!fired) continue;

    const sig = series[fired.idx]!;
    const horizonPts = series
      .slice(fired.idx + 1)
      .filter((p) => dayDiff(sig.ts, p.ts) <= params.forwardHorizonDays);

    let forwardMovePct: number | null = null;
    let result: SellTimingSignal["result"] = "pending";
    if (horizonPts.length) {
      forwardMovePct = Math.round((horizonPts[horizonPts.length - 1]!.pnlPct - sig.pnlPct) * 100) / 100;
      if (forwardMovePct <= -params.flatBandPct) result = "down";
      else if (forwardMovePct >= params.flatBandPct) result = "up";
      else result = "flat";
    }

    signals.push({
      key,
      ticker,
      signalTs: sig.ts,
      signalPnlPct: Math.round(sig.pnlPct * 100) / 100,
      sellScore: Math.round(fired.score * 1000) / 1000,
      components: {
        momentumPt: Math.round(fired.momentumPt * 1000) / 1000,
        eisPt: Math.round(eisPt * 1000) / 1000,
        rescuePt: Math.round(fired.rescuePt * 1000) / 1000,
      },
      forwardMovePct,
      result,
      leadDays: dayDiff(sig.ts, series[series.length - 1]!.ts),
    });
  }

  if (!signals.length) {
    return {
      available: false,
      pDownPct: null,
      gradedN: 0,
      signalN: 0,
      pendingN: 0,
      flatN: 0,
      medianLeadDays: null,
      params,
      signals: [],
      note:
        "nessun segnale di debolezza precoce nello storico (con i pesi/soglia attuali) — si popola con i cicli",
    };
  }

  const downs = signals.filter((s) => s.result === "down").length;
  const ups = signals.filter((s) => s.result === "up").length;
  const flatN = signals.filter((s) => s.result === "flat").length;
  const pendingN = signals.filter((s) => s.result === "pending").length;
  const gradedN = downs + ups;
  const pDownPct = gradedN ? round1((downs / gradedN) * 100) : null;
  const medianLeadDays = round1(
    median(
      signals
        .filter((s) => s.result === "down" || s.result === "up")
        .map((s) => s.leadDays)
        .filter((d): d is number => d != null),
    ),
  );

  return {
    available: gradedN > 0,
    pDownPct,
    gradedN,
    signalN: signals.length,
    pendingN,
    flatN,
    medianLeadDays,
    params,
    signals,
    note:
      gradedN > 0
        ? null
        : "segnali presenti ma non ancora valutabili (orizzonte forward non coperto) — si popola con i cicli",
  };
}
