import type {
  AdviceActionKind,
  AdviceCalibrationPoint,
} from "./investDecisionSimAdviceCalibration";
import {
  ADVICE_CALIB_BUY_MIN_UP_PCT,
  scatterYForAdvicePoint,
} from "./investDecisionSimAdviceCalibration";
import { liveAdviceSessionAnchor } from "./adviceSessionAnchor";

export const ADVICE_ACTIONS: AdviceActionKind[] = ["buy", "sell", "hold", "review"];

export type AdviceErrorTimeBucket = {
  key: string;
  label: string;
  meanAbsErrorPct: number | null;
  meanSignedErrorPct: number | null;
  successPct: number | null;
  scored: number;
  good: number;
  bad: number;
};

export type AdviceErrorActionBucket = {
  action: AdviceActionKind;
  meanAbsErrorPct: number | null;
  meanSignedErrorPct: number | null;
  successPct: number | null;
  scored: number;
  good: number;
  bad: number;
};

/** Operational error taxonomy shown on the BUY/SELL advice error chart. */
export type AdviceBuySellErrorKind = "wrongBuy" | "wrongSell" | "missBuy";

export type AdviceOperationalErrorKind = AdviceBuySellErrorKind | "missSell";

/** Critical = missed SELL while position lost value; sized by loss % of capital. */
export type MissSellLossTier = 1 | 2 | 3 | 4;

export type AdviceErrorVisualClass = "criticalMissSell" | "secondary";

export type SecondaryErrorPalette = "yellowBlue" | "blueYellow";

export const MISS_SELL_LOSS_TIER_THRESHOLDS = [25, 50, 75, 100] as const;

export type AdviceErrorHorizon = "24h" | "7d" | "all";

export type AdviceErrorDotPoint = {
  id: string;
  ticker: string;
  x: number;
  xLabel: string;
  /** Signed forecast error % (Y axis). */
  y: number;
  signedErrorPct: number;
  absErrorPct: number;
  outcome: "good" | "bad";
  suggestedAction: AdviceActionKind;
  /** wrongBuy | wrongSell | missBuy — missSell uses visualClass instead. */
  errorKind?: AdviceBuySellErrorKind;
  /** Critical miss-sell + loss vs other errors. */
  visualClass?: AdviceErrorVisualClass;
  /** Loss as % of invested — quartile 1–4 for critical marker size. */
  missSellLossTier?: MissSellLossTier;
  /** Yellow/blue pairing for non-critical dots. */
  secondaryPalette?: SecondaryErrorPalette;
};

const MS_24H = 24 * 60 * 60 * 1000;
const MS_7D = 7 * MS_24H;

const EXECUTED_BUY_KINDS = new Set(["good_buy", "bad_buy", "paper_buy", "deal_buy"]);
const EXECUTED_SELL_KINDS = new Set(["good_sell", "bad_sell", "paper_sell", "deal_sell"]);

function stockMovePct(p: AdviceCalibrationPoint): number | null {
  const move = p.priceChangePct ?? p.pnlPct;
  return move != null && Number.isFinite(move) ? Math.round(move * 10) / 10 : null;
}

function isBuyExecuted(p: AdviceCalibrationPoint): boolean {
  return EXECUTED_BUY_KINDS.has(p.kind);
}

function isSellExecuted(p: AdviceCalibrationPoint): boolean {
  return EXECUTED_SELL_KINDS.has(p.kind);
}

/** BUY signal ignored while the stock rallied. */
export function isMissBuyRally(p: AdviceCalibrationPoint): boolean {
  if (p.suggestedAction !== "buy" || isBuyExecuted(p)) return false;
  const move = stockMovePct(p);
  return move != null && move >= ADVICE_CALIB_BUY_MIN_UP_PCT;
}

/**
 * Maps each dot to one operational error type (or null when advice was correct).
 * Priority: miss sell > miss buy > wrong buy / wrong sell.
 */
export function classifyOperationalAdviceError(
  p: AdviceCalibrationPoint,
): AdviceOperationalErrorKind | null {
  if (isCriticalMissSellLoss(p)) return "missSell";
  if (isMissBuyRally(p)) return "missBuy";
  if (p.suggestedAction === "buy" && p.outcome === "bad") return "wrongBuy";
  if (p.suggestedAction === "sell" && p.outcome === "bad") return "wrongSell";
  return null;
}

/** @deprecated Quadrant keys replaced by {@link classifyOperationalAdviceError}. */
export function classifyBuySellErrorKind(
  signedErrorPct: number,
  action: "buy" | "sell",
): AdviceBuySellErrorKind {
  void signedErrorPct;
  return action === "buy" ? "wrongBuy" : "wrongSell";
}

