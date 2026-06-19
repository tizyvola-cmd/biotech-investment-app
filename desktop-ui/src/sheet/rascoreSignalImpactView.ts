import type { SdsRow } from "../api/supernova";
import { simulationRowSeriesKey, chartPointsMapFromBundle } from "../data/simulationCharts";
import type { ChartBundle, ChartPoint, SheetTable } from "../types";
import { buildMigSolidityByKey } from "./entrySolidityMig";
import { normalizedRowKey, reconcileInvestSimInputs } from "./investSimKeys";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { tradeCalibThreshold } from "./investmentTradeCalib";
import { buildCdHorizonPriceChanges, RA_CALIB_CD_OFFSETS } from "./rascoreCdHorizons";
import { buildRaScoresByAnchor } from "./rascoreAnchorSolidity";
import { resolvePriceVariationHorizons } from "./priceVariationHorizons";
import {
  resolveSimulationEntrySolidity,
  simulationSolidityVisible,
} from "./simulationEntrySolidity";
import { rowHasActivePortfolio, computeSimulationPosition } from "./simulationPosition";
import { buildSdsByTicker, type SdsGateInfo } from "./sdsTopOppGate";
import { pickSignalFromSimRow } from "./top2FromSimulation";

const BIN_WIDTH = 10;
const MIN_BIN_N = 1;
const MIN_BIN_N_FOR_THRESHOLD = 2;
/** |Δ%| ≤ soglia → flat (non conta né crescita né calo). */
const PRICE_MOVE_EPS_PP = 0.05;
const GROW_INVEST_MIN_PCT = 55;
const DECLINE_DIVEST_MIN_PCT = 55;

export type RascoreObservation = {
  score: number;
  ticker: string;
  rowKey: string;
  hasPosition: boolean;
  priceChg24h: number | null;
  priceChg7d: number | null;
  /** % price change from CD anchor → T+7 (long). */
  cdPriceChgLongByOffset: Partial<Record<number, number>>;
  /** % price change from CD anchor → next anchor (short). */
  cdPriceChgShortByOffset: Partial<Record<number, number>>;
  /** RA composito as-of each CD anchor (curve+timing at T−X). */
  raScoreByOffset: Partial<Record<number, number>>;
  pnlPct: number | null;
};

export type RascoreBinRow = {
  binLabel: string;
  scoreMid: number;
  scoreMin: number;
  scoreMax: number;
  n: number;
  n24h: number;
  n7d: number;
  nInvest: number;
  grow24hPct: number | null;
  grow7dPct: number | null;
  decline24hPct: number | null;
  decline7dPct: number | null;
  /** % righe in portafoglio con P&L MTM > 0. */
  winInvestPct: number | null;
  /** P&L MTM medio % sulle righe in portafoglio con P&L disponibile. */
  meanPnlPct: number | null;
};

export type RascoreThresholdHints = {
  investMinScore: number | null;
  divestBelowScore: number | null;
  peakSuccessBinMid: number | null;
  peakGrow7dPct: number | null;
};

/** Quanto la curva «RA ↑ → successo ↑» è rispettata nella coorte (QC, non training). */
export type RascoreCalibrationQuality = {
  spearmanGrow7d: number | null;
  nBinsUsed: number;
  tier: "strong" | "weak" | "inverted" | "insufficient";
};

export type RascoreCohortSummary = {
  scoreMin: number | null;
  scoreMax: number | null;
  /** Nessun segnale con RA ≥ 60 nella coorte storica. */
  missingHighRa: boolean;
};

export type RascoreReliabilityAnswer = {
  /** Finestra primaria per «successo = prezzo su». */
  primaryWindow: "7d";
  /** RA minimo con ≥55% prezzo su a 7g (regola invest), se esiste. */
  investMinScore: number | null;
  investGrow7dPct: number | null;
  /** Fascia con la quota più alta di prezzo su a 7g. */
  bestBandLabel: string | null;
  bestGrow7dPct: number | null;
  /** RA sotto cui ≥55% prezzo giù a 7g (hint divest), se esiste. */
  divestBelowScore: number | null;
};

export type RascoreSignalImpactView = {
  bins: RascoreBinRow[];
  observations: RascoreObservation[];
  hasData: boolean;
  nTotal: number;
  nWith24h: number;
  nWith7d: number;
  nWithPosition: number;
  thresholds: RascoreThresholdHints;
  calibrationQuality: RascoreCalibrationQuality;
  cohort: RascoreCohortSummary;
  reliability: RascoreReliabilityAnswer;
  calibForteMin: number;
  calibWatchMin: number;
};

