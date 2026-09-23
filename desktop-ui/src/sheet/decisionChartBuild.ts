import type { SdsRow, RegulatoryRiskSnapshot } from "../api/supernova";
import type { EisSuperScoreState } from "../api/eisSuperScore";
import type { ChartPoint } from "../types";
import {
  resolveNearestEisForTicker,
  type CdPatternTickerRecommendation,
} from "./cdPatternRecommendation";
import { getMonitoredAsset } from "./catalystAnalysisStore";
import {
  buildRegulatoryRiskIndex,
  buildRegulatoryRiskIndexFromK8,
  resolveRegulatoryRiskBundle,
} from "./regulatoryRiskIndex";
import { clinicalPhaseFromSimRow } from "./simRowClinicalMeta";
import { clinicalKpiFromSimRow } from "./tickerEisSummary";
import {
  computeTickerMcs,
  loadMarketContextSnapshot,
  xbiClosesFromSnapshot,
  type MarketContextSnapshotDoc,
} from "./marketContextScore";
import type { PortfolioLossAnalysisItem } from "./portfolioLossAnalysis";
import { resolvePlanProbHeroPayload } from "./portfolioLossAnalysis";
import type { TickerSimEvaluation } from "./investDecisionSimLoop";
import type { LossRiskEntry } from "../components/LossRiskPoopCell";
import {
  type DecisionChartTickerRow,
  type DecisionScoreInput,
  getDiagnosticNote,
  explainRecommendation,
  hasInsufficientScores,
  isRescuePosition,
  regRiskFromSignedScore,
  resolveDecisionChartRec,
} from "./decisionChartLogic";
import { getTickerGainStars } from "./gainStarLedger";
import { issuerResilienceFromSimRow } from "./issuerResilience";
import { dailyChangePctFromRow, isWarrantTicker } from "./simulationPosition";
import { softBuyRisingStreakOk } from "./softBuyRisingStreak";
import { softBuyContinuationAllows } from "./continuationScore";

function sdsScore(
  patternRec: CdPatternTickerRecommendation | null | undefined,
  sdsRow: SdsRow | null | undefined,
): number | null {
  const ax = patternRec?.axes.find((a) => a.id === "sds");
  if (ax?.rawValue != null && Number.isFinite(ax.rawValue)) return Math.round(ax.rawValue);
  if (sdsRow?.sds != null && Number.isFinite(sdsRow.sds)) return Math.round(sdsRow.sds);
  return null;
}

/** Map signed EIS (−50…+50 typical) to 0–100 for radar/bars (neutral = 50). */
export function eisToDecisionDisplayScale(raw: number): number {
  return Math.round(Math.max(0, Math.min(100, 50 + raw)));
}

function resolveDecisionEisRaw(opts: {
  patternRec?: CdPatternTickerRecommendation | null;
  ticker: string;
  completionDate?: string | null;
  lang: "it" | "en";
  eisSuperScoreState?: EisSuperScoreState | null;
  clinicalKpi?: number | null;
  clinicalPreCdRecords?: import("../api/supernova").ClinicalPreCdRecord[];
}): number | null {
  const nearest = resolveNearestEisForTicker(opts);
  const raw = nearest?.score ?? null;
  return raw != null && Number.isFinite(raw) ? raw : null;
}

function tickerCloses(chartPts: ChartPoint[] | null | undefined): number[] {
  if (!chartPts?.length) return [];
  return chartPts
    .map((p) => p.price_usd)
    .filter((v): v is number => v != null && Number.isFinite(v));
}

