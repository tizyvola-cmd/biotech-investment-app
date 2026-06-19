/**

 * Daily open recalibration for the Prediction + Recalibration curve.

 *

 * Anchors «today» to the live market level (% vs T−60) using (priority):

 * 1. Nasdaq session open from Simulation row (refresh Yahoo)

 * 2. Prezzo Corrente ($) from Simulation sheet (live quote)

 * 3. pct_reale on chart bundle at today offset (snapshot close — fallback only)

 *

 * Future nodes (today → CD) are parallel-shifted so the model path continues

 * from the live anchor.

 */

import type { ChartPoint } from "../types";

import { overlaySheetPredOnPoints } from "../data/simulationCharts";

import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";

import {

  currentPriceFromRow,

  nasdaqOpenFromRow,

  priceRefreshAtFromRow,

} from "./simulationPosition";



const RECALIB_EPS_PP = 0.02;



export type DailyRecalibAnchorSource =

  | "nasdaq_open"

  | "sheet_price"

  | "snapshot_close"

  | "none";



export type DailyRecalibSummary = {

  applied: boolean;

  shiftPp: number | null;

  liveTodayPct: number | null;

  modelTodayPct: number | null;

  anchorSource: DailyRecalibAnchorSource;

  anchorPriceUsd: number | null;

  refreshAt: string | null;

};



function round2(n: number): number {

  return Math.round(n * 100) / 100;

}



function bestPct(p: ChartPoint): number | null {

  const v = p.pct_foglio ?? p.pct_curva ?? p.pct_modello;

  return typeof v === "number" && Number.isFinite(v) ? v : null;

}



function priceT60Usd(points: ChartPoint[], row: Record<string, unknown>): number | null {

  let best: ChartPoint | null = null;

  for (const p of points) {

    if (p.offset > -30) continue;

    const px = p.price_storico_usd ?? p.price_usd;

    if (typeof px !== "number" || !Number.isFinite(px) || px <= 0) continue;

    if (!best || Math.abs(p.offset + 60) < Math.abs(best.offset + 60)) {

      best = p;

    }

  }

  if (best) {

    const px = best.price_storico_usd ?? best.price_usd;

    if (typeof px === "number" && Number.isFinite(px) && px > 0) return px;

  }

  for (const k of ["Prezzo T−60 ($)", "Prezzo T-60 ($)", "close_m60", "seq_curve_t60_usd", "close_m60_cal"]) {

    const raw = row[k];

    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/,/g, ""));

    if (Number.isFinite(n) && n > 0) return n;

  }

  return null;

}



function pctFromPriceVsT60(priceUsd: number, points: ChartPoint[], row: Record<string, unknown>): number | null {

  const p60 = priceT60Usd(points, row);

  if (priceUsd > 0 && p60 != null && p60 > 0) {

    return round2((priceUsd / p60 - 1) * 100);

  }

  return null;

}



function snapshotClosePctAtToday(points: ChartPoint[], nowOff: number): number | null {

  const realeSeries = points

    .map((p) => ({

      offset: p.offset,

      y:

        typeof p.pct_reale === "number" && Number.isFinite(p.pct_reale)

          ? p.pct_reale

          : null,

    }))

    .filter((p): p is { offset: number; y: number } => p.y != null);

  const fromReale = interpolateAtOffset(realeSeries, nowOff);

  return fromReale != null ? round2(fromReale) : null;

}



type LiveAnchor = {

  pct: number | null;

  source: DailyRecalibAnchorSource;

  priceUsd: number | null;

};



/** Resolve live anchor % vs T−60 and its data source. */

export function resolveLiveAnchorAtToday(

  points: ChartPoint[],

  row: Record<string, unknown>,

  nowOff: number,

): LiveAnchor {

  const openPx = nasdaqOpenFromRow(row);

  if (openPx != null && openPx > 0) {

    const pct = pctFromPriceVsT60(openPx, points, row);

    if (pct != null) {

      return { pct, source: "nasdaq_open", priceUsd: openPx };

    }

  }



  const curr = currentPriceFromRow(row);

  if (curr != null && curr > 0) {

    const pct = pctFromPriceVsT60(curr, points, row);

    if (pct != null) {

      return { pct, source: "sheet_price", priceUsd: curr };

    }

  }



  const fromSnapshot = snapshotClosePctAtToday(points, nowOff);

  if (fromSnapshot != null) {

    return { pct: fromSnapshot, source: "snapshot_close", priceUsd: null };

  }



  return { pct: null, source: "none", priceUsd: null };

}



