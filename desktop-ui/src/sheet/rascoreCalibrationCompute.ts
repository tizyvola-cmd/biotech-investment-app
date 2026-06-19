import type { RascoreObservation } from "./rascoreSignalImpactView";
import { spearmanRho } from "./rascoreSignalImpactView";
import {
  RA_CALIB_CD_OFFSETS,
  RA_CALIB_LONG_TARGET_OFFSET,
  nextRaCalibCdOffset,
  priceUpFromChgPct,
  raCalibOffsetLabel,
} from "./rascoreCdHorizons";

export const RA_CALIB_INVEST_TARGET_PCT = 55;
import { formatCorrelationWithStars } from "./statSignificance";

const PRICE_MOVE_EPS_PP = 0.05;
const BIN_STARTS = [20, 30, 40, 50, 60, 70, 80] as const;
const THRESHOLDS = [20, 25, 30, 35, 40, 45, 50, 55] as const;

/** Min signals at a threshold before the success % is treated as operational (same as inverse table). */
export const RA_CALIB_MIN_SAMPLE_N = 4;
const QUARTILE_COUNT = 4;

export type RaCalibrationSignal = {
  raScore: number;
  ticker?: string;
  priceUp7d: boolean;
  priceUp24h: boolean;
  priceChgLongByOffset: Partial<Record<number, number>>;
  priceChgShortByOffset: Partial<Record<number, number>>;
  priceUpLongByOffset: Partial<Record<number, boolean>>;
  priceUpShortByOffset: Partial<Record<number, boolean>>;
  /** RA as-of CD anchor (v2); scatter uses per-offset score when present. */
  raScoreByOffset?: Partial<Record<number, number>>;
};

/** One simulation row at one pre/post-CD anchor — scatter dot (not quartile aggregate). */
export type RaCdReliabilityPoint = {
  offset: number;
  offsetLabel: string;
  /** Days vs CD + stable jitter so overlapping tickers remain visible. */
  x: number;
  /** % price change from anchor (long → T+7 or short → next knot). */
  y: number;
  raScore: number;
  ticker: string;
  /** 0–100: higher when outcome sits closer to the 55% invest target line. */
  reliability: number;
  priceUp: boolean;
  horizon: "long" | "short";
};

/** Cohort trend at each CD anchor (long horizon) — overlay on scatter. */
export type RaCdOffsetTrendPoint = {
  offset: number;
  offsetLabel: string;
  n: number;
  /** % companies with price-up from anchor → T+7. */
  pctPriceUp: number | null;
  /** % companies with Δ% ≥ 55% invest target. */
  pctAbove55: number | null;
  meanReliability: number | null;
  /** Spearman ρ(RA score, Δ% price) at this anchor. */
  rhoRaPrice: number | null;
};

export type RaBandStat = {
  label: string;
  binStart: number;
  pct7d: number | null;
  pct24h: number | null;
  n: number;
};

export type RaQuartileWindow = {
  quartile: 1 | 2 | 3 | 4;
  label: string;
  caption: string;
  raMin: number;
  raMax: number;
  /** Minimum RA score in this window — candidate invest floor. */
  raFloor: number;
  pct7d: number | null;
  pct24h: number | null;
  n: number;
};

export type RaThresholdPoint = {
  threshold: number;
  successRate: number | null;
  sampleN: number;
};

export type RaTemporalBestWindow = {
  offset: number;
  offsetLabel: string;
  quartileLabel: string;
  raRange: string;
  longPct: number;
  shortPct: number | null;
  n: number;
};

export type RaCalibrationKpis = {
  totalSignals: number;
  bestBand: string | null;
  bestBandPct: string | null;
  bestBandPct24h: string | null;
  bestTemporal: RaTemporalBestWindow | null;
  monotonicityRho: string;
  monotonicityRhoNum: number | null;
  investThreshold: string;
  investThresholdNum: number | null;
};

export type QuartileColorSet = {
  q1: string;
  q2: string;
  q3: string;
  q4: string;
};

const QUARTILE_CAPTIONS = ["bottom 25%", "25–50%", "50–75%", "top 25%"] as const;

