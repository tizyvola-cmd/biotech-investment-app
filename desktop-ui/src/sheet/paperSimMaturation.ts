/**
 * Deal paper chiusi (SELL) e curva di maturazione P&L nel tempo.
 */
import {
  openPaperMtmFromPortfolio,
  sanitizePaperMovePct,
  type ExperimentPiggyBank,
} from "./investDecisionSimExperiment";
import type { DecisionSimTick, PaperPosition, TickerSimEvaluation } from "./investDecisionSimLoop";
import { formatDecisionSimChartTime, resolvePaperTotalPnlEur } from "./investDecisionSimCharts";
import {
  resolveMaturationOpenMtmEur,
  resolveTickClosedPnlEur,
  sanitizeDecisionSimTimeSeries,
  sanitizeLiveExperimentPiggy,
} from "./decisionSimPnlResolve";

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundPct(n: number): number {
  return Math.round(n * 100) / 100;
}

function holdDaysBetween(entryAt: string, exitAt: string): number {
  const a = Date.parse(entryAt);
  const b = Date.parse(exitAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type PaperClosedDeal = {
  key: string;
  ticker: string;
  entryAt: string;
  exitAt: string;
  holdDays: number;
  capitalEur: number;
  pnlEur: number;
  pnlPct: number | null;
  entryProbPct: number | null;
};

export type PaperClosedPiggySummary = {
  rawPnlEur: number;
  capitalEur: number;
  dealCount: number;
  tickers: string[];
  deals: PaperClosedDeal[];
  winCount: number;
  lossCount: number;
};

/** Deal paper venduti e maturati — P&L realizzato al SELL. */
export function summarizePaperClosedDeals(ticks: DecisionSimTick[]): PaperClosedPiggySummary {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  const deals: PaperClosedDeal[] = [];

  for (const tk of sorted) {
    for (const tr of tk.trades) {
      if (tr.side !== "sell") continue;
      const entryPos = tk.portfolioBefore.find((p) => p.key === tr.key);
      const pnlEur = tr.pnlEurSimulated ?? 0;
      deals.push({
        key: tr.key,
        ticker: tr.ticker,
        entryAt: entryPos?.entryAt ?? tr.at,
        exitAt: tr.at,
        holdDays: holdDaysBetween(entryPos?.entryAt ?? tr.at, tr.at),
        capitalEur: tr.capital ?? entryPos?.capital ?? 0,
        pnlEur: roundEur(pnlEur),
        pnlPct: tr.pnlPctSimulated,
        entryProbPct: entryPos?.entryProbPct ?? null,
      });
    }
  }

  const rawPnlEur = roundEur(deals.reduce((s, d) => s + d.pnlEur, 0));
  const capitalEur = roundEur(deals.reduce((s, d) => s + d.capitalEur, 0));
  let winCount = 0;
  let lossCount = 0;
  for (const d of deals) {
    if (d.pnlEur > 0) winCount += 1;
    else if (d.pnlEur < 0) lossCount += 1;
  }

  return {
    rawPnlEur,
    capitalEur,
    dealCount: deals.length,
    tickers: deals.map((d) => d.ticker),
    deals,
    winCount,
    lossCount,
  };
}

export type PaperMaturationPoint = {
  at: string;
  atLabel: string;
  /** P&L realizzato cumulato — solo deal chiusi. */
  closedPnlEur: number;
  /** MTM posizioni ancora aperte. */
  openMtmEur: number;
  /** closed + open. */
  totalPnlEur: number;
  closedDealCount: number;
  /** Media P&L % posizioni aperte in questo tick. */
  avgOpenPnlPct: number | null;
  /** Evento SELL in questo tick (se presente). */
  sellTicker?: string;
  sellPnlEur?: number;
  isLive?: boolean;
};

function openMtmForPortfolio(
  portfolio: PaperPosition[],
  evaluations: TickerSimEvaluation[],
): { openMtmEur: number; avgOpenPnlPct: number | null } {
  if (!portfolio.length) return { openMtmEur: 0, avgOpenPnlPct: null };
  const byKey = new Map(evaluations.map((e) => [e.key, e]));
  let pctSum = 0;
  let pctN = 0;
  for (const pos of portfolio) {
    const cap = pos.capital ?? 0;
    if (!Number.isFinite(cap) || cap <= 0) continue;
    const ev = byKey.get(pos.key);
    const pct =
      sanitizePaperMovePct(ev?.pnlPct) ??
      sanitizePaperMovePct(pos.lastMarkPct) ??
      sanitizePaperMovePct(ev?.pnlPct24h) ??
      null;
    if (pct != null) {
      pctSum += pct;
      pctN += 1;
    }
  }
  return {
    openMtmEur: openPaperMtmFromPortfolio(portfolio, evaluations),
    avgOpenPnlPct: pctN > 0 ? roundPct(pctSum / pctN) : null,
  };
}

function resolveMaturationClosedPnl(cumClosed: number, piggy?: ExperimentPiggyBank | null): number {
  return resolveTickClosedPnlEur(cumClosed, piggy);
}

/** Curva maturazione piggy: chiuso vs aperto nel tempo (un punto per tick). */
export function buildPaperMaturationSeries(
  ticks: DecisionSimTick[],
  live?: {
    piggyBank: ExperimentPiggyBank;
    evaluations?: TickerSimEvaluation[];
    paperPortfolio?: PaperPosition[];
    atLabel?: string;
  } | null,
): PaperMaturationPoint[] {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  let cumClosed = 0;
  let closedDealCount = 0;
  const points: PaperMaturationPoint[] = [];

  for (const tk of sorted) {
    let sellTicker: string | undefined;
    let sellPnlEur: number | undefined;
    for (const tr of tk.trades) {
      if (tr.side === "sell") {
        closedDealCount += 1;
        const pnl = tr.pnlEurSimulated ?? 0;
        cumClosed = roundEur(cumClosed + pnl);
        sellTicker = tr.ticker;
        sellPnlEur = roundEur(pnl);
      }
    }

    const piggy = tk.summary.piggyBank;
    const closedPnlEur = resolveMaturationClosedPnl(cumClosed, piggy);
    const openMtm = resolveMaturationOpenMtmEur(tk.portfolioAfter, tk.evaluations, piggy);
    const totalPnlEur = resolvePaperTotalPnlEur(
      cumClosed,
      tk.portfolioAfter,
      tk.evaluations,
      piggy,
    );
    const { avgOpenPnlPct } = openMtmForPortfolio(tk.portfolioAfter, tk.evaluations);

    points.push({
      at: tk.at,
      atLabel: formatDecisionSimChartTime(tk.at),
      closedPnlEur,
      openMtmEur: openMtm,
      totalPnlEur,
      closedDealCount,
      avgOpenPnlPct,
      sellTicker,
      sellPnlEur,
    });
  }

  if (live?.piggyBank) {
    const paper = live.paperPortfolio ?? [];
    const evals = live.evaluations ?? [];
    const { avgOpenPnlPct } = evals.length
      ? openMtmForPortfolio(paper, evals)
      : { avgOpenPnlPct: null };
    const livePiggy = sanitizeLiveExperimentPiggy(live.piggyBank, cumClosed).piggy;
    const closedPnlEur = roundEur(livePiggy.closedPnlEur);
    const openMtmEur = roundEur(livePiggy.openMtmPnlEur);
    points.push({
      at: new Date().toISOString(),
      atLabel: live.atLabel ?? "· now",
      closedPnlEur,
      openMtmEur,
      totalPnlEur: roundEur(livePiggy.totalPnlEur),
      closedDealCount: livePiggy.closedTradeCount,
      avgOpenPnlPct,
      isLive: true,
    });
  }

  return sanitizeDecisionSimTimeSeries(points);
}

function calendarDayKey(iso: string): string {
  if (!iso?.trim()) return "—";
  const d = iso.includes("T") ? iso : iso.replace(" ", "T");
  return d.slice(0, 10);
}

/** Etichetta compatta asse X — solo giorno o · now. */
export function maturationAxisShortLabel(p: Pick<PaperMaturationPoint, "at" | "atLabel" | "isLive">): string {
  if (p.isLive) return "· now";
  const day = calendarDayKey(p.at);
  if (day.length >= 10) return day.slice(5); // MM-DD
  return p.atLabel.slice(0, 5);
}

/**
 * Riduce i punti per il grafico: un campione per giorno + SELL + live.
 * Evita assi X affollati quando ci sono molti tick nello stesso giorno.
 */
export function compressPaperMaturationSeries(
  points: PaperMaturationPoint[],
  maxPoints = 14,
): PaperMaturationPoint[] {
  if (points.length <= 1) return points;

  const mustKeep = new Set<number>();
  mustKeep.add(0);
  mustKeep.add(points.length - 1);

  points.forEach((p, i) => {
    if (p.sellTicker || p.isLive) mustKeep.add(i);
  });

  const lastIdxByDay = new Map<string, number>();
  points.forEach((p, i) => {
    if (p.isLive) return;
    lastIdxByDay.set(calendarDayKey(p.at), i);
  });
  for (const idx of lastIdxByDay.values()) mustKeep.add(idx);

  let kept = [...mustKeep].sort((a, b) => a - b).map((i) => points[i]!);
  if (kept.length <= maxPoints) return kept;

  const locked = new Set<number>();
  for (const idx of mustKeep) {
    const p = points[idx]!;
    if (idx === 0 || idx === points.length - 1 || p.sellTicker || p.isLive) locked.add(idx);
  }
  const flex = [...mustKeep].filter((i) => !locked.has(i)).sort((a, b) => a - b);
  const budget = Math.max(0, maxPoints - locked.size);
  const step = Math.max(1, Math.ceil(flex.length / Math.max(1, budget)));
  const pickedFlex = flex.filter((_, i) => i % step === 0).slice(0, budget);
  const finalIndices = [...locked, ...pickedFlex].sort((a, b) => a - b);
  return finalIndices.map((i) => points[i]!);
}

export type PaperMaturationChartPoint = PaperMaturationPoint & {
  xIdx: number;
  xShort: string;
};

export function preparePaperMaturationChartData(
  points: PaperMaturationPoint[],
): PaperMaturationChartPoint[] {
  return compressPaperMaturationSeries(points).map((p, i) => ({
    ...p,
    xIdx: i,
    xShort: maturationAxisShortLabel(p),
  }));
}

/** Indici tick visibili sull'asse X (max 5 etichette). */
export function maturationChartTickIndices(count: number): number[] {
  if (count <= 0) return [];
  if (count <= 5) return Array.from({ length: count }, (_, i) => i);
  const step = Math.max(1, Math.floor((count - 1) / 4));
  const ticks = new Set<number>([0, count - 1]);
  for (let i = step; i < count - 1; i += step) ticks.add(i);
  return [...ticks].sort((a, b) => a - b);
}

/** Campioni per maturazione % media posizioni aperte (asse tempo). */
export type PaperOpenMaturationPoint = {
  atLabel: string;
  avgOpenPnlPct: number;
  openCount: number;
};

export function buildPaperOpenMaturationPctSeries(ticks: DecisionSimTick[]): PaperOpenMaturationPoint[] {
  const sorted = [...ticks].sort((a, b) => a.at.localeCompare(b.at));
  const out: PaperOpenMaturationPoint[] = [];
  for (const tk of sorted) {
    const { avgOpenPnlPct } = openMtmForPortfolio(tk.portfolioAfter, tk.evaluations);
    if (avgOpenPnlPct == null || tk.portfolioAfter.length === 0) continue;
    out.push({
      atLabel: formatDecisionSimChartTime(tk.at),
      avgOpenPnlPct,
      openCount: tk.portfolioAfter.length,
    });
  }
  return out;
}
