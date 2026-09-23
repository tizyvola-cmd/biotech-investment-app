/**
 * Single arbiter for operative BUY/SELL chips across Home Pulse, Cutoff panel,
 * Evaluation, and Simulation — always `deriveSuggestedAction` with full enhance.
 */
import type { ChartBundle, ChartPoint, SheetTable } from "../types";
import type { SdsRow, RegulatoryRiskSnapshot } from "../api/supernova";
import type { InvestSimInputs, InvestSimHistoryPoint } from "./investSimStorage";
import { chartPointsMapFromBundle } from "../data/simulationCharts";
import { buildMigSolidityByKey } from "./entrySolidityMig";
import {
  buildLossAnalysisItems,
  type LossAnalysisProbOptions,
  type PortfolioLossAnalysisItem,
} from "./portfolioLossAnalysis";
import {
  deriveSuggestedAction,
  softBuyRisingStreakAllows,
  softBuySuggestionPriority,
  softBuyDayNotRed,
  softBuyTapeNotCatastrophic,
  softBuyCatalystVolSurge,
  softSellCatalystNewsBearish,
  type SuggestedActionEnhanceCtx,
  type TickerSimEvaluation,
} from "./investDecisionSimLoop";
import {
  attachContCutPriority,
  evaluateSoftBuyGrade1,
  evaluateSoftSellGrade1,
  evaluateSoftSellGiveback,
  peakPnlEurFromHistory,
  evaluateUrgentSellGrade2Book,
} from "./softSignalGrades";
import { priorSessionDayPnlByKey } from "./urgentSellBookLegs";
import { buildSimRowByKeyMap } from "./investSimKeys";
import {
  buildDashboardPortfolioChips,
  dailyChangePctFromRow,
} from "./simulationPosition";
import {
  resolveRegSignedScoreForTicker,
} from "./decisionChartBuild";
import { regRiskFromSignedScore } from "./decisionChartLogic";
import {
  lookupLossRisk,
  lookupLossRiskByRowKey,
  type LossRiskCatalog,
} from "../hooks/useLossRiskCatalog";
import type { LossRiskEntry } from "../components/LossRiskPoopCell";
import { softBuyBlockedByBookSell } from "./softBuyPostSellCooldown";
import {
  contSellCutPriority,
  shouldContinuationExhaustedSell,
} from "./continuationScore";
import { DEFAULT_PLAN_CAPITAL_EUR } from "./expectedRoiDisplay";
import {
  evaluateSoftBuyGateStrength,
  softBuyCapitalFromGateStrength,
  type SoftBuyGateStrength,
} from "./softBuyGateStrength";
import {
  isEarlyPeakBuySignal,
  resolveWeekMinPriceUsd,
} from "./earlyPeakBuyMinTarget";

export type OperationalSuggestedAction = TickerSimEvaluation["suggestedAction"];

export type OperationalSellTag =
  | "G2"
  | "giveback"
  | "soft_g1"
  | "cont_exh"
  | "hard";

export type OperationalSellHit = {
  key: string;
  ticker: string;
  tag: OperationalSellTag;
  /** Invested capital € (open book). */
  capitalEur: number | null;
  /** Open MTM P&L € since entry. */
  pnlEur: number | null;
};

function operationalSellTagRank(tag: OperationalSellTag): number {
  if (tag === "G2") return 0;
  if (tag === "giveback") return 1;
  if (tag === "soft_g1") return 2;
  if (tag === "cont_exh") return 3;
  return 4;
}

function compareOperationalSells(
  a: OperationalSellHit,
  b: OperationalSellHit,
  rowByKey: Map<string, Record<string, unknown>>,
): number {
  const tr = operationalSellTagRank(a.tag) - operationalSellTagRank(b.tag);
  if (tr !== 0) return tr;
  const pa = contSellCutPriority(rowByKey.get(a.key) ?? null);
  const pb = contSellCutPriority(rowByKey.get(b.key) ?? null);
  if (pa !== pb) return pb - pa;
  const ea = a.pnlEur ?? 0;
  const eb = b.pnlEur ?? 0;
  if (ea !== eb) return ea - eb;
  return a.ticker.localeCompare(b.ticker);
}

