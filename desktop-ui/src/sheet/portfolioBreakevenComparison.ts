/**
 * Portfolio break-even comparison.
 *
 * Compares two portfolios side-by-side:
 *  - "mine":     positions currently OPEN in the simulation tab (real positions
 *                the user is holding).
 *  - "sim loop": top-N BUY/ENTRY recommendations the sim loop would execute
 *                today if left running freely.
 *
 * For each portfolio we:
 *  1. group positions by calibration cell (clinicalPhase / sdsBucket /
 *     pplanBucket), using FROZEN feature snapshots when available
 *  2. read the frozen calibration weights (only approved — never live snapshot)
 *  3. compute expected P&L per cell = N × scaled expectancy × shrunk weight
 *     contribution (relative to neutral baseline)
 *  4. aggregate totals
 *  5. compare the total invested capital with the break-even target
 *
 * The break-even target is the capital that pushes P(portfolio close > 0)
 * above `targetProbPct` (default 50%) — see `computeBreakEvenCapital`.
 *
 * NOTE on data sources:
 *  - "Mine" comes from `closedRows` filtered to OPEN positions (no realized PnL).
 *    These are the rows the user actually holds.
 *  - "Sim loop" comes from `simTable` reinterpreted by `buildSuggestionMonitorRows`
 *    keeping only `suggestedAction === "buy"` (the freshly-suggested entries),
 *    capped at `simLoopMaxPositions`.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { InvestSimInputs } from "./investSimStorage";
import {
  clinicalPhaseFromSimRow,
  clinicalIndicationFromSimRow,
} from "./simRowClinicalMeta";
import { buildSimRowByKeyMap, normalizedRowKey } from "./investSimKeys";
import {
  bucketClinicalPhase,
  bucketIndication,
  bucketSds,
  bucketPplan,
} from "./lossAuditAnalysis";
import {
  computeBreakEvenCapital,
  type TradeOutcomeStats,
  type BreakEvenCapital,
} from "./portfolioDiversificationLab";
import {
  freezeFeaturesIfMissing,
  getFrozenFeatures,
} from "../calibration/featureSnapshotStore";
import { loadFrozenWeights } from "../calibration/proposalStore";
import {
  type CalibrationDimension,
  type ConfidenceLevel,
  type FrozenWeights,
} from "../calibration/calibrationTypes";

// ── Types ─────────────────────────────────────────────────────────────────

export type PortfolioPositionSummary = {
  ticker: string;
  rowKey: string;
  capitalEur: number;
  /** Bucket per dimensione calibrata (frozen feature snapshot). */
  cells: Record<CalibrationDimension, string>;
  /** Win rate atteso da frozen weights (media pesata sui 4 dim, neutro se mancanti). */
  expectedWinRate: number;
  /** Min confidence delle 4 dimensioni — quanto fidarsi della stima. */
  weakestConfidence: ConfidenceLevel;
  /** Expected P&L per questa posizione. */
  expectedPnlEur: number;
};

export type DimensionBreakdownRow = {
  dimension: CalibrationDimension;
  cell: string;
  /** Frozen weight (win rate) for this cell, or null when no frozen entry. */
  frozenWeight: number | null;
  frozenN: number;
  frozenConfidence: ConfidenceLevel | null;
  mine: {
    positions: number;
    capitalEur: number;
    expectedPnlEur: number;
  };
  simLoop: {
    positions: number;
    capitalEur: number;
    expectedPnlEur: number;
  };
};

export type PortfolioTotals = {
  positions: number;
  capitalEur: number;
  expectedPnlEur: number;
  /** Mean expected win rate weighted by capital. */
  avgWinRate: number;
};

export type PortfolioComparisonResult = {
  /** Stats di base usate per derivare expectancy e break-even. */
  stats: TradeOutcomeStats;
  /** Capital break-even target (single source of truth). */
  breakEven: BreakEvenCapital;
  /** Per-position rollup (mine and sim loop separately). */
  minePositions: PortfolioPositionSummary[];
  simLoopPositions: PortfolioPositionSummary[];
  /** Per-cell breakdown across both portfolios. */
  rows: DimensionBreakdownRow[];
  mineTotals: PortfolioTotals;
  simLoopTotals: PortfolioTotals;
  /** True when no frozen weights are approved yet — the comparison degrades to neutral. */
  weightsNeutral: boolean;
};

