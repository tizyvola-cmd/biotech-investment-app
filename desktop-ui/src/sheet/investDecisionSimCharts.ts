import type { ExperimentPiggyBank } from "./investDecisionSimExperiment";
import { sanitizePaperMovePct } from "./investDecisionSimExperiment";
import { resolvePaperTotalPnlEur } from "./decisionSimPnlResolve";
export { resolvePaperTotalPnlEur } from "./decisionSimPnlResolve";
import {
  resolveTickClosedPnlEur,
  sanitizeDecisionSimTimeSeries,
  sanitizeLiveExperimentPiggy,
} from "./decisionSimPnlResolve";
import type {
  DecisionSimTick,
  PaperPosition,
  PaperTradeEvent,
  TickerSimEvaluation,
} from "./investDecisionSimLoop";
import { MISSED_OPP_CAPITAL_EUR, pnlEurFrom24hPct } from "./missedOpportunityAudit";
import { computeFairRecs24hFromEvaluations } from "./missedOpportunityFairRecs";
import { DECISION_SIM_MARKET_TZ } from "./investDecisionSimSchedule";

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Default slot count when maxOpenPositions is unlimited (JSON stores Infinity as null). */
export const SIM_LOOP_DISPLAY_MAX_SLOTS = 12;

/** Pot for Weight Sim Exp / synth curves: capPerTrade × finite max slots. */
export function resolveSimLoopCapitalPot(
  capitalPerTrade: number,
  maxOpenPositions: number,
): number {
  const perTrade =
    Number.isFinite(capitalPerTrade) && capitalPerTrade > 0 ? capitalPerTrade : 5000;
  const slots =
    Number.isFinite(maxOpenPositions) &&
    maxOpenPositions > 0 &&
    maxOpenPositions < 1_000_000
      ? maxOpenPositions
      : SIM_LOOP_DISPLAY_MAX_SLOTS;
  return Math.max(1, Math.round(perTrade * slots));
}

