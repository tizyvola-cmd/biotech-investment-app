/**
 * Risk & Benefit scores vs realised P&L on closed sim outcomes.
 */
import type { SimOutcomeRow } from "../data/investmentSimOutcomesData";
import type { SheetTable } from "../types";
import type { SdsRow } from "../api/supernova";
import type { FrozenWeights, CalibrationSnapshot, CalibrationDimension } from "../calibration/calibrationTypes";
import { buildSimRowByKeyMap, normalizedRowKey } from "./investSimKeys";
import {
  buildComparisonDealForLossRisk,
} from "./threePortfolioCompare";
import { compositeApprovedWinRate } from "./approvedWeightsDisplay";
import {
  approvedWinRateToRiskPct,
  deriveClosedDealEntryBenefitComponents,
} from "./riskBenefitScoring";
import {
  buildRegulatoryRiskIndexFromK8,
  computeRegulatoryImminence,
} from "./regulatoryRiskIndex";
import { extractSlopesFromSimRow } from "./scoreValidationExport";
import {
  closedDealLossBinary,
  computeRiskScoreV2,
  riskScoreV2InputFromSources,
  type RiskScoreV2Breakdown,
} from "./riskScoreV2";
import {
  computeDealLossRisk,
  lossRiskInvestmentScore,
} from "./portfolioSizingWidget";
import {
  extractAllRowFeatures,
  type RowFeatures,
} from "../riskPattern/lossRiskScreening";
import type { PhaseAResult, RiskPattern } from "../riskPattern/riskPatternTypes";
import type { SdsGainBreakdown } from "./sdsGainBreakdown";
import type { MergedClosedDealRow } from "./closedDealsUnion";

export type ClosedDealRiskBenefitPoint = {
  ticker: string;
  rowKey: string;
  riskScore: number | null;
  /** True when risk uses approved P(win) inverse — Phase A had no bucket match. */
  riskScoreIsFallback: boolean;
  benefitScore: number;
  benefitWinComponentPct: number;
  benefitPplanComponentPct: number;
  benefitSdsComponentPct: number;
  entryPplanPct: number | null;
  entrySdsPct: number | null;
  /** Production Risk v2 — primary risk index for validation charts. */
  riskScoreV2: number | null;
  riskScoreV2Breakdown: RiskScoreV2Breakdown | null;
  /** Phase A native target: pnl_pct < -2%. */
  lossBinary: boolean;
  pnlPct: number;
  pnlEur: number | null;
  correlationSource: "simloop" | "portfolio";
};

function calibrationCellsFromRowFeatures(
  f: RowFeatures,
): Record<CalibrationDimension, string> {
  return {
    clinicalPhase: f.clinicalPhase ?? "Unknown",
    clinicalIndication: f.clinicalIndication ?? "Unknown",
    sdsBucket: f.sdsBucket ?? "No SDS",
    pplanBucket: f.pplanBucket ?? "P(plan) n/a",
  };
}

function isClosedOutcome(r: SimOutcomeRow): boolean {
  if (typeof r.decision_current_open === "boolean") return !r.decision_current_open;
  if (r.exit_ts) return true;
  return r.pnl_pct != null && Number.isFinite(r.pnl_pct);
}