export function buildDecisionScoreInput(opts: {
  item: PortfolioLossAnalysisItem;
  patternRec?: CdPatternTickerRecommendation | null;
  sdsRow?: SdsRow | null;
  lossRisk?: LossRiskEntry | null;
  regSignedScore?: number | null;
  mcsDoc?: MarketContextSnapshotDoc | null;
  chartPts?: ChartPoint[] | null;
  simRow?: Record<string, unknown> | null;
  lang?: "it" | "en";
  eisSuperScoreState?: EisSuperScoreState | null;
  clinicalPreCdRecords?: import("../api/supernova").ClinicalPreCdRecord[];
  /** Urgent SELL G2 book-budget hit for this key. */
  urgentSellG2?: boolean;
}): DecisionScoreInput {
  const {
    item,
    patternRec,
    sdsRow,
    lossRisk,
    regSignedScore,
    mcsDoc,
    chartPts,
    simRow,
    lang = "it",
    eisSuperScoreState,
    clinicalPreCdRecords,
    urgentSellG2 = false,
  } = opts;
  const clinicalKpi = clinicalKpiFromSimRow(simRow);
  const completionDate =
    item.completionDate ??
    (simRow ? String(simRow["Completion Date"] ?? "").trim() || null : null);
  const nearestEis = resolveNearestEisForTicker({
    patternRec,
    ticker: item.ticker,
    completionDate,
    lang,
    eisSuperScoreState,
    clinicalKpi,
    clinicalPreCdRecords,
  });
  const plan = resolvePlanProbHeroPayload(item, {
    matchPct: patternRec?.matchPct ?? null,
    sdsScore: sdsRow?.sds ?? null,
    eisSuperScore: nearestEis?.superScore ?? nearestEis?.score ?? null,
  });

  let mcs: number | null = null;
  if (mcsDoc?.latest) {
    mcs = computeTickerMcs(mcsDoc.latest, tickerCloses(chartPts), xbiClosesFromSnapshot(mcsDoc));
  }

  const pnlPct = item.hasPosition ? item.pnlPct : item.pnlPct24h ?? item.pnlPct;

  const eisRaw = resolveDecisionEisRaw({
      patternRec,
      ticker: item.ticker,
      completionDate,
      lang,
      eisSuperScoreState,
      clinicalKpi,
      clinicalPreCdRecords,
    });

  // Low-liquidity noise flag written by refresh_live_signals.py:
  //   trigger = (price < $1 OR ADV20 < 100k share) AND |Δgg%| > 15
  // Downstream: decisionChartLogic forces REVIEW to avoid classifying
  // microstructure bounce on sub-dime warrants as BUY/SELL. Boolean
  // extraction is defensive because the field may be a stringified
  // "true"/"false" if the JSON round-trip passed through Excel.
  const rawLowLiq = simRow?.["low_liq_noise"];
  const lowLiqNoise =
    rawLowLiq === true ||
    rawLowLiq === 1 ||
    (typeof rawLowLiq === "string" && rawLowLiq.trim().toLowerCase() === "true");
  const rawLowLiqReason = simRow?.["low_liq_reason"];
  const lowLiqReason =
    typeof rawLowLiqReason === "string" && rawLowLiqReason.trim().length > 0
      ? rawLowLiqReason.trim()
      : null;

  // Commercial/approved phase from Simulation; ADV/mcap/β/FY liq from row + live overlay.
  const resilienceProfile = issuerResilienceFromSimRow(simRow ?? undefined);

  const todayPct =
    item.pnlPct24h != null && Number.isFinite(item.pnlPct24h)
      ? item.pnlPct24h
      : simRow
        ? dailyChangePctFromRow(simRow)
        : null;
  const risingStreakOk = softBuyRisingStreakOk({
    row: simRow ?? null,
    chartPoints: chartPts,
    todayPct,
  });
  const continuationOk = softBuyContinuationAllows(simRow ?? null);

  return {
    pplan: plan.entryProbPct != null ? Math.round(plan.entryProbPct) : null,
    sds: sdsScore(patternRec, sdsRow),
    eis: eisRaw != null ? eisToDecisionDisplayScale(eisRaw) : null,
    eisRaw,
    riskV2: lossRisk?.riskScore ?? null,
    regRisk: regRiskFromSignedScore(regSignedScore ?? null),
    mcs: mcs != null ? Math.round(mcs) : null,
    pnlPct: pnlPct != null && Number.isFinite(pnlPct) ? pnlPct : null,
    pnlPct24h: todayPct != null && Number.isFinite(todayPct) ? todayPct : null,
    isRescue: isRescuePosition(pnlPct),
    status: "open",
    lowLiqNoise,
    lowLiqReason,
    resilience: resilienceProfile?.band ?? null,
    resilienceScore: resilienceProfile?.score ?? null,
    hasPosition: item.hasPosition,
    urgentSellG2: Boolean(urgentSellG2),
    isWarrant: isWarrantTicker(item.ticker),
    risingStreakOk,
    continuationOk,
  };
}