export type OperationalBuyHit = {
  key: string;
  ticker: string;
  /** Higher = pass more Soft BUY gates (wind / Top2 / rising / …). */
  priority?: number;
  /** Gate ticks + tier for Suggested BUY chip shade. */
  gateStrength?: SoftBuyGateStrength;
  /**
   * Grade 3 suggested size — `DEFAULT_PLAN_CAPITAL_EUR` × gate tier
   * (strong 100% · mid 70% · weak 40%).
   */
  suggestedCapitalEur?: number;
  /** Early-peak breakout (not classic 10d wind-run). */
  isEarlyPeak?: boolean;
  /** Confirmed volume acceleration (T_double ≤30 min). */
  isHighVol?: boolean;
  /** Implied doubling time in minutes when High Vol. */
  volDoublingMinutes?: number | null;
  /** Lowest USD in the last 7 calendar days (CD chart). */
  weekMinPriceUsd?: number | null;
  /** Buy when price reaches this weekly minimum. */
  buyAtMinTargetUsd?: number | null;
};

/** Soft G1 SDS/P hit but not Suggested BUY — for empty-state explainers. */
export type OperationalBuyNearMissFail =
  | "top2_no"
  | "rising_streak"
  | "precat_sell"
  | "tape"
  | "cooldown"
  | "pcont"
  | "other";

export type OperationalBuyNearMiss = {
  key: string;
  ticker: string;
  fail: OperationalBuyNearMissFail;
  /** Session day % when fail is tape / rising (explains 30-min flicker). */
  dayPct?: number | null;
};

export type OperationalRecBuildInput = {
  simTable: SheetTable;
  inputs: InvestSimInputs;
  pointsBySeriesKey?: Map<string, ChartPoint[]>;
  chartBundle?: ChartBundle | null;
  history?: InvestSimHistoryPoint[] | null;
  lang?: "it" | "en";
  sdsRows?: SdsRow[] | null;
  probOptions?: LossAnalysisProbOptions | null;
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry> | null;
  autoRegSnap?: RegulatoryRiskSnapshot | null;
  /** Yesterday session % by ticker (Yahoo intraday 1h prior block). */
  priorSessionPctByTicker?: Map<string, number> | Record<string, number> | null;
  /** Confirmed 5m volume acceleration by ticker (Soft BUY High Vol). */
  volumeAccelByTicker?:
    | Map<string, NonNullable<SuggestedActionEnhanceCtx["volumeAccel"]>>
    | Record<string, NonNullable<SuggestedActionEnhanceCtx["volumeAccel"]>>
    | null;
  /**
   * Daily VOL vs prev surge tickers (and/or T_double). Used to pull past-CD
   * High Vol rescue names into Suggested BUY — same Off Book universe as Evaluation.
   */
  highVolTickers?: Iterable<string> | null;
  /** Catalyst desk VOL vs prev % by ticker (Soft BUY day-1). */
  volPctByTicker?: Map<string, number> | Record<string, number> | null;
  /** Catalyst desk Clin/Fin/Corp/Access scores (Soft BUY day-1 / Soft SELL boost). */
  newsScoresByTicker?:
    | Map<string, import("./newsDimensionScores").NewsDimensionScores>
    | Record<string, import("./newsDimensionScores").NewsDimensionScores>
    | null;
};

export type OperationalRecResult = {
  byKey: Map<string, OperationalSuggestedAction>;
  buys: OperationalBuyHit[];
  sells: OperationalSellHit[];
  urgentKeys: Set<string>;
  /** Off-book Soft G1 candidates that failed a later gate (Top2 / ↑2d / …). */
  buyNearMisses: OperationalBuyNearMiss[];
  /** Soft BUY gate ticks — Suggested BUY chips + open-book piggy monitoring. */
  gateStrengthByKey: Map<string, SoftBuyGateStrength>;
};

function sellTagFor(
  item: PortfolioLossAnalysisItem,
  enhance: SuggestedActionEnhanceCtx,
  urgentKeys: ReadonlySet<string>,
): OperationalSellTag {
  if (urgentKeys.has(item.key)) return "G2";
  if (
    evaluateSoftSellGiveback({
      hasPosition: true,
      peakPnlEur: enhance.peakPnlEur,
      pnlEur: item.pnlEur,
      capitalEur: item.capital,
      investedAt: item.investedAt,
    }).hit
  ) {
    return "giveback";
  }
  if (
    shouldContinuationExhaustedSell({
      hasPosition: true,
      pnlPct: item.pnlPct,
      simRow: enhance.simRow,
    })
  ) {
    return "cont_exh";
  }
  const soft = evaluateSoftSellGrade1({
    hasPosition: true,
    pnlPct: item.pnlPct,
    pplan: item.recoveryProbabilityPct,
    riskV2: enhance.riskV2,
    regRisk: enhance.regRisk ?? enhance.regulatoryRiskScore,
    simRow: enhance.simRow,
    investedAt: item.investedAt,
    catalystBearish: softSellCatalystNewsBearish(enhance),
  });
  if (soft.hit) return "soft_g1";
  return "hard";
}

