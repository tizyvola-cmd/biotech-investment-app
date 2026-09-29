/**
 * Loop simulazione invest/disinvest — legge curve + suggerimenti, rileva disallineamenti,
 * esegue paper trades virtuali per misurare potenza segnali.
 */
import type { ChartPoint, SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { buildSimRowByKeyMap } from "./investSimKeys";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import type { RegulatoryRiskSnapshot } from "../api/supernova";
import {
  lookupLossRisk,
  lookupLossRiskByRowKey,
  type LossRiskCatalog,
} from "../hooks/useLossRiskCatalog";
import type { LossRiskEntry } from "../components/LossRiskPoopCell";
import { resolveRegSignedScoreForTicker } from "./decisionChartBuild";
import { regRiskFromSignedScore } from "./decisionChartLogic";
import { capturePaperBuyEntrySnapshots } from "./paperBuyEntrySnapshot";
import { priorSessionDayPnlByKey } from "./urgentSellBookLegs";
import {
  auditAssessmentChartHarmony,
  canonicalTodayOffset,
  transformOverlayVsToday,
  type AssessmentHarmonyAudit,
} from "./assessmentChartHarmony";
import { buildOverlayCurve } from "./sdsCompareOverlay";
import { buildSlopeTrajectory } from "./slopeRecalibCurve";
import { resolveSupernovaTargetRoi } from "./supernovaTargetRoi";
import {
  buildLossAnalysisItems,
  type LossAnalysisProbOptions,
  type PortfolioLossAnalysisItem,
} from "./portfolioLossAnalysis";
import { forwardPeakForMisalignmentCompare } from "./planTargetPeakAlign";
import { daysFromToday } from "./simulationPlanGain";
import type { LossExitDecision } from "./portfolioLossAnalysis";
import {
  getTop2Label,
  type Top2InvestVerdict,
} from "./top2DecisionHelpers";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import { SIM_HOT_ZONE_DAYS } from "./cdHorizons";
import { RECOVERY_HOLD_PROB_MIN, P_ENTRY_MIN } from "./recoveryProbability";
import {
  buildMarketContextDecisionCtx,
  getCachedMarketContextSnapshot,
  type MarketContextDecisionCtx,
} from "./marketContextScore";
import { portfolioExitRecoveryGuardsActive } from "./portfolioDeclineSell";
import { demoteAction, type AdviceFeedback } from "./adviceFeedback";
import {
  attachContCutPriority,
  evaluateSoftBuyGrade1,
  evaluateSoftSellGrade1,
  evaluateSoftSellGiveback,
  peakPnlEurFromHistory,
  softSellG1IsDeepFloor,
  evaluateUrgentSellGrade2Book,
  evaluateSoftBuyGrade1c,
  evaluateSoftBuyHighVol,
  evaluateSoftBuyDay1Catalyst,
  SOFT_BUY_G1_MIN_PLAN_RETURN_PCT,
  SOFT_BUY_G1_SDS_MIN,
  SOFT_BUY_G1_PPLAN_MIN,
  SOFT_BUY_G1C_SDS_MIN,
  SOFT_BUY_G1C_PPLAN_MIN,
} from "./softSignalGrades";
import {
  newsDimensionBearish,
  newsDimensionBullish,
  type NewsDimensionScores,
} from "./newsDimensionScores";
import { isVolumeSurge } from "./volumeVsPrevSession";
import { nyseSessionsElapsedSince } from "./marketSession";
import { recordSoftSellFireOnce } from "./softSellFireSnapshotStore";
import {
  SOFT_BUY_RISING_DAYS_MIN,
  softBuyRisingStreakOk,
} from "./softBuyRisingStreak";
import { softBuyBlockedByBookSell } from "./softBuyPostSellCooldown";
import {
  currentPriceFromRow,
  dailyChangePctFromRow,
  isWarrantTicker,
} from "./simulationPosition";
import {
  applyDirectionalSignalDemotion,
  buildRecommendationSignalCtx,
} from "./recommendationSignalGates";
import {
  shouldContinuationExhaustedSell,
  softBuyContinuationAllows,
  softBuyEarlyPeakHit,
  softBuyWindOrEarlyPeakHit,
  softBuyWindRunHit,
  resolveDisplayPContinuation,
} from "./continuationScore";
import type { SimLoopExecutionOpts } from "./simLoopDailyEvaluation";
import {
  DEFAULT_MAX_OPEN_POSITIONS,
  evaluateExperimentTick,
  stampPortfolioMarks,
  type ExperimentAdviceEvent,
  type ExperimentPiggyBank,
  type ExperimentScorecard,
} from "./investDecisionSimExperiment";
import {
  computeCompositeScore,
  COMPOSITE_LOSS_REVIEW_MIN,
  COMPOSITE_REVIEW_MIN,
  type CompositeScoreInput,
  type CompositeScoreResult,
} from "../lib/scoring/compositeScore";
import type { IndexId, ScoringZone } from "../lib/scoring/zoneWeights";
import { resolveTop2VerdictFields } from "./top2DecisionHelpers";
import { signalMetricsFromSimRow } from "./investSignalScore";
import { computeFairRecs24hFromEvaluations } from "./missedOpportunityFairRecs";
import type { GapInvestigationRecord } from "./gapInvestigationTypes";

export type CurveMisalignmentId =
  | "harmony_pred_slope"
  | "target_vs_supernova"
  | "precat_vs_verdict"
  | "spot_vs_model"
  | "slope_sign_mismatch";

export type CurveReadings = {
  supernovaPeakPct: number | null;
  planTargetPct: number | null;
  planCdPct: number | null;
  precatKind: string;
  slope5d: number | null;
  slope20d: number | null;
  pred5Pp: number | null;
  curveGapPct: number | null;
  harmonyMaxGapPp: number | null;
  harmonyAligned: boolean | null;
  stabilityVerdict: string;
};

export type TickerSimEvaluation = {
  key: string;
  ticker: string;
  hasPosition: boolean;
  inPaperPortfolio: boolean;
  daysToCd: number | null;
  readings: CurveReadings;
  misalignments: CurveMisalignmentId[];
  misalignmentLabels: string[];
  exitDecision: LossExitDecision;
  investVerdict: Top2InvestVerdict;
  /** Top2 lato ingresso — null se in portafoglio. */
  entryVerdict: Top2InvestVerdict | null;
  /** Top2 lato uscita — null se opportunità. */
  exitVerdict: Top2InvestVerdict | null;
  probPct: number | null;
  suggestedAction: "buy" | "sell" | "hold" | "review" | "none";
  planReturnPct: number | null;
  pnlPct24h: number | null;
  pnlPct: number | null;
  precatVerdictAgree: boolean;
  exitReason: string;
  /** Composite score 0–100 per fascia CD (ausiliario — non sostituisce guardie recovery). */
  compositeScore: number;
  scoringZone: ScoringZone;
  scoreBreakdown: Record<IndexId, number>;
  compositeDampened: boolean;
};

export type CompositeScoreContext = Pick<
  CompositeScoreInput,
  | "signalScore"
  | "sdsScore"
  | "eisSuperScore"
  | "matchPct"
  | "miiAngleDeg"
>;

export function buildCompositeInputFromLossItem(
  item: PortfolioLossAnalysisItem,
  scoreCtx?: CompositeScoreContext | null,
): CompositeScoreInput {
  const top2 = resolveTop2VerdictFields(item.hasPosition, item.investVerdict);
  return {
    daysToCd: item.daysToCd,
    hasPosition: item.hasPosition,
    currentPnlPct: item.pnlPct,
    probPlan: item.recoveryProbabilityPct,
    investVerdict: item.investVerdict,
    entryVerdict: top2.entryVerdict,
    exitVerdict: top2.exitVerdict,
    precatKind: item.precatKind,
    stabilityVerdict: item.stabilityVerdict,
    curveRisingHold: item.curveRisingHold,
    slope20d: item.slope20d,
    forwardRoi: item.planReturnPct,
    spotVsModelGapPct: item.curveGapPct,
    signalScore: scoreCtx?.signalScore ?? null,
    sdsScore: scoreCtx?.sdsScore ?? null,
    eisSuperScore: scoreCtx?.eisSuperScore ?? null,
    matchPct: scoreCtx?.matchPct ?? null,
    miiAngleDeg: scoreCtx?.miiAngleDeg ?? null,
  };
}

export function computeCompositeForLossItem(
  item: PortfolioLossAnalysisItem,
  scoreCtx?: CompositeScoreContext | null,
): CompositeScoreResult {
  return computeCompositeScore(buildCompositeInputFromLossItem(item, scoreCtx));
}

export type PaperPosition = {
  key: string;
  ticker: string;
  entryAt: string;
  capital: number;
  entryReason: string;
  entryPlanReturnPct: number | null;
  /** P(plan) al momento dell'ingresso paper. */
  entryProbPct?: number | null;
  /** SDS at paper BUY (frozen entry score). */
  entrySds?: number | null;
  /** EIS feed window score at paper BUY. */
  entryEisScore?: number | null;
  /** Signed regulatory score at paper BUY. */
  entryRegulatoryScore?: number | null;
  /** Ultimo P&L % mark-to-market (tick precedente). */
  lastMarkPct?: number | null;
  /** Spot USD at paper entry — MTM vs sheet current (not opportunity pnlPct≡0). */
  entryBuyPrice?: number | null;
};

export type PaperTradeEvent = {
  at: string;
  ticker: string;
  key: string;
  side: "buy" | "sell";
  reason: string;
  capital: number;
  pnlPctSimulated: number | null;
  pnlEurSimulated: number | null;
  /** Var.24h post-vendita — persistito prima del compact tick (evaluations[] vuote). */
  postSellMove24hPct?: number | null;
};

export type DecisionSimTickSummary = {
  evaluatedTickers: number;
  misalignedTickers: number;
  harmonyAlignedPct: number | null;
  precatVerdictAgree: number;
  buySignals: number;
  sellSignals: number;
  holdSignals: number;
  reviewSignals: number;
  tradesExecuted: number;
  misalignmentByType: Partial<Record<CurveMisalignmentId, number>>;
  piggyBank?: ExperimentPiggyBank;
  missedBuyCount?: number;
  adviceEventsCount?: number;
  /** Precomputed at tick time — avoids persisting full evaluations[]. */
  recs24hHypotheticalEur?: number;
  /** Cap max 8, capitale paper, Enter eseguibili — v. missedOpportunityFairRecs. */
  fairRecs24hEur?: number;
};

export type DecisionSimTick = {
  id: string;
  at: string;
  evaluations: TickerSimEvaluation[];
  portfolioBefore: PaperPosition[];
  portfolioAfter: PaperPosition[];
  trades: PaperTradeEvent[];
  summary: DecisionSimTickSummary;
  adviceEvents?: ExperimentAdviceEvent[];
  experimentDelta?: Partial<ExperimentScorecard>;
  badBuyScoredKeys?: string[];
};

export type DecisionSimRunConfig = {
  enabled: boolean;
  intervalHours: number;
  startedAt: string | null;
  endsAt: string | null;
  capitalPerTrade: number;
  maxOpenPositions: number;
  experimentMode: boolean;
};

export type DecisionSimState = {
  version: 2;
  config: DecisionSimRunConfig;
  paperPortfolio: PaperPosition[];
  ticks: DecisionSimTick[];
  lastTickAt: string | null;
  /** Rome ymd of last 18:00 solid evaluation mark tick. */
  lastDailyEvaluationDayKey: string | null;
  cumulativePaperPnlEur: number;
  closedTradeCount: number;
  experimentStartedAt: string | null;
  scorecard: ExperimentScorecard;
  piggyBank: ExperimentPiggyBank;
  adviceLog: ExperimentAdviceEvent[];
  badBuyScoredKeys: string[];
  gapInvestigationLog: GapInvestigationRecord[];
};

export type DecisionSimContext = {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  lang: "it" | "en";
  probOptions?: LossAnalysisProbOptions | null;
  paperPortfolio: PaperPosition[];
  capitalPerTrade?: number;
  maxOpenPositions?: number;
  closedTradeCount?: number;
  cumulativeClosedPnlEur?: number;
  badBuyScoredKeys?: Set<string>;
  /** Learning loop corrections — demotions block paper auto-sell. */
  adviceFeedback?: AdviceFeedback | null;
  /** Auto tick: Soft BUY pass-through + synth capital sizing. */
  simLoopExecution?: SimLoopExecutionOpts | null;
  /** Portfolio history — prior-session legs for Urgent SELL G2 (+ PnL items). */
  history?: InvestSimHistoryPoint[] | null;
  /** Risk v2 catalog — Soft SELL G1 (same as Home Cutoff / Pulse). */
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry> | null;
  autoRegSnap?: RegulatoryRiskSnapshot | null;
};

export type SimulatePaperTradesOpts = {
  resolveBuyCapital?: (ev: TickerSimEvaluation) => number;
  /** Capture entry spot on BUY for subsequent MTM. */
  simRowByKey?: Map<string, Record<string, unknown>>;
};

function sanitizeMarkPct(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  if (Math.abs(pct) > 500) return null;
  return pct;
}

/**
 * Paper mark from sheet: total % vs entryBuyPrice (or lastMark), day % from Var. Giorn.
 * Used so Soft SELL / G2 / stamp see real tape — not opportunity pnlPct≡0.
 */
export function resolvePaperPositionMarks(
  pos: PaperPosition,
  simRow: Record<string, unknown> | null | undefined,
): {
  totalPnlPct: number | null;
  dayPnlPct: number | null;
  dayPnlEur: number;
} {
  const dayPct = simRow ? dailyChangePctFromRow(simRow) : null;
  const curr = simRow ? currentPriceFromRow(simRow) : null;
  let totalPct: number | null = null;
  if (
    pos.entryBuyPrice != null &&
    Number.isFinite(pos.entryBuyPrice) &&
    pos.entryBuyPrice > 0 &&
    curr != null &&
    curr > 0
  ) {
    totalPct = Math.round(((curr - pos.entryBuyPrice) / pos.entryBuyPrice) * 10000) / 100;
    // Same-day / stale Prezzo Corrente: entry was stamped to spot at buy, so
    // (curr−entry)/entry stays 0 forever while Var. Giorn. % already moved.
    // Flash Test equity curves and Soft SELL marks need that daily tape.
    if (
      Math.abs(totalPct) < 0.05 &&
      dayPct != null &&
      Number.isFinite(dayPct) &&
      Math.abs(dayPct) >= 0.05 &&
      Math.abs(pos.entryBuyPrice - curr) / curr <= 0.001
    ) {
      totalPct = Math.round(dayPct * 100) / 100;
    }
  } else {
    totalPct = sanitizeMarkPct(pos.lastMarkPct);
    if (totalPct == null && dayPct != null && Number.isFinite(dayPct)) {
      totalPct = dayPct;
    }
  }
  const dayPnlEur =
    dayPct != null && Number.isFinite(dayPct) && pos.capital > 0
      ? Math.round(((pos.capital * dayPct) / 100) * 100) / 100
      : 0;
  return {
    totalPnlPct: totalPct != null && Number.isFinite(totalPct) ? totalPct : null,
    dayPnlPct: dayPct != null && Number.isFinite(dayPct) ? dayPct : null,
    dayPnlEur,
  };
}

/** Overlay paper MTM onto opportunity items (keeps hasPosition=false for Top2 entry semantics). */
export function overlayPaperMarksOnLossItem(
  item: PortfolioLossAnalysisItem,
  pos: PaperPosition | null | undefined,
  simRow: Record<string, unknown> | null | undefined,
): PortfolioLossAnalysisItem {
  if (!pos) return item;
  const marks = resolvePaperPositionMarks(pos, simRow);
  const total = marks.totalPnlPct;
  const day = marks.dayPnlPct;
  const capital = pos.capital > 0 ? pos.capital : item.capital;
  return {
    ...item,
    capital,
    pnlPct: total ?? item.pnlPct,
    pnlEur:
      total != null && capital > 0
        ? Math.round(((capital * total) / 100) * 100) / 100
        : item.pnlEur,
    pnlPct24h: day ?? item.pnlPct24h,
    pnlEur24h:
      marks.dayPnlEur !== 0
        ? marks.dayPnlEur
        : day != null && capital > 0
          ? Math.round(((capital * day) / 100) * 100) / 100
          : item.pnlEur24h,
    inLoss: total != null ? total < 0 : item.inLoss,
  };
}

/** Backfill missing entryBuyPrice from current spot (± lastMark). */
export function backfillPaperEntryBuyPrices(
  portfolio: PaperPosition[],
  simRowByKey: Map<string, Record<string, unknown>>,
): PaperPosition[] {
  return portfolio.map((p) => {
    if (p.entryBuyPrice != null && p.entryBuyPrice > 0) return p;
    const row = simRowByKey.get(p.key);
    const curr = row ? currentPriceFromRow(row) : null;
    if (curr == null || curr <= 0) return p;
    const mark = sanitizeMarkPct(p.lastMarkPct);
    if (mark != null && mark > -99.9) {
      const entry = curr / (1 + mark / 100);
      if (entry > 0 && Number.isFinite(entry)) {
        return { ...p, entryBuyPrice: Math.round(entry * 10000) / 10000 };
      }
    }
    return { ...p, entryBuyPrice: curr };
  });
}

const TARGET_SN_GAP_PP = 2.5;
const SPOT_MODEL_GAP_PCT = 8;
const SLOPE_PRED_MIN = 0.05;

/** Soglie più alte per il KPI headline — i flag deboli restano in tabella/dettaglio. */
export const CRITICAL_MISALIGN_THRESHOLDS = {
  harmonyPredGapPp: 1.5,
  targetSnGapPp: 5,
  spotModelGapPct: 12,
} as const;

/** Sottoinsieme “critico” usato dal KPI Disallineati (non dalla tabella per-riga). */
export function criticalMisalignmentIds(ev: TickerSimEvaluation): CurveMisalignmentId[] {
  const { readings, misalignments } = ev;
  const critical: CurveMisalignmentId[] = [];

  for (const id of misalignments) {
    switch (id) {
      case "precat_vs_verdict":
      case "slope_sign_mismatch":
        critical.push(id);
        break;
      case "harmony_pred_slope":
        if (
          readings.harmonyMaxGapPp != null &&
          readings.harmonyMaxGapPp > CRITICAL_MISALIGN_THRESHOLDS.harmonyPredGapPp
        ) {
          critical.push(id);
        }
        break;
      case "target_vs_supernova": {
        const plan = readings.planTargetPct;
        const sn = readings.supernovaPeakPct;
        if (
          plan != null &&
          sn != null &&
          Math.abs(plan - sn) > CRITICAL_MISALIGN_THRESHOLDS.targetSnGapPp
        ) {
          critical.push(id);
        }
        break;
      }
      case "spot_vs_model":
        if (
          readings.curveGapPct != null &&
          Math.abs(readings.curveGapPct) > CRITICAL_MISALIGN_THRESHOLDS.spotModelGapPct
        ) {
          critical.push(id);
        }
        break;
    }
  }

  return critical;
}
const PRED5_MIN_PP = 0.3;

const MISALIGN_LABELS: Record<CurveMisalignmentId, { it: string; en: string }> = {
  harmony_pred_slope: {
    it: "Overlay pred ≠ traiettoria slope (stessi nodi calendario)",
    en: "Pred overlay ≠ slope trajectory (shared calendar knots)",
  },
  target_vs_supernova: {
    it: "Target piano ≠ picco curva (forward pre-CD)",
    en: "Plan target ≠ curve peak (forward pre-CD)",
  },
  precat_vs_verdict: {
    it: "Precat vs verdetto Top2",
    en: "Precat vs Top2 verdict",
  },
  spot_vs_model: {
    it: "Prezzo spot vs modello oggi",
    en: "Spot price vs model today",
  },
  slope_sign_mismatch: {
    it: "Segno slope5 ≠ pred+5",
    en: "Slope5 sign ≠ pred+5",
  },
};

/** Short labels for bar charts (stable, not first-word truncation). */
export const MISALIGN_CHART_LABELS: Record<CurveMisalignmentId, { it: string; en: string }> = {
  harmony_pred_slope: { it: "Pred", en: "Pred" },
  target_vs_supernova: { it: "Piano", en: "Plan" },
  precat_vs_verdict: { it: "Precat", en: "Precat" },
  spot_vs_model: { it: "Spot", en: "Spot" },
  slope_sign_mismatch: { it: "Slope5", en: "Slope5" },
};

export function misalignmentSummaryFromEvaluations(evaluations: TickerSimEvaluation[]): {
  evaluatedTickers: number;
  misalignedTickers: number;
  misalignmentByType: Partial<Record<CurveMisalignmentId, number>>;
  harmonyAlignedPct: number | null;
  precatVerdictAgree: number;
} {
  const misalignmentByType: Partial<Record<CurveMisalignmentId, number>> = {};
  let misaligned = 0;
  let harmonyAlignedN = 0;
  let harmonyDenom = 0;
  let precatAgree = 0;

  for (const ev of evaluations) {
    if (ev.misalignments.length > 0) misaligned += 1;
    for (const id of ev.misalignments) {
      misalignmentByType[id] = (misalignmentByType[id] ?? 0) + 1;
    }
    if (ev.readings.harmonyAligned != null) {
      harmonyDenom += 1;
      if (ev.readings.harmonyAligned) harmonyAlignedN += 1;
    }
    if (ev.precatVerdictAgree) precatAgree += 1;
  }

  return {
    evaluatedTickers: evaluations.length,
    misalignedTickers: misaligned,
    misalignmentByType,
    harmonyAlignedPct:
      harmonyDenom > 0 ? Math.round((harmonyAlignedN / harmonyDenom) * 1000) / 10 : null,
    precatVerdictAgree: precatAgree,
  };
}

/** KPI headline: solo disallineamenti critici (Precat/Slope5 sempre; Pred/Piano/Spot con soglie più alte). */
export function criticalMisalignmentSummaryFromEvaluations(
  evaluations: TickerSimEvaluation[],
): Pick<
  ReturnType<typeof misalignmentSummaryFromEvaluations>,
  "evaluatedTickers" | "misalignedTickers" | "misalignmentByType"
> {
  const misalignmentByType: Partial<Record<CurveMisalignmentId, number>> = {};
  let misaligned = 0;

  for (const ev of evaluations) {
    const critical = criticalMisalignmentIds(ev);
    if (critical.length > 0) misaligned += 1;
    for (const id of critical) {
      misalignmentByType[id] = (misalignmentByType[id] ?? 0) + 1;
    }
  }

  return {
    evaluatedTickers: evaluations.length,
    misalignedTickers: misaligned,
    misalignmentByType,
  };
}

export type HarmonizedCurveContext = {
  supernovaPeakPct: number | null;
  harmony: AssessmentHarmonyAudit | null;
};

function harmonyForRow(
  row: Record<string, unknown>,
  chartPts: ChartPoint[] | null | undefined,
  ticker: string,
): AssessmentHarmonyAudit | null {
  if (!chartPts?.length) return null;
  const days = daysFromToday(String(row["Completion Date"] ?? ""));
  const todayOff = canonicalTodayOffset(row, days);
  const raw = buildOverlayCurve(ticker, chartPts, row, 0, { extendedPostCd: true });
  if (!raw) return null;
  const overlay = transformOverlayVsToday(raw, todayOff);
  const traj = buildSlopeTrajectory({
    chartPoints: chartPts,
    simRow: row,
    daysToCd: days ?? 30,
  });
  if (!traj?.points.length) return null;
  return auditAssessmentChartHarmony({
    overlayVsToday: overlay,
    slopePoints: traj.points,
    todayOffset: todayOff,
  });
}

/** Same Supernova peak path as Decision Lab ROI-Target column (pre-CD grid, vs today). */
export function harmonizedSupernovaPeakPct(
  ticker: string,
  simRow: Record<string, unknown> | null,
  chartPts: ChartPoint[] | null | undefined,
): number | null {
  if (!simRow || !chartPts?.length) return null;
  return resolveSupernovaTargetRoi(ticker, simRow, chartPts)?.returnPct ?? null;
}

export function buildHarmonizedCurveContext(
  ticker: string,
  simRow: Record<string, unknown> | null,
  chartPts: ChartPoint[] | null | undefined,
): HarmonizedCurveContext {
  return {
    supernovaPeakPct: harmonizedSupernovaPeakPct(ticker, simRow, chartPts),
    harmony: simRow ? harmonyForRow(simRow, chartPts, ticker) : null,
  };
}

export function detectCurveMisalignments(
  item: PortfolioLossAnalysisItem,
  harmony: AssessmentHarmonyAudit | null,
  lang: "it" | "en",
  harmonized?: Pick<HarmonizedCurveContext, "supernovaPeakPct">,
): { ids: CurveMisalignmentId[]; labels: string[] } {
  const ids: CurveMisalignmentId[] = [];
  const labels: string[] = [];

  if (harmony && !harmony.aligned) {
    const gap = harmony.maxPredGapPp;
    if (gap != null && Number.isFinite(gap)) {
      ids.push("harmony_pred_slope");
      labels.push(
        lang === "it"
          ? `${MISALIGN_LABELS.harmony_pred_slope.it} (Δ ${gap.toFixed(2)} pp)`
          : `${MISALIGN_LABELS.harmony_pred_slope.en} (Δ ${gap.toFixed(2)} pp)`,
      );
    }
  }

  const snPeak = forwardPeakForMisalignmentCompare(harmonized?.supernovaPeakPct, {
    curvePeakReturnPct: item.curvePeakReturnPct,
    daysToCurvePeak: item.daysToCurvePeak,
    daysToCd: item.daysToCd,
  });
  if (
    !item.planTargetProvisional &&
    item.planReturnPct != null &&
    snPeak != null &&
    snPeak > 0.05 &&
    Math.abs(item.planReturnPct - snPeak) > TARGET_SN_GAP_PP
  ) {
    ids.push("target_vs_supernova");
    labels.push(
      lang === "it"
        ? `${MISALIGN_LABELS.target_vs_supernova.it} (${item.planReturnPct.toFixed(1)}% vs ${snPeak.toFixed(1)}%)`
        : `${MISALIGN_LABELS.target_vs_supernova.en} (${item.planReturnPct.toFixed(1)}% vs ${snPeak.toFixed(1)}%)`,
    );
  }

  const precatBuy = item.precatKind === "enter" || item.precatKind === "accumulate";
  const precatSell = item.precatKind === "avoid" || item.precatKind === "sell";
  const verdictBuy = item.investVerdict === "yes";
  const verdictBlock = item.investVerdict === "no";
  if ((precatBuy && verdictBlock) || (precatSell && verdictBuy)) {
    ids.push("precat_vs_verdict");
    labels.push(MISALIGN_LABELS.precat_vs_verdict[lang]);
  }

  if (item.curveGapPct != null && Math.abs(item.curveGapPct) > SPOT_MODEL_GAP_PCT) {
    ids.push("spot_vs_model");
    labels.push(
      lang === "it"
        ? `${MISALIGN_LABELS.spot_vs_model.it} (${item.curveGapPct >= 0 ? "+" : ""}${item.curveGapPct.toFixed(1)}%)`
        : `${MISALIGN_LABELS.spot_vs_model.en} (${item.curveGapPct >= 0 ? "+" : ""}${item.curveGapPct.toFixed(1)}%)`,
    );
  }

  if (
    item.slope5d != null &&
    item.pred5Pp != null &&
    Math.abs(item.slope5d) > SLOPE_PRED_MIN &&
    Math.abs(item.pred5Pp) > PRED5_MIN_PP &&
    Math.sign(item.slope5d) !== Math.sign(item.pred5Pp)
  ) {
    ids.push("slope_sign_mismatch");
    labels.push(MISALIGN_LABELS.slope_sign_mismatch[lang]);
  }

  return { ids, labels };
}

export function precatVerdictAgrees(item: PortfolioLossAnalysisItem): boolean {
  const precatBuy = item.precatKind === "enter" || item.precatKind === "accumulate";
  const precatSell = item.precatKind === "avoid" || item.precatKind === "sell";
  if (precatBuy) return item.investVerdict === "yes";
  if (precatSell) return item.investVerdict === "no";
  return item.investVerdict === "wait";
}

const SIM_BUY_PROB_MIN = P_ENTRY_MIN;
/** @deprecated Watchlist buy rimosso — Buy solo con Top2 sì + evidenze studio. */
const SIM_BUY_WATCH_PROB_MIN = P_ENTRY_MIN;
/** Var. giorn. minima per override momentum (allineato a missed-opp audit). */
export const MOMENTUM_24H_BUY_MIN = 0.5;
/** P(plan) minima per buy momentum quando Top2 no / precat avoid ma titolo sale oggi. */
export const MOMENTUM_P_STRONG_MIN = 45;

const FORWARD_DECLINE_SLOPE_PP = -0.05;
const FORWARD_DECLINE_PRED5_PP = -0.05;

/** Modello forward in calo — blocca momentum-BUY su precat avoid. */
export function isForwardModelDeclining(
  item: Pick<
    PortfolioLossAnalysisItem,
    "curveRisingHold" | "slope5d" | "pred5Pp" | "planReturnPct"
  >,
): boolean {
  if (item.curveRisingHold) return false;
  if (item.planReturnPct != null && item.planReturnPct > 0 && item.slope5d != null && item.slope5d > 0) {
    return false;
  }
  if (item.slope5d != null && item.slope5d <= FORWARD_DECLINE_SLOPE_PP) return true;
  if (item.pred5Pp != null && item.pred5Pp <= FORWARD_DECLINE_PRED5_PP) return true;
  return false;
}

/** BUY off-portfolio richiede target/picco forward > 0 — P(recovery) da sola non basta. */
export function forwardBuyGainOutlookPositive(
  item: Pick<
    PortfolioLossAnalysisItem,
    "planReturnPct" | "curvePeakReturnPct" | "daysToCurvePeak" | "pred5Pp" | "curveRisingHold" | "slope5d"
  >,
): boolean {
  if (
    item.curvePeakReturnPct != null &&
    item.curvePeakReturnPct > 0 &&
    item.daysToCurvePeak != null &&
    item.daysToCurvePeak > 0
  ) {
    return true;
  }
  if (item.planReturnPct != null && item.planReturnPct > 0) {
    return true;
  }
  if (item.pred5Pp != null && item.pred5Pp > 0 && !isForwardModelDeclining(item)) {
    return true;
  }
  return false;
}

/**
 * Soft BUY forward bar — stricter than generic >0 so WAIT + Target +1.3%
 * cannot paint Operative BUY (HAE).
 */
export function softBuyForwardGainAdequate(
  item: Pick<
    PortfolioLossAnalysisItem,
    "planReturnPct" | "curvePeakReturnPct" | "daysToCurvePeak"
  >,
): boolean {
  if (
    item.planReturnPct != null &&
    Number.isFinite(item.planReturnPct) &&
    item.planReturnPct >= SOFT_BUY_G1_MIN_PLAN_RETURN_PCT
  ) {
    return true;
  }
  if (
    item.curvePeakReturnPct != null &&
    Number.isFinite(item.curvePeakReturnPct) &&
    item.curvePeakReturnPct >= SOFT_BUY_G1_MIN_PLAN_RETURN_PCT &&
    item.daysToCurvePeak != null &&
    item.daysToCurvePeak > 0
  ) {
    return true;
  }
  return false;
}

/**
 * Soft BUY Top2 filter — WAIT is allowed (volume trial); only hard NO blocks G1.
 * G1c can still override NO when study is strong.
 */
export function softBuyTop2Allows(item: Pick<PortfolioLossAnalysisItem, "investVerdict">): boolean {
  const v = String(item.investVerdict ?? "").trim().toLowerCase();
  return v !== "no";
}

/** Top2 yes + precat enter/accumulate — allow forward >0 instead of ≥3%. */
export function softBuyEntryAligned(
  item: Pick<PortfolioLossAnalysisItem, "investVerdict" | "precatKind">,
): boolean {
  const v = String(item.investVerdict ?? "").trim().toLowerCase();
  if (v !== "yes") return false;
  return item.precatKind === "enter" || item.precatKind === "accumulate";
}

/**
 * Soft BUY G1c / legacy forward bar (not required for Soft BUY G1 volume when ↑≥2d):
 * - Top2 WAIT → forward ≥3%
 * - Top2 yes + ENTER/accumulate → forward >0
 * - otherwise → forward ≥3%
 */
export function softBuyForwardForPath(
  item: Pick<
    PortfolioLossAnalysisItem,
    | "planReturnPct"
    | "curvePeakReturnPct"
    | "daysToCurvePeak"
    | "pred5Pp"
    | "curveRisingHold"
    | "slope5d"
    | "investVerdict"
    | "precatKind"
  >,
): boolean {
  if (softBuyForwardGainAdequate(item)) return true;
  const v = String(item.investVerdict ?? "").trim().toLowerCase();
  if (v === "wait") return false;
  if (softBuyEntryAligned(item) && forwardBuyGainOutlookPositive(item)) return true;
  return false;
}

function resolveSoftBuyDayPct(
  item: Pick<PortfolioLossAnalysisItem, "pnlPct24h">,
  dayPctFromSim?: number | null,
): number | null {
  if (item.pnlPct24h != null && Number.isFinite(item.pnlPct24h)) return item.pnlPct24h;
  if (dayPctFromSim != null && Number.isFinite(dayPctFromSim)) return dayPctFromSim;
  return null;
}

/**
 * Intraday Var. Giorn. noise around 0% — a −0.2% print must not wipe Home
 * Suggested BUY on the next 30-min refresh.
 */
export const SOFT_BUY_DAY_RED_EPS = -0.35;

/**
 * Soft BUY: do not enter a name that is meaningfully red on the session.
 * Unknown day → allow (no false block). Tiny red prints stay allowed.
 */
export function softBuyDayNotRed(
  item: Pick<PortfolioLossAnalysisItem, "pnlPct24h">,
  dayPctFromSim?: number | null,
): boolean {
  const day = resolveSoftBuyDayPct(item, dayPctFromSim);
  if (day == null) return true;
  return day >= SOFT_BUY_DAY_RED_EPS;
}

/** Block Soft BUY on fresh crash tape (JSPR −47% day lesson). */
export function softBuyTapeNotCatastrophic(
  item: Pick<PortfolioLossAnalysisItem, "pnlPct24h" | "pnlPct">,
  dayPctFromSim?: number | null,
): boolean {
  const day = resolveSoftBuyDayPct(item, dayPctFromSim);
  if (day != null && day <= -10) return false;
  if (item.pnlPct != null && Number.isFinite(item.pnlPct) && item.pnlPct <= -8) {
    return false;
  }
  return true;
}

/** Soft BUY: today green + prior sessions green (≥2 total). */
export function softBuyRisingStreakAllows(
  item: PortfolioLossAnalysisItem,
  dayPctFromSim?: number | null,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): boolean {
  const today = resolveSoftBuyDayPct(item, dayPctFromSim);
  return softBuyRisingStreakOk({
    row: enhanceCtx?.simRow ?? null,
    chartPoints: enhanceCtx?.chartPts,
    todayPct: today,
    minDays: SOFT_BUY_RISING_DAYS_MIN,
    priorSessionPcts: enhanceCtx?.priorSessionPcts,
  });
}

/**
 * Soft BUY list rank — higher first. Wind-run is the volume promoter;
 * Top2 / rising / no-cooldown / higher P(cont) lift priority.
 */
export function softBuySuggestionPriority(
  item: PortfolioLossAnalysisItem,
  dayPctFromSim?: number | null,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): number {
  const simRow = enhanceCtx?.simRow ?? null;
  let score = 0;
  const dayPct = resolveSoftBuyDayPct(item, dayPctFromSim);
  if (softBuyWindRunHit(simRow)) score += 100;
  else if (softBuyEarlyPeakHit(simRow, dayPct)) score += 90;
  if (enhanceCtx?.volumeAccel?.flagged) score += 85;
  else if (softBuyCatalystVolSurge(enhanceCtx) && softBuyCatalystNewsBullish(enhanceCtx)) {
    score += 80;
  }
  if (softBuyTop2Allows(item)) score += 40;
  if (softBuyRisingStreakAllows(item, dayPctFromSim, enhanceCtx)) score += 30;
  if (!enhanceCtx?.recentlySoldBlocked) score += 20;
  if (softBuyContinuationAllows(simRow)) score += 10;
  const pCont = resolveDisplayPContinuation(simRow);
  if (pCont != null && Number.isFinite(pCont)) {
    score += Math.min(40, Math.max(0, pCont - 50));
  }
  const sds = item.sdsScore;
  if (sds != null && Number.isFinite(sds)) score += Math.min(20, sds * 0.25);
  return score;
}

/** Soft BUY G1c study override — strong SDS/P clears Top2/precat conflict. */
export function qualifiesSoftBuyGrade1c(
  item: PortfolioLossAnalysisItem,
  dayPctFromSim?: number | null,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): boolean {
  const g1c = evaluateSoftBuyGrade1c({
    hasPosition: Boolean(item.hasPosition),
    sdsScore: item.sdsScore,
    pplan: item.recoveryProbabilityPct,
  });
  if (!g1c.hit) return false;
  if (!softBuyDayNotRed(item, dayPctFromSim)) return false;
  if (!softBuyRisingStreakAllows(item, dayPctFromSim, enhanceCtx)) return false;
  if (!softBuyTapeNotCatastrophic(item, dayPctFromSim)) return false;
  if (!softBuyContinuationAllows(enhanceCtx?.simRow ?? null)) return false;
  return softBuyForwardGainAdequate(item);
}

/** Min SDS — setup distanza/solidità. */
export const STUDY_EVIDENCE_SDS_MIN = 50;
/** Min EIS super-score — catalizzatore clinico/regolatorio osservato. */
export const STUDY_EVIDENCE_EIS_MIN = 45;

export type StudyEvidenceSignals = Pick<
  PortfolioLossAnalysisItem,
  "sdsScore" | "sdsVeto" | "eisSuperScore" | "stabilityVerdict"
>;

/** Evidenze reali (SDS + EIS) — polygon match rimosso (r≈0 vs outcome). */
export function studySetupEvidenceSupportsBuy(signals: StudyEvidenceSignals): boolean {
  if (signals.sdsVeto) return false;
  if (signals.stabilityVerdict === "exit" || signals.stabilityVerdict === "avoid") {
    return false;
  }
  const sds = signals.sdsScore;
  const eis = signals.eisSuperScore;
  if (sds == null || sds < STUDY_EVIDENCE_SDS_MIN) return false;
  if (eis == null || eis < STUDY_EVIDENCE_EIS_MIN) return false;
  return true;
}

/** Buy off-portfolio: Top2 sì + ENTER + P(plan) + target forward + evidenze studio. */
export function qualifiesStrictOpportunityBuy(item: PortfolioLossAnalysisItem): boolean {
  if (item.hasPosition) return false;
  if (item.investVerdict !== "yes") return false;
  if (item.exitDecision !== "hold") return false;
  const precatBuy = item.precatKind === "enter" || item.precatKind === "accumulate";
  if (!precatBuy) return false;
  const p = item.recoveryProbabilityPct;
  if (p == null || p < SIM_BUY_PROB_MIN) return false;
  if (!forwardBuyGainOutlookPositive(item)) return false;
  return studySetupEvidenceSupportsBuy(item);
}

export type SuggestedActionEnhanceCtx = {
  marketContext?: MarketContextDecisionCtx | null;
  regulatoryRiskScore?: number | null;
  externalAlignmentScore?: number | null;
  volumeAnomalyScore?: number | null;
  /** Book-level Urgent SELL G2 keys (20% purchased+gains budget). */
  urgentSellG2Keys?: ReadonlySet<string> | null;
  /** Per-ticker Risk v2 (0–100) for Soft SELL G1. */
  riskV2?: number | null;
  /** Per-ticker regulatory risk (0–100) for Soft SELL G1. */
  regRisk?: number | null;
  /** Simulation row — BETA / LIQ / Var.% for BUY quality gates. */
  simRow?: Record<string, unknown> | null;
  /** Chart points — fallback for 7d / 3M / 6M when sheet columns missing. */
  chartPts?: ChartPoint[] | null;
  /**
   * Prior session returns newest-first (Yahoo intraday 1h), for Soft BUY
   * rising ≥2d when CD charts are sparse/stale.
   */
  priorSessionPcts?: Array<number | null | undefined>;
  /**
   * Real book was sold recently (ignoreSheet+soldAt within cooldown) —
   * block Soft BUY so we do not re-propose the same name immediately.
   */
  recentlySoldBlocked?: boolean;
  /**
   * Peak open MTM € from invest_sim_history for this key (Gen 4 giveback Soft SELL).
   * Giveback only promotes SELL when current open MTM € ≤ 0.
   */
  peakPnlEur?: number | null;
  /**
   * Confirmed 5m volume acceleration (T_double ≤30 min) — Soft BUY High Vol.
   */
  volumeAccel?: {
    flagged: boolean;
    score?: number | null;
    doublingMinutes?: number | null;
    rvol?: number | null;
  } | null;
  /**
   * Catalyst desk VOL vs prev % — Soft BUY day-1 when ≥150% (with news bullish).
   */
  volSurgePct?: number | null;
  /**
   * Catalyst desk Clin/Fin/Corp/Access scores (36h) — Soft BUY day-1 / Soft SELL boost.
   */
  newsScores?: NewsDimensionScores | null;
};

/** True when desk Vol surge and/or T_double High Vol is active. */
export function softBuyCatalystVolSurge(
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): boolean {
  if (enhanceCtx?.volumeAccel?.flagged === true) return true;
  return isVolumeSurge(enhanceCtx?.volSurgePct);
}

/** Soft BUY day-1 news leg (Scores Σ > 0). */
export function softBuyCatalystNewsBullish(
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): boolean {
  return newsDimensionBullish(enhanceCtx?.newsScores ?? null);
}

/** Soft SELL catalyst boost (Scores Σ < 0). */
export function softSellCatalystNewsBearish(
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): boolean {
  return newsDimensionBearish(enhanceCtx?.newsScores ?? null);
}

function finalizeSuggestedAction(
  action: TickerSimEvaluation["suggestedAction"],
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
  dayPctFromSim?: number | null,
): TickerSimEvaluation["suggestedAction"] {
  if (action !== "buy") return action;
  const simRow = enhanceCtx?.simRow ?? null;
  const dayPct =
    dayPctFromSim ??
    (simRow ? buildRecommendationSignalCtx(simRow, enhanceCtx?.chartPts).d1 : null);
  // Wind-run / early-peak Soft BUY: β / liq / multi-horizon demote → ranking only, not drop.
  if (softBuyWindOrEarlyPeakHit(simRow, dayPct)) return "buy";
  if (enhanceCtx?.volumeAccel?.flagged) return "buy";
  // Day-1 catalyst Soft BUY — same: desk Vol+news aligned, skip quality demote.
  if (
    softBuyCatalystVolSurge(enhanceCtx) &&
    softBuyCatalystNewsBullish(enhanceCtx)
  ) {
    return "buy";
  }
  const signalCtx = buildRecommendationSignalCtx(
    enhanceCtx?.simRow,
    enhanceCtx?.chartPts,
  );
  return applyDirectionalSignalDemotion(action, signalCtx).action;
}

function shouldHoldPortfolioExit(
  item: PortfolioLossAnalysisItem,
  enhance?: SuggestedActionEnhanceCtx | null,
): boolean {
  const marketContext =
    enhance?.marketContext ?? buildMarketContextDecisionCtx(getCachedMarketContextSnapshot());
  return portfolioExitRecoveryGuardsActive({
    curveRisingHold: item.curveRisingHold,
    investVerdict: item.investVerdict,
    recoveryProbabilityPct: item.recoveryProbabilityPct,
    recoveryCoversLoss: item.recoveryCoversLoss,
    pnlPct24h: item.pnlPct24h,
    pnlPct: item.pnlPct,
    planReturnPct: item.planReturnPct,
    curvePeakReturnPct: item.curvePeakReturnPct,
    stabilityVerdict: item.stabilityVerdict,
    marketContext,
    regulatoryRiskScore: enhance?.regulatoryRiskScore,
    externalAlignmentScore: enhance?.externalAlignmentScore,
    volumeAnomalyScore: enhance?.volumeAnomalyScore,
    simRow: enhance?.simRow,
  });
}

/** Session green (Var. Giorn. > 0) — never recommend SELL into a rising day (CERS +13% / −2.8% total). */
export function sessionDayIsGreen(
  item: Pick<PortfolioLossAnalysisItem, "pnlPct24h">,
  dayPctFromSim?: number | null,
): boolean {
  const day =
    item.pnlPct24h != null && Number.isFinite(item.pnlPct24h)
      ? item.pnlPct24h
      : dayPctFromSim != null && Number.isFinite(dayPctFromSim)
        ? dayPctFromSim
        : null;
  return day != null && day > 0;
}

/** Borderline recovery → Review; failed thesis → stay on Sell path. */
function shouldDemotePortfolioExitToReview(
  item: PortfolioLossAnalysisItem,
  composite: CompositeScoreResult,
): boolean {
  if (composite.zone !== "loss" || composite.score < COMPOSITE_LOSS_REVIEW_MIN) return false;
  const p = item.recoveryProbabilityPct;
  if (p == null || !Number.isFinite(p)) return false;
  return p >= RECOVERY_HOLD_PROB_MIN - 10 && item.recoveryCoversLoss !== false;
}

/** Allinea chip P(plan) all'azione sim loop (non solo exitDecision grezzo). */
export function planProbDecisionForDisplay(
  exitDecision: PortfolioLossAnalysisItem["exitDecision"],
  suggestedAction: TickerSimEvaluation["suggestedAction"],
): PortfolioLossAnalysisItem["exitDecision"] {
  switch (suggestedAction) {
    case "hold":
      return "hold";
    case "sell":
      return "exit";
    case "buy":
      return "hold";
    case "review":
      return "review";
    default:
      return exitDecision;
  }
}

export type BuyRecommendationSignals = Pick<
  PortfolioLossAnalysisItem,
  | "hasPosition"
  | "exitDecision"
  | "investVerdict"
  | "precatKind"
  | "recoveryProbabilityPct"
  | "pnlPct24h"
  | "daysToCd"
>;

export function isOffPortfolioBuyRecommended(signals: BuyRecommendationSignals): boolean {
  return qualifiesStrictOpportunityBuy(signals as PortfolioLossAnalysisItem);
}

/** Soglia P(plan) minima per buy nel loop sim — esportata per UI/tooltip. */
export const SIM_LOOP_BUY_PROB_MIN = SIM_BUY_PROB_MIN;
export const SIM_LOOP_BUY_WATCH_PROB_MIN = SIM_BUY_WATCH_PROB_MIN;

export type SimBuyGateResult = {
  allowed: boolean;
  reason: string | null;
};

/** Stessa barra del loop sim / monitor suggerimenti — per pulsante Buy in Decision Lab. */
export function evaluateSimBuyGate(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  lang: "it" | "en",
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): SimBuyGateResult {
  if (deriveSuggestedAction(item, inPaper, null, null, enhanceCtx) === "buy") {
    return { allowed: true, reason: null };
  }
  return { allowed: false, reason: explainBuyBlockReason(item, inPaper, lang) };
}

export function buildSimBuyGateByKey(
  items: PortfolioLossAnalysisItem[],
  lang: "it" | "en",
  inPaper = false,
): Map<string, SimBuyGateResult> {
  const map = new Map<string, SimBuyGateResult>();
  for (const item of items) {
    map.set(item.key, evaluateSimBuyGate(item, inPaper, lang));
  }
  return map;
}

function softSellG1ForItem(
  item: PortfolioLossAnalysisItem,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
  simRow?: Record<string, unknown> | null,
) {
  return evaluateSoftSellGrade1({
    hasPosition: true,
    pnlPct: item.pnlPct,
    pplan: item.recoveryProbabilityPct,
    riskV2: enhanceCtx?.riskV2,
    regRisk: enhanceCtx?.regRisk ?? enhanceCtx?.regulatoryRiskScore,
    simRow: simRow === undefined ? enhanceCtx?.simRow : simRow,
    investedAt: item.investedAt,
    catalystBearish: softSellCatalystNewsBearish(enhanceCtx),
  });
}

function maybeRecordSoftSellFire(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  enhanceCtx: SuggestedActionEnhanceCtx | null | undefined,
  action: TickerSimEvaluation["suggestedAction"],
): void {
  if (action !== "sell") return;
  if (!inPaper && !item.hasPosition) return;
  try {
    const g1 = softSellG1ForItem(item, enhanceCtx);
    recordSoftSellFireOnce({
      key: item.key,
      ticker: item.ticker,
      investedAt: item.investedAt ?? null,
      ts: new Date().toISOString(),
      pnlPct: item.pnlPct ?? null,
      pplan: item.recoveryProbabilityPct ?? null,
      riskV2: enhanceCtx?.riskV2 ?? null,
      reg: enhanceCtx?.regRisk ?? enhanceCtx?.regulatoryRiskScore ?? null,
      sessionsElapsed: nyseSessionsElapsedSince(item.investedAt),
      deepFloor: softSellG1IsDeepFloor(g1),
      g1Hit: g1.hit,
      g2: Boolean(enhanceCtx?.urgentSellG2Keys?.has(item.key)),
      reason: g1.reason,
    });
  } catch {
    /* snapshot must never block REC */
  }
}

export function deriveSuggestedAction(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  scoreCtx?: CompositeScoreContext | null,
  adviceFeedback?: AdviceFeedback | null,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): TickerSimEvaluation["suggestedAction"] {
  const raw = deriveSuggestedActionRaw(
    item,
    inPaper,
    scoreCtx,
    adviceFeedback,
    enhanceCtx,
  );
  const finalized = finalizeSuggestedAction(
    raw,
    enhanceCtx,
    buildRecommendationSignalCtx(enhanceCtx?.simRow, enhanceCtx?.chartPts).d1,
  );
  maybeRecordSoftSellFire(item, inPaper, enhanceCtx, finalized);
  return finalized;
}

function deriveSuggestedActionRaw(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  scoreCtx?: CompositeScoreContext | null,
  adviceFeedback?: AdviceFeedback | null,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): TickerSimEvaluation["suggestedAction"] {
  const composite = computeCompositeForLossItem(item, scoreCtx);

  if (inPaper) {
    const paperMtmUp =
      item.pnlPct != null && Number.isFinite(item.pnlPct) && item.pnlPct > 0;
    if (
      !paperMtmUp &&
      evaluateSoftSellGiveback({
        hasPosition: true,
        peakPnlEur: enhanceCtx?.peakPnlEur,
        pnlEur: item.pnlEur,
        capitalEur: item.capital,
        investedAt: item.investedAt,
      }).hit
    ) {
      return "sell";
    }
    if (item.exitDecision === "exit") {
      if (paperMtmUp) {
        return "hold";
      }
      // Deep Soft SELL (−12%) beats green-day HOLD (same as live book).
      {
        const softSell = softSellG1ForItem(item, enhanceCtx);
        if (softSellG1IsDeepFloor(softSell)) return "sell";
      }
      if (sessionDayIsGreen(item)) return "hold";
      if (shouldHoldPortfolioExit(item, enhanceCtx)) return "hold";
      if (
        adviceFeedback &&
        demoteAction("sell", item.recoveryProbabilityPct, adviceFeedback).demotedTo === "review"
      ) {
        return "hold";
      }
      if (shouldDemotePortfolioExitToReview(item, composite)) return "review";
      return "sell";
    }
    // Paper: Urgent SELL G2 / Soft SELL G1 still apply when marked in loss.
    if (
      item.pnlPct != null &&
      Number.isFinite(item.pnlPct) &&
      item.pnlPct <= 0
    ) {
      if (enhanceCtx?.urgentSellG2Keys?.has(item.key)) return "sell";
      {
        const softSell = softSellG1ForItem(item, enhanceCtx);
        if (softSell.hit) {
          // Deep floor ignores recovery + green-day HOLD; milder Soft SELL does not.
          if (
            softSellG1IsDeepFloor(softSell) ||
            (!sessionDayIsGreen(item) && !shouldHoldPortfolioExit(item, enhanceCtx))
          ) {
            return "sell";
          }
        }
      }
    }
    if (item.exitDecision === "hold") return "hold";
    return "review";
  }

  /** Portafoglio reale: soft/urgent SELL before sticky HOLD/rescue. */
  if (item.hasPosition) {
    const mtmUp =
      item.pnlPct != null && Number.isFinite(item.pnlPct) && item.pnlPct > 0;
    const dayGreen = sessionDayIsGreen(item);
    // Gen 4 giveback — only when open MTM € is underwater (flat €0 ≠ exit).
    if (
      !mtmUp &&
      evaluateSoftSellGiveback({
        hasPosition: true,
        peakPnlEur: enhanceCtx?.peakPnlEur,
        pnlEur: item.pnlEur,
        capitalEur: item.capital,
        investedAt: item.investedAt,
      }).hit
    ) {
      return "sell";
    }
    // Continuation exhaustion — take-profit is manual while MTM > 0.
    if (
      !mtmUp &&
      shouldContinuationExhaustedSell({
        hasPosition: true,
        pnlPct: item.pnlPct,
        simRow: enhanceCtx?.simRow,
      })
    ) {
      return "sell";
    }
    if (!mtmUp) {
      // Urgent G2 + deep Soft SELL (−12%) beat green-day HOLD.
      // Mild red + green bounce still HOLD (CERS −2.8% / +13% day case).
      if (enhanceCtx?.urgentSellG2Keys?.has(item.key)) {
        return "sell";
      }
      const softSell = softSellG1ForItem(item, enhanceCtx);
      if (softSellG1IsDeepFloor(softSell)) {
        return "sell";
      }
      if (
        !dayGreen &&
        softSell.hit &&
        !shouldHoldPortfolioExit(item, enhanceCtx)
      ) {
        return "sell";
      }
    }
    // Mild losses: never SELL into a green session (bounce day).
    if (dayGreen) {
      if (item.exitDecision === "exit" || item.exitDecision === "hold") return "hold";
      // Decent P(plan) → Hold, not blanket Uncertain on a green session.
      if (
        item.recoveryProbabilityPct != null &&
        Number.isFinite(item.recoveryProbabilityPct) &&
        item.recoveryProbabilityPct >= SOFT_BUY_G1_PPLAN_MIN
      ) {
        return "hold";
      }
      return "review";
    }
    if (item.exitDecision === "exit") {
      if (mtmUp) return "hold";
      if (shouldHoldPortfolioExit(item, enhanceCtx)) return "hold";
      if (shouldDemotePortfolioExitToReview(item, composite)) return "review";
      return "sell";
    }
    if (item.exitDecision === "hold") {
      return "hold";
    }
    // Top2 wait / unclear exit with P≥50 → Hold (same band as score pplan_hold).
    if (
      item.recoveryProbabilityPct != null &&
      Number.isFinite(item.recoveryProbabilityPct) &&
      item.recoveryProbabilityPct >= SOFT_BUY_G1_PPLAN_MIN
    ) {
      return "hold";
    }
    return "review";
  }

  /** Off-book BUY: Soft G1 / G1w / G1c then strict Top2 path. */
  if (!item.hasPosition) {
    // Warrants (JSPRW…): never Soft/Top2 BUY — trade the common (JSPR) only.
    if (isWarrantTicker(item.ticker)) {
      if (composite.score >= COMPOSITE_REVIEW_MIN) return "review";
      return "review";
    }
    const dayPctFromSim = buildRecommendationSignalCtx(
      enhanceCtx?.simRow,
      enhanceCtx?.chartPts,
    ).d1;
    const softBuy = evaluateSoftBuyGrade1({
      hasPosition: false,
      sdsScore: item.sdsScore,
      pplan: item.recoveryProbabilityPct,
    });
    const precatHardBlock = item.precatKind === "sell";
    const tapeOk = softBuyTapeNotCatastrophic(item, dayPctFromSim);
    // Hard: never Soft BUY into a red session (KZIA −7.85% with G1w wind).
    // Rising ≥2d already implies green today for G1; G1w used to skip rising.
    const dayOk = softBuyDayNotRed(item, dayPctFromSim);
    const windRun = softBuyWindOrEarlyPeakHit(enhanceCtx?.simRow ?? null, dayPctFromSim);
    // Soft BUY G1w — vento + corsa forte (10d≥5% · P(cont)≥50 · edge≤0) or early peak (Δ≥8% · 0≤10d<5%).
    // Top2 / ↑2d / cooldown only rank; still need SDS/P + green day + tape + !precat.
    if (softBuy.hit && windRun && dayOk && tapeOk && !precatHardBlock) {
      return "buy";
    }
    // Just sold from the real book — block classic Soft BUY (G1w already passed).
    if (enhanceCtx?.recentlySoldBlocked) {
      if (
        item.recoveryProbabilityPct != null &&
        Number.isFinite(item.recoveryProbabilityPct) &&
        item.recoveryProbabilityPct >= SOFT_BUY_G1_PPLAN_MIN
      ) {
        return "hold";
      }
      return "review";
    }
    // Soft BUY G1v High Vol — T_double ≤30 min confirmed. SDS/P and ↑2d not required.
    if (
      evaluateSoftBuyHighVol({
        hasPosition: false,
        flagged: enhanceCtx?.volumeAccel?.flagged,
      }).hit &&
      !precatHardBlock &&
      dayOk &&
      tapeOk
    ) {
      return "buy";
    }
    // Soft BUY G1d day-1 catalyst — Vol surge + news Σ>0; ↑2d not required.
    // Aligns Rec with Catalyst desk (Vol / Scores) on hot mover days.
    if (
      evaluateSoftBuyDay1Catalyst({
        hasPosition: false,
        sdsScore: item.sdsScore,
        pplan: item.recoveryProbabilityPct,
        volSurge: softBuyCatalystVolSurge(enhanceCtx),
        newsBullish: softBuyCatalystNewsBullish(enhanceCtx),
      }).hit &&
      !precatHardBlock &&
      dayOk &&
      tapeOk
    ) {
      return "buy";
    }
    // Soft BUY G1 (volume) = Home what-if cutoff (Gen 4):
    // SDS/P · rising ≥2 sessions · green day · tape · !precat sell.
    // Top2 NO / P(cont) demote via ranking only (not hard block).
    // Forward ≥3% is NOT required here (BBNX Target +0.8% still BUY if ↑≥2d).
    // Book risk is capped by Urgent SELL G2 (20% purchased+gains) + giveback 20%.
    if (
      softBuy.hit &&
      !precatHardBlock &&
      dayOk &&
      softBuyRisingStreakAllows(item, dayPctFromSim, enhanceCtx) &&
      tapeOk
    ) {
      return "buy";
    }
    // Soft BUY G1c: strong study — override Top2 NO / precat avoid.
    if (qualifiesSoftBuyGrade1c(item, dayPctFromSim, enhanceCtx)) {
      return "buy";
    }
    if (dayOk && qualifiesStrictOpportunityBuy(item)) {
      return "buy";
    }
    // Not Soft BUY: P≥50 → HOLD (wait / no entry), not blanket Uncertain.
    // Matches Decision Chart score path `pplan_hold` and keeps Soft BUY as the only BUY volume gate.
    if (
      item.recoveryProbabilityPct != null &&
      Number.isFinite(item.recoveryProbabilityPct) &&
      item.recoveryProbabilityPct >= SOFT_BUY_G1_PPLAN_MIN
    ) {
      return "hold";
    }
    if (item.exitDecision === "hold") {
      if (composite.score >= COMPOSITE_REVIEW_MIN) return "review";
      return "hold";
    }
    if (composite.score >= COMPOSITE_REVIEW_MIN) return "review";
    return "review";
  }

  return "review";
}

export type RecommendationBucket =
  | "buy"
  | "sell"
  | "hold"
  | "already_paper"
  | "already_portfolio"
  | "top2_no_precat_avoid"
  | "top2_no"
  | "top2_wait"
  | "yes_exit_low_p"
  | "yes_exit_prob"
  | "other";

/** Audit: classifica perché un ticker non è BUY (o quale raccomandazione ha). */
export function classifyRecommendationBucket(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  action: TickerSimEvaluation["suggestedAction"] = deriveSuggestedAction(item, inPaper),
): RecommendationBucket {
  if (action === "buy") return "buy";
  if (action === "sell") return "sell";
  if (action === "hold") return "hold";
  if (inPaper) return "already_paper";
  if (item.hasPosition) return "already_portfolio";
  if (item.investVerdict === "no") {
    return item.precatKind === "avoid" ? "top2_no_precat_avoid" : "top2_no";
  }
  if (item.investVerdict === "wait") return "top2_wait";
  if (item.investVerdict === "yes" && item.exitDecision === "exit") {
    if (
      item.recoveryProbabilityPct != null &&
      item.recoveryProbabilityPct < SIM_BUY_PROB_MIN
    ) {
      return "yes_exit_low_p";
    }
    return "yes_exit_prob";
  }
  return "other";
}

/** Per monitor UI: perché un'opportunità non genera buy nel loop paper. */
export function explainBuyBlockReason(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  lang: "it" | "en",
): string | null {
  if (deriveSuggestedAction(item, inPaper) === "buy") return null;
  if (inPaper) return lang === "it" ? "Già nel portfolio paper" : "Already in paper portfolio";
  if (
    !forwardBuyGainOutlookPositive(item) &&
    item.recoveryProbabilityPct != null &&
    item.recoveryProbabilityPct >= SIM_BUY_PROB_MIN &&
    !item.hasPosition
  ) {
    return lang === "it"
      ? "Guadagno atteso al target ≤ 0 — BUY solo con plusvalenza attesa"
      : "Expected gain to target ≤ 0 — BUY requires positive expected return";
  }
  if (item.investVerdict === "no") {
    const mom24 = item.pnlPct24h;
    if (
      mom24 != null &&
      mom24 >= MOMENTUM_24H_BUY_MIN &&
      item.recoveryProbabilityPct != null &&
      item.recoveryProbabilityPct >= MOMENTUM_P_STRONG_MIN - 3
    ) {
      return lang === "it"
        ? `Top2 no — serve Var.24h ≥${MOMENTUM_24H_BUY_MIN}% e P≥${MOMENTUM_P_STRONG_MIN}% per override momentum`
        : `Top2 no — need 24h ≥${MOMENTUM_24H_BUY_MIN}% and P≥${MOMENTUM_P_STRONG_MIN}% for momentum override`;
    }
    return lang === "it"
      ? `Verdetto Top2 «no» (precat ${item.precatKind})`
      : `Top2 verdict «no» (precat ${item.precatKind})`;
  }
  if (item.investVerdict === "wait") {
    return lang === "it"
      ? "Verdetto Top2 «wait» — timing/ROI non allineati; serve Top2 sì + ENTER"
      : "Top2 verdict «wait» — timing/ROI not aligned; need Top2 yes + ENTER";
  }
  if (item.investVerdict === "yes" && item.exitDecision !== "hold") {
    return lang === "it"
      ? "Segnale ENTER non ancora allineato (badge WAIT/review) — no Buy tattico"
      : "ENTER signal not aligned yet (WAIT/review badge) — no tactical Buy";
  }
  if (item.investVerdict === "yes" && item.exitDecision === "hold") {
    const p = item.recoveryProbabilityPct;
    if (p != null && p < SIM_BUY_PROB_MIN) {
      return lang === "it"
        ? `P(plan) ${Math.round(p)}% < ${SIM_BUY_PROB_MIN}%`
        : `P(plan) ${Math.round(p)}% < ${SIM_BUY_PROB_MIN}%`;
    }
    if (!forwardBuyGainOutlookPositive(item)) {
      return lang === "it"
        ? "Target forward ≤ 0 — serve plusvalenza attesa sul piano"
        : "Forward target ≤ 0 — positive plan gain required";
    }
    if (item.sdsVeto) {
      return lang === "it" ? "SDS veto attivo" : "SDS veto active";
    }
    const sds = item.sdsScore;
    if (sds == null || sds < STUDY_EVIDENCE_SDS_MIN) {
      return lang === "it"
        ? `SDS ${sds != null ? Math.round(sds) : "—"} < ${STUDY_EVIDENCE_SDS_MIN} — setup debole`
        : `SDS ${sds != null ? Math.round(sds) : "—"} < ${STUDY_EVIDENCE_SDS_MIN} — weak setup`;
    }
    const eis = item.eisSuperScore;
    if (eis == null || eis < STUDY_EVIDENCE_EIS_MIN) {
      return lang === "it"
        ? `EIS clinico assente o basso (${eis != null ? Math.round(eis) : "—"}) — servono dati studio favorevoli`
        : `Clinical EIS missing or low (${eis != null ? Math.round(eis) : "—"}) — favorable study data required`;
    }
  }
  if (item.investVerdict === "yes" && item.exitDecision === "exit") {
    if (
      item.recoveryProbabilityPct != null &&
      item.recoveryProbabilityPct < SIM_BUY_PROB_MIN
    ) {
      return lang === "it"
        ? `P(plan) ${Math.round(item.recoveryProbabilityPct)}% < ${SIM_BUY_PROB_MIN}%`
        : `P(plan) ${Math.round(item.recoveryProbabilityPct)}% < ${SIM_BUY_PROB_MIN}%`;
    }
    return lang === "it"
      ? "Exit probabilistico (SDS veto / forward basso)"
      : "Probabilistic exit (SDS veto / low forward)";
  }
  return lang === "it" ? "In review — gate intermedio" : "In review — intermediate gate";
}

export type BuyReasonKind =
  | "top2_yes_hold"
  | "soft_buy_g1"
  | "soft_buy_g1c"
  | "soft_buy_g1v"
  | "soft_buy_g1d";

function fmtBuyReasonPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v)}%`;
}

/** Quale ramo di deriveSuggestedAction ha prodotto «buy» (null se non buy). */
export function classifyBuyReasonKind(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): BuyReasonKind | null {
  if (inPaper) return null;
  if (item.hasPosition && item.exitDecision === "exit") return null;
  if (deriveSuggestedAction(item, inPaper, null, null, enhanceCtx) !== "buy") return null;
  if (qualifiesStrictOpportunityBuy(item)) return "top2_yes_hold";
  if (
    evaluateSoftBuyHighVol({
      hasPosition: Boolean(item.hasPosition),
      flagged: enhanceCtx?.volumeAccel?.flagged,
    }).hit
  ) {
    return "soft_buy_g1v";
  }
  const soft = evaluateSoftBuyGrade1({
    hasPosition: Boolean(item.hasPosition),
    sdsScore: item.sdsScore,
    pplan: item.recoveryProbabilityPct,
  });
  const dayPctFromSim = buildRecommendationSignalCtx(
    enhanceCtx?.simRow,
    enhanceCtx?.chartPts,
  ).d1;
  if (
    evaluateSoftBuyDay1Catalyst({
      hasPosition: Boolean(item.hasPosition),
      sdsScore: item.sdsScore,
      pplan: item.recoveryProbabilityPct,
      volSurge: softBuyCatalystVolSurge(enhanceCtx),
      newsBullish: softBuyCatalystNewsBullish(enhanceCtx),
    }).hit
  ) {
    return "soft_buy_g1d";
  }
  if (qualifiesSoftBuyGrade1c(item, dayPctFromSim, enhanceCtx)) return "soft_buy_g1c";
  if (
    soft.hit &&
    item.precatKind !== "sell" &&
    softBuyRisingStreakAllows(item, dayPctFromSim, enhanceCtx) &&
    softBuyTapeNotCatastrophic(item, dayPctFromSim)
  ) {
    return "soft_buy_g1";
  }
  return null;
}

/** Per popup/monitor: perché il sistema raccomanda BUY. */
export function explainBuyReason(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  lang: "it" | "en",
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): string | null {
  const kind = classifyBuyReasonKind(item, inPaper, enhanceCtx);
  if (!kind) return null;

  const p = fmtBuyReasonPct(item.recoveryProbabilityPct);
  const sds =
    item.sdsScore != null && Number.isFinite(item.sdsScore)
      ? String(Math.round(item.sdsScore))
      : "—";

  switch (kind) {
    case "top2_yes_hold":
      return lang === "it"
        ? `Top2 sì + ENTER + P(plan) ${p} + match/SDS/EIS ok`
        : `Top2 yes + ENTER + P(plan) ${p} + match/SDS/EIS ok`;
    case "soft_buy_g1":
      return lang === "it"
        ? `Soft BUY G1: SDS ${sds} ≥ ${SOFT_BUY_G1_SDS_MIN} · P(plan) ${p} ≥ ${SOFT_BUY_G1_PPLAN_MIN} · Top2≠NO · rialzo ≥${SOFT_BUY_RISING_DAYS_MIN}g · forward>0`
        : `Soft BUY G1: SDS ${sds} ≥ ${SOFT_BUY_G1_SDS_MIN} · P(plan) ${p} ≥ ${SOFT_BUY_G1_PPLAN_MIN} · Top2≠NO · rising ≥${SOFT_BUY_RISING_DAYS_MIN}d · forward>0`;
    case "soft_buy_g1c":
      return lang === "it"
        ? `Soft BUY G1c (studio): SDS ${sds} ≥ ${SOFT_BUY_G1C_SDS_MIN} · P(plan) ${p} ≥ ${SOFT_BUY_G1C_PPLAN_MIN} · rialzo ≥${SOFT_BUY_RISING_DAYS_MIN}g · target ≥${SOFT_BUY_G1_MIN_PLAN_RETURN_PCT}% (override Top2 NO)`
        : `Soft BUY G1c (study): SDS ${sds} ≥ ${SOFT_BUY_G1C_SDS_MIN} · P(plan) ${p} ≥ ${SOFT_BUY_G1C_PPLAN_MIN} · rising ≥${SOFT_BUY_RISING_DAYS_MIN}d · target ≥${SOFT_BUY_G1_MIN_PLAN_RETURN_PCT}% (overrides Top2 NO)`;
    case "soft_buy_g1v": {
      const td = enhanceCtx?.volumeAccel?.doublingMinutes;
      const tdLab =
        td != null && Number.isFinite(td) ? `${Math.round(td)} min` : "≤30 min";
      return lang === "it"
        ? `Soft BUY High Vol: volume raddoppia ogni ${tdLab} (RVOL log-slope confermato)`
        : `Soft BUY High Vol: volume doubling every ${tdLab} (confirmed RVOL log-slope)`;
    }
    case "soft_buy_g1d":
      return lang === "it"
        ? `Soft BUY day-1 catalyst: SDS ${sds} ≥ ${SOFT_BUY_G1_SDS_MIN} · P(plan) ${p} ≥ ${SOFT_BUY_G1_PPLAN_MIN} · Vol surge · Scores Σ>0 (↑2d non richiesto)`
        : `Soft BUY day-1 catalyst: SDS ${sds} ≥ ${SOFT_BUY_G1_SDS_MIN} · P(plan) ${p} ≥ ${SOFT_BUY_G1_PPLAN_MIN} · Vol surge · Scores Σ>0 (↑2d not required)`;
    default:
      return null;
  }
}

/** Avviso quando BUY contraddice segnali deboli — riservato a estensioni future. */
export function explainBuyWarning(
  _item: PortfolioLossAnalysisItem,
  _inPaper: boolean,
  _lang: "it" | "en",
): string | null {
  return null;
}

export type SellReasonKind =
  | "slope_decline"
  | "stability_exit"
  | "top2_exit_yes"
  | "low_recovery"
  | "precat_avoid"
  | "soft_sell_g1"
  | "urgent_sell_g2"
  | "cont_exhaustion";

/** Per popup/monitor: perché il sistema raccomanda SELL (paper o portafoglio reale). */
export function classifySellReasonKind(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): SellReasonKind | null {
  if (deriveSuggestedAction(item, inPaper, null, null, enhanceCtx) !== "sell") return null;
  // Need a book to exit: paper sim loop and/or real Simulation position.
  if (!inPaper && !item.hasPosition) return null;
  if (enhanceCtx?.urgentSellG2Keys?.has(item.key)) return "urgent_sell_g2";
  if (
    shouldContinuationExhaustedSell({
      hasPosition: true,
      pnlPct: item.pnlPct,
      simRow: enhanceCtx?.simRow,
    })
  ) {
    return "cont_exhaustion";
  }
  const softSell = softSellG1ForItem(item, enhanceCtx);
  if (softSell.hit && item.exitDecision !== "exit") return "soft_sell_g1";
  if (item.stabilityVerdict === "exit" || item.stabilityVerdict === "avoid") {
    return "stability_exit";
  }
  if (
    item.recoveryProbabilityPct != null &&
    item.recoveryProbabilityPct < RECOVERY_HOLD_PROB_MIN - 10
  ) {
    return "low_recovery";
  }
  if (item.precatKind === "avoid" || item.precatKind === "sell") return "precat_avoid";
  if (item.investVerdict === "yes") return "top2_exit_yes";
  return "slope_decline";
}

export function explainSellReason(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  lang: "it" | "en",
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): string | null {
  const kind = classifySellReasonKind(item, inPaper, enhanceCtx);
  if (!kind) return null;
  const p = fmtBuyReasonPct(item.recoveryProbabilityPct);
  switch (kind) {
    case "urgent_sell_g2":
      return lang === "it"
        ? "Urgent SELL G2 — budget 20% di (acquistato + guadagnato) sforato (taglio perdite day più drastiche)"
        : "Urgent SELL G2 — 20% of (purchased + gains) budget breached (cut fastest day losers)";
    case "cont_exhaustion":
      return lang === "it"
        ? "Take-profit — G10≥5% con edge esaurimento > base bucket"
        : "Take-profit — G10≥5% with exhaustion edge above bucket base";
    case "soft_sell_g1":
      return lang === "it"
        ? `Soft SELL G1 — P&L ≤ −2.5% con risk/reg/P(plan)/G10 deboli (P ${p})`
        : `Soft SELL G1 — P&L ≤ −2.5% with weak risk/reg/P(plan)/G10 (P ${p})`;
    case "stability_exit":
      return lang === "it"
        ? "Pendenza instabile / segnale uscita — P(recovery) insufficiente"
        : "Unstable slope / exit signal — recovery odds too low";
    case "low_recovery":
      return lang === "it"
        ? `P(recovery) ${p} — curva non copre la perdita`
        : `P(recovery) ${p} — curve does not cover the loss`;
    case "precat_avoid":
      return lang === "it"
        ? `Precat ${item.precatKind} + Top2 uscita`
        : `Precat ${item.precatKind} + Top2 exit`;
    case "top2_exit_yes":
      return lang === "it"
        ? "Top2 conferma uscita — pendenza ↓ sostenuta"
        : "Top2 confirms exit — sustained slope ↓";
    case "slope_decline":
    default:
      return lang === "it"
        ? "Pendenza ↓ sostenuta — esci prima del deterioramento"
        : "Sustained slope ↓ — exit before further deterioration";
  }
}

/** Tesi hold/recupero — quando non vendere nonostante precat/slope cauti. */
export function explainHoldThesis(
  item: PortfolioLossAnalysisItem,
  lang: "it" | "en",
): string | null {
  if (!item.hasPosition) return null;
  if (deriveSuggestedAction(item, false) === "sell") return null;

  const p = fmtBuyReasonPct(item.recoveryProbabilityPct);
  const target =
    item.planReturnPct != null && Number.isFinite(item.planReturnPct)
      ? `${item.planReturnPct >= 0 ? "+" : ""}${item.planReturnPct.toFixed(1)}%`
      : null;
  const peakDays = item.daysToCurvePeak;
  const horizon =
    peakDays != null && peakDays > 0
      ? lang === "it"
        ? `~${peakDays}g`
        : `~${peakDays}d`
      : item.daysToCd != null && item.daysToCd > 0
        ? lang === "it"
          ? `entro T−${item.daysToCd}`
          : `by T−${item.daysToCd}`
        : null;

  if (item.curveRisingHold) {
    return lang === "it"
      ? `Attendi recupero — curva modello ↑${horizon ? `, picco ${horizon}` : ""}${target ? `, target ${target}` : ""}${p !== "—" ? ` · P(recovery) ${p}` : ""}`
      : `Hold for recovery — model curve ↑${horizon ? `, peak ${horizon}` : ""}${target ? `, target ${target}` : ""}${p !== "—" ? ` · P(recovery) ${p}` : ""}`;
  }
  if (
    item.recoveryProbabilityPct != null &&
    item.recoveryProbabilityPct >= RECOVERY_HOLD_PROB_MIN &&
    item.recoveryCoversLoss !== false
  ) {
    return lang === "it"
      ? `Attendi recupero — P(recovery) ${p}${target ? `, target ${target}` : ""}${horizon ? ` · orizzonte ${horizon}` : ""}`
      : `Hold for recovery — P(recovery) ${p}${target ? `, target ${target}` : ""}${horizon ? ` · horizon ${horizon}` : ""}`;
  }
  if (
    item.precatKind === "accumulate" &&
    item.daysToCd != null &&
    item.daysToCd > SIM_HOT_ZONE_DAYS
  ) {
    return lang === "it"
      ? `Watch zone — accumula/attendi, CD tra ${item.daysToCd}g${target ? ` · target ${target}` : ""}`
      : `Watch zone — accumulate/wait, CD in ${item.daysToCd}d${target ? ` · target ${target}` : ""}`;
  }
  return null;
}

function readingsFromItem(
  item: PortfolioLossAnalysisItem,
  harmony: AssessmentHarmonyAudit | null,
  harmonized?: HarmonizedCurveContext,
): CurveReadings {
  return {
    supernovaPeakPct: harmonized?.supernovaPeakPct ?? item.curvePeakReturnPct,
    planTargetPct: item.planReturnPct,
    planCdPct: item.planCdReturnPct,
    precatKind: item.precatKind,
    slope5d: item.slope5d,
    slope20d: item.slope20d,
    pred5Pp: item.pred5Pp,
    curveGapPct: item.curveGapPct,
    harmonyMaxGapPp: harmony?.maxPredGapPp ?? null,
    harmonyAligned: harmony?.aligned ?? null,
    stabilityVerdict: item.stabilityVerdict,
  };
}

function evaluateItem(
  item: PortfolioLossAnalysisItem,
  simRow: Record<string, unknown> | null,
  chartPts: ChartPoint[] | undefined,
  paperKeys: Set<string>,
  lang: "it" | "en",
  adviceFeedback?: AdviceFeedback | null,
  enhanceCtx?: SuggestedActionEnhanceCtx | null,
): TickerSimEvaluation {
  const harmonized = buildHarmonizedCurveContext(item.ticker, simRow, chartPts);
  const { ids, labels } = detectCurveMisalignments(item, harmonized.harmony, lang, harmonized);
  const inPaper = paperKeys.has(item.key);
  const top2 = resolveTop2VerdictFields(item.hasPosition, item.investVerdict);
  const metrics = simRow
    ? signalMetricsFromSimRow(simRow, Object.keys(simRow), { chartPoints: chartPts ?? null })
    : null;
  const scoreCtx: CompositeScoreContext = {
    signalScore: metrics?.score ?? null,
  };
  const composite = computeCompositeForLossItem(item, scoreCtx);
  return {
    key: item.key,
    ticker: item.ticker,
    hasPosition: item.hasPosition,
    inPaperPortfolio: inPaper,
    daysToCd: item.daysToCd,
    readings: readingsFromItem(item, harmonized.harmony, harmonized),
    misalignments: ids,
    misalignmentLabels: labels,
    exitDecision: item.exitDecision,
    investVerdict: item.investVerdict,
    entryVerdict: top2.entryVerdict,
    exitVerdict: top2.exitVerdict,
    probPct: item.recoveryProbabilityPct,
    suggestedAction: deriveSuggestedAction(
      item,
      inPaper,
      scoreCtx,
      adviceFeedback,
      enhanceCtx,
    ),
    planReturnPct: item.planReturnPct,
    pnlPct24h: item.pnlPct24h,
    pnlPct: item.pnlPct,
    precatVerdictAgree: precatVerdictAgrees(item),
    exitReason: item.exitReason,
    compositeScore: composite.score,
    scoringZone: composite.zone,
    scoreBreakdown: composite.breakdown,
    compositeDampened: composite.dampened,
  };
}

/**
 * Pure: walk evaluations against the current paper portfolio and return the
 * trades + next portfolio. Exported for tests; the production path is
 * `runDecisionSimTick`.
 */
export function simulatePaperTrades(
  evaluations: TickerSimEvaluation[],
  portfolio: PaperPosition[],
  at: string,
  capitalPerTrade: number,
  maxOpenPositions: number,
  opts?: SimulatePaperTradesOpts,
): { trades: PaperTradeEvent[]; portfolioAfter: PaperPosition[] } {
  const trades: PaperTradeEvent[] = [];
  const keys = new Set(portfolio.map((p) => p.key));
  let next = [...portfolio];

  // Pass 0 — orphan sweep. Any position whose key no longer appears in the
  // current evaluations list (post-CD, removed from sim table, etc.) is
  // force-closed at the last known mark. This keeps the paper portfolio in
  // sync with the live universe so the "open positions still maturing" table
  // and the BUY-coverage KPIs stay coherent.
  const evalKeys = new Set(evaluations.map((e) => e.key));
  for (const pos of portfolio) {
    if (evalKeys.has(pos.key)) continue;
    const pnlPct = pos.lastMarkPct ?? 0;
    const pnlEur = Math.round((pos.capital * pnlPct) / 100 * 100) / 100;
    trades.push({
      at,
      ticker: pos.ticker,
      key: pos.key,
      side: "sell",
      reason: "orphaned (post-CD or removed from sim table)",
      capital: pos.capital,
      pnlPctSimulated: pnlPct,
      pnlEurSimulated: pnlEur,
    });
    next = next.filter((p) => p.key !== pos.key);
    keys.delete(pos.key);
  }

  for (const ev of evaluations) {
    if (ev.suggestedAction !== "buy" || keys.has(ev.key)) continue;
    if (next.length >= maxOpenPositions) continue;
    const buyCapital = opts?.resolveBuyCapital?.(ev) ?? capitalPerTrade;
    if (!(buyCapital > 0) || !Number.isFinite(buyCapital)) continue;
    const top2Label = getTop2Label(ev.hasPosition, ev.investVerdict, "en");
    const buyRow = opts?.simRowByKey?.get(ev.key) ?? null;
    const entrySpot = buyRow ? currentPriceFromRow(buyRow) : null;
    const pos: PaperPosition = {
      key: ev.key,
      ticker: ev.ticker,
      entryAt: at,
      capital: buyCapital,
      entryReason: `${top2Label} · P ${ev.probPct?.toFixed(0) ?? "—"}%`,
      entryPlanReturnPct: ev.planReturnPct,
      entryProbPct: ev.probPct,
      entryBuyPrice:
        entrySpot != null && entrySpot > 0
          ? Math.round(entrySpot * 10000) / 10000
          : null,
    };
    next.push(pos);
    keys.add(ev.key);
    trades.push({
      at,
      ticker: ev.ticker,
      key: ev.key,
      side: "buy",
      reason: `${top2Label} · ${ev.exitDecision}`,
      capital: buyCapital,
      pnlPctSimulated: null,
      pnlEurSimulated: null,
    });
  }

  for (const ev of evaluations) {
    if (ev.suggestedAction !== "sell" || !keys.has(ev.key)) continue;
    const pos = next.find((p) => p.key === ev.key);
    if (!pos) continue;
    // Prefer position MTM (stamped mark), then eval — same order as open-book piggy.
    const pnlPct =
      (typeof pos.lastMarkPct === "number" && Number.isFinite(pos.lastMarkPct)
        ? pos.lastMarkPct
        : null) ??
      ev.pnlPct ??
      ev.pnlPct24h ??
      0;
    const pnlEur = Math.round((pos.capital * pnlPct) / 100 * 100) / 100;
    const sellReason =
      ev.exitDecision === "exit"
        ? ev.exitReason?.trim() || "exit signal"
        : "exit signal";
    trades.push({
      at,
      ticker: ev.ticker,
      key: ev.key,
      side: "sell",
      reason: sellReason,
      capital: pos.capital,
      pnlPctSimulated: pnlPct,
      pnlEurSimulated: pnlEur,
    });
    next = next.filter((p) => p.key !== ev.key);
    keys.delete(ev.key);
  }

  return { trades, portfolioAfter: next };
}

function recs24hFromEvaluations(
  evaluations: TickerSimEvaluation[],
  capitalEur: number,
): number {
  let sum = 0;
  for (const ev of evaluations) {
    if (!ev.hasPosition && ev.suggestedAction !== "buy") continue;
    if (ev.pnlPct24h == null || !Number.isFinite(ev.pnlPct24h)) continue;
    sum += (capitalEur * ev.pnlPct24h) / 100;
  }
  return Math.round(sum * 100) / 100;
}

function summarizeTick(evaluations: TickerSimEvaluation[], trades: PaperTradeEvent[]): DecisionSimTickSummary {
  const misalign = misalignmentSummaryFromEvaluations(evaluations);
  let buy = 0;
  let sell = 0;
  let hold = 0;
  let review = 0;

  for (const ev of evaluations) {
    if (ev.suggestedAction === "buy") buy += 1;
    else if (ev.suggestedAction === "sell") sell += 1;
    else if (ev.suggestedAction === "hold") hold += 1;
    else if (ev.suggestedAction === "review") review += 1;
  }

  return {
    ...misalign,
    buySignals: buy,
    sellSignals: sell,
    holdSignals: hold,
    reviewSignals: review,
    tradesExecuted: trades.length,
  };
}

/** Un tick completo: valuta universo Simulation + esegue paper trades. */
export function buildDecisionSimEvaluations(ctx: DecisionSimContext): TickerSimEvaluation[] {
  const lang = ctx.lang;
  const paperKeys = new Set(ctx.paperPortfolio.map((p) => p.key));
  const history = ctx.history ?? null;
  const simRowByKey = buildSimRowByKeyMap(ctx.simTable?.rows ?? []);
  const paperPortfolio = backfillPaperEntryBuyPrices(ctx.paperPortfolio, simRowByKey);
  const paperByKey = new Map(paperPortfolio.map((p) => [p.key, p]));

  const portfolioItems = buildLossAnalysisItems(
    "portfolio",
    ctx.simTable,
    ctx.inputs,
    ctx.pointsBySeriesKey,
    lang,
    history,
    ctx.probOptions,
  );
  // Match operative Cutoff / Pulse — hot + watch (not watch-only).
  const oppItems = buildLossAnalysisItems(
    "opportunities",
    ctx.simTable,
    ctx.inputs,
    ctx.pointsBySeriesKey,
    lang,
    history,
    ctx.probOptions,
    "all",
  );

  const byKey = new Map<string, PortfolioLossAnalysisItem>();
  for (const it of [...portfolioItems, ...oppItems]) {
    byKey.set(it.key, it);
  }
  // Ensure every open paper name is evaluable even if outside CD filters.
  for (const pos of paperPortfolio) {
    if (byKey.has(pos.key)) continue;
    const row = simRowByKey.get(pos.key);
    if (!row) continue;
    const stub = buildLossAnalysisItems(
      "opportunities",
      { sheet: "Simulation", columns: [], rows: [row] },
      ctx.inputs,
      ctx.pointsBySeriesKey,
      lang,
      history,
      ctx.probOptions,
      "all",
    )[0];
    if (stub) byKey.set(pos.key, stub);
  }

  // Overlay paper MTM onto items held in paper (opportunity pnlPct was 0).
  for (const [key, item] of [...byKey.entries()]) {
    const pos = paperByKey.get(key);
    if (!pos) continue;
    byKey.set(key, overlayPaperMarksOnLossItem(item, pos, simRowByKey.get(key) ?? null));
  }

  // Urgent SELL G2 on the **paper** book (not real hasPosition), + prior session €.
  const paperOpenKeys = paperPortfolio.map((p) => p.key);
  const prior = priorSessionDayPnlByKey(history, paperOpenKeys);
  const paperLegs = paperPortfolio.map((pos) => {
    const item = byKey.get(pos.key);
    const simRow = simRowByKey.get(pos.key) ?? null;
    const marks = resolvePaperPositionMarks(pos, simRow);
    const dayPct = marks.dayPnlPct ?? item?.pnlPct24h ?? null;
    const dayEur =
      marks.dayPnlEur !== 0
        ? marks.dayPnlEur
        : dayPct != null && pos.capital > 0
          ? Math.round(((pos.capital * dayPct) / 100) * 100) / 100
          : 0;
    const totalPct = marks.totalPnlPct ?? item?.pnlPct ?? null;
    const pnlEur =
      item?.pnlEur != null && Number.isFinite(item.pnlEur)
        ? item.pnlEur
        : totalPct != null && pos.capital > 0
          ? Math.round(((pos.capital * totalPct) / 100) * 100) / 100
          : null;
    return attachContCutPriority(
      {
        key: pos.key,
        ticker: pos.ticker,
        dayPnlEur: Math.round((dayEur + (prior.get(pos.key) ?? 0)) * 100) / 100,
        dayPnlPct: dayPct,
        totalPnlPct: totalPct,
        capitalEur: pos.capital,
        pnlEur,
      },
      simRow,
    );
  });
  const urgentG2 = evaluateUrgentSellGrade2Book(paperLegs);

  const evaluations: TickerSimEvaluation[] = [];
  for (const item of byKey.values()) {
    const simRow = simRowByKey.get(item.key) ?? null;
    const sk = item.seriesKey ?? (simRow ? simulationRowSeriesKey(simRow) : null);
    const chartPts = sk ? ctx.pointsBySeriesKey.get(sk) : undefined;
    const lossRisk =
      (ctx.catalogByRowKey
        ? lookupLossRiskByRowKey(ctx.catalogByRowKey, item.key)
        : null) ??
      (ctx.lossRiskCatalog
        ? lookupLossRisk(ctx.lossRiskCatalog, item.ticker)
        : null);
    const regSigned = resolveRegSignedScoreForTicker(
      item.ticker,
      simRow,
      ctx.autoRegSnap ?? null,
    );
    const regRisk = regRiskFromSignedScore(regSigned);
    const enhance: SuggestedActionEnhanceCtx = {
      urgentSellG2Keys: urgentG2.urgentKeys,
      riskV2: lossRisk?.riskScore ?? null,
      regRisk,
      regulatoryRiskScore: regRisk,
      simRow,
      chartPts: chartPts ?? null,
      recentlySoldBlocked: softBuyBlockedByBookSell(ctx.inputs, {
        key: item.key,
        ticker: item.ticker,
      }),
      peakPnlEur: peakPnlEurFromHistory(
        history,
        item.key,
        ctx.inputs?.[item.key]?.investedAt ??
          paperByKey.get(item.key)?.entryAt ??
          null,
      ),
    };
    evaluations.push(
      evaluateItem(item, simRow, chartPts, paperKeys, lang, ctx.adviceFeedback, enhance),
    );
  }

  evaluations.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return evaluations;
}

/** Un tick completo: valuta universo Simulation + esegue paper trades. */
export function runDecisionSimTick(ctx: DecisionSimContext): DecisionSimTick {
  const capital = ctx.capitalPerTrade ?? DEFAULT_PLAN_CAPITAL_EUR;
  const at = new Date().toISOString();

  const evaluations = buildDecisionSimEvaluations(ctx);
  const filtered = ctx.simLoopExecution?.filterEvaluations
    ? ctx.simLoopExecution.filterEvaluations(evaluations)
    : evaluations;

  const maxOpen = ctx.maxOpenPositions ?? DEFAULT_MAX_OPEN_POSITIONS;
  const tickId = `tick_${Date.now()}`;
  const simRowByKey = buildSimRowByKeyMap(ctx.simTable?.rows ?? []);
  const paperWithEntry = backfillPaperEntryBuyPrices(ctx.paperPortfolio, simRowByKey);

  const { trades, portfolioAfter: rawAfter } = simulatePaperTrades(
    filtered,
    paperWithEntry,
    at,
    capital,
    maxOpen,
    {
      resolveBuyCapital: ctx.simLoopExecution?.resolveBuyCapital,
      simRowByKey,
    },
  );

  // Freeze P/SDS/EIS/Reg at BUY (before live drift) + stamp paper positions.
  let stampedAfter = rawAfter;
  if (trades.some((t) => t.side === "buy")) {
    const entryByKey = capturePaperBuyEntrySnapshots({
      trades,
      evaluations: filtered,
      simRowByKey,
      sdsRows: ctx.probOptions?.sdsRows,
      autoRegSnap: ctx.autoRegSnap ?? null,
      lang: ctx.lang,
    });
    if (entryByKey.size > 0) {
      stampedAfter = rawAfter.map((p) => {
        const scores = entryByKey.get(p.key);
        if (!scores) return p;
        if (
          p.entrySds != null ||
          p.entryEisScore != null ||
          p.entryRegulatoryScore != null
        ) {
          return p;
        }
        return {
          ...p,
          entrySds: scores.sds,
          entryEisScore: scores.eisScore,
          entryRegulatoryScore: scores.regulatoryScore,
        };
      });
    }
  }

  const portfolioAfter = stampPortfolioMarks(stampedAfter, filtered);
  const summary = summarizeTick(filtered, trades);

  const badBuyKeys = new Set(ctx.badBuyScoredKeys ?? []);
  const experiment = evaluateExperimentTick({
    tickId,
    at,
    evaluations: filtered,
    trades,
    portfolioBefore: ctx.paperPortfolio,
    portfolioAfter,
    maxOpenPositions: maxOpen,
    capitalPerTrade: capital,
    closedPnlBeforeEur: ctx.cumulativeClosedPnlEur ?? 0,
    closedTradeCountBefore: ctx.closedTradeCount ?? 0,
    badBuyScoredKeys: badBuyKeys,
  });

  summary.piggyBank = experiment.piggyBank;
  summary.missedBuyCount = experiment.scorecardDelta.missedBuyCount ?? 0;
  summary.adviceEventsCount = experiment.adviceEvents.length;
  summary.recs24hHypotheticalEur = recs24hFromEvaluations(filtered, capital);
  summary.fairRecs24hEur = computeFairRecs24hFromEvaluations(filtered, portfolioAfter, {
    capitalPerTrade: capital,
    maxOpenPositions: maxOpen,
  });

  return {
    id: tickId,
    at,
    evaluations: filtered,
    portfolioBefore: ctx.paperPortfolio,
    portfolioAfter,
    trades,
    summary,
    adviceEvents: experiment.adviceEvents,
    experimentDelta: experiment.scorecardDelta,
    badBuyScoredKeys: [...badBuyKeys],
  };
}

/**
 * Re-mark open paper positions after a market refresh — no BUY/SELL execution.
 * Used before the response window; trades run later via pending batch.
 */
export function runDecisionSimMarkTick(ctx: DecisionSimContext): DecisionSimTick {
  const capital = ctx.capitalPerTrade ?? DEFAULT_PLAN_CAPITAL_EUR;
  const at = new Date().toISOString();
  const evaluations = buildDecisionSimEvaluations(ctx);
  const filtered = ctx.simLoopExecution?.filterEvaluations
    ? ctx.simLoopExecution.filterEvaluations(evaluations)
    : evaluations;
  const maxOpen = ctx.maxOpenPositions ?? DEFAULT_MAX_OPEN_POSITIONS;
  const tickId = `mark_${Date.now()}`;
  const trades: PaperTradeEvent[] = [];
  const simRowByKey = buildSimRowByKeyMap(ctx.simTable?.rows ?? []);
  const paperWithEntry = backfillPaperEntryBuyPrices(ctx.paperPortfolio, simRowByKey);

  const portfolioAfter = stampPortfolioMarks(paperWithEntry, evaluations);
  const summary = summarizeTick(filtered, trades);

  const badBuyKeys = new Set(ctx.badBuyScoredKeys ?? []);
  const experiment = evaluateExperimentTick({
    tickId,
    at,
    evaluations: filtered,
    trades,
    portfolioBefore: ctx.paperPortfolio,
    portfolioAfter,
    maxOpenPositions: maxOpen,
    capitalPerTrade: capital,
    closedPnlBeforeEur: ctx.cumulativeClosedPnlEur ?? 0,
    closedTradeCountBefore: ctx.closedTradeCount ?? 0,
    badBuyScoredKeys: badBuyKeys,
  });

  summary.piggyBank = experiment.piggyBank;
  summary.missedBuyCount = experiment.scorecardDelta.missedBuyCount ?? 0;
  summary.adviceEventsCount = experiment.adviceEvents.length;
  summary.recs24hHypotheticalEur = recs24hFromEvaluations(filtered, capital);
  summary.fairRecs24hEur = computeFairRecs24hFromEvaluations(filtered, portfolioAfter, {
    capitalPerTrade: capital,
    maxOpenPositions: maxOpen,
  });

  return {
    id: tickId,
    at,
    evaluations: filtered,
    portfolioBefore: ctx.paperPortfolio,
    portfolioAfter,
    trades,
    summary,
    adviceEvents: experiment.adviceEvents,
    experimentDelta: experiment.scorecardDelta,
    badBuyScoredKeys: [...badBuyKeys],
  };
}

export type ActionSolidityTier = "buy" | "sell" | "other";

/** Tier for KPI snapshot sort — buy raccomandati, poi sell, poi resto. */
export function actionSolidityTier(
  item: PortfolioLossAnalysisItem,
  inPaper = false,
): ActionSolidityTier {
  const action = deriveSuggestedAction(item, inPaper);
  if (action === "buy") return "buy";
  if (action === "sell") return "sell";
  return "other";
}

/** Score più alto = buy più solido (Top2, P(plan), precat, target). */
export function buySolidityScore(item: PortfolioLossAnalysisItem): number {
  let score = 0;
  if (item.investVerdict === "yes") score += 500;
  else if (item.investVerdict === "wait") score += 220;
  const prob = item.recoveryProbabilityPct;
  if (prob != null && Number.isFinite(prob)) score += prob * 4;
  if (item.exitDecision === "hold") score += 180;
  else if (item.exitDecision === "review") score += 90;
  if (item.precatKind === "enter") score += 120;
  else if (item.precatKind === "accumulate") score += 80;
  if (precatVerdictAgrees(item)) score += 60;
  const plan = item.planReturnPct;
  if (plan != null && plan > 0) score += Math.min(plan, 25) * 4;
  if (item.curveRisingHold) score += 40;
  if (
    item.stabilityVerdict === "entry" ||
    item.stabilityVerdict === "persistent" ||
    item.stabilityVerdict === "watch"
  ) {
    score += 35;
  }
  if ((item.curvePeakReturnPct ?? 0) > 0) score += 25;
  if (!item.planTargetProvisional) score += 15;
  return score;
}

/** Score più alto = sell più solido (exit, slope ↓, P(rec) bassa). */
export function sellSolidityScore(item: PortfolioLossAnalysisItem): number {
  let score = 0;
  if (item.exitDecision === "exit") score += 500;
  if (item.investVerdict === "no") score += 200;
  if (item.stabilityVerdict === "exit") score += 160;
  else if (item.stabilityVerdict === "avoid") score += 140;
  const prob = item.recoveryProbabilityPct;
  if (prob != null && Number.isFinite(prob)) score += Math.max(0, 100 - prob) * 3;
  if (item.precatKind === "avoid" || item.precatKind === "sell") score += 90;
  if (item.inLoss) score += 70;
  if ((item.slope5d ?? 0) < -0.02) score += 50;
  if ((item.planReturnPct ?? 0) <= 0) score += 40;
  if (!item.curveRisingHold) score += 25;
  return score;
}

/**
 * KPI snapshot: displayed BUY (incl. Soft BUY) first, then SELL, then hold/uncertain.
 * `recForItem` should match the REC column (Decision Chart / Soft BUY enhance).
 */
export function sortLossItemsByDisplayedRec(
  items: PortfolioLossAnalysisItem[],
  recForItem: (item: PortfolioLossAnalysisItem) => "buy" | "hold" | "review" | "sell" | null | undefined,
  withinTier?: (tierItems: PortfolioLossAnalysisItem[]) => PortfolioLossAnalysisItem[],
): PortfolioLossAnalysisItem[] {
  const buy: PortfolioLossAnalysisItem[] = [];
  const sell: PortfolioLossAnalysisItem[] = [];
  const other: PortfolioLossAnalysisItem[] = [];

  for (const item of items) {
    const rec = recForItem(item);
    if (rec === "buy") buy.push(item);
    else if (rec === "sell") sell.push(item);
    else other.push(item);
  }

  const finalize = (
    tierItems: PortfolioLossAnalysisItem[],
    scoreFn: (item: PortfolioLossAnalysisItem) => number,
  ) => {
    const byScore = [...tierItems].sort((a, b) => {
      const d = scoreFn(b) - scoreFn(a);
      if (d !== 0) return d;
      return a.ticker.localeCompare(b.ticker);
    });
    return withinTier ? withinTier(byScore) : byScore;
  };

  return [
    ...finalize(buy, buySolidityScore),
    ...finalize(sell, sellSolidityScore),
    ...(withinTier
      ? withinTier([...other].sort((a, b) => a.ticker.localeCompare(b.ticker)))
      : [...other].sort((a, b) => a.ticker.localeCompare(b.ticker))),
  ];
}

/**
 * KPI snapshot: buy più solidi in cima, poi sell più solidi, poi hold/review.
 * `withinTier` optional (es. Match % poligono dentro ogni gruppo).
 * Prefer {@link sortLossItemsByDisplayedRec} when the table shows Soft BUY.
 */
export function sortLossItemsByActionSolidity(
  items: PortfolioLossAnalysisItem[],
  inPaper = false,
  withinTier?: (tierItems: PortfolioLossAnalysisItem[]) => PortfolioLossAnalysisItem[],
): PortfolioLossAnalysisItem[] {
  return sortLossItemsByDisplayedRec(
    items,
    (item) => {
      const tier = actionSolidityTier(item, inPaper);
      if (tier === "buy") return "buy";
      if (tier === "sell") return "sell";
      return "hold";
    },
    withinTier,
  );
}

export { MISALIGN_LABELS };
