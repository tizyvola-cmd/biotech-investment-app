/**
 * P(continuation) v2 — sell-only exhaustion vs g10-bucket base.
 * Columns from prediction/continuation_score.py (drawdown-from-start label).
 *
 * Soft SELL: green book + g10≥min + sell_edge > 0
 * (P(exhaustion) above the same-rate bucket base).
 * Live edge/g10 gate may be stretched by continuationSellStretchStore.
 */

import {
  contSellPassesStretch,
  resolveContSellStretchThresholds,
} from "./continuationSellStretchStore";
import type { ChartPoint } from "../types";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import {
  interpolateCurveP,
  resolveContCurvePop,
  resolveContPctPopRate,
} from "./continuationPercentileCurve";

/** Prefer names that already ran so we do not sell flat names. */
export const P_CONT_SELL_MIN_G10 = 5;

/**
 * Early-run breakout: g10 still below sell regime but session Δ is strong —
 * catch names like HAE (+16% day, +4.9% 10d) at the start of the curve.
 */
export const EARLY_PEAK_MIN_DAY_PCT = 8;

/**
 * Soft BUY quality floor when already in sell-regime (g10 ≥ 5%):
 * require P(cont) ≥ coin-flip so we do not Soft BUY exhausted runs.
 * Out of regime (g10 &lt; 5%) → gate skipped (P(cont) N/A).
 */
export const SOFT_BUY_MIN_PCONT = 50;

export type ContBand = "high" | "mid" | "low" | "declining" | "not_run" | "unknown";

export type ContSellUiRegime = "declining" | "not_run" | "in_regime" | "missing";

function coerceSimNum(raw: unknown): number | null {
  if (raw == null || raw === "" || raw === "—") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ".").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

function numField(simRow: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!simRow) return null;
  return coerceSimNum(simRow[key]);
}

/**
 * Column `p_continuation` in v2 is blended **P(exhaustion)** (drawdown ≥5% in 5d),
 * 0..100 — not P(continuation). Prefer `resolveDisplayPContinuation` for UI %.
 */
export function resolvePContinuation(simRow: Record<string, unknown> | null | undefined): number | null {
  if (!simRow) return null;
  return coerceSimNum(simRow.p_continuation ?? simRow["P(continuation)"]);
}

/** Alias — same column as resolvePContinuation (exhaustion). */
export function resolvePExhaustion(
  simRow: Record<string, unknown> | null | undefined,
): number | null {
  return resolvePContinuation(simRow);
}

/**
 * UI P(continuation) — same number as the chart chrome:
 * population curve at rate percentile, else 100 − P(exhaustion).
 */
export function resolveDisplayPContinuation(
  simRow: Record<string, unknown> | null | undefined,
): number | null {
  const fromCurve = interpolateCurveP(
    resolveContCurvePop(simRow),
    resolveContPctPopRate(simRow),
  );
  if (fromCurve != null) return Math.round(fromCurve * 10) / 10;
  const pExh = resolvePExhaustion(simRow);
  if (pExh == null) return null;
  return Math.round((100 - pExh) * 10) / 10;
}

export function resolveContPBase(simRow: Record<string, unknown> | null | undefined): number | null {
  return numField(simRow, "cont_p_base");
}

export function resolveContPOwn(simRow: Record<string, unknown> | null | undefined): number | null {
  return numField(simRow, "cont_p_own");
}

export function resolveContPPop(simRow: Record<string, unknown> | null | undefined): number | null {
  return numField(simRow, "cont_p_pop");
}

/** sell_edge = P − p_base(bucket); positive → more exhaustion than regime. */
export function resolveContSellEdge(simRow: Record<string, unknown> | null | undefined): number | null {
  const direct = numField(simRow, "cont_sell_edge");
  if (direct != null) return direct;
  const p = resolvePContinuation(simRow);
  const base = resolveContPBase(simRow);
  if (p == null || base == null) return null;
  return Math.round((p - base) * 10) / 10;
}

