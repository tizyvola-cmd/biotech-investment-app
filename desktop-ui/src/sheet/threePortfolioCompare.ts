/**
 * Three-portfolio comparison (Capital & Diversification, top of tab).
 *
 * Compares three hypothetical portfolios at the SAME total capital pot:
 *   A) "mine"           — user's real open positions in the Simulation tab,
 *                         split EQUALLY across positions.
 *   B) "simLoopEqual"   — sim loop universe (open paper book + BUY-eligible
 *                         recommendations), split EQUALLY.
 *   C) "simLoopWeighted"— same sim loop universe, split in PROPORTION to the
 *                         calibrated win rate (≈ 1 − loss risk).
 *
 * "Gain" is the EXPECTED P&L for all three (apples-to-apples) computed as:
 *
 *     EV_i = cap_i × ( winRate_i × payoffWinPct_i +
 *                      (1 − winRate_i) × payoffLossPct_i )
 *
 * where:
 *   - winRate_i = pickBestCellEstimate(snapshot, deal.cells).shrinkageApplied
 *                 (fallback: 0.5 neutral)
 *   - (payoffWinPct, payoffLossPct) = payoffForSdsBucket(deal.cells.sdsBucket,
 *                                     sdsGainBreakdown) — same fallback as
 *                                     the breakeven widget.
 *
 * This module is PURE: no React, no localStorage. Unit-testable in isolation.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { ChartPoint, SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type {
  CalibrationDimension,
  CalibrationSnapshot,
  ConfidenceLevel,
} from "../calibration/calibrationTypes";
import type { InvestSimInputs } from "./investSimStorage";
import type { SdsGainBreakdown } from "./sdsGainBreakdown";
import { bucketClinicalPhase, bucketIndication, bucketPplan, bucketSds } from "./lossAuditAnalysis";
import {
  clinicalIndicationFromSimRow,
  clinicalPhaseFromSimRow,
} from "./simRowClinicalMeta";
import { buildSimRowByKeyMap, normalizedRowKey } from "./investSimKeys";
import { rowHasActivePortfolio } from "./simulationPosition";
import { buildSuggestionMonitorRows, type SuggestionMonitorRow } from "./suggestionMonitor";
import {
  computeDealLossRisk,
  lossRiskInvestmentScore,
  pickBestCellEstimate,
  payoffForSdsBucket,
  DEFAULT_FRICTION_THRESHOLDS,
  type DealLossRisk,
} from "./portfolioSizingWidget";
import type { PhaseAResult, RiskPattern } from "../riskPattern/riskPatternTypes";
import type { PaperPosition } from "./investDecisionSimLoop";
import { sanitizePaperMovePct } from "./investDecisionSimExperiment";
import { harmonizeAllocationRealized } from "./portfolioScenarioGain";

/**
 * Sizing weights used by `allocateRiskWeighted`. Same numbers as
 * `DEFAULT_WEIGHTED_SIZING_CONFIG` in ./portfolioWeightedSizing.ts — kept
 * local here only to avoid an import cycle (portfolioWeightedSizing already
 * imports ComparisonDeal from this file). Keep in sync if you re-tune one.
 */
const DEFAULT_CONFIDENCE_MULT_LOCAL: Record<ConfidenceLevel, number> = {
  low: DEFAULT_FRICTION_THRESHOLDS.low,
  medium: DEFAULT_FRICTION_THRESHOLDS.medium,
  high: DEFAULT_FRICTION_THRESHOLDS.high,
};
const DEFAULT_PATTERN_PENALTY_LOCAL = 0.5;

// ── Types ─────────────────────────────────────────────────────────────────

export type PortfolioScenarioKind = "mine" | "simLoopEqual" | "simLoopWeighted";

export type ComparisonDeal = {
  ticker: string;
  rowKey: string;
  /** Display label for the table cell (e.g. "ABCD · Phase 2"). */
  label: string;
  cells: Record<CalibrationDimension, string>;
  /** Numeric SDS score (0-100 typ.) when available — null when the ticker is
   *  not in `sdsByTicker` or has no SDS yet. UI uses this for the SDS column. */
  sdsValue: number | null;
  /** Win rate (shrunk) from best calibration cell, or neutral 0.5 if missing. */
  winRate: number;
  /** Raw observed win rate (no Bayesian shrinkage) — use for joint P(+) without calibration. */
  rawWinRate: number;
  /** Confidence of the win rate source. */
  confidence: ConfidenceLevel;
  /** Dimension that provided the win rate (for UI tooltip). */
  winRateDimension: CalibrationDimension | null;
  /** N of the cell that provided the win rate. */
  winRateN: number;
  /** Average win % (positive). */
  payoffWinPct: number;
  /** Average loss % (negative). */
  payoffLossPct: number;
  /** "step1" if from sdsGainBreakdown, "fallback" if defaults applied. */
  payoffSource: "step1" | "fallback";
  /** Phase A + Phase B loss-risk profile (null when neither phaseA nor an
   *  approved pattern is provided, or the deal has no risk signal). */
  lossRisk: DealLossRisk | null;
  /** 0-100 combined investment-risk score (higher = riskier). null when no
   *  risk signal is available — the UI must render "—" rather than 50. */
  riskScore: number | null;
  /** Current mark-to-market P&L % for this deal (per-€). Sourced from the
   *  suggestion-monitor pipeline so it matches the Decision Lab table and
   *  the Simulation P&L cards. `null` when the deal is not currently held
   *  in either the real portfolio or the paper sim loop (no realized P&L
   *  to attribute yet). */
  realizedReturnPct: number | null;
  /** Last-24h move % for this deal (per-€). Same source as `realizedReturnPct`
   *  but for the latest day only — feeds the "24h cumulative gain" chart so
   *  the user can compare per-scenario momentum independent of the all-time
   *  MTM. `null` when no daily move is available. */
  realizedReturnPct24h: number | null;
};