// ── Helpers ───────────────────────────────────────────────────────────────

const NEUTRAL_WIN_RATE = 0.5;

function isOpen(r: SimOutcomeRow): boolean {
  // Position counts as OPEN when no realized PnL is known yet.
  if (r.pnl_pct == null || !Number.isFinite(r.pnl_pct)) return true;
  // Or explicit flag from sim loop side.
  if ((r as { decision_current_open?: boolean }).decision_current_open === true) {
    return true;
  }
  return false;
}

/** Best confidence is the weakest one across 4 dimensions (cautious). */
function weakerConfidence(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[a] <= rank[b] ? a : b;
}

function expectedWinRateFromCells(
  cells: Record<CalibrationDimension, string>,
  frozen: FrozenWeights,
): { rate: number; conf: ConfidenceLevel } {
  let sum = 0;
  let count = 0;
  let conf: ConfidenceLevel = "high";
  for (const dim of Object.keys(cells) as CalibrationDimension[]) {
    const entry = frozen.weights[dim]?.[cells[dim]];
    if (entry) {
      sum += entry.weight;
      count += 1;
      conf = weakerConfidence(conf, entry.confidence);
    } else {
      // unfrozen dim → neutral, but mark as low confidence
      sum += NEUTRAL_WIN_RATE;
      count += 1;
      conf = weakerConfidence(conf, "low");
    }
  }
  return {
    rate: count > 0 ? sum / count : NEUTRAL_WIN_RATE,
    conf,
  };
}

/** Snapshot helper for a row, using frozen features if available. */
function cellsForRow(
  row: SimOutcomeRow,
  ctx: {
    simRowByKey: Map<string, Record<string, unknown>>;
    sdsByTicker: Map<string, SdsRow>;
  },
): Record<CalibrationDimension, string> {
  const key = normalizedRowKey(row.ticker, row.completion_date);
  const simRow = ctx.simRowByKey.get(key);
  const livePhase = simRow ? clinicalPhaseFromSimRow(simRow) : "";
  const liveIndication = simRow ? clinicalIndicationFromSimRow(simRow, 200) : "";
  const liveSds = ctx.sdsByTicker.get(row.ticker.toUpperCase())?.sds ?? null;
  const pplanPct =
    (row as { entry_affidabilita_pct?: number | null }).entry_affidabilita_pct ??
    row.affidabilita_pct ??
    null;
  let frozen = getFrozenFeatures(key);
  if (!frozen) {
    frozen = freezeFeaturesIfMissing(key, {
      sds: liveSds,
      clinicalPhase: livePhase || null,
      clinicalIndication: liveIndication || null,
      pplanPct,
    });
  }
  return {
    clinicalPhase: bucketClinicalPhase(frozen.clinicalPhase ?? ""),
    clinicalIndication: bucketIndication(frozen.clinicalIndication ?? ""),
    sdsBucket: bucketSds(frozen.sds),
    pplanBucket: bucketPplan(pplanPct),
  };
}

// ── Sim loop portfolio derivation ─────────────────────────────────────────

/**
 * Build the "sim loop portfolio" — synthetic positions representing what the
 * sim loop would hold if it executed all current BUY suggestions.
 *
 * We materialize them as SimOutcomeRow-shaped objects with no realized PnL
 * and capitalEur = `inputs.capitalPerPosition` (sim loop default), keyed by
 * the simTable ticker + completion_date.
 *
 * Picks the top `maxPositions` by `probPct` (descending).
 */
