/**
 * Continuous feature → loss regression.
 *
 * Per ogni feature continuo usato per valutare un'opportunità (P(plan) at
 * entry, slope 20d at entry, days to CD at entry, SDS score) e per ogni
 * trade chiuso, calcoliamo:
 *
 *   - mean del feature nei TRADE CHE HANNO PERSO  (meanLoss)
 *   - mean del feature nei TRADE CHE HANNO VINTO  (meanWin)
 *   - correlazione di Pearson(feature, pnl_pct)   (corrWithPnl)
 *   - slope OLS di pnl_pct ~ β·featureStd          (regressionSlopeStdized)
 *
 * Il segnale operativo principale è `lossIndicator = (meanWin − meanLoss) /
 * stdDev`. È una "Cohen's d" standardizzata che risponde direttamente alla
 * domanda dell'utente: "quali parametri sono SEMPRE BASSI quando il trade
 * va in perdita?". Valori >0 = il feature è significativamente più basso
 * nelle perdite (segnale rosso "se basso, attento"). Valori <0 = il feature
 * è più alto nelle perdite (segnale invertito).
 *
 * Per il "BUY-recommendation error" segmento, l'utente può chiedere il
 * subset dei trade in cui `was_buy_recommended === true`. Quello richiede
 * una sorgente storica delle raccomandazioni che oggi non viviamo come
 * stato congelato sui SimOutcomeRow; si può approssimare con
 * `entry_affidabilita_pct >= 50%` come proxy "il sistema raccomandava di
 * comprare" — quel filtro è esposto come opzione `buyRecOnly`.
 *
 * Anti-leakage: usiamo solo feature entry-time già congelati sul
 * SimOutcomeRow (entry_affidabilita_pct, entry_slope_20d, days_to_cd) e
 * l'SDS attuale del ticker (proxy stabile — l'SDS si muove pian piano).
 *
 * Anti-overfit: ogni feature riporta `n` e una `confidence` shrunk dal
 * sample size (low/medium/high) calcolata con la stessa regola di Phase A.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import { LOSS_THRESHOLD_PCT } from "../sheet/lossAuditAnalysis";
import {
  confidenceFromN,
  DEFAULT_SHRINKAGE_CONFIG,
  type ConfidenceLevel,
} from "../calibration/calibrationTypes";

// ── Feature identification ────────────────────────────────────────────────

export type ContinuousFeatureKey =
  | "pplanPct"
  | "slope20d"
  | "daysToCd"
  | "sdsScore";

export type ContinuousFeatureDescriptor = {
  key: ContinuousFeatureKey;
  labelIt: string;
  labelEn: string;
  /** Sensible plotting range for tooltips/binning. */
  niceRange: [number, number];
  /** Higher value usually means "better signal"? Used only for UI hinting. */
  directionGoodIfHigh: boolean;
};

export const CONTINUOUS_FEATURE_CATALOG: readonly ContinuousFeatureDescriptor[] = [
  {
    key: "pplanPct",
    labelIt: "P(plan) at entry (%)",
    labelEn: "P(plan) at entry (%)",
    niceRange: [0, 100],
    directionGoodIfHigh: true,
  },
  {
    key: "slope20d",
    labelIt: "Slope 20d at entry (pp/giorno)",
    labelEn: "20d slope at entry (pp/day)",
    niceRange: [-2, 2],
    directionGoodIfHigh: true,
  },
  {
    key: "daysToCd",
    labelIt: "Giorni al CD at entry",
    labelEn: "Days to CD at entry",
    niceRange: [0, 180],
    directionGoodIfHigh: false,
  },
  {
    key: "sdsScore",
    labelIt: "SDS score",
    labelEn: "SDS score",
    niceRange: [0, 100],
    directionGoodIfHigh: true,
  },
] as const;

function extractContinuousValue(
  row: SimOutcomeRow,
  key: ContinuousFeatureKey,
  sdsByTicker: Map<string, number>,
): number | null {
  switch (key) {
    case "pplanPct": {
      const v = row.entry_affidabilita_pct ?? null;
      return v != null && Number.isFinite(v) ? Number(v) : null;
    }
    case "slope20d": {
      const v = row.entry_slope_20d ?? null;
      return v != null && Number.isFinite(v) ? Number(v) : null;
    }
    case "daysToCd": {
      const v = row.days_to_cd ?? null;
      return v != null && Number.isFinite(v) ? Number(v) : null;
    }
    case "sdsScore": {
      const tk = String(row.ticker ?? "").trim().toUpperCase();
      const v = sdsByTicker.get(tk) ?? null;
      return v != null && Number.isFinite(v) ? Number(v) : null;
    }
  }
}

// ── Statistics ────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

/** Pearson correlation coefficient. Returns 0 when either side is constant. */
function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return 0;
  return num / denom;
}

/** OLS slope of y on x. Returns 0 when x has no variance. */
function olsSlope(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx;
    num += dx * (ys[i] - my);
    den += dx * dx;
  }
  if (den === 0) return 0;
  return num / den;
}

// ── Public output type ────────────────────────────────────────────────────