/** Loss on invested capital (%), from negative move on the position. */
export function lossPctOfInvested(p: AdviceCalibrationPoint): number | null {
  const move = p.priceChangePct ?? p.pnlPct;
  if (move == null || !Number.isFinite(move) || move >= 0) return null;
  return Math.round(Math.abs(move) * 10) / 10;
}

/** Missed SELL (not an executed exit) followed by value loss on the position. */
export function isCriticalMissSellLoss(p: AdviceCalibrationPoint): boolean {
  if (p.suggestedAction !== "sell") return false;
  if (isSellExecuted(p)) return false;
  return lossPctOfInvested(p) != null;
}

/** Quartile marker size: 25 / 50 / 75 / 100 % of invested lost. */
export function classifyMissSellLossTier(lossPct: number): MissSellLossTier {
  const l = Math.min(100, Math.max(0, lossPct));
  if (l <= MISS_SELL_LOSS_TIER_THRESHOLDS[0]) return 1;
  if (l <= MISS_SELL_LOSS_TIER_THRESHOLDS[1]) return 2;
  if (l <= MISS_SELL_LOSS_TIER_THRESHOLDS[2]) return 3;
  return 4;
}

export function secondaryPaletteForErrorKind(kind: AdviceBuySellErrorKind): SecondaryErrorPalette {
  return kind === "missBuy" || kind === "wrongSell" ? "yellowBlue" : "blueYellow";
}

export function classifyAdviceErrorVisual(
  p: AdviceCalibrationPoint,
  _signedErrorPct: number,
): Pick<AdviceErrorDotPoint, "visualClass" | "missSellLossTier" | "secondaryPalette" | "errorKind"> {
  const op = classifyOperationalAdviceError(p);
  if (op === "missSell") {
    const lossPct = lossPctOfInvested(p)!;
    return {
      errorKind: undefined,
      visualClass: "criticalMissSell",
      missSellLossTier: classifyMissSellLossTier(lossPct),
    };
  }
  if (op === "wrongBuy" || op === "wrongSell" || op === "missBuy") {
    return {
      errorKind: op,
      visualClass: "secondary",
      secondaryPalette: secondaryPaletteForErrorKind(op),
    };
  }
  return { visualClass: "secondary" };
}

/** Y-axis for operational error chart — stock move after advice (%). */
export function operationalAdviceErrorMovePct(p: AdviceCalibrationPoint): number | null {
  return stockMovePct(p) ?? scatterYForAdvicePoint(p);
}

export function filterAdvicePointsByHorizon(
  points: AdviceCalibrationPoint[],
  horizon: AdviceErrorHorizon,
  asOfMs: number = Date.now(),
): AdviceCalibrationPoint[] {
  if (horizon === "all") return points;
  const windowMs = horizon === "24h" ? MS_24H : MS_7D;
  const cutoff = asOfMs - windowMs;
  return points.filter((p) => {
    const t = new Date(stableAdvicePointAt(p)).getTime();
    return Number.isFinite(t) && t >= cutoff && t <= asOfMs + 60_000;
  });
}

/** BUY/SELL operational errors only — stock move on Y. */
export function chartableBuySellAdvicePoints(
  points: AdviceCalibrationPoint[],
): { point: AdviceCalibrationPoint; signed: number }[] {
  const out: { point: AdviceCalibrationPoint; signed: number }[] = [];
  for (const p of filterAdvicePointsByActions(points, new Set(["buy", "sell"]))) {
    if (classifyOperationalAdviceError(p) == null) continue;
    const signed = operationalAdviceErrorMovePct(p);
    if (signed == null || !Number.isFinite(signed)) continue;
    out.push({ point: p, signed });
  }
  return out;
}

export type BuySellAdviceWindowSummary = {
  /** All scored BUY advice in the window (good + bad + pending). */
  totalBuy: number;
  /** All scored SELL advice in the window (good + bad + pending). */
  totalSell: number;
  /** Executed BUY (paper/deal/log). */
  executedBuy: number;
  /** Executed SELL (paper/deal/log). */
  executedSell: number;
  /** Operational errors plotted on the chart. */
  errorTotal: number;
  errorBuy: number;
  errorSell: number;
};

