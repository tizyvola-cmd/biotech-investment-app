/**
 * Flash Test tick — 5 independent auto paper books (Gen 0…4).
 */
import type { ChartPoint, SheetTable } from "../types";
import type { RegulatoryRiskSnapshot } from "../api/supernova";
import type { LossRiskEntry } from "../components/LossRiskPoopCell";
import type { LossRiskCatalog } from "../hooks/useLossRiskCatalog";
import {
  buildLossAnalysisItems,
  type LossAnalysisProbOptions,
  type PortfolioLossAnalysisItem,
} from "./portfolioLossAnalysis";
import {
  attachContCutPriority,
  evaluateUrgentSellGrade2Book,
  peakPnlEurFromHistory,
} from "./softSignalGrades";
import {
  backfillPaperEntryBuyPrices,
  overlayPaperMarksOnLossItem,
  resolvePaperPositionMarks,
  simulatePaperTrades,
  softBuySuggestionPriority,
  type PaperPosition,
  type SuggestedActionEnhanceCtx,
  type TickerSimEvaluation,
} from "./investDecisionSimLoop";
import { getTop2Label } from "./top2DecisionHelpers";
import { stampPortfolioMarks } from "./investDecisionSimExperiment";
import { buildSimRowByKeyMap } from "./investSimKeys";
import { currentPriceFromRow } from "./simulationPosition";
import { priorSessionDayPnlByKey } from "./urgentSellBookLegs";
import {
  resolveRegSignedScoreForTicker,
} from "./decisionChartBuild";
import { regRiskFromSignedScore } from "./decisionChartLogic";
import {
  lookupLossRisk,
  lookupLossRiskByRowKey,
} from "../hooks/useLossRiskCatalog";
import { softBuyBlockedByBookSell } from "./softBuyPostSellCooldown";
import type { InvestSimHistoryPoint, InvestSimInputs } from "./investSimStorage";
import { deriveFlashTestAction, explainFlashBuyMiss } from "./flashTestLogic";
import { buildRecommendationSignalCtx } from "./recommendationSignalGates";
import {
  FLASH_TEST_GENS,
  FLASH_TEST_SIGNALS_MAX,
  type FlashTestArmState,
  type FlashTestEquityPoint,
  type FlashTestMissCounts,
  type FlashTestSignalRow,
  type FlashTestState,
  type FlashTestTrade,
  type SoftLogicGenId,
} from "./flashTestTypes";
import {
  isFlashTestRunExpired,
  saveFlashTestState,
  stopFlashTestRun,
} from "./flashTestStorage";

export type FlashTestTickContext = {
  simTable: SheetTable;
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  lang: "it" | "en";
  probOptions?: LossAnalysisProbOptions | null;
  history?: InvestSimHistoryPoint[] | null;
  lossRiskCatalog?: LossRiskCatalog | null;
  catalogByRowKey?: Map<string, LossRiskEntry> | null;
  autoRegSnap?: RegulatoryRiskSnapshot | null;
  /** Yahoo prior-session % — same Soft BUY ↑≥2d input as Home. */
  priorSessionPctByTicker?: Map<string, number> | Record<string, number> | null;
  /** Real book — Soft BUY post-sell cooldown (same as Home). */
  inputs?: InvestSimInputs | null;
};

/** Open keys implied by the trade ledger (buy without a later sell). */
function openKeysFromTrades(trades: readonly FlashTestTrade[]): Set<string> {
  const open = new Set<string>();
  for (const t of trades) {
    if (t.side === "buy") open.add(t.key);
    else open.delete(t.key);
  }
  return open;
}

/**
 * Force every open paper row to the fixed per-trade capital (Flash A/B rule).
 * Legacy Gen 4 gate-strength tickets (40–70%) are rewritten in place so the
 * UI capital column and € MTM update without requiring a full restart.
 */
