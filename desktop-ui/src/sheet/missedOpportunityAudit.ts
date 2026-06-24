/**
 * Audit opportunità perse: titoli in rialzo 24h non segnalati come Enter dal modello.
 * Snapshot giornaliero in localStorage per trend recall.
 */
import type { ChartPoint, SheetTable } from "../types";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import { isHotZone, isWatchZone, SIM_HOT_ZONE_DAYS, SIM_MONITOR_HORIZON_DAYS } from "./cdHorizons";
import { normalizedRowKey } from "./investSimKeys";
import type { InvestSimInputs } from "./investSimStorage";
import { dailyChangePctFromRow, rowHasActivePortfolio } from "./simulationPosition";
import { daysFromToday } from "./simulationPlanGain";
import {
  buildRecoveryProbContextForAlert,
  resolveOpportunityEntryForAlert,
  type LossAnalysisProbOptions,
  type LossExitDecision,
} from "./portfolioLossAnalysis";
import type { PortfolioLossAlert } from "./portfolioLossUrgent";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import { buildPrecatEntry, extractCurveInputs } from "./precatCurve";
import { reconcileInvestSimInputs } from "./investSimKeys";
import { isOffPortfolioBuyRecommended } from "./investDecisionSimLoop";
import {
  inWatchEntryWindow,
  WATCH_MATCH_MIN,
  WATCH_P_ENTRY_MIN,
} from "./watchZoneEntryPolicy";
import { computeFairRecsDailyPnlFromMissedOppRows } from "./missedOpportunityFairRecs";

/** Min Var. Giorn. % to count as a 24h gainer. */
export const MISSED_OPP_GAIN_24H_MIN_PCT = 0.5;

/** Hypothetical stake per ticker in P&L comparison chart (€). */
export const MISSED_OPP_CAPITAL_EUR = 5000;

/** Operational entry audit: T−90 → T−14 (days to CD 14–90). Excludes CD troppo vicino/lontano. */
export const MISSED_OPP_OP_MIN_DAYS = 14;
export const MISSED_OPP_OP_MAX_DAYS = 90;

/** Watch-zone recall audit: T−120 → T−61 (days to CD 61–120). */
export const MISSED_OPP_WATCH_MIN_DAYS = SIM_HOT_ZONE_DAYS + 1;
export const MISSED_OPP_WATCH_MAX_DAYS = SIM_MONITOR_HORIZON_DAYS;

export function inMissedOppOperationalWindow(days: number | null): boolean {
  if (days == null || !Number.isFinite(days)) return false;
  return days >= MISSED_OPP_OP_MIN_DAYS && days <= MISSED_OPP_OP_MAX_DAYS;
}

export function inMissedOppWatchWindow(days: number | null): boolean {
  if (days == null || !Number.isFinite(days)) return false;
  return days >= MISSED_OPP_WATCH_MIN_DAYS && days <= MISSED_OPP_WATCH_MAX_DAYS;
}

export type MissedOppBucket =
  | "detected"
  | "missed"
  | "held_gainer"
  | "gainer_outside_window"
  | "not_gainer";

export type MissedOppRow = {
  key: string;
  ticker: string;
  company: string | null;
  completionDate: string;
  dailyPct24h: number;
  daysToCd: number | null;
  bucket: MissedOppBucket;
  suggested: boolean;
  exitDecision: LossExitDecision;
  probPct: number | null;
  planReturnPct: number | null;
  matchPct: number | null;
  segmentRoiPct: number | null;
  blockers: string[];
  inPortfolio: boolean;
  inMonitorWindow: boolean;
  inOperationalWindow: boolean;
  inWatchWindow: boolean;
};

export type MissedOppBlockerStat = {
  id: string;
  labelIt: string;
  labelEn: string;
  count: number;
};

/**
 * Error-rate curve point along the days-to-CD axis.
 *  - falsePositiveRatePct (errore +) = false Enter / total Enter in window (1 − precision).
 *  - missRatePct           (errore −) = missed gainers / total gainers in window (1 − recall).
 * X axis convention: small daysToCd on the LEFT (close to CD), large on the RIGHT (early).
 */
export type MissedOppErrorCurvePoint = {
  daysToCd: number;
  falsePositiveRatePct: number | null;
  missRatePct: number | null;
  samples: number;
  enterSamples: number;
  gainerSamples: number;
};

/**
 * Aggregate error metrics for a single days-to-CD bucket.
 *  - "close" bucket = T−14 … T−60 (≤ 2 months from CD, hot zone).
 *  - "far"   bucket = T−61 … T−120 (~2 to ~4 months from CD, watch zone).
 *
 * Two families of metrics are tracked side-by-side:
 *  - Rate (legacy): % of suggestions / gainers that were wrong (1 − precision /
 *    1 − recall). Kept for back-compat with existing snapshots.
 *  - Magnitude (primary, used by the error-trend chart): the **average size in
 *    %** of the actual stock move that contradicted the recommendation, i.e.
 *    how big the mistake was. `null` means no samples to publish.
 */
