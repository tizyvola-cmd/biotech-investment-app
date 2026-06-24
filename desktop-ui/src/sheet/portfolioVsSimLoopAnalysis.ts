import type { ExperimentAdviceEvent, ExperimentScorecard } from "./investDecisionSimExperiment";
import type { PaperPosition } from "./investDecisionSimLoop";
import type { MissedOppPnlDailyWithSim } from "./decisionSimPnlDaily";

function roundEur(n: number): number {
  return Math.round(n * 100) / 100;
}

export type PortfolioVsSimLoopSummary = {
  actualTotalEur: number | null;
  simLoopTotalEur: number | null;
  /** actual − simLoop (positive = portfolio ahead). */
  deltaEur: number | null;
  actualDailyEur: number | null;
  simLoopDailyEur: number | null;
  deltaDailyEur: number | null;
};

export type PortfolioVsSimLoopFactorId =
  | "ahead"
  | "behind"
  | "ra_not_driver"
  | "sim_bad_buys"
  | "sim_missed_buys"
  | "low_overlap"
  | "advice_precision"
  | "executable_aligned";

export type PortfolioVsSimLoopFactor = {
  id: PortfolioVsSimLoopFactorId;
  tone: "good" | "warn" | "info";
  params: Record<string, string>;
};

export type PortfolioVsSimLoopInsight = {
  summary: PortfolioVsSimLoopSummary;
  factors: PortfolioVsSimLoopFactor[];
  portfolioTickerCount: number;
  paperTickerCount: number;
  overlapCount: number;
};

export function summarizePortfolioVsSimLoop(
  pnlActualEur: number | null,
  simLoopTotalEur: number | null,
  dailyWithSim: MissedOppPnlDailyWithSim[],
): PortfolioVsSimLoopSummary {
  const last = dailyWithSim[dailyWithSim.length - 1];
  const actualTotal =
    pnlActualEur != null && Number.isFinite(pnlActualEur)
      ? pnlActualEur
      : last?.dayActual != null
        ? last.dayActual
        : null;
  const simTotal =
    simLoopTotalEur != null && Number.isFinite(simLoopTotalEur)
      ? simLoopTotalEur
      : last?.cumSimLoop != null
        ? last.cumSimLoop
        : null;

  const deltaEur =
    actualTotal != null && simTotal != null ? roundEur(actualTotal - simTotal) : null;

  const actualDaily = last?.deltaActual ?? null;
  const simLoopDaily = last?.daySimLoop ?? null;
  const deltaDailyEur =
    actualDaily != null && simLoopDaily != null ? roundEur(actualDaily - simLoopDaily) : null;

  return {
    actualTotalEur: actualTotal,
    simLoopTotalEur: simTotal,
    deltaEur,
    actualDailyEur: actualDaily,
    simLoopDailyEur: simLoopDaily,
    deltaDailyEur,
  };
}

function tickerSet(positions: PaperPosition[]): Set<string> {
  return new Set(
    positions.map((p) => String(p.ticker ?? "").trim().toUpperCase()).filter(Boolean),
  );
}

export function buildPortfolioVsSimLoopInsight(args: {
  pnlActualEur: number | null;
  simLoopTotalEur: number | null;
  dailyWithSim: MissedOppPnlDailyWithSim[];
  scorecard: ExperimentScorecard;
  paperPortfolio: PaperPosition[];
  portfolioTickers: string[];
  gapVsFairRecToday?: number | null;
}): PortfolioVsSimLoopInsight {
  const summary = summarizePortfolioVsSimLoop(
    args.pnlActualEur,
    args.simLoopTotalEur,
    args.dailyWithSim,
  );

  const realSet = new Set(
    args.portfolioTickers.map((t) => t.trim().toUpperCase()).filter(Boolean),
  );
  const paperSet = tickerSet(args.paperPortfolio);
  let overlapCount = 0;
  for (const t of paperSet) {
    if (realSet.has(t)) overlapCount += 1;
  }

  const factors: PortfolioVsSimLoopFactor[] = [];

  factors.push({
    id: "ra_not_driver",
    tone: "info",
    params: {},
  });

  if (summary.deltaEur != null) {
    if (summary.deltaEur > 5) {
      factors.push({
        id: "ahead",
        tone: "good",
        params: { delta: String(summary.deltaEur) },
      });
    } else if (summary.deltaEur < -5) {
      factors.push({
        id: "behind",
        tone: "warn",
        params: { delta: String(Math.abs(summary.deltaEur)) },
      });
    }
  }

  if (args.scorecard.badBuyCount > 0) {
    factors.push({
      id: "sim_bad_buys",
      tone: "warn",
      params: { n: String(args.scorecard.badBuyCount) },
    });
  }

  if (args.scorecard.missedBuyCount > 0) {
    factors.push({
      id: "sim_missed_buys",
      tone: "info",
      params: {
        n: String(args.scorecard.missedBuyCount),
        eur: String(Math.round(args.scorecard.missedBuyEurEst)),
      },
    });
  }

  if (paperSet.size > 0 && overlapCount < Math.min(realSet.size, paperSet.size)) {
    factors.push({
      id: "low_overlap",
      tone: "info",
      params: {
        overlap: String(overlapCount),
        paperN: String(paperSet.size),
        realN: String(realSet.size),
      },
    });
  }

  if (args.scorecard.advicePrecisionPct != null) {
    factors.push({
      id: "advice_precision",
      tone: args.scorecard.advicePrecisionPct >= 55 ? "good" : "warn",
      params: { pct: String(args.scorecard.advicePrecisionPct) },
    });
  }

  if (args.gapVsFairRecToday != null && args.gapVsFairRecToday <= 0) {
    factors.push({
      id: "executable_aligned",
      tone: "good",
      params: {
        gap: String(Math.abs(args.gapVsFairRecToday)),
      },
    });
  }

  return {
    summary,
    factors,
    portfolioTickerCount: realSet.size,
    paperTickerCount: paperSet.size,
    overlapCount,
  };
}

/** Recent closed advice events for optional detail table. */
export function recentAdviceEvents(
  adviceLog: ExperimentAdviceEvent[],
  limit = 8,
): ExperimentAdviceEvent[] {
  return [...adviceLog].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