function mapCdPriceUpFlags(
  chg: Partial<Record<number, number>>,
): Partial<Record<number, boolean>> {
  const out: Partial<Record<number, boolean>> = {};
  for (const [rawOff, pct] of Object.entries(chg)) {
    const off = Number(rawOff);
    const up = priceUpFromChgPct(pct);
    if (up != null) out[off] = up;
  }
  return out;
}

function stableScatterJitter(ticker: string, offset: number): number {
  let h = 0;
  const s = `${ticker}:${offset}`;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000) * 0.6 - 0.3;
}

/** Distance from 55% invest target — used as per-point reliability at each CD anchor. */
export function reliabilityFromInvestTarget(priceChgPct: number, target = RA_CALIB_INVEST_TARGET_PCT): number {
  return Math.round(Math.max(0, 100 - Math.abs(priceChgPct - target)) * 10) / 10;
}

export function buildRaCdReliabilityScatterPoints(
  signals: RaCalibrationSignal[],
  horizon: "long" | "short" = "long",
): RaCdReliabilityPoint[] {
  const points: RaCdReliabilityPoint[] = [];
  for (const sig of signals) {
    const chgMap = horizon === "long" ? sig.priceChgLongByOffset : sig.priceChgShortByOffset;
    const upMap = horizon === "long" ? sig.priceUpLongByOffset : sig.priceUpShortByOffset;
    const ticker = sig.ticker?.trim() || "—";
    for (const offset of RA_CALIB_CD_OFFSETS) {
      const y = chgMap[offset];
      if (y == null || !Number.isFinite(y)) continue;
      const priceUp = upMap[offset] ?? y > PRICE_MOVE_EPS_PP;
      points.push({
        offset,
        offsetLabel: raCalibOffsetLabel(offset),
        x: offset + stableScatterJitter(ticker, offset),
        y,
        raScore: sig.raScoreByOffset?.[offset] ?? sig.raScore,
        ticker,
        reliability: reliabilityFromInvestTarget(y),
        priceUp,
        horizon,
      });
    }
  }
  return points;
}

export function raScoreScatterColor(
  raScore: number,
  palette: { low: string; mid: string; high: string },
): string {
  if (raScore >= 55) return palette.high;
  if (raScore >= 40) return palette.mid;
  return palette.low;
}

export function buildRaCdOffsetTrend(longPoints: RaCdReliabilityPoint[]): RaCdOffsetTrendPoint[] {
  return RA_CALIB_CD_OFFSETS.map((offset) => {
    const at = longPoints.filter((p) => p.offset === offset);
    const n = at.length;
    if (n === 0) {
      return {
        offset,
        offsetLabel: raCalibOffsetLabel(offset),
        n: 0,
        pctPriceUp: null,
        pctAbove55: null,
        meanReliability: null,
        rhoRaPrice: null,
      };
    }
    const pctPriceUp =
      Math.round((at.filter((p) => p.priceUp).length / n) * 1000) / 10;
    const pctAbove55 =
      Math.round((at.filter((p) => p.y >= RA_CALIB_INVEST_TARGET_PCT).length / n) * 1000) / 10;
    const meanReliability =
      Math.round((at.reduce((sum, p) => sum + p.reliability, 0) / n) * 10) / 10;
    const rhoRaPrice =
      n >= 3 ? spearmanRho(at.map((p) => p.raScore), at.map((p) => p.y)) : null;
    return {
      offset,
      offsetLabel: raCalibOffsetLabel(offset),
      n,
      pctPriceUp,
      pctAbove55,
      meanReliability,
      rhoRaPrice,
    };
  });
}

export function pickBestRaCdOffsetTrend(
  trend: RaCdOffsetTrendPoint[],
): RaCdOffsetTrendPoint | null {
  let best: RaCdOffsetTrendPoint | null = null;
  for (const row of trend) {
    if (row.n < 2 || row.pctPriceUp == null) continue;
    if (!best || row.pctPriceUp > (best.pctPriceUp ?? -1)) best = row;
  }
  return best;
}