export type MissedOppBucketError = {
  /** Legacy: false-positive rate among Enter suggestions (0..100). */
  fpRatePct: number | null;
  /** Legacy: miss rate among gainers (0..100). */
  missRatePct: number | null;
  /**
   * Errore + magnitude: average |dailyPct24h| (positive %) on rows where the
   * model suggested Enter but the stock actually dropped (dailyPct24h < 0).
   * 0% means no error; higher = bigger wrong-Enter drop on average.
   */
  fpAvgDropPct: number | null;
  /**
   * Errore − magnitude: average dailyPct24h (positive %) on rows where the
   * model did NOT suggest Enter but the stock gained ≥ threshold. 0% means
   * no missed move; higher = bigger missed gainer on average.
   */
  missAvgGainPct: number | null;
  samples: number;
  enterSamples: number;
  gainerSamples: number;
  /** Samples used for the fpAvgDropPct mean (Enter suggestions that dropped). */
  fpDropSamples: number;
  /** Samples used for the missAvgGainPct mean (off-portfolio missed gainers). */
  missGainSamples: number;
};

export type MissedOppBucketId = "close" | "far";

/** Daily point for the calendar-time error trend chart, per bucket. */
export type MissedOppErrorTrendPoint = {
  date: string;
  /** Legacy rate field (kept for tooltip back-compat). */
  fpRatePct: number | null;
  /** Legacy rate field (negative), kept for tooltip back-compat. */
  missRatePctNeg: number | null;
  /** Above the 0 line — average % drop magnitude when Enter was wrong. */
  fpAvgDropPct: number | null;
  /** Below the 0 line — average % gain magnitude when gainer was missed, sign-flipped. */
  missAvgGainPctNeg: number | null;
  samples: number;
  enterSamples: number;
  gainerSamples: number;
  fpDropSamples: number;
  missGainSamples: number;
};

export type MissedOpportunitySummary = {
  evaluatedAt: string;
  universeN: number;
  with24hN: number;
  gainersN: number;
  detectedN: number;
  missedN: number;
  heldGainerN: number;
  outsideWindowGainerN: number;
  /** Gainers in monitor window but outside T−90→T−14 (CD <14d or >90d). */
  cdDistantGainerN: number;
  /** Recall Enter — primary metric (operational window only). */
  recallPct: number | null;
  /** Full monitor window recall (hot+watch up to 120d) — secondary. */
  monitorRecallPct: number | null;
  monitorMissedN: number;
  monitorDetectedN: number;
  /** Watch window T−61→T−120 recall (off-portfolio gainers). */
  watchRecallPct: number | null;
  watchDetectedN: number;
  watchMissedN: number;
  watchGainerN: number;
  /** Enter suggestions that did not gain 24h (off-portfolio pre-CD). */
  falsePositiveN: number;
  /** Enter suggestions off-portfolio pre-CD with 24h data. */
  suggestedN: number;
  precisionPct: number | null;
  missedRows: MissedOppRow[];
  detectedRows: MissedOppRow[];
  /** Off-portfolio gainers in monitor window but outside T−90→T−14. */
  cdDistantRows: MissedOppRow[];
  /** Off-portfolio gainers in watch window T−61→T−120. */
  watchRows: MissedOppRow[];
  watchMissedRows: MissedOppRow[];
  watchDetectedRows: MissedOppRow[];
  blockerStats: MissedOppBlockerStat[];
  chartBars: { id: string; labelIt: string; labelEn: string; count: number; fill: string }[];
  /** Error-rate curve along days-to-CD axis (left = close, right = early). */
  errorCurve: MissedOppErrorCurvePoint[];
  /** Aggregated error rates split by days-to-CD bucket (today's snapshot). */
  errorByBucket: { close: MissedOppBucketError; far: MissedOppBucketError };
  /** €5000 × 24h % on every gainer (≥ threshold). */
  pnlAllGainersEur: number;
  /** €5000 × 24h % on Enter signals + positions already held. */
  pnlRecommendationsEur: number;
  /** Cap max 8, capitale reale, Enter eseguibili — v. missedOpportunityFairRecs. */
  pnlFairRecommendationsEur: number;
  fairRecsPositionN: number;
};

export type MissedOppDailySnapshot = {
  date: string;
  /** ISO timestamp when this daily point was saved. */
  savedAt?: string;
  recallPct: number | null;
  missedN: number;
  detectedN: number;
  /** All tickers up ≥ threshold in last 24h. */
  gainersN: number;
  /** Enter + 24h gain + already-held 24h gainers. */
  recommendedInvestedN?: number;
  heldGainerN?: number;
  cdDistantGainerN?: number;
  watchRecallPct?: number | null;
  watchDetectedN?: number;
  watchMissedN?: number;
  pnlAllGainersEur?: number;
  pnlRecommendationsEur?: number;
  pnlFairRecommendationsEur?: number;
  /** Open-portfolio daily P&L from ledger (actual). */
  pnlActualEur?: number;
  /** Bucket-level error rates (added v2 — optional for back-compat). */
  errorClose?: MissedOppBucketError;
  errorFar?: MissedOppBucketError;
};

export type MissedOppPnlTrendPoint = {
  date: string;
  cumAllGainers: number;
  cumRecommendations: number;
  cumFairRecommendations: number;
  cumActual: number;
};

