/**
 * Phase A — Univariate loss-risk screening.
 *
 * For each candidate entry-state feature, compute per-bucket loss rate with
 * Bayesian shrinkage against the global loss prior, then rank features by
 * |lift - 1| (most discriminating first).
 *
 * Reuses the same shrinkage formula and confidence enum as the Calibration
 * Engine, so users see identical semantics across the two systems:
 *
 *   p_shrunk_loss = (n * raw_loss + k * prior) / (n + k)
 *
 * Anti-leakage:
 *   - Only entry-state features (see RiskFeatureDimension docstring).
 *   - Trades with missing feature value are excluded from that feature's
 *     screening (don't bucket as "Unknown" because that creates a degenerate
 *     bucket that often dominates lift).
 *   - Output rawLossRate and shrunkLossRate are both surfaced so the UI can
 *     never show a naked "100% loss rate on n=2" without the shrunk version.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import {
  buildSimRowByKeyMap,
  normalizedRowKey,
} from "../sheet/investSimKeys";
import {
  clinicalIndicationFromSimRow,
  clinicalPhaseFromSimRow,
} from "../sheet/simRowClinicalMeta";
import {
  bucketClinicalPhase,
  bucketIndication,
  bucketPplan,
  bucketSds,
  LOSS_THRESHOLD_PCT,
} from "../sheet/lossAuditAnalysis";
import {
  freezeFeaturesIfMissing,
  getFrozenFeatures,
} from "../calibration/featureSnapshotStore";
import {
  confidenceFromN,
  DEFAULT_SHRINKAGE_CONFIG,
  type ShrinkageConfig,
} from "../calibration/calibrationTypes";
import type {
  PhaseAResult,
  RiskFeatureDimension,
  UnivariateBucket,
  UnivariateScreening,
} from "./riskPatternTypes";

// ── Bucket helpers (entry-state pure) ─────────────────────────────────────

/** Days-to-CD bucket at entry. */
export function bucketDaysToCd(d: number | null | undefined): string {
  if (d == null || !Number.isFinite(d)) return "DTC n/a";
  if (d < 14) return "DTC <14d";
  if (d < 30) return "DTC 14-30d";
  if (d < 60) return "DTC 30-60d";
  if (d < 90) return "DTC 60-90d";
  return "DTC ≥90d";
}

/** Pre-CD slope sign bucket (from entry_slope_20d in pp/day). */
export function bucketPrecdSlopeSign(slope: number | null | undefined): string {
  if (slope == null || !Number.isFinite(slope)) return "Slope n/a";
  if (slope < -0.3) return "Slope down";
  if (slope > 0.3) return "Slope up";
  return "Slope flat";
}

const DTC_SORT: Record<string, number> = {
  "DTC <14d": 0,
  "DTC 14-30d": 1,
  "DTC 30-60d": 2,
  "DTC 60-90d": 3,
  "DTC ≥90d": 4,
  "DTC n/a": 99,
};

const SLOPE_SORT: Record<string, number> = {
  "Slope down": 0,
  "Slope flat": 1,
  "Slope up": 2,
  "Slope n/a": 99,
};

const SDS_SORT: Record<string, number> = {
  "SDS <40 (Low)": 0,
  "SDS 40-55 (Mid)": 1,
  "SDS 55-70 (High)": 2,
  "SDS ≥70 (Premium)": 3,
  "No SDS": 99,
};

const PPLAN_SORT: Record<string, number> = {
  "P(plan) <30%": 0,
  "P(plan) 30-50%": 1,
  "P(plan) 50-70%": 2,
  "P(plan) ≥70%": 3,
  "P(plan) n/a": 99,
};

const PHASE_SORT: Record<string, number> = {
  Preclinical: 0,
  "Phase 1": 1,
  "Phase 2": 2,
  "Phase 3": 3,
  "Phase 4": 4,
  Approved: 5,
  Other: 6,
  Unknown: 99,
};

function bucketSortKey(dim: RiskFeatureDimension, bucket: string): number {
  switch (dim) {
    case "sdsBucket":
      return SDS_SORT[bucket] ?? 50;
    case "pplanBucket":
      return PPLAN_SORT[bucket] ?? 50;
    case "clinicalPhase":
      return PHASE_SORT[bucket] ?? 50;
    case "daysToCdBucket":
      return DTC_SORT[bucket] ?? 50;
    case "precdSlopeSign":
      return SLOPE_SORT[bucket] ?? 50;
    case "clinicalIndication":
      return 0; // alphabetical handled in sort
    default:
      return 0;
  }
}