/** Y scale for RA scatter (% price chg) — headroom so points/lines are not clipped at 100%. */
export function scatterPriceChgYDomain(values: number[]): { min: number; max: number } {
  const ys = values.filter((v) => Number.isFinite(v));
  if (!ys.length) return { min: -40, max: 115 };
  const dataMin = Math.min(...ys);
  const dataMax = Math.max(...ys);
  let min = Math.min(dataMin, 0);
  let max = Math.max(dataMax, 55);
  const pad = Math.max((max - min) * 0.14, 12);
  min = Math.floor((min - pad) / 5) * 5;
  max = Math.ceil((max + pad) / 5) * 5;
  if (dataMax >= 88 && max <= 105) max = 115;
  min = Math.max(min, -40);
  max = Math.min(max, 220);
  return { min, max };
}

export function observationsToSignals(observations: RascoreObservation[]): RaCalibrationSignal[] {
  return observations.map((o) => ({
    raScore: o.score,
    ticker: o.ticker,
    priceUp7d: o.priceChg7d != null && o.priceChg7d > PRICE_MOVE_EPS_PP,
    priceUp24h: o.priceChg24h != null && o.priceChg24h > PRICE_MOVE_EPS_PP,
    priceChgLongByOffset: { ...o.cdPriceChgLongByOffset },
    priceChgShortByOffset: { ...o.cdPriceChgShortByOffset },
    priceUpLongByOffset: mapCdPriceUpFlags(o.cdPriceChgLongByOffset),
    priceUpShortByOffset: mapCdPriceUpFlags(o.cdPriceChgShortByOffset),
    raScoreByOffset: { ...o.raScoreByOffset },
  }));
}

export function bandLabel(binStart: number): string {
  return `${binStart}–${binStart + 10}`;
}

function pctGrowing(inBand: RaCalibrationSignal[], key: "priceUp7d" | "priceUp24h"): number | null {
  const n = inBand.length;
  if (n === 0) return null;
  return Math.round((inBand.filter((s) => s[key]).length / n) * 1000) / 10;
}

export function buildBandStats(signals: RaCalibrationSignal[]): RaBandStat[] {
  return BIN_STARTS.map((binStart) => {
    const inBand = signals.filter((s) => s.raScore >= binStart && s.raScore < binStart + 10);
    const n = inBand.length;
    if (n === 0) {
      return { label: bandLabel(binStart), binStart, pct7d: null, pct24h: null, n: 0 };
    }
    return {
      label: bandLabel(binStart),
      binStart,
      pct7d: pctGrowing(inBand, "priceUp7d"),
      pct24h: pctGrowing(inBand, "priceUp24h"),
      n,
    };
  });
}

/** Split signals into four equal-count RA windows (25% of cohort each). */
export function buildQuartileWindowStats(signals: RaCalibrationSignal[]): RaQuartileWindow[] {
  const n = signals.length;
  if (n === 0) return [];

  const sorted = [...signals].sort((a, b) => a.raScore - b.raScore);
  const cuts = [0, Math.ceil(n * 0.25), Math.ceil(n * 0.5), Math.ceil(n * 0.75), n];

  const windows: RaQuartileWindow[] = [];
  for (let q = 0; q < QUARTILE_COUNT; q += 1) {
    const slice = sorted.slice(cuts[q], cuts[q + 1]);
    const nIn = slice.length;
    const quartile = (q + 1) as RaQuartileWindow["quartile"];
    if (nIn === 0) {
      windows.push({
        quartile,
        label: `Q${quartile}`,
        caption: QUARTILE_CAPTIONS[q]!,
        raMin: 0,
        raMax: 0,
        raFloor: 0,
        pct7d: null,
        pct24h: null,
        n: 0,
      });
      continue;
    }
    const scores = slice.map((s) => s.raScore);
    const raMin = Math.min(...scores);
    const raMax = Math.max(...scores);
    windows.push({
      quartile,
      label: `Q${quartile}`,
      caption: QUARTILE_CAPTIONS[q]!,
      raMin,
      raMax,
      raFloor: raMin,
      pct7d: pctGrowing(slice, "priceUp7d"),
      pct24h: pctGrowing(slice, "priceUp24h"),
      n: nIn,
    });
  }
  return windows;
}

export type RaScoreQuartileBand = {
  quartile: 1 | 2 | 3 | 4;
  label: string;
  caption: string;
  raMin: number;
  raMax: number;
  n: number;
};