/**
 * Per-deal breakdown of the weighted sizing score. Populated only for the
 * `simLoopWeighted` allocation; for equal-split scenarios it stays empty.
 * Same shape (sub-set) of `DealSizingBreakdown` in portfolioWeightedSizing.ts —
 * kept local to avoid an import cycle. Surfaced so the table can show *why*
 * each deal got its capital share.
 */
export type WeightedSizingBreakdown = {
  ticker: string;
  rowKey: string;
  /** Probability-weighted expected gain per € invested, in fractional units
   *  (e.g. 0.024 = +2.4 %). Always ≥ 0 (zero when payoffWinPct is missing). */
  evPerEur: number;
  rawScore: number;
  confidence: ConfidenceLevel;
  confidenceMultiplier: number;
  matchesStep2Pattern: boolean;
  patternPenaltyFactor: number;
  /** rawScore × confidenceMultiplier × patternPenaltyFactor. Drives the
   *  proportional sizing — bigger adjustedScore = bigger capital share. */
  adjustedScore: number;
  /** Capital share in [0, 1]. Sums to 1 across all deals in the allocation
   *  (or 0 if every deal had adjustedScore == 0 and we fell back to uniform). */
  sizeShare: number;
};

export type PortfolioAllocation = {
  /** Map ticker → capital €. */
  capByTicker: Record<string, number>;
  /** Map ticker → expected P&L €. */
  evByTicker: Record<string, number>;
  /** Map ticker → current mark-to-market P&L € given this scenario's capital
   *  split. Computed as `cap × realizedReturnPct / 100`, with 0 for deals
   *  whose `realizedReturnPct` is null (not yet entered anywhere). */
  realizedEurByTicker: Record<string, number>;
  /** Sum of cap. Always equals (or ≤) totalCapitalEur. */
  totalCapitalEur: number;
  /** Sum of EV. */
  totalEvEur: number;
  /** Sum of realized P&L €. This is the headline number shown in the
   *  comparison chart and harmonized with the Daily / Cumulative P&L
   *  progression charts (same MTM basis). */
  totalRealizedEur: number;
  /** N positions with cap > 0. */
  positionsCount: number;
  /** N positions among `positionsCount` that have a non-null realized return
   *  (i.e. are actually held somewhere and contribute to `totalRealizedEur`).
   *  Useful for the UI to flag "X of Y deals contributing to the realized P&L". */
  realizedPositionsCount: number;
  /** True only for the weighted allocation when the uniform fallback kicked
   *  in (every deal had adjustedScore = 0 → equal split as last resort). */
  uniformFallbackActive?: boolean;
  /** Per-ticker sizing breakdown. Populated only for weighted allocations;
   *  remains undefined for `allocateEqual`. */
  breakdownByTicker?: Record<string, WeightedSizingBreakdown>;
};

export type ThreePortfolioComparison = {
  /** Same total capital pot used for all three scenarios. */
  totalCapitalEur: number;
  /** All unique deals across all three universes (mine + sim loop). */
  allDeals: ComparisonDeal[];
  /** Subset of allDeals that are in "mine" universe (open positions). */
  mineDeals: ComparisonDeal[];
  /** Subset of allDeals that are in "sim loop" universe. */
  simLoopDeals: ComparisonDeal[];
  /** Allocation for each scenario. */
  mine: PortfolioAllocation;
  simLoopEqual: PortfolioAllocation;
  simLoopWeighted: PortfolioAllocation;
};

// ── Helpers ───────────────────────────────────────────────────────────────

const NEUTRAL_WIN_RATE = 0.5;

function cellsForSimRow(
  rec: Record<string, unknown>,
  ticker: string,
  sdsByTicker: Map<string, SdsRow>,
  pplanOverride: number | null,
): Record<CalibrationDimension, string> {
  const phaseRaw = clinicalPhaseFromSimRow(rec);
  const indRaw = clinicalIndicationFromSimRow(rec, 200);
  const sds = sdsByTicker.get(ticker.toUpperCase())?.sds ?? null;
  return {
    clinicalPhase: bucketClinicalPhase(phaseRaw),
    clinicalIndication: bucketIndication(indRaw),
    sdsBucket: bucketSds(sds),
    pplanBucket: bucketPplan(
      pplanOverride != null && Number.isFinite(pplanOverride) ? pplanOverride : null,
    ),
  };
}