/** Live % vs T−60 at the calendar «today» offset (Nasdaq open / sheet / snapshot). */

export function livePctVsM60AtToday(

  points: ChartPoint[],

  row: Record<string, unknown>,

  nowOff: number,

): number | null {

  return resolveLiveAnchorAtToday(points, row, nowOff).pct;

}



export function dailyRecalibAnchorSourceLabel(

  source: DailyRecalibAnchorSource,

  lang: "it" | "en",

): string {

  switch (source) {

    case "nasdaq_open":

      return lang === "it" ? "apertura Nasdaq" : "Nasdaq open";

    case "sheet_price":

      return lang === "it" ? "Prezzo Corrente ($)" : "Prezzo Corrente ($)";

    case "snapshot_close":

      return lang === "it" ? "close snapshot (fallback)" : "snapshot close (fallback)";

    default:

      return lang === "it" ? "non disponibile" : "unavailable";

  }

}



function modelSeriesAtOffsets(points: ChartPoint[]): { offset: number; y: number }[] {

  const byOff = new Map<number, number>();

  for (const p of points) {

    const v = bestPct(p);

    if (v == null) continue;

    if (!byOff.has(p.offset)) byOff.set(p.offset, v);

  }

  return [...byOff.entries()]

    .sort((a, b) => a[0] - b[0])

    .map(([offset, y]) => ({ offset, y }));

}



function shiftPctFields(p: ChartPoint, delta: number): ChartPoint {

  const shift = (v: number | null | undefined) =>

    typeof v === "number" && Number.isFinite(v) ? round2(v + delta) : v;

  return {

    ...p,

    pct_foglio: shift(p.pct_foglio),

    pct_curva: shift(p.pct_curva),

    pct_modello: shift(p.pct_modello),

  };

}



function pinTodayFields(p: ChartPoint, liveToday: number): ChartPoint {

  return {

    ...p,

    pct_foglio: liveToday,

    pct_curva: liveToday,

    pct_reale: liveToday,

  };

}



/** Summary for UI badge — shift, anchor source, refresh timestamp. */

export function computeDailyRecalibSummary(

  points: ChartPoint[] | null | undefined,

  row: Record<string, unknown> | null | undefined,

): DailyRecalibSummary {

  const empty: DailyRecalibSummary = {

    applied: false,

    shiftPp: null,

    liveTodayPct: null,

    modelTodayPct: null,

    anchorSource: "none",

    anchorPriceUsd: null,

    refreshAt: row ? priceRefreshAtFromRow(row) : null,

  };

  if (!points?.length || !row) return empty;



  const nowOff = completionDateToNowOffset(row["Completion Date"]);

  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) return empty;



  const overlaid = overlaySheetPredOnPoints(points, row);

  const anchor = resolveLiveAnchorAtToday(overlaid, row, nowOff);

  const modelSeries = modelSeriesAtOffsets(overlaid);

  const modelAtToday = interpolateAtOffset(modelSeries, nowOff);

  const shift =

    anchor.pct != null && modelAtToday != null ? round2(anchor.pct - modelAtToday) : null;



  return {

    applied: shift != null && Math.abs(shift) >= RECALIB_EPS_PP,

    shiftPp: shift,

    liveTodayPct: anchor.pct,

    modelTodayPct: modelAtToday != null ? round2(modelAtToday) : null,

    anchorSource: anchor.source,

    anchorPriceUsd: anchor.priceUsd,

    refreshAt:

      priceRefreshAtFromRow(row) ??

      (typeof row["_manifest_updated_at"] === "string" ? row["_manifest_updated_at"] : null),

  };

}



/**

 * Shift future prediction nodes so «today» matches live market; historical segment unchanged.

 */