export type ContinuousFeatureStat = {
  key: ContinuousFeatureKey;
  labelIt: string;
  labelEn: string;
  /** Total trades that had a value for this feature. */
  n: number;
  nLosses: number;
  nWins: number;
  mean: number;
  meanLoss: number;
  meanWin: number;
  stdDev: number;
  /** Pearson correlation between feature value and pnl_pct (continuous). */
  corrWithPnl: number;
  /** Slope of OLS regression pnl_pct = α + β·featureStandardized.
   *  β > 0 → higher feature, higher pnl. β < 0 → higher feature, lower pnl. */
  regressionSlopeStdized: number;
  /** Standardised mean difference: (meanWin − meanLoss) / stdDev.
   *  Positive → feature is LOWER in losses than in wins (the user's "low
   *  concomitant with loss"). Magnitude > ~0.5 is a moderate effect, > ~0.8
   *  is large (Cohen's d convention). */
  lossIndicator: number;
  /** Confidence based on n (same scale as Calibration / Phase A). */
  confidence: ConfidenceLevel;
};

export type ContinuousLossRegressionResult = {
  computedAt: string;
  /** Total trades fed into the analysis. */
  totalTrades: number;
  /** Fraction of trades that ended in loss (P&L < LOSS_THRESHOLD). */
  baseLossRate: number;
  /** Per-feature stats, ranked by |lossIndicator| desc (most diagnostic first). */
  features: ContinuousFeatureStat[];
  /** Effective subset filter applied. */
  filter: "all" | "buyRecOnly";
};

export type ContinuousRegressionOptions = {
  /** Restrict analysis to the subset of trades where the system effectively
   *  recommended BUY (proxy: entry_affidabilita_pct ≥ minBuyRecPct). */
  buyRecOnly?: boolean;
  /** Threshold for the buy-recommendation proxy (in %). Default 50. */
  minBuyRecPct?: number;
};

// ── Public entry point ────────────────────────────────────────────────────

function isResolved(r: SimOutcomeRow): boolean {
  return r.pnl_pct != null && Number.isFinite(r.pnl_pct);
}

function isLoss(r: SimOutcomeRow): boolean {
  return (r.pnl_pct ?? 0) < LOSS_THRESHOLD_PCT;
}

export function runContinuousLossRegression(
  outcomes: SimOutcomeRow[],
  ctx: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
  } = {},
  opts: ContinuousRegressionOptions = {},
): ContinuousLossRegressionResult {
  const sdsByTicker = new Map<string, number>();
  for (const s of ctx.sdsRows ?? []) {
    const tk = String(s.ticker ?? "").trim().toUpperCase();
    if (!tk) continue;
    const v = s.sds;
    if (typeof v === "number" && Number.isFinite(v)) sdsByTicker.set(tk, v);
  }

  // Filter trades
  const minBuyRecPct = opts.minBuyRecPct ?? 50;
  const buyRecOnly = opts.buyRecOnly ?? false;
  const filtered = outcomes.filter((r) => {
    if (!isResolved(r)) return false;
    if (!buyRecOnly) return true;
    const p = r.entry_affidabilita_pct;
    return typeof p === "number" && Number.isFinite(p) && p >= minBuyRecPct;
  });

  const totalTrades = filtered.length;
  const losses = filtered.filter(isLoss);
  const baseLossRate = totalTrades > 0 ? losses.length / totalTrades : 0;

  const features: ContinuousFeatureStat[] = [];
  for (const desc of CONTINUOUS_FEATURE_CATALOG) {
    const xs: number[] = [];
    const ys: number[] = [];
    const xsLoss: number[] = [];
    const xsWin: number[] = [];
    for (const r of filtered) {
      const v = extractContinuousValue(r, desc.key, sdsByTicker);
      if (v == null) continue;
      const pnl = r.pnl_pct as number;
      xs.push(v);
      ys.push(pnl);
      if (isLoss(r)) xsLoss.push(v);
      else xsWin.push(v);
    }
    const n = xs.length;
    const m = mean(xs);
    const sd = stdDev(xs);
    const ml = mean(xsLoss);
    const mw = mean(xsWin);
    const corr = pearson(xs, ys);
    // Standardise x for an interpretable slope unit ("pnl_pct change per 1 std-dev of feature").
    const slopeStdized = sd > 0 ? olsSlope(xs, ys) * sd : 0;
    const lossIndicator = sd > 0 ? (mw - ml) / sd : 0;
    features.push({
      key: desc.key,
      labelIt: desc.labelIt,
      labelEn: desc.labelEn,
      n,
      nLosses: xsLoss.length,
      nWins: xsWin.length,
      mean: m,
      meanLoss: ml,
      meanWin: mw,
      stdDev: sd,
      corrWithPnl: corr,
      regressionSlopeStdized: slopeStdized,
      lossIndicator,
      confidence: confidenceFromN(n, DEFAULT_SHRINKAGE_CONFIG.confidence),
    });
  }

  // Rank by |lossIndicator| desc — biggest separator first
  features.sort((a, b) => Math.abs(b.lossIndicator) - Math.abs(a.lossIndicator));

  return {
    computedAt: new Date().toISOString(),
    totalTrades,
    baseLossRate,
    features,
    filter: buyRecOnly ? "buyRecOnly" : "all",
  };
}