function enrichOneDeal(
  rowKey: string,
  ticker: string,
  cells: Record<CalibrationDimension, string>,
  ctx: {
    snapshot: CalibrationSnapshot | null;
    sdsBreakdown: SdsGainBreakdown | null;
    phaseA: PhaseAResult | null;
    approvedPattern: RiskPattern | null;
    sdsValue: number | null;
    realizedReturnPct: number | null;
    realizedReturnPct24h: number | null;
  },
): ComparisonDeal {
  let winRate = NEUTRAL_WIN_RATE;
  let rawWinRate = NEUTRAL_WIN_RATE;
  let confidence: ConfidenceLevel = "low";
  let winRateDimension: CalibrationDimension | null = null;
  let winRateN = 0;
  if (ctx.snapshot) {
    const picked = pickBestCellEstimate(ctx.snapshot, cells);
    if (picked) {
      winRate = picked.estimate.shrinkageApplied;
      rawWinRate = picked.estimate.rawObserved;
      confidence = picked.estimate.confidence;
      winRateDimension = picked.dimension;
      winRateN = picked.estimate.n;
    }
  }
  const payoff = payoffForSdsBucket(cells.sdsBucket ?? "No SDS", ctx.sdsBreakdown);
  const label = `${ticker} · ${cells.clinicalPhase || "—"}`;

  // Loss-risk + investment-risk score. We delegate to the widget's pure
  // function so the score on the comparison table matches the score under
  // each slider in the interactive widget (single source of truth).
  let lossRisk: DealLossRisk | null = null;
  if (ctx.phaseA || ctx.approvedPattern) {
    lossRisk = computeDealLossRisk(
      { ticker, displayLabel: label, cells },
      ctx.phaseA,
      ctx.approvedPattern,
    );
  }
  const riskScore = lossRiskInvestmentScore(lossRisk);

  return {
    ticker,
    rowKey,
    label,
    cells,
    sdsValue: ctx.sdsValue,
    winRate,
    rawWinRate,
    confidence,
    winRateDimension,
    winRateN,
    payoffWinPct: payoff.winPct,
    payoffLossPct: payoff.lossPct,
    payoffSource: payoff.source,
    lossRisk,
    riskScore,
    realizedReturnPct: ctx.realizedReturnPct,
    realizedReturnPct24h: ctx.realizedReturnPct24h,
  };
}

/** Build a single ComparisonDeal for loss-risk / Risk & Benefit UI surfaces.
 *  Used when a row is outside the three-portfolio BUY/mine universes (e.g.
 *  WAIT opportunities in the KPI snapshot table). */
export function buildComparisonDealForLossRisk(
  rowKey: string,
  ticker: string,
  simRow: Record<string, unknown> | null | undefined,
  pplanOverride: number | null,
  ctx: {
    sdsByTicker: Map<string, SdsRow>;
    snapshot: CalibrationSnapshot | null;
    sdsBreakdown: SdsGainBreakdown | null;
    phaseA: PhaseAResult | null;
    approvedPattern: RiskPattern | null;
    realizedReturnPct?: number | null;
    realizedReturnPct24h?: number | null;
  },
): ComparisonDeal {
  const t = String(ticker).toUpperCase();
  const cells = simRow
    ? cellsForSimRow(simRow, t, ctx.sdsByTicker, pplanOverride)
    : {
        clinicalPhase: "Unknown",
        clinicalIndication: "Unknown",
        sdsBucket: "No SDS",
        pplanBucket: "P(plan) n/a",
      };
  const sdsValue = ctx.sdsByTicker.get(t)?.sds ?? null;
  return enrichOneDeal(rowKey, t, cells, {
    snapshot: ctx.snapshot,
    sdsBreakdown: ctx.sdsBreakdown,
    phaseA: ctx.phaseA,
    approvedPattern: ctx.approvedPattern,
    sdsValue,
    realizedReturnPct: ctx.realizedReturnPct ?? null,
    realizedReturnPct24h: ctx.realizedReturnPct24h ?? null,
  });
}

/** EV per € invested = winRate × winPct − (1−winRate) × |lossPct|, in fractional pct. */
export function evPerEur(deal: ComparisonDeal): number {
  // payoffLossPct is negative; the formula uses winPct positive and lossPct negative.
  // EV_pct = wr × winPct + (1−wr) × lossPct  → that's a percent number (e.g. +3.5).
  const evPct = deal.winRate * deal.payoffWinPct + (1 - deal.winRate) * deal.payoffLossPct;
  return evPct / 100;
}

/**
 * Realized return per € invested for this deal — derived from the current
 * mark-to-market P&L percent. Returns 0 (no contribution) when the deal has
 * never been entered anywhere, so the running total stays well-defined even
 * for the sim-loop universe (which may include freshly-suggested BUYs that
 * the loop hasn't yet bought). Returning 0 (instead of null) keeps the
 * scenario totals additive and the bar chart fully populated.
 */
export function realizedReturnPerEur(deal: ComparisonDeal): number {
  if (deal.realizedReturnPct == null || !Number.isFinite(deal.realizedReturnPct)) return 0;
  return deal.realizedReturnPct / 100;
}

/** Last-24h realized return per € invested. Same null-safe semantics as above. */
export function realizedReturn24hPerEur(deal: ComparisonDeal): number {
  if (deal.realizedReturnPct24h == null || !Number.isFinite(deal.realizedReturnPct24h)) {
    return 0;
  }
  return deal.realizedReturnPct24h / 100;
}

// ── Universe selection ────────────────────────────────────────────────────

/**
 * Select the user's real OPEN positions (mine universe).
 *
 * Preferred path: scan `simTable.rows` and filter via `rowHasActivePortfolio`
 * — the canonical "open position" detection used by the Simulation tab,
 * Decision Lab and all other parts of the app. This requires `inputs`.
 *
 * Fallback (when inputs are missing): try `closedRows` with pnl_pct == null,
 * which is the legacy heuristic. Most callers should pass `inputs`.
 */
