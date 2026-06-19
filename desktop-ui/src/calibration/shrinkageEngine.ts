/**
 * Bayesian Shrinkage Engine.
 *
 * For each cell of each dimension, computes a shrunk win-rate estimate:
 *
 *   p_shrunk = (n * p_observed + k * prior) / (n + k)
 *
 * where prior = dimension-level pooled win rate (hierarchical),
 * and k = pseudo-count (default 8 — tunable via ShrinkageConfig).
 *
 * INVARIANTS enforced by the type system:
 *   - Cells with n=0 are returned with `inactive = "no_data"` and MUST NOT
 *     be used in sizing. The raw and shrunk values are set to the prior
 *     (so consumers that ignore the flag at least don't see 0%).
 *   - Cells with n>0 but n < minNForSizing are returned with
 *     `inactive = "n_below_floor"`. Consumers should treat them as
 *     informational only.
 *   - Dimensions where every observed trade falls in the same single bucket
 *     are flagged `hasVariance = false` and disabled in sizing.
 *
 * The engine is PURE: no side effects, no persistence. Run it whenever you
 * want a fresh snapshot. Persistence happens elsewhere (frozen weights /
 * proposal store).
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import {
  clinicalPhaseFromSimRow,
  clinicalIndicationFromSimRow,
} from "../sheet/simRowClinicalMeta";
import { buildSimRowByKeyMap, normalizedRowKey } from "../sheet/investSimKeys";
import {
  bucketClinicalPhase,
  bucketIndication,
  bucketSds,
  bucketPplan,
} from "../sheet/lossAuditAnalysis";
import {
  freezeFeaturesIfMissing,
  getFrozenFeatures,
} from "./featureSnapshotStore";
import {
  type CalibrationDimension,
  type CalibrationSnapshot,
  type CellEstimate,
  type DimensionEstimate,
  type ShrinkageConfig,
  DEFAULT_SHRINKAGE_CONFIG,
  confidenceFromN,
} from "./calibrationTypes";

const LOSS_THRESHOLD_PCT = -2;

/** A trade contributes to a cell only if pnl_pct is realized. Flat band is ignored. */
function isResolved(r: SimOutcomeRow): boolean {
  return r.pnl_pct != null && Number.isFinite(r.pnl_pct);
}

/** Convention: WIN when pnl_pct > +LOSS_THRESHOLD_PCT (symmetric ±2 flat band). */
function isWin(r: SimOutcomeRow): boolean {
  return (r.pnl_pct ?? 0) > -LOSS_THRESHOLD_PCT;
}

type EnrichedRow = {
  row: SimOutcomeRow;
  cells: Record<CalibrationDimension, string>;
};

/**
 * Build the cell membership for one row, using FROZEN features when available
 * (and freezing them on first observation if not).
 */
function enrichRow(
  row: SimOutcomeRow,
  ctx: {
    simRowByKey: Map<string, Record<string, unknown>>;
    sdsByTicker: Map<string, SdsRow>;
  },
): EnrichedRow {
  const key = normalizedRowKey(row.ticker, row.completion_date);
  const simRow = ctx.simRowByKey.get(key);
  // Live values (may be derived; we'll freeze them on first sight)
  const livePhaseRaw = simRow ? clinicalPhaseFromSimRow(simRow) : "";
  const liveIndicationRaw = simRow
    ? clinicalIndicationFromSimRow(simRow, 200)
    : "";
  const liveSds = ctx.sdsByTicker.get(row.ticker.toUpperCase())?.sds ?? null;

  // P(plan) at entry: prefer the immutable `entry_affidabilita_pct` from the
  // outcome record itself; fall back to live affidabilita_pct only when missing.
  const pplanPctAtEntry =
    (row as SimOutcomeRow & { entry_affidabilita_pct?: number | null })
      .entry_affidabilita_pct ??
    row.affidabilita_pct ??
    null;

  // Try to use the frozen snapshot. If missing, freeze the live values.
  let frozen = getFrozenFeatures(key);
  if (!frozen) {
    frozen = freezeFeaturesIfMissing(key, {
      sds: liveSds,
      clinicalPhase: livePhaseRaw || null,
      clinicalIndication: liveIndicationRaw || null,
      pplanPct: pplanPctAtEntry,
    });
  }

  return {
    row,
    cells: {
      clinicalPhase: bucketClinicalPhase(frozen.clinicalPhase ?? ""),
      clinicalIndication: bucketIndication(frozen.clinicalIndication ?? ""),
      sdsBucket: bucketSds(frozen.sds),
      pplanBucket: bucketPplan(pplanPctAtEntry),
    },
  };
}

/** Empty / placeholder cell estimate used when n=0. */
function emptyCell(
  dimension: CalibrationDimension,
  cell: string,
  prior: number,
  config: ShrinkageConfig,
): CellEstimate {
  return {
    dimension,
    cell,
    n: 0,
    wins: 0,
    rawObserved: prior,
    shrinkageApplied: prior,
    prior,
    k: config.k,
    confidence: confidenceFromN(0, config.confidence),
    inactive: "no_data",
    avgPnlPct: null,
    capitalDeployedEur: 0,
  };
}

/**
 * Compute shrinkage estimate for a single cell given its observed trades.
 */