/** Full enhance used by every operative REC surface. */
function volumeAccelForTicker(
  ticker: string,
  byTicker?:
    | Map<string, NonNullable<SuggestedActionEnhanceCtx["volumeAccel"]>>
    | Record<string, NonNullable<SuggestedActionEnhanceCtx["volumeAccel"]>>
    | null,
): SuggestedActionEnhanceCtx["volumeAccel"] {
  if (!byTicker) return undefined;
  const tk = ticker.trim().toUpperCase();
  const row = byTicker instanceof Map ? byTicker.get(tk) : byTicker[tk];
  return row ?? undefined;
}

function volSurgePctForTicker(
  ticker: string,
  byTicker?: Map<string, number> | Record<string, number> | null,
): number | null {
  if (!byTicker) return null;
  const tk = ticker.trim().toUpperCase();
  const v = byTicker instanceof Map ? byTicker.get(tk) : byTicker[tk];
  return v != null && Number.isFinite(v) ? v : null;
}

function newsScoresForTicker(
  ticker: string,
  byTicker?: OperationalRecBuildInput["newsScoresByTicker"],
): SuggestedActionEnhanceCtx["newsScores"] {
  if (!byTicker) return null;
  const tk = ticker.trim().toUpperCase();
  const row = byTicker instanceof Map ? byTicker.get(tk) : byTicker[tk];
  return row ?? null;
}

/** Daily surge ∪ 5m T_double flags — Off Book High Vol rescue on Home. */
export function collectOperationalHighVolTickers(input: {
  highVolTickers?: Iterable<string> | null;
  volumeAccelByTicker?: OperationalRecBuildInput["volumeAccelByTicker"];
}): string[] {
  const out = new Set<string>();
  for (const raw of input.highVolTickers ?? []) {
    const tk = String(raw ?? "").trim().toUpperCase();
    if (tk) out.add(tk);
  }
  const accel = input.volumeAccelByTicker;
  if (accel) {
    const entries =
      accel instanceof Map ? accel.entries() : Object.entries(accel);
    for (const [raw, row] of entries) {
      if (!row?.flagged) continue;
      const tk = String(raw ?? "").trim().toUpperCase();
      if (tk) out.add(tk);
    }
  }
  return [...out];
}

function priorSessionPctsForTicker(
  ticker: string,
  byTicker?: Map<string, number> | Record<string, number> | null,
): Array<number | null | undefined> | undefined {
  if (!byTicker) return undefined;
  const tk = ticker.trim().toUpperCase();
  const pct =
    byTicker instanceof Map ? byTicker.get(tk) : byTicker[tk];
  if (pct == null || !Number.isFinite(pct)) return undefined;
  return [pct];
}

export function buildOperationalEnhanceForItem(
  item: PortfolioLossAnalysisItem,
  opts: {
    simRow: Record<string, unknown> | null;
    chartPts: ChartPoint[] | null;
    urgentKeys: ReadonlySet<string>;
    lossRiskCatalog?: LossRiskCatalog | null;
    catalogByRowKey?: Map<string, LossRiskEntry> | null;
    autoRegSnap?: RegulatoryRiskSnapshot | null;
    priorSessionPctByTicker?: Map<string, number> | Record<string, number> | null;
    volumeAccelByTicker?:
      | Map<string, NonNullable<SuggestedActionEnhanceCtx["volumeAccel"]>>
      | Record<string, NonNullable<SuggestedActionEnhanceCtx["volumeAccel"]>>
      | null;
    volPctByTicker?: Map<string, number> | Record<string, number> | null;
    newsScoresByTicker?: OperationalRecBuildInput["newsScoresByTicker"];
    /** Real book inputs — Soft BUY post-sell cooldown. */
    inputs?: InvestSimInputs | null;
    /** Open-book history — Gen 4 giveback peak €. */
    history?: InvestSimHistoryPoint[] | null;
  },
): SuggestedActionEnhanceCtx {
  const lossRisk =
    (opts.catalogByRowKey
      ? lookupLossRiskByRowKey(opts.catalogByRowKey, item.key)
      : null) ??
    (opts.lossRiskCatalog
      ? lookupLossRisk(opts.lossRiskCatalog, item.ticker)
      : null);
  const regSigned = resolveRegSignedScoreForTicker(
    item.ticker,
    opts.simRow,
    opts.autoRegSnap ?? null,
  );
  const regRisk = regRiskFromSignedScore(regSigned);
  return {
    urgentSellG2Keys: opts.urgentKeys,
    riskV2: lossRisk?.riskScore ?? null,
    regRisk,
    regulatoryRiskScore: regRisk,
    simRow: opts.simRow,
    chartPts: opts.chartPts,
    priorSessionPcts: priorSessionPctsForTicker(
      item.ticker,
      opts.priorSessionPctByTicker,
    ),
    volumeAccel: volumeAccelForTicker(item.ticker, opts.volumeAccelByTicker),
    volSurgePct: volSurgePctForTicker(item.ticker, opts.volPctByTicker),
    newsScores: newsScoresForTicker(item.ticker, opts.newsScoresByTicker),
    recentlySoldBlocked: softBuyBlockedByBookSell(opts.inputs, {
      key: item.key,
      ticker: item.ticker,
    }),
    peakPnlEur: peakPnlEurFromHistory(
      opts.history,
      item.key,
      opts.inputs?.[item.key]?.investedAt ?? null,
    ),
  };
}