export function buildDecisionChartRow(opts: {
  item: PortfolioLossAnalysisItem;
  patternRec?: CdPatternTickerRecommendation | null;
  sdsRow?: SdsRow | null;
  lossRisk?: LossRiskEntry | null;
  regSignedScore?: number | null;
  mcsDoc?: MarketContextSnapshotDoc | null;
  chartPts?: ChartPoint[] | null;
  simRow?: Record<string, unknown> | null;
  lang?: "it" | "en";
  eisSuperScoreState?: EisSuperScoreState | null;
  /** Sim loop action — same source as PlanProbHero / raccomandazioni. */
  suggestedAction?: TickerSimEvaluation["suggestedAction"];
  clinicalPreCdRecords?: import("../api/supernova").ClinicalPreCdRecord[];
  urgentSellG2?: boolean;
}): DecisionChartTickerRow {
  const scores = buildDecisionScoreInput(opts);
  const rec = resolveDecisionChartRec(scores, opts.suggestedAction);
  const it = (opts.lang ?? "it") === "it";
  const gainStars = getTickerGainStars(opts.item.ticker, opts.item.pnlPct24h);
  return {
    key: opts.item.key,
    ticker: opts.item.ticker,
    company: opts.item.company,
    phaseLabel: opts.item.completionDate ?? clinicalPhaseFromSimRow(opts.simRow ?? undefined),
    pnlPct: scores.pnlPct,
    pnlPct24h:
      opts.item.pnlPct24h != null && Number.isFinite(opts.item.pnlPct24h)
        ? opts.item.pnlPct24h
        : null,
    scores,
    rec,
    diagnostic: getDiagnosticNote(scores, rec, it),
    recExplanation: explainRecommendation(scores, rec, it, opts.suggestedAction),
    insufficientScores: hasInsufficientScores(scores),
    hasPortfolio: opts.item.hasPosition,
    manualGainStar: gainStars.length > 0,
    gainStars,
  };
}

export function resolveRegulatoryRiskBundleForTicker(
  ticker: string,
  simRow: Record<string, unknown> | null | undefined,
  autoRegSnap: RegulatoryRiskSnapshot | null | undefined,
) {
  const resolvedTicker = ticker.trim().toUpperCase();
  const asset = getMonitoredAsset(resolvedTicker);
  const manualIdx = asset ? buildRegulatoryRiskIndex(asset) : null;
  const autoSig = autoRegSnap?.tickers?.[resolvedTicker] ?? null;
  const k8Index = simRow ? buildRegulatoryRiskIndexFromK8(resolvedTicker, [simRow]) : null;
  return resolveRegulatoryRiskBundle({
    manualIdx,
    autoSig,
    clinicalPhase: clinicalPhaseFromSimRow(simRow ?? undefined),
    k8Index,
    ticker: resolvedTicker,
  });
}

export function resolveRegSignedScoreForTicker(
  ticker: string,
  simRow: Record<string, unknown> | null | undefined,
  autoRegSnap: RegulatoryRiskSnapshot | null | undefined,
): number | null {
  return resolveRegulatoryRiskBundleForTicker(ticker, simRow, autoRegSnap).score;
}

export async function loadDecisionChartMcsDoc(): Promise<MarketContextSnapshotDoc | null> {
  try {
    return await loadMarketContextSnapshot();
  } catch {
    return null;
  }
}