// ── Resolve / loss helpers (symmetric flat band with shrinkageEngine) ─────

function isResolved(r: SimOutcomeRow): boolean {
  return r.pnl_pct != null && Number.isFinite(r.pnl_pct);
}

function isLoss(r: SimOutcomeRow): boolean {
  return (r.pnl_pct ?? 0) < LOSS_THRESHOLD_PCT;
}

// ── Feature extraction for a single row (entry-state pure) ────────────────

type RowFeatures = {
  rowKey: string;
  sdsBucket: string | null;
  clinicalPhase: string | null;
  clinicalIndication: string | null;
  pplanBucket: string | null;
  daysToCdBucket: string | null;
  precdSlopeSign: string | null;
};

function extractRowFeatures(
  row: SimOutcomeRow,
  ctx: {
    simRowByKey: Map<string, Record<string, unknown>>;
    sdsByTicker: Map<string, SdsRow>;
  },
): RowFeatures {
  const rowKey = normalizedRowKey(row.ticker, row.completion_date);
  const simRow = ctx.simRowByKey.get(rowKey);
  const livePhaseRaw = simRow ? clinicalPhaseFromSimRow(simRow) : "";
  const liveIndicationRaw = simRow
    ? clinicalIndicationFromSimRow(simRow, 200)
    : "";
  const liveSds =
    ctx.sdsByTicker.get(row.ticker.toUpperCase())?.sds ?? null;
  const pplanPctAtEntry =
    (row as SimOutcomeRow & { entry_affidabilita_pct?: number | null })
      .entry_affidabilita_pct ??
    row.affidabilita_pct ??
    null;

  // Freeze (or get) immutable feature snapshot
  let frozen = getFrozenFeatures(rowKey);
  if (!frozen) {
    frozen = freezeFeaturesIfMissing(rowKey, {
      sds: liveSds,
      clinicalPhase: livePhaseRaw || null,
      clinicalIndication: liveIndicationRaw || null,
      pplanPct: pplanPctAtEntry,
    });
  }

  // Native immutable fields from the outcome record
  const entrySlope20d = (row as SimOutcomeRow & {
    entry_slope_20d?: number | null;
  }).entry_slope_20d;
  const daysToCd = row.days_to_cd;

  return {
    rowKey,
    sdsBucket: frozen.sds != null ? bucketSds(frozen.sds) : null,
    clinicalPhase: frozen.clinicalPhase
      ? bucketClinicalPhase(frozen.clinicalPhase)
      : null,
    clinicalIndication: frozen.clinicalIndication
      ? bucketIndication(frozen.clinicalIndication)
      : null,
    pplanBucket:
      pplanPctAtEntry != null ? bucketPplan(pplanPctAtEntry) : null,
    daysToCdBucket:
      daysToCd != null && Number.isFinite(daysToCd)
        ? bucketDaysToCd(daysToCd)
        : null,
    precdSlopeSign:
      entrySlope20d != null && Number.isFinite(entrySlope20d)
        ? bucketPrecdSlopeSign(entrySlope20d)
        : null,
  };
}

// ── Bucket aggregation ────────────────────────────────────────────────────

type Aggregate = { n: number; losses: number };

function emptyAgg(): Aggregate {
  return { n: 0, losses: 0 };
}

/** Compute one bucket's UnivariateBucket from aggregates and global prior. */
function makeBucket(
  dimension: RiskFeatureDimension,
  bucket: string,
  agg: Aggregate,
  prior: number,
  config: ShrinkageConfig,
): UnivariateBucket {
  const n = agg.n;
  const k = config.k;
  const raw = n > 0 ? agg.losses / n : 0;
  const shrunk = (n * raw + k * prior) / (n + k);
  const baseRate = prior > 0 ? prior : 1e-9;
  const lift = shrunk / baseRate;
  const conf = confidenceFromN(n, config.confidence);
  const eligible = n >= config.minNForSizing && bucket !== "" && agg.n > 0;
  return {
    dimension,
    bucket,
    n,
    losses: agg.losses,
    rawLossRate: raw,
    shrunkLossRate: shrunk,
    lift,
    confidence: conf,
    eligibleForPattern: eligible,
  };
}

