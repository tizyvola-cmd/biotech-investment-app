/**
 * Reverse-engineer a Step-2 risk pattern from manual allocation sliders.
 *
 * Primary signal: OPEN positions (real portfolio + sim-loop BUY universe) —
 * the same deals the user dials in Step 3. Closed trades are optional context
 * for historical loss-rate validation only.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import {
  conditionLabel,
  describePattern,
  evaluatePatternStats,
  matchPattern,
} from "../riskPattern/lossRiskPattern";
import {
  extractAllRowFeatures,
  extractFeaturesForOpenDeals,
  type RowFeatures,
} from "../riskPattern/lossRiskScreening";
import type { ConfidenceLevel } from "../calibration/calibrationTypes";
import type {
  PatternCondition,
  PatternStats,
  PhaseAResult,
  RiskFeatureDimension,
  RiskPattern,
  UnivariateBucket,
} from "../riskPattern/riskPatternTypes";

export type ManualAllocationDealRow = {
  rowKey: string;
  ticker: string;
  baselineShare: number;
  manualShare: number;
  /** User explicitly moved the slider (not the implicit weighted default). */
  userAdjusted: boolean;
  /** Entry-state bucket cells — required for accurate pattern synthesis. */
  cells?: Record<string, string>;
};

export type ManualAllocationSynthesizerInput = {
  universe: "portfolio" | "simLoop";
  enabled: boolean;
  deals: ManualAllocationDealRow[];
};

export type ManualAllocationSynthesizerBundle = {
  portfolio: ManualAllocationSynthesizerInput | null;
  simLoop: ManualAllocationSynthesizerInput | null;
};

export type OpenBookPatternStats = {
  n: number;
  penalizedN: number;
  firedN: number;
  firedPenalized: number;
  precision: number;
  recall: number;
  lift: number;
};

/** One row per open deal: ticker, portfolio share, and synthesized pattern match. */
export type ManualAllocationCompanyRow = {
  rowKey: string;
  ticker: string;
  baselineSharePct: number;
  manualSharePct: number;
  shareDeltaPp: number;
  penalized: boolean;
  patternMatches: boolean;
  /** Localized pattern label when this deal matches the synthesized pattern. */
  patternLabel: string | null;
};

/** One row in the index table: bucket enriched among down-weighted open deals. */
export type ManualAllocationIndexRow = {
  dimension: RiskFeatureDimension;
  cell: string;
  openN: number;
  openPenalizedN: number;
  avgBaselineShare: number;
  avgManualShare: number;
  /** manual − baseline in percentage points of portfolio share. */
  shareDeltaPp: number;
  /** Shrunk loss rate on closed trades (Phase A). */
  closedLossRate: number | null;
  closedN: number;
  closedConfidence: ConfidenceLevel | null;
  closedLift: number | null;
  inSuggestedPattern: boolean;
};

export type ManualAllocationPatternResult = {
  pattern: RiskPattern;
  universe: "portfolio" | "simLoop";
  openBookStats: OpenBookPatternStats;
  /** Historical loss validation on closed trades (when available). */
  closedValidation: PatternStats | null;
  penalizedTickers: string[];
  candidatesEvaluated: number;
  /** Bucket-level indices linking manual weights → historical error rates. */
  indexRows: ManualAllocationIndexRow[];
  /** Per-company rows: ticker, portfolio %, pattern association. */
  companyRows: ManualAllocationCompanyRow[];
  /** Best estimate of loss/error % when pattern fires on closed trades. */
  estimatedErrorPct: number | null;
};

export type ManualAllocationSynthesizerBundleResult = {
  portfolio: ManualAllocationPatternResult | null;
  simLoop: ManualAllocationPatternResult | null;
};

export type SynthesizerConfig = {
  /** Manual share below this fraction of baseline ⇒ penalized. */
  relativeCutThreshold?: number;
  maxConditions?: number;
  minPenalizedN?: number;
  minFiredN?: number;
  minPrecision?: number;
};