/** Headline counts for the BUY/SELL error chart footer. */
export function summarizeBuySellAdviceWindow(
  points: AdviceCalibrationPoint[],
  horizon: AdviceErrorHorizon,
  asOfMs: number = Date.now(),
): BuySellAdviceWindowSummary {
  const inWindow = filterAdvicePointsByHorizon(points, horizon, asOfMs);
  const buySell = filterAdvicePointsByActions(inWindow, new Set(["buy", "sell"]));
  const chartable = chartableBuySellAdvicePoints(inWindow);

  let totalBuy = 0;
  let totalSell = 0;
  let executedBuy = 0;
  let executedSell = 0;
  for (const p of buySell) {
    if (p.suggestedAction === "buy") {
      totalBuy += 1;
      if (isBuyExecuted(p)) executedBuy += 1;
    } else {
      totalSell += 1;
      if (isSellExecuted(p)) executedSell += 1;
    }
  }

  let errorBuy = 0;
  let errorSell = 0;
  for (const { point } of chartable) {
    if (point.suggestedAction === "buy") errorBuy += 1;
    else errorSell += 1;
  }

  return {
    totalBuy,
    totalSell,
    executedBuy,
    executedSell,
    errorTotal: chartable.length,
    errorBuy,
    errorSell,
  };
}

function jitterSpread(seed: string, span = 0.28): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  const unit = (((h % 1000) + 1000) % 1000) / 1000;
  return (unit - 0.5) * span;
}

function deterministicDayFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  const offset = Math.abs(h) % 120;
  const base = new Date("2025-01-06T12:00:00.000Z");
  base.setUTCDate(base.getUTCDate() + offset);
  return base.toISOString();
}

/** Never use wall-clock `now` — chart dots must not jump between re-renders. */
export function stableAdvicePointAt(p: AdviceCalibrationPoint): string {
  if (p.at && p.at.length >= 10) return p.at;
  if (p.source === "live" || p.id.startsWith("live|")) {
    return liveAdviceSessionAnchor();
  }
  return deterministicDayFromId(p.id);
}

export function filterAdvicePointsByActions(
  points: AdviceCalibrationPoint[],
  actions: ReadonlySet<AdviceActionKind>,
): AdviceCalibrationPoint[] {
  if (actions.size === 0) return [];
  return points.filter((p) => actions.has(p.suggestedAction));
}

export function scoredAdvicePoints(points: AdviceCalibrationPoint[]): AdviceCalibrationPoint[] {
  return points.filter(
    (p) =>
      (p.outcome === "good" || p.outcome === "bad") &&
      p.forecastErrorPct != null &&
      Number.isFinite(p.forecastErrorPct),
  );
}

/** Monday-start week key YYYY-MM-DD for grouping. */
export function weekStartKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const start = new Date(d);
  start.setHours(12, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start.toISOString().slice(0, 10);
}