export type RaQuartile = RaScoreQuartileBand["quartile"];

export function buildRaScoreQuartileBands(signals: RaCalibrationSignal[]): RaScoreQuartileBand[] {
  return buildQuartileWindowStats(signals).map((w) => ({
    quartile: w.quartile,
    label: w.label,
    caption: w.caption,
    raMin: w.raMin,
    raMax: w.raMax,
    n: w.n,
  }));
}

/** Rank-based RA quartile per ticker (equal-count cohort split). */
export function buildTickerRaQuartileMap(signals: RaCalibrationSignal[]): Map<string, RaQuartile> {
  const n = signals.length;
  const map = new Map<string, RaQuartile>();
  if (n === 0) return map;
  const sorted = [...signals].sort((a, b) => a.raScore - b.raScore);
  const cuts = [0, Math.ceil(n * 0.25), Math.ceil(n * 0.5), Math.ceil(n * 0.75), n];
  for (let q = 0; q < QUARTILE_COUNT; q += 1) {
    const quartile = (q + 1) as RaQuartile;
    for (const s of sorted.slice(cuts[q], cuts[q + 1])) {
      const tk = s.ticker?.trim();
      if (tk) map.set(tk, quartile);
    }
  }
  return map;
}

export function scatterPointMatchesFocus(
  point: Pick<RaCdReliabilityPoint, "offset" | "ticker">,
  quartileByTicker: Map<string, RaQuartile>,
  focusAnchor: number | null,
  focusQuartile: RaQuartile | null,
): boolean {
  if (focusAnchor != null && point.offset !== focusAnchor) return false;
  if (focusQuartile != null) {
    const q = quartileByTicker.get(point.ticker);
    if (q !== focusQuartile) return false;
  }
  return true;
}

export function quartileBandColor(
  quartile: RaQuartile,
  css: { q1: string; q2: string; q3: string; q4: string },
): string {
  switch (quartile) {
    case 1:
      return css.q1;
    case 2:
      return css.q2;
    case 3:
      return css.q3;
    case 4:
      return css.q4;
    default:
      return css.q1;
  }
}

export function formatQuartileWindowLabel(w: RaQuartileWindow): string {
  if (w.n === 0) return w.label;
  return `${w.label} (RA ${w.raMin}–${w.raMax})`;
}

function pctPriceUpAtCdOffset(
  slice: RaCalibrationSignal[],
  offset: number,
  horizon: "long" | "short",
): number | null {
  const upKey = horizon === "long" ? "priceUpLongByOffset" : "priceUpShortByOffset";
  const eligible = slice.filter((s) => s[upKey][offset] != null);
  if (!eligible.length) return null;
  const n = eligible.filter((s) => s[upKey][offset]).length;
  return Math.round((n / eligible.length) * 1000) / 10;
}

/** Quartile stats for one CD anchor (long → T+7, short → next knot). */
export function buildQuartileWindowStatsAtCdOffset(
  signals: RaCalibrationSignal[],
  offset: number,
): Array<RaQuartileWindow & { pctLong: number | null; pctShort: number | null }> {
  const n = signals.length;
  if (n === 0) return [];

  const sorted = [...signals].sort((a, b) => a.raScore - b.raScore);
  const cuts = [0, Math.ceil(n * 0.25), Math.ceil(n * 0.5), Math.ceil(n * 0.75), n];

  const windows: Array<RaQuartileWindow & { pctLong: number | null; pctShort: number | null }> = [];
  for (let q = 0; q < QUARTILE_COUNT; q += 1) {
    const slice = sorted.slice(cuts[q], cuts[q + 1]);
    const nIn = slice.length;
    const quartile = (q + 1) as RaQuartileWindow["quartile"];
    if (nIn === 0) {
      windows.push({
        quartile,
        label: `Q${quartile}`,
        caption: QUARTILE_CAPTIONS[q]!,
        raMin: 0,
        raMax: 0,
        raFloor: 0,
        pct7d: null,
        pct24h: null,
        pctLong: null,
        pctShort: null,
        n: 0,
      });
      continue;
    }
    const scores = slice.map((s) => s.raScore);
    windows.push({
      quartile,
      label: `Q${quartile}`,
      caption: QUARTILE_CAPTIONS[q]!,
      raMin: Math.min(...scores),
      raMax: Math.max(...scores),
      raFloor: Math.min(...scores),
      pct7d: null,
      pct24h: null,
      pctLong: pctPriceUpAtCdOffset(slice, offset, "long"),
      pctShort: pctPriceUpAtCdOffset(slice, offset, "short"),
      n: nIn,
    });
  }
  return windows;
}