function dedupeClosedOutcomes(rows: SimOutcomeRow[]): SimOutcomeRow[] {
  const closed = rows.filter(isClosedOutcome);
  const byKey = new Map<string, SimOutcomeRow>();
  for (const r of closed) {
    const key = r.row_key ?? `${r.ticker}|${r.completion_date ?? ""}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, r);
      continue;
    }
    const aTs = Date.parse(r.exit_ts ?? "");
    const bTs = Date.parse(prev.exit_ts ?? "");
    const pick =
      Number.isFinite(aTs) && Number.isFinite(bTs)
        ? aTs > bTs
        : (r.pnl_pct ?? -1e9) > (prev.pnl_pct ?? -1e9);
    if (pick) byKey.set(key, r);
  }
  return [...byKey.values()];
}

export function buildClosedDealRiskBenefitPoints(args: {
  outcomes: SimOutcomeRow[] | MergedClosedDealRow[];
  simTable?: SheetTable | null;
  sdsRows?: SdsRow[] | null;
  frozen: FrozenWeights;
  snapshot: CalibrationSnapshot | null;
  sdsBreakdown: SdsGainBreakdown | null;
  phaseA: PhaseAResult | null;
  approvedPattern: RiskPattern | null;
  /** Optional sec_k8 rows for regulatory imminence axis 1. */
  secK8Rows?: Record<string, unknown>[] | null;
}): ClosedDealRiskBenefitPoint[] {
  const closed = dedupeClosedOutcomes(args.outcomes);
  if (closed.length === 0) return [];

  const sdsByTicker = new Map<string, SdsRow>();
  for (const s of args.sdsRows ?? []) {
    if (s.ticker) sdsByTicker.set(s.ticker.toUpperCase(), s);
  }
  const simRowByKey = buildSimRowByKeyMap(
    (args.simTable?.rows ?? []) as Record<string, unknown>[],
  );
  const featuresByKey = extractAllRowFeatures(closed, {
    simTable: args.simTable,
    sdsRows: args.sdsRows,
  });

  const out: ClosedDealRiskBenefitPoint[] = [];
  for (const r of closed) {
    const pnlPct = r.pnl_pct;
    if (pnlPct == null || !Number.isFinite(pnlPct)) continue;
    const ticker = String(r.ticker ?? "").trim().toUpperCase();
    if (!ticker) continue;
    const rowKey = r.row_key ?? "";
    const simRow = simRowByKey.get(rowKey);
    const deal = buildComparisonDealForLossRisk(
      rowKey,
      ticker,
      simRow,
      r.entry_affidabilita_pct ??
        (r as SimOutcomeRow & { affidabilita_pct?: number | null }).affidabilita_pct ??
        null,
      {
        sdsByTicker,
        snapshot: args.snapshot,
        sdsBreakdown: args.sdsBreakdown,
        phaseA: args.phaseA,
        approvedPattern: args.approvedPattern,
      },
    );
    const outcomeCells = (() => {
      const normKey = normalizedRowKey(ticker, r.completion_date);
      const f = featuresByKey.get(normKey) ?? featuresByKey.get(rowKey);
      return f ? calibrationCellsFromRowFeatures(f) : deal.cells;
    })();
    const lossRisk = computeDealLossRisk(
      {
        ticker,
        displayLabel: deal.label,
        cells: outcomeCells,
      },
      args.phaseA,
      args.approvedPattern,
      { allowLowNBuckets: true },
    );
    const approvedWin =
      compositeApprovedWinRate(outcomeCells, args.frozen) ??
      compositeApprovedWinRate(deal.cells, args.frozen);
    let riskScore = lossRiskInvestmentScore(lossRisk) ?? deal.riskScore;
    let riskScoreIsFallback = false;
    if (riskScore == null && approvedWin != null && Number.isFinite(approvedWin)) {
      riskScore = approvedWinRateToRiskPct(approvedWin);
      riskScoreIsFallback = true;
    }
    const entryAff =
      r.entry_affidabilita_pct ??
      (r as SimOutcomeRow & { affidabilita_pct?: number | null }).affidabilita_pct ??
      null;
    const entrySlope =
      r.entry_slope_20d ??
      (r as SimOutcomeRow & { pre_cd_slope_20d?: number | null }).pre_cd_slope_20d ??
      (r as SimOutcomeRow & { latest_slope_20d?: number | null }).latest_slope_20d ??
      null;
    const entrySds = sdsByTicker.get(ticker)?.sds ?? deal.sdsValue ?? null;
    const benefitParts = deriveClosedDealEntryBenefitComponents({
      approvedWinRate: approvedWin ?? deal.winRate,
      entryAffidabilitaPct: entryAff,
      entrySlope20d: entrySlope,
      entrySdsPct: entrySds,
    });

    const sdsRow = sdsByTicker.get(ticker) ?? null;
    const slopes = simRow ? extractSlopesFromSimRow(simRow) : { slope5d: null, slope20d: null };
    const daysToCd =
      r.days_to_cd != null && Number.isFinite(r.days_to_cd)
        ? r.days_to_cd
        : (sdsRow?.days_to_cd ?? null);
    let regulatoryImminence: number | null = null;
    if (args.secK8Rows?.length) {
      const regIndex = buildRegulatoryRiskIndexFromK8(ticker, args.secK8Rows);
      regulatoryImminence = computeRegulatoryImminence(regIndex).score;
    }
    const riskV2Input = riskScoreV2InputFromSources({
      entryPplanPct: entryAff ?? benefitParts.entryPplanPct,
      daysToCd,
      slope5d: slopes.slope5d,
      sdsRow,
      regulatoryImminenceScore: regulatoryImminence,
    });
    const riskV2Breakdown = computeRiskScoreV2(riskV2Input);

    const pnlEurRaw = r.exit_pnl_eur_at_event ?? r.pnl_eur;
    const pnlEur =
      pnlEurRaw != null && Number.isFinite(Number(pnlEurRaw))
        ? Number(pnlEurRaw)
        : null;

    const correlationSource: "simloop" | "portfolio" =
      (r as MergedClosedDealRow).correlationSource ??
      (String(r.universe ?? "").toLowerCase() === "portfolio" ||
      String(r.universe ?? "").toLowerCase() === "real"
        ? "portfolio"
        : "simloop");

    out.push({
      ticker,
      rowKey,
      riskScore,
      riskScoreIsFallback,
      benefitScore: benefitParts.benefitScore,
      benefitWinComponentPct: benefitParts.winComponentPct,
      benefitPplanComponentPct: benefitParts.pplanComponentPct,
      benefitSdsComponentPct: benefitParts.sdsComponentPct,
      entryPplanPct: benefitParts.entryPplanPct,
      entrySdsPct: benefitParts.entrySdsPct,
      riskScoreV2: riskV2Breakdown.score,
      riskScoreV2Breakdown: riskV2Breakdown.score != null ? riskV2Breakdown : null,
      lossBinary: closedDealLossBinary(pnlPct),
      pnlPct,
      pnlEur,
      correlationSource,
    });
  }
  return out;
}