/** @internal exported for unit tests */
export function normalizeFlashOpenCapitals(
  portfolio: PaperPosition[],
  capitalPerTrade: number,
  simRowByKey?: Map<string, Record<string, unknown>>,
): PaperPosition[] {
  if (!(capitalPerTrade > 0) || !portfolio.length) return portfolio;
  let changed = false;
  const out = portfolio.map((p) => {
    const cap = Number(p.capital) || 0;
    if (Math.abs(cap - capitalPerTrade) < 0.5) return p;
    changed = true;
    const simRow = simRowByKey?.get(p.key);
    const marks = resolvePaperPositionMarks(p, simRow ?? null);
    const mtmEur =
      marks.totalPnlPct != null && cap > 0
        ? Math.round(((cap * marks.totalPnlPct) / 100) * 100) / 100
        : 0;
    const currFromRow = simRow ? currentPriceFromRow(simRow) : null;
    const curr =
      currFromRow != null && currFromRow > 0
        ? currFromRow
        : p.entryBuyPrice != null &&
            marks.totalPnlPct != null &&
            Number.isFinite(marks.totalPnlPct)
          ? p.entryBuyPrice * (1 + marks.totalPnlPct / 100)
          : null;
    let entryBuyPrice = p.entryBuyPrice;
    if (curr != null && curr > 0 && capitalPerTrade + mtmEur > 0) {
      // Preserve € MTM when resizing legacy gate-sized tickets to fixed per-trade capital.
      entryBuyPrice =
        Math.round(((capitalPerTrade * curr) / (mtmEur + capitalPerTrade)) * 10000) /
        10000;
    }
    const lastMarkPct =
      capitalPerTrade > 0
        ? Math.round((mtmEur / capitalPerTrade) * 10000) / 100
        : marks.totalPnlPct ?? p.lastMarkPct ?? null;
    return {
      ...p,
      capital: capitalPerTrade,
      entryBuyPrice,
      lastMarkPct,
    };
  });
  return changed ? out : portfolio;
}

/** Pin portfolio + BUY ledger tickets to fixed per-trade size. */
export function normalizeFlashArmCapitals(
  arm: FlashTestArmState,
  capitalPerTrade: number,
  simRowByKey?: Map<string, Record<string, unknown>>,
): FlashTestArmState {
  if (!(capitalPerTrade > 0)) return arm;
  const portfolio = normalizeFlashOpenCapitals(
    arm.portfolio,
    capitalPerTrade,
    simRowByKey,
  );
  let tradesChanged = false;
  const trades = arm.trades.map((t) => {
    if (t.side !== "buy") return t;
    const cap = Number(t.capital) || 0;
    if (Math.abs(cap - capitalPerTrade) < 0.5) return t;
    tradesChanged = true;
    return { ...t, capital: capitalPerTrade };
  });
  if (portfolio === arm.portfolio && !tradesChanged) return arm;
  return {
    ...arm,
    portfolio,
    trades: tradesChanged ? trades : arm.trades,
  };
}

/** One-shot: rewrite all arms' open/ledger capital and persist (no sim required). */
export function normalizeFlashTestCapitals(state: FlashTestState): FlashTestState {
  const capitalPerTrade = state.capitalPerTrade;
  if (!(capitalPerTrade > 0)) return state;
  let changed = false;
  const arms = { ...state.arms };
  for (const gen of FLASH_TEST_GENS) {
    const arm = state.arms[gen]!;
    const next = normalizeFlashArmCapitals(arm, capitalPerTrade);
    if (next !== arm) {
      changed = true;
      arms[gen] = next;
    }
  }
  if (!changed) return state;
  return saveFlashTestState({ ...state, arms });
}

/**
 * Heal portfolio ↔ trade-log drift (e.g. localStorage race left buys in the log
 * but dropped open rows). Re-open missing buys; drop rows the ledger closed.
 */
function reconcilePortfolioToTradeLedger(
  portfolio: PaperPosition[],
  trades: readonly FlashTestTrade[],
  capitalPerTrade: number,
): PaperPosition[] {
  const shouldOpen = openKeysFromTrades(trades);
  const byKey = new Map(portfolio.map((p) => [p.key, p]));
  const out: PaperPosition[] = [];
  for (const key of shouldOpen) {
    const existing = byKey.get(key);
    if (existing) {
      out.push(existing);
      continue;
    }
    // Rebuild from the latest BUY event for this key.
    let lastBuy: FlashTestTrade | null = null;
    for (let i = trades.length - 1; i >= 0; i--) {
      const t = trades[i]!;
      if (t.key === key && t.side === "buy") {
        lastBuy = t;
        break;
      }
    }
    if (!lastBuy) continue;
    out.push({
      key: lastBuy.key,
      ticker: lastBuy.ticker,
      entryAt: lastBuy.at,
      // Always fixed Flash size — ignore legacy Gen 4 gate-sized buy tickets.
      capital: capitalPerTrade,
      entryReason: lastBuy.reason,
      entryPlanReturnPct: null,
      entryProbPct: null,
      entryBuyPrice: null,
      lastMarkPct: null,
    });
  }
  return out;
}

