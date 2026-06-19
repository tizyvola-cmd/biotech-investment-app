/**
 * Loop simulazione invest/disinvest — legge curve + suggerimenti, rileva disallineamenti,
 * esegue paper trades virtuali per misurare potenza segnali.
 */
import type { ChartPoint, SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { buildSimRowByKeyMap } from "./investSimKeys";
import type { InvestSimInputs } from "./investSimStorage";
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
import { RECOVERY_HOLD_PROB_MIN } from "./recoveryProbability";
import { portfolioExitRecoveryGuardsActive } from "./portfolioDeclineSell";
import { demoteAction, type AdviceFeedback } from "./adviceFeedback";
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
  /** Ultimo P&L % mark-to-market (tick precedente). */
  lastMarkPct?: number | null;
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
};

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

const SIM_BUY_PROB_MIN = 40;
/** Top2 wait + precat enter/accumulate + P(plan) ≥ soglia → buy watchlist. */
const SIM_BUY_WATCH_PROB_MIN = 45;
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

function buyIfGainExpected(
  item: PortfolioLossAnalysisItem,
  scoreCtx?: CompositeScoreContext | null,
): TickerSimEvaluation["suggestedAction"] {
  if (forwardBuyGainOutlookPositive(item)) return "buy";
  const composite = computeCompositeForLossItem(item, scoreCtx);
  if (composite.score >= COMPOSITE_REVIEW_MIN && !item.hasPosition) return "review";
  return item.exitDecision === "hold" ? "hold" : "review";
}