const ALL_DIMENSIONS: RiskFeatureDimension[] = [
  "sdsBucket",
  "clinicalPhase",
  "clinicalIndication",
  "pplanBucket",
  "daysToCdBucket",
  "precdSlopeSign",
];

function pickFeatureBucket(
  features: RowFeatures,
  dim: RiskFeatureDimension,
): string | null {
  switch (dim) {
    case "sdsBucket":
      return features.sdsBucket;
    case "clinicalPhase":
      return features.clinicalPhase;
    case "clinicalIndication":
      return features.clinicalIndication;
    case "pplanBucket":
      return features.pplanBucket;
    case "daysToCdBucket":
      return features.daysToCdBucket;
    case "precdSlopeSign":
      return features.precdSlopeSign;
    default:
      return null;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────

/**
 * Run Phase A on a set of closed outcomes.
 * Returns a PhaseAResult with features ranked by maxAbsLift desc.
 */
export function runUnivariateScreening(
  outcomes: SimOutcomeRow[],
  ctxIn: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
    config?: ShrinkageConfig;
  } = {},
): PhaseAResult {
  const config = ctxIn.config ?? DEFAULT_SHRINKAGE_CONFIG;
  const resolved = outcomes.filter(isResolved);

  const simRowByKey = ctxIn.simTable
    ? buildSimRowByKeyMap(ctxIn.simTable.rows ?? [])
    : new Map<string, Record<string, unknown>>();
  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of ctxIn.sdsRows ?? []) {
    if (s.ticker) sdsByTicker.set(s.ticker.toUpperCase(), s);
  }
  const ctx = { simRowByKey, sdsByTicker };

  // Per-row feature extraction
  const enriched = resolved.map((row) => ({
    row,
    features: extractRowFeatures(row, ctx),
    isLoss: isLoss(row),
  }));

  // Global loss rate (used as prior for shrinkage)
  let globalLosses = 0;
  let globalN = 0;
  for (const e of enriched) {
    globalN++;
    if (e.isLoss) globalLosses++;
  }
  const globalLossRate = globalN > 0 ? globalLosses / globalN : 0;

  // Per-feature screening
  const featuresOut: UnivariateScreening[] = [];
  for (const dim of ALL_DIMENSIONS) {
    const byBucket = new Map<string, Aggregate>();
    let dimN = 0;
    let dimLosses = 0;
    for (const e of enriched) {
      const b = pickFeatureBucket(e.features, dim);
      if (b == null) continue; // missing feature → exclude from this dimension
      let agg = byBucket.get(b);
      if (!agg) {
        agg = emptyAgg();
        byBucket.set(b, agg);
      }
      agg.n += 1;
      if (e.isLoss) agg.losses += 1;
      dimN += 1;
      if (e.isLoss) dimLosses += 1;
    }

    // Dimension-level prior: pooled loss rate on the subset with values.
    // Falls back to global if too few observations to be its own prior.
    const dimPrior = dimN > 0 ? dimLosses / dimN : globalLossRate;
    const prior = dimN >= config.minNForSizing ? dimPrior : globalLossRate;

    const buckets: UnivariateBucket[] = [];
    for (const [bucket, agg] of byBucket) {
      buckets.push(makeBucket(dim, bucket, agg, prior, config));
    }
    // Sort: domain-aware sort, then alphabetical
    buckets.sort((a, b) => {
      const sa = bucketSortKey(dim, a.bucket);
      const sb = bucketSortKey(dim, b.bucket);
      if (sa !== sb) return sa - sb;
      return a.bucket.localeCompare(b.bucket);
    });

    const cellsWithData = buckets.filter((b) => b.n > 0).length;
    const hasVariance = cellsWithData >= config.minCellsForVariance;
    const maxAbsLift =
      buckets.length === 0
        ? 0
        : Math.max(...buckets.map((b) => Math.abs(b.lift - 1)));

    featuresOut.push({
      dimension: dim,
      baseLossRate: dimN > 0 ? dimLosses / dimN : globalLossRate,
      totalN: dimN,
      buckets,
      maxAbsLift,
      hasVariance,
    });
  }

  // Rank features: maxAbsLift desc, hasVariance first
  featuresOut.sort((a, b) => {
    if (a.hasVariance !== b.hasVariance) return a.hasVariance ? -1 : 1;
    return b.maxAbsLift - a.maxAbsLift;
  });

  return {
    computedAt: new Date().toISOString(),
    totalTrades: globalN,
    globalLossRate,
    features: featuresOut,
  };
}