function selectMineDeals(
  closedRows: SimOutcomeRow[],
  ctx: {
    simTable: SheetTable | null | undefined;
    inputs: InvestSimInputs | undefined;
    monitorByKey: Map<string, SuggestionMonitorRow>;
    simRowByKey: Map<string, Record<string, unknown>>;
    sdsByTicker: Map<string, SdsRow>;
    snapshot: CalibrationSnapshot | null;
    sdsBreakdown: SdsGainBreakdown | null;
    phaseA: PhaseAResult | null;
    approvedPattern: RiskPattern | null;
  },
): ComparisonDeal[] {
  const seen = new Set<string>();
  const out: ComparisonDeal[] = [];

  // Primary path: simTable + inputs → rowHasActivePortfolio.
  if (ctx.simTable?.rows?.length && ctx.inputs) {
    for (const rec of ctx.simTable.rows) {
      if (!rowHasActivePortfolio(rec as Record<string, unknown>, ctx.inputs)) continue;
      const tickerRaw = String(
        (rec as Record<string, unknown>).Ticker ??
          (rec as Record<string, unknown>).ticker ??
          "",
      );
      if (!tickerRaw) continue;
      const ticker = tickerRaw.toUpperCase();
      const cd =
        (rec["Completion Date"] as string) ??
        (rec["Catalyst Date"] as string) ??
        (rec["CD"] as string) ??
        "";
      const rowKey = normalizedRowKey(ticker, cd);
      if (seen.has(rowKey)) continue;
      seen.add(rowKey);
      const monitor = ctx.monitorByKey.get(rowKey);
      const pplan = monitor?.probPct ?? null;
      const realizedReturnPct =
        monitor?.pnlPct != null && Number.isFinite(monitor.pnlPct) ? monitor.pnlPct : null;
      const realizedReturnPct24h =
        monitor?.pnlPct24h != null && Number.isFinite(monitor.pnlPct24h) ? monitor.pnlPct24h : null;
      const cells = cellsForSimRow(
        rec as Record<string, unknown>,
        ticker,
        ctx.sdsByTicker,
        pplan,
      );
      const sdsValue = ctx.sdsByTicker.get(ticker)?.sds ?? null;
      out.push(
        enrichOneDeal(rowKey, ticker, cells, {
          snapshot: ctx.snapshot,
          sdsBreakdown: ctx.sdsBreakdown,
          phaseA: ctx.phaseA,
          approvedPattern: ctx.approvedPattern,
          sdsValue,
          realizedReturnPct,
          realizedReturnPct24h,
        }),
      );
    }
    return out;
  }

  // Fallback (legacy): scan closedRows for unrealized PnL rows.
  for (const r of closedRows) {
    if (r.pnl_pct != null && Number.isFinite(r.pnl_pct)) continue;
    if (!r.ticker) continue;
    const ticker = String(r.ticker).toUpperCase();
    const rowKey = normalizedRowKey(r.ticker, r.completion_date);
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    const simRow = ctx.simRowByKey.get(rowKey);
    const monitor = ctx.monitorByKey.get(rowKey);
    const pplan = monitor?.probPct ?? null;
    const realizedReturnPct =
      monitor?.pnlPct != null && Number.isFinite(monitor.pnlPct) ? monitor.pnlPct : null;
    const realizedReturnPct24h =
      monitor?.pnlPct24h != null && Number.isFinite(monitor.pnlPct24h) ? monitor.pnlPct24h : null;
    const cells = simRow
      ? cellsForSimRow(simRow, ticker, ctx.sdsByTicker, pplan)
      : {
          clinicalPhase: "Unknown",
          clinicalIndication: "Unknown",
          sdsBucket: "No SDS",
          pplanBucket: "P(plan) n/a",
        };
    const sdsValue = ctx.sdsByTicker.get(ticker)?.sds ?? null;
    out.push(
      enrichOneDeal(rowKey, ticker, cells, {
        snapshot: ctx.snapshot,
        sdsBreakdown: ctx.sdsBreakdown,
        phaseA: ctx.phaseA,
        approvedPattern: ctx.approvedPattern,
        sdsValue,
        realizedReturnPct,
        realizedReturnPct24h,
      }),
    );
  }
  return out;
}

function resolveSimLoopReturnPct(
  rowKey: string,
  paperByKey: Map<string, PaperPosition>,
  monitorPct: number | null | undefined,
  monitorPct24h: number | null | undefined,
): { realizedReturnPct: number | null; realizedReturnPct24h: number | null } {
  const paper = paperByKey.get(rowKey);
  const paperPct = paper ? sanitizePaperMovePct(paper.lastMarkPct) : null;
  const realizedReturnPct =
    paperPct ??
    (monitorPct != null && Number.isFinite(monitorPct) ? monitorPct : null);
  const realizedReturnPct24h =
    monitorPct24h != null && Number.isFinite(monitorPct24h) ? monitorPct24h : null;
  return { realizedReturnPct, realizedReturnPct24h };
}