/** Ultima fascia mostrata sul grafico (include slot vuoti fino a 80–90). */
export const RAScore_CHART_BIN_MAX_IDX = 8;
export const MIN_WIN_RATE_INVEST_N = 2;

function asFinite(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function pctGrowing(values: number[]): number | null {
  if (!values.length) return null;
  const n = values.filter((v) => v > PRICE_MOVE_EPS_PP).length;
  return Math.round((n / values.length) * 1000) / 10;
}

function pctDeclining(values: number[]): number | null {
  if (!values.length) return null;
  const n = values.filter((v) => v < -PRICE_MOVE_EPS_PP).length;
  return Math.round((n / values.length) * 1000) / 10;
}

function scoreBinIndex(score: number): number {
  const clamped = Math.max(0, Math.min(99.999, score));
  return Math.floor(clamped / BIN_WIDTH);
}

function binMeta(idx: number): Pick<RascoreBinRow, "binLabel" | "scoreMid" | "scoreMin" | "scoreMax"> {
  const scoreMin = idx * BIN_WIDTH;
  const scoreMax = scoreMin + BIN_WIDTH;
  return {
    binLabel: `${scoreMin}–${scoreMax}`,
    scoreMid: scoreMin + BIN_WIDTH / 2,
    scoreMin,
    scoreMax,
  };
}

function pctWinning(values: number[]): number | null {
  if (!values.length) return null;
  const n = values.filter((v) => v > PRICE_MOVE_EPS_PP).length;
  return Math.round((n / values.length) * 1000) / 10;
}

function meanOf(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
}

export function rascoreChartHasPlottableSeries(bins: RascoreBinRow[]): boolean {
  return bins.some((b) =>
    [b.grow7dPct, b.winInvestPct, b.meanPnlPct].some((v) => v != null && Number.isFinite(v)),
  );
}

/** Y fisso 0–100%: quota «prezzo su» (non P&L € che può eccedere 100). */
export function computeRascoreChartYDomain(): [number, number] {
  return [0, 100];
}

export function rascoreBubbleRadius(n: number): number {
  if (n <= 0) return 0;
  return Math.min(28, Math.max(10, Math.round(Math.sqrt(n) * 9 + 6)));
}

/** Fasce RA per asse X: dati popolati + slot vuoti (n/a) fino a 80–90. */
export function rascoreChartSlots(bins: RascoreBinRow[]): RascoreBinRow[] {
  const byMin = new Map(bins.map((b) => [b.scoreMin, b]));
  const populated = bins.filter((b) => b.n > 0);
  if (!populated.length) return [];

  const minIdx = Math.min(...populated.map((b) => Math.floor(b.scoreMin / BIN_WIDTH)));
  const maxIdx = Math.max(
    RAScore_CHART_BIN_MAX_IDX,
    ...populated.map((b) => Math.floor(b.scoreMin / BIN_WIDTH)),
  );
  const slots: RascoreBinRow[] = [];
  for (let idx = minIdx; idx <= maxIdx; idx += 1) {
    const existing = byMin.get(idx * BIN_WIDTH);
    if (existing) {
      slots.push(existing);
      continue;
    }
    slots.push({
      ...binMeta(idx),
      n: 0,
      n24h: 0,
      n7d: 0,
      nInvest: 0,
      grow24hPct: null,
      grow7dPct: null,
      decline24hPct: null,
      decline7dPct: null,
      winInvestPct: null,
      meanPnlPct: null,
    });
  }
  return slots;
}

function buildCohortSummary(bins: RascoreBinRow[]): RascoreCohortSummary {
  const populated = bins.filter((b) => b.n > 0);
  if (!populated.length) {
    return { scoreMin: null, scoreMax: null, missingHighRa: true };
  }
  const scoreMin = Math.min(...populated.map((b) => b.scoreMin));
  const scoreMax = Math.max(...populated.map((b) => b.scoreMax));
  return {
    scoreMin,
    scoreMax,
    missingHighRa: !populated.some((b) => b.scoreMin >= 60),
  };
}

function buildReliabilityAnswer(
  bins: RascoreBinRow[],
  thresholds: RascoreThresholdHints,
): RascoreReliabilityAnswer {
  const eligible = bins.filter((b) => b.n7d >= MIN_BIN_N_FOR_THRESHOLD && b.grow7dPct != null);
  let best: RascoreBinRow | null = null;
  for (const b of eligible) {
    if (!best || (b.grow7dPct ?? 0) > (best.grow7dPct ?? 0)) best = b;
  }
  const investBand = thresholds.investMinScore != null
    ? bins.find((b) => b.scoreMin === thresholds.investMinScore)
    : null;

  return {
    primaryWindow: "7d",
    investMinScore: thresholds.investMinScore,
    investGrow7dPct: investBand?.grow7dPct ?? null,
    bestBandLabel: best?.binLabel ?? null,
    bestGrow7dPct: best?.grow7dPct ?? null,
    divestBelowScore: thresholds.divestBelowScore,
  };
}

export function binLabelForScore(bins: RascoreBinRow[], score: number): string | null {
  const hit = bins.find((b) => b.scoreMin <= score && b.scoreMax >= score);
  return hit?.binLabel ?? null;
}

function computeRascoreForRow(
  simRow: Record<string, unknown>,
  mergedInputs: InvestSimInputs,
  chartPts: ChartPoint[] | null,
  history: InvestSimHistoryPoint[] | null,
  sdsByTicker: Map<string, SdsGateInfo>,
  migByKey: ReturnType<typeof buildMigSolidityByKey>,
  lang: "it" | "en",
): number | null {
  const pick = pickSignalFromSimRow(simRow, mergedInputs, chartPts, history);
  if (!pick) return null;
  const sol = resolveSimulationEntrySolidity(
    pick,
    { sdsByTicker, migByKey },
    lang,
    "rascore",
  );
  if (!simulationSolidityVisible(sol)) return null;
  return asFinite(sol.composite.total);
}

function rankValues(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j += 1;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[indexed[k]!.i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

/** Spearman ρ tra fascia RA (X) e % prezzo su 7g (Y). ρ→1 = curva crescente come atteso. */
export function spearmanRho(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const rx = rankValues(xs);
  const ry = rankValues(ys);
  const n = xs.length;
  let sumD2 = 0;
  for (let i = 0; i < n; i += 1) sumD2 += (rx[i]! - ry[i]!) ** 2;
  const denom = n * (n * n - 1);
  if (denom <= 0) return null;
  return Math.round((1 - (6 * sumD2) / denom) * 1000) / 1000;
}

export function computeRascoreCalibrationQuality(bins: RascoreBinRow[]): RascoreCalibrationQuality {
  const eligible = bins.filter((b) => b.grow7dPct != null && b.n7d >= 2);
  if (eligible.length < 3) {
    return { spearmanGrow7d: null, nBinsUsed: eligible.length, tier: "insufficient" };
  }
  const rho = spearmanRho(
    eligible.map((b) => b.scoreMid),
    eligible.map((b) => b.grow7dPct as number),
  );
  if (rho == null) {
    return { spearmanGrow7d: null, nBinsUsed: eligible.length, tier: "insufficient" };
  }
  let tier: RascoreCalibrationQuality["tier"] = "weak";
  if (rho >= 0.45) tier = "strong";
  else if (rho < -0.15) tier = "inverted";
  return { spearmanGrow7d: rho, nBinsUsed: eligible.length, tier };
}

function buildThresholdHints(bins: RascoreBinRow[]): RascoreThresholdHints {
  const eligible = bins.filter((b) => b.n7d >= MIN_BIN_N_FOR_THRESHOLD);

  let peak: RascoreBinRow | null = null;
  for (const b of eligible) {
    if (b.grow7dPct == null) continue;
    if (!peak || (b.grow7dPct ?? 0) > (peak.grow7dPct ?? 0)) peak = b;
  }

  let investMinScore: number | null = null;
  for (const b of eligible) {
    if (b.grow7dPct != null && b.grow7dPct >= GROW_INVEST_MIN_PCT) {
      investMinScore = b.scoreMin;
      break;
    }
  }

  let divestBelowScore: number | null = null;
  const declineBins = eligible.filter(
    (b) => b.decline7dPct != null && b.decline7dPct >= DECLINE_DIVEST_MIN_PCT,
  );
  if (declineBins.length) {
    divestBelowScore = Math.max(...declineBins.map((b) => b.scoreMax));
  }

  return {
    investMinScore,
    divestBelowScore,
    peakSuccessBinMid: peak?.scoreMid ?? null,
    peakGrow7dPct: peak?.grow7dPct ?? null,
  };
}

export function buildRascoreObservations(args: {
  simTable: SheetTable | null | undefined;
  chartBundle: ChartBundle | null | undefined;
  sdsRows: SdsRow[] | null | undefined;
  inputs: InvestSimInputs;
  history?: InvestSimHistoryPoint[] | null;
  lang?: "it" | "en";
}): RascoreObservation[] {
  const {
    simTable,
    chartBundle,
    sdsRows,
    inputs,
    history = null,
    lang = "it",
  } = args;

  const rows = simTable?.rows ?? [];
  if (!rows.length) return [];

  const merged = reconcileInvestSimInputs(inputs, rows);
  const pointsByKey = chartPointsMapFromBundle(chartBundle);
  const sdsByTicker = buildSdsByTicker(sdsRows);
  const migByKey = buildMigSolidityByKey(simTable ?? null, chartBundle, sdsRows);

  const seenKeys = new Set<string>();
  const out: RascoreObservation[] = [];

  for (const simRow of rows) {
    const ticker = String(simRow.Ticker ?? "").trim().toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;

    const cd = simRow["Completion Date"];
    const key = normalizedRowKey(ticker, cd);
    if (seenKeys.has(key)) continue;

    const seriesKey = simulationRowSeriesKey(simRow);
    const chartPts = seriesKey ? pointsByKey.get(seriesKey) ?? null : null;

    const pick = pickSignalFromSimRow(simRow, merged, chartPts, history);
    if (!pick) continue;

    const score = computeRascoreForRow(simRow, merged, chartPts, history, sdsByTicker, migByKey, lang);
    if (score == null) continue;

    seenKeys.add(key);
    const seriesMeta = seriesKey && chartBundle?.series?.[seriesKey] ? chartBundle.series[seriesKey] : null;
    const { d1, d7 } = resolvePriceVariationHorizons(simRow, chartPts, seriesMeta);
    const { long: cdPriceChgLongByOffset, short: cdPriceChgShortByOffset } =
      buildCdHorizonPriceChanges(simRow, chartPts);
    const raScoreByOffset = buildRaScoresByAnchor({
      simRow,
      mergedInputs: merged,
      chartPts,
      history,
      anchors: RA_CALIB_CD_OFFSETS,
      opts: { sdsByTicker, migByKey },
      lang,
    });
    const pos = computeSimulationPosition(simRow, merged);
    const pnlPct = pos && !pos.pnlUnavailable ? pos.pnlPct : null;

    out.push({
      score,
      ticker,
      rowKey: key,
      hasPosition: rowHasActivePortfolio(simRow, merged),
      priceChg24h: d1,
      priceChg7d: d7,
      cdPriceChgLongByOffset,
      cdPriceChgShortByOffset,
      raScoreByOffset,
      pnlPct,
    });
  }

  return out;
}

export function buildRascoreSignalImpactView(
  observations: RascoreObservation[],
): RascoreSignalImpactView {
  const nWith24h = observations.filter((o) => o.priceChg24h != null).length;
  const nWith7d = observations.filter((o) => o.priceChg7d != null).length;
  const nWithPosition = observations.filter((o) => o.hasPosition).length;

  const binCount = Math.ceil(100 / BIN_WIDTH);
  const bins: RascoreBinRow[] = [];

  for (let idx = 0; idx < binCount; idx += 1) {
    const meta = binMeta(idx);
    const inBin = observations.filter((o) => scoreBinIndex(o.score) === idx);

    const chg24 = inBin
      .map((o) => o.priceChg24h)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const chg7 = inBin
      .map((o) => o.priceChg7d)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const invested = inBin.filter((o) => o.hasPosition);
    const pnlVals = invested
      .map((o) => o.pnlPct)
      .filter((v): v is number => v != null && Number.isFinite(v));

    bins.push({
      ...meta,
      n: inBin.length,
      n24h: chg24.length,
      n7d: chg7.length,
      nInvest: invested.length,
      grow24hPct: pctGrowing(chg24),
      grow7dPct: pctGrowing(chg7),
      decline24hPct: pctDeclining(chg24),
      decline7dPct: pctDeclining(chg7),
      winInvestPct: pctWinning(pnlVals),
      meanPnlPct: meanOf(pnlVals),
    });
  }

  const hasData =
    observations.length >= MIN_BIN_N &&
    observations.some((o) => o.priceChg24h != null || o.priceChg7d != null);

  const thresholds = buildThresholdHints(bins);

  return {
    bins,
    observations,
    hasData,
    nTotal: observations.length,
    nWith24h,
    nWith7d,
    nWithPosition,
    thresholds,
    calibrationQuality: computeRascoreCalibrationQuality(bins),
    cohort: buildCohortSummary(bins),
    reliability: buildReliabilityAnswer(bins, thresholds),
    calibForteMin: tradeCalibThreshold("score_forte_min"),
    calibWatchMin: tradeCalibThreshold("score_watch_min"),
  };
}
