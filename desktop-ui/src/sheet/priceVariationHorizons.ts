/**
 * Variazioni % prezzo vs ieri / 7g / 1M — da foglio Simulation e/o bundle grafici.
 */
import type { ChartPoint, ChartSeries } from "../types";
import { completionDateToNowOffset, interpolateAtOffset } from "./chartNowOffset";
import { computeDailyRecalibSummary } from "./predictionCurveDailyRecalib";
import { currentPriceFromRow, dailyChangePctFromRow } from "./simulationPosition";
import { resolveVarHorizonPct } from "./simulationStyles";

export type PriceVariationHorizons = {
  d1: number | null;
  d7: number | null;
  m1: number | null;
};

function parseNum(v: unknown): number | null {
  if (v == null || v === "" || v === "—" || v === "-") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ".").replace(/%/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pctFromPrices(now: number, then: number): number | null {
  if (!Number.isFinite(now) || !Number.isFinite(then) || then <= 0) return null;
  return Math.round(((now - then) / then) * 10000) / 100;
}

/** Δ% prezzo da storico bundle (offset calendario vs CD). */
function pricePctChangeCalendarDaysAgo(
  row: Record<string, unknown>,
  points: ChartPoint[] | null | undefined,
  calendarDays: number,
): number | null {
  if (!points?.length || calendarDays <= 0) return null;
  const nowOff = completionDateToNowOffset(row["Completion Date"]);
  if (nowOff == null || !Number.isFinite(nowOff)) return null;

  const pricePts = points
    .filter((p) => p.price_storico_usd != null && Number.isFinite(p.price_storico_usd))
    .map((p) => ({ offset: p.offset, y: p.price_storico_usd as number }));

  if (pricePts.length < 2) return null;

  const nowPrice = interpolateAtOffset(pricePts, nowOff);
  const pastPrice = interpolateAtOffset(pricePts, nowOff - calendarDays);
  return pctFromPrices(nowPrice ?? NaN, pastPrice ?? NaN);
}

function varFromRow(row: Record<string, unknown>, ...cols: string[]): number | null {
  for (const c of cols) {
    const n = parseNum(row[c]);
    if (n != null) return n;
  }
  return null;
}

export function resolvePriceVariationHorizons(
  row: Record<string, unknown> | null | undefined,
  chartPoints?: ChartPoint[] | null,
  seriesMeta?: Pick<ChartSeries, "var_horizons"> | null,
): PriceVariationHorizons {
  const r = row ?? {};
  const horizons = seriesMeta?.var_horizons;

  const d1 =
    dailyChangePctFromRow(r) ??
    resolveVarHorizonPct(horizons, "1d") ??
    varFromRow(r, "Var. Giorn. %", "Var. Giorn.%", "dailyChange_%");

  const m1 =
    varFromRow(r, "Var. 1M %", "Var. 1M%") ??
    resolveVarHorizonPct(horizons, "1M");

  let d7 =
    varFromRow(r, "Var. 7d %", "Var. 7D %", "Var. 7g %", "Var. 7G %", "Var. 7 days %") ??
    resolveVarHorizonPct(horizons, "7d");

  if (d7 == null) {
    d7 = pricePctChangeCalendarDaysAgo(r, chartPoints, 7);
  }

  return { d1, d7, m1 };
}

export function priceVariationTone(pct: number | null): "up" | "down" | "flat" | "muted" {
  if (pct == null || !Number.isFinite(pct)) return "muted";
  if (pct > 0.05) return "up";
  if (pct < -0.05) return "down";
  return "flat";
}

export function formatPriceVariationPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export type TodayModelRealPrices = {
  /** Prezzo di mercato corrente (Yahoo / foglio). */
  realUsd: number | null;
  /** Prezzo implicito del modello ricalibrato a «oggi» (prima del pin live). */
  modelUsd: number | null;
  /** Reale − modello ($). */
  gapUsd: number | null;
  /** Scostamento % (reale vs modello). */
  gapPct: number | null;
};

function usdFromPctVsT60Base(
  baseUsd: number,
  livePctVsT60: number,
  targetPctVsT60: number,
): number | null {
  const denom = 1 + livePctVsT60 / 100;
  if (!Number.isFinite(denom) || denom <= 0) return null;
  const p60 = baseUsd / denom;
  return Math.round(p60 * (1 + targetPctVsT60 / 100) * 100) / 100;
}

/** Prezzo atteso (modello) vs reale a oggi — stesso asse % vs T−60 della curva. */
export function resolveTodayExpectedVsRealUsd(
  row: Record<string, unknown> | null | undefined,
  chartPoints?: ChartPoint[] | null,
): TodayModelRealPrices {
  const r = row ?? {};
  const realUsd = currentPriceFromRow(r);
  const summary = computeDailyRecalibSummary(chartPoints, r);

  let modelUsd: number | null = null;
  if (
    realUsd != null &&
    realUsd > 0 &&
    summary.liveTodayPct != null &&
    summary.modelTodayPct != null
  ) {
    modelUsd = usdFromPctVsT60Base(realUsd, summary.liveTodayPct, summary.modelTodayPct);
  }

  const gapUsd =
    realUsd != null && modelUsd != null
      ? Math.round((realUsd - modelUsd) * 100) / 100
      : null;
  const gapPct =
    gapUsd != null && modelUsd != null && modelUsd > 0
      ? Math.round((gapUsd / modelUsd) * 10000) / 100
      : null;

  return { realUsd, modelUsd, gapUsd, gapPct };
}

export function todayModelRealTone(gapPct: number | null): string {
  const t = priceVariationTone(gapPct);
  if (t === "up") return "text-[rgb(var(--signal-up))]";
  if (t === "down") return "text-[rgb(var(--signal-down))]";
  if (t === "flat") return "text-ink";
  return "text-ink-muted";
}

export function fmtStockUsdShort(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 100) return `$${v.toFixed(0)}`;
  if (v >= 10) return `$${v.toFixed(1)}`;
  return `$${v.toFixed(2)}`;
}