function buildSimLoopOpenRows(args: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  maxPositions: number;
  defaultCapital: number;
}): SimOutcomeRow[] {
  if (!args.simTable?.rows?.length) return [];
  const out: Array<{ row: SimOutcomeRow; prob: number }> = [];
  for (const r of args.simTable.rows) {
    // Heuristics to decide if this row is a BUY-eligible suggestion right now.
    const prob = Number(r.Plan_Prob_Pct);
    if (!Number.isFinite(prob) || prob <= 0) continue;
    // Skip rows where completion date is missing — we need it as part of row_key
    const cd =
      (r["Catalyst Date"] as string) ??
      (r["CD"] as string) ??
      (r["Completion Date"] as string) ??
      "";
    if (!cd) continue;
    const ticker =
      (r.Ticker as string) ?? (r.ticker as string) ?? (r["Symbol"] as string);
    if (!ticker) continue;
    const rowKey = `${ticker}|${cd}`;
    // Use per-row capital from invest sim inputs if present and positive,
    // else fall back to the historical average capital from stats.
    const entryCap = args.inputs?.[rowKey]?.capital;
    const cap =
      entryCap != null && Number.isFinite(entryCap) && entryCap > 0
        ? entryCap
        : args.defaultCapital;
    if (!Number.isFinite(cap) || cap <= 0) continue;
    const fakeRow: SimOutcomeRow = {
      row_key: rowKey,
      ticker,
      completion_date: cd,
      days_to_cd: Number(r["Days to CD"] ?? r["Days"]) || 0,
      cd_passed: false,
      timing_bucket: "pre_cd",
      timing_label: "Pre-CD (sim loop)",
      capital_eur: cap,
      pnl_eur: null,
      pnl_pct: null,
      outcome: "open",
      outcome_label: "Open (sim loop)",
      is_win: false,
      affidabilita_pct: prob,
    } as SimOutcomeRow;
    out.push({ row: fakeRow, prob });
  }
  out.sort((a, b) => b.prob - a.prob);
  return out.slice(0, args.maxPositions).map((x) => x.row);
}

// ── Main API ──────────────────────────────────────────────────────────────

export type BuildComparisonArgs = {
  /** All closed + open rows from the user's sim tab. */
  allRows: SimOutcomeRow[];
  /** Sim table for sim loop derivation + phase/indication metadata. */
  simTable?: SheetTable | null;
  /** Sim loop inputs (per-position capital default). */
  inputs?: InvestSimInputs | null;
  /** SDS rows for SDS bucketing. */
  sdsRows?: SdsRow[] | null;
  /** Trade stats already computed by the panel (avoids recomputation). */
  stats: TradeOutcomeStats;
  /** Target P(positive) for the break-even calculation. Default 50%. */
  targetProbPct?: number;
  /** Maximum number of BUY suggestions to include as sim loop portfolio. */
  simLoopMaxPositions?: number;
};