function pushSimLoopDeal(
  rowKey: string,
  ticker: string,
  seen: Set<string>,
  out: ComparisonDeal[],
  ctx: {
    simRowByKey: Map<string, Record<string, unknown>>;
    sdsByTicker: Map<string, SdsRow>;
    snapshot: CalibrationSnapshot | null;
    sdsBreakdown: SdsGainBreakdown | null;
    phaseA: PhaseAResult | null;
    approvedPattern: RiskPattern | null;
    paperByKey: Map<string, PaperPosition>;
    monitorByKey: Map<string, SuggestionMonitorRow>;
    pplanOverride?: number | null;
  },
): void {
  if (seen.has(rowKey)) return;
  seen.add(rowKey);
  const monitor = ctx.monitorByKey.get(rowKey);
  const simRow = ctx.simRowByKey.get(rowKey);
  const cells = simRow
    ? cellsForSimRow(simRow, ticker, ctx.sdsByTicker, ctx.pplanOverride ?? monitor?.probPct ?? null)
    : {
        clinicalPhase: "Unknown",
        clinicalIndication: "Unknown",
        sdsBucket: "No SDS",
        pplanBucket: "P(plan) n/a",
      };
  const sdsValue = ctx.sdsByTicker.get(ticker)?.sds ?? null;
  const { realizedReturnPct, realizedReturnPct24h } = resolveSimLoopReturnPct(
    rowKey,
    ctx.paperByKey,
    monitor?.pnlPct,
    monitor?.pnlPct24h,
  );
  out.push(
    enrichOneDeal(rowKey, ticker, cells, {
      snapshot: ctx.snapshot,
      sdsBreakdown: ctx.sdsBreakdown,
      phaseA: ctx.phaseA,
      approvedPattern: ctx.approvedPattern,
      sdsValue,
      realizedReturnPct,
      realizedReturnPct24h,
    }),
  );
}

/**
 * Select the "sim loop universe": open paper book positions plus BUY-eligible
 * recommendations from the suggestion monitor (Decision Lab source).
 *
 * Paper positions stay in the universe even when the live action is hold/review
 * — otherwise the chart shows €0 whenever the loop has already bought and is
 * holding. P&L % prefers paper marks over the real-portfolio MTM on the monitor.
 *
 * When the monitor is unavailable we fall back to paper-only, then coarse CD rows.
 */
function selectSimLoopDeals(
  simTable: SheetTable | null | undefined,
  ctx: {
    monitorRows: SuggestionMonitorRow[];
    paperPortfolio?: PaperPosition[];
    simRowByKey: Map<string, Record<string, unknown>>;
    sdsByTicker: Map<string, SdsRow>;
    snapshot: CalibrationSnapshot | null;
    sdsBreakdown: SdsGainBreakdown | null;
    phaseA: PhaseAResult | null;
    approvedPattern: RiskPattern | null;
  },
): ComparisonDeal[] {
  if (!simTable?.rows?.length) return [];
  const seen = new Set<string>();
  const out: ComparisonDeal[] = [];
  const paperByKey = new Map((ctx.paperPortfolio ?? []).map((p) => [p.key, p]));
  const monitorByKey = new Map(ctx.monitorRows.map((m) => [m.key, m]));
  const dealCtx = {
    simRowByKey: ctx.simRowByKey,
    sdsByTicker: ctx.sdsByTicker,
    snapshot: ctx.snapshot,
    sdsBreakdown: ctx.sdsBreakdown,
    phaseA: ctx.phaseA,
    approvedPattern: ctx.approvedPattern,
    paperByKey,
    monitorByKey,
  };

  // Primary path: monitor BUY recs + any open paper position not yet seen.
  if (ctx.monitorRows.length > 0) {
    for (const m of ctx.monitorRows) {
      if (m.suggestedAction !== "buy") continue;
      const ticker = String(m.ticker ?? "").toUpperCase();
      if (!ticker) continue;
      pushSimLoopDeal(m.key, ticker, seen, out, { ...dealCtx, pplanOverride: m.probPct ?? null });
    }
    for (const pos of ctx.paperPortfolio ?? []) {
      const ticker = String(pos.ticker ?? "").toUpperCase();
      if (!ticker) continue;
      pushSimLoopDeal(pos.key, ticker, seen, out, dealCtx);
    }
    return out;
  }

  // Monitor unavailable — paper book only when present.
  for (const pos of ctx.paperPortfolio ?? []) {
    const ticker = String(pos.ticker ?? "").toUpperCase();
    if (!ticker) continue;
    pushSimLoopDeal(pos.key, ticker, seen, out, dealCtx);
  }
  if (out.length > 0) return out;

  // No monitor available — coarse fallback: every row with a CD.
  for (const rec of simTable.rows) {
    const tickerRaw = String(
      (rec as Record<string, unknown>).Ticker ??
        (rec as Record<string, unknown>).ticker ??
        "",
    );
    if (!tickerRaw) continue;
    const ticker = tickerRaw.toUpperCase();
    const cd =
      (rec["Catalyst Date"] as string) ??
      (rec["CD"] as string) ??
      (rec["Completion Date"] as string) ??
      "";
    if (!cd) continue;
    const rowKey = normalizedRowKey(ticker, cd);
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    const cells = cellsForSimRow(rec as Record<string, unknown>, ticker, ctx.sdsByTicker, null);
    const sdsValue = ctx.sdsByTicker.get(ticker)?.sds ?? null;
    out.push(
      enrichOneDeal(rowKey, ticker, cells, {
        snapshot: ctx.snapshot,
        sdsBreakdown: ctx.sdsBreakdown,
        phaseA: ctx.phaseA,
        approvedPattern: ctx.approvedPattern,
        sdsValue,
        realizedReturnPct: null,
        realizedReturnPct24h: null,
      }),
    );
  }
  return out;
}

// ── Allocators ────────────────────────────────────────────────────────────

function emptyAllocation(): PortfolioAllocation {
  return {
    capByTicker: {},
    evByTicker: {},
    realizedEurByTicker: {},
    totalCapitalEur: 0,
    totalEvEur: 0,
    totalRealizedEur: 0,
    positionsCount: 0,
    realizedPositionsCount: 0,
  };
}