export function resolveContBand(simRow: Record<string, unknown> | null | undefined): ContBand {
  const b = String(simRow?.cont_band ?? "").toLowerCase();
  if (
    b === "high" ||
    b === "mid" ||
    b === "low" ||
    b === "declining" ||
    b === "not_run"
  ) {
    return b;
  }
  return "unknown";
}

export function resolveContG10(simRow: Record<string, unknown> | null | undefined): number | null {
  return numField(simRow, "cont_g10");
}

/**
 * ~10-session % from chart when `cont_g10` is missing (stale sheet / pre-enrich).
 * Matches PRIMARY_WINDOW = 10 on the backend.
 *
 * Uses CD-relative offsets. Catalyst sidecar CDs are often months/years off
 * the live price window, so this returns null and callers should use
 * {@link estimateContG10FromDailyCloses} (Yahoo session bars) instead.
 */
export function estimateContG10FromChart(
  simRow: Record<string, unknown> | null | undefined,
  chartPts: ChartPoint[] | null | undefined,
): number | null {
  if (!simRow || !chartPts?.length) return null;
  const pricePts = chartPts
    .filter((p) => p.price_storico_usd != null && Number.isFinite(p.price_storico_usd))
    .map((p) => ({ offset: p.offset, y: p.price_storico_usd as number }));
  if (pricePts.length < 2) return null;
  const nowOff = completionDateToNowOffset(simRow["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff)) return null;
  const minOff = Math.min(...pricePts.map((p) => p.offset));
  const maxOff = Math.max(...pricePts.map((p) => p.offset));
  // interpolateAtOffset clamps outside the series — refuse rather than a fake 0%.
  if (nowOff > maxOff + 0.5 || nowOff - 10 < minOff - 0.5) return null;
  const end = interpolateAtOffset(pricePts, nowOff);
  const start = interpolateAtOffset(pricePts, nowOff - 10);
  if (end == null || start == null || !(start > 0)) return null;
  return Math.round((end / start - 1) * 1000) / 10;
}

/** Last ~10 Yahoo daily closes → session % (not CD-relative). */
export function estimateContG10FromDailyCloses(
  closes: ReadonlyArray<{ close?: number | null } | number | null | undefined>,
): number | null {
  const vals: number[] = [];
  for (const c of closes) {
    const n = typeof c === "number" ? c : c?.close;
    if (n != null && Number.isFinite(n) && n > 0) vals.push(n);
  }
  if (vals.length < 2) return null;
  const end = vals[vals.length - 1]!;
  const startIdx = Math.max(0, vals.length - 11);
  const start = vals[startIdx]!;
  if (!(start > 0) || startIdx === vals.length - 1) return null;
  return Math.round((end / start - 1) * 1000) / 10;
}

/** Sheet cont_g10, else chart estimate. */
export function resolveContG10WithFallback(
  simRow: Record<string, unknown> | null | undefined,
  chartPts?: ChartPoint[] | null,
): number | null {
  const direct = resolveContG10(simRow);
  if (direct != null) return direct;
  return estimateContG10FromChart(simRow, chartPts);
}

/** UI regime for open-book signal — always one of four states. */
export function resolveContSellUiRegime(
  g10: number | null | undefined,
): ContSellUiRegime {
  if (g10 == null || !Number.isFinite(g10)) return "missing";
  if (g10 < 0) return "declining";
  if (g10 < P_CONT_SELL_MIN_G10) return "not_run";
  return "in_regime";
}

/** Merge fallback g10 into a row copy for chart/badge consumers. */
export function withContG10Fallback(
  simRow: Record<string, unknown> | null | undefined,
  chartPts?: ChartPoint[] | null,
): Record<string, unknown> | null {
  if (!simRow) return null;
  const g10 = resolveContG10WithFallback(simRow, chartPts);
  if (g10 == null || resolveContG10(simRow) != null) return simRow;
  return { ...simRow, cont_g10: g10 };
}

export function resolveContZOwn(simRow: Record<string, unknown> | null | undefined): number | null {
  return numField(simRow, "cont_z_own");
}

export function resolveContPctPop(simRow: Record<string, unknown> | null | undefined): number | null {
  return numField(simRow, "cont_pct_pop");
}

/**
 * Soft SELL when exhaustion edge clears the (possibly stretched) threshold.
 * Stretch comes from the continuation-sell learning loop (Model Analysis).
 */
export function shouldContinuationExhaustedSell(opts: {
  hasPosition: boolean;
  pnlPct: number | null | undefined;
  simRow?: Record<string, unknown> | null;
}): boolean {
  if (!opts.hasPosition) return false;
  const mtm = opts.pnlPct;
  if (mtm == null || !Number.isFinite(mtm) || mtm <= 0) return false;
  return contSellPassesStretch(
    {
      g10: resolveContG10(opts.simRow ?? null),
      edge: resolveContSellEdge(opts.simRow ?? null),
    },
    resolveContSellStretchThresholds(),
    P_CONT_SELL_MIN_G10,
  );
}

/**
 * Soft BUY continuation quality — when the name already ran (g10 ≥ 5%),
 * block entry if exhaustion edge &gt; 0 or P(cont) &lt; {@link SOFT_BUY_MIN_PCONT}.
 * Below +5% the sell-regime score does not apply → allow.
 */
export function softBuyContinuationAllows(
  simRow: Record<string, unknown> | null | undefined,
): boolean {
  const g10 = resolveContG10(simRow);
  if (g10 == null || !Number.isFinite(g10) || g10 < P_CONT_SELL_MIN_G10) {
    return true;
  }
  const edge = resolveContSellEdge(simRow);
  if (edge != null && Number.isFinite(edge) && edge > 0) {
    return false;
  }
  const pCont = resolveDisplayPContinuation(simRow);
  if (pCont != null && Number.isFinite(pCont) && pCont < SOFT_BUY_MIN_PCONT) {
    return false;
  }
  return true;
}

/**
 * Soft BUY G1w — “vento + corsa”: strong 10d run with high P(cont) and no
 * exhaustion edge. Positive evidence that promotes Suggested BUY; Top2 /
 * rising / cooldown only affect ranking, not the hard suggest.
 */
export function softBuyWindRunHit(
  simRow: Record<string, unknown> | null | undefined,
): boolean {
  const g10 = resolveContG10(simRow);
  if (g10 == null || !Number.isFinite(g10) || g10 < P_CONT_SELL_MIN_G10) {
    return false;
  }
  const pCont = resolveDisplayPContinuation(simRow);
  if (pCont == null || !Number.isFinite(pCont) || pCont < SOFT_BUY_MIN_PCONT) {
    return false;
  }
  const edge = resolveContSellEdge(simRow);
  if (edge != null && Number.isFinite(edge) && edge > 0) {
    return false;
  }
  return true;
}

/**
 * Soft BUY G1w early peak — corsa nascente (0 ≤ g10 &lt; 5%) with a strong
 * session breakout. P(cont) is N/A below +5% 10d; momentum substitutes.
 * Declining names (g10 &lt; 0) are excluded.
 */
export function softBuyEarlyPeakHit(
  simRow: Record<string, unknown> | null | undefined,
  dayPct: number | null | undefined,
): boolean {
  const g10 = resolveContG10(simRow);
  if (g10 == null || !Number.isFinite(g10) || g10 < 0 || g10 >= P_CONT_SELL_MIN_G10) {
    return false;
  }
  if (dayPct == null || !Number.isFinite(dayPct) || dayPct < EARLY_PEAK_MIN_DAY_PCT) {
    return false;
  }
  const edge = resolveContSellEdge(simRow);
  if (edge != null && Number.isFinite(edge) && edge > 0) {
    return false;
  }
  return true;
}

/** Full wind-run (10d≥5 · P(cont)≥50) or early-peak breakout. */
export function softBuyWindOrEarlyPeakHit(
  simRow: Record<string, unknown> | null | undefined,
  dayPct: number | null | undefined,
): boolean {
  return softBuyWindRunHit(simRow) || softBuyEarlyPeakHit(simRow, dayPct);
}

/** G10 regime relative to the sell-only continuation gate. */
export type ContSellRegime = "declining" | "not_run" | "in_regime" | "unknown";

export function resolveContSellRegime(
  simRow: Record<string, unknown> | null | undefined,
): ContSellRegime {
  const g10 = resolveContG10(simRow);
  if (g10 == null) return "unknown";
  if (g10 < 0) return "declining";
  if (g10 < P_CONT_SELL_MIN_G10) return "not_run";
  return "in_regime";
}

/**
 * Cut / list priority among loss-side sells (higher = sooner).
 * Declining → out-of-regime → in-regime exhaustion edge → still-running.
 */
export function contSellCutPriority(
  simRow: Record<string, unknown> | null | undefined,
): number {
  const regime = resolveContSellRegime(simRow);
  if (regime === "declining") return 300;
  if (regime === "not_run") return 200;
  if (regime === "unknown") return 50;
  const edge = resolveContSellEdge(simRow);
  if (edge != null && Number.isFinite(edge) && edge > 0) {
    return 100 + Math.min(Math.round(edge), 50);
  }
  return 0;
}

/**
 * Extra Soft SELL G1 secondary on open red book — declining / not-run /
 * in-regime exhaustion. Does not invent a score for declining names.
 */
export function contLossSideSellBoost(
  simRow: Record<string, unknown> | null | undefined,
): string | null {
  const regime = resolveContSellRegime(simRow);
  if (regime === "declining") return "g10 declining";
  if (regime === "not_run") return "g10 not in regime";
  if (regime === "in_regime") {
    const edge = resolveContSellEdge(simRow);
    if (edge != null && Number.isFinite(edge) && edge > 0) {
      return "exhaustion edge>0";
    }
  }
  return null;
}

/** Red-book recovery HOLD is weaker when G10 context says cut sooner. */
export function contWeakensRecoveryHold(opts: {
  pnlPct: number | null | undefined;
  simRow?: Record<string, unknown> | null;
}): boolean {
  const pnl = opts.pnlPct;
  if (pnl == null || !Number.isFinite(pnl) || pnl >= 0) return false;
  return contLossSideSellBoost(opts.simRow ?? null) != null;
}

export function contBandLabel(band: ContBand, it: boolean): string {
  if (band === "high") return it ? "esaurimento sopra base bucket" : "exhaustion above bucket base";
  if (band === "low") return it ? "esaurimento sotto base bucket" : "exhaustion below bucket base";
  if (band === "mid") return it ? "~ base bucket" : "~ bucket base";
  if (band === "declining") return it ? "in calo (10g %)" : "declining (10d %)";
  if (band === "not_run") return it ? "corsa nascente (<5%)" : "early run (<5%)";
  return it ? "n/d" : "n/a";
}

export function contSellUiRegimeLabel(regime: ContSellUiRegime, it: boolean): string {
  if (regime === "declining") return it ? "in calo" : "declining";
  if (regime === "not_run") return it ? "corsa nascente" : "early run";
  if (regime === "in_regime") return it ? "in corsa" : "in run";
  return it ? "10g % n/d" : "10d % n/a";
}

export function continuationTooltipText(
  simRow: Record<string, unknown> | null | undefined,
  it: boolean,
): string {
  const pCont = resolveDisplayPContinuation(simRow);
  const g10 = resolveContG10(simRow);
  const lines = it
    ? [
        "P(cont) = probabilità che il titolo continui a crescere.",
        "D10% = quanto è cresciuto in percentuale negli ultimi 10 giorni.",
      ]
    : [
        "P(cont) = probability that the stock continues to rise.",
        "D10% = how much the price has grown, in percent, over the last 10 days.",
      ];
  if (pCont != null && Number.isFinite(pCont)) {
    lines.push(it ? `P(cont) ora ${Math.round(pCont)}%` : `P(cont) now ${Math.round(pCont)}%`);
  }
  if (g10 != null && Number.isFinite(g10)) {
    const g = `${g10 >= 0 ? "+" : ""}${g10.toFixed(1)}%`;
    lines.push(`D10% ${g}`);
  }
  return lines.join("\n");
}