/** One calendar day — non-cumulative 24h P&L + day-over-day deltas. */
export type MissedOppPnlDailyPoint = {
  date: string;
  dayAllGainers: number;
  dayRecommendations: number;
  dayFairRecommendations: number;
  dayActual: number;
  /** Actual portfolio P&L vs previous snapshot day. */
  deltaActual: number | null;
  /** actual / recommendations × 100 — share of recommended 24h P&L captured. */
  capturePct: number | null;
  /** recommendations − actual (€ left on table vs following recs). */
  gapVsRecEur: number;
};

export type MissedOppImprovementSummary = {
  deltaActual: number | null;
  capturePctToday: number | null;
  capturePctFairToday: number | null;
  gapVsRecToday: number;
  gapVsFairRecToday: number;
  gapVsAllGainersToday: number;
  daysTracked: number;
};

const HISTORY_KEY = "missed_opp_daily_snapshots_v1";
const HISTORY_MAX = 45;

/** First day bucket-level error aggregates are tracked (snapshot v2). */
export const MISSED_OPP_ERROR_TREND_START_DATE = "2026-06-17";

function rowCompany(row: Record<string, unknown>): string | null {
  const c = String(row["Società"] ?? row["Societa"] ?? "").trim();
  return c || null;
}

function inPreCdMonitorWindow(days: number | null): boolean {
  return isHotZone(days) || isWatchZone(days);
}

function blockerId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
}

export function inferMissBlockers(args: {
  lang: "it" | "en";
  exitDecision: LossExitDecision;
  planReturnPct: number | null;
  probPct: number | null;
  matchPct: number | null;
  segmentRoiPct: number | null;
  stabilityVerdict: string;
  precatKind: string;
  recoverySummary: string | null;
  daysToCd?: number | null;
}): string[] {
  const out: string[] = [];
  const { lang } = args;

  if (args.planReturnPct != null && args.planReturnPct < 2) {
    out.push(
      lang === "it"
        ? `Target forward basso (+${args.planReturnPct.toFixed(1)}%)`
        : `Low forward target (+${args.planReturnPct.toFixed(1)}%)`,
    );
  }
  if (args.segmentRoiPct != null && args.segmentRoiPct < 0) {
    out.push(
      lang === "it"
        ? `ROI arco negativo (${args.segmentRoiPct.toFixed(1)}%)`
        : `Negative arc ROI (${args.segmentRoiPct.toFixed(1)}%)`,
    );
  }
  if (args.matchPct != null) {
    const matchMin = inWatchEntryWindow(args.daysToCd) ? WATCH_MATCH_MIN : 62;
    if (args.matchPct < matchMin) {
      out.push(
        lang === "it"
          ? `Match poligono basso (${Math.round(args.matchPct)}%)`
          : `Low polygon match (${Math.round(args.matchPct)}%)`,
      );
    }
  }
  if (args.stabilityVerdict === "exit" || args.stabilityVerdict === "avoid") {
    out.push(lang === "it" ? "Pendenza EXIT/AVOID" : "Slope EXIT/AVOID");
  } else if (args.stabilityVerdict === "watch") {
    out.push(lang === "it" ? "Pendenza WATCH" : "Slope WATCH");
  }
  if (args.precatKind === "avoid" || args.precatKind === "sell") {
    out.push(lang === "it" ? "Precat: evita ingresso" : "Precat: avoid entry");
  } else if (args.precatKind === "too_early") {
    out.push(
      lang === "it"
        ? inWatchEntryWindow(args.daysToCd)
          ? "Watch — accumulate (non Enter diretto)"
          : "CD troppo lontano"
        : inWatchEntryWindow(args.daysToCd)
          ? "Watch — accumulate (not direct Enter)"
          : "CD too far",
    );
  } else if (args.precatKind === "late") {
    out.push(lang === "it" ? "Ingresso tardivo" : "Late entry");
  }
  const probMin = inWatchEntryWindow(args.daysToCd) ? WATCH_P_ENTRY_MIN : 60;
  if (args.probPct != null && args.probPct < probMin) {
    out.push(
      lang === "it"
        ? `P(plan) sotto soglia Enter (${args.probPct.toFixed(0)}%)`
        : `P(plan) below Enter threshold (${args.probPct.toFixed(0)}%)`,
    );
  }
  if (args.exitDecision === "review") {
    out.push(lang === "it" ? "Verdetto: Attendere" : "Verdict: Wait");
  } else if (args.exitDecision === "exit") {
    out.push(lang === "it" ? "Verdetto: Skip" : "Verdict: Skip");
  }

  if (!out.length && args.recoverySummary) {
    const tail = args.recoverySummary.split("·").pop()?.trim();
    if (tail) out.push(tail);
  }
  if (!out.length) {
    out.push(lang === "it" ? "Profilo non sufficiente per Enter" : "Profile insufficient for Enter");
  }
  return out.slice(0, 4);
}

function classifyBucket(
  dailyPct: number,
  inPortfolio: boolean,
  inMonitorWindow: boolean,
  suggested: boolean,
): MissedOppBucket {
  if (dailyPct < MISSED_OPP_GAIN_24H_MIN_PCT) return "not_gainer";
  if (inPortfolio) return "held_gainer";
  if (!inMonitorWindow) return "gainer_outside_window";
  if (suggested) return "detected";
  return "missed";
}