const DEFAULT_CONFIG: Required<SynthesizerConfig> = {
  relativeCutThreshold: 0.75,
  maxConditions: 3,
  minPenalizedN: 1,
  minFiredN: 1,
  minPrecision: 0.5,
};

const ALL_DIMS: RiskFeatureDimension[] = [
  "sdsBucket",
  "clinicalPhase",
  "pplanBucket",
  "daysToCdBucket",
  "precdSlopeSign",
  "clinicalIndication",
];

function nextPatternId(): string {
  return `manual-synth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pickBucket(features: RowFeatures, dim: RiskFeatureDimension): string | null {
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

/** A deal counts as penalized when manual sizing is materially below baseline. */
export function isDealPenalized(
  baselineShare: number,
  manualShare: number,
  userAdjusted: boolean,
  relativeCutThreshold = DEFAULT_CONFIG.relativeCutThreshold,
): boolean {
  if (baselineShare <= 0 && manualShare <= 0) return false;
  if (manualShare <= 0 && baselineShare > 0) return true;
  if (!userAdjusted && Math.abs(manualShare - baselineShare) < 1e-9) return false;
  if (baselineShare > 0 && manualShare < baselineShare * relativeCutThreshold) return true;
  if (userAdjusted && manualShare < baselineShare * 0.95) return true;
  return false;
}

function evaluateOpenBookStats(
  pattern: RiskPattern,
  deals: ManualAllocationDealRow[],
  features: Map<string, RowFeatures>,
  cfg: Required<SynthesizerConfig>,
): OpenBookPatternStats | null {
  let penalizedN = 0;
  let firedN = 0;
  let firedPenalized = 0;

  for (const d of deals) {
    const feat = features.get(d.rowKey);
    if (!feat) continue;
    const penalized = isDealPenalized(
      d.baselineShare,
      d.manualShare,
      d.userAdjusted,
      cfg.relativeCutThreshold,
    );
    if (penalized) penalizedN += 1;
    const fires = matchPattern(pattern, feat);
    if (fires) {
      firedN += 1;
      if (penalized) firedPenalized += 1;
    }
  }

  const n = deals.length;
  if (penalizedN < cfg.minPenalizedN || firedN < cfg.minFiredN) return null;

  const precision = firedN > 0 ? firedPenalized / firedN : 0;
  const recall = penalizedN > 0 ? firedPenalized / penalizedN : 0;
  const baseRate = n > 0 ? penalizedN / n : 0;
  const lift = baseRate > 0 ? precision / baseRate : firedN > 0 ? Infinity : 0;

  return {
    n,
    penalizedN,
    firedN,
    firedPenalized,
    precision,
    recall,
    lift: Number.isFinite(lift) ? lift : 0,
  };
}

function buildConditions(
  dims: RiskFeatureDimension[],
  buckets: string[],
): PatternCondition[] {
  return dims.map((dim, i) => ({
    dimension: dim,
    operator: "in" as const,
    values: [buckets[i]],
  }));
}

function scoreOpenBook(stats: OpenBookPatternStats): number {
  return stats.precision * 0.7 + stats.recall * 0.3 + Math.min(stats.lift, 3) * 0.05;
}

/** Synthesize a risk pattern from one manual-allocation universe (open deals). */
export function synthesizePatternFromManualAllocation(
  input: ManualAllocationSynthesizerInput,
  features: Map<string, RowFeatures>,
  closedRows: SimOutcomeRow[] = [],
  closedFeatures: Map<string, RowFeatures> = new Map(),
  config: SynthesizerConfig = {},
): ManualAllocationPatternResult | null {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (!input.enabled || input.deals.length === 0) return null;

  const penalizedKeys = new Set(
    input.deals
      .filter((d) =>
        isDealPenalized(d.baselineShare, d.manualShare, d.userAdjusted, cfg.relativeCutThreshold),
      )
      .map((d) => d.rowKey),
  );
  if (penalizedKeys.size < cfg.minPenalizedN) return null;

  // Collect candidate buckets enriched among penalized deals.
  const bucketCounts = new Map<string, { penalized: number; total: number }>();
  for (const d of input.deals) {
    const feat = features.get(d.rowKey);
    if (!feat) continue;
    const isPen = penalizedKeys.has(d.rowKey);
    for (const dim of ALL_DIMS) {
      const bucket = pickBucket(feat, dim);
      if (!bucket || bucket.includes("n/a") || bucket === "Unknown") continue;
      const key = `${dim}|${bucket}`;
      const cur = bucketCounts.get(key) ?? { penalized: 0, total: 0 };
      cur.total += 1;
      if (isPen) cur.penalized += 1;
      bucketCounts.set(key, cur);
    }
  }

  const basePenRate = penalizedKeys.size / Math.max(1, input.deals.length);
  const rankedBuckets = Array.from(bucketCounts.entries())
    .map(([key, agg]) => {
      const [dim, bucket] = key.split("|") as [RiskFeatureDimension, string];
      const rate = agg.total > 0 ? agg.penalized / agg.total : 0;
      const lift = basePenRate > 0 ? rate / basePenRate : rate > 0 ? Infinity : 0;
      return { dim, bucket, lift: Number.isFinite(lift) ? lift : 0, rate, total: agg.total };
    })
    .filter((b) => b.lift >= 1.0 && b.total >= 1)
    .sort((a, b) => b.lift - a.lift || b.rate - a.rate);

  if (rankedBuckets.length === 0) return null;

  type Scored = { conditions: PatternCondition[]; stats: OpenBookPatternStats; score: number };
  const scored: Scored[] = [];
  let candidatesEvaluated = 0;

  const tryConditions = (conditions: PatternCondition[]) => {
    candidatesEvaluated += 1;
    const provisional: RiskPattern = {
      id: "cand",
      createdAt: new Date(0).toISOString(),
      conditions,
      name: "",
      inSampleStats: {} as PatternStats,
    };
    const stats = evaluateOpenBookStats(provisional, input.deals, features, cfg);
    if (!stats || stats.precision < cfg.minPrecision) return;
    scored.push({ conditions, stats, score: scoreOpenBook(stats) });
  };

  // Single-bucket candidates
  for (const b of rankedBuckets.slice(0, 12)) {
    tryConditions(buildConditions([b.dim], [b.bucket]));
  }

  // Pairwise AND (top buckets, distinct dimensions)
  for (let i = 0; i < Math.min(rankedBuckets.length, 8); i += 1) {
    for (let j = i + 1; j < Math.min(rankedBuckets.length, 10); j += 1) {
      const a = rankedBuckets[i];
      const b = rankedBuckets[j];
      if (a.dim === b.dim) continue;
      tryConditions(buildConditions([a.dim, b.dim], [a.bucket, b.bucket]));
    }
  }

  // Triple AND when configured
  if (cfg.maxConditions >= 3) {
    for (let i = 0; i < Math.min(rankedBuckets.length, 6); i += 1) {
      for (let j = i + 1; j < Math.min(rankedBuckets.length, 8); j += 1) {
        for (let k = j + 1; k < Math.min(rankedBuckets.length, 10); k += 1) {
          const dims = [rankedBuckets[i].dim, rankedBuckets[j].dim, rankedBuckets[k].dim];
          if (new Set(dims).size < 3) continue;
          tryConditions(
            buildConditions(dims, [
              rankedBuckets[i].bucket,
              rankedBuckets[j].bucket,
              rankedBuckets[k].bucket,
            ]),
          );
        }
      }
    }
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const winner = scored[0];

  const pattern: RiskPattern = {
    id: nextPatternId(),
    createdAt: new Date().toISOString(),
    conditions: winner.conditions,
    name: describePattern({
      id: "",
      createdAt: "",
      conditions: winner.conditions,
      name: "",
      inSampleStats: {} as PatternStats,
    }),
    inSampleStats: {} as PatternStats,
  };

  let closedValidation: PatternStats | null = null;
  if (closedRows.length > 0 && closedFeatures.size > 0) {
    closedValidation = evaluatePatternStats(pattern, closedRows, closedFeatures);
  }

  const baseResult: Omit<
    ManualAllocationPatternResult,
    "indexRows" | "companyRows" | "estimatedErrorPct"
  > = {
    pattern,
    universe: input.universe,
    openBookStats: winner.stats,
    closedValidation,
    penalizedTickers: input.deals
      .filter((d) => penalizedKeys.has(d.rowKey))
      .map((d) => d.ticker),
    candidatesEvaluated,
  };

  const partialResult = {
    ...baseResult,
    indexRows: [] as ManualAllocationIndexRow[],
    companyRows: [] as ManualAllocationCompanyRow[],
    estimatedErrorPct: null,
  };
  const indexRows = computeManualAllocationIndices(input, partialResult, features, null);
  const companyRows = computeManualAllocationCompanyRows(input, partialResult, features);

  return {
    ...baseResult,
    indexRows,
    companyRows,
    estimatedErrorPct: estimateErrorPct(closedValidation, indexRows),
  };
}

/** Per-company view: ticker, portfolio share, and whether it matches the synthesized pattern. */
export function computeManualAllocationCompanyRows(
  input: ManualAllocationSynthesizerInput,
  result: ManualAllocationPatternResult | null,
  features: Map<string, RowFeatures>,
  lang: "it" | "en" = "en",
  relativeCutThreshold = DEFAULT_CONFIG.relativeCutThreshold,
): ManualAllocationCompanyRow[] {
  if (!input.enabled || input.deals.length === 0) return [];

  const patternLabel =
    result?.pattern.conditions
      .map((c) => conditionLabel(c, lang))
      .join(" AND ") ?? null;

  const rows: ManualAllocationCompanyRow[] = [];
  for (const d of input.deals) {
    const feat = features.get(d.rowKey);
    const penalized = isDealPenalized(
      d.baselineShare,
      d.manualShare,
      d.userAdjusted,
      relativeCutThreshold,
    );
    const patternMatches = Boolean(result?.pattern && feat && matchPattern(result.pattern, feat));

    rows.push({
      rowKey: d.rowKey,
      ticker: d.ticker,
      baselineSharePct: d.baselineShare * 100,
      manualSharePct: d.manualShare * 100,
      shareDeltaPp: (d.manualShare - d.baselineShare) * 100,
      penalized,
      patternMatches,
      patternLabel: patternMatches ? patternLabel : null,
    });
  }

  rows.sort((a, b) => {
    if (a.penalized !== b.penalized) return a.penalized ? -1 : 1;
    if (a.patternMatches !== b.patternMatches) return a.patternMatches ? -1 : 1;
    return b.manualSharePct - a.manualSharePct;
  });

  return rows;
}

function phaseABucketLookup(
  phaseA: PhaseAResult | null,
  dim: RiskFeatureDimension,
  bucket: string,
): UnivariateBucket | null {
  if (!phaseA) return null;
  const screening = phaseA.features.find((f) => f.dimension === dim);
  return screening?.buckets.find((b) => b.bucket === bucket) ?? null;
}

function bucketInPattern(
  pattern: RiskPattern | null,
  dim: RiskFeatureDimension,
  bucket: string,
): boolean {
  if (!pattern) return false;
  const cond = pattern.conditions.find((c) => c.dimension === dim);
  return cond?.values.includes(bucket) ?? false;
}

/** Aggregate bucket indices from open manual weights + Phase A closed loss rates. */
export function computeManualAllocationIndices(
  input: ManualAllocationSynthesizerInput,
  result: ManualAllocationPatternResult | null,
  features: Map<string, RowFeatures>,
  phaseA: PhaseAResult | null,
): ManualAllocationIndexRow[] {
  if (!input.enabled || input.deals.length === 0) return [];

  const penalizedKeys = new Set(
    input.deals
      .filter((d) =>
        isDealPenalized(d.baselineShare, d.manualShare, d.userAdjusted),
      )
      .map((d) => d.rowKey),
  );

  type Agg = {
    openN: number;
    openPenalizedN: number;
    baselineSum: number;
    manualSum: number;
  };
  const aggByKey = new Map<string, Agg>();

  for (const d of input.deals) {
    const feat = features.get(d.rowKey);
    if (!feat) continue;
    const isPen = penalizedKeys.has(d.rowKey);
    for (const dim of ALL_DIMS) {
      const bucket = pickBucket(feat, dim);
      if (!bucket || bucket.includes("n/a") || bucket === "Unknown") continue;
      const key = `${dim}|${bucket}`;
      const cur = aggByKey.get(key) ?? {
        openN: 0,
        openPenalizedN: 0,
        baselineSum: 0,
        manualSum: 0,
      };
      cur.openN += 1;
      if (isPen) cur.openPenalizedN += 1;
      cur.baselineSum += d.baselineShare;
      cur.manualSum += d.manualShare;
      aggByKey.set(key, cur);
    }
  }

  // Include pattern buckets even if not enriched among penalized deals.
  if (result?.pattern) {
    for (const cond of result.pattern.conditions) {
      for (const bucket of cond.values) {
        const key = `${cond.dimension}|${bucket}`;
        if (!aggByKey.has(key)) {
          aggByKey.set(key, {
            openN: 0,
            openPenalizedN: 0,
            baselineSum: 0,
            manualSum: 0,
          });
        }
      }
    }
  }

  const rows: ManualAllocationIndexRow[] = [];
  for (const [key, agg] of aggByKey) {
    const [dim, cell] = key.split("|") as [RiskFeatureDimension, string];
    if (agg.openPenalizedN === 0 && !bucketInPattern(result?.pattern ?? null, dim, cell)) {
      continue;
    }
    const phaseRow = phaseABucketLookup(phaseA, dim, cell);
    const avgBaseline = agg.openN > 0 ? agg.baselineSum / agg.openN : 0;
    const avgManual = agg.openN > 0 ? agg.manualSum / agg.openN : 0;
    rows.push({
      dimension: dim,
      cell,
      openN: agg.openN,
      openPenalizedN: agg.openPenalizedN,
      avgBaselineShare: avgBaseline,
      avgManualShare: avgManual,
      shareDeltaPp: (avgManual - avgBaseline) * 100,
      closedLossRate: phaseRow?.shrunkLossRate ?? null,
      closedN: phaseRow?.n ?? 0,
      closedConfidence: phaseRow?.confidence ?? null,
      closedLift: phaseRow?.lift ?? null,
      inSuggestedPattern: bucketInPattern(result?.pattern ?? null, dim, cell),
    });
  }

  rows.sort((a, b) => {
    if (a.inSuggestedPattern !== b.inSuggestedPattern) {
      return a.inSuggestedPattern ? -1 : 1;
    }
    const penA = a.openN > 0 ? a.openPenalizedN / a.openN : 0;
    const penB = b.openN > 0 ? b.openPenalizedN / b.openN : 0;
    if (penB !== penA) return penB - penA;
    return (b.closedLift ?? 0) - (a.closedLift ?? 0);
  });

  return rows;
}

function estimateErrorPct(
  closedValidation: PatternStats | null,
  indexRows: ManualAllocationIndexRow[],
): number | null {
  if (closedValidation && closedValidation.firedN > 0) {
    return closedValidation.precision * 100;
  }
  const patternRows = indexRows.filter(
    (r) => r.inSuggestedPattern && r.closedLossRate != null,
  );
  if (patternRows.length === 0) return null;
  const sum = patternRows.reduce((s, r) => s + (r.closedLossRate ?? 0), 0);
  return (sum / patternRows.length) * 100;
}

/** Pick the active manual-allocation universe for synthesis preview. */
export function pickActiveManualAllocationInput(
  bundle: ManualAllocationSynthesizerBundle | null | undefined,
): ManualAllocationSynthesizerInput | null {
  if (!bundle) return null;
  if (bundle.portfolio?.enabled && (bundle.portfolio.deals.length ?? 0) > 0) {
    return bundle.portfolio;
  }
  if (bundle.simLoop?.enabled && (bundle.simLoop.deals.length ?? 0) > 0) {
    return bundle.simLoop;
  }
  return null;
}

export function buildSynthesizerContext(
  input: ManualAllocationSynthesizerInput,
  ctx: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
    closedRows?: SimOutcomeRow[];
  },
): {
  openFeatures: Map<string, RowFeatures>;
  closedFeatures: Map<string, RowFeatures>;
} {
  const openFeatures = extractFeaturesForOpenDeals(
    input.deals.map((d) => ({
      rowKey: d.rowKey,
      ticker: d.ticker,
      cells: d.cells ?? {},
    })),
    ctx,
  );
  const closedFeatures =
    ctx.closedRows && ctx.closedRows.length > 0
      ? extractAllRowFeatures(ctx.closedRows, ctx)
      : new Map<string, RowFeatures>();
  return { openFeatures, closedFeatures };
}

/** Full pipeline: features extraction + synthesis for one universe. */
export function runManualAllocationSynthesizer(
  input: ManualAllocationSynthesizerInput | null,
  ctx: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
    closedRows?: SimOutcomeRow[];
    phaseA?: PhaseAResult | null;
    /** Pre-built feature map keyed by rowKey (preferred — includes full cells). */
    featuresByRowKey?: Map<string, RowFeatures>;
  },
  config?: SynthesizerConfig,
): ManualAllocationPatternResult | null {
  if (!input?.enabled || input.deals.length === 0) return null;

  const openFeatures =
    ctx.featuresByRowKey ??
    extractFeaturesForOpenDeals(
      input.deals.map((d) => ({
        rowKey: d.rowKey,
        ticker: d.ticker,
        cells: d.cells ?? {},
      })),
      ctx,
    );

  const closedFeatures =
    ctx.closedRows && ctx.closedRows.length > 0
      ? extractAllRowFeatures(ctx.closedRows, ctx)
      : new Map<string, RowFeatures>();

  const raw = synthesizePatternFromManualAllocation(
    input,
    openFeatures,
    ctx.closedRows ?? [],
    closedFeatures,
    config,
  );
  if (!raw) return null;

  const phaseA = ctx.phaseA ?? null;
  const indexRows = computeManualAllocationIndices(input, raw, openFeatures, phaseA);
  const companyRows = computeManualAllocationCompanyRows(input, raw, openFeatures);
  return {
    ...raw,
    indexRows,
    companyRows,
    estimatedErrorPct: estimateErrorPct(raw.closedValidation, indexRows),
  };
}

/** Run synthesizer for each enabled manual-allocation universe. */
export function runManualAllocationSynthesizerBundle(
  bundle: ManualAllocationSynthesizerBundle | null | undefined,
  ctx: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
    closedRows?: SimOutcomeRow[];
    phaseA?: PhaseAResult | null;
  },
  config?: SynthesizerConfig,
): ManualAllocationSynthesizerBundleResult {
  const runOne = (input: ManualAllocationSynthesizerInput | null) =>
    runManualAllocationSynthesizer(input, ctx, config);

  return {
    portfolio: runOne(bundle?.portfolio ?? null),
    simLoop: runOne(bundle?.simLoop ?? null),
  };
}
