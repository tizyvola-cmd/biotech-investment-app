/**
 * Analisi posizioni in perdita — curve + verdetto uscita/rimani.
 */
import type { ChartPoint, SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { buildSimRowByKeyMap } from "./investSimKeys";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import { buildPrecatEntry, extractCurveInputs } from "./precatCurve";
import {
  computeSlopeStability,
  stabilityVerdict,
  type StabilityVerdict,
} from "./slopeStability";
import {
  declineInputFromSignalLike,
  isCurveRisingForHold,
  isSustainedDeclineSell,
} from "./portfolioDeclineSell";
import {
  resolveTop2InvestVerdict,
  top2InvestReasonShort,
  type Top2InvestVerdict,
} from "./top2DecisionHelpers";
import { resolveExpectedGainPlan, daysFromToday } from "./simulationPlanGain";
import type { ExpectedGainPlan } from "./simulationPlanGain";
import { planRoiBundleFromGainPlan, type PlanRoiBundle } from "./canonicalRoi";
import { resolveTodayExpectedVsRealUsd } from "./priceVariationHorizons";
import {
  resolveSlopeCapitalImpact,
  resolveSlopeStockPrices,
} from "./slopeStockPrices";
import { computeSimulationPosition, positionPnlForOpenRow } from "./simulationPosition";
import { signalMetricsFromSimRow } from "./investSignalScore";
import {
  detectPortfolioPositionAlerts,
  type PortfolioLossAlert,
} from "./portfolioLossUrgent";
import { normalizedRowKey } from "./investSimKeys";
import {
  filterOffPortfolioByCdHorizonSimRows,
  type SimCdHorizonScope,
} from "./simCdHorizonScope";
import { resolveInvestedAt, holdingDaysFromInvestedAt } from "./investSimStorage";
import { portfolioPnlTone } from "./portfolioGainLossStyle";
import { modelSlopesFromRecalibChart } from "./slopeRecalibCurve";
import { resolveAssessmentSupernovaPeak, resolveSupernovaTargetRoi } from "./supernovaTargetRoi";
import {
  capPlanReturnToForwardPeak,
} from "./planTargetPeakAlign";
import {
  computeEntryOutlook,
  computeRecoveryOutlook,
  type RecoveryProbabilityContext,
} from "./recoveryProbability";
import { planProbMisalignContextFromRow } from "./planProbCalibration";
import {
  watchPrecatProbOverride,
  qualifiesWatchZoneEnter,
} from "./watchZoneEntryPolicy";
import { buildSdsByTicker } from "./sdsTopOppGate";
import type { SdsRow } from "../api/supernova";
import { migSolidityKey } from "./entrySolidityMig";
import { buildCdPatternTickerRecommendation } from "./cdPatternRecommendation";
import { reconcileInvestSimInputs } from "./investSimKeys";
import type { EisSuperScoreState } from "../api/eisSuperScore";
import type { MigSoliditySnapshot } from "./entrySolidityMig";
import {
  resolveCdPatternWindowCorr,
  type CdPatternPolygonOverview,
} from "./cdPatternPolygonAccuracyView";

/** External polygon / SDS / MII / EIS inputs for probabilistic exit/entry. */
export type LossAnalysisProbOptions = {
  sdsRows?: SdsRow[] | null;
  migSolidityByKey?: Map<string, MigSoliditySnapshot>;
  eisSuperScoreState?: EisSuperScoreState | null;
  /** Learning Lab cd_pattern_polygon — ρ(match, stock) per CD window. */
  polygonOverview?: CdPatternPolygonOverview | null;
  /** Bulk audit: skip EIS lookup inside polygon rec. */
  lightweightPolygon?: boolean;
  /** Pre-reconciled invest inputs (avoids O(n²) reconcile in row loops). */
  mergedInputs?: InvestSimInputs;
};

function probCtxForAlert(
  alert: PortfolioLossAlert,
  simRow: Record<string, unknown> | null,
  chartPts: ChartPoint[] | null,
  inputs: InvestSimInputs,
  simRows: Record<string, unknown>[],
  lang: "it" | "en",
  probOptions?: LossAnalysisProbOptions | null,
): RecoveryProbabilityContext | undefined {
  if (!probOptions) return undefined;
  const langCode = lang === "it" ? "it" : "en";
  const merged =
    probOptions.mergedInputs ?? reconcileInvestSimInputs(inputs, simRows);
  const rec = simRow
    ? buildCdPatternTickerRecommendation({
        row: simRow,
        chartPoints: chartPts,
        investInputs: merged,
        sdsRows: probOptions.sdsRows ?? undefined,
        migByKey: probOptions.migSolidityByKey ?? new Map(),
        lang: langCode,
        includeEis: probOptions.lightweightPolygon !== true,
        eisSuperScoreState: probOptions.eisSuperScoreState ?? undefined,
      })
    : null;
  return recoveryContextFromExternals({
    simRow,
    chartPts,
    ticker: alert.ticker,
    completionDate: alert.completionDate,
    sdsRows: probOptions.sdsRows,
    migSolidityByKey: probOptions.migSolidityByKey,
    matchPct: rec?.matchPct ?? null,
    eisSuperScore: rec?.nearestEis?.superScore ?? rec?.nearestEis?.score ?? null,
    windowCorr: resolveCdPatternWindowCorr(probOptions.polygonOverview, {
      daysToCd: rec?.daysToCd ?? null,
      windowId: rec?.window?.id ?? null,
    }),
    segmentRoiPct: rec?.segmentRoiPct ?? null,
  });
}

/** Probabilistic context for a single alert (exported for urgent modal / tests). */
export function buildRecoveryProbContextForAlert(
  alert: PortfolioLossAlert,
  simRow: Record<string, unknown> | null,
  chartPts: ChartPoint[] | null,
  inputs: InvestSimInputs,
  simRows: Record<string, unknown>[],
  lang: "it" | "en",
  probOptions?: LossAnalysisProbOptions | null,
): RecoveryProbabilityContext | undefined {
  return probCtxForAlert(
    alert,
    simRow,
    chartPts,
    inputs,
    simRows,
    lang,
    probOptions,
  );
}

export type LossExitDecision = "exit" | "hold" | "review";

/** Strong P(plan) + polygon match soften precat avoid/too_early → Wait instead of hard Skip. */
export const PRECAT_PROB_OVERRIDE_MIN = 65;
export const PRECAT_MATCH_OVERRIDE_MIN = 80;

export type BuyExitResolutionOpts = {
  precatKind?: string;
  probPct?: number | null;
  matchPct?: number | null;
  forwardPct?: number | null;
  daysToCd?: number | null;
  targetProvisional?: boolean;
  dailyPct24h?: number | null;
  simRow?: Record<string, unknown> | null;
  sdsVeto?: boolean;
};

export function resolveBuyExitDecision(
  investVerdict: Top2InvestVerdict,
  probDecision: LossExitDecision | null,
  sdsVeto: boolean,
  opts?: BuyExitResolutionOpts,
): LossExitDecision {
  const probPct = opts?.probPct;
  const matchPct = opts?.matchPct;
  const precatKind = opts?.precatKind ?? "";
  const precatSoftBlock = precatKind === "avoid" || precatKind === "too_early";
  const strongProbOverride =
    precatSoftBlock &&
    probPct != null &&
    probPct >= PRECAT_PROB_OVERRIDE_MIN &&
    matchPct != null &&
    matchPct >= PRECAT_MATCH_OVERRIDE_MIN;
  const watchOverride =
    watchPrecatProbOverride({
      daysToCd: opts?.daysToCd ?? null,
      probPct,
      matchPct: matchPct ?? null,
      precatKind,
      targetProvisional: opts?.targetProvisional,
      dailyPct24h: opts?.dailyPct24h,
    }) ||
    qualifiesWatchZoneEnter({
      daysToCd: opts?.daysToCd ?? null,
      probPct,
      matchPct: matchPct ?? null,
      forwardPct: opts?.forwardPct ?? null,
      dailyPct24h: opts?.dailyPct24h,
      targetProvisional: opts?.targetProvisional,
      simRow: opts?.simRow ?? null,
      sdsVeto: opts?.sdsVeto,
    }).qualified;

  if (sdsVeto) {
    const precatBuy = precatKind === "enter" || precatKind === "accumulate";
    if (investVerdict === "yes" && precatBuy) return "review";
    return "exit";
  }
  if (investVerdict === "no" && !strongProbOverride && !watchOverride) return "exit";

  if (probDecision === "hold") return "hold";
  if ((strongProbOverride || watchOverride) && investVerdict === "no") {
    if (probDecision === "exit") return "review";
    return probDecision ?? "review";
  }
  if (probDecision) {
    const precatBuy = precatKind === "enter" || precatKind === "accumulate";
    if (investVerdict === "yes" && precatBuy && probDecision === "exit") return "review";
    return probDecision;
  }
  if (investVerdict === "yes") return "hold";
  return "review";
}

function mapBuyVerdictToExit(
  v: Top2InvestVerdict,
  probDecision: LossExitDecision | null,
  sdsVeto: boolean,
  opts?: BuyExitResolutionOpts,
): LossExitDecision {
  return resolveBuyExitDecision(v, probDecision, sdsVeto, opts);
}

export type LossAnalysisProfile = "portfolio" | "opportunities";

export type { RecoveryProbabilityContext } from "./recoveryProbability";

export type PortfolioLossAnalysisItem = PortfolioLossAlert & {
  /** Portfolio position vs off-portfolio hot-zone opportunity. */
  hasPosition: boolean;
  company: string;
  daysToCd: number | null;
  investedAt: string | null;
  holdDaysElapsed: number | null;
  planReturnPct: number | null;
  planCdReturnPct: number | null;
  curveGapPct: number | null;
  curveGapUsd: number | null;
  slope5d: number | null;
  slope20d: number | null;
  slope45d: number | null;
  pred5Pp: number | null;
  stabilityVerdict: StabilityVerdict;
  precatKind: string;
  precatLabel: string;
  investVerdict: Top2InvestVerdict;
  exitDecision: LossExitDecision;
  exitReason: string;
  /** Giorni da oggi al picco del tratto in salita prima del plateau. */
  daysToCurvePeak: number | null;
  /** Rendimento % modello da oggi all'apice. */
  curvePeakReturnPct: number | null;
  /** Serie grafico caricata (bundle Simulation). */
  chartPointsLoaded: boolean;
  /** Perdita € sul capitale per scostamento spot vs modello T+5 (come slope errors). */
  modelGapLossEur: number | null;
  /** Perdita € sul capitale per scostamento spot vs modello oggi (Δ vs curva). */
  curveGapLossEur: number | null;
  priceGapUsd: number | null;
  /** P&L ultime ~24h (Var. giornaliera vs chiusura precedente). */
  pnlEur24h: number | null;
  pnlPct24h: number | null;
  /** Δ vs ultimo snapshot portfolio (tra letture / refresh). */
  pnlEurSinceReading: number | null;
  pnlPctSinceReading: number | null;
  priorReadingTs: string | null;
  inLoss: boolean;
  /** Curva modello in salita — pill pendenza RISE anche se |slope| sotto soglia rumore. */
  curveRisingHold: boolean;
  /** Target watch zone provvisorio (≤60d refines). */
  planTargetProvisional?: boolean;
  planTargetConfidencePct?: number | null;
  /** P(recupero) 0–100 quando in perdita (modello probabilistico). */
  recoveryProbabilityPct: number | null;
  recoveryCoversLoss: boolean | null;
  recoveryExpectedValuePct: number | null;
  recoverySummary: string | null;
};

function mapInvestVerdictToExit(
  v: Top2InvestVerdict,
  slopeDeclining: boolean,
  stabVerdict: StabilityVerdict,
  inLoss: boolean,
  probDecision: LossExitDecision | null,
  curveRisingHold: boolean,
): LossExitDecision {
  /** Curva ↑ o P(recupero) forte — non forzare uscita meccanica su pendenza/precat. */
  if (curveRisingHold) {
    if (probDecision === "hold" || probDecision === "review") return probDecision;
    return v === "yes" && slopeDeclining ? "review" : "hold";
  }
  if (inLoss && probDecision === "hold") return "hold";
  if (inLoss && probDecision === "review") {
    if (v === "yes" && slopeDeclining && (stabVerdict === "exit" || stabVerdict === "avoid")) {
      return "exit";
    }
    return "review";
  }

  if (v === "yes" || slopeDeclining || stabVerdict === "exit" || stabVerdict === "avoid") {
    return "exit";
  }
  if (inLoss && probDecision) return probDecision;
  if (!inLoss && probDecision) return probDecision;
  if (v === "wait") return "review";
  return "review";
}

function forwardPctForOutlook(
  planReturnPct: number | null,
  peakReturnPct: number | null,
): number | null {
  if (peakReturnPct != null && peakReturnPct > 0) return peakReturnPct;
  if (planReturnPct != null && planReturnPct > 0) return planReturnPct;
  return planReturnPct ?? peakReturnPct;
}

export type PlanProbHeroPayload = {
  probPct: number;
  decision: LossExitDecision;
  summary: string;
};

/** P(plan) / P(recovery) readout — uses stored item fields or recomputes from card context. */
export function resolvePlanProbHeroPayload(
  item: PortfolioLossAnalysisItem,
  extras?: {
    matchPct?: number | null;
    sdsScore?: number | null;
    sdsVeto?: boolean;
    miiAngleDeg?: number | null;
    eisSuperScore?: number | null;
    windowCorr?: number | null;
    segmentRoiPct?: number | null;
    lang?: "it" | "en";
  },
): PlanProbHeroPayload {
  const lang = extras?.lang ?? "it";
  if (item.recoveryProbabilityPct != null && Number.isFinite(item.recoveryProbabilityPct)) {
    return {
      probPct: item.recoveryProbabilityPct,
      decision: item.exitDecision,
      summary: item.recoverySummary ?? "",
    };
  }
  const outlook = computeRecoveryOutlook({
    lang,
    inLoss: item.inLoss,
    pnlPct: item.pnlPct,
    forwardPct: forwardPctForOutlook(item.planReturnPct, item.curvePeakReturnPct),
    curveGapPct: item.curveGapPct,
    matchPct: extras?.matchPct ?? null,
    sdsScore: extras?.sdsScore ?? null,
    sdsVeto: extras?.sdsVeto ?? false,
    miiAngleDeg: extras?.miiAngleDeg ?? null,
    stabilityVerdict: item.stabilityVerdict,
    curveRisingHold: item.curveRisingHold,
    daysToCd: item.daysToCd,
    windowCorr: extras?.windowCorr ?? null,
    eisSuperScore: extras?.eisSuperScore ?? null,
    segmentRoiPct: extras?.segmentRoiPct ?? null,
  });
  return {
    probPct: outlook.probabilityPct,
    decision: outlook.suggestedDecision,
    summary: lang === "it" ? outlook.summaryIt : outlook.summaryEn,
  };
}

function buildRecoveryContext(
  alert: PortfolioLossAlert,
  simRow: Record<string, unknown> | null,
  chartPts: ChartPoint[] | null,
  lang: "it" | "en",
  inLoss: boolean,
  planReturnPct: number | null,
  peakReturnPct: number | null,
  curveRisingHold: boolean,
  stabVerdict: StabilityVerdict,
  daysToCd: number | null,
  ctx?: RecoveryProbabilityContext | null,
): Parameters<typeof computeRecoveryOutlook>[0] {
  const today = simRow ? resolveTodayExpectedVsRealUsd(simRow, chartPts) : { gapPct: null };
  return {
    lang,
    inLoss,
    pnlPct: alert.pnlPct,
    forwardPct: forwardPctForOutlook(planReturnPct, peakReturnPct),
    curveGapPct: ctx?.curveGapPct ?? today.gapPct,
    matchPct: ctx?.matchPct ?? null,
    sdsScore: ctx?.sdsScore ?? null,
    sdsVeto: ctx?.sdsVeto ?? false,
    miiAngleDeg: ctx?.miiAngleDeg ?? null,
    stabilityVerdict: stabVerdict,
    curveRisingHold,
    daysToCd,
    windowCorr: ctx?.windowCorr ?? null,
    eisSuperScore: ctx?.eisSuperScore ?? null,
    segmentRoiPct: ctx?.segmentRoiPct ?? null,
    dailyPct24h: parseDailyVarPct(simRow),
    targetProvisional: ctx?.targetProvisional ?? false,
    planTargetProvisional: ctx?.planTargetProvisional ?? ctx?.targetProvisional ?? false,
    supernovaPeakPct: ctx?.supernovaPeakPct ?? null,
    harmonyAligned: ctx?.harmonyAligned ?? null,
    harmonyMaxGapPp: ctx?.harmonyMaxGapPp ?? null,
    precatKind: ctx?.precatKind ?? null,
    investVerdict: ctx?.investVerdict ?? null,
    slope5d: ctx?.slope5d ?? null,
    pred5Pp: ctx?.pred5Pp ?? null,
    misalignmentIds: ctx?.misalignmentIds,
  };
}

function mergeProbContextForOutlook(
  alert: PortfolioLossAlert,
  simRow: Record<string, unknown> | null,
  chartPts: ChartPoint[] | null,
  probCtx: RecoveryProbabilityContext | null | undefined,
  extras: {
    planReturnPct: number | null;
    targetProvisional?: boolean;
    precatKind: string;
    investVerdict: string;
    slope5d: number | null;
    pred5Pp: number | null;
  },
): RecoveryProbabilityContext {
  const today = simRow ? resolveTodayExpectedVsRealUsd(simRow, chartPts) : { gapPct: null };
  const misalign = planProbMisalignContextFromRow({
    ticker: alert.ticker,
    simRow,
    chartPts,
    planReturnPct: extras.planReturnPct,
    targetProvisional: extras.targetProvisional,
    precatKind: extras.precatKind,
    investVerdict: extras.investVerdict,
    slope5d: extras.slope5d,
    pred5Pp: extras.pred5Pp,
    curveGapPct: probCtx?.curveGapPct ?? today.gapPct,
  });
  return {
    ...(probCtx ?? {}),
    targetProvisional: extras.targetProvisional ?? probCtx?.targetProvisional ?? false,
    planTargetProvisional: extras.targetProvisional ?? probCtx?.targetProvisional ?? false,
    ...misalign,
  };
}

export function recoveryContextFromExternals(args: {
  simRow: Record<string, unknown> | null;
  chartPts: ChartPoint[] | null;
  ticker: string;
  completionDate: string;
  sdsRows?: SdsRow[] | null;
  migSolidityByKey?: Map<string, import("./entrySolidityMig").MigSoliditySnapshot>;
  matchPct?: number | null;
  eisSuperScore?: number | null;
  windowCorr?: number | null;
  segmentRoiPct?: number | null;
}): RecoveryProbabilityContext {
  const tk = args.ticker.trim().toUpperCase();
  const sdsMap = buildSdsByTicker(args.sdsRows);
  const sds = sdsMap.get(tk);
  const migKey = migSolidityKey(args.ticker, args.completionDate);
  const mig = args.migSolidityByKey?.get(migKey) ?? null;
  const today = args.simRow
    ? resolveTodayExpectedVsRealUsd(args.simRow, args.chartPts)
    : { gapPct: null };
  return {
    matchPct: args.matchPct ?? null,
    sdsScore: sds?.sds ?? null,
    sdsVeto: Boolean(sds?.veto),
    miiAngleDeg: mig?.slopeAngleDeg ?? null,
    eisSuperScore: args.eisSuperScore ?? null,
    windowCorr: args.windowCorr ?? null,
    curveGapPct: today.gapPct,
    segmentRoiPct: args.segmentRoiPct ?? null,
  };
}

function parseDailyVarPct(simRow: Record<string, unknown> | null): number | null {
  if (!simRow) return null;
  for (const col of ["Var. Giorn. %", "Var. Giorn.%", "Var. Giornaliera %"]) {
    const v = simRow[col];
    if (v == null || v === "" || v === "—") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Off-portfolio Simulation rows per finestra CD (hot ≤2 mesi · watch 4–2 mesi). */
export function detectOpportunityAnalysisAlerts(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  scope: SimCdHorizonScope = "hot",
): PortfolioLossAlert[] {
  if (!simTable?.rows?.length) return [];
  const rows = filterOffPortfolioByCdHorizonSimRows(simTable.rows, inputs, scope);
  const out: PortfolioLossAlert[] = [];
  for (const row of rows) {
    const ticker = String(row["Ticker"] ?? "").trim();
    if (!ticker || ticker.includes("TOTALE")) continue;
    const cd = String(row["Completion Date"] ?? "").trim();
    if (!cd || cd === "—") continue;
    out.push({
      key: normalizedRowKey(ticker, cd),
      ticker,
      completionDate: cd,
      pnlEur: 0,
      pnlPct: 0,
      capital: DEFAULT_PLAN_CAPITAL_EUR,
      valueNow: 0,
      buyPrice: 0,
      seriesKey: simulationRowSeriesKey(row),
    });
  }
  return out;
}

/** Target ROI per decisione colore — cap al picco forward pre-CD quando plan > picco. */
function effectivePlanReturnPct(
  roi: PlanRoiBundle,
  gainPlan: ExpectedGainPlan | null,
  chartPts: ChartPoint[] | null,
  simRow: Record<string, unknown> | null,
): number | null {
  let raw: number | null = null;
  if (roi.planReturnPct != null && Number.isFinite(roi.planReturnPct) && roi.planReturnPct > 0) {
    raw = roi.planReturnPct;
  } else if (simRow && chartPts?.length) {
    const sn = resolveAssessmentSupernovaPeak(simRow, chartPts);
    if (sn != null) raw = sn.returnPct;
  }
  if (raw == null) {
    if (!gainPlan) return null;
    if (chartPts?.length) {
      raw = gainPlan.expectedReturnPct ?? roi.planCdReturnPct ?? null;
    } else {
      const cd = gainPlan.expectedReturnPct ?? roi.planCdReturnPct;
      if (cd != null && cd > 0) raw = cd;
      else raw = gainPlan.targetReturnPct ?? cd ?? null;
    }
  }
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return raw;
  if (!simRow || !chartPts?.length) return raw;
  const ticker = String(simRow.Ticker ?? simRow.ticker ?? "").trim();
  const preCdPeak = ticker
    ? resolveSupernovaTargetRoi(ticker, simRow, chartPts)?.returnPct ?? null
    : null;
  return capPlanReturnToForwardPeak(raw, {
    forwardPeakPct: preCdPeak,
    targetHighPct: roi.planTargetHighPct ?? gainPlan?.targetHighPct ?? null,
  });
}

export type LossExitResolution = {
  exitDecision: LossExitDecision;
  exitReason: string;
  planReturnPct: number | null;
  investVerdict?: Top2InvestVerdict;
  precatKind?: string;
  curveRisingHold: boolean;
  slopeDeclining: boolean;
  slope5d: number | null;
  slope20d: number | null;
  slope45d: number | null;
  pred5Pp: number | null;
  stabilityVerdict: StabilityVerdict;
  usedRecalibSlopes: boolean;
  recoveryProbabilityPct: number | null;
  recoveryCoversLoss: boolean | null;
  recoveryExpectedValuePct: number | null;
  recoverySummary: string | null;
};

/** Vendita urgente: uscita immediata (rosso in modal perdita). */
export function isUrgentPortfolioLossExit(
  res: Pick<LossExitResolution, "exitDecision" | "stabilityVerdict">,
): boolean {
  return (
    res.exitDecision === "exit" ||
    res.stabilityVerdict === "exit" ||
    res.stabilityVerdict === "avoid"
  );
}

export function filterUrgentPortfolioLossAlerts(
  alerts: PortfolioLossAlert[],
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
): PortfolioLossAlert[] {
  if (!alerts.length || !simTable?.rows?.length) return [];
  const rowMap = buildSimRowByKeyMap(simTable.rows);
  const columns = simTable.columns ?? Object.keys(simTable.rows[0] ?? {});
  return alerts.filter((a) => {
    const simRow = rowMap.get(a.key) ?? null;
    const res = resolveLossExitForAlert(a, simRow, null, inputs, columns, "en");
    return isUrgentPortfolioLossExit(res);
  });
}

/**
 * Regola colore messaggio (modal + tab In Loss):
 * - exit (rosso): pendenza ↓ sostenuta, stability exit/avoid, o ROI target ≤ 0 → vendi ora.
 * - hold (giallo in modal): in perdita P&L ma curva ↑ e target positivo → attendi recupero.
 * - review (giallo in modal): in perdita senza urgenza → monitora.
 */
export function resolveLossExitForAlert(
  alert: PortfolioLossAlert,
  simRow: Record<string, unknown> | null,
  chartPts: ChartPoint[] | null,
  inputs: InvestSimInputs,
  columns: string[],
  lang: "it" | "en",
  portfolioPnlLoss = true,
  probCtx?: RecoveryProbabilityContext | null,
): LossExitResolution {
  const planCapital =
    inputs[alert.key]?.capital > 0 ? inputs[alert.key].capital : DEFAULT_PLAN_CAPITAL_EUR;

  const gainPlan = simRow
    ? resolveExpectedGainPlan(simRow, planCapital, { chartPoints: chartPts })
    : null;
  const roi: PlanRoiBundle = gainPlan
    ? planRoiBundleFromGainPlan(gainPlan, planCapital, daysFromToday(alert.completionDate))
    : {
        planReturnPct: null,
        planDays: null,
        planGainEur: null,
        planCdReturnPct: null,
        planCdDays: null,
        planCdGainEur: null,
        planTargetReturnPct: null,
        planTargetDays: null,
        planTargetHighPct: null,
      };
  const planReturnPct = effectivePlanReturnPct(roi, gainPlan, chartPts, simRow);
  const planCdReturnPct = roi.planCdReturnPct ?? gainPlan?.expectedReturnPct ?? null;
  const metrics = simRow ? signalMetricsFromSimRow(simRow, columns) : null;
  const sheetCurves = simRow ? extractCurveInputs(simRow) : null;
  const chartSlopes =
    chartPts?.length && simRow
      ? modelSlopesFromRecalibChart(chartPts, simRow)
      : null;
  const useRecalib = Boolean(chartSlopes?.usedRecalibPath);
  const slope5d = useRecalib
    ? (chartSlopes?.slope5d ?? sheetCurves?.slope5d ?? null)
    : (sheetCurves?.slope5d ?? null);
  const slope20d = useRecalib
    ? (chartSlopes?.slope20d ?? sheetCurves?.slope20d ?? null)
    : (sheetCurves?.slope20d ?? null);
  const slope45d = useRecalib
    ? (chartSlopes?.slope45d ?? sheetCurves?.slope45d ?? null)
    : (sheetCurves?.slope45d ?? null);
  const days = metrics?.daysToCd ?? daysFromToday(alert.completionDate);

  const stab = computeSlopeStability(slope5d, slope20d, slope45d);
  const effSlope =
    slope20d != null && Number.isFinite(slope20d)
      ? slope20d
      : slope5d ?? null;
  const stabVerdict = stabilityVerdict(stab, effSlope);

  const precat = buildPrecatEntry(
    slope5d,
    slope20d,
    sheetCurves?.runUp30d ?? null,
    days,
    { hasPosition: true },
  );

  const declineInput = declineInputFromSignalLike({
    simRow: simRow ?? undefined,
    chartPoints: chartPts,
    planReturnPct,
    planCdReturnPct,
    pred5: metrics?.pred5Pp ?? null,
    slope5d,
    slope20d,
    slope45d,
  });
  const slopeDeclining = isSustainedDeclineSell(declineInput);
  const curveRisingHold = isCurveRisingForHold(declineInput);

  const peak = simRow ? resolveAssessmentSupernovaPeak(simRow, chartPts) : null;

  const inLossForProb =
    portfolioPnlLoss || (alert.pnlPct != null && alert.pnlPct < -0.01);

  const investVerdict = resolveTop2InvestVerdict({
    side: "sell",
    planReturnPct,
    planCdReturnPct,
    precatKind: precat.kind,
    action: "",
    precatLabel: precat.label,
    stabilityVerdict: stabVerdict,
    curveRisingHold,
    slopeDeclining,
    portfolioPnlLoss,
  });

  const recoveryOutlook = computeRecoveryOutlook(
    buildRecoveryContext(
      alert,
      simRow,
      chartPts,
      lang,
      inLossForProb,
      planReturnPct,
      peak?.returnPct ?? null,
      curveRisingHold,
      stabVerdict,
      days,
      mergeProbContextForOutlook(alert, simRow, chartPts, probCtx, {
        planReturnPct,
        precatKind: precat.kind,
        investVerdict,
        slope5d,
        pred5Pp: metrics?.pred5Pp ?? null,
      }),
    ),
  );

  const exitReason = top2InvestReasonShort(
    {
      side: "sell",
      planReturnPct,
      planCdReturnPct,
      precatKind: precat.kind,
      action: "",
      precatLabel: precat.label,
      stabilityVerdict: stabVerdict,
      curveRisingHold,
      slopeDeclining,
      portfolioPnlLoss,
    },
    lang,
    { includeTarget: false },
  );

  return {
    exitDecision: mapInvestVerdictToExit(
      investVerdict,
      slopeDeclining,
      stabVerdict,
      portfolioPnlLoss,
      recoveryOutlook?.suggestedDecision ?? null,
      curveRisingHold,
    ),
    exitReason,
    planReturnPct,
    investVerdict,
    precatKind: precat.kind,
    curveRisingHold,
    slopeDeclining,
    slope5d,
    slope20d,
    slope45d,
    pred5Pp: metrics?.pred5Pp ?? null,
    stabilityVerdict: stabVerdict,
    usedRecalibSlopes: useRecalib,
    recoveryProbabilityPct: recoveryOutlook?.probabilityPct ?? null,
    recoveryCoversLoss: recoveryOutlook?.coversLoss ?? null,
    recoveryExpectedValuePct: recoveryOutlook?.expectedValuePct ?? null,
    recoverySummary: recoveryOutlook
      ? lang === "it"
        ? recoveryOutlook.summaryIt
        : recoveryOutlook.summaryEn
      : null,
  };
}

/** Entry assessment for off-portfolio hot-zone opportunities (buy-side). */
export function resolveOpportunityEntryForAlert(
  alert: PortfolioLossAlert,
  simRow: Record<string, unknown> | null,
  chartPts: ChartPoint[] | null,
  columns: string[],
  lang: "it" | "en",
  probCtx?: RecoveryProbabilityContext | null,
): LossExitResolution {
  const planCapital = DEFAULT_PLAN_CAPITAL_EUR;
  const gainPlan = simRow
    ? resolveExpectedGainPlan(simRow, planCapital, { chartPoints: chartPts })
    : null;
  const roi: PlanRoiBundle = gainPlan
    ? planRoiBundleFromGainPlan(gainPlan, planCapital, daysFromToday(alert.completionDate))
    : {
        planReturnPct: null,
        planDays: null,
        planGainEur: null,
        planCdReturnPct: null,
        planCdDays: null,
        planCdGainEur: null,
        planTargetReturnPct: null,
        planTargetDays: null,
        planTargetHighPct: null,
      };
  const planReturnPct = effectivePlanReturnPct(roi, gainPlan, chartPts, simRow);
  const planCdReturnPct = roi.planCdReturnPct ?? gainPlan?.expectedReturnPct ?? null;
  const metrics = simRow ? signalMetricsFromSimRow(simRow, columns) : null;
  const sheetCurves = simRow ? extractCurveInputs(simRow) : null;
  const chartSlopes =
    chartPts?.length && simRow ? modelSlopesFromRecalibChart(chartPts, simRow) : null;
  const useRecalib = Boolean(chartSlopes?.usedRecalibPath);
  const slope5d = useRecalib
    ? (chartSlopes?.slope5d ?? sheetCurves?.slope5d ?? null)
    : (sheetCurves?.slope5d ?? null);
  const slope20d = useRecalib
    ? (chartSlopes?.slope20d ?? sheetCurves?.slope20d ?? null)
    : (sheetCurves?.slope20d ?? null);
  const slope45d = useRecalib
    ? (chartSlopes?.slope45d ?? sheetCurves?.slope45d ?? null)
    : (sheetCurves?.slope45d ?? null);
  const days = metrics?.daysToCd ?? daysFromToday(alert.completionDate);

  const stab = computeSlopeStability(slope5d, slope20d, slope45d);
  const effSlope =
    slope20d != null && Number.isFinite(slope20d) ? slope20d : (slope5d ?? null);
  const stabVerdict = stabilityVerdict(stab, effSlope);

  const precat = buildPrecatEntry(
    slope5d,
    slope20d,
    sheetCurves?.runUp30d ?? null,
    days,
    { hasPosition: false },
  );

  const declineInput = declineInputFromSignalLike({
    simRow: simRow ?? undefined,
    chartPoints: chartPts,
    planReturnPct,
    planCdReturnPct,
    pred5: metrics?.pred5Pp ?? null,
    slope5d,
    slope20d,
    slope45d,
  });
  const slopeDeclining = isSustainedDeclineSell(declineInput);
  const curveRisingHold = isCurveRisingForHold(declineInput);

  const peak = simRow ? resolveAssessmentSupernovaPeak(simRow, chartPts) : null;

  const investVerdict = resolveTop2InvestVerdict({
    side: "buy",
    planReturnPct,
    planCdReturnPct,
    daysToCd: days,
    precatKind: precat.kind,
    action: "",
    precatLabel: precat.label,
    stabilityVerdict: stabVerdict,
    curveRisingHold,
    slopeDeclining,
    portfolioPnlLoss: false,
    targetProvisional: gainPlan?.targetProvisional ?? false,
    matchPct: probCtx?.matchPct ?? null,
    dailyPct24h: parseDailyVarPct(simRow),
  });

  const entryOutlook = computeEntryOutlook(
    buildRecoveryContext(
      alert,
      simRow,
      chartPts,
      lang,
      false,
      planReturnPct,
      peak?.returnPct ?? null,
      curveRisingHold,
      stabVerdict,
      days,
      mergeProbContextForOutlook(alert, simRow, chartPts, probCtx, {
        planReturnPct,
        targetProvisional: gainPlan?.targetProvisional ?? false,
        precatKind: precat.kind,
        investVerdict,
        slope5d,
        pred5Pp: metrics?.pred5Pp ?? null,
      }),
    ),
  );

  const exitReason = top2InvestReasonShort(
    {
      side: "buy",
      planReturnPct,
      planCdReturnPct,
      precatKind: precat.kind,
      action: "",
      precatLabel: precat.label,
      stabilityVerdict: stabVerdict,
      curveRisingHold,
      slopeDeclining,
      portfolioPnlLoss: false,
    },
    lang,
    { includeTarget: false },
  );

  return {
    exitDecision: mapBuyVerdictToExit(
      investVerdict,
      entryOutlook.suggestedDecision,
      Boolean(probCtx?.sdsVeto),
      {
        precatKind: precat.kind,
        probPct: entryOutlook.probabilityPct,
        matchPct: probCtx?.matchPct ?? null,
        forwardPct: planReturnPct,
        daysToCd: days,
        targetProvisional: gainPlan?.targetProvisional ?? false,
        dailyPct24h: parseDailyVarPct(simRow),
        simRow,
        sdsVeto: probCtx?.sdsVeto,
      },
    ),
    exitReason,
    planReturnPct,
    investVerdict,
    precatKind: precat.kind,
    curveRisingHold,
    slopeDeclining,
    slope5d,
    slope20d,
    slope45d,
    pred5Pp: metrics?.pred5Pp ?? null,
    stabilityVerdict: stabVerdict,
    usedRecalibSlopes: useRecalib,
    recoveryProbabilityPct: entryOutlook.probabilityPct,
    recoveryCoversLoss: null,
    recoveryExpectedValuePct: entryOutlook.expectedValuePct,
    recoverySummary: lang === "it" ? entryOutlook.summaryIt : entryOutlook.summaryEn,
  };
}

/** Stile modal avviso perdita — allineato a LossExitDecision. */
export function lossAlertModalTheme(decision: LossExitDecision): {
  icon: string;
  shellBorder: string;
  headerBorder: string;
  headerBg: string;
  titleClass: string;
  navDivider: string;
} {
  if (decision === "exit") {
    return {
      icon: "🛑",
      shellBorder: "border-[rgb(var(--signal-down))]/55",
      headerBorder: "border-[rgb(var(--signal-down))]/35",
      headerBg: "bg-[rgb(var(--signal-down))]/10",
      titleClass: "text-[rgb(var(--signal-down))]",
      navDivider: "border-[rgb(var(--signal-down))]/20",
    };
  }
  if (decision === "hold") {
    return {
      icon: "📈",
      shellBorder: "border-[rgb(var(--warn))]/50",
      headerBorder: "border-[rgb(var(--warn))]/35",
      headerBg: "bg-[rgb(var(--warn))]/10",
      titleClass: "text-[rgb(var(--warn))]",
      navDivider: "border-[rgb(var(--warn))]/20",
    };
  }
  return {
    icon: "👀",
    shellBorder: "border-[rgb(var(--warn))]/45",
    headerBorder: "border-[rgb(var(--warn))]/30",
    headerBg: "bg-[rgb(var(--warn))]/8",
    titleClass: "text-[rgb(var(--warn))]",
    navDivider: "border-[rgb(var(--warn))]/18",
  };
}

export function buildPortfolioLossAnalysisItems(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
  lang: "it" | "en",
  history?: InvestSimHistoryPoint[] | null,
  probOptions?: LossAnalysisProbOptions | null,
): PortfolioLossAnalysisItem[] {
  if (!simTable?.rows?.length) return [];

  const rowByKey = buildSimRowByKeyMap(simTable.rows);
  const columns = simTable.columns ?? Object.keys(simTable.rows[0] ?? {});
  const merged = reconcileInvestSimInputs(inputs, simTable.rows);
  const probOptsEff = probOptions
    ? { ...probOptions, mergedInputs: merged }
    : null;
  const alerts = detectPortfolioPositionAlerts(simTable, inputs, history);

  const items = alerts.map((alert) => {
    const inLoss = portfolioPnlTone(alert.pnlEur, alert.pnlPct) === "loss";
    const simRow = rowByKey.get(alert.key) ?? null;
    const chartPts = alert.seriesKey
      ? pointsBySeriesKey.get(alert.seriesKey) ?? null
      : null;

    const investedAt = resolveInvestedAt(alert.key, inputs[alert.key], history ?? []);
    const holdDaysElapsed = investedAt ? holdingDaysFromInvestedAt(investedAt) : null;

    const probCtx = probCtxForAlert(
      alert,
      simRow,
      chartPts,
      inputs,
      simTable.rows,
      lang,
      probOptsEff,
    );

    const exit = resolveLossExitForAlert(
      alert,
      simRow,
      chartPts,
      inputs,
      columns,
      lang,
      inLoss,
      probCtx,
    );
    const openPnl = simRow ? positionPnlForOpenRow(simRow, inputs, history) : null;
    const daily = {
      pnlEur24h: openPnl?.pnlEur24h ?? null,
      pnlPct24h: openPnl?.pnlPct24h ?? null,
    };
    const metrics = simRow ? signalMetricsFromSimRow(simRow, columns) : null;
    const curves = simRow ? extractCurveInputs(simRow) : null;
    const days = metrics?.daysToCd ?? daysFromToday(alert.completionDate);
    const roi = {
      planReturnPct: exit.planReturnPct,
      planCdReturnPct: null as number | null,
    };
    const gainPlan = simRow
      ? resolveExpectedGainPlan(
          simRow,
          inputs[alert.key]?.capital > 0 ? inputs[alert.key].capital : DEFAULT_PLAN_CAPITAL_EUR,
          { chartPoints: chartPts },
        )
      : null;
    if (gainPlan) {
      const bundle = planRoiBundleFromGainPlan(
        gainPlan,
        inputs[alert.key]?.capital > 0 ? inputs[alert.key].capital : DEFAULT_PLAN_CAPITAL_EUR,
        daysFromToday(alert.completionDate),
      );
      roi.planCdReturnPct = bundle.planCdReturnPct;
    }

    const precat = buildPrecatEntry(
      exit.slope5d,
      exit.slope20d,
      curves?.runUp30d ?? null,
      days,
      { hasPosition: true },
    );

    const todayPrices = simRow
      ? resolveTodayExpectedVsRealUsd(simRow, chartPts)
      : { modelUsd: null, realUsd: null, gapPct: null, gapUsd: null };

    const company = simRow
      ? String(simRow["Società"] ?? simRow["Societa"] ?? "").trim()
      : "";

    const peak = simRow ? resolveAssessmentSupernovaPeak(simRow, chartPts) : null;

    const stock = simRow ? resolveSlopeStockPrices(simRow, chartPts, null) : null;
    const capImpact = resolveSlopeCapitalImpact(
      simRow,
      inputs,
      stock?.actual ?? null,
      stock?.expected ?? null,
    );

    let curveGapLossEur: number | null = null;
    if (simRow && todayPrices.gapUsd != null && Number.isFinite(todayPrices.gapUsd)) {
      const pos = computeSimulationPosition(simRow, inputs);
      if (pos) {
        const shares =
          pos.shares > 0
            ? pos.shares
            : pos.buyPrice > 0 && pos.capital > 0
              ? pos.capital / pos.buyPrice
              : 0;
        if (shares > 0) {
          curveGapLossEur = Math.round(shares * todayPrices.gapUsd * 100) / 100;
        }
      }
    }

    return {
      ...alert,
      hasPosition: true,
      seriesKey: alert.seriesKey ?? (simRow ? simulationRowSeriesKey(simRow) : null),
      company,
      daysToCd: days,
      investedAt,
      holdDaysElapsed,
      planReturnPct: roi.planReturnPct,
      planCdReturnPct: roi.planCdReturnPct,
      curveGapPct: todayPrices.gapPct,
      curveGapUsd: todayPrices.gapUsd,
      slope5d: exit.slope5d,
      slope20d: exit.slope20d,
      slope45d: exit.slope45d,
      pred5Pp: exit.pred5Pp ?? metrics?.pred5Pp ?? null,
      stabilityVerdict: exit.stabilityVerdict,
      precatKind: precat.kind,
      precatLabel: precat.label,
      investVerdict: resolveTop2InvestVerdict({
        side: "sell",
        planReturnPct: roi.planReturnPct,
        planCdReturnPct: roi.planCdReturnPct,
        precatKind: precat.kind,
        action: "",
        precatLabel: precat.label,
        stabilityVerdict: exit.stabilityVerdict,
        curveRisingHold: exit.curveRisingHold,
        slopeDeclining: exit.slopeDeclining,
        portfolioPnlLoss: inLoss,
      }),
      exitDecision: exit.exitDecision,
      exitReason: exit.exitReason,
      daysToCurvePeak: peak?.days ?? null,
      curvePeakReturnPct: peak?.returnPct ?? null,
      chartPointsLoaded: Boolean(chartPts?.length),
      modelGapLossEur: capImpact.modelGapLossEur,
      curveGapLossEur,
      priceGapUsd: capImpact.priceGapUsd,
      pnlEur24h: daily.pnlEur24h,
      pnlPct24h: daily.pnlPct24h,
      pnlEurSinceReading: openPnl?.pnlEurSinceReading ?? null,
      pnlPctSinceReading: openPnl?.pnlPctSinceReading ?? null,
      priorReadingTs: openPnl?.priorReadingTs ?? null,
      inLoss,
      curveRisingHold: exit.curveRisingHold,
      planTargetProvisional: gainPlan?.targetProvisional ?? false,
      planTargetConfidencePct: gainPlan?.targetConfidencePct ?? null,
      recoveryProbabilityPct: exit.recoveryProbabilityPct,
      recoveryCoversLoss: exit.recoveryCoversLoss,
      recoveryExpectedValuePct: exit.recoveryExpectedValuePct,
      recoverySummary: exit.recoverySummary,
    };
  });

  return items.sort((a, b) => {
    if (a.exitDecision === "exit" && b.exitDecision !== "exit") return -1;
    if (b.exitDecision === "exit" && a.exitDecision !== "exit") return 1;
    const a24 = a.pnlPct24h ?? 0;
    const b24 = b.pnlPct24h ?? 0;
    if (a.inLoss !== b.inLoss) return a.inLoss ? -1 : 1;
    return a24 - b24;
  });
}

export function buildOpportunityAnalysisItems(
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
  lang: "it" | "en",
  probOptions?: LossAnalysisProbOptions | null,
  scope: SimCdHorizonScope = "hot",
): PortfolioLossAnalysisItem[] {
  if (!simTable?.rows?.length) return [];

  const rowByKey = buildSimRowByKeyMap(simTable.rows);
  const columns = simTable.columns ?? Object.keys(simTable.rows[0] ?? {});
  const merged = reconcileInvestSimInputs(inputs, simTable.rows);
  const probOptsEff = probOptions
    ? { ...probOptions, mergedInputs: merged }
    : null;
  const alerts = detectOpportunityAnalysisAlerts(simTable, inputs, scope);

  const items = alerts.map((alert) => {
    const simRow = rowByKey.get(alert.key) ?? null;
    const chartPts = alert.seriesKey
      ? pointsBySeriesKey.get(alert.seriesKey) ?? null
      : null;

    const probCtx = probCtxForAlert(
      alert,
      simRow,
      chartPts,
      inputs,
      simTable.rows,
      lang,
      probOptsEff,
    );

    const exit = resolveOpportunityEntryForAlert(
      alert,
      simRow,
      chartPts,
      columns,
      lang,
      probCtx,
    );
    const dailyPct = parseDailyVarPct(simRow);
    const daily = {
      pnlPct24h: dailyPct,
      pnlEur24h:
        dailyPct != null
          ? Math.round((DEFAULT_PLAN_CAPITAL_EUR * dailyPct) / 100 * 100) / 100
          : null,
    };
    const metrics = simRow ? signalMetricsFromSimRow(simRow, columns) : null;
    const curves = simRow ? extractCurveInputs(simRow) : null;
    const days = metrics?.daysToCd ?? daysFromToday(alert.completionDate);
    const gainPlan = simRow
      ? resolveExpectedGainPlan(simRow, DEFAULT_PLAN_CAPITAL_EUR, { chartPoints: chartPts })
      : null;
    const roi = gainPlan
      ? planRoiBundleFromGainPlan(
          gainPlan,
          DEFAULT_PLAN_CAPITAL_EUR,
          daysFromToday(alert.completionDate),
        )
      : {
          planReturnPct: exit.planReturnPct,
          planCdReturnPct: null as number | null,
          planDays: null,
          planGainEur: null,
          planCdDays: null,
          planCdGainEur: null,
          planTargetReturnPct: null,
          planTargetDays: null,
          planTargetHighPct: null,
        };

    const precat = buildPrecatEntry(
      exit.slope5d,
      exit.slope20d,
      curves?.runUp30d ?? null,
      days,
      { hasPosition: false },
    );

    const todayPrices = simRow
      ? resolveTodayExpectedVsRealUsd(simRow, chartPts)
      : { modelUsd: null, realUsd: null, gapPct: null, gapUsd: null };

    const company = simRow
      ? String(simRow["Società"] ?? simRow["Societa"] ?? "").trim()
      : "";

    const peak = simRow ? resolveAssessmentSupernovaPeak(simRow, chartPts) : null;

    const stock = simRow ? resolveSlopeStockPrices(simRow, chartPts, null) : null;
    const capImpact = resolveSlopeCapitalImpact(
      simRow,
      inputs,
      stock?.actual ?? null,
      stock?.expected ?? null,
    );
    let modelGapLossEur = capImpact.modelGapLossEur;
    if (modelGapLossEur == null && stock?.actual != null && stock?.expected != null) {
      const price = stock.actual;
      if (price > 0) {
        const shares = DEFAULT_PLAN_CAPITAL_EUR / price;
        modelGapLossEur =
          Math.round(shares * (stock.actual - stock.expected) * 100) / 100;
      }
    }

    let curveGapLossEur: number | null = null;
    if (simRow && todayPrices.gapUsd != null && Number.isFinite(todayPrices.gapUsd)) {
      const price = stock?.actual ?? null;
      const shares =
        price != null && price > 0 ? DEFAULT_PLAN_CAPITAL_EUR / price : 0;
      if (shares > 0) {
        curveGapLossEur = Math.round(shares * todayPrices.gapUsd * 100) / 100;
      }
    }

    const inLoss = daily.pnlPct24h != null && daily.pnlPct24h < -0.05;

    return {
      ...alert,
      hasPosition: false,
      seriesKey: alert.seriesKey ?? (simRow ? simulationRowSeriesKey(simRow) : null),
      company,
      daysToCd: days,
      investedAt: null,
      holdDaysElapsed: null,
      planReturnPct: exit.planReturnPct,
      planCdReturnPct: roi.planCdReturnPct ?? gainPlan?.expectedReturnPct ?? null,
      curveGapPct: todayPrices.gapPct,
      curveGapUsd: todayPrices.gapUsd,
      slope5d: exit.slope5d,
      slope20d: exit.slope20d,
      slope45d: exit.slope45d,
      pred5Pp: exit.pred5Pp ?? metrics?.pred5Pp ?? null,
      stabilityVerdict: exit.stabilityVerdict,
      precatKind: precat.kind,
      precatLabel: precat.label,
      investVerdict: resolveTop2InvestVerdict({
        side: "buy",
        planReturnPct: exit.planReturnPct,
        planCdReturnPct: roi.planCdReturnPct ?? gainPlan?.expectedReturnPct ?? null,
        daysToCd: days,
        precatKind: precat.kind,
        action: "",
        precatLabel: precat.label,
        stabilityVerdict: exit.stabilityVerdict,
        curveRisingHold: exit.curveRisingHold,
        slopeDeclining: exit.slopeDeclining,
        portfolioPnlLoss: false,
        targetProvisional: gainPlan?.targetProvisional ?? false,
        matchPct: probCtx?.matchPct ?? null,
        dailyPct24h: dailyPct,
      }),
      exitDecision: exit.exitDecision,
      exitReason: exit.exitReason,
      daysToCurvePeak: peak?.days ?? null,
      curvePeakReturnPct: peak?.returnPct ?? null,
      chartPointsLoaded: Boolean(chartPts?.length),
      modelGapLossEur,
      curveGapLossEur,
      priceGapUsd: capImpact.priceGapUsd,
      pnlEur24h: daily.pnlEur24h,
      pnlPct24h: daily.pnlPct24h,
      pnlEurSinceReading: null,
      pnlPctSinceReading: null,
      priorReadingTs: null,
      inLoss,
      curveRisingHold: exit.curveRisingHold,
      planTargetProvisional: gainPlan?.targetProvisional ?? false,
      planTargetConfidencePct: gainPlan?.targetConfidencePct ?? null,
      recoveryProbabilityPct: exit.recoveryProbabilityPct,
      recoveryCoversLoss: exit.recoveryCoversLoss,
      recoveryExpectedValuePct: exit.recoveryExpectedValuePct,
      recoverySummary: exit.recoverySummary,
    };
  });

  return items.sort((a, b) => {
    if (a.exitDecision === "hold" && b.exitDecision !== "hold") return -1;
    if (b.exitDecision === "hold" && a.exitDecision !== "hold") return 1;
    const aRoi = a.planReturnPct ?? 0;
    const bRoi = b.planReturnPct ?? 0;
    return bRoi - aRoi;
  });
}

export function buildLossAnalysisItems(
  profile: LossAnalysisProfile,
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
  lang: "it" | "en",
  history?: InvestSimHistoryPoint[] | null,
  probOptions?: LossAnalysisProbOptions | null,
  oppCdScope: SimCdHorizonScope = "hot",
): PortfolioLossAnalysisItem[] {
  if (profile === "opportunities") {
    return buildOpportunityAnalysisItems(
      simTable,
      inputs,
      pointsBySeriesKey,
      lang,
      probOptions,
      oppCdScope,
    );
  }
  return buildPortfolioLossAnalysisItems(
    simTable,
    inputs,
    pointsBySeriesKey,
    lang,
    history,
    probOptions,
  );
}

export function summarizeLossAnalysis(items: PortfolioLossAnalysisItem[]): {
  count: number;
  lossCount: number;
  gainCount: number;
  totalPnlEur: number;
  totalPnlEur24h: number;
  totalCapital: number;
  totalModelGapLossEur: number;
  totalCurveGapLossEur: number;
  exitCount: number;
  holdCount: number;
  reviewCount: number;
} {
  let totalPnlEur = 0;
  let totalPnlEur24h = 0;
  let totalCapital = 0;
  let totalModelGapLossEur = 0;
  let totalCurveGapLossEur = 0;
  let exitCount = 0;
  let holdCount = 0;
  let reviewCount = 0;
  let lossCount = 0;
  let gainCount = 0;
  for (const it of items) {
    totalPnlEur += it.pnlEur;
    if (it.pnlEur24h != null) totalPnlEur24h += it.pnlEur24h;
    totalCapital += it.capital;
    if (it.inLoss) lossCount += 1;
    else gainCount += 1;
    if (it.modelGapLossEur != null) totalModelGapLossEur += it.modelGapLossEur;
    if (it.curveGapLossEur != null) totalCurveGapLossEur += it.curveGapLossEur;
    if (it.exitDecision === "exit") exitCount += 1;
    else if (it.exitDecision === "hold") holdCount += 1;
    else reviewCount += 1;
  }
  return {
    count: items.length,
    lossCount,
    gainCount,
    totalPnlEur,
    totalPnlEur24h,
    totalCapital,
    totalModelGapLossEur,
    totalCurveGapLossEur,
    exitCount,
    holdCount,
    reviewCount,
  };
}

/** Prioritizza avvisi perdita: slope EXIT prima, poi AVOID, poi exit decision. */
export function prioritizeLossAlertsBySlopeExit(
  alerts: PortfolioLossAlert[],
  simTable: SheetTable | null,
  inputs: InvestSimInputs,
): PortfolioLossAlert[] {
  if (alerts.length <= 1 || !simTable?.rows?.length) return alerts;
  const rowMap = buildSimRowByKeyMap(simTable.rows);
  const columns = simTable.columns ?? Object.keys(simTable.rows[0] ?? {});

  const rank = (a: PortfolioLossAlert): number => {
    const simRow = rowMap.get(a.key) ?? null;
    const res = resolveLossExitForAlert(a, simRow, null, inputs, columns, "en");
    if (res.stabilityVerdict === "exit") return 0;
    if (res.stabilityVerdict === "avoid") return 1;
    if (res.exitDecision === "exit") return 2;
    if (res.stabilityVerdict === "watch") return 3;
    return 4;
  };

  return [...alerts].sort((a, b) => rank(a) - rank(b));
}
