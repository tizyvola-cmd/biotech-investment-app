/**
 * Replay paper sim ticks applying RA→ in the loop (what-if vs current Top2/P(plan) logic).
 * Uses today's Entry RA snapshot retroactively on stored evaluations.
 */
import type { ChartPoint, SheetTable } from "../types";
import type { InvestSimInputs } from "./investSimStorage";
import { buildSimRowByKeyMap, reconcileInvestSimInputs } from "./investSimKeys";
import { pickSignalFromSimRow } from "./top2FromSimulation";
import { simulationRowSeriesKey } from "../data/simulationCharts";
import {
  resolveSimulationEntrySolidity,
  simulationSolidityVisible,
} from "./simulationEntrySolidity";
import { buildSdsByTicker } from "./sdsTopOppGate";
import type { SdsRow } from "../api/supernova";
import type { MigSoliditySnapshot } from "./entrySolidityMig";
import {
  deriveRaEntryInvestVerdict,
  type RaEntryInvestVerdict,
  type RaEntryInvestVerdictResult,
} from "./raEntryInvestVerdict";
import {
  misalignmentSummaryFromEvaluations,
  type DecisionSimTick,
  type DecisionSimTickSummary,
  type PaperPosition,
  type PaperTradeEvent,
  type TickerSimEvaluation,
} from "./investDecisionSimLoop";
import { getTop2Label } from "./top2DecisionHelpers";
import {
  buildExperimentPiggyBank,
  stampPortfolioMarks,
} from "./investDecisionSimExperiment";

export type EntryRaVerdictEntry = {
  entryRa: number | null;
  /** Display / in-portfolio chip — uses real portfolio flag. */
  result: RaEntryInvestVerdictResult;
  /** Paper entry gate — always evaluated as a new entry (hasPosition=false). */
  entryGate: RaEntryInvestVerdictResult;
};

export function buildEntryRaVerdictByKey(args: {
  simTable: SheetTable | null;
  inputs: InvestSimInputs;
  pointsBySeriesKey: Map<string, ChartPoint[]>;
  sdsRows: SdsRow[] | null;
  migSolidityByKey: Map<string, MigSoliditySnapshot>;
  lang: "it" | "en";
}): Map<string, EntryRaVerdictEntry> {
  const map = new Map<string, EntryRaVerdictEntry>();
  if (!args.simTable?.rows?.length) return map;

  const merged = reconcileInvestSimInputs(args.inputs, args.simTable.rows);
  const simRowByKey = buildSimRowByKeyMap(args.simTable.rows);
  const sdsByTicker = buildSdsByTicker(args.sdsRows);
  const langCode = args.lang;

  for (const [key, simRow] of simRowByKey) {
    const sk = simulationRowSeriesKey(simRow);
    const chartPts = sk ? args.pointsBySeriesKey.get(sk) ?? null : null;
    const pick = pickSignalFromSimRow(simRow, merged, chartPts, null);
    if (!pick) continue;

    const sol = resolveSimulationEntrySolidity(
      pick,
      {
        sdsByTicker,
        migByKey: args.migSolidityByKey,
        reliabilityMetricsOptions: { chartPoints: chartPts },
        simColumns: args.simTable.columns,
      },
      langCode,
      "rascore",
    );
    if (!simulationSolidityVisible(sol)) continue;

    const entryRa = sol.composite.total;
    map.set(key, {
      entryRa,
      result: deriveRaEntryInvestVerdict({
        entryRa,
        hasPosition: pick.hasPosition,
      }),
      entryGate: deriveRaEntryInvestVerdict({
        entryRa,
        hasPosition: false,
      }),
    });
  }

  return map;
}