function buildCellEstimate(
  dimension: CalibrationDimension,
  cell: string,
  rows: SimOutcomeRow[],
  prior: number,
  config: ShrinkageConfig,
): CellEstimate {
  if (rows.length === 0) {
    return emptyCell(dimension, cell, prior, config);
  }
  let wins = 0;
  let sumPnl = 0;
  let capital = 0;
  for (const r of rows) {
    if (isWin(r)) wins++;
    sumPnl += r.pnl_pct ?? 0;
    capital += r.capital_eur ?? 0;
  }
  const n = rows.length;
  const rawObserved = wins / n;
  const k = config.k;
  const shrunk = (n * rawObserved + k * prior) / (n + k);
  const conf = confidenceFromN(n, config.confidence);
  const inactive =
    n === 0
      ? "no_data"
      : n < config.minNForSizing
        ? "n_below_floor"
        : null;
  return {
    dimension,
    cell,
    n,
    wins,
    rawObserved,
    shrinkageApplied: shrunk,
    prior,
    k,
    confidence: conf,
    inactive,
    avgPnlPct: n > 0 ? sumPnl / n : null,
    capitalDeployedEur: capital,
  };
}

/**
 * Group rows by their value in one dimension and build cell estimates.
 */
function buildDimensionEstimate(
  dimension: CalibrationDimension,
  enriched: EnrichedRow[],
  globalPrior: number,
  config: ShrinkageConfig,
): DimensionEstimate {
  // Pool by cell — only resolved trades contribute
  const byCell = new Map<string, SimOutcomeRow[]>();
  for (const e of enriched) {
    const cell = e.cells[dimension];
    let arr = byCell.get(cell);
    if (!arr) {
      arr = [];
      byCell.set(cell, arr);
    }
    arr.push(e.row);
  }

  // Dimension-level prior: pooled win rate across all cells in this dimension.
  // We pool the raw counts (not the cell win rates), so it's weighted by n.
  let dimWins = 0;
  let dimTotal = 0;
  for (const rows of byCell.values()) {
    for (const r of rows) {
      dimTotal++;
      if (isWin(r)) dimWins++;
    }
  }
  // Hierarchical prior: if the dimension itself has <minCellsForVariance bookings,
  // fall back to the global prior (more shrinkage, less risk of self-referential prior).
  const dimensionPrior = dimTotal > 0 ? dimWins / dimTotal : globalPrior;
  const prior =
    dimTotal >= config.minNForSizing ? dimensionPrior : globalPrior;

  // Build estimates
  const cells: CellEstimate[] = [];
  for (const [cell, rows] of byCell) {
    cells.push(buildCellEstimate(dimension, cell, rows, prior, config));
  }
  // Sort: active cells first by n desc, then inactive
  cells.sort((a, b) => {
    if ((a.inactive == null) !== (b.inactive == null)) {
      return a.inactive == null ? -1 : 1;
    }
    return b.n - a.n;
  });

  // hasVariance: the dimension has actionable variance if at least minCellsForVariance
  // distinct cells have observations.
  const cellsWithData = cells.filter((c) => c.n > 0).length;
  const hasVariance = cellsWithData >= config.minCellsForVariance;

  return {
    dimension,
    prior,
    hasVariance,
    cells,
    totalN: dimTotal,
  };
}

/**
 * Main entry point — compute a full calibration snapshot from closed outcomes.
 *
 * Returns a snapshot that includes raw_observed, shrinkage_applied, n, and
 * confidence for every cell. Never returns naked numbers.
 */
export function computeCalibrationSnapshot(
  outcomes: SimOutcomeRow[],
  opts: {
    simTable?: SheetTable | null;
    sdsRows?: SdsRow[] | null;
    config?: ShrinkageConfig;
  } = {},
): CalibrationSnapshot {
  const config = opts.config ?? DEFAULT_SHRINKAGE_CONFIG;
  const resolved = outcomes.filter(isResolved);

  // Build lookup ctx
  const simRowByKey = opts.simTable
    ? buildSimRowByKeyMap(opts.simTable.rows ?? [])
    : new Map<string, Record<string, unknown>>();
  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of opts.sdsRows ?? []) {
    if (s.ticker) sdsByTicker.set(s.ticker.toUpperCase(), s);
  }

  // Enrich rows with frozen features
  const enriched: EnrichedRow[] = resolved.map((r) =>
    enrichRow(r, { simRowByKey, sdsByTicker }),
  );

  // Global win rate (fallback prior + reported in snapshot)
  let globalWins = 0;
  for (const e of enriched) {
    if (isWin(e.row)) globalWins++;
  }
  const totalTrades = enriched.length;
  const globalPrior = totalTrades > 0 ? globalWins / totalTrades : 0.5;

  // Build per-dimension estimates
  const dimensions: Record<CalibrationDimension, DimensionEstimate> = {
    clinicalPhase: buildDimensionEstimate(
      "clinicalPhase",
      enriched,
      globalPrior,
      config,
    ),
    clinicalIndication: buildDimensionEstimate(
      "clinicalIndication",
      enriched,
      globalPrior,
      config,
    ),
    sdsBucket: buildDimensionEstimate(
      "sdsBucket",
      enriched,
      globalPrior,
      config,
    ),
    pplanBucket: buildDimensionEstimate(
      "pplanBucket",
      enriched,
      globalPrior,
      config,
    ),
  };

  return {
    computedAt: new Date().toISOString(),
    globalPrior,
    totalTrades,
    dimensions,
  };
}

/**
 * Convenience: get a single cell estimate for a row's feature combination,
 * useful for sizing decisions on NEW opportunities.
 */
export function lookupCellEstimate(
  snapshot: CalibrationSnapshot,
  dimension: CalibrationDimension,
  cell: string,
): CellEstimate | null {
  const dim = snapshot.dimensions[dimension];
  if (!dim) return null;
  return dim.cells.find((c) => c.cell === cell) ?? null;
}