/** Etichetta asse X: MM-DD HH:mm (Europe/Rome — allineata al pannello Decision Lab). */
export function formatDecisionSimChartTime(iso: string): string {
  if (!iso?.trim()) return "—";
  try {
    const normalized = iso.includes("T") ? iso : iso.replace(" ", "T");
    const d = new Date(normalized);
    if (!Number.isFinite(d.getTime())) return iso;
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: DECISION_SIM_MARKET_TZ,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(d);
    const pick = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "";
    return `${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
  } catch {
    return iso;
  }
}

export type DecisionSimCumulativePoint = {
  at: string;
  atLabel: string;
  /** MTM totale paper (aperto + chiuso). */
  totalPnlEur: number;
  openMtmEur: number;
  closedPnlEur: number;
  /** Somma P&L realizzato sui soli SELL. */
  cumulativeRealizedEur: number;
  /** Stesso calcolo del grafico viola Performance: Σ Var.24h × €5k su BUY + portafoglio reale. */
  recs24hHypotheticalEur: number;
  /** Cap max 8, capitale paper/reale, Enter eseguibili — confronto equo multi-giorno. */
  fairRecs24hEur: number;
  /** Somma progressiva fairRecs24hEur sui tick (backtest «se avessi seguito tutto»). */
  cumulativeFairRecs24hEur: number;
  isLive?: boolean;
};

/** Stesso universo di `computeMissedOppDailyPnl` (suggested off-portfolio BUY + real portfolio). */
export function isInRecs24hUniverse(ev: Pick<TickerSimEvaluation, "hasPosition" | "suggestedAction">): boolean {
  if (ev.hasPosition) return true;
  return ev.suggestedAction === "buy";
}

/** Ipotesi «100% raccomandazioni»: solo movimento Var. Giorn. % × capitale fisso. */
export function computeRecs24hHypotheticalPnl(
  evaluations: TickerSimEvaluation[],
  capitalEur = MISSED_OPP_CAPITAL_EUR,
): number {
  let sum = 0;
  for (const ev of evaluations) {
    if (!isInRecs24hUniverse(ev)) continue;
    if (ev.pnlPct24h == null || !Number.isFinite(ev.pnlPct24h)) continue;
    sum += pnlEurFrom24hPct(capitalEur, ev.pnlPct24h);
  }
  return Math.round(sum);
}

export type DecisionSimTradeChartPoint = {
  id: string;
  at: string;
  atLabel: string;
  /** Etichetta compatta asse X. */
  label: string;
  ticker: string;
  side: "buy" | "sell";
  /** P&L al momento dell'operazione (0 su BUY). */
  pnlEur: number;
  pnlPct: number | null;
  capital: number;
  /** P&L realizzato cumulato dopo questa operazione. */
  cumRealizedEur: number;
  /** MTM attuale se BUY ancora aperto (solo informativo tooltip). */
  openMtmEur?: number | null;
  /** Barra SELL (null su BUY). */
  sellBarEur: number | null;
  /** Marker visibile ingresso BUY sull'asse 0 (null su SELL). */
  buyMarkerY: number | null;
  /** Ricostruito da portfolio quando manca lo storico trade. */
  fromPortfolioFallback?: boolean;
};

export type DecisionSimTradeChartSummary = {
  buyCount: number;
  sellCount: number;
  hasOpenMtmOnly: boolean;
};

export function summarizeDecisionSimTradeChart(
  points: DecisionSimTradeChartPoint[],
): DecisionSimTradeChartSummary {
  let buyCount = 0;
  let sellCount = 0;
  for (const p of points) {
    if (p.side === "buy") buyCount += 1;
    else sellCount += 1;
  }
  return {
    buyCount,
    sellCount,
    hasOpenMtmOnly: buyCount > 0 && sellCount === 0,
  };
}

export function sumClosedPnlFromTicks(ticks: DecisionSimTick[]): number {
  let sum = 0;
  for (const tk of ticks) {
    for (const tr of tk.trades) {
      if (tr.side === "sell" && tr.pnlEurSimulated != null) {
        sum += tr.pnlEurSimulated;
      }
    }
  }
  return roundEur(sum);
}

export function flattenDecisionSimTrades(ticks: DecisionSimTick[]): PaperTradeEvent[] {
  return [...ticks]
    .sort((a, b) => a.at.localeCompare(b.at))
    .flatMap((tk) => tk.trades);
}

/** Curva cumulativa gain/loss paper — un punto per tick + opzionale live. */
export function buildDecisionSimCumulativeSeries(
  ticks: DecisionSimTick[],
  live?: {
    piggyBank: ExperimentPiggyBank;
    atLabel?: string;
    evaluations?: TickerSimEvaluation[];
    paperPortfolio?: PaperPosition[];
    capitalPerTrade?: number;
    maxOpenPositions?: number;
  } | null,
  recsCapitalEur = MISSED_OPP_CAPITAL_EUR,
): DecisionSimCumulativePoint[] {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  let cumRealized = 0;
  let cumFairRecs = 0;
  const points: DecisionSimCumulativePoint[] = [];
  const capitalPerTrade = live?.capitalPerTrade ?? recsCapitalEur;
  const maxOpen = live?.maxOpenPositions;

  for (const tk of sorted) {
    for (const tr of tk.trades) {
      if (tr.side === "sell" && tr.pnlEurSimulated != null) {
        cumRealized += tr.pnlEurSimulated;
      }
    }
    cumRealized = roundEur(cumRealized);
    const piggy = tk.summary.piggyBank;
    const closedPnlEur = resolveTickClosedPnlEur(cumRealized, piggy);
    const totalPnlEur = resolvePaperTotalPnlEur(
      cumRealized,
      tk.portfolioAfter,
      tk.evaluations,
      piggy,
    );
    const openMtm = roundEur(totalPnlEur - closedPnlEur);
    const fairDaily =
      tk.summary.fairRecs24hEur ??
      computeFairRecs24hFromEvaluations(tk.evaluations, tk.portfolioAfter, {
        capitalPerTrade,
        maxOpenPositions: maxOpen,
      });
    cumFairRecs = roundEur(cumFairRecs + fairDaily);
    points.push({
      at: tk.at,
      atLabel: formatDecisionSimChartTime(tk.at),
      totalPnlEur,
      openMtmEur: openMtm,
      closedPnlEur,
      cumulativeRealizedEur: cumRealized,
      recs24hHypotheticalEur:
        tk.summary.recs24hHypotheticalEur ??
        computeRecs24hHypotheticalPnl(tk.evaluations, recsCapitalEur),
      fairRecs24hEur: fairDaily,
      cumulativeFairRecs24hEur: cumFairRecs,
    });
  }

  if (live?.piggyBank) {
    const paper = live.paperPortfolio ?? [];
    const livePiggy = sanitizeLiveExperimentPiggy(live.piggyBank, cumRealized).piggy;
    const closedPnlEur = roundEur(livePiggy.closedPnlEur);
    const openMtm = roundEur(livePiggy.openMtmPnlEur);
    const totalPnlEur = roundEur(livePiggy.totalPnlEur);
    const fairDaily = live.evaluations
      ? computeFairRecs24hFromEvaluations(live.evaluations, paper, {
          capitalPerTrade,
          maxOpenPositions: maxOpen,
        })
      : 0;
    cumFairRecs = roundEur(cumFairRecs + fairDaily);
    points.push({
      at: new Date().toISOString(),
      atLabel: live.atLabel ?? "· now",
      totalPnlEur,
      openMtmEur: openMtm,
      closedPnlEur,
      cumulativeRealizedEur: closedPnlEur,
      recs24hHypotheticalEur: live.evaluations
        ? computeRecs24hHypotheticalPnl(live.evaluations, recsCapitalEur)
        : 0,
      fairRecs24hEur: fairDaily,
      cumulativeFairRecs24hEur: cumFairRecs,
      isLive: true,
    });
  }

  return sanitizeDecisionSimTimeSeries(points);
}

function openMtmForPosition(
  pos: Pick<PaperPosition, "key" | "capital" | "lastMarkPct">,
  openEvalByKey?: Map<string, Pick<TickerSimEvaluation, "pnlPct" | "pnlPct24h">>,
): number | null {
  const ev = openEvalByKey?.get(pos.key);
  const pct =
    sanitizePaperMovePct(ev?.pnlPct) ??
    sanitizePaperMovePct(ev?.pnlPct24h) ??
    sanitizePaperMovePct(pos.lastMarkPct) ??
    null;
  if (pct == null) return null;
  return roundEur((pos.capital * pct) / 100);
}

function buildBuyTradeChartPoint(
  tr: Pick<PaperTradeEvent, "at" | "ticker" | "key" | "capital">,
  cumRealized: number,
  openMtm: number | null,
  fromPortfolioFallback = false,
): DecisionSimTradeChartPoint {
  const atLabel = formatDecisionSimChartTime(tr.at);
  return {
    id: `${tr.at}|${tr.key}|buy`,
    at: tr.at,
    atLabel,
    label: `${atLabel} · ${tr.ticker}`,
    ticker: tr.ticker,
    side: "buy",
    pnlEur: 0,
    pnlPct: null,
    capital: tr.capital,
    cumRealizedEur: cumRealized,
    openMtmEur: openMtm,
    sellBarEur: null,
    buyMarkerY: 0,
    fromPortfolioFallback,
  };
}

function buildSellTradeChartPoint(
  tr: PaperTradeEvent,
  cumRealized: number,
): DecisionSimTradeChartPoint {
  const pnl = tr.pnlEurSimulated ?? 0;
  const atLabel = formatDecisionSimChartTime(tr.at);
  return {
    id: `${tr.at}|${tr.key}|sell`,
    at: tr.at,
    atLabel,
    label: `${atLabel} · ${tr.ticker}`,
    ticker: tr.ticker,
    side: "sell",
    pnlEur: roundEur(pnl),
    pnlPct: tr.pnlPctSimulated,
    capital: tr.capital,
    cumRealizedEur: cumRealized,
    sellBarEur: roundEur(pnl),
    buyMarkerY: null,
  };
}

/** Timeline operazioni BUY/SELL con P&L al momento del trade. */
export function buildDecisionSimTradeChartSeries(
  ticks: DecisionSimTick[],
  openEvalByKey?: Map<string, Pick<TickerSimEvaluation, "pnlPct" | "pnlPct24h">>,
  portfolioFallback?: PaperPosition[],
): DecisionSimTradeChartPoint[] {
  const trades = flattenDecisionSimTrades(ticks);
  const openKeys = new Set<string>();
  let cumRealized = 0;
  const out: DecisionSimTradeChartPoint[] = [];

  for (const tr of trades) {
    if (tr.side === "sell") {
      const pnl = tr.pnlEurSimulated ?? 0;
      cumRealized = roundEur(cumRealized + pnl);
      openKeys.delete(tr.key);
      out.push(buildSellTradeChartPoint(tr, cumRealized));
    } else {
      openKeys.add(tr.key);
      const openMtm = openKeys.has(tr.key)
        ? openMtmForPosition({ key: tr.key, capital: tr.capital, lastMarkPct: null }, openEvalByKey)
        : null;
      out.push(buildBuyTradeChartPoint(tr, cumRealized, openMtm));
    }
  }

  if (out.length > 0) return out;

  if (!portfolioFallback?.length) return [];

  return [...portfolioFallback]
    .sort((a, b) => a.entryAt.localeCompare(b.entryAt))
    .map((pos) =>
      buildBuyTradeChartPoint(
        {
          at: pos.entryAt,
          ticker: pos.ticker,
          key: pos.key,
          capital: pos.capital,
        },
        0,
        openMtmForPosition(pos, openEvalByKey),
        true,
      ),
    );
}