export function applyDailyOpenRecalib(

  points: ChartPoint[],

  row: Record<string, unknown>,

): ChartPoint[] {

  if (!points.length) return points;



  const nowOff = completionDateToNowOffset(row["Completion Date"]);

  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) return points;



  const liveToday = livePctVsM60AtToday(points, row, nowOff);

  if (liveToday == null) return points;



  const modelSeries = modelSeriesAtOffsets(points);

  const modelAtToday = interpolateAtOffset(modelSeries, nowOff);

  const shift =

    modelAtToday != null ? liveToday - modelAtToday : 0;

  const needsShift = Math.abs(shift) >= RECALIB_EPS_PP;



  let hasTodayNode = false;

  const out: ChartPoint[] = points.map((p) => {

    if (Math.abs(p.offset - nowOff) < 0.01) {

      hasTodayNode = true;

      return pinTodayFields(p, liveToday);

    }

    if (p.offset < nowOff - 0.01) return p;

    if (needsShift) return shiftPctFields(p, shift);

    return p;

  });



  if (!hasTodayNode) {

    out.push({

      offset: nowOff,

      nodo: "standard",

      tipo: "live (daily open)",

      pct_foglio: liveToday,

      pct_curva: liveToday,

      pct_reale: liveToday,

      pct_modello:

        modelAtToday != null ? round2(modelAtToday + shift) : liveToday,

      sort: [nowOff, 0],

    });

    out.sort((a, b) => {

      const sa = a.sort?.[0] ?? a.offset;

      const sb = b.sort?.[0] ?? b.offset;

      return sa !== sb ? sa - sb : (a.sort?.[1] ?? 0) - (b.sort?.[1] ?? 0);

    });

  }



  return out;

}



/** Sheet Pred overlay + daily open recalibration — single entry for all UI curves. */

export function resolveRecalibratedChartPoints(

  points: ChartPoint[] | null | undefined,

  row: Record<string, unknown> | null | undefined,

): ChartPoint[] {

  if (!points?.length || !row) return points ?? [];

  const overlaid = overlaySheetPredOnPoints(points, row);

  return applyDailyOpenRecalib(overlaid, row);

}

/** Pred +5 forward delta (pp) along a resolved curve at «today». */
export function forwardPred5PpFromCurvePoints(
  row: Record<string, unknown>,
  points: ChartPoint[],
): number | null {
  if (!points.length) return null;
  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 5) return null;
  const series = modelSeriesAtOffsets(points);
  const atNow = interpolateAtOffset(series, nowOff, { extrapolate: true });
  const atFwd = interpolateAtOffset(series, nowOff + 5, { extrapolate: true });
  if (atNow == null || atFwd == null) return null;
  return round2(atFwd - atNow);
}

/**
 * Pred +5 da oggi sulla curva Prediction + 8-K/AI (sheet overlay) — **prima**
 * dello shift daily open (ancora al livello modello pre-apertura).
 */
export function forwardPred5PpBeforeDailyRecalib(
  row: Record<string, unknown>,
  chartPoints: ChartPoint[] | null | undefined,
): number | null {
  if (!chartPoints?.length || !row) return null;
  const overlaid = overlaySheetPredOnPoints(chartPoints, row);
  return forwardPred5PpFromCurvePoints(row, overlaid);
}

/**
 * Pred +5 da oggi **dopo** ricalibrazione giornaliera (ancoraggio live a oggi).
 */
export function forwardPred5PpAfterDailyRecalib(
  row: Record<string, unknown>,
  chartPoints: ChartPoint[] | null | undefined,
): number | null {
  if (!chartPoints?.length || !row) return null;
  const recalib = resolveRecalibratedChartPoints(chartPoints, row);
  return forwardPred5PpFromCurvePoints(row, recalib);
}

/** Pred +5 forward delta (pp) from the daily-recalibrated curve at «today». */
export function forwardPred5PpFromRecalibCurve(
  row: Record<string, unknown>,
  chartPoints: ChartPoint[] | null | undefined,
): number | null {
  return forwardPred5PpAfterDailyRecalib(row, chartPoints);
}



/** Planned gain € along the recalibrated curve (entry → each day). */

export function plannedGainEurFromRecalibCurve(

  row: Record<string, unknown>,

  chartPoints: ChartPoint[] | null | undefined,

  capital: number,

  holdDaysElapsed: number,

  day: number,

): number | null {

  if (!chartPoints?.length || capital <= 0 || !Number.isFinite(capital)) return null;

  const recalib = resolveRecalibratedChartPoints(chartPoints, row);

  const nowOff = completionDateToNowOffset(row["Completion Date"]);

  if (nowOff == null || !Number.isFinite(nowOff) || nowOff >= 0) return null;



  const elapsed =

    holdDaysElapsed != null && Number.isFinite(holdDaysElapsed) && holdDaysElapsed >= 0

      ? holdDaysElapsed

      : 0;

  const entryOff = nowOff - elapsed;

  const series = modelSeriesAtOffsets(recalib);

  const atEntry = interpolateAtOffset(series, entryOff, { extrapolate: true });

  const atDay = interpolateAtOffset(series, entryOff + day, { extrapolate: true });

  if (atEntry == null || atDay == null) return null;

  const returnPct = atDay - atEntry;

  return round2((capital * returnPct) / 100);

}


