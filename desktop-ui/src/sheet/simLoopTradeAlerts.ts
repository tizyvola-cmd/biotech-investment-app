import type { ChartPoint, SheetTable } from "../types";
import type {
  DecisionSimTick,
  PaperTradeEvent,
  TickerSimEvaluation,
} from "./investDecisionSimLoop";
import { explainBuyReason, explainSellReason } from "./investDecisionSimLoop";
import {
  buildLossAnalysisItems,
  type LossAnalysisProbOptions,
  type PortfolioLossAnalysisItem,
} from "./portfolioLossAnalysis";
import type { InvestSimInputs } from "./investSimStorage";

export const SIM_LOOP_TRADE_ALERT_EVENT = "supernova:sim-loop-trade-alert";

export type SimLoopTradeAlert = {
  key: string;
  ticker: string;
  completionDate: string;
  side: "buy" | "sell";
  at: string;
  commandLabel: string;
  recommendation: string;
  detail: string;
  capital: number | null;
  pnlEur: number | null;
  pnlPct: number | null;
  /** Open Simulation portfolio position (capital > 0), not paper sim loop. */
  inRealPortfolio: boolean;
};

export type SimLoopTradeAlertBatch = {
  tickId: string;
  at: string;
  alerts: SimLoopTradeAlert[];
  /** True while trades wait for the response window before execution. */
  pending?: boolean;
  executeAfter?: string | null;
};

export function completionDateFromRowKey(key: string): string {
  const sep = key.indexOf("|");
  return sep >= 0 ? key.slice(sep + 1) : "—";
}

function buildItemsByKey(
  simTable: SheetTable,
  inputs: InvestSimInputs,
  pointsBySeriesKey: Map<string, ChartPoint[]>,
  lang: "it" | "en",
  probOptions: LossAnalysisProbOptions | null,
): Map<string, PortfolioLossAnalysisItem> {
  const portfolio = buildLossAnalysisItems(
    "portfolio",
    simTable,
    inputs,
    pointsBySeriesKey,
    lang,
    null,
    probOptions,
  );
  const opp = buildLossAnalysisItems(
    "opportunities",
    simTable,
    inputs,
    pointsBySeriesKey,
    lang,
    null,
    probOptions,
    "watch",
  );
  const byKey = new Map<string, PortfolioLossAnalysisItem>();
  for (const it of [...portfolio, ...opp]) byKey.set(it.key, it);
  return byKey;
}

function recommendationForTrade(
  trade: PaperTradeEvent,
  ev: TickerSimEvaluation | undefined,
  item: PortfolioLossAnalysisItem | null,
  lang: "it" | "en",
): { recommendation: string; detail: string } {
  const it = lang === "it";
  const commandLabel = trade.side === "buy" ? "BUY" : "SELL";

  if (item) {
    const explained =
      trade.side === "buy"
        ? explainBuyReason(item, true, lang)
        : explainSellReason(item, true, lang);
    if (explained) {
      return {
        recommendation: `${commandLabel} · ${explained}`,
        detail: trade.reason,
      };
    }
  }

  const parts: string[] = [commandLabel];
  if (ev?.probPct != null && Number.isFinite(ev.probPct)) {
    parts.push(`${it ? "P(plan)" : "P(plan)"} ${ev.probPct.toFixed(0)}%`);
  }
  if (ev?.planReturnPct != null && Number.isFinite(ev.planReturnPct)) {
    parts.push(
      `${it ? "ROI atteso" : "Plan ROI"} ${ev.planReturnPct >= 0 ? "+" : ""}${ev.planReturnPct.toFixed(1)}%`,
    );
  }
  if (ev?.misalignmentLabels?.length) {
    parts.push(ev.misalignmentLabels.slice(0, 2).join(" · "));
  }
  parts.push(trade.reason);

  return {
    recommendation: parts.filter(Boolean).join(" · "),
    detail:
      ev?.exitReason?.trim() ||
      (trade.side === "sell" && trade.pnlEurSimulated != null
        ? `${it ? "P&L sim" : "Sim P&L"} ${trade.pnlEurSimulated >= 0 ? "+" : ""}${Math.round(trade.pnlEurSimulated)} €`
        : trade.reason),
  };
}

function isInRealPortfolio(
  key: string,
  item: PortfolioLossAnalysisItem | null,
  ev: TickerSimEvaluation | undefined,
  inputs?: InvestSimInputs,
): boolean {
  if (item?.hasPosition === true || ev?.hasPosition === true) return true;
  const entry = inputs?.[key];
  return entry != null && Number.isFinite(entry.capital) && entry.capital > 0;
}

export function buildSimLoopTradeAlertsFromTick(
  tick: DecisionSimTick,
  lang: "it" | "en",
  itemsByKey?: Map<string, PortfolioLossAnalysisItem>,
  inputs?: InvestSimInputs,
  previewTrades?: PaperTradeEvent[],
): SimLoopTradeAlert[] {
  const evalByKey = new Map(tick.evaluations.map((e) => [e.key, e]));
  const out: SimLoopTradeAlert[] = [];
  const trades = previewTrades?.length ? previewTrades : tick.trades;

  for (const trade of trades) {
    if (trade.side !== "buy" && trade.side !== "sell") continue;
    const ev = evalByKey.get(trade.key);
    const item = itemsByKey?.get(trade.key) ?? null;
    const { recommendation, detail } = recommendationForTrade(trade, ev, item, lang);

    out.push({
      key: trade.key,
      ticker: trade.ticker,
      completionDate: completionDateFromRowKey(trade.key),
      side: trade.side,
      at: trade.at,
      commandLabel: trade.side === "buy" ? "BUY" : "SELL",
      recommendation,
      detail,
      capital: trade.side === "buy" ? trade.capital : null,
      pnlEur: trade.pnlEurSimulated,
      pnlPct: trade.pnlPctSimulated,
      inRealPortfolio: isInRealPortfolio(trade.key, item, ev, inputs),
    });
  }

  return out;
}

export function publishSimLoopTradeAlerts(
  tick: DecisionSimTick,
  opts: {
    lang: "it" | "en";
    simTable?: SheetTable | null;
    inputs?: InvestSimInputs;
    pointsBySeriesKey?: Map<string, ChartPoint[]>;
    probOptions?: LossAnalysisProbOptions | null;
    pending?: boolean;
    executeAfter?: string | null;
    previewTrades?: PaperTradeEvent[];
  },
): void {
  if (typeof window === "undefined") return;

  let itemsByKey: Map<string, PortfolioLossAnalysisItem> | undefined;
  if (opts.simTable?.rows?.length && opts.inputs && opts.pointsBySeriesKey) {
    itemsByKey = buildItemsByKey(
      opts.simTable,
      opts.inputs,
      opts.pointsBySeriesKey,
      opts.lang,
      opts.probOptions ?? null,
    );
  }

  const alerts = buildSimLoopTradeAlertsFromTick(
    tick,
    opts.lang,
    itemsByKey,
    opts.inputs,
    opts.previewTrades,
  );
  if (!alerts.length) return;

  const batch: SimLoopTradeAlertBatch = {
    tickId: tick.id,
    at: tick.at,
    alerts,
    pending: opts.pending ?? false,
    executeAfter: opts.executeAfter ?? null,
  };

  window.dispatchEvent(
    new CustomEvent(SIM_LOOP_TRADE_ALERT_EVENT, { detail: batch }),
  );
}