function stubEval(
  item: PortfolioLossAnalysisItem,
  action: TickerSimEvaluation["suggestedAction"],
  inPaper: boolean,
): TickerSimEvaluation {
  return {
    key: item.key,
    ticker: item.ticker,
    hasPosition: inPaper || item.hasPosition,
    inPaperPortfolio: inPaper,
    daysToCd: item.daysToCd,
    readings: {
      supernovaPeakPct: item.curvePeakReturnPct,
      planTargetPct: item.planReturnPct,
      planCdPct: item.planCdReturnPct,
      precatKind: String(item.precatKind ?? ""),
      slope5d: item.slope5d,
      slope20d: item.slope20d,
      pred5Pp: item.pred5Pp,
      curveGapPct: item.curveGapPct,
      harmonyMaxGapPp: null,
      harmonyAligned: null,
      stabilityVerdict: item.stabilityVerdict,
    },
    misalignments: [],
    misalignmentLabels: [],
    exitDecision: item.exitDecision,
    investVerdict: item.investVerdict,
    entryVerdict: item.hasPosition ? null : item.investVerdict,
    exitVerdict: item.hasPosition ? item.investVerdict : null,
    probPct: item.recoveryProbabilityPct,
    suggestedAction: action,
    planReturnPct: item.planReturnPct,
    pnlPct24h: item.pnlPct24h,
    pnlPct: item.pnlPct,
    precatVerdictAgree: true,
    exitReason: item.exitReason,
    compositeScore: 0,
    scoringZone: "watch",
    scoreBreakdown: {} as TickerSimEvaluation["scoreBreakdown"],
    compositeDampened: false,
  };
}

function priorSessionPctsForTicker(
  ticker: string,
  byTicker?: Map<string, number> | Record<string, number> | null,
): Array<number | null | undefined> | undefined {
  if (!byTicker) return undefined;
  const tk = ticker.trim().toUpperCase();
  const pct = byTicker instanceof Map ? byTicker.get(tk) : byTicker[tk];
  if (pct == null || !Number.isFinite(pct)) return undefined;
  return [pct];
}