export function computeBestRaTemporalWindow(
  signals: RaCalibrationSignal[],
): RaTemporalBestWindow | null {
  let best: RaTemporalBestWindow | null = null;
  let bestPct = -1;

  for (const offset of RA_CALIB_CD_OFFSETS) {
    const windows = buildQuartileWindowStatsAtCdOffset(signals, offset);
    for (const w of windows) {
      if (w.n < 2 || w.pctLong == null) continue;
      if (w.pctLong > bestPct) {
        bestPct = w.pctLong;
        best = {
          offset,
          offsetLabel: raCalibOffsetLabel(offset),
          quartileLabel: w.label,
          raRange: w.n > 0 ? `RA ${w.raMin}–${w.raMax}` : w.label,
          longPct: w.pctLong,
          shortPct: w.pctShort,
          n: w.n,
        };
      }
    }
  }
  return best;
}

export function formatRaTemporalBestValue(best: RaTemporalBestWindow): string {
  return `${best.quartileLabel} @ ${best.offsetLabel}`;
}

export function formatRaTemporalLongTarget(): string {
  return raCalibOffsetLabel(RA_CALIB_LONG_TARGET_OFFSET);
}

export function formatRaTemporalShortTarget(offset: number): string | null {
  const next = nextRaCalibCdOffset(offset);
  return next != null ? raCalibOffsetLabel(next) : null;
}

export function quartileWindowColor(quartile: RaQuartileWindow["quartile"], css: QuartileColorSet): string {
  switch (quartile) {
    case 1:
      return css.q1;
    case 2:
      return css.q2;
    case 3:
      return css.q3;
    case 4:
      return css.q4;
    default:
      return css.q1;
  }
}

export function buildThresholdCurve(signals: RaCalibrationSignal[]): RaThresholdPoint[] {
  return THRESHOLDS.map((threshold) => {
    const filtered = signals.filter((s) => s.raScore >= threshold);
    const sampleN = filtered.length;
    if (sampleN === 0) return { threshold, successRate: null, sampleN: 0 };
    const successRate =
      Math.round((filtered.filter((s) => s.priceUp7d).length / sampleN) * 1000) / 10;
    return { threshold, successRate, sampleN };
  });
}

/** Threshold curve at a CD anchor (long → T+7), using RA as-of that anchor when available. */
export function buildThresholdCurveAtOffset(
  signals: RaCalibrationSignal[],
  offset: number,
): RaThresholdPoint[] {
  const atAnchor = signals.filter((s) => {
    const chg = s.priceChgLongByOffset[offset];
    return chg != null && Number.isFinite(chg);
  });
  return THRESHOLDS.map((threshold) => {
    const filtered = atAnchor.filter((s) => {
      const ra = s.raScoreByOffset?.[offset] ?? s.raScore;
      return ra >= threshold;
    });
    const sampleN = filtered.length;
    if (sampleN === 0) return { threshold, successRate: null, sampleN: 0 };
    const upN = filtered.filter((s) => s.priceUpLongByOffset[offset] === true).length;
    const successRate = Math.round((upN / sampleN) * 1000) / 10;
    return { threshold, successRate, sampleN };
  });
}

/** Pre-CD anchors shown in threshold heatmap (matches inverse pattern chips). */
export const RA_THRESHOLD_HEATMAP_OFFSETS = [-60, -30, -10, -7] as const;

export type RaThresholdHeatmapCell = {
  offset: number;
  offsetLabel: string;
  threshold: number;
  successRate: number | null;
  sampleN: number;
  reliable: boolean;
  operational: boolean;
};

export type RaThresholdHeatmap = {
  offsets: readonly number[];
  thresholds: readonly number[];
  cells: RaThresholdHeatmapCell[];
};

