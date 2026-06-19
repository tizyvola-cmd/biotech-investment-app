/**
 * KPI complementari al «Successo consigli» (direzione 24h):
 * capture vs raccomandazioni, P&L round-trip paper, rendimento book.
 */
import type { AdviceCalibrationSummary } from "./investDecisionSimAdviceCalibration";
import type { ExperimentPiggyBank } from "./investDecisionSimExperiment";
import type { PaperClosedPiggySummary } from "./paperSimMaturation";
import type { UnifiedAdviceSuccess } from "./unifiedAdviceSuccess";

export type AdviceCaptureKpi = {
  capturePct: number | null;
  actualEur: number;
  potentialEur: number;
};

export type AdviceClosedPnlKpi = {
  winRatePct: number | null;
  winCount: number;
  lossCount: number;
  dealCount: number;
  rawPnlEur: number;
};

export type AdvicePaperReturnKpi = {
  returnPct: number | null;
  totalPnlEur: number;
  bookEur: number;
};

export type AdviceComplementKpis = {
  direction24hPct: number | null;
  direction24hSource: UnifiedAdviceSuccess["primarySource"];
  direction24hScored: number;
  capture: AdviceCaptureKpi;
  closedPnl: AdviceClosedPnlKpi;
  paperReturn: AdvicePaperReturnKpi;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundEur(n: number): number {
  return Math.round(n);
}

/** P&L potenziale 24h su raccomandazioni eseguibili (BUY/SELL/paper) vs P&L paper reale. */
export function computePaperRecCapture(args: {
  monitorRows: Array<{
    suggestedAction: string;
    inPaperPortfolio?: boolean;
    pnlPct24h?: number | null;
  }>;
  capitalPerTrade: number;
  actualPnlEur: number;
}): AdviceCaptureKpi {
  let potential = 0;
  for (const row of args.monitorRows) {
    const pct = row.pnlPct24h;
    if (pct == null || !Number.isFinite(pct)) continue;
    const act = row.suggestedAction;
    const executable =
      Boolean(row.inPaperPortfolio) || act === "buy" || act === "sell";
    if (!executable) continue;
    potential += (args.capitalPerTrade * pct) / 100;
  }
  const potentialEur = roundEur(potential);
  const actualEur = roundEur(args.actualPnlEur);
  let capturePct =
    potentialEur !== 0 ? round1((actualEur / potentialEur) * 100) : null;
  if (
    capturePct != null &&
    potentialEur > 0 &&
    potentialEur < 20_000 &&
    Math.abs(capturePct) > 300 &&
    Math.abs(actualEur) > potentialEur * 2.5
  ) {
    capturePct = null;
  }
  return { capturePct, potentialEur, actualEur };
}

export function summarizeClosedPnlAdvice(
  closed: PaperClosedPiggySummary,
): AdviceClosedPnlKpi {
  const scored = closed.winCount + closed.lossCount;
  return {
    winRatePct:
      scored > 0 ? round1((closed.winCount / scored) * 100) : null,
    winCount: closed.winCount,
    lossCount: closed.lossCount,
    dealCount: closed.dealCount,
    rawPnlEur: closed.rawPnlEur,
  };
}

export function computePaperReturnKpi(
  livePiggy: ExperimentPiggyBank,
  closed: PaperClosedPiggySummary,
): AdvicePaperReturnKpi {
  const bookEur = roundEur(livePiggy.openCapitalEur + closed.capitalEur);
  const totalPnlEur = roundEur(livePiggy.totalPnlEur);
  const returnPct =
    bookEur > 0 ? round1((totalPnlEur / bookEur) * 100) : null;
  return { returnPct, totalPnlEur, bookEur };
}

export function buildAdviceComplementKpis(args: {
  unified: UnifiedAdviceSuccess;
  liveAdvice: AdviceCalibrationSummary;
  monitorRows: Array<{
    suggestedAction: string;
    inPaperPortfolio?: boolean;
    pnlPct24h?: number | null;
  }>;
  capitalPerTrade: number;
  livePiggy: ExperimentPiggyBank;
  closedPiggy: PaperClosedPiggySummary;
}): AdviceComplementKpis {
  return {
    direction24hPct: args.unified.headlinePct,
    direction24hSource: args.unified.primarySource,
    direction24hScored: args.liveAdvice.scoredCount,
    capture: computePaperRecCapture({
      monitorRows: args.monitorRows,
      capitalPerTrade: args.capitalPerTrade,
      actualPnlEur: args.livePiggy.totalPnlEur,
    }),
    closedPnl: summarizeClosedPnlAdvice(args.closedPiggy),
    paperReturn: computePaperReturnKpi(args.livePiggy, args.closedPiggy),
  };
}

export function formatCapturePct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct >= 0 ? "" : ""}${pct.toFixed(1)}%`;
}