export function raVerdictForKey(
  raByKey: Map<string, EntryRaVerdictEntry>,
  key: string,
  mode: "display" | "entryGate" | "position" = "display",
): RaEntryInvestVerdict | null {
  const row = raByKey.get(key);
  if (!row) return null;
  if (mode === "entryGate") return row.entryGate.verdict;
  if (mode === "position") {
    return deriveRaEntryInvestVerdict({
      entryRa: row.entryRa,
      hasPosition: true,
      thresholds: row.result.thresholds,
    }).verdict;
  }
  return row.result.verdict;
}

/** Paper BUY only when Top2 says buy and RA→ entry gate confirms buy. */
export function wouldRaSimBuy(
  ev: Pick<TickerSimEvaluation, "suggestedAction" | "key">,
  raByKey: Map<string, EntryRaVerdictEntry>,
): boolean {
  if (ev.suggestedAction !== "buy") return false;
  return raVerdictForKey(raByKey, ev.key, "entryGate") === "buy";
}

/** Paper SELL when Top2 sell or RA reduce on an open paper line. */
export function wouldRaSimSell(
  ev: Pick<TickerSimEvaluation, "suggestedAction" | "key" | "inPaperPortfolio">,
  raByKey: Map<string, EntryRaVerdictEntry>,
  inPaper: boolean,
): boolean {
  if (!inPaper) return false;
  if (ev.suggestedAction === "sell") return true;
  return raVerdictForKey(raByKey, ev.key, "position") === "reduce";
}

export function simulatePaperTradesWithRa(
  evaluations: TickerSimEvaluation[],
  portfolio: PaperPosition[],
  at: string,
  capitalPerTrade: number,
  maxOpenPositions: number,
  raByKey: Map<string, EntryRaVerdictEntry>,
): { trades: PaperTradeEvent[]; portfolioAfter: PaperPosition[] } {
  const trades: PaperTradeEvent[] = [];
  const keys = new Set(portfolio.map((p) => p.key));
  let next = [...portfolio];

  for (const ev of evaluations) {
    if (!wouldRaSimBuy(ev, raByKey) || keys.has(ev.key)) continue;
    if (next.length >= maxOpenPositions) continue;
    const raTag = raVerdictForKey(raByKey, ev.key, "entryGate") ?? "—";
    const top2Label = getTop2Label(ev.hasPosition, ev.investVerdict, "en");
    const pos: PaperPosition = {
      key: ev.key,
      ticker: ev.ticker,
      entryAt: at,
      capital: capitalPerTrade,
      entryReason: `${top2Label} · RA→ ${raTag} · P ${ev.probPct?.toFixed(0) ?? "—"}%`,
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
      reason: `${top2Label} · RA→ ${raTag}`,
      capital: capitalPerTrade,
      pnlPctSimulated: null,
      pnlEurSimulated: null,
    });
  }

  for (const ev of evaluations) {
    const inPaper = keys.has(ev.key);
    if (!wouldRaSimSell(ev, raByKey, inPaper)) continue;
    const pos = next.find((p) => p.key === ev.key);
    if (!pos) continue;
    const pnlPct = ev.pnlPct ?? ev.pnlPct24h ?? 0;
    const pnlEur = Math.round((pos.capital * pnlPct) / 100 * 100) / 100;
    const raTag = raVerdictForKey(raByKey, ev.key, "position");
    const reason =
      ev.suggestedAction === "sell"
        ? (ev.exitReason ?? "exit signal")
        : `RA→ ${raTag ?? "reduce"}`;
    trades.push({
      at,
      ticker: ev.ticker,
      key: ev.key,
      side: "sell",
      reason,
      capital: pos.capital,
      pnlPctSimulated: pnlPct,
      pnlEurSimulated: pnlEur,
    });
    next = next.filter((p) => p.key !== ev.key);
    keys.delete(ev.key);
  }

  return { trades, portfolioAfter: next };
}