export function buildRaThresholdHeatmap(
  signals: RaCalibrationSignal[],
  opts?: { offsets?: readonly number[]; thresholds?: readonly number[] },
): RaThresholdHeatmap {
  const offsets = opts?.offsets ?? RA_THRESHOLD_HEATMAP_OFFSETS;
  const thresholds = opts?.thresholds ?? THRESHOLDS;
  const cells: RaThresholdHeatmapCell[] = [];
  for (const offset of offsets) {
    const curve = buildThresholdCurveAtOffset(signals, offset);
    const byThreshold = new Map(curve.map((p) => [p.threshold, p]));
    const offsetLabel = raCalibOffsetLabel(offset);
    for (const threshold of thresholds) {
      const pt = byThreshold.get(threshold) ?? {
        threshold,
        successRate: null,
        sampleN: 0,
      };
      const reliable = pt.sampleN >= RA_CALIB_MIN_SAMPLE_N;
      const operational =
        reliable && pt.successRate != null && pt.successRate >= 55;
      cells.push({
        offset,
        offsetLabel,
        threshold: pt.threshold,
        successRate: pt.successRate,
        sampleN: pt.sampleN,
        reliable,
        operational,
      });
    }
  }
  return { offsets, thresholds, cells };
}

export function countAnchorPriceGroups(
  signals: RaCalibrationSignal[],
  offset: number,
): { total: number; upN: number; downN: number; flatN: number } {
  let upN = 0;
  let downN = 0;
  let flatN = 0;
  for (const s of signals) {
    const chg = s.priceChgLongByOffset[offset];
    if (chg == null || !Number.isFinite(chg)) continue;
    if (chg > PRICE_MOVE_EPS_PP) upN += 1;
    else if (chg < -PRICE_MOVE_EPS_PP) downN += 1;
    else flatN += 1;
  }
  return { total: upN + downN + flatN, upN, downN, flatN };
}

/** Same rule as inverse pattern table: ≥4 tickers classified ↑ or ↓ at anchor. */
export function anchorAnalysisReady(
  signals: RaCalibrationSignal[],
  offset: number,
): boolean {
  const { upN, downN } = countAnchorPriceGroups(signals, offset);
  return upN + downN >= 4;
}

export function computeCalibrationKpis(
  signals: RaCalibrationSignal[],
  weeklyRho: Array<{ week: string; rho: number | null; rhoN?: number | null }>,
): RaCalibrationKpis {
  const totalSignals = signals.length;
  const windows = buildQuartileWindowStats(signals);

  let bestBand: string | null = null;
  let bestBandPct: string | null = null;
  let bestBandPct24h: string | null = null;
  let bestPct = -1;
  for (const w of windows) {
    if (w.n < 2 || w.pct7d == null) continue;
    if (w.pct7d > bestPct) {
      bestPct = w.pct7d;
      bestBand = formatQuartileWindowLabel(w);
      bestBandPct = `${w.pct7d}%`;
      bestBandPct24h = w.pct24h != null ? `${w.pct24h}%` : null;
    }
  }

  const rhoWeeks = weeklyRho.filter((w) => w.rho != null);
  const lastRhoWeek = rhoWeeks.length > 0 ? rhoWeeks[rhoWeeks.length - 1]! : null;
  const lastRho = lastRhoWeek?.rho ?? null;
  const rhoN = lastRhoWeek?.rhoN ?? null;
  const monotonicityRho =
    lastRho != null ? formatCorrelationWithStars(lastRho, rhoN) : "n/d";

  let investThresholdNum: number | null = null;
  for (const w of [...windows].reverse()) {
    if (w.n >= 3 && w.pct7d != null && w.pct7d >= 55) {
      investThresholdNum = w.raFloor;
      break;
    }
  }
  const investThreshold =
    investThresholdNum != null ? `RA≥${investThresholdNum}` : "n/d";

  const bestTemporal = computeBestRaTemporalWindow(signals);

  return {
    totalSignals,
    bestBand,
    bestBandPct,
    bestBandPct24h,
    bestTemporal,
    monotonicityRho,
    monotonicityRhoNum: lastRho,
    investThreshold,
    investThresholdNum,
  };
}