/** Display label for a RiskFeatureDimension. */
export function dimensionLabel(
  dim: RiskFeatureDimension,
  lang: "it" | "en" = "en",
): string {
  const it = lang === "it";
  switch (dim) {
    case "sdsBucket":
      return it ? "SDS bucket" : "SDS bucket";
    case "clinicalPhase":
      return it ? "Fase clinica" : "Clinical phase";
    case "clinicalIndication":
      return it ? "Indicazione" : "Indication";
    case "pplanBucket":
      return it ? "P(plan) bucket" : "P(plan) bucket";
    case "daysToCdBucket":
      return it ? "Giorni al CD" : "Days to CD";
    case "precdSlopeSign":
      return it ? "Slope 20d entry" : "Entry slope 20d";
    default:
      return dim;
  }
}

/** Compute the per-row features map keyed by row_key — used by Phase B and
 *  proposal engine to avoid re-extracting features. */
export function extractAllRowFeatures(
  outcomes: SimOutcomeRow[],
  ctxIn: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
  } = {},
): Map<string, RowFeatures> {
  const simRowByKey = ctxIn.simTable
    ? buildSimRowByKeyMap(ctxIn.simTable.rows ?? [])
    : new Map<string, Record<string, unknown>>();
  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of ctxIn.sdsRows ?? []) {
    if (s.ticker) sdsByTicker.set(s.ticker.toUpperCase(), s);
  }
  const ctx = { simRowByKey, sdsByTicker };
  const map = new Map<string, RowFeatures>();
  for (const r of outcomes) {
    if (!isResolved(r)) continue;
    map.set(normalizedRowKey(r.ticker, r.completion_date), extractRowFeatures(r, ctx));
  }
  return map;
}

function numFromSimRow(rec: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Entry-state features for OPEN positions (portfolio + sim-loop BUY universe).
 *  Uses frozen snapshots when present; otherwise buckets from live sim rows. */
export function extractFeaturesForOpenDeals(
  deals: Array<{ rowKey: string; ticker: string; cells: Record<string, string> }>,
  ctxIn: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
  } = {},
): Map<string, RowFeatures> {
  const simRowByKey = ctxIn.simTable
    ? buildSimRowByKeyMap(ctxIn.simTable.rows ?? [])
    : new Map<string, Record<string, unknown>>();
  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of ctxIn.sdsRows ?? []) {
    if (s.ticker) sdsByTicker.set(s.ticker.toUpperCase(), s);
  }

  const map = new Map<string, RowFeatures>();
  for (const d of deals) {
    const simRow = simRowByKey.get(d.rowKey);
    const liveSds = sdsByTicker.get(d.ticker.toUpperCase())?.sds ?? null;
    let frozen = getFrozenFeatures(d.rowKey);
    if (!frozen) {
      frozen = freezeFeaturesIfMissing(d.rowKey, {
        sds: liveSds,
        clinicalPhase: d.cells.clinicalPhase ?? null,
        clinicalIndication: d.cells.clinicalIndication ?? null,
        pplanPct: null,
      });
    }
    const daysToCd = simRow
      ? numFromSimRow(simRow, "Days to CD", "Days", "days_to_cd")
      : null;
    const entrySlope20d = simRow
      ? numFromSimRow(simRow, "entry_slope_20d", "Entry slope 20d", "Slope 20d")
      : null;

    map.set(d.rowKey, {
      rowKey: d.rowKey,
      sdsBucket: d.cells.sdsBucket ?? (frozen.sds != null ? bucketSds(frozen.sds) : null),
      clinicalPhase: d.cells.clinicalPhase ?? null,
      clinicalIndication: d.cells.clinicalIndication ?? null,
      pplanBucket: d.cells.pplanBucket ?? null,
      daysToCdBucket:
        daysToCd != null && Number.isFinite(daysToCd) ? bucketDaysToCd(daysToCd) : null,
      precdSlopeSign:
        entrySlope20d != null && Number.isFinite(entrySlope20d)
          ? bucketPrecdSlopeSign(entrySlope20d)
          : null,
    });
  }
  return map;
}

export type { RowFeatures };