export function weekLabel(key: string, lang: "it" | "en"): string {
  if (!key || key.length < 10) return key;
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  const monthsIt = [
    "gen", "feb", "mar", "apr", "mag", "giu",
    "lug", "ago", "set", "ott", "nov", "dic",
  ];
  const monthsEn = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const months = lang === "it" ? monthsIt : monthsEn;
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]}`;
}

function resolvePointAt(p: AdviceCalibrationPoint): string {
  return stableAdvicePointAt(p);
}

function aggregateRows(
  key: string,
  rows: AdviceCalibrationPoint[],
  lang: "it" | "en",
): AdviceErrorTimeBucket {
  let good = 0;
  let bad = 0;
  let absSum = 0;
  let signedSum = 0;
  for (const p of rows) {
    const err = p.forecastErrorPct!;
    if (p.outcome === "good") good += 1;
    else bad += 1;
    absSum += Math.abs(err);
    signedSum += err;
  }
  const scored = good + bad;
  return {
    key,
    label: weekLabel(key, lang),
    meanAbsErrorPct: scored > 0 ? Math.round((absSum / scored) * 10) / 10 : null,
    meanSignedErrorPct: scored > 0 ? Math.round((signedSum / scored) * 10) / 10 : null,
    successPct: scored > 0 ? Math.round((good / scored) * 1000) / 10 : null,
    scored,
    good,
    bad,
  };
}

export function buildAdviceErrorTimeBuckets(
  points: AdviceCalibrationPoint[],
  lang: "it" | "en",
): AdviceErrorTimeBucket[] {
  const scored = scoredAdvicePoints(points);
  const byWeek = new Map<string, AdviceCalibrationPoint[]>();
  for (const p of scored) {
    const wk = weekStartKey(resolvePointAt(p));
    const arr = byWeek.get(wk) ?? [];
    arr.push(p);
    byWeek.set(wk, arr);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => aggregateRows(key, rows, lang));
}

export function buildAdviceErrorByAction(
  points: AdviceCalibrationPoint[],
): AdviceErrorActionBucket[] {
  const scored = scoredAdvicePoints(points);
  const out: AdviceErrorActionBucket[] = [];
  for (const action of ADVICE_ACTIONS) {
    const rows = scored.filter((p) => p.suggestedAction === action);
    let good = 0;
    let bad = 0;
    let absSum = 0;
    let signedSum = 0;
    for (const p of rows) {
      const err = p.forecastErrorPct!;
      if (p.outcome === "good") good += 1;
      else bad += 1;
      absSum += Math.abs(err);
      signedSum += err;
    }
    const n = good + bad;
    out.push({
      action,
      meanAbsErrorPct: n > 0 ? Math.round((absSum / n) * 10) / 10 : null,
      meanSignedErrorPct: n > 0 ? Math.round((signedSum / n) * 10) / 10 : null,
      successPct: n > 0 ? Math.round((good / n) * 1000) / 10 : null,
      scored: n,
      good,
      bad,
    });
  }
  return out;
}

/** Individual scored outcomes as dot plot — X = week index with light jitter. */
export function buildAdviceErrorTimeDots(
  points: AdviceCalibrationPoint[],
  lang: "it" | "en",
): AdviceErrorDotPoint[] {
  const scored = scoredAdvicePoints(points);
  const weekKeys = [...new Set(scored.map((p) => weekStartKey(resolvePointAt(p))))].sort();
  const weekIndex = new Map(weekKeys.map((k, i) => [k, i]));
  return scored.map((p) => {
    const wk = weekStartKey(resolvePointAt(p));
    const idx = weekIndex.get(wk) ?? 0;
    const signed = p.forecastErrorPct!;
    const absErrorPct = Math.abs(signed);
    const rounded = Math.round(signed * 10) / 10;
    return {
      id: p.id,
      ticker: p.ticker,
      x: idx + jitterSpread(p.id),
      xLabel: weekLabel(wk, lang),
      y: rounded,
      signedErrorPct: rounded,
      absErrorPct: Math.round(absErrorPct * 10) / 10,
      outcome: p.outcome === "good" ? "good" : "bad",
      suggestedAction: p.suggestedAction,
    };
  });
}

/** BUY/SELL only — pooled strip (no time axis); horizon filters which points appear. */
export function buildAdviceBuySellHorizonDots(
  points: AdviceCalibrationPoint[],
  horizon: AdviceErrorHorizon,
  _lang: "it" | "en",
  asOfMs: number = Date.now(),
): AdviceErrorDotPoint[] {
  const inWindow = filterAdvicePointsByHorizon(points, horizon, asOfMs);
  const chartable = chartableBuySellAdvicePoints(inWindow);

  return chartable.map(({ point: p, signed }) => {
    const action = p.suggestedAction as "buy" | "sell";
    const rounded = Math.round(signed * 10) / 10;
    const visual = classifyAdviceErrorVisual(p, rounded);
    return {
      id: p.id,
      ticker: p.ticker,
      x: 0.5 + jitterSpread(p.id, 0.88),
      xLabel: p.ticker,
      y: rounded,
      signedErrorPct: rounded,
      absErrorPct: Math.round(Math.abs(signed) * 10) / 10,
      outcome: p.outcome === "good" ? "good" : "bad",
      suggestedAction: action,
      ...visual,
    };
  });
}

/** Individual scored outcomes as dot plot — X = action slot with light jitter. */
export function buildAdviceErrorActionDots(
  points: AdviceCalibrationPoint[],
): AdviceErrorDotPoint[] {
  const scored = scoredAdvicePoints(points);
  const actionIndex = new Map(ADVICE_ACTIONS.map((a, i) => [a, i]));
  return scored.map((p) => {
    const idx = actionIndex.get(p.suggestedAction) ?? 0;
    const signed = p.forecastErrorPct!;
    const absErrorPct = Math.abs(signed);
    const rounded = Math.round(signed * 10) / 10;
    return {
      id: p.id,
      ticker: p.ticker,
      x: idx + jitterSpread(`${p.id}|${p.suggestedAction}`),
      xLabel: p.suggestedAction.toUpperCase(),
      y: rounded,
      signedErrorPct: rounded,
      absErrorPct: Math.round(absErrorPct * 10) / 10,
      outcome: p.outcome === "good" ? "good" : "bad",
      suggestedAction: p.suggestedAction,
    };
  });
}