/** Equal split: cap_i = totalCapital / N. */
export function allocateEqual(
  deals: ComparisonDeal[],
  totalCapitalEur: number,
): PortfolioAllocation {
  if (deals.length === 0 || totalCapitalEur <= 0) return emptyAllocation();
  const capByTicker: Record<string, number> = {};
  const evByTicker: Record<string, number> = {};
  const realizedEurByTicker: Record<string, number> = {};
  const perDeal = totalCapitalEur / deals.length;
  let evTotal = 0;
  let realizedTotal = 0;
  let realizedPositions = 0;
  for (const d of deals) {
    capByTicker[d.ticker] = perDeal;
    const ev = perDeal * evPerEur(d);
    evByTicker[d.ticker] = ev;
    evTotal += ev;
    const realized = perDeal * realizedReturnPerEur(d);
    realizedEurByTicker[d.ticker] = realized;
    realizedTotal += realized;
    if (d.realizedReturnPct != null && Number.isFinite(d.realizedReturnPct)) {
      realizedPositions += 1;
    }
  }
  return {
    capByTicker,
    evByTicker,
    realizedEurByTicker,
    totalCapitalEur: perDeal * deals.length,
    totalEvEur: evTotal,
    totalRealizedEur: realizedTotal,
    positionsCount: deals.length,
    realizedPositionsCount: realizedPositions,
  };
}

/** Arbitrary share map (rowKey → fraction, need not sum to 1 — renormalised). */
export function allocateFromShares(
  deals: ComparisonDeal[],
  totalCapitalEur: number,
  shareByRowKey: Map<string, number> | Record<string, number>,
): PortfolioAllocation {
  if (deals.length === 0 || totalCapitalEur <= 0) return emptyAllocation();

  const readShare = (rowKey: string): number => {
    const raw =
      shareByRowKey instanceof Map
        ? shareByRowKey.get(rowKey)
        : shareByRowKey[rowKey];
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : 0;
  };

  let sumShares = 0;
  for (const d of deals) sumShares += readShare(d.rowKey);
  if (sumShares <= 0) return allocateEqual(deals, totalCapitalEur);

  const capByTicker: Record<string, number> = {};
  const evByTicker: Record<string, number> = {};
  const realizedEurByTicker: Record<string, number> = {};
  let evTotal = 0;
  let realizedTotal = 0;
  let realizedPositions = 0;
  let capitalTotal = 0;

  for (const d of deals) {
    const share = readShare(d.rowKey) / sumShares;
    const cap = totalCapitalEur * share;
    capByTicker[d.ticker] = cap;
    capitalTotal += cap;
    const ev = cap * evPerEur(d);
    evByTicker[d.ticker] = ev;
    evTotal += ev;
    const realized = cap * realizedReturnPerEur(d);
    realizedEurByTicker[d.ticker] = realized;
    realizedTotal += realized;
    if (d.realizedReturnPct != null && Number.isFinite(d.realizedReturnPct)) {
      realizedPositions += 1;
    }
  }

  return {
    capByTicker,
    evByTicker,
    realizedEurByTicker,
    totalCapitalEur: capitalTotal,
    totalEvEur: evTotal,
    totalRealizedEur: realizedTotal,
    positionsCount: deals.length,
    realizedPositionsCount: realizedPositions,
  };
}

/**
 * EV per € invested at the SDS target — same numerator used by
 * `computeWeightedPortfolioStats` so the two surfaces stay in lockstep.
 * Returns 0 (not negative) when payoffWinPct ≤ 0 or missing — caller treats
 * the value as a non-negative "score per €".
 */
function evPerEurAtTarget(d: ComparisonDeal): number {
  if (!Number.isFinite(d.winRate) || !Number.isFinite(d.payoffWinPct)) return 0;
  if (d.payoffWinPct <= 0) return 0;
  const wr = Math.max(0, Math.min(1, d.winRate));
  return (wr * d.payoffWinPct) / 100;
}

export type RiskWeightedConfig = {
  /** Multiplier in (0, 1] applied per confidence tier. Defaults to the same
   *  thresholds used by the Step 3 chart so the two views stay aligned. */
  confidenceMultipliers?: Record<ConfidenceLevel, number>;
  /** Multiplier in (0, 1] applied to deals matching the approved Phase B
   *  risk pattern (downside hedge). Defaults to 0.5 (halves the weight). */
  patternPenalty?: number;
};

/**
 * Risk-weighted split aligned with the Step 3 breakeven chart:
 *
 *   evPerEur_i      = max(0, winRate_i × payoffWinPct_i / 100)
 *   adjustedScore_i = evPerEur_i × confidenceMultiplier(conf_i) × patternFactor(i)
 *   share_i         = adjustedScore_i / Σ adjustedScore_j
 *   cap_i           = totalCapital × share_i
 *
 * The formula valorises positive-EV deals with HIGH confidence and penalises
 * deals matching the Step 2 risk pattern. When every deal scores 0 (no payoff
 * data anywhere, or every deal matched the risk pattern with patternPenalty=0)
 * we fall back to equal split so the comparison stays well-defined.
 */