export type RaConfidenceCheckKey = "rho" | "bands" | "priceup" | "threshold" | "trend";

export type RaConfidenceCheck = {
  key: RaConfidenceCheckKey;
  dotColor: "green" | "amber" | "red";
  met: boolean;
  bandsWithN2: number;
  investThreshold: string;
  monotonicityRho: string;
  trendPending: boolean;
};

export function computeConfidenceChecks(
  signals: RaCalibrationSignal[],
  weeklyRho: Array<{ week: string; rho: number | null }>,
  kpis: RaCalibrationKpis,
): RaConfidenceCheck[] {
  const windows = buildQuartileWindowStats(signals);
  const bandsWithN2 = windows.filter((w) => w.n >= 2).length;
  const bandsAbove55 = windows.filter((w) => w.pct7d != null && w.pct7d >= 55).length;

  const rhoMet = kpis.monotonicityRhoNum != null && kpis.monotonicityRhoNum > 0.6;
  const bandCoverageMet = bandsWithN2 >= 3;
  const priceUpMet = bandsAbove55 >= 1;
  const thresholdMet = kpis.investThresholdNum != null;

  const rhoVals = weeklyRho.map((w) => w.rho).filter((r): r is number => r != null);
  let trendMet = false;
  let trendPending = rhoVals.length < 3;
  if (rhoVals.length >= 3) {
    const recent = rhoVals.slice(-3);
    trendMet = recent[2]! > recent[0]!;
    trendPending = false;
  }

  return [
    {
      key: "rho",
      dotColor: "green",
      met: rhoMet,
      bandsWithN2,
      investThreshold: kpis.investThreshold,
      monotonicityRho: kpis.monotonicityRho,
      trendPending,
    },
    {
      key: "bands",
      dotColor: "amber",
      met: bandCoverageMet,
      bandsWithN2,
      investThreshold: kpis.investThreshold,
      monotonicityRho: kpis.monotonicityRho,
      trendPending,
    },
    {
      key: "priceup",
      dotColor: "red",
      met: priceUpMet,
      bandsWithN2,
      investThreshold: kpis.investThreshold,
      monotonicityRho: kpis.monotonicityRho,
      trendPending,
    },
    {
      key: "threshold",
      dotColor: "red",
      met: thresholdMet,
      bandsWithN2,
      investThreshold: kpis.investThreshold,
      monotonicityRho: kpis.monotonicityRho,
      trendPending,
    },
    {
      key: "trend",
      dotColor: "amber",
      met: trendMet,
      bandsWithN2,
      investThreshold: kpis.investThreshold,
      monotonicityRho: kpis.monotonicityRho,
      trendPending,
    },
  ];
}

export function computeRadarScores(
  signals: RaCalibrationSignal[],
  weeklyRho: Array<{ week: string; rho: number | null }>,
  kpis: RaCalibrationKpis,
): number[] {
  const windows = buildQuartileWindowStats(signals);
  const bandsWithN2 = windows.filter((w) => w.n >= 2).length;
  const bandsAbove55 = windows.filter((w) => w.pct7d != null && w.pct7d >= 55).length;

  const rhoScore =
    kpis.monotonicityRhoNum != null && kpis.monotonicityRhoNum > 0
      ? Math.min(100, kpis.monotonicityRhoNum * 100)
      : 0;
  const sampleScore = Math.min(100, kpis.totalSignals / 0.5);
  const coverageScore = (bandsWithN2 / QUARTILE_COUNT) * 100;
  const priceUpScore = (bandsAbove55 / QUARTILE_COUNT) * 100;

  const rhoVals = weeklyRho.map((w) => w.rho).filter((r): r is number => r != null);
  let trendScore = 30;
  if (rhoVals.length < 3) trendScore = 10;
  else if (rhoVals.slice(-3)[2]! > rhoVals.slice(-3)[0]!) trendScore = 80;

  return [
    Math.round(rhoScore),
    Math.round(sampleScore),
    Math.round(coverageScore),
    Math.round(priceUpScore),
    trendScore,
  ];
}

export const RADAR_TARGET = [60, 70, 70, 55, 60];
