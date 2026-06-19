/**
 * Adatta tick paper del Decision Sim loop → TradePortfolioChart.
 */
import type { PortfolioPoint, Trade, TradeAction } from "../types/trades";
import type { SheetTable } from "../types";
import { buildSimRowByKeyMap } from "./investSimKeys";
import {
  classifyAdviceOutcome,
  type AdviceOutcomeClass,
} from "./investDecisionSimAdviceCalibration";
import { dailyChangePctFromRow } from "./simulationPosition";
import {
  buildDecisionSimCumulativeSeries,
  flattenDecisionSimTrades,
  formatDecisionSimChartTime,
} from "./investDecisionSimCharts";
import type {
  DecisionSimTick,
  PaperPosition,
  PaperTradeEvent,
  TickerSimEvaluation,
} from "./investDecisionSimLoop";
import type { ExperimentPiggyBank } from "./investDecisionSimExperiment";

function spotUsdFromSimRow(row: Record<string, unknown> | null | undefined): number | null {
  if (!row) return null;
  for (const col of ["Prezzo Corrente ($)", "Current Price ($)", "Prezzo"]) {
    const raw = row[col];
    if (raw == null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function chartDateLabel(iso: string): string {
  return formatDecisionSimChartTime(iso);
}

function resolvePostMove24hPct(
  key: string,
  liveEvaluations: TickerSimEvaluation[],
  simRowByKey: Map<string, Record<string, unknown>>,
): number | null {
  const ev = liveEvaluations.find((e) => e.key === key);
  if (ev?.pnlPct24h != null && Number.isFinite(ev.pnlPct24h)) return ev.pnlPct24h;
  const row = simRowByKey.get(key);
  if (row) {
    const daily = dailyChangePctFromRow(row);
    if (daily != null && Number.isFinite(daily)) return daily;
  }
  return null;
}

function tradeFromPaperEvent(
  tr: PaperTradeEvent,
  simRowByKey: Map<string, Record<string, unknown>>,
  liveEvaluations: TickerSimEvaluation[],
): Trade {
  const spot = spotUsdFromSimRow(simRowByKey.get(tr.key));
  const qty = spot != null && spot > 0 ? Math.round((tr.capital / spot) * 100) / 100 : null;
  const action: TradeAction = tr.side === "sell" ? "SELL" : "BUY";
  let postMovePct24h: number | null = null;
  let adviceOutcome: AdviceOutcomeClass | null = null;
  if (tr.side === "sell") {
    postMovePct24h = resolvePostMove24hPct(tr.key, liveEvaluations, simRowByKey);
    adviceOutcome = classifyAdviceOutcome("sell", postMovePct24h) ?? "pending";
  }
  return {
    id: `${tr.at}|${tr.key}|${tr.side}`,
    date: chartDateLabel(tr.at),
    ticker: tr.ticker,
    action,
    price: spot,
    qty,
    value: tr.capital ?? 0,
    pnl: tr.side === "sell" ? (tr.pnlEurSimulated ?? 0) : null,
    pnlPct: tr.side === "sell" ? tr.pnlPctSimulated : null,
    postMovePct24h,
    adviceOutcome,
  };
}

function signalTradeFromEvaluation(
  ev: TickerSimEvaluation,
  at: string,
  simRowByKey: Map<string, Record<string, unknown>>,
  paperPortfolio: PaperPosition[],
  capitalPerTrade: number,
): Trade | null {
  if (ev.suggestedAction !== "hold" && ev.suggestedAction !== "review") return null;
  if (!ev.inPaperPortfolio && ev.suggestedAction === "review") return null;
  const spot = spotUsdFromSimRow(simRowByKey.get(ev.key));
  const pos = paperPortfolio.find((p) => p.key === ev.key);
  const cap = pos?.capital ?? (ev.inPaperPortfolio ? capitalPerTrade : 0);
  const qty = spot != null && spot > 0 && cap > 0 ? Math.round((cap / spot) * 100) / 100 : null;
  return {
    id: `${at}|${ev.key}|${ev.suggestedAction}`,
    date: chartDateLabel(at),
    ticker: ev.ticker,
    action: ev.suggestedAction === "hold" ? "HOLD" : "REVIEW",
    price: spot,
    qty,
    value: cap,
    pnl: null,
    pnlPct: ev.pnlPct ?? ev.pnlPct24h,
  };
}

export type DecisionSimTradePortfolio = {
  trades: Trade[];
  portfolioCurve: PortfolioPoint[];
  /** Deployed capital on open book — for return % in P&L mode. */
  deployedCapitalEur: number;
  valueMode: "pnl";
};

export function buildDecisionSimTradePortfolio(opts: {
  ticks: DecisionSimTick[];
  simTable: SheetTable | null | undefined;
  paperPortfolio: PaperPosition[];
  livePiggy: ExperimentPiggyBank;
  liveEvaluations: TickerSimEvaluation[];
  capitalPerTrade: number;
  maxOpenPositions?: number;
}): DecisionSimTradePortfolio {
  const simRowByKey = buildSimRowByKeyMap(opts.simTable?.rows ?? []);
  const sortedTicks = [...opts.ticks].sort((a, b) => a.at.localeCompare(b.at));

  const cumulative = buildDecisionSimCumulativeSeries(sortedTicks, {
    piggyBank: opts.livePiggy,
    evaluations: opts.liveEvaluations,
    paperPortfolio: opts.paperPortfolio,
    capitalPerTrade: opts.capitalPerTrade,
    maxOpenPositions: opts.maxOpenPositions,
  });

  const portfolioCurve: PortfolioPoint[] = cumulative.map((pt) => ({
    date: pt.atLabel,
    value: pt.totalPnlEur,
    totalPnlEur: pt.totalPnlEur,
  }));

  if (portfolioCurve.length === 0) {
    portfolioCurve.push({
      date: chartDateLabel(new Date().toISOString()),
      value: 0,
      totalPnlEur: 0,
    });
  }

  const paperTrades = flattenDecisionSimTrades(opts.ticks);
  const trades: Trade[] = paperTrades.map((tr) =>
    tradeFromPaperEvent(tr, simRowByKey, opts.liveEvaluations),
  );

  if (trades.length === 0 && opts.paperPortfolio.length > 0) {
    for (const pos of opts.paperPortfolio) {
      const spot = spotUsdFromSimRow(simRowByKey.get(pos.key));
      const qty = spot != null && spot > 0 ? Math.round((pos.capital / spot) * 100) / 100 : null;
      trades.push({
        id: `${pos.entryAt}|${pos.key}|buy`,
        date: chartDateLabel(pos.entryAt),
        ticker: pos.ticker,
        action: "BUY",
        price: spot,
        qty,
        value: pos.capital,
        pnl: null,
        pnlPct: pos.lastMarkPct ?? null,
      });
    }
  }

  const seenSignal = new Set<string>();
  for (const ev of opts.liveEvaluations) {
    if (!ev.inPaperPortfolio) continue;
    if (ev.suggestedAction !== "hold" && ev.suggestedAction !== "review") continue;
    const sig = `${ev.key}|${ev.suggestedAction}`;
    if (seenSignal.has(sig)) continue;
    seenSignal.add(sig);
    const row = signalTradeFromEvaluation(
      ev,
      new Date().toISOString(),
      simRowByKey,
      opts.paperPortfolio,
      opts.capitalPerTrade,
    );
    if (row) trades.push(row);
  }

  trades.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));

  const deployedCapitalEur = Math.max(
    opts.livePiggy.openCapitalEur,
    opts.paperPortfolio.reduce((s, p) => s + (p.capital > 0 ? p.capital : 0), 0),
    opts.capitalPerTrade > 0 ? opts.capitalPerTrade : 0,
  );

  return { trades, portfolioCurve, deployedCapitalEur, valueMode: "pnl" };
}