export function allocateRiskWeighted(
  deals: ComparisonDeal[],
  totalCapitalEur: number,
  matchesStep2Pattern: (deal: ComparisonDeal) => boolean = () => false,
  config: RiskWeightedConfig = {},
): PortfolioAllocation {
  if (deals.length === 0 || totalCapitalEur <= 0) return emptyAllocation();
  const confMult = config.confidenceMultipliers ?? DEFAULT_CONFIDENCE_MULT_LOCAL;
  const patternPen = config.patternPenalty ?? DEFAULT_PATTERN_PENALTY_LOCAL;

  // Stage 1 — compute the adjustedScore for every deal.
  const stage: Array<{
    deal: ComparisonDeal;
    evPerEur: number;
    rawScore: number;
    confidenceMultiplier: number;
    matches: boolean;
    patternPenaltyFactor: number;
    adjustedScore: number;
  }> = deals.map((d) => {
    const ev = evPerEurAtTarget(d);
    const rawScore = Math.max(0, ev);
    const mult = confMult[d.confidence] ?? DEFAULT_CONFIDENCE_MULT_LOCAL[d.confidence] ?? 1;
    const matches = matchesStep2Pattern(d);
    const patternFactor = matches ? patternPen : 1;
    const adjustedScore = rawScore * mult * patternFactor;
    return {
      deal: d,
      evPerEur: ev,
      rawScore,
      confidenceMultiplier: mult,
      matches,
      patternPenaltyFactor: patternFactor,
      adjustedScore,
    };
  });

  const sumScore = stage.reduce((s, x) => s + x.adjustedScore, 0);

  // Fallback: every deal scored 0 → uniform split + zero-fill the breakdown.
  if (sumScore <= 0) {
    const fallback = allocateEqual(deals, totalCapitalEur);
    const breakdown: Record<string, WeightedSizingBreakdown> = {};
    const share = 1 / deals.length;
    for (const row of stage) {
      breakdown[row.deal.ticker] = {
        ticker: row.deal.ticker,
        rowKey: row.deal.rowKey,
        evPerEur: row.evPerEur,
        rawScore: row.rawScore,
        confidence: row.deal.confidence,
        confidenceMultiplier: row.confidenceMultiplier,
        matchesStep2Pattern: row.matches,
        patternPenaltyFactor: row.patternPenaltyFactor,
        adjustedScore: row.adjustedScore,
        sizeShare: share,
      };
    }
    return {
      ...fallback,
      uniformFallbackActive: true,
      breakdownByTicker: breakdown,
    };
  }

  // Stage 2 — normalise shares, then materialise the allocation.
  const capByTicker: Record<string, number> = {};
  const evByTicker: Record<string, number> = {};
  const realizedEurByTicker: Record<string, number> = {};
  const breakdownByTicker: Record<string, WeightedSizingBreakdown> = {};
  let evTotal = 0;
  let realizedTotal = 0;
  let positions = 0;
  let realizedPositions = 0;
  for (const row of stage) {
    const share = row.adjustedScore / sumScore;
    const cap = totalCapitalEur * share;
    const d = row.deal;
    capByTicker[d.ticker] = cap;
    // Use the symmetric EV (win - loss) for the "expected P&L" column so the
    // Cap × EV-per-€ stays consistent with the existing column semantics.
    const ev = cap * evPerEur(d);
    evByTicker[d.ticker] = ev;
    evTotal += ev;
    const realized = cap * realizedReturnPerEur(d);
    realizedEurByTicker[d.ticker] = realized;
    realizedTotal += realized;
    if (cap > 0) positions += 1;
    if (cap > 0 && d.realizedReturnPct != null && Number.isFinite(d.realizedReturnPct)) {
      realizedPositions += 1;
    }
    breakdownByTicker[d.ticker] = {
      ticker: d.ticker,
      rowKey: d.rowKey,
      evPerEur: row.evPerEur,
      rawScore: row.rawScore,
      confidence: d.confidence,
      confidenceMultiplier: row.confidenceMultiplier,
      matchesStep2Pattern: row.matches,
      patternPenaltyFactor: row.patternPenaltyFactor,
      adjustedScore: row.adjustedScore,
      sizeShare: share,
    };
  }
  return {
    capByTicker,
    evByTicker,
    realizedEurByTicker,
    totalCapitalEur,
    totalEvEur: evTotal,
    totalRealizedEur: realizedTotal,
    positionsCount: positions,
    realizedPositionsCount: realizedPositions,
    uniformFallbackActive: false,
    breakdownByTicker,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────

export type BuildThreePortfolioArgs = {
  closedRows: SimOutcomeRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  /** Live Simulation inputs — required for canonical "open position" detection. */
  inputs?: InvestSimInputs;
  /** Chart points per series key — required for monitor-pipeline probabilities. */
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
  lang?: "it" | "en";
  calibrationSnapshot: CalibrationSnapshot | null;
  sdsBreakdown: SdsGainBreakdown | null;
  totalCapitalEur: number;
  /** Phase A univariate screening for loss-risk score. Optional — when absent,
   *  ComparisonDeal.lossRisk and .riskScore stay null and the UI shows "—". */
  phaseA?: PhaseAResult | null;
  /** Approved Phase B risk pattern. Optional — when matched on a deal, the
   *  riskScore gets +20 (clamped to 100). */
  approvedPattern?: RiskPattern | null;
  /** Predicate used by `allocateRiskWeighted` to apply the Step 2 pattern
   *  penalty. Defaults to always-false (no deal matches → no penalty). The
   *  caller is responsible for resolving the match (e.g. via the feature
   *  snapshot store + matchPattern helper) since pattern matching needs the
   *  per-deal feature context we don't carry on ComparisonDeal. */
  matchesStep2Pattern?: (deal: ComparisonDeal) => boolean;
  /** Override the default sizing weights. Defaults to the same numbers used
   *  by `DEFAULT_WEIGHTED_SIZING_CONFIG` in portfolioWeightedSizing.ts. */
  riskWeightedConfig?: RiskWeightedConfig;
  /** Paper sim loop book — feeds mark-to-market % on sim-loop deals. */
  paperPortfolio?: PaperPosition[];
};

export function buildThreePortfolioComparison(
  args: BuildThreePortfolioArgs,
): ThreePortfolioComparison {
  const simRowByKey = args.simTable
    ? buildSimRowByKeyMap(args.simTable.rows ?? [])
    : new Map<string, Record<string, unknown>>();
  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of args.sdsRows ?? []) {
    if (s.ticker) sdsByTicker.set(s.ticker.toUpperCase(), s);
  }

  // Build the suggestion-monitor rows once and reuse across both universes.
  // It requires inputs + pointsBySeriesKey; without them, monitor stays empty
  // and selectors fall back to their legacy heuristics.
  let monitorRows: SuggestionMonitorRow[] = [];
  if (args.simTable?.rows?.length && args.inputs) {
    try {
      monitorRows = buildSuggestionMonitorRows({
        simTable: args.simTable,
        inputs: args.inputs,
        pointsBySeriesKey: args.pointsBySeriesKey ?? new Map<string, ChartPoint[]>(),
        lang: args.lang ?? "en",
        paperPortfolio: args.paperPortfolio ?? [],
      });
    } catch {
      monitorRows = [];
    }
  }
  const monitorByKey = new Map<string, SuggestionMonitorRow>();
  for (const m of monitorRows) monitorByKey.set(m.key, m);

  const phaseA = args.phaseA ?? null;
  const approvedPattern = args.approvedPattern ?? null;
  const mineDeals = selectMineDeals(args.closedRows, {
    simTable: args.simTable,
    inputs: args.inputs,
    monitorByKey,
    simRowByKey,
    sdsByTicker,
    snapshot: args.calibrationSnapshot,
    sdsBreakdown: args.sdsBreakdown,
    phaseA,
    approvedPattern,
  });
  const simLoopDeals = selectSimLoopDeals(args.simTable ?? null, {
    monitorRows,
    paperPortfolio: args.paperPortfolio,
    simRowByKey,
    sdsByTicker,
    snapshot: args.calibrationSnapshot,
    sdsBreakdown: args.sdsBreakdown,
    phaseA,
    approvedPattern,
  });

  // Union (unique by rowKey) for the table that lists every deal in either set.
  const byKey = new Map<string, ComparisonDeal>();
  for (const d of mineDeals) byKey.set(d.rowKey, d);
  for (const d of simLoopDeals) {
    if (!byKey.has(d.rowKey)) byKey.set(d.rowKey, d);
  }
  const allDeals = Array.from(byKey.values());

  const mine = harmonizeAllocationRealized(
    allocateEqual(mineDeals, args.totalCapitalEur),
    mineDeals,
  );
  const simLoopEqual = harmonizeAllocationRealized(
    allocateEqual(simLoopDeals, args.totalCapitalEur),
    simLoopDeals,
  );
  const simLoopWeighted = harmonizeAllocationRealized(
    allocateRiskWeighted(
      simLoopDeals,
      args.totalCapitalEur,
      args.matchesStep2Pattern,
      args.riskWeightedConfig,
    ),
    simLoopDeals,
  );

  return {
    totalCapitalEur: args.totalCapitalEur,
    allDeals,
    mineDeals,
    simLoopDeals,
    mine,
    simLoopEqual,
    simLoopWeighted,
  };
}

/** Synth vs equal-€ baseline on cumulative chart last row (P&L + invested capital). */
export type SynthGainImpact = {
  baselinePnlEur: number;
  baselineCostEur: number;
  /** P&L / invested capital (fraction, e.g. 0.04 = 4%). */
  baselineGainPct: number | null;
  synthPnlEur: number;
  synthCostEur: number;
  synthGainPct: number | null;
  deltaPnlEur: number;
  /** Percentage-point lift on return (synth − equal), e.g. 2.64 = +2.64 pp. */
  deltaGainPp: number | null;
  /** Relative lift on gain € vs equal baseline, e.g. 194 = +194% more P&L. */
  relativeGainUpliftPct: number | null;
};

export function computeSynthGainImpact(
  baselinePnlEur: number,
  baselineCostEur: number,
  synthPnlEur: number,
  synthCostEur: number,
): SynthGainImpact {
  const baselineGainPct =
    baselineCostEur > 0 && Number.isFinite(baselinePnlEur)
      ? baselinePnlEur / baselineCostEur
      : null;
  const synthGainPct =
    synthCostEur > 0 && Number.isFinite(synthPnlEur) ? synthPnlEur / synthCostEur : null;
  const deltaPnlEur = synthPnlEur - baselinePnlEur;
  const deltaGainPp =
    baselineGainPct != null && synthGainPct != null
      ? (synthGainPct - baselineGainPct) * 100
      : null;
  let relativeGainUpliftPct: number | null = null;
  if (Number.isFinite(baselinePnlEur) && Math.abs(baselinePnlEur) > 0.01) {
    relativeGainUpliftPct = (deltaPnlEur / Math.abs(baselinePnlEur)) * 100;
  }
  return {
    baselinePnlEur,
    baselineCostEur,
    baselineGainPct,
    synthPnlEur,
    synthCostEur,
    synthGainPct,
    deltaPnlEur,
    deltaGainPp,
    relativeGainUpliftPct,
  };
}