function buildEnhance(
  item: PortfolioLossAnalysisItem,
  opts: {
    simRow: Record<string, unknown> | null;
    chartPts: ChartPoint[] | null;
    urgentKeys: ReadonlySet<string>;
    peakPnlEur: number | null;
    lossRiskCatalog?: LossRiskCatalog | null;
    catalogByRowKey?: Map<string, LossRiskEntry> | null;
    autoRegSnap?: RegulatoryRiskSnapshot | null;
    priorSessionPctByTicker?: Map<string, number> | Record<string, number> | null;
    inputs?: InvestSimInputs | null;
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
  return {
    urgentSellG2Keys: opts.urgentKeys,
    riskV2: lossRisk?.riskScore ?? null,
    regRisk: regRiskFromSignedScore(regSigned),
    regulatoryRiskScore: regRiskFromSignedScore(regSigned),
    simRow: opts.simRow,
    chartPts: opts.chartPts,
    priorSessionPcts: priorSessionPctsForTicker(
      item.ticker,
      opts.priorSessionPctByTicker,
    ),
    recentlySoldBlocked: softBuyBlockedByBookSell(opts.inputs ?? {}, {
      key: item.key,
      ticker: item.ticker,
    }),
    peakPnlEur: opts.peakPnlEur,
  };
}

function equityPoint(
  at: string,
  arm: FlashTestArmState,
  bankroll: number,
): FlashTestEquityPoint {
  let openMtm = 0;
  let openCap = 0;
  for (const p of arm.portfolio) {
    openCap += p.capital;
    const pct =
      p.lastMarkPct != null && Number.isFinite(p.lastMarkPct) ? p.lastMarkPct : 0;
    openMtm += (p.capital * pct) / 100;
  }
  const total = Math.round((arm.cumulativeClosedPnlEur + openMtm) * 100) / 100;
  const pct =
    bankroll > 0 ? Math.round((total / bankroll) * 1000) / 10 : 0;
  return {
    ts: at,
    closedPnlEur: Math.round(arm.cumulativeClosedPnlEur * 100) / 100,
    openMtmEur: Math.round(openMtm * 100) / 100,
    totalPnlEur: total,
    openCapitalEur: Math.round(openCap * 100) / 100,
    pnlPctOnBankroll: pct,
  };
}

function tickArm(
  gen: SoftLogicGenId,
  arm: FlashTestArmState,
  baseItems: Map<string, PortfolioLossAnalysisItem>,
  ctx: FlashTestTickContext,
  at: string,
  capitalPerTrade: number,
  maxOpen: number,
  bankroll: number,
): FlashTestArmState {
  const simRowByKey = buildSimRowByKeyMap(ctx.simTable.rows ?? []);
  // Heal portfolio↔trades drift first so Soft SELL sees every ledger-open name.
  // Then pin capital to the fixed per-trade size (undo legacy Gen 4 gate sizing).
  const healed = normalizeFlashArmCapitals(
    {
      ...arm,
      portfolio: backfillPaperEntryBuyPrices(
        reconcilePortfolioToTradeLedger(arm.portfolio, arm.trades, capitalPerTrade),
        simRowByKey,
      ),
    },
    capitalPerTrade,
    simRowByKey,
  );
  const paper = healed.portfolio;
  const paperByKey = new Map(paper.map((p) => [p.key, p]));
  const paperKeys = new Set(paper.map((p) => p.key));

  const byKey = new Map<string, PortfolioLossAnalysisItem>();
  for (const [k, it] of baseItems) byKey.set(k, { ...it, hasPosition: false });

  for (const pos of paper) {
    if (!byKey.has(pos.key)) {
      const row = simRowByKey.get(pos.key);
      if (!row) continue;
      const stub = buildLossAnalysisItems(
        "opportunities",
        { sheet: "Simulation", columns: [], rows: [row] },
        {},
        ctx.pointsBySeriesKey,
        ctx.lang,
        ctx.history ?? null,
        ctx.probOptions,
        "all",
      )[0];
      if (stub) byKey.set(pos.key, stub);
    }
  }

  for (const [key, item] of [...byKey.entries()]) {
    const pos = paperByKey.get(key);
    if (!pos) continue;
    // Paper book must flip hasPosition so Soft SELL / Gen exits can fire (Decision
    // Sim passes inPaper into deriveSuggestedAction — Flash Test was leaving false).
    byKey.set(key, {
      ...overlayPaperMarksOnLossItem(item, pos, simRowByKey.get(key) ?? null),
      hasPosition: true,
    });
  }

  const prior = priorSessionDayPnlByKey(
    ctx.history ?? null,
    paper.map((p) => p.key),
  );
  const urgent = evaluateUrgentSellGrade2Book(
    paper.map((pos) => {
      const item = byKey.get(pos.key);
      const simRow = simRowByKey.get(pos.key) ?? null;
      const marks = resolvePaperPositionMarks(pos, simRow);
      const dayEur =
        marks.dayPnlPct != null && Number.isFinite(marks.dayPnlPct)
          ? (pos.capital * marks.dayPnlPct) / 100
          : 0;
      return attachContCutPriority(
        {
          key: pos.key,
          ticker: pos.ticker,
          dayPnlEur: Math.round((dayEur + (prior.get(pos.key) ?? 0)) * 100) / 100,
          dayPnlPct: marks.dayPnlPct,
          totalPnlPct: marks.totalPnlPct ?? item?.pnlPct ?? null,
        },
        simRow,
      );
    }),
  );

  const peakPnlByKey = { ...arm.peakPnlByKey };
  const evaluations: TickerSimEvaluation[] = [];
  const enhanceByKey = new Map<string, SuggestedActionEnhanceCtx>();
  for (const item of byKey.values()) {
    const simRow = simRowByKey.get(item.key) ?? null;
    const chartPts = item.seriesKey
      ? ctx.pointsBySeriesKey.get(item.seriesKey) ?? null
      : null;
    const curPnl =
      item.pnlEur != null && Number.isFinite(item.pnlEur) ? item.pnlEur : null;
    if (item.hasPosition && curPnl != null) {
      const prev = peakPnlByKey[item.key];
      peakPnlByKey[item.key] =
        prev != null && Number.isFinite(prev) ? Math.max(prev, curPnl) : curPnl;
    }
    const enhance = buildEnhance(item, {
      simRow,
      chartPts,
      urgentKeys: urgent.urgentKeys,
      peakPnlEur:
        peakPnlByKey[item.key] ??
        peakPnlEurFromHistory(
          ctx.history,
          item.key,
          // Flash paper peaks are tracked in peakPnlByKey for the run; history fallback is unscoped.
          null,
        ),
      lossRiskCatalog: ctx.lossRiskCatalog,
      catalogByRowKey: ctx.catalogByRowKey,
      autoRegSnap: ctx.autoRegSnap,
      priorSessionPctByTicker: ctx.priorSessionPctByTicker,
      inputs: ctx.inputs,
    });
    enhanceByKey.set(item.key, enhance);
    const inPaper = paperKeys.has(item.key);
    const action = deriveFlashTestAction(gen, item, enhance, inPaper);
    evaluations.push(stubEval(item, action, inPaper));
  }

  // Soft BUY first by priority — fair bankroll fill across the same universe.
  const buyRank = (ev: TickerSimEvaluation): number => {
    if (ev.suggestedAction !== "buy") return -1;
    if (ev.inPaperPortfolio || ev.hasPosition) return -1;
    const item = byKey.get(ev.key);
    if (!item) return 0;
    const dayPct = buildRecommendationSignalCtx(
      enhanceByKey.get(ev.key)?.simRow,
      enhanceByKey.get(ev.key)?.chartPts,
    ).d1;
    return softBuySuggestionPriority(item, dayPct, enhanceByKey.get(ev.key));
  };
  evaluations.sort((a, b) => {
    const aBuy = a.suggestedAction === "buy" && !a.inPaperPortfolio ? 1 : 0;
    const bBuy = b.suggestedAction === "buy" && !b.inPaperPortfolio ? 1 : 0;
    if (aBuy !== bBuy) return bBuy - aBuy;
    if (aBuy) return buyRank(b) - buyRank(a);
    return 0;
  });

  const lastTickSignals: FlashTestSignalRow[] = [];
  const lastTickMissCounts: FlashTestMissCounts = {};
  for (const ev of evaluations) {
    const item = byKey.get(ev.key);
    const inPaper = Boolean(ev.inPaperPortfolio);
    if (item && !inPaper && ev.suggestedAction !== "buy") {
      const miss = explainFlashBuyMiss(gen, item, enhanceByKey.get(ev.key), inPaper);
      if (miss) {
        lastTickMissCounts[miss] = (lastTickMissCounts[miss] ?? 0) + 1;
      }
    }
    // Soft BUY list = candidates not already held; Soft SELL = exits on open book.
    if (ev.suggestedAction === "buy" && inPaper) continue;
    if (ev.suggestedAction !== "buy" && ev.suggestedAction !== "sell") continue;
    const top2 = getTop2Label(ev.hasPosition, ev.investVerdict, ctx.lang);
    lastTickSignals.push({
      key: ev.key,
      ticker: ev.ticker,
      side: ev.suggestedAction,
      priority:
        ev.suggestedAction === "buy"
          ? Math.round(buyRank(ev) * 100) / 100
          : 0,
      reason:
        ev.suggestedAction === "buy"
          ? `${top2} · P ${ev.probPct?.toFixed(0) ?? "—"}%`
          : ev.exitReason?.trim() || top2 || "sell",
    });
    if (lastTickSignals.length >= FLASH_TEST_SIGNALS_MAX) break;
  }

  let slotsLeft = Math.max(0, maxOpen - paper.length);
  const openCap = paper.reduce((s, p) => s + (Number(p.capital) || 0), 0);
  let budgetLeft = Math.max(0, bankroll - openCap);
  // All gens: fixed capitalPerTrade (default $5000). Gate-strength sizing is
  // Home Soft Soft only — scaling Gen 4 tickets (40–70%) biased the A/B low.
  const resolveBuyCapital = (_ev: TickerSimEvaluation): number => {
    if (slotsLeft <= 0 || budgetLeft < 1) return 0;
    const cap = Math.min(capitalPerTrade, budgetLeft);
    if (cap < 1) return 0;
    slotsLeft -= 1;
    budgetLeft -= cap;
    return Math.round(cap * 100) / 100;
  };

  const { trades, portfolioAfter: rawAfter } = simulatePaperTrades(
    evaluations,
    paper,
    at,
    capitalPerTrade,
    maxOpen,
    { simRowByKey, resolveBuyCapital },
  );
  // Prefer sheet tape marks (entry vs spot / Var. Giorn.) over eval stubs that
  // often stay at 0% when Prezzo Corrente is still equal to the buy stamp.
  const portfolioAfter = stampPortfolioMarks(rawAfter, evaluations).map((pos) => {
    const marks = resolvePaperPositionMarks(pos, simRowByKey.get(pos.key));
    return marks.totalPnlPct != null
      ? { ...pos, lastMarkPct: marks.totalPnlPct }
      : pos;
  });

  let closedPnl = arm.cumulativeClosedPnlEur;
  let closedCount = arm.closedTradeCount;
  for (const t of trades) {
    if (t.side === "sell" && t.pnlEurSimulated != null) {
      closedPnl += t.pnlEurSimulated;
      closedCount += 1;
      delete peakPnlByKey[t.key];
    }
  }

  const tradesAll: FlashTestTrade[] = [
    ...healed.trades,
    ...trades.map((t) => ({ ...t, gen })),
  ];

  const nextArm: FlashTestArmState = {
    ...arm,
    portfolio: normalizeFlashOpenCapitals(
      reconcilePortfolioToTradeLedger(
        portfolioAfter,
        tradesAll,
        capitalPerTrade,
      ),
      capitalPerTrade,
      simRowByKey,
    ),
    trades: tradesAll,
    cumulativeClosedPnlEur: closedPnl,
    closedTradeCount: closedCount,
    peakPnlByKey,
    lastTickSignals,
    lastTickMissCounts,
    equity: arm.equity,
  };
  const eq = equityPoint(at, nextArm, bankroll);
  nextArm.equity = [...arm.equity, eq];
  return nextArm;
}

/** Run one Flash Test tick across all 5 gens. Persists when `persist` (default true). */
export function runFlashTestTick(
  state: FlashTestState,
  ctx: FlashTestTickContext,
  opts?: { persist?: boolean },
): FlashTestState {
  if (!state.enabled || !ctx.simTable.rows?.length) return state;
  if (isFlashTestRunExpired(state)) {
    return stopFlashTestRun(state);
  }

  const at = new Date().toISOString();
  // Empty inputs → universe is opportunities; paper overlay creates positions.
  const baseList = [
    ...buildLossAnalysisItems(
      "opportunities",
      ctx.simTable,
      {},
      ctx.pointsBySeriesKey,
      ctx.lang,
      ctx.history ?? null,
      ctx.probOptions,
      "all",
    ),
  ];
  const baseItems = new Map<string, PortfolioLossAnalysisItem>();
  for (const it of baseList) baseItems.set(it.key, it);

  const arms = { ...state.arms };
  for (const gen of FLASH_TEST_GENS) {
    arms[gen] = tickArm(
      gen,
      state.arms[gen]!,
      baseItems,
      ctx,
      at,
      state.capitalPerTrade,
      state.maxOpenPositions,
      state.bankrollEur,
    );
  }

  const next: FlashTestState = {
    ...state,
    arms,
    lastTickAt: at,
  };
  return opts?.persist === false ? next : saveFlashTestState(next);
}

/** Mark-only tick (no new trades) — refresh equity curves between full ticks. */
export function markFlashTestBooks(
  state: FlashTestState,
  ctx: FlashTestTickContext,
): FlashTestState {
  if (!state.enabled || !ctx.simTable.rows?.length) return state;
  const at = new Date().toISOString();
  const simRowByKey = buildSimRowByKeyMap(ctx.simTable.rows ?? []);
  const arms = { ...state.arms };
  for (const gen of FLASH_TEST_GENS) {
    const arm = state.arms[gen]!;
    const healed = normalizeFlashArmCapitals(
      {
        ...arm,
        portfolio: backfillPaperEntryBuyPrices(arm.portfolio, simRowByKey),
      },
      state.capitalPerTrade,
      simRowByKey,
    );
    const stamped = healed.portfolio.map((pos) => {
      const marks = resolvePaperPositionMarks(pos, simRowByKey.get(pos.key));
      return {
        ...pos,
        lastMarkPct: marks.totalPnlPct ?? pos.lastMarkPct ?? null,
      } satisfies PaperPosition;
    });
    const nextArm: FlashTestArmState = {
      ...healed,
      portfolio: stamped,
    };
    const eq = equityPoint(at, nextArm, state.bankrollEur);
    nextArm.equity = [...arm.equity, eq];
    arms[gen] = nextArm;
  }
  return saveFlashTestState({ ...state, arms, lastTickAt: at });
}