/**
 * Build per-key suggestedAction + buy/sell lists with Soft/Urgent enhance.
 * Same numbers for Home Cutoff ops and Pulse OPEN POSITIONS Rec column.
 */
export function buildOperationalRecResult(
  input: OperationalRecBuildInput,
): OperationalRecResult {
  const lang = input.lang ?? "en";
  const charts = input.chartBundle ?? ({ series: {} } as ChartBundle);
  const pointsBySeriesKey =
    input.pointsBySeriesKey ?? chartPointsMapFromBundle(charts);
  const sdsRows = input.sdsRows ?? input.probOptions?.sdsRows ?? [];
  const migSolidityByKey =
    input.probOptions?.migSolidityByKey ??
    buildMigSolidityByKey(input.simTable, charts, sdsRows);
  const probOptions: LossAnalysisProbOptions = {
    ...(input.probOptions ?? {}),
    migSolidityByKey,
    sdsRows,
  };

  const port = buildLossAnalysisItems(
    "portfolio",
    input.simTable,
    input.inputs,
    pointsBySeriesKey,
    lang,
    input.history ?? null,
    probOptions,
  );
  const opp = buildLossAnalysisItems(
    "opportunities",
    input.simTable,
    input.inputs,
    pointsBySeriesKey,
    lang,
    input.history ?? null,
    probOptions,
    "all",
  );
  // Same Off Book extras as Evaluation: CD > 60d (incl. >120) ∪ past-CD High Vol.
  // Home "all" is only 0–120d, so Rec BUY on PMVP-style rescue never reached the chips.
  const oppOffBook = buildLossAnalysisItems(
    "opportunities",
    input.simTable,
    input.inputs,
    pointsBySeriesKey,
    lang,
    input.history ?? null,
    probOptions,
    "watch",
    collectOperationalHighVolTickers(input),
  );

  const byKeyItems = new Map<string, PortfolioLossAnalysisItem>();
  for (const it of [...port, ...opp, ...oppOffBook]) byKeyItems.set(it.key, it);

  const rowByKey = buildSimRowByKeyMap(input.simTable.rows);
  const open = port.filter((i) => i.hasPosition);
  // Same 24h €/% as Pulse OPEN POSITIONS — loss-analysis legs can lag/null.
  const chipByKey = new Map(
    buildDashboardPortfolioChips(
      input.simTable,
      input.inputs,
      input.history ?? [],
    ).map((c) => [c.key, c]),
  );
  const prior = priorSessionDayPnlByKey(
    input.history,
    open.map((i) => i.key),
  );
  const urgent = evaluateUrgentSellGrade2Book(
    open.map((i) => {
      const chip = chipByKey.get(i.key);
      const dayEur = chip?.pnlEur24h ?? i.pnlEur24h ?? 0;
      const dayPct = chip?.pnlPct24h ?? i.pnlPct24h ?? null;
      const totalPct = chip?.pnlPct ?? i.pnlPct ?? null;
      return attachContCutPriority(
        {
          key: i.key,
          ticker: i.ticker,
          dayPnlEur: Math.round((dayEur + (prior.get(i.key) ?? 0)) * 100) / 100,
          dayPnlPct: dayPct,
          totalPnlPct: totalPct,
        },
        rowByKey.get(i.key) ?? null,
      );
    }),
  );

  const byKey = new Map<string, OperationalSuggestedAction>();
  const buys: OperationalBuyHit[] = [];
  const sells: OperationalSellHit[] = [];
  const buyNearMisses: OperationalBuyNearMiss[] = [];
  const gateStrengthByKey = new Map<string, SoftBuyGateStrength>();

  for (const item of byKeyItems.values()) {
    const simRow = rowByKey.get(item.key) ?? null;
    const chartPts = item.seriesKey
      ? pointsBySeriesKey.get(item.seriesKey) ?? null
      : null;
    const enhance = buildOperationalEnhanceForItem(item, {
      simRow,
      chartPts,
      urgentKeys: urgent.urgentKeys,
      lossRiskCatalog: input.lossRiskCatalog,
      catalogByRowKey: input.catalogByRowKey,
      autoRegSnap: input.autoRegSnap,
      priorSessionPctByTicker: input.priorSessionPctByTicker,
      volumeAccelByTicker: input.volumeAccelByTicker,
      volPctByTicker: input.volPctByTicker,
      newsScoresByTicker: input.newsScoresByTicker,
      inputs: input.inputs,
      history: input.history,
    });
    const action = deriveSuggestedAction(item, false, null, null, enhance);
    byKey.set(item.key, action);
    const strength = evaluateSoftBuyGateStrength(item, enhance);
    gateStrengthByKey.set(item.key, strength);
    if (action === "buy" && !item.hasPosition) {
      const dayPct = simRow ? dailyChangePctFromRow(simRow) : null;
      const earlyPeak = isEarlyPeakBuySignal(simRow, dayPct);
      const weekMin = earlyPeak
        ? resolveWeekMinPriceUsd({ simRow, chartPts })
        : null;
      buys.push({
        key: item.key,
        ticker: item.ticker,
        priority: softBuySuggestionPriority(item, dayPct, enhance),
        gateStrength: strength,
        suggestedCapitalEur: softBuyCapitalFromGateStrength(
          DEFAULT_PLAN_CAPITAL_EUR,
          strength,
        ),
        isEarlyPeak: earlyPeak,
        isHighVol:
          Boolean(enhance.volumeAccel?.flagged) || softBuyCatalystVolSurge(enhance),
        volDoublingMinutes: enhance.volumeAccel?.doublingMinutes ?? null,
        weekMinPriceUsd: weekMin,
        buyAtMinTargetUsd: weekMin,
      });
    } else if (!item.hasPosition) {
      const soft = evaluateSoftBuyGrade1({
        hasPosition: false,
        sdsScore: item.sdsScore,
        pplan: item.recoveryProbabilityPct,
      });
      if (soft.hit) {
        const dayPct = simRow ? dailyChangePctFromRow(simRow) : null;
        let fail: OperationalBuyNearMissFail = "other";
        // Gen 4: Top2 NO / P(cont) no longer hard-block Soft BUY volume.
        if (enhance.recentlySoldBlocked) fail = "cooldown";
        else if (item.precatKind === "sell") fail = "precat_sell";
        else if (!softBuyDayNotRed(item, dayPct)) fail = "tape";
        else if (!softBuyRisingStreakAllows(item, dayPct, enhance)) fail = "rising_streak";
        else if (!softBuyTapeNotCatastrophic(item, dayPct)) fail = "tape";
        buyNearMisses.push({ key: item.key, ticker: item.ticker, fail, dayPct });
      }
    }
    if (action === "sell" && item.hasPosition) {
      const capital =
        item.capital != null && Number.isFinite(item.capital) && item.capital > 0
          ? item.capital
          : null;
      const pnl =
        item.pnlEur != null && Number.isFinite(item.pnlEur)
          ? Math.round(item.pnlEur * 100) / 100
          : null;
      sells.push({
        key: item.key,
        ticker: item.ticker,
        tag: sellTagFor(item, enhance, urgent.urgentKeys),
        capitalEur: capital,
        pnlEur: pnl,
      });
    }
  }

  buys.sort((a, b) => {
    const dp = (b.priority ?? 0) - (a.priority ?? 0);
    if (dp !== 0) return dp;
    return a.ticker.localeCompare(b.ticker);
  });
  sells.sort((a, b) => compareOperationalSells(a, b, rowByKey));
  buyNearMisses.sort((a, b) => a.ticker.localeCompare(b.ticker));

  return {
    byKey,
    buys,
    sells,
    urgentKeys: urgent.urgentKeys,
    buyNearMisses,
    gateStrengthByKey,
  };
}