function summarizeReplayTick(
  evaluations: TickerSimEvaluation[],
  trades: PaperTradeEvent[],
): DecisionSimTickSummary {
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

export type RaReplayStats = {
  blockedBuys: number;
  raExtraSells: number;
  baselineTrades: number;
  raTrades: number;
};

export function replayDecisionSimWithRa(args: {
  ticks: DecisionSimTick[];
  raByKey: Map<string, EntryRaVerdictEntry>;
  capitalPerTrade: number;
  maxOpenPositions: number;
  /** Required when persisted ticks have evaluations stripped (localStorage compact). */
  resolveEvaluations?: (
    portfolioBefore: PaperPosition[],
    tick: DecisionSimTick,
  ) => TickerSimEvaluation[];
}): {
  ticks: DecisionSimTick[];
  finalPortfolio: PaperPosition[];
  cumulativeClosedPnlEur: number;
  closedTradeCount: number;
  stats: RaReplayStats;
} {
  const sorted = [...args.ticks].sort((a, b) => a.at.localeCompare(b.at));
  let portfolio: PaperPosition[] = [];
  let closedPnl = 0;
  let closedCount = 0;
  let blockedBuys = 0;
  let raExtraSells = 0;
  let baselineTrades = 0;
  let raTrades = 0;
  const replayTicks: DecisionSimTick[] = [];

  for (const orig of sorted) {
    baselineTrades += orig.trades.length;
    const evaluations =
      orig.evaluations.length > 0
        ? orig.evaluations
        : (args.resolveEvaluations?.(portfolio, orig) ?? []);

    for (const ev of evaluations) {
      if (ev.suggestedAction === "buy" && !portfolio.some((p) => p.key === ev.key) && !wouldRaSimBuy(ev, args.raByKey)) {
        blockedBuys += 1;
      }
    }

    const { trades, portfolioAfter: rawAfter } = simulatePaperTradesWithRa(
      evaluations,
      portfolio,
      orig.at,
      args.capitalPerTrade,
      args.maxOpenPositions,
      args.raByKey,
    );
    raTrades += trades.length;
    for (const tr of trades) {
      if (tr.side !== "sell") continue;
      const ev = evaluations.find((e) => e.key === tr.key);
      if (ev && ev.suggestedAction !== "sell") raExtraSells += 1;
    }

    const portfolioAfter = stampPortfolioMarks(rawAfter, evaluations);
    for (const tr of trades) {
      if (tr.side === "sell") {
        closedPnl = Math.round((closedPnl + (tr.pnlEurSimulated ?? 0)) * 100) / 100;
        closedCount += 1;
      }
    }

    const summary = summarizeReplayTick(evaluations, trades);
    summary.piggyBank = buildExperimentPiggyBank(
      portfolioAfter,
      evaluations,
      closedPnl,
      closedCount,
    );

    replayTicks.push({
      ...orig,
      evaluations,
      portfolioBefore: portfolio,
      portfolioAfter,
      trades,
      summary,
    });
    portfolio = portfolioAfter;
  }

  return {
    ticks: replayTicks,
    finalPortfolio: portfolio,
    cumulativeClosedPnlEur: closedPnl,
    closedTradeCount: closedCount,
    stats: { blockedBuys, raExtraSells, baselineTrades, raTrades },
  };
}

/** Effective paper action for advice calibration under RA loop. */
export function raEffectivePaperAction(
  row: {
    suggestedAction: TickerSimEvaluation["suggestedAction"];
    key: string;
    inPaperPortfolio: boolean;
  },
  raByKey: Map<string, EntryRaVerdictEntry>,
): "buy" | "sell" | "hold" | "review" {
  const base = row.suggestedAction;
  if (wouldRaSimBuy({ suggestedAction: base, key: row.key }, raByKey)) return "buy";
  if (
    wouldRaSimSell(
      { suggestedAction: base, key: row.key, inPaperPortfolio: row.inPaperPortfolio },
      raByKey,
      row.inPaperPortfolio,
    )
  ) {
    return "sell";
  }
  if (base === "buy" || base === "sell") return "hold";
  if (base === "review") return "review";
  return "hold";
}