function shouldHoldPortfolioExit(item: PortfolioLossAnalysisItem): boolean {
  return portfolioExitRecoveryGuardsActive(item);
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
  return deriveSuggestedAction(signals as PortfolioLossAnalysisItem, false) === "buy";
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
): SimBuyGateResult {
  if (deriveSuggestedAction(item, inPaper) === "buy") {
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

export function deriveSuggestedAction(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  scoreCtx?: CompositeScoreContext | null,
  adviceFeedback?: AdviceFeedback | null,
): TickerSimEvaluation["suggestedAction"] {
  const composite = computeCompositeForLossItem(item, scoreCtx);

  if (inPaper) {
    if (item.exitDecision === "exit") {
      if (shouldHoldPortfolioExit(item)) return "hold";
      if (
        adviceFeedback &&
        demoteAction("sell", item.recoveryProbabilityPct, adviceFeedback).demotedTo === "review"
      ) {
        return "hold";
      }
      if (composite.zone === "loss" && composite.score >= COMPOSITE_LOSS_REVIEW_MIN) {
        return "review";
      }
      return "sell";
    }
    if (item.exitDecision === "hold") return "hold";
    return "review";
  }

  /** Portafoglio reale: vendi solo con uscita netta — rispetta recovery / curva ↑ / watch accumulate. */
  if (item.hasPosition && item.exitDecision === "exit") {
    if (shouldHoldPortfolioExit(item)) return "hold";
    if (composite.zone === "loss" && composite.score >= COMPOSITE_LOSS_REVIEW_MIN) {
      return "review";
    }
    return "sell";
  }

  const precatBuy = item.precatKind === "enter" || item.precatKind === "accumulate";
  const probOk =
    item.recoveryProbabilityPct == null || item.recoveryProbabilityPct >= SIM_BUY_PROB_MIN;
  if (item.investVerdict === "yes") {
    if (item.exitDecision === "hold" || item.exitDecision === "review") {
      return buyIfGainExpected(item, scoreCtx);
    }
    if (item.exitDecision === "exit" && precatBuy && probOk) {
      return buyIfGainExpected(item, scoreCtx);
    }
  }
  if (
    item.investVerdict === "wait" &&
    precatBuy &&
    item.recoveryProbabilityPct != null &&
    item.recoveryProbabilityPct >= SIM_BUY_WATCH_PROB_MIN
  ) {
    return buyIfGainExpected(item, scoreCtx);
  }

  const mom24 = item.pnlPct24h;
  const hasMomentum = mom24 != null && mom24 >= MOMENTUM_24H_BUY_MIN;
  const probPct = item.recoveryProbabilityPct;

  /** Gainer 24h + P(plan) forte: override Top2 no / precat avoid (recall opportunità perse). */
  if (
    hasMomentum &&
    probPct != null &&
    probPct >= MOMENTUM_P_STRONG_MIN &&
    item.precatKind !== "sell" &&
    !(item.precatKind === "avoid" && isForwardModelDeclining(item))
  ) {
    return buyIfGainExpected(item, scoreCtx);
  }

  /** Watch zone T−61…T−120: accumulate + P(plan) ok. */
  if (
    precatBuy &&
    item.daysToCd != null &&
    item.daysToCd > SIM_HOT_ZONE_DAYS &&
    probPct != null &&
    probPct >= SIM_BUY_PROB_MIN &&
    item.investVerdict !== "no"
  ) {
    return buyIfGainExpected(item, scoreCtx);
  }

  /** Pre-CD vicino (late) + momentum: cattura gainers fuori finestra T−90→T−14. */
  if (
    item.precatKind === "late" &&
    hasMomentum &&
    probPct != null &&
    probPct >= SIM_BUY_WATCH_PROB_MIN
  ) {
    return buyIfGainExpected(item, scoreCtx);
  }

  if (item.exitDecision === "hold") {
    if (composite.score >= COMPOSITE_REVIEW_MIN && !item.hasPosition) return "review";
    return "hold";
  }
  if (item.exitDecision === "review" && item.investVerdict === "yes") {
    return buyIfGainExpected(item, scoreCtx);
  }
  if (composite.score >= COMPOSITE_REVIEW_MIN && !item.hasPosition) return "review";
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
      ? "Verdetto Top2 «wait» — ROI/timing non ancora ok"
      : "Top2 verdict «wait» — ROI/timing not ready";
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
  | "top2_yes_review"
  | "top2_yes_exit_precat"
  | "top2_wait_precat"
  | "momentum_override"
  | "watch_zone_accumulate"
  | "late_momentum";

function fmtBuyReasonPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v)}%`;
}

function fmtBuyReasonMom(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

/** Quale ramo di deriveSuggestedAction ha prodotto «buy» (null se non buy). */
export function classifyBuyReasonKind(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
): BuyReasonKind | null {
  if (inPaper) return null;
  if (item.hasPosition && item.exitDecision === "exit") return null;
  if (deriveSuggestedAction(item, inPaper) !== "buy") return null;

  const precatBuy = item.precatKind === "enter" || item.precatKind === "accumulate";
  const probOk =
    item.recoveryProbabilityPct == null || item.recoveryProbabilityPct >= SIM_BUY_PROB_MIN;
  if (item.investVerdict === "yes") {
    if (item.exitDecision === "hold") return "top2_yes_hold";
    if (item.exitDecision === "review") return "top2_yes_review";
    if (item.exitDecision === "exit" && precatBuy && probOk) return "top2_yes_exit_precat";
  }
  if (
    item.investVerdict === "wait" &&
    precatBuy &&
    item.recoveryProbabilityPct != null &&
    item.recoveryProbabilityPct >= SIM_BUY_WATCH_PROB_MIN
  ) {
    return "top2_wait_precat";
  }

  const mom24 = item.pnlPct24h;
  const hasMomentum = mom24 != null && mom24 >= MOMENTUM_24H_BUY_MIN;
  const probPct = item.recoveryProbabilityPct;

  if (
    hasMomentum &&
    probPct != null &&
    probPct >= MOMENTUM_P_STRONG_MIN &&
    item.precatKind !== "sell"
  ) {
    return "momentum_override";
  }
  if (
    precatBuy &&
    item.daysToCd != null &&
    item.daysToCd > SIM_HOT_ZONE_DAYS &&
    probPct != null &&
    probPct >= SIM_BUY_PROB_MIN &&
    item.investVerdict !== "no"
  ) {
    return "watch_zone_accumulate";
  }
  if (
    item.precatKind === "late" &&
    hasMomentum &&
    probPct != null &&
    probPct >= SIM_BUY_WATCH_PROB_MIN
  ) {
    return "late_momentum";
  }
  return null;
}

/** Per popup/monitor: perché il sistema raccomanda BUY. */
export function explainBuyReason(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  lang: "it" | "en",
): string | null {
  const kind = classifyBuyReasonKind(item, inPaper);
  if (!kind) return null;

  const p = fmtBuyReasonPct(item.recoveryProbabilityPct);
  const mom = fmtBuyReasonMom(item.pnlPct24h);
  const precat = item.precatKind;

  switch (kind) {
    case "top2_yes_hold":
      return lang === "it" ? "Top2 sì + exit hold" : "Top2 yes + exit hold";
    case "top2_yes_review":
      return lang === "it" ? "Top2 sì + exit review" : "Top2 yes + exit review";
    case "top2_yes_exit_precat":
      return lang === "it"
        ? `Top2 sì + precat ${precat} + P(plan) ${p}`
        : `Top2 yes + precat ${precat} + P(plan) ${p}`;
    case "top2_wait_precat":
      return lang === "it"
        ? `Top2 wait + precat ${precat} + P(plan) ${p}`
        : `Top2 wait + precat ${precat} + P(plan) ${p}`;
    case "momentum_override":
      return lang === "it"
        ? `Override momentum 24h ${mom} + P(plan) ${p}`
        : `24h momentum override ${mom} + P(plan) ${p}`;
    case "watch_zone_accumulate":
      return lang === "it"
        ? `Watch zone T−61…120 + precat ${precat} + P(plan) ${p}`
        : `Watch zone T−61…120 + precat ${precat} + P(plan) ${p}`;
    case "late_momentum":
      return lang === "it"
        ? `Precat late + momentum 24h ${mom} + P(plan) ${p}`
        : `Precat late + 24h momentum ${mom} + P(plan) ${p}`;
    default:
      return null;
  }
}

/** Avviso quando BUY momentum contraddice Top2/precat (brief P3-A). */
export function explainBuyWarning(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
  lang: "it" | "en",
): string | null {
  if (classifyBuyReasonKind(item, inPaper) !== "momentum_override") return null;
  if (item.investVerdict === "no" || item.precatKind === "avoid") {
    return lang === "it"
      ? "Top2 e precat negativi — solo segnale momentum"
      : "Top2 and precat negative — momentum signal only";
  }
  return null;
}

export type SellReasonKind =
  | "slope_decline"
  | "stability_exit"
  | "top2_exit_yes"
  | "low_recovery"
  | "precat_avoid";

/** Per popup/monitor: perché il sistema raccomanda SELL su portafoglio. */
export function classifySellReasonKind(
  item: PortfolioLossAnalysisItem,
  inPaper: boolean,
): SellReasonKind | null {
  if (inPaper || !item.hasPosition || deriveSuggestedAction(item, inPaper) !== "sell") {
    return null;
  }
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
): string | null {
  const kind = classifySellReasonKind(item, inPaper);
  if (!kind) return null;
  const p = fmtBuyReasonPct(item.recoveryProbabilityPct);
  switch (kind) {
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
    suggestedAction: deriveSuggestedAction(item, inPaper, scoreCtx, adviceFeedback),
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
    const top2Label = getTop2Label(ev.hasPosition, ev.investVerdict, "en");
    const pos: PaperPosition = {
      key: ev.key,
      ticker: ev.ticker,
      entryAt: at,
      capital: capitalPerTrade,
      entryReason: `${top2Label} · P ${ev.probPct?.toFixed(0) ?? "—"}%`,
      entryPlanReturnPct: ev.planReturnPct,
      entryProbPct: ev.probPct,
    };
    next.push(pos);
    keys.add(ev.key);
    trades.push({
      at,
      ticker: ev.ticker,
      key: ev.key,
      side: "buy",
      reason: `${top2Label} · ${ev.exitDecision}`,
      capital: capitalPerTrade,
      pnlPctSimulated: null,
      pnlEurSimulated: null,
    });
  }

  for (const ev of evaluations) {
    if (ev.suggestedAction !== "sell" || !keys.has(ev.key)) continue;
    const pos = next.find((p) => p.key === ev.key);
    if (!pos) continue;
    const pnlPct = ev.pnlPct ?? ev.pnlPct24h ?? 0;
    const pnlEur = Math.round((pos.capital * pnlPct) / 100 * 100) / 100;
    trades.push({
      at,
      ticker: ev.ticker,
      key: ev.key,
      side: "sell",
      reason: ev.exitReason ?? "exit signal",
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

  const portfolioItems = buildLossAnalysisItems(
    "portfolio",
    ctx.simTable,
    ctx.inputs,
    ctx.pointsBySeriesKey,
    lang,
    null,
    ctx.probOptions,
  );
  const oppItems = buildLossAnalysisItems(
    "opportunities",
    ctx.simTable,
    ctx.inputs,
    ctx.pointsBySeriesKey,
    lang,
    null,
    ctx.probOptions,
    "watch",
  );

  const byKey = new Map<string, PortfolioLossAnalysisItem>();
  for (const it of [...portfolioItems, ...oppItems]) {
    byKey.set(it.key, it);
  }

  const simRowByKey = buildSimRowByKeyMap(ctx.simTable?.rows ?? []);

  const evaluations: TickerSimEvaluation[] = [];
  for (const item of byKey.values()) {
    const simRow = simRowByKey.get(item.key) ?? null;
    const sk = item.seriesKey ?? (simRow ? simulationRowSeriesKey(simRow) : null);
    const chartPts = sk ? ctx.pointsBySeriesKey.get(sk) : undefined;
    evaluations.push(evaluateItem(item, simRow, chartPts, paperKeys, lang, ctx.adviceFeedback));
  }

  evaluations.sort((a, b) => a.ticker.localeCompare(b.ticker));
  return evaluations;
}

/** Un tick completo: valuta universo Simulation + esegue paper trades. */
export function runDecisionSimTick(ctx: DecisionSimContext): DecisionSimTick {
  const capital = ctx.capitalPerTrade ?? DEFAULT_PLAN_CAPITAL_EUR;
  const at = new Date().toISOString();

  const evaluations = buildDecisionSimEvaluations(ctx);

  const maxOpen = ctx.maxOpenPositions ?? DEFAULT_MAX_OPEN_POSITIONS;
  const tickId = `tick_${Date.now()}`;

  const { trades, portfolioAfter: rawAfter } = simulatePaperTrades(
    evaluations,
    ctx.paperPortfolio,
    at,
    capital,
    maxOpen,
  );

  const portfolioAfter = stampPortfolioMarks(rawAfter, evaluations);
  const summary = summarizeTick(evaluations, trades);

  const badBuyKeys = new Set(ctx.badBuyScoredKeys ?? []);
  const experiment = evaluateExperimentTick({
    tickId,
    at,
    evaluations,
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
  summary.recs24hHypotheticalEur = recs24hFromEvaluations(evaluations, capital);
  summary.fairRecs24hEur = computeFairRecs24hFromEvaluations(evaluations, portfolioAfter, {
    capitalPerTrade: capital,
    maxOpenPositions: maxOpen,
  });

  return {
    id: tickId,
    at,
    evaluations,
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
  const maxOpen = ctx.maxOpenPositions ?? DEFAULT_MAX_OPEN_POSITIONS;
  const tickId = `mark_${Date.now()}`;
  const trades: PaperTradeEvent[] = [];

  const portfolioAfter = stampPortfolioMarks(ctx.paperPortfolio, evaluations);
  const summary = summarizeTick(evaluations, trades);

  const badBuyKeys = new Set(ctx.badBuyScoredKeys ?? []);
  const experiment = evaluateExperimentTick({
    tickId,
    at,
    evaluations,
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
  summary.recs24hHypotheticalEur = recs24hFromEvaluations(evaluations, capital);
  summary.fairRecs24hEur = computeFairRecs24hFromEvaluations(evaluations, portfolioAfter, {
    capitalPerTrade: capital,
    maxOpenPositions: maxOpen,
  });

  return {
    id: tickId,
    at,
    evaluations,
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
 * KPI snapshot: buy più solidi in cima, poi sell più solidi, poi hold/review.
 * `withinTier` optional (es. Match % poligono dentro ogni gruppo).
 */
export function sortLossItemsByActionSolidity(
  items: PortfolioLossAnalysisItem[],
  inPaper = false,
  withinTier?: (tierItems: PortfolioLossAnalysisItem[]) => PortfolioLossAnalysisItem[],
): PortfolioLossAnalysisItem[] {
  const buy: PortfolioLossAnalysisItem[] = [];
  const sell: PortfolioLossAnalysisItem[] = [];
  const other: PortfolioLossAnalysisItem[] = [];

  for (const item of items) {
    const tier = actionSolidityTier(item, inPaper);
    if (tier === "buy") buy.push(item);
    else if (tier === "sell") sell.push(item);
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

export { MISALIGN_LABELS };