export function buildPortfolioComparison(
  args: BuildComparisonArgs,
): PortfolioComparisonResult {
  // 1. Resolve break-even
  const breakEven = computeBreakEvenCapital(args.stats, {
    targetProbPct: args.targetProbPct ?? 50,
    capitalPerPositionEur: args.stats.avgCapitalEur,
  });

  // 2. Materialize the two portfolios as SimOutcomeRow[]
  const mineRows = args.allRows.filter((r) => isOpen(r) && (r.capital_eur ?? 0) > 0);

  const simLoopMax = args.simLoopMaxPositions ?? breakEven.positions ?? 12;
  const simLoopRows = buildSimLoopOpenRows({
    simTable: args.simTable ?? null,
    inputs: args.inputs ?? ({} as InvestSimInputs),
    maxPositions: simLoopMax,
    defaultCapital: args.stats.avgCapitalEur,
  });

  // 3. Pre-compute lookup ctx for both portfolios
  const simRowByKey = args.simTable
    ? buildSimRowByKeyMap(args.simTable.rows ?? [])
    : new Map<string, Record<string, unknown>>();
  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of args.sdsRows ?? []) {
    if (s.ticker) sdsByTicker.set(s.ticker.toUpperCase(), s);
  }
  const ctx = { simRowByKey, sdsByTicker };

  // 4. Load frozen weights (approved only)
  const frozen = loadFrozenWeights();
  const weightsNeutral =
    (Object.keys(frozen.weights) as CalibrationDimension[]).every(
      (d) => Object.keys(frozen.weights[d]).length === 0,
    );

  // 5. Per-position summary helper
  const summarize = (
    rows: SimOutcomeRow[],
    label: "mine" | "simLoop",
  ): PortfolioPositionSummary[] =>
    rows.map((r) => {
      const cells = cellsForRow(r, ctx);
      const { rate, conf } = expectedWinRateFromCells(cells, frozen);
      // Scale expectancy linearly with the cell's expected win rate vs neutral.
      // expectancyEurPerTrade is computed at the historical avg win rate. We
      // adjust by the ratio cellRate / historicalRate, bounded [0.4, 1.6].
      const histRate = args.stats.winRate || NEUTRAL_WIN_RATE;
      const ratio = Math.max(0.4, Math.min(1.6, rate / histRate));
      const expectedPnl = args.stats.expectancyEurPerTrade * ratio;
      void label;
      return {
        ticker: r.ticker,
        rowKey: r.row_key,
        capitalEur: r.capital_eur ?? 0,
        cells,
        expectedWinRate: rate,
        weakestConfidence: conf,
        expectedPnlEur: expectedPnl,
      };
    });

  const minePositions = summarize(mineRows, "mine");
  const simLoopPositions = summarize(simLoopRows, "simLoop");

  // 6. Per-cell rollup across both portfolios
  type CellKey = string; // `${dim}::${cell}`
  type CellAcc = {
    dim: CalibrationDimension;
    cell: string;
    mineN: number;
    mineCap: number;
    minePnl: number;
    simN: number;
    simCap: number;
    simPnl: number;
  };
  const acc = new Map<CellKey, CellAcc>();
  const ensureCell = (dim: CalibrationDimension, cell: string): CellAcc => {
    const key = `${dim}::${cell}`;
    let a = acc.get(key);
    if (!a) {
      a = { dim, cell, mineN: 0, mineCap: 0, minePnl: 0, simN: 0, simCap: 0, simPnl: 0 };
      acc.set(key, a);
    }
    return a;
  };
  for (const p of minePositions) {
    for (const dim of Object.keys(p.cells) as CalibrationDimension[]) {
      const a = ensureCell(dim, p.cells[dim]);
      a.mineN += 1;
      a.mineCap += p.capitalEur;
      // Per-cell contribution is shared evenly across 4 dimensions to avoid
      // quadruple counting expected PnL.
      a.minePnl += p.expectedPnlEur / 4;
    }
  }
  for (const p of simLoopPositions) {
    for (const dim of Object.keys(p.cells) as CalibrationDimension[]) {
      const a = ensureCell(dim, p.cells[dim]);
      a.simN += 1;
      a.simCap += p.capitalEur;
      a.simPnl += p.expectedPnlEur / 4;
    }
  }

  const rows: DimensionBreakdownRow[] = Array.from(acc.values()).map((a) => {
    const fe = frozen.weights[a.dim]?.[a.cell];
    return {
      dimension: a.dim,
      cell: a.cell,
      frozenWeight: fe?.weight ?? null,
      frozenN: fe?.n ?? 0,
      frozenConfidence: fe?.confidence ?? null,
      mine: {
        positions: a.mineN,
        capitalEur: a.mineCap / 4, // averaged across 4 dims so totals add up
        expectedPnlEur: a.minePnl,
      },
      simLoop: {
        positions: a.simN,
        capitalEur: a.simCap / 4,
        expectedPnlEur: a.simPnl,
      },
    };
  });
  // Sort by dim → confidence (high first) → n desc → cell
  const dimOrder: Record<CalibrationDimension, number> = {
    clinicalPhase: 0,
    clinicalIndication: 1,
    sdsBucket: 2,
    pplanBucket: 3,
  };
  const confOrder: Record<ConfidenceLevel, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  rows.sort((a, b) => {
    if (dimOrder[a.dimension] !== dimOrder[b.dimension]) {
      return dimOrder[a.dimension] - dimOrder[b.dimension];
    }
    const ca = a.frozenConfidence ?? "low";
    const cb = b.frozenConfidence ?? "low";
    if (confOrder[ca] !== confOrder[cb]) return confOrder[ca] - confOrder[cb];
    if (a.frozenN !== b.frozenN) return b.frozenN - a.frozenN;
    return a.cell.localeCompare(b.cell);
  });

  // 7. Totals (sum of per-position metrics, NOT of per-cell rollup, to avoid drift)
  const totalsFor = (ps: PortfolioPositionSummary[]): PortfolioTotals => {
    const cap = ps.reduce((s, p) => s + p.capitalEur, 0);
    const pnl = ps.reduce((s, p) => s + p.expectedPnlEur, 0);
    const weightedWin =
      cap > 0
        ? ps.reduce((s, p) => s + p.expectedWinRate * p.capitalEur, 0) / cap
        : NEUTRAL_WIN_RATE;
    return {
      positions: ps.length,
      capitalEur: cap,
      expectedPnlEur: pnl,
      avgWinRate: weightedWin,
    };
  };

  return {
    stats: args.stats,
    breakEven,
    minePositions,
    simLoopPositions,
    rows,
    mineTotals: totalsFor(minePositions),
    simLoopTotals: totalsFor(simLoopPositions),
    weightsNeutral,
  };
}