function buildBlockerStats(rows: MissedOppRow[], lang: "it" | "en"): MissedOppBlockerStat[] {
  const map = new Map<string, MissedOppBlockerStat>();
  for (const row of rows) {
    for (const label of row.blockers) {
      const id = blockerId(label);
      const hit = map.get(id);
      if (hit) hit.count += 1;
      else {
        map.set(id, {
          id,
          labelIt: label,
          labelEn: label,
          count: 1,
        });
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((s) => ({
      ...s,
      labelIt: lang === "it" ? s.labelIt : s.labelEn,
      labelEn: s.labelEn,
    }));
}

export function buildMissedOpportunityAudit(args: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  lang: "it" | "en";
  probOptions?: LossAnalysisProbOptions | null;
}): MissedOpportunitySummary {
  const { simTable, inputs, pointsBySeriesKey, lang, probOptions } = args;
  const empty: MissedOpportunitySummary = {
    evaluatedAt: new Date().toISOString(),
    universeN: 0,
    with24hN: 0,
    gainersN: 0,
    detectedN: 0,
    missedN: 0,
    heldGainerN: 0,
    outsideWindowGainerN: 0,
    cdDistantGainerN: 0,
    recallPct: null,
    monitorRecallPct: null,
    monitorMissedN: 0,
    monitorDetectedN: 0,
    watchRecallPct: null,
    watchDetectedN: 0,
    watchMissedN: 0,
    watchGainerN: 0,
    falsePositiveN: 0,
    suggestedN: 0,
    precisionPct: null,
    missedRows: [],
    detectedRows: [],
    cdDistantRows: [],
    watchRows: [],
    watchMissedRows: [],
    watchDetectedRows: [],
    blockerStats: [],
    chartBars: [],
    errorCurve: [],
    errorByBucket: {
      close: emptyBucketError(),
      far: emptyBucketError(),
    },
    pnlAllGainersEur: 0,
    pnlRecommendationsEur: 0,
    pnlFairRecommendationsEur: 0,
    fairRecsPositionN: 0,
  };
  if (!simTable?.rows?.length) return empty;

  const columns = simTable.columns ?? Object.keys(simTable.rows[0] ?? {});
  const merged = reconcileInvestSimInputs(inputs, simTable.rows);
  const probOptsEff =
    probOptions != null
      ? { ...probOptions, mergedInputs: merged, lightweightPolygon: true }
      : null;
  const rows: MissedOppRow[] = [];

  for (const simRow of simTable.rows) {
    const ticker = String(simRow["Ticker"] ?? "").trim().toUpperCase();
    if (!ticker || ticker.includes("TOTALE")) continue;

    const cd = String(simRow["Completion Date"] ?? "").trim();
    if (!cd || cd === "—") continue;

    const dailyPct = dailyChangePctFromRow(simRow);
    if (dailyPct == null || !Number.isFinite(dailyPct)) continue;

    const key = normalizedRowKey(ticker, cd);
    const inPortfolio = rowHasActivePortfolio(simRow, inputs);
    const daysToCd = daysFromToday(cd);
    const inMonitorWindow = inPreCdMonitorWindow(daysToCd);
    const inOperationalWindow = inMissedOppOperationalWindow(daysToCd);
    const inWatchWindow = inMissedOppWatchWindow(daysToCd);
    const seriesKey = simulationRowSeriesKey(simRow);
    const chartPts = seriesKey ? pointsBySeriesKey.get(seriesKey) ?? null : null;

    const alert: PortfolioLossAlert = {
      key,
      ticker,
      completionDate: cd,
      pnlEur: 0,
      pnlPct: 0,
      capital: DEFAULT_PLAN_CAPITAL_EUR,
      valueNow: 0,
      buyPrice: 0,
      seriesKey,
    };

    const probCtx =
      probOptsEff != null
        ? buildRecoveryProbContextForAlert(
            alert,
            simRow,
            chartPts,
            inputs,
            simTable.rows,
            lang,
            probOptsEff,
          )
        : undefined;

    const exit = resolveOpportunityEntryForAlert(
      alert,
      simRow,
      chartPts,
      columns,
      lang,
      probCtx,
    );

    const curves = extractCurveInputs(simRow);
    const precat = buildPrecatEntry(
      exit.slope5d,
      exit.slope20d,
      curves?.runUp30d ?? null,
      daysToCd,
      { hasPosition: inPortfolio },
    );

    const suggested =
      !inPortfolio &&
      isOffPortfolioBuyRecommended({
        hasPosition: false,
        exitDecision: exit.exitDecision,
        investVerdict: exit.investVerdict ?? "wait",
        precatKind: exit.precatKind ?? precat.kind,
        recoveryProbabilityPct: exit.recoveryProbabilityPct,
        pnlPct24h: dailyPct,
        daysToCd,
      });
    const bucket = classifyBucket(dailyPct, inPortfolio, inMonitorWindow, suggested);

    const blockers =
      bucket === "missed" && (inOperationalWindow || inWatchWindow)
        ? inferMissBlockers({
            lang,
            exitDecision: exit.exitDecision,
            planReturnPct: exit.planReturnPct,
            probPct: exit.recoveryProbabilityPct,
            matchPct: probCtx?.matchPct ?? null,
            segmentRoiPct: probCtx?.segmentRoiPct ?? null,
            stabilityVerdict: exit.stabilityVerdict,
            precatKind: precat.kind,
            recoverySummary: exit.recoverySummary,
            daysToCd,
          })
        : [];

    const item: MissedOppRow = {
      key,
      ticker,
      company: rowCompany(simRow),
      completionDate: cd,
      dailyPct24h: dailyPct,
      daysToCd,
      bucket,
      suggested,
      exitDecision: exit.exitDecision,
      probPct: exit.recoveryProbabilityPct,
      planReturnPct: exit.planReturnPct,
      matchPct: probCtx?.matchPct ?? null,
      segmentRoiPct: probCtx?.segmentRoiPct ?? null,
      blockers,
      inPortfolio,
      inMonitorWindow,
      inOperationalWindow,
      inWatchWindow,
    };
    rows.push(item);
  }

  const universeN = simTable.rows.filter((r) => {
    const tk = String(r["Ticker"] ?? "").trim();
    return tk && !tk.includes("TOTALE");
  }).length;

  const with24hN = rows.length;
  const gainers = rows.filter((r) => r.dailyPct24h >= MISSED_OPP_GAIN_24H_MIN_PCT);
  const oppGainersMonitor = gainers.filter((r) => !r.inPortfolio && r.inMonitorWindow);
  const oppGainersOp = gainers.filter((r) => !r.inPortfolio && r.inOperationalWindow);
  const oppGainersWatch = gainers.filter((r) => !r.inPortfolio && r.inWatchWindow);
  const detectedWatch = oppGainersWatch.filter((r) => r.suggested);
  const missedWatch = oppGainersWatch.filter((r) => !r.suggested);
  const detectedOp = oppGainersOp.filter((r) => r.suggested);
  const missedOp = oppGainersOp.filter((r) => !r.suggested);
  const detectedMonitor = oppGainersMonitor.filter((r) => r.suggested);
  const missedMonitor = oppGainersMonitor.filter((r) => !r.suggested);
  const heldGainerN = gainers.filter((r) => r.inPortfolio).length;
  const outsideWindowGainerN = gainers.filter((r) => !r.inPortfolio && !r.inMonitorWindow).length;
  const cdDistantGainerN = gainers.filter(
    (r) => !r.inPortfolio && r.inMonitorWindow && !r.inOperationalWindow,
  ).length;

  const suggestedOffOp = rows.filter(
    (r) => r.suggested && !r.inPortfolio && r.inOperationalWindow,
  );
  const falsePositiveN = suggestedOffOp.filter(
    (r) => r.dailyPct24h < MISSED_OPP_GAIN_24H_MIN_PCT,
  ).length;

  const recallDenomOp = oppGainersOp.length;
  const recallPct =
    recallDenomOp > 0 ? Math.round((detectedOp.length / recallDenomOp) * 1000) / 10 : null;
  const monitorRecallPct =
    oppGainersMonitor.length > 0
      ? Math.round((detectedMonitor.length / oppGainersMonitor.length) * 1000) / 10
      : null;
  const watchRecallPct =
    oppGainersWatch.length > 0
      ? Math.round((detectedWatch.length / oppGainersWatch.length) * 1000) / 10
      : null;
  const precisionDenom = suggestedOffOp.length;
  const precisionPct =
    precisionDenom > 0
      ? Math.round(((precisionDenom - falsePositiveN) / precisionDenom) * 1000) / 10
      : null;

  const missedRows = [...missedOp].sort((a, b) => b.dailyPct24h - a.dailyPct24h);
  const detectedRows = [...detectedOp].sort((a, b) => b.dailyPct24h - a.dailyPct24h);
  const cdDistantRows = gainers
    .filter((r) => !r.inPortfolio && r.inMonitorWindow && !r.inOperationalWindow)
    .sort((a, b) => b.dailyPct24h - a.dailyPct24h);
  const watchRows = [...oppGainersWatch].sort((a, b) => b.dailyPct24h - a.dailyPct24h);
  const watchMissedRows = [...missedWatch].sort((a, b) => b.dailyPct24h - a.dailyPct24h);
  const watchDetectedRows = [...detectedWatch].sort((a, b) => b.dailyPct24h - a.dailyPct24h);

  const chartBars = [
    {
      id: "detected",
      labelIt: "Enter + rialzo 24h",
      labelEn: "Enter + 24h gain",
      count: detectedOp.length,
      fill: "#22c55e",
    },
    {
      id: "missed",
      labelIt: "Persa (no Enter)",
      labelEn: "Missed (no Enter)",
      count: missedOp.length,
      fill: "#f59e0b",
    },
    {
      id: "watch_detected",
      labelIt: "Watch Enter + rialzo",
      labelEn: "Watch Enter + gain",
      count: detectedWatch.length,
      fill: "#34d399",
    },
    {
      id: "watch_missed",
      labelIt: "Watch persa",
      labelEn: "Watch missed",
      count: missedWatch.length,
      fill: "#fb923c",
    },
    {
      id: "cd_distant",
      labelIt: "CD fuori T−90→T−14",
      labelEn: "CD outside T−90→T−14",
      count: cdDistantGainerN,
      fill: "#a78bfa",
    },
    {
      id: "held",
      labelIt: "Già in portafoglio",
      labelEn: "Already held",
      count: heldGainerN,
      fill: "#6366f1",
    },
    {
      id: "outside",
      labelIt: "Fuori monitor CD",
      labelEn: "Outside CD monitor",
      count: outsideWindowGainerN,
      fill: "#94a3b8",
    },
  ].filter((b) => b.count > 0);

  const { pnlAllGainersEur, pnlRecommendationsEur } = computeMissedOppDailyPnl(rows);
  const { pnlFairRecommendationsEur, fairRecsPositionN } = computeFairRecsDailyPnlFromMissedOppRows(
    rows,
    simTable,
    merged,
  );

  return {
    evaluatedAt: new Date().toISOString(),
    universeN,
    with24hN,
    gainersN: gainers.length,
    detectedN: detectedOp.length,
    missedN: missedOp.length,
    heldGainerN,
    outsideWindowGainerN,
    cdDistantGainerN,
    recallPct,
    monitorRecallPct,
    monitorMissedN: missedMonitor.length,
    monitorDetectedN: detectedMonitor.length,
    watchRecallPct,
    watchDetectedN: detectedWatch.length,
    watchMissedN: missedWatch.length,
    watchGainerN: oppGainersWatch.length,
    falsePositiveN,
    suggestedN: suggestedOffOp.length,
    precisionPct,
    missedRows,
    detectedRows,
    cdDistantRows,
    watchRows,
    watchMissedRows,
    watchDetectedRows,
    blockerStats: buildBlockerStats(missedRows, lang),
    chartBars,
    errorCurve: buildMissedOppErrorCurve(rows),
    errorByBucket: {
      close: buildMissedOppBucketError(rows, "close"),
      far: buildMissedOppBucketError(rows, "far"),
    },
    pnlAllGainersEur,
    pnlRecommendationsEur,
    pnlFairRecommendationsEur,
    fairRecsPositionN,
  };
}

function emptyBucketError(): MissedOppBucketError {
  return {
    fpRatePct: null,
    missRatePct: null,
    fpAvgDropPct: null,
    missAvgGainPct: null,
    samples: 0,
    enterSamples: 0,
    gainerSamples: 0,
    fpDropSamples: 0,
    missGainSamples: 0,
  };
}

/**
 * Aggregate error metrics for a single days-to-CD bucket on today's snapshot.
 *
 * The lens stays consistent with the rest of the missed-opportunity audit:
 * only off-portfolio rows count.
 *
 *  - Rate fields (back-compat) are published when the denominator reaches
 *    `minSamples` (default 2) to avoid wild 0%/100% jitter on thin slices.
 *  - Magnitude fields measure the **average % move that contradicted the
 *    recommendation**:
 *      • fpAvgDropPct: mean of |dailyPct24h| over Enter suggestions that
 *        actually dropped (dailyPct24h < 0).
 *      • missAvgGainPct: mean of dailyPct24h over rows the model did NOT
 *        suggest but which gained ≥ MISSED_OPP_GAIN_24H_MIN_PCT.
 *    Magnitudes publish from `minMagnitudeSamples` (default 1) onward — a
 *    single error is still a meaningful magnitude (unlike a rate).
 */
export function buildMissedOppBucketError(
  rows: MissedOppRow[],
  bucket: MissedOppBucketId,
  minSamples = 2,
  minMagnitudeSamples = 1,
): MissedOppBucketError {
  const [lo, hi] = bucket === "close"
    ? [MISSED_OPP_OP_MIN_DAYS, SIM_HOT_ZONE_DAYS] // 14..60
    : [MISSED_OPP_WATCH_MIN_DAYS, MISSED_OPP_WATCH_MAX_DAYS]; // 61..120

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let total = 0;
  let fpDropSum = 0;
  let fpDropSamples = 0;
  let missGainSum = 0;
  let missGainSamples = 0;
  for (const r of rows) {
    if (r.inPortfolio) continue;
    const d = r.daysToCd;
    if (d == null || !Number.isFinite(d)) continue;
    if (d < lo || d > hi) continue;
    total += 1;
    const isGainer = r.dailyPct24h >= MISSED_OPP_GAIN_24H_MIN_PCT;
    if (r.suggested) {
      if (isGainer) tp += 1;
      else fp += 1;
      // Errore + magnitude: only count Enter recommendations where the stock
      // actually dropped (not just flat/below gain threshold).
      if (Number.isFinite(r.dailyPct24h) && r.dailyPct24h < 0) {
        fpDropSum += Math.abs(r.dailyPct24h);
        fpDropSamples += 1;
      }
    } else if (isGainer) {
      fn += 1;
      // Errore − magnitude: how big was the gain we did NOT recommend.
      if (Number.isFinite(r.dailyPct24h)) {
        missGainSum += r.dailyPct24h;
        missGainSamples += 1;
      }
    }
  }
  const enterSamples = tp + fp;
  const gainerSamples = tp + fn;
  return {
    fpRatePct:
      enterSamples >= minSamples
        ? Math.round((fp / enterSamples) * 1000) / 10
        : null,
    missRatePct:
      gainerSamples >= minSamples
        ? Math.round((fn / gainerSamples) * 1000) / 10
        : null,
    fpAvgDropPct:
      fpDropSamples >= minMagnitudeSamples
        ? Math.round((fpDropSum / fpDropSamples) * 10) / 10
        : null,
    missAvgGainPct:
      missGainSamples >= minMagnitudeSamples
        ? Math.round((missGainSum / missGainSamples) * 10) / 10
        : null,
    samples: total,
    enterSamples,
    gainerSamples,
    fpDropSamples,
    missGainSamples,
  };
}

/**
 * Calendar-time trend of bucket errors. Each saved daily snapshot from
 * `loadMissedOppHistory()` carries the bucket aggregates so we just project
 * them onto a date axis. The missed-gainer magnitude is flipped to negative
 * so the chart can render both curves around a single 0 reference line
 * (errore + above, errore − below).
 */
export function buildMissedOppErrorTrend(
  history: MissedOppDailySnapshot[],
  bucket: MissedOppBucketId,
): MissedOppErrorTrendPoint[] {
  return [...history]
    .filter((h) => h.date >= MISSED_OPP_ERROR_TREND_START_DATE)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => {
      const e = bucket === "close" ? h.errorClose : h.errorFar;
      const missRateNeg =
        e?.missRatePct != null && Number.isFinite(e.missRatePct)
          ? -e.missRatePct
          : null;
      const missGainNeg =
        e?.missAvgGainPct != null && Number.isFinite(e.missAvgGainPct)
          ? -e.missAvgGainPct
          : null;
      return {
        date: h.date.slice(5),
        fpRatePct: e?.fpRatePct ?? null,
        missRatePctNeg: missRateNeg,
        fpAvgDropPct: e?.fpAvgDropPct ?? null,
        missAvgGainPctNeg: missGainNeg,
        samples: e?.samples ?? 0,
        enterSamples: e?.enterSamples ?? 0,
        gainerSamples: e?.gainerSamples ?? 0,
        fpDropSamples: e?.fpDropSamples ?? 0,
        missGainSamples: e?.missGainSamples ?? 0,
      };
    });
}

/**
 * Build error-rate curve along days-to-CD axis using a sliding window of
 * `windowSize` days centered on each evaluated `daysToCd` value. Only
 * off-portfolio rows are considered (the audit lens is "did we suggest Enter
 * on something not yet held?"). A point is published with a non-null rate
 * only when the relevant denominator reaches `minSamples`.
 */
export function buildMissedOppErrorCurve(
  rows: MissedOppRow[],
  opts: {
    minDays?: number;
    maxDays?: number;
    step?: number;
    windowSize?: number;
    minSamples?: number;
  } = {},
): MissedOppErrorCurvePoint[] {
  const minDays = opts.minDays ?? MISSED_OPP_OP_MIN_DAYS; // 14
  const maxDays = opts.maxDays ?? MISSED_OPP_WATCH_MAX_DAYS; // 120
  const step = opts.step ?? 7;
  const windowSize = opts.windowSize ?? 21;
  const minSamples = opts.minSamples ?? 2;
  const half = windowSize / 2;

  const offRows = rows.filter(
    (r) => !r.inPortfolio && r.daysToCd != null && Number.isFinite(r.daysToCd),
  );

  const points: MissedOppErrorCurvePoint[] = [];
  for (let center = minDays; center <= maxDays; center += step) {
    const lo = center - half;
    const hi = center + half;
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let total = 0;
    for (const r of offRows) {
      const d = r.daysToCd as number;
      if (d < lo || d > hi) continue;
      total += 1;
      const isGainer = r.dailyPct24h >= MISSED_OPP_GAIN_24H_MIN_PCT;
      if (r.suggested) {
        if (isGainer) tp += 1;
        else fp += 1;
      } else if (isGainer) {
        fn += 1;
      }
    }
    const enterSamples = tp + fp;
    const gainerSamples = tp + fn;
    const falsePositiveRatePct =
      enterSamples >= minSamples
        ? Math.round((fp / enterSamples) * 1000) / 10
        : null;
    const missRatePct =
      gainerSamples >= minSamples
        ? Math.round((fn / gainerSamples) * 1000) / 10
        : null;
    points.push({
      daysToCd: center,
      falsePositiveRatePct,
      missRatePct,
      samples: total,
      enterSamples,
      gainerSamples,
    });
  }
  return points;
}

export function pnlEurFrom24hPct(capitalEur: number, dailyPct24h: number): number {
  if (!Number.isFinite(capitalEur) || !Number.isFinite(dailyPct24h)) return 0;
  return Math.round((capitalEur * dailyPct24h) / 100);
}

/** Daily hypothetical P&L: all 24h gainers vs following every Enter + held position. */
export function computeMissedOppDailyPnl(
  rows: MissedOppRow[],
  capitalEur = MISSED_OPP_CAPITAL_EUR,
): { pnlAllGainersEur: number; pnlRecommendationsEur: number } {
  let pnlAllGainersEur = 0;
  let pnlRecommendationsEur = 0;
  for (const row of rows) {
    const pnl = pnlEurFrom24hPct(capitalEur, row.dailyPct24h);
    if (row.dailyPct24h >= MISSED_OPP_GAIN_24H_MIN_PCT) {
      pnlAllGainersEur += pnl;
    }
    if (row.suggested || row.inPortfolio) {
      pnlRecommendationsEur += pnl;
    }
  }
  return {
    pnlAllGainersEur: Math.round(pnlAllGainersEur),
    pnlRecommendationsEur: Math.round(pnlRecommendationsEur),
  };
}

export function buildMissedOppPnlTrend(
  history: MissedOppDailySnapshot[],
): MissedOppPnlTrendPoint[] {
  let cumAllGainers = 0;
  let cumRecommendations = 0;
  let cumFairRecommendations = 0;
  let cumActual = 0;
  return [...history]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((h) => {
      cumAllGainers += h.pnlAllGainersEur ?? 0;
      cumRecommendations += h.pnlRecommendationsEur ?? 0;
      cumFairRecommendations += h.pnlFairRecommendationsEur ?? h.pnlRecommendationsEur ?? 0;
      cumActual += h.pnlActualEur ?? 0;
      return {
        date: h.date.slice(5),
        cumAllGainers,
        cumRecommendations,
        cumFairRecommendations,
        cumActual,
      };
    });
}

/** Daily (non-cumulative) 24h series — one point per calendar day in localStorage. */
export function buildMissedOppPnlDailySeries(
  history: MissedOppDailySnapshot[],
): MissedOppPnlDailyPoint[] {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  let prevActual: number | null = null;
  return sorted.map((h) => {
    const dayAllGainers = h.pnlAllGainersEur ?? 0;
    const dayRecommendations = h.pnlRecommendationsEur ?? 0;
    const dayFairRecommendations =
      h.pnlFairRecommendationsEur ?? h.pnlRecommendationsEur ?? 0;
    const dayActual = h.pnlActualEur ?? 0;
    const deltaActual = prevActual != null ? dayActual - prevActual : null;
    prevActual = dayActual;
    const gapVsRecEur = dayRecommendations - dayActual;
    const capturePct =
      dayRecommendations !== 0 && h.pnlRecommendationsEur != null
        ? Math.round((dayActual / dayRecommendations) * 1000) / 10
        : null;
    return {
      date: h.date.slice(5),
      dayAllGainers,
      dayRecommendations,
      dayFairRecommendations,
      dayActual,
      deltaActual,
      capturePct,
      gapVsRecEur,
    };
  });
}

/** KPI «miglioramento» — confronto oggi vs ieri e gap vs raccomandazioni. */
export function summarizeMissedOppImprovement(
  history: MissedOppDailySnapshot[],
  todaySummary: Pick<
    MissedOpportunitySummary,
    "pnlAllGainersEur" | "pnlRecommendationsEur" | "pnlFairRecommendationsEur"
  > | null,
  pnlActualToday: number | null,
): MissedOppImprovementSummary {
  const daily = buildMissedOppPnlDailySeries(history);
  const last = daily[daily.length - 1];
  const recToday = todaySummary?.pnlRecommendationsEur ?? last?.dayRecommendations ?? 0;
  const fairRecToday =
    todaySummary?.pnlFairRecommendationsEur ?? last?.dayFairRecommendations ?? recToday;
  const allToday = todaySummary?.pnlAllGainersEur ?? last?.dayAllGainers ?? 0;
  const actToday = pnlActualToday ?? last?.dayActual ?? 0;
  return {
    deltaActual: last?.deltaActual ?? null,
    capturePctToday:
      recToday !== 0 ? Math.round((actToday / recToday) * 1000) / 10 : null,
    capturePctFairToday:
      fairRecToday !== 0 ? Math.round((actToday / fairRecToday) * 1000) / 10 : null,
    gapVsRecToday: recToday - actToday,
    gapVsFairRecToday: fairRecToday - actToday,
    gapVsAllGainersToday: allToday - actToday,
    daysTracked: history.length,
  };
}

export function loadMissedOppHistory(): MissedOppDailySnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MissedOppDailySnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMissedOppSnapshot(
  summary: MissedOpportunitySummary,
  pnlActualEur?: number | null,
): MissedOppDailySnapshot[] {
  if (typeof window === "undefined") return [];
  const date = summary.evaluatedAt.slice(0, 10);
  const snap: MissedOppDailySnapshot = {
    date,
    savedAt: new Date().toISOString(),
    recallPct: summary.recallPct,
    missedN: summary.missedN,
    detectedN: summary.detectedN,
    gainersN: summary.gainersN,
    recommendedInvestedN: summary.detectedN + summary.heldGainerN,
    heldGainerN: summary.heldGainerN,
    cdDistantGainerN: summary.cdDistantGainerN,
    watchRecallPct: summary.watchRecallPct,
    watchDetectedN: summary.watchDetectedN,
    watchMissedN: summary.watchMissedN,
    pnlAllGainersEur: summary.pnlAllGainersEur,
    pnlRecommendationsEur: summary.pnlRecommendationsEur,
    pnlFairRecommendationsEur: summary.pnlFairRecommendationsEur,
    pnlActualEur:
      pnlActualEur != null && Number.isFinite(pnlActualEur) ? Math.round(pnlActualEur) : undefined,
    errorClose: summary.errorByBucket.close,
    errorFar: summary.errorByBucket.far,
  };
  const prev = loadMissedOppHistory().filter((s) => s.date !== date);
  const next = [...prev, snap].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}
